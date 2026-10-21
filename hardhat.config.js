require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    portaldot: {
      url: process.env.PORTALDOT_RPC || "https://test-evm-rpc-v3.portaldot.dev",
      chainId: 420420777,
      accounts,
    },
  },
};
