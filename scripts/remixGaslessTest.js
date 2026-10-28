// ============================================================
// Remix IDE 전용 검증 스크립트 (npm/hardhat 필요 없음)
//
// 사용법:
//   1) remix.ethereum.org 접속
//   2) contracts/Forwarder.sol, contracts/Educhain.sol 을 그대로 붙여넣기
//   3) Solidity Compiler 탭에서 컴파일 (버전 0.8.24, EVM version: cancun)
//   4) Deploy & Run 탭, Environment: "Remix VM (Cancun)" 선택
//      - EduChainForwarder 배포 (생성자 인자 없음) -> 주소 복사
//      - EduChain 배포 (생성자 인자에 방금 복사한 forwarder 주소 붙여넣기) -> 주소 복사
//   5) 아래 FORWARDER_ADDRESS / EDUCHAIN_ADDRESS 를 4)에서 복사한 주소로 교체
//   6) Solidity Compiler 탭에서 각 컨트랙트를 컴파일한 뒤 나오는 "ABI" 복사 버튼을
//      눌러 FORWARDER_ABI / EDUCHAIN_ABI 자리에 붙여넣기
//   7) 이 파일을 Remix의 File Explorer에 그대로 저장 -> 파일 우클릭 -> "Run" 클릭
//   8) 하단 콘솔(터미널)에 결과 로그가 출력됨. 아래 항목이 모두 나오면 성공:
//      - "permit() 성공! allowance: 50000000000000000000"
//      - "verify() 결과: true"
//      - "학생 ETH 잔액 변화 없어야 함: A -> A" (앞뒤 숫자가 동일해야 함)
//      - "문제 #1 provider: 0x학생주소... (학생 주소와 같아야 성공)"
// ============================================================

(async () => {
  try {
    const FORWARDER_ADDRESS = "여기에_배포된_Forwarder_주소_붙여넣기";
    const EDUCHAIN_ADDRESS  = "여기에_배포된_EduChain_주소_붙여넣기";

    // Solidity Compiler 탭 > 컨트랙트 선택 > "ABI" 복사 버튼 결과를 그대로 붙여넣기
    const FORWARDER_ABI = [ /* EduChainForwarder ABI를 여기에 붙여넣기 */ ];
    const EDUCHAIN_ABI  = [ /* EduChain ABI를 여기에 붙여넣기 */ ];

    // Remix VM 계좌 0번 = 학생, 1번 = 릴레이어(Paymaster) 로 사용
    const student = await ethers.provider.getSigner(0);
    const relayer = await ethers.provider.getSigner(1);
    const studentAddr = await student.getAddress();
    const relayerAddr = await relayer.getAddress();

    const forwarder = new ethers.Contract(FORWARDER_ADDRESS, FORWARDER_ABI, ethers.provider);
    const eduChain = new ethers.Contract(EDUCHAIN_ADDRESS, EDUCHAIN_ABI, ethers.provider);

    console.log("학생 주소:", studentAddr);
    console.log("릴레이어(Paymaster) 주소:", relayerAddr);

    // 0) 배선 확인: EduChain이 이 Forwarder를 신뢰하는지
    console.log("trustedForwarder():", await eduChain.trustedForwarder());
    console.log("isTrustedForwarder() 결과:", await eduChain.isTrustedForwarder(FORWARDER_ADDRESS));

    // 0-1) 학생 faucet (일반 트랜잭션, 가스비 학생 본인 부담 - 비교용)
    await (await eduChain.connect(student).faucet()).wait();
    console.log("학생 EDU 잔액:", (await eduChain.balanceOf(studentAddr)).toString());

    // ==========================================================
    // 1) EIP-2612 Permit 테스트: approve 트랜잭션 없이 서명만으로 승인
    // ==========================================================
    const net = await ethers.provider.getNetwork();
    const permitDomain = {
      name: "EduToken",
      version: "1",
      chainId: net.chainId,
      verifyingContract: EDUCHAIN_ADDRESS,
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
    const permitDeadline = Math.floor(Date.now() / 1000) + 3600;
    const permitMsg = {
      owner: studentAddr,
      spender: relayerAddr,
      value: ethers.parseUnits("50", 18),
      nonce: await eduChain.nonces(studentAddr),
      deadline: permitDeadline,
    };

    // 학생은 서명만 함 (가스비 0)
    const permitSig = await student.signTypedData(permitDomain, permitTypes, permitMsg);
    const { v, r, s } = ethers.Signature.from(permitSig);

    // 릴레이어가 대신 permit()을 제출 (가스비는 릴레이어 부담)
    await (
      await eduChain
        .connect(relayer)
        .permit(studentAddr, relayerAddr, permitMsg.value, permitDeadline, v, r, s)
    ).wait();

    console.log(
      "permit() 성공! allowance:",
      (await eduChain.allowance(studentAddr, relayerAddr)).toString()
    );

    // ==========================================================
    // 2) ERC-2771 가스리스 릴레이 테스트 (EIP-7702 대체 구현)
    // ==========================================================
    const cid = ethers.id("QmRemixTestCID"); // 32 bytes hex (테스트용, bytes32로 인코딩)
    const price = ethers.parseUnits("10", 18);
    const data = eduChain.interface.encodeFunctionData("submitProblem", [cid, price, "Remix Subject", "Remix Author"]);

    const fwdDomain = {
      name: "EduChainForwarder",
      version: "1",
      chainId: net.chainId,
      verifyingContract: FORWARDER_ADDRESS,
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
    const fwdDeadline = Math.floor(Date.now() / 1000) + 3600;
    const fwdMsg = {
      from: studentAddr,
      to: EDUCHAIN_ADDRESS,
      value: 0,
      gas: 500000,
      nonce: await forwarder.nonces(studentAddr),
      deadline: fwdDeadline,
      data,
    };

    // 학생은 여기서도 "서명"만 함 (트랜잭션 전송 X -> 가스비 0)
    const fwdSig = await student.signTypedData(fwdDomain, fwdTypes, fwdMsg);

    const requestData = {
      from: studentAddr,
      to: EDUCHAIN_ADDRESS,
      value: 0,
      gas: 500000,
      deadline: fwdDeadline,
      data,
      signature: fwdSig,
    };

    console.log("forwarder.verify() 결과:", await forwarder.verify(requestData));

    const studentEthBefore = await ethers.provider.getBalance(studentAddr);

    // 릴레이어(Paymaster)가 실제 트랜잭션을 보내고 가스비를 냄
    await (await forwarder.connect(relayer).execute(requestData)).wait();

    const studentEthAfter = await ethers.provider.getBalance(studentAddr);

    console.log(
      "학생 ETH 잔액 변화 없어야 함:",
      studentEthBefore.toString(),
      "->",
      studentEthAfter.toString()
    );

    const pid = await eduChain.problemCount();
    const problem = await eduChain.problems(pid);
    console.log(`문제 #${pid} provider:`, problem.provider, "(학생 주소와 같아야 성공)");
    console.log("학생 주소:                 ", studentAddr);
  } catch (e) {
    console.log("에러 발생:", e.message);
  }
})();
