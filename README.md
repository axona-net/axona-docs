# Axona Documentation

Documentation for the **Axona** peer-to-peer protocol: papers, whitepapers,
explainers, decks, architecture references, implementation plans, and red-team
analyses. The protocol itself lives in
[axona-net/axona-peer](https://github.com/axona-net/axona-peer) (browser SDK),
[axona-net/axona-bridge](https://github.com/axona-net/axona-bridge) (signaling
broker), and [axona-net/dht-sim](https://github.com/axona-net/dht-sim) (reference
simulator).

**Try it live:**

- **<https://axona.net>** — the reference application (browser peer, pub/sub UI; talks to the deployed network).
- **<https://axona-net.github.io/dht-sim/>** — the in-browser DHT simulator (drive 1K–50K peers locally; visualise routing, benchmark all five protocols).
- **<https://bridge.axona.net>** — the signaling broker that bootstraps the live network.

## Naming convention

This repo uses three terms consistently:

| Term | Meaning |
|---|---|
| **Axona** | The protocol described here — addressing, routing, and pub/sub layer, and the name of the deployed network running it. |
| **N-DHT** | *Neuromorphic DHT* — the broader family of learning-adaptive DHT designs to which Axona belongs. |
| **NH-1** | The current Axona implementation. Numerical results and concrete parameter values quoted in the documents are NH-1 numbers. |

## The five canonical documents

| Document | Audience | File |
|---|---|---|
| **Paper** | Conference-format research write-up; IEEEtran two-column LaTeX.  Focused 3-protocol comparison (\KDHT / \GDHT / \axona). | [`paper/Axona-Paper.tex`](paper/Axona-Paper.tex) · [PDF](paper/Axona%20Paper%20v0.4.01.pdf) |
| **Whitepaper** | Complete technical reference. Synthesis edition. | [`whitepaper/Axona-Whitepaper.md`](whitepaper/Axona-Whitepaper.md) · [PDF](whitepaper/Axona%20Whitepaper%20v0.3.58.pdf) |
| **Explainer** | Popular-audience introduction. Less math, more story. Three-protocol focus (\KDHT / \GDHT / \axona). | [`explainer/Axona-Explainer.md`](explainer/Axona-Explainer.md) · [PDF](explainer/Axona%20Explainer%20v0.4.27.pdf) |
| **Presentation** | Research deck — full benchmark walkthrough at 25K nodes. Marp. | [`presentation/deck.md`](presentation/deck.md) · [PDF](presentation/Axona%20Presentation%20v0.3.55.pdf) |
| **Pitch** | Tufte-style two-column pitch.  Three-protocol focus (\KDHT / \GDHT / \axona) with the v0.93.0 / May 2026 benchmark numbers. | [`pitch/axona-pitch.md`](pitch/axona-pitch.md) · [PDF](pitch/Axona%20Pitch%20v0.19.pdf) |

## Supplementary material

- **[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md)** — public, shareable record of resolved security-relevant changes to the protocol kernel and apps (authenticated handshake, channel binding, hardening batches).
- **[`applications/`](applications/)** — product briefs for applications built on the Axona protocol (SYZL — adaptive social feed).
- **[`architecture/`](architecture/)** — the full-stack architecture note: kernel · protocol · transport · bridge, the wire protocol, the complete application API, and the demo-app source. [PDF](architecture/Axona%20Architecture%20v0.6.2.pdf) · [`.tex`](architecture/Axona-Architecture.tex)
- **[`implementation/`](implementation/)** — integration plans, wire-protocol spec, per-node refactor plan, NX-17 → NH-1 punchlist, and the [pub/sub lifecycle & access-control design](implementation/Pubsub-Lifecycle-Design-v0.2.md) (pull/kill/unpub/unsub, bounded queues, hold time, the three access models).
- **[`red team/`](red%20team/)** — independent red-team analyses including the protocol-layer god's-eye audit, the v0.3.38 13-issue priority list, the post-`axona/4` v2 sweep, an external v2.6.0 assessment, and the **consolidated, prioritized [punch list](red%20team/red-team-punchlist-v2.6.0.md)** that merges them.
- **[`dead-ends/`](dead-ends/)** — preserved failures kept as cautionary examples (NX-16's masked-distance experiment; relevant smoke tests).
- **[`history/`](history/)** — superseded versions of all documents, preserved as project-evolution context.
- Loose architecture notes at the repo root (`01_*.md`…`07_*.md`, `NX-10-Architecture.md`, `Phase3-Membership-Protocol-Plan.md`) — early-stage design documents that pre-date the synthesis whitepaper.

## Programmer guide

Three companion documents in [`programmer-guide/`](programmer-guide/),
sized by how deep you want to go:

| Doc | Read when | Length |
|---|---|---|
| **[Quick Start](programmer-guide/Quick-Start-v2.10.0.md)** · [PDF](programmer-guide/Quick-Start-v2.10.0.pdf) | You want a working pub/sub roundtrip in 5 minutes. Copy three commands + one file, run, done. | ~150 lines |
| **[API Reference](programmer-guide/API-Reference-v2.10.0.md)** · [PDF](programmer-guide/API-Reference-v2.10.0.pdf) | You're building and need to look up a specific call: signature, params, returns, errors, example for every public export. | ~700 lines |
| **[Programmer Guide](programmer-guide/Axona-Programmer-Guide-v2.10.0.md)** · [PDF](programmer-guide/Axona-Programmer-Guide-v2.10.0.pdf) | You're starting a new application against Axona. Mental model, identity, topic addressing, pub/sub semantics, the bridge, a worked chat-app example, common pitfalls, production checklist. | ~1500 lines |

All three track `@axona/protocol` v2.10.0 (the version is in each
filename); the Quick Start's example runs verbatim from a fresh
`npm init`.

A runnable copy of the Quick Start lives at
[`programmer-guide/examples/minimal-pubsub/`](programmer-guide/examples/minimal-pubsub/)
— `npm install && node index.js`, end-to-end roundtrip in under a minute.

For longer-form reference reading: the reference browser peer is
[`axona-peer/src/client.js`](https://github.com/axona-net/axona-peer/blob/main/src/client.js)
(~1500 lines, end-to-end), and the bridge's embedded peer is
[`axona-bridge/src/bridge_axona_node.js`](https://github.com/axona-net/axona-bridge/blob/main/src/bridge_axona_node.js).
The in-process simulator's pub/sub cascade test lives in
[`dht-sim/src/main.js`](https://github.com/axona-net/dht-sim/blob/main/src/main.js).

## Repository map

```
.
├── paper/             # IEEE-format research paper (LaTeX + PDFs)
├── whitepaper/        # Full reference whitepaper (Markdown + LaTeX + PDFs)
├── explainer/         # Popular-audience explainer (Markdown + PDFs)
├── presentation/      # Marp research deck (Markdown + PDFs + charts/)
├── pitch/             # Tufte-style readable pitch (Markdown + PDFs)
├── architecture/      # DHT / Transport / BootstrapService contracts reference
├── implementation/    # Integration plans, wire spec, refactor punchlists
├── red team/          # Red-team audits and analyses
├── dead-ends/         # Archived failed approaches (NX-16, etc.)
├── history/           # Superseded document versions, preserved as context
└── README.md
```

## Contributing

This repo holds finished documents and curated supplementary material. Edits to
documents follow a per-document version number: bump the version in the
document's footer / title and produce a fresh versioned PDF in the same commit.
The previous PDF moves to `history/<section>/` so the canonical file is always
the most recent version at the top level.

**Security-relevant changes** (in any Axona repo): update
[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md) in the same batch — resolved
items only, keyed to kernel version, described by *what's now protected* (never
enumerate still-open findings, which live only in the private red-team
register). The code repos' PR templates carry this same reminder.

## License

Documents in this repository are released under the same terms as the protocol
implementation. See the LICENSE files in
[axona-peer](https://github.com/axona-net/axona-peer/blob/main/LICENSE) for the
canonical terms.
