// Deploys Vestry and Guestbook to PortaldotV3 testnet and records addresses, tx hashes,
// gas, and the deployer balance before and after (storage deposits are held, not burned).
// Usage: npx hardhat run scripts/deploy.js --network portaldot
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const OUT = path.join(__dirname, "..", "evidence", "deployments.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const p = ethers.provider;
  const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { network: "PortaldotV3 testnet", chainId: 420420777, contracts: {} };
  record.deployer = deployer.address;

  for (const name of ["Vestry", "Guestbook"]) {
    if (record.contracts[name]?.address && (await p.getCode(record.contracts[name].address)) !== "0x") {
      console.log(`${name} already deployed at ${record.contracts[name].address}`);
      continue;
    }
    const before = await p.getBalance(deployer.address);
    const contract = await (await ethers.getContractFactory(name, deployer)).deploy();
    const receipt = await contract.deploymentTransaction().wait();
    const after = await p.getBalance(deployer.address);
    const address = await contract.getAddress();
    record.contracts[name] = {
      address,
      deployTx: receipt.hash,
      block: receipt.blockNumber,
      status: receipt.status === 1 ? "success" : "failed",
      runtimeBytes: ((await p.getCode(address)).length - 2) / 2,
      gasUsed: receipt.gasUsed.toString(),
      tPotSpent: ethers.formatEther(before - after),
      deployedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
    console.log(`${name} ${address} tx ${receipt.hash} block ${receipt.blockNumber} spent ${record.contracts[name].tPotSpent} tPOT`);
  }
  console.log("deployer balance left", ethers.formatEther(await p.getBalance(deployer.address)), "tPOT");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
