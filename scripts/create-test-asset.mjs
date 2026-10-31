// One-off setup for an Assets-token grant on PortaldotV3 testnet, run by a person with a native (sr25519) wallet.
// Creates a test asset owned by that wallet, mints it to the Vestry deployer's mapped native account, and sends
// the deployer tPOT for storage deposits, all in one utility.batchAll. The recovery phrase is read from a file and
// never printed.
//   node create-test-asset.mjs <recovery-phrase-file> <expected-ss58-address>
import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { readFileSync } from "node:fs";

const [phraseFile, expected] = process.argv.slice(2);
if (!phraseFile || !expected) throw new Error("usage: node create-test-asset.mjs <recovery-phrase-file> <expected-ss58-address>");

const ASSET_ID = 77170291;                 // unused id, checked below
const DEPLOYER = "5CWsA8QwM1NBtaXeSggPP8cbLUmkj23HGf886723toVKMPmR"; // native account of 0x13f3…9ddb
const DECIMALS = 6;
const MINT = 1000n * 10n ** BigInt(DECIMALS); // 1,000 vUSD
const TPOT_FOR_DEPOSITS = 40n * 10n ** 14n;    // 40 tPOT

const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
const me = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(readFileSync(phraseFile, "utf8").trim());
if (me.address !== expected) { console.log("Phrase does not match the expected address, stopping."); process.exit(1); }
if ((await api.query.assets.asset(ASSET_ID)).isSome) { console.log(`Asset ${ASSET_ID} already exists, stopping.`); process.exit(1); }

const calls = [
  api.tx.assets.create(ASSET_ID, me.address, 1),
  api.tx.assets.setMetadata(ASSET_ID, "Vestry Test Dollar", "vUSD", DECIMALS),
  api.tx.assets.mint(ASSET_ID, DEPLOYER, MINT),
  api.tx.balances.transferKeepAlive(DEPLOYER, TPOT_FOR_DEPOSITS),
];
console.log(`Creating asset ${ASSET_ID} (vUSD), minting 1,000 vUSD to ${DEPLOYER}, sending 40 tPOT to it...`);
const unsub = await api.tx.utility.batchAll(calls).signAndSend(me, ({ status, dispatchError, events, txHash }) => {
  if (dispatchError) {
    const d = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
    console.log("Failed:", d ? `${d.section}.${d.name}` : dispatchError.toString());
    process.exit(1);
  }
  if (status.isInBlock) {
    const ok = events.some(({ event }) => api.events.utility.BatchCompleted.is(event));
    console.log(`${ok ? "Done" : "Included, check events"}. Tx hash: ${txHash.toHex()} in block ${status.asInBlock.toHex()}`);
    unsub(); api.disconnect();
  }
});
