# Axona Documentation

Documentation for the **Axona** peer-to-peer protocol: papers, whitepapers,
explainers, decks, architecture references, implementation plans, and red-team
analyses. The protocol itself lives in
[axona-net/axona-protocol](https://github.com/axona-net/axona-protocol) (the
`@axona/protocol` kernel),
[axona-net/axona-peer](https://github.com/axona-net/axona-peer) (reference
browser peer),
[axona-net/axona-bridge](https://github.com/axona-net/axona-bridge) (signaling
broker + TURN),
[axona-net/axona-relay](https://github.com/axona-net/axona-relay) (headless Node
supernode), and [axona-net/dht-sim](https://github.com/axona-net/dht-sim)
(reference simulator).

**Try it live:**

- **<https://axona.net>** — the reference application (browser peer, pub/sub UI; talks to the deployed network). *Production runs the `axona/5` / kernel-2.32 line (cut over 2026-06-08).*
- **<https://testnet.axona.net>** — the SF testnet peer (the `axona/5` / kernel-2.32 line); **<https://demo-testnet.axona.net>** is the minimal kernel demo on the same testnet.
- **<https://axona-net.github.io/dht-sim/>** — the in-browser DHT simulator (drive 1K–50K peers locally; visualise routing, benchmark all five protocols).
- **<https://bridge.axona.net>** — the signaling broker that bootstraps the live network.

## Naming convention

This repo uses three terms consistently:

| Term | Meaning |
|---|---|
| **Axona** | The protocol — addressing, routing, and pub/sub layer — and the name of the deployed network running it. This is the protocol these documents describe; refer to it by name. |
| **N-DHT** | *Neuromorphic DHT* — the broader family of learning-adaptive DHT designs to which Axona belongs. |
| **NX-17 / NH-1** | Named neuromorphic engine generations in the **dht-sim** benchmark roster — simulator comparison points along the lineage that informed Axona's design, *not* the deployed protocol. They appear only inside `dht-sim` and its benchmark walkthroughs; everywhere else the protocol is **Axona**. |

## The five canonical documents

| Document | Audience | File |
|---|---|---|
| **Paper** | Conference-format research write-up; IEEEtran two-column LaTeX.  Focused 3-protocol comparison (\KDHT / \GDHT / \axona). | [`paper/Axona-Paper.tex`](paper/Axona-Paper.tex) · [PDF](paper/Axona%20Paper%20v0.5.0.pdf) |
| **Whitepaper** | Complete technical reference. Synthesis edition. | [`whitepaper/Axona-Whitepaper.md`](whitepaper/Axona-Whitepaper.md) · [PDF](whitepaper/Axona%20Whitepaper%20v0.3.58.pdf) |
| **Explainer** | Popular-audience introduction. Less math, more story. Three-protocol focus (\KDHT / \GDHT / \axona). | [`explainer/Axona-Explainer.md`](explainer/Axona-Explainer.md) · [PDF](explainer/Axona%20Explainer%20v0.4.29.pdf) |
| **Presentation** | Research deck — full benchmark walkthrough at 25K nodes. Marp. | [`presentation/deck.md`](presentation/deck.md) · [PDF](presentation/Axona%20Presentation%20v0.3.55.pdf) |
| **Pitch** | Tufte-style two-column pitch.  Three-protocol focus (\KDHT / \GDHT / \axona) with the v0.93.0 / May 2026 benchmark numbers. | [`pitch/axona-pitch.md`](pitch/axona-pitch.md) · [PDF](pitch/Axona%20Pitch%20v0.21.pdf) |

## Supplementary material

- **[`BUILDING.md`](BUILDING.md)** — the standard build process for every typeset doc (LaTeX source → tectonic → versioned PDF, archive the prior to history/). Read this before bumping any document.
- **[`TESTNET.md`](TESTNET.md)** — the SF testnet (staging line) quick-reference: live URLs (`testnet.axona.net` peer + `demo-testnet.axona.net` demo), the version matrix, how to run the apps against the testnet bridge, and the security/bug fixes on the line now live in production.
- **[`RELEASE-NOTES.md`](RELEASE-NOTES.md)** — changes shipped in the kernel and the apps, newest-first and keyed to kernel version.
- **[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md)** — public, shareable record of resolved security-relevant changes to the protocol kernel and apps (authenticated handshake, channel binding, hardening batches).
- **[`applications/`](applications/)** — the [**Axona Applications**](applications/Axona-Applications.md) document ([PDF](applications/Axona%20Applications%20v0.5.pdf)) — leads with the managed pub/sub-as-a-service tier (Pusher/Ably/PubNub and where Axona does — and doesn't — displace them), then decentralized social/messaging protocols (Nostr, Matrix, Farcaster, Bluesky, Waku/WalletConnect) and realtime apps renting centralized infra (peer-assisted CDN, collaborative editing, live feeds), then the established applications built on a DHT today; plus the Axona-powered apps we're building (civildefense.io, SYZL) — and the per-product briefs (SYZL — adaptive social feed).
- **[`architecture/`](architecture/)** — the full-stack architecture note: kernel · protocol · transport · bridge, the wire protocol, the complete application API, and the demo-app source. [PDF](architecture/Axona%20Architecture%20v0.7.12.pdf) · [`.tex`](architecture/Axona-Architecture.tex). Also the [Axona vs. Vivaldi](architecture/Axona-vs-Vivaldi-v0.1.md) design note (measured-RTT keyspace router vs. predictive latency-coordinate embedding) and the [E-1 placement-defense decision record](architecture/E-1-Placement-Defense-v0.1.md) (memory-hard PoW selected, RTT/Vivaldi rejected because the prefix is a routing area-code; includes the impact on the publishID/transportID split).
- **[`implementation/`](implementation/)** — integration plans, wire-protocol spec, per-node refactor plan, NX-17 → NH-1 punchlist, the [pub/sub lifecycle & access-control design](implementation/Pubsub-Lifecycle-Design-v0.2.md) (pull/kill/unpub/unsub, bounded queues, hold time, the three access models), the [heterogeneous-protocol simulation plan](implementation/Heterogeneous-Protocol-Sim-v0.1.md) (run mixed protocol versions / adversaries in one sim session), the [bridgeless connection / peer-relayed signaling design](implementation/Peer-Relayed-Signaling-v0.1.md) (form a new direct WebRTC link *through an existing peer* instead of the bridge — removing the signaling SPOF), and the [decoupled publish identity + C-3 metrics-authz spec](implementation/Decoupled-Publish-Identity-and-C3-v0.1.md) (self-contained handoff: a dedicated publish key separate from the transport/routing identity, plus the metrics reflection/fail-open fix they share an authorization seam with).
- **[`red team/`](red%20team/)** — independent red-team analyses including the protocol-layer god's-eye audit, the v0.3.38 13-issue priority list, the post-`axona/4` v2 sweep, an external v2.6.0 assessment, the **consolidated, prioritized [punch list](red%20team/red-team-punchlist-v2.6.0.md)** that merges them, and the [black-hole node threat & detection note](red%20team/black-hole-nodes-v0.1.md) (Byzantine omission — provable vs inferable, forwarding-vitality design). The current consolidated view — what's shipped on the live `axona/5` line and the remediation plan — is the **[Security Status & Remediation Plan (v2.32.0)](red%20team/SECURITY-STATUS-v2.32.0.md)**.
- **[`dead-ends/`](dead-ends/)** — preserved failures kept as cautionary examples (NX-16's masked-distance experiment; relevant smoke tests).
- **[`history/`](history/)** — superseded versions of all documents, preserved as project-evolution context.
- Loose architecture notes at the repo root (`01_*.md`…`07_*.md`, `NX-10-Architecture.md`, `Phase3-Membership-Protocol-Plan.md`) — early-stage design documents that pre-date the synthesis whitepaper.

## Programmer guide

Three companion documents in [`programmer-guide/`](programmer-guide/),
sized by how deep you want to go:

| Doc | Read when | Length |
|---|---|---|
| **[Quick Start](programmer-guide/Quick-Start-v2.32.0.md)** · [PDF](programmer-guide/Quick-Start-v2.32.0.pdf) | You want a working pub/sub roundtrip in 5 minutes. Copy three commands + one file, run, done. | ~150 lines |
| **[Axona API Reference](programmer-guide/Axona-API-Reference-v2.32.0.md)** · [PDF](programmer-guide/Axona-API-Reference-v2.32.0.pdf) | You're building and need to look up a specific call: signature, params, returns, errors, example for every public export. | ~700 lines |
| **[Programmer Guide](programmer-guide/Axona-Programmer-Guide-v2.32.0.md)** · [PDF](programmer-guide/Axona-Programmer-Guide-v2.32.0.pdf) | You're starting a new application against Axona. Mental model, identity, topic addressing, pub/sub semantics, the bridge, a worked chat-app example, common pitfalls, production checklist. | ~1500 lines |

All three track `@axona/protocol` v2.32.0 (the version is in each
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
