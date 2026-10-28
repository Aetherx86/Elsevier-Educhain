#set page(width: 1200pt, height: 780pt, margin: 24pt, fill: rgb("#0d1117"))
#set text(fill: rgb("#e6edf3"), font: "Helvetica", size: 12pt)

#align(center)[
  #text(size: 24pt, weight: "bold", fill: rgb("#58a6ff"))[EduChain Empirical Benchmarks & Stochastic Mechanism Analysis] \
  #v(2pt)
  #text(size: 13pt, fill: rgb("#8b949e"))[Gas Profiling, Zero-Knowledge Proving Latency, and Game-Theoretic Collusion Bounds]
]

#v(16pt)

#grid(
  columns: (1.25fr, 1fr),
  gutter: 20pt,

  // Left Column: Gas Profiling
  rect(width: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 18pt)[
    #text(size: 14pt, weight: "bold", fill: rgb("#79c0ff"))[1. EVM Layer-2 Execution Gas & Cost Profile] \
    #v(4pt)
    #text(size: 10.5pt, fill: rgb("#8b949e"))[Cancun EVM Profiling on Arbitrum / Base Sepolia (30 Gwei L1 base fee equivalent)] \
    #v(12pt)

    #table(
      columns: (1.8fr, 1.2fr, 1.2fr, 2.5fr),
      inset: 7pt,
      stroke: 0.5pt + rgb("#30363d"),
      fill: (col, row) => if row == 0 { rgb("#21262d") } else { none },
      align: (left, center, center, left),
      [*Smart Contract Method*], [*Gas Used*], [*Cost (USD)*], [*Optimization Details*],
      [`proveAuthorship (ZK)`], [256,146], [\$0.0060], [Groth16 BN254 Pairing Check],
      [`purchaseProblem (70/20/10)`], [157,636], [\$0.0037], [Reputation-Weighted Multi-Split],
      [`submitProblem (bytes32)`], [134,028], [\$0.0031], [O(1) 32-byte CID Slot Optimization],
      [`voteProblem (with Rollover)`], [105,526], [\$0.0025], [Review Bond Rollover (No Double Debit)],
      [`registerCopyright (Poseidon)`], [93,398], [\$0.0022], [Preemption Slot & Timestamping],
      [`requestReviewAccess (Bond)`], [73,022], [\$0.0017], [5 EDU Escrow State Allocation],
      [`claimReward (O(1) Pull)`], [53,814], [\$0.0013], [Non-inflationary Balances Transfer]
    )

    #v(12pt)
    #rect(width: 100%, fill: rgb("#0d1117"), radius: 6pt, stroke: 1pt + rgb("#238636"), inset: 10pt)[
      #text(weight: "bold", fill: rgb("#3fb950"))[Sub-Cent Microtransaction Feasibility:] \
      #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
        All core student and reviewer transactions cost less than *\$0.006* on Layer-2 rollups. The 10% platform reserve comfortably subsidizes ERC-2771 Paymaster gasless execution for campus users.
      ]
    ]
  ],

  // Right Column: ZK & Mechanism Analysis
  grid(
    rows: (auto, auto),
    gutter: 16pt,

    // Right Top: VRA
    rect(width: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
      #text(size: 13pt, weight: "bold", fill: rgb("#ff7b72"))[2. Verifiable Random Assignment (VRA) Bound] \
      #v(6pt)
      #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
        Stochastic committee sampling via $mono("prevrandao")$ non-replacement Fisher-Yates shuffle:
        $ P_"hijack" = (binom(m, 5)) / (binom(M, 5)) = product_(j=0)^4 (m - j) / (M - j) $
      ]
      #v(6pt)
      #table(
        columns: (1fr, 1.2fr, 1.5fr),
        inset: 5pt,
        stroke: 0.5pt + rgb("#30363d"),
        fill: (col, row) => if row == 0 { rgb("#21262d") } else { none },
        align: (center, center, center),
        [*Pool Size ($M$)*], [*Cartel Friends ($m$)*], [*Hijack Probability ($P$)*],
        [10], [5], [0.396% ($1 / 252$)],
        [30], [5], [0.0007% ($1 / 142,506$)],
        [50], [5], [0.00004% ($1 / 2,118,760$)],
        [*100*], [*5*], [*0.0000013% ($1 / 75,287,520$)*]
      )
    ],

    // Right Bottom: Wash-Trading
    rect(width: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#30363d"), radius: 8pt, inset: 16pt)[
      #text(size: 13pt, weight: "bold", fill: rgb("#ffa657"))[3. Negative-Sum Wash-Trading Depletion (Theorem 2)] \
      #v(6pt)
      #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
        Under the non-inflationary 70/20/10 purchase settlement protocol:
        $ Delta C_"retrieved" = 0.70 cal(P) + 0.20 cal(P) = 0.90 cal(P) $
        $ Delta W_N = sum_(t=1)^N (0.90 cal(P) - cal(P)) = -0.10 dot N dot cal(P) $
      ]
      #v(6pt)
      #rect(width: 100%, fill: rgb("#0d1117"), radius: 4pt, stroke: 1pt + rgb("#da3633"), inset: 8pt)[
        #text(weight: "bold", fill: rgb("#f85149"))[Deterministic Capital Bleed: -10% per transaction] \
        #text(size: 10pt, fill: rgb("#8b949e"))[
          Cartel wash-trading cannot extract funds. 100 self-purchases of a 10 EDU question forfeits 100 EDU entirely to the platform reserve sink ($lim_(N arrow.r infinity) W_N = 0$).
        ]
      ]
    ]
  )
)
