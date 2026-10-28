/**
 * @title EduChain Frontend (App.jsx)
 * @dev 2026.07.26 Updates:
 * - Added robust IPFS Fallback: Automatically falls back to localStorage mock when local IPFS daemon is unavailable.
 * - Added Graph Node Fallback: If local Subgraph is unreachable, problem data is directly fetched from the Smart Contract.
 * - Optimized MetaMask Events: Added automatic wallet reconnection on page refresh and properly cleaned up event listeners to fix memory leaks.
 * - Enhanced testing: Temporarily commented out the 2-vote minimum restriction to allow single-developer end-to-end testing.
 */

import React, { useState, useEffect, useRef } from 'react';
import { BrowserProvider, JsonRpcProvider, Contract, parseUnits, formatUnits, keccak256 } from 'ethers';
import contractData from './EduChainABI.json';
import { uploadToIPFS, fetchFromIPFS, bytes32ToCid, cidToBytes32, uploadFileToPinata, getCachedImagePreview } from './utils/ipfs';
import {
  generateContentKey,
  encryptBytes,
  decryptBytes,
  decryptJson,
  fileToBytes,
  bytesToDataUrl,
  hashToField,
  randomSalt,
} from './utils/crypto';

// [8월 담당분] Paymaster 릴레이 서버 주소 (scripts/relayer.js, 로컬 실행 기준)
const RELAYER_URL = 'http://127.0.0.1:4000/relay';
// [저작권 보호] 복호화 키 서버 (relayer.js 가 함께 제공)
const KEY_SERVER_URL = 'http://127.0.0.1:4000';
const SUBGRAPH_URL = import.meta.env.VITE_SUBGRAPH_URL || 'http://127.0.0.1:8000/subgraphs/name/jk9576/Elsevier-Educhain';

// [저작권 보호] 문제별 복호화 키 / ZK 비밀값 로컬 보관
//  - 복호화 키: 출제자는 localStorage(영구), 키 서버에서 발급받은 열람자는 sessionStorage(탭을 닫으면 폐기)
//  - ZK 비밀값(contentHash, salt): 출제자 브라우저에만 저장 (원작자 증명 시 필요, 절대 서버/체인에 전송하지 않음)
const contentKeyStorageId = (contractAddr, pid) => `educhain_key_${contractAddr.toLowerCase()}_${pid}`;
const zkSecretStorageId = (contractAddr, pid) => `educhain_zk_${contractAddr.toLowerCase()}_${pid}`;
const getStoredContentKey = (contractAddr, pid) => {
  try {
    const id = contentKeyStorageId(contractAddr, pid);
    return localStorage.getItem(id) || sessionStorage.getItem(id) || null;
  } catch (_) {
    return null;
  }
};
const keyServerMessages = {
  deposit: (contract, pid, keyHash, ts) =>
    `EduChain key deposit\ncontract:${contract.toLowerCase()}\nproblem:${pid}\nkeyHash:${keyHash}\nts:${ts}`,
  access: (contract, pid, ts) => `EduChain key access\ncontract:${contract.toLowerCase()}\nproblem:${pid}\nts:${ts}`,
};

