import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { CHAIN, readProvider } from "./chain.js";

/// One wallet state at a time: none → disconnected → wrong-network → unfunded → ready.
export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;

  const refresh = useCallback(async () => {
    if (!hasWallet) return;
    const [accounts, cid] = await Promise.all([
      window.ethereum.request({ method: "eth_accounts" }),
      window.ethereum.request({ method: "eth_chainId" }),
    ]);
    const a = accounts[0] ? ethers.getAddress(accounts[0]) : null;
    setAccount(a);
    setChainId(parseInt(cid, 16));
    setBalance(a ? await readProvider.getBalance(a).catch(() => null) : null);
  }, [hasWallet]);

  useEffect(() => {
    if (!hasWallet) return;
    refresh();
    const onChange = () => refresh();
    window.ethereum.on?.("accountsChanged", onChange);
    window.ethereum.on?.("chainChanged", onChange);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onChange);
      window.ethereum.removeListener?.("chainChanged", onChange);
    };
  }, [hasWallet, refresh]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refresh();
    } catch (e) {
      setError(e?.code === 4001 ? "Connection request was rejected." : e?.message);
    }
  }, [refresh]);

  const switchNetwork = useCallback(async () => {
    setError(null);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hexId }] });
    } catch (e) {
      if (e?.code === 4902 || /Unrecognized chain/i.test(e?.message || "")) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: CHAIN.hexId, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: "Test POT", symbol: CHAIN.symbol, decimals: 18 } }],
        });
      } else {
        setError(e?.code === 4001 ? "Network switch was rejected." : e?.message);
      }
    }
    await refresh();
  }, [refresh]);

  let status = "none";
  if (hasWallet) {
    if (!account) status = "disconnected";
    else if (chainId !== CHAIN.id) status = "wrong-network";
    else if (balance !== null && balance === 0n) status = "unfunded";
    else status = "ready";
  }

  const signer = useCallback(async () => new ethers.BrowserProvider(window.ethereum).getSigner(), []);

  return { status, account, balance, error, connect, switchNetwork, refresh, signer };
}
