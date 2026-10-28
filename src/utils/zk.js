/**
 * [저작권 보호] 브라우저/Node 공용 ZK 증명 헬퍼 (snarkjs Groth16)
 *
 * 서킷: zk/circuits/copyright_proof.circom
 *   private: contentHash, salt   public: author   output: commitment = Poseidon(contentHash, salt)
 *   public signals 순서 = [commitment, author]
 *
 * wasm / zkey 경로는 환경에 따라 주입한다:
 *   - 브라우저(Vite): /zk/copyright_proof.wasm, /zk/copyright_final.zkey  (public/zk/ 에 복사됨)
 *   - Node 테스트:    zk/build/ 경로
 */
import * as snarkjs from "snarkjs";

export const BROWSER_ARTIFACTS = {
  wasm: "/zk/copyright_proof.wasm",
  zkey: "/zk/copyright_final.zkey",
};

// 증명 생성. author 는 uint160 으로 해석되는 지갑 주소(BigInt/hex 문자열 모두 허용)
export const generateCopyrightProof = async ({ contentHash, salt, author }, artifacts = BROWSER_ARTIFACTS) => {
  const input = {
    contentHash: contentHash.toString(),
    salt: salt.toString(),
    author: BigInt(author).toString(),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, artifacts.wasm, artifacts.zkey);
  return { proof, publicSignals, commitment: BigInt(publicSignals[0]) };
};

// snarkjs proof -> Solidity verifyProof()/proveAuthorship() 인자 (pB 좌표 순서 뒤집기 포함)
export const proofToSolidityArgs = (proof) => ({
  a: [proof.pi_a[0], proof.pi_a[1]],
  b: [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ],
  c: [proof.pi_c[0], proof.pi_c[1]],
});

// 오프체인 사전 검증 (vkey 로 로컬 검증)
export const verifyCopyrightProofOffchain = async (vkey, publicSignals, proof) =>
  snarkjs.groth16.verify(vkey, publicSignals, proof);
