# For other Portaldot builders

What we learned building on PortaldotV3 (chain 420420777), with code you can reuse. Everything here was read back from the testnet, not taken from upstream docs.

## Reusable: `contracts/lib/Portaldot.sol`

A small MIT library for Solidity contracts on pallet-revive:

```solidity
import { Portaldot } from "./lib/Portaldot.sol";

// Pay 10 POT from this contract as a native vesting lock released over 1,000 blocks.
Portaldot.vestedPay(grantee, msg.value, 1000);

// The ERC-20 address of native asset 2 (pallet-assets behind its precompile).
address token = Portaldot.assetToken(2); // 0x0000000200000000000000000000000000010000
```

It encodes:

| Fact | Value on PortaldotV3 |
|---|---|
| Vesting precompile | `0x0000000000000000000000000000000009020000` (upstream `IVesting.sol` says `0x…0902`, which is empty here) |
| Native asset as ERC-20 | asset id in bytes 0-3, `0x0001` in bytes 16-17 |
| Wei per planck | 10^4 (`msg.value` is 18-decimal; POT is 14) |
| Minimum vested transfer | 10 POT (1e15 planck); smaller ones revert |

`vestedPay` checks the minimum and planck alignment first, so you get a named error instead of a bare revert from the precompile. Tests: `test/Portaldot.test.js`.

## Things that cost us time

- **Storage deposits are large.** 0.06 POT per stored byte, 0.15 POT per item, plus a 30% lockup on code. A 5 KB contract holds about 430 POT up front. Compile with `viaIR` and `runs: 1`, pack structs into few slots, and keep text in events. That took us from 643 to 423 POT.
- **Every new storage slot is paid by the sender.** Users of your dApp pay a deposit on their first write (the up-front estimate for one Guestbook entry, two new slots, was about 7.8 POT), so fund test wallets accordingly.
- **Failing transactions are not included.** The node refuses a transaction that would revert, so it never gets a hash. Prove refusals with `eth_call` dry runs.
- **`eth_getLogs` may return logs out of order within a block.** Sort by block, then log index.
- **Vesting locks need `vest()`.** pallet-vesting keeps vested funds frozen until the owner (or anyone, via `vestOther`) calls it; balances look locked even after full vesting.
- **Native accounts of EVM wallets.** With autoMap on, an H160 maps to `H160 ++ 0xEE × 12` (SS58 prefix 42). Fund that address from a Portaldot wallet to give a MetaMask account gas.

## Proposed upstream fix

The official testnet guide's vesting interface points at `0x…0902`. A ready-to-file note is in `docs/upstream-issue.md`; we'll file it with the Portaldot team.
