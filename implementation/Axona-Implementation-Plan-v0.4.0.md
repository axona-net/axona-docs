# Axona Implementation Plan

## A Complete Specification for Building the Production Axona Bootstrap and Routing System

**Document version:** v0.4.0
**Companion to:** Axona Whitepaper v0.3.58, Axona Architecture Note v0.7.5, Axona Programmer Guide v2.14.0
**Author:** David A. Smith — YZ.social
**Date:** 2026-06-03
**Kernel as built:** `@axona/protocol` v2.14.0 (wire v1.0)
**Target deployment:** Mobile (iOS/Android), browser, and server-class peers

---

## Front Matter

### Purpose

This document specifies the complete implementation of the Axona system as a deployable platform. It is intended for engineers who will build the protocol library, the supporting infrastructure (connection servers, bootstrap servers, monitoring), and the reference application. After reading this document, an engineering team should have unambiguous direction on:

- What modules need to exist
- What each module is responsible for
- What APIs each module exposes
- What state is persisted, where, and how
- What network protocols are spoken
- What infrastructure is required
- In what order to build and validate everything

The goal is a system that **applications can integrate into seamlessly** — drop in a library, configure an entry point, and the app is part of the network. This requires a clean separation between protocol logic and application concerns.

### Scope

This document covers:

- **The protocol library** — `axona-core`, the routing and pub/sub engine
- **The transport layer** — `axona-transport`, abstracting WebRTC, WebSockets, libp2p
- **The persistence layer** — `axona-storage`, abstracting platform-specific storage
- **The bootstrap subsystem** — `axona-bootstrap`, sponsor flow + hardcoded servers + QR
- **The cryptographic layer** — `axona-crypto`, Ed25519, signatures, key management
- **The infrastructure** — bootstrap servers, TURN relays, monitoring backends
- **The reference application** — `axona-demo`, validating the integration path
- **The development sequence** — build order, validation gates, deployment milestones

This document does **not** cover:

- The detailed mathematics of the Axona routing algorithm (see whitepaper §3-5)
- The simulator (`dht-sim`) — that is a research artifact, not a deployment artifact
- Application-level features built on top (chat UX, social graphs, content discovery)
- Operational runbooks beyond the build phase (see whitepaper §13 for steady-state ops)

### Non-Negotiable Design Principles

These principles drive every architectural decision below:

1. **The protocol library is platform-agnostic.** Core logic ships as portable code (TypeScript, with bindings) that runs identically on Node.js, browsers, iOS (via WebKit JS bridge or native port), and Android (similar).
2. **Every layer has a clean interface.** Transport, storage, crypto are *abstractions*; the protocol depends on the interface, not the implementation. This is what makes mobile and browser deployments possible from a single core.
3. **Persistence is mandatory, not optional.** Every node persists its synaptome and identity by default. Sessions resume; they do not restart.
4. **Cryptographic verification is non-skippable.** Every peer-to-peer message is signed; every signature is verified. There is no "trust mode" that bypasses signatures.
5. **Failure modes are first-class.** Every operation has explicit timeout, retry, and fallback. The system degrades gracefully.
6. **Observability is built-in, not bolted-on.** Every operation emits structured events; metrics are produced from those events; no separate instrumentation layer is needed.
7. **The integration surface is small.** An application embeds the library by initializing one object and calling 4-5 methods. The library handles everything else.

### Intended Reader

This document assumes the reader is:

