// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMorpho, MarketParams, Market, Position, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {SharesMathLib} from "morpho-blue/libraries/SharesMathLib.sol";
import {ISluiceVault} from "./interfaces/ISluiceVault.sol";

/// @title SluiceVault
/// @notice A vault on Base Sepolia that lends into one Morpho Blue market and runs a FIFO withdrawal queue that
///         settles itself:
///         - deposits into this vault pay the queue in the same transaction (no Reactive needed);
///         - repayments in Morpho (a contract we don't control) reach us as a Reactive callback, `pullFromMorpho`;
///         - cross-chain liquidity arrives from the RelayerReserve via `onFronted`.
/// @dev Shares are 1:1 with assets: the demo market uses `irm = address(0)`, so there is no yield to account for.
///      Reservation rule: while anyone is queued, new withdrawals queue behind them and idle assets only leave
///      the vault to pay the queue.
contract SluiceVault is ISluiceVault, AbstractCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MarketParamsLib for MarketParams;
    using SharesMathLib for uint256;

    struct Request {
        address owner;
        uint256 remaining;
    }

    /// @notice Upper bound on queue payments per call, so a callback's gas stays bounded.
    uint256 public constant MAX_FILLS_PER_CALL = 25;

    IERC20 public immutable ASSET;
    IMorpho public immutable MORPHO;
    Id public immutable MARKET_ID;

    MarketParams internal _marketParams;

    address public reserve;
    uint256 public bufferTarget;

    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    Request[] internal _queue;
    uint256 public head;
    uint256 public pendingTotal;

    constructor(
        IPayable callbackProxy_,
        address callbackSender_,
        IMorpho morpho_,
        MarketParams memory marketParams_,
        address owner_
    ) payable AbstractCallback(callbackProxy_, callbackSender_) Ownable(owner_) {
        ASSET = IERC20(marketParams_.loanToken);
        MORPHO = morpho_;
        _marketParams = marketParams_;
        MARKET_ID = marketParams_.id();
        IERC20(marketParams_.loanToken).forceApprove(address(morpho_), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------------------
    // User functions
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Deposit assets. If anyone is queued, the deposit pays them first, in the same transaction.
    function deposit(uint256 assets_) external nonReentrant {
        if (assets_ == 0) revert ZeroAmount();
        ASSET.safeTransferFrom(msg.sender, address(this), assets_);
        sharesOf[msg.sender] += assets_;
        totalShares += assets_;
        emit Deposited(msg.sender, assets_);

        _settle(0);
        _allocate();
        _emitState(0);
    }

    /// @notice Withdraw assets. Paid instantly when nobody is queued and liquidity suffices, otherwise queued.
    /// @return queued_ True if the request joined the queue.
    /// @return requestId_ The queue position (only meaningful when queued).
    function requestWithdraw(uint256 assets_) external nonReentrant returns (bool queued_, uint256 requestId_) {
        if (assets_ == 0) revert ZeroAmount();
        if (sharesOf[msg.sender] < assets_) revert InsufficientShares();
        sharesOf[msg.sender] -= assets_;
        totalShares -= assets_;

        if (pendingTotal == 0) {
            uint256 idleNow = _idle();
            if (idleNow < assets_) {
                uint256 need = assets_ - idleNow;
                if (_morphoWithdrawable() >= need) _withdrawFromMorpho(need, 0);
            }
            if (_idle() >= assets_) {
                ASSET.safeTransfer(msg.sender, assets_);
                emit WithdrawPaidInstantly(msg.sender, assets_);
                _emitState(0);
                return (false, 0);
            }
        }

        requestId_ = _queue.length;
        _queue.push(Request({owner: msg.sender, remaining: assets_}));
        pendingTotal += assets_;
        emit WithdrawQueued(requestId_, msg.sender, assets_);

        // Pay whatever this vault can reach right now; Reactive handles what it can't.
        _pullAvailable(0);
        _settle(0);
        _emitState(0);
        return (true, requestId_);
    }

    /// @notice Permissionless nudge: pull reachable Morpho liquidity and pay the queue.
    /// @dev Not needed for normal operation (Reactive does this); exists so nobody is ever stuck on a single path.
    function poke() external nonReentrant {
        _pullAvailable(0);
        _settle(0);
        _allocate();
        _emitState(0);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Reactive callback and reserve hook
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Reactive callback: liquidity appeared in Morpho, so pull it and pay the queue.
    /// @dev Never reverts when there is nothing to do (reverts are billed), and always emits StateUpdated, which
    ///      is SluiceReactive's confirmation that the pull ran.
    function pullFromMorpho(address rvm_, uint256 traceId_)
        external
        nonReentrant
        onlyServiceProvider
        onlyCallbackSender(rvm_)
    {
        _pullAvailable(traceId_);
        _settle(traceId_);
        _emitState(traceId_);
    }

    /// @notice Called by the RelayerReserve right after it transferred `amount_` to this vault.
    function onFronted(uint256, uint256, uint256 traceId_) external nonReentrant {
        if (msg.sender != reserve) revert NotReserve();
        _settle(traceId_);
        _emitState(traceId_);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Owner
    // ---------------------------------------------------------------------------------------------------------

    function setReserve(address reserve_) external onlyOwner {
        if (reserve != address(0)) revert ReserveAlreadySet();
        reserve = reserve_;
        emit ReserveSet(reserve_);
    }

    function setBufferTarget(uint256 bufferTarget_) external onlyOwner {
        bufferTarget = bufferTarget_;
        emit BufferTargetSet(bufferTarget_);
    }

    /// @notice Settle callback-proxy debt from this contract's ETH balance.
    function coverDebt() external {
        _coverDebt();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------

    function marketParams() external view returns (MarketParams memory) {
        return _marketParams;
    }

    function queueLength() external view returns (uint256) {
        return _queue.length;
    }

    function request(uint256 requestId_) external view returns (address owner_, uint256 remaining_) {
        Request storage r = _queue[requestId_];
        return (r.owner, r.remaining);
    }

    function idle() external view returns (uint256) {
        return _idle();
    }

    /// @notice This vault's supply in our Morpho market, in assets.
    function morphoSupplied() public view returns (uint256) {
        Market memory m = MORPHO.market(MARKET_ID);
        Position memory p = MORPHO.position(MARKET_ID, address(this));
        return p.supplyShares.toAssetsDown(m.totalSupplyAssets, m.totalSupplyShares);
    }

    /// @notice How much this vault could withdraw from Morpho right now.
    function morphoWithdrawable() external view returns (uint256) {
        return _morphoWithdrawable();
    }

    /// @notice What the queue still needs beyond everything this vault can reach (idle + Morpho).
    function shortfall() public view returns (uint256) {
        uint256 reachable = _idle() + _morphoWithdrawable();
        return pendingTotal > reachable ? pendingTotal - reachable : 0;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------

    function _idle() internal view returns (uint256) {
        return ASSET.balanceOf(address(this));
    }

    function _morphoWithdrawable() internal view returns (uint256) {
        Market memory m = MORPHO.market(MARKET_ID);
        uint256 ours = MORPHO.position(MARKET_ID, address(this)).supplyShares
            .toAssetsDown(m.totalSupplyAssets, m.totalSupplyShares);
        uint256 liquidity = m.totalSupplyAssets > m.totalBorrowAssets ? m.totalSupplyAssets - m.totalBorrowAssets : 0;
        return ours < liquidity ? ours : liquidity;
    }

    /// @dev Withdraw from Morpho whatever the queue needs beyond idle, capped by what's withdrawable.
    function _pullAvailable(uint256 traceId_) internal {
        uint256 idleNow = _idle();
        if (pendingTotal <= idleNow) return;
        uint256 need = pendingTotal - idleNow;
        uint256 available = _morphoWithdrawable();
        uint256 amount = need < available ? need : available;
        if (amount > 0) _withdrawFromMorpho(amount, traceId_);
    }

    function _withdrawFromMorpho(uint256 amount_, uint256 traceId_) internal {
        MORPHO.withdraw(_marketParams, amount_, 0, address(this), address(this));
        emit PulledFromMorpho(amount_, traceId_);
    }

    /// @dev Supply idle above the buffer to Morpho. Disabled while anyone is queued (reservation rule).
    function _allocate() internal {
        if (pendingTotal > 0) return;
        uint256 idleNow = _idle();
        if (idleNow <= bufferTarget) return;
        uint256 amount = idleNow - bufferTarget;
        MORPHO.supply(_marketParams, amount, 0, address(this), "");
        emit Allocated(amount);
    }

    /// @dev FIFO with partial fills: the head is paid as much as possible before anyone behind it.
    function _settle(uint256 traceId_) internal {
        uint256 available = _idle();
        uint256 fills;
        uint256 h = head;
        uint256 len = _queue.length;
        while (available > 0 && h < len && fills < MAX_FILLS_PER_CALL) {
            Request storage r = _queue[h];
            uint256 pay = r.remaining < available ? r.remaining : available;
            r.remaining -= pay;
            available -= pay;
            pendingTotal -= pay;
            ASSET.safeTransfer(r.owner, pay);
            emit WithdrawSettled(h, r.owner, pay, r.remaining, traceId_);
            if (r.remaining == 0) h++;
            fills++;
        }
        head = h;
    }

    function _emitState(uint256 traceId_) internal {
        emit StateUpdated(pendingTotal, shortfall(), traceId_);
    }
}
