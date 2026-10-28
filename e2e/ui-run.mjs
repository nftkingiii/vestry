// Drives the LIVE Vestry app in Chromium through one full grant, every transaction sent from the UI.
// MetaMask cannot run headless, so each browser gets an injected EIP-1193 wallet (window.ethereum) backed by a
// testnet burner key from ../.env. Signing happens here in Node; the page only ever sees the wallet API.
// Writes evidence/ui-run.json (tx hashes per click) and e2e/out/ (screenshots + one video per role).
//   node e2e/ui-run.mjs [--url=https://vestry-grants.vercel.app]
import { chromium } from "playwright";
import { ethers } from "ethers";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((s) => s.trim())));
const URL = (process.argv.find((a) => a.startsWith("--url=")) || "--url=https://vestry-grants.vercel.app").slice(6);
const RPC = "https://test-evm-rpc-v3.portaldot.dev";
const CHAIN_HEX = "0x190f1ca9";
const OUT = join(ROOT, "e2e", "out");
mkdirSync(OUT, { recursive: true });

const provider = new ethers.JsonRpcProvider(RPC, 420420777, { staticNetwork: true });
const steps = [];
const record = (role, label, extra = {}) => { steps.push({ role, label, at: new Date().toISOString(), ...extra }); console.log(`${role.padEnd(8)} ${label}${extra.hash ? "  " + extra.hash : ""}`); };

/// One browser context per person, with a wallet the page reaches through window.ethereum.
async function person(browser, role, key) {
  const wallet = new ethers.Wallet(key, provider);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, recordVideo: { dir: join(OUT, `video-${role}`), size: { width: 1280, height: 860 } } });
  await ctx.exposeFunction("__vestryWallet", async (method, params) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts": return [wallet.address];
      case "eth_chainId": return CHAIN_HEX;
      case "net_version": return "420420777";
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": return null;
      case "eth_sendTransaction": {
        const t = params[0];
        const tx = await wallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n, gasLimit: t.gas ? BigInt(t.gas) : undefined });
        record(role, "wallet signed and sent", { hash: tx.hash });
        return tx.hash;
      }
      default: return provider.send(method, params || []);
    }
  });
  await ctx.addInitScript(() => {
    const listeners = {};
    window.ethereum = {
      isVestryTestWallet: true,
      request: ({ method, params }) => window.__vestryWallet(method, params || []),
      on: (e, f) => { (listeners[e] ||= []).push(f); },
      removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
    };
    try { localStorage.setItem("vestry.tab", "grants"); } catch {}
  });
  const page = await ctx.newPage();
  return { role, wallet, ctx, page };
}

async function open(p) {
  await p.page.goto(URL, { waitUntil: "networkidle" });
  // The injected wallet answers eth_accounts at once, so the app usually connects by itself.
  await p.page.waitForSelector('.wallet-chip, button:has-text("Connect wallet")', { timeout: 30000 });
  const connect = p.page.getByRole("button", { name: "Connect wallet" }).first();
  if (await connect.isVisible()) await connect.click();
  await p.page.waitForSelector(".wallet-chip", { timeout: 30000 });
  await p.page.waitForSelector(".grant", { timeout: 60000 });
}

/// Confirms a click from the chain (the receipt of the tx the wallet just sent), then checks the app said so too.
async function waitConfirmed(p, label) {
  // The app estimates cost before asking the wallet to send, so poll for a hash sent after this click.
  const since = p.clickedAt || "";
  let sent;
  for (let i = 0; i < 120 && !sent; i++) {
    sent = steps.filter((s) => s.role === p.role && s.hash && s.at >= since).pop();
    if (!sent) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!sent) throw new Error(`${label}: the wallet sent no transaction within 2 minutes of the click`);
  const receipt = await provider.waitForTransaction(sent.hash, 1, 240000);
  if (!receipt || receipt.status !== 1) throw new Error(`${label}: tx ${sent.hash} failed on chain`);
  const ui = await p.page
    .waitForFunction(() => { const s = [...document.querySelectorAll(".txstatus")].pop(); return s && /Confirmed on chain/.test(s.innerText); }, null, { timeout: 60000 })
    .then(() => "app showed Confirmed on chain", () => "app did not show confirmation in time");
  await p.page.screenshot({ path: join(OUT, `${String(steps.length).padStart(2, "0")}-${p.role}-${label.replace(/\W+/g, "-")}.png`) }).catch(() => {});
  record(p.role, `${label}: confirmed on chain in block ${receipt.blockNumber}; ${ui}`, { block: receipt.blockNumber });
}

