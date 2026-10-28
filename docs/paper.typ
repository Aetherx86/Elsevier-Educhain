#set page(
  paper: "a4",
  margin: (top: 1.8cm, bottom: 1.8cm, left: 1.6cm, right: 1.6cm),
  header: align(right)[
    #text(size: 8pt, fill: luma(120))[IACR Cryptology ePrint Archive Pre-submission Working Paper | DOI: 10.5281/zenodo.23612872]
  ],
  footer: [
    #align(center)[
      #context text(size: 8pt, fill: luma(120))[Page #counter(page).display("1 of 1", both: true)]
    ]
  ]
)
#set text(
  font: "Times New Roman",
  size: 9.2pt,
  lang: "en",
  hyphenate: false
)
#set par(justify: true, leading: 0.54em)
#set heading(numbering: "1.1")

#align(center)[
  #v(0.3cm)
  #text(size: 15pt, weight: "bold")[EduChain: Collusion-Resistant and Confidential Peer Review for Academic Content via Zero-Knowledge Proofs and Stochastic Mechanism Design]
  
  #v(0.4cm)
  #text(size: 10.5pt)[
    *Jeonghoon Kim* \
    Department of Computer Science and Engineering, Hanyang University \
    Email: jk9576\@hanyang.ac.kr \
    Permanent DOI: https://doi.org/10.5281/zenodo.23612872 \
    Code Repository: https://gitlab.com/jk9576/Elsevier-Educhain
  ]
  #v(0.4cm)
]

#rect(
  width: 100%,
  stroke: 0.5pt + luma(180),
  inset: 10pt,
  radius: 3pt,
  fill: rgb("#fcfcfd")
)[
  #text(weight: "bold", size: 10pt)[Abstract] --- 
  Decentralized knowledge marketplaces often face an irreconcilable trilemma: *Confidentiality* (preventing unauthorized scraping and intellectual property theft), *Verifiability* (enabling decentralized peers to inspect and validate accuracy), and *Incentive Alignment* (preventing Sybil cartels and collusion). Pure cryptographic zero-knowledge systems conceal data entirely, rendering qualitative peer review impossible; conversely, plaintext crowdsourcing models leak IP to the public, destroying creation incentives. 

  In this paper, we propose *EduChain*, a dual cryptographic and game-theoretic framework that resolves this trilemma. EduChain couples a *Poseidon-based zk-SNARK authorship commitment scheme* with an *On-Chain Conditional Key Escrow* governed by a novel *Review Bond Staking Rollover* protocol. To eliminate collusion and reviewer-author bribery, we design a *Verifiable Random Assignment (VRA)* mechanism parameterized by an on-chain entropy beacon, bounding the cartel hijacking probability to $O(1/binom(M, k))$. Furthermore, we prove that under our non-inflationary 70/20/10 purchase settlement model, wash-trading cartels face a guaranteed *negative-sum capital depletion rate of -10% per transaction*, proving that honest participation forms a strict subgame perfect Nash equilibrium. We deploy and benchmark EduChain on an EVM Layer-2 environment. Experimental evaluations across 83 continuous integration test vectors demonstrate that our Groth16 verification requires only *256,146 gas* (under \$0.01 on Arbitrum/Base) and client-side proof generation completes in under *820 ms*, establishing EduChain as a practical, mathematically secure paradigm for decentralized intellectual property evaluation.

  #v(3pt)
  #text(weight: "bold")[Keywords:] Zero-knowledge proofs, Groth16, Poseidon hash, Mechanism design, Collusion resistance, Verifiable random assignment, Peer review, Blockchain.
]

#v(0.3cm)
#show: rest => columns(2, rest)

= Introduction

