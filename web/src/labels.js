// Human names for on-chain grants, milestones and addresses. The contract stores none of
// these (names would cost storage deposit), so they are this app's labels, not chain data.
// Grants without an entry fall back to "Grant N" / "Milestone N".

export const GRANT_LABELS = {
  0: {
    title: "Guestbook grant",
    milestones: [
      { title: "Deploy the Guestbook" },
      { title: "Get two real users", metric: "people signed the Guestbook" },
    ],
  },
  1: {
    title: "Pilot grant",
    milestones: [{ title: "Pilot launch" }],
  },
};

export const ADDRESS_LABELS = {
  "0x13f3b0c9c83ffdba37fe0b3efa41e625651e9ddb": "Foundation (demo funder)",
  "0x816cc56de60be882c1bfd882abd1a5500682dc60": "Guestbook team",
  "0x8408bcaf43be674a6a4b4bbd417342a89bbb5b16": "Reviewer 1",
  "0xd45e54acb843a5729d792ca6c5fc719c66784f7f": "Reviewer 2",
  "0x701e3a618ee6099b16e6a9bf55c79173fea2d733": "Visitor 1",
  "0x2390d4f66f6c73bc98bd4c96b9a0f501c7c4174d": "Visitor 2",
};

export function grantTitle(id) {
  return GRANT_LABELS[id]?.title || `Grant ${id + 1}`;
}

export function milestoneLabel(grantId, index) {
  const m = GRANT_LABELS[grantId]?.milestones?.[index];
  return { title: m?.title || `Milestone ${index + 1}`, metric: m?.metric || null };
}

export function nameOf(address) {
  return address ? ADDRESS_LABELS[address.toLowerCase()] || null : null;
}
