// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

// Toolchain smoke test: proves the pinned libraries compile together and that
// reactive-test-lib (omni branch) can run a full origin -> react() -> callback cycle.
// The Ping* contracts are test fixtures only, not Sluice code.

import {ReactiveTest, FeeMode, CallbackResult} from "reactive-test-lib/ReactiveTest.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
// IMorpho and ERC20 are imported only to prove the morpho-blue and OpenZeppelin remappings resolve.
// forge-lint: disable-next-line(unused-import)
import {IMorpho, MarketParams, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
// forge-lint: disable-next-line(unused-import)
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PingOrigin {
    event Ping(uint256 indexed n);

    function ping(uint256 n) external {
        emit Ping(n);
    }
}

contract PingReactive is AbstractReactive {
    uint256 public immutable DEST_CHAIN;
    address public immutable DESTINATION;

    constructor(uint256 originChain_, address origin_, uint256 destChain_, address destination_) {
        DEST_CHAIN = destChain_;
        DESTINATION = destination_;
        SYSTEM.subscribe(
            originChain_, origin_, uint256(PingOrigin.Ping.selector), REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    function react(LogRecord calldata log_) external onlySystem {
        // Echo the origin tx hash as the trace id, as Sluice will.
        bytes memory payload =
            abi.encodeWithSignature("pong(address,uint256,uint256)", address(0), log_.topic1, log_.txHash);
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: DEST_CHAIN, recipient: DESTINATION, gasLimit: 200_000, payload: payload
            })
        );
    }
}

contract PingCallback is AbstractCallback {
    event Pong(uint256 n, uint256 traceId);

    uint256 public lastN;

    constructor(address proxy_, address reactive_) AbstractCallback(IPayable(payable(proxy_)), reactive_) {}

    function pong(address rvm_, uint256 n_, uint256 traceId_) external onlyServiceProvider onlyCallbackSender(rvm_) {
        lastN = n_;
        emit Pong(n_, traceId_);
    }
}

contract ToolchainTest is ReactiveTest {
    uint256 internal constant REACTIVE_CHAIN = 5318007; // Lasna
    uint256 internal constant BASE_SEPOLIA = 84532;

    PingOrigin internal origin;
    PingReactive internal reactive;
    PingCallback internal callback_;

    function setUp() public {
        _reactiveSetUp(REACTIVE_CHAIN);
        address proxy = _registerChain(BASE_SEPOLIA);

        origin = new PingOrigin();

        // Deployment order from the docs: reactive first, then the callback that names it.
        // The reactive needs the callback's address, so predict it (next nonce of this test contract).
        address predictedCallback = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reactive = new PingReactive(BASE_SEPOLIA, address(origin), BASE_SEPOLIA, predictedCallback);
        callback_ = new PingCallback(proxy, address(reactive));
        assertEq(address(callback_), predictedCallback, "callback address prediction");

        _registerContract(REACTIVE_CHAIN, address(reactive));
        _registerContract(BASE_SEPOLIA, address(origin));
        _registerContract(BASE_SEPOLIA, address(callback_));
    }

    function test_fullCycle_originToCallback() public {
        _switchToChain(BASE_SEPOLIA);
        origin.ping(42);

        _switchToChain(REACTIVE_CHAIN);
        CallbackResult[] memory results = _react(FeeMode.Subsidized);

        assertEq(results.length, 1, "one callback");
        assertTrue(results[0].success, "callback succeeded");
        assertEq(results[0].sender, address(reactive), "injected sender is the reactive contract");
        assertEq(callback_.lastN(), 42, "payload delivered");
    }

    function test_morphoMarketIdLib() public pure {
        // Compile-level check that morpho-blue libs resolve; id is keccak256(abi.encode(params)).
        MarketParams memory p = MarketParams({
            loanToken: address(1), collateralToken: address(2), oracle: address(3), irm: address(0), lltv: 0.86e18
        });
        Id id = MarketParamsLib.id(p);
        assertEq(Id.unwrap(id), keccak256(abi.encode(p)));
    }
}