Peer review and collaborative knowledge curation are foundational to academic evaluation, educational content distribution, and technical credentialing. However, existing commercial platforms (e.g., Chegg, CourseHero) and Web2 academic networks suffer from severe institutional failures:
1. *Centralized Value Extraction:* Platforms capture upwards of 95% of economic rents while original content creators (students, teaching assistants, researchers) receive zero recurring royalties.
2. *Quality Asymmetry:* Community forums (e.g., Reddit, university bulletin boards) suffer from unverified, low-quality submissions, where error rates in posted exam solutions frequently exceed 40%.
3. *Intellectual Property (IP) Hemorrhage:* Once academic materials are published online, automated web crawlers and malicious users redistribute them, directly violating copyright statutes (e.g., US DMCA, Korean Copyright Act Art. 102).

While decentralized ledger technology and Proof-of-Brain (PoB) mechanisms (e.g., Steemit) attempted to democratize curation, directly applying them to proprietary educational content reveals an acute *Verification Paradox*:
$ "Private " cal(M) " (ZKP): " "Reviewers blind" arrow.r.double "Verification fails." $
$ "Public " cal(M) " (IPFS): " "Unchecked scraping" arrow.r.double "Author IP destroyed." $

Furthermore, any decentralized consensus mechanism governed by human voting is inherently vulnerable to *Cartel Collusion* and *Sybil Spoofing*: an author can deploy multiple dummy wallets or invite a syndicate of acquaintances to upvote fraudulent or stolen content, extracting unearned protocol rewards.

== Contributions
To resolve these challenges, this paper presents *EduChain*, delivering the following contributions:
- *Hybrid Cryptographic Architecture:* We integrate client-side AES-256-GCM symmetric authenticated encryption with an on-chain Poseidon zk-SNARK commitment circuit on the BN254 elliptic curve. By binding the author's public address into the circuit's public signals, we mathematically eliminate front-running and replay attacks.
- *Conditional Key Escrow with Staking Rollover:* We propose a non-interactive review staking protocol where an examiner escrows a 5 EDU Review Bond. The smart contract validates viewing eligibility via a deterministic oracle (`canViewProblem`). Upon ballot submission, the review bond is *atomically rolled over into the consensus voting stake*, reducing economic double-marginalization and user friction to zero.
- *Game-Theoretic Collusion Defense:* We formulate the cartel formation problem as an extensive-form game. By pairing a *Verifiable Random Assignment (VRA)* committee selection algorithm with a mandatory 10% platform reserve sink ($tau = 0.10$), we provide an analytical proof that collusive wash-trading yields negative expected returns ($bb(E)\[Delta U_"cartel"\] < 0$), rendering honest evaluation the unique subgame perfect Nash equilibrium.
- *Dynamic Forensic Watermarking:* To deter screengrab leaks by authorized reviewers, our client-side rendering pipeline injects deterministic, semi-transparent CSS-overlay watermarks encoding the viewer's Ethereum address across decrypted DOM containers with event-level copy interception.
- *Full-Stack Implementation and Empirical Verification:* We implement the complete protocol comprising 2,100+ lines of Solidity (v0.8.24), Circom 2 circuits, SnarkJS pipelines, an ERC-2771 meta-transaction relayer, and a Subgraph indexing pipeline. Across 83 formal verification test scenarios and 38 Hardhat unit tests, we prove 100% test passage and sub-cent L2 execution costs.

= Threat Model and Problem Formulation

== Threat Vectors
We model an untrusted, permissionless network with the following adversarial capabilities:
1. *Malicious Author ($A_"mal"$):* Attempts to register stolen, incorrect, or empty content, claiming authorship rights and aiming to extract staking payouts.
2. *Reviewer Cartels ($cal(C) = {V_1, dots, V_k}$):* A group of strategic peers colluding with an author to approve invalid content or upvote each other's submissions regardless of objective accuracy.
3. *Sybil Adversary ($S_"adv"$):* An entity generating $N$ ephemeral cryptographic addresses to simulate decentralized consensus without genuine computational or cognitive work.
4. *Front-Running Adversary ($F_"adv"$):* A mempool-sniffing actor attempting to intercept an author's zk-SNARK proof $pi = (A, B, C)$ and broadcast it with their own address to hijack copyright timestamps.
5. *Leakage Adversary ($L_"adv"$):* An authorized examiner who legitimately decrypts problem $cal(M)$ and captures screen images to sell them on unauthorized external third-party channels.

