import { useState } from "react";
import { ethers } from "ethers";
import { VESTRY, VESTRY_ABI, formatPot } from "./chain.js";
import { TxStatus, useTx } from "./ui.jsx";

/// The release track answers one question per milestone: what is holding this tranche?
export function stations(grant, m, nowSec) {
  const expired = nowSec > m.deadline && (m.state === "Open" || m.state === "Submitted");
  const quorum = m.approvals >= grant.threshold;
  const metricOk = m.metricValue === null ? null : m.metricValue >= m.metricMin;
  const done = m.state === "Released";
  const list = [
    { key: "escrow", label: "Escrowed", detail: `${formatPot(m.amount)} tPOT`, status: "done" },
    {
      key: "submit",
      label: "Evidence",
      detail: m.state === "Open" ? (m.round > 0 ? "Changes requested" : "Awaiting grantee") : "Submitted",
      status: m.state === "Open" ? (expired ? "blocked" : "current") : "done",
    },
    {
      key: "review",
      label: "Review",
      detail: `${m.approvals} of ${grant.threshold} approvals`,
      status: done || (m.state === "Submitted" && quorum) ? "done" : m.state === "Submitted" ? (expired ? "blocked" : "current") : "todo",
    },
  ];
  if (m.metricTarget !== ethers.ZeroAddress) {
    list.push({
      key: "metric",
      label: "Activity",
      detail: m.metricValue === null ? `target ${m.metricMin} (unreadable)` : `${m.metricValue} of ${m.metricMin}`,
      status: done ? "done" : quorum && m.state === "Submitted" ? (metricOk ? "done" : "blocked") : metricOk ? "done" : "todo",
    });
  }
  list.push({
    key: "pay",
    label: m.state === "Reclaimed" ? "Returned" : m.vestingBlocks ? "Vesting lock" : "Paid",
    detail:
      m.state === "Reclaimed"
        ? "Back to funder"
        : done
          ? m.vestingBlocks
            ? `Unlocks over ${m.vestingBlocks.toLocaleString()} blocks`
            : "Sent to grantee"
          : expired
            ? "Deadline passed"
            : `Due ${new Date(m.deadline * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
    status: done ? "done" : m.state === "Reclaimed" ? "returned" : expired ? "blocked" : "todo",
  });
  return list;
}

export function Track({ grant, m, nowSec }) {
  return (
    <ol className="track" aria-label={`Milestone ${m.index + 1} release track`}>
      {stations(grant, m, nowSec).map((s) => (
        <li key={s.key} className={`station station-${s.status}`}>
          <span className="dot" aria-hidden="true" />
          <span className="station-label">{s.label}</span>
          <span className="station-detail">{s.detail}</span>
          <span className="sr-only">({s.status})</span>
        </li>
      ))}
    </ol>
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
  const expired = nowSec > m.deadline;
  const busy = ["estimating", "wallet", "pending"].includes(tx.state.phase);

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
        <label className="sr-only" htmlFor={`ev-${grant.id}-${m.index}`}>Delivery evidence</label>
        <input id={`ev-${grant.id}-${m.index}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Commit, URL or tx hash" required />
        <button className="btn btn-primary" disabled={busy}>Submit evidence</button>
      </form>
    );
  }
  if (isReviewer && m.state === "Submitted" && !expired) {
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
        <label className="sr-only" htmlFor={`rc-${grant.id}-${m.index}`}>Reason for changes</label>
        <input id={`rc-${grant.id}-${m.index}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="What needs to change" required />
        <button className="btn" disabled={busy}>Request changes</button>
      </form>
    );
  }
  if (m.state === "Submitted" && m.approvals >= grant.threshold && !expired) {
    actions.push(
      <button key="release" className="btn" disabled={busy} onClick={() => call("release", [grant.id, m.index])}>
        Release tranche
      </button>
    );
  }
  if (isFunder && expired && (m.state === "Open" || m.state === "Submitted")) {
    actions.push(
      <button key="reclaim" className="btn" disabled={busy} onClick={() => call("reclaim", [grant.id, m.index])}>
        Reclaim {formatPot(m.amount)} tPOT
      </button>
    );
  }
  if (!actions.length && tx.state.phase === "idle") return null;
  return (
    <div className="actions">
      <div className="action-row">{actions}</div>
      <TxStatus state={tx.state} />
    </div>
  );
}
