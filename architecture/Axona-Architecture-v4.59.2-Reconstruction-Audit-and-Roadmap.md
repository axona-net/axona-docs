# Axona Architecture v4.59.2: Reconstruction Audit and Improvement Roadmap

## Verdict

**No — not yet as an interoperable protocol specification.** The draft is an unusually effective architectural explanation and captures much of the v4.59.2 design intent. It would let an experienced engineer reconstruct a recognizably Axona-like system: separate transport and author identities, region-addressed topics, an emergent root, axon-tree fan-out, renewal-based repair, cohort replication, and graceful handoff.

It does **not** yet let an independent implementer reconstruct a peer that can safely and deterministically interoperate with the current implementation. The blocker is not mostly missing prose; it is missing or inaccurate normative contract material: byte-level framing, complete schemas, authentication transcripts, exact routing and lookup behavior, validation/error semantics, and a few important claims that conflict with the code.

The most productive reframing is: retain this document as the architecture and rationale, but add a companion **Normative Protocol Specification** generated or checked against the implementation. The architecture document should link to that specification rather than claiming that prose and selected tables alone are sufficient for reconstruction.

## Scope and method

This audit compares:

- Draft: [Axona-Architecture-DRAFT-v4.59.2.md](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md), SHA-256 `04fbfbb34091b04c62661a6b4ef606ba986d755c9aca1bcf381b3b79276aa017`.
- Kernel: `@axona/protocol` commit `30664923e84419ce81c9b281b7dd7de63fd1e16d` (`v4.59.2`).
- Bridge: commit `86493ea4870cfd92abc90cadfacccbed584cd0e3`, package `2.105.1`, pinned to protocol v4.59.2.
- Relay: commit `b36d7a23531f17a6728122095da2356c12e4f62f`.

I read the draft in full, traced the kernel’s identity, envelope, routing, transport, pub/sub, lifecycle, persistence, and public API code, and checked the bridge integration boundary. I also ran the kernel’s default `npm test` suite; it completed successfully. Passing that suite confirms the checked source baseline, not that the document is sufficient for clean-room interoperability.

Finding labels:

- **Inaccurate** — conflicts with the current implementation.
- **Incomplete** — omits information required to implement or interoperate.
- **Contradictory** — conflicts with another part of the draft.
- **Known divergence** — code itself identifies unfinished or bypassed behavior; the document must disclose it or narrow its guarantee.

## What the draft already does well

The following are strong and should be preserved:

- The separation of node/transport identity from author/content identity, topic placement, owner-write policy, root repair, anti-entropy, and bounded-state rationale is unusually clear.
- The lifecycle, repair, and root-management sections explain *why* mechanisms exist, which is valuable design context that a pure wire specification would lose.
- The constants, policy tables, and failure narratives provide an excellent starting point for normative state-machine sections.
- The draft correctly makes convergence and durability conditional rather than pretending to offer consensus or partition-free linearizability.

The recommended change is therefore additive and corrective, not a rewrite of the narrative.

## Reconstruction-critical findings