// One browser per role, so a problem in one cannot close the others' pages.
async function launchPerson(role, key) {
  const browser = await chromium.launch();
  const p = await person(browser, role, key);
  p.browser = browser;
  p.page.on("close", () => console.log(`${role}: page closed`));
  p.page.on("crash", () => console.log(`${role}: page CRASHED`));
  p.page.on("pageerror", (e) => console.log(`${role}: page error: ${e.message}`));
  return p;
}

const resumeArg = process.argv.find((a) => a.startsWith("--grant="));
const vestryRead = new ethers.Contract("0x12d0691c7B756AA5205f24B678D68C74B885cda9", [
  "function grantCount() view returns (uint256)",
  "function getMilestone(uint256,uint256) view returns (tuple(uint128 amount,uint64 deadline,uint32 vestingBlocks,uint8 approvals,uint8 round,uint8 state,address metricTarget,bytes4 metricSelector,uint64 metricMin))",
], provider);
const grantId = resumeArg ? Number(resumeArg.slice(8)) : Number(await vestryRead.grantCount());
const prior = resumeArg && existsSync(join(ROOT, "evidence", "ui-run.json")) ? JSON.parse(readFileSync(join(ROOT, "evidence", "ui-run.json"), "utf8")) : null;
if (prior && prior.grantId === grantId) steps.push(...prior.steps.filter((s) => !/^FAILED/.test(s.label)));
const stateNow = resumeArg ? Number((await vestryRead.getMilestone(grantId, 0)).state) : -1; // 0 Open, 1 Submitted, 2 Released
const funder = await launchPerson("funder", env.DEPLOYER_KEY);
const grantee = await launchPerson("grantee", env.GRANTEE_KEY);
const reviewer = await launchPerson("reviewer", env.REVIEWER_1_KEY);
record("system", resumeArg ? `resuming grant ${grantId} at on-chain state ${stateNow}` : `next grant id ${grantId}; funder ${funder.wallet.address}`);

