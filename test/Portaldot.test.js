const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const VESTING = "0x0000000000000000000000000000000009020000";

describe("Portaldot library", function () {
  // The mock precompile lives at a fixed address whose storage outlives setCode; restore the chain afterwards
  // so schedules created here never leak into other test files.
  let snapshot;
  before(async function () { snapshot = await network.provider.send("evm_snapshot"); });
  after(async function () { await network.provider.send("evm_revert", [snapshot]); });

  let lib, vesting, target;

  beforeEach(async function () {
    [, target] = await ethers.getSigners();
    const mock = await (await ethers.getContractFactory("MockVesting")).deploy();
    await network.provider.send("hardhat_setCode", [VESTING, await ethers.provider.getCode(await mock.getAddress())]);
    vesting = await ethers.getContractAt("MockVesting", VESTING);
    lib = await (await ethers.getContractFactory("PortaldotHarness")).deploy();
  });

  it("derives the Assets ERC-20 precompile address verified on testnet", async function () {
    // Asset 2's totalSupply was read at this address on PortaldotV3 testnet.
    expect(await lib.assetToken(2)).to.equal("0x0000000200000000000000000000000000010000");
    expect(await lib.assetToken(806707)).to.equal(ethers.getAddress("0x000c4f3300000000000000000000000000010000"));
    expect(await lib.assetToken(0xffffffff)).to.equal(ethers.getAddress("0xffffffff00000000000000000000000000010000"));
  });

  it("converts between wei and planck without losing dust", async function () {
    expect(await lib.toPlanck(ethers.parseEther("10"))).to.equal(10n ** 15n);
    expect(await lib.toWei(10n ** 15n)).to.equal(ethers.parseEther("10"));
    await expect(lib.toPlanck(10001n)).to.be.revertedWithCustomError(lib, "NotPlanckAligned").withArgs(10001n);
  });

  it("pays a native vesting lock through the precompile", async function () {
    await expect(lib.vestedPay(target.address, 1000, { value: ethers.parseEther("10") }))
      .to.emit(vesting, "VestedTransfer")
      .withArgs(await lib.getAddress(), target.address, 10n ** 15n, 10n ** 12n, (v) => v > 0n);
  });

  it("refuses transfers the chain would reject, with a clear error", async function () {
    await expect(lib.vestedPay(target.address, 1000, { value: ethers.parseEther("9") }))
      .to.be.revertedWithCustomError(lib, "BelowMinVestedTransfer");
    await expect(lib.vestedPay(target.address, 0, { value: ethers.parseEther("10") })).to.be.revertedWithCustomError(lib, "ZeroBlocks");
    await expect(lib.vestedPay(target.address, 1000, { value: ethers.parseEther("10") + 1n })).to.be.revertedWithCustomError(lib, "NotPlanckAligned");
  });

  it("keeps a positive per-block rate even over the longest schedule", async function () {
    await expect(lib.vestedPay(target.address, 0xffffffff, { value: ethers.parseEther("10") }))
      .to.emit(vesting, "VestedTransfer")
      .withArgs(await lib.getAddress(), target.address, 10n ** 15n, 232830n, (v) => v > 0n);
  });
});
