import { ethers } from "ethers";

export const CHAIN = {
  id: 420420777,
  hexId: "0x190f1ca9",
  name: "PortaldotV3 Testnet",
  rpc: "https://test-evm-rpc-v3.portaldot.dev",
  symbol: "tPOT",
};

export const VESTRY = "0x12d0691c7B756AA5205f24B678D68C74B885cda9";
export const GUESTBOOK = "0xc3Ee4B657FADAE473b22c692544e35223bFE9B42";
export const VESTING_PRECOMPILE = "0x0000000000000000000000000000000009020000";
export const DEPLOY_BLOCK = 128768;
export const DEPLOYMENTS = [
  { name: "Vestry", address: VESTRY, tx: "0xc7c38b8fcfdf204fe825ea2437e9767b3d462c291f605e8b4103f18955cd118d", block: 128768, deposit: "423.38" },
  { name: "Guestbook", address: GUESTBOOK, tx: "0xc501d932533ecb7c5b25c854e287f0b495d80ece0d0a6fa3c85741c555931367", block: 128769, deposit: "49.83" },
];
/// pallet-revive maps 1 planck (10^-14 POT) to 10^4 wei, so EVM amounts use 18 decimals.
export const WEI_PER_PLANCK = 10n ** 4n;
export const MIN_VESTED = ethers.parseEther("10");

export const VESTRY_ABI = [
  "function grantCount() view returns (uint256)",
  "function grants(uint256) view returns (address funder, uint8 threshold, uint8 milestoneCount, address grantee, address token)",
  "function isReviewer(uint256, address) view returns (bool)",
  "function getMilestone(uint256 grantId, uint256 index) view returns (tuple(uint128 amount, uint64 deadline, uint32 vestingBlocks, uint8 approvals, uint8 round, uint8 state, address metricTarget, bytes4 metricSelector, uint64 metricMin))",
  "function readMetric(address target, bytes4 selector) view returns (uint256)",
  "function createGrant(address grantee, address token, address[] reviewers, uint8 threshold, tuple(uint128 amount, uint64 deadline, uint32 vestingBlocks, address metricTarget, bytes4 metricSelector, uint64 metricMin)[] inputs) payable returns (uint256)",
  "function submitMilestone(uint256 grantId, uint256 index, string evidence)",
  "function approveMilestone(uint256 grantId, uint256 index)",
  "function requestChanges(uint256 grantId, uint256 index, string reason)",
  "function release(uint256 grantId, uint256 index)",
  "function reclaim(uint256 grantId, uint256 index)",
  "event GrantCreated(uint256 indexed grantId, address indexed funder, address indexed grantee, address token, uint256 total, address[] reviewers, uint8 threshold)",
  "event MilestoneSubmitted(uint256 indexed grantId, uint256 indexed index, string evidence)",
  "event MilestoneApproved(uint256 indexed grantId, uint256 indexed index, address indexed reviewer, uint8 approvals)",
  "event ChangesRequested(uint256 indexed grantId, uint256 indexed index, address indexed reviewer, string reason)",
  "event AwaitingMetric(uint256 indexed grantId, uint256 indexed index)",
  "event MilestoneReleased(uint256 indexed grantId, uint256 indexed index, uint256 amount, uint32 vestingBlocks, uint256 metricValue)",
  "event MilestoneReclaimed(uint256 indexed grantId, uint256 indexed index, uint256 amount)",
  "error NotFunder()",
  "error NotGrantee()",
  "error NotReviewer()",
  "error BadConfig()",
  "error BadState()",
  "error AlreadyApproved()",
  "error DeadlinePassed()",
  "error DeadlineNotPassed()",
  "error MetricBelowTarget(uint256 value, uint256 required)",
  "error MetricUnreadable()",
  "error PayoutFailed()",
];

export const VESTING_ABI = ["function vestingBalanceOf(address target) view returns (uint256)", "function vest()"];
const GUESTBOOK_ABI = ["function entryCount() view returns (uint256)", "function sign(string note)", "function signed(address) view returns (bool)"];

export const STATES = ["Open", "Submitted", "Released", "Reclaimed"];
export const readProvider = new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true });
export const vestryRead = new ethers.Contract(VESTRY, VESTRY_ABI, readProvider);
export const guestbookRead = new ethers.Contract(GUESTBOOK, GUESTBOOK_ABI, readProvider);
const vestingRead = new ethers.Contract(VESTING_PRECOMPILE, VESTING_ABI, readProvider);
export const vestryIface = new ethers.Interface(VESTRY_ABI);
export const guestbookIface = new ethers.Interface(GUESTBOOK_ABI);

