# Axona Kernel Refactor — Master Plan

**File:** `axona-docs/architecture/code-refactor-plan.md`
**Version:** v2.1 — 2026-08-08, triumvirate-readiness amendments incorporated; Aster final-review corrections E1/E2 applied
**Collator:** axona.bot (chief programmer), by unanimous council vote, David's designation (#council, 2026-08-07)
**Sources:** `axona.bot-Redesign-Plan.md`, `Aster-Protocol-Refactor-Plan.md`, `Orion-Redesign-Plan.md`, `code-refactor-plan-draft-orion.md`, the council cross-review thread (#council seq 381–392), `axona-refactor-triumvirate-readiness-review-v0.1.md` (Aster, 2026-08-08), and the readiness Q&A record (#council seq 458–462: Q1/Q2 confirmed, A1 accepted)
**Status:** FINAL DRAFT v2 — shared with the council and David for final agreement before Phase 0 begins
**Scope:** the kernel, `axona-protocol/src`. Relay, bridge, and apps are consumers of the kernel and are touched only where a phase's canary requires them.

**What v2 adds.** The v1 plan predates two things: the shipped Dead-Root
Eviction machinery (kernel 4.62.x) and the triumvirate-root design (Aster +
David, design v0.4). Aster's readiness review asked one question of the plan:
which of its choices would the triumvirate project have to reopen? This
revision closes those choices — new service owners, an evidence hierarchy, a
versioned authority reference, policy-selected sync summaries — while changing
NO current behavior, NO wire format, and NO public API. The triumvirate itself
is not implemented here. The refactor stays behavior-preserving; its seams
stop assuming the singleton root is timeless.

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
to make their discipline universal. It is not the triumvirate: no cohort
membership, no timekeeper election, no active co-roots, and no new wire frames
ship with this refactor.

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
  write completes only on an INGEST-ack bound to the sender and incarnation it
  was addressed to; a root that cannot produce that proof within the flight
  budget is convicted, tombstoned, and succeeded.
- **Where code lives.** Nine top-level modules under `src/` — `contracts`,
  `crypto`, `dht`, `identity`, `persistence`, `pow`, `pubsub`, `transport`,
  `utils` — about 22.9K lines total (measured 2026-08-08, `wc -l` over
  `src/**/*.js`, kernel v4.62.1 at `8f34759`).

## 2. The problem, measured

The nine-module split is sound. The debt sits in two god-objects and one
asymmetric dispatch surface; nothing else in the tree is structurally alarming.
Line counts below were measured 2026-08-08 at kernel v4.62.1 (`8f34759`):

| Surface | Lines | What it wrongly owns |
|---|---|---|
| `dht/AxonaPeer.js` | 4,434 | lifecycle, join/integrate, persistence, the public pub/sub API, direct messaging, greedy routing, lookup, relay maintenance, metrics, eventing |
| `pubsub/repairPlane.js` | 1,223 | repair triggers, retries, and emissions |
| `pubsub/AxonaManager.js` | 1,118 | topic state, election, wire handling, sync |
| `pubsub/wireHandlers.js` | 991 | frame registration without a single contract |

The pub/sub trio totals 3,332 lines and is prototype-composed, so ownership
and precedence cannot be read from any one file. The rest of the tree —
transports included — is heavy in places but coherent: one file, one concern.
`pubsub/writeFlight.js` (246 lines, new in 4.62.x) is the youngest example of
the coherent form: one bounded state record per flight, one sweep, no timers.

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
duties. The refactor must stop the equivalence from hardening into interfaces.

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

The #28/#422 family graduates in this revision from open item to **protected
regression family**. Its live-gate evidence enters the reliability ledger as
fixtures, with the conditions attached: measured 2026-08-08 on a 38-relay
testnet under no load — rooting-relay SIGKILL succession in 11 s;
zombie-window write (published 6 ms after the kill) independently readable in
29 s where 4.61.x stranded 2h06m; Howard-shape chunked transfer 30/30;
axonSpec 11/11 excluding the harness's pre-existing five-second setup
timeout. The 29 s bound is flight budget plus refreshTick sweep cadence — a
shorter sweep tick, not tighter constants, is the lever if ~15 s matters.
One overnight soak, churn A/B, and load would prove these numbers wrong first.

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
- **`pubsub/writeFlight.js` (246 lines, 4.62.x)** — one bounded record per
  write flight, swept from the shared refresh tick, completion only on
  sender-and-incarnation-bound evidence. This is the scheduler and evidence
  discipline of §4.3 and §4.8, already shipped and live-gated.

The organizing rule they demonstrate, which this plan applies everywhere:

> One owner for each durable decision; one named invariant that permits the
> transition; one authoritative wire contract; one bounded, observable effect
> path. Every mechanism that plants remote state names its evictor in the
> same module.

## 4. Target architecture

### 4.1 Layering and ownership

Each layer owns its column and must not own the next. The table is the test:
when a review asks "who owns this field/timer/frame," the answer is one cell.

| Layer | Owns | Must not own |
|---|---|---|
| Application / API façade (`AxonaPeer`) | public API surface, service composition | any policy it composes |
| Sync/repair plane (`syncEngine`) | policy-driven state transfer, retry bounds, reconciliation outcomes | hot-path delivery semantics |
| Placement & control authority (generalized `rootClaim`) | topic lifecycle, placement/retention *transition policy*, election | the retained data itself (`TopicStore` owns that), transport establishment, repair data movement |
| Pub/sub delivery plane (`TopicDeliveryTree`) | the axonic subscriber/child forest: seating, renewal, replay-on-seat, rehome, fan-out | routing tables, stamp issuance, retained data |
| DHT/routing plane | synaptome, greedy routing, lookup, routing-table and synapse maintenance | authorization, persistence formats, pub/sub subscriber ownership |
| Transport / auth / persistence | live authenticated channels, frame I/O, durable storage mechanics | topic placement, repair semantics |
| Per-boundary contract registries | frame validation, tracing, correlation contracts | handler business logic |

v1 of this table assigned "tree maintenance" to the routing plane. That
phrase named two different trees at once. The routing plane maintains its own
tables and synapses; the axonic *delivery* tree — who is seated under whom,
who replays, who fans out — is pub/sub state with its own owner (§4.5). The
distinction is load-bearing later: a lost co-root must move only its branch
ownership, not reopen routing.

### 4.2 The role model — placement, retention, and the duties they bind

Adopted as shipped, now made explicit and enforced:

```
placement ∈ { ROOT, CHILD, BACKUP }           — mutually exclusive;
                                                 every transition passes through
                                                 the placement authority
retention ⊆ { HOSTED, APP_SUBSCRIBED,          — orthogonal set; a node in any
              HISTORY, METRICS_LEASE }           placement may hold any of these
```

A four-exclusive-state FSM (`ROOT/CHILD/BACKUP/HOLDER`) was considered and
rejected: it cannot express a root that also holds, which every relay does
through the `host()` primitive (kernel 2.40.0). The council record shows all
three assessments converging on the two-axis model after the code citation.

The readiness review refines what `ROOT` *means*. Today the placement binds
five further duties in one word: stamp authority, beacon authority, write
verification, replica principalship, and forest rooting. The refactor models
these duties as separate concepts while keeping them bound in the current
implementation:

```
LocalPlacement          current: ROOT | CHILD | BACKUP
Retention               HOSTED | APP_SUBSCRIBED | HISTORY | METRICS_LEASE
ServingTree             subscriber/child ownership, renewals, replay, rehome, fan-out
StampAuthority          current: the local singleton root
AuthorityDiscovery      current: one root identity + root epoch
OperationalCapability   SERVE | DRAINING | FORWARD_ONLY | BRIDGE
```

The compatibility implementation remains one line: if `localPlacement ==
ROOT`, the local node is serving root and StampAuthority. No cohort or
timekeeper state is populated. What changes is that the store, the delivery
tree, and the wire contracts stop *depending* on that equivalence.

A placement transition is legal only with a **transition record** naming its
preconditions, durable writes, emitted effects, idempotency key, any remote
standing state, and its eviction/rollback path.

**Invariant language.** "A topic has exactly one root" remains the tested
behavior of the current negotiated protocol, and every Phase 0 fixture asserts
it. It is a profile fact, not an unversioned architectural law. The durable
law is narrower: *for one topic authority term, at most one stamp authority
may create externally committed stamps; conflicting claims converge by
versioned evidence.* The current profile satisfies it by binding root service
and stamp authority to one node. A future cohort profile satisfies it with a
transferable timekeeper. The invariant catalogue (§XII) records the law and
the profile separately.

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
INGESTED      the intended write authority accepted the operation
RETAINED      an authenticated named holder confirms it stores the exact entry
COMMITTED_R2  two distinct named retention-capable holders
              prove exact retention                          (RESERVED)
COMMITTED_R3  three distinct named retention-capable holders
              prove exact retention                          (RESERVED)
```

A `consumed` routing verdict is not retention; successful dispatch is not
ingestion; self-delivery is not cohort durability. The 4.62.1 write-flight
acknowledgment is the shipped precedent: success is correlated to the message
and bound to the expected sender plus authority incarnation. Commitment
counts *retention-capable holders*, never raw cohort size: the design permits
a configured member that cannot hold cache state (`FORWARD_ONLY`, `BRIDGE`),
and such a member can satisfy neither proof (Aster final review, E1). The two
`COMMITTED` levels are registry vocabulary only — nothing produces them in the
current profile, and the RESERVED rule below governs them.

**The correlation contract.** Registry correlation is capable of binding:
`topicId`, `operation`, `msgId`, authenticated sender, authority reference,
configuration reference (absent in the current profile), retained-state
assertion, and an optional state digest. No new fields are emitted on current
wire frames; the contract types simply stop assuming `rootId + rootEpoch` is
the only shape of authority.

**The authority reference.** Internal code that today reads `rootHex` and
`rootEpoch` consumes a versioned reference instead:

```
AuthorityRef {
  kind,                 // current: singleton-root; future: timekeeper
  nodeId,
  incarnation           // UNVERSIONED | VERSIONED(epoch > 0)
}
```

Incarnation is algebraic, not a magic zero (council seq 462, Q2): UNVERSIONED
is the compatibility state for flights opened without a beacon record — which
is exactly the post-eviction promotion re-flight — and its evidence is valid
only from the exact addressed node for that flight, never as a wildcard
across authorities or terms. New code uses VERSIONED whenever an epoch is
known. Current wire adapters keep encoding and decoding the existing fields.

Consumers of "where is this topic served" query a `TopicLocator` returning a
`TopicServiceView { servingNodes, retentionNodes, writeAuthority,
configuration, observedAt, evidence }`. Serving and retention are distinct
facts and the view keeps them distinct (Aster final review, E2): in the
current profile `servingNodes` contains the active root; `retentionNodes`
contains only named nodes actually known to retain state; `configuration` may
describe backups and candidates without claiming either. A backup is never
represented as a current serving node, and a future `FORWARD_ONLY` member can
appear in `configuration` while appearing in neither list. Routing, write
flights, delivery, and sync consume the view rather than each reading raw
beacon maps.

Registries enter in **shadow mode**: they validate and trace beside the
existing handlers and change no acceptance behavior. Dispatch migrates one
frame family at a time, each migration carrying its own differential-trace
proof. The registry is the machine-readable *source material* for the Phase 5
normative contract — prose semantics and conformance vectors are authored
against it, not generated from it automatically.

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
```

`COHORT_REPLICATE` keeps `COUNT_HIGHWATER_HINT` for rate gating; no row may
label it equality proof, and durability may not infer exact retention from
it. **The RESERVED rule (council seq 462, A1):** a strategy without an
installed implementation and conformance tests stays RESERVED; policy and
configuration validation reject selecting a RESERVED strategy; RESERVED
values are never advertised as negotiated capability. No Merkle tree or new
digest wire format ships with the refactor.

Any later change from routed/dispatch evidence to exact receiver-retention
evidence is a behavioral correction, implemented after the structural
extraction in a separately reviewed and gated change — not smuggled into
mechanical moves.

Hot-path `DELIVER` fan-out and seat replay stay outside the engine. They carry
latency and ordering obligations that anti-entropy repair does not, and moving
them for uniformity's sake would risk a delivery regression. Snapshot and
delta construction move behind `TopicStore` (§4.5); the engine requests
`TopicStore.snapshot()` or `TopicStore.delta(cursor)` rather than reaching
into `role.cache` and `role.tombstones` directly.

### 4.5 Façade decomposition of `AxonaPeer` — and the three missing owners

`AxonaPeer` keeps every public signature (`sub`, `pub`, `pull`, `connect`,
`leave`, `host`, `snapshot`, `fromSnapshot`, …) and becomes a composition of
named services:

- `PeerLifecycle` — start/stop/join/leave/readiness, and cancellation
  ownership: every interval and listener has one owner and one teardown. It
  owns the master timer's creation and teardown (§4.8).
- `GreedyRouter` and `LookupService` — routing and α-parallel K-closest.
  `LookupService` exposes bounded candidate sets with predicate filtering —
  `findClosest(targetId, { limit, exclude, eligibility, budget })` — not only
  a single-closest convenience. Current behavior is unchanged; the seam later
  admits capability-filtered cohort selection without rebuilding routing.
- `SynaptomeManager` — synapse lifecycle and `meshBoundCount()`, the
  live-channel count the v4.61.0 connect gate already reads.
- `PeerMessaging` — direct messaging and event bridging.
- `PeerPersistence` — versioned snapshot envelopes, migrations, restore
  boundaries.
- `TopicControl` — the placement authority's per-peer face, including the
  capability/admission subpolicy (`RoleAdmission`): operational capability —
  `SERVE | DRAINING | FORWARD_ONLY | BRIDGE` — is consulted before planting
  remote standing state, and stays separate from reachability.

The readiness review found three per-topic concerns with no named owner in
v1 — the store, the write pipeline, and the subscriber forest. Leaving them
unnamed would shrink the façade while preserving the most important pub/sub
ownership overlap. v2 names them:

- **`TopicStore`** — owns cache entries and byte/count/TTL bounds; tombstones
  and tombstone-first ingestion; `msgId` deduplication; timestamp/sequence
  high- and low-water; state summary/digest generation; snapshot and delta
  export; retained-state queries; cache metrics. It does not know the node's
  placement, where a snapshot is sent, who owns a subscriber branch, or any
  election or capacity policy. The existing `topicStore.js` is the seed.
- **`WriteIngress` + `StampAuthority`** — the current root ingress performs
  validation, deduplication, stamping, cache mutation, durability opening,
  and delivery in one handler path. It becomes an explicit pipeline:

  ```
  WriteIngress.validate(authorEnvelope)
  WriteIngress.deduplicate(topicStore, msgId)
  StampAuthority.issue(topic, authorityContext)
  TopicStore.apply(stampedEntry)
  DurabilityLedger.open(stampedEntry)
  TopicDeliveryTree.fanout(stampedEntry)
  ```

  `StampAuthority.issue()` uses the local root's `lastTs` and `seq`; the
  later triumvirate replaces that one adapter with "forward to the current
  timekeeper and await the stamped result" without touching validation,
  storage, durability, or delivery. **The ack boundary (council seq 462,
  Q1):** the pipeline returns a typed terminal disposition — `APPLIED`,
  `DUPLICATE_PRESENT`, `TOMBSTONE_SUPPRESSED`, and the failure dispositions —
  and the 4.62.x INGEST-ack to the forwarder is a transport-facing exit
  effect derived from that result, not a `TopicStore` effect. The
  success-equivalent dispositions produce the idempotent ack; validation,
  authorization, authority-fence, and malformed-message failures do not. The
  shipped sender-and-incarnation binding is preserved in the mapping, and
  INGESTED evidence stays distinct from RETAINED/COMMITTED evidence.
- **`TopicDeliveryTree`** — owns subscriber and child maps, seating and
  renewal, replay-on-seat, child delegation, upstream attachment and rehome,
  fan-out and duplicate suppression at the delivery boundary, and branch
  teardown/transfer during graceful drain. The routing plane keeps paths,
  lookups, and synapses — not subscriber ownership (§4.1).

No extraction changes a wire format or a public signature. Extraction changes
ownership and test boundaries first; behavior changes are separate commits
with separate proofs.

### 4.6 Structural laws

Three rules graduate from prose to enforced structure, each carrying the
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
master timer's creation and teardown; `TopicControl` owns the meaning and
transitions of topic deadlines. Later timekeeper heartbeats and election
deadlines become additional typed obligations in the same scheduler — never a
competing timing subsystem.

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
| Topic placement | placement authority under `TopicControl` | placement record | named transition effects |
| Capability/admission | `RoleAdmission` subpolicy | capability record | accept/decline/drain effects |
| Topic data | `TopicStore` | cache/tombstones/stamp high-water/digest | none beyond local mutation |
| Write processing | `WriteIngress` | bounded pending write record | `StampAuthority`, store, durability, delivery, ingest-ack emission |
| Stamp issuance | `StampAuthority` | current authority clock/sequence | returns stamped entry only |
| Subscriber forest | `TopicDeliveryTree` | subscribers/children/upstream | SUB/DELIVER/replay/rehome |
| Repair/state transfer | `SyncEngine` | policy/flight ledger | router plus `TopicStore` import/export |
| Durability | `DurabilityLedger` | evidence state per message | no delivery mutation |
| Authority discovery | `TopicLocator` | observed service view (serving ≠ retention, per §4.3 E2) | lookup/beacon adapters |
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
  source/epoch-bound ingest-ack acceptance AND rejection; full-snapshot
  versus keepalive durability evidence; duplicate and reordered stamped
  ingest; bridge-as-routing-only behavior. A static ownership map: every
  per-topic state field, timer, and frame type named to exactly one §4.9
  owner — placement, retention/store, delivery tree, stamp authority, sync
  evidence, or capability/admission — with an inventory of every
  singleton-root assumption. A reliability ledger separating implemented
  behavior, known defect, and future design requirement (the reconnect flake
  #423 and the buildAxonTree flake #402 enter as named deviations; the 4.62.x
  live-gate evidence enters as protected fixtures per §2.1).
- **Exit criteria.** Every incident in the §2.1 ledger is covered by a
  falsifiable fixture; tests include duplicate, reorder, rejection,
  cancellation, and teardown paths; browser/WebRTC and bridge evidence is
  recorded alongside simulator evidence. Phase 0 tests assert singleton-root
  behavior; their added value is showing which component owns each fact.

### Phase 1 — Contract registries in shadow mode (milestone M1)

- **Deliverables.** All four boundaries' frames registered with schemas, frame
  kinds, and guards; validation and tracing in report mode; zero change to
  acceptance behavior; ambiguous handler ownership resolved or recorded as a
  named exception. Each applicable row additionally declares: owning service
  from the §4.9 map; authority reference shape; evidence level produced and
  required (§4.3); exact correlation fields; whether the response proves
  routing, ingestion, or retention; capability/version range; bounded
  payload/work budget; idempotency key; terminal negative outcome.
  *Catalogued* is not *enforcement-ready*: a family's registry row governs
  dispatch only after that family's own migration proof.
- **M1 canary.** Telemetry-only on the testnet droplet. Health criteria:
  trace/error distributions match the Phase 0 baseline. Rollback: disable the
  wrapper flag — no protocol rollback exists because no protocol changed.

### Phase 2 — Façade and service decomposition (milestone M2)

- **Deliverables.** The §4.5 services extracted behind the unchanged
  `AxonaPeer` façade — including the named seams `TopicStore`, `WriteIngress`,
  `StampAuthority` (current singleton-root implementation),
  `TopicDeliveryTree`, `TopicLocator`, and the `RoleAdmission` policy;
  teardown tests proving zero orphan timers, listeners, channels, or stale
  readiness state; versioned persistence envelope with read-old/write-new
  compatibility. Differential traces prove the extracted write pipeline
  preserves validation, stamp, cache, durability, delivery, renewal, and
  teardown order — and the ingest-ack emission behavior on every disposition.
- **M2 canary.** Testnet droplet bridge plus browser peers. Health criteria:
  differential traces match Phase 0; memory flat; `meshBoundCount()` stable.
  Rollback: prior composition at the recorded ref.

### Phase 3 — Placement lifecycle authority (milestone M3)

- **Deliverables.** `rootClaim` generalized to arbitrate every *local
  placement* mutation — not all future cohort, storage, delivery, and
  timestamp behavior. Placement, retention, delivery ownership, and stamp
  authority remain separate concepts (§4.2); `ROOT | CHILD | BACKUP` remains
  the compatibility implementation, not a closed universe. Transition records
  carry an extensible `AuthorityRef`, not hard-coded root identity fields;
  capability/admission gates are consulted before planting remote standing
  state; ordinary placement changes mutate the topic store or subscriber
  forest only through named effects. Contract guards reject illegal
  transition/frame combinations; mixed-version compatibility is stated before
  any changed frame semantics. No `CohortControl` and no timekeeper election
  state is created in this phase.
- **M3 canary.** Testnet under churn, partition, reconnect, root migration,
  and stale-state restoration, with mixed old/new peers. Health criteria:
  transition telemetry shows convergence and no unbounded repair loop.

### Phase 4 — Sync engine sole ownership (milestone M4)

- **Deliverables.** Remaining repair emissions migrate into `syncEngine`
  policy rows, one family at a time, each with duplicate/reorder tests; rows
  declare initiator/counterpart relationship, summary strategy (§4.4),
  evidence produced, receipt/correlation rule, terminal negative outcome,
  state planted and its evictor, and retry/work bounds; snapshot and delta
  construction move behind `TopicStore`; Principal-Liveness transition
  records enforced on every remote-state write; hot paths untouched.
  `COHORT_REPLICATE` wire behavior is unchanged; internally, root-pushes-
  passive-backup stops being the only representable cohort relationship. Any
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
  current root epoch from the generic authority-incarnation concept;
  heuristic sync summaries from exact evidence; the current singleton locator
  response from the versioned service view. It permits a later profile such
  as `root-cohort-v1` and publishes no unimplemented triumvirate frames or
  states.
- **M5.** Progressive production canary — expand or roll back on named
  indicators. Version: testnet increments ride `4.62.x+`; the completed
  restructure, if David judges it warranted, is `v5.0.0`. David's explicit
  approval gates every step of this milestone.

### 5.1 Triumvirate-readiness exit conditions

The refactor is ready for the later triumvirate project when all of the
following hold. They are exit conditions for the refactor as a whole, checked
at Phase 5; none of them requires triumvirate behavior to exist:

1. No wire handler directly allocates a root stamp, mutates a cache, and fans
   out in one uninterruptible method.
2. `TopicStore` can import/export stamped state without knowing the node's
   placement.
3. `TopicDeliveryTree` can rehome a subscriber forest without changing stamp
   authority.
4. `StampAuthority` can be replaced without changing envelope validation,
   storage, or delivery interfaces.
5. Write-flight and receipt correlation use the versioned `AuthorityRef`
   internally, with algebraic UNVERSIONED semantics preserved.
6. Registry outcomes distinguish routed, ingested, retained, and committed
   evidence; committed levels count retention-capable holders, and the
   service view keeps serving and retention distinct (E1/E2).
7. Sync summaries are policy-selected; no heuristic is labeled universal
   equality proof; RESERVED strategies are unselectable.
8. Lookup returns bounded candidate sets and supports eligibility/admission
   filtering.
9. Root service, retention, delivery-tree ownership, and stamp authority have
   separate owners in the static ownership map.
10. All current singleton-root behavior remains covered by differential
    traces and mixed-version tests.
11. No triumvirate wire behavior or state exists in the shipping refactor
    unless separately authorized.

Without these, the triumvirate project would reopen `rootClaim`,
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

## 7. Initial work breakdown

Implementation is axona.bot's (standing rule: only the chief programmer
changes kernel code); Orion and Aster review each item's design and evidence;
David decides each deployment.

