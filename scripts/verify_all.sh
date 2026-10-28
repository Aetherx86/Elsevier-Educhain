#!/bin/bash

# 색상 지정
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 스크립트 실행 위치와 상관없이 Educhain 프로젝트 루트 폴더로 자동 이동
cd "$(dirname "$0")/.." || exit 1

echo "========================================"
echo -e "${GREEN}[1/4] 프로젝트 무결성 해시 생성 시작...${NC}"
echo "========================================"
find . -type f -not -path "*/\.git/*" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/cache/*" -not -path "*/artifacts/*" -exec shasum -a 256 {} + > project_hashes.sha256
echo -e "${GREEN}[OK] project_hashes.sha256 파일 생성 완료!${NC}\n"

echo "========================================"
echo -e "${GREEN}[2/4] 프론트엔드 빌드 무결성 테스트...${NC}"
echo "========================================"
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}[OK] 프론트엔드 빌드(컴파일) 성공! 문법 에러 없음.${NC}\n"
else
    echo -e "${RED}[ERROR] 프론트엔드 빌드 실패! 코드를 확인하세요.${NC}\n"
    exit 1
fi

echo "========================================"
echo -e "${GREEN}[3/4] 백엔드(블록체인 노드) 가동 및 배포 테스트...${NC}"
echo "========================================"
# 분석 데이터(Telemetry) 프롬프트 스킵을 위한 환경변수
export HARDHAT_ENABLE_NO_ANALYTICS=true

# 백그라운드에서 하드햇 노드 실행
npx hardhat node > hardhat_node.log 2>&1 &
NODE_PID=$!

# 노드가 켜질 때까지 잠시 대기 (3초)
echo "노드 부팅 대기 중..."
sleep 3

# 스마트 컨트랙트 배포 스크립트 실행
npx hardhat run scripts/deployL2.js --network localhost
DEPLOY_STATUS=$?

if [ $DEPLOY_STATUS -eq 0 ]; then
    echo -e "${GREEN}[OK] 스마트 컨트랙트 컴파일 및 로컬 노드 배포 성공!${NC}\n"
else
    echo -e "${RED}[ERROR] 배포 실패! 스마트 컨트랙트 또는 환경 설정을 확인하세요.${NC}\n"
fi

echo "========================================"
echo -e "${GREEN}[4/4] 테스트 종료 및 환경 정리...${NC}"
echo "========================================"
# 백그라운드 노드 종료
kill $NODE_PID
echo -e "${GREEN}[OK] 로컬 노드 종료 완료!${NC}\n"

if [ $DEPLOY_STATUS -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS] 모든 검증 스텝(해시, 빌드, 컨트랙트 배포)이 완벽하게 자동 통과되었습니다! [SUCCESS]${NC}"
else
    echo -e "${RED}[WARN] 일부 검증 스텝이 실패했습니다. 로그를 확인하세요.${NC}"
    exit 1
fi
