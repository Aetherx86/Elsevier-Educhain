// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EduChain Core Logic
 * @dev 2026.07.26 Updates:
 * - Added `hasVoted` mapping to prevent duplicate voting (money duplication bug fix).
 * - Enforced strict slashing (malicious verifiers forfeit 5 EDU, rejected problem providers forfeit 100 EDU).
 * - Implemented ERC2771Context for Gasless Meta-transactions (Relayer support).
 *
 * @dev 2026.09.16 Updates (실제 토큰 이코노미 구현):
 * - 이전에는 finalizeProblem()에서 `price`를 근거로 70%/20% 보상을 그냥 mint()해서 지급했는데,
 *   실제로 그 `price`를 지불하는 학생(구매자)이 없어서 "수익 분배"가 실제 돈의 흐름 없이
 *   숫자로만 존재했음. 이번 업데이트로 purchaseProblem()을 추가해 학생이 실제로 EDU를
 *   지불해야 문제를 구매할 수 있고, 그 결제액이 그 자리에서 70%(출제자)/20%(정답 검증자)/
 *   10%(운영 재고, platformReserve)로 실제 분배됨.
 * - claimReward()도 더 이상 mint()로 새로 찍어내지 않고, 컨트랙트가 실제로 보유한 잔액에서
 *   transfer하도록 변경 (인플레이션 없는 보상 구조).
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/Context.sol";

// [8월 담당분] ERC20Permit(EIP-2612): 서명만으로 approve를 대신할 수 있게 하여
//              Uniswap V3 유동성 공급 등에서 "승인 트랜잭션 1회 생략"을 가능하게 함.
// [8월 담당분] ERC2771Context: EIP-7702/Paymaster의 실무적 대안으로 채택한
//              메타트랜잭션(ERC-2771) 표준. 신뢰된 Forwarder를 통해 들어온 호출은
//              _msgSender()가 실제 서명자 주소로 해석되어, 학생(서명자)은 가스비를
//              내지 않고 릴레이어(Paymaster 역할)가 대신 가스비를 지불한다.
// [저작권 보호] snarkjs 가 생성한 Groth16 Verifier(contracts/CopyrightVerifier.sol)와 통신하기 위한 인터페이스.
// public signals 순서 = [commitment, author]  (zk/circuits/copyright_proof.circom 참고)
interface ICopyrightVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[2] calldata _pubSignals
    ) external view returns (bool);
}

