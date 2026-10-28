import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  Approval,
  OwnershipTransferred,
  ProblemFinalized,
  ProblemSubmitted,
  RewardClaimed,
  Transfer,
  Voted
} from "../generated/EduChain/EduChain"

export function createApprovalEvent(
  owner: Address,
  spender: Address,
  value: BigInt
): Approval {
  let approvalEvent = changetype<Approval>(newMockEvent())

  approvalEvent.parameters = new Array()

  approvalEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )
  approvalEvent.parameters.push(
    new ethereum.EventParam("spender", ethereum.Value.fromAddress(spender))
  )
  approvalEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value))
  )

  return approvalEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent =
    changetype<OwnershipTransferred>(newMockEvent())

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createProblemFinalizedEvent(
  problemId: BigInt,
  status: i32
): ProblemFinalized {
  let problemFinalizedEvent = changetype<ProblemFinalized>(newMockEvent())

  problemFinalizedEvent.parameters = new Array()

  problemFinalizedEvent.parameters.push(
    new ethereum.EventParam(
      "problemId",
      ethereum.Value.fromUnsignedBigInt(problemId)
    )
  )
  problemFinalizedEvent.parameters.push(
    new ethereum.EventParam(
      "status",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(status))
    )
  )

  return problemFinalizedEvent
}

export function createProblemSubmittedEvent(
  problemId: BigInt,
  provider: Address,
  ipfsCid: string
): ProblemSubmitted {
  let problemSubmittedEvent = changetype<ProblemSubmitted>(newMockEvent())

  problemSubmittedEvent.parameters = new Array()

  problemSubmittedEvent.parameters.push(
    new ethereum.EventParam(
      "problemId",
      ethereum.Value.fromUnsignedBigInt(problemId)
    )
  )
  problemSubmittedEvent.parameters.push(
    new ethereum.EventParam("provider", ethereum.Value.fromAddress(provider))
  )
  problemSubmittedEvent.parameters.push(
    new ethereum.EventParam("ipfsCid", ethereum.Value.fromString(ipfsCid))
  )

  return problemSubmittedEvent
}

export function createRewardClaimedEvent(
  user: Address,
  amount: BigInt
): RewardClaimed {
  let rewardClaimedEvent = changetype<RewardClaimed>(newMockEvent())

  rewardClaimedEvent.parameters = new Array()

  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return rewardClaimedEvent
}

export function createTransferEvent(
  from: Address,
  to: Address,
  value: BigInt
): Transfer {
  let transferEvent = changetype<Transfer>(newMockEvent())

  transferEvent.parameters = new Array()

  transferEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  )
  transferEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  transferEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value))
  )

  return transferEvent
}

export function createVotedEvent(
  problemId: BigInt,
  verifier: Address,
  isCorrect: boolean
): Voted {
  let votedEvent = changetype<Voted>(newMockEvent())

  votedEvent.parameters = new Array()

  votedEvent.parameters.push(
    new ethereum.EventParam(
      "problemId",
      ethereum.Value.fromUnsignedBigInt(problemId)
    )
  )
  votedEvent.parameters.push(
    new ethereum.EventParam("verifier", ethereum.Value.fromAddress(verifier))
  )
  votedEvent.parameters.push(
    new ethereum.EventParam("isCorrect", ethereum.Value.fromBoolean(isCorrect))
  )

  return votedEvent
}