| Priority | Classification | Draft claim / location | Code evidence | Why it blocks reconstruction | Required correction |
|---|---|---|---|---|---|
| P0 | Inaccurate + incomplete | The routed frame is `{target, type, payload, fromId, hopBudget}` and handlers run at the terminal ([draft:184](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:184)). | The actual `route_msg` wire object is `{type, payload, targetId, hops, originId}`; every hop invokes the handler before deciding whether to forward ([AxonaPeer.js:630](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:630), [AxonaPeer.js:663](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:663), [AxonaPeer.js:691](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:691)). | A conforming-looking reimplementation would emit the wrong keys and put dispatch in the wrong place. | Publish the exact routed request, reply verdict, local handler metadata, hop limit, malformed-frame behavior, and forwarding order. |
| P0 | Incomplete | The type table is called normative and says payload schemas appear later ([draft:186](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:186)). | The kernel has a distinct `pubsub:pullresp` routed type missing from the table ([constants.js:344](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/constants.js:344)); handlers require additional fields such as `corrId`, `requesterId`, `json`, stamped message records, and handoff held/sent counters. | Most frames cannot be constructed or validated from the draft. Optionality, cardinality, caps, defaults, and reply/error forms are also unknown. | Add a complete wire registry: one entry per frame, exact schema, encoding, required/optional fields, cap, receiver validation, return verdict, and compatibility status. |
| P0 | Inaccurate | A claimed node ID “must equal `regionByte || SHA-256(pubkey)`” for the proven key ([draft:162](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:162)). | Authentication intentionally verifies only the low 256-bit hash suffix; the geographic byte is explicitly unauthenticated ([handshake-auth.js:31](/Users/croqueteer/Documents/claude/axona-protocol/src/transport/handshake-auth.js:31), [handshake-auth.js:150](/Users/croqueteer/Documents/claude/axona-protocol/src/transport/handshake-auth.js:150)). | This changes the security and placement threat model. An implementer following the text would reject peers that the deployed network accepts, or make a false location-authentication promise. | State explicitly that the region byte is a selectable routing/placement hint, not an attested location. Specify the accepted node-ID predicate and the consequences for Sybil/region concentration. |
| P0 | Inaccurate | Receivers enforce both timestamp skew and per-publisher sequence monotonicity at live ingress ([draft:134](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:134); repeated in Security). | Root ingress verifies envelope and timestamp freshness, then deduplicates by `msgId`; it does not maintain or compare a per-author sequence high-water ([wireHandlers.js:302](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/wireHandlers.js:302)-[wireHandlers.js:317](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/wireHandlers.js:317)). | The advertised replay guarantee cannot be reproduced from the actual behavior. | Either implement and test a per-author high-water rule, or specify the actual guarantee: signed timestamp window plus topic-local message-ID deduplication. |
| P0 | Inaccurate | A PUB has no return address for publisher-location privacy ([draft:264](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:264)). | Every routed `route_msg` carries `originId` ([AxonaPeer.js:3994](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:3994)), and the request/response route yields a delivery verdict. The signed envelope omits node ID, but its routing wrapper does not. | The security and privacy claim is overbroad; an interoperable peer must carry the origin field. | Distinguish envelope privacy from routing-metadata privacy. State which peers can observe `originId`, what it reveals, the retention rule, and why that is or is not acceptable. |
| P0 | Known divergence | The draft presents observation-confirmation and graceful draining as settled behavior ([draft:262](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:262)-[draft:264](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:264)). | The source marks a known unresolved bypass: local delivery to a self-subscribed publisher confirms pending publish before the durability gate observes cohort evidence ([wireHandlers.js:336](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/wireHandlers.js:336)-[wireHandlers.js:351](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/wireHandlers.js:351)). | This affects the precise meaning of confirmation and can let `leave()` regard a publish as drained before durable replication evidence. | Add a “known implementation deviations” box now; do not present the durable-observation property as an unconditional v4.59.2 guarantee until fixed and fenced. |
| P1 | Incomplete | `axona/5` is described, but no actual transcript or exchange is specified ([draft:160](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:160)). | Auth proof carries `{proto,nodeId,pubkey,sig,pow}` and signs canonical `{proto,nodeId,pubkey,cbv}` ([handshake-auth.js:77](/Users/croqueteer/Documents/claude/axona-protocol/src/transport/handshake-auth.js:77)-[handshake-auth.js:116](/Users/croqueteer/Documents/claude/axona-protocol/src/transport/handshake-auth.js:116)); WebRTC also has nonce and `hello-sig` sequencing. | A reader cannot authenticate a peer or build a bridge/web client that joins the mesh. | Specify all hello/nonce/proof frames, CBV derivation per transport, timeout/close behavior, duplicate-channel rule, exact literal protocol and domain tags, and PoW activation semantics. |
| P1 | Incomplete | “All frames are JSON” ([draft:184](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:184)). | The shared codec serializes BigInts as decimal strings suffixed by `n` and Sets as arrays ([wire.js:1](/Users/croqueteer/Documents/claude/axona-protocol/src/transport/wire.js:1)). | Plain JSON is insufficient to reproduce routing and lookup frames. | Specify the JSON codec/reviver, which fields use it, and rejection behavior for ambiguous strings. |
| P1 | Incomplete / misleading | `canonical()` is “RFC-8785-style” ([draft:132](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:132)). | The deployed function is custom recursive key sorting with JavaScript `JSON.stringify` value semantics, including omitted object values and coerced array/non-finite values ([post.js:47](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/post.js:47)-[post.js:100](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/post.js:100)). | “Style” is not enough to reproduce signature/hash bytes, and it risks a different JCS implementation. | Give normative pseudocode or name an exact standard only after adopting it; include UTF-8, numeric, escaping, unsupported-value, and golden-vector rules. |
| P1 | Inaccurate | Identical reposts “dedup network-wide” ([draft:128](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:128)). | Ingress dedup is `role.cacheIds` plus that role’s tombstones ([wireHandlers.js:316](/Users/croqueteer/Documents/claude/axona-protocol/src/pubsub/wireHandlers.js:316)); it is topic/role/retention scoped. | It overstates the dedup domain and hides behavior for the same body across topics or after expiry. | Say “topic-local, retained-state dedup by `msgId`” and define expiry/republication semantics. |
| P1 | Incomplete / inaccurate | `findKClosest` and `lookup` are described as one classic alpha-parallel primitive ([draft:147](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:147)). | `findKClosest` is alpha-parallel (`alpha=3`, `maxRounds=40`) ([AxonaPeer.js:3863](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:3863)); public `lookup()` drives a distinct recursive `lookup_step` process with routing-learning side effects ([AxonaPeer.js:1554](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:1554)). | An implementer cannot know which search feeds root hints, verification, or routing-table mutation. | Split the two algorithms; publish inputs, outputs, stopping rules, side effects, and call sites. |
| P1 | Incomplete | Greedy routing is described as terminal on no one-hop improvement ([draft:144](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:144)). | Routing tries `_findCloserInTwoHops` before declaring terminal ([AxonaPeer.js:3954](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:3954)-[AxonaPeer.js:3961](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:3961)); the limit is `MAX_HOPS=40`. | Terminal selection is protocol-critical because it creates roots. | Include two-hop escape, lazy connection opening, bridge exclusion, 40-hop exhaustion result, and tie/failed-send behavior. |
| P1 | Contradictory | I-1 says exactly one root ([draft:416](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:416)); later the draft permits two transient roots ([draft:477](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:477)). | The implementation is convergence-based, not a distributed mutual-exclusion algorithm. | A clean-room implementer cannot tell whether duplicate roots are forbidden safety failures or expected temporary states. | Replace I-1 with an eventual/convergence property containing assumptions, bounds, and partition qualifications. |
| P1 | Inaccurate | After partition healing, per-publisher `seq` lets readers order interleaved histories ([draft:481](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:481)). | Delivery overwrites the envelope’s publisher sequence and timestamp with root-assigned per-topic values ([AxonaPeer.js:3165](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:3165)-[AxonaPeer.js:3174](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:3174)). | The claimed ordering mechanism is unavailable to applications and duplicate roots can create colliding root sequences. | Specify the actual merge/order contract, including ties and duplicate-root histories; do not claim a total order across a partition unless implemented. |
| P2 | Incomplete | The API list treats `connect()` and `fromSnapshot()` as `AxonaPeer` methods and gives abbreviated pub/sub signatures ([draft:512](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:512)). | `connect()` is a module factory ([connect.js:1](/Users/croqueteer/Documents/claude/axona-protocol/src/connect.js:1)); `sub(topic, handler, opts)` requires a handler ([AxonaPeer.js:1950](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:1950)); `pull(msgId, {topic,...})` has different argument order ([AxonaPeer.js:2282](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:2282)); `fromSnapshot` is static ([AxonaPeer.js:1453](/Users/croqueteer/Documents/claude/axona-protocol/src/dht/AxonaPeer.js:1453)). | A reader cannot use the reference API from the stated contract. | Move public API to a versioned reference appendix with complete signatures, return/error shapes, static/module ownership, and examples that execute. |
| P2 | Contradictory | The draft enumerates fourteen invariants ([draft:416](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:416)-[draft:443](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:443)), but the reconstruction guide instructs the reader to write eleven ([draft:545](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md:545)). | Internal document inconsistency. | It undermines the claimed normative acceptance test. | Correct the count and give each invariant a stable ID, precise quantifiers, preconditions, and linked executable test/vector. |