try {
  if (resumeArg) {
    // Confirm any UI-sent transaction from the earlier run that never got its confirmation line.
    for (const s of steps.filter((x) => x.hash && !steps.some((y) => y.role === x.role && y.block && y.at > x.at))) {
      const r = await provider.getTransactionReceipt(s.hash);
      if (r) record(s.role, `earlier UI tx ${s.hash.slice(0, 10)}… confirmed on chain in block ${r.blockNumber}, status ${r.status}`, { block: r.blockNumber });
    }
    // Resume: only the steps the chain says are still to do.
    if (stateNow < 2) {
      await open(reviewer);
      await reviewer.page.getByRole("tab", { name: /Review/ }).click();
      const rc = reviewer.page.locator(`#grant-${grantId}`);
      await rc.waitFor({ timeout: 60000 });
      reviewer.clickedAt = new Date().toISOString();
      await rc.getByRole("button", { name: "Approve" }).click();
      await waitConfirmed(reviewer, "approved and paid");
      await grantee.page.waitForTimeout(36000);
    }
    await open(grantee);
    grantee.clickedAt = new Date().toISOString();
    await grantee.page.locator(`#grant-${grantId}`).getByRole("button", { name: "Claim vested tPOT" }).click();
    await waitConfirmed(grantee, "vested tPOT claimed");
    await open(funder);
    await funder.page.locator(`#grant-${grantId}`).screenshot({ path: join(OUT, "final-card.png") });
    record("system", "final card captured");
    throw "done";
  }
  // 0. Setup, outside the UI: make sure the reviewer can cover the storage deposit of a first approval.
  const reviewerBal = await provider.getBalance(reviewer.wallet.address);
  const want = ethers.parseEther("14");
  if (reviewerBal < want) {
    const tx = await funder.wallet.sendTransaction({ to: reviewer.wallet.address, value: want - reviewerBal });
    await tx.wait();
    record("setup", `topped up reviewer to 14 tPOT (script, not UI)`, { hash: tx.hash });
  }

  // 1. Funder opens the app, fills the form and escrows 10 tPOT for one usage-gated milestone.
  await open(funder);
  await funder.page.getByRole("button", { name: "Fund a grant" }).click();
  await funder.page.getByLabel("Grantee address").fill(grantee.wallet.address);
  await funder.page.getByLabel("Approvals needed").fill("1");
  await funder.page.getByLabel("Reviewer addresses").fill(reviewer.wallet.address);
  await funder.page.getByLabel("Amount (tPOT)").fill("10");
  await funder.page.getByLabel("Due in (days)").fill("7");
  await funder.page.getByLabel("Unlock over (blocks)").fill("300");
  await funder.page.getByLabel("Only pay once the grantee's contract shows real use").check();
  await funder.page.getByLabel("At least").fill("2");
  funder.clickedAt = new Date().toISOString();
  await funder.page.getByRole("button", { name: /Put 10 tPOT in escrow/ }).click();
  await waitConfirmed(funder, "grant funded");

  // 2. Grantee submits work from their own browser.
  await open(grantee);
  const card = grantee.page.locator(`#grant-${grantId}`);
  await card.waitFor({ timeout: 60000 });
  await card.getByPlaceholder("Link to the commit, demo or transaction").fill("https://github.com/nftkingiii/vestry/tree/main/e2e");
  grantee.clickedAt = new Date().toISOString();
  await card.getByRole("button", { name: "Submit work" }).click();
  await waitConfirmed(grantee, "work submitted");

  // 3. Reviewer approves on the Review tab; the usage gate (2 Guestbook users) is read in the same transaction.
  await open(reviewer);
  await reviewer.page.getByRole("tab", { name: /Review/ }).click();
  const rcard = reviewer.page.locator(`#grant-${grantId}`);
  await rcard.waitFor({ timeout: 60000 });
  reviewer.clickedAt = new Date().toISOString();
  await rcard.getByRole("button", { name: "Approve" }).click();
  await waitConfirmed(reviewer, "approved and paid");

  // 4. A few blocks later the grantee claims what has vested so far with vest() on the precompile.
  await grantee.page.waitForTimeout(36000);
  await open(grantee);
  const gcard = grantee.page.locator(`#grant-${grantId}`);
  grantee.clickedAt = new Date().toISOString();
  await gcard.getByRole("button", { name: "Claim vested tPOT" }).click();
  await waitConfirmed(grantee, "vested tPOT claimed");

  // 5. Read back what the app now shows.
  await funder.page.reload({ waitUntil: "networkidle" });
  await funder.page.locator(`#grant-${grantId}`).screenshot({ path: join(OUT, "final-card.png") });
  record("system", "final card captured");
} catch (e) {
  if (e !== "done") {
    record("system", `FAILED: ${e.message}`);
    for (const p of [funder, grantee, reviewer]) await p.page.screenshot({ path: join(OUT, `failure-${p.role}.png`) }).catch(() => {});
    process.exitCode = 1;
  }
} finally {
  for (const p of [funder, grantee, reviewer]) { await p.ctx.close().catch(() => {}); await p.browser.close().catch(() => {}); }
  const outFile = join(ROOT, "evidence", "ui-run.json");
  writeFileSync(outFile, JSON.stringify({
    what: "One grant driven entirely through the live web app in Chromium. Each role used an injected EIP-1193 test wallet (not MetaMask) holding a PortaldotV3 testnet burner key; every transaction below was triggered by a UI click.",
    app: URL, network: "PortaldotV3 testnet", chainId: 420420777, grantId, steps,
  }, null, 2));
  console.log("evidence written to", outFile);
}
