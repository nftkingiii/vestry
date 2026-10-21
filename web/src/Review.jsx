import { GrantCard } from "./Grants.jsx";

/// Submitted milestones waiting on review. With a wallet connected, only grants where
/// that wallet is a reviewer; without one, every open submission, read-only.
export function Review({ data, wallet, nowSec, onChange }) {
  const me = wallet.account?.toLowerCase();
  const queue = (data?.grants || []).filter(
    (g) =>
      g.milestones.some((m) => m.state === "Submitted") &&
      (!me || wallet.status !== "ready" || g.reviewers.some((r) => r.toLowerCase() === me))
  );
  if (!data) return <p className="muted">Reading the chain…</p>;
  if (!queue.length) {
    return (
      <div className="empty">
        <h3>Nothing waiting for review</h3>
        <p className="muted">
          {me && wallet.status === "ready"
            ? "When a grantee submits evidence on a grant you review, it shows up here."
            : "Submitted milestones from every grant appear here. Connect a reviewer wallet to approve or request changes."}
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      {queue.map((g) => (
        <GrantCard key={g.id} grant={g} wallet={wallet} nowSec={nowSec} onChange={onChange} />
      ))}
    </div>
  );
}
