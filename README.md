# Axona Documentation

Documentation for the **Axona** peer-to-peer protocol: the whitepaper, research
paper, decks, architecture references, developer guides, AI-assistant
documentation, and red-team analyses. The protocol itself lives in
[axona-net/axona-protocol](https://github.com/axona-net/axona-protocol) (the
`@axona/protocol` kernel); the applications and infrastructure are
[axona-chat](https://github.com/axona-net/axona-chat) (group chat),
[axona-peer](https://github.com/axona-net/axona-peer) (the axona.net site),
[axona-bridge](https://github.com/axona-net/axona-bridge) (signaling broker),
[axona-relay](https://github.com/axona-net/axona-relay) (headless supernode +
MCP server), and [dht-sim](https://github.com/axona-net/dht-sim) (research
simulator).

**Try it live:**

- **<https://axona.net>** — the protocol's front door: the story, the documents, and every destination below.
- **<https://axona.chat>** — group chat on the production network. No server, no account; open two browsers and talk.
- **<https://demo.axona.net>** — the minimal kernel demo (and `/apps/axona-minimal`, the ~60-line build-along app).
- **<https://testnet.axona.net>** — the staging network (next kernel line before promotion).
- **<https://axona-net.github.io/dht-sim/>** — the in-browser simulator (1K–50K peers, all benchmark protocols).

Production runs the kernel **4.29.x** line (wire 4.0); the deployed version is
always visible at each bridge's `/healthz` and in every app's version row.

## Naming convention

| Term | Meaning |
|---|---|
| **Axona** | The protocol — addressing, routing, and pub/sub layer — and the name of the deployed network running it. This is the protocol these documents describe; refer to it by name. |
| **N-DHT** | *Neuromorphic DHT* — the broader family of learning-adaptive DHT designs to which Axona belongs. |
| **NX-17 / NH-1** | Named neuromorphic engine generations in the **dht-sim** benchmark roster — simulator comparison points along the lineage that informed Axona's design, *not* the deployed protocol. They appear only inside `dht-sim` and its benchmark walkthroughs; everywhere else the protocol is **Axona**. |

## The documents (PDF catalog)

Every finished document is a versioned PDF at the top of its section; superseded
versions move to [`history/`](history/). Source (`.md`/`.tex`) sits beside each
PDF — see [`BUILDING.md`](BUILDING.md) for the render process.

### Read first

| PDF | What it is |
|---|---|
| [**Axona Whitepaper v0.4**](whitepaper/Axona%20Whitepaper%20v0.4.pdf) | The unified document and the best single read: the Manifesto (Part I — why a network with no owner), The Machine (Part II — the full technical exposition), and The Politics (Part III — governance and consequences). Supersedes the standalone Explainer and Manifesto. |
| [**Axona Synopsis v0.6**](synopsis/Axona%20Synopsis%20v0.6.pdf) | A short position note: what Axona is, what is genuinely new (un-censorable assembly, ungovernable mobilization), who it is for — people and, increasingly, AI agents — and the costs of an un-censorable medium. |
| [**Axona Pitch v0.23**](pitch/Axona%20Pitch%20v0.23.pdf) | The two-column pitch: no-owner framing, live products (axona.chat, civildefense.io), and the headline 25K-node benchmark numbers. |
| [**Axona Manifesto**](manifesto/Axona-Manifesto.pdf) | The original manifesto as a standalone piece (now also Part I of the whitepaper): architecture is politics, at the scale of the protocol. |

### Research

| PDF | What it is |
|---|---|
| [**Axona Paper v0.5.0**](paper/Axona%20Paper%20v0.5.0.pdf) | Conference-format research write-up (IEEE two-column): the neuromorphic routing design and a controlled comparison against Kademlia-class baselines. |
| [**Axona Presentation v0.3.55**](presentation/Axona%20Presentation%20v0.3.55.pdf) | The research deck — full benchmark walkthrough at 25K nodes across the protocol roster. |
| [**Axona Explainer v0.4.29**](explainer/Axona%20Explainer%20v0.4.29.pdf) | The popular-audience explainer. *Merged into the whitepaper as of v0.4;* retained for its standalone narrative and the Symbiotic Development postscript. |
| [**Gates to Gradients**](synopsis/axona%20gates%20to%20gradients.pdf) | Companion essay: replace platform *gates* (accounts, moderation queues, bans) with *gradients* (cost, friction, reputation) — the design philosophy behind the six implementation notes in `architecture/`. |

### Architecture & applications

| PDF | What it is |
|---|---|
| [**Axona Architecture v4.27.0**](architecture/Axona%20Architecture%20v4.27.0.pdf) | The full-stack reference, dual-audience by design: prose for humans plus a reconstruction-grade specification for AI implementers — wire vocabulary and schemas, the root-management and convergence-policy tables, the timing model, the eleven invariants, and the life of a message end-to-end. |
| [**Axona Applications v0.6**](applications/Axona%20Applications%20v0.6.pdf) | What you build on an operator-free network: anonymous broadcast (the fan-out no incumbent offers), managed pub/sub displacement (Pusher/Ably/PubNub), decentralized social protocols compared (Nostr, Matrix, Farcaster, Bluesky), and the Axona-powered apps in flight. |
| [**SYZL Briefs v0.4**](applications/SYZL%20Briefs%20v0.4.pdf) | Per-product brief: SYZL, an adaptive social feed built on Axona pub/sub. |

### For programmers

Start with the intro deck, then pick by depth. The guides carry the kernel
version they were verified against in their filename (the application API is
unchanged from 4.27.1 through the current 4.29.x production line).

| PDF | What it is |
|---|---|
| [**Programmer Intro v0.4**](programmer-guide/Axona%20Programmer%20Intro%20v0.4.pdf) | A ~30-minute slide deck: what Axona is, how it works, the security model, the API you actually call, and a build-along of the live [Axona Minimal](https://demo.axona.net/apps/axona-minimal/) app. |
| [**Quick Start v4.27.1**](programmer-guide/Quick-Start-v4.27.1.pdf) | A working pub/sub roundtrip in 5 minutes: mint two identities, join the testnet, publish and subscribe. A runnable copy lives at [`programmer-guide/examples/minimal-pubsub/`](programmer-guide/examples/minimal-pubsub/). |
| [**Programmer Guide v4.27.1**](programmer-guide/Axona-Programmer-Guide-v4.27.1.pdf) | The application-builder's book: the five ideas (peer, author, topic, publish, subscribe), then recipes — chat, feeds, presence, retraction, file sharing, DMs, metrics — plus pitfalls, errors, and limits. |
| [**API Reference v4.27.1**](programmer-guide/Axona-API-Reference-v4.27.1.pdf) | Every public export: signature, params, returns, errors. The application surface first; transport and internals fenced off behind "you probably don't need this." |
| [**Services Guide v4.27.1**](programmer-guide/Axona-Services-Guide-v4.27.1.pdf) | For operators: the signaling bridge, the relay and its four front-ends (console, CLI, MCP server, desktop), directory/federation, and the PoW collector — the programs you *run* rather than write. |
| [**AI Grounding v4.30.0**](programmer-guide/Axona-AI-Grounding-v4.30.0.pdf) | Tier 1 of the AI documentation pair: hard rules, exact signatures, canonical patterns, error codes, limits — paste the [`.md`](programmer-guide/Axona-AI-Grounding-v4.30.0.md) into an AI assistant's context so it writes correct Axona code from the start. |

Tier 2 of the AI pair is markdown-only: the
[**AI Reference**](programmer-guide/Axona-AI-Reference-v4.30.0.md) — the
complete application API in AI form, with the timing/behavioral model that
prevents "it must be broken" agent errors. The whole corpus is also published
for automatic agent discovery as [`llms.txt`](llms.txt) (index) and
[`llms-full.txt`](llms-full.txt) / [`llms-full.md`](llms-full.md) at the repo
root.

### External references

[`references/`](references/) holds the third-party papers the design draws on —
Kademlia and S/Kademlia, Pastry, Tapestry, Chord/DHT surveys, Hashcash, the
Sybil attack, the end-to-end argument, Licklider's *Man-Computer Symbiosis*,
and others. They are cited throughout the whitepaper and architecture doc.

## Working notes and supplementary material

- **[`architecture/`](architecture/)** — beyond the PDF above, the deep-dive markdown notes: [Root Management — the RootClaim state machine](architecture/Root-Management-v4.20.1.md) (the authoritative root-election/convergence reference), the [Kernel Refactor Analysis v0.2](architecture/Kernel-Refactor-Analysis-v0.2.md) (the convergence-plane simplification program), the [Soak-Test Framework overview](architecture/Soak-Framework-Overview-v4.21.0.md) (what the live soaks measure and the methodology rules), the [E-1 placement-defense](architecture/E-1-Placement-Defense-v0.1.md) and [Stage-4 memory-hard PoW](architecture/Stage4-MemoryHard-PoW-v0.1.md) decision records, [Axona vs. Vivaldi](architecture/Axona-vs-Vivaldi-v0.1.md), [Eligibility-Aware Root Placement](architecture/Load-Aware-Root-Placement-v0.2.md) (proposal, not built), [Pub/Sub metrics as a derived topic](architecture/Pub-Sub-Metrics-Topic-v0.1.md), [Axona as a control plane for virtual device links](architecture/Axona-Control-Plane-for-Virtual-Links-v0.1.md), and the six **Gates to Gradients** implementation notes ([1](architecture/Gates-to-Gradients-1-Costly-Identity-v0.2.md)–[6](architecture/Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)).
- **[`implementation/`](implementation/)** — integration plans and specs: the [pub/sub lifecycle & access-control design](implementation/Pubsub-Lifecycle-Design-v0.2.md), [peer-relayed signaling](implementation/Peer-Relayed-Signaling-v0.1.md) (bridgeless connections), the [decoupled publish identity spec](implementation/Decoupled-Publish-Identity-and-C3-v0.1.md), the wire-protocol spec, and refactor punchlists.
- **[`red team/`](red%20team/)** — independent red-team analyses. The current consolidated view is the [punch list re-audited against 4.19.3](red%20team/red-team-punchlist-v4.19.3.md); the shipped-baseline narrative is the [Security Status & Remediation Plan](red%20team/SECURITY-STATUS-v2.43.0.md); plus the [black-hole node threat note](red%20team/black-hole-nodes-v0.1.md) and the external bridge assessment ([axona-bridge#1](https://github.com/axona-net/axona-bridge/issues/1)).
- **[`reviews/`](reviews/)** — external AI-agent reviews of the protocol and its documentation, unedited.
- **[`BUILDING.md`](BUILDING.md)** — how every typeset doc is rendered (source → tectonic → versioned PDF, prior PDF archived to `history/`). Read before bumping any document.
- **[`TESTNET.md`](TESTNET.md)** — the staging-network quick reference: URLs, version matrix, running apps against the testnet bridge.
- **[`RELEASE-NOTES.md`](RELEASE-NOTES.md)** — kernel and app changes, newest-first, keyed to kernel version.
- **[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md)** — public record of resolved security-relevant changes (what's now protected, keyed to kernel version).
- **[`team-updates/`](team-updates/)** — the running engineering record: one dated team update per release or investigation (soak reviews, prod promotions, incident post-mortems), newest work at the highest version.
- **[`dead-ends/`](dead-ends/)** — preserved failures kept as cautionary examples.
- **[`history/`](history/)** — superseded versions of all documents, preserved as project-evolution context.
- Loose notes at the repo root (`01_*.md`…`07_*.md`, diagnosis notes) — early design documents and working notes.

## Repository map

```
.
├── whitepaper/        # The unified reference document (md + tex + PDF)
├── synopsis/          # Position note + Gates-to-Gradients essay
├── pitch/             # Two-column pitch
├── manifesto/         # Standalone manifesto
├── paper/             # IEEE-format research paper
├── presentation/      # Marp research deck (+ charts/)
├── explainer/         # Merged into the whitepaper; kept for history
├── architecture/      # Full-stack reference + deep-dive design notes
├── applications/      # Applications survey + product briefs
├── programmer-guide/  # Programmer Intro deck, Quick Start, Guide, API Ref, Services, AI docs (+ examples/)
├── implementation/    # Integration plans, wire spec, punchlists
├── red team/          # Red-team audits and analyses
├── reviews/           # External AI-agent reviews
├── references/        # Third-party papers the design draws on
├── dead-ends/         # Archived failed approaches
├── history/           # Superseded document versions
├── llms.txt           # AI-agent discovery index (+ llms-full.txt / llms-full.md)
└── README.md
```

## Contributing

This repo holds finished documents and curated supplementary material. Edits
follow a per-document version number: bump the version in the document's
footer/title and produce a fresh versioned PDF in the same commit. The previous
PDF moves to `history/<section>/` so the canonical file is always the most
recent version at the top level. Developer guides carry the kernel version
deployed on testnet that they describe, in their filename.

**Security-relevant changes** (in any Axona repo): update
[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md) in the same batch — resolved
items only, keyed to kernel version, described by *what's now protected* (never
enumerate still-open findings, which live only in the private red-team
register).

## License

Documents in this repository are released under the same terms as the protocol
implementation. See the LICENSE file in
[axona-protocol](https://github.com/axona-net/axona-protocol/blob/main/LICENSE)
for the canonical terms.
