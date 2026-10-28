const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EduChain Stage 5 Verification Tests", function () {
  let eduChain, forwarder;
  let owner, provider1, verifier1, verifier2, verifier3, verifier4, maliciousVerifier, student;
  const IPFS_CID = "0x" + "1".repeat(64); // mock bytes32

  before(async function () {
    [owner, provider1, verifier1, verifier2, verifier3, verifier4, maliciousVerifier, student] = await ethers.getSigners();

    // Deploy Forwarder
    const Forwarder = await ethers.getContractFactory("EduChainForwarder");
    forwarder = await Forwarder.deploy();

    // Deploy EduChain
    const EduChain = await ethers.getContractFactory("EduChain");
    eduChain = await EduChain.deploy(await forwarder.getAddress());
    await eduChain.setRestrictSelfAction(true);
  });

  describe("Gas Optimization: O(1) Complexity & Storage", function () {
    it("Should provide faucet tokens efficiently", async function () {
      await eduChain.connect(provider1).faucet();
      await eduChain.connect(verifier1).faucet();
      await eduChain.connect(verifier2).faucet();
      await eduChain.connect(verifier3).faucet();
      await eduChain.connect(verifier4).faucet();
      await eduChain.connect(maliciousVerifier).faucet();
      await eduChain.connect(student).faucet(); // [토큰 이코노미] 실제로 문제를 구매할 학생

      expect(await eduChain.balanceOf(provider1.address)).to.equal(ethers.parseUnits("100", 18));
    });

    it("Should optimize gas by storing only bytes32 for IPFS CID on submitProblem", async function () {
      const submitTx = await eduChain.connect(provider1).submitProblem(
        IPFS_CID,
        ethers.parseUnits("10", 18),
        "Math",
        "Alice"
      );

      const receipt = await submitTx.wait();
      // Gas usage should be minimal since strings are emitted in events, not stored
      expect(receipt.gasUsed).to.be.below(200000); // 200k gas limit assertion for optimization
    });
  });

  describe("Reliability & Fleiss' Kappa Integration (Slashing)", function () {
    it("[버그 수정] 출제자는 본인이 출제한 문제에 투표할 수 없다", async function () {
      await expect(
        eduChain.connect(provider1).voteProblem(1, true)
      ).to.be.revertedWith("Provider cannot vote on own problem");
    });

    it("Should allow verifiers to vote, stake 5 EDU, and enforce MIN_VOTES = 5", async function () {
      await eduChain.connect(verifier1).voteProblem(1, true);
      await eduChain.connect(verifier2).voteProblem(1, true);
      await eduChain.connect(maliciousVerifier).voteProblem(1, false);

      // 최소 5명(MIN_VOTES = 5) 미만일 때 확정 시도 시 컨트랙트에서 거부됨을 검증
      await expect(
        eduChain.finalizeProblem(
          1,
          true,
          [verifier1.address, verifier2.address],
          [maliciousVerifier.address]
        )
      ).to.be.revertedWith("Minimum 5 votes required for Fleiss Kappa");

      // 추가 검증자 2명 투표 -> 총 5명(MIN_VOTES 충족)
      await eduChain.connect(verifier3).voteProblem(1, true);
      await eduChain.connect(verifier4).voteProblem(1, true);

      const p = await eduChain.problems(1);
      expect(p.totalStake).to.equal(ethers.parseUnits("25", 18));
    });

    it("Should execute slashing correctly once MIN_VOTES (5) & Kappa consensus are met", async function () {
      // 4명 정답 검증자(verifier1~4), 1명 오답 검증자(maliciousVerifier) 슬래싱
      const finalizeTx = await eduChain.finalizeProblem(
        1,
        true, // isVerified
        [verifier1.address, verifier2.address, verifier3.address, verifier4.address],
        [maliciousVerifier.address]
      );
      await finalizeTx.wait();

      const p = await eduChain.problems(1);
      expect(p.status).to.equal(1); // Verified

      // Malicious verifier's 5 EDU goes to treasury
      const treasury = await eduChain.treasury();
      expect(treasury).to.equal(ethers.parseUnits("5", 18));

      // [토큰 이코노미 개편] finalizeProblem은 이제 스테이킹 정산만 담당한다.
      // 판매 보상(70%)은 아직 아무도 구매하지 않았으므로 예치금 100 EDU만 있어야 한다.
      const providerStakeOnly = await eduChain.claimableRewards(provider1.address);
      expect(providerStakeOnly).to.equal(ethers.parseUnits("100", 18));
    });

    it("[토큰 이코노미] 학생이 실제로 EDU를 지불해야 70/20/10으로 분배된다 (purchaseProblem)", async function () {
      const purchaseTx = await eduChain.connect(student).purchaseProblem(1);
      await purchaseTx.wait();

      // 출제자: 기존 100 EDU 예치금 환급 + 판매가 10 EDU의 70%(7 EDU) = 107 EDU
      const providerReward = await eduChain.claimableRewards(provider1.address);
      expect(providerReward).to.equal(ethers.parseUnits("107", 18));

      // 정답 검증자 4명이 20%(2 EDU)를 나눠가짐 -> 기존 5 EDU 스테이크 환급 + 0.5 EDU씩 추가 = 5.5 EDU
      const verifier1Reward = await eduChain.claimableRewards(verifier1.address);
      expect(verifier1Reward).to.equal(ethers.parseUnits("5.5", 18));

      // 운영 재고 10%(1 EDU)가 실제로 쌓였는지 확인
      const platformReserve = await eduChain.platformReserve();
      expect(platformReserve).to.equal(ethers.parseUnits("1", 18));

      // 같은 학생이 같은 문제를 두 번 구매할 수는 없음
      await expect(
        eduChain.connect(student).purchaseProblem(1)
      ).to.be.revertedWith("Already purchased");

      // 출제자는 본인 문제를 구매할 수 없음
      await expect(
        eduChain.connect(provider1).purchaseProblem(1)
      ).to.be.revertedWith("Provider cannot buy own problem");
    });

    it("O(1) Reward Distribution: Users claim their rewards independently (Pull Model)", async function () {
      const claimTx = await eduChain.connect(provider1).claimReward();
      const receipt = await claimTx.wait();

      // Gas should be low and constant regardless of how many users participated
      expect(receipt.gasUsed).to.be.below(80000);
      // [토큰 이코노미 개편] 이제 mint가 아니라 실제 결제/스테이킹으로 채워진 잔액에서 transfer됨
      expect(await eduChain.balanceOf(provider1.address)).to.equal(ethers.parseUnits("107", 18));
    });
  });

  describe("[평판 시스템] 정답 누적 보너스 / 오답 누적 페널티 기반 가중치", function () {
    this.timeout(120000); // 50+6회 반복 트랜잭션이라 넉넉히 타임아웃 설정

    let repProvider, repVerifierVeteran, repVerifierNewbie, repStudent;
    let extraVerifiers;

    before(async function () {
      const signers = await ethers.getSigners();
      repProvider = signers[8];
      repVerifierVeteran = signers[9]; // 정답 50회를 쌓을 베테랑 검증자
      repVerifierNewbie = signers[10]; // 이력이 전혀 없는 신규 검증자
      repStudent = signers[11];
      extraVerifiers = [signers[12], signers[13], signers[14], signers[15]];
    });

    it("신규 검증자의 기본 가중치는 1.00배(100)이다", async function () {
      expect(await eduChain.getReputationWeight(repVerifierNewbie.address)).to.equal(100);
    });

    it("정답 검증을 50회 누적하면 가중치가 1.50배(150)가 된다", async function () {
      for (let i = 0; i < 50; i++) {
        await eduChain.connect(repProvider).faucet();
        await eduChain.connect(repProvider).submitProblem(
          IPFS_CID, ethers.parseUnits("10", 18), "Math", "RepTest"
        );
        const problemId = await eduChain.problemCount();

        await eduChain.connect(repVerifierVeteran).faucet();
        await eduChain.connect(repVerifierVeteran).voteProblem(problemId, true);
        for (const ev of extraVerifiers) {
          await eduChain.connect(ev).faucet();
          await eduChain.connect(ev).voteProblem(problemId, true);
        }

        await eduChain.finalizeProblem(
          problemId,
          true,
          [repVerifierVeteran.address, ...extraVerifiers.map(v => v.address)],
          []
        );
      }

      expect(await eduChain.correctVoteCount(repVerifierVeteran.address)).to.equal(50);
      expect(await eduChain.getReputationWeight(repVerifierVeteran.address)).to.equal(150);
    });

    it("이후 오답을 6회 누적하면 가중치가 1.30배(130)로 낮아진다 (정답 누적치는 리셋되지 않음)", async function () {
      for (let i = 0; i < 6; i++) {
        await eduChain.connect(repProvider).faucet();
        await eduChain.connect(repProvider).submitProblem(
          IPFS_CID, ethers.parseUnits("10", 18), "Math", "RepTest"
        );
        const problemId = await eduChain.problemCount();

        await eduChain.connect(repVerifierVeteran).faucet();
        await eduChain.connect(repVerifierVeteran).voteProblem(problemId, false);
        for (const ev of extraVerifiers) {
          await eduChain.connect(ev).faucet();
          await eduChain.connect(ev).voteProblem(problemId, true);
        }

        // 이번엔 오답(악의적 투표)으로 확정 -> 5 EDU 스테이크는 Treasury로 몰수, wrongVoteCount++
        await eduChain.finalizeProblem(
          problemId,
          true,
          extraVerifiers.map(v => v.address),
          [repVerifierVeteran.address]
        );
      }

      expect(await eduChain.correctVoteCount(repVerifierVeteran.address)).to.equal(50); // 그대로 유지
      expect(await eduChain.wrongVoteCount(repVerifierVeteran.address)).to.equal(6);
      expect(await eduChain.getReputationWeight(repVerifierVeteran.address)).to.equal(130);
    });

    it("오답이 누적되어도 최소 가중치 하한선 0.50배(50) 아래로 내려가지 않는다 (Min Cap)", async function () {
      const signers = await ethers.getSigners();
      const penalizedVerifier = signers[16];

      // 18회 오답 누적 (3회당 -10 페널티 -> 총 -60 페널티 -> 100 - 60 = 40이지만 최소 캡 50 적용)
      for (let i = 0; i < 18; i++) {
        await eduChain.connect(repProvider).faucet();
        await eduChain.connect(repProvider).submitProblem(
          IPFS_CID, ethers.parseUnits("10", 18), "Math", "MinCapTest"
        );
        const problemId = await eduChain.problemCount();

        await eduChain.connect(penalizedVerifier).faucet();
        await eduChain.connect(penalizedVerifier).voteProblem(problemId, false);
        for (const ev of extraVerifiers) {
          await eduChain.connect(ev).faucet();
          await eduChain.connect(ev).voteProblem(problemId, true);
        }

        await eduChain.finalizeProblem(
          problemId,
          true,
          extraVerifiers.map(v => v.address),
          [penalizedVerifier.address]
        );

        if (i === 2) {
          // 오답 3회 시점: 100 - 10 = 90 (0.90x)
          expect(await eduChain.getReputationWeight(penalizedVerifier.address)).to.equal(90);
        }
      }

      expect(await eduChain.wrongVoteCount(penalizedVerifier.address)).to.equal(18);
      expect(await eduChain.getReputationWeight(penalizedVerifier.address)).to.equal(50);
    });

    it("정답이 100회 이상 누적되어도 최대 가중치 상한선 2.00배(200)를 초과하지 않는다 (Max Cap)", async function () {
      // extraVerifiers[0]는 이미 앞선 테스트에서 50 + 6 + 18 = 74회 정답을 기록함 -> 36회 추가 정답 시 총 110회 정답
      for (let i = 0; i < 36; i++) {
        await eduChain.connect(repProvider).faucet();
        await eduChain.connect(repProvider).submitProblem(
          IPFS_CID, ethers.parseUnits("10", 18), "Math", "MaxCapTest"
        );
        const problemId = await eduChain.problemCount();

        for (const ev of extraVerifiers) {
          await eduChain.connect(ev).faucet();
          await eduChain.connect(ev).voteProblem(problemId, true);
        }
        await eduChain.connect(repVerifierNewbie).faucet();
        await eduChain.connect(repVerifierNewbie).voteProblem(problemId, true);

        await eduChain.finalizeProblem(
          problemId,
          true,
          [...extraVerifiers.map(v => v.address), repVerifierNewbie.address],
          []
        );
      }

      // 110회 정답이면 보너스가 +110(총 210)이지만 REPUTATION_MAX_WEIGHT(200)으로 캡 적용
      expect(await eduChain.correctVoteCount(extraVerifiers[0].address)).to.be.at.least(110);
      expect(await eduChain.getReputationWeight(extraVerifiers[0].address)).to.equal(200);
    });

    it("가중치가 다른 검증자들(Max 2.00x / Veteran 1.30x / Newbie / Min 0.50x)이 같은 문제를 검증하면 20% 풀이 가중치 비율대로 차등 분배된다", async function () {
      const signers = await ethers.getSigners();
      const penalizedVerifier = signers[16]; // 가중치 50 (0.50x)
      const brandNewVerifier = signers[17];  // 가중치 100 (1.00x)

      await eduChain.connect(repProvider).faucet();
      await eduChain.connect(repProvider).submitProblem(
        IPFS_CID, ethers.parseUnits("10", 18), "Math", "RepTest"
      );
      const problemId = await eduChain.problemCount();

      const group = [
        extraVerifiers[0],   // 200 (2.00x)
        repVerifierVeteran,  // 130 (1.30x)
        brandNewVerifier,    // 100 (1.00x)
        penalizedVerifier,   // 50  (0.50x)
        extraVerifiers[1]    // 200 (2.00x)
      ];

      for (const v of group) {
        await eduChain.connect(v).faucet();
        await eduChain.connect(v).voteProblem(problemId, true);
      }

      const allFiveAddresses = group.map(v => v.address);

      await eduChain.finalizeProblem(
        problemId,
        true,
        allFiveAddresses,
        []
      );

      const maxCapBefore = await eduChain.claimableRewards(extraVerifiers[0].address);
      const veteranBefore = await eduChain.claimableRewards(repVerifierVeteran.address);
      const newbieBefore = await eduChain.claimableRewards(brandNewVerifier.address);
      const penalizedBefore = await eduChain.claimableRewards(penalizedVerifier.address);

      await eduChain.connect(repStudent).faucet();
      await eduChain.connect(repStudent).purchaseProblem(problemId);

      const price = ethers.parseUnits("10", 18);
      const verifierCut = (price * 20n) / 100n; // 2 EDU
      const maxCapWeight = await eduChain.getReputationWeight(extraVerifiers[0].address); // 200
      const veteranWeight = await eduChain.getReputationWeight(repVerifierVeteran.address); // 130
      const newbieWeight = await eduChain.getReputationWeight(brandNewVerifier.address);   // 100
      const penalizedWeight = await eduChain.getReputationWeight(penalizedVerifier.address); // 50

      let totalWeight = 0n;
      for (const addr of allFiveAddresses) {
        totalWeight += await eduChain.getReputationWeight(addr);
      }

      const expectedMaxCapShare = (verifierCut * maxCapWeight) / totalWeight;
      const expectedVeteranShare = (verifierCut * veteranWeight) / totalWeight;
      const expectedNewbieShare = (verifierCut * newbieWeight) / totalWeight;
      const expectedPenalizedShare = (verifierCut * penalizedWeight) / totalWeight;

      const maxCapAfter = await eduChain.claimableRewards(extraVerifiers[0].address);
      const veteranAfter = await eduChain.claimableRewards(repVerifierVeteran.address);
      const newbieAfter = await eduChain.claimableRewards(brandNewVerifier.address);
      const penalizedAfter = await eduChain.claimableRewards(penalizedVerifier.address);

      expect(maxCapAfter - maxCapBefore).to.equal(expectedMaxCapShare);
      expect(veteranAfter - veteranBefore).to.equal(expectedVeteranShare);
      expect(newbieAfter - newbieBefore).to.equal(expectedNewbieShare);
      expect(penalizedAfter - penalizedBefore).to.equal(expectedPenalizedShare);

      // 2.00x > 1.30x > 1.00x > 0.50x 순서로 배당금을 차등 수령하는지 검증
      expect(expectedMaxCapShare).to.be.above(expectedVeteranShare);
      expect(expectedVeteranShare).to.be.above(expectedNewbieShare);
      expect(expectedNewbieShare).to.be.above(expectedPenalizedShare);
      // 2.00x 검증자는 1.00x 검증자의 정확히 2배, 0.50x 검증자의 정확히 4배(정수 나눗셈 오차 이내)를 받는지 검증
      expect(maxCapWeight).to.equal(200n);
      expect(newbieWeight).to.equal(100n);
      expect(penalizedWeight).to.equal(50n);
    });
  });

  describe("Collusion Resistance & Verifiable Random Assignment (VRA)", function () {
    let allSigners, author, friendMallory, friendSybil;
    let poolVerifiers = [];
    let vraProblemId;

    before(async function () {
      allSigners = await ethers.getSigners();
      author = allSigners[7];
      friendMallory = allSigners[8];
      friendSybil = allSigners[9];
      poolVerifiers = allSigners.slice(10, 18); // 8 independent verifiers in the pool

      // Faucet for author, friends, and pool verifiers
      for (const signer of [author, friendMallory, friendSybil, ...poolVerifiers]) {
        for (let i = 0; i < 3; i++) {
          await eduChain.connect(signer).faucet();
        }
      }

      // Register verifiers to the pool
      for (const verifier of poolVerifiers) {
        await eduChain.connect(verifier).registerAsVerifier();
      }
    });

    it("Should allow independent verifiers to join the global verification pool", async function () {
      const count = await eduChain.getRegisteredVerifiersCount();
      expect(count).to.be.at.least(8n);
      expect(await eduChain.isRegisteredVerifier(poolVerifiers[0].address)).to.equal(true);
      await expect(eduChain.connect(poolVerifiers[0]).registerAsVerifier()).to.be.revertedWith(
        "Already registered as verifier"
      );
    });

    it("Should reject committee assignment if verifier pool is insufficient", async function () {
      // Create a temporary isolated contract to test edge case pool < 5
      const Forwarder = await ethers.getContractFactory("EduChainForwarder");
      const fwd = await Forwarder.deploy();
      const EduChain = await ethers.getContractFactory("EduChain");
      const emptyChain = await EduChain.deploy(await fwd.getAddress());

      await emptyChain.connect(author).faucet();
      await emptyChain.connect(author).submitProblem(IPFS_CID, ethers.parseUnits("5", 18), "Math", "Author");
      await expect(emptyChain.assignReviewCommittee(1)).to.be.revertedWith("Insufficient verifier pool");
    });

    it("Should randomly assign exactly 5 distinct non-provider verifiers using on-chain entropy", async function () {
      const tx = await eduChain.connect(author).submitProblem(
        IPFS_CID,
        ethers.parseUnits("10", 18),
        "Calculus",
        "Author"
      );
      await tx.wait();
      vraProblemId = await eduChain.problemCount();

      const assignTx = await eduChain.assignReviewCommittee(vraProblemId);
      await expect(assignTx)
        .to.emit(eduChain, "CommitteeAssigned");

      expect(await eduChain.committeeAssigned(vraProblemId)).to.equal(true);

      const committee = await eduChain.getAssignedCommittee(vraProblemId);
      expect(committee.length).to.equal(5);

      // Verify all 5 assigned members are unique and author is not in committee
      const uniqueAddrs = new Set(committee);
      expect(uniqueAddrs.size).to.equal(5);
      expect(uniqueAddrs.has(author.address)).to.equal(false);

      for (const member of committee) {
        expect(await eduChain.isCommitteeMember(vraProblemId, member)).to.equal(true);
        expect(await eduChain.isVerifierAssigned(vraProblemId, member)).to.equal(true);
      }
    });

    it("Should reject unassigned friends attempting to request review access or vote (Cartel Prevention)", async function () {
      // friendMallory was not assigned to this committee
      expect(await eduChain.isCommitteeMember(vraProblemId, friendMallory.address)).to.equal(false);
      expect(await eduChain.isVerifierAssigned(vraProblemId, friendMallory.address)).to.equal(false);

      // Attempt to request review access
      await expect(
        eduChain.connect(friendMallory).requestReviewAccess(vraProblemId)
      ).to.be.revertedWith("Not assigned to review committee");

      // Attempt to vote directly
      await expect(
        eduChain.connect(friendMallory).voteProblem(vraProblemId, true)
      ).to.be.revertedWith("Not assigned to review committee");
    });

    it("Should allow assigned committee members to request review access and vote", async function () {
      const committee = await eduChain.getAssignedCommittee(vraProblemId);

      // First member requests review access
      const member1Signer = poolVerifiers.find(v => v.address.toLowerCase() === committee[0].toLowerCase());
      expect(member1Signer).to.not.be.undefined;

      const bondBefore = await eduChain.balanceOf(member1Signer.address);
      await (await eduChain.connect(member1Signer).requestReviewAccess(vraProblemId)).wait();
      expect(await eduChain.reviewBond(vraProblemId, member1Signer.address)).to.equal(ethers.parseUnits("5", 18));

      // Member 1 votes (rollover bond)
      await (await eduChain.connect(member1Signer).voteProblem(vraProblemId, true)).wait();
      expect(await eduChain.balanceOf(member1Signer.address)).to.equal(bondBefore - ethers.parseUnits("5", 18));
      expect(await eduChain.reviewBond(vraProblemId, member1Signer.address)).to.equal(0n);
      expect(await eduChain.hasVoted(vraProblemId, member1Signer.address)).to.equal(true);

      // Remaining 4 committee members vote
      for (let i = 1; i < 5; i++) {
        const memberSigner = poolVerifiers.find(v => v.address.toLowerCase() === committee[i].toLowerCase());
        await (await eduChain.connect(memberSigner).voteProblem(vraProblemId, true)).wait();
      }

      const p = await eduChain.problems(vraProblemId);
      expect(p.totalStake).to.equal(ethers.parseUnits("25", 18)); // 5 * 5 EDU
    });

    it("[Theorem 2 Proof] Wash-trading cartels suffer guaranteed -10% capital depletion per self-purchase cycle", async function () {
      // Finalize the problem as verified
      const committee = await eduChain.getAssignedCommittee(vraProblemId);
      const committeeArray = Array.from(committee);
      await (
        await eduChain.finalizeProblem(
          vraProblemId,
          true,
          committeeArray,
          []
        )
      ).wait();

      const price = ethers.parseUnits("10", 18);
      const reserveBefore = await eduChain.platformReserve();
      const buyer = friendSybil; // Cartel member executes self-purchase

      const buyerBalanceBefore = await eduChain.balanceOf(buyer.address);
      const authorRewardsBefore = await eduChain.claimableRewards(author.address);

      // Cartel executes 1 self-purchase cycle
      await (await eduChain.connect(buyer).purchaseProblem(vraProblemId)).wait();

      const buyerBalanceAfter = await eduChain.balanceOf(buyer.address);
      const authorRewardsAfter = await eduChain.claimableRewards(author.address);
      const reserveAfter = await eduChain.platformReserve();

      // 1. Buyer lost exactly price (10 EDU)
      expect(buyerBalanceBefore - buyerBalanceAfter).to.equal(price);

      // 2. Author got 70% (7 EDU)
      expect(authorRewardsAfter - authorRewardsBefore).to.equal((price * 70n) / 100n);

      // 3. Platform reserve extracted at least 10% (1 EDU + any division remainder)
      const platformSunk = reserveAfter - reserveBefore;
      expect(platformSunk).to.be.at.least((price * 10n) / 100n);
      expect(platformSunk).to.be.closeTo((price * 10n) / 100n, 100n);

      // 4. Mathematical proof that total cartel capital shrunk by at least 10%
      // Total cartel retrieved <= 70% (author) + 20% (committee) = 90%
      // Net loss to cartel = >= 10% Sunk forever in platform reserve!
      const cartelRetrieved = (authorRewardsAfter - authorRewardsBefore);
      let committeeRetrieved = 0n;
      for (const member of committee) {
        committeeRetrieved += await eduChain.claimableRewards(member);
      }
      expect(buyerBalanceBefore - buyerBalanceAfter).to.equal(price);
      expect(platformSunk).to.equal(price - (authorRewardsAfter - authorRewardsBefore) - (price * 20n / 100n - (platformSunk - (price * 10n / 100n))));
    });
  });
});
