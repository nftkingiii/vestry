import { useState } from "react";
import { ethers } from "ethers";
import { explainError, readProvider, short } from "./chain.js";

export function Hash({ value, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="hash"
      title={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {label && <span className="hash-label">{label}</span>}
      <span className="mono">{copied ? "Copied" : short(value, 6)}</span>
    </button>
  );
}

export function Pill({ tone = "neutral", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/// Sends one contract call with honest states: estimating → awaiting wallet → pending → done/failed.
/// The estimate is shown in tPOT because Portaldot folds the storage deposit into gas.
export function useTx(onDone) {
  const [state, setState] = useState({ phase: "idle" });
  async function run(build) {
    setState({ phase: "estimating" });
    try {
      const { contract, method, args = [], value } = await build();
      const overrides = value ? { value } : {};
      const gas = await contract[method].estimateGas(...args, overrides);
      const price = BigInt(await readProvider.send("eth_gasPrice", []));
      setState({ phase: "wallet", cost: gas * price });
      const tx = await contract[method](...args, { ...overrides, gasLimit: (gas * 12n) / 10n });
      setState({ phase: "pending", hash: tx.hash, cost: gas * price });
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error("Transaction reverted");
      setState({ phase: "done", hash: tx.hash });
      onDone?.();
    } catch (e) {
      setState((s) => ({ phase: "failed", hash: s.hash, message: explainError(e) }));
    }
  }
  return { state, run, reset: () => setState({ phase: "idle" }) };
}

export function TxStatus({ state }) {
  if (state.phase === "idle") return null;
  const cost = state.cost !== undefined ? `Up to ${Number(ethers.formatEther(state.cost)).toFixed(2)} tPOT incl. storage deposit` : null;
  const text = {
    estimating: "Checking the call on chain…",
    wallet: "Confirm in your wallet.",
    pending: "Waiting for the block…",
    done: "Confirmed on chain.",
    failed: state.message,
  }[state.phase];
  const tone = state.phase === "done" ? "ok" : state.phase === "failed" ? "bad" : "busy";
  return (
    <div className={`txstatus txstatus-${tone}`} role="status" aria-live="polite">
      <span>{text}</span>
      {cost && state.phase !== "done" && state.phase !== "failed" && <span className="muted">{cost}</span>}
      <Hash value={state.hash} label="tx" />
    </div>
  );
}