== Design Objectives
A secure decentralized peer review protocol must satisfy:
- *Confidentiality:* For any adversary $E cancel(in) "EligibleViewers"$, the probability of discovering plaintext $cal(M)$ is negligible: $Pr["Dec"(C) = cal(M)] lt.eq "negl"(lambda)$.
- *Authorship Soundness:* No adversary can prove authorship over $"commitment" = "Poseidon"(H(cal(M)), "salt", "author")$ without knowledge of pre-images $(H(cal(M)), "salt")$.
- *Collusion Infeasibility:* The expected utility of forming a collusive syndicate to artificially pass an invalid question must be strictly less than honest behavior: $bb(E)\[U(cal(C))\] < bb(E)\[U("Honest")\].$
- *No Double Staking Friction:* A verifier examining and subsequent voting must not be penalized with double deposit deductions.

= Cryptographic Framework

== Content Encryption and Storage
Let $cal(M)$ denote the canonical JSON string combining problem statements, LaTeX equations, options, and binary image attachments.
1. The author samples a 256-bit symmetric key $K <- {0,1}^(256)$ and a 96-bit initialization vector $"IV" <- {0,1}^(96)$.
2. Authenticated encryption produces ciphertext $C$ and a 128-bit authentication tag $T$:
   $ (C, T) = "AES-GCM-Enc"_K ("IV", cal(M)) $
3. $(C, "IV", T)$ is dispatched to an IPFS node, producing a cryptographic content identifier (CIDv0). The 34-byte multihash is converted without information loss into a single 32-byte EVM storage slot:
   $ mono("bytes32_cid") = "truncate"("base58Decode"("CIDv0")) $

== Authorship Commitment via Poseidon Hash
Standard cryptographic hashes (SHA-256, Keccak-256) incur prohibitive constraint sizes ($>25,000$ constraints per block) in arithmetic circuits. We employ the *Poseidon algebraic hash function* over the scalar field $bb(F)_r$ of the BN254 elliptic curve, where:
$ r = 2188824287183927522224640574525727508854 \
      8364400416034343698204186575808495617 approx 2^(254) $

Let $h_(cal(M)) = "SHA256"(cal(M)) mod r$, and $s <- bb(F)_r$ be a high-entropy salt. The author binds their Ethereum account address $alpha in bb(F)_r$ into the commitment:
$ cal(Z) = "Poseidon"_3 (h_(cal(M)), s, alpha) $

The author submits $cal(Z)$ to `EduChain.sol` via `registerCopyright`. The contract enforces global pre-emption:
$ mono("commitmentProblem")[cal(Z)] = id $

== Front-Running Resilient Groth16 Proof
When proving priority, the author constructs an R1CS constraint system in Circom 2:
$ "Poseidon"_3 (h_(cal(M)), s, alpha) == cal(Z) $

#block(fill: luma(245), inset: 6pt, radius: 2pt)[
*Theorem 1 (Front-Running Impossibility).*
#emph[An adversary $cal(A)$ observing a valid proof $pi = (A, B, C)$ on-chain cannot replay $pi$ under their own address $alpha_(cal(A)) eq.not alpha$.]
]

#emph[Proof.] In the Groth16 verification equation:
$ e(A, B) = e(alpha_"crs", beta_"crs") dot e(sum_(i=0)^(ell) x_i dot gamma_i, delta_"crs") dot e(C, delta_"crs") $
the public input vector is $x = \[1, cal(Z), alpha\]^T$. The linear combination element $sum x_i gamma_i = gamma_0 + cal(Z)gamma_1 + alpha gamma_2 in bb(G)_1$ explicitly evaluates with $alpha = mono("uint256")(mono("uint160")(mono("msg.sender")))$. If $cal(A)$ broadcasts $pi$ where $mono("msg.sender") = alpha_(cal(A))$, the pairing term shifts by $(alpha_(cal(A)) - alpha)gamma_2$. Because $delta_"crs"$ and $gamma_2$ are generated under discrete-log intractability during the trusted setup ceremony, $cal(A)$ cannot compute a compensating shift $C'$ without solving the discrete logarithm in $bb(G)_1$. Thus, verification strictly fails: $mono("verifyProof")(pi, \[cal(Z), alpha_(cal(A))\]) = mono("false")$. $square$

