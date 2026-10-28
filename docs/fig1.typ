#set page(width: 1200pt, height: 680pt, margin: 24pt, fill: rgb("#0d1117"))
#set text(fill: rgb("#e6edf3"), font: "Helvetica", size: 12pt)

#align(center)[
  #text(size: 24pt, weight: "bold", fill: rgb("#58a6ff"))[EduChain End-to-End Cryptographic & Mechanism Pipeline] \
  #v(2pt)
  #text(size: 13pt, fill: rgb("#8b949e"))[Confidentiality, Verifiability, and Collusion Resistance for Academic Peer Review]
]

#v(16pt)

#grid(
  columns: (1fr, 1fr, 1fr),
  rows: (1fr, 1fr),
  gutter: 16pt,
  
  // Card 1
  rect(width: 100%, height: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
    #text(size: 11pt, weight: "bold", fill: rgb("#79c0ff"))[STAGE 1. CLIENT ENCRYPTION & STORAGE] \
    #v(6pt)
    #text(size: 13pt, weight: "bold", fill: white)[AES-256-GCM + IPFS Compression] \
    #v(8pt)
    #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
      - 256-bit Key $K$ + 96-bit IV sampled client-side
      - $(C, T) = "AES-GCM-Enc"_K ("IV", cal(M))$
      - Full plaintext/LaTeX/images concealed on IPFS
      - 34-byte Base58 CID truncated into single 32-byte slot: \
        `bytes32_cid` (Gas saving: ~78% storage reduction)
    ]
  ],

  // Card 2
  rect(width: 100%, height: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
    #text(size: 11pt, weight: "bold", fill: rgb("#d2a8ff"))[STAGE 2. POSEIDON COMMITMENT] \
    #v(6pt)
    #text(size: 13pt, weight: "bold", fill: white)[BN254 Algebraic Cryptographic Hash] \
    #v(8pt)
    #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
      - $cal(Z) = "Poseidon"_3 (h_(cal(M)), s, alpha_"author")$
      - Sub-second constraint generation (under 350 R1CS)
      - On-chain preemption via `registerCopyright`
      - Immutable block timestamp proves first creation priority
      - Pre-image $(h_(cal(M)), s)$ strictly kept secret
    ]
  ],

  // Card 3
  rect(width: 100%, height: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
    #text(size: 11pt, weight: "bold", fill: rgb("#56d364"))[STAGE 3. ZERO-KNOWLEDGE PROOF] \
    #v(6pt)
    #text(size: 13pt, weight: "bold", fill: white)[Groth16 + Author Address Binding] \
    #v(8pt)
    #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
      - Public signals: $[cal(Z), mono("uint256")(mono("uint160")(mono("msg.sender")))]$
      - Theorem 1 Proof: Discrete-log hardness prevents front-running
      - Mempool sniffer replay strictly rejected ($mono("verifyProof") = mono("false")$)
      - On-chain verification cost: *256,158 gas* (\$0.006 on L2)
      - Client proof latency: *778 ms* in browser WASM
    ]
  ],

  // Card 4
  rect(width: 100%, height: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
    #text(size: 11pt, weight: "bold", fill: rgb("#ffa657"))[STAGE 4. CONDITIONAL KEY ESCROW] \
    #v(6pt)
    #text(size: 13pt, weight: "bold", fill: white)[Review Bond Staking Rollover] \
    #v(8pt)
    #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
      - Reviewer deposits 5 EDU bond (`requestReviewAccess`)
      - Key server validates access via on-chain `canViewProblem`
      - Ballot submission atomically rolls bond into consensus stake
      - Zero economic double-marginalization ($5" EDU" + 0 = 5" EDU"$)
      - Abandoned inspections locked until finalization
    ]
  ],

  // Card 5
  rect(width: 100%, height: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
    #text(size: 11pt, weight: "bold", fill: rgb("#ff7b72"))[STAGE 5. ANTI-COLLUSION DEFENSE] \
    #v(6pt)
    #text(size: 13pt, weight: "bold", fill: white)[Verifiable Random Assignment (VRA)] \
    #v(8pt)
    #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
      - On-chain entropy seed: Keccak256(`prevrandao`, `problemId`)
      - Fisher-Yates non-replacement sampling selects $k=5$ committee
      - Proposition 1: Cartel capture probability $P < 1.33 times 10^(-8)$
      - Unassigned peers strictly rejected from reviewing or voting
      - Fleiss' Kappa consensus ($kappa >= 0.61$ auto-approval)
    ]
  ],

  // Card 6
  rect(width: 100%, height: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
    #text(size: 11pt, weight: "bold", fill: rgb("#7ee787"))[STAGE 6. NON-INFLATIONARY SETTLEMENT] \
    #v(6pt)
    #text(size: 13pt, weight: "bold", fill: white)[70 / 20 / 10 Real-Yield Distribution] \
    #v(8pt)
    #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
      - 70% Perpetual Author Royalties (Passive Income)
      - 20% Reputation-Weighted Reviewer Pool ($0.50x ~ 2.00x$)
      - 10% Platform Reserve Sink (Covers gas relayer paymaster)
      - Theorem 2: Wash-trading incurs guaranteed -10% capital loss
      - $lim_(N -> infinity) W_N = 0 arrow.r.double$ Cartels go bankrupt
    ]
  ]
)
