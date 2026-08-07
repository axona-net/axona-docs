# Axona Kernel Refactor — Master Plan

**File:** `axona-docs/architecture/code-refactor-plan.md`
**Collator:** axona.bot (chief programmer), by unanimous council vote, David's designation (#council, 2026-08-07)
**Sources:** `axona.bot-Redesign-Plan.md`, `Aster-Protocol-Refactor-Plan.md`, `Orion-Redesign-Plan.md`, `code-refactor-plan-draft-orion.md` (Orion's first collation, kept as secondary reference), and the council cross-review thread (#council seq 381–392)
**Status:** FINAL DRAFT — shared with the council and David for final agreement before Phase 0 begins
**Scope:** the kernel, `axona-protocol/src`. Relay, bridge, and apps are consumers of the kernel and are touched only where a phase's canary requires them.

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
to make their discipline universal.

The failure mode to fear is a clean diagram that silently drops the
leave-order fix, the handoff-liveness gate, or the split-history union. Each of
those cost a diagnosed production incident to learn. The plan below is built so
that losing one of them fails a test, not a user.

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
- **Where code lives.** Nine top-level modules under `src/` — `contracts`,
  `crypto`, `dht`, `identity`, `persistence`, `pow`, `pubsub`, `transport`,
  `utils` — about 22.4K lines total (measured 2026-08-07, `wc -l` over
  `src/**/*.js`).

## 2. The problem, measured

The nine-module split is sound. The debt sits in two god-objects and one
asymmetric dispatch surface; nothing else in the tree is structurally alarming.
Line counts below were measured 2026-08-07 at kernel v4.61.0:

| Surface | Lines | What it wrongly owns |
|---|---|---|
| `dht/AxonaPeer.js` | 4,422 | lifecycle, join/integrate, persistence, the public pub/sub API, direct messaging, greedy routing, lookup, relay maintenance, metrics, eventing |
| `pubsub/repairPlane.js` | 1,220 | repair triggers, retries, and emissions |
| `pubsub/AxonaManager.js` | 1,112 | topic state, election, wire handling, sync |
| `pubsub/wireHandlers.js` | 939 | frame registration without a single contract |

The pub/sub trio totals 3,271 lines and is prototype-composed, so ownership
and precedence cannot be read from any one file. The rest of the tree —
transports included — is heavy in places but coherent: one file, one concern.

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
| write-liveness, #422 (open) | PUB defers to an unreachable root; a publish can report a msgId yet never propagate | every effect path reports an observable outcome. Phase 0 owes this row a reproducible trace; until then the evidence is the 2026-08-06 #council publish (msgId `6112103f…`, confirmed:false, absent from the thread) |

The common shape: individually-correct mechanisms interacting through a second
entry path. The target is fewer places a decision can be made, not fewer lines.

## 3. What already exists — extend, do not rebuild

Two consolidations shipped in the v0.2 refactor (kernel ≈4.26–4.29) and run in
production today. They are the exemplars David's directive points at, and any
plan that schedules "building" them is scheduling the reconstruction of
working code:

- **`pubsub/rootClaim.js` (379 lines)** — the single transition authority for
  root placement. Every flip of `role.isRoot` passes through one `_set()` with
  one structured log per flip. Its header states the shipped role model:
  *"A role acts in exactly one PRIMARY nature — ROOT, BACKUP, or CHILD — plus
  an orthogonal HOLDER flag"* (`rootClaim.js:38-39`).
- **`pubsub/syncEngine.js` (13 KB)** — a frozen, typed policy table already
  owning seven repair verbs: `REPLAY_UP`, `SPLIT_UNION`, `EMPTY_ROOT_PROBE`,
  `COHORT_REPLICATE`, `UNION_AT_ROOT`, `HANDOFF`, `PUB_DURABLE` — each row
  carrying mode, verb, ledger, and rate bound.

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
| Placement & control authority (generalized `rootClaim`) | topic lifecycle, placement/retention *transition policy*, election | the retained data itself (the topic store owns that), transport establishment, repair data movement |
| DHT/routing plane | synaptome, greedy routing, lookup, tree maintenance | authorization, persistence formats |
| Transport / auth / persistence | live authenticated channels, frame I/O, durable storage mechanics | topic placement, repair semantics |
| Per-boundary contract registries | frame validation, tracing, correlation contracts | handler business logic |

### 4.2 The two-dimensional role model

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

A placement transition is legal only with a **transition record** naming its
preconditions, durable writes, emitted effects, idempotency key, any remote
standing state, and its eviction/rollback path.

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
relationship, payload contract, retry/backoff bound, convergence or terminal
condition, and metric outcome. Signature equality (`count : hw : tombstones`)
is the universal quench that stops replication loops.

Hot-path `DELIVER` fan-out and seat replay stay outside the engine. They carry
latency and ordering obligations that anti-entropy repair does not, and moving
them for uniformity's sake would risk a delivery regression. They move only if
a later design brings its own semantic contract, differential-trace evidence,
and rollback plan.

### 4.5 Façade decomposition of `AxonaPeer`

`AxonaPeer` keeps every public signature (`sub`, `pub`, `pull`, `connect`,
`leave`, `host`, `snapshot`, `fromSnapshot`, …) and becomes a composition of
named services:

- `PeerLifecycle` — start/stop/join/leave/readiness, and cancellation
  ownership: every interval and listener has one owner and one teardown.
- `GreedyRouter` and `LookupService` — routing and α-parallel K-closest.
- `SynaptomeManager` — synapse lifecycle and `meshBoundCount()`, the
  live-channel count the v4.61.0 connect gate already reads.
- `PeerMessaging` — direct messaging and event bridging.
- `PeerPersistence` — versioned snapshot envelopes, migrations, restore
  boundaries.
- `TopicControl` — the placement authority's per-peer face.

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
  in code, not implied by statement order.

### 4.7 Documentation model

Four artifacts, kept deliberately separate: architecture rationale (why the
system is shaped this way); the normative protocol contract (frames, states,
guards, errors — generated from the registries in Phase 5); the public API and
deployment reference; and the conformance suite. One invariant catalogue —
`Axona-Architecture.tex` §XII (I-1…I-18, S1–S6) — and every other document
links to it. `INVARIANTS.md` stays a pointer.

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
  duplicate/reorder/rejected frames, and teardown. A static ownership map:
  every state field, timer, and frame type named to exactly one proposed
  owner. A reliability ledger separating implemented behavior, intended
  behavior, and known deviations (the reconnect flake #423 and the buildAxonTree
  flake #402 enter here as named deviations, not waived noise).
- **Exit criteria.** Every incident in the §2.1 ledger is covered by a
  falsifiable fixture; tests include duplicate, reorder, rejection,
  cancellation, and teardown paths; browser/WebRTC and bridge evidence is
  recorded alongside simulator evidence.

### Phase 1 — Contract registries in shadow mode (milestone M1)

- **Deliverables.** All four boundaries' frames registered with schemas, frame
  kinds, and guards; validation and tracing in report mode; zero change to
  acceptance behavior; ambiguous handler ownership resolved or recorded as a
  named exception. *Catalogued* is not *enforcement-ready*: a family's
  registry row governs dispatch only after that family's own migration proof
  (Phase 1 ships the catalogue; enforcement migrates per family, later).
- **M1 canary.** Telemetry-only on the testnet droplet. Health criteria:
  trace/error distributions match the Phase 0 baseline. Rollback: disable the
  wrapper flag — no protocol rollback exists because no protocol changed.

### Phase 2 — Façade decomposition (milestone M2)

- **Deliverables.** The §4.5 services extracted behind the unchanged
  `AxonaPeer` façade; teardown tests proving zero orphan timers, listeners,
  channels, or stale readiness state; versioned persistence envelope with
  read-old/write-new compatibility.
- **M2 canary.** Testnet droplet bridge plus browser peers. Health criteria:
  differential traces match Phase 0; memory flat; `meshBoundCount()` stable.
  Rollback: prior composition at the recorded ref.

### Phase 3 — Placement-lifecycle authority (milestone M3)

- **Deliverables.** `rootClaim` generalized to arbitrate every placement
  mutation; retention changes explicit and orthogonal; transition records
  (§4.2) required; contract guards rejecting illegal transition/frame
  combinations; mixed-version compatibility stated before any changed frame
  semantics.
- **M3 canary.** Testnet under churn, partition, reconnect, root migration,
  and stale-state restoration, with mixed old/new peers. Health criteria:
  transition telemetry shows convergence and no unbounded repair loop.

### Phase 4 — Sync engine sole ownership (milestone M4)

- **Deliverables.** Remaining repair emissions migrate into `syncEngine`
  policy rows, one family at a time, each with duplicate/reorder tests;
  Principal-Liveness transition records enforced on every remote-state write;
  hot paths untouched.
- **M4 canary.** Extended testnet soak: churn, bridge reconnect, mesh repair,
  root migration, durable handoff. Recurring flakes are blocking defects.

### Phase 5 — Normative specification and production decision (milestone M5)

- **Deliverables.** The registries published as the normative wire contract
  with machine-readable conformance vectors; an independent harness consumes
  the fixtures and reaches the expected outcomes; compatibility and migration
  policy frozen.
- **M5.** Progressive production canary — expand or roll back on named
  indicators. Version: testnet increments ride `4.62.x+`; the completed
  restructure, if David judges it warranted, is `v5.0.0`. David's explicit
  approval gates every step of this milestone.

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
ones; real transports never require simulator-only global knowledge.

## 7. Initial work breakdown

Implementation is axona.bot's (standing rule: only the chief programmer
changes kernel code); Orion and Aster review each item's design and evidence;
David decides each deployment.

| ID | Task | Completion evidence |
|---|---|---|
| REF-0.1 | Inventory: frames, state fields, timers, repair emissions, API surface | versioned inventory committed, council-reviewed |
| REF-0.2 | Golden traces + reliability ledger | deterministic fixtures; §2.1 ledger fully covered |
| REF-0.3 | Static ownership map | every field/timer/frame → one owner, no orphans |
| REF-1.1 | Registry types + shadow wrappers, four boundaries | report-mode telemetry on testnet, zero behavior change (M1) |
| REF-2.1 | `PeerLifecycle` extraction + teardown proofs | API parity; zero leaked resources |
| REF-2.2 | Router/lookup/synaptome/messaging/persistence extraction | differential-trace parity (M2) |
| REF-3.1 | Placement/retention transition table + authority | row-level normal and negative tests (M3) |
| REF-4.1 | Repair families → `syncEngine`, one at a time | policy row + churn evidence per family (M4) |
| REF-5.1 | Normative contracts + conformance vectors | independent harness passes fixtures (M5) |

## 8. Decisions requested from David

1. Final agreement on this plan (this round — Part 3 closes on your word).
2. Authorization to begin Phase 0.
3. Confirmation of the standing governance: council reviews design and
   evidence at each milestone; you decide every deployment; a post-mortem
   after each phase revises the remainder of the plan.

---

*Collated by axona.bot from the three council assessments and the
cross-review record. Orion's structural framing and first collation, Aster's
phase and evidence discipline, and the implementer's code-grounded
corrections are all load-bearing here; the disagreements the council opened
were closed by code citation, and the citations are preserved above.*
