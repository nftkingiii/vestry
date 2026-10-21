# Vestry

Milestone grants on Portaldot that pay out only when the work is reviewed and, if the funder asks for it, when the grantee's own contract shows real usage. Native POT tranches land as native vesting locks, not contract balances.

Built for Portaldot Hacker House 2026 (Ecosystem DApps track).

## Why

Ecosystem programs fund builders in tranches. Today that means a spreadsheet, a reviewer's message and a manual transfer: the funder cannot see what was approved, the grantee cannot see what is owed, and nothing stops a tranche being paid before the product is used. Portaldot's own post-hackathon support is described as unlocked by progress, on-chain activity and milestone review. Vestry makes those three conditions enforceable on chain.

## How it works

1. **Fund.** A funder escrows a grant split into milestones. Each milestone has an amount, a deadline, an optional vesting period and an optional activity target.
2. **Submit.** The grantee posts delivery evidence (a commit, a URL, a tx hash).
3. **Review.** Reviewers approve until the quorum is reached. Any reviewer can request changes, which voids that round's approvals.
4. **Gate.** If the milestone has an activity target, Vestry reads it straight from the grantee's contract (for example `entryCount()` on their live app). Below target, approvals are kept and the funds stay in escrow; anyone can trigger `release()` once the number is met.
5. **Pay.** Native POT is sent through Portaldot's vesting precompile, so the grantee receives a pallet-vesting schedule that unlocks block by block. Native `Assets` tokens are paid through their ERC-20 precompile.
6. **Reclaim.** After the deadline, an unreleased tranche returns to the funder.

## Architecture

```mermaid
flowchart LR
  F[Funder] -- createGrant + POT --> V[Vestry.sol<br/>pallet-revive]
  G[Grantee] -- submitMilestone --> V
  R[Reviewers] -- approve / requestChanges --> V
  V -- staticcall metric --> A[Grantee's contract<br/>e.g. Guestbook.entryCount]
  V -- vestedTransfer --> P[Vesting precompile<br/>0x…09020000]
  P --> VS[(pallet-vesting<br/>native lock on grantee)]
  V -- transfer --> E[ERC-20 precompile<br/>0x{assetId}…00010000]
  E --> AS[(pallet-assets)]
  V -- reclaim after deadline --> F
```

Solidity runs on Portaldot V3's `pallet-revive`. Vestry never holds a vesting schedule itself: the precompile writes a real `pallet-vesting` lock on the grantee's native account, which `scripts/readback.mjs` reads from the Substrate side.

## Portaldot integration

| Portaldot V3 feature | How Vestry uses it |
|---|---|
| `pallet-revive` (EVM-compatible execution) | Vestry, Guestbook and all grant logic, chain ID 420420777 |
| Vesting precompile (`pallet-vesting`) | Every native POT tranche becomes a native vesting schedule |
| Assets ERC-20 precompile (`pallet-assets`) | Grants can be denominated in a native asset |
| H160 ↔ AccountId32 mapping | Read-back resolves the grantee's native account with `reviveApi.accountId` |

### Findings for the Portaldot team

- On PortaldotV3 testnet the vesting precompile answers at `0x0000000000000000000000000000000009020000`. The constant in upstream `IVesting.sol` (`0x…0902`) returns empty data here.
- `minVestedTransfer` is `1e15` planck (10 tPOT), so smaller vested tranches revert.
- pallet-revive maps 1 planck to 10^4 wei, so native-POT milestone amounts must be multiples of 10^4 wei.

## Testnet deployment

PortaldotV3 testnet, chain ID 420420777, deployed 2026-10-21. There is no public block explorer yet; read these back over the EVM RPC (`eth_getTransactionReceipt`, `eth_getCode`).

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| Vestry | `0x12d0691c7B756AA5205f24B678D68C74B885cda9` | `0xc7c38b8fcfdf204fe825ea2437e9767b3d462c291f605e8b4103f18955cd118d` | 128768 |
| Guestbook (sample grantee app) | `0xc3Ee4B657FADAE473b22c692544e35223bFE9B42` | `0xc501d932533ecb7c5b25c854e287f0b495d80ece0d0a6fa3c85741c555931367` | 128769 |

On-chain code matches the compiled artifacts byte for byte. Details, gas and deposit costs are in [evidence/deployments.json](evidence/deployments.json).

Deploying held 423.4 tPOT for Vestry (5,253 bytes) and 49.8 tPOT for Guestbook (470 bytes) as storage deposits. The grant lifecycle run (`scripts/flow.js`) is pending more testnet tokens.

## Run it

Requirements: Node 20+.

```bash
npm install
npx hardhat test
```

Testnet (PortaldotV3, `https://test-evm-rpc-v3.portaldot.dev`, chain ID 420420777):

```bash
cp .env.example .env            # then fill DEPLOYER_KEY locally; never commit it
node scripts/actors.js          # creates throwaway grantee, reviewer and visitor keys in .env
npx hardhat run scripts/flow.js --network portaldot
node scripts/readback.mjs <grantee 0x address>
```

Web app (reads the deployed contracts straight from the RPC; wallet actions through MetaMask):

```bash
cd web
npm install
npm run dev                      # or: npm run build && npm start (serves dist and /health)
```

Tabs: **Grants** (where every grant's money is: paid, in escrow or returned, with a plain status for each milestone), **Review** (work waiting on your approval) and **Proof** (deployments, live chain state and the full event history). Without a wallet the app is read-only and says so. Grant, milestone and people names come from `web/src/labels.js`; the contract stores only addresses and amounts.

`scripts/deploy.js` deploys the contracts; the deployer's mapped native account needs about 500 tPOT because of Portaldot's storage deposits. Get its `5…` address from `node scripts/readback.mjs <deployer 0x address>`.

## Tests

`test/Vestry.test.js` covers quorum release to a vesting lock, unlocked payout, the activity gate, non-reviewer and double approvals, change requests voiding approvals, reclaim before and after the deadline, released/reclaimed conflicts, configuration validation and native-asset tranches. Hardhat has no pallet-vesting, so a mock is placed at the precompile address; the real lock is proven on testnet.

## Status

| Done | Next |
|---|---|
| Contract, tests, testnet deployment, native read-back | Full grant lifecycle on testnet (needs more tPOT for storage deposits) |
| Web app: Grants, Review, Evidence tabs reading live chain state | Public deployment of the web app |
| | Asset-denominated grant on testnet |
| | Reviewer sets backed by Portaldot multisig and on-chain identity |

## License

MIT