## Additional gaps to close

These are not necessarily false statements, but a clean-room peer needs them:

- Full stamped-message, tombstone, `DELIVER`, `ADOPT`, `PULLUP`, `REPLAYUP`, `HANDOFF`, `HANDOFFACK`, `REPLICATE`, `ROOTBEACON`, `METRICSON`, `PULL`, and `PULLRESP` schemas. Include the fields that identify the received batch and the exact validation/drop result.
- The authoritative state model: which state is durable, which is soft, initialization/default values, ownership, eviction, and recovery after restart. The prose names fields, but it does not define serializable representation or atomicity boundaries.
- Version negotiation and compatibility matrix: `WIRE_VERSION`, `AUTH_PROTO`, `KERNEL_VERSION`, bridge gate, close codes, and which changes require a wire-major bump.
- Exact cap enforcement. The prose claims universal input caps; the inspected subscription sender truncates outbound `via`, while the routed handler does not visibly reject an oversized inbound `via`. Clarify whether that is intentional, add an ingress rule if required, and fence it.
- Normative status of code comments that call features “TODO,” “thin,” “temporary,” or “known defect.” The document should differentiate deployed behavior, intended behavior, and planned behavior.
- Bridge/bootstrap and mesh-relayed signaling schemas. These are required to reconstruct a browser or bridge-connected peer even if the kernel core is transport-abstract.
- Persistence compatibility: snapshot envelope, namespaces, freshness of restored node identity, subscription-handler non-persistence, and recovery sequencing.

