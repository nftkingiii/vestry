const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const VESTING = "0x0000000000000000000000000000000009020000";
const TEN_POT = ethers.parseUnits("10", 18); // 10 tPOT in wei = 1e15 planck, the MinVestedTransfer
const NO_METRIC = { metricTarget: ethers.ZeroAddress, metricSelector: "0x00000000", metricMin: 0 };

describe("Vestry", function () {
  let vestry, vesting, guestbook, funder, grantee, r1, r2, r3, outsider;

  beforeEach(async function () {
    [funder, grantee, r1, r2, r3, outsider] = await ethers.getSigners();
    const mock = await (await ethers.getContractFactory("MockVesting")).deploy();
    await network.provider.send("hardhat_setCode", [VESTING, await ethers.provider.getCode(await mock.getAddress())]);
    vesting = await ethers.getContractAt("MockVesting", VESTING);
    vestry = await (await ethers.getContractFactory("Vestry")).deploy();
    guestbook = await (await ethers.getContractFactory("Guestbook")).deploy();
  });

  async function deadline(seconds = 3600) {
    return (await time.latest()) + seconds;
  }

  async function createNativeGrant(milestones, threshold = 2) {
    const total = milestones.reduce((s, m) => s + m.amount, 0n);
    await vestry
      .connect(funder)
      .createGrant(grantee.address, ethers.ZeroAddress, [r1.address, r2.address, r3.address], threshold, milestones, { value: total });
    return (await vestry.grantCount()) - 1n;
  }

  it("releases a tranche as a native vesting lock after reviewer quorum", async function () {
    const id = await createNativeGrant([{ amount: TEN_POT, deadline: await deadline(), vestingBlocks: 100, ...NO_METRIC }]);
    await vestry.connect(grantee).submitMilestone(id, 0, "commit abc123");
    await vestry.connect(r1).approveMilestone(id, 0);
    expect((await vestry.getMilestone(id, 0)).state).to.equal(1); // still Submitted at 1 of 2

    await expect(vestry.connect(r2).approveMilestone(id, 0))
      .to.emit(vestry, "MilestoneReleased")
      .and.to.emit(vesting, "VestedTransfer")
      .withArgs(await vestry.getAddress(), grantee.address, TEN_POT / 10000n, TEN_POT / 10000n / 100n, anyBlock());
    expect((await vestry.getMilestone(id, 0)).state).to.equal(2);
    expect(await vesting.vestingBalanceOf(grantee.address)).to.equal(TEN_POT / 10000n);
  });

  it("pays an unlocked native tranche directly when vestingBlocks is 0", async function () {
    const id = await createNativeGrant([{ amount: TEN_POT, deadline: await deadline(), vestingBlocks: 0, ...NO_METRIC }], 1);
    await vestry.connect(grantee).submitMilestone(id, 0, "demo link");
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.changeEtherBalance(grantee, TEN_POT);
  });

  it("holds an approved tranche until the grantee's on-chain metric meets target", async function () {
    const selector = guestbook.interface.getFunction("entryCount").selector;
    const id = await createNativeGrant(
      [{ amount: TEN_POT, deadline: await deadline(), vestingBlocks: 0, metricTarget: await guestbook.getAddress(), metricSelector: selector, metricMin: 2 }],
      1
    );
    await vestry.connect(grantee).submitMilestone(id, 0, "guestbook live");
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.emit(vestry, "AwaitingMetric");
    await expect(vestry.connect(outsider).release(id, 0)).to.be.revertedWithCustomError(vestry, "MetricBelowTarget").withArgs(0, 2);

    await guestbook.connect(r2).sign("first user");
    await guestbook.connect(r3).sign("second user");
    await expect(vestry.connect(outsider).release(id, 0)).to.emit(vestry, "MilestoneReleased").withArgs(id, 0, TEN_POT, 0, 2);
  });

  it("rejects approvals from non-reviewers and double approvals", async function () {
    const id = await createNativeGrant([{ amount: TEN_POT, deadline: await deadline(), vestingBlocks: 100, ...NO_METRIC }]);
    await vestry.connect(grantee).submitMilestone(id, 0, "x");
    await expect(vestry.connect(outsider).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "NotReviewer");
    await expect(vestry.connect(grantee).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "NotReviewer");
    await vestry.connect(r1).approveMilestone(id, 0);
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "AlreadyApproved");
  });

  it("voids earlier approvals when a reviewer requests changes", async function () {
    const id = await createNativeGrant([{ amount: TEN_POT, deadline: await deadline(), vestingBlocks: 100, ...NO_METRIC }]);
    await vestry.connect(grantee).submitMilestone(id, 0, "v1");
    await vestry.connect(r1).approveMilestone(id, 0);
    await vestry.connect(r2).requestChanges(id, 0, "tests missing");
    await expect(vestry.connect(r3).approveMilestone(id, 0)).to.be.revertedWithCustomError(vestry, "BadState");

    await vestry.connect(grantee).submitMilestone(id, 0, "v2 with tests");
    await vestry.connect(r3).approveMilestone(id, 0);
    expect((await vestry.getMilestone(id, 0)).approvals).to.equal(1); // r1's round-0 approval is gone
    await expect(vestry.connect(r1).approveMilestone(id, 0)).to.emit(vestry, "MilestoneReleased");
  });

  it("returns a missed tranche to the funder only after the deadline", async function () {
    const id = await createNativeGrant([{ amount: TEN_POT, deadline: await deadline(600), vestingBlocks: 100, ...NO_METRIC }]);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.be.revertedWithCustomError(vestry, "DeadlineNotPassed");
    await time.increase(601);
    await expect(vestry.connect(grantee).submitMilestone(id, 0, "late")).to.be.revertedWithCustomError(vestry, "DeadlinePassed");
    await expect(vestry.connect(outsider).reclaim(id, 0)).to.be.revertedWithCustomError(vestry, "NotFunder");
    await expect(vestry.connect(funder).reclaim(id, 0)).to.changeEtherBalance(funder, TEN_POT);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.be.revertedWithCustomError(vestry, "BadState");
  });

  it("cannot reclaim a released tranche or release a reclaimed one", async function () {
    const id = await createNativeGrant(
      [
        { amount: TEN_POT, deadline: await deadline(600), vestingBlocks: 0, ...NO_METRIC },
        { amount: TEN_POT, deadline: await deadline(600), vestingBlocks: 0, ...NO_METRIC },
      ],
      1
    );
    await vestry.connect(grantee).submitMilestone(id, 0, "done");
    await vestry.connect(r1).approveMilestone(id, 0);
    await vestry.connect(grantee).submitMilestone(id, 1, "done too");
    await time.increase(601);
    await expect(vestry.connect(funder).reclaim(id, 0)).to.be.revertedWithCustomError(vestry, "BadState");
    await expect(vestry.connect(r1).approveMilestone(id, 1)).to.be.revertedWithCustomError(vestry, "DeadlinePassed");
    await vestry.connect(funder).reclaim(id, 1);
    await expect(vestry.connect(outsider).release(id, 1)).to.be.revertedWithCustomError(vestry, "BadState");
  });

  it("validates grant configuration", async function () {
    const d = await deadline();
    const ok = { amount: TEN_POT, deadline: d, vestingBlocks: 100, ...NO_METRIC };
    const create = (overrides, value = TEN_POT, reviewers = [r1.address], threshold = 1) =>
      vestry.connect(funder).createGrant(grantee.address, ethers.ZeroAddress, reviewers, threshold, [{ ...ok, ...overrides }], { value });
    await expect(create({}, TEN_POT - 1n)).to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(create({ amount: TEN_POT + 1n }, TEN_POT + 1n)).to.be.revertedWithCustomError(vestry, "BadConfig"); // not planck-aligned
    await expect(create({}, TEN_POT, [r1.address], 2)).to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(create({}, TEN_POT, [grantee.address])).to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(create({}, TEN_POT, [r1.address, r1.address])).to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(create({ deadline: (await time.latest()) - 1 })).to.be.revertedWithCustomError(vestry, "BadConfig");
    await expect(create({ metricTarget: r1.address })).to.be.revertedWithCustomError(vestry, "BadConfig");
  });

  it("escrows and pays a native-asset tranche through the ERC-20 interface", async function () {
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    await token.mint(funder.address, 500);
    await token.connect(funder).approve(await vestry.getAddress(), 500);
    const d = await deadline();
    await vestry.connect(funder).createGrant(grantee.address, await token.getAddress(), [r1.address], 1, [{ amount: 500, deadline: d, vestingBlocks: 0, ...NO_METRIC }]);
    expect(await token.balanceOf(await vestry.getAddress())).to.equal(500);
    await vestry.connect(grantee).submitMilestone(0, 0, "asset milestone");
    await vestry.connect(r1).approveMilestone(0, 0);
    expect(await token.balanceOf(grantee.address)).to.equal(500);
  });
});

function anyBlock() {
  return (v) => typeof v === "bigint" && v > 0n;
}
