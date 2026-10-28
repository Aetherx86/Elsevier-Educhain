// scripts/relayer.js
// ------------------------------------------------------------------
// [8월 담당분] Paymaster 시뮬레이션 서버
//
// EIP-7702 + 진짜 온체인 Paymaster 계약을 쓰려면 viem/permissionless.js 같은
// 전용 SDK와 Pectra 이후 노드 지원이 필요해서, 이번 학기 캡스톤 범위에서는
// "신뢰된 Forwarder(ERC-2771) + 오프체인 서명 릴레이" 조합으로 같은 사용자
// 경험(학생은 서명만, 가스비는 0)을 구현했다. 이 스크립트가 그 Paymaster 역할.
//
// 실행 방법:
//   1) 터미널 A: npx hardhat node
//   2) 터미널 B: npx hardhat run scripts/deploy.js --network localhost
//   3) 터미널 C: RELAYER_PRIVATE_KEY=<hardhat 로컬넷 계정 개인키> node scripts/relayer.js
//   4) 프론트엔드에서 "가스리스로 제출" 버튼 클릭 -> 이 서버의 POST /relay 로 전달됨
//
// 주의: 이 서버는 로컬 데모/발표용이다. 실제 서비스에서는
//   - 서명 재사용/리플레이 방지 (deadline + nonce, 이미 Forwarder가 처리)
//   - 릴레이어 남용 방지 (rate limit, 화이트리스트, 캡차 등)
//   - 릴레이어 지갑 잔고/가스 가격 모니터링
// 이 추가로 필요하다.
// ------------------------------------------------------------------

const http = require("http");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const PORT = process.env.RELAYER_PORT || 4000;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

// hardhat 로컬넷의 0번 계정 개인키가 기본값 (문서화된 테스트용 키, 실제 자금 없음)
const DEFAULT_LOCAL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || DEFAULT_LOCAL_KEY;

function loadDeployment() {
  const abiPath = path.join(__dirname, "..", "src", "EduChainABI.json");
  const raw = fs.readFileSync(abiPath, "utf-8");
  return JSON.parse(raw);
}

