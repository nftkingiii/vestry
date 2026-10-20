// Creates throwaway testnet keys for the demo actors and appends them to .env.
// Keys never leave the machine; only addresses are printed.
const fs = require("fs");
const { Wallet } = require("ethers");

const names = ["GRANTEE", "REVIEWER_1", "REVIEWER_2", "VISITOR_1", "VISITOR_2"];
const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
let added = "";
for (const name of names) {
  if (env.includes(`${name}_KEY=`)) continue;
  const w = Wallet.createRandom();
  added += `${name}_KEY=${w.privateKey}\n${name}_ADDRESS=${w.address}\n`;
}
if (added) fs.appendFileSync(".env", added, { mode: 0o600 });
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  if (line.includes("_ADDRESS=")) console.log(line);
}
