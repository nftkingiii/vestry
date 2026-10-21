import { useState } from "react";
import { ethers } from "ethers";
import { GUESTBOOK, MIN_VESTED, VESTRY, VESTRY_ABI, WEI_PER_PLANCK, formatPot, short } from "./chain.js";
import { grantTitle, nameOf } from "./labels.js";
import { split } from "./status.js";
import { MilestoneRow } from "./Milestone.jsx";
import { Hash, TxStatus, useTx } from "./ui.jsx";

function Party({ address }) {
  const name = nameOf(address);
  return (
    <span className="party">
      {name || short(address)}
      {name && <small className="mono">{short(address)}</small>}
    </span>
  );
}

export function GrantCard({ grant, wallet, nowSec, head, onChange }) {
  const s = split(grant);
  const pct = (v) => (grant.total > 0n ? Number((v * 10000n) / grant.total) / 100 : 0);
  return (
    <article className="grant" id={`grant-${grant.id}`}>
      <div className="grant-top">
        <div>
          <h3>{grantTitle(grant.id)}</h3>
          <div className="who">
            <span>
              From <Party address={grant.funder} />
            </span>
            <span>
              to <Party address={grant.grantee} />
            </span>
          </div>
        </div>
        <div className="grant-amount tabular">
          {formatPot(grant.total)} <span>tPOT</span>
        </div>
      </div>
      <div className="bar" role="img" aria-label={`${formatPot(s.paid)} paid, ${formatPot(s.escrow)} in escrow, ${formatPot(s.returned)} returned`}>
        <i className="bar-paid" style={{ width: `${pct(s.paid)}%` }} />
        <i className="bar-escrow" style={{ width: `${pct(s.escrow)}%` }} />
        <i className="bar-back" style={{ width: `${pct(s.returned)}%` }} />
      </div>
      <div className="legend tabular">
        <span><i className="key key-paid" /><b>{formatPot(s.paid)}</b> paid</span>
        <span><i className="key key-escrow" /><b>{formatPot(s.escrow)}</b> in escrow</span>
        <span><i className="key key-back" /><b>{formatPot(s.returned)}</b> returned</span>
        <span className="legend-meta">
          {grant.reviewers.length === 1 && grant.threshold === 1
            ? "1 reviewer must approve"
            : `${grant.threshold} of ${grant.reviewers.length || "?"} reviewers must approve`}
        </span>
      </div>
      <ol className="ms">
        {grant.milestones.map((m) => (
          <MilestoneRow key={m.index} grant={grant} m={m} wallet={wallet} nowSec={nowSec} head={head} onChange={onChange} />
        ))}
      </ol>
      {grant.createdTx && (
        <div className="grant-foot">
          <span>Funded in block {grant.createdBlock?.toLocaleString()}</span>
          <Hash value={grant.createdTx} label="tx" />
        </div>
      )}
    </article>
  );
}

const blankMilestone = () => ({ amount: "10", days: "14", vestingBlocks: "1000", metric: false, target: GUESTBOOK, fn: "entryCount", min: "2" });

