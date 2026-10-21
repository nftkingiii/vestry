// Runs the full Vestry lifecycle on PortaldotV3 testnet and writes every tx hash,
// including the deliberately rejected ones, to evidence/testnet.json.
// Usage: npx hardhat run scripts/flow.js --network portaldot
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const RPC = network.config.url;
const EVIDENCE = path.join(__dirname, "..", "evidence", "testnet.json");
const TEN_POT = ethers.parseUnits("10", 18);
const VESTING_BLOCKS = 1000; // ~100 minutes at 6s blocks
const NO_METRIC = { metricTarget: ethers.ZeroAddress, metricSelector: "0x00000000", metricMin: 0 };

const log = [];
let evidence = fs.existsSync(EVIDENCE) ? JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) : {};

function save() {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, JSON.stringify({ ...evidence, steps: log }, null, 2));
}

async function step(label, txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  log.push({ label, hash: tx.hash, block: receipt.blockNumber, status: receipt.status === 1 ? "success" : "reverted" });
  console.log(`ok   ${label}  ${tx.hash}`);
  save();
  return receipt;
}

/// Sends a call we expect the contract to reject. The revert reason comes from a dry run;
/// the tx is then broadcast with a fixed gas limit so the rejection is also on chain.
async function expectReject(label, contract, signer, method, args, expectedError) {
  const c = contract.connect(signer);
  let reason;
  try {
    await c[method].staticCall(...args);
    throw new Error(`${label}: expected ${expectedError} but the call succeeded`);
  } catch (e) {
    const parsed = e.data ? contract.interface.parseError(e.data) : null;
    reason = parsed ? `${parsed.name}(${parsed.args.join(",")})` : e.shortMessage || e.message;
    if (!reason.startsWith(expectedError)) throw new Error(`${label}: expected ${expectedError}, got ${reason}`);
  }
  const entry = { label, expected: expectedError, revertReason: reason, status: "rejected" };
  try {
    const tx = await c[method](...args, { gasLimit: 3_000_000n });
    const receipt = await tx.wait().catch((e) => e.receipt);
    entry.hash = tx.hash;
    entry.block = receipt?.blockNumber;
    entry.onchainStatus = receipt?.status === 0 ? "reverted" : "unexpected";
  } catch (e) {
    entry.onchainStatus = "not broadcast (node rejected: " + (e.shortMessage || e.message).slice(0, 80) + ")";
  }
  log.push(entry);
  console.log(`no   ${label}  ${reason}  ${entry.hash || entry.onchainStatus}`);
  save();
}

