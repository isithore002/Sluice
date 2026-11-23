// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {RelayerReserve} from "../../src/RelayerReserve.sol";
import {SiblingVault} from "../../src/SiblingVault.sol";
import {ISluiceVault} from "../../src/interfaces/ISluiceVault.sol";
import {MockUSD} from "../../src/mocks/MockUSD.sol";

/// @dev Stands in for the vault: it only needs to accept `onFronted`.
contract VaultSink {
    function onFronted(uint256, uint256, uint256) external {}
}

/// @notice Hammers the two destination callbacks with duplicated, reordered, oversized and forged calls. Reactive can
///         deliver the same instruction more than once, so these properties are what keep a retry from paying twice.
contract ReserveHandler is Test {
    RelayerReserve public immutable RESERVE;
    MockUSD public immutable USD;
    address public immutable VAULT;
    address public immutable PROXY;
    address public immutable RVM;
    address public immutable RELAYER;

    uint256 public constant FILLS = 6;
    uint256 public ghostFunded;
    uint256 public ghostWithdrawn;
    /// @dev What the first execution of each fill sent, which no later call may change.
    mapping(uint256 => uint256) public firstSent;
    mapping(uint256 => bool) public seen;
    uint256 public forgedAttempts;
    uint256 public forgedSucceeded;

    constructor(RelayerReserve reserve_, MockUSD usd_, address vault_, address proxy_, address rvm_, address relayer_) {
        RESERVE = reserve_;
        USD = usd_;
        VAULT = vault_;
        PROXY = proxy_;
        RVM = rvm_;
        RELAYER = relayer_;
    }

    function fund(uint256 amount_) external {
        amount_ = bound(amount_, 1, 1_000e6);
        USD.mint(RELAYER, amount_);
        vm.startPrank(RELAYER);
        USD.approve(address(RESERVE), amount_);
        RESERVE.fund(amount_);
        vm.stopPrank();
        ghostFunded += amount_;
    }

    function withdrawInventory(uint256 amount_) external {
        uint256 bal = USD.balanceOf(address(RESERVE));
        if (bal == 0) return;
        amount_ = bound(amount_, 1, bal);
        vm.prank(RELAYER);
        RESERVE.withdrawInventory(amount_);
        ghostWithdrawn += amount_;
    }

    /// @dev The same fill id comes back with different amounts and traces, like a retried or duplicated callback.
    function front(uint256 fillId_, uint256 amount_, uint256 trace_) external {
        fillId_ = bound(fillId_, 1, FILLS);
        amount_ = bound(amount_, 0, 1_500e6);
        vm.prank(PROXY);
        RESERVE.front(RVM, fillId_, amount_, trace_);
        (,, uint256 sent) = RESERVE.fills(fillId_);
        if (!seen[fillId_]) {
            seen[fillId_] = true;
            firstSent[fillId_] = sent;
        }
    }

    /// @dev Anyone but the callback proxy, and the proxy with a forged reactive sender.
    function forgedFront(address caller_, address rvm_, uint256 fillId_, uint256 amount_) external {
        vm.assume(caller_ != PROXY || rvm_ != RVM);
        ++forgedAttempts;
        vm.prank(caller_);
        try RESERVE.front(rvm_, bound(fillId_, 1, FILLS), amount_, 0) {
            ++forgedSucceeded;
        } catch {}
    }
}

contract SiblingHandler is Test {
    SiblingVault public immutable SIBLING;
    MockUSD public immutable USD;
    address public immutable PROXY;
    address public immutable RVM;
    address public immutable PAYEE;
    address public immutable LP;
    address public immutable OWNER;

    uint256 public constant FILLS = 6;
    mapping(uint256 => uint256) public firstPaid;
    mapping(uint256 => bool) public seen;
    uint256 public forgedAttempts;
    uint256 public forgedSucceeded;

    constructor(
        SiblingVault sibling_,
        MockUSD usd_,
        address proxy_,
        address rvm_,
        address payee_,
        address lp_,
        address owner_
    ) {
        OWNER = owner_;
        SIBLING = sibling_;
        USD = usd_;
        PROXY = proxy_;
        RVM = rvm_;
        PAYEE = payee_;
        LP = lp_;
    }

    function deposit(uint256 amount_) external {
        amount_ = bound(amount_, 1, 1_000e6);
        USD.mint(LP, amount_);
        vm.startPrank(LP);
        USD.approve(address(SIBLING), amount_);
        SIBLING.deposit(amount_);
        vm.stopPrank();
    }

    function withdraw(uint256 amount_) external {
        uint256 shares = SIBLING.sharesOf(LP);
        if (shares == 0) return;
        vm.prank(LP);
        // May exceed what is uncommitted: the vault must refuse, never dip into credit.
        try SIBLING.withdraw(bound(amount_, 1, shares)) {} catch {}
    }

    function commitCredit() external {
        vm.prank(OWNER);
        SIBLING.commitCredit();
    }

    /// @dev Repeats, different amounts for the same fill, zero, and more than the credit.
    function reimburse(uint256 fillId_, uint256 amount_, uint256 trace_) external {
        fillId_ = bound(fillId_, 1, FILLS);
        amount_ = bound(amount_, 0, 1_500e6);
        vm.prank(PROXY);
        SIBLING.reimburse(RVM, fillId_, amount_, trace_);
        uint256 paid = SIBLING.paidAmount(fillId_);
        if (!seen[fillId_] && paid != 0) {
            seen[fillId_] = true;
            firstPaid[fillId_] = paid;
        }
    }

    function forgedReimburse(address caller_, address rvm_, uint256 fillId_, uint256 amount_) external {
        vm.assume(caller_ != PROXY || rvm_ != RVM);
        ++forgedAttempts;
        vm.prank(caller_);
        try SIBLING.reimburse(rvm_, bound(fillId_, 1, FILLS), amount_, 0) {
            ++forgedSucceeded;
        } catch {}
    }
}

