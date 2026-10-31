// Records demo footage from the LIVE app: a new grant, every step clicked in a real browser, real testnet transactions.
// Same injected EIP-1193 test wallets as ui-run.mjs (MetaMask cannot run headless). Output: e2e/film/<role>/*.jpg frames
// with film.json (per-frame wall-clock times and named marks), plus evidence/demo-run.json with every tx hash.
//   node e2e/demo-run.mjs
import { chromium } from "playwright";
import { ethers } from "ethers";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((s) => s.trim())));
const URL = "https://vestry-grants.vercel.app";
const VESTRY = "0x12d0691c7B756AA5205f24B678D68C74B885cda9";
const GUESTBOOK = "0xc3Ee4B657FADAE473b22c692544e35223bFE9B42";
const FILM = join(ROOT, "e2e", "film");
rmSync(FILM, { recursive: true, force: true });

const provider = new ethers.JsonRpcProvider("https://test-evm-rpc-v3.portaldot.dev", 420420777, { staticNetwork: true });
const steps = [];
const marks = [];
const now = () => Date.now() / 1000;
const mark = (role, name) => { marks.push({ role, name, t: now() }); console.log(`mark ${role}: ${name}`); };
const record = (role, label, extra = {}) => { steps.push({ role, label, at: new Date().toISOString(), ...extra }); console.log(`${role.padEnd(9)} ${label}${extra.hash ? "  " + extra.hash : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function person(role, key) {
  const wallet = new ethers.Wallet(key, provider);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.exposeFunction("__vestryWallet", async (method, params) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts": return [wallet.address];
      case "eth_chainId": return "0x190f1ca9";
      case "net_version": return "420420777";
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": return null;
      case "eth_sendTransaction": {
        const t = params[0];
        const tx = await wallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n, gasLimit: t.gas ? BigInt(t.gas) : undefined });
        record(role, "wallet sent", { hash: tx.hash });
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
    // A visible cursor for the recording: headless browsers paint none.
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "__cursor";
      c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(25,24,20,.55);border:2px solid #fff;z-index:99999;pointer-events:none;transition:transform .12s;box-shadow:0 1px 4px rgba(0,0,0,.3)";
      document.body.appendChild(c);
      addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", () => { c.style.transform = "scale(.65)"; }, true);
      addEventListener("mouseup", () => { c.style.transform = "scale(1)"; }, true);
    });
  });
  const page = await ctx.newPage();
  const dir = join(FILM, role);
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    const n = frames.length + 1;
    writeFileSync(join(dir, String(n).padStart(6, "0") + ".jpg"), Buffer.from(data, "base64"));
    frames.push(metadata.timestamp);
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  return { role, wallet, browser, ctx, page, frames };
}

async function open(p) {
  await p.page.goto(URL, { waitUntil: "domcontentloaded" });
  await p.page.waitForSelector(".wallet-chip", { timeout: 60000 });
  await p.page.waitForSelector(".grant", { timeout: 120000 });
  await sleep(1200);
}

/// Moves the visible cursor to an element, pauses like a person, clicks.
async function press(p, loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await p.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
  await sleep(450);
  await p.page.mouse.down(); await sleep(70); await p.page.mouse.up();
}
async function type(p, loc, text) {
  await press(p, loc);
  await loc.pressSequentially(text, { delay: 28 });
  await sleep(250);
}
async function setValue(p, loc, text) {
  await press(p, loc);
  await p.page.keyboard.press("Control+A");
  await loc.pressSequentially(text, { delay: 60 });
  await sleep(200);
}

/// Waits for the wallet to send after a click, then for the chain receipt, then for the app to catch up.
async function confirmed(p, since, label) {
  let sent;
  for (let i = 0; i < 180 && !sent; i++) {
    sent = steps.filter((s) => s.role === p.role && s.hash && s.at >= since).pop();
    if (!sent) await sleep(1000);
  }
  if (!sent) throw new Error(`${label}: wallet sent nothing`);
  let r = null;
  for (let i = 0; i < 90 && !r; i++) { r = await provider.getTransactionReceipt(sent.hash).catch(() => null); if (!r) await sleep(2000); }
  if (!r || r.status !== 1) throw new Error(`${label}: tx ${sent.hash} not confirmed`);
  await p.page.waitForFunction(() => { const s = [...document.querySelectorAll(".txstatus")].pop(); return s && /Confirmed on chain/.test(s.innerText); }, null, { timeout: 90000 }).catch(() => {});
  sent.block = r.blockNumber; sent.label = label; sent.status = r.status;
  mark(p.role, `${label} confirmed`);
  console.log(`  ${label}: block ${r.blockNumber}`);
  await sleep(2500);
}

const vestryRead = new ethers.Contract(VESTRY, ["function grantCount() view returns (uint256)"], provider);
const funder = await person("funder", env.DEPLOYER_KEY);
const grantee = await person("grantee", env.GRANTEE_KEY);
const reviewer = await person("reviewer", env.REVIEWER_1_KEY);
const thirdUser = new ethers.Wallet(env.REVIEWER_2_KEY, provider);
let grantId = -1;

async function ensure(wallet, tPot) {
  const want = ethers.parseEther(String(tPot)), have = await provider.getBalance(wallet.address);
  if (have >= want) return;
  const tx = await grantee.wallet.sendTransaction({ to: wallet.address, value: want - have });
  await tx.wait();
  record("setup", `script top-up of ${wallet.address.slice(0, 8)}… to ${tPot} tPOT`, { hash: tx.hash });
}

try {
  grantId = Number(await vestryRead.grantCount());
  record("system", `recording grant id ${grantId}`);
  await ensure(reviewer.wallet, 16);
  await ensure(thirdUser, 10);

  // 1. Funder fills the form and escrows 10 tPOT. Gate: 3 Guestbook users, while it has 2.
  mark("funder", "opens app");
  await open(funder);
  await sleep(1500);
  await press(funder, funder.page.getByRole("button", { name: "Fund a grant" }));
  await sleep(900);
  await type(funder, funder.page.getByLabel("Grantee address"), grantee.wallet.address);
  await setValue(funder, funder.page.getByLabel("Approvals needed"), "1");
  await type(funder, funder.page.getByLabel("Reviewer addresses"), reviewer.wallet.address);
  await setValue(funder, funder.page.getByLabel("Amount (tPOT)"), "10");
  await setValue(funder, funder.page.getByLabel("Due in (days)"), "7");
  await setValue(funder, funder.page.getByLabel("Unlock over (blocks)"), "300");
  await press(funder, funder.page.getByLabel("Only pay once the grantee's contract shows real use"));
  await sleep(700);
  await setValue(funder, funder.page.getByLabel("At least"), "3");
  mark("funder", "form filled");
  await sleep(1500);
  let since = new Date().toISOString();
  await press(funder, funder.page.getByRole("button", { name: /Put 10 tPOT in escrow/ }));
  mark("funder", "escrow clicked");
  await confirmed(funder, since, "grant funded");

  // 2. Grantee submits their work.
  mark("grantee", "opens app");
  await open(grantee);
  const card = grantee.page.locator(`#grant-${grantId}`);
  await card.waitFor({ timeout: 90000 });
  await card.scrollIntoViewIfNeeded();
  await sleep(1500);
  await type(grantee, card.getByPlaceholder("Link to the commit, demo or transaction"), "https://github.com/nftkingiii/vestry");
  since = new Date().toISOString();
  await press(grantee, card.getByRole("button", { name: "Submit work" }));
  mark("grantee", "submit clicked");
  await confirmed(grantee, since, "work submitted");

  // 3. Reviewer approves. The Guestbook has 2 of 3 users, so Vestry keeps the money in escrow.
  mark("reviewer", "opens app");
  await open(reviewer);
  await press(reviewer, reviewer.page.getByRole("tab", { name: /Review/ }));
  const rcard = reviewer.page.locator(`#grant-${grantId}`);
  await rcard.waitFor({ timeout: 90000 });
  await rcard.scrollIntoViewIfNeeded();
  await sleep(1800);
  since = new Date().toISOString();
  await press(reviewer, rcard.getByRole("button", { name: "Approve" }));
  mark("reviewer", "approve clicked");
  await confirmed(reviewer, since, "approved, held at 2 of 3 users");
  await reviewer.page.reload({ waitUntil: "domcontentloaded" });
  await reviewer.page.waitForSelector(".wallet-chip", { timeout: 60000 });
  await press(reviewer, reviewer.page.getByRole("tab", { name: "Grants" }));
  const held = reviewer.page.locator(`#grant-${grantId}`);
  await held.waitFor({ timeout: 90000 });
  await held.scrollIntoViewIfNeeded();
  mark("reviewer", "held shown");
  await sleep(5000);

  // 4. A third real user signs the grantee's Guestbook (their app has no UI, so this one call is a script).
  const gb = new ethers.Contract(GUESTBOOK, ["function sign(string note)", "function entryCount() view returns (uint256)"], thirdUser);
  const signTx = await gb.sign("third user");
  await signTx.wait();
  record("third-user", "signed the grantee's Guestbook (script: the Guestbook has no UI)", { hash: signTx.hash, block: (await provider.getTransactionReceipt(signTx.hash)).blockNumber });

  // 5. Anyone can now release: the reviewer presses Pay in the app.
  await reviewer.page.reload({ waitUntil: "domcontentloaded" });
  await reviewer.page.waitForSelector(".wallet-chip", { timeout: 60000 });
  const pay = reviewer.page.locator(`#grant-${grantId}`);
  await pay.waitFor({ timeout: 90000 });
  await pay.scrollIntoViewIfNeeded();
  mark("reviewer", "three users shown");
  await sleep(2500);
  since = new Date().toISOString();
  await press(reviewer, pay.getByRole("button", { name: /Pay 10 tPOT/ }));
  mark("reviewer", "pay clicked");
  await confirmed(reviewer, since, "released as a vesting lock");

  // 6. The grantee claims what has vested so far.
  await sleep(40000);
  mark("grantee", "reopens for claim");
  await open(grantee);
  const claim = grantee.page.locator(`#grant-${grantId}`);
  await claim.waitFor({ timeout: 90000 });
  await claim.getByRole("button", { name: "Claim vested tPOT" }).scrollIntoViewIfNeeded();
  await sleep(2500);
  since = new Date().toISOString();
  await press(grantee, claim.getByRole("button", { name: "Claim vested tPOT" }));
  mark("grantee", "claim clicked");
  await confirmed(grantee, since, "vested tPOT claimed");

  // 7. Proof tab, live.
  mark("funder", "proof tab");
  await open(funder);
  await press(funder, funder.page.getByRole("tab", { name: "Proof" }));
  await funder.page.waitForSelector(".log li", { timeout: 120000 });
  await sleep(4000);
  await funder.page.mouse.wheel(0, 500);
  await sleep(4000);
  mark("funder", "done");
} catch (e) {
  record("system", `FAILED: ${e.message}`);
  for (const p of [funder, grantee, reviewer]) await p.page.screenshot({ path: join(FILM, `failure-${p.role}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const p of [funder, grantee, reviewer]) await p.browser.close().catch(() => {});
  writeFileSync(join(FILM, "film.json"), JSON.stringify({ marks, frames: { funder: funder.frames, grantee: grantee.frames, reviewer: reviewer.frames } }));
  writeFileSync(join(ROOT, "evidence", "demo-run.json"), JSON.stringify({
    what: "A grant recorded for the demo: each step clicked in the live web app in Chromium with an injected EIP-1193 test wallet (not MetaMask) holding a testnet burner key. Guestbook signing and wallet top-ups were scripts.",
    app: URL, network: "PortaldotV3 testnet", chainId: 420420777, grantId, steps,
  }, null, 2));
  console.log("done; frames:", funder.frames.length, grantee.frames.length, reviewer.frames.length);
}
