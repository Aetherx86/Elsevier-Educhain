#set page(width: 1200pt, height: 720pt, margin: 24pt, fill: rgb("#0d1117"))
#set text(fill: rgb("#e6edf3"), font: "Helvetica", size: 12pt)

#align(center)[
  #text(size: 24pt, weight: "bold", fill: rgb("#58a6ff"))[Academic Knowledge Platforms: Legacy vs. EduChain Architecture] \
  #v(2pt)
  #text(size: 13pt, fill: rgb("#8b949e"))[Comparative Structural Breakdown: Centralized Web2 vs. Inflationary Web3 vs. Zero-Knowledge Stochastic Protocol]
]

#v(16pt)

#grid(
  columns: (1fr, 1.2fr),
  gutter: 20pt,

  // Left Column: Legacy Failure Modes
  rect(width: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#da3633"), radius: 8pt, inset: 20pt)[
    #text(size: 15pt, weight: "bold", fill: rgb("#f85149"))[BEFORE: Legacy Academic Crowdsourcing Failures] \
    #v(4pt)
    #text(size: 11pt, fill: rgb("#8b949e"))[Centralized Extraction & Inflationary Sybil Exploitation] \
    #v(14pt)

    #rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#30363d"), radius: 6pt, inset: 12pt)[
      #text(weight: "bold", fill: rgb("#ff7b72"))[1. Centralized Rent Extraction (Chegg / CourseHero)] \
      #v(4pt)
      #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
        - *Value Extraction:* Platform captures upwards of *95%* of economic rents.
        - *Zero Royalties:* Student creators & TAs receive *\$0 recurring royalties*.
        - *Inelastic Cost:* Inflexible *\$19.95/month* recurring subscription barrier.
        - *Quality Deficit:* Error rates in posted solutions frequently exceed *40%*.
      ]
    ]

    #v(12pt)

    #rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#30363d"), radius: 6pt, inset: 12pt)[
      #text(weight: "bold", fill: rgb("#ffa657"))[2. Naive Web3 Proof-of-Brain (Steemit / Hive Models)] \
      #v(4pt)
      #text(size: 10.5pt, fill: rgb("#c9d1d9"))[
        - *Inflationary Death Spiral:* Endless token minting diluted holder value.
        - *Cartel Hijacking:* Authors invited syndicates to upvote garbage content.
        - *Unchecked Scraping:* Public IPFS data destroyed creator monetization.
        - *Wash-Trading Exploits:* Sybils extracted platform emission pools with zero risk.
      ]
    ]
  ],

  // Right Column: EduChain Paradigm
  rect(width: 100%, fill: rgb("#161b22"), stroke: 1pt + rgb("#238636"), radius: 8pt, inset: 20pt)[
    #text(size: 15pt, weight: "bold", fill: rgb("#3fb950"))[AFTER: EduChain Cryptographic & Game-Theoretic Solution] \
    #v(4pt)
    #text(size: 11pt, fill: rgb("#8b949e"))[Zero-Knowledge Verification, VRA Committee, and Non-Inflationary Real-Yield] \
    #v(14pt)

    #grid(
      columns: (1fr, 1fr),
      gutter: 12pt,

      rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#30363d"), radius: 6pt, inset: 10pt)[
        #text(weight: "bold", fill: rgb("#79c0ff"))[70% Author Royalties] \
        #v(4pt)
        #text(size: 10pt, fill: rgb("#c9d1d9"))[
          Perpetual on-chain royalties paid directly to author wallets on every student purchase.
        ]
      ],

      rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#30363d"), radius: 6pt, inset: 10pt)[
        #text(weight: "bold", fill: rgb("#7ee787"))[20% Reviewer Pool] \
        #v(4pt)
        #text(size: 10pt, fill: rgb("#c9d1d9"))[
          Distributed strictly by dynamic reputation weights ($0.50x ~ 2.00x$) across verified raters.
        ]
      ],

      rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#30363d"), radius: 6pt, inset: 10pt)[
        #text(weight: "bold", fill: rgb("#d2a8ff"))[VRA Cartel Defense] \
        #v(4pt)
        #text(size: 10pt, fill: rgb("#c9d1d9"))[
          Stochastic Fisher-Yates 5-peer assignment bounds hijack probability to $1.33 times 10^(-8)$.
        ]
      ],

      rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#30363d"), radius: 6pt, inset: 10pt)[
        #text(weight: "bold", fill: rgb("#ffa657"))[Theorem 2 Wash-Trading Tax] \
        #v(4pt)
        #text(size: 10pt, fill: rgb("#c9d1d9"))[
          10% Platform Sink guarantees $-10%$ loss per wash-trade, forcing asymptotic cartel bankruptcy.
        ]
      ]
    )

    #v(10pt)

    #rect(width: 100%, fill: rgb("#0d1117"), stroke: 1pt + rgb("#388bfd"), radius: 6pt, inset: 10pt)[
      #text(weight: "bold", fill: rgb("#58a6ff"))[Frictionless Web2-Native Onboarding & ZK Copyright Assurance] \
      #v(4pt)
      #text(size: 10pt, fill: rgb("#c9d1d9"))[
        - *Zero Gas Friction:* ERC-2771 Forwarders + Web3Auth allow one-click Google login without seed phrases.
        - *Groth16 Authorship Proof:* Author address bound to public signals; front-running is provably impossible.
        - *Unbundled Microtransactions:* Students purchase single verified solutions for \$0.50 ~ \$1.00 instead of \$20/mo.
      ]
    ]
  ]
)
