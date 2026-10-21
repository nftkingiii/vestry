import { useState } from "react";
import { ethers } from "ethers";
import { VESTRY, VESTRY_ABI, formatPot } from "./chain.js";
import { milestoneLabel } from "./labels.js";
import { describe, duration, steps, unlock } from "./status.js";
import { TxStatus, useTx } from "./ui.jsx";

export function MilestoneRow({ grant, m, wallet, nowSec, head, onChange }) {
  const { title } = milestoneLabel(grant.id, m.index);
  const d = describe(grant, m, nowSec);
  const u = unlock(m, head);
  return (
    <li className="m">
      <span className="m-n tabular">{m.index + 1}</span>
      <div className="m-body">
        <div className="m-title">{title}</div>
        <p className="m-text">{d.text}</p>
        {m.evidence && m.state !== "Reclaimed" && <p className="m-evidence">Evidence: {m.evidence}</p>}
        <div className="m-steps">
          {steps(grant, m).map((s, i) => (
            <span key={i} className={`step step-${s.tone}`}>
              {s.tone === "ok" ? "✓ " : ""}
              {s.text}
            </span>
          ))}
        </div>
        {u && (
          <div className="unlock">
            <div className="unlock-track" role="progressbar" aria-valuenow={u.pct} aria-valuemin="0" aria-valuemax="100" aria-label="Vested share of this tranche">
              <i style={{ width: `${u.pct}%` }} />
            </div>
            {/* pallet-vesting keeps the lock until the grantee calls vest(), so this is vested, not yet withdrawn. */}
            <span>
              {u.pct < 100 ? `${u.pct}% vested · the rest over ~${duration(u.remainingSeconds)}` : "Fully vested · the grantee claims it with vest()"}
            </span>
          </div>
        )}
        <MilestoneActions grant={grant} m={m} wallet={wallet} nowSec={nowSec} onChange={onChange} />
      </div>
      <span className={`chip chip-${d.chip}`}>{d.chipText}</span>
    </li>
  );
}

/// The actions this wallet may take on this milestone, and nothing else.
export function MilestoneActions({ grant, m, wallet, nowSec, onChange }) {
  const tx = useTx(onChange);
  const [text, setText] = useState("");
  const me = wallet.account?.toLowerCase();
  const isGrantee = me === grant.grantee.toLowerCase();
  const isFunder = me === grant.funder.toLowerCase();
  const isReviewer = grant.reviewers.some((r) => r.toLowerCase() === me);
  const approvedAlready = m.approvers.some((a) => a.toLowerCase() === me);
  const expired = nowSec > m.deadline;
  const busy = ["estimating", "wallet", "pending"].includes(tx.state.phase);
  const metricOk = m.metricTarget === ethers.ZeroAddress || (m.metricValue ?? 0) >= m.metricMin;

  const call = (method, args) =>
    tx.run(async () => ({ contract: new ethers.Contract(VESTRY, VESTRY_ABI, await wallet.signer()), method, args }));

  if (wallet.status !== "ready") return null;
  const actions = [];
  if (isGrantee && m.state === "Open" && !expired) {
    actions.push(
      <form
        key="submit"
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) call("submitMilestone", [grant.id, m.index, text.trim()]);
        }}
      >
        <label className="sr-only" htmlFor={`ev-${grant.id}-${m.index}`}>Link to your work</label>
        <input id={`ev-${grant.id}-${m.index}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Link to the commit, demo or transaction" required />
        <button className="btn btn-primary" disabled={busy}>Submit work</button>
      </form>
    );
  }
  if (isReviewer && m.state === "Submitted" && !expired && !approvedAlready) {
    actions.push(
      <button key="approve" className="btn btn-primary" disabled={busy} onClick={() => call("approveMilestone", [grant.id, m.index])}>
        Approve
      </button>,
      <form
        key="changes"
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) call("requestChanges", [grant.id, m.index, text.trim()]);
        }}
      >
        <label className="sr-only" htmlFor={`rc-${grant.id}-${m.index}`}>What needs to change</label>
        <input id={`rc-${grant.id}-${m.index}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or say what needs to change" required />
        <button className="btn" disabled={busy}>Request changes</button>
      </form>
    );
  }
  if (m.state === "Submitted" && m.approvals >= grant.threshold && metricOk && !expired) {
    actions.push(
      <button key="release" className="btn btn-primary" disabled={busy} onClick={() => call("release", [grant.id, m.index])}>
        Pay {formatPot(m.amount)} tPOT
      </button>
    );
  }
  if (isFunder && expired && (m.state === "Open" || m.state === "Submitted")) {
    actions.push(
      <button key="reclaim" className="btn btn-primary" disabled={busy} onClick={() => call("reclaim", [grant.id, m.index])}>
        Take back {formatPot(m.amount)} tPOT
      </button>
    );
  }
  if (!actions.length && tx.state.phase === "idle") return null;
  return (
    <div className="m-actions">
      <div className="action-row">{actions}</div>
      <TxStatus state={tx.state} />
    </div>
  );
}
