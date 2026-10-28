// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

// EduChainForwarder
// -----------------
// EIP-7702(계정 추상화 + Paymaster)의 실무적 대안으로 도입한 ERC-2771 신뢰된
// Forwarder 계약. OpenZeppelin의 감사된 ERC2771Forwarder를 그대로 상속만 해서
// 배포용 이름을 붙인 얇은 래퍼(wrapper)이다.
//
// 동작 원리:
//   1. 학생(사용자)이 지갑에서 "가스비 없이" ForwardRequest(EIP-712 typed data)에
//      서명만 한다. (트랜잭션 전송 X, 오프체인 서명만 발생 -> 가스비 0)
//   2. 학교/운영진이 띄워둔 릴레이어(scripts/relayer.js, Paymaster 역할)가
//      서명된 요청을 받아 이 컨트랙트의 execute()를 호출하며, 이때 가스비는
//      릴레이어의 지갑에서 지불된다.
//   3. 이 컨트랙트가 EduChain.submitProblem() 등을 대신 호출해주고,
//      EduChain은 ERC2771Context 덕분에 실제 서명자를 _msgSender()로 인식한다.
//
// 참고: OpenZeppelin Contracts v5 기준 ERC2771Forwarder가 v4의 MinimalForwarder를
// 대체하는 표준 구현체이며, ForwardRequestData { from, to, value, gas, deadline,
// data, signature } 구조체와 execute()/executeBatch() 함수를 제공한다.
contract EduChainForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("EduChainForwarder") {}
}
