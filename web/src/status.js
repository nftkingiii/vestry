import { ethers } from "ethers";
import { formatPot } from "./chain.js";
import { milestoneLabel, nameOf } from "./labels.js";

const BLOCK_SECONDS = 6;

export function duration(seconds) {
  const minutes = Math.max(1, Math.round(Math.max(0, seconds) / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) {
    const h = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${Math.round(hours / 24)} days`;
}

/// Where a grant's money is right now.
export function split(grant) {
  const sum = (state) => grant.milestones.filter((m) => m.state === state).reduce((s, m) => s + m.amount, 0n);
  const paid = sum("Released");
  const returned = sum("Reclaimed");
  return { paid, returned, escrow: grant.total - paid - returned };
}

export function totals(grants) {
  return grants.reduce(
    (t, g) => {
      const s = split(g);
      return { paid: t.paid + s.paid, escrow: t.escrow + s.escrow, returned: t.returned + s.returned };
    },
    { paid: 0n, escrow: 0n, returned: 0n }
  );
}

/// How much of a released vesting tranche has unlocked, from the release block.
export function unlock(m, head) {
  if (m.state !== "Released" || !m.vestingBlocks || m.releasedBlock === null || !head) return null;
  const done = Math.min(m.vestingBlocks, Math.max(0, head - m.releasedBlock));
  return { pct: Math.floor((done / m.vestingBlocks) * 100), remainingSeconds: (m.vestingBlocks - done) * BLOCK_SECONDS };
}

/// One plain sentence per milestone, a chip, and the step row.
export function describe(grant, m, nowSec) {
  const { metric } = milestoneLabel(grant.id, m.index);
  const hasMetric = m.metricTarget !== ethers.ZeroAddress;
  const metricText = (v) => (metric ? `${v} of ${m.metricMin} ${metric}` : `${v} of ${m.metricMin} on the activity target`);
  const expired = nowSec > m.deadline;
  const due = expired ? null : duration(m.deadline - nowSec);
  const need = grant.threshold - m.approvals;
  const amount = `${formatPot(m.amount)} tPOT`;
  const reviewers = grant.threshold === 1 ? "the reviewer" : grant.threshold === 2 ? "both reviewers" : `${grant.threshold} reviewers`;

  if (m.state === "Released") {
    const how = hasMetric ? `once ${reviewers} approved and ${metricText(m.metricAtRelease ?? m.metricMin)}` : `after ${reviewers} approved`;
    return { chip: "paid", chipText: "Paid", text: `Paid ${amount} ${how}.${m.changes ? " One change was requested first." : ""}` };
  }
  if (m.state === "Reclaimed") {
    return { chip: "back", chipText: "Returned", text: `Nothing was paid before the deadline, so ${amount} went back to the funder.` };
  }
  if (expired) {
    return { chip: "late", chipText: "Overdue", text: `The deadline passed before this was paid. The funder can take the ${amount} back.` };
  }
  if (m.state === "Open") {
    if (m.changes) {
      return { chip: "held", chipText: "Changes requested", text: `${nameOf(m.changes.by) || "A reviewer"} asked for changes: "${m.changes.reason}". Waiting for the grantee to resubmit. Due in ${due}.` };
    }
    return { chip: "held", chipText: "Waiting", text: `Waiting for the grantee to submit their work. Due in ${due}.` };
  }
  // Submitted
  const metricOk = !hasMetric || (m.metricValue ?? 0) >= m.metricMin;
  if (need > 0) {
    const then = hasMetric ? `, then ${metricText(m.metricValue ?? 0)}` : "";
    return { chip: "held", chipText: "In review", text: `Waiting for ${need} more approval${need > 1 ? "s" : ""}${then}. Due in ${due}.` };
  }
  if (!metricOk) {
    return { chip: "held", chipText: "Waiting on usage", text: `Approved, but held until ${metric ? `${m.metricMin} ${metric}` : "the activity target is met"}. So far ${m.metricValue ?? 0}. Due in ${due}.` };
  }
  return { chip: "held", chipText: "Ready", text: `Approved and ready to pay. Anyone can release it now.` };
}

export function steps(grant, m) {
  const { metric } = milestoneLabel(grant.id, m.index);
  const list = [];
  // Submission is known from events: a Reclaimed milestone may never have been submitted.
  const submitted = m.state === "Submitted" || m.state === "Released" || (m.state === "Reclaimed" && m.evidence !== null);
  const closed = m.state === "Reclaimed";
  list.push({ text: submitted ? "Submitted" : "Not submitted", tone: submitted ? "ok" : closed ? "todo" : "wait" });
  const approved = m.state === "Released" ? grant.threshold : m.state === "Submitted" ? m.approvals : 0;
  list.push({ text: `Approvals ${approved} of ${grant.threshold}`, tone: approved >= grant.threshold ? "ok" : m.state === "Submitted" ? "wait" : "todo" });
  if (m.metricTarget !== ethers.ZeroAddress) {
    const v = m.state === "Released" ? m.metricAtRelease ?? m.metricMin : m.metricValue ?? 0;
    list.push({ text: `${v} of ${m.metricMin} ${metric || "on the activity target"}`, tone: v >= m.metricMin ? "ok" : closed ? "todo" : "wait" });
  }
  return list;
}

/// What the connected wallet can do right now, across all grants.
export function todos(grants, account, nowSec) {
  if (!account) return [];
  const me = account.toLowerCase();
  const out = [];
  for (const g of grants) {
    const isReviewer = g.reviewers.some((r) => r.toLowerCase() === me);
    for (const m of g.milestones) {
      const live = nowSec <= m.deadline;
      if (live && m.state === "Submitted" && isReviewer && !m.approvers.some((a) => a.toLowerCase() === me)) {
        out.push({ grant: g, m, kind: "review" });
      } else if (live && m.state === "Open" && g.grantee.toLowerCase() === me) {
        out.push({ grant: g, m, kind: "submit" });
      } else if (!live && (m.state === "Open" || m.state === "Submitted") && g.funder.toLowerCase() === me) {
        out.push({ grant: g, m, kind: "reclaim" });
      }
    }
  }
  return out;
}
