# EduChain: Collusion-Resistant and Confidential Peer Review for Academic Content via Zero-Knowledge Proofs and Stochastic Mechanism Design

**Author:** Jeonghoon Kim  
**Affiliation:** Department of Computer Science and Engineering, Hanyang University, Seoul, Republic of Korea  
**Email:** jk9576@hanyang.ac.kr  
**Permanent Archive DOI:** [10.5281/zenodo.23612872](https://doi.org/10.5281/zenodo.23612872)  
**Target Journal:** Elsevier *Journal of Information Security and Applications* (JISA)  
**Repository:** [https://gitlab.com/jk9576/Elsevier-Educhain](https://gitlab.com/jk9576/Elsevier-Educhain)

---

## Reviewer and Reproducibility Guide

This repository contains the complete experimental artifacts, smart contract source code, zero-knowledge verification circuits, raw benchmark datasets, and continuous integration test suites corresponding to the research paper submitted to the *Journal of Information Security and Applications* (JISA).

The artifact is organized to allow independent reviewers to compile, audit, and reproduce all theoretical theorems, empirical gas benchmarks, and cryptographic proofs presented in the manuscript.

---

## Mapping of Paper Theorems to Implementation

| Manuscript Reference | Formal Claim | Implementation File | Verification Test Suite |
| :--- | :--- | :--- | :--- |
| **Theorem 1** | Front-Running Impossibility via Author Public Signal Binding | `zk/circuits/copyright_proof.circom`<br>`contracts/CopyrightVerifier.sol` | `test/CopyrightProtection.test.js`<br>`test/Educhain.test.js` |
| **Proposition 1** | Cartel Quorum Hijacking Probability Bound $P < 1.33 \times 10^{-8}$ | `contracts/Educhain.sol` (`assignReviewCommittee`) | `test/Educhain.test.js` (VRA suite)<br>`scripts/tddFullSystemTest.js` |
| **Theorem 2** | Wash-Trading Negative-Sum Capital Depletion ($-10\%$ per cycle) | `contracts/Educhain.sol` (`purchaseProblem`) | `test/Educhain.test.js` (Theorem 2 suite)<br>`scripts/tddFullSystemTest.js` |
| **Section 4.1** | Conditional Key Escrow and Atomic Review Bond Staking Rollover | `contracts/Educhain.sol` (`requestReviewAccess`, `canViewProblem`) | `test/CopyrightProtection.test.js`<br>`scripts/tddFullSystemTest.js` |
| **Section 4.4** | Fleiss' Multi-Rater Kappa Consensus and Slashing | `contracts/Educhain.sol` (`voteProblem`, `_finalizeProblem`) | `test/Educhain.test.js`<br>`scripts/tddFullSystemTest.js` |
| **Section 4.5** | Dynamic Reputation Engine ($W_i \in [0.50, 2.00]$) | `contracts/Educhain.sol` (`voterWeights`, `purchaseProblem`) | `test/Educhain.test.js` |

---

## Raw Benchmark Datasets

Machine-readable JSON datasets matching the tables and figures in the manuscript are provided in the `benchmark_data/` directory:

1. **`benchmark_data/gas_measurements.json`**  
   Contains raw gas measurements, execution timings (ms), and projected Layer-2 USD costs corresponding to Table II for all on-chain operations (`submitProblem`, `registerCopyright`, `requestReviewAccess`, `proveAuthorship`, `voteProblem`, `purchaseProblem`, `claimReward`).

2. **`benchmark_data/zk_benchmarks.json`**  
   Contains BN254 cryptographic proving benchmarks, Circom R1CS constraint count (322 non-linear constraints), witness generation time (42 ms), Groth16 proving time (778 ms), proof size (256 bytes), and on-chain verifier bytecode size (3.6 KB).

3. **`benchmark_data/test_vectors_83.json`**  
   Contains the execution log and assertion statuses for all 83 continuous integration test vectors across 10 functional subsystems.

---

## Repository Directory Structure

```text
Elsevier-Educhain/
|-- benchmark_data/               # Raw experimental datasets supporting manuscript figures & tables
|   |-- gas_measurements.json     # Table II on-chain EVM L2 gas profiling data
|   |-- zk_benchmarks.json        # Section 6.2 zero-knowledge benchmark metrics
|   |-- test_vectors_83.json      # Complete 83-point TDD verification ledger
|-- contracts/                    # Production Solidity v0.8.24 smart contracts
|   |-- Educhain.sol              # Core protocol: VRA, review bond rollover, 70/20/10 settlement
|   |-- CopyrightVerifier.sol     # SnarkJS Groth16 pairing verifier for BN254 curve
|   |-- Forwarder.sol             # ERC-2771 trusted forwarder for gasless meta-transactions
|-- zk/                           # Zero-knowledge circuit definitions and proving pipeline
|   |-- circuits/
|   |   |-- copyright_proof.circom # Circom 2 circuit enforcing Poseidon hash author binding
|-- test/                         # Hardhat unit test suites
|   |-- Educhain.test.js          # 38 unit tests covering VRA, Theorem 2, and consensus
|   |-- CopyrightProtection.test.js # Unit tests for AES-256-GCM and Groth16 verification
|   |-- EduchainGas.t.sol         # Foundry gas analysis suite
|-- scripts/                      # Deployment, testing, and verification harnesses
|   |-- tddFullSystemTest.js      # 83-assertion end-to-end integration verification script
|   |-- deploy.js                 # Smart contract deployment pipeline
|   |-- relayer.js                # ERC-2771 gasless transaction relayer service
|-- docs/                         # Academic manuscript files and publication graphics
|   |-- EduChain_JISA_Manuscript.pdf # Full 4-page academic manuscript (pre-compiled)
|   |-- paper.tex                 # Publication-grade LaTeX source (IEEEtran format)
|   |-- references.bib            # BibTeX citation database
|   |-- fig1_architecture.png     # Figure 1: End-to-end cryptographic and mechanism pipeline
|   |-- fig2_benchmark_charts.png # Figure 2: Empirical gas distributions and proving latency
|   |-- fig3_model_comparison.png # Figure 3: Legacy Web2 vs. Web3 vs. EduChain structural breakdown
|-- hardhat.config.js             # Hardhat network configuration and optimizer settings
|-- package.json                  # Node.js dependencies and testing commands
`-- README.md                     # Reviewer documentation
```

---

## Instructions for Artifact Reproduction

### 1. Prerequisites

The testing suite requires:
- **Node.js:** version 18.0.0 or higher
- **npm:** version 9.0.0 or higher
- **Operating System:** Linux, macOS, or Windows (WSL2 recommended)

### 2. Dependency Installation

Clone the repository and install dependencies:

```bash
git clone https://gitlab.com/jk9576/Elsevier-Educhain.git
cd Elsevier-Educhain
npm install
```

### 3. Smart Contract Compilation

Compile the Solidity smart contracts and generate ABI definitions:

```bash
npx hardhat compile
```

Expected output:
```text
Compiled 3 Solidity files successfully
```

### 4. Running the Hardhat Unit Test Suite (38 Tests)

Execute the full suite of unit tests, which validates VRA committee assignment, Theorem 2 wash-trading capital depletion, Review Bond staking rollover, and Groth16 pairing checks:

```bash
npx hardhat test
```

Expected output:
```text
  EduChain Copyright Protection (ZK + Encryption + Review Access)
    AES-256-GCM Content Encryption
      [OK] Ciphertext decrypts only with matching symmetric key
      [OK] Tampered ciphertext fails GCM authentication check
      [OK] Binary image payloads round-trip identically
    ZK Authorship Proof (Poseidon Commitment + Groth16)
      [OK] Author registers Poseidon commitment with block timestamp
      [OK] Non-authors cannot register commitment for the same problem
      [OK] Replay/front-running attacks fail due to msg.sender binding
      [OK] Valid Groth16 proof verifies successfully on-chain
      [OK] Invalid salt or corrupted proof is rejected
    Reviewer Inspection Access (5 EDU Bond -> Key Release Oracle)
      [OK] Unbonded addresses cannot access problem content
      [OK] 5 EDU deposit grants viewing eligibility via canViewProblem
      [OK] Review bond atomically rolls over into voting stake upon ballot submission
      [OK] Non-voting examiners cannot withdraw bond before problem finalization
      [OK] Bond refund succeeds after problem finalization

  EduChain Consensus, Slashing, and Game-Theoretic Mechanisms
    Collusion Resistance & Verifiable Random Assignment (VRA)
      [OK] Independent reviewers register into global pool
      [OK] Committee assignment requires minimum pool size
      [OK] Committee of 5 distinct examiners selected using on-chain entropy
      [OK] Unassigned peers cannot submit review votes (Cartel prevention)
      [OK] Assigned peers successfully cast votes
      [OK] [Theorem 2 Proof] Wash-trading cartels suffer guaranteed -10% capital depletion

  38 passing (3s)
```

### 5. Running the End-to-End System Integration Test Suite (83 Assertions)

Execute the comprehensive integration test harness:

```bash
node scripts/tddFullSystemTest.js
```

Expected output:
```text
[TDD Full System Verification]
Total test suites: 10
Total assertions: 83
Results: 83 Passed, 0 Failed (100% Pass Rate)
Execution status: VERIFIED
```

### 6. Verifying Gas Consumption, Prover Latency, and Mechanisms

To reproduce all empirical metrics reported in Table II, the zero-knowledge proving latency benchmarks, and the Theorem 2 negative-sum wash-trading depletion simulation in a single command:

```bash
node scripts/reproduce_benchmarks.js
```

Expected output:
```text
--- Empirical Gas Measurements (Hardhat Single-Tx Execution) ---
  submitProblem            : 134,028 gas
  registerCopyright        : 93,398 gas
  requestReviewAccess      : 73,022 gas
  proveAuthorship          : 256,146 gas
  voteProblem              : 105,526 gas
  purchaseProblem          : 157,636 gas
  claimReward              : 53,814 gas

--- Empirical ZK Groth16 Timings (10 runs) ---
  Proving Time (warm avg) : ~51-55 ms (cold start: 154 ms, bound: < 820 ms)
  Verification Time (avg) : ~5.6 ms

--- Theorem 2: Empirical Negative-Sum Depletion Simulation ---
  Cycle 1: Capital = 99.00 EDU (Platform Sink cumulative: 1.00 EDU, Net shift: -1.00 EDU)
  Cycle 2: Capital = 98.00 EDU (Platform Sink cumulative: 2.00 EDU, Net shift: -2.00 EDU)
  Cycle 3: Capital = 97.00 EDU (Platform Sink cumulative: 3.00 EDU, Net shift: -3.00 EDU)
  Cycle 4: Capital = 96.00 EDU (Platform Sink cumulative: 4.00 EDU, Net shift: -4.00 EDU)
  Cycle 5: Capital = 95.00 EDU (Platform Sink cumulative: 5.00 EDU, Net shift: -5.00 EDU)
```

---

## Security and Privacy Policy

1. **No Private Keys in Repository:** This repository does not contain production private keys, RPC secrets, or unencrypted problem payloads. All test wallets utilize standard Hardhat mnemonic accounts (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`).
2. **Deterministic Oracle Validation:** The conditional key release logic is governed deterministically on-chain via the pure view function `canViewProblem(uint256 id, address viewer)` in `contracts/Educhain.sol`.

---

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

---

## Citation

If you utilize this framework or datasets in your research, please cite:

```bibtex
@article{kim2026educhain,
  title={{EduChain: Collusion-Resistant and Confidential Peer Review for Academic Content via Zero-Knowledge Proofs and Stochastic Mechanism Design}},
  author={Kim, Jeonghoon},
  journal={Elsevier Journal of Information Security and Applications (Under Review)},
  year={2026},
  doi={10.5281/zenodo.23612872},
  url={https://doi.org/10.5281/zenodo.23612872}
}
```
