# Axona Documentation

Documentation for the **Axona** peer-to-peer protocol: papers, whitepapers,
explainers, decks, architecture references, implementation plans, and red-team
analyses. The protocol itself lives in
[axona-net/axona-peer](https://github.com/axona-net/axona-peer) (browser SDK),
[axona-net/axona-bridge](https://github.com/axona-net/axona-bridge) (signaling
broker), and [axona-net/dht-sim](https://github.com/axona-net/dht-sim) (reference
simulator).

Live network: <https://axona.net> · Bridge: <https://bridge.axona.net>

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
| **Paper** | Conference-format research write-up; IEEEtran two-column LaTeX. | [`paper/Axona-Paper.tex`](paper/Axona-Paper.tex) · [PDF](paper/Axona%20Paper%20v0.3.55.pdf) |
| **Whitepaper** | Complete technical reference. Synthesis edition. | [`whitepaper/Axona-Whitepaper.md`](whitepaper/Axona-Whitepaper.md) · [PDF](whitepaper/Axona%20Whitepaper%20v0.3.55.pdf) |
| **Explainer** | Popular-audience introduction. Less math, more story. | [`explainer/Axona-Explainer.md`](explainer/Axona-Explainer.md) · [PDF](explainer/Axona%20Explainer%20v0.3.55.pdf) |
| **Presentation** | Research deck — full benchmark walkthrough at 25K nodes. Marp. | [`presentation/deck.md`](presentation/deck.md) · [PDF](presentation/Axona%20Presentation%20v0.3.55.pdf) |
| **Readable pitch** | Tufte-style two-column pitch. Concise. | [`pitch/axona-readable-deck.md`](pitch/axona-readable-deck.md) · [PDF](pitch/Axona%20Readable%20Deck%20v0.16.pdf) |

## Supplementary material

- **[`architecture/`](architecture/)** — the two-layer-API architecture reference (DHT contract + Transport contract + BootstrapService).
- **[`implementation/`](implementation/)** — integration plans, wire-protocol spec, per-node refactor plan, NX-17 → NH-1 punchlist.
- **[`red team/`](red%20team/)** — independent red-team analyses including the protocol-layer god's-eye audit and the v0.3.38 13-issue priority list.
- **[`dead-ends/`](dead-ends/)** — preserved failures kept as cautionary examples (NX-16's masked-distance experiment; relevant smoke tests).
- **[`history/`](history/)** — superseded versions of all documents, preserved as project-evolution context.
- Loose architecture notes at the repo root (`01_*.md`…`07_*.md`, `NX-10-Architecture.md`, `Phase3-Membership-Protocol-Plan.md`) — early-stage design documents that pre-date the synthesis whitepaper.

## Programmer guide

Three companion documents in [`programmer-guide/`](programmer-guide/),
sized by how deep you want to go:

| Doc | Read when | Length |
|---|---|---|
| **[Quick Start](programmer-guide/Quick-Start.md)** | You want a working pub/sub roundtrip in 5 minutes. Copy three commands + one file, run, done. | ~150 lines |
| **[API Reference](programmer-guide/API-Reference.md)** | You're building and need to look up a specific call: signature, params, returns, errors, example for every public export. | ~700 lines |
| **[Programmer Guide](programmer-guide/Axona-Programmer-Guide.md)** | You're starting a new application against Axona. Mental model, identity, topic addressing, pub/sub semantics, the bridge, a worked chat-app example, common pitfalls, production checklist. | ~1500 lines |

All three are verified against `@axona/protocol` v1.1.2; the
Quick Start's example runs verbatim from a fresh `npm init`.

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

## License

Documents in this repository are released under the same terms as the protocol
implementation. See the LICENSE files in
[axona-peer](https://github.com/axona-net/axona-peer/blob/main/LICENSE) for the
canonical terms.
