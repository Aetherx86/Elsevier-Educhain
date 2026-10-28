/**
 * [2026-07-26 업데이트]
 * 보고서 2. 데이터 스택 설계 (32바이트 해시 저장):
 * - 텍스트, 이미지 등의 실제 데이터는 IPFS에 저장하고, 스마트 컨트랙트에는 32바이트(해시)만 저장합니다.
 * - 온체인 가스비를 최소화하면서도 탈중앙화 무결성을 보장합니다.
 *
 * [IPFS 활용 가이드]
 * 1. 로컬 환경 (2026-07-26 당시):
 *    - localStorage를 활용하여 IPFS를 흉내내는 Mock 버전으로 동작했습니다.
 *    - 서버 연결 오류를 방지하고 프론트엔드 UI/기능 테스트에 집중할 수 있었습니다.
 *
 * [2026-09-30 업데이트] 실제 IPFS(Pinata) 연동:
 * - 그동안 이미지 첨부만 Pinata에 실제로 업로드되고, 문제 본문(제목/내용/과목/작성자) 텍스트는
 *   여전히 브라우저 localStorage에만 저장되는 반쪽짜리 구현이었음 (다른 기기/브라우저에서는
 *   내용을 못 불러오는 문제).
 * - uploadToIPFS()/fetchFromIPFS() 모두 Pinata(pinJSONToIPFS / 공개 게이트웨이)를 우선 사용하도록
 *   변경하고, .env에 VITE_PINATA_JWT가 없거나 네트워크 오류가 나는 경우에만 기존 localStorage
 *   Mock으로 자동 폴백하도록 해서, 인터넷 연결 없이도 로컬 개발/테스트는 그대로 가능하게 유지함.
 */
import { ethers } from "ethers";
import bs58 from 'bs58';

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || "emerald-magnetic-fish-225.mypinata.cloud";
const PINATA_GATEWAY_TOKEN = import.meta.env.VITE_PINATA_GATEWAY_TOKEN;
const LOCAL_IPFS_API = import.meta.env.VITE_LOCAL_IPFS_API || "http://127.0.0.1:5001";

const memoryMockStore = {};

const cacheInLocalMock = (cid, strData) => {
    memoryMockStore[cid] = strData;
    try {
        localStorage.setItem(`ipfs_${cid}`, strData);
    } catch (e) {
        console.warn("[IPFS Mock] localStorage 용량 초과, 메모리에만 임시 저장합니다:", e);
    }
};

// 3단계 폴백 — 브라우저 로컬 Mock 업로드 (Pinata 및 로컬 IPFS 데몬 모두 사용 불가 시)
const uploadToLocalMock = (data) => {
    const strData = JSON.stringify(data);
    const hashHex = ethers.keccak256(ethers.toUtf8Bytes(strData));
    const hashBytes = ethers.getBytes(hashHex);
    const multihash = new Uint8Array(34);
    multihash[0] = 0x12;
    multihash[1] = 0x20;
    multihash.set(hashBytes, 2);
    const pseudoCid = bs58.encode(multihash);
    cacheInLocalMock(pseudoCid, strData);
    console.log(`[IPFS Mock] Saved to local mock: ${pseudoCid}`);
    return pseudoCid;
};

// 2단계 폴백 — 로컬 Docker IPFS Kubo 데몬 (http://127.0.0.1:5001) 업로드
const uploadJsonToLocalIpfsNode = async (data) => {
    const strData = JSON.stringify(data);
    const formData = new FormData();
    formData.append('file', new Blob([strData], { type: 'application/json' }), 'problem.json');

    const response = await fetch(`${LOCAL_IPFS_API}/api/v0/add?cid-version=0`, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Local IPFS node responded ${response.status}`);
    }
    const resData = await response.json();
    const cid = resData.Hash;
    cacheInLocalMock(cid, strData);
    console.log("[Local IPFS Daemon] JSON Uploaded, CID:", cid);
    return cid;
};

// [실제 IPFS] 1순위: Pinata Cloud -> 2순위: 로컬 IPFS 데몬(5001) -> 3순위: 브라우저 Local Mock
export const uploadToIPFS = async (data) => {
    if (PINATA_JWT) {
        try {
            const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${PINATA_JWT}`
                },
                body: JSON.stringify({
                    pinataContent: data,
                    pinataMetadata: { name: data.title || 'educhain-problem' },
                    // cidToBytes32/bytes32ToCid가 CIDv0(34바이트 sha256 멀티해시) 형식을 가정하므로
                    // 반드시 cidVersion 0으로 고정 (이미지 업로드와 동일한 규칙)
                    pinataOptions: { cidVersion: 0 }
                })
            });

            if (!response.ok) {
                throw new Error(`Pinata JSON upload failed: ${response.status} ${response.statusText}`);
            }

            const resData = await response.json();
            cacheInLocalMock(resData.IpfsHash, JSON.stringify(data));
            console.log("[Pinata] JSON Uploaded, CID:", resData.IpfsHash);
            return resData.IpfsHash;
        } catch (e) {
            console.warn("[IPFS] Pinata 업로드 실패, 로컬 IPFS 데몬 또는 Mock으로 폴백:", e);
        }
    }

    try {
        return await uploadJsonToLocalIpfsNode(data);
    } catch (localNodeErr) {
        console.warn("[IPFS] 로컬 IPFS 데몬(5001) 미연결, 브라우저 Local Mock으로 저장합니다.");
        return uploadToLocalMock(data);
    }
};