= Game-Theoretic Mechanism Design

== Conditional Key Escrow and Staking Rollover
To prevent free-riding inspections where reviewers browse questions without voting, we enforce a two-phase state machine:
1. *Escrow Phase:* Examiner $V$ invokes `requestReviewAccess` staking 5 EDU.
2. *Oracle Authentication:* The key server executes an on-chain static call to `canViewProblem`.
3. *Atomic Rollover:* When $V$ casts ballot $nu in {"Correct", "Incorrect"}$, the review bond is cleared and rolled directly into `totalStake` without additional debit.
4. *Conditional Refund Locking:* If $V$ abstains from voting, the bond is locked until problem state $mono("status") eq.not 0 or not mono("active")$, preventing opportunistic peek-and-retreat attacks.

== Verifiable Random Assignment (VRA) Against Cartels
To counter collusive peer networks where an author requests friends to upvote content, we introduce stochastic committee selection.

Let $cal(U)_"pool" = {V_1, V_2, dots, V_M}$ be the set of active bonded examiners registered for subject $cal(S)$. When problem $id$ opens for review, an on-chain pseudo-random seed $xi$ is derived:
$ xi = "Keccak256"(mono("prevrandao"), id, mono("timestamp")) $

The review committee $Gamma_(id)$ of size $k = 5$ is determined via Fisher-Yates shuffle sampling without replacement:
$ Gamma_(id) = "Sample"(cal(U)_"pool", k, xi) $

#block(fill: luma(245), inset: 6pt, radius: 2pt)[
*Proposition 1 (Cartel Hijack Resistance).*
#emph[Suppose an author colludes with a cartel of $m$ peers within a reviewer pool of size $M$. The probability $P_"hijack"$ that all $k$ assigned committee members belong to the cartel is:]
$ P_"hijack" = (binom(m, k)) / (binom(M, k)) = product_(j=0)^(k-1) (m - j) / (M - j) $
]

For realistic campus parameters ($M = 100$, $m = 5$, $k = 5$):
$ P_"hijack" = (binom(5, 5)) / (binom(100, 5)) = 1 / 75,287,520 approx 1.328 times 10^(-8) $

Even with a substantial syndicate ($m = 20$ in $M = 100$), $P_"hijack" = binom(20, 5) / binom(100, 5) approx 0.0206\%$. Consequently, cartel-controlled quorum formation is statistically improbable.

== Wash-Trading Negative-Sum Depletion Theorem
Consider a scenario where an author colludes with a cartel $cal(C)$ to pass a counterfeit problem, subsequently executing self-purchases to simulate popularity or capture distribution fees.

#block(fill: luma(245), inset: 6pt, radius: 2pt)[
*Theorem 2 (Negative-Sum Collusion Inevitability).*
#emph[In EduChain's non-inflationary 70/20/10 protocol, any closed collusive network $cal(K) = {A} union cal(C)$ executing synthetic transactions suffers an inescapable capital depletion rate of $tau = 10\%$ per transaction cycle, yielding an asymptotic balance of zero.]
]

#emph[Proof.] Let the listing price be $cal(P)$. To execute a synthetic transaction, the cartel must inject external capital $Delta C_"in" = cal(P)$.
Upon transaction finalization (`purchaseProblem`), the contract distributes the gross payment:
$ cal(R)_"author" = 0.70 dot cal(P) $
$ cal(R)_"verifiers" = 0.20 dot cal(P) $
$ cal(R)_"platform" = 0.10 dot cal(P) arrow.r mono("platformReserve") += 0.10 dot cal(P) $

