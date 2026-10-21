import { useCallback, useEffect, useRef, useState } from "react";
import { CHAIN, formatPot, loadGrants, mappedSs58, short } from "./chain.js";
import { grantTitle, milestoneLabel, nameOf } from "./labels.js";
import { todos, totals } from "./status.js";
import { useWallet } from "./wallet.js";
import { CreateGrant, GrantCard } from "./Grants.jsx";
import { Review } from "./Review.jsx";
import { Evidence } from "./Evidence.jsx";
import { Hash } from "./ui.jsx";

const TABS = [
  { id: "grants", label: "Grants" },
  { id: "review", label: "Review" },
  { id: "proof", label: "Proof" },
];

/// Exactly one next step for the wallet, or nothing once it is ready.
function WalletStep({ wallet }) {
  if (wallet.status === "ready") return null;
  // Built lazily: the unfunded step needs an account, which the other states lack.
  const steps = {
    none: () => ({ text: "You're viewing read-only. Install MetaMask or another EVM wallet to fund, submit or review.", action: null }),
    disconnected: () => ({ text: "You're viewing read-only. Connect a wallet to fund, submit or review.", action: ["Connect wallet", wallet.connect] }),
    "wrong-network": () => ({ text: `Your wallet is on another network. Vestry runs on ${CHAIN.name}.`, action: ["Switch network", wallet.switchNetwork] }),
    unfunded: () => ({
      text: (
        <>
          This wallet has no tPOT. Send test POT to its Portaldot account <Hash value={mappedSs58(wallet.account)} />, then refresh.
        </>
      ),
      action: ["Refresh balance", wallet.refresh],
    }),
  };
  const step = steps[wallet.status]();
  return (
    <div className="notice" role="status">
      <p>{step.text}</p>
      {step.action && (
        <button className="btn" onClick={step.action[1]}>
          {step.action[0]}
        </button>
      )}
      {wallet.error && <span className="error">{wallet.error}</span>}
    </div>
  );
}

const TODO_TEXT = {
  review: (t) => `${milestoneLabel(t.grant.id, t.m.index).title} is waiting for your approval.`,
  submit: (t) => `${milestoneLabel(t.grant.id, t.m.index).title} is waiting for you to submit your work.`,
  reclaim: (t) => `${milestoneLabel(t.grant.id, t.m.index).title} passed its deadline unpaid. You can take the ${formatPot(t.m.amount)} tPOT back.`,
};

function NeedsYou({ items, onGo }) {
  if (!items.length) return null;
  const first = items[0];
  return (
    <div className="needs" role="status">
      <span className="needs-dot" aria-hidden="true" />
      <p>
        <b>{grantTitle(first.grant.id)}</b> · {TODO_TEXT[first.kind](first)}
        {items.length > 1 && <span className="muted"> And {items.length - 1} more.</span>}
      </p>
      <button className="btn btn-you" onClick={() => onGo(first)}>
        {first.kind === "review" ? "Review" : first.kind === "submit" ? "Submit work" : "Take it back"}
      </button>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem("vestry.tab");
      return TABS.some((t) => t.id === saved) ? saved : "grants";
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

  function goTo(todo) {
    select(todo.kind === "review" ? "review" : "grants");
    setTimeout(() => document.getElementById(`grant-${todo.grant.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const grants = data?.grants || [];
  const sum = totals(grants);
  const mine = wallet.status === "ready" ? todos(grants, wallet.account, nowSec) : [];
  const reviewCount = grants.reduce((n, g) => n + g.milestones.filter((m) => m.state === "Submitted" && nowSec <= m.deadline).length, 0);
  const walletName = nameOf(wallet.account);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">Vestry</div>
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
              {t.id === "review" && reviewCount > 0 && <span className="count tabular">{reviewCount}</span>}
            </button>
          ))}
        </nav>
        <div className="wallet">
          {wallet.status === "ready" || wallet.status === "unfunded" ? (
            <span className="wallet-chip" title={wallet.account}>
              {walletName || short(wallet.account)}
              <span className="tabular">{formatPot(wallet.balance)} tPOT</span>
            </span>
          ) : wallet.status === "disconnected" ? (
            <button className="btn" onClick={wallet.connect}>Connect wallet</button>
          ) : (
            <span className="wallet-chip muted">Read-only</span>
          )}
        </div>
      </header>

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab !== "proof" && (
          <section className="totals" aria-label="Across all grants">
            <div className="total total-paid">
              <b className="tabular">{data ? formatPot(sum.paid) : "–"}</b>
              <span>tPOT paid to grantees</span>
            </div>
            <div className="total total-escrow">
              <b className="tabular">{data ? formatPot(sum.escrow) : "–"}</b>
              <span>tPOT waiting in escrow</span>
            </div>
            <div className="total total-back">
              <b className="tabular">{data ? formatPot(sum.returned) : "–"}</b>
              <span>tPOT returned to funders</span>
            </div>
          </section>
        )}

        <WalletStep wallet={wallet} />
        {tab !== "proof" && <NeedsYou items={mine} onGo={goTo} />}
        {loadError && <p className="error" role="alert">Couldn't read Vestry on {CHAIN.name}: {loadError}</p>}

        {tab === "grants" && (
          <>
            <div className="section-head">
              <h2>Grants</h2>
              {wallet.status === "ready" && (
                <button className="btn" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
                  {showCreate ? "Close" : "Fund a grant"}
                </button>
              )}
            </div>
            {showCreate && wallet.status === "ready" && <CreateGrant wallet={wallet} onChange={reload} />}
            {!data && !loadError && <p className="muted">Reading the chain…</p>}
            {data && grants.length === 0 && (
              <div className="empty">
                <h3>No grants yet</h3>
                <p className="muted">The first funded grant will appear here, read live from {CHAIN.name}.</p>
              </div>
            )}
            <div className="stack">
              {grants
                .slice()
                .reverse()
                .map((g) => (
                  <GrantCard key={g.id} grant={g} wallet={wallet} nowSec={nowSec} head={data.head} onChange={reload} />
                ))}
            </div>
          </>
        )}
        {tab === "review" && (
          <>
            <div className="section-head">
              <h2>Waiting for review</h2>
            </div>
            <Review data={data} wallet={wallet} nowSec={nowSec} onChange={reload} />
          </>
        )}
        {tab === "proof" && <Evidence head={data?.head} />}
      </main>

      <footer className="footer">
        <span>
          Live on {CHAIN.name} · chain {CHAIN.id}
        </span>
        <span>Build {__REVISION__}</span>
        <a href="https://github.com/nftkingiii/vestry">Source</a>
      </footer>
    </div>
  );
}