| ID | Task | Completion evidence |
|---|---|---|
| REF-0.1 | Inventory: frames, state fields, timers, repair emissions, API surface, singleton-root assumptions | versioned inventory committed, council-reviewed |
| REF-0.2 | Golden traces + reliability ledger (incl. readiness trace set + 4.62.x protected fixtures) | deterministic fixtures; §2.1 ledger fully covered |
| REF-0.3 | Static ownership map per §4.9 | every field/timer/frame → one owner, no orphans |
| REF-1.1 | Registry types + shadow wrappers, four boundaries, evidence levels + correlation fields | report-mode telemetry on testnet, zero behavior change (M1) |
| REF-2.1 | `PeerLifecycle` extraction + teardown proofs | API parity; zero leaked resources |
| REF-2.2 | Router/lookup/synaptome/messaging/persistence extraction | differential-trace parity (M2) |
| REF-2.3 | `TopicStore` + `WriteIngress`/`StampAuthority` pipeline + `TopicDeliveryTree` + `TopicLocator` seams | pipeline differential traces incl. ack dispositions (M2) |
| REF-3.1 | Placement/retention transition table + authority, `AuthorityRef` in transition records | row-level normal and negative tests (M3) |
| REF-4.1 | Repair families → `syncEngine`, one at a time, with summary-strategy rows | policy row + churn evidence per family (M4) |
| REF-5.1 | Normative contracts + conformance vectors, profile language | independent harness passes fixtures; §5.1 exit conditions all green (M5) |

## 8. Decisions requested from David

1. Final agreement on this v2 plan (final review round — closes on your word).
2. Authorization to begin Phase 0.
3. Confirmation of the standing governance: council reviews design and
   evidence at each milestone; you decide every deployment; a post-mortem
   after each phase revises the remainder of the plan.

---

*Collated by axona.bot from the three council assessments, the cross-review
record, and Aster's triumvirate-readiness review with its council Q&A (Q1/Q2
confirmed, A1 accepted — seq 458–462). Orion's structural framing, Aster's
phase and evidence discipline, the readiness amendments, and the
implementer's code-grounded corrections are all load-bearing here; the
disagreements the council opened were closed by code citation, and the
citations are preserved above.*