// 로컬 파일 Mock 업로드 (Pinata/로컬 데몬 사용 불가 시 Data URL로 변환하여 폴백)
const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });

export const getCachedImagePreview = (cid) => {
  if (!cid) return null;
  if (cid.startsWith('http') || cid.startsWith('data:')) return cid;
  return memoryMockStore[`img_${cid}`] || localStorage.getItem(`ipfs_img_${cid}`) || null;
};

export const uploadFileToPinata = async (file) => {
  let localDataUrl = null;
  try {
    localDataUrl = await fileToDataUrl(file);
  } catch (err) {
    console.warn("로컬 이미지 미리보기 변환 경고:", err);
  }

  // 1순위: Pinata Cloud API (VITE_PINATA_JWT가 있을 때)
  if (PINATA_JWT) {
    const url = `https://api.pinata.cloud/pinning/pinFileToIPFS`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pinataMetadata', JSON.stringify({ name: file.name || 'image.png' }));
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 0 }));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PINATA_JWT}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Pinata upload failed: ${response.statusText}`);
      }

      const resData = await response.json();
      console.log("[Pinata] File Uploaded, CID:", resData.IpfsHash);
      if (localDataUrl && resData.IpfsHash) {
        memoryMockStore[`img_${resData.IpfsHash}`] = localDataUrl;
        try {
          localStorage.setItem(`ipfs_img_${resData.IpfsHash}`, localDataUrl);
        } catch (_) {}
      }
      return resData.IpfsHash;
    } catch (error) {
      console.warn("Pinata 파일 업로드 실패, 로컬 Data URL Mock으로 폴백:", error);
    }
  }

  // 2순위: 브라우저에서도 즉시 렌더링되도록 Data URL(Base64)로 변환하여 반환
  // (선택적으로 로컬 IPFS 데몬 5001 포트에도 피닝 시도)
  try {
    const localFormData = new FormData();
    localFormData.append('file', file);
    fetch(`${LOCAL_IPFS_API}/api/v0/add?cid-version=0`, {
      method: 'POST',
      body: localFormData
    }).catch(() => {});
  } catch (_) {}

  return localDataUrl;
};

// 로컬 Mock에서 읽기
const fetchFromLocalMock = (cid) => {
    const data = memoryMockStore[cid] || localStorage.getItem(`ipfs_${cid}`);
    if (data) {
        console.log(`[IPFS Mock] Loaded from local mock: ${cid}`);
        return JSON.parse(data);
    }
    return null;
};

// [실제 IPFS 조회] 1순위: 로컬 캐시/Mock -> 2순위: Pinata 게이트웨이 -> 3순위: 공용 게이트웨이 / 로컬 데몬(offline=true)
export const fetchFromIPFS = async (cid) => {
    try {
        const local = fetchFromLocalMock(cid);
        if (local) return local;
    } catch (e) {
        console.warn("[IPFS] 로컬 Mock 조회 오류:", e);
    }

    const gateways = [
        `https://${PINATA_GATEWAY}/ipfs/${cid}${PINATA_GATEWAY_TOKEN ? `?pinataGatewayToken=${PINATA_GATEWAY_TOKEN}` : ''}`,
        `https://gateway.pinata.cloud/ipfs/${cid}`
    ];

    for (const gwUrl of gateways) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            const response = await fetch(gwUrl, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                const data = await response.json();
                cacheInLocalMock(cid, JSON.stringify(data));
                console.log(`[IPFS] Loaded from gateway (${gwUrl}):`, cid);
                return data;
            }
        } catch (e) {
            console.warn(`[IPFS] 게이트웨이 조회 실패 (${gwUrl}):`, e.message || e);
        }
    }

    // 로컬 Docker IPFS 데몬(5001) 조회 시도 (offline=true로 DHT 무한 대기 방지)
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const localRes = await fetch(`${LOCAL_IPFS_API}/api/v0/cat?arg=${cid}&offline=true`, {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timer);
        if (localRes.ok) {
            const data = await localRes.json();
            cacheInLocalMock(cid, JSON.stringify(data));
            console.log(`[Local IPFS Daemon] Loaded from 5001: ${cid}`);
            return data;
        }
    } catch (_) {
        // 로컬 IPFS 데몬 미응답 시 무시
    }

    console.error("IPFS 가져오기 실패:", cid);
    return {
        subject: "Unknown",
        author: "Unknown",
        title: "Unknown",
        content: "Cannot load content. (IPFS daemon is offline)",
    };
};

export function cidToBytes32(cid) {
  try {
    const decoded = bs58.decode(cid);
    const hashBytes = decoded.slice(2);
    const hex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return "0x" + hex;
  } catch (e) {
    return ethers.ZeroHash;
  }
}

export function bytes32ToCid(bytes32Str) {
  try {
    const hashHex = bytes32Str.replace('0x', '');
    const hashBytes = new Uint8Array(hashHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const multihash = new Uint8Array(34);
    multihash[0] = 0x12;
    multihash[1] = 0x20;
    multihash.set(hashBytes, 2);
    return bs58.encode(multihash);
  } catch (e) {
    return "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  }
}