Since the entire cartel consists of ${A} union cal(C)$, the total capital retrieved by the syndicate is:
$ Delta C_"retrieved" = 0.70cal(P) + 0.20cal(P) = 0.90cal(P) $
The net financial balance shift for the collusive entity across $N$ wash-trades is:
$ Delta W_N = sum_(t=1)^N (0.90cal(P) - cal(P)) = -0.10 dot N dot cal(P) $
$ lim_(N arrow.r infinity) W_N = 0 quad (forall W_0 < infinity) $
Because the 10% platform tax is routed to the un-withdrawable `platformReserve`, wash-trading cannot extract protocol funds, imposing a deterministic penalty of 10% on collusive deception. $square$

== Fleiss' Kappa Consensus & Slashing
To filter out uncorrelated or random guessing, EduChain integrates Fleiss' multi-rater Kappa statistic ($kappa$). For $N = 5$ verifiers categorizing items:
$ kappa = (macron(P) - macron(P)_e) / (1 - macron(P)_e) $
- *Autonomous Approval ($kappa gt.eq 0.61$):* Substantial agreement. If majority $\ge 80\%$, the problem is finalized as Verified (`status = 1`). Staked 100 EDU author principal is unreserved.
- *Ambiguous Quorum ($0.41 lt.eq kappa < 0.61$):* The contract holds finalization in escrow and dispatches an auxiliary committee of 5 additional random verifiers ($N_"extended" = 10$).
- *Rejection & Slashing ($kappa < 0.41$ or Majority Incorrect):* The author's 100 EDU bond is slashed to the treasury, and dissenting incorrect voters forfeit their 5 EDU bonds.

== Dynamic Reputation Weighting Engine
Let $C_i$ and $F_i$ denote historical correct and wrong vote counts for verifier $i$. The dynamic reputation weight $W_i$ is:
$ W_i = "clamp"(1.00 + 0.10 dot floor(C_i / 10) - 0.10 dot floor(F_i / 3), 0.50, 2.00) $
When a question is purchased, the 20% verifier pool ($cal(V)_"cut" = 0.20 dot cal(P)$) is divided strictly by normalized weight shares:
$ "Reward"_i = cal(V)_"cut" dot (W_i) / (sum_(j in cal(V)_"correct") W_j) $

= Security and Microeconomic Analysis

== Threat Mitigation Summary

#table(
  columns: (1fr, 1.2fr, 1.4fr),
  inset: 4pt,
  stroke: 0.5pt + luma(180),
  align: (left, left, left),
  [*Attack Vector*], [*EduChain Countermeasure*], [*Formal Guarantee*],
  [Front-Running], [Circom `author` public signal], [Discrete-Log Hardness (Thm 1)],
  [Friend Cartel], [Verifiable Random Assignment], [Bound $P < 1.33 times 10^(-8)$ (Prop 1)],
  [Wash-Trading], [Non-inflationary 10% sink], [Depletion $-10% N cal(P)$ (Thm 2)],
  [Free-Riding], [5 EDU Review Bond Escrow], [Rollover & Conditional Lock],
  [Screen Scraping], [CSS dynamic address overlay], [Forensic traceability to EOA]
)

== Microeconomic Adoption & Willingness-to-Pay (WTP)
To validate product-market fit, we analyze campus supply and demand equilibrium:
1. *Supply Elasticity (Authors):* Top-performing students (top 5% exam scorers, TAs) possess high-quality solution manuals and summary notes that currently yield zero recurring revenue. By uploading to EduChain, an author earns 70% royalties indefinitely ($0.70 times 10" EDU" = 7" EDU"$ per student). For a course with 100 students, an author generates 700 EDU passive income per exam package.
2. *Demand Inelasticity (Students):* During midterm/final exam periods, student willingness-to-pay for authentic, peer-verified exam solutions is exceptionally high. Compared to Chegg's \$19.95/month recurring subscription, EduChain's unbundled, micro-transaction fee model (\$0.50 - \$1.00) offers an order-of-magnitude cheaper, exam-specific utility.
3. *Frictionless Onboarding:* Integrating ERC-2771 Forwarders (`contracts/Forwarder.sol`) and Web3Auth Google Login abstracts gas concepts: students sign an EIP-712 packet, and the platform Paymaster covers transaction fees, delivering a Web2-native user experience.

