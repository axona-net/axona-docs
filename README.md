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

- **<https://axona.net>** — the reference application (browser peer, pub/sub UI; talks to the deployed network). *Production runs the `axona/5` / kernel-2.40 line (`WIRE_VERSION` 2.0; cut over 2026-06-08, kernel rolled to 2.40.0 on 2026-06-12).*
- **<https://testnet.axona.net>** — the SF testnet peer (the `axona/5` / kernel-2.40 line); **<https://demo-testnet.axona.net>** is the minimal kernel demo on the same testnet.
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

- **[`synopsis/`](synopsis/)** — the [**Axona Synopsis and Implications**](synopsis/Axona%20Synopsis%20v0.6.pdf) ([`.tex`](synopsis/Axona-Synopsis.tex)) — a position note (tufte-handout): what Axona is, what is genuinely new (ungovernable mobilization, un-censorable assembly), who it is for (every participant a publisher; people and, increasingly, AI agents), the cost of an un-censorable medium, and the end-to-end principle and falsifiable rules behind the design.
- **[`BUILDING.md`](BUILDING.md)** — the standard build process for every typeset doc (LaTeX source → tectonic → versioned PDF, archive the prior to history/). Read this before bumping any document.
- **[`TESTNET.md`](TESTNET.md)** — the SF testnet (staging line) quick-reference: live URLs (`testnet.axona.net` peer + `demo-testnet.axona.net` demo), the version matrix, how to run the apps against the testnet bridge, and the security/bug fixes on the line now live in production.
- **[`RELEASE-NOTES.md`](RELEASE-NOTES.md)** — changes shipped in the kernel and the apps, newest-first and keyed to kernel version.
- **[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md)** — public, shareable record of resolved security-relevant changes to the protocol kernel and apps (authenticated handshake, channel binding, hardening batches).
- **[`applications/`](applications/)** — the [**Axona Applications**](applications/Axona-Applications.md) document ([PDF](applications/Axona%20Applications%20v0.6.pdf)) — leads with **anonymous broadcast** (the operator-free, publisher-unlinkable fan-out no incumbent offers — whistleblowing, censorship-resilient coordination, anonymous feedback, pseudonymous publishing) and the managed pub/sub-as-a-service tier (Pusher/Ably/PubNub and where Axona does — and doesn't — displace them), then decentralized social/messaging protocols (Nostr, Matrix, Farcaster, Bluesky, Waku/WalletConnect) and realtime apps renting centralized infra (peer-assisted CDN, collaborative editing, live feeds), then the established applications built on a DHT today; plus the Axona-powered apps we're building (civildefense.io, SYZL) — and the per-product briefs (SYZL — adaptive social feed).
- **[`architecture/`](architecture/)** — the full-stack architecture note, revised at kernel 4.26.0 as a dual-audience document — prose for humans, a reconstruction-grade specification for AI implementers (wire vocabulary with schemas, the root-management decision table, the convergence-plane policy table, the role-nature/eviction table, the normative timing model, the eleven invariants incl. the principal-liveness rule, and an ordered reconstruction guide with four traps): the axonic pub/sub tree (emergent roots, delegation, delta-gated cohort replication), identity · addressing · routing · transport · bridge, the wire protocol, the life of a message end-to-end, and a what-fails-and-what-happens robustness section. [PDF](architecture/Axona%20Architecture%20v4.26.0.pdf) · [`.tex`](architecture/Axona-Architecture.tex). The authoritative deep-dive on root election/convergence is **[Root Management — the RootClaim state machine (kernel 4.20.1)](architecture/Root-Management-v4.20.1.md)**: the one-transition-function model, the defer-gate decision table with its liveness-evidence tiers, departure rules, timing model, and worked examples — written for humans and AI assistants working on the kernel (companions: the [Kernel Refactor Analysis v0.2](architecture/Kernel-Refactor-Analysis-v0.2.md) — the convergence-plane program with the full 38-mechanism inventory (v0.1, which motivated the 4.20–4.21 consolidation, remains in place), and the [response to the external root-management review](architecture/Root-Management-Review-Response-2026-07-13.md) — one finding shipped as 4.20.1, two invalidated by trace, one confirmed as the documented tradeoff), and the [Soak-Test Framework overview & gap analysis](architecture/Soak-Framework-Overview-v4.21.0.md) — what the live soaks measure, the methodology rules (healed-not-initial, REPS≥5, quiesced gates), and the ranked coverage gaps mapped to who actually found each July incident. Also the [Axona vs. Vivaldi](architecture/Axona-vs-Vivaldi-v0.1.md) design note (measured-RTT keyspace router vs. predictive latency-coordinate embedding) and the [E-1 placement-defense decision record](architecture/E-1-Placement-Defense-v0.1.md) (memory-hard PoW selected, RTT/Vivaldi rejected because the prefix is a routing area-code; includes the impact on the publishID/transportID split, plus Stage-5 proof-of-tenure), and the [Stage-4 memory-hard PoW function-selection record](architecture/Stage4-MemoryHard-PoW-v0.1.md) (asymmetric Equihash/Cuckoo, the "memory = device floor, difficulty = search effort" parameters, and multi-device shared-publishID effort-splitting). Also the [Axona as a decentralized control plane for virtual device links](architecture/Axona-Control-Plane-for-Virtual-Links-v0.1.md) design sketch (prompted by AWS Resilient Network Graphs — Axona pub/sub as a zero-trust SDN-style control plane that discovers devices and negotiates direct links, with the data plane out of band; where it beats a single-owner fabric and where it does not), and the [Pub/Sub metrics as a derived topic](architecture/Pub-Sub-Metrics-Topic-v0.1.md) note (move per-user metrics polling off the K-root scatter-gather: the topic's primary root publishes signed snapshots to `metricTopic(T)`, subscribers get the latest plus a rolling ~48 h trend history for free — a core `metricTopic()` helper in `@axona/protocol`, no wire change), and the [Load-Aware Root Placement](architecture/Load-Aware-Root-Placement-v0.1.md) proposal (split the *anchor* — the address-closest node found by routing — from the *root* — the node doing the work; let an overloaded closest node `defer` and hand rootship to the nearest under-budget member of the topic's K-closest ladder, so a root can live off its closest node without a coordinator, a trust hole, or a discovery failure; **not built** — to be falsified in `dht-sim` first, mindful of the stability-root-election NO-GO). And the **From Gates to Gradients** six-note series — implementation design sketches responding to the [companion essay](synopsis/axona%20gates%20to%20gradients.pdf) (replace platform *gates* with *gradients*; governance unbundled from control): [1 costly identity](architecture/Gates-to-Gradients-1-Costly-Identity-v0.2.md), [2 cascade telemetry](architecture/Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md), [3 soft retraction & annotations](architecture/Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md), [4 forkable filter sets](architecture/Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md), [5 agent legibility](architecture/Gates-to-Gradients-5-Agent-Legibility-v0.2.md), [6 friction scaled to reach](architecture/Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md).
- **[`implementation/`](implementation/)** — integration plans, wire-protocol spec, per-node refactor plan, NX-17 → NH-1 punchlist, the [pub/sub lifecycle & access-control design](implementation/Pubsub-Lifecycle-Design-v0.2.md) (pull/kill/unpub/unsub, bounded queues, hold time, the three access models), the [heterogeneous-protocol simulation plan](implementation/Heterogeneous-Protocol-Sim-v0.1.md) (run mixed protocol versions / adversaries in one sim session), the [bridgeless connection / peer-relayed signaling design](implementation/Peer-Relayed-Signaling-v0.1.md) (form a new direct WebRTC link *through an existing peer* instead of the bridge — removing the signaling SPOF), and the [decoupled publish identity + C-3 metrics-authz spec](implementation/Decoupled-Publish-Identity-and-C3-v0.1.md) (self-contained handoff: a dedicated publish key separate from the transport/routing identity, plus the metrics reflection/fail-open fix they share an authorization seam with).
- **[`red team/`](red%20team/)** — independent red-team analyses including the protocol-layer god's-eye audit, the v0.3.38 13-issue priority list, the post-`axona/4` v2 sweep, an external v2.6.0 assessment, the [black-hole node threat & detection note](red%20team/black-hole-nodes-v0.1.md) (Byzantine omission — provable vs inferable, forwarding-vitality design), and the external [bridge security assessment](https://github.com/axona-net/axona-bridge/issues/1) (June 2026) with its enumeration analysis in [Bridge directory enumeration & privacy](architecture/Bridge-Directory-Enumeration-and-Privacy-v0.1.md). The current consolidated view is the **ranked [punch list re-audited against 4.16.x](red%20team/red-team-punchlist-v4.22.0.md)** — a code-verified pass over kernel 4.16.1 (testnet) / 3.6.0 (prod) that confirms the 3.x integrity wave + the bridge G-batch closed and re-ranks the open frontier (G-1 directory enumeration, E-1 memory-hard PoW, F-2 CSP). It supersedes the [v2.43.0 punch list](red%20team/red-team-punchlist-v2.43.0.md); the shipped-baseline narrative remains the **[Security Status & Remediation Plan (v2.43.0)](red%20team/SECURITY-STATUS-v2.43.0.md)**.
- **[`dead-ends/`](dead-ends/)** — preserved failures kept as cautionary examples (NX-16's masked-distance experiment; relevant smoke tests).
- **[`history/`](history/)** — superseded versions of all documents, preserved as project-evolution context.
- Loose architecture notes at the repo root (`01_*.md`…`07_*.md`, `NX-10-Architecture.md`, `Phase3-Membership-Protocol-Plan.md`) — early-stage design documents that pre-date the synthesis whitepaper.

## Programmer guide

Start with the **[Programmer Introduction](programmer-intro/Axona%20Programmer%20Intro%20v0.4.pdf)** ([`.md`](programmer-intro/Axona-Programmer-Intro.md)) — a ~30-minute **slide deck** (Marp, Tufte theme, with diagrams): what Axona is, how it works, the security model, the API you actually call, and a build-along of the live **[Axona Minimal](https://demo.axona.net/apps/axona-minimal/)** app (topic / message / received, ~60 lines). Then go deeper with the companion documents in [`programmer-guide/`](programmer-guide/), sized by how far you want to go:

| Doc | Read when | Length |
|---|---|---|
| **[Quick Start](programmer-guide/Quick-Start-v4.22.0.md)** · [PDF](programmer-guide/Quick-Start-v4.22.0.pdf) | You want a working pub/sub roundtrip in 5 minutes. Mint two identities, build a peer on the live testnet bridge, publish + subscribe to an open topic. | ~240 lines |
| **[Programmer Guide](programmer-guide/Axona-Programmer-Guide-v4.22.0.md)** · [PDF](programmer-guide/Axona-Programmer-Guide-v4.22.0.pdf) | You're building an application. The five ideas (peer, author, topic, publish, subscribe), then **recipes** — chat, feeds, inboxes, presence, retraction, file sharing, DMs, metrics — plus the pitfalls, errors, limits, and an optional under-the-hood chapter. Written for app programmers, not network engineers. | ~530 lines |
| **[AI Grounding](programmer-guide/Axona-AI-Grounding-v4.22.0.md)** · [PDF](programmer-guide/Axona-AI-Grounding-v4.22.0.pdf) | You're building **with an AI assistant** (most Axona apps are). One self-contained, machine-oriented file — hard rules, exact signatures, canonical patterns, error codes, limits — to paste into the assistant's context so it builds correct Axona code from the start. (Paste the `.md`; the PDF is the human-readable rendering.) | ~350 lines |
| **[Axona API Reference](programmer-guide/Axona-API-Reference-v4.22.0.md)** · [PDF](programmer-guide/Axona-API-Reference-v4.22.0.pdf) | You need to look up a specific call: signature, params, returns, errors for every public export. Three fenced parts — the **Application surface** (what apps call), then transport/protocol and low-level internals clearly marked "you probably don't need this." | ~1630 lines |
| **[Services Guide](programmer-guide/Axona-Services-Guide-v4.22.0.md)** · [PDF](programmer-guide/Axona-Services-Guide-v4.22.0.pdf) | You're **operating** Axona, not just building on it: the signaling **bridge**, the **relay** + its four front-ends (console, CLI, **MCP server**, desktop app), directory/federation, and the PoW collector — the programs you *run* rather than write. | ~420 lines |

All five track `@axona/protocol` **v4.22.0** — every developer document carries
the kernel version deployed on testnet that it describes, in its filename. The 4.x line runs on **testnet** (`wss://testnet.axona.net`);
production is still on the 3.x line. The kernel currently deployed is at each app's
version row and the bridge's `/healthz`. The topic-addressing reference (formerly a standalone Topic-IDs
note) is now folded into the Programmer Guide (Topics & Addressing) and the API
Reference (Pub/sub → Topic addressing).

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
