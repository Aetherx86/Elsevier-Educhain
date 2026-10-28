const { expect } = require("chai");
const { ethers } = require("hardhat");
const path = require("path");

// [저작권 보호] ZK 원작자 증명 + 암호화 + 검증자 열람 권한 테스트
// 실제 Groth16 증명(public/zk 산출물)을 생성해 온체인 CopyrightVerifier 로 검증한다.
// 사전 준비: npm run zk:build
describe("EduChain Copyright Protection (ZK + Encryption + Review Access)", function () {
  this.timeout(120000);

  const ARTIFACTS = {
    wasm: path.join(__dirname, "..", "public", "zk", "copyright_proof.wasm"),
    zkey: path.join(__dirname, "..", "public", "zk", "copyright_final.zkey"),
  };
  const CID = "0x" + "2".repeat(64);
  const price = ethers.parseUnits("10", 18);

  let eduChain, verifierContract;
  let owner, provider, thief, v1, v2, v3, v4, v5, bystander;
  let zk, crypto;

  const submit = async (signer) => {
    await (await eduChain.connect(signer).submitProblem(CID, price, "CS", "Prof")).wait();
    return Number(await eduChain.problemCount());
  };

  before(async function () {
    [owner, provider, thief, v1, v2, v3, v4, v5, bystander] = await ethers.getSigners();
    zk = await import("../src/utils/zk.js");
    crypto = await import("../src/utils/crypto.js");

    const Forwarder = await ethers.getContractFactory("EduChainForwarder");
    const forwarder = await Forwarder.deploy();
    const EduChain = await ethers.getContractFactory("EduChain");
    eduChain = await EduChain.deploy(await forwarder.getAddress());
    await eduChain.setRestrictSelfAction(true);

    const Verifier = await ethers.getContractFactory("CopyrightVerifier");
    verifierContract = await Verifier.deploy();
    await eduChain.setCopyrightVerifier(await verifierContract.getAddress());

    // faucet 은 호출당 100 EDU. 출제자는 문제당 100 EDU 를 예치하므로 넉넉히 지급
    for (const s of [provider, thief, v1, v2, v3, v4, v5, bystander]) {
      for (let i = 0; i < 8; i++) await eduChain.connect(s).faucet();
    }
  });

  describe("AES-256-GCM 문제 원문 암호화", function () {
    it("키로 암호화한 원문은 같은 키로만 복호화되고, 평문이 암호문에 노출되지 않는다", async function () {
      const key = crypto.generateContentKey();
      const secret = { title: "기말고사 3번", content: "극한 lim x->0 sin(x)/x 를 구하시오" };
      const env = await crypto.encryptJson(secret, key);

      expect(JSON.stringify(env)).to.not.include("기말고사");
      expect(JSON.stringify(env)).to.not.include("sin(x)");
      expect(await crypto.decryptJson(env, key)).to.deep.equal(secret);
    });

    it("다른 키 또는 변조된 암호문은 GCM 인증 실패로 복호화가 거부된다", async function () {
      const key = crypto.generateContentKey();
      const wrongKey = crypto.generateContentKey();
      const env = await crypto.encryptJson({ a: 1 }, key);

      let failedWrongKey = false;
      try { await crypto.decryptJson(env, wrongKey); } catch (_) { failedWrongKey = true; }
      expect(failedWrongKey).to.equal(true);

      const tampered = { ...env, ct: env.ct.slice(0, -4) + "AAAA" };
      let failedTamper = false;
      try { await crypto.decryptJson(tampered, key); } catch (_) { failedTamper = true; }
      expect(failedTamper).to.equal(true);
    });

    it("이미지 바이트도 암호화/복호화 왕복 시 원본과 동일하다", async function () {
      const key = crypto.generateContentKey();
      const img = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 254, 255]);
      const env = await crypto.encryptBytes(img, key);
      expect(Array.from(await crypto.decryptBytes(env, key))).to.deep.equal(Array.from(img));
    });
  });

  describe("ZK 원작자 증명 (Poseidon 커밋먼트 + Groth16)", function () {
    let problemId, secrets, commitment;

    it("출제자가 원문 해시+salt 로 커밋먼트를 만들어 온체인에 등록하면 타임스탬프가 기록된다", async function () {
      problemId = await submit(provider);
      const contentHash = await crypto.hashToField(new TextEncoder().encode("원본 문제 본문"));
      secrets = { contentHash, salt: crypto.randomSalt() };

      const out = await zk.generateCopyrightProof({ ...secrets, author: provider.address }, ARTIFACTS);
      commitment = out.commitment;

      await (await eduChain.connect(provider).registerCopyright(problemId, commitment)).wait();
      expect(await eduChain.copyrightCommitment(problemId)).to.equal(commitment);
      expect(await eduChain.copyrightRegisteredAt(problemId)).to.be.greaterThan(0n);
    });

    it("출제자 이외에는 저작권 커밋먼트를 등록할 수 없다", async function () {
      await expect(eduChain.connect(thief).registerCopyright(problemId, 12345n)).to.be.revertedWith(
        "Only provider can register copyright"
      );
    });

    it("이미 등록된 커밋먼트를 다른 문제에 재등록(복붙 선점)할 수 없다", async function () {
      const thiefProblem = await submit(thief);
      await expect(eduChain.connect(thief).registerCopyright(thiefProblem, commitment)).to.be.revertedWith(
        "Commitment already claimed"
      );
    });

    it("원문 비공개 상태로 제출한 유효한 영지식 증명은 온체인에서 통과한다", async function () {
      const { proof, publicSignals } = await zk.generateCopyrightProof(
        { ...secrets, author: provider.address },
        ARTIFACTS
      );
      const { a, b, c } = zk.proofToSolidityArgs(proof);

      // public signals 에는 commitment 와 author 만 있고 원문/salt 는 없다
      expect(publicSignals.length).to.equal(2);
      expect(publicSignals.join(",")).to.not.include(secrets.salt.toString());

      await expect(eduChain.connect(provider).proveAuthorship(problemId, a, b, c))
        .to.emit(eduChain, "AuthorshipProven")
        .withArgs(problemId, provider.address, commitment);
      expect(await eduChain.authorshipProven(problemId)).to.equal(true);

      await expect(eduChain.connect(provider).proveAuthorship(problemId, a, b, c)).to.be.revertedWith(
        "Authorship already proven"
      );
    });

    it("원문/salt 를 모르는 도용자는 유효한 증명을 만들 수 없다 (잘못된 salt 증명은 커밋먼트 불일치로 거부)", async function () {
      const victim = await submit(provider);
      const victimSecrets = { contentHash: await crypto.hashToField(new TextEncoder().encode("피해자 문제")), salt: crypto.randomSalt() };
      const real = await zk.generateCopyrightProof({ ...victimSecrets, author: provider.address }, ARTIFACTS);
      await (await eduChain.connect(provider).registerCopyright(victim, real.commitment)).wait();

      // 도용자는 복사한 본문은 알지만 salt 를 모른다 -> 임의 salt 로 증명 생성 시도
      const forged = await zk.generateCopyrightProof(
        { contentHash: victimSecrets.contentHash, salt: crypto.randomSalt(), author: provider.address },
        ARTIFACTS
      );
      const { a, b, c } = zk.proofToSolidityArgs(forged.proof);
      await expect(eduChain.connect(provider).proveAuthorship(victim, a, b, c)).to.be.revertedWith("Invalid ZK proof");
    });

    it("다른 사람의 증명을 가로채 재사용(front-running)해도 author 바인딩 때문에 거부된다", async function () {
      const target = await submit(provider);
      const s = { contentHash: await crypto.hashToField(new TextEncoder().encode("바인딩 테스트")), salt: crypto.randomSalt() };
      const real = await zk.generateCopyrightProof({ ...s, author: provider.address }, ARTIFACTS);
      await (await eduChain.connect(provider).registerCopyright(target, real.commitment)).wait();

      // 제3자(thief)가 provider 의 유효 증명을 그대로 제출 -> provider 만 호출 가능
      const { a, b, c } = zk.proofToSolidityArgs(real.proof);
      await expect(eduChain.connect(thief).proveAuthorship(target, a, b, c)).to.be.revertedWith(
        "Only provider can prove authorship"
      );
      // 다른 author 주소로 만든 증명은 provider 호출 시 public input(author) 불일치로 거부
      const asThief = await zk.generateCopyrightProof({ ...s, author: thief.address }, ARTIFACTS);
      const t = zk.proofToSolidityArgs(asThief.proof);
      await expect(eduChain.connect(provider).proveAuthorship(target, t.a, t.b, t.c)).to.be.revertedWith(
        "Invalid ZK proof"
      );
    });

    it("커밋먼트 미등록 문제는 증명할 수 없다", async function () {
      const bare = await submit(provider);
      const dummy = [[0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n]];
      await expect(eduChain.connect(provider).proveAuthorship(bare, dummy[0], dummy[1], dummy[2])).to.be.revertedWith(
        "No copyright commitment"
      );
    });
  });

  describe("검증자 열람 권한 (5 EDU 보증금 -> 키 서버 자격)", function () {
    let pid;

    before(async function () {
      pid = await submit(provider);
    });

    it("보증금을 내기 전 일반 지갑은 열람 자격이 없다 (출제자만 가능)", async function () {
      expect(await eduChain.canViewProblem(pid, v1.address)).to.equal(false);
      expect(await eduChain.canViewProblem(pid, bystander.address)).to.equal(false);
      expect(await eduChain.canViewProblem(pid, provider.address)).to.equal(true);
    });

    it("requestReviewAccess 로 5 EDU 를 예치하면 열람 자격이 생긴다", async function () {
      const before = await eduChain.balanceOf(v1.address);
      await expect(eduChain.connect(v1).requestReviewAccess(pid))
        .to.emit(eduChain, "ReviewAccessGranted")
        .withArgs(pid, v1.address, ethers.parseUnits("5", 18));
      expect(before - (await eduChain.balanceOf(v1.address))).to.equal(ethers.parseUnits("5", 18));
      expect(await eduChain.canViewProblem(pid, v1.address)).to.equal(true);
      expect(await eduChain.canViewProblem(pid, bystander.address)).to.equal(false);
    });

    it("보증금 이중 예치 / 출제자 자기 열람 요청은 차단된다", async function () {
      await expect(eduChain.connect(v1).requestReviewAccess(pid)).to.be.revertedWith("Review access already granted");
      await expect(eduChain.connect(provider).requestReviewAccess(pid)).to.be.revertedWith(
        "Provider cannot review own problem"
      );
    });

    it("보증금은 투표 예치금으로 승계되어 투표 시 추가로 5 EDU 가 빠지지 않는다", async function () {
      const before = await eduChain.balanceOf(v1.address);
      await (await eduChain.connect(v1).voteProblem(pid, true)).wait();
      expect(await eduChain.balanceOf(v1.address)).to.equal(before); // 추가 차감 없음
      expect(await eduChain.reviewBond(pid, v1.address)).to.equal(0n);
      expect(await eduChain.hasVoted(pid, v1.address)).to.equal(true);
      expect(await eduChain.canViewProblem(pid, v1.address)).to.equal(true); // 투표자도 열람 가능
      expect((await eduChain.problems(pid)).totalStake).to.equal(ethers.parseUnits("5", 18));
    });

    it("보증금 없이 투표해도 기존처럼 5 EDU 가 예치된다 (하위 호환)", async function () {
      const before = await eduChain.balanceOf(v2.address);
      await (await eduChain.connect(v2).voteProblem(pid, true)).wait();
      expect(before - (await eduChain.balanceOf(v2.address))).to.equal(ethers.parseUnits("5", 18));
    });

    it("열람만 하고 투표하지 않은 검증자는 문제 확정 전에 보증금을 환불받을 수 없다", async function () {
      await (await eduChain.connect(v5).requestReviewAccess(pid)).wait();
      await expect(eduChain.connect(v5).refundReviewBond(pid)).to.be.revertedWith("Problem still under review");
    });

    it("문제 확정 후에는 미투표 열람자가 보증금을 회수할 수 있다", async function () {
      await (await eduChain.connect(v3).voteProblem(pid, true)).wait();
      await (await eduChain.connect(v4).voteProblem(pid, true)).wait();
      await (await eduChain.connect(bystander).voteProblem(pid, true)).wait();
      // v1, v2, v3, v4, bystander = 5표 모두 찬성
      await (
        await eduChain.finalizeProblem(
          pid,
          true,
          [v1.address, v2.address, v3.address, v4.address, bystander.address],
          []
        )
      ).wait();

      const before = await eduChain.balanceOf(v5.address);
      await expect(eduChain.connect(v5).refundReviewBond(pid))
        .to.emit(eduChain, "ReviewBondRefunded")
        .withArgs(pid, v5.address, ethers.parseUnits("5", 18));
      expect((await eduChain.balanceOf(v5.address)) - before).to.equal(ethers.parseUnits("5", 18));
      await expect(eduChain.connect(v5).refundReviewBond(pid)).to.be.revertedWith("No review bond");
    });

    it("이미 확정된 문제에는 열람 권한을 신규 요청할 수 없다", async function () {
      await expect(eduChain.connect(thief).requestReviewAccess(pid)).to.be.revertedWith("Problem not open for review");
    });

    it("구매 완료한 학생도 열람 자격을 얻는다", async function () {
      const buyer = thief;
      await (await eduChain.connect(buyer).purchaseProblem(pid)).wait();
      expect(await eduChain.canViewProblem(pid, buyer.address)).to.equal(true);
    });
  });
});
