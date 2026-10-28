// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/Educhain.sol";

contract EduChainGasTest is Test {
    EduChain public educhain;
    address public relayer = address(0x123);
    address public provider = address(0x456);

    // [수정] submitProblem은 이제 bytes32 CID를 받는다 (string 리터럴은 32바이트를
    // 초과하면 암시적 변환이 안 되어 컴파일 에러가 남). 실제 앱의 cidToBytes32()와
    // 마찬가지로, 여기서는 keccak256 해시를 테스트용 bytes32 CID로 사용한다.
    bytes32 public testCid = keccak256(abi.encodePacked("bafybeigyygrsfnus5y5eihk4duaxist43yypjs3ftof6x4caxufoabkgrq"));

    function setUp() public {
        educhain = new EduChain(relayer);
        // Mint initial EDU for provider
        educhain.faucet();
        // Since faucet uses msg.sender, let's impersonate provider
        vm.startPrank(provider);
        educhain.faucet();
        educhain.approve(address(educhain), type(uint256).max);
        vm.stopPrank();
    }

    function testGas_SubmitProblem() public {
        vm.startPrank(provider);
        educhain.submitProblem(testCid, 10 * 10**18, "Math", "Author");
        vm.stopPrank();
    }

    function testGas_Vote() public {
        vm.startPrank(provider);
        educhain.submitProblem(testCid, 10 * 10**18, "Math", "Author");
        vm.stopPrank();

        address verifier = address(0x789);
        vm.startPrank(verifier);
        educhain.faucet();
        educhain.approve(address(educhain), type(uint256).max);
        // [수정] 컨트랙트의 실제 함수명은 voteProblem이다 (vote 아님).
        // [수정] submitProblem은 problemCount를 먼저 ++ 한 뒤 저장하므로
        // 첫 번째로 제출된 문제의 id는 0이 아니라 1이다.
        educhain.voteProblem(1, true);
        vm.stopPrank();
    }
}