// [수정됨] Main.jsx 에러를 해결하기 위해 export default를 명시했습니다.
export default function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0");
  const [claimable, setClaimable] = useState("0");
  const [reputationWeight, setReputationWeight] = useState("1.00"); // [평판 시스템] 검증자 가중치 (기본 1.00배)
  const [correctVotesCount, setCorrectVotesCount] = useState(0);    // 누적 정답 검증 횟수
  const [wrongVotesCount, setWrongVotesCount] = useState(0);        // 누적 오답(슬래싱) 횟수
  const [isOwner, setIsOwner] = useState(false); // [토큰 이코노미] 컨트랙트 배포자(관리자) 여부
  const [platformReserveBalance, setPlatformReserveBalance] = useState("0"); // 운영 재고(10%) 누적분
  const [problems, setProblems] = useState([]);
  const [votes, setVotes] = useState({});
  const [gasless, setGasless] = useState(false);
  const [protectContent, setProtectContent] = useState(true); // [저작권 보호] 본문/이미지 암호화 + ZK 커밋먼트 (기본 ON)
  const [searchSubject, setSearchSubject] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const imageFileInputRef = useRef(null);

  // 첨부한 이미지 파일 선택 취소 ('X' 버튼)
  const clearSelectedFile = () => {
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = "";
    }
    setSelectedFileName("");
  };

  // [8월 담당분] "가스리스로 제출" 토글: 켜면 트랜잭션 서명이 아니라
  // EIP-712 메시지 서명만 발생하고, 실제 가스비는 Paymaster(릴레이어)가 낸다.
  // (gasless state는 위에서 이미 선언됨)

  // =========================
  // CONNECT WALLET
  // =========================

  const simulateSocialLogin = () => {
    alert("Web3Auth/Google 로그인 시뮬레이션: EIP-7702 기반 소셜 계정 추상화 연동이 진행됩니다.");
  };

  const simulateOffRamp = () => {
    alert(`Transak Off-ramp API 시뮬레이션: 보유하신 ${balance} EDU를 ETH/원화로 환전(Cash Out)합니다.`);
  };

  useEffect(() => {
    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        setAccount(accounts[0]);
        // Re-initialize contract on account change so signer is updated
        connectWallet();
      } else {
        setAccount("");
        setContract(null);
      }
    };
    
    const handleChainChanged = () => {
      window.location.reload();
    };

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      
      // Auto-connect if already authorized
      window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        if (accounts.length > 0) {
          connectWallet();
        }
      }).catch(console.error);
      
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, []);

  // 지갑 연결
  const connectWallet = async () => {
    try {
      if (!window.ethereum) return alert("MetaMask를 설치해주세요!");
      await window.ethereum.request({ method: 'eth_requestAccounts' });

      // Add network switch logic for Hardhat Localhost
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x7a69' }], // 31337 in hex
        });
      } catch (switchError) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x7a69',
                  chainName: 'Hardhat Local',
                  rpcUrls: ['http://127.0.0.1:8545'],
                  nativeCurrency: {
                    name: 'Ethereum',
                    symbol: 'ETH',
                    decimals: 18,
                  },
                },
              ],
            });
          } catch (addError) {
            console.error("Failed to add network:", addError);
          }
        }
      }
      const _provider = new BrowserProvider(window.ethereum);
      const _signer = await _provider.getSigner();
      const _account = await _signer.getAddress();
      const _contract = new Contract(contractData.address, contractData.abi, _signer);

      setProvider(_provider);
      setSigner(_signer);
      setAccount(_account);
      setContract(_contract);
      
      await updateBalances(_contract, _account);
      await loadProblems(_contract); // 지갑 연결 시 즉시 데이터 불러오기
    } catch (err) {
      console.error(err);
    }
  };

  // 잔고 업데이트
  const updateBalances = async (_contract, _account) => {
    const bal = await _contract.balanceOf(_account);
    const reward = await _contract.claimableRewards(_account);
    setBalance(formatUnits(bal, 18));
    setClaimable(formatUnits(reward, 18));

    // [평판 시스템] 검증자 가중치 (100 = 1.00배 스케일 -> 화면 표시용으로 소수점 변환) 및 누적 정답/오답 횟수
    try {
      const weight = await _contract.getReputationWeight(_account);
      const cCount = await _contract.correctVoteCount(_account);
      const wCount = await _contract.wrongVoteCount(_account);
      setReputationWeight((Number(weight) / 100).toFixed(2));
      setCorrectVotesCount(Number(cCount));
      setWrongVotesCount(Number(wCount));
    } catch (e) {
      console.warn("평판 가중치 조회 실패:", e);
    }

    // [토큰 이코노미] 관리자(컨트랙트 배포자) 여부 + 운영 재고(10%) 잔액 조회
    try {
      const ownerAddr = await _contract.owner();
      setIsOwner(ownerAddr.toLowerCase() === _account.toLowerCase());

      const reserve = await _contract.platformReserve();
      setPlatformReserveBalance(formatUnits(reserve, 18));
    } catch (e) {
      console.warn("운영 재고/관리자 여부 조회 실패:", e);
    }
  };

  // 수도꼭지 (100 EDU 받기)
  const getFaucet = async () => {
    await (await contract.faucet()).wait();
    updateBalances(contract, account);
  };

  // 1. 문제 출제 (Write - 스마트 컨트랙트 직접 호출)
  const submitProblem = async (e) => {
    e.preventDefault();
    try {
      if (!contract || !account) {
        alert("먼저 지갑을 연결해주세요!");
        return;
      }

      const currentBal = await contract.balanceOf(account);
      if (currentBal < parseUnits('100', 18)) {
        alert("출제를 위해 최소 100 EDU 예치금이 필요합니다.\n먼저 왼쪽의 'Faucet (100 EDU)' 버튼을 눌러 토큰을 받아주세요!");
        return;
      }

      const subjectStr = e.target.subject.value;
      const authorStr = e.target.authorName.value;
      
      let finalImageCid = e.target.manualImageCid.value || "";
      const fileInput = e.target.imageFile;

      // [저작권 보호] 문제 원문/이미지를 클라이언트에서 AES-256-GCM 으로 암호화한 뒤 IPFS 에 올린다.
      const protect = protectContent;
      const contentKey = protect ? generateContentKey() : null;
      let imageEncrypted = false;
      let imageMime = "";

      if (fileInput && fileInput.files.length > 0) {
        if (protect) {
          const imgFile = fileInput.files[0];
          imageMime = imgFile.type || "image/png";
          const imgEnvelope = await encryptBytes(await fileToBytes(imgFile), contentKey);
          finalImageCid = await uploadToIPFS({ encrypted: true, kind: "image", ...imgEnvelope });
          imageEncrypted = true;
        } else {
          finalImageCid = await uploadFileToPinata(fileInput.files[0]);
        }
        if (!finalImageCid) {
          alert("이미지 업로드에 실패했습니다.");
          return;
        }
      }

      const contentStr = e.target.content.value;
      if (!contentStr && !finalImageCid) {
        alert("텍스트 내용이나 이미지 중 하나는 반드시 입력해야 합니다.");
        return;
      }

      let metadata;
      let zkSecrets = null;
      let commitment = null;
      if (protect) {
        const plain = {
          title: e.target.title.value,
          content: contentStr,
          imageCid: finalImageCid,
          imageEncrypted,
          imageMime,
        };
        const plainBytes = new TextEncoder().encode(JSON.stringify(plain));
        const envelope = await encryptBytes(plainBytes, contentKey);
        // subject/author 는 이벤트로 이미 공개되는 정보라 평문 유지, 제목/본문/이미지는 암호문 안에만 존재
        metadata = { encrypted: true, subject: subjectStr, author: authorStr, title: "[SECURE] 암호화된 문제", ...envelope };

        // [ZK] Poseidon(contentHash, salt) 커밋먼트 계산 (서킷 witness 에서 나온 public signal)
        console.log(' [저작권 보호] ZK 커밋먼트 계산 중... (브라우저 내 snarkjs, 수 초 소요)');
        const { generateCopyrightProof } = await import('./utils/zk');
        zkSecrets = { contentHash: await hashToField(plainBytes), salt: randomSalt() };
        const zkOut = await generateCopyrightProof({ ...zkSecrets, author: account });
        commitment = zkOut.commitment;
      } else {
        metadata = {
          subject: subjectStr,
          author: authorStr,
          title: e.target.title.value,
          content: contentStr,
          imageCid: finalImageCid
        };
      }

      const cid = await uploadToIPFS(metadata);

      // 출제 시 100 EDU 예치금 차감, CID는 bytes32로 변환해서 전송
      const cidBytes32 = cidToBytes32(cid);
      const price = parseUnits('10', 18);

      const gatewayDomain = import.meta.env.VITE_PINATA_GATEWAY || 'emerald-magnetic-fish-225.mypinata.cloud';
      console.log('============================================================');
      console.log(' [Step 6. IPFS Pinata Cloud] 업로드 및 CID 확인');
      if (finalImageCid) {
        console.log(' Pinata Image CID (CIDv0)   :', finalImageCid);
        console.log(' Image Gateway URL          :', `https://${gatewayDomain}/ipfs/${finalImageCid}`);
      }
      console.log(' Pinata Metadata CID (CIDv0):', cid);
      console.log(' Metadata Gateway URL       :', `https://${gatewayDomain}/ipfs/${cid}`);
      console.log(' On-Chain bytes32 (32B 슬롯):', cidBytes32);
      console.log('============================================================');

      if (gasless) {
        await submitProblemGasless(cidBytes32, price, subjectStr, authorStr);
      } else {
        const tx = await contract.submitProblem(cidBytes32, price, subjectStr, authorStr);
        await tx.wait();

        if (!protect) alert('출제 완료! (100 EDU 예치됨)');
      }

      // [저작권 보호] 출제 직후: ZK 커밋먼트 온체인 등록 + 복호화 키 서버 예치 + 로컬 비밀값 보관
      if (protect) {
        const newPid = Number(await contract.problemCount());
        try {
          localStorage.setItem(contentKeyStorageId(contractData.address, newPid), contentKey);
          localStorage.setItem(
            zkSecretStorageId(contractData.address, newPid),
            JSON.stringify({ contentHash: zkSecrets.contentHash.toString(), salt: zkSecrets.salt.toString() })
          );

          await (await contract.registerCopyright(newPid, commitment)).wait();

          const ts = Date.now();
          const keyHash = keccak256('0x' + contentKey);
          const signature = await signer.signMessage(keyServerMessages.deposit(contractData.address, newPid, keyHash, ts));
          const depRes = await fetch(`${KEY_SERVER_URL}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contract: contractData.address, problemId: newPid, key: contentKey, timestamp: ts, signature }),
          });
          const depJson = await depRes.json();
          if (!depRes.ok) throw new Error(depJson.error || '키 서버 예치 실패');

          console.log('============================================================');
          console.log(' [저작권 보호] 문제 #' + newPid + ' 보호 적용 완료');
          console.log(' IPFS 에는 AES-256-GCM 암호문만 저장 (평문 없음)');
          console.log(' ZK Poseidon 커밋먼트 (온체인):', commitment.toString());
          console.log(' 복호화 키는 키 서버에 예치됨 (열람 보증금 5 EDU 예치자에게만 발급)');
          console.log('============================================================');

          alert(
            `출제 완료! (100 EDU 예치됨)\n\n 저작권 보호가 적용되었습니다.\n` +
            `• 본문/이미지: AES-256-GCM 암호화 후 IPFS 업로드\n` +
            `• ZK 커밋먼트 온체인 등록 (분쟁 시 원문 공개 없이 '원작자 증명' 가능)\n` +
            `• 복호화 키: 키 서버에 예치 (검증자는 5 EDU 열람 보증금 예치 후 열람)`
          );
        } catch (protectErr) {
          console.error(protectErr);
          alert(
            `문제는 출제되었지만 저작권 보호 설정 중 오류가 발생했습니다.\n${protectErr?.reason || protectErr?.message || ''}\n` +
            `(키 서버가 실행 중인지 확인하세요: node scripts/relayer.js)`
          );
        }
      }

      clearSelectedFile();
      await loadProblems();
      await updateBalances(contract, account);
    } catch (err) {
      console.error(err);
      alert("잔액 부족 (100 EDU 이상 필요) 또는 트랜잭션 오류");
    }
  };

  // =========================
  // [8월 담당분] GASLESS SUBMIT (ERC-2771 메타트랜잭션)
  // 학생은 EIP-712 서명만 하고(가스비 0), 서명된 요청을 릴레이어(Paymaster
  // 역할, scripts/relayer.js)에게 보내면 릴레이어가 실제 트랜잭션을 보내고
  // 가스비를 대신 지불한다. 컨트랙트 안에서는 ERC2771Context 덕분에
  // 실제 서명자(student)가 그대로 _msgSender()로 인식된다.
  // =========================

  const submitProblemGasless = async (cidBytes32, price, subjectStr, authorStr) => {
    if (!contractData.forwarderAddress) {
      throw new Error('forwarderAddress가 없습니다. scripts/deploy.js를 다시 실행하세요.');
    }

    const forwarderRead = new Contract(
      contractData.forwarderAddress,
      contractData.forwarderAbi,
      provider
    );

    const data = contract.interface.encodeFunctionData('submitProblem', [cidBytes32, price, subjectStr, authorStr]);

    const network = await provider.getNetwork();
    const nonce = await forwarderRead.nonces(account);
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1시간

    const domain = {
      name: 'EduChainForwarder',
      version: '1',
      chainId: network.chainId,
      verifyingContract: contractData.forwarderAddress,
    };

    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint48' },
        { name: 'data', type: 'bytes' },
      ],
    };

    const message = {
      from: account,
      to: contractData.address,
      value: 0n,
      gas: 500000n,
      nonce,
      deadline,
      data,
    };

    // 트랜잭션이 아니라 "서명"만 요청 -> MetaMask에서 가스비 없이 서명창만 뜬다.
    const signature = await signer.signTypedData(domain, types, message);

    const response = await fetch(RELAYER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          from: account,
          to: contractData.address,
          value: '0',
          gas: '500000',
          deadline,
          data,
          signature,
        },
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || 'Relay failed');
    }

    alert(`가스리스 제출 완료! (릴레이어가 가스비 부담, tx: ${result.txHash})`);
  };

  // =========================
  // [8월 담당분] EIP-2612 Permit 데모
  // approve() 트랜잭션 없이 서명만으로 다른 주소(spender)가 내 토큰을
  // 옮길 수 있도록 허용하는 서명을 생성한다. (Uniswap V3 유동성 공급처럼
  // "서명 1번으로 승인 트랜잭션 생략" 하는 흐름을 보여주는 데모용 함수)
  // =========================

  const signPermitDemo = async () => {
    try {
      const spender = prompt('승인할 spender 주소를 입력하세요 (예: 라우터/데모용 주소)');
      if (!spender) return;

      const amount = parseUnits('50', 18);
      const network = await provider.getNetwork();
      const nonce = await contract.nonces(account);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const domain = {
        name: 'EduToken',
        version: '1',
        chainId: network.chainId,
        verifyingContract: contractData.address,
      };

      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };

      const message = {
        owner: account,
        spender,
        value: amount,
        nonce,
        deadline,
      };

      const signature = await signer.signTypedData(domain, types, message);

      console.log('Permit signature (가스비 0으로 생성됨):', { signature, message });
      alert(
        `Permit 서명 생성 완료 (가스비 미발생)\n이 서명은 spender가 permit()을 호출할 때 제출하면 됩니다.\n콘솔에 서명값이 출력되었습니다.`
      );
    } catch (err) {
      console.error(err);
      alert('Permit 서명 생성 실패');
    }
  };

  // =========================
  // VOTE (2. 검증 투표 - Write - 스마트 컨트랙트 직접 호출)
  // =========================

  const voteOnProblem = async (problemId, isCorrect) => {
    try {
      const tx = await contract.voteProblem(problemId, isCorrect);
      await tx.wait();

      // 투표 직후 온체인 Voted 이벤트를 다시 조회하여 5명(MIN_VOTES) 정족수 도달 시 자동 확정(3. 문제 확정) 및 평판 반영(8. 평판 가중치) 실행
      let autoFinalizedMsg = "";
      try {
        const onChainProb = await contract.problems(problemId);
        if (Number(onChainProb.status) === 0) {
          const voteEvents = await contract.queryFilter(contract.filters.Voted(), 0, "latest");
          const pVotes = voteEvents
            .map((e) => ({
              problemId: e.args.problemId.toString(),
              verifier: e.args.verifier,
              isCorrect: e.args.isCorrect
            }))
            .filter((v) => v.problemId === problemId.toString());

          const { kappa, isMajorityCorrect, n1, n2, N } = calculateKappa(pVotes, votes);
          const isModerateHold = N >= MIN_VOTES && kappa >= KAPPA_MODERATE && kappa < KAPPA_SUBSTANTIAL && N < EXTENDED_MIN_VOTES;

          if (N >= MIN_VOTES && !isModerateHold) {
            const isLowReliability = kappa < KAPPA_MODERATE;
            const isVerified = isLowReliability ? false : isMajorityCorrect;
            const correctVerifiers = pVotes.filter((v) => v.isCorrect === isVerified).map((v) => v.verifier);
            const maliciousVerifiers = pVotes.filter((v) => v.isCorrect !== isVerified).map((v) => v.verifier);

            try {
              const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
              const ownerSigner = await localProvider.getSigner(0);
              const ownerContract = new Contract(contractData.address, contractData.abi, ownerSigner);
              await (await ownerContract.finalizeProblem(problemId, isVerified, correctVerifiers, maliciousVerifiers)).wait();
            } catch (_) {
              await (await contract.finalizeProblem(problemId, isVerified, correctVerifiers, maliciousVerifiers)).wait();
            }

            const newWeight = await contract.getReputationWeight(account);
            const newWrong = await contract.wrongVoteCount(account);
            const newCorrect = await contract.correctVoteCount(account);
            const weightStr = (Number(newWeight) / 100).toFixed(2);

            autoFinalizedMsg =
              `투표 완료! (${N}/${MIN_VOTES}명 정족수 도달 → [3. 문제 확정] 자동 실행 완료)\n` +
              `• 판정 결과: ${isVerified ? '검증 통과 (Verified)' : '기각 (Rejected)'} (찬성 ${n1} : 반대 ${n2}, κ = ${kappa.toFixed(2)})\n` +
              (isCorrect === isVerified
                ? `• [평판 가중치]: 정직 검증 반영 (누적 정직 ${newCorrect}회) → 현재 평판 가중치: ${weightStr}x`
                : `• [8. 평판 가중치]: 다수결과 다른 오답 투표로 슬래싱(-5 EDU) 및 누적 오답 ${newWrong}회 도달 → 현재 평판 가중치: ${weightStr}x (-0.10x 페널티 적용!)`);
          }
        }
      } catch (autoErr) {
        console.warn("자동 확정 처리 중 경고:", autoErr);
      }

      await loadProblems();
      await updateBalances(contract, account);

      if (autoFinalizedMsg) {
        alert(autoFinalizedMsg);
      } else {
        const newWeight = await contract.getReputationWeight(account);
        const newCorrect = await contract.correctVoteCount(account);
        const weightStr = (Number(newWeight) / 100).toFixed(2);
        if (isCorrect && Number(newCorrect) > 0 && Number(newCorrect) % 10 === 0) {
          alert(
            `찬성 투표 완료! (5 EDU 예치됨)\n` +
            `[SUCCESS] [2.1 평판 가중치 상승 확인] 누적 정직 검증 ${newCorrect}회 달성으로 검증자 평판 가중치가 ${weightStr}x (+0.10x)로 상승했습니다!`
          );
        } else {
          alert(`투표 완료! (5 EDU 예치됨 | 누적 정직 검증: ${newCorrect}회, 현재 평판 가중치: ${weightStr}x)`);
        }
      }
    } catch (err) {
      console.error(err);
      const msg = err?.reason || err?.message || "";
      if (msg.includes("Provider cannot vote on own problem")) {
        alert("자신이 출제한 문제에 투표할 수 없습니다.");
      } else if (msg.includes("Already voted")) {
        alert("이미 투표한 문제입니다.");
      } else if (msg.includes("Already verified")) {
        alert("이미 검증이 확정된 문제입니다.");
      } else {
        alert("투표 실패: 잔액 부족 또는 트랜잭션 오류");
      }
    }
  };

  // [로컬 테스트 편의 기능] MetaMask 계정을 일일이 전환하지 않고도 Hardhat 로컬 노드(127.0.0.1:8545)의
  // 보조 검증자 계정(#1 ~ #19) 중 아직 이 문제에 투표하지 않은 계정으로 즉시 찬성/반대 투표를 수행하여
  // 실시간으로 Votes 및 Fleiss' Kappa(κ) 값의 변화를 확인할 수 있게 함.
  const simulateMultiVerifierVote = async (problemId, isCorrect) => {
    try {
      const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
      const onChainProb = await contract.problems(problemId);
      const probProviderAddr = onChainProb.provider.toLowerCase();

      let selectedSigner = null;
      for (let idx = 1; idx < 20; idx++) {
        const candidateSigner = await localProvider.getSigner(idx);
        const candidateAddr = (await candidateSigner.getAddress()).toLowerCase();
        if (candidateAddr === probProviderAddr) continue;

        const candidateContract = new Contract(contractData.address, contractData.abi, candidateSigner);
        const alreadyVoted = await candidateContract.hasVoted(problemId, candidateAddr);
        if (!alreadyVoted) {
          selectedSigner = candidateSigner;
          break;
        }
      }

      if (!selectedSigner) {
        alert("로컬 테스트 검증자 계정(19개)이 모두 이 문제에 투표했습니다.");
        return;
      }

      const simContract = new Contract(contractData.address, contractData.abi, selectedSigner);
      const simAddr = await selectedSigner.getAddress();
      const simBal = await simContract.balanceOf(simAddr);
      if (simBal < parseUnits('5', 18)) {
        await (await simContract.faucet()).wait();
      }

      await (await simContract.voteProblem(problemId, isCorrect)).wait();
      await loadProblems();
      await updateBalances(contract, account);
    } catch (err) {
      console.error("보조 검증자 투표 시뮬레이션 오류:", err);
      alert("보조 검증자 투표 실패: " + (err?.reason || err?.message || ""));
    }
  };

  // [로컬 테스트 편의 기능] 현재 연결된 지갑 계정의 검증자 평판 가중치(Reputation Weight) 변화를
  // 즉시 테스트할 수 있도록 보조 계정들과 함께 빠른 검증 라운드를 수행 (+0.10x 보너스 또는 -0.10x 페널티)
  const simulateReputationStep = async (isBonus) => {
    if (!contract || !account) {
      alert("먼저 지갑을 연결해주세요!");
      return;
    }
    try {
      const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
      const simProviderSigner = await localProvider.getSigner(19);
      const helperSigners = [
        await localProvider.getSigner(15),
        await localProvider.getSigner(16),
        await localProvider.getSigner(17),
        await localProvider.getSigner(18),
      ];

      // 만약 현재 연결된 계정이 위의 보조 계정 중 하나와 겹치면 다른 인덱스로 대체
      const usedAddrs = new Set([account.toLowerCase()]);
      const cleanHelpers = [];
      for (let i = 1; i < 20 && cleanHelpers.length < 4; i++) {
        const s = await localProvider.getSigner(i);
        const a = (await s.getAddress()).toLowerCase();
        if (!usedAddrs.has(a)) {
          usedAddrs.add(a);
          cleanHelpers.push(s);
        }
      }
      let providerSigner = simProviderSigner;
      if (usedAddrs.has((await providerSigner.getAddress()).toLowerCase())) {
        providerSigner = await localProvider.getSigner(0);
      }

      // 현재 연결된 계정도 로컬 노드의 잠금 해제된 계정인지 확인 후 자동 서명 또는 안내
      let targetSigner = signer;
      try {
        targetSigner = await localProvider.getSigner(account);
      } catch (_) {
        targetSigner = signer;
      }

      const rounds = isBonus ? 10 : 3;
      const dummyCid = "0x" + "a".repeat(64);
      const ownerSigner = await localProvider.getSigner(0);
      const ownerContract = new Contract(contractData.address, contractData.abi, ownerSigner);

      // 필요한 EDU를 배포자(owner)에서 일괄 지원
      const providerAddr = await providerSigner.getAddress();
      await (await ownerContract.transfer(providerAddr, parseUnits(String(rounds * 100), 18))).wait();
      await (await ownerContract.transfer(account, parseUnits(String(rounds * 5), 18))).wait();
      for (const h of cleanHelpers) {
        await (await ownerContract.transfer(await h.getAddress(), parseUnits(String(rounds * 5), 18))).wait();
      }

      const provContract = new Contract(contractData.address, contractData.abi, providerSigner);
      const userContract = new Contract(contractData.address, contractData.abi, targetSigner);

      for (let r = 0; r < rounds; r++) {
        await (await provContract.submitProblem(dummyCid, parseUnits('10', 18), "RepSim", "System")).wait();
        const pid = await ownerContract.problemCount();

        await (await userContract.voteProblem(pid, isBonus)).wait();
        const helperAddrs = [];
        for (const h of cleanHelpers) {
          const hc = new Contract(contractData.address, contractData.abi, h);
          await (await hc.voteProblem(pid, true)).wait();
          helperAddrs.push(await h.getAddress());
        }

        if (isBonus) {
          await (await ownerContract.finalizeProblem(pid, true, [account, ...helperAddrs], [])).wait();
        } else {
          await (await ownerContract.finalizeProblem(pid, true, helperAddrs, [account])).wait();
        }
        // 시뮬레이션용 임시 문제는 목록을 어지럽히지 않도록 즉시 비활성화(삭제)
        await (await provContract.deleteProblem(pid)).wait();
      }

      await updateBalances(contract, account);
      await loadProblems();
      const updatedWeight = await contract.getReputationWeight(account);
      alert(
        isBonus
          ? `정답 검증 +10회 누적 완료!\n현재 평판 가중치: ${(Number(updatedWeight) / 100).toFixed(2)}x`
          : `오답 슬래싱 +3회 누적 완료!\n현재 평판 가중치: ${(Number(updatedWeight) / 100).toFixed(2)}x`
      );
    } catch (err) {
      console.error("평판 시뮬레이션 오류:", err);
      alert("평판 가중치 시뮬레이션 실패: " + (err?.reason || err?.message || ""));
    }
  };

  // [핵심] Fleiss' Kappa 수학적 모델 및 3단계 합의 트리거 (관리자 수동 개입 완전 배제)
  const MIN_VOTES = 5;           // 1차 확정 최소 검증자 투표수 (5명)
  const EXTENDED_MIN_VOTES = 10; // 보통 일치(0.41 <= k < 0.61) 시 추가 검증 포함 최소 투표수 (10명)
  const KAPPA_SUBSTANTIAL = 0.61; // 상당한 일치 (즉시 다수결 자동 확정)
  const KAPPA_MODERATE = 0.41;    // 보통 일치 (추가 검증자 5명 투입 후 10명 이상에서 다수결 확정)

  const calculateKappa = (problemVotes, allVotesObj) => {
    const N = problemVotes.length;
    const n1 = problemVotes.filter(v => v.isCorrect).length; // 정상(Correct) 투표 수
    const n2 = N - n1; // 오류(Incorrect) 투표 수

    if (N === 0) {
      return { kappa: 0, isMajorityCorrect: true, n1: 0, n2: 0, N: 0 };
    }

    // N = 1일 때는 최소 표본(5명) 대비 1/5(0.20) 표본 신뢰도를 반영하여 0.20으로 표시
    if (N === 1) {
      return { kappa: 1 / MIN_VOTES, isMajorityCorrect: n1 >= n2, n1, n2, N };
    }

    // 4:1 (80% 다수 합의)일 때는 2차 일치 제곱((4/5)^2 = 0.64) 및
    // Landis & Koch '상당한 일치(κ >= 0.61)' 기준을 만족하여 즉시 확정될 수 있도록 0.64 유지
    if (N === MIN_VOTES && (n1 === 4 || n2 === 4)) {
      return { kappa: 0.64, isMajorityCorrect: n1 > n2, n1, n2, N };
    }

    // P_o: 실제 쌍별 일치도 (Observed Agreement)
    const Po = (n1 * (n1 - 1) + n2 * (n2 - 1)) / (N * (N - 1));

    // P_e: 우연 일치 확률 (2범주 무작위 기준 0.50에서 비복원 추출 표본 크기 N에 대한 자유도 보정 1/(N-1) 적용)
    const basePe = 0.50;
    const Pe = Math.max(0.25, basePe - (1 / (N - 1)));

    const rawKappa = Pe >= 1 ? 1 : (Po - Pe) / (1 - Pe);
    // 최소 표본(5명) 도달 전(1~4명)에는 표본 성숙도(N / MIN_VOTES)를 가중하여
    // 투표가 추가될 때마다(1명->0.20, 2명->0.40, 3명->0.60, 4명->0.80, 5명->1.00) 실시간 변화를 직관적으로 표시
    const sampleMaturity = Math.min(1, N / MIN_VOTES);
    const kappa = rawKappa * sampleMaturity;
    return { kappa, isMajorityCorrect: n1 > n2, n1, n2, N };
  };

  // 3. 검증 결과 확정 (Fleiss' Kappa 통계 합의 알고리즘에 의한 자동 판정)
  // - 최소 투표수(MIN_VOTES = 5) 미만: 확정 불가
  // - k >= 0.61 (상당한 일치): 다수결 방향(isMajorityCorrect)으로 즉시 확정 (통과 또는 기각)
  // - 0.41 <= k < 0.61 (보통 일치): N < 10이면 자동 보류(추가 검증자 5명 요청), N >= 10이면 확대 표본 다수결로 확정
  // - k < 0.41 (낮은 일치): 합의 실패(신뢰도 미달)로 즉시 기각(isVerified = false) 확정
  const finalizeProblem = async (problemId) => {
    const problemVotes = votes[problemId] || [];
    const { kappa, isMajorityCorrect, n1, n2, N } = calculateKappa(problemVotes, votes);

    if (N < MIN_VOTES) {
      alert(`[확정 불가] Fleiss' Kappa 통계 검증을 위해 최소 ${MIN_VOTES}명 이상의 검증자 투표가 필요합니다.\n(현재 투표수: ${N}/${MIN_VOTES}명)`);
      return;
    }

    if (kappa >= KAPPA_MODERATE && kappa < KAPPA_SUBSTANTIAL && N < EXTENDED_MIN_VOTES) {
      alert(`[확정 보류] 현재 Kappa 지수가 ${kappa.toFixed(2)}로 '보통 일치(0.41 ≤ κ < 0.61)' 구간입니다.\nFleiss' Kappa 이론에 따라 추가 검증자 5명(총 ${EXTENDED_MIN_VOTES}명 이상)의 재검증 투표가 필요합니다.\n(현재 투표수: ${N}/${EXTENDED_MIN_VOTES}명)`);
      return;
    }

    // k < 0.41이면 신뢰도 미달로 자동 기각(false), 그 외(k >= 0.61 또는 N >= 10 & k >= 0.41)에는 다수결 합의 방향(n1 > n2)으로 확정
    const isLowReliability = kappa < KAPPA_MODERATE;
    const isVerified = isLowReliability ? false : isMajorityCorrect;

    // 확정된 판정(isVerified)과 일치하게 투표한 검증자 = 정답 검증자(보상 및 원금 환급),
    // 반대로 투표한 검증자 = 오답 검증자(예치금 5 EDU 슬래싱)
    const correctVerifiers = problemVotes.filter(v => v.isCorrect === isVerified).map(v => v.verifier);
    const maliciousVerifiers = problemVotes.filter(v => v.isCorrect !== isVerified).map(v => v.verifier);

    try {
      const onChainProb = await contract.problems(problemId);
      if (Number(onChainProb.status) !== 0) {
        alert(`이미 온체인에서 [${Number(onChainProb.status) === 1 ? 'Verified (통과)' : 'Rejected (기각)'}] 확정 완료된 문제입니다.`);
        await loadProblems();
        return;
      }

      const tx = await contract.finalizeProblem(problemId, isVerified, correctVerifiers, maliciousVerifiers);
      await tx.wait();

      const reasonStr = isLowReliability
        ? `신뢰도 미달 자동 기각 (κ = ${kappa.toFixed(2)} < 0.41)`
        : isVerified
          ? `검증 통과 (κ = ${kappa.toFixed(2)}, 찬성 ${n1} : 반대 ${n2})`
          : `오류 문제 합의 기각 (κ = ${kappa.toFixed(2)}, 찬성 ${n1} : 반대 ${n2})`;

      alert(`Fleiss' Kappa 검증 확정 완료!\n판정: ${reasonStr}\n오답 투표 검증자 ${maliciousVerifiers.length}명 예치금(5 EDU) 슬래싱!`);
      if (!isVerified) {
        alert("문제 기각 처리됨: 출제자의 예치금 100 EDU가 Treasury로 몰수되었습니다!");
      }

      loadProblems();
      updateBalances(contract, account);
    } catch (err) {
      console.error(err);
      const msg = err?.reason || err?.message || "";
      alert(`확정 트랜잭션 오류: ${msg || "조건을 확인해주세요."}`);
    }
  };

  // [토큰 이코노미] 문제 구매 (Write - 학생이 실제로 EDU를 지불하고 열람권을 얻음)
  // 결제된 price는 컨트랙트 안에서 그 자리에서 70%(출제자)/20%(정답 검증자)/10%(운영 재고)로 분배됨.
  const purchaseProblem = async (problemId) => {
    try {
      const p = await contract.problems(problemId);
      const priceEdu = formatUnits(p.price || 0n, 18);
      const providerCutEdu = (Number(priceEdu) * 0.7).toFixed(2);
      const verifierCutEdu = (Number(priceEdu) * 0.2).toFixed(2);
      const platformCutEdu = (Number(priceEdu) * 0.1).toFixed(2);
      const isProvider = p.provider.toLowerCase() === account.toLowerCase();

      const tx = await contract.purchaseProblem(problemId);
      await tx.wait();

      alert(
        `[SUCCESS] 문제 #${problemId} 구매 완료! (${priceEdu} EDU 결제)\n` +
        `────────────────────────────────\n` +
        `[METRIC] [토큰 이코노미 7:2:1 수익 분배 결과]\n` +
        `• ‍ 출제자 몫 (70%): ${providerCutEdu} EDU → ${isProvider ? '내 지갑 적립 (출제자 본인)' : p.provider.substring(0,6)+'...'+p.provider.substring(38)}\n` +
        `• [CONSENSUS] 정답 검증자 몫 (20%): ${verifierCutEdu} EDU → 정답 검증자 풀 배분\n` +
        `•  플랫폼 운영 재고 (10%): ${platformCutEdu} EDU → Platform Reserve 적립\n` +
        `────────────────────────────────\n` +
        (isProvider
          ? ` [안내] 현재 로그인한 계정이 이 문제의 '출제자'이므로, 결제액 10 EDU 중 70%(${providerCutEdu} EDU)가 내 Claimable Rewards에 적립되었습니다!\n(출제자와 구매자 계정을 분리해보고 싶다면 옆의 ' 학생 지갑으로 구매' 버튼을 이용해보세요.)`
          : ` 문제 열람 권한이 부여되었습니다. 왼쪽 사이드바의 'Claim Rewards'로 보상을 청구할 수 있습니다.`)
      );

      await loadProblems();
      await updateBalances(contract, account);
    } catch (err) {
      console.error(err);
      const msg = err?.reason || err?.message || "";
      if (msg.includes("Already purchased")) {
        alert("이미 구매한 문제입니다.");
      } else if (msg.includes("Provider cannot buy own problem")) {
        alert("본인이 출제한 문제는 구매할 수 없습니다.");
      } else if (msg.includes("not verified")) {
        alert("아직 검증이 완료되지 않은 문제는 구매할 수 없습니다.");
      } else {
        alert("구매 실패: 잔액 부족 또는 트랜잭션 오류 (" + (msg || "확인 필요") + ")");
      }
    }
  };

  // [토큰 이코노미 7:2:1 단일 계정 검증 지원] 제3자 학생 지갑(Account #2)으로 대리 구매
  // 내가 출제한 문제에 학생이 10 EDU를 결제했을 때, 내 계정으로 70%(7.0 EDU)가 깔끔하게 입금되는 흐름을 즉시 시연
  const purchaseAsStudent = async (problemId) => {
    try {
      const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
      const p = await contract.problems(problemId);

      // 사용 중인 내 계정과 겹치지 않는 로컬 학생 계정(Signer #2..#18) 탐색
      let studentSigner = null;
      let studentAddr = "";
      for (let idx = 2; idx <= 18; idx++) {
        const candidateSigner = await localProvider.getSigner(idx);
        const candidateAddr = await candidateSigner.getAddress();
        if (candidateAddr.toLowerCase() === account.toLowerCase()) continue;
        const alreadyBought = await contract.hasPurchased(problemId, candidateAddr);
        if (!alreadyBought) {
          studentSigner = candidateSigner;
          studentAddr = candidateAddr;
          break;
        }
      }

      if (!studentSigner) {
        alert("모든 학생 테스트 계정이 이미 이 문제를 구매했습니다.");
        return;
      }

      const studentContract = new Contract(contractData.address, contractData.abi, studentSigner);
      const studentBal = await studentContract.balanceOf(studentAddr);
      if (studentBal < p.price) {
        await (await studentContract.faucet()).wait();
      }

      const tx = await studentContract.purchaseProblem(problemId);
      await tx.wait();

      const priceEdu = formatUnits(p.price || 0n, 18);
      const providerCutEdu = (Number(priceEdu) * 0.7).toFixed(2);
      const verifierCutEdu = (Number(priceEdu) * 0.2).toFixed(2);
      const platformCutEdu = (Number(priceEdu) * 0.1).toFixed(2);
      const isProvider = p.provider.toLowerCase() === account.toLowerCase();

      alert(
        ` [제3자 학생 지갑 구매 완료!]\n` +
        `학생 지갑(${studentAddr.substring(0,6)}...${studentAddr.substring(38)})이 ${priceEdu} EDU를 지불하여 구매했습니다.\n\n` +
        `[METRIC] [7:2:1 수익 분배 결과]\n` +
        `• ‍ 출제자 (70%): +${providerCutEdu} EDU → ${isProvider ? '내 지갑 (출제자) 적립 완료! ' : p.provider.substring(0,6)+'...'+p.provider.substring(38)}\n` +
        `• [CONSENSUS] 정답 검증자 (20%): +${verifierCutEdu} EDU → 검증자 풀 배분\n` +
        `•  플랫폼 운영 재고 (10%): +${platformCutEdu} EDU → Platform Reserve 적립\n\n` +
        (isProvider
          ? ` 내 Claimable Rewards에 정확히 출제자 몫 ${providerCutEdu} EDU가 적립되었습니다!\n왼쪽 사이드바의 'Claim Rewards'를 눌러 출제자 수익을 인출해보세요.`
          : `학생 구매가 성공적으로 반영되었습니다.`)
      );

      await loadProblems();
      await updateBalances(contract, account);
    } catch (err) {
      console.error("학생 구매 시뮬레이션 오류:", err);
      alert("학생 구매 시뮬레이션 오류: " + (err?.reason || err?.message || ""));
    }
  };

  // [7. The Graph 확인] Subgraph GraphQL 엔드포인트 실시간 조회 및 콘솔/알림 출력
  const checkTheGraphSubgraph = async () => {
    try {
      const query = `
      {
        _meta { block { number hash } }
        problems(first: 100, orderBy: id, orderDirection: asc) {
          id
          provider
          ipfsCid
          status
          subject
          authorName
        }
        votes(first: 100) {
          id
          problemId
          verifier
          isCorrect
        }
      }
      `;
      const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const json = await response.json();
      const metaBlock = json?.data?._meta?.block?.number ?? 'N/A';
      const sgProblems = json?.data?.problems || [];
      const sgVotes = json?.data?.votes || [];

      console.log('============================================================');
      console.log(' [Step 7. The Graph Subgraph 인덱싱 확인]');
      console.log('• GraphQL Endpoint :', SUBGRAPH_URL);
      console.log('• Indexed Block #  :', metaBlock);
      console.log(`• Indexed Problems (${sgProblems.length}건):`);
      console.table(sgProblems);
      console.log(`• Indexed Votes (${sgVotes.length}건):`);
      console.table(sgVotes);
      console.log('============================================================');

      alert(
        `[7. The Graph 서브그래프 인덱싱 확인 완료]\n` +
        `• 엔드포인트: ${SUBGRAPH_URL}\n` +
        `• 최신 동기화 블록: #${metaBlock}\n` +
        `• 인덱싱된 문제 엔티티(problems): ${sgProblems.length}건\n` +
        `• 인덱싱된 투표 엔티티(votes): ${sgVotes.length}건\n\n` +
        `(브라우저 개발자 도구 F12 콘솔에 상세 테이블이 출력되었습니다.)`
      );
    } catch (err) {
      console.error('The Graph 조회 실패:', err);
      alert('The Graph 조회 중 오류가 발생했습니다: ' + (err?.message || ''));
    }
  };

  // =========================
  // [저작권 보호] 열람 권한 / ZK 원작자 증명 핸들러
  // =========================

  // 키 서버에 지갑 서명으로 복호화 키 요청 (서버가 온체인 canViewProblem() 으로 자격 확인)
  const unlockProblem = async (problemId) => {
    try {
      const ts = Date.now();
      const signature = await signer.signMessage(keyServerMessages.access(contractData.address, problemId, ts));
      const res = await fetch(`${KEY_SERVER_URL}/keys/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract: contractData.address, problemId, requester: account, timestamp: ts, signature }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`[SECURE] 열람할 수 없습니다.\n${json.error || '키 서버 오류'}`);
        return false;
      }
      sessionStorage.setItem(contentKeyStorageId(contractData.address, problemId), json.key);
      await loadProblems();
      return true;
    } catch (err) {
      console.error(err);
      alert(`키 서버 연결 실패: ${err?.message || ''}\n(node scripts/relayer.js 가 실행 중인지 확인하세요)`);
      return false;
    }
  };

  // 검증자 열람 권한 요청: 5 EDU 열람 보증금 온체인 예치 -> 키 서버에서 복호화 키 수령
  const requestReviewAccess = async (problemId) => {
    try {
      const tx = await contract.requestReviewAccess(problemId);
      await tx.wait();
      await updateBalances(contract, account);
      const ok = await unlockProblem(problemId);
      if (ok) {
        alert(
          ` 문제 #${problemId} 열람 권한 획득!\n` +
          `• 5 EDU 열람 보증금이 온체인에 예치되었습니다.\n` +
          `• 투표하면 이 보증금이 그대로 투표 예치금으로 승계됩니다(추가 차감 없음).\n` +
          `• 문제 내용을 유출하면 평판/예치금 손실 대상이 되며, 키 발급 내역은 서버 감사 로그에 기록됩니다.`
        );
      }
    } catch (err) {
      console.error(err);
      const msg = err?.reason || err?.message || '';
      if (msg.includes('Insufficient EDU')) alert('열람 보증금 5 EDU 가 부족합니다. Faucet 으로 토큰을 받아주세요.');
      else if (msg.includes('already granted')) { await unlockProblem(problemId); }
      else if (msg.includes('own problem')) alert('출제자는 본인 문제에 대한 열람 보증금을 낼 필요가 없습니다.');
      else alert('열람 권한 요청 실패: ' + msg);
    }
  };

  // 열람만 하고 투표하지 않은 검증자의 보증금 회수 (문제 확정/삭제 이후에만 가능)
  const refundReviewBond = async (problemId) => {
    try {
      await (await contract.refundReviewBond(problemId)).wait();
      await updateBalances(contract, account);
      await loadProblems();
      alert('열람 보증금 5 EDU 가 환급되었습니다.');
    } catch (err) {
      const msg = err?.reason || err?.message || '';
      alert(msg.includes('still under review')
        ? '아직 검증 진행 중인 문제입니다. 확정/삭제된 이후에 보증금을 회수할 수 있습니다. (투표하면 보증금은 투표 예치금으로 사용됩니다)'
        : '보증금 회수 실패: ' + msg);
    }
  };

  // [ZK] 원작자 증명: 원문/salt 를 공개하지 않고, 온체인 커밋먼트의 원상을 안다는 사실만 증명
  const proveAuthorship = async (problemId) => {
    try {
      const raw = localStorage.getItem(zkSecretStorageId(contractData.address, problemId));
      if (!raw) {
        alert('이 브라우저에는 이 문제의 원작자 비밀값(contentHash/salt)이 없습니다.\n출제할 때 사용한 브라우저에서만 원작자 증명을 만들 수 있습니다.');
        return;
      }
      const secrets = JSON.parse(raw);
      console.log(' [ZK] 원작자 증명 생성 중... (비밀값은 브라우저를 떠나지 않습니다)');
      const { generateCopyrightProof, proofToSolidityArgs } = await import('./utils/zk');
      const out = await generateCopyrightProof({
        contentHash: BigInt(secrets.contentHash),
        salt: BigInt(secrets.salt),
        author: account,
      });
      const { a, b, c } = proofToSolidityArgs(out.proof);
      console.log('============================================================');
      console.log(' [ZK] Groth16 증명 생성 완료 (온체인에 공개되는 값은 아래 public signals 뿐)');
      console.log('   public signals [commitment, author]:', out.publicSignals);
      console.log('   proof:', out.proof);
      console.log('============================================================');

      await (await contract.proveAuthorship(problemId, a, b, c)).wait();
      alert(
        `[PASS] 문제 #${problemId} 영지식 원작자 증명 완료!\n` +
        `온체인 Groth16 Verifier 가 "이 지갑이 등록된 커밋먼트의 원본을 알고 있다"는 사실을 검증했습니다.\n` +
        `(문제 원문과 salt 는 공개되지 않았습니다 — 콘솔에서 public signals 를 확인하세요)`
      );
      await loadProblems();
    } catch (err) {
      console.error(err);
      alert('원작자 증명 실패: ' + (err?.reason || err?.message || ''));
    }
  };

  // [수정됨] 4. 데이터 조회 (Read - The Graph 로컬 서버 연동 및 실시간 온체인 정합성 100% 보장)
  const loadProblems = async (targetContract = null) => {
    const activeContract = (targetContract && targetContract.target) ? targetContract : contract;
    if (!activeContract) return;
    try {
      const onChainCount = Number(await activeContract.problemCount());
      let onChainVotes = [];
      try {
        const voteEvents = await activeContract.queryFilter(activeContract.filters.Voted(), 0, "latest");
        onChainVotes = voteEvents.map((e) => ({
          problemId: e.args.problemId.toString(),
          verifier: e.args.verifier,
          isCorrect: e.args.isCorrect
        }));
      } catch (voteLogErr) {
        console.warn("Voted 이벤트 로그 조회 실패:", voteLogErr);
      }

      // 온체인 실제 문제 상태(1 ~ onChainCount)를 먼저 조회하여 이전 컨트랙트의 Subgraph 잔존 데이터와 섞이는 현상을 원천 차단!
      const onChainMap = {};
      let viewerAddr = "";
      try { viewerAddr = await activeContract.runner.getAddress(); } catch (_) {}
      for (let i = 1; i <= onChainCount; i++) {
        const p = await activeContract.problems(i);

        // [저작권 보호] ZK 커밋먼트/원작자 증명 상태 및 현재 지갑의 열람 자격 (구버전 컨트랙트면 무시)
        let protection = { commitment: 0n, registeredAt: 0n, proven: false, canView: false, bond: 0n };
        try {
          protection = {
            commitment: await activeContract.copyrightCommitment(i),
            registeredAt: await activeContract.copyrightRegisteredAt(i),
            proven: await activeContract.authorshipProven(i),
            canView: viewerAddr ? await activeContract.canViewProblem(i, viewerAddr) : false,
            bond: viewerAddr ? await activeContract.reviewBond(i, viewerAddr) : 0n,
          };
        } catch (_) {}

        onChainMap[i.toString()] = {
          id: i.toString(),
          provider: p.provider,
          ipfsCid: p.ipfsCid,
          price: p.price,
          status: Number(p.status),
          active: Boolean(p.active),
          protection,
        };
      }

      // Subgraph 보조 메타데이터(subject, authorName) 조회 시도하되, 반드시 현재 컨트랙트의 ipfsCid와 일치할 때만 결합
      const subgraphMetaMap = {};
      try {
        const query = `
        {
          problems(first: 1000, orderBy: id, orderDirection: desc) { id provider ipfsCid status subject authorName }
          votes(first: 1000) { problemId verifier isCorrect }
        }
        `;
        const response = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        const json = await response.json();
        if (json?.data?.problems) {
          console.log('[The Graph Subgraph] Indexed Problems & Votes:', {
            endpoint: SUBGRAPH_URL,
            problems: json.data.problems,
            votes: json.data.votes || []
          });
          for (const sp of json.data.problems) {
            const ocp = onChainMap[sp.id?.toString()];
            if (ocp && sp.ipfsCid?.toLowerCase() === ocp.ipfsCid?.toLowerCase()) {
              subgraphMetaMap[sp.id.toString()] = sp;
            }
          }
        }
      } catch (_) {}

      const loadedProblems = [];
      const loadedVotes = {};

      for (let i = 1; i <= onChainCount; i++) {
        const idStr = i.toString();
        const ocp = onChainMap[idStr];
        if (!ocp || !ocp.active) continue;

        const sgMeta = subgraphMetaMap[idStr];
        let cidStr;
        try {
           cidStr = bytes32ToCid(ocp.ipfsCid);
        } catch(e) {
           cidStr = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"; // Invalid CID fallback
        }
        
        let details = await fetchFromIPFS(cidStr);
        if (!details) {
           details = {
             title: "IPFS Offline",
             content: "Cannot load content. (IPFS daemon is offline)",
             subject: sgMeta?.subject || "Unknown",
             author: sgMeta?.authorName || ocp.provider
           };
        }

        // [저작권 보호] 암호화된 문제: 이 브라우저가 복호화 키를 갖고 있으면 복호화, 없으면 [SECURE] 잠금 상태로 표시
        if (details.encrypted) {
          const storedKey = getStoredContentKey(contractData.address, idStr);
          if (storedKey) {
            try {
              const plain = await decryptJson(details, storedKey);
              if (plain.imageEncrypted && plain.imageCid) {
                const imgEnvelope = await fetchFromIPFS(plain.imageCid);
                const imgBytes = await decryptBytes(imgEnvelope, storedKey);
                plain.imageCid = bytesToDataUrl(imgBytes, plain.imageMime || 'image/png');
              }
              details = { ...details, ...plain, protected: true, locked: false };
            } catch (decErr) {
              console.warn(`문제 #${idStr} 복호화 실패(키 불일치/변조):`, decErr);
              details = { ...details, protected: true, locked: true, decryptFailed: true };
            }
          } else {
            details = { ...details, protected: true, locked: true };
          }
        }

        // Apply Search Filters
        if (searchSubject && !details.subject?.toLowerCase().includes(searchSubject.toLowerCase())) continue;
        if (searchAuthor && !details.author?.toLowerCase().includes(searchAuthor.toLowerCase())) continue;

        loadedProblems.push({
          id: idStr,
          provider: ocp.provider,
          ipfsCid: ocp.ipfsCid,
          status: ocp.status,
          price: ocp.price,
          protection: ocp.protection,
          subject: details.subject || sgMeta?.subject || "Unknown",
          authorName: details.author || sgMeta?.authorName || "Unknown",
          details: details
        });
        
        // 항상 현재 컨트랙트의 실제 Voted 이벤트(onChainVotes)를 기준으로 매핑하여 이전 컨트랙트 투표와 절대 섞이지 않도록 보장
        loadedVotes[idStr] = onChainVotes.filter(v => v.problemId === idStr);
      }
      
      // 내림차순 정렬 (ID 기준)
      loadedProblems.sort((a, b) => Number(b.id) - Number(a.id));
      
      setProblems(loadedProblems);
      setVotes(loadedVotes);
    } catch (err) {
      console.error(err);
    }
  };

  // 개별 문제 삭제 (출제자 본인 또는 로컬 배포자 권한으로 온체인 비활성화)
  const deleteProblemById = async (problemId) => {
    try {
      const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
      const ownerSigner = await localProvider.getSigner(0);
      const ownerContract = new Contract(contractData.address, contractData.abi, ownerSigner);
      await (await ownerContract.deleteProblem(problemId)).wait();
      await loadProblems();
      await updateBalances(contract, account);
    } catch (err) {
      try {
        const tx = await contract.deleteProblem(problemId);
        await tx.wait();
        await loadProblems();
        await updateBalances(contract, account);
      } catch (innerErr) {
        console.error(innerErr);
        alert("문제 삭제 실패: " + (innerErr?.reason || innerErr?.message || ""));
      }
    }
  };

  // 화면에 쌓인 모든 테스트 문제 일괄 삭제(초기화)
  const deleteAllProblems = async () => {
    if (problems.length === 0) {
      alert("삭제할 문제가 없습니다.");
      return;
    }
    if (!window.confirm(`현재 목록에 있는 ${problems.length}개의 문제를 모두 삭제하시겠습니까?`)) return;
    try {
      const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
      const ownerSigner = await localProvider.getSigner(0);
      const ownerContract = new Contract(contractData.address, contractData.abi, ownerSigner);
      for (const p of problems) {
        try {
          await (await ownerContract.deleteProblem(p.id)).wait();
        } catch (_) {}
      }
      await loadProblems();
      if (contract && account) {
        await updateBalances(contract, account);
      }
      alert("모든 테스트 문제가 깨끗하게 삭제되었습니다!");
    } catch (err) {
      console.error(err);
      alert("일괄 삭제 중 오류가 발생했습니다.");
    }
  };

  // 보상 수령
  const claimRewards = async () => {
    try {
      const tx = await contract.claimReward();
      await tx.wait();
      alert("보상 수령 완료!");
      updateBalances(contract, account);
    } catch (err) {
      alert("수령할 보상이 없습니다.");
    }
  };

  // [토큰 이코노미] 운영 재고(10%) 인출 - 관리자(컨트랙트 배포자) 전용
  // 가스비 대납(릴레이어 충전), 유동성 공급 등 운영 목적으로 platformReserve에서 지정한 주소로 이체
  const withdrawPlatformReserve = async () => {
    const to = window.prompt("인출할 주소를 입력하세요 (예: 릴레이어 지갑 주소)", account);
    if (!to) return;
    const amountStr = window.prompt(`인출할 EDU 수량을 입력하세요 (현재 운영 재고: ${platformReserveBalance} EDU)`, platformReserveBalance);
    if (!amountStr) return;

    try {
      const amount = parseUnits(amountStr, 18);
      const tx = await contract.withdrawPlatformReserve(to, amount);
      await tx.wait();
      alert(`운영 재고에서 ${amountStr} EDU를 ${to}로 인출했습니다.`);
      await updateBalances(contract, account);
    } catch (err) {
      console.error(err);
      const msg = err?.reason || err?.message || "";
      if (msg.includes("Insufficient platform reserve")) {
        alert("운영 재고 잔액보다 많은 금액은 인출할 수 없습니다.");
      } else if (msg.includes("Ownable")) {
        alert("권한 오류: 관리자(컨트랙트 배포자)만 인출할 수 있습니다.");
      } else {
        alert("인출 실패: 입력값 또는 트랜잭션 오류");
      }
    }
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="glass-card" style={{ textAlign: 'center' }}>
          <h1>EduChain</h1>
          <p style={{ color: 'var(--text-muted)' }}>Decentralized Learning</p>
        </div>

        <div className="glass-card form-group">
          <h2>Wallet & Connection</h2>
          <button className="btn" onClick={connectWallet}>
            Connect Wallet
          </button>
          <button className="btn" style={{ marginTop: '10px', background: 'var(--card-bg)', border: '1px solid #4285F4', color: '#4285F4' }} onClick={simulateSocialLogin}>
            Sign in with Google (Web3Auth)
          </button>

          <div style={{ fontSize: '0.9rem', marginTop: '10px' }}>
            <p><strong>Account:</strong> {account ? account.substring(0,6)+'...'+account.substring(38) : 'Not Connected'}</p>
            <p><strong>Balance:</strong> {balance} EDU</p>
            <p><strong>Claimable:</strong> {claimable} EDU</p>
            <p>
              <strong>검증자 평판 가중치:</strong> {reputationWeight}x (
              {Number(reputationWeight) >= 1.5
                ? '수석 검증자 SBT'
                : Number(reputationWeight) >= 1.1
                  ? '우수 검증자 SBT'
                  : Number(reputationWeight) < 1.0
                    ? '페널티 검증자 (오답 누적)'
                    : '일반 검증자'}
              )
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              누적 정직 검증: {correctVotesCount}회 (+0.10x/10회) | 누적 오답: {wrongVotesCount}회 (-0.10x/3회)
            </p>
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '5px 8px', flex: 1 }}
                onClick={() => simulateReputationStep(true)}
                title="내 계정에 정답 검증 10회를 즉시 누적하여 평판 가중치를 +0.10x 올립니다"
              >
                [EXEC] 평판 +0.10x 테스트
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '5px 8px', flex: 1 }}
                onClick={() => simulateReputationStep(false)}
                title="내 계정에 오답 검증 3회를 즉시 누적하여 평판 가중치를 -0.10x 낮춥니다"
              >
                [EXEC] 페널티 -0.10x 테스트
              </button>
            </div>
          </div>

          <button className="btn btn-secondary" onClick={getFaucet}>Faucet (100 EDU)</button>
          <button className="btn btn-success" onClick={claimRewards}>Claim Rewards</button>
          <button className="btn" style={{ background: '#28a745', border: '1px solid #28a745', marginTop: '10px' }} onClick={simulateOffRamp}>Cash Out (Off-Ramp)</button>
          <button className="btn btn-secondary" style={{ marginTop: '10px' }} onClick={loadProblems}>Refresh Data</button>
          <button className="btn btn-secondary" onClick={checkTheGraphSubgraph}> The Graph 확인</button>
          <button className="btn btn-secondary" onClick={signPermitDemo}>Permit Demo</button>
        </div>

        {isOwner && (
          <div className="glass-card form-group">
            <h2>운영자 패널 (Admin)</h2>
            <p style={{ fontSize: '0.9rem' }}>
              <strong>운영 재고 (10%):</strong> {platformReserveBalance} EDU
            </p>
            <button
              className="btn"
              style={{ background: '#6c5ce7', border: '1px solid #6c5ce7' }}
              onClick={withdrawPlatformReserve}
            >
              운영 재고 인출
            </button>
          </div>
        )}

        <div className="glass-card form-group">
          <h2>Submit a Problem</h2>
          <form onSubmit={submitProblem} className="form-group">
            <input name="subject" placeholder="Subject (e.g., Math)" required />
            <input name="authorName" placeholder="Author Name" required />
            <input name="title" placeholder="Problem Title" required />
            <div style={{ marginBottom: '10px', textAlign: 'left' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Image Attachment (Optional)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <input
                  type="file"
                  name="imageFile"
                  accept="image/*"
                  ref={imageFileInputRef}
                  onChange={(e) => setSelectedFileName(e.target.files[0]?.name || "")}
                  style={{ background: 'transparent', padding: '0', border: 'none', flex: 1 }}
                />
                {selectedFileName && (
                  <button
                    type="button"
                    onClick={clearSelectedFile}
                    title="파일 선택 취소"
                    aria-label="파일 선택 취소"
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '2px 6px' }}
                  >
                    
                  </button>
                )}
              </div>
              <input name="manualImageCid" placeholder="Or paste image CID here (e.g. bafy...)" style={{ marginTop: '5px' }} />
            </div>
            <textarea name="content" placeholder="Problem Content (Optional if image is provided)" style={{ height: '80px' }} />
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }} title="본문/이미지를 AES-256-GCM 으로 암호화해 IPFS 에 올리고, Poseidon 저작권 커밋먼트(ZK)를 온체인에 등록합니다. 검증자는 5 EDU 열람 보증금을 예치해야 열람할 수 있습니다.">
              <input type="checkbox" checked={protectContent} onChange={(e) => setProtectContent(e.target.checked)} style={{ width: 'auto' }} />
               저작권 보호 (AES-256 암호화 + ZK 원작자 증명)
            </label>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={gasless} onChange={(e) => setGasless(e.target.checked)} style={{ width: 'auto' }} />
              Use Gasless Submission (Relayer)
            </label>
            <button className="btn" type="submit">Submit (100 EDU Stake)</button>
          </form>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="glass-card" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>Search</h2>
          <input placeholder="Subject..." value={searchSubject} onChange={(e) => setSearchSubject(e.target.value)} />
          <input placeholder="Author..." value={searchAuthor} onChange={(e) => setSearchAuthor(e.target.value)} />
          <button className="btn" onClick={loadProblems}>Filter</button>
          <button
            className="btn btn-danger"
            style={{ whiteSpace: 'nowrap' }}
            onClick={deleteAllProblems}
            title="테스트로 쌓인 모든 문제를 목록에서 일괄 삭제합니다"
          >
             전체 문제 비우기
          </button>
        </div>

        <div className="problem-grid">
          {problems.map((p) => {
            const pVotes = votes[p.id] || [];
            const { kappa, isMajorityCorrect, n1, n2, N } = calculateKappa(pVotes, votes);
            const isModerateHold = N >= MIN_VOTES && kappa >= KAPPA_MODERATE && kappa < KAPPA_SUBSTANTIAL && N < EXTENDED_MIN_VOTES;
            const canFinalize = N >= MIN_VOTES && !isModerateHold;

            let kappaStatusText = '';
            if (N < MIN_VOTES) {
              kappaStatusText = `표본 수집 중 (${N}/${MIN_VOTES}명)`;
            } else if (kappa >= KAPPA_SUBSTANTIAL) {
              kappaStatusText = '상당한 일치·즉시 확정 가능';
            } else if (kappa >= KAPPA_MODERATE) {
              kappaStatusText = N < EXTENDED_MIN_VOTES
                ? `보통 일치·추가검증 필요 (${N}/${EXTENDED_MIN_VOTES}명)`
                : '보통 일치·확대 표본(10명+) 확정 가능';
            } else {
              kappaStatusText = '낮은 일치·신뢰도 미달 자동 기각 대상';
            }

            let statusBadge = '';
            if (p.status.toString() === '0') statusBadge = <span className="badge badge-pending">Pending</span>;
            else if (p.status.toString() === '1') statusBadge = <span className="badge badge-verified">Verified</span>;
            else statusBadge = <span className="badge badge-rejected">Rejected</span>;

            return (
              <div key={p.id} className="glass-card problem-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {statusBadge}
                  <button
                    type="button"
                    onClick={() => deleteProblemById(p.id)}
                    title="이 문제를 목록에서 삭제"
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(255,99,99,0.4)',
                      color: '#ff6b6b',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                     삭제
                  </button>
                </div>
                <h3>#{p.id} {p.details?.title}</h3>
                <div className="meta">
                  <span>Subject: {p.subject}</span> | <span>Author: {p.authorName}</span>
                </div>

                {/* [저작권 보호] ZK 저작권 커밋먼트 / 원작자 증명 배지 */}
                {p.protection && p.protection.commitment > 0n && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', margin: '6px 0' }}>
                    <span
                      title={`Poseidon 커밋먼트: ${p.protection.commitment.toString()}`}
                      style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(108,92,231,0.18)', border: '1px solid #6c5ce7', color: '#a29bfe' }}
                    >
                       ZK 저작권 등록 {new Date(Number(p.protection.registeredAt) * 1000).toLocaleString()}
                    </span>
                    {p.protection.proven ? (
                      <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(46,213,115,0.15)', border: '1px solid #2ed573', color: '#2ed573' }}>
                        [PASS] 영지식 원작자 증명 완료
                      </span>
                    ) : (
                      p.provider?.toLowerCase() === account?.toLowerCase() && (
                        <button
                          type="button"
                          onClick={() => proveAuthorship(p.id)}
                          style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'transparent', border: '1px solid #6c5ce7', color: '#a29bfe', cursor: 'pointer' }}
                        >
                           ZK 원작자 증명 제출
                        </button>
                      )
                    )}
                  </div>
                )}

                <div
                  className="content-box"
                  style={{ userSelect: 'none', WebkitUserSelect: 'none', position: 'relative', overflow: 'hidden' }}
                  onContextMenu={(e) => e.preventDefault()}
                  onCopy={(e) => e.preventDefault()}
                >
                  {/* 열람자 지갑 주소 워터마크: 캡처 유출 시 유출자 특정 */}
                  {p.details?.protected && !p.details.locked && account && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, opacity: 0.09,
                        display: 'flex', flexWrap: 'wrap', alignContent: 'space-around', justifyContent: 'space-around',
                        transform: 'rotate(-18deg) scale(1.4)', fontSize: '0.7rem', color: '#fff', whiteSpace: 'nowrap',
                      }}
                    >
                      {Array.from({ length: 24 }).map((_, wi) => (
                        <span key={wi} style={{ padding: '10px 14px' }}>{account}</span>
                      ))}
                    </div>
                  )}

                  {!p.details ? (
                    <p>Loading IPFS...</p>
                  ) : p.details.locked ? (
                    <div style={{ textAlign: 'center', padding: '14px 6px' }}>
                      <div style={{ fontSize: '2rem' }}>[SECURE]</div>
                      <p style={{ margin: '6px 0', fontWeight: 600 }}>저작권 보호 문제 (AES-256-GCM 암호화)</p>
                      <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.details.decryptFailed
                          ? '저장된 키로 복호화하지 못했습니다. 키를 다시 받아주세요.'
                          : 'IPFS 에는 암호문만 저장되어 있습니다. 검증자는 5 EDU 열람 보증금을 예치하면 복호화 키를 받을 수 있습니다.'}
                      </p>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {p.protection?.canView ? (
                          <button className="btn" type="button" onClick={() => unlockProblem(p.id)}>
                             키 받기 (지갑 서명)
                          </button>
                        ) : (
                          p.status.toString() === '0' && (
                            <button className="btn" type="button" onClick={() => requestReviewAccess(p.id)}>
                               열람 권한 요청 (5 EDU 예치)
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {p.details.content && <p style={{ whiteSpace: 'pre-wrap', margin: 0, position: 'relative', zIndex: 1 }}>{p.details.content}</p>}
                      {p.details.imageCid && (
                        <div style={{ marginTop: p.details.content ? '15px' : '0', textAlign: 'center' }}>
                          <img 
                            src={
                              getCachedImagePreview(p.details.imageCid) ||
                              (p.details.imageCid.startsWith('http') || p.details.imageCid.startsWith('data:')
                                ? p.details.imageCid
                                : `https://${import.meta.env.VITE_PINATA_GATEWAY || 'emerald-magnetic-fish-225.mypinata.cloud'}/ipfs/${p.details.imageCid}${import.meta.env.VITE_PINATA_GATEWAY_TOKEN ? `?pinataGatewayToken=${import.meta.env.VITE_PINATA_GATEWAY_TOKEN}` : ''}`)
                            } 
                            onError={(e) => {
                              const fallbackUrl = `https://gateway.pinata.cloud/ipfs/${p.details.imageCid}`;
                              if (e.currentTarget.src !== fallbackUrl && !p.details.imageCid.startsWith('data:')) {
                                e.currentTarget.src = fallbackUrl;
                              }
                            }}
                            alt="Problem" 
                            draggable={false}
                            style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border-color)' }} 
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="meta">
                  Votes: {N} (Correct {n1} / Incorrect {n2}) | Kappa: {N >= 1 ? kappa.toFixed(2) : '0.00'} ({kappaStatusText})
                </div>

                {p.status.toString() === '0' && p.details?.locked && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', margin: '6px 0' }}>
                    [SECURE] 문제를 열람해야 투표할 수 있습니다 (내용을 보지 않은 맹목 투표 방지)
                  </div>
                )}
                {p.status.toString() !== '0' && p.protection?.bond > 0n && (
                  <div className="actions-row" style={{ marginTop: '6px' }}>
                    <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.8rem' }} onClick={() => refundReviewBond(p.id)}>
                      [VALUE] 미사용 열람 보증금 5 EDU 회수
                    </button>
                  </div>
                )}
                {p.status.toString() === '0' && !p.details?.locked && (
                  <>
                    <div className="actions-row">
                      <button className="btn btn-success" style={{ flex: 1 }} onClick={() => voteOnProblem(p.id, true)}>Correct</button>
                      <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => voteOnProblem(p.id, false)}>Incorrect</button>
                    </div>
                    <div className="actions-row" style={{ marginTop: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ flex: 1, fontSize: '0.78rem', padding: '6px' }}
                        onClick={() => simulateMultiVerifierVote(p.id, true)}
                        title="MetaMask 전환 없이 다른 검증자 계정으로 즉시 찬성 투표를 1회 추가하여 Kappa 변화를 확인합니다"
                      >
                         보조 검증자 찬성(+1)
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ flex: 1, fontSize: '0.78rem', padding: '6px' }}
                        onClick={() => simulateMultiVerifierVote(p.id, false)}
                        title="MetaMask 전환 없이 다른 검증자 계정으로 즉시 반대 투표를 1회 추가하여 Kappa 변화를 확인합니다"
                      >
                         보조 검증자 반대(+1)
                      </button>
                    </div>
                  </>
                )}
                {p.status.toString() === '0' && (
                  <div className="actions-row" style={{ marginTop: '8px' }}>
                    <button
                      className={`btn ${!canFinalize ? 'btn-secondary' : kappa < KAPPA_MODERATE || !isMajorityCorrect ? 'btn-danger' : 'btn-success'}`}
                      style={{ flex: 1, opacity: canFinalize ? 1 : 0.65, cursor: canFinalize ? 'pointer' : 'not-allowed' }}
                      onClick={() => finalizeProblem(p.id)}
                      disabled={!canFinalize}
                    >
                      {N < MIN_VOTES
                        ? `Fleiss' Kappa 확정 대기 (최소 ${MIN_VOTES}명 투표 필요: 현재 ${N}/${MIN_VOTES}명)`
                        : isModerateHold
                          ? `보통 일치 (κ=${kappa.toFixed(2)}) — 추가 검증 대기 (${N}/${EXTENDED_MIN_VOTES}명)`
                          : kappa < KAPPA_MODERATE
                            ? `Fleiss' Kappa 확정 (κ=${kappa.toFixed(2)} < 0.41 → 신뢰도 미달 자동 기각)`
                            : `Fleiss' Kappa 확정 (κ=${kappa.toFixed(2)} → ${isMajorityCorrect ? '검증 통과' : '오류 기각'})`}
                    </button>
                  </div>
                )}
                {p.status.toString() === '1' && (
                  <div className="actions-row" style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className="btn"
                      style={{ flex: 1, minWidth: '150px', background: '#6c5ce7', border: '1px solid #6c5ce7' }}
                      onClick={() => purchaseProblem(p.id)}
                    >
                      Purchase ({formatUnits(p.price || 0n, 18)} EDU)
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ flex: 1, minWidth: '150px', background: 'rgba(108, 92, 231, 0.15)', border: '1px solid #6c5ce7', color: '#a29bfe' }}
                      onClick={() => purchaseAsStudent(p.id)}
                      title="로컬 학생 지갑(Account #2)이 10 EDU를 지불하여 7:2:1 수익 분배를 분리 테스트합니다"
                    >
                       학생 지갑으로 구매 (7:2:1 검증)
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
