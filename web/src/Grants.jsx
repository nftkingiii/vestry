import { useState } from "react";
import { ethers } from "ethers";
import { GUESTBOOK, MIN_VESTED, VESTRY, VESTRY_ABI, WEI_PER_PLANCK, formatPot, short } from "./chain.js";
import { MilestoneActions, Track } from "./Track.jsx";
import { Hash, Pill, TxStatus, useTx } from "./ui.jsx";

export function GrantCard({ grant, wallet, nowSec, onChange }) {
  const released = grant.milestones.filter((m) => m.state === "Released").reduce((s, m) => s + m.amount, 0n);
  const me = wallet.account?.toLowerCase();
  const role = !me
    ? null
    : me === grant.funder.toLowerCase()
      ? "Funder"
      : me === grant.grantee.toLowerCase()
        ? "Grantee"
        : grant.reviewers.some((r) => r.toLowerCase() === me)
          ? "Reviewer"
          : null;
  return (
    <article className="grant">
      <header className="grant-head">
        <div>
          <h3>Grant {grant.id + 1}</h3>
          <p className="muted">
            <span className="mono">{short(grant.funder)}</span> funds <span className="mono">{short(grant.grantee)}</span> · {grant.threshold} of{" "}
            {grant.reviewers.length || "?"} reviewers
          </p>
        </div>
        <div className="grant-figures">
          {role && <Pill tone="accent">You are the {role.toLowerCase()}</Pill>}
          <div className="figure">
            <span className="figure-value tabular">{formatPot(released)}</span>
            <span className="figure-label">of {formatPot(grant.total)} tPOT released</span>
          </div>
          {grant.vestingLock !== null && (
            <div className="figure">
              <span className="figure-value tabular">{formatPot(grant.vestingLock * WEI_PER_PLANCK)}</span>
              <span className="figure-label">tPOT still locked on grantee</span>
            </div>
          )}
        </div>
      </header>
      <ul className="milestones">
        {grant.milestones.map((m) => (
          <li key={m.index} className="milestone">
            <div className="milestone-title">
              <span>Milestone {m.index + 1}</span>
              <Pill tone={{ Released: "ok", Reclaimed: "neutral", Submitted: "busy", Open: "neutral" }[m.state]}>{m.state}</Pill>
            </div>
            <Track grant={grant} m={m} nowSec={nowSec} />
            <MilestoneActions grant={grant} m={m} wallet={wallet} nowSec={nowSec} onChange={onChange} />
          </li>
        ))}
      </ul>
      {grant.createdTx && <Hash value={grant.createdTx} label="created" />}
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
        if (vestingBlocks > 0 && amount < MIN_VESTED) throw new Error("A vested tranche must be at least 10 tPOT (Portaldot's minimum vested transfer).");
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
      <h3>Fund a grant</h3>
      <p className="muted">
        You escrow the full amount now. Each milestone pays out only after review, and unpaid milestones come back to you after their deadline. Portaldot also holds a
        refundable storage deposit for the grant's on-chain record.
      </p>
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
              Deadline in days
              <input type="number" min="0.01" step="any" value={m.days} onChange={(e) => update(i, { days: e.target.value })} required />
            </label>
            <label>
              Vesting blocks
              <input type="number" min="0" value={m.vestingBlocks} onChange={(e) => update(i, { vestingBlocks: e.target.value })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={m.metric} onChange={(e) => update(i, { metric: e.target.checked })} />
            Require on-chain activity before payout
          </label>
          {m.metric && (
            <div className="grid-3">
              <label>
                Contract
                <input value={m.target} onChange={(e) => update(i, { target: e.target.value })} required />
              </label>
              <label>
                View function
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
          Escrow {total.toLocaleString()} tPOT
        </button>
      </div>
      {formError && <p className="error" role="alert">{formError}</p>}
      <TxStatus state={tx.state} />
    </form>
  );
}
