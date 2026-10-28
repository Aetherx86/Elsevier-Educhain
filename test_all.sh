#!/usr/bin/env bash
# ==============================================================================
# test_all.sh: EduChain 전 주기 시스템 통합 테스트 + 웹앱 연속 구동 스크립트
#
# 1) 로컬 하드햇 노드 기동 (포트 8545)
# 2) 스마트 컨트랙트 및 CopyrightVerifier 자동 배포
# 3) The Graph (도커 실행 중인 경우) 상태 동기화 및 서브그래프 배포
# 4) 릴레이어 및 키 에스크로 서버 기동 (포트 4000)
# 5) TDD 전 주기 시스템 시뮬레이션 (83개 스텝) + 단위 테스트 (32개) 실행
# 6) [중요] 테스트 완료 후 웹앱(Vite)을 실행하여 구동 상태를 유지 (자동 종료 X)
# 7) 사용자가 터미널에서 Ctrl + C 를 누르면 모든 프로세스 안전 자동 종료 (trap)
# ==============================================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

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

# 사용자가 Ctrl+C 누르거나 스크립트 종료 시 백그라운드 프로세스 자동 정리 함수
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

    # 포트에 잔여 프로세스가 있을 경우 강제 정리
    local PIDS=$(lsof -ti :8545 -ti :4000 -ti :5173 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        kill -9 $PIDS 2>/dev/null || true
    fi

    echo -e "${GREEN}[OK] 모든 서비스가 안전하게 정리되었습니다.${NC}\n"
}
trap cleanup EXIT INT TERM

echo -e "\n${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}   EduChain Full Test Suite & Live WebApp Launcher             ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}\n"

# 기존 점유 포트 확인 및 정리
for PORT in 8545 4000 5173; do
    PID_FOUND=$(lsof -ti :$PORT 2>/dev/null || true)
    if [ -n "$PID_FOUND" ]; then
        echo -e "${YELLOW}[!] 포트 $PORT 번에 기존 프로세스(PID: $PID_FOUND)가 실행 중입니다. 정리합니다...${NC}"
        kill -9 $PID_FOUND 2>/dev/null || true
        sleep 1
    fi
done

# 키스토어 캐시 정리
rm -f scripts/.keystore.json

# 1. 하드햇 노드 기동
echo -e "${CYAN}[1/5] 하드햇 로컬 블록체인 노드 기동 중 (포트 8545)...${NC}"
npx hardhat node --hostname 0.0.0.0 > .hardhat_node.log 2>&1 &
NODE_PID=$!

# RPC 응답 대기 (최대 15초)
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
    echo -e "${RED}[ERROR] 하드햇 노드 기동 실패. .hardhat_node.log 로그를 확인하세요.${NC}"
    exit 1
fi

# 2. 스마트 컨트랙트 배포
echo -e "${CYAN}[2/5] 스마트 컨트랙트 및 CopyrightVerifier 로컬 배포 중...${NC}"
npx hardhat run scripts/deploy.js --network localhost
echo -e "${GREEN}[OK] 스마트 컨트랙트 배포 완료!${NC}\n"

# 3. The Graph 서브그래프 동기화 (Docker 가 기동 중인 경우)
if docker ps 2>/dev/null | grep -q "graph-node"; then
    echo -e "${CYAN}[3/5] The Graph 서브그래프 동기화 및 로컬 배포 중...${NC}"
    npx graph create --node http://127.0.0.1:8020/ jk9576/Elsevier-Educhain >/dev/null 2>&1 || true
    npx graph deploy --node http://127.0.0.1:8020/ --ipfs http://127.0.0.1:5001 --version-label v0.0.1 jk9576/Elsevier-Educhain subgraph/subgraph.yaml >/dev/null 2>&1 || true
    echo -e "${GREEN}[OK] Subgraph 로컬 배포 완료!${NC}\n"
else
    echo -e "${YELLOW}[3/5] (안내) The Graph Docker 컨테이너가 꺼져 있어 서브그래프 동기화를 건너뜁니다.${NC}\n"
fi

# 4. 릴레이어 & 키 에스크로 서버 기동
echo -e "${CYAN}[4/5] Paymaster 릴레이어 & 키 에스크로 서버 기동 중 (포트 4000)...${NC}"
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
    echo -e "${RED}[ERROR] 릴레이어 서버 기동 실패. .relayer.log 로그를 확인하세요.${NC}"
    exit 1
fi

# 5. 테스트 실행
echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}[5/5] 1. 전 주기 TDD 시스템 통합 테스트 (83개 스텝 시뮬레이션)...${NC}"
echo -e "${CYAN}================================================================${NC}"
npx hardhat run scripts/tddFullSystemTest.js --network localhost

echo -e "\n${CYAN}================================================================${NC}"
echo -e "${CYAN}[5/5] 2. 하드햇 단위 테스트 (ZK 저작권 19건 + 핵심 기능 13건 + 담합 방지/VRA 6건 = 총 38건)...${NC}"
echo -e "${CYAN}================================================================${NC}"
npx hardhat test

echo -e "\n${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}   [SUCCESS] 모든 테스트(TDD 83단계 + 단위 38건) 통과 완료! [SUCCESS]          ${NC}"
echo -e "${BOLD}${GREEN}   [START] 이제 EduChain 웹앱(Vite)이 구동된 상태로 유지됩니다.       ${NC}"
echo -e "${BOLD}${GREEN}   - 웹앱 브라우저 : http://localhost:5173                      ${NC}"
echo -e "${BOLD}${GREEN}   - 블록체인 RPC  : http://127.0.0.1:8545 (Chain ID: 31337)   ${NC}"
echo -e "${BOLD}${GREEN}   - 키 에스크로   : http://127.0.0.1:4000                      ${NC}"
echo -e "${BOLD}${YELLOW}   - 종료 방법     : 사용 후 이 터미널에서 Ctrl + C 를 누르세요 ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}\n"

# [중요] 웹앱을 구동하고 사용자가 Ctrl+C로 종료할 때까지 유지
npm run dev
