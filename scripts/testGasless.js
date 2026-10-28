// scripts/testGasless.js
// ------------------------------------------------------------------
// [8월 담당분] 검증 스크립트
//
// 이 스크립트는 아래를 한 번에 로컬넷에서 검증한다:
//   1) EIP-2612 permit() 서명이 실제로 approve 트랜잭션 없이 allowance를 세팅하는지
//   2) ERC-2771 가스리스 릴레이(Forwarder)를 통해 "학생 지갑"이 아닌
//      "릴레이어 지갑"이 가스비를 내고도 submitProblem이 정상 실행되고,
//      문제의 provider가 학생 지갑 주소로 정확히 기록되는지
//
// 실행:
//   1) 터미널 A: npx hardhat node
//   2) 터미널 B: npx hardhat run scripts/deploy.js --network localhost
//   3) 터미널 B: npx hardhat run scripts/testGasless.js --network localhost
// ------------------------------------------------------------------

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer, student, relayer, spender] = await hre.ethers.getSigners();

  const deployment = require("../src/EduChainABI.json");
  const eduChain = await ethers.getContractAt("EduChain", deployment.address);
  const forwarder = await ethers.getContractAt("EduChainForwarder", deployment.forwarderAddress);

  console.log("=== 0. 잔액 준비 ===");
  await (await eduChain.connect(student).faucet()).wait();
  const studentEthBefore = await ethers.provider.getBalance(student.address);
  console.log(`학생 EDU 잔액: ${ethers.formatUnits(await eduChain.balanceOf(student.address), 18)}`);
  console.log(`학생 ETH(가스) 잔액: ${ethers.formatEther(studentEthBefore)}`);

  console.log("\n=== 1. EIP-2612 Permit 테스트 (서명만으로 approve) ===");
  const permitValue = ethers.parseUnits("50", 18);
  const permitDeadline = Math.floor(Date.now() / 1000) + 3600;
  const permitNonce = await eduChain.nonces(student.address);
  const net = await ethers.provider.getNetwork();

  const permitDomain = {
    name: "EduToken",
    version: "1",
    chainId: net.chainId,
    verifyingContract: deployment.address,
  };
  const permitTypes = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const permitMessage = {
    owner: student.address,
    spender: spender.address,
    value: permitValue,
    nonce: permitNonce,
    deadline: permitDeadline,
  };

  const permitSig = await student.signTypedData(permitDomain, permitTypes, permitMessage);
  const { v, r, s } = ethers.Signature.from(permitSig);

  // 학생 본인이 아니라 spender(또는 릴레이어)가 permit()을 대신 제출해도 된다.
  // -> 학생은 서명만 하고 가스비는 한 푼도 내지 않는다.
  await (
    await eduChain
      .connect(spender)
      .permit(student.address, spender.address, permitValue, permitDeadline, v, r, s)
  ).wait();

  const allowance = await eduChain.allowance(student.address, spender.address);
  console.log(`permit() 이후 allowance: ${ethers.formatUnits(allowance, 18)} EDU (approve 트랜잭션 0회)`);

  console.log("\n=== 2. ERC-2771 가스리스 릴레이 테스트 ===");
  const cid = ethers.id("QmTestGaslessCID"); // 32 bytes hex (테스트용, bytes32로 인코딩)
  const price = ethers.parseUnits("10", 18);
  const data = eduChain.interface.encodeFunctionData("submitProblem", [cid, price, "Test Subject", "Test Author"]);

  const fwdDomain = {
    name: "EduChainForwarder",
    version: "1",
    chainId: net.chainId,
    verifyingContract: deployment.forwarderAddress,
  };
  const fwdTypes = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };
  const fwdNonce = await forwarder.nonces(student.address);
  const fwdDeadline = Math.floor(Date.now() / 1000) + 3600;
  const fwdMessage = {
    from: student.address,
    to: deployment.address,
    value: 0n,
    gas: 500000n,
    nonce: fwdNonce,
    deadline: fwdDeadline,
    data,
  };

  const fwdSig = await student.signTypedData(fwdDomain, fwdTypes, fwdMessage);

  const forwardRequestData = {
    from: student.address,
    to: deployment.address,
    value: 0n,
    gas: 500000n,
    deadline: fwdDeadline,
    data,
    signature: fwdSig,
  };

  const isValid = await forwarder.verify(forwardRequestData);
  console.log(`forwarder.verify() 결과: ${isValid}`);

  const studentEthBeforeRelay = await ethers.provider.getBalance(student.address);
  const relayerEthBefore = await ethers.provider.getBalance(relayer.address);

  // 가스비는 relayer가 냄 (student는 서명만 했을 뿐 이 tx를 보내지 않았다)
  const tx = await forwarder.connect(relayer).execute(forwardRequestData);
  const receipt = await tx.wait();

  const studentEthAfterRelay = await ethers.provider.getBalance(student.address);
  const relayerEthAfter = await ethers.provider.getBalance(relayer.address);

  console.log(`학생 ETH 잔액 변화: ${ethers.formatEther(studentEthBeforeRelay)} -> ${ethers.formatEther(studentEthAfterRelay)} (변화 없어야 정상)`);
  console.log(`릴레이어 ETH 잔액 변화: ${ethers.formatEther(relayerEthBefore)} -> ${ethers.formatEther(relayerEthAfter)} (가스비만큼 감소해야 정상)`);

  const newProblemId = await eduChain.problemCount();
  const problem = await eduChain.problems(newProblemId);
  console.log(`\n새로 등록된 문제 #${newProblemId} 의 provider: ${problem.provider}`);
  console.log(`학생 지갑 주소:                        ${student.address}`);
  console.log(
    problem.provider === student.address
      ? "[성공] 릴레이어가 가스비를 냈지만 provider는 학생 본인으로 정확히 기록됨 (_msgSender 정상 동작)"
      : "[실패] provider가 학생 주소와 다릅니다. Forwarder 주소/override 설정을 확인하세요."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