export function CreateGrant({ wallet, onChange }) {
  const [grantee, setGrantee] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [threshold, setThreshold] = useState("1");
  const [items, setItems] = useState([blankMilestone()]);
  const [formError, setFormError] = useState(null);
  const tx = useTx(onChange);
  const busy = ["estimating", "wallet", "pending"].includes(tx.state.phase);

  function update(i, patch) {
    setItems((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  function submit(e) {
    e.preventDefault();
    setFormError(null);
    try {
      const reviewerList = reviewers.split(/[\s,]+/).filter(Boolean).map((a) => ethers.getAddress(a));
      const now = Math.floor(Date.now() / 1000);
      const inputs = items.map((m) => {
        const amount = ethers.parseEther(m.amount || "0");
        const vestingBlocks = Number(m.vestingBlocks || 0);
        if (vestingBlocks > 0 && amount < MIN_VESTED) throw new Error("A tranche paid as a vesting lock must be at least 10 tPOT (Portaldot's minimum).");
        if (amount % WEI_PER_PLANCK !== 0n) throw new Error("Amounts can have at most 14 decimal places.");
        return {
          amount,
          deadline: now + Math.round(Number(m.days) * 86400),
          vestingBlocks,
          metricTarget: m.metric ? ethers.getAddress(m.target) : ethers.ZeroAddress,
          metricSelector: m.metric ? ethers.id(`${m.fn.replace(/\(\)$/, "")}()`).slice(0, 10) : "0x00000000",
          metricMin: m.metric ? Number(m.min) : 0,
        };
      });
      const total = inputs.reduce((s, m) => s + m.amount, 0n);
      const args = [ethers.getAddress(grantee), ethers.ZeroAddress, reviewerList, Number(threshold), inputs];
      tx.run(async () => ({ contract: new ethers.Contract(VESTRY, VESTRY_ABI, await wallet.signer()), method: "createGrant", args, value: total }));
    } catch (err) {
      setFormError(err.shortMessage || err.message);
    }
  }

  const total = items.reduce((s, m) => s + Number(m.amount || 0), 0);
  return (
    <form className="create" onSubmit={submit}>
      <div>
        <h3>Fund a grant</h3>
        <p className="muted">
          You put the full amount in escrow now. Each milestone is paid only after review, and anything unpaid comes back to you after its deadline. Portaldot also holds a
          refundable storage deposit, shown before you confirm.
        </p>
      </div>
      <div className="grid-2">
        <label>
          Grantee address
          <input value={grantee} onChange={(e) => setGrantee(e.target.value)} placeholder="0x…" required />
        </label>
        <label>
          Approvals needed
          <input type="number" min="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
        </label>
      </div>
      <label>
        Reviewer addresses
        <textarea rows="2" value={reviewers} onChange={(e) => setReviewers(e.target.value)} placeholder="0x… one per line" required />
      </label>
      {items.map((m, i) => (
        <fieldset key={i} className="milestone-input">
          <legend>Milestone {i + 1}</legend>
          <div className="grid-3">
            <label>
              Amount (tPOT)
              <input type="number" min="0" step="any" value={m.amount} onChange={(e) => update(i, { amount: e.target.value })} required />
            </label>
            <label>
              Due in (days)
              <input type="number" min="0.01" step="any" value={m.days} onChange={(e) => update(i, { days: e.target.value })} required />
            </label>
            <label>
              Unlock over (blocks)
              <input type="number" min="0" value={m.vestingBlocks} onChange={(e) => update(i, { vestingBlocks: e.target.value })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={m.metric} onChange={(e) => update(i, { metric: e.target.checked })} />
            Only pay once the grantee's contract shows real use
          </label>
          {m.metric && (
            <div className="grid-3">
              <label>
                Contract
                <input value={m.target} onChange={(e) => update(i, { target: e.target.value })} required />
              </label>
              <label>
                Counter function
                <input value={m.fn} onChange={(e) => update(i, { fn: e.target.value })} required />
              </label>
              <label>
                At least
                <input type="number" min="0" value={m.min} onChange={(e) => update(i, { min: e.target.value })} required />
              </label>
            </div>
          )}
          {items.length > 1 && (
            <button type="button" className="btn btn-quiet" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
              Remove milestone
            </button>
          )}
        </fieldset>
      ))}
      <div className="action-row">
        <button type="button" className="btn btn-quiet" onClick={() => setItems((l) => [...l, blankMilestone()])}>
          Add milestone
        </button>
        <button className="btn btn-primary" disabled={busy || wallet.status !== "ready"}>
          Put {total.toLocaleString()} tPOT in escrow
        </button>
      </div>
      {formError && <p className="error" role="alert">{formError}</p>}
      <TxStatus state={tx.state} />
    </form>
  );
}