## Recommended document architecture

Keep the current readable architecture note, but divide the published contract into four artifacts:

1. **Architecture and rationale** — this document’s strongest material: intent, trade-offs, incidents, operational advice, and diagrams.
2. **Normative Protocol Specification** — precise wire, crypto, routing, state-machine, timing, and error contract. It must use RFC 2119/8174 language and stable section/field identifiers.
3. **API and deployment reference** — public JavaScript API, bridge bootstrap, relay behavior, persistence, health/metrics, and operational compatibility.
4. **Conformance suite and vectors** — machine-readable fixtures that every independent implementation must pass.

The architecture note should say that it is explanatory where it is explanatory. It should only use “normative” for material whose field names, defaults, and failure behavior are fully specified and tested.

## Roadmap

### Phase 0 — Establish a trustworthy baseline

- Put the source commit, package version, document hash, and target network profile at the top of every release.
- Add a short “implemented / intended / known deviation” table. Include the self-subscribed publish-confirmation bypass until resolved.
- Replace absolute claims with conditional guarantees where appropriate: eventual root convergence, retention-bounded deduplication, and durability conditioned on confirmed handoff/cohort evidence.
- Fix internal contradictions: I-1, fourteen versus eleven invariants, and the privacy claim around routed `originId`.

**Exit criterion:** a reviewer can identify the exact binary/source behavior described and can distinguish it from planned behavior.

### Phase 1 — Specify the bytes and cryptography

- Define JSON encoding, BigInt/Set conversion, wire field casing, canonical hex rules, and maximum frame sizes.
- Publish one machine-readable schema per request, notification, routed message, and reply/verdict; include `pubsub:pullresp`.
- Define canonicalization as executable pseudocode or an adopted standard, with test vectors for special numerics, Unicode, omitted values, nested objects, and signatures.
- Specify literal domain tags, Ed25519 representation, hash input bytes, auth proof fields, nonce/CBV derivation, DTLS fingerprint composition, PoW fields, and verification failure codes.
- Correct the node identity section to state that the geographic byte is not cryptographically bound.

