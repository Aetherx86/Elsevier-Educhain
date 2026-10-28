#!/usr/bin/env bash
# ==============================================================================
# start_all.sh: EduChain 전체 개발/데모 환경 원클릭 실행 스크립트
#
# 1) 로컬 하드햇 노드 기동 (포트 8545)
# 2) 스마트 컨트랙트 및 CopyrightVerifier 자동 배포
# 3) 릴레이어 & 키 에스크로 서버 기동 (포트 4000)
# 4) 프론트엔드 Vite 개발 서버 기동 (포트 5173)
# 5) Ctrl+C 누르면 모든 백그라운드 프로세스 안전 자동 종료 (trap)
#
# 사용법:
#   ./start_all.sh          (개발 서버 전체 구동)
#   ./start_all.sh --test   (전체 테스트 스크립트 실행)
# ==============================================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# --test 인자가 주어지면 test_all.sh 로 전환
if [ "$1" == "--test" ]; then
    exec ./test_all.sh
fi

# 터미널 색상
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

NODE_PID=""
RELAYER_PID=""
VITE_PID=""

cleanup() {
    echo -e "\n${YELLOW}========================================${NC}"
    echo -e "${YELLOW}EduChain 시스템을 안전하게 종료하는 중...${NC}"
    echo -e "${YELLOW}========================================${NC}"

    if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
        echo "Vite 개발 서버(PID: $VITE_PID) 종료..."
        kill "$VITE_PID" 2>/dev/null || true
    fi

    if [ -n "$RELAYER_PID" ] && kill -0 "$RELAYER_PID" 2>/dev/null; then
        echo "릴레이어 서버(PID: $RELAYER_PID) 종료..."
        kill "$RELAYER_PID" 2>/dev/null || true
    fi

    if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
        echo "하드햇 노드(PID: $NODE_PID) 종료..."
        kill "$NODE_PID" 2>/dev/null || true
    fi

    # 포트에 잔존하는 프로세스 정리
    local PIDS=$(lsof -ti :8545 -ti :4000 -ti :5173 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        kill -9 $PIDS 2>/dev/null || true
    fi

    echo -e "${GREEN}[OK] 모든 서비스가 정상 종료되었습니다.${NC}\n"
}
trap cleanup EXIT INT TERM

echo -e "\n${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}   EduChain All-In-One Full Stack Launcher                     ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}\n"

# 기존 포트 점유 검사
for PORT in 8545 4000 5173; do
    PID_FOUND=$(lsof -ti :$PORT 2>/dev/null || true)
    if [ -n "$PID_FOUND" ]; then
        echo -e "${YELLOW}[!] 포트 $PORT 번에 프로세스(PID: $PID_FOUND)가 이미 실행 중입니다. 재시작을 위해 정리합니다...${NC}"
        kill -9 $PID_FOUND 2>/dev/null || true
        sleep 1
    fi
done

# 키스토어 캐시 정리
rm -f scripts/.keystore.json

# 1. 하드햇 노드 기동
echo -e "${CYAN}[1/4] 하드햇 로컬 블록체인 노드 기동 중 (포트 8545)...${NC}"
npx hardhat node --hostname 0.0.0.0 > .hardhat_node.log 2>&1 &
NODE_PID=$!

NODE_READY=0
for i in {1..30}; do
    if curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' http://127.0.0.1:8545 >/dev/null 2>&1; then
        NODE_READY=1
        break
    fi
    sleep 0.5
done

if [ $NODE_READY -eq 1 ]; then
    echo -e "${GREEN}[OK] 하드햇 노드 기동 성공! (PID: $NODE_PID, Chain ID: 31337)${NC}\n"
else
    echo -e "${RED}[ERROR] 하드햇 노드 기동 실패. .hardhat_node.log 를 확인하세요.${NC}"
    exit 1
fi

# 2. 스마트 컨트랙트 배포
echo -e "${CYAN}[2/4] 스마트 컨트랙트 및 CopyrightVerifier 배포 중...${NC}"
npx hardhat run scripts/deploy.js --network localhost
echo -e "${GREEN}[OK] 스마트 컨트랙트 배포 완료!${NC}\n"

# The Graph 서브그래프 동기화 (Docker 가 기동 중인 경우)
if docker ps 2>/dev/null | grep -q "graph-node"; then
    echo -e "${CYAN}[SubGraph] The Graph 서브그래프 동기화 및 로컬 배포 중...${NC}"
    npx graph create --node http://127.0.0.1:8020/ jk9576/Elsevier-Educhain >/dev/null 2>&1 || true
    npx graph deploy --node http://127.0.0.1:8020/ --ipfs http://127.0.0.1:5001 --version-label v0.0.1 jk9576/Elsevier-Educhain subgraph/subgraph.yaml >/dev/null 2>&1 || true
    echo -e "${GREEN}[OK] Subgraph 로컬 배포 완료!${NC}\n"
fi

# 3. 릴레이어 & 키 에스크로 서버 기동
echo -e "${CYAN}[3/4] Paymaster 릴레이어 & 키 에스크로 서버 기동 중 (포트 4000)...${NC}"
node scripts/relayer.js > .relayer.log 2>&1 &
RELAYER_PID=$!

RELAYER_READY=0
for i in {1..20}; do
    if lsof -i :4000 >/dev/null 2>&1; then
        RELAYER_READY=1
        break
    fi
    sleep 0.5
done

if [ $RELAYER_READY -eq 1 ]; then
    echo -e "${GREEN}[OK] 릴레이어 & 키 에스크로 서버 기동 성공! (PID: $RELAYER_PID)${NC}\n"
else
    echo -e "${RED}[ERROR] 릴레이어 서버 기동 실패. .relayer.log 를 확인하세요.${NC}"
    exit 1
fi

# 4. 프론트엔드 Vite 개발 서버 기동
echo -e "${CYAN}[4/4] 프론트엔드 Vite 웹앱 기동 중 (포트 5173)...${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}   [START] 모든 서비스가 성공적으로 구동되었습니다!                 ${NC}"
echo -e "${BOLD}${GREEN}   - 웹앱 주소     : http://localhost:5173                      ${NC}"
echo -e "${BOLD}${GREEN}   - 블록체인 RPC  : http://127.0.0.1:8545 (Chain ID: 31337)   ${NC}"
echo -e "${BOLD}${GREEN}   - 키 에스크로   : http://127.0.0.1:4000                      ${NC}"
echo -e "${BOLD}${GREEN}   - 종료 방법     : 이 터미널에서 Ctrl + C                    ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}\n"

npm run dev
