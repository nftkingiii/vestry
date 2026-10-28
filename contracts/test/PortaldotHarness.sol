// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Portaldot } from "../lib/Portaldot.sol";

/// Exposes the internal library functions so tests can call them.
contract PortaldotHarness {
    function assetToken(uint32 id) external pure returns (address) {
        return Portaldot.assetToken(id);
    }

    function toPlanck(uint256 weiAmount) external pure returns (uint256) {
        return Portaldot.toPlanck(weiAmount);
    }

    function toWei(uint256 planck) external pure returns (uint256) {
        return Portaldot.toWei(planck);
    }

    function vestedPay(address target, uint32 blocks) external payable {
        Portaldot.vestedPay(target, msg.value, blocks);
    }
}
