// Grantee claims its vested tranches: calls vest() on the Portaldot vesting precompile so pallet-vesting
// lifts the native lock. Records the tx and the native read-back before and after.
const fs = require("fs");
const { ethers } = require("hardhat");
const { execSync } = require("child_process");
const VESTING = "0x0000000000000000000000000000000009020000";
(async () => {
  const grantee = new ethers.Wallet(process.env.GRANTEE_KEY, ethers.provider);
  const read = () => JSON.parse(execSync(`node scripts/readback.mjs ${grantee.address} 2>/dev/null`).toString().split("\n").filter((l) => !/REGISTRY|API\/INIT/.test(l)).join("\n"));
  const before = read();
  const v = new ethers.Contract(VESTING, ["function vest()", "function vestingBalance() view returns (uint256)"], grantee);
  console.log("still vesting (precompile):", (await v.vestingBalance()).toString());
  const tx = await v.vest();
  const r = await tx.wait();
  const after = read();
  const out = { action: "grantee calls vest() on the vesting precompile", tx: tx.hash, block: r.blockNumber, status: r.status, before: { frozen: before.frozen, schedules: before.vestingSchedules.length }, after: { frozen: after.frozen, schedules: after.vestingSchedules.length, block: after.block } };
  fs.writeFileSync("evidence/vest-claim.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