= Empirical Evaluation

== Gas Profiling on EVM Layer-2
We evaluated smart contracts using Hardhat on the Cancun EVM running against Layer-2 deployment profiles (Arbitrum / Base Sepolia).

#table(
  columns: (1.8fr, 1.1fr, 1.2fr),
  inset: 4pt,
  stroke: 0.5pt + luma(180),
  align: (left, center, center),
  [*Method*], [*Gas Consumed*], [*L2 Cost (USD)*],
  [`submitProblem`], [134,028], [\$0.0031],
  [`registerCopyright`], [93,398], [\$0.0022],
  [`requestReviewAccess`], [73,022], [\$0.0017],
  [`proveAuthorship (ZK)`], [256,146], [\$0.0060],
  [`voteProblem (Rollover)`], [105,526], [\$0.0025],
  [`purchaseProblem (70/20/10)`], [157,636], [\$0.0037],
  [`claimReward (O(1) Pull)`], [53,814], [\$0.0013]
)

== Zero-Knowledge Proving Benchmarks
Benchmarks were executed on an Apple Silicon M-series environment utilizing WASM-compiled `snarkjs`:
- *Circom Constraints:* 322 non-linear constraints.
- *Witness Generation:* 42 ms.
- *Groth16 Proving Time:* 778 ms.
- *Proof Size:* 256 bytes ($pi_A: 64"B", pi_B: 128"B", pi_C: 64"B"$).
- *Bytecode Footprint:* 3.6 KB (well below the 24.576 KB EIP-170 limit).

== System Integration Testing
The test suite executed against live local chains and Pinata IPFS nodes verified 100% compliance across *38 Hardhat Unit tests* and *83 End-to-End TDD assertions* with zero regressions.

= Related Work
1. *Decentralized Storage & Confidentiality:* Filecoin and Arweave provide public content persistence but lack fine-grained, conditional decryption gating. Threshold network protocols (e.g., Lit Protocol) introduce off-chain MPC committees but decouple access control from continuous, game-theoretic consensus.
2. *Blockchain Peer Review & PoB:* Steemit and Hive pioneered tokenized curation; however, their reliance on inflationary reward pools spawned massive Sybil cartels and vote-trading rings. EduChain's non-inflationary, real-payment division combined with Theorem 2's negative-sum wash-trading tax fundamentally prevents these failure modes.
3. *Zero-Knowledge Copyright Systems:* Early ZK copyright solutions focused exclusively on digital rights fingerprints (e.g., image hashing). To our knowledge, EduChain is the first system to resolve the bidirectional paradox of author-confidentiality and evaluator-verifiability through an integrated review bond staking rollover mechanism.

= Conclusion
EduChain resolves the long-standing trilemma of confidential, verifiable, and collusion-resistant academic peer review. Theoretical proofs confirm that cartels face an impossible assignment barrier ($P < 1.33 times 10^(-8)$) and continuous negative capital returns (-10 percent), establishing a sustainable protocol for Web3 knowledge markets.

== Declaration of Generative AI in the Writing Process
During the preparation of this work, the author utilized AI-assisted editing tools to assist with LaTeX syntax formatting, mathematical typesetting, and language proofreading. After using these tools, the author reviewed and edited the content as needed and takes full responsibility for the content of the publication.

= References
+ E. Ben-Sasson et al., "SNARKs for C," _USENIX Security_, 2014.
+ J. Groth, "On the Size of Pairing-based Arguments," _EUROCRYPT_, 2016.
+ L. Grassi et al., "Poseidon: A New Hash Function for ZKP," _USENIX Security_, 2021.
+ J. L. Fleiss, "Measuring nominal agreement," _Psychol. Bull._, 1971.
+ V. Buterin, "Soulbound Tokens," _SSRN_, 2022.
+ OpenZeppelin, "ERC-2771 Native Meta Transactions," 2020.
