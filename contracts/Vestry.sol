// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Portaldot V3 vesting precompile (pallet-vesting behind pallet-revive).
/// Verified on PortaldotV3 testnet: answers at 0x...09020000, not the 0x...0902
/// constant in upstream IVesting.sol. Amounts are in native planck (14 decimals).
interface IVesting {
    function vestedTransfer(address target, uint256 locked, uint256 perBlock, uint256 startingBlock) external;
    function vestingBalanceOf(address target) external view returns (uint256);
}

/// Native pallet-assets are exposed as ERC-20 precompiles at 0x{assetId}000...00010000.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Vestry: milestone grants whose tranches leave escrow only after reviewer quorum
/// and, optionally, an on-chain activity metric read directly from the grantee's
/// own contract. Native POT tranches land as native vesting locks on the grantee.
contract Vestry {
    address public constant VESTING = 0x0000000000000000000000000000000009020000;
    /// pallet-revive maps 1 native planck to 10^4 wei (nativeToEthRatio).
    uint256 public constant WEI_PER_PLANCK = 1e4;

    enum MilestoneState { Open, Submitted, Released, Reclaimed }

    struct Milestone {
        uint256 amount;          // wei for native POT, token units for an asset
        uint64 deadline;         // unix seconds; after it, unreleased funds return to the funder
        uint32 vestingBlocks;    // 0 = paid out unlocked; >0 = native vesting lock (POT only)
        uint32 approvals;
        uint32 round;            // bumps on every change request so stale approvals do not count
        MilestoneState state;
        address metricTarget;    // optional activity gate: staticcall target
        bytes4 metricSelector;   // view function returning uint256
        uint256 metricMin;
        string evidence;         // grantee's delivery proof (commit, URL, tx)
    }

    struct Grant {
        address funder;
        address grantee;
        address token;           // address(0) = native POT
        uint32 threshold;
        address[] reviewers;
        Milestone[] milestones;
    }

    Grant[] internal grants;
    mapping(uint256 => mapping(address => bool)) public isReviewer;
    mapping(uint256 => mapping(uint256 => mapping(uint32 => mapping(address => bool)))) public approved;

    struct MilestoneInput {
        uint256 amount;
        uint64 deadline;
        uint32 vestingBlocks;
        address metricTarget;
        bytes4 metricSelector;
        uint256 metricMin;
    }

    event GrantCreated(uint256 indexed grantId, address indexed funder, address indexed grantee, address token, uint256 total);
    event MilestoneSubmitted(uint256 indexed grantId, uint256 indexed index, string evidence);
    event MilestoneApproved(uint256 indexed grantId, uint256 indexed index, address indexed reviewer, uint32 approvals);
    event ChangesRequested(uint256 indexed grantId, uint256 indexed index, address indexed reviewer, string reason);
    event AwaitingMetric(uint256 indexed grantId, uint256 indexed index);
    event MilestoneReleased(uint256 indexed grantId, uint256 indexed index, uint256 amount, uint32 vestingBlocks, uint256 metricValue);
    event MilestoneReclaimed(uint256 indexed grantId, uint256 indexed index, uint256 amount);

    error NotFunder();
    error NotGrantee();
    error NotReviewer();
    error BadConfig();
    error BadState();
    error AlreadyApproved();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error MetricBelowTarget(uint256 value, uint256 required);
    error MetricUnreadable();
    error PayoutFailed();

    function createGrant(
        address grantee,
        address token,
        address[] calldata reviewers,
        uint32 threshold,
        MilestoneInput[] calldata inputs
    ) external payable returns (uint256 grantId) {
        if (grantee == address(0) || reviewers.length == 0 || threshold == 0 || threshold > reviewers.length || inputs.length == 0) {
            revert BadConfig();
        }
        grantId = grants.length;
        Grant storage g = grants.push();
        g.funder = msg.sender;
        g.grantee = grantee;
        g.token = token;
        g.threshold = threshold;

        for (uint256 i; i < reviewers.length; ++i) {
            address r = reviewers[i];
            if (r == address(0) || r == grantee || isReviewer[grantId][r]) revert BadConfig();
            isReviewer[grantId][r] = true;
            g.reviewers.push(r);
        }

        uint256 total;
        for (uint256 i; i < inputs.length; ++i) {
            MilestoneInput calldata m = inputs[i];
            if (m.amount == 0 || m.deadline <= block.timestamp) revert BadConfig();
            if (token == address(0) && m.amount % WEI_PER_PLANCK != 0) revert BadConfig();
            if (token != address(0) && m.vestingBlocks != 0) revert BadConfig();
            if (m.vestingBlocks != 0 && m.amount / WEI_PER_PLANCK < m.vestingBlocks) revert BadConfig();
            if ((m.metricTarget == address(0)) != (m.metricSelector == bytes4(0))) revert BadConfig();
            Milestone storage s = g.milestones.push();
            s.amount = m.amount;
            s.deadline = m.deadline;
            s.vestingBlocks = m.vestingBlocks;
            s.metricTarget = m.metricTarget;
            s.metricSelector = m.metricSelector;
            s.metricMin = m.metricMin;
            total += m.amount;
        }

        if (token == address(0)) {
            if (msg.value != total) revert BadConfig();
        } else {
            if (msg.value != 0) revert BadConfig();
            if (!IERC20(token).transferFrom(msg.sender, address(this), total)) revert PayoutFailed();
        }
        emit GrantCreated(grantId, msg.sender, grantee, token, total);
    }

    function submitMilestone(uint256 grantId, uint256 index, string calldata evidence) external {
        Grant storage g = grants[grantId];
        if (msg.sender != g.grantee) revert NotGrantee();
        Milestone storage m = g.milestones[index];
        if (m.state != MilestoneState.Open) revert BadState();
        if (block.timestamp > m.deadline) revert DeadlinePassed();
        m.state = MilestoneState.Submitted;
        m.evidence = evidence;
        emit MilestoneSubmitted(grantId, index, evidence);
    }

    /// Approve the submitted evidence. The approval that reaches quorum releases the
    /// tranche in the same transaction, so a passing metric is read at payout time.
    function approveMilestone(uint256 grantId, uint256 index) external {
        Grant storage g = grants[grantId];
        if (!isReviewer[grantId][msg.sender]) revert NotReviewer();
        Milestone storage m = g.milestones[index];
        if (m.state != MilestoneState.Submitted) revert BadState();
        if (block.timestamp > m.deadline) revert DeadlinePassed();
        if (approved[grantId][index][m.round][msg.sender]) revert AlreadyApproved();
        approved[grantId][index][m.round][msg.sender] = true;
        m.approvals += 1;
        emit MilestoneApproved(grantId, index, msg.sender, m.approvals);
        if (m.approvals >= g.threshold) {
            if (m.metricTarget == address(0) || readMetric(m.metricTarget, m.metricSelector) >= m.metricMin) {
                _release(g, grantId, index, m);
            } else {
                emit AwaitingMetric(grantId, index);
            }
        }
    }

    /// Anyone may trigger payout once quorum is reached; reverts while the activity
    /// metric is below target, so the tranche stays in escrow until it is met.
    function release(uint256 grantId, uint256 index) external {
        Grant storage g = grants[grantId];
        Milestone storage m = g.milestones[index];
        if (m.state != MilestoneState.Submitted || m.approvals < g.threshold) revert BadState();
        if (block.timestamp > m.deadline) revert DeadlinePassed();
        _release(g, grantId, index, m);
    }

    /// Any reviewer can send a submission back; approvals from that round no longer count.
    function requestChanges(uint256 grantId, uint256 index, string calldata reason) external {
        if (!isReviewer[grantId][msg.sender]) revert NotReviewer();
        Milestone storage m = grants[grantId].milestones[index];
        if (m.state != MilestoneState.Submitted) revert BadState();
        m.state = MilestoneState.Open;
        m.approvals = 0;
        m.round += 1;
        emit ChangesRequested(grantId, index, msg.sender, reason);
    }

    /// After the deadline, an unreleased tranche returns to the funder.
    function reclaim(uint256 grantId, uint256 index) external {
        Grant storage g = grants[grantId];
        if (msg.sender != g.funder) revert NotFunder();
        Milestone storage m = g.milestones[index];
        if (m.state == MilestoneState.Released || m.state == MilestoneState.Reclaimed) revert BadState();
        if (block.timestamp <= m.deadline) revert DeadlineNotPassed();
        m.state = MilestoneState.Reclaimed;
        _pay(g.token, g.funder, m.amount);
        emit MilestoneReclaimed(grantId, index, m.amount);
    }

    function _release(Grant storage g, uint256 grantId, uint256 index, Milestone storage m) internal {
        uint256 metricValue;
        if (m.metricTarget != address(0)) {
            metricValue = readMetric(m.metricTarget, m.metricSelector);
            if (metricValue < m.metricMin) revert MetricBelowTarget(metricValue, m.metricMin);
        }
        m.state = MilestoneState.Released;
        if (g.token == address(0) && m.vestingBlocks != 0) {
            uint256 locked = m.amount / WEI_PER_PLANCK;
            uint256 perBlock = locked / m.vestingBlocks;
            IVesting(VESTING).vestedTransfer(g.grantee, locked, perBlock, block.number);
        } else {
            _pay(g.token, g.grantee, m.amount);
        }
        emit MilestoneReleased(grantId, index, m.amount, m.vestingBlocks, metricValue);
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert PayoutFailed();
        } else if (!IERC20(token).transfer(to, amount)) {
            revert PayoutFailed();
        }
    }

    function readMetric(address target, bytes4 selector) public view returns (uint256) {
        (bool ok, bytes memory out) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || out.length < 32) revert MetricUnreadable();
        return abi.decode(out, (uint256));
    }

    function grantCount() external view returns (uint256) {
        return grants.length;
    }

    function getGrant(uint256 grantId)
        external
        view
        returns (address funder, address grantee, address token, uint32 threshold, address[] memory reviewers, uint256 milestoneCount)
    {
        Grant storage g = grants[grantId];
        return (g.funder, g.grantee, g.token, g.threshold, g.reviewers, g.milestones.length);
    }

    function getMilestone(uint256 grantId, uint256 index) external view returns (Milestone memory) {
        return grants[grantId].milestones[index];
    }
}
