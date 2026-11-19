// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Stand-in for an origin contract (vault, Morpho, reserve, sibling) in SluiceReactive unit tests.
///         Emits arbitrary logs, and records any callback delivered to it.
contract LogEmitter {
    bytes[] internal _calls;

    function emitLog(bytes32[] calldata topics_, bytes calldata data_) external {
        bytes memory d = data_;
        uint256 n = topics_.length;
        bytes32 t0 = n > 0 ? topics_[0] : bytes32(0);
        bytes32 t1 = n > 1 ? topics_[1] : bytes32(0);
        bytes32 t2 = n > 2 ? topics_[2] : bytes32(0);
        bytes32 t3 = n > 3 ? topics_[3] : bytes32(0);
        assembly {
            let ptr := add(d, 32)
            let len := mload(d)
            switch n
            case 1 { log1(ptr, len, t0) }
            case 2 { log2(ptr, len, t0, t1) }
            case 3 { log3(ptr, len, t0, t1, t2) }
            case 4 { log4(ptr, len, t0, t1, t2, t3) }
            default { log0(ptr, len) }
        }
    }

    fallback() external payable {
        _calls.push(msg.data);
    }

    receive() external payable {}

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function callAt(uint256 i_) external view returns (bytes memory) {
        return _calls[i_];
    }
}
