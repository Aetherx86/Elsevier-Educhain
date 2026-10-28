const hre = require("hardhat");
const fs = require("fs");

async function main() {
  // 1. Forwarder(Paymaster 역할의 신뢰된 릴레이 계약) 먼저 배포
  const Forwarder = await hre.ethers.getContractFactory("EduChainForwarder");
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();
  console.log(`EduChainForwarder deployed to: ${forwarderAddress}`);

  // 2. EduChain 배포 시 Forwarder 주소를 넘겨줘야 가스리스 릴레이가 동작함
  const EduChain = await hre.ethers.getContractFactory("EduChain");
  const eduChain = await EduChain.deploy(forwarderAddress);
  await eduChain.waitForDeployment();

  const address = await eduChain.getAddress();
  console.log(`EduChain deployed to: ${address}`);

  // 3. [저작권 보호] ZK 원작자 증명용 Groth16 Verifier 배포 후 EduChain 에 연결
  //    (contracts/CopyrightVerifier.sol 은 `npm run zk:build` 가 서킷에서 자동 생성)
  const CopyrightVerifier = await hre.ethers.getContractFactory("CopyrightVerifier");
  const copyrightVerifier = await CopyrightVerifier.deploy();
  await copyrightVerifier.waitForDeployment();
  const copyrightVerifierAddress = await copyrightVerifier.getAddress();
  await (await eduChain.setCopyrightVerifier(copyrightVerifierAddress)).wait();
  console.log(`CopyrightVerifier deployed to: ${copyrightVerifierAddress}`);

  // 프론트엔드에서 사용할 수 있도록 주소와 ABI 저장
  const eduChainAbi = JSON.parse(eduChain.interface.formatJson());
  const data = {
    address: address,
    abi: eduChainAbi,
    forwarderAddress: forwarderAddress,
    forwarderAbi: JSON.parse(forwarder.interface.formatJson()),
    copyrightVerifierAddress: copyrightVerifierAddress
  };
  fs.writeFileSync('./src/EduChainABI.json', JSON.stringify(data));

  // Subgraph ABI 및 subgraph.yaml의 컨트랙트 주소 자동 동기화
  try {
    if (fs.existsSync('./subgraph/abis')) {
      fs.writeFileSync('./subgraph/abis/EduChain.json', JSON.stringify(eduChainAbi, null, 2));
    }
    if (fs.existsSync('./subgraph/subgraph.yaml')) {
      const yamlContent = fs.readFileSync('./subgraph/subgraph.yaml', 'utf-8');
      const updatedYaml = yamlContent.replace(
        /address:\s*"0x[0-9a-fA-F]{40}"/,
        `address: "${address}"`
      );
      fs.writeFileSync('./subgraph/subgraph.yaml', updatedYaml);
      console.log(`Subgraph config synced with EduChain address: ${address}`);
    }
  } catch (syncErr) {
    console.warn("Subgraph 설정 동기화 중 경고:", syncErr.message);
  }

  console.log("\n[알림] scripts/relayer.js 를 실행하기 전에 RELAYER_PRIVATE_KEY 환경변수에");
  console.log("가스비를 대납할 지갑(Hardhat 로컬넷 계정 등)의 개인키를 설정하세요.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});