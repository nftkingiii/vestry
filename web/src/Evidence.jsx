import { useEffect, useState } from "react";
import { CHAIN, DEPLOYMENTS, VESTING_PRECOMPILE, guestbookRead, loadActivity, readProvider, vestryRead } from "./chain.js";
import { Hash, Pill } from "./ui.jsx";
import { grantTitle, milestoneLabel } from "./labels.js";

const g = (a) => grantTitle(Number(a.grantId));
const ms = (a) => `${g(a)} · ${milestoneLabel(Number(a.grantId), Number(a.index)).title}`;
const EVENT_TEXT = {
  GrantCreated: (a) => `${g(a)} funded`,
  MilestoneSubmitted: (a) => `${ms(a)}: work submitted`,
  MilestoneApproved: (a) => `${ms(a)}: approval ${a.approvals}`,
  ChangesRequested: (a) => `${ms(a)}: changes requested`,
  AwaitingMetric: (a) => `${ms(a)}: approved, held until usage target`,
  MilestoneReleased: (a) => `${ms(a)}: paid${Number(a.vestingBlocks) ? " as a vesting lock" : ""}`,
  MilestoneReclaimed: (a) => `${ms(a)}: returned to funder`,
};

export function Evidence({ head }) {
  const [live, setLive] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const codes = await Promise.all(DEPLOYMENTS.map((d) => readProvider.getCode(d.address)));
        const [grantCount, entries] = await Promise.all([vestryRead.grantCount(), guestbookRead.entryCount()]);
        const events = await loadActivity();
        if (cancelled) return;
        setLive({ codes: codes.map((c) => (c.length - 2) / 2), grantCount: Number(grantCount), entries: Number(entries) });
        setActivity(events);
      } catch (e) {
        if (!cancelled) setError(e.shortMessage || e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [head]);

  return (
    <div className="stack">
      <section className="panel">
        <h3>Deployed on {CHAIN.name}</h3>
        <p className="muted">
          Chain ID {CHAIN.id}. Portaldot has no public block explorer yet, so every value below is read live from <span className="mono">{CHAIN.rpc}</span>.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Address</th>
              <th>Deploy tx</th>
              <th className="num">Block</th>
              <th className="num">Code on chain</th>
              <th className="num">Deposit held</th>
            </tr>
          </thead>
          <tbody>
            {DEPLOYMENTS.map((d, i) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td><Hash value={d.address} /></td>
                <td><Hash value={d.tx} /></td>
                <td className="num tabular">{d.block.toLocaleString()}</td>
                <td className="num tabular">{live ? (live.codes[i] > 0 ? `${live.codes[i].toLocaleString()} bytes` : <Pill tone="bad">missing</Pill>) : "…"}</td>
                <td className="num tabular">{d.deposit} tPOT</td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="error" role="alert">Couldn't read the chain: {error}</p>}
      </section>

      <section className="panel">
        <h3>Live state</h3>
        <dl className="facts">
          <div><dt>Latest block</dt><dd className="tabular">{head ? head.toLocaleString() : "…"}</dd></div>
          <div><dt>Grants on Vestry</dt><dd className="tabular">{live ? live.grantCount : "…"}</dd></div>
          <div><dt>Guestbook users</dt><dd className="tabular">{live ? live.entries : "…"}</dd></div>
          <div><dt>Vesting precompile</dt><dd><Hash value={VESTING_PRECOMPILE} /></dd></div>
        </dl>
      </section>

      <section className="panel">
        <h3>Contract activity</h3>
        {!activity ? (
          <p className="muted">Reading events…</p>
        ) : activity.length === 0 ? (
          <p className="muted">No grant activity yet. The first funded grant will appear here with its transaction.</p>
        ) : (
          <ol className="log">
            {activity.map((e, i) => (
              <li key={`${e.tx}-${i}`}>
                <span>{EVENT_TEXT[e.name]?.(e.args) || e.name}</span>
                <span className="muted tabular">block {e.block.toLocaleString()}</span>
                <Hash value={e.tx} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <h3>Notes for Portaldot builders</h3>
        <ul className="notes">
          <li>The vesting precompile answers at <span className="mono">0x…09020000</span>. The constant in upstream <span className="mono">IVesting.sol</span> (<span className="mono">0x…0902</span>) returns empty data on this testnet.</li>
          <li>Storage deposits are 0.06 tPOT per byte and 0.15 tPOT per item, so a 5 KB contract holds about 430 tPOT. Vestry packs each milestone into two storage slots and keeps evidence text in events.</li>
          <li>Vested tranches must be at least 10 tPOT, Portaldot's minimum vested transfer.</li>
          <li>Grant, milestone and people names are labels kept by this app. The contract stores only addresses and amounts.</li>
        </ul>
      </section>
    </div>
  );
}
