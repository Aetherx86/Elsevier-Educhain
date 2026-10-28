/**
 * [저작권 보호] 문제 원문 암호화 / ZK 커밋먼트용 비밀값 유틸
 *
 * - 문제 본문/이미지는 AES-256-GCM(WebCrypto)으로 클라이언트에서 암호화한 뒤 IPFS 에 올린다.
 *   => IPFS 게이트웨이/크롤러/일반 사용자는 암호문(외계어)만 볼 수 있다.
 * - 복호화 키(K)는 IPFS 에도 온체인에도 올리지 않는다. 키 서버(scripts/relayer.js)가 보관하고,
 *   온체인 canViewProblem() 자격이 확인된 지갑 서명 요청에만 내준다.
 * - 이 파일은 브라우저(Vite)와 Node(테스트) 양쪽에서 동일하게 동작하도록 WebCrypto(globalThis.crypto)만 사용한다.
 */

// BN254 스칼라 필드 크기 (circom/snarkjs 의 모든 signal 은 이 값 미만이어야 함)
export const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const bytesToHex = (bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const hexToBytes = (hex) => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};

const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

const fromB64 = (b64) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

// 32바이트 랜덤 대칭키 (hex 문자열)
export const generateContentKey = () =>
  bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));

const importKey = (keyHex) =>
  globalThis.crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, ["encrypt", "decrypt"]);

// 바이트 -> 암호문 봉투 {v, alg, iv, ct}
export const encryptBytes = async (bytes, keyHex) => {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyHex);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { v: 1, alg: "AES-256-GCM", iv: toB64(iv), ct: toB64(ct) };
};

// 암호문 봉투 -> 바이트 (키가 틀리거나 변조되면 GCM 인증 실패로 예외)
export const decryptBytes = async (envelope, keyHex) => {
  const key = await importKey(keyHex);
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(envelope.iv) },
    key,
    fromB64(envelope.ct)
  );
  return new Uint8Array(plain);
};

export const encryptJson = (obj, keyHex) => encryptBytes(enc.encode(JSON.stringify(obj)), keyHex);

export const decryptJson = async (envelope, keyHex) =>
  JSON.parse(dec.decode(await decryptBytes(envelope, keyHex)));

// 바이트 -> data URL (복호화한 이미지를 <img src>로 바로 쓰기 위함)
export const bytesToDataUrl = (bytes, mime = "image/png") => `data:${mime};base64,${toB64(bytes)}`;

// 파일/이미지 바이트 읽기
export const fileToBytes = async (file) => new Uint8Array(await file.arrayBuffer());

// ---------------------------------------------------------------
// ZK 커밋먼트용 비밀값: contentHash = SHA-256(원문 바이트) mod p,  salt = 랜덤 31바이트
// (31바이트면 항상 필드 크기보다 작아 별도 mod 불필요)
// ---------------------------------------------------------------
export const hashToField = async (bytes) => {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return BigInt("0x" + bytesToHex(digest)) % BN254_FIELD;
};

export const randomSalt = () => BigInt("0x" + bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(31))));