contract EduChain is ERC20, ERC20Permit, ERC2771Context, Ownable, ReentrancyGuard {
    struct Problem {
        address provider;
        bytes32 ipfsCid; // [병합] 팀원 브랜치: string -> bytes32로 최적화 (가스 절감)
        uint256 price;
        uint256 totalStake;
        uint8 status; // 0: Pending, 1: Verified, 2: Rejected
        bool active;
    }

    uint256 public constant PROVIDER_STAKE = 100 * 10**18; // 출제자 예치금 100 EDU (추가)
    uint256 public constant VERIFIER_STAKE = 5 * 10**18;   // 검증자 예치금 5 EDU
    uint256 public constant PROVIDER_FEE = 70; // 문제 판매 보상 (70%)
    uint256 public constant VERIFIER_FEE = 20; // 검증자 배분 (20%)
    uint256 public constant PLATFORM_FEE = 10; // 운영 재고 (10%) - 가스비 대납/유동성 공급용

    // [Fleiss' Kappa 합의 기준] 관리자 수동 개입 없이 최소 투표수(5명) 및 통계적 일치도에 따라 확정
    uint256 public constant MIN_VOTES = 5;           // 1차 확정 최소 검증자 투표수 (5명)
    uint256 public constant EXTENDED_MIN_VOTES = 10; // 보통 일치(0.41 <= k < 0.61) 시 확대 표본 최소 투표수 (10명)

    mapping(uint256 => Problem) public problems;
    uint256 public problemCount;

    mapping(address => uint256) public claimableRewards;
    uint256 public treasury; // 플랫폼 금고 (몰수된 금액 누적)
    uint256 public platformReserve; // [토큰 이코노미] 판매 수익의 10% 운영 재고 누적분

    // [토큰 이코노미] 학생이 실제로 EDU를 지불하고 문제를 구매(열람권)했는지 기록
    mapping(uint256 => mapping(address => bool)) public hasPurchased;
    // 검증 통과 시점의 "정답 검증자" 목록을 저장해두고, 이후 구매가 발생할 때마다
    // 그 목록에 20%를 계속 분배한다 (한 문제를 여러 학생이 반복 구매하는 마켓플레이스 구조).
    mapping(uint256 => address[]) public correctVerifiersOf;

    // [평판 시스템] 검증자별 누적 정답/오답 횟수 (finalizeProblem에서 계속 누적, 리셋되지 않음)
    mapping(address => uint256) public correctVoteCount;
    mapping(address => uint256) public wrongVoteCount;

    // 가중치는 100 = 1.00배를 기준으로 하는 정수 스케일(퍼센트 포인트*10 아님, 그냥 1.00=100).
    // 정답 10회마다 +0.10(10), 오답 3회마다 -0.10(10). 최소 0.5배(50), 최대 2.0배(200)로 캡.
    uint256 public constant REPUTATION_BASE_WEIGHT = 100; // 1.00x
    uint256 public constant REPUTATION_MIN_WEIGHT = 50;   // 0.50x
    uint256 public constant REPUTATION_MAX_WEIGHT = 200;  // 2.00x
    uint256 public constant REPUTATION_STEP = 10;         // 0.10 단위
    uint256 public constant CORRECT_VOTES_PER_STEP = 10;  // 정답 10회마다 한 단계
    uint256 public constant WRONG_VOTES_PER_STEP = 3;     // 오답 3회마다 한 단계

    event ProblemSubmitted(uint256 indexed problemId, address indexed provider, bytes32 ipfsCid, string subject, string authorName);
    event Voted(uint256 indexed problemId, address indexed verifier, bool isCorrect);
    event ProblemFinalized(uint256 indexed problemId, uint8 status);
    event ProblemPurchased(uint256 indexed problemId, address indexed buyer, uint256 price);
    event ProblemDeleted(uint256 indexed problemId, address indexed deletedBy);

    // trustedForwarder: 가스비를 대납하는 ERC-2771 Forwarder 계약 주소
    // (scripts/deploy.js 에서 EduChainForwarder를 먼저 배포한 뒤 이 주소를 넘긴다)
    constructor(address trustedForwarder)
        ERC20("EduToken", "EDU")
        ERC20Permit("EduToken")
        ERC2771Context(trustedForwarder)
        Ownable(msg.sender)
    {
        _mint(msg.sender, 1000000 * 10**18);
    }

    // 1. 문제 출제 (100 EDU 예치 필수)
    // _msgSender(): 사용자가 지갑으로 직접 호출하면 msg.sender와 동일하고,
    // Forwarder를 통한 가스리스 릴레이 호출이면 서명자 주소로 자동 치환된다.
    // [병합] 팀원 브랜치: subject/authorName은 온체인 스토리지에 저장하지 않고
    // (가스 절감), 이벤트로만 emit해서 The Graph/프론트가 인덱싱하도록 한다.
    // 실제 문제 본문/과목/작성자 표시는 IPFS에 저장된 JSON을 우선 사용한다.
    function submitProblem(
        bytes32 _ipfsCid,
        uint256 _price,
        string memory _subject,
        string memory _authorName
    ) external {
        address sender = _msgSender();
        require(balanceOf(sender) >= PROVIDER_STAKE, "Insufficient EDU to stake 100");

        // 출제자 지갑에서 컨트랙트로 100 EDU 이동 (예치)
        _transfer(sender, address(this), PROVIDER_STAKE);

        problemCount++;
        problems[problemCount] = Problem({
            provider: sender,
            ipfsCid: _ipfsCid,
            price: _price,
            totalStake: 0,
            status: 0,
            active: true
        });
        emit ProblemSubmitted(problemCount, sender, _ipfsCid, _subject, _authorName);
    }

    // [병합] 팀원 브랜치: 중복 투표 방지 (동일 문제에 같은 지갑이 두 번 투표해서
    // 보상을 중복으로 받아가는 버그 수정)
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bool)) public voteCountedInReputation;

    // 데모 시에는 단일 지갑으로 출제·투표·구매를 모두 시연할 수 있도록 기본값 false,
    // 보안/TDD 테스트 시에는 true로 활성화하여 출제자 자전 투표 및 자전 구매를 엄격히 차단
    bool public restrictSelfAction = false;

    function setRestrictSelfAction(bool _restrict) external onlyOwner {
        restrictSelfAction = _restrict;
    }

    // ================================================================
    // [담합 방지] Verifiable Random Assignment (VRA) 위원회 무작위 배정
    //
    // 출제자가 지인/친구(담합 카르텔)를 불러 짜고 치는 투표를 방지하기 위해:
    // 1) 검증자 풀(registeredVerifiers)에 사전에 등록된 검증자들 중에서,
    // 2) 온체인 엔트로피(prevrandao, problemId, timestamp)를 시드로 하여
    //    MIN_VOTES(5명) 크기의 독립 위원회를 무작위 비복원 추출(Fisher-Yates)로 배정한다.
    // 3) 배정된 위원회 멤버만 해당 문제의 열람(requestReviewAccess) 및 투표(voteProblem)가 가능하다.
    // ================================================================
    address[] public registeredVerifiers;
    mapping(address => bool) public isRegisteredVerifier;

    mapping(uint256 => bool) public committeeAssigned;
    mapping(uint256 => address[]) public assignedCommittee;
    mapping(uint256 => mapping(address => bool)) public isCommitteeMember;

    event VerifierRegistered(address indexed verifier);
    event CommitteeAssigned(uint256 indexed problemId, address[] members, bytes32 seed);

    function registerAsVerifier() external {
        address sender = _msgSender();
        require(!isRegisteredVerifier[sender], "Already registered as verifier");
        isRegisteredVerifier[sender] = true;
        registeredVerifiers.push(sender);
        emit VerifierRegistered(sender);
    }

    function getRegisteredVerifiersCount() external view returns (uint256) {
        return registeredVerifiers.length;
    }

    function getAssignedCommittee(uint256 _problemId) external view returns (address[] memory) {
        return assignedCommittee[_problemId];
    }

    function isVerifierAssigned(uint256 _problemId, address _verifier) external view returns (bool) {
        if (!committeeAssigned[_problemId]) return true;
        return isCommitteeMember[_problemId][_verifier];
    }

    function assignReviewCommittee(uint256 _problemId) external {
        Problem storage p = problems[_problemId];
        require(p.active && p.status == 0, "Problem not active or already finalized");
        require(!committeeAssigned[_problemId], "Committee already assigned");
        require(registeredVerifiers.length >= MIN_VOTES, "Insufficient verifier pool");

        // 온체인 의사난수 시드 (EVM prevrandao + problemId + timestamp + blocknumber)
        bytes32 seed = keccak256(
            abi.encodePacked(block.prevrandao, _problemId, block.timestamp, block.number, registeredVerifiers.length)
        );

        // Fisher-Yates 스타일 비복원 무작위 샘플링 (MIN_VOTES = 5명 선출)
        uint256 poolSize = registeredVerifiers.length;
        uint256[] memory indices = new uint256[](poolSize);
        for (uint256 i = 0; i < poolSize; i++) {
            indices[i] = i;
        }

        address[] memory selected = new address[](MIN_VOTES);
        uint256 currentSeed = uint256(seed);

        uint256 pickedCount = 0;
        for (uint256 i = 0; i < poolSize && pickedCount < MIN_VOTES; i++) {
            uint256 remaining = poolSize - i;
            uint256 pickOffset = currentSeed % remaining;
            uint256 selectedIdx = indices[pickOffset];

            indices[pickOffset] = indices[remaining - 1];

            address candidate = registeredVerifiers[selectedIdx];
            // 출제자 본인은 위원회에서 제외
            if (candidate != p.provider) {
                selected[pickedCount] = candidate;
                isCommitteeMember[_problemId][candidate] = true;
                pickedCount++;
            }

            currentSeed = uint256(keccak256(abi.encodePacked(currentSeed, i)));
        }

        require(pickedCount == MIN_VOTES, "Failed to select complete committee");

        committeeAssigned[_problemId] = true;
        assignedCommittee[_problemId] = selected;

        emit CommitteeAssigned(_problemId, selected, seed);
    }

    // 관리자 또는 테스트용 명시적 위원회 지정 (결정론적 테스트 및 사전 승인 환경 지원)
    function setCommitteeForProblem(uint256 _problemId, address[] calldata members) external onlyOwner {
        require(members.length >= MIN_VOTES, "Committee must have at least MIN_VOTES members");
        Problem storage p = problems[_problemId];
        require(p.active && p.status == 0, "Problem not active or already finalized");

        for (uint256 i = 0; i < members.length; i++) {
            require(members[i] != p.provider, "Provider cannot be in committee");
            isCommitteeMember[_problemId][members[i]] = true;
        }
        committeeAssigned[_problemId] = true;
        assignedCommittee[_problemId] = members;

        emit CommitteeAssigned(_problemId, members, bytes32(0));
    }

    // 2. 검증 투표 (5 EDU 예치 필수)
    function voteProblem(uint256 _problemId, bool _isCorrect) external {
        address sender = _msgSender();
        require(problems[_problemId].status == 0, "Already verified");
        require(!restrictSelfAction || sender != problems[_problemId].provider, "Provider cannot vote on own problem");
        require(!hasVoted[_problemId][sender], "Already voted on this problem");
        require(!committeeAssigned[_problemId] || isCommitteeMember[_problemId][sender], "Not assigned to review committee");

        // [저작권 보호] 사전에 requestReviewAccess()로 열람 보증금(5 EDU)을 맡긴 검증자는
        // 그 보증금이 그대로 이번 투표의 예치금으로 승계된다(이중 예치 없음).
        if (reviewBond[_problemId][sender] > 0) {
            reviewBond[_problemId][sender] = 0;
        } else {
            require(balanceOf(sender) >= VERIFIER_STAKE, "Insufficient EDU for staking");
            _transfer(sender, address(this), VERIFIER_STAKE);
        }

        hasVoted[_problemId][sender] = true;
        problems[_problemId].totalStake += VERIFIER_STAKE;

        // 찬성(정직 검증) 투표 시 온체인 정직 검증 카운트를 즉시 반영하여 실시간 평판 상승 확인 지원
        // (추후 확정 시 기각 판정으로 오답 처리되면 롤백 후 wrongVoteCount로 전환하며, 정답 확정 시 중복 카운트 방지)
        if (_isCorrect) {
            correctVoteCount[sender]++;
            voteCountedInReputation[_problemId][sender] = true;
        }

        emit Voted(_problemId, sender, _isCorrect);
    }

    // 3. 검증 결과 확정 (Fleiss' Kappa 통계 합의 기반 — 관리자 수동 개입 배제)
    // [토큰 이코노미 개편] 여기서는 "예치금(스테이킹) 정산"만 담당한다.
    // 최소 투표수(MIN_VOTES = 5) 이상이 모여야만 확정 가능하며, 온체인 예치 총액(p.totalStake)과
    // 전달된 검증자 수가 정확히 일치하는지 검증한다.
    function finalizeProblem(
        uint256 _problemId,
        bool _isVerified,
        address[] calldata _correctVerifiers,
        address[] calldata _maliciousVerifiers
    ) external {
        Problem storage p = problems[_problemId];
        require(p.status == 0, "Already finalized");

        uint256 totalVotes = _correctVerifiers.length + _maliciousVerifiers.length;
        require(totalVotes >= MIN_VOTES, "Minimum 5 votes required for Fleiss Kappa");
        require(totalVotes * VERIFIER_STAKE == p.totalStake, "Verifier count must match staked votes");

        p.status = _isVerified ? 1 : 2;

        // [슬래싱 1] 오답 투표자들의 5 EDU는 컨트랙트 금고(Treasury)에 영구 귀속
        // + [평판 시스템] 오답 횟수 누적 (리셋되지 않는 총 누적치)
        for (uint i = 0; i < _maliciousVerifiers.length; i++) {
            address malV = _maliciousVerifiers[i];
            if (voteCountedInReputation[_problemId][malV]) {
                if (correctVoteCount[malV] > 0) {
                    correctVoteCount[malV]--;
                }
                voteCountedInReputation[_problemId][malV] = false;
            }
            wrongVoteCount[malV]++;
        }
        treasury += (_maliciousVerifiers.length * VERIFIER_STAKE);

        // 정답 투표자들에게는 원금(5 EDU) 환급 + [평판 시스템] 정답 횟수 누적 (중복 반영 방지)
        for (uint i = 0; i < _correctVerifiers.length; i++) {
            address corV = _correctVerifiers[i];
            claimableRewards[corV] += VERIFIER_STAKE;
            if (!voteCountedInReputation[_problemId][corV]) {
                correctVoteCount[corV]++;
                voteCountedInReputation[_problemId][corV] = true;
            }
        }

        // [슬래싱 2] 출제자 100 EDU 처리
        if (_isVerified) {
            // 통과 시: 예치금 100 EDU 반환. 판매 보상은 구매 시점에 별도 지급.
            claimableRewards[p.provider] += PROVIDER_STAKE;
            // 이후 구매가 들어올 때마다 20%를 나눠 받을 정답 검증자 명단을 저장
            correctVerifiersOf[_problemId] = _correctVerifiers;
        } else {
            // 기각(오류 문제) 시: 출제자의 예치금 100 EDU 전액 Treasury로 몰수
            treasury += PROVIDER_STAKE;
        }

        emit ProblemFinalized(_problemId, p.status);
    }

    // 3-B. 문제 삭제/비활성화 (출제자 본인 또는 관리자가 테스트/불필요 문제를 목록에서 삭제)
    function deleteProblem(uint256 _problemId) external nonReentrant {
        address sender = _msgSender();
        Problem storage p = problems[_problemId];
        require(p.active, "Problem already deleted");
        require(sender == p.provider || sender == owner(), "Only provider or owner can delete");

        p.active = false;

        // 아직 아무도 투표하지 않은 Pending 문제를 삭제하는 경우 출제자 예치금(100 EDU) 즉시 환급
        if (p.status == 0 && p.totalStake == 0) {
            p.status = 2;
            _transfer(address(this), p.provider, PROVIDER_STAKE);
        }

        emit ProblemDeleted(_problemId, sender);
    }

    // [평판 시스템] 검증자의 현재 가중치를 계산 (1.00 = 100 스케일)
    // 정답 10회마다 +0.10, 오답 3회마다 -0.10. 최소 0.50 ~ 최대 2.00으로 캡.
    // 예: 정답 50회 -> 1.50, 이후 오답 6회 추가 -> 1.30 (정답 카운트는 리셋되지 않음)
    function getReputationWeight(address verifier) public view returns (uint256) {
        uint256 bonus = (correctVoteCount[verifier] / CORRECT_VOTES_PER_STEP) * REPUTATION_STEP;
        uint256 penalty = (wrongVoteCount[verifier] / WRONG_VOTES_PER_STEP) * REPUTATION_STEP;

        uint256 weight;
        if (bonus >= penalty) {
            weight = REPUTATION_BASE_WEIGHT + (bonus - penalty);
        } else {
            uint256 net = penalty - bonus;
            weight = net >= REPUTATION_BASE_WEIGHT ? 0 : REPUTATION_BASE_WEIGHT - net;
        }

        if (weight < REPUTATION_MIN_WEIGHT) weight = REPUTATION_MIN_WEIGHT;
        if (weight > REPUTATION_MAX_WEIGHT) weight = REPUTATION_MAX_WEIGHT;
        return weight;
    }

    // [데모/테스트 시드 설정] 초기 평판 누적 이력(정답 횟수, 오답 횟수) 설정 (관리자 전용)
    function seedVerifierReputation(
        address verifier,
        uint256 _correctCount,
        uint256 _wrongCount
    ) external onlyOwner {
        correctVoteCount[verifier] = _correctCount;
        wrongVoteCount[verifier] = _wrongCount;
    }

    // ================================================================
    // [저작권 보호] ZK 원작자 증명 + 검증자 열람 권한(Review Access)
    //
    // 1) 문제 본문/이미지는 출제자가 AES-256-GCM 으로 암호화해 IPFS 에 올리므로 일반인은 읽을 수 없다.
    // 2) 출제자는 Poseidon(contentHash, salt) 커밋먼트를 출제 시점에 온체인에 등록(타임스탬프 = 선점 증거).
    //    분쟁 시 원문/salt 공개 없이 Groth16 영지식 증명으로 "내가 그 커밋먼트의 원본을 안다"를 증명한다.
    // 3) 검증자는 5 EDU 열람 보증금을 예치(requestReviewAccess)해야만 키 서버(relayer)로부터 복호화 키를
    //    받을 수 있다. 이 보증금은 투표 시 그대로 투표 예치금으로 승계된다.
    //    (키 서버는 canViewProblem()을 조회해 온체인 자격을 확인한다.)
    // ================================================================
    ICopyrightVerifier public copyrightVerifier;
    mapping(uint256 => uint256) public copyrightCommitment;   // problemId => Poseidon 커밋먼트
    mapping(uint256 => uint256) public copyrightRegisteredAt; // problemId => 등록 블록 타임스탬프
    mapping(uint256 => uint256) public commitmentProblem;     // 커밋먼트 => 최초 등록한 problemId (선점 방지)
    mapping(uint256 => bool) public authorshipProven;         // problemId => ZK 원작자 증명 완료 여부
    mapping(uint256 => mapping(address => uint256)) public reviewBond; // 검증자 열람 보증금

    event CopyrightRegistered(uint256 indexed problemId, address indexed provider, uint256 commitment, uint256 timestamp);
    event AuthorshipProven(uint256 indexed problemId, address indexed prover, uint256 commitment);
    event ReviewAccessGranted(uint256 indexed problemId, address indexed verifier, uint256 bond);
    event ReviewBondRefunded(uint256 indexed problemId, address indexed verifier, uint256 bond);

    function setCopyrightVerifier(address _verifier) external onlyOwner {
        copyrightVerifier = ICopyrightVerifier(_verifier);
    }

    // 출제자가 본인 문제에 저작권 커밋먼트 등록 (문제당 1회, 동일 커밋먼트 중복 등록 불가 = 선점자 우선)
    function registerCopyright(uint256 _problemId, uint256 _commitment) external {
        address sender = _msgSender();
        Problem storage p = problems[_problemId];
        require(p.provider == sender && p.provider != address(0), "Only provider can register copyright");
        require(copyrightCommitment[_problemId] == 0, "Copyright already registered");
        require(_commitment != 0, "Invalid commitment");
        require(commitmentProblem[_commitment] == 0, "Commitment already claimed");

        copyrightCommitment[_problemId] = _commitment;
        copyrightRegisteredAt[_problemId] = block.timestamp;
        commitmentProblem[_commitment] = _problemId;

        emit CopyrightRegistered(_problemId, sender, _commitment, block.timestamp);
    }

    // 영지식 원작자 증명 제출: 원문/salt 를 공개하지 않고 커밋먼트의 원상(preimage)을 안다는 사실만 검증
    function proveAuthorship(
        uint256 _problemId,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    ) external {
        address sender = _msgSender();
        require(address(copyrightVerifier) != address(0), "Copyright verifier not set");
        require(problems[_problemId].provider == sender, "Only provider can prove authorship");
        uint256 commitment = copyrightCommitment[_problemId];
        require(commitment != 0, "No copyright commitment");
        require(!authorshipProven[_problemId], "Authorship already proven");

        // public signals = [commitment, author]: author 를 증명에 묶어 타인이 증명을 가로채 재사용하지 못하게 함
        uint[2] memory pub = [commitment, uint256(uint160(sender))];
        require(copyrightVerifier.verifyProof(_pA, _pB, _pC, pub), "Invalid ZK proof");

        authorshipProven[_problemId] = true;
        emit AuthorshipProven(_problemId, sender, commitment);
    }

    // 검증자 열람 권한 요청: 5 EDU 보증금 예치 -> 키 서버가 canViewProblem()으로 확인 후 복호화 키 발급
    function requestReviewAccess(uint256 _problemId) external nonReentrant {
        address sender = _msgSender();
        Problem storage p = problems[_problemId];
        require(p.active && p.status == 0, "Problem not open for review");
        require(!restrictSelfAction || sender != p.provider, "Provider cannot review own problem");
        require(!hasVoted[_problemId][sender], "Already voted on this problem");
        require(!committeeAssigned[_problemId] || isCommitteeMember[_problemId][sender], "Not assigned to review committee");
        require(reviewBond[_problemId][sender] == 0, "Review access already granted");
        require(balanceOf(sender) >= VERIFIER_STAKE, "Insufficient EDU for staking");

        _transfer(sender, address(this), VERIFIER_STAKE);
        reviewBond[_problemId][sender] = VERIFIER_STAKE;

        emit ReviewAccessGranted(_problemId, sender, VERIFIER_STAKE);
    }

    // 열람만 하고 투표하지 않은 검증자의 보증금은 문제 확정/삭제 이후에만 회수 가능 (열람 후 즉시 환불 방지)
    function refundReviewBond(uint256 _problemId) external nonReentrant {
        address sender = _msgSender();
        Problem storage p = problems[_problemId];
        require(p.status != 0 || !p.active, "Problem still under review");
        uint256 bond = reviewBond[_problemId][sender];
        require(bond > 0, "No review bond");

        reviewBond[_problemId][sender] = 0;
        _transfer(address(this), sender, bond);
        emit ReviewBondRefunded(_problemId, sender, bond);
    }

    // 키 서버(relayer)가 호출하는 단일 진실 소스: 이 주소가 문제 원문을 열람할 자격이 있는가?
    //  - 출제자 본인 / 구매 완료한 학생 / 투표 완료한 검증자 / 열람 보증금을 예치한 검증자
    function canViewProblem(uint256 _problemId, address _viewer) external view returns (bool) {
        Problem storage p = problems[_problemId];
        if (p.provider == address(0)) return false;
        return
            _viewer == p.provider ||
            hasPurchased[_problemId][_viewer] ||
            hasVoted[_problemId][_viewer] ||
            reviewBond[_problemId][_viewer] > 0;
    }

    // 4. 문제 구매 (학생이 실제로 EDU를 지불하고 열람권을 얻는 단계)
    // [토큰 이코노미] 검증 통과된 문제만 구매 가능하며, 결제된 price를
    // 그 자리에서 출제자 70% / 정답 검증자 20% / 운영 재고 10%로 실제 분배한다.
    function purchaseProblem(uint256 _problemId) external nonReentrant {
        address sender = _msgSender();
        Problem storage p = problems[_problemId];

        require(p.status == 1, "Problem not verified/purchasable");
        require(!hasPurchased[_problemId][sender], "Already purchased");
        require(!restrictSelfAction || sender != p.provider, "Provider cannot buy own problem");

        hasPurchased[_problemId][sender] = true;

        // 학생 지갑에서 컨트랙트로 price만큼 실제 결제
        _transfer(sender, address(this), p.price);

        uint256 providerCut = (p.price * PROVIDER_FEE) / 100;
        uint256 verifierCut = (p.price * VERIFIER_FEE) / 100;
        // 반올림 오차를 흡수하도록 운영 재고는 "나머지 전부"로 계산 (항상 정확히 100% 소진)
        uint256 platformCut = p.price - providerCut - verifierCut;

        claimableRewards[p.provider] += providerCut;

        address[] storage verifiers = correctVerifiersOf[_problemId];
        if (verifiers.length > 0) {
            // [평판 시스템] 20% 풀을 인원수로 균등 분배하지 않고, 각자의 평판 가중치
            // (getReputationWeight, 0.5x~2.0x) 비율대로 분배한다.
            uint256[] memory weights = new uint256[](verifiers.length);
            uint256 totalWeight = 0;
            for (uint i = 0; i < verifiers.length; i++) {
                weights[i] = getReputationWeight(verifiers[i]);
                totalWeight += weights[i];
            }

            uint256 distributed = 0;
            for (uint i = 0; i < verifiers.length; i++) {
                uint256 share = (verifierCut * weights[i]) / totalWeight;
                claimableRewards[verifiers[i]] += share;
                distributed += share;
            }
            // 나눗셈 나머지도 운영 재고로 귀속
            platformCut += (verifierCut - distributed);
        } else {
            // 정답 검증자가 없는 경우, 검증자 몫도 운영 재고로 귀속
            platformCut += verifierCut;
        }

        platformReserve += platformCut;

        emit ProblemPurchased(_problemId, sender, p.price);
    }

    // 운영 재고(10%) 인출 - 가스비 대납(릴레이어 충전), 유동성 공급 등 운영 목적으로만 사용
    function withdrawPlatformReserve(address to, uint256 amount) external onlyOwner {
        require(amount <= platformReserve, "Insufficient platform reserve");
        platformReserve -= amount;
        _transfer(address(this), to, amount);
    }

    function claimReward() external nonReentrant {
        address sender = _msgSender();
        uint256 reward = claimableRewards[sender];
        require(reward > 0, "No rewards to claim");
        claimableRewards[sender] = 0;
        // [토큰 이코노미 개편] 이제 claimableRewards는 항상 스테이킹 예치금 환급 또는
        // purchaseProblem()에서 실제로 지불된 EDU로만 채워지므로, 새로 발행(mint)하지 않고
        // 컨트랙트가 이미 보유한 실제 잔액에서 그대로 이체한다 (인플레이션 없는 보상).
        _transfer(address(this), sender, reward);
    }

    function faucet() external {
        _mint(_msgSender(), 100 * 10**18);
    }

    // ================================================================
    // ERC20 + ERC2771Context 다중 상속으로 인한 Context 함수 재정의
    // (ERC20과 ERC2771Context가 모두 Context를 상속하므로, 어떤 _msgSender
    //  구현을 쓸지 명시적으로 지정해야 컴파일된다. 실제 로직은 ERC2771Context
    //  쪽을 그대로 사용: msg.sender가 신뢰된 Forwarder이고 calldata 끝에
    //  20바이트 주소가 붙어있을 때만 그 주소를 실서명자로 인식한다.)
    // ================================================================
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}

//실제 몰수 기능 < (현재 예치금액만 몰수중)
//kleiss kappa <
//pdf 업로드 기능 (6월)
//ipfs 에 업로드 연동 <
//the graph 기능 <<
//front end 수정 (빼고)
//!문제 제출시 10 edu 예치 버그 있음 <

//6월 전

// ================== 8월 담당분 진행 상황 ==================
// [완료] ERC-2612 Permit 도입 -> ERC20Permit 상속으로 permit()/nonces()/DOMAIN_SEPARATOR() 자동 구현됨
// [완료] EIP-7702 대안으로 ERC-2771 메타트랜잭션 도입 -> contracts/Forwarder.sol + scripts/relayer.js 참고
//        (이유는 README.md의 "8월 파트 설명" 섹션 참고: 현재 ethers v6 + Hardhat 조합에서
//         진짜 EIP-7702 서명/전송은 아직 실무 표준 툴링이 부족해 캡스톤 범위에서는
//         ERC-2771(신뢰된 Forwarder + 서명 기반 릴레이)로 "가스비 대납" 목표를 실제로 구현함)
// [주의] constructor 인자가 (trustedForwarder) 로 바뀌었으므로 scripts/deploy.js 도 함께 확인할 것
// ===========================================================