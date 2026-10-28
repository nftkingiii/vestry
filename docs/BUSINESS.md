# Vestry: usage-vested payouts on Portaldot

## One line

Vestry pays money out only when work is approved **and** on-chain usage proves it shipped, and it pays as a native Portaldot vesting lock.

## The idea, sharpened

Most programs that fund builders pay on promises. A grant pays on a reviewer's message. An incentive pays on a pitch deck. Both pay before anyone can see whether the thing is used.

Vestry's new piece is the **usage gate**: a payout condition read straight from the funded project's own contract, with no oracle and no reporting step. "Pay 10 POT once the app has two real users" is checked by the chain at the moment of payment. Combined with a reviewer quorum and native vesting, that makes three guarantees no spreadsheet process gives:

1. **Approved** — a named quorum signed off on the evidence.
2. **Used** — the project's own contract shows the agreed activity.
3. **Kept aligned** — the money vests block by block in Portaldot's own module, visible in any wallet.

## Who pays, for what

| Buyer | Job | Today | With Vestry |
|---|---|---|---|
| Ecosystem foundations (first: Portaldot's own post-hackathon builder support) | Fund teams in tranches without paying for unused products | Spreadsheets, manual transfers, trust | Milestones that pay on approval plus usage, with a public evidence trail |
| Incentive programs (user growth, liquidity, gas rebates) | Reward dApps for real activity | Snapshots and manual payouts after the fact | The reward vests as the dApp's own metric is met |
| Hackathon and bounty hosts | Pay winners in stages after the event | One lump sum, or follow-ups that fade | Prize tranches tied to shipping after demo day |

Portaldot's event page describes its builder support as unlocking on progress, product readiness, on-chain activity and milestone review. That is the same rule Vestry runs on chain, which makes the Foundation the natural first customer.

## How it makes money (plan)

- **Program fee:** a small share of each released tranche (planned: 1%), paid by the funder at release, only when value actually moves. No fee on reclaimed money.
- **Hosted programs:** for foundations that want a managed review desk, setup and reporting (planned flat fee per program).
- The contract stays open source (MIT). The fee would sit in a program-level wrapper, so the base escrow remains free to use.

These are proposals. No pricing has been tested with a buyer yet.

## Path to adoption

1. **Now (testnet):** working contract, live app, full lifecycle evidence, the UI-driven run, and a reusable precompile library for other teams.
2. **Next 30 days:** run a real pilot. Offer Vestry to Hacker House teams for their post-event milestones, and ask the Foundation to route one support tranche through it.
3. **Mainnet:** deploy with the 10 POT minimum and metric checks built in (see `docs/SECURITY.md`), add reviewer councils on Portaldot multisig and identity, and add native Assets-token programs.
4. **Expansion:** templates for incentive programs (metric presets such as unique users, fees paid, volume), and an evidence export for funder reporting.

## Why this grows the Portaldot ecosystem

- Every payout uses native modules (vesting, assets, later multisig and identity), so program volume becomes native-module activity.
- Funders can see that money goes to products people use, which makes it easier to fund the next team.
- The precompile library and the findings in `docs/ECOSYSTEM.md` save other teams the debugging we did.

## Evidence status

| Claim | Status |
|---|---|
| Contract, app, testnet lifecycle, vest() release | Built and verified on testnet |
| UI-driven grant (every step clicked in the live app) | See `evidence/ui-run.json` |
| Pricing, buyers, pilot | Planned; not yet validated with a paying customer |
