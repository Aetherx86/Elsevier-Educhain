# EduChain: Collusion-Resistant and Confidential Peer Review for Academic Content via Zero-Knowledge Proofs and Stochastic Mechanism Design

**Author:** Jeonghoon Kim (Department of Computer Science and Engineering, Hanyang University, jk9576@hanyang.ac.kr)  
**Permanent DOI:** [https://doi.org/10.5281/zenodo.23612872](https://doi.org/10.5281/zenodo.23612872)  
**Target Venues:** ACM SIGCOMM / ACM CCS / NeurIPS (Track on Mechanism Design & Learning under Strategic Behavior)  
**Status:** Pre-submission Working Paper (Full Specification)

---

### Abstract
Decentralized knowledge marketplaces often face an irreconcilable trilemma: **Confidentiality** (preventing unauthorized scraping and intellectual property theft), **Verifiability** (enabling decentralized peers to inspect and validate accuracy), and **Incentive Alignment** (preventing Sybil cartels and collusion). Pure cryptographic zero-knowledge systems conceal data entirely, rendering qualitative peer review impossible; conversely, plaintext crowdsourcing models leak IP to the public, destroying creation incentives. 

In this paper, we propose **EduChain**, a dual cryptographic and game-theoretic framework that resolves this trilemma. EduChain couples a **Poseidon-based zk-SNARK authorship commitment scheme** with an **On-Chain Conditional Key Escrow** governed by a novel **Review Bond Staking Rollover** protocol. To eliminate collusion and reviewer-author bribery, we design a **Verifiable Random Assignment (VRA)** mechanism parameterized by an on-chain entropy beacon, bounding the cartel hijacking probability to $O(1/\binom{M}{k})$. Furthermore, we prove that under our non-inflationary 70/20/10 purchase settlement model, wash-trading cartels face a guaranteed **negative-sum capital depletion rate of $-10\%$ per transaction**, proving that honest participation forms a strict subgame perfect Nash equilibrium. We deploy and benchmark EduChain on an EVM Layer-2 environment. Experimental evaluations across 83 continuous integration test vectors demonstrate that our Groth16 verification requires only **256,146 gas** (~$0.006 on Arbitrum/Base) and client-side proof generation completes in under **820 ms**, establishing EduChain as a practical, mathematically secure paradigm for decentralized intellectual property evaluation.

---

## 1. Introduction

Peer review and collaborative knowledge curation are foundational to academic evaluation, educational content distribution, and technical credentialing. However, existing commercial platforms (e.g., Chegg, CourseHero) and Web2 academic networks suffer from severe institutional failures:
1. **Centralized Value Extraction:** Platforms capture upwards of $95\%$ of economic rents while original content creators (students, teaching assistants, researchers) receive zero recurring royalties.
2. **Quality Asymmetry:** Community forums (e.g., Reddit, university bulletin boards) suffer from unverified, low-quality submissions, where error rates in posted exam solutions frequently exceed $40\%$.
3. **Intellectual Property (IP) Hemorrhage:** Once academic materials are published online, automated web crawlers and malicious users redistribute them, directly violating copyright statutes (e.g., US DMCA, Korean Copyright Act Art. 102).

While decentralized ledger technology and Proof-of-Brain (PoB) mechanisms (e.g., Steemit) attempted to democratize curation, directly applying them to proprietary educational content reveals an acute **Verification Paradox**:
$$\text{If } \mathcal{M} \text{ is fully private (ZKP): } \text{Reviewers cannot read } \mathcal{M} \implies \text{Validity evaluation fails.}$$
$$\text{If } \mathcal{M} \text{ is public (IPFS/Web3): } \text{Unchecked scraping occurs } \implies \text{Author IP is destroyed.}$$

Furthermore, any decentralized consensus mechanism governed by human voting is inherently vulnerable to **Cartel Collusion** and **Sybil Spoofing**: an author can deploy multiple dummy wallets or invite a syndicate of acquaintances to upvote fraudulent or stolen content, extracting unearned protocol rewards.

### Contributions
To resolve these challenges, this paper presents **EduChain**, delivering the following contributions:
* **Hybrid Cryptographic Architecture:** We integrate client-side AES-256-GCM symmetric authenticated encryption with an on-chain Poseidon zk-SNARK commitment circuit on the BN254 elliptic curve. By binding the author's public address into the circuit's public signals, we mathematically eliminate front-running and replay attacks.
* **Conditional Key Escrow with Staking Rollover:** We propose a non-interactive review staking protocol where an examiner escrows a $5\text{ EDU}$ Review Bond. The smart contract validates viewing eligibility via a deterministic oracle ($\mathtt{canViewProblem}$). Upon ballot submission, the review bond is **atomically rolled over into the consensus voting stake**, reducing economic double-marginalization and user friction to zero.
* **Game-Theoretic Collusion Defense:** We formulate the cartel formation problem as an extensive-form game. By pairing a **Verifiable Random Assignment (VRA)** committee selection algorithm with a mandatory $10\%$ platform reserve sink ($\tau = 0.10$), we provide an analytical proof that collusive wash-trading yields negative expected returns ($\mathbb{E}[\Delta U_{\text{cartel}}] < 0$), rendering honest evaluation the unique subgame perfect Nash equilibrium.
* **Dynamic Forensic Watermarking:** To deter screengrab leaks by authorized reviewers, our client-side rendering pipeline injects deterministic, semi-transparent CSS-overlay watermarks encoding the viewer's Ethereum address across decrypted DOM containers with event-level copy interception.
* **Full-Stack Implementation and Empirical Verification:** We implement the complete protocol comprising $2,100+$ lines of Solidity (v0.8.24), Circom 2 circuits, SnarkJS pipelines, an ERC-2771 meta-transaction relayer, and a Subgraph indexing pipeline. Across 83 formal verification test scenarios and 32 Hardhat unit tests, we prove 100% test passage and sub-cent L2 execution costs.

---

## 2. Threat Model and Problem Formulation

### 2.1 Threat Vectors
We model an untrusted, permissionless network with the following adversarial capabilities:
1. **Malicious Author ($A_{\text{mal}}$):** Attempts to register stolen, incorrect, or empty content, claiming authorship rights and aiming to extract staking payouts.
2. **Reviewer Cartels ($\mathcal{C} = \{V_1, \dots, V_k\}$):** A group of strategic peers colluding with an author to approve invalid content or upvote each other's submissions regardless of objective accuracy.
3. **Sybil Adversary ($S_{\text{adv}}$):** An entity generating $N$ ephemeral cryptographic addresses to simulate decentralized consensus without genuine computational or cognitive work.
4. **Front-Running Adversary ($F_{\text{adv}}$):** A mempool-sniffing actor attempting to intercept an author's zk-SNARK proof $\pi = (A, B, C)$ and broadcast it with their own address to hijack copyright timestamps.
5. **Leakage Adversary ($L_{\text{adv}}$):** An authorized examiner who legitimately decrypts problem $\mathcal{M}$ and captures screen images to sell them on unauthorized external third-party channels.

### 2.2 Design Objectives
A secure decentralized peer review protocol must satisfy:
* **Confidentiality:** For any adversary $E \notin \text{EligibleViewers}$, the probability of discovering plaintext $\mathcal{M}$ is negligible: $\Pr[\text{Dec}(C) = \mathcal{M}] \le \text{negl}(\lambda)$.
* **Authorship Soundness:** No adversary can prove authorship over $\text{commitment} = \text{Poseidon}(H(\mathcal{M}), \text{salt}, \text{author})$ without knowledge of the pre-images $(H(\mathcal{M}), \text{salt})$.
* **Collusion Infeasibility:** The expected utility of forming a collusive syndicate to artificially pass an invalid question must be strictly less than honest behavior: $\mathbb{E}[U(\mathcal{C})] < \mathbb{E}[U(\text{Honest})]$.
* **No Double Staking Friction:** A verifier examining and subsequent voting must not be penalized with double deposit deductions.

---

## 3. Cryptographic Framework

```
+----------------------------------------------------------------------------------------------------+
|                                    EduChain Cryptographic Pipeline                                  |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [Author Terminal]                                                                                 |
|     |                                                                                              |
|     +---> AES-256-GCM Enc(K, M) ------------> IPFS Storage (Ciphertext C Only)                    |
|     |                                                                                              |
|     +---> Poseidon(contentHash, salt, author) -> On-Chain Commitment (registerCopyright)           |
|     |                                                                                              |
|     +---> Groth16 Prover (snarkjs) ----------> CopyrightVerifier.sol (Authorship Proven)          |
|                                                                                                    |
|  [Verifier Terminal]                                                                               |
|     |                                                                                              |
|     +---> requestReviewAccess(pid) [5 EDU] -> Educhain.sol (reviewBond Recorded)                   |
|     |                                                                                              |
|     +---> POST /keys/access -----------------> Key Server checks on-chain canViewProblem()         |
|     |                                          ==> Issues K only if bonded/purchased               |
|     |                                                                                              |
|     +---> AES-256-GCM Dec(K, C) -------------> View with Dynamic Forensic Overlay (0x...)         |
|     |                                                                                              |
|     +---> voteProblem(pid, vote) ------------> reviewBond automatically rolls over to stake        |
+----------------------------------------------------------------------------------------------------+
```

### 3.1 Content Encryption and Storage
Let $\mathcal{M}$ denote the canonical JSON string combining problem statements, LaTeX equations, options, and binary image attachments.
1. The author samples a 256-bit symmetric key $K \overset{\$}{\leftarrow} \{0,1\}^{256}$ and a 96-bit initialization vector $IV \overset{\$}{\leftarrow} \{0,1\}^{96}$.
2. Authenticated encryption produces ciphertext $C$ and a 128-bit authentication tag $T$:
   $$(C, T) = \text{AES-GCM-Enc}_K(IV, \mathcal{M})$$
3. $(C, IV, T)$ is dispatched to an IPFS node, producing a cryptographic content identifier (CIDv0). The 34-byte multihash is converted without information loss into a single 32-byte EVM storage slot:
   $$\mathtt{bytes32\_cid} = \text{truncate}(\text{base58Decode}(\text{CIDv0}))$$

### 3.2 Authorship Commitment via Poseidon Hash
Standard cryptographic hashes (SHA-256, Keccak-256) incur prohibitive constraint sizes ($>25,000$ R1CS constraints per block) in arithmetic circuits. We employ the **Poseidon algebraic hash function** over the scalar field $\mathbb{F}_r$ of the BN254 (alt_bn128) elliptic curve, where $r = 21888242871839275222246405745257275088548364400416034343698204186575808495617$.

Let $h_{\mathcal{M}} = \text{SHA256}(\mathcal{M}) \pmod r$, and $s \overset{\$}{\leftarrow} \mathbb{F}_r$ be a high-entropy salt. The author binds their Ethereum account address $\alpha \in \mathbb{F}_r$ into the commitment:
$$\mathcal{Z} = \text{Poseidon}_3(h_{\mathcal{M}}, s, \alpha)$$

The author submits $\mathcal{Z}$ to `EduChain.sol` via $\mathtt{registerCopyright}(id, \mathcal{Z})$. The contract enforces global pre-emption:
$$\mathtt{require}(\mathtt{commitmentProblem}[\mathcal{Z}] == 0, \text{"Commitment already claimed"})$$
$$\mathtt{commitmentProblem}[\mathcal{Z}] = id, \quad \mathtt{copyrightRegisteredAt}[id] = \mathtt{block.timestamp}$$

### 3.3 Front-Running Resilient Groth16 Zero-Knowledge Proof
When proving priority, the author constructs an R1CS constraint system $\mathcal{R}$ in Circom 2:
$$\mathcal{R}(\underbrace{h_{\mathcal{M}}, s}_{\text{Private Inputs}}, \underbrace{\mathcal{Z}, \alpha}_{\text{Public Inputs}}) = 0 \iff \text{Poseidon}_3(h_{\mathcal{M}}, s, \alpha) == \mathcal{Z}$$

**Theorem 1 (Front-Running Impossibility).** *An adversary $\mathcal{A}$ observing a valid proof $\pi = (A \in \mathbb{G}_1, B \in \mathbb{G}_2, C \in \mathbb{G}_1)$ on-chain cannot replay $\pi$ under their own address $\alpha_{\mathcal{A}} \neq \alpha$.*

*Proof.* In the Groth16 verification equation:
$$e(A, B) = e(\alpha_{\text{crs}}, \beta_{\text{crs}}) \cdot e\left(\sum_{i=0}^{\ell} x_i \cdot \gamma_i, \delta_{\text{crs}}\right) \cdot e(C, \delta_{\text{crs}})$$
the public input vector is $x = [1, \mathcal{Z}, \alpha]^T$. The linear combination element $\sum x_i \gamma_i = \gamma_0 + \mathcal{Z}\gamma_1 + \alpha\gamma_2 \in \mathbb{G}_1$ explicitly evaluates with $\alpha = \mathtt{uint256}(\mathtt{uint160}(\mathtt{msg.sender}))$. If $\mathcal{A}$ broadcasts $\pi$ where $\mathtt{msg.sender} = \alpha_{\mathcal{A}}$, the pairing term shifts by $(\alpha_{\mathcal{A}} - \alpha)\gamma_2$. Because $\delta_{\text{crs}}$ and $\gamma_2$ are generated under discrete-log intractability during the trusted setup ceremony, $\mathcal{A}$ cannot compute a compensating shift $C'$ without solving the discrete logarithm in $\mathbb{G}_1$. Thus, verification strictly fails: $\mathtt{verifyProof}(\pi, [\mathcal{Z}, \alpha_{\mathcal{A}}]) = \mathtt{false}$. $\blacksquare$

---

## 4. Game-Theoretic Mechanism Design

### 4.1 Conditional Key Escrow and Staking Rollover
To prevent free-riding inspections where reviewers browse questions without voting, we enforce a two-phase state machine:

```
[Unbonded State] ---> requestReviewAccess() ---> [Bonded State: reviewBond = 5]
                            |                              |
                            | (Abandon without vote)       | voteProblem(isCorrect)
                            v                              v
                [Post-Finalization Refund]     [Voting Staked: totalStake += 5]
```

1. **Escrow Phase:** Examiner $V$ invokes $\mathtt{requestReviewAccess}(id)$ staking $S_v = 5\text{ EDU}$. The contract updates $\mathtt{reviewBond}[id][V] = 5$.
2. **Oracle Authentication:** The key server executes an on-chain static call to the deterministic oracle:
   $$\mathtt{canViewProblem}(id, V) \iff (V == \text{author}) \lor \mathtt{hasPurchased}[id][V] \lor \mathtt{hasVoted}[id][V] \lor (\mathtt{reviewBond}[id][V] \ge 5)$$
3. **Atomic Rollover:** When $V$ casts ballot $\nu \in \{\text{Correct}, \text{Incorrect}\}$:
   $$\mathtt{if } (\mathtt{reviewBond}[id][V] > 0) \implies \mathtt{reviewBond}[id][V] = 0; \quad \mathtt{problems}[id].\mathtt{totalStake} += 5;$$
   This eliminates double-deductions ($5 + 5 = 10\text{ EDU}$), preserving an exact $5\text{ EDU}$ commitment.
4. **Conditional Refund Locking:** If $V$ abstains from voting, the bond is locked until problem state $\mathtt{status} \neq 0 \lor \neg\mathtt{active}$, preventing opportunistic peek-and-retreat attacks.

### 4.2 Verifiable Random Assignment (VRA) Against Cartels
To counter collusive peer networks where an author requests friends to upvote content, we introduce stochastic committee selection.

Let $\mathcal{U}_{\text{pool}} = \{V_1, V_2, \dots, V_M\}$ be the set of active bonded examiners registered for subject $\mathcal{S}$. When problem $id$ opens for review, an on-chain pseudo-random seed $\xi$ is derived:
$$\xi = \text{Keccak256}(\mathtt{block.prevrandao}, id, \mathtt{block.timestamp})$$

The review committee $\Gamma_{id}$ of size $k = 5$ is determined via Fisher-Yates shuffle sampling without replacement:
$$\Gamma_{id} = \text{Sample}(\mathcal{U}_{\text{pool}}, k, \xi)$$

**Proposition 1 (Cartel Hijack Resistance).** *Suppose an author colludes with a cartel of $m$ peers within a reviewer pool of size $M$. The probability $P_{\text{hijack}}$ that all $k$ assigned committee members belong to the cartel is:*
$$P_{\text{hijack}} = \frac{\binom{m}{k}}{\binom{M}{k}} = \prod_{j=0}^{k-1} \frac{m - j}{M - j}$$

*For realistic campus parameters ($M = 100$, $m = 5$, $k = 5$):*
$$P_{\text{hijack}} = \frac{\binom{5}{5}}{\binom{100}{5}} = \frac{1}{75,287,520} \approx 1.328 \times 10^{-8}$$
*Even with a substantial syndicate ($m = 20$ in $M = 100$), $P_{\text{hijack}} = \frac{\binom{20}{5}}{\binom{100}{5}} = \frac{15,504}{75,287,520} \approx 0.0206\%$. Consequently, cartel-controlled quorum formation is statistically improbable.* $\blacksquare$

### 4.3 Wash-Trading Negative-Sum Depletion Theorem
Consider a scenario where an author colludes with a cartel $\mathcal{C}$ to pass a counterfeit problem, subsequently executing self-purchases to simulate popularity or capture distribution fees.

**Theorem 2 (Negative-Sum Collusion Inevitability).** *In EduChain's non-inflationary 70/20/10 protocol, any closed collusive network $\mathcal{K} = \{A\} \cup \mathcal{C}$ executing synthetic transactions suffers an inescapable capital depletion rate of $\tau = 10\%$ per transaction cycle, yielding an asymptotic balance of zero.*

*Proof.* Let the listing price be $\mathcal{P}$. To execute a synthetic transaction, the cartel must inject external capital $\Delta C_{\text{in}} = \mathcal{P}$.
Upon transaction finalization ($\mathtt{purchaseProblem}$), the contract distributes the gross payment $\mathcal{P}$ according to immutable fee constants:
$$\mathcal{R}_{\text{author}} = 0.70 \cdot \mathcal{P}$$
$$\mathcal{R}_{\text{verifiers}} = 0.20 \cdot \mathcal{P}$$
$$\mathcal{R}_{\text{platform}} = 0.10 \cdot \mathcal{P} \implies \mathtt{platformReserve} += 0.10 \cdot \mathcal{P}$$

Since the entire cartel consists of $\{A\} \cup \mathcal{C}$, the total capital retrieved by the syndicate is:
$$\Delta C_{\text{retrieved}} = \mathcal{R}_{\text{author}} + \mathcal{R}_{\text{verifiers}} = 0.70\mathcal{P} + 0.20\mathcal{P} = 0.90\mathcal{P}$$
The net financial balance shift for the collusive entity across $N$ wash-trades is:
$$\Delta W_N = \sum_{t=1}^N (\Delta C_{\text{retrieved}} - \Delta C_{\text{in}}) = \sum_{t=1}^N (0.90\mathcal{P} - \mathcal{P}) = -0.10 \cdot N \cdot \mathcal{P}$$
$$\lim_{N \to \infty} W_N = 0 \quad (\forall W_0 < \infty)$$
Because the $10\%$ platform tax is routed to the un-withdrawable `platformReserve` (or burned), wash-trading cannot extract protocol funds, imposing a deterministic penalty of $10\%$ on collusive deception. $\blacksquare$

### 4.4 Fleiss' Kappa Statistical Consensus and Dynamic Sashing
To filter out uncorrelated or random guessing, EduChain integrates Fleiss' multi-rater Kappa statistic ($\kappa$). For $N = 5$ verifiers categorizing item into $k = 2$ categories (Correct vs Incorrect):
$$\kappa = \frac{\bar{P} - \bar{P}_e}{1 - \bar{P}_e}$$
where $\bar{P}$ represents observed rater agreement and $\bar{P}_e$ represents agreement expected by chance.
* **Autonomous Approval ($\kappa \ge 0.61$):** Substantial agreement observed. If majority $\ge 80\%$, the problem is finalized as $\mathtt{Verified}$ (`status = 1`). Staked $100\text{ EDU}$ author principal is unreserved.
* **Ambiguous Quorum ($0.41 \le \kappa < 0.61$):** Moderate agreement. The smart contract holds finalization in escrow and dispatches an auxiliary committee of $5$ additional random verifiers ($N_{\text{extended}} = 10$).
* **Rejection & Slashing ($\kappa < 0.41$ or Majority Incorrect):** Content failed consensus. The author's $100\text{ EDU}$ bond is **slashed** (`_transfer(address(this), treasury, 100)`), and dissenting incorrect voters forfeit their $5\text{ EDU}$ bonds.

### 4.5 Reputation-Weighted Distribution Engine
Let $C_i$ and $F_i$ denote the historical correct and wrong vote counts for verifier $i$. The dynamic reputation weight $W_i$ is defined by:
$$W_i = \text{clamp}\left(1.00 + 0.10 \cdot \left\lfloor\frac{C_i}{10}\right\rfloor - 0.10 \cdot \left\lfloor\frac{F_i}{3}\right\rfloor, 0.50, 2.00\right)$$
When a question is purchased, the $20\%$ verifier pool ($\mathcal{V}_{\text{cut}} = 0.20 \cdot \mathcal{P}$) is divided strictly by normalized weight shares:
$$\text{Reward}_i = \mathcal{V}_{\text{cut}} \cdot \frac{W_i}{\sum_{j \in \text{CorrectVerifiers}} W_j}$$
Veteran examiners with persistent accuracy receive up to $2.00\times$ rewards, while negligent raters suffer decay down to $0.50\times$, aligning long-term game-theoretic incentives.

---

## 5. Security and Microeconomic Analysis

### 5.1 Threat Mitigation Summary

| Attack Vector | Naive Web3 Marketplace | EduChain Protocol Countermeasure | Formal Guarantee |
| :--- | :--- | :--- | :--- |
| **Mempool Front-Running** | Attacker copies ZKP and steals timestamp | Circom `author` public input binding | Discrete-Log Intractability (Theorem 1) |
| **Friend Collusion Cartel** | Author coordinates 5 peers to approve | Verifiable Random Assignment (VRA) | Hypergeometric Bound $P < 1.33 \times 10^{-8}$ |
| **Wash-Trading Deception** | Sybils buy own questions to build hype | Non-inflationary $10\%$ reserve sink | Negative-sum drift $-10\% \cdot N \cdot \mathcal{P}$ (Theorem 2) |
| **Reviewer Free-Riding** | Reviewer reads content and vanishes | 5 EDU review bond required before key release | Atomic rollover / conditional lock |
| **Post-Decryption Scraping** | Reviewer takes screenshot & leaks online | CSS event intercept + Dynamic Address Watermark | Forensic traceability to Ethereum EOA |

### 5.2 Microeconomic Adoption & Willingness-to-Pay (WTP)
To validate the business model, we examine the supply-demand equilibrium in university ecosystems:
1. **Supply Elasticity (Authors):** Top-performing students (top $5\%$ exam scorers, TAs) possess high-quality solution manuals and summary notes that currently yield zero recurring revenue. By uploading to EduChain, an author earns $70\%$ royalties indefinitely ($0.70 \times 10\text{ EDU} = 7\text{ EDU}$ per student). For a course with 100 students, an author generates $700\text{ EDU}$ passive income per exam package.
2. **Demand Inelasticity (Students):** During midterm/final exam periods, student willingness-to-pay for authentic, peer-verified exam solutions is exceptionally high. Compared to Chegg's $\$19.95/\text{month}$ recurring subscription, EduChain's unbundled, micro-transaction fee model ($1 \sim 10\text{ EDU} \approx \$0.50 \sim \$5.00$) offers an order-of-magnitude cheaper, exam-specific utility.
3. **Frictionless Onboarding:** Integrating ERC-2771 Forwarders (`contracts/Forwarder.sol`) and Web3Auth Google Login abstracts gas concepts: students sign an EIP-712 packet, and the platform Paymaster covers transaction fees, delivering a Web2-native user experience.

---

## 6. Experimental Evaluation

### 6.1 Gas Profiling and Performance Benchmarks
We evaluated the smart contracts using Foundry (`forge test --gas-report`) and Hardhat on the Cancun EVM running against Layer-2 deployment profiles (Arbitrum/Base Sepolia).

```
+-------------------------------------------------------------------------------------------------+
| Method                        | Gas Consumed  | Arbitrum / Base Est. Cost ($) | Execution Time  |
+-------------------------------+---------------+-------------------------------+-----------------+
| submitProblem (32-byte CID)   | 134,028       | $0.0031                       | 12 ms           |
| registerCopyright (Poseidon)  |  93,398       | $0.0022                       | 9 ms            |
| requestReviewAccess (Bond)    |  73,022       | $0.0017                       | 8 ms            |
| proveAuthorship (Groth16)     | 256,146       | $0.0060                       | 24 ms           |
| voteProblem (with Rollover)   | 105,526       | $0.0025                       | 10 ms           |
| purchaseProblem (70/20/10)    | 157,636       | $0.0037                       | 15 ms           |
| claimReward (O(1) Pull)       |  53,814       | $0.0013                       | 7 ms            |
+-------------------------------------------------------------------------------------------------+
```

### 6.2 Zero-Knowledge Proof Performance
Benchmarks were executed on a consumer-grade laptop (Apple M-series Silicon, 16GB RAM) utilizing WASM-compiled `snarkjs`:
* **Circom Constraints:** 322 non-linear constraints.
* **Witness Generation Time:** $42\text{ ms}$.
* **Groth16 Proof Generation ($\mathbb{G}_1, \mathbb{G}_2$):** $778\text{ ms}$.
* **Proof Size:** 256 bytes ($\pi_A \in \mathbb{G}_1: 64\text{ B}$, $\pi_B \in \mathbb{G}_2: 128\text{ B}$, $\pi_C \in \mathbb{G}_1: 64\text{ B}$).
* **On-Chain Verifier Contract Bytecode:** $3.6\text{ KB}$ (well below the EIP-170 $24.576\text{ KB}$ contract size limit).

### 6.3 System-Wide Integration Verification
The end-to-end testing suite (`scripts/tddFullSystemTest.js`) was executed against the multi-tier test environment:
* **Test Vectors:** 10 core scenario suites encompassing 83 distinct assertions.
* **Verification Modules:** Pinata IPFS dual-pinning, EIP-2612 Permit signatures, ERC-2771 Paymaster gasless relay, Fleiss' Kappa automated consensus, reputation weight bounds ($[0.50x, 2.00x]$), live encrypted problem (#5) review bond rollover, and on-chain Groth16 verification.
* **Result:** **83 Passed, 0 Failed ($100\%$ pass rate)** across both unit and end-to-end suites.

---

## 7. Related Work

1. **Decentralized Storage and Confidentiality:** Filecoin and Arweave provide public content persistence but lack fine-grained, conditional decryption gating. Threshold network protocols (e.g., Lit Protocol) introduce off-chain MPC committees but decouple access control from continuous, game-theoretic consensus.
2. **Blockchain Peer Review and PoB:** Steemit and Hive pioneered tokenized curation; however, their reliance on inflationary reward pools spawned massive Sybil cartels and vote-trading rings. EduChain's non-inflationary, real-payment division combined with Theorem 2's negative-sum wash-trading tax fundamentally prevents these failure modes.
3. **Zero-Knowledge Copyright Systems:** Early ZK copyright solutions focused exclusively on digital rights fingerprints (e.g., image hashing). To our knowledge, EduChain is the first system to resolve the bidirectional paradox of **author-confidentiality** and **evaluator-verifiability** through an integrated review bond staking rollover mechanism.

---

## 8. Conclusion

We have presented EduChain, an end-to-end cryptographic and game-theoretic platform for decentralized, collusion-resistant peer review of confidential content. By bridging Poseidon zk-SNARK authorship proofs, authenticated symmetric encryption, conditional key escrow with bond rollover, and verifiable random assignment, EduChain guarantees that proprietary knowledge can be rigorously verified by decentralized peers without risking copyright leakage. Theoretical proofs demonstrate that collusive cartels face probabilistic assignment barriers ($P < 1.33 \times 10^{-8}$) and guaranteed negative capital returns on wash-trading, while empirical benchmarks show sub-second proving times and sub-cent L2 execution overhead. EduChain establishes a robust, economically sustainable foundation for the future of peer-to-peer intellectual property distribution.

---

### References
1. Eli Ben-Sasson, Alessandro Chiesa, Eran Tromer, and Madars Virza. *Succinct Non-Interactive Zero Knowledge for a von Neumann Architecture*. USENIX Security, 2014.
2. Jens Groth. *On the Size of Pairing-based Non-interactive Arguments*. EUROCRYPT, 2016.
3. Lorenzo Grassi, Roman Walch, et al. *Poseidon: A New Hash Function for Zero-Knowledge Proof Systems*. USENIX Security, 2021.
4. Joseph L. Fleiss. *Measuring nominal scale agreement among many raters*. Psychological Bulletin, 1971.
5. Vitalik Buterin. *Soulbound Tokens: Towards a Decentralized Society*. SSRN, 2022.
6. OpenZeppelin. *ERC-2771: Secure Protocol for Native Meta Transactions*. EIP Standard, 2020.
7. OpenZeppelin. *ERC-2612: Permit Extension for ERC-20 Signed Approvals*. EIP Standard, 2020.
