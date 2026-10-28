const hre = require("hardhat");

async function main() {
  console.log(`Starting deployment to ${hre.network.name}...`);

  // Ethers v6 deployment pattern
  // EduChain requires a relayer address (trustedForwarder) in constructor.
  // For L2 deployment demo, we'll use a dummy address if not specified.
  const relayerAddress = process.env.RELAYER_ADDRESS || "0x1234567890123456789012345678901234567890";
  console.log(`Using relayer address: ${relayerAddress}`);

  const EduChain = await hre.ethers.getContractFactory("EduChain");
  const educhain = await EduChain.deploy(relayerAddress);

  await educhain.waitForDeployment();

  const contractAddress = await educhain.getAddress();
  console.log(`EduChain deployed successfully to: ${contractAddress}`);
  console.log(`Network: ${hre.network.name}`);
  console.log("Deployment completed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
