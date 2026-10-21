import { useCallback, useEffect, useRef, useState } from "react";
import { CHAIN, formatPot, loadGrants, mappedSs58, short } from "./chain.js";
import { useWallet } from "./wallet.js";
import { CreateGrant, GrantCard } from "./Grants.jsx";
import { Review } from "./Review.jsx";
import { Evidence } from "./Evidence.jsx";
import { Hash } from "./ui.jsx";

const TABS = [
  { id: "grants", label: "Grants" },
  { id: "review", label: "Review" },
  { id: "evidence", label: "Evidence" },
];

/// Exactly one next step for the wallet, or nothing once it is ready.
function NextStep({ wallet }) {
  if (wallet.status === "ready") return null;
  // Built lazily: the unfunded step needs an account, which the other states lack.
  const steps = {
    none: () => ({ text: "Read-only. Install MetaMask or another EVM wallet to fund, submit or review.", action: null }),
    disconnected: () => ({ text: "Read-only. Connect a wallet to fund, submit or review.", action: ["Connect wallet", wallet.connect] }),
    "wrong-network": () => ({ text: `Your wallet is on another network. Vestry runs on ${CHAIN.name}.`, action: ["Switch network", wallet.switchNetwork] }),
    unfunded: () => ({
      text: (
        <>
          This wallet has no tPOT. Send test POT to its native account <Hash value={mappedSs58(wallet.account)} /> from a Portaldot wallet, then refresh.
        </>
      ),
      action: ["Refresh balance", wallet.refresh],
    }),
  };
  const step = steps[wallet.status]();
  return (
    <div className="nextstep" role="status">
      <span>{step.text}</span>
      {step.action && (
        <button className="btn btn-primary" onClick={step.action[1]}>
          {step.action[0]}
        </button>
      )}
      {wallet.error && <span className="error">{wallet.error}</span>}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem("vestry.tab") || "grants";
    } catch {
      return "grants";
    }
  });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const wallet = useWallet();
  const tabRefs = useRef({});

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      setData(await loadGrants());
      setNowSec(Math.floor(Date.now() / 1000));
      wallet.refresh();
    } catch (e) {
      setLoadError(e.shortMessage || e.message);
    }
  }, [wallet.refresh]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  function select(id) {
    setTab(id);
    try {
      localStorage.setItem("vestry.tab", id);
    } catch {
      /* storage unavailable */
    }
  }

  function onTabKey(e, i) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    const next = TABS[(i + dir + TABS.length) % TABS.length].id;
    select(next);
    tabRefs.current[next]?.focus();
  }

  const pending = data?.grants.reduce((n, g) => n + g.milestones.filter((m) => m.state === "Submitted").length, 0) || 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">V</span>
          <span className="wordmark">Vestry</span>
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => (tabRefs.current[t.id] = el)}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => select(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
              {t.id === "review" && pending > 0 && <span className="count tabular">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="wallet">
          {wallet.status === "ready" || wallet.status === "unfunded" ? (
            <span className="wallet-chip">
              <span className="mono">{short(wallet.account)}</span>
              <span className="tabular">{formatPot(wallet.balance)} tPOT</span>
            </span>
          ) : wallet.status === "disconnected" ? (
            <button className="btn" onClick={wallet.connect}>Connect wallet</button>
          ) : null}
        </div>
      </header>

      <NextStep wallet={wallet} />

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="main">
        {tab === "grants" && (
          <>
            <section className="intro">
              <h1>Grants that pay when the work ships</h1>
              <p>
                Each milestone stays in escrow until reviewers approve it and, if you ask for it, until the grantee's own contract shows real use. Native POT tranches land
                as Portaldot vesting locks.
              </p>
              {wallet.status === "ready" && (
                <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
                  {showCreate ? "Close" : "Fund a grant"}
                </button>
              )}
            </section>
            {showCreate && wallet.status === "ready" && <CreateGrant wallet={wallet} onChange={reload} />}
            {loadError && <p className="error" role="alert">Couldn't read Vestry: {loadError}</p>}
            {!data && !loadError && <p className="muted">Reading the chain…</p>}
            {data && data.grants.length === 0 && (
              <div className="empty">
                <h3>No grants on chain yet</h3>
                <p className="muted">Vestry is deployed and waiting for its first funded grant. Everything shown here is read live from {CHAIN.name}.</p>
              </div>
            )}
            <div className="stack">
              {data?.grants
                .slice()
                .reverse()
                .map((g) => <GrantCard key={g.id} grant={g} wallet={wallet} nowSec={nowSec} onChange={reload} />)}
            </div>
          </>
        )}
        {tab === "review" && <Review data={data} wallet={wallet} nowSec={nowSec} onChange={reload} />}
        {tab === "evidence" && <Evidence head={data?.head} />}
      </main>

      <footer className="footer muted">
        <span>{CHAIN.name} · chain {CHAIN.id}</span>
        <span>Build {__REVISION__}</span>
        <a href="https://github.com/nftkingiii/vestry">Source</a>
      </footer>
    </div>
  );
}
