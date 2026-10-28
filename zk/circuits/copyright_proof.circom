pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

/*
 * EduChain 저작권(원작자) 영지식 증명 서킷
 *
 * 증명하는 명제:
 *   "나는 어떤 문제 원문의 해시(contentHash)와 비밀 salt를 알고 있으며,
 *    Poseidon(contentHash, salt) 이 온체인에 등록된 commitment 와 같다."
 *
 *  - contentHash, salt        : Private Input (절대 공개되지 않음)
 *  - commitment               : Public Output (출제 시점에 온체인에 타임스탬프와 함께 등록)
 *  - author                   : Public Input  (증명 제출자 주소. 증명을 다른 사람이 가로채
 *                                              자기 것처럼 재사용(front-running)하지 못하도록 묶음)
 *
 * snarkjs 의 public signals 순서: [commitment, author]
 */
template CopyrightProof() {
    signal input contentHash;
    signal input salt;
    signal input author;

    signal output commitment;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== contentHash;
    hasher.inputs[1] <== salt;
    commitment <== hasher.out;

    // author 가 증명 회로에서 제거(최적화)되지 않도록 제약에 포함 (Tornado Cash 방식의 binding)
    signal authorSquare;
    authorSquare <== author * author;
}

component main { public [author] } = CopyrightProof();
