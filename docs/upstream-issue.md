# Draft issue: vesting precompile address on PortaldotV3

**Not filed yet.** For the Portaldot testnet guide maintainers (github.com/ItsCogumellum/portaldot-v3-testnet-guide) or the Portaldot team on Discord.

---

**Title:** Vesting precompile answers at 0x…09020000, not 0x…0902

On PortaldotV3 testnet (chain ID 420420777), the vesting precompile responds at:

`0x0000000000000000000000000000000009020000`

The `IVesting.sol` interface shipped with polkadot-sdk declares `VESTING_ADDR = 0x0000000000000000000000000000000000000902`. On this testnet that address has no code and returns empty data, so a contract using the upstream constant silently gets nothing back.

**How to check** (read-only, no keys):

```
eth_call to 0x0000000000000000000000000000000009020000, data = vestingBalanceOf(address) → 32-byte result
eth_call to 0x0000000000000000000000000000000000000902, same data → "0x"
```

**Working example:** Vestry (`0x12d0691c7B756AA5205f24B678D68C74B885cda9`) pays grants through the precompile at the first address. A grantee later called `vest()` there, tx `0x4147764f9e1d87ba944c9c2ef7abb67359106d58401118a4d1aeb416d006f946`.

**Suggestion:** mention the correct address in the testnet guide's Solidity section, next to the Assets ERC-20 precompile layout (asset id in bytes 0-3, `0x0001` in bytes 16-17).
