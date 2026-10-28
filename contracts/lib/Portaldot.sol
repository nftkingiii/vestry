// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Portaldot V3 vesting precompile (pallet-vesting behind pallet-revive). Amounts are native planck (14 decimals).
interface IPortaldotVesting {
    /// Unlock whatever has vested for the caller. Reverts if the caller has no schedule.
    function vest() external;
    /// Unlock whatever has vested for `target`; the caller pays the fee.
    function vestOther(address target) external;
    /// Still-locked (not yet vested) balance of the caller.
    function vestingBalance() external view returns (uint256);
    /// Still-locked (not yet vested) balance of `target`. 0 when none or fully vested.
    function vestingBalanceOf(address target) external view returns (uint256);
    /// Move `locked` planck from the caller to `target` under a schedule releasing `perBlock` from `startingBlock`.
    function vestedTransfer(address target, uint256 locked, uint256 perBlock, uint256 startingBlock) external;
}

/// Helpers for Solidity contracts on Portaldot V3 (pallet-revive) that use the chain's native modules.
/// Every constant here was read back from PortaldotV3 testnet (chain 420420777), not copied from upstream docs.
library Portaldot {
    /// The vesting precompile. Upstream IVesting.sol says 0x...0902, which returns empty data on Portaldot.
    address internal constant VESTING = 0x0000000000000000000000000000000009020000;
    /// pallet-revive maps 1 native planck to 10^4 wei (nativeToEthRatio), so msg.value is 18-decimal wei.
    uint256 internal constant WEI_PER_PLANCK = 1e4;
    /// pallet-vesting's MinVestedTransfer: 1e15 planck = 10 POT. Smaller vested transfers revert.
    uint256 internal constant MIN_VESTED_PLANCK = 1e15;
    /// Address prefix (bytes 16-17) of the ERC-20 precompile that fronts the native Assets pallet.
    uint16 internal constant ASSETS_PREFIX = 0x0001;

    error NotPlanckAligned(uint256 weiAmount);
    error BelowMinVestedTransfer(uint256 planck);
    error ZeroBlocks();

    /// ERC-20 address of native asset `assetId`: the id in the first 4 bytes, 0x0001 in bytes 16-17.
    /// Asset 2 on testnet -> 0x0000000200000000000000000000000000010000.
    function assetToken(uint32 assetId) internal pure returns (address) {
        return address(uint160((uint256(assetId) << 128) | (uint256(ASSETS_PREFIX) << 16)));
    }

    /// Wei (msg.value / EVM balances) to native planck. Reverts unless exact, so no dust is lost.
    function toPlanck(uint256 weiAmount) internal pure returns (uint256) {
        if (weiAmount % WEI_PER_PLANCK != 0) revert NotPlanckAligned(weiAmount);
        return weiAmount / WEI_PER_PLANCK;
    }

    function toWei(uint256 planck) internal pure returns (uint256) {
        return planck * WEI_PER_PLANCK;
    }

    /// Pay `weiAmount` of this contract's POT to `target` as a native vesting lock released evenly over `blocks`,
    /// starting now. Checks the chain's minimum first so the caller gets a clear error instead of a bare revert.
    function vestedPay(address target, uint256 weiAmount, uint32 blocks) internal {
        if (blocks == 0) revert ZeroBlocks();
        uint256 locked = toPlanck(weiAmount);
        if (locked < MIN_VESTED_PLANCK) revert BelowMinVestedTransfer(locked);
        // locked >= 1e15 and blocks < 2^32, so perBlock is never zero.
        IPortaldotVesting(VESTING).vestedTransfer(target, locked, locked / blocks, block.number);
    }
}
