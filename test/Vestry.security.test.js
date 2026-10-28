// Edge and adversarial cases against the deployed Vestry.sol (unchanged source). Findings are written up in
// docs/SECURITY.md; tests here pin the current behavior, including the one limitation we found.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const VESTING = "0x0000000000000000000000000000000009020000";
const TEN = ethers.parseUnits("10", 18);
const NO_METRIC = { metricTarget: ethers.ZeroAddress, metricSelector: "0x00000000", metricMin: 0 };

describe("Vestry security and edge cases", function () {
  // The mock precompile lives at a fixed address whose storage outlives setCode; restore the chain afterwards
  // so schedules created here never leak into other test files.
  let snapshot;
  before(async function () { snapshot = await network.provider.send("evm_snapshot"); });
  after(async function () { await network.provider.send("evm_revert", [snapshot]); });

  let vestry, funder, r1, r2, outsider, grantee;

  beforeEach(async function () {
    [funder, r1, r2, outsider, grantee] = await ethers.getSigners();
    const mock = await (await ethers.getContractFactory("MockVesting")).deploy();
    await network.provider.send("hardhat_setCode", [VESTING, await ethers.provider.getCode(await mock.getAddress())]);
    vestry = await (await ethers.getContractFactory("Vestry")).deploy();
  });

  async function grant(granteeAddr, milestones, reviewers = [r1.address], threshold = 1) {
    const total = milestones.reduce((s, m) => s + m.amount, 0n);
    await vestry.connect(funder).createGrant(granteeAddr, ethers.ZeroAddress, reviewers, threshold, milestones, { value: total });
    return (await vestry.grantCount()) - 1n;
  }

  it("treats the deadline second as still open, and the next second as closed", async function () {
    const deadline = (await time.latest()) + 600;
    const id = await grant(grantee.address, [{ amount: TEN, deadline, vestingBlocks: 0, ...NO_METRIC }]);
    await time.setNextBlockTimestamp(deadline);
    await vestry.connect(grantee).submitMilestone(id, 0, "on the deadline");
    await time.setNextBlockTimestamp(deadline + 1);
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "DeadlinePassed");
    await expect(vestry.connect(funder).reclaim(id, 0)).to.changeEtherBalance(funder, TEN);
  });

  it("blocks reclaim at exactly the deadline", async function () {
    const deadline = (await time.latest()) + 600;
    const id = await grant(grantee.address, [{ amount: TEN, deadline, vestingBlocks: 0, ...NO_METRIC }]);
    await time.setNextBlockTimestamp(deadline);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.be.revertedWithCustomError(vestry, "DeadlineNotPassed");
  });

  it("stops a grantee contract from re-entering release while being paid", async function () {
    const attacker = await (await ethers.getContractFactory("ReentrantGrantee")).deploy();
    const deadline = (await time.latest()) + 3600;
    const id = await grant(await attacker.getAddress(), [{ amount: TEN, deadline, vestingBlocks: 0, ...NO_METRIC }]);
    await attacker.arm(await vestry.getAddress(), id, 0);
    await attacker.submit("work");
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.changeEtherBalance(attacker, TEN);
    expect(await attacker.reentered()).to.equal(true);
    expect(await attacker.reentrySucceeded()).to.equal(false); // state is Released before the transfer
    expect(await ethers.provider.getBalance(await vestry.getAddress())).to.equal(0n);
  });

  it("rolls back cleanly when the grantee refuses payment, and the funder can still reclaim later", async function () {
    const refuser = await (await ethers.getContractFactory("RejectingGrantee")).deploy();
    const deadline = (await time.latest()) + 600;
    const id = await grant(await refuser.getAddress(), [{ amount: TEN, deadline, vestingBlocks: 0, ...NO_METRIC }]);
    await refuser.submit(await vestry.getAddress(), id, 0);
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "PayoutFailed");
    const m = await vestry.getMilestone(id, 0);
    expect(m.state).to.equal(1n); // still Submitted, approvals rolled back with the failed tx
    expect(m.approvals).to.equal(0n);
    await time.increase(601);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.changeEtherBalance(funder, TEN);
  });

  it("LIMITATION: an unreadable usage metric blocks the quorum approval until the deadline, then funds are reclaimable", async function () {
    const broken = await (await ethers.getContractFactory("BrokenMetric")).deploy();
    const selector = broken.interface.getFunction("entryCount").selector;
    const deadline = (await time.latest()) + 600;
    const id = await grant(grantee.address, [
      { amount: TEN, deadline, vestingBlocks: 0, metricTarget: await broken.getAddress(), metricSelector: selector, metricMin: 1 },
    ]);
    await vestry.connect(grantee).submitMilestone(id, 0, "work");
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "MetricUnreadable");
    await time.increase(601);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.changeEtherBalance(funder, TEN); // no funds are stuck
  });

  it("LIMITATION: a vested milestone under 10 POT is accepted but cannot pay, and is reclaimable", async function () {
    const deadline = (await time.latest()) + 600;
    const small = ethers.parseUnits("5", 18);
    const id = await grant(grantee.address, [{ amount: small, deadline, vestingBlocks: 100, ...NO_METRIC }]);
    await vestry.connect(grantee).submitMilestone(id, 0, "work");
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.be.reverted; // pallet-vesting minimum, enforced by the precompile
    await time.increase(601);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.changeEtherBalance(funder, small);
  });

  it("rejects milestone indexes outside the grant", async function () {
    const id = await grant(grantee.address, [{ amount: TEN, deadline: (await time.latest()) + 600, vestingBlocks: 0, ...NO_METRIC }]);
    await expect(vestry.connect(grantee).submitMilestone(id, 1, "x")).to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(vestry.getMilestone(id, 5)).to.be.revertedWithCustomError(vestry, "BadConfig");
  });

  it("only lets reviewers request changes, and only on a submission", async function () {
    const id = await grant(grantee.address, [{ amount: TEN, deadline: (await time.latest()) + 600, vestingBlocks: 0, ...NO_METRIC }]);
    await expect(vestry.connect(r1).requestChanges(id, 0, "early")).to.be.revertedWithCustomError(vestry, "BadState");
    await vestry.connect(grantee).submitMilestone(id, 0, "work");
    await expect(vestry.connect(outsider).requestChanges(id, 0, "x")).to.be.revertedWithCustomError(vestry, "NotReviewer");
  });

  it("refuses a grant whose escrow does not match its milestones, so nothing is left unaccounted", async function () {
    const deadline = (await time.latest()) + 600;
    const ms = [{ amount: TEN, deadline, vestingBlocks: 0, ...NO_METRIC }];
    await expect(vestry.connect(funder).createGrant(grantee.address, ethers.ZeroAddress, [r1.address], 1, ms, { value: TEN + 10000n }))
      .to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(vestry.connect(funder).createGrant(grantee.address, ethers.ZeroAddress, [], 1, ms, { value: TEN }))
      .to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(vestry.connect(funder).createGrant(ethers.ZeroAddress, ethers.ZeroAddress, [r1.address], 1, ms, { value: TEN }))
      .to.be.revertedWithCustomError(vestry, "BadConfig");
  });

  it("holds exactly the unpaid escrow after mixed outcomes", async function () {
    const deadline = (await time.latest()) + 600;
    const id = await grant(grantee.address, [
      { amount: TEN, deadline, vestingBlocks: 0, ...NO_METRIC },
      { amount: TEN * 2n, deadline, vestingBlocks: 0, ...NO_METRIC },
      { amount: TEN * 3n, deadline, vestingBlocks: 0, ...NO_METRIC },
    ]);
    await vestry.connect(grantee).submitMilestone(id, 0, "a");
    await vestry.connect(r1).approveMilestone(id, 0);
    await time.increase(601);
    await vestry.connect(funder).reclaim(id, 1);
    expect(await ethers.provider.getBalance(await vestry.getAddress())).to.equal(TEN * 3n);
  });
});
