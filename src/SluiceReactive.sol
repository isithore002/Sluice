// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SluiceReactive
/// @notice Reactive contract on Reactive Lasna. Watches every place liquidity can come back from and makes the
///         SluiceVault queue on Base Sepolia settle itself:
///         - Morpho Repay / Supply / Liquidate in our market  -> callback `pullFromMorpho` on the vault;
///         - vault shortfall + Unichain credit + Base inventory -> callback `front` on the RelayerReserve, and only
///           after seeing `Fronted`, callback `reimburse` on the SiblingVault for exactly the amount sent.
/// @dev Robustness rules:
///      - every cache is overwritten from absolute values carried by events (no running counters);
///      - destinations are idempotent and re-emit their result, so a retry heals a missed confirmation;
///      - retries use Cron10 with exponential backoff, at most MAX_ATTEMPTS, and Cron is subscribed only while
///        something is in flight (Cron ticks are billed);
///      - a Liquidate with bad debt in our market halts all cross-chain fronting until the owner resumes;
///      - `react()` never reverts to filter logs (reverts are billed).
contract SluiceReactive is AbstractReactive, Ownable {
    enum Stage {
        NONE,
        FRONTING,
        REIMBURSING,
        DONE
    }

    struct Fill {
        uint256 requested;
        uint256 sent;
        Stage stage;
        uint8 attempts;
        uint256 lastTryBlock;
        uint256 traceId;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------------------

    uint256 internal constant STATE_UPDATED_T0 = uint256(keccak256("StateUpdated(uint256,uint256,uint256)"));
    uint256 internal constant REPAY_T0 = uint256(keccak256("Repay(bytes32,address,address,uint256,uint256)"));
    uint256 internal constant SUPPLY_T0 = uint256(keccak256("Supply(bytes32,address,address,uint256,uint256)"));
    uint256 internal constant LIQUIDATE_T0 =
        uint256(keccak256("Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)"));
    uint256 internal constant FRONTED_T0 = uint256(keccak256("Fronted(uint256,uint256,uint256,uint256,uint256)"));
    uint256 internal constant INVENTORY_T0 = uint256(keccak256("InventoryUpdated(uint256)"));
    uint256 internal constant CREDIT_T0 = uint256(keccak256("CreditCommitted(uint256)"));
    uint256 internal constant REIMBURSED_T0 = uint256(keccak256("Reimbursed(uint256,uint256,uint256,uint256)"));
    uint256 internal constant REIMBURSE_FAILED_T0 = uint256(keccak256("ReimburseFailed(uint256,uint256,uint256)"));

    /// @dev Cron events come from the legacy system address on the Reactive chain itself.
    address internal constant CRON_SOURCE = 0x0000000000000000000000000000000000fffFfF;
    uint256 internal constant CRON1_T0 = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;
    uint256 internal constant CRON10_T0 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;

    uint8 public constant KIND_STATE = 1;
    uint8 public constant KIND_LIQUIDITY = 2;
    uint8 public constant KIND_LIQUIDATE = 3;
    uint8 public constant KIND_FRONTED = 4;
    uint8 public constant KIND_REIMBURSED = 5;
    uint8 public constant KIND_REIMBURSE_FAILED = 6;
    uint8 public constant KIND_CREDIT = 7;
    uint8 public constant KIND_INVENTORY = 8;
    uint8 public constant KIND_DELAYED_PULL = 9;

    uint64 public constant PULL_GAS = 1_500_000;
    uint64 public constant FRONT_GAS = 1_500_000;
    uint64 public constant REIMBURSE_GAS = 300_000;

    uint8 public constant MAX_ATTEMPTS = 3;
    uint64 public constant RETRY_BASE_BLOCKS = 10;
    uint256 public constant MAX_OPEN_FILLS = 10;

    uint256 public immutable BASE_CHAIN_ID;
    uint256 public immutable UNI_CHAIN_ID;

    // ---------------------------------------------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------------------------------------------

    address public vault;
    address public reserve;
    address public sibling;
    address public morpho;
    uint256 public marketId;
    bool public configured;

    // ---------------------------------------------------------------------------------------------------------
    // Absolute caches (overwritten by events)
    // ---------------------------------------------------------------------------------------------------------

    uint256 public pending;
    uint256 public shortfall;
    uint256 public inventory;
    uint256 public credit;

    // ---------------------------------------------------------------------------------------------------------
    // Fills (cross-chain)
    // ---------------------------------------------------------------------------------------------------------

    mapping(uint256 => Fill) public fills;
    uint256[] internal _openFills;
    uint256 public fillNonce;

    // ---------------------------------------------------------------------------------------------------------
    // Pulls (Morpho path)
    // ---------------------------------------------------------------------------------------------------------

    bool public pullPending;
    bool public repullAfterConfirm;
    uint8 public pullAttempts;
    uint256 public pullLastTryBlock;
    uint256 public pullTrace;

    /// @notice Delay mode for the latency race: when > 0, liquidity-triggered pulls wait this many Lasna blocks.
    uint256 public delayBlocks;
    bool public pullScheduled;
    uint256 public pullDueBlock;
    uint256 public scheduledTrace;

    bool public halted;
    bool public cron1On;
    bool public cron10On;

    // ---------------------------------------------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------------------------------------------

    event Configured(address vault, address reserve, address sibling, address morpho, uint256 marketId);
    event Handled(uint256 indexed traceId, uint8 kind, uint256 fillId);
    event PullRequested(uint256 indexed traceId, uint8 attempt);
    event PullScheduled(uint256 indexed traceId, uint256 dueBlock);
    event FrontRequested(uint256 indexed fillId, uint256 amount, uint256 traceId, uint8 attempt);
    event ReimburseRequested(uint256 indexed fillId, uint256 amount, uint256 traceId, uint8 attempt);
    event GaveUp(uint256 indexed fillId, uint256 traceId);
    event Halted(uint256 traceId, uint256 badDebtAssets);
    event Resumed();
    event DelayBlocksSet(uint256 delayBlocks);
    event Resynced(uint256 pending, uint256 shortfall, uint256 inventory, uint256 credit);
    event FillClosed(uint256 indexed fillId, Stage stage);

    error AlreadyConfigured();
    error UnknownFill(uint256 fillId);

    constructor(uint256 baseChainId_, uint256 uniChainId_) payable Ownable(msg.sender) {
        BASE_CHAIN_ID = baseChainId_;
        UNI_CHAIN_ID = uniChainId_;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Owner: setup and repair
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Subscribe to everything. Pass address(0) for reserve and sibling to run the Morpho path only.
    function configure(address vault_, address reserve_, address sibling_, address morpho_, bytes32 marketId_)
        external
        onlyOwner
    {
        if (configured) revert AlreadyConfigured();
        configured = true;
        vault = vault_;
        reserve = reserve_;
        sibling = sibling_;
        morpho = morpho_;
        marketId = uint256(marketId_);

        _sub(BASE_CHAIN_ID, vault_, STATE_UPDATED_T0, REACTIVE_IGNORE);
        _sub(BASE_CHAIN_ID, morpho_, REPAY_T0, uint256(marketId_));
        _sub(BASE_CHAIN_ID, morpho_, SUPPLY_T0, uint256(marketId_));
        _sub(BASE_CHAIN_ID, morpho_, LIQUIDATE_T0, uint256(marketId_));
        if (reserve_ != address(0)) {
            _sub(BASE_CHAIN_ID, reserve_, FRONTED_T0, REACTIVE_IGNORE);
            _sub(BASE_CHAIN_ID, reserve_, INVENTORY_T0, REACTIVE_IGNORE);
        }
        if (sibling_ != address(0)) {
            _sub(UNI_CHAIN_ID, sibling_, CREDIT_T0, REACTIVE_IGNORE);
            _sub(UNI_CHAIN_ID, sibling_, REIMBURSED_T0, REACTIVE_IGNORE);
            _sub(UNI_CHAIN_ID, sibling_, REIMBURSE_FAILED_T0, REACTIVE_IGNORE);
        }
        emit Configured(vault_, reserve_, sibling_, morpho_, uint256(marketId_));
    }

    function setDelayBlocks(uint256 delayBlocks_) external onlyOwner {
        delayBlocks = delayBlocks_;
        emit DelayBlocksSet(delayBlocks_);
    }

    /// @notice Overwrite caches with values read off-chain (e.g. after a period in debt, when events may be lost).
    function resync(uint256 pending_, uint256 shortfall_, uint256 inventory_, uint256 credit_) external onlyOwner {
        pending = pending_;
        shortfall = shortfall_;
        inventory = inventory_;
        credit = credit_;
        emit Resynced(pending_, shortfall_, inventory_, credit_);
    }

    function retryPull() external onlyOwner {
        pullAttempts = 0;
        _requestPull(pullTrace);
        _syncCron();
    }

    function retryFill(uint256 fillId_) external onlyOwner {
        Fill storage f = fills[fillId_];
        if (f.stage == Stage.NONE) revert UnknownFill(fillId_);
        f.attempts = 0;
        if (f.stage == Stage.FRONTING) _requestFront(fillId_, f);
        else if (f.stage == Stage.REIMBURSING) _requestReimburse(fillId_, f);
        _syncCron();
    }

    function closeFill(uint256 fillId_, Stage stage_) external onlyOwner {
        Fill storage f = fills[fillId_];
        if (f.stage == Stage.NONE) revert UnknownFill(fillId_);
        f.stage = stage_;
        if (stage_ == Stage.DONE) _removeOpen(fillId_);
        emit FillClosed(fillId_, stage_);
        _syncCron();
    }

    /// @notice Manual stop for cross-chain fronting (emergencies, or isolating the Morpho path in the race).
    function halt() external onlyOwner {
        halted = true;
        emit Halted(0, 0);
    }

    function resume() external onlyOwner {
        halted = false;
        emit Resumed();
    }

    /// @notice Settle system-contract debt from this contract's lREACT balance. Open to anyone, so anyone can
    ///         fund and restart the contract.
    function coverDebt() external {
        _coverDebt();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------

    function openFills() external view returns (uint256[] memory) {
        return _openFills;
    }

    function inFlight() external view returns (uint256 inFront_, uint256 creditReserved_) {
        return _inFlight();
    }

    // ---------------------------------------------------------------------------------------------------------
    // react()
    // ---------------------------------------------------------------------------------------------------------

    function react(LogRecord calldata log_) external onlySystem {
        address src = log_.contractAddress;
        uint256 t0 = log_.topic0;

        if (src == CRON_SOURCE) {
            if (t0 == CRON1_T0) _onCron1();
            else if (t0 == CRON10_T0) _onCron10();
            return;
        }

        if (log_.chainId == BASE_CHAIN_ID) {
            if (src == vault) {
                if (t0 == STATE_UPDATED_T0) _onState(log_);
            } else if (src == morpho) {
                if (log_.topic1 != marketId) return;
                if (t0 == REPAY_T0 || t0 == SUPPLY_T0) _onLiquidity(log_.txHash, KIND_LIQUIDITY);
                else if (t0 == LIQUIDATE_T0) _onLiquidate(log_);
            } else if (src == reserve) {
                if (t0 == FRONTED_T0) _onFronted(log_);
                else if (t0 == INVENTORY_T0) _onInventory(log_);
            }
        } else if (log_.chainId == UNI_CHAIN_ID && src == sibling) {
            if (t0 == CREDIT_T0) _onCredit(log_);
            else if (t0 == REIMBURSED_T0) _onReimbursed(log_);
            else if (t0 == REIMBURSE_FAILED_T0) _onReimburseFailed(log_);
        }
    }

    // ---------------------------------------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------------------------------------

    function _onState(LogRecord calldata log_) internal {
        if (log_.opCode != 1) return;
        (uint256 p, uint256 s, uint256 t) = abi.decode(log_.data, (uint256, uint256, uint256));
        uint256 trace = t != 0 ? t : log_.txHash;

        bool confirmsPull = pullPending;
        uint256 prevPending = pending;
        pending = p;
        shortfall = s;

        bool repull = false;
        if (confirmsPull) {
            pullPending = false;
            pullAttempts = 0;
            repull = repullAfterConfirm;
            repullAfterConfirm = false;
        }

        // Liquidity the vault can reach (idle or Morpho) while people wait: pull it. A pull that just ran without
        // reducing the queue doesn't trigger another one, so this can't loop.
        if (p > 0 && !pullScheduled) {
            bool reachable = p > s;
            bool progressed = !confirmsPull || p < prevPending;
            if ((reachable && progressed) || repull) _requestPull(trace);
        }

        _maybeFront(trace);
        _syncCron();
        emit Handled(trace, KIND_STATE, 0);
    }

    function _onLiquidity(uint256 trace_, uint8 kind_) internal {
        if (pending > 0) {
            if (delayBlocks == 0) {
                if (pullPending) repullAfterConfirm = true;
                else _requestPull(trace_);
            } else if (!pullScheduled) {
                pullScheduled = true;
                pullDueBlock = block.number + delayBlocks;
                scheduledTrace = trace_;
                emit PullScheduled(trace_, pullDueBlock);
            }
            _syncCron();
        }
        emit Handled(trace_, kind_, 0);
    }

    function _onLiquidate(LogRecord calldata log_) internal {
        if (log_.opCode != 4) return;
        (,,, uint256 badDebtAssets,) = abi.decode(log_.data, (uint256, uint256, uint256, uint256, uint256));
        if (badDebtAssets > 0 && !halted) {
            halted = true;
            emit Halted(log_.txHash, badDebtAssets);
        }
        // Repaid debt still frees liquidity for the queue; only cross-chain fronting stops.
        _onLiquidity(log_.txHash, KIND_LIQUIDATE);
    }

    function _onFronted(LogRecord calldata log_) internal {
        if (log_.opCode != 2) return;
        uint256 fillId = log_.topic1;
        (, uint256 sent, uint256 inv, uint256 t) = abi.decode(log_.data, (uint256, uint256, uint256, uint256));
        inventory = inv;

        Fill storage f = fills[fillId];
        if (f.stage == Stage.FRONTING) {
            f.sent = sent;
            f.attempts = 0;
            if (sent > 0) {
                f.stage = Stage.REIMBURSING;
                _requestReimburse(fillId, f);
            } else {
                f.stage = Stage.DONE;
                _removeOpen(fillId);
            }
        }

        uint256 trace = t != 0 ? t : log_.txHash;
        _maybeFront(trace);
        _syncCron();
        emit Handled(trace, KIND_FRONTED, fillId);
    }

    function _onInventory(LogRecord calldata log_) internal {
        if (log_.opCode != 1) return;
        inventory = abi.decode(log_.data, (uint256));
        _maybeFront(log_.txHash);
        _syncCron();
        emit Handled(log_.txHash, KIND_INVENTORY, 0);
    }

    function _onCredit(LogRecord calldata log_) internal {
        if (log_.opCode != 1) return;
        credit = abi.decode(log_.data, (uint256));

        // Fresh credit revives reimbursements that gave up for lack of it.
        uint256 n = _openFills.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = _openFills[i];
            Fill storage f = fills[id];
            if (f.stage == Stage.REIMBURSING && f.attempts > MAX_ATTEMPTS) {
                f.attempts = 0;
                _requestReimburse(id, f);
            }
        }

        _maybeFront(log_.txHash);
        _syncCron();
        emit Handled(log_.txHash, KIND_CREDIT, 0);
    }

    function _onReimbursed(LogRecord calldata log_) internal {
        if (log_.opCode != 2) return;
        uint256 fillId = log_.topic1;
        (, uint256 creditAvailable, uint256 t) = abi.decode(log_.data, (uint256, uint256, uint256));
        credit = creditAvailable;

        Fill storage f = fills[fillId];
        if (f.stage == Stage.REIMBURSING) {
            f.stage = Stage.DONE;
            _removeOpen(fillId);
        }

        uint256 trace = t != 0 ? t : log_.txHash;
        _maybeFront(trace);
        _syncCron();
        emit Handled(trace, KIND_REIMBURSED, fillId);
    }

    function _onReimburseFailed(LogRecord calldata log_) internal {
        if (log_.opCode != 2) return;
        (, uint256 creditAvailable) = abi.decode(log_.data, (uint256, uint256));
        credit = creditAvailable;
        // Leave the fill in REIMBURSING: the Cron10 retry (or fresh credit) re-sends it.
        _syncCron();
        emit Handled(log_.txHash, KIND_REIMBURSE_FAILED, log_.topic1);
    }

    function _onCron1() internal {
        if (pullScheduled && block.number >= pullDueBlock) {
            pullScheduled = false;
            if (pullPending) repullAfterConfirm = true;
            else _requestPull(scheduledTrace);
            emit Handled(scheduledTrace, KIND_DELAYED_PULL, 0);
        }
        _syncCron();
    }

    function _onCron10() internal {
        if (pullPending && block.number >= pullLastTryBlock + (uint256(RETRY_BASE_BLOCKS) << pullAttempts)) {
            if (pullAttempts < MAX_ATTEMPTS) {
                pullAttempts++;
                _requestPull(pullTrace);
            } else {
                pullPending = false;
                pullAttempts = 0;
                emit GaveUp(0, pullTrace);
            }
        }

        uint256 n = _openFills.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = _openFills[i];
            Fill storage f = fills[id];
            if (f.attempts > MAX_ATTEMPTS) continue;
            if (block.number < f.lastTryBlock + (uint256(RETRY_BASE_BLOCKS) << f.attempts)) continue;
            if (f.attempts == MAX_ATTEMPTS) {
                f.attempts++;
                emit GaveUp(id, f.traceId);
                continue;
            }
            f.attempts++;
            if (f.stage == Stage.FRONTING) _requestFront(id, f);
            else if (f.stage == Stage.REIMBURSING) _requestReimburse(id, f);
        }

        _syncCron();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Decisions and callbacks
    // ---------------------------------------------------------------------------------------------------------

    /// @dev Front min(shortfall, inventory, credit), each net of what open fills already claim.
    function _maybeFront(uint256 trace_) internal {
        if (halted || reserve == address(0) || sibling == address(0)) return;
        if (_openFills.length >= MAX_OPEN_FILLS) return;

        (uint256 inFront, uint256 reserved) = _inFlight();
        uint256 x = _floorSub(shortfall, inFront);
        uint256 inv = _floorSub(inventory, inFront);
        if (inv < x) x = inv;
        uint256 cr = _floorSub(credit, reserved);
        if (cr < x) x = cr;
        if (x == 0) return;

        uint256 id = ++fillNonce;
        fills[id] = Fill({
            requested: x, sent: 0, stage: Stage.FRONTING, attempts: 0, lastTryBlock: block.number, traceId: trace_
        });
        _openFills.push(id);
        _requestFront(id, fills[id]);
    }

    function _requestPull(uint256 trace_) internal {
        pullPending = true;
        pullLastTryBlock = block.number;
        pullTrace = trace_;
        _callback(
            BASE_CHAIN_ID,
            vault,
            PULL_GAS,
            abi.encodeWithSignature("pullFromMorpho(address,uint256)", address(0), trace_)
        );
        emit PullRequested(trace_, pullAttempts);
    }

    function _requestFront(uint256 fillId_, Fill storage f_) internal {
        f_.lastTryBlock = block.number;
        _callback(
            BASE_CHAIN_ID,
            reserve,
            FRONT_GAS,
            abi.encodeWithSignature(
                "front(address,uint256,uint256,uint256)", address(0), fillId_, f_.requested, f_.traceId
            )
        );
        emit FrontRequested(fillId_, f_.requested, f_.traceId, f_.attempts);
    }

    function _requestReimburse(uint256 fillId_, Fill storage f_) internal {
        f_.lastTryBlock = block.number;
        _callback(
            UNI_CHAIN_ID,
            sibling,
            REIMBURSE_GAS,
            abi.encodeWithSignature(
                "reimburse(address,uint256,uint256,uint256)", address(0), fillId_, f_.sent, f_.traceId
            )
        );
        emit ReimburseRequested(fillId_, f_.sent, f_.traceId, f_.attempts);
    }

    function _callback(uint256 chainId_, address recipient_, uint64 gasLimit_, bytes memory payload_) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: chainId_, recipient: recipient_, gasLimit: gasLimit_, payload: payload_
            })
        );
    }

    // ---------------------------------------------------------------------------------------------------------
    // Cron (subscribed only while needed: every tick is billed)
    // ---------------------------------------------------------------------------------------------------------

    function _syncCron() internal {
        bool need10 = pullPending || _hasRetryableFill();
        if (need10 != cron10On) {
            cron10On = need10;
            if (need10) _sub(block.chainid, CRON_SOURCE, CRON10_T0, REACTIVE_IGNORE);
            else _unsub(block.chainid, CRON_SOURCE, CRON10_T0, REACTIVE_IGNORE);
        }
        bool need1 = pullScheduled;
        if (need1 != cron1On) {
            cron1On = need1;
            if (need1) _sub(block.chainid, CRON_SOURCE, CRON1_T0, REACTIVE_IGNORE);
            else _unsub(block.chainid, CRON_SOURCE, CRON1_T0, REACTIVE_IGNORE);
        }
    }

    function _hasRetryableFill() internal view returns (bool) {
        uint256 n = _openFills.length;
        for (uint256 i; i < n; ++i) {
            if (fills[_openFills[i]].attempts <= MAX_ATTEMPTS) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------

    function _inFlight() internal view returns (uint256 inFront_, uint256 reserved_) {
        uint256 n = _openFills.length;
        for (uint256 i; i < n; ++i) {
            Fill storage f = fills[_openFills[i]];
            if (f.stage == Stage.FRONTING) {
                inFront_ += f.requested;
                reserved_ += f.requested;
            } else if (f.stage == Stage.REIMBURSING) {
                reserved_ += f.sent;
            }
        }
    }

    function _removeOpen(uint256 fillId_) internal {
        uint256 n = _openFills.length;
        for (uint256 i; i < n; ++i) {
            if (_openFills[i] == fillId_) {
                _openFills[i] = _openFills[n - 1];
                _openFills.pop();
                return;
            }
        }
    }

    function _floorSub(uint256 a_, uint256 b_) internal pure returns (uint256) {
        return a_ > b_ ? a_ - b_ : 0;
    }

    function _sub(uint256 chainId_, address contract_, uint256 topic0_, uint256 topic1_) internal {
        SYSTEM.subscribe(chainId_, contract_, topic0_, topic1_, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _unsub(uint256 chainId_, address contract_, uint256 topic0_, uint256 topic1_) internal {
        SYSTEM.unsubscribe(chainId_, contract_, topic0_, topic1_, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }
}
