// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Local stand-in for the Portaldot vesting precompile. Hardhat has no pallet-vesting,
/// so this records schedules; the real lock is proven on testnet, not here.
contract MockVesting {
    struct Schedule {
        uint256 locked;
        uint256 perBlock;
        uint256 startingBlock;
    }

    mapping(address => Schedule[]) public schedules;

    event VestedTransfer(address indexed from, address indexed target, uint256 locked, uint256 perBlock, uint256 startingBlock);

    function vestedTransfer(address target, uint256 locked, uint256 perBlock, uint256 startingBlock) external {
        require(locked >= 1e15, "below MinVestedTransfer");
        require(perBlock > 0, "perBlock zero");
        schedules[target].push(Schedule(locked, perBlock, startingBlock));
        emit VestedTransfer(msg.sender, target, locked, perBlock, startingBlock);
    }

    function vestingBalanceOf(address target) external view returns (uint256 total) {
        Schedule[] storage s = schedules[target];
        for (uint256 i; i < s.length; ++i) total += s[i].locked;
    }

    function scheduleCount(address target) external view returns (uint256) {
        return schedules[target].length;
    }
}

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
