import { GrantCard } from "./Grants.jsx";

/// Grants with work waiting on review. With a reviewer wallet connected, only grants that
/// wallet reviews; otherwise every grant with a submission, read-only.
export function Review({ data, wallet, nowSec, onChange }) {
  if (!data) return <p className="muted">Reading the chain…</p>;
  const me = wallet.status === "ready" ? wallet.account?.toLowerCase() : null;
  const queue = data.grants.filter(
    (g) => g.milestones.some((m) => m.state === "Submitted" && nowSec <= m.deadline) && (!me || g.reviewers.some((r) => r.toLowerCase() === me))
  );
  if (!queue.length) {
    return (
      <div className="empty">
        <h3>Nothing waiting for review</h3>
        <p className="muted">
          {me
            ? "When a grantee submits work on a grant you review, it shows up here."
            : "Submitted work from every grant shows up here. Connect a reviewer wallet to approve or ask for changes."}
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      {queue.map((g) => (
        <GrantCard key={g.id} grant={g} wallet={wallet} nowSec={nowSec} head={data.head} onChange={onChange} />
      ))}
    </div>
  );
}
