// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVestryLike {
    function release(uint256 grantId, uint256 index) external;
    function reclaim(uint256 grantId, uint256 index) external;
    function submitMilestone(uint256 grantId, uint256 index, string calldata evidence) external;
}

/// A grantee contract that tries to re-enter Vestry while being paid.
contract ReentrantGrantee {
    IVestryLike public vestry;
    uint256 public grantId;
    uint256 public index;
    bool public reentered;
    bool public reentrySucceeded;

    function arm(address v, uint256 g, uint256 i) external {
        vestry = IVestryLike(v);
        grantId = g;
        index = i;
    }

    function submit(string calldata evidence) external {
        vestry.submitMilestone(grantId, index, evidence);
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;
        try vestry.release(grantId, index) {
            reentrySucceeded = true;
        } catch {}
    }
}

/// A grantee contract that refuses native payments.
contract RejectingGrantee {
    function submit(address vestry, uint256 grantId, uint256 index) external {
        IVestryLike(vestry).submitMilestone(grantId, index, "work");
    }

    receive() external payable {
        revert("no thanks");
    }
}

/// A usage target whose counter reverts, to check what an unreadable metric does to a milestone.
contract BrokenMetric {
    function entryCount() external pure returns (uint256) {
        revert("broken");
    }
}
