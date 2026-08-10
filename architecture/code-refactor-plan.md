# Axona Kernel Refactor — Master Plan

**File:** `axona-docs/architecture/code-refactor-plan.md`
**Version:** v3.2 — 2026-08-09, Phase 0 ownership-map findings incorporated
**Collator:** axona.bot (chief programmer), by unanimous council vote, David's designation (#council, 2026-08-07)
**Sources:** `axona.bot-Redesign-Plan.md`, `Aster-Protocol-Refactor-Plan.md`, `Orion-Redesign-Plan.md`, `code-refactor-plan-draft-orion.md`, the council cross-review thread (#council seq 381–392), `axona-refactor-triumvirate-readiness-review-v0.1.md` (Aster, 2026-08-08), the readiness Q&A record (#council seq 458–462), `Write-Flight-Ack-Routing-v0.9.md`, the released D1 slice (protocol `fb3ea39`, docs `cdb7303`), `Axona-Pubsub-Architecture-Alternatives-v0.1.md`, `Axona-Leaderless-Per-Author-Pubsub-Design-v0.1.md`, axona.bot's code-grounded review and correction (#council seq 558, 564–565), `Refactor-Phase0-Inventory-v0.1.md`, `Refactor-Phase0-OwnershipMap-v0.1.md` (#council seq 568), and Orion's structural audit (#council seq 561)
**Status:** PHASE 0 LIVING PLAN v3.2 — REF-0.1 complete; REF-0.3 landed for council review; no deploy or behavior change authorized
**Scope:** the kernel, `axona-protocol/src`. Relay, bridge, and apps are consumers of the kernel and are touched only where a phase's canary requires them.

**What v3 adds.** v2 made the plan ready to replace one root authority with a
triumvirate timekeeper. Two facts now supersede that target. First, kernel
4.62.2 shipped D1: a byte-exact signed INGEST-ACK proof routes across multiple
hops to its flight owner, with an authenticated, channel-fresh capability
oracle and conformance vectors. Second, David accepted the semantic premise
that per-author order plus deterministic convergence is sufficient, making
the intended post-refactor architecture leaderless rather than
timekeeper-based. This revision treats D1 as protected baseline and changes
the target seams so they do not require any write authority, root stamp,
scalar replay cursor, fixed replica count, or singly rooted delivery forest.
It still changes NO current behavior, NO wire format, and NO public API. Kernel
4 behavior survives behind explicit legacy adapters; the leaderless wire is a
separately authorized Kernel 5 project.

---

## 0. The question this plan answers

How do we restructure the kernel so that every rule is owned in exactly one
place, symmetrical where symmetry is real, and impossible to reach from two
paths at once — without losing the incident knowledge the current code paid
for?

What this plan is not. It is not a rewrite: a rewrite would re-derive, by
future outage, the rules the code already encodes. It is not file-size
reduction: the earlier refactor pass made some files larger while making the
system more correct, and that trade was right. It is not a new framework: the
target patterns already exist in the kernel as working seams, and the work is
to make their discipline universal. It is not the triumvirate and it is not
the leaderless implementation: no cohort membership, no timekeeper election,
no author-lane wire, no adaptive retention certificates, and no new delivery
DAG frames ship with this refactor. The refactor prepares profile-neutral
interfaces and keeps the shipping singleton-root profile byte-compatible.

The failure mode to fear is a clean diagram that silently drops the
leave-order fix, the handoff-liveness gate, the split-history union, or the
write-flight ack binding. Each of those cost a diagnosed production incident
to learn. The plan below is built so that losing one of them fails a test, not
a user.

---

## 1. The system, for a reader who has never seen it

Axona is a peer-to-peer commons: browsers and Node processes form a mesh with
no owner, place data by content address, and deliver publish/subscribe traffic
without a server in the data path. The kernel is one JavaScript package,
`@axona/protocol`, consumed verbatim by every node.

The pieces a newcomer needs, in the order a packet meets them:

- **Identity.** Two keypairs per participant. The *transport* identity is
  ephemeral and mints a fresh 264-bit node address every restart (a durable
  node id would be a correlator, so persistence of it is forbidden —
  invariant I-15). The *author* identity signs published content and MAY
  persist. Addresses carry an S2 geographic prefix, so keyspace distance
  correlates with physical distance.
- **Transports.** `transport/web` is the production stack: a WebSocket to a
  bridge for bootstrap and signalling, then authenticated WebRTC data channels
  peer-to-peer. The bridge is bootstrap-only; two peers keep working after the
  bridge process dies (proven live on 4.17.2). `transport/node` serves
  server-side relays; `transport/sim` drives the deterministic simulator.
- **Routing.** Each node is a `NeuronNode` holding a `synaptome` — a bounded
  table of live, authenticated connections ("synapses") that rewires under
  traffic, greedy-routes toward keyspace targets, and escapes local minima
  with an α-parallel K-closest lookup.
- **Pub/sub.** A topic hashes to an address; the node closest to that address
  becomes the topic's ROOT and anchors a dendritic fan-out tree of CHILD
  subscribers, with BACKUP replicas in the K-closest cohort. A topic's history
  is a *stamped set*: cache entries totally ordered by root stamps, plus
  tombstones. All repair is convergence of stamped sets between two nodes.
  Since 4.62.0, a root carries an *incarnation* — (nodeId, epoch) — and a
  write completes only on bound INGEST evidence. Since 4.62.2 D1, a root signs
  a fixed-transcript INGEST-ACK proof and routes it end-to-end to the write
  flight owner; completion binds the proof to the root transport key,
  authority incarnation, topic, message, operation, attempt, destination, and
  flight nonce rather than trusting the proof's last routing hop. Legacy
  unsigned one-hop acks remain an additive compatibility path. A root that
  cannot produce bound evidence within the flight budget is convicted,
  tombstoned, and succeeded. D1 fixes the multi-hop deaf-flight defect; the
  author↔transport correlator and unbounded promotion chain remain governed
  exceptions for later D0/D2 work.
- **Where code lives.** Nine top-level modules under `src/` — `contracts`,
  `crypto`, `dht`, `identity`, `persistence`, `pow`, `pubsub`, `transport`,
  `utils` — 23,559 lines total (measured 2026-08-09, `wc -l` over
  `src/**/*.js`, kernel v4.62.2 at `fb3ea39`).

## 2. The problem, measured

The nine-module split is sound. The debt sits in two god-objects and one
asymmetric dispatch surface; nothing else in the tree is structurally alarming.
Line counts below were measured 2026-08-09 at kernel v4.62.2 (`fb3ea39`):

| Surface | Lines | What it wrongly owns |
|---|---|---|
| `dht/AxonaPeer.js` | 4,440 | lifecycle, join/integrate, persistence, the public pub/sub API, direct messaging, greedy routing, lookup, relay maintenance, metrics, eventing |
| `pubsub/repairPlane.js` | 1,223 | repair triggers, retries, and emissions |
| `pubsub/AxonaManager.js` | 1,165 | topic state, election, wire handling, sync, D1 capability selection seam |
| `pubsub/wireHandlers.js` | 1,046 | frame registration and D1 dual-form ack handling without a single contract |

The pub/sub trio totals 3,434 lines and is prototype-composed, so ownership
and precedence cannot be read from any one file. The rest of the tree —
transports included — is heavy in places but coherent: one file, one concern.
`pubsub/writeFlight.js` (310 lines, new in 4.62.x) is a younger example of the
coherent form: one bounded state record per flight, one sweep, no timers.
`pubsub/ackProof.js` (260 lines) and `pubsub/capAttest.js` (151 lines) add the
D1 pattern the registries must preserve: one byte-exact transcript builder,
strict pre-signature width checks, domain-separated proof classes, golden and
rejection vectors, and capability state bound to one authenticated live
channel.

The pressure shows up in five recurring forms (Aster's diagnosis, which the
other two assessments confirmed):

1. **Overlapping decision sites.** Admission, placement, repair, replay, and
   cleanup can each be reached from more than one lifecycle or handler path.
2. **State and capability conflation.** Placement (who anchors the tree) is
   discussed alongside retention (who holds data), though they are separate.
3. **Unnormalized wire policy.** Schemas, versions, admission guards,
   idempotency, correlation, and observability are not one inspectable
   contract per frame.
4. **Effects tangled with decisions.** A decision can send, mutate, arm timers,
   and emit events without one recorded transition outcome.
5. **Specification drift.** Prose described intent while code carried the
   interoperable truth; duplicate invariant catalogues have already caused a
   documented confusion (two INVARIANTS.md files, folded into one in §XII).

The readiness review adds a sixth form, prospective rather than measured:
**singleton-root coupling presented as timeless architecture.** Today one node
is at once the serving anchor, stamp authority, beacon authority, write
verifier, cache holder, replica principal, forest root, and replay service.
That is an accurate description of the negotiated protocol. It is not a safe
target abstraction, because the triumvirate design separates exactly these
duties and the accepted leaderless target removes the authority equivalence
altogether. The refactor must stop it from hardening into permanent
interfaces.

### 2.1 The incident ledger — the rules the refactor must not lose

Every entry below was a production or testnet incident with a diagnosed root
cause. Each teaches a structural rule. The refactor's job is to make these
rules legible and enforced in one place; re-deriving any of them by outage is
the definition of failure for this project.

| Incident | Root cause | Structural rule it teaches |
|---|---|---|
| GH #333 backbone collapse | bulk role ingest on join blocked the event loop → mass eviction | work on a control path is bounded, always |
| leave-order (fixed 4.32.0) | notify-before-handoff killed every leave handoff | ordering of effects is load-bearing and must be explicit |
| handoff-liveness (fixed 4.31) | a departing node planted standing state on a peer that could not maintain it | the Principal-Liveness law (§4.6) |
| split-history cold-attach (fixed 4.22.0) | two individually-correct replay paths, neither seeing the other's half | one owner per data-movement decision |
| TURN expiry, GH #44 (fixed 4.60.x) | credential refresh existed only on a path that a healthy node never took | every lifecycle has an in-band renewal path |
| write blackhole, GH #28/#422 (fixed 4.62.x) | a half-alive root accepted every write and ingested none; `consumed` routing verdicts stood in for ingestion — 2h06m strand on tape | routing evidence is not ingestion evidence; a write completes on a bound INGEST-ack or the authority is convicted (§4.3 evidence hierarchy) |
| ack forgery scope, Aster seq 439 (fixed 4.62.1) | any holder's valid ack for (topic, msgId, op) could settle a flight opened against a different suspect | completion evidence binds the authenticated sender AND the authority incarnation |
| multi-hop deaf flight, GH #51/#446 (fixed 4.62.2 D1) | the root returned an unsigned ack to the last routing hop, while the flight lived at an earlier node; the proof was dropped and healthy roots were repeatedly evicted | evidence return routing is part of the evidence contract; a multi-hop proof is signed end-to-end, addressed to the flight owner, bound to its exact attempt and nonce, and verified independently of the last hop |

The #28/#422 and #51/#446 families are **protected regression families**.
Their ledger includes the 4.62.1 source/incarnation binding and the released
4.62.2 D1 slice (`fb3ea39`): fixed 197-byte INGEST-ACK transcript; 33-byte
topic/node ids in every keyspace profile; 32-byte message/root-key fields;
16-byte attempt and flight nonce; safe-integer JavaScript subset of a u64
epoch wire field; purpose-separated ACK/NACK/probe proofs; multi-hop
completion independent of `meta.fromId`; channel-bound `CAP_ATTEST`; unknown-
frame compatibility; and the checked-in golden/rejection/profile vectors.
Production go-live completed without the eviction storm and passed a live
write→read check. The reliability ledger must still distinguish shipped D1
from pending D0 delegation and D2 terminal chain bounds; neither governed
exception may be marked closed by association.

The common shape: individually-correct mechanisms interacting through a second
entry path. The target is fewer places a decision can be made, not fewer lines.

## 3. What already exists — extend, do not rebuild

Three consolidations shipped in production or on testnet today. They are the
exemplars David's directive points at, and any plan that schedules "building"
them is scheduling the reconstruction of working code:

- **`pubsub/rootClaim.js` (393 lines)** — the single transition authority for
  root placement. Every flip of `role.isRoot` passes through one `_set()` with
  one structured log per flip, and since 4.62.0 every claim mints an
  incarnation epoch at the same site.
- **`pubsub/syncEngine.js` (233 lines)** — a frozen, typed policy table already
  owning seven repair verbs: `REPLAY_UP`, `SPLIT_UNION`, `EMPTY_ROOT_PROBE`,
  `COHORT_REPLICATE`, `UNION_AT_ROOT`, `HANDOFF`, `PUB_DURABLE` — each row
  carrying mode, verb, ledger, and rate bound.
- **`pubsub/writeFlight.js` (310 lines, 4.62.x)** — one bounded record per
  write flight, swept from the shared refresh tick. Its 4.62.1 compatibility
  path completes only on sender-and-incarnation-bound evidence; its 4.62.2 D1
  path completes on a verified proof bound to root key, authority
  incarnation, attempt id, `ackTo`, and flight nonce, regardless of the final
  routing hop. This is the scheduler and evidence discipline of §4.3 and
  §4.8, already shipped and live-gated.
- **`pubsub/ackProof.js` + `pubsub/capAttest.js` (411 lines, 4.62.2 D1)** —
  pure cryptographic contract modules with fixed transcripts, strict decoding,
  domain separation, locally derived channel freshness, and independently
  reproducible conformance vectors. Their builders and verifiers remain pure
  owners after handler extraction; registries call them rather than rebuilding
  signed bytes.

The organizing rule they demonstrate, which this plan applies everywhere:

> One owner for each durable decision; one named invariant that permits the
> transition; one authoritative wire contract; one bounded, observable effect
> path. Every mechanism that plants remote state names its evictor in the same
> module. Every signed evidence class has one byte-exact transcript builder,
> one verifier, and checked-in positive and negative vectors.

## 4. Target architecture

### 4.1 Layering and ownership

Each layer owns its column and must not own the next. The table is the test:
when a review asks "who owns this field/timer/frame," the answer is one cell.

| Layer | Owns | Must not own |
|---|---|---|
| Application / API façade (`AxonaPeer`) | public API surface, service composition | any policy it composes |
| Sync/repair plane (`syncEngine`) | policy-driven state transfer, retry bounds, reconciliation outcomes | hot-path delivery semantics |
| Topic role lifecycle (`TopicRoleLifecycle`, with legacy `rootClaim` adapter) | renewable topic-service obligations and legacy placement transitions | event ordering, retained data, transport establishment, repair data movement |
| Pub/sub delivery plane (`TopicDeliveryPlane`) | downstream leases, one or more upstream leases, renewal, catch-up trigger, rehome/promotion, fan-out | routing tables, event ordering, retained data, catch-up delta construction |
| DHT/routing plane | synaptome, greedy routing, lookup, routing-table and synapse maintenance | authorization, persistence formats, pub/sub subscriber ownership |
| Transport / auth / persistence | live authenticated channels, frame I/O, durable storage mechanics | topic placement, repair semantics |
| Per-boundary contract registries | frame validation, tracing, correlation contracts | handler business logic |

v1 of this table assigned "tree maintenance" to the routing plane. That
phrase named two different trees at once. The routing plane maintains its own
tables and synapses; the axonic *delivery* relationships — who is seated under
whom, which upstream is primary or standby, who renews, and who fans out — are
pub/sub state with their own owner (§4.5). The current profile instantiates a
tree with one upstream; the target interface permits a renewable DAG. Routing
finds candidates and paths, but never owns subscriber leases.

### 4.2 The role and profile model — legacy placement, future obligations

The shipping Kernel 4 profile remains explicit and enforced:

```
legacyPlacement ∈ { ROOT, CHILD, BACKUP }      — mutually exclusive;
                                                   every transition passes through
                                                   LegacyPlacementControl/rootClaim
retention ⊆ { HOSTED, APP_SUBSCRIBED,          — orthogonal set; a node in any
              HISTORY, METRICS_LEASE }           placement may hold any of these
```

A four-exclusive-state FSM (`ROOT/CHILD/BACKUP/HOLDER`) remains rejected: it
cannot express a root that also holds. But `ROOT | CHILD | BACKUP` is now
formally a **legacy profile state**, not the universal future role model. A
leaderless node may simultaneously act as ingress, retainer, relay, and
application subscriber. Those are renewable, orthogonal obligations rather
than one elected placement.

The refactor therefore models:

```
TopicProfile            current: LEGACY_ROOT_V4; future: AUTHOR_LANES_V1
LegacyPlacement         ROOT | CHILD | BACKUP, only under LEGACY_ROOT_V4
TopicObligations        INGRESS | RETAIN | RELAY | APP_SUBSCRIBE | HOST
DeliveryLeases          downstream[] + upstreams[] (legacy activates <= 1 upstream)
EventSemantics          legacy stamped set | future author lanes
Retention               exact local possession and policy evidence
OperationalCapability   SERVE | DRAINING | FORWARD_ONLY | BRIDGE
```

Today `ROOT` binds stamp authority, beacon authority, write verification,
replica principalship, and forest rooting. The compatibility adapter preserves
that behavior exactly: if `legacyPlacement == ROOT`, the local node serves,
issues legacy stamps, and owns the legacy subscriber tree. `LegacyStampAuthority`
and `LegacyPlacementControl` make that coupling explicit without requiring the
permanent store, delivery, sync, locator, or ingress interfaces to depend on it.

A lifecycle transition is legal only with a **transition record** naming its
profile, preconditions, durable writes, emitted effects, idempotency key, any
remote standing state, renewal evidence, and eviction/rollback path.

**Invariant language.** "A topic has exactly one root" and "one authority
issues dense root stamps" remain tested Kernel 4 profile facts. They are not
unversioned architectural laws. The leaderless durable law is instead:
*each accepted author lane has one unambiguous signed prefix, and replicas
with the same valid event set and compaction evidence compute the same state.*
The refactor implements neither law generically; it makes event semantics
profile-selected and preserves the Kernel 4 law behind its adapter.

### 4.3 Per-boundary frame contract registries, shadow first

One universal dispatcher for every byte on every boundary was considered and
rejected: the frame families carry different obligations, and a single matcher
would become the third god-object. Instead, four registries — one per
boundary, matching four genuinely different trust surfaces:

1. pub/sub and DHT control frames (`route_msg`, `pullresp`, `ROOTBEACON`, …)
2. transport hello / auth / session frames
3. WebRTC signalling and mesh-auth frames
4. bridge administration frames

Each registry row declares: frame type and version range; canonical schema;
authentication, admission, and placement-state guards; **frame kind** —
`REQUEST_RESPONSE | ONE_WAY | MULTICAST | UNSOLICITED_EVENT` — with a
correlation contract only where the kind implies one (a `ROOTBEACON` has no
opposite and registers without one); idempotency rule; owning service;
normalized outcome type; error contract; trace fields.

**The evidence hierarchy.** Normalized outcomes distinguish facts that the
#28 incident proved are not interchangeable:

```
ROUTED        a transport or routing hop accepted/forwarded the frame
INGESTED      a profile-valid ingest endpoint accepted the exact event
RETAINED      an authenticated named holder confirms it stores the exact entry
COMMITTED     exact holder receipts satisfy the named retention policy
OBSERVED      an application subscriber delivered the event exactly once
```

A `consumed` routing verdict is not retention; successful dispatch is not
ingestion; self-delivery is not durability. The 4.62.2 D1 proof is the shipped
precedent: the last hop is merely routing evidence; INGESTED is established by
a domain-separated signature whose transcript binds the exact operation and
open flight. Commitment counts *retention-capable holders* satisfying a named
policy, never raw cohort size. `COMMITTED` therefore carries `policyId`, exact
receipt-set digest, distinct-holder count, and diversity evidence rather than
encoding the numbers two or three in an enum. No current profile produces
leaderless retention certificates; the RESERVED rule in §4.4 governs those
strategies.

**The correlation contract.** Registry correlation is capable of binding:
protocol profile, `topicId`, operation, generic `eventId` (legacy adapter:
`msgId`), authenticated channel peer, proof signer, correlation subject,
attempt id, destination, nonce, configuration/policy reference,
retained-state assertion, receipt-set digest, and optional state digest. A
correlation subject is a tagged union:

```
CorrelationSubject = LegacyAuthorityRef | IngressRef | HolderRef | AuthorLaneRef
```

No new fields are emitted on current wire frames. The type prevents every
write profile from being forced through `rootId + rootEpoch`.

**D1 is a first-class registry contract.** Signed `INGESTACK` is a routed
`ONE_WAY` proof, not a response authenticated by its final hop. Its registry
row delegates byte construction and verification exclusively to
`ackProof.js`, records all fixed transcript widths, safe-integer epoch input
restriction, closed purpose/operation sets, proof-signer binding, and
`(topicId,msgId,op,attemptId,ackTo,flightNonce)` flight match. The legacy
unsigned one-hop `INGESTACK` is a separate compatibility variant whose
completion rule still requires the authenticated adjacent sender and intended
incarnation. Both D1 proof production and completion are selected only under
`LEGACY_ROOT_V4` and bind a `LegacyAuthorityRef`; no future author-lane profile
inherits this authority contract merely because it reuses the ingress façade.
`CAP_ATTEST` belongs to the transport/auth boundary: its
`write-flight-ack-v1` capability is verified only with the base-authenticated
channel key and a locally derived current-channel CBV digest, expires on
channel loss, is never persisted, and is absent/fail-closed on old peers.

**The legacy authority reference.** Internal Kernel 4 code that today reads
`rootHex` and `rootEpoch` consumes a versioned legacy reference:

```
LegacyAuthorityRef {
  kind: "singleton-root",
  nodeId,
  incarnation           // UNVERSIONED | VERSIONED(epoch > 0)
}
```

Incarnation is algebraic, not a magic zero (council seq 462, Q2): UNVERSIONED
is the compatibility state for flights opened without a beacon record — which
is exactly the post-eviction promotion re-flight — and its evidence is valid
only from the exact addressed node for that flight, never as a wildcard
across authorities or terms. New code uses VERSIONED whenever an epoch is
known. The D1 signed path additionally binds the authority transport public key
to the node-id hash portion. Current wire adapters keep encoding and decoding
the existing fields. No leaderless interface requires this reference.

Consumers of "where is this topic served" query a `TopicLocator` returning a
`TopicServiceView { profile, ingressNodes, retentionNodes,
deliveryEntrypoints, legacyAuthority?, policy, observedAt, evidence }`.
Ingress, serving, and retention are distinct facts. In the current profile the
active root can appear in all three candidate lists and
`legacyAuthority` names its incarnation; `retentionNodes` still contains only
nodes actually known to hold state. A backup is never represented as a current
delivery entrypoint merely because it is configured. In a future leaderless
profile `legacyAuthority` is absent and multiple ingress, retention, and
delivery candidates are normal. Routing, write flights, delivery, and sync
consume the view rather than reading raw beacon maps.

Registries enter in **shadow mode**: they validate and trace beside the
existing handlers and change no acceptance behavior. Dispatch migrates one
frame family at a time, each migration carrying its own differential-trace
proof. The registry is the machine-readable *source material* for the Phase 5
normative contract — prose semantics and conformance vectors are authored
against it, not generated from it automatically.

**Shadow observation — trust boundary (normative).** The shadow layer observes
every frame, so it must never mutate a handler's frame, suppress the handler, or
change its arguments. It reflects only on a decoder-certified snapshot, and it
classifies structural kind from decoder-private construction-time tags rather
than from any live prototype or constructor — so a value an attacker mutates
after certification, including a swapped prototype, cannot make observation fire
a trap. The boundary the layer relies on is **intact realm intrinsics and
prototypes for the whole certification-and-dispatch lifetime**, the same
assumption the rest of the kernel already makes throughout (the DHT, transport,
wire codec, and routed handlers all call mutable realm globals). Same-realm
post-load replacement of a relied-upon intrinsic is **out of scope**; the shadow
layer makes no post-load intrinsic-tamper-resistance claim, because hardening one
module inside a realm the attacker otherwise controls buys nothing system-wide.
Requiring same-realm resistance later means a kernel-wide hardened compartment
(SES-style), not an intrinsic checklist local to the registry.

### 4.4 The sync engine as sole repair owner

`syncEngine`'s seven policy rows extend to own **all** repair and
state-transfer emissions now scattered through `repairPlane`. A policy row
states: trigger, required placement/retention state, allowed peer
relationship (initiator and counterpart, not only root/backup nature),
payload contract, retry/backoff bound, convergence or terminal condition, and
metric outcome.

**Summary strategies replace the universal quench.** v1 called signature
equality (`count : hw : tombstones`) the universal quench that stops
replication loops. It is a send-suppression heuristic, not an equality proof:
two caches can match on all three values and hold different message IDs. Each
policy row now names its summary/evidence strategy:

```
EMPTY                    no summary exchanged
TIMESTAMP_FLOOR          scalar since-floor
COUNT_HIGHWATER_HINT     count : hw : tombstones — rate gating only
RETAINED_SET_DIGEST      (RESERVED)
EXACT_MESSAGE_RECEIPT    (RESERVED)
AUTHOR_FRONTIER_MERKLE   (RESERVED)
COMPACTION_FLOOR         (RESERVED)
```

`COHORT_REPLICATE` keeps `COUNT_HIGHWATER_HINT` for rate gating; selection is
valid only under `LEGACY_ROOT_V4` while the active delivery profile has at most
one upstream. No row may label it equality proof, and durability may not infer
exact retention from it. **The RESERVED rule (council seq 462, A1):** a strategy without an
installed implementation and conformance tests stays RESERVED; policy and
configuration validation reject selecting a RESERVED strategy; RESERVED
values are never advertised as negotiated capability. No Merkle tree or new
digest wire format ships with the refactor.

Replay cursors are a tagged type, not an assumed scalar:

```
ReplayCursor = LegacyTimestampCursor | LegacySequenceCursor | FrontierRef
```

Kernel 4 selects only its legacy cursor adapters. `FrontierRef` and the author
Merkle strategies remain RESERVED until Kernel 5 installs their codecs,
validation, and conformance vectors.

Any later change from routed/dispatch evidence to exact receiver-retention
evidence is a behavioral correction, implemented after the structural
extraction in a separately reviewed and gated change — not smuggled into
mechanical moves.

Hot-path `DELIVER` fan-out stays outside the engine. Seat and renewal catch-up
are triggered by the delivery plane but obtain missing-state decisions and
deltas through `SyncEngine`, preventing a second replay implementation from
recreating split-history failures. Snapshot and delta construction move behind
`TopicStore` plus the selected profile index (§4.5); the engine requests
`snapshot(profile)` or `delta(ReplayCursor)` rather than reaching into
`role.cache` and `role.tombstones` directly. Kernel 4 differential traces must
prove the delegation does not change seat latency or replay order.

### 4.5 Façade decomposition of `AxonaPeer` — and the missing owners

`AxonaPeer` keeps every public signature (`sub`, `pub`, `pull`, `connect`,
`leave`, `host`, `snapshot`, `fromSnapshot`, …) and becomes a composition of
named services:

- `PeerLifecycle` — start/stop/join/leave/readiness, and cancellation
  ownership: every interval and listener has one owner and one teardown. It
  owns the master timer's creation and teardown (§4.8).
- `GreedyRouter` and `LookupService` — routing and α-parallel K-closest.
  `LookupService` exposes bounded candidate sets with predicate filtering —
  `findClosest(targetId, { limit, exclude, eligibility, diversity, budget })`
  — not only
  a single-closest convenience. Current behavior is unchanged; the seam later
  admits capability- and diversity-filtered ingress, retention, and delivery
  candidate selection without rebuilding routing. The diversity predicate is
  explicit so multiple logical upstreams cannot silently resolve through one
  physical bottleneck.
- `SynaptomeManager` — synapse lifecycle and `meshBoundCount()`, the
  live-channel count the v4.61.0 connect gate already reads.
- `PeerMessaging` — direct messaging and event bridging.
- `PeerPersistence` — versioned snapshot envelopes, migrations, restore
  boundaries.
- `TopicRoleLifecycle` — the per-peer owner of renewable topic obligations,
  including `LegacyPlacementControl`/`rootClaim` and the capability/admission
  subpolicy (`RoleAdmission`). Operational capability — `SERVE | DRAINING |
  FORWARD_ONLY | BRIDGE` — is consulted before planting remote standing state
  and stays separate from reachability. Exclusive ROOT/CHILD/BACKUP placement
  is selected only by the legacy profile.

The readiness reviews found the store, write pipeline, retention evidence, and
subscriber relationships without sufficiently neutral owners. Leaving them
coupled would shrink the façade while preserving the most important pub/sub
overlap. REF-0.3 then found the state surface is larger than the `role` object:
23 `role.*` fields plus approximately 21 module-level topic/peer-keyed maps,
including write flights and pending ingests, root beacons/hints, upstream and
subscription maps, role and delivery markers, metrics maps, handler tables,
and the durability tracker. Phase 2 sizing and parity fixtures cover both
surfaces. Every map must resolve into the §4.9 policy/data/effect columns; a
slash-separated co-owner label is an unresolved assignment, not proof of
single ownership. v3 names the target owners without embedding one ordering
profile:

- **`TopicStore` + profile index** — `TopicStore` owns persisted event/header
  bodies, tombstones, byte/count bounds, exact retained-state queries, cache
  metrics, and snapshot/delta mechanics. Ordering, deduplication identity,
  high/low water, materialization, and replay cursor interpretation belong to
  the selected index: current `LegacyStampedSetIndex`, future
  `AuthorLaneIndex`. The existing `topicStore.js` seeds the legacy adapter.
  Neither store nor index knows local placement, transfer destinations, or
  subscriber ownership.
- **`WriteIngress` + profile-selected event semantics** — the current root
  handler is extracted into a pipeline whose generic shape does not require a
  stamp:

  ```
  event       = EventCodec.verify(frame)
  disposition = OrderingIndex.classify(event, topicState)
  applied     = TopicStore.apply(disposition)
  evidence    = RetentionLedger.recordLocal(applied)
  DeliveryPlane.announceWhenEligible(applied, evidence)
  ```

  `LegacyRootStampedSemantics` invokes `LegacyStampAuthority.issue()` using
  the local root's `lastTs` and dense `seq`, preserving Kernel 4 exactly.
  `AuthorLaneSemantics` later verifies `authorSeq` and `prevEventId` and never
  calls a stamp authority. Generic contracts use `eventId`; the legacy adapter
  maps current `msgId` into that field. The adapter and profile index keep
  payload-hash identity separate from author-lane sequence position; dedup may
  never infer that equal numeric positions identify equal events across
  authors or profiles.

  **The D1 ack boundary:** the pipeline returns typed dispositions —
  `APPLIED`, `DUPLICATE_PRESENT`, `TOMBSTONE_SUPPRESSED`, and failures. A
  success-equivalent legacy disposition authorizes the transport-facing ACK
  effect; verification, authorization, authority-fence, and malformed-message
  failures do not. Signed D1 proof construction stays exclusively in
  `ackProof.js`; its post-ingest emission call site currently lives in
  `wireHandlers`, routes to `ackTo`, and is not a `TopicStore` effect. The
  legacy unsigned one-hop ack plus flight-retry re-stamp behavior currently
  lives in `writeFlight` and remains a separate compatibility adapter. Phase 2
  may move both call sites but must preserve their different responsibilities.
  Neither path equates INGESTED with RETAINED or COMMITTED.
- **`RetentionLedger` / future `RetentionEngine`** — owns evidence state per
  event, exact holder receipts, expiry, policy evaluation, and repair
  eligibility. The refactor preserves current durability behavior; Kernel 5
  later adds holder selection and receipt certificates. Fixed R2/R3 enums are
  not part of the permanent interface.
- **`TopicDeliveryPlane`** — owns subscriber and child leases, seating and
  renewal, `upstreams[]`, primary/standby designations, attachment and rehome,
  fan-out, duplicate suppression, and graceful teardown. The legacy adapter
  activates one upstream and presents current tree behavior. Catch-up is
  triggered here but fulfilled by `SyncEngine`. The routing plane keeps paths,
  lookups, and synapses — not subscriber ownership (§4.1).
- **D1 proof and capability codecs** — `ackProof.js` owns the signed
  INGEST-ACK/RECEIPT-NACK/probe transcript and verification;
  `capAttest.js` owns `write-flight-ack-v1` attestation. Extraction may move
  call sites but must not duplicate, re-encode, or broaden either transcript.

No extraction changes a wire format or a public signature. Extraction changes
ownership and test boundaries first; behavior changes are separate commits
with separate proofs.

### 4.6 Structural laws

Four rules graduate from prose to enforced structure, each carrying the
incident that taught it:

- **Principal-Liveness** (from the 4.31 handoff-liveness gap). Standing state
  on a remote node may only be planted by a principal alive to maintain it. A
  departing node performs an acknowledged HANDOFF or does nothing. Executable
  form — every mechanism that plants remote state ships a record:
  `{ issuer, remote_standing_state, renewal_evidence, evictor, retry_bound,
  terminal_outcome }`. A mechanism without a named evictor in its own module
  does not merge.
- **Bounded control paths** (from GH #333). Any work triggered by a control
  frame — join, role ingest, beacon — carries an explicit budget, and the
  budget is a constant in the same module.
- **Observable outcomes** (from #422 and the leave-order fix). A decision path
  ends in exactly one recorded outcome; effect ordering that matters is stated
  in code, not implied by statement order. The #28 fix sharpened the law:
  the outcome must carry the right *evidence level* (§4.3) — a path that
  records ROUTED where it needs INGESTED has not recorded an outcome.
- **End-to-end evidence binding** (from #51/#446 and D1). When the consumer of
  evidence is not adjacent to its producer, the last hop is delivery metadata,
  not proof identity. The evidence object is addressed to its consumer,
  cryptographically binds every correlation field and signer role, uses one
  fixed transcript codec, and has replay-resistant attempt/generation binding.
  Capability claims derive identity and freshness from the verifier's current
  authenticated channel, never from replacement fields supplied by the frame.

### 4.7 Documentation model

Four artifacts, kept deliberately separate: architecture rationale (why the
system is shaped this way); the normative protocol contract (frames, states,
guards, errors — generated from the registries in Phase 5); the public API and
deployment reference; and the conformance suite. One invariant catalogue —
`Axona-Architecture.tex` §XII (I-1…I-18, S1–S6) — and every other document
links to it. `INVARIANTS.md` stays a pointer. Documentation that presents
singleton-root coupling as timeless architecture is corrected to profile
language (§4.2) as the sections it describes are refactored.

### 4.8 One scheduler, typed obligations

The single `refreshTick`/sweep pattern is kept and made the rule. Write
flights demonstrate the discipline: one bounded state record per flight, no
per-flight timers to leak. The refactor exposes an injected clock and one
scheduler owner; topic services register bounded sweeps and obligations
rather than installing arbitrary per-topic timers. `PeerLifecycle` owns the
master timer's creation and teardown; `TopicRoleLifecycle` owns the meaning
and transitions of topic deadlines. D1 write-flight ack/probe deadlines remain
protected legacy obligations; pending
D2 chain bounds must join this scheduler rather than add timers. Kernel 5 may
later register subscription renewal, standby replacement, pending-predecessor
repair, receipt expiry, retention repair, frontier reconciliation, and
compaction work — never a competing timing subsystem.

### 4.9 Target ownership map

The §4.1 layering test, cell by cell. When a review asks "who owns this," the
answer is one row:

| Concern | Sole policy owner | Data owner | Effect owner |
|---|---|---|---|
| Public API | `AxonaPeer` façade | composed services | façade delegates only |
| Peer start/stop/join/leave | `PeerLifecycle` | lifecycle state | scheduler/transports through interfaces |
| Synapse lifecycle | `SynaptomeManager` | synaptome | transport connector |
| Greedy routing | `GreedyRouter` | route-local state | DHT transport adapter |
| K-closest discovery | `LookupService` | bounded lookup flights | router/transport adapter |
| Topic profile selection | `TopicProfileRegistry` | immutable selected profile | composes codecs/index/cursor adapters |
| Topic role lifecycle | `TopicRoleLifecycle` | renewable obligations + legacy placement record | named transition effects |
| Legacy root placement | `LegacyPlacementControl` / `rootClaim` | ROOT/CHILD/BACKUP record | compatibility transition effects |
| Capability/admission | `RoleAdmission` subpolicy | capability record; D1 per-channel capability stays in transport auth | accept/decline/drain effects |
| Topic event data | `TopicStore` | headers/bodies/tombstones/local retention | none beyond local mutation |
| Ordering/materialization | selected `OrderingIndex` | legacy stamp index or future author-lane index | returns typed disposition/view only |
| Write processing | `WriteIngress` | bounded pending ingest record | selected semantics, store, retention, delivery eligibility, ack disposition |
| Legacy stamp issuance | `LegacyStampAuthority` | current root clock/sequence | returns legacy stamped entry only |
| D1 evidence codec | `ackProof.js` | none beyond pure transcript fields | signs/verifies; routing adapter sends proof |
| D1 capability attestation | `capAttest.js` + transport auth owner | live-channel capability flag | sign/verify/clear on channel loss |
| Subscriber delivery | `TopicDeliveryPlane` | downstream leases + `upstreams[]` | SUB/DELIVER/renew/promote/rehome; catch-up trigger only |
| Repair/state transfer | `SyncEngine` | policy/flight ledger | router plus profile-aware `TopicStore` import/export |
| Retention/durability | `RetentionLedger` | evidence state per event and policy | no delivery mutation; future repair through `RetentionEngine` |
| Topic service discovery | `TopicLocator` | ingress/retention/delivery candidates + optional legacy authority | lookup/beacon adapters |
| Wire validation/correlation | per-boundary registry | contract metadata | invokes owning service |

---

## 5. Phases and deployment milestones

Six phases, strictly ordered so the safety harness exists before anything is
cut, and the riskiest structural changes (placement, repair) come last. Per
David's directive, **a post-mortem follows each implemented phase and revises
the remainder of this plan before the next phase starts** — the plan is a
living document until Phase 5 closes it.

Every deployment milestone uses the canary discipline proven on the 4.60.x
TURN work: record the prior ref, deploy to the testnet droplet, observe a
15-minute window against named health criteria, roll back to the recorded ref
on any breach. David approves every deployment; the council reviews design and
evidence, and David decides.

### Phase 0 — Characterization harness (no deploy)

The load-bearing phase. It converts "rewrite risk" into "regression test."

- **Deliverables.** Golden-trace fixtures for join/leave, root claim,
  split/merge, subscription renewal, handoff, bridge-only bootstrap,
  duplicate/reorder/rejected frames, and teardown — plus, from the readiness
  amendments: root and backup abrupt loss; two sequential root losses inside
  and outside the repair window; child-tree rehome and cache replay-up;
  legacy source/epoch-bound ingest-ack acceptance AND rejection; D1 signed
  multi-hop ack success independent of last hop; wrong signer, purpose,
  operation, attempt, destination, nonce, id width, and epoch rejection;
  signed/unsigned compatibility dispatch; CAP_ATTEST golden, wrong-key,
  wrong-channel, reconnect-replay, clear-on-loss, fail-closed absence, and
  old-peer-ignore behavior; full-snapshot versus keepalive durability
  evidence; duplicate and reordered stamped ingest; bridge-as-routing-only
  behavior. A static ownership map names every per-topic state field, timer,
  proof codec, capability flag, and frame type to exactly one §4.9 owner.

  The assumption inventory additionally names every use of: root-issued
  stamps; scalar `since`; dense sequence/high-water; legacy `msgId` identity;
  singular upstream; root-as-write-authority; replay outside `SyncEngine`;
  separate kill/tombstone flow; unsigned publish; author sequence generation;
  and TTL/count eviction that could be confused with semantic compaction. The
  reliability ledger separates shipped D1 from pending D0 delegation and D2
  chain termination, and carries reconnect flake #423, buildAxonTree flake
  #402, I-9 exposure, and the unbounded promotion chain as named facts rather
  than silently closing them.

  The inventory is falsifiable against `fb3ea39`: it begins with 63 direct
  `role.cache`/`role.tombstones` access sites across six files
  (`wireHandlers` 23, `topicStore` 16, `repairPlane` 11, `AxonaManager` 9,
  `syncEngine` 3, `writeFlight` 1); two D1/legacy ACK emission responsibilities
  split between `wireHandlers` and `writeFlight`; and the repair-operation
  families enumerated by `Refactor-Phase0-Inventory-v0.1.md`. The latter are
  approximately 9–10 families — `emptyRootProbe`, `readRepair`,
  `replicateRole`, `replicateRoot`, `leaveHandoff`, `confirmPending`,
  `earlyResend`, the ingest pipeline, and `peerDied` handling — rather than the
  superseded coarse count of 49 matching lines. `repairPlane` has three direct
  `_send` calls, zero `_route`/`_emit` calls, and zero current delegation to
  `syncEngine`. Every measured site or enumerated family maps to one §4.9
  owner, one legacy adapter, one policy row, or a named exception. Count drift
  is reconciled by a reviewed inventory update rather than silently accepted.

  REF-0.3 additionally inventories the full state/timer surface: 23 `role.*`
  fields, approximately 21 module-level topic/peer-keyed maps, and 17 timer
  call sites. The ownership map is not complete merely because a category has
  a destination; each concrete map and timer must have one policy owner, one
  data owner, and one effect/teardown owner where those differ. Ambiguous
  slash cells and contradictory orphan status block acceptance until resolved.

  Four structural assertions from Orion's audit are explicit Phase 0 targets:
  lookup diversity prevents several upstreams from sharing one physical
  bottleneck; legacy `msgId` mapping cannot conflate payload identity with an
  author-lane position; `COUNT_HIGHWATER_HINT` is limited to
  `LEGACY_ROOT_V4` with at most one active upstream; and signed D1 ACK evidence
  remains bound to `LegacyAuthorityRef` rather than leaking into generic
  ingress semantics.
- **Exit criteria.** Every incident in the §2.1 ledger is covered by a
  falsifiable fixture; tests include duplicate, reorder, rejection,
  cancellation, and teardown paths; browser/WebRTC and bridge evidence is
  recorded alongside simulator evidence. The checked-in D1 transcript vectors
  are consumed, not rewritten. Phase 0 tests assert singleton-root behavior;
  their added value is showing which component and legacy adapter owns each
  fact.

### Phase 1 — Contract registries in shadow mode (milestone M1)

- **Deliverables.** All four boundaries' frames registered with schemas, frame
  kinds, and guards; validation and tracing in report mode; zero change to
  acceptance behavior; ambiguous handler ownership resolved or recorded as a
  named exception. Each applicable row additionally declares: owning service
  from the §4.9 map; topic profile; event-id scheme; replay cursor type;
  ordering model; correlation-subject shape; evidence level and policy
  produced/required (§4.3); exact correlation fields; whether the frame proves
  routing, ingestion, retention, or observation; capability/version range;
  bounded payload/work budget; idempotency key; terminal negative outcome.
  Signed D1 `INGESTACK`, legacy unsigned `INGESTACK`, and `CAP_ATTEST` are
  distinct rows/variants with their shipped transcript modules and channel
  lifetime rules named explicitly.
  *Catalogued* is not *enforcement-ready*: a family's registry row governs
  dispatch only after that family's own migration proof.
- **M1 canary.** Telemetry-only on the testnet droplet. Health criteria:
  trace/error distributions match the Phase 0 baseline. Rollback: disable the
  wrapper flag — no protocol rollback exists because no protocol changed.

### Phase 2 — Façade and service decomposition (milestone M2)

- **Deliverables.** The §4.5 services extracted behind the unchanged
  `AxonaPeer` façade — including `TopicProfileRegistry`, `TopicStore` plus
  `LegacyStampedSetIndex`, `WriteIngress`, `LegacyStampAuthority`,
  `RetentionLedger`, topology-neutral `TopicDeliveryPlane`, profile-aware
  `TopicLocator`, `TopicRoleLifecycle`, and `RoleAdmission`;
  teardown tests proving zero orphan timers, listeners, channels, or stale
  readiness state; versioned persistence envelope with read-old/write-new
  compatibility. Differential traces prove the extracted write pipeline
  preserves validation, stamp, cache, durability, delivery, renewal, and
  teardown order — and both D1 signed multi-hop and legacy unsigned ingest-ack
  emission/completion behavior on every disposition. `ackProof.js` and
  `capAttest.js` remain single pure codecs; extraction may move call sites but
  may not clone their transcript logic.
- **M2 canary.** Testnet droplet bridge plus browser peers. Health criteria:
  differential traces match Phase 0; memory flat; `meshBoundCount()` stable.
  Rollback: prior composition at the recorded ref.

### Phase 3 — Topic role lifecycle (milestone M3)

- **Deliverables.** `TopicRoleLifecycle` arbitrates renewable topic
  obligations; `rootClaim` becomes its `LegacyPlacementControl` adapter and
  remains the sole mutator of Kernel 4 ROOT/CHILD/BACKUP. Retention, delivery,
  event semantics, and legacy stamping remain separate (§4.2). Transition
  records carry `profile` and a tagged correlation subject; legacy records may
  carry `LegacyAuthorityRef`, while generic records do not require one.
  Capability/admission gates are consulted before planting remote standing
  state; D1 channel capability is read from transport auth and never persisted
  as topic capability. Role changes mutate the store or delivery leases only
  through named effects. Contract guards reject illegal profile/state/frame
  combinations. No cohort, timekeeper, author-lane, or Kernel 5 state is
  created in this phase.
- **M3 canary.** Testnet under churn, partition, reconnect, root migration,
  and stale-state restoration, with mixed old/new peers. Health criteria:
  transition telemetry shows convergence and no unbounded repair loop.

### Phase 4 — Sync engine sole ownership (milestone M4)

- **Deliverables.** Remaining repair emissions migrate into `syncEngine`
  policy rows, one family at a time, each with duplicate/reorder tests; rows
  declare initiator/counterpart relationship, summary strategy (§4.4),
  evidence produced, receipt/correlation rule, terminal negative outcome,
  state planted and its evictor, and retry/work bounds; snapshot and delta
  construction move behind `TopicStore` plus the selected profile index;
  Principal-Liveness transition records enforced on every remote-state write;
  live fan-out remains untouched, while seat and renewal catch-up call the
  same `SyncEngine` reconciliation seam under differential-trace proof.
  `COHORT_REPLICATE` wire behavior is unchanged; internally, root-pushes-
  passive-backup stops being the only representable retention flow. Any
  evidence upgrade (routed → retained) is a separately gated behavioral
  change, not part of this phase.
- **M4 canary.** Extended testnet soak: churn, bridge reconnect, mesh repair,
  root migration, durable handoff. Recurring flakes are blocking defects.

### Phase 5 — Normative specification and production decision (milestone M5)

- **Deliverables.** The registries published as the normative wire contract
  with machine-readable conformance vectors; an independent harness consumes
  the fixtures and reaches the expected outcomes; compatibility and migration
  policy frozen. The specification publishes singleton-root behavior as the
  current negotiated profile, distinguishing: serving placement from
  write/stamp authority; routing outcomes from retained-state outcomes; the
  current root epoch from the tagged legacy-authority correlation subject;
  heuristic sync summaries from exact evidence; the current singleton locator
  response from the profile-aware service view. It publishes D1 exactly as
  shipped, including signed/unsigned compatibility, proof transcripts,
  capability lifetime, fixed-width/safe-epoch constraints, and governed
  exceptions. It defines the extension boundary for `author-lanes-v1` but
  publishes no unimplemented leaderless frames or states.
- **M5.** Progressive production canary — expand or roll back on named
  indicators. The behavior-preserving restructure remains a Kernel 4 minor
  line; the exact minor is selected at release. `v5.0.0` is reserved for the
  first separately authorized leaderless wire and semantic profile. David's
  explicit approval gates every step of this milestone.

### 5.1 Leaderless-readiness exit conditions

The refactor is ready for the later leaderless project when all of the
following hold. They are exit conditions for the refactor as a whole, checked
at Phase 5; none requires Kernel 5 behavior to exist:

1. No wire handler directly allocates a root stamp, mutates a cache, and fans
   out in one uninterruptible method.
2. `LegacyStampAuthority` is selected only by `LEGACY_ROOT_V4`; no generic
   write interface requires a stamp or authority.
3. Generic contracts use `eventId`; Kernel 4 `msgId` semantics live behind a
   legacy adapter.
4. `TopicStore` imports/exports state without knowing placement and delegates
   ordering, materialization, and cursor meaning to a selected profile index.
5. Replay accepts tagged cursor types; scalar floors are not universal, and
   all RESERVED frontier strategies are unselectable.
6. `TopicDeliveryPlane` represents `upstreams[]`, downstream leases, and
   primary/standby roles even though Kernel 4 activates at most one upstream.
7. Live fan-out stays in delivery; seat and renewal catch-up use `SyncEngine`.
8. `TopicLocator` returns ingress, retention, and delivery candidates without
   requiring `legacyAuthority`.
9. Registry outcomes distinguish routed, ingested, retained, committed, and
   observed evidence; commitment is policy-based and counts only exact
   retention-capable holder receipts.
10. Lookup returns bounded candidate sets and supports eligibility,
    capability, and diversity filtering.
11. Root placement is owned by a legacy adapter; renewable topic obligations,
    retention, delivery, and ordering have separate owners.
12. D1 signed proof and CAP_ATTEST codecs remain byte-identical, single-owner,
    and covered by golden, rejection, profile-width, multi-hop, reconnect, and
    mixed-version tests; the unsigned compatibility variant remains isolated.
13. D0 delegation, D2 chain termination, I-9 exposure, and any other governed
    exception remain explicitly open until their own authorized work closes
    them.
14. All current singleton-root behavior remains covered by differential
    traces and mixed-version tests.
15. No Kernel 5 wire behavior or leaderless state exists in the shipping
    refactor unless separately authorized.

Without these, the leaderless project would reopen `rootClaim`,
`wireHandlers`, `syncEngine`, `topicStore`, `writeFlight`, routing beacons,
subscriber state, and durability at once — a second refactor plus a
distributed-systems feature at the same time, the exact sequencing this plan
exists to avoid.

---

## 6. Evidence and compatibility rules

Required evidence at every milestone: unit tests for every policy and
transition row; integration tests over real authenticated channels, including
browser/WebRTC where the deployed system uses them; differential traces
against the Phase 0 baseline; duplicate, replay, reorder, rejection,
reconnect, cancellation, and teardown cases; metrics for transition outcomes,
repair attempts and terminal reasons, registry validation failures, and live
mesh counts; a written rollback condition with the prior ref recorded before
deploy.

Compatibility rules, holding through all phases: public API signatures stay
stable behind the façade; wire version/capability negotiation precedes any
semantic change; persistence reads old envelopes and writes versioned new
ones; real transports never require simulator-only global knowledge. Any
behavior correction discovered during refactoring is isolated in a separate
commit, fixture, gate, and rollback decision.

D1 adds a stricter compatibility floor. Its signed proof transcript, domain,
field widths, signer/root binding, and safe-epoch checks are protocol data, not
implementation details: refactoring may relocate their call sites but may not
reconstruct or reinterpret them. Mixed-version evidence must cover signed D1
peers, legacy unsigned peers, and peers that ignore `CAP_ATTEST`. Capability is
accepted only when the attestation verifies against the authenticated channel
peer and the locally derived channel-binding value; it is cleared with that
channel and is never persisted or inferred from topic state.

Topic profiles and wire versions are negotiated independently. Kernel 4 keeps
the `LEGACY_ROOT_V4` profile and its existing topic-id, ordering, and replay
semantics. The later leaderless project introduces its author-lane identity,
ordering, cursor, retention-policy, and delivery semantics under Kernel 5; the
refactor does not silently activate them. Consequently, completion of this
plan does not by itself justify a `v5.0.0` release.

## 7. Initial work breakdown

Implementation is axona.bot's (standing rule: only the chief programmer
changes kernel code); Orion and Aster review each item's design and evidence;
David decides each deployment.

| ID | Task | Completion evidence |
|---|---|---|
| REF-0.1 | Inventory: frames, state fields, timers, proof/capability codecs, the ~9–10 enumerated repair-operation families, two ACK-emission responsibilities, API surface, and singleton-root/leaderless-sensitive assumptions | versioned inventory committed; every measured site/family reconciled; D1, D0, and D2 classified separately |
| REF-0.2 | Golden traces + reliability ledger, including D1 proof/CAP_ATTEST vectors and the 4.62.x protected fixtures | deterministic fixtures; §2.1 ledger fully covered; shipped D1 behavior byte-identical |
| REF-0.3 | Static ownership map per §4.9, including 23 `role.*` fields, ~21 module-level keyed maps, 17 timer sites, all 63 direct cache/tombstone access sites, and profile/event/cursor/evidence ownership | every concrete state/timer/frame/proof resolves into unambiguous policy/data/effect owners or a named adapter; no slash co-ownership, contradictory orphan status, or open cells |
| REF-1.1 | Registry types + shadow wrappers, four boundaries, profile/evidence/correlation metadata, and distinct signed/unsigned D1 rows | report-mode telemetry on testnet, zero behavior change (M1) |
| REF-2.1 | `PeerLifecycle` extraction + teardown proofs | API parity; zero leaked resources |
| REF-2.2 | Router/lookup/synaptome/messaging/persistence extraction | differential-trace parity (M2) |
| REF-2.3 | `TopicProfileRegistry`, `TopicStore` + legacy index, generic `WriteIngress`, `LegacyStampAuthority`, `RetentionLedger`, `TopicDeliveryPlane`, `TopicLocator`, and `TopicRoleLifecycle` seams | all 63 inventoried store-access sites migrated or adapted; pipeline differential traces include all D1 ack dispositions (M2) |
| REF-2.4 | Preserve D1 proof/CAP_ATTEST single ownership while moving the signed post-ingest call site from `wireHandlers` and the legacy/retry call site from `writeFlight` behind façades | both responsibilities preserved; golden/rejection/profile-width/multi-hop/reconnect/mixed-version suites unchanged (M2) |
| REF-3.1 | Topic-role lifecycle table plus `LegacyPlacementControl`; tagged correlation subjects in transition records | row-level normal and negative tests; no generic authority requirement (M3) |
| REF-4.1 | The inventoried repair-operation families (`emptyRootProbe`, `readRepair`, `replicateRole`, `replicateRoot`, `leaveHandoff`, `confirmPending`, `earlyResend`, ingest pipeline, `peerDied`) → `SyncEngine`, one at a time; profile index and tagged-cursor strategy rows; seat/renewal catch-up through the same seam | every family and direct emission mapped to a policy row or named exception, with churn and differential-trace evidence per family (M4) |
| REF-5.1 | Kernel 4 normative contracts + conformance vectors, profile language, and Kernel 5 extension boundary | independent harness passes fixtures; §5.1 exit conditions all green; no leaderless behavior shipped (M5) |

## 8. Decisions and current status

1. **Council validation: complete.** axona.bot found the plan code-accurate and
   Phase-0-ready (#council seq 558); Orion unconditionally ratified its
   structural sufficiency (#council seq 561).
2. **Phase 0: authorized, no deploy.** axona.bot reported David's authorization
   and began the characterization-harness sequence at #council seq 562.
   `Refactor-Phase0-Inventory-v0.1.md` (REF-0.1, commit `19376cd`) landed at
   seq 565. `Refactor-Phase0-OwnershipMap-v0.1.md` (REF-0.3, commit `c2a2d79`)
   landed for review at seq 568 and surfaced the hidden module-map state.
   REF-0.3 acceptance remains open until its slash-separated owner cells and
   contradictory `_m` orphan statements are reconciled; REF-0.2 follows.
3. **Release boundary: still requires David's explicit confirmation.** Kernel
   4 refactor releases remain minor versions; `v5.0.0` is reserved for
   separately authorized leaderless wire semantics.
4. **Standing governance remains in force.** Council reviews design and
   evidence at each milestone; David decides every deployment; a post-mortem
   after each phase revises the remainder of the plan.

---

*Originally collated by axona.bot from the three council assessments and the
cross-review record. Aster's v3 revision integrates the released D1
write-flight acknowledgement slice and replaces the earlier
triumvirate-specific readiness target with the approved per-author,
deterministically convergent leaderless target. Orion's structural framing,
Aster's phase/evidence discipline, and the implementer's code-grounded
corrections remain load-bearing; the new D1 and leaderless amendments now
carry the measured Phase 0 inventories, corrected repair-family enumeration,
four seam assertions, and the expanded state surface identified through seq
568.*
