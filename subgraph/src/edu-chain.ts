import { BigInt } from "@graphprotocol/graph-ts"
import {
  ProblemSubmitted,
  Voted,
  ProblemFinalized
} from "../generated/EduChain/EduChain"
import { Problem, Vote } from "../generated/schema"

export function handleProblemSubmitted(event: ProblemSubmitted): void {
  let problem = new Problem(event.params.problemId.toString())
  problem.provider = event.params.provider
  problem.ipfsCid = event.params.ipfsCid
  problem.subject = event.params.subject
  problem.authorName = event.params.authorName
  problem.status = 0
  problem.save()
}

export function handleVoted(event: Voted): void {
  // 중복 투표 방지 및 고유 ID 생성을 위해 "ID-주소" 형식 사용
  let voteId = event.params.problemId.toString() + "-" + event.params.verifier.toHexString()
  let vote = new Vote(voteId)
  vote.problemId = event.params.problemId
  vote.verifier = event.params.verifier
  vote.isCorrect = event.params.isCorrect
  vote.save()
}

export function handleProblemFinalized(event: ProblemFinalized): void {
  let problem = Problem.load(event.params.problemId.toString())
  if (problem) {
    problem.status = event.params.status
    problem.save()
  }
}