// Reads the grantee's vesting lock from the native side (pallet-vesting storage), proving
// that a Solidity call produced a real native lock and not just contract bookkeeping.
// Usage: node scripts/readback.mjs <h160>
import { ApiPromise, WsProvider } from "@polkadot/api";
import { encodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, u8aConcat } from "@polkadot/util";

const h160 = process.argv[2];
if (!h160) throw new Error("usage: node scripts/readback.mjs <h160>");
const api = await ApiPromise.create({ provider: new WsProvider(process.env.PORTALDOT_WS || "wss://test-node-v3.portaldot.dev"), noInitWarn: true });
const account = await api.call.reviveApi.accountId(h160);
const fallback = encodeAddress(u8aConcat(hexToU8a(h160), new Uint8Array(12).fill(0xee)), 42);
const [vesting, info, head] = await Promise.all([api.query.vesting.vesting(account), api.query.system.account(account), api.rpc.chain.getHeader()]);
console.log(
  JSON.stringify(
    {
      h160,
      nativeAccount: encodeAddress(account, 42),
      matchesFallbackMapping: encodeAddress(account, 42) === fallback,
      block: head.number.toNumber(),
      free: info.data.free.toString(),
      frozen: info.data.frozen.toString(),
      vestingSchedules: vesting.isSome ? vesting.unwrap().map((s) => s.toJSON()) : [],
    },
    null,
    2
  )
);
await api.disconnect();