/// Native account behind an H160 under pallet-revive's auto-mapping: the 20 address
/// bytes followed by twelve 0xEE bytes, SS58-encoded with the generic prefix 42.
export function mappedSs58(h160) {
  const bytes = ethers.getBytes(ethers.concat([h160, new Uint8Array(12).fill(0xee)]));
  return ss58Encode(bytes, 42);
}

function ss58Encode(pubkey, prefix) {
  const payload = new Uint8Array([prefix, ...pubkey]);
  const pre = new TextEncoder().encode("SS58PRE");
  const hash = blake2b512(new Uint8Array([...pre, ...payload]));
  return base58(new Uint8Array([...payload, hash[0], hash[1]]));
}

function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

// Minimal BLAKE2b-512 (RFC 7693) for the SS58 checksum.
function blake2b512(input) {
  const IV = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
  const SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  ];
  const M = 0xffffffffffffffffn;
  const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M;
  const h = IV.slice();
  h[0] ^= 0x01010000n ^ 64n;
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let b = 0; b < blocks; b++) {
    const chunk = new Uint8Array(128);
    chunk.set(input.subarray(b * 128, b * 128 + 128));
    const m = [];
    for (let i = 0; i < 16; i++) {
      let w = 0n;
      for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(chunk[i * 8 + j]);
      m.push(w);
    }
    const last = b === blocks - 1;
    const t = BigInt(last ? input.length : (b + 1) * 128);
    const v = [...h, ...IV];
    v[12] ^= t & M;
    if (last) v[14] ^= M;
    const G = (a, bb, c, d, x, y) => {
      v[a] = (v[a] + v[bb] + x) & M; v[d] = rotr(v[d] ^ v[a], 32);
      v[c] = (v[c] + v[d]) & M; v[bb] = rotr(v[bb] ^ v[c], 24);
      v[a] = (v[a] + v[bb] + y) & M; v[d] = rotr(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) & M; v[bb] = rotr(v[bb] ^ v[c], 63);
    };
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((h[i] >> BigInt(8 * j)) & 0xffn);
  return out;
}

/// Per-milestone history the contract keeps only in events: latest evidence, the last
/// change request, who approved since the latest submission, and when it was released.
function historyFromEvents(events) {
  const byMilestone = new Map();
  const key = (g, i) => `${g}:${i}`;
  const get = (g, i) => {
    if (!byMilestone.has(key(g, i))) byMilestone.set(key(g, i), { evidence: null, changes: null, approvers: [], releasedBlock: null, metricAtRelease: null });
    return byMilestone.get(key(g, i));
  };
  for (const e of events) {
    if (e.args.index === undefined) continue;
    const h = get(Number(e.args.grantId), Number(e.args.index));
    if (e.name === "MilestoneSubmitted") {
      h.evidence = e.args.evidence;
      h.approvers = [];
    } else if (e.name === "ChangesRequested") {
      h.changes = { reason: e.args.reason, by: e.args.reviewer };
    } else if (e.name === "MilestoneApproved") {
      h.approvers.push(e.args.reviewer);
    } else if (e.name === "MilestoneReleased") {
      h.releasedBlock = e.block;
      h.metricAtRelease = Number(e.args.metricValue);
    }
  }
  return (g, i) => byMilestone.get(key(g, i)) || { evidence: null, changes: null, approvers: [], releasedBlock: null, metricAtRelease: null };
}