contract CallbackInvariantTest is Test {
    RelayerReserve internal reserve;
    SiblingVault internal sibling;
    MockUSD internal usd;
    VaultSink internal vault;
    ReserveHandler internal reserveHandler;
    SiblingHandler internal siblingHandler;

    address internal proxy = makeAddr("callbackProxy");
    address internal rvm = makeAddr("sluiceReactive");
    address internal relayer = makeAddr("relayer");
    address internal payee = makeAddr("relayerPayee");
    address internal lp = makeAddr("lp");
    address internal owner = makeAddr("owner");

    function setUp() public {
        usd = new MockUSD();
        vault = new VaultSink();
        reserve = new RelayerReserve(IPayable(payable(proxy)), rvm, usd, ISluiceVault(address(vault)), relayer);
        sibling = new SiblingVault(IPayable(payable(proxy)), rvm, usd, payee, 100e6, owner);
        reserveHandler = new ReserveHandler(reserve, usd, address(vault), proxy, rvm, relayer);
        siblingHandler = new SiblingHandler(sibling, usd, proxy, rvm, payee, lp, owner);
        targetContract(address(reserveHandler));
        targetContract(address(siblingHandler));
    }

    // ----- RelayerReserve ------------------------------------------------------------------------------------

    /// @notice Cash never leaves the reserve twice for one fill: what the vault received equals the sum of what each
    ///         fill first sent, however many times it was retried.
    function invariant_reserve_noDoubleFront() public view {
        uint256 sum;
        for (uint256 id = 1; id <= reserveHandler.FILLS(); ++id) {
            (,, uint256 sent) = reserve.fills(id);
            sum += sent;
        }
        assertEq(usd.balanceOf(address(vault)), sum);
    }

    /// @notice A fill's stored result is fixed by its first execution.
    function invariant_reserve_fillResultIsFinal() public view {
        for (uint256 id = 1; id <= reserveHandler.FILLS(); ++id) {
            if (!reserveHandler.seen(id)) continue;
            (,, uint256 sent) = reserve.fills(id);
            assertEq(sent, reserveHandler.firstSent(id));
        }
    }

    /// @notice A fill never sends more than it was asked for.
    function invariant_reserve_neverSendsMoreThanRequested() public view {
        for (uint256 id = 1; id <= reserveHandler.FILLS(); ++id) {
            (, uint256 requested, uint256 sent) = reserve.fills(id);
            assertLe(sent, requested);
        }
    }

    /// @notice Inventory accounting: funded = still held + fronted to the vault + taken back by the relayer.
    function invariant_reserve_inventoryConserved() public view {
        assertEq(
            reserveHandler.ghostFunded(),
            usd.balanceOf(address(reserve)) + usd.balanceOf(address(vault)) + reserveHandler.ghostWithdrawn()
        );
    }

    /// @notice Only the callback proxy carrying Reactive's address can front.
    function invariant_reserve_noForgedCall() public view {
        assertEq(reserveHandler.forgedSucceeded(), 0);
    }

    // ----- SiblingVault --------------------------------------------------------------------------------------

    /// @notice The relayer is paid exactly once per fill: its balance is the sum of each fill's first payment.
    function invariant_sibling_noDoubleReimbursement() public view {
        uint256 sum;
        for (uint256 id = 1; id <= siblingHandler.FILLS(); ++id) {
            sum += sibling.paidAmount(id);
        }
        assertEq(usd.balanceOf(payee), sum);
    }

    /// @notice A reimbursement, once made, never changes.
    function invariant_sibling_paymentIsFinal() public view {
        for (uint256 id = 1; id <= siblingHandler.FILLS(); ++id) {
            if (!siblingHandler.seen(id)) continue;
            assertEq(sibling.paidAmount(id), siblingHandler.firstPaid(id));
        }
    }

    /// @notice Committed credit is always backed by real balance, so a reimbursement can never be unfunded.
    function invariant_sibling_creditIsBacked() public view {
        assertGe(usd.balanceOf(address(sibling)), sibling.creditAvailable());
    }

    function invariant_sibling_noForgedCall() public view {
        assertEq(siblingHandler.forgedSucceeded(), 0);
    }
}
