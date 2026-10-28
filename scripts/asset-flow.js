// A grant paid in a native pallet-assets token through its ERC-20 precompile, on PortaldotV3 testnet.
// Needs scripts/create-test-asset.mjs to have created asset 20261028 (vUSD) and minted it to the deployer.
// Usage: npx hardhat run scripts/asset-flow.js --network portaldot
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { execFileSync } = require("child_process");

const ASSET_ID = 20261028;
const AMOUNT = 100n * 10n ** 6n; // 100 vUSD (6 decimals)
const NO_METRIC = { metricTarget: ethers.ZeroAddress, metricSelector: "0x00000000", metricMin: 0 };
// Same layout as contracts/lib/Portaldot.sol assetToken(): id in bytes 0-3, 0x0001 in bytes 16-17.
const assetToken = (id) => ethers.getAddress("0x" + id.toString(16).padStart(8, "0") + "0".repeat(24) + "00010000");
const ERC20 = ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"];

async function main() {
  const [funder] = await ethers.getSigners();
  const grantee = new ethers.Wallet(process.env.GRANTEE_KEY, ethers.provider);
  const reviewer = new ethers.Wallet(process.env.REVIEWER_1_KEY, ethers.provider);
  const deployed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evidence", "deployments.json"), "utf8")).contracts;
  const vestry = await ethers.getContractAt("Vestry", deployed.Vestry.address, funder);
  const tokenAddr = assetToken(ASSET_ID);
  const token = new ethers.Contract(tokenAddr, ERC20, funder);
  const steps = [];
  const step = async (label, p) => { const tx = await p; const r = await tx.wait(); steps.push({ label, hash: tx.hash, block: r.blockNumber, status: r.status }); console.log("ok ", label, tx.hash); };
  const bal = async (a) => (await token.balanceOf(a)).toString();

  const before = { funder: await bal(funder.address), grantee: await bal(grantee.address), vestry: await bal(deployed.Vestry.address), totalSupply: (await token.totalSupply()).toString() };
  console.log("asset", ASSET_ID, "at", tokenAddr, before);
  if (BigInt(before.funder) < AMOUNT) throw new Error("funder holds too little vUSD; run scripts/create-test-asset.mjs first");

  await step("funder approves Vestry for 100 vUSD on the asset's ERC-20 precompile", token.approve(deployed.Vestry.address, AMOUNT));
  const grantId = await vestry.grantCount();
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * 24 * 3600;
  await step("funder creates a 100 vUSD grant (token pulled into escrow)", vestry.createGrant(grantee.address, tokenAddr, [reviewer.address], 1, [{ amount: AMOUNT, deadline, vestingBlocks: 0, ...NO_METRIC }]));
  const escrowed = await bal(deployed.Vestry.address);
  await step("grantee submits work", vestry.connect(grantee).submitMilestone(grantId, 0, "Integrated vUSD payouts"));
  await step("reviewer approves; Vestry pays 100 vUSD through the precompile", vestry.connect(reviewer).approveMilestone(grantId, 0));
  const after = { funder: await bal(funder.address), grantee: await bal(grantee.address), vestry: await bal(deployed.Vestry.address) };

  // Native read-back of the grantee's pallet-assets account (Substrate side, not the precompile).
  const reader = `const {ApiPromise,WsProvider}=require('@polkadot/api');const [h160,id]=process.argv.slice(1);
    (async()=>{const api=await ApiPromise.create({provider:new WsProvider('wss://test-node-v3.portaldot.dev'),noInitWarn:true});
    const who=await api.call.reviveApi.accountId(h160);const a=await api.query.assets.account(Number(id), who);
    console.log(JSON.stringify({account: who.toString(), balance: a.isSome ? a.unwrap().balance.toString() : '0'}));await api.disconnect()})()`;
  const native = execFileSync(process.execPath, ["-e", reader, grantee.address, String(ASSET_ID)])
    .toString().split("\n").filter((l) => l.startsWith("{")).pop();

  const out = { what: "Grant paid in a native pallet-assets token through its ERC-20 precompile; transactions sent by this script with testnet burner wallets.",
    network: "PortaldotV3 testnet", chainId: 420420777, assetId: ASSET_ID, token: tokenAddr, grantId: Number(grantId), amount: AMOUNT.toString(),
    escrowedAfterCreate: escrowed, before, after, granteeNativeAssetAccount: JSON.parse(native), steps };
  fs.writeFileSync(path.join(__dirname, "..", "evidence", "asset-grant.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