async function main() {
  const deployment = loadDeployment();
  if (!deployment.forwarderAddress) {
    console.error(
      "EduChainABI.json 에 forwarderAddress가 없습니다. scripts/deploy.js 를 다시 실행하세요."
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
  const getForwarder = () => {
    const dep = loadDeployment();
    return new ethers.Contract(
      dep.forwarderAddress,
      dep.forwarderAbi,
      relayerWallet
    );
  };

  console.log(`[relayer] RPC: ${RPC_URL}`);
  console.log(`[relayer] Forwarder: ${deployment.forwarderAddress}`);
  console.log(`[relayer] Paymaster(가스비 대납) 지갑: ${relayerWallet.address}`);

  // ------------------------------------------------------------------
  // [저작권 보호] 복호화 키 서버 (Key Escrow)
  //
  //  - POST /keys         : 출제자가 문제 암호화 키(K)를 맡긴다. 온체인 problems(id).provider 의 서명이어야 함.
  //  - POST /keys/access  : 열람 자격자가 지갑 서명으로 키를 요청한다. 서버는 온체인
  //                         canViewProblem(id, 요청자)로 자격(출제자/구매자/투표자/5 EDU 열람 보증금 예치자)을
  //                         확인한 경우에만 K 를 내준다. 모든 발급 내역은 감사 로그에 남는다(유출 시 추적).
  //
  // 한계(문서화): 키 서버는 신뢰 지점(trusted custodian)이다. 실서비스에서는 임계값 암호(Shamir/MPC) 키 서버
  // 다중화 또는 Lit Protocol 같은 조건부 복호화 네트워크로 대체해야 한다.
  // ------------------------------------------------------------------
  const KEYSTORE_PATH = path.join(__dirname, ".keystore.json");
  const loadKeystore = () => {
    try {
      return JSON.parse(fs.readFileSync(KEYSTORE_PATH, "utf-8"));
    } catch (_) {
      return {};
    }
  };
  const saveKeystore = (store) => fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(store, null, 2));
  const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

  const readJsonBody = (req) =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (e) {
          reject(new Error("Invalid JSON body"));
        }
      });
    });

  const sendJson = (res, status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  const keyMessages = {
    deposit: (contract, pid, keyHash, ts) =>
      `EduChain key deposit\ncontract:${contract.toLowerCase()}\nproblem:${pid}\nkeyHash:${keyHash}\nts:${ts}`,
    access: (contract, pid, ts) =>
      `EduChain key access\ncontract:${contract.toLowerCase()}\nproblem:${pid}\nts:${ts}`,
  };

  const handleKeyDeposit = async (req, res) => {
    try {
      const { contract: contractAddr, problemId, key, timestamp, signature } = await readJsonBody(req);
      const dep = loadDeployment();
      if (!contractAddr || contractAddr.toLowerCase() !== dep.address.toLowerCase()) {
        return sendJson(res, 400, { ok: false, error: "Unknown contract address" });
      }
      if (!/^[0-9a-f]{64}$/i.test(key || "")) {
        return sendJson(res, 400, { ok: false, error: "key must be 32-byte hex" });
      }
      if (Math.abs(Date.now() - Number(timestamp)) > MAX_SIGNATURE_AGE_MS) {
        return sendJson(res, 400, { ok: false, error: "Signature expired" });
      }
      const signer = ethers.verifyMessage(
        keyMessages.deposit(contractAddr, problemId, ethers.keccak256("0x" + key), timestamp),
        signature
      );
      const edu = new ethers.Contract(dep.address, dep.abi, provider);
      const problem = await edu.problems(problemId);
      if (problem.provider.toLowerCase() !== signer.toLowerCase()) {
        return sendJson(res, 403, { ok: false, error: "Only the on-chain provider can deposit the key" });
      }

      const store = loadKeystore();
      const id = `${dep.address.toLowerCase()}:${problemId}`;
      if (store[id]) return sendJson(res, 409, { ok: false, error: "Key already deposited" });
      store[id] = { key, provider: signer, depositedAt: new Date().toISOString(), accessLog: [] };
      saveKeystore(store);
      console.log(`[keys] 문제 #${problemId} 키 보관 (출제자 ${signer})`);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error("[keys] deposit error:", err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  };

  const handleKeyAccess = async (req, res) => {
    try {
      const { contract: contractAddr, problemId, requester, timestamp, signature } = await readJsonBody(req);
      const dep = loadDeployment();
      if (!contractAddr || contractAddr.toLowerCase() !== dep.address.toLowerCase()) {
        return sendJson(res, 400, { ok: false, error: "Unknown contract address" });
      }
      if (Math.abs(Date.now() - Number(timestamp)) > MAX_SIGNATURE_AGE_MS) {
        return sendJson(res, 400, { ok: false, error: "Signature expired" });
      }
      const signer = ethers.verifyMessage(keyMessages.access(contractAddr, problemId, timestamp), signature);
      if (signer.toLowerCase() !== String(requester).toLowerCase()) {
        return sendJson(res, 401, { ok: false, error: "Signature does not match requester" });
      }

      const edu = new ethers.Contract(dep.address, dep.abi, provider);
      const allowed = await edu.canViewProblem(problemId, signer);
      if (!allowed) {
        return sendJson(res, 403, {
          ok: false,
          error: "열람 권한 없음: 5 EDU 열람 보증금(requestReviewAccess) 예치 또는 구매/투표 이력이 필요합니다.",
        });
      }

      const store = loadKeystore();
      const id = `${dep.address.toLowerCase()}:${problemId}`;
      const entry = store[id];
      if (!entry) return sendJson(res, 404, { ok: false, error: "Key not found for this problem" });

      entry.accessLog.push({ requester: signer, at: new Date().toISOString() });
      saveKeystore(store);
      console.log(`[keys] 문제 #${problemId} 키 발급 -> ${signer}`);
      return sendJson(res, 200, { ok: true, key: entry.key });
    } catch (err) {
      console.error("[keys] access error:", err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  };

  const server = http.createServer(async (req, res) => {
    // 프론트엔드(vite, 다른 포트)에서 오는 요청을 허용
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === "POST" && req.url === "/keys") return handleKeyDeposit(req, res);
    if (req.method === "POST" && req.url === "/keys/access") return handleKeyAccess(req, res);

    if (req.method === "GET" && req.url === "/health") {
      const dep = loadDeployment();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: true,
          forwarder: dep.forwarderAddress,
          relayer: relayerWallet.address,
        })
      );
    }

    if (req.method !== "POST" || req.url !== "/relay") {
      res.writeHead(404);
      return res.end("Not found");
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { request } = JSON.parse(body);
        const forwarder = getForwarder();

        // request = { from, to, value, gas, deadline, data, signature }
        // ForwardRequestData 구조체와 필드/순서를 맞춰서 넘겨준다.
        const forwardRequest = {
          from: request.from,
          to: request.to,
          value: request.value ?? 0n,
          gas: request.gas,
          deadline: request.deadline,
          data: request.data,
          signature: request.signature,
        };

        // 실행 전에 verify()로 서명이 유효한지 먼저 확인 (실패 시 온체인 gas 낭비 방지)
        const isValid = await forwarder.verify(forwardRequest);
        if (!isValid) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, error: "Invalid signature or expired deadline" }));
        }

        // 가스비는 relayerWallet(Paymaster 역할)이 지불하고, 실행 결과의
        // msg.sender 는 forwarder이지만 EduChain 안에서는 _msgSender()가
        // request.from(실제 서명자)으로 정확히 치환된다.
        const tx = await forwarder.execute(forwardRequest);
        const receipt = await tx.wait();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString(),
            relayerPaidGas: true,
          })
        );
      } catch (err) {
        console.error("[relayer] relay error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`[relayer] Paymaster 릴레이 서버 실행 중: http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
