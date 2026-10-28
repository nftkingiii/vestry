# Vestry security review

Scope: `contracts/Vestry.sol` as deployed on PortaldotV3 testnet at `0x12d0691c7B756AA5205f24B678D68C74B885cda9` (source unchanged since deployment; the check-in review rebuilt it byte-identical). Internal review by the builder, October 2026. This is not an external audit.

Each point below is pinned by a test in `test/Vestry.security.test.js` or `test/Vestry.test.js`.

## Money flow

| Path | Who can call | Guard |
|---|---|---|
| `createGrant` | anyone (becomes funder) | escrow must equal the sum of milestones exactly; at least one reviewer; threshold within reviewers; no zero grantee; amounts aligned to whole planck |
| `release` / quorum `approveMilestone` | reviewers (approve), anyone (release) | milestone must be Submitted, quorum reached, before deadline, usage target met |
| `reclaim` | funder only | strictly after the deadline; never on Released or Reclaimed |

Native POT leaves the contract in only two ways: a vesting lock or transfer to the grantee on release, or a transfer back to the funder on reclaim. Each milestone can do one of these once.

## Checked properties

- **Reentrancy.** A grantee contract that calls `release` again from inside its payment cannot double-collect. State moves to Released before any transfer (checks-effects-interactions). Test: *stops a grantee contract from re-entering release*.
- **Failed payout.** If the grantee refuses the payment, the whole approval transaction reverts. The milestone stays Submitted, nothing is paid, and the funder can reclaim after the deadline. Test: *rolls back cleanly when the grantee refuses payment*.
- **Deadline edges.** The deadline second is still open for submit and approve. Reclaim opens strictly after it, so there is no second where both a payout and a reclaim are possible. Tests: *treats the deadline second as still open*, *blocks reclaim at exactly the deadline*.
- **Accounting.** After any mix of paid, reclaimed and pending milestones, the contract holds exactly the pending escrow. Test: *holds exactly the unpaid escrow after mixed outcomes*.
- **Stale approvals.** A change request bumps the round, so approvals from before it never count. Test: *voids earlier approvals when a reviewer requests changes*.
- **Access.** Only reviewers approve or request changes, only the grantee submits, only the funder reclaims. Out-of-range milestone indexes revert.

## Known limitations

1. **An unreadable usage metric blocks payout until the deadline.** If the metric target contract reverts or returns nothing, the approval that would reach quorum reverts with `MetricUnreadable`. No funds are stuck: the funder reclaims after the deadline (test: *LIMITATION: an unreadable usage metric…*). A funder should point the gate only at a contract and view function they have checked. The app could warn before funding; that is on the roadmap.
2. **The usage metric is whatever the target contract reports.** Vestry reads it without an oracle, which is the point, but a grantee who controls the target contract could inflate the counter. The Guestbook counts distinct addresses, which is cheap to fake with new wallets. Funders should choose metrics that cost something to fake (fees paid, volume, unique holders above a balance), or keep a reviewer quorum that checks the evidence too.
3. **Reviewers are trusted for judgement.** A quorum can approve weak work. Reviewer sets backed by Portaldot multisig and on-chain identity are planned.
4. **No pause or upgrade.** The contract has no admin, so nobody can freeze or redirect escrow. Bugs need a new deployment, and running grants finish on the old one.
5. **A vested milestone under 10 POT can be funded but never paid.** The contract does not enforce pallet-vesting's minimum at creation, so its payout reverts in the precompile. Funds are not lost: the funder reclaims after the deadline. The web app blocks such milestones; `Portaldot.vestedPay` in `contracts/lib/Portaldot.sol` checks the minimum up front, and the next Vestry deployment should use it.
6. **Native-asset grants rely on the asset's own admin.** A pallet-assets admin can freeze accounts. A frozen grantee would make an asset payout fail, and the funder reclaims after the deadline.

## Portaldot-specific notes

- The vesting precompile lives at `0x0000000000000000000000000000000009020000` on PortaldotV3, not the `0x…0902` in upstream `IVesting.sol`. A contract using the upstream constant would call an empty address and receive nothing, without reverting. `contracts/lib/Portaldot.sol` pins the verified address.
- pallet-vesting's minimum vested transfer is 10 POT, and amounts must be whole planck (10^4 wei). Vestry checks planck alignment when a grant is created. It does not check the 10 POT minimum (see limitation 5); the web app refuses such milestones before funding.
- Storage deposits are charged to whoever writes new storage, including reviewers on their first approval. The app shows the up-front cost before every transaction.