async function vestingLock(address) {
  const v = new ethers.Contract("0x0000000000000000000000000000000009020000", ["function vestingBalanceOf(address) view returns (uint256)"], ethers.provider);
  return (await v.vestingBalanceOf(address)).toString();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const wallet = (k) => new ethers.Wallet(k, ethers.provider);
  const actors = {};
  for (const name of ["GRANTEE", "REVIEWER_1", "REVIEWER_2", "VISITOR_1", "VISITOR_2"]) {
    const key = process.env[`${name}_KEY`];
    if (!key) throw new Error(`${name}_KEY missing in .env (run scripts/actors.js)`);
    actors[name] = wallet(key);
  }
  const { GRANTEE: grantee, REVIEWER_1: r1, REVIEWER_2: r2, VISITOR_1: v1, VISITOR_2: v2 } = actors;

  evidence = {
    network: "PortaldotV3 testnet",
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    rpc: RPC,
    startedAt: new Date().toISOString(),
    funder: deployer.address,
    actors: Object.fromEntries(Object.entries(actors).map(([k, w]) => [k.toLowerCase(), w.address])),
  };

  // Every new storage slot holds a deposit from the sender, so actors are topped up to what
  // their role writes: two approvals per reviewer, one Guestbook entry per visitor.
  const targets = { GRANTEE: 3, REVIEWER_1: 15, REVIEWER_2: 15, VISITOR_1: 10, VISITOR_2: 10 };
  for (const [name, w] of Object.entries(actors)) {
    const want = ethers.parseEther(String(targets[name]));
    const have = await ethers.provider.getBalance(w.address);
    if (have < want) {
      await step(`top up ${name.toLowerCase()} ${w.address} to ${targets[name]} tPOT for gas and storage deposit`, deployer.sendTransaction({ to: w.address, value: want - have }));
    }
  }

  // Reuse the contracts from scripts/deploy.js: each fresh deploy holds ~470 tPOT of storage deposit.
  const deployed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evidence", "deployments.json"), "utf8")).contracts;
  const vestry = await ethers.getContractAt("Vestry", deployed.Vestry.address, deployer);
  const guestbook = await ethers.getContractAt("Guestbook", deployed.Guestbook.address, deployer);
  evidence.contracts = { Vestry: deployed.Vestry, Guestbook: deployed.Guestbook };
  console.log("Vestry", evidence.contracts.Vestry.address, "Guestbook", evidence.contracts.Guestbook.address);
  save();

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const week = now + 7 * 24 * 3600;
  const entrySelector = guestbook.interface.getFunction("entryCount").selector;

  // Grant 0: two milestones, 2-of-2 review, both paid as native vesting locks.
  const g0 = await vestry.grantCount();
  await step(
    "create grant 0: 2 milestones x 10 tPOT, 2-of-2 reviewers, milestone 1 needs 2 Guestbook users",
    vestry.createGrant(grantee.address, ethers.ZeroAddress, [r1.address, r2.address], 2, [
      { amount: TEN_POT, deadline: week, vestingBlocks: VESTING_BLOCKS, ...NO_METRIC },
      { amount: TEN_POT, deadline: week, vestingBlocks: VESTING_BLOCKS, metricTarget: await guestbook.getAddress(), metricSelector: entrySelector, metricMin: 2 },
    ], { value: TEN_POT * 2n })
  );

  evidence.granteeVestingBefore = await vestingLock(grantee.address);
  await step("grantee submits milestone 0 evidence", vestry.connect(grantee).submitMilestone(g0, 0, "Guestbook contract deployed: " + evidence.contracts.Guestbook.address));
  await expectReject("outsider tries to approve milestone 0", vestry, v1, "approveMilestone", [g0, 0], "NotReviewer");
  await step("reviewer 1 approves milestone 0", vestry.connect(r1).approveMilestone(g0, 0));
  await expectReject("reviewer 1 approves milestone 0 twice", vestry, r1, "approveMilestone", [g0, 0], "AlreadyApproved");
  await step("reviewer 2 approves milestone 0 -> quorum, released as native vesting lock", vestry.connect(r2).approveMilestone(g0, 0));
  evidence.granteeVestingAfterM0 = await vestingLock(grantee.address);

  await step("grantee submits milestone 1 evidence", vestry.connect(grantee).submitMilestone(g0, 1, "Guestbook open to users"));
  await step("reviewer 2 requests changes on milestone 1", vestry.connect(r2).requestChanges(g0, 1, "Show real usage before payout"));
  await step("grantee resubmits milestone 1", vestry.connect(grantee).submitMilestone(g0, 1, "Guestbook live, inviting users"));
  await step("reviewer 1 approves milestone 1", vestry.connect(r1).approveMilestone(g0, 1));
  await step("reviewer 2 approves milestone 1 -> quorum, but metric 0 < 2 so funds stay in escrow", vestry.connect(r2).approveMilestone(g0, 1));
  await expectReject("anyone tries to release milestone 1 with 0 users", vestry, v1, "release", [g0, 1], "MetricBelowTarget");
  await step("visitor 1 signs the grantee's Guestbook", guestbook.connect(v1).sign("first user"));
  await step("visitor 2 signs the grantee's Guestbook", guestbook.connect(v2).sign("second user"));
  await step("visitor 1 releases milestone 1 now that metric = 2", vestry.connect(v1).release(g0, 1));
  evidence.granteeVestingAfterM1 = await vestingLock(grantee.address);

  // Grant 1: a tranche the grantee never delivers; funder reclaims after the deadline.
  const shortDeadline = (await ethers.provider.getBlock("latest")).timestamp + 180;
  const g1 = await vestry.grantCount();
  await step(
    "create grant 1: 1 milestone x 10 tPOT, deadline in 3 minutes",
    vestry.createGrant(grantee.address, ethers.ZeroAddress, [r1.address], 1, [{ amount: TEN_POT, deadline: shortDeadline, vestingBlocks: VESTING_BLOCKS, ...NO_METRIC }], { value: TEN_POT })
  );
  await expectReject("funder tries to reclaim before the deadline", vestry, deployer, "reclaim", [g1, 0], "DeadlineNotPassed");
  while ((await ethers.provider.getBlock("latest")).timestamp <= shortDeadline) {
    await new Promise((r) => setTimeout(r, 12_000));
  }
  await expectReject("grantee submits after the deadline", vestry, grantee, "submitMilestone", [g1, 0, "too late"], "DeadlinePassed");
  await step("funder reclaims the missed tranche", vestry.reclaim(g1, 0));

  evidence.finishedAt = new Date().toISOString();
  save();
  console.log("evidence written to", EVIDENCE);
}

main().catch((e) => {
  console.error(e);
  save();
  process.exit(1);
});