/// Loads every grant with its milestones, reviewers (from GrantCreated), event history,
/// and the grantee's live vesting lock and activity metric.
export async function loadGrants() {
  const [count, head, events] = await Promise.all([vestryRead.grantCount(), readProvider.getBlockNumber(), loadActivity()]);
  const chronological = events.slice().reverse();
  const created = new Map(chronological.filter((e) => e.name === "GrantCreated").map((e) => [Number(e.args.grantId), e]));
  const history = historyFromEvents(chronological);
  // Read everything in parallel: one after another took about 20 s on the public RPC and grew with every grant.
  const grants = await Promise.all(
    Array.from({ length: Number(count) }, async (_, id) => {
      const g = await vestryRead.grants(id);
      const [milestones, vestingLock] = await Promise.all([
        Promise.all(
          Array.from({ length: Number(g.milestoneCount) }, async (_, i) => {
            const m = await vestryRead.getMilestone(id, i);
            const metricValue =
              m.metricTarget === ethers.ZeroAddress ? null : await vestryRead.readMetric(m.metricTarget, m.metricSelector).catch(() => null);
            return {
              index: i,
              amount: m.amount,
              deadline: Number(m.deadline),
              vestingBlocks: Number(m.vestingBlocks),
              approvals: Number(m.approvals),
              round: Number(m.round),
              state: STATES[Number(m.state)],
              metricTarget: m.metricTarget,
              metricSelector: m.metricSelector,
              metricMin: Number(m.metricMin),
              metricValue: metricValue === null ? null : Number(metricValue),
              ...history(id, i),
            };
          })
        ),
        vestingRead.vestingBalanceOf(g.grantee).catch(() => null),
      ]);
      const log = created.get(id);
      return {
        id,
        funder: g.funder,
        grantee: g.grantee,
        token: g.token,
        threshold: Number(g.threshold),
        reviewers: log ? [...log.args.reviewers] : [],
        total: log ? log.args.total : milestones.reduce((s, m) => s + m.amount, 0n),
        createdTx: log?.tx,
        createdBlock: log?.block,
        vestingLock,
        milestones,
      };
    })
  );
  return { grants, head };
}

export async function loadActivity() {
  const logs = await readProvider.getLogs({ address: VESTRY, fromBlock: DEPLOY_BLOCK, toBlock: "latest" });
  return logs
    .map((l) => {
      try {
        const parsed = vestryIface.parseLog(l);
        return { name: parsed.name, args: parsed.args, tx: l.transactionHash, block: l.blockNumber, logIndex: l.index ?? 0 };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    // Newest first. The RPC does not guarantee log order within a block, so sort explicitly.
    .sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
}

/// Native assets a grant can be paid in (pallet-assets behind its ERC-20 precompile). Amounts on chain are in the
/// token's own units, so a 6-decimal token must never go through formatPot.
const TOKENS = { "0x0499867300000000000000000000000000010000": { symbol: "vUSD", decimals: 6 } };

export function tokenOf(grant) {
  if (!grant.token || grant.token === ethers.ZeroAddress) return { symbol: CHAIN.symbol, decimals: 18, native: true };
  return TOKENS[grant.token.toLowerCase()] || { symbol: "tokens", decimals: 18 };
}

/// An amount of this grant's own currency as a plain number string, e.g. "100".
export function formatUnits(grant, amount) {
  if (amount === null || amount === undefined) return "—";
  return Number(ethers.formatUnits(amount, tokenOf(grant).decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPot(wei, digits = 2) {
  if (wei === null || wei === undefined) return "—";
  return Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function short(addr, n = 4) {
  return addr ? `${addr.slice(0, 2 + n)}…${addr.slice(-n)}` : "";
}

/// Turns a revert into a sentence a funder or reviewer can act on.
export function explainError(e) {
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  if (data) {
    try {
      const err = vestryIface.parseError(data);
      const map = {
        NotFunder: "Only the funder of this grant can do that.",
        NotGrantee: "Only the grantee can submit evidence.",
        NotReviewer: "This wallet is not a reviewer on this grant.",
        BadConfig: "The grant settings are invalid. Check amounts (at least 10 tPOT for a vested tranche), deadlines and reviewers.",
        BadState: "This milestone is not in a state that allows that action.",
        AlreadyApproved: "You already approved this round.",
        DeadlinePassed: "The deadline has passed.",
        DeadlineNotPassed: "The deadline has not passed yet.",
        MetricBelowTarget: `Activity is ${err.args?.[0]} and the target is ${err.args?.[1]}, so the tranche stays in escrow.`,
        MetricUnreadable: "The activity metric could not be read from the target contract.",
        PayoutFailed: "The payout transfer failed.",
      };
      if (map[err.name]) return map[err.name];
    } catch {
      /* not a Vestry error */
    }
  }
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "You rejected the request in your wallet.";
  if (!data && /execution reverted|CALL_EXCEPTION/i.test(e?.message || e?.code || "")) {
    return "The chain refused this call. For a claim, that usually means nothing new has vested yet or it was already claimed.";
  }
  if (/insufficient funds|Invalid Transaction/i.test(e?.message || "")) {
    return "Not enough tPOT for this transaction plus Portaldot's storage deposit.";
  }
  return e?.shortMessage || e?.message || "Something went wrong.";
}