**Exit criterion:** a separate implementation can produce and verify golden envelope, kill, auth, `route_msg`, and pub/sub frames byte-for-byte.

### Phase 2 — Specify routing and root convergence as state machines

- Give separate algorithms for `routeMessage`, `findKClosest`, and `lookup`, including bridge exclusion, direct versus incoming synapses, two-hop escape, lazy open, hop exhaustion, alpha/max-round defaults, and learning side effects.
- Define handler execution at every hop and terminal semantics through `meta.isTerminal`, not merely as “handler at terminal.”
- Turn root-claim behavior into an explicit transition table with input evidence, guards, output state mutations, emitted messages, timeout, and idempotency rule.
- State eventual-convergence assumptions, partition behavior, and what data/order conflict resolution actually guarantees.

**Exit criterion:** a model/differential test exercises the same route verdict and root transitions as the reference kernel on fixed topologies.

### Phase 3 — Complete pub/sub, durability, and failure semantics

- Add schemas and receiver pseudocode for every pub/sub verb and stamped record.
- Define deduplication scope, cache/tombstone expiry, kill-before-publish behavior, replay filters, response correlation, and the three pull outcomes.
- Reconcile publisher `seq`, root-assigned `seq`, and delivered `seq`; either implement author-sequence replay protection or remove the claim.
- Define the acknowledgement/observation/durability boundary and resolve the known self-delivery bypass before advertising a durable-drain guarantee.
- Audit all inbound caps and make `MAX_VIA`/any hop-leg budget enforceable, documented, and tested.

**Exit criterion:** a clean-room node can pass churn, root death, kill race, replay, handoff, and malformed-frame conformance tests without source access.

### Phase 4 — Make integration contracts explicit

- Move the exact `AxonaPeer` API into a generated reference: signatures, ownership, values, errors, cancellation, and examples.
- Specify `connect()` separately as a factory, and `AxonaPeer.fromSnapshot()` as a static restoration operation.
- Document bridge hello/welcome/signaling/graduation/directory contracts and which elements are protocol versus deployment policy.
- Document persistence and the browser/Node/simulator profile differences.

**Exit criterion:** a third party can write a browser client, a Node relay, and a bridge-adjacent test client from the documents alone.

### Phase 5 — Make “reconstructable” measurable

- Ship test vectors for every identifier, signature, auth transcript, and canonical form.
- Ship golden frame fixtures and negative fixtures for every schema/error reason.
- Run a black-box interoperability suite against the current kernel over sim and a real WebRTC/WebSocket path.
- Add trace-based differential tests: same topology and inputs must yield the same route verdicts, root transitions, and normalized topic state.
- Gate a protocol-document release on the conformance suite, not only on source tests.

**Definition of done:** an independently written implementation, using only the published specification and vectors, can join a v4.59.2 network, authenticate, route, publish, subscribe, replay, kill, pull, hand off, and survive prescribed churn scenarios without consulting the reference source.

## Suggested editorial changes to the current draft

1. Change the headline reconstruction claim from “contains everything needed” to “contains the architectural model; the normative protocol companion is required for interoperable reconstruction” until Phases 1–5 are complete.
2. Replace the wire section with a short overview plus a link to the generated frame registry; do not compress schemas into prose.
3. Add a “Security boundaries” box immediately after node identity: geo prefix is not attested; envelope privacy differs from routing metadata privacy.
4. Add a “Guarantee status” box to publish confirmation and durability, including the known v4.59.2 self-delivery bypass.
5. Make every invariant a precise testable property with its code/test identifier; do not label an eventual property as an exact safety invariant.
6. Put all literal strings and defaults in one appendix: domain tags, protocol versions, close codes, message type names, field names, caps, and timers.

