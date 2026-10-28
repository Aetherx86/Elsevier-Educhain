// zk/build.js
// ------------------------------------------------------------------
// 저작권 영지식 증명 서킷 빌드 파이프라인 (Rust/circom 바이너리 설치 불필요: npm `circom2` WASM 사용)
//   1) circom2 로 copyright_proof.circom 컴파일 (r1cs + wasm witness generator)
//   2) Powers of Tau (로컬 개발용 임시 의식) -> Groth16 phase2 setup -> zkey
//   3) verification_key.json 및 Solidity Verifier (contracts/CopyrightVerifier.sol) 추출
//   4) 프론트엔드에서 쓰도록 wasm/zkey 를 public/zk/ 로 복사
//
// 실행:  npm run zk:build
//
// 주의: 여기서 만드는 ptau/zkey 는 "로컬 개발용 단일 참여자 setup" 이다. 실서비스에서는
//       다수 참여자 MPC trusted setup(예: Hermez/PSE ptau) 결과물을 써야 toxic waste 위험이 없다.
// ------------------------------------------------------------------
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const CIRCUIT = path.join(__dirname, "circuits", "copyright_proof.circom");
const BUILD = path.join(__dirname, "build");
const PUBLIC_ZK = path.join(ROOT, "public", "zk");

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(PUBLIC_ZK, { recursive: true });

  console.log("[zk] 1/4 서킷 컴파일 (circom2 WASM)...");
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "circom2", "cli.js"),
      CIRCUIT,
      "--r1cs",
      "--wasm",
      "--sym",
      "-l",
      path.join(ROOT, "node_modules"),
      "-o",
      BUILD,
    ],
    { stdio: "inherit" }
  );

  const r1cs = path.join(BUILD, "copyright_proof.r1cs");
  const ptau0 = path.join(BUILD, "pot_0000.ptau");
  const ptau1 = path.join(BUILD, "pot_0001.ptau");
  const ptauFinal = path.join(BUILD, "pot_final.ptau");
  const zkey0 = path.join(BUILD, "copyright_0000.zkey");
  const zkeyFinal = path.join(BUILD, "copyright_final.zkey");

  console.log("[zk] 2/4 Powers of Tau + Groth16 setup (로컬 개발용)...");
  // 제약 수가 수백 개 수준이라 2^12 로 충분
  await snarkjs.powersOfTau.newAccumulator(await getCurve(), 12, ptau0);
  await snarkjs.powersOfTau.contribute(ptau0, ptau1, "educhain-local-dev", "educhain-entropy-" + Date.now());
  await snarkjs.powersOfTau.preparePhase2(ptau1, ptauFinal);
  await snarkjs.zKey.newZKey(r1cs, ptauFinal, zkey0);
  await snarkjs.zKey.contribute(zkey0, zkeyFinal, "educhain-phase2", "educhain-phase2-entropy-" + Date.now());

  console.log("[zk] 3/4 verification key / Solidity Verifier 추출...");
  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyFinal);
  fs.writeFileSync(path.join(BUILD, "verification_key.json"), JSON.stringify(vkey, null, 2));

  const templates = {
    groth16: fs.readFileSync(
      path.join(ROOT, "node_modules", "snarkjs", "templates", "verifier_groth16.sol.ejs"),
      "utf8"
    ),
  };
  let solidity = await snarkjs.zKey.exportSolidityVerifier(zkeyFinal, templates);
  // 컨트랙트 이름을 프로젝트 규칙에 맞게 변경
  solidity = solidity.replace(/contract Groth16Verifier/, "contract CopyrightVerifier");
  fs.writeFileSync(path.join(ROOT, "contracts", "CopyrightVerifier.sol"), solidity);

  console.log("[zk] 4/4 프론트엔드용 산출물 복사 (public/zk)...");
  fs.copyFileSync(
    path.join(BUILD, "copyright_proof_js", "copyright_proof.wasm"),
    path.join(PUBLIC_ZK, "copyright_proof.wasm")
  );
  fs.copyFileSync(zkeyFinal, path.join(PUBLIC_ZK, "copyright_final.zkey"));
  fs.copyFileSync(path.join(BUILD, "verification_key.json"), path.join(PUBLIC_ZK, "verification_key.json"));

  console.log("[zk] 완료 -> contracts/CopyrightVerifier.sol, public/zk/*");
}

async function getCurve() {
  return snarkjs.curves.getCurveFromName("bn128");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