- Familiar with the Axona whitepaper (especially §3-6: foundational mechanics, vitality model, axonal pub/sub)
- Familiar with the red team document (especially Issues #1-4: friction items)
- Comfortable with TypeScript, async/await, cryptographic primitives, and distributed systems concepts
- Building either the protocol library, the infrastructure, or an application on top of it

### Document Structure


| Section                                         | Content                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| **1. System Architecture Overview**             | The kernel + three consumers, kernel module map, integration surface |
| **2. The Protocol Library: `axona-core`**         | Routing, pub/sub, learning rules — the brain                 |
| **3. The Transport Layer: `axona-transport`**     | WebRTC, WebSocket, libp2p abstractions                       |
| **4. The Persistence Layer: `axona-storage`**     | Platform-specific storage adapters                           |
| **5. The Cryptographic Layer: `axona-crypto`**    | Keys, signatures, hashes, secure random                      |
| **6. The Bootstrap Subsystem: `axona-bootstrap`** | Sponsor flow, QR codes, fallback servers                     |
| **7. The Application API: `axona-app`**           | The integration surface for application developers           |
| **8. Infrastructure Components**                | Bootstrap servers, TURN relays, monitoring                   |
| **9. Wire Protocol Specification**              | Message formats, encoding, signatures                        |
| **10. State Persistence Format**                | Disk schemas, migration, integrity                           |
| **11. Development Sequence**                    | Build order, validation gates, milestones                    |
| **12. Testing Strategy**                        | Unit, integration, simulation, deployment                    |
| **13. Deployment Phases**                       | Testnet, staging, limited release, production                |
| **14. Reference Application**                   | The integration validator                                    |
| **15. Operational Handoff**                     | What ops needs from engineering                              |
| **16. Future Directions**                       | Federated bridges, demoting the bridge, capability hardening |


---

## Implementation Status (as built — kernel v2.14.0)

This plan was authored in April 2026 as a forward specification. The system
has since been **built and deployed**; this section reconciles the plan with
what actually shipped, so the detailed specifications that follow are read in
the right light. Where a later section names a module or class that differs
from the shipped name, the mapping below is authoritative.

### What shipped, and where it lives

The seven-layer module taxonomy in §1 (`axona-core`, `axona-transport`,
`axona-storage`, `axona-crypto`, `axona-bootstrap`, `axona-app`) was realized
as a **single protocol kernel** plus three consumers — not seven separately
published packages:

| This plan | As built |
|---|---|
| `axona-core` / class `AxonaCore` | **`@axona/protocol`** — `AxonaPeer` (routing + lifecycle), `AxonaManager` (axonal pub/sub), `AxonaDomain` (shared mesh state) |
| `axona-transport` | kernel `transport/` — `Transport.web()` (bridge-WS + WebRTC-mesh composite), `Transport.node()` (WS), `Transport.sim()` (in-process) |
| `axona-storage` | kernel `persistence/` — `PersistenceAdapter` with IndexedDB (browser) and file (Node) adapters |
| `axona-crypto` | kernel `identity/` + `pubsub/envelope` — Ed25519 via Web Crypto, signed envelopes, canonical signing input |
| `axona-bootstrap` | the **`axona-bridge`** service (signaling broker + embedded universal-hub peer) plus the peer's `join()` path |
| `axona-app` / class `AxonaApp` | the unified **`AxonaPeer`** API, consumed directly (`pub`/`sub`/`pull`/`metrics`/`unsub`/`kill`/`unpub`/`send`/`notify`/`peers`/`health`) |
| `axona-demo` | **`axona-peer`** (the axona.net reference app) and the kernel's `examples/minimal-pubsub-browser` demo |

Repositories (the `github.com/YZ-social/dht-sim` pointer in this doc predates
the split): `axona-net/axona-protocol` (kernel), `axona-net/axona-peer`
(browser SDK → axona.net), `axona-net/axona-bridge` (signaling broker →
bridge.axona.net), `axona-net/dht-sim` (simulator + benchmarks);
documentation in `axona-net/axona-docs`.

### Capabilities realized since v0.3.38

- **264-bit address space.** Identity = `8-bit S2 geo prefix ‖ sha256(Ed25519 pubkey)`; topics share the space (public, publisher-keyed, and synthetic-regional modes).
- **Authenticated transport (`axona/5`).** Every bind proves the peer's pubkey hashes to its nodeId suffix; WebRTC channels are bound to their DTLS-certificate fingerprint (MITM-resistant). A bidirectional version-gate handshake lets bridges reject sub-floor clients with a clear upgrade signal.
- **Unified, signed pub/sub.** Ed25519-signed envelopes, verified at K-closest ingress; replication to the K-closest root set; a bounded replay queue (default 100, ceiling 256) with deterministic seq-ordered eviction; hold-time TTL (24 h, 48 h ceiling); a per-publisher quota on open topics; per-publisher monotonic `seq` + a freshness window for anti-replay.
- **Lifecycle controls, all self-authenticating.** `unsub`; `kill` (creator-only retract + tombstone); `unpub` (owner-only queue removal); `pull` (by `msgId` or latest); `metrics` (swept across the whole K-closest root set; unowned-topic metrics readable by anyone, owner-keyed metrics owner-only).
- **Soft-state subscriptions.** Re-announced every ~10 s (`refreshIntervalMs`); a root expires a subscriber after 30 s (`maxSubscriptionAgeMs`).
- **Resilient web transport.** Auto-reconnect with exponential backoff (1→16 s), welcome/RTT observability, app-layer resume on wake.
- **Graceful bridge shutdown** (kernel ≥ v2.13.0). On `SIGTERM` the bridge announces `peer-leaving`; peers evict it and re-anchor immediately instead of waiting out a refresh tick.
- **Persistence.** Identity, synaptome, and subscriptions are checkpointed and recovered through the `PersistenceAdapter`.

### Build-sequence status

The phased plan in §11 is largely complete. Phases 0–4 (foundation → core
protocol → real I/O → bootstrap → hardening) shipped as the v1.0 flag-day
cutover followed by the v2.x security-hardening waves; the network is **live
in limited production** (axona.net, bridge.axona.net, demo.axona.net). Active
work is Phase 7 (scale & refine) plus the items in **Future Directions**
(§16) — chiefly federated bridges and removing the bridge's residual
centrality. Security posture is tracked in `SECURITY-CHANGELOG.md` (resolved
items) and the private red-team punch list (open items).

> The module/interface/wire specifications in §§1–10 are preserved as the
> original engineering plan. Read them through the mapping above: the shapes
> are representative, but the canonical, current contracts are the shipped
> `@axona/protocol` API — see the **Axona Programmer Guide v2.14.0** and the
> **Axona API Reference**.

---

## 1. System Architecture Overview

Axona ships as **one protocol kernel** plus **three consumers** — not the seven
separately published packages this plan originally proposed. The kernel,
`@axona/protocol`, is a pure-JS, dependency-free library that runs unchanged in
browsers and Node; the consumers wire it to a real environment.

### 1.1 The kernel and its consumers

```
@axona/protocol   the kernel: routing, axonal pub/sub, identity,
                  signed envelopes, and the three adapter contracts
   │
   ├── axona-peer     browser SDK + reference application   → axona.net
   ├── axona-bridge   signaling broker + embedded universal-hub peer → bridge.axona.net
   └── dht-sim        in-process simulator + benchmark harness → demo.axona.net
```

There is no network boundary between "core" and "app". An application
constructs an `AxonaPeer`, hands it a `Transport` and (optionally) a
`PersistenceAdapter`, and calls `pub` / `sub` / `pull` / `metrics` / `send`.
The kernel owns routing, learning, and pub/sub; the application owns its UI and
storage choice; the transport owns the wire. The "seven layers" of the original
plan still exist — as **internal directories of one package**, not separate
artifacts (see the *Implementation Status* mapping above).

### 1.2 Kernel module map

| Directory | Module(s) | Responsibility |
|---|---|---|
| `contracts/` | `DHT`, `Transport`, `BootstrapService`, `types` | The interfaces every adapter implements, plus shared typedefs |
| `dht/` | `AxonaPeer` | Per-node API + routing/lifecycle: `start`/`join`/`leave`, `lookup`, `pub`/`sub`/`pull`/`metrics`, `unsub`/`kill`/`unpub`, `send`/`notify`/`onMessage`, `peers`/`health`, `snapshot` |
| | `AxonaManager` | Axonal pub/sub engine — roots, replay caches, fan-out, lifecycle |
| | `AxonaDomain` | Shared mesh state + event bus for peers in one process |
| | `NeuronNode`, `Synapse` | The synaptome (routing table) and its learned, weighted edges |
| | `Subscription` | The handle `sub()` returns |
| `pubsub/` | `AxonaManager`, `AxonPubSub` | Engine + thin facade |
| | `envelope`, `post`, `ed25519` | Signed-envelope build/verify, topic-id derivation, Ed25519 helpers |
| | `kill`, `unpub` | Lifecycle markers (tombstones, owner queue removal) |
| `identity/` | `deriveIdentity`, `nodeid` | Ed25519 keygen + 264-bit nodeId derivation |
| `persistence/` | `interface`, `indexeddb`, `file` | `PersistenceAdapter` + browser and Node adapters |
| `transport/` | `web/`, `node/`, `sim/` | `Transport.web()` (bridge-WS + WebRTC-mesh composite), `Transport.node()` (WS), `Transport.sim()` (in-process) |
| | `handshake`, `handshake-auth`, `wire` | Version gate, the `axona/5` authenticated handshake, the frame codec |
| `utils/` | `hexid`, `s2`, `geo` | BigInt↔hex, S2 geo-cell prefix, distance helpers |

### 1.3 The integration surface

An application never touches the layers individually; it constructs a peer and
uses it:

```js
import { AxonaPeer, AxonaDomain, deriveIdentity } from '@axona/protocol';
import { webTransport } from '@axona/protocol/transport/web/index.js';

const identity  = await deriveIdentity({ lat, lng });   // or restored from persistence
const transport = webTransport({ bridgeUrl, identity, autoHandshake: true });
const peer = new AxonaPeer({ domain: new AxonaDomain(), node, identity, transport, persist });

await peer.start();                       // or peer.join(sponsorId) for the production bootstrap
const sub = await peer.sub('us-east/chat', env => render(env.message), { publisher, since: 'all' });
await peer.pub('us-east/chat', { text: 'hello' }, { publisher });
```

The canonical, current signatures live in the **Axona API Reference v2.14.0**;
this section is the map, not the reference.

---

## 2. The Protocol Core: `AxonaPeer` + `AxonaManager` + `AxonaDomain`

*(Realizes the planned `axona-core` / `AxonaCore`. The single class became three
collaborating ones.)*

### 2.1 Responsibilities

- **`AxonaPeer`** — the per-node "brain" and the public API. Owns the synaptome
  (admission, vitality, eviction), AP/XOR routing and `lookup`, the unified
  pub/sub + direct-message surface, the `join`/`leave` lifecycle, and
  health/observability. It installs its routing handlers on whatever
  `Transport` it's given.
- **`AxonaManager`** — the axonal pub/sub engine `AxonaPeer` delegates topic
  work to: K-closest root selection, the bounded replay cache, fan-out to
  subscriber children, and the lifecycle operations (`kill`/`unpub`, freshness,
  metrics).
- **`AxonaDomain`** — shared mesh state and the event bus. In the simulator and
  in tests many peers share one domain; in the browser a peer has its own. It
  also holds the 12 learning parameters.

### 2.2 Public interface (as built)

The shipped surface (see API Reference for exact signatures):

```
start() / stop() / join(sponsor?) / leave({drain,notify})
lookup(targetId)
pub(topic, msg, {publisher, sign})  /  sub(topic, handler, {publisher, since})
pull(topic, msgId|null, {publisher})  /  metrics(topic, {publisher})
unsub(topic, opts)  /  kill(topic, msgId, opts)  /  unpub(topic, {destroy}, opts)
send(peerId, type, body)  /  notify(...)  /  onMessage(handler)
peers()  /  onPeerJoin(cb)  /  onPeerLeave(cb)
health()  /  onLog(cb)  /  onError(cb)
snapshot()  /  AxonaPeer.fromSnapshot(...)
```

### 2.3 Internal structure

The synaptome is a `NeuronNode` holding `Synapse` edges scored by a single
**vitality** function (`weight × recency`, with an inertia lock and decay) —
the consolidation the whitepaper describes. Routing handlers (`lookup`,
`reinforce`, `triadic_introduce`, `hop_cache`/`lateral_spread`, and the
graceful-departure `peer-leaving`) are registered on the transport at
construction. `AxonaManager` keeps `axonRoles` (per-topic root/relay state with
its replay cache and child set) and is created lazily on first `pub`/`sub`.

### 2.4 Key data structures

- **NodeId / topicId** — `BigInt`, 264 bits, `8-bit S2 prefix ‖ 256-bit hash`.
- **Synapse** — `{ peerId, weight, latencyMs, stratum, inertia, useCount }`.
- **Axon role** — `{ isRoot, parentId, children:Map, replayCache:[], … }`.
- **Envelope** — `{ msgId, ts, topic, message, signerPubkey?, signature?, seq }`.

### 2.5 Notes — divergence from the simulator

The simulator's engine is ~270 lines; the production core is larger because it
adds typed errors, observability, persistence integration, authenticated
transport, and the lifecycle/anti-abuse machinery (signature verification at
ingress, freshness windows, bounded queues, tombstones) the simulator never
faces. The *algorithm* is identical; the *surface* is hardened.

---

## 3. The Transport Layer: `contracts/Transport` + `transport/{web,node,sim}`

*(Realizes the planned `axona-transport`.)*

### 3.1 The Transport contract

One interface, three adapters: `send` / `notify` (request and fire-and-forget),
`onRequest` / `onNotification`, `openConnection` / `closeConnection` /
`isConnected`, `boundPeers()`, and lifecycle `start` / `stop`. The kernel is
transport-agnostic — routing and pub/sub call only this contract.

### 3.2 The three adapters

- **`Transport.web()` (`webTransport`)** — the browser path, a **composite** of
  two sub-transports: a **bridge WebSocket** (signaling relay + bootstrap, and a
  fallback data path to the bridge's own nodeId) and a **WebRTC mesh** (direct
  peer-to-peer DataChannels). `webTransport` owns the bridge-socket lifecycle:
  the version-gate + `axona/5` hello, ping/pong with stale detection,
  welcome/RTT exposure, and auto-reconnect.
- **`Transport.node()`** — a Node WebSocket transport for server-class peers and
  the headless test harness.
- **`Transport.sim()`** — an in-process `SimNetwork` used by the simulator and
  the kernel's own smoke tests; same contract, zero sockets.

### 3.3 Authentication — `axona/5`

Every bind is gated on proof (`handshake-auth`): the peer presents its pubkey,
which must hash to the 256-bit suffix of the nodeId it claims, and signs a
server-issued nonce. On the WebRTC mesh the channel is additionally bound to the
peer's **DTLS-certificate fingerprint**, so a relay that swaps the media path
fails the mutual check (finding A-1). A separate bidirectional **version gate**
(`handshake`) lets a bridge reject sub-floor clients with close code 4426.

### 3.4 Connection state machine

`webTransport` surfaces `connecting → connected → disconnected → (reconnecting)`
plus a terminal `upgrade-required`. Reconnect is exponential backoff,
**1 s → 16 s**, re-running the full handshake on each re-open; an app-layer
"resume on wake" accelerates recovery after device sleep.

---

## 4. The Persistence Layer: `persistence/`

*(Realizes the planned `axona-storage`.)*

A single `PersistenceAdapter` contract (`load`/`save`/`delete` per namespace)
with two shipped adapters — **IndexedDB** (browser) and **file** (Node) — and an
in-memory adapter for tests. The kernel persists four namespaces: `identity`,
`synaptome`, `subscriptions`, and `wireVersion`. Writes are **debounced**
(~5 s) and **force-flushed on `leave()`**; on `start()` the peer reloads them
(unless the constructor supplied identity/synaptome). Axon-role/replay state is
in-memory by design and rebuilds from the network. Full shapes are in §10.

---

## 5. Identity & Cryptography: `identity/` + `pubsub/{envelope,ed25519}`

*(Realizes the planned `axona-crypto`.)*

Identity is the keypair. `deriveIdentity({lat,lng})` generates an **Ed25519**
keypair via Web Crypto (the signing key is **non-extractable**) and derives the
264-bit nodeId as `8-bit S2 geo prefix ‖ sha256(pubkey)`. Publishes are
**signed envelopes**: `buildEnvelope` canonicalises the signing input
(RFC 8785-style total ordering) and signs it; `verifyEnvelope` returns a result
object (`{ ok, reason, signed }`). Signatures are verified **at the topic's
K-closest ingress** before caching or fan-out (finding B-4), and applications
can re-verify what they consume. There is no certificate authority and no
central key registry — trust in a pubkey is the application's policy.

---

## 6. Bootstrap & Signaling: `axona-bridge` + `BootstrapService` + `peer.join()`

*(Realizes the planned `axona-bootstrap`.)*

The **bridge** is the rendezvous. It is a WebSocket broker that (a) relays
WebRTC offer/answer/ICE between browsers (`peer-list` / `peer-joined` /
`signal`), (b) runs the `axona/5` auth + version gate at connect, and (c)
embeds a **full `AxonaPeer`** so it participates in routing and pub/sub like any
node. A joining peer connects to the bridge, authenticates, receives `welcome`
(connId + server nonce) and `peer-list`, forms its WebRTC mesh, and calls
`peer.join(sponsor)` to seed its synaptome. A **QR share** encodes the current
URL (including any `?bridge=` override) so a phone lands on the same mesh.
Reconnection is peer-driven with backoff (§3.4); the bridge's identity persists
across restarts, so it returns as the same node.

Today there is **one** bridge — a deployment simplification, and the residual
centrality discussed in §16, not a protocol constraint. The detailed connect /
signal / tunnel frames are specified in **`Axona-Wire-Protocol-v0.71.md`**.

---

## 7. The Application API: `AxonaPeer`

*(Realizes the planned `axona-app` / `AxonaApp`.)*

Applications consume the kernel through `AxonaPeer` directly — there is no
separate app-framework package. The surface (signatures in the API Reference,
worked example in the **Programmer Guide §12**):

- **Pub/sub** — `pub` / `sub` with three topic-addressing modes (public,
  publisher-keyed, synthetic-regional) and a `since` replay control; soft-state
  subscriptions re-anchor every ~10 s automatically.
- **Lifecycle** — `unsub`, `kill` (creator-only retract), `unpub` (owner-only
  queue removal), `pull` (by `msgId` or latest), `metrics`.
- **Direct messaging** — `send` / `notify` / `onMessage`.
- **Mesh introspection** — `peers` / `onPeerJoin` / `onPeerLeave`.
- **Health & events** — `health` / `onLog` / `onError`.

The reference consumer is `axona-peer/src/client.js` (the axona.net app); the
minimal end-to-end example is the kernel's `examples/minimal-pubsub-browser`.

---

## 8. Infrastructure Components

- **Bridge host** — `axona-bridge` on a DigitalOcean droplet under `systemd`,
  fronted as `bridge.axona.net`; deploys by `git pull && npm ci --omit=dev &&
  systemctl restart`, with a graceful `peer-leaving` drain on `SIGTERM`.
- **TURN relay** — `coturn` at `turn.axona.net`; the bridge mints short-lived
  HMAC credentials per connecting peer (no long-lived secrets in client source).
- **Monitoring** — the bridge exposes `/healthz` (connections, admitted/pending,
  version + kernel version, embedded-peer nodeId) and `/diag` (per-connection +
  axon-role snapshot); structured JSON logs.
- **Distribution** — `axona-peer` and the demo ship via **GitHub Pages**
  (axona.net, demo.axona.net) straight from `main`; the kernel is consumed by
  git tag pin (`@axona/protocol#vX.Y.Z`); the bridge updates by redeploy.
  Clients self-report a version and the bridge enforces **flag-day floors**
  (`MIN_KERNEL_VERSION`, `MIN_PEER_APP_VERSION`) at the gate.

---

## 9. Wire Protocol

The wire format has its own living specification — **`Axona-Wire-Protocol-v0.71.md`**
(in `implementation/`) — which is authoritative; this section summarizes it.

Frames are JSON over the transport. A connection opens with the version-gate
hello and the `axona/5` authenticated hello (pubkey + signed nonce; DTLS
fingerprint on the mesh). Application traffic is then **routed** (`req`/`res`)
or **direct** (`ntf`) messages carrying a type and body. The pub/sub types
include `pubsub:subscribe-k` / `pubsub:publish-k` (replication to the K-closest
roots), `pubsub:replay-batch`, `pubsub:metricsReq-k` / `metricsBroadcast` /
`metricsResp`, and the lifecycle `pubsub:kill` / `pubsub:unpub` plus the
transport-level `peer-leaving`. Publishes carry a **signed envelope**
(`signerPubkey`, `signature`, per-publisher monotonic `seq`). `WIRE_VERSION` is
`1.0`; bridges gate on its major version.

---

## 10. State Persistence Format

The `PersistenceAdapter` stores four namespaces, each under one key:

| Namespace | Shape | Written when |
|---|---|---|
| `identity` | `IdentityEnvelope` (`id`, `pubkey`, sealed `privkey`, region, createdAt) | once, on first derive |
| `synaptome` | `[{ peerId, weight, latency, stratum, addedBy }]` | debounced on synapse add/evict |
| `subscriptions` | `[{ topic, since }]` | debounced on `sub` / `sub.stop` |
| `wireVersion` | string — the kernel build that wrote the store | on any flush |

On `start()` all four are loaded (unless the constructor supplied them); a
namespace is marked dirty on change and flushed on a ~5 s debounce, with a
force-flush on `leave()`. Axon-role/replay-cache state is **not** persisted — it
is reconstructed from the network on rejoin. For an out-of-band transfer of the
whole node state there is `snapshot()` / `AxonaPeer.fromSnapshot()`; the
per-field schema is documented in the API Reference's persistence section.

---

## 11. Development Sequence

This is the recommended build order. Each phase has explicit gates that must be passed before moving to the next.

### 11.1 Phase 0 — Foundation (Weeks 1-3)

**Goal:** Get the foundation right before building protocol logic.

**Tasks:**

- Set up TypeScript monorepo with `axona-crypto`, `axona-storage`, `axona-transport`, `axona-core`, `axona-bootstrap`, `axona-app`
- Define interfaces for ICrypto, IStorage, ITransport
- Implement WebCrypto-based crypto adapter
- Implement IndexedDB storage adapter (browser)
- Implement filesystem storage adapter (Node.js)
- Implement WebSocket transport adapter (simplest first)
- Set up testing infrastructure (Vitest, Playwright for browser tests)
- Set up CI/CD pipeline

**Validation gates:**

- All adapters have ≥80% test coverage
- Cross-platform tests pass on macOS, Linux, Windows
- Browser tests pass in Chrome, Firefox, Safari
- Node.js tests pass on Node 20

**Outcome:** Reusable plumbing that's ready for protocol logic to be built on top.

### 11.2 Phase 1 — Core Protocol (Weeks 4-7)

**Goal:** Implement the Axona protocol, isolated from production concerns.

**Tasks:**

- Implement Synapse and Synaptome data structures with all fields
- Implement vitality function and `_addByVitality`
- Implement AP routing
- Implement two-hop lookahead
- Implement iterative fallback
- Implement LTP, hop caching, triadic closure, incoming promotion, annealing
- Implement axonal tree construction and delivery
- Implement re-subscribe and replay cache
- Build a fake transport for unit testing
- Build a fake storage for unit testing

**Validation gates:**

- Unit tests cover all 12 Axona rules with their behavioral contracts
- Integration test: spawn 100 instances on a single machine using fake transport, verify routing succeeds
- Behavioral parity test: a small simulated network on the protocol library matches Axona simulator output to within 5%

**Outcome:** A correct Axona implementation that can be hooked up to real I/O.

### 11.3 Phase 2 — Real I/O (Weeks 8-11)

**Goal:** Hook the protocol up to actual network and storage.

**Tasks:**

- Implement WebRTC transport adapter with full ICE/STUN/TURN
- Implement libp2p transport adapter
- Implement iOS native crypto and storage bridge
- Implement Android native crypto and storage bridge
- Implement connection state tracking and friction handling (Issue #1)
- Implement RPC timeouts and suspicion (Issue #2)
- Implement variance-aware AP scoring (Issue #4)
- Run on real testnet (5-10 nodes on different machines)

**Validation gates:**

- 5-node real testnet sustains 99%+ lookup success over 1 hour
- WebRTC connection setup succeeds in < 5 seconds for typical NAT environments
- Synaptome state persists across restarts; no re-bootstrap needed
- Mobile (iOS) integration test: app connects, performs lookup, persists state

**Outcome:** Real network integration; the brain is talking to the body.

### 11.4 Phase 3 — Bootstrap System (Weeks 12-15)

**Goal:** Polish the join experience, including QR codes, sponsor flow, and hardcoded fallback.

**Tasks:**

- Implement QR code generation and parsing
- Implement sponsor flow and bootstrap request/response messages
- Implement hardcoded bootstrap server fallback
- Implement persisted bootstrap (resume from disk)
- Implement liveness probe in parallel
- Build first bootstrap server (deployable container)
- Deploy 3 bootstrap servers in different regions
- Implement TURN integration for WebRTC

**Validation gates:**

- QR-based bootstrap completes in < 7 seconds end-to-end on real mobile devices
- Hardcoded bootstrap completes in < 7 seconds end-to-end
- Persisted bootstrap completes in < 1 second on rejoin
- Bootstrap servers handle 100 concurrent join requests without degradation
- TURN successfully relays connections for 95% of NAT scenarios

**Outcome:** Joinable network. New users can install and connect from anywhere.

### 11.5 Phase 4 — Hardening (Weeks 16-19)

**Goal:** Address red-team Tier 1 issues for production readiness.

**Tasks:**

- Implement bandwidth saturation handling and load-aware AP scoring (Issue #3)
- Implement replay cache integrity (HMAC, signature verification)
- Implement reputation tracking and decay
- Implement asymmetric reachability tracking (Issue #8)
- Implement load-aware relay selection
- Add Vivaldi-style RTT validation as secondary check on S2 prefix (Issue #5)
- Build comprehensive observability: events → metrics → dashboards
- Build alerting rules per the operational handoff

**Validation gates:**

- Synthetic Zipf workload (α=1.0): no relay saturates beyond 80% load
- Synthetic Sybil attack (10% nodes in one cell): lookup success > 90% in that cell
- Real WebRTC measurements: latency within 30% of simulator predictions
- Observability dashboard shows all critical metrics in real-time

**Outcome:** Production-grade protocol that survives real-world adversarial conditions.

### 11.6 Phase 5 — Testnet & Staging (Weeks 20-23)

**Goal:** Validate at scale on dedicated infrastructure.

**Tasks:**

- Deploy 100-node testnet on dedicated VMs
- Deploy 1,000-node testnet
- Deploy 5,000-node staging environment
- Run 1-week soak test
- Calibrate alert thresholds
- Document operational runbooks
- Train operations team on diagnosis playbooks

**Validation gates:**

- 1K-node testnet: 99% lookup success, p95 latency < 500ms
- 5K-node staging: 99% lookup success, p95 latency < 800ms
- Pub/sub baseline delivery: 100% under no churn
- Pub/sub recovered delivery: > 95% under simulated 5% churn
- Operations team confident on dashboards and playbooks

**Outcome:** Production-validated system, ready for limited release.

### 11.7 Phase 6 — Limited Production Release (Weeks 24-25)

**Goal:** Ship to early adopters with active monitoring.

**Tasks:**

- Deploy reference application (`axona-demo`) — chat or social-style
- Open to ~500 invited users
- Monitor all Tier 1, 2, 3 metrics continuously
- Establish incident response playbook
- Daily review of operational data
- Iterate on bugs found in production

**Validation gates:**

- 24-hour soak: all critical metrics within target
- 1-week run: any issue addressed within 48 hours
- User-reported friction: collected and triaged
- Before scaling to 2K: all open issues classified and prioritized

**Outcome:** Validated production system with real users, ready for wider release.

### 11.8 Phase 7 — Scale and Refine (Weeks 26+)

Following phases follow the deployment timeline in the whitepaper §16.

---

## 12. Testing Strategy

### 12.1 Unit Tests

Each module has unit tests with ≥80% coverage. Tests run in CI on every PR.

```typescript
// Example: Vitality function
describe('vitality', () => {
  it('returns 0 for synapses with weight 0', () => {
    const s = mockSynapse({ weight: 0 });
    expect(vitality(s, Date.now())).toBe(0);
  });
  
  it('decays with recency over time', () => {
    const past = Date.now() - 7200000; // 2 hours ago
    const s = mockSynapse({
      weight: 1.0,
      lastSuccessfulUse: past,
    });
    
    expect(vitality(s, Date.now())).toBeLessThan(1.0);
    expect(vitality(s, Date.now())).toBeCloseTo(0.5, 1);
  });
  
  // ... more tests
});
```

### 12.2 Integration Tests

Run the full stack against real I/O and check end-to-end behavior:

```typescript
describe('Bootstrap and Lookup', () => {
  it('successfully bootstraps via QR code', async () => {
    // Setup: a sponsor node with 50 synapses
    const sponsor = await spawnNode({ initialSynaptome: createMock50Peers() });
    
    // New node receives QR
    const qr = await sponsor.generateInviteQR();
    
    // Newjoiner uses QR
    const newJoiner = await spawnNode();
    await newJoiner.joinViaInvite(qr.url);
    
    // Verify
    const synaptome = newJoiner.getSynaptome();
    expect(synaptome.size).toBeGreaterThan(35);  // Most peers alive
    expect(synaptome.size).toBeLessThan(51);     // Capped
    
    // Verify lookup works
    const result = await newJoiner.lookup(arbitraryPeerId);
    expect(result.success).toBe(true);
  });
});
```

### 12.3 Network Simulation Tests

Verify behavior at scale using deterministic simulators:

```typescript
describe('Slice World Recovery', () => {
  it('recovers from partition through bridge', async () => {
    // Setup: 1000 nodes split into East/West, with 1 bridge in Hawaii
    const network = await spawnNetwork({
      nodes: 1000,
      partitionStrategy: 'east-west-bridge'
    });
    
    // Run 100 lookups across partition
    const results = await Promise.all(
      Array.from({length: 100}, () =>
        network.east[0].lookup(network.west[0].id)
      )
    );
    
    // Most should succeed
    const successRate = results.filter(r => r.success).length / 100;
    expect(successRate).toBeGreaterThan(0.9);
    
    // Verify cross-hemisphere synapses formed
    const eastNode = network.east[0];
    const crossHemSynapses = eastNode.synaptome.filter(s => isWestern(s.s2Cell));
    expect(crossHemSynapses.length).toBeGreaterThan(5);
  });
});
```

### 12.4 Chaos Tests

Inject failures and verify the system handles them:

```typescript
describe('Chaos Engineering', () => {
  it('survives 25% churn', async () => {
    const network = await spawnNetwork({ nodes: 1000 });
    
    // Run baseline lookups
    const baseline = await runLookups(network, 100);
    
    // Inject 25% churn
    await network.killRandomNodes(250);
    
    // Run lookups again
    const postChurn = await runLookups(network, 100);
    
    // Should mostly succeed
    expect(postChurn.successRate).toBeGreaterThan(0.95);
    expect(postChurn.avgLatency).toBeLessThan(baseline.avgLatency * 1.5);
  });
});
```

### 12.5 Real-World Tests

End-to-end tests against real infrastructure:

```typescript
describe('Real WebRTC Bootstrap', () => {
  it('bootstraps via WebRTC over real ICE in <10 seconds', async () => {
    const sponsor = await deployBootstrapServer({
      address: 'public-test-server.example.com:8080'
    });
    
    const joiner = new AxonaApp({
      bootstrap: { servers: [sponsor.endpoint] },
    });
    
    const start = Date.now();
    await joiner.connect();
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(10000);
  });
});
```

---

## 13. Deployment Phases

The deployment timeline maps to the development phases above:


| Week  | Phase | Milestone                 | Deployment Target              |
| ----- | ----- | ------------------------- | ------------------------------ |
| 0-3   | 0     | Foundation built          | Internal dev                   |
| 4-7   | 1     | Protocol library complete | Internal dev                   |
| 8-11  | 2     | Real I/O integration      | Engineering testnet (5 nodes)  |
| 12-15 | 3     | Bootstrap system complete | Engineering testnet (50 nodes) |
| 16-19 | 4     | Hardening complete        | Open testnet (100 nodes)       |
| 20-23 | 5     | Scale validation          | Staging (5K nodes)             |
| 24-25 | 6     | Limited release           | Production (500 users)         |
| 26+   | 7     | Scaled release            | Production (5K+ users)         |


Total: 26 weeks (~6 months) from kickoff to limited production release.

---

## 14. Reference Application: `axona-demo`

To validate that the API is genuinely simple and integrable, we ship a reference application.

**Choice:** A decentralized chat application — minimum viable to exercise pub/sub, lookup, and persistence.

```typescript
// axona-demo/src/app.ts

import { AxonaApp } from '@yz-social/axona-app';

class ChatApp {
  private app: AxonaApp;
  private myUsername: string;
  
  async start() {
    this.app = new AxonaApp({
      observability: 'console',
    });
    
    await this.app.connect();
    
    // Subscribe to my own messages topic
    this.app.subscribe(`@${this.myUsername}`, (message) => {
      this.displayMessage(message);
    });
    
    // Subscribe to general
    this.app.subscribe('general', (message) => {
      this.displayMessage(message);
    });
    
    console.log(`Connected as ${this.app.getMyIdentity().nodeId}`);
  }
  
  async sendMessage(toUser: string, text: string) {
    await this.app.publish(`@${toUser}`, {
      from: this.myUsername,
      text,
      timestamp: Date.now(),
    });
  }
  
  async sendToGeneral(text: string) {
    await this.app.publish('general', {
      from: this.myUsername,
      text,
      timestamp: Date.now(),
    });
  }
  
  async generateInvite() {
    const invite = await this.app.generateInvite({ expiresIn: 3600 });
    return invite;
  }
  
  async joinViaQR(qrData: string) {
    await this.app.joinViaInvite(qrData);
  }
}
```

**This application validates:**

- The simple 6-method API works
- Lookup works
- Pub/sub publish/subscribe works
- QR code generation/parsing works
- Lifecycle events work
- Persistence across restarts works

**It is shipped to early adopters as the reference for what a real app looks like.**

---

## 15. Operational Handoff

When the protocol library is production-ready, the engineering team hands off to operations. Required artifacts:

### 15.1 Documentation

- This implementation plan (you are reading it)
- The whitepaper (architectural reference)
- The red team document (failure mode catalog)
- API documentation for `axona-app` (TypeDoc-generated)
- Internal architecture documentation
- Runbooks for each operational scenario

### 15.2 Observability

- Pre-configured Grafana dashboards
- Alert rules in Prometheus or equivalent
- Log queries for common diagnostic scenarios
- Performance baselines per environment

### 15.3 Tooling

- Bootstrap server deployment automation (Terraform or equivalent)
- TURN server deployment automation
- Synaptome inspection CLI (`axona-cli synaptome inspect <node>`)
- Performance profiling tools

### 15.4 Knowledge Transfer

- Engineering walkthrough of each module
- Operations training on diagnosis playbooks (whitepaper §13)
- Incident response simulations (chaos days)
- On-call rotation handoff with active engineering shadowing for first 4 weeks

---

## 16. Future Directions

These sit inside the existing seams — the wire format, addressing discipline,
and K-closest pub/sub semantics are stable. They mirror the **Axona
Architecture Note (§14, v0.7.5)**; see that document for the detailed
rationale.

- **Federated bridges.** Multiple bridges across regions, gossiping
peer-lists so a peer connected to one is reachable from another. Single-bridge
today is a deployment simplification, not a protocol constraint.

- **Demote the bridge to an ordinary peer.** The routing and pub/sub layers
already treat a bridge as just another nodeId — no `isBridge` flag, no
eviction exemption, no routing privilege. Its present dominance is *emergent*:
every peer dials it first (so it lands in every synaptome) and its `0x89`
geo-identity sits XOR-close to every `us-east/*` topic, so the ordinary
K-closest and vitality rules keep selecting it as a root. The only residual
special status is at the bootstrap layer — peers hold the bridge socket open
and auto-readmit it on every reconnect, so it never leaves the routing table.
Once federated bridges exist, and once a peer holds enough healthy mesh peers,
it should **drop the bridge from routing and root candidacy** (keeping the
socket for signaling only) and stop auto-readmitting its nodeId — dissolving
the *correlated* failure mode in which one bridge restart removes a root from
nearly every topic at once. Validate convergence and churn in `dht-sim`
before shipping.

- **Bridge directory.** A well-known public topic where each bridge
republishes itself hourly (URL, region, kernel version, advertised TURN
credentials, last-seen), gated by an allowed-signer set anchored to genesis
bridge keys, so a peer whose primary bridge disappears has alternates to try
without out-of-band coordination.

- **Capability hardening (Endo / SES).** Adopt the Agoric/MetaMask
object-capability stack (lockdown, Compartments, `codeHash`) to harden the
host-side surface and make a node's kernel-version claim falsifiable.

- **Behavioral node attestation.** Detect failing or malicious nodes (the
"broken-but-authentic" failure mode that motivated graceful shutdown) via
round-trip probes feeding the vitality function, and route around them. No
browser TEE exists for remote cryptographic attestation, so this is
*behavioral*, not certificate-based.

- **Latency-coordinate seed (research).** Replace or augment the static S2
geo-prefix seed with a learned RTT-coordinate embedding (Vivaldi-style); see
the *Axona vs. Vivaldi* design note.

- **Proof-of-location (research).** Anchor a claimed geo-prefix to measurable
physical reality (verifiable RTT triangulation or attestation) to resist
prefix-grinding.

Open security items are tracked in the consolidated red-team punch list;
resolved items are summarized in `SECURITY-CHANGELOG.md`.

---

## Summary

This implementation plan describes a complete production Axona system in seven layers: Crypto → Storage → Transport → Bootstrap → Core → App → Application. Each layer has clean interfaces, multiple adapter implementations for different platforms, and is independently testable.

**The development sequence** is 26 weeks across 8 phases. Each phase has explicit validation gates that must be passed before moving forward. The reference application (`axona-demo`) validates the integration surface throughout development.

**The infrastructure** consists of 3 hardcoded bootstrap servers, regional TURN relays, and observability backends. All are off-the-shelf or trivially custom.

**The integration surface** is intentionally minimal: 6 methods on a single class. Application developers don't need to understand the protocol internals; they just call `connect()`, `publish()`, `subscribe()`, `lookup()`, and `disconnect()`.

The result, when complete, is a system where:

- A new user can install the app, scan a QR code, and be functional in 7 seconds
- A returning user can resume in 1 second
- Pub/sub messages reliably reach all subscribers, even under churn
- Bootstrap survives bootstrap server failures (3 redundant + persisted state)
- The protocol learns and adapts as it runs
- Operations can diagnose and respond to issues with documented playbooks

The brain is the algorithm. The body is everything in this document. Together, they ship Axona.

---

## References

- Axona Whitepaper v0.3.58 (`whitepaper/Axona-Whitepaper.md`)
- Axona Architecture Note v0.7.5 (`architecture/Axona-Architecture.tex`)
- Axona Programmer Guide v2.14.0 + API Reference (`programmer-guide/`)
- Red Team Analysis v0.3.38 — historical, retains its original name (`red team/N-DHT-RedTeam-v0.3.38.md`)
- Research Deck (`presentation/deck.md`)
- Source: `github.com/axona-net` — `axona-protocol` (kernel), `axona-peer`, `axona-bridge`, `dht-sim`

---

*End of implementation plan. Total length ≈ 90 pages typeset.*

*Suggested next steps for the engineering team:*

1. *Review and align on architectural decisions in §1-7*
2. *Establish team structure and assign module ownership*
3. *Begin Phase 0: Foundation (week 1-3) work*
4. *Schedule Phase 1 design review at end of week 3*

