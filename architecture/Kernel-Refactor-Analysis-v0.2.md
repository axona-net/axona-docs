# Kernel Refactor Analysis & Proposal — v0.2

**Date:** 2026-07-16 · **Subject:** `@axona/protocol` kernel pub/sub planes ·
**Line:** 4.24.1 · **Supersedes:** v0.1 (2026-07-11) — v0.1's Phases 0–2 are done
and its status ledger is folded into §1 here.

**Thesis:** v0.1's diagnosis was correct and its prescription worked — where it
was applied. The root-claim consolidation (Phase 1) killed the wrong-root bug
class outright: not one incident since 4.20.0 has been a bad `isRoot` flip.
But v0.1's catalog B — "move/repair topic data," ~7 mechanisms then — was
explicitly deferred, and **every incident since has been a catalog-B incident**,
including two testnet backbone collapses. Catalog B is now 11 mechanisms. This
document does for the data plane what Phase 1 did for the claim plane: names
the one concept the mechanisms are circling, defines the model, and lays out a
phased consolidation. It also specifies the architecture-doc revision, because
the audit (§5) found the current doc would lead a careful engineer to
*reintroduce* the exact bug that collapsed the backbone.

---

## 1. What happened since v0.1 — the incident locus moved, as predicted

| Release | Fix | Catalog | New mechanism added |
|---|---|---|---|
| 4.22.0 | split-history union | B | lw-advertisement + root pulls older half |
| 4.22.1 | lw-pull refire storm | B | one-shot `pulledLw` guard |
| 4.23.2 | leave() drain pin | D | stall-exit in the drain |
| 4.24.0 | empty-self-root misses | B | birth/sweep cohort probe (PULLUP sinceHw:0) |
| 4.24.0 | handoff fire-and-forget | B | HANDOFFACK + retry rounds + cohort spray |
| **4.24.0** | **— REGRESSION —** | **B×B×B** | **spray × backup-subscribe × per-tick replication → backbone collapse (#333)** |
| 4.24.1 | the collapse | B | spray → single alt-HANDOFF; delta-gated replication; ingest yield |

v0.1, §5: *"Open behavioral work … stays on the punch list and gets easier
after Phase 1–2, because it will land in one decision table instead of an
eighth patch site."* That held for root claims. For data movement there **is
no decision table** — so each fix landed as an 8th, 9th, 10th, 11th
independent mechanism, and 4.24.0's collapse was three of them composing.
Each was individually correct and tested. The interaction was the bug. That is
the structural signal, again, one plane over.

The v0.1 phase ledger: Phase 0 (INVARIANTS.md + constants audit) ✅ 4.19.6 ·
Phase 1 (rootClaim state machine) ✅ 4.20.0 · Phase 2 (manager split into
planes) ✅ 4.21.0 · Phase 3 (AxonaPeer diet) and Phase 4 (constants→policy)
remain open and are re-sequenced in §7.

## 2. The system as it actually is — 38 mechanisms

A fresh full inventory (2026-07-16, against 4.24.1) counts **38 distinct
mechanisms** across the pub/sub planes — every periodic loop, reactive repair,
retry path, and state-machine rule. The full inventory with file:line anchors,
state touched, constants, and protected invariants is Appendix A. The shape:

| Group | Mechanisms | Consolidated? |
|---|---|---|
| Scheduler | 1 (refreshTick owns all periodic work) | ✅ yes (Phase 2) |
| Renewal / attachment | 4 | mostly (one interval model) |
| **Root durability / data movement** | **11** | **no — the gap** |
| Publish/kill reliability | 3 | no (3 loops over 1 map) |
| Election / convergence | 7 | ✅ yes (rootClaim + rootElection) |
| Departure / liveness | 2 | yes |
| Wire ingest | 7 | ingest side yes (`_ingestStamped`); emission side no |
| Tree shape / replay / delivery | 5 | yes |
| Metrics / region / pull / bounds | 4 | yes |

The 11-mechanism data-movement group shares three different per-role guard
fields (`pulledLw`, `probeTries/probeAt`, `replSig/replLastFull`), five
different quench rules, and four trigger classes — all protecting one
invariant family ("history survives membership change; late readers recover
it"). The ingest side is already unified: everything funnels through
`_ingestStamped` (verify → dedup → tombstone-first → stamp-preserving). The
emission side is where the mechanisms multiply.

## 3. The model — a topic is a replicated stamped set; there is ONE data operation

**The concept every catalog-B mechanism is circling:**

> A topic's state is a **stamped set** — cache entries totally ordered by the
> root's stamps, plus tombstones. Nodes hold **views** of the set. The only
> data operation in the system is **`sync(a, b, topic)`: make two views
> converge** — compare summaries, transfer what's missing, union-ingest.

Every mechanism in the group is `sync` with a different *policy* (who, when,
which direction):

| # | Mechanism today | initiator ↔ counterpart | trigger | direction |
|---|---|---|---|---|
| 1 | fan-out (DELIVER) | root → subscribers | on stamp | push (delta=1) |
| 2 | replay-on-subscribe | root → child | on seat/renewal | push (since-floor) |
| 3 | hw replay-up | root ← child | SUB advertises hw>mine | pull (delta) |
| 4 | lw split-union pull | root ← child | SUB advertises lw<mine | pull (full, one-shot) |
| 5 | empty-root probe | root ← cohort+path | on root birth, while empty | pull (full, ≤3) |
| 6 | cohort replication sweep | root → K-closest | tick (delta-gated) | push (full/keepalive) |
| 7 | eager on-stamp/on-kill | root → K-closest | on state change | push (full) |
| 8 | graceful handoff | leaver → heir | on leave() | push (full, acked) |
| 9 | union-at-root | (ingest side of 6/8) | REPLICATE arrives at a root | ingest |
| 10 | pull early-answer | reader ← nearest replica | on demand | pull (point) |
| 11 | tombstone re-send | root → subscriber | every renewal | push (dels) |

**Everything in the trigger/direction columns is policy. Everything else is
the same operation.** The 4.24.1 delta signature (`count:hw:tombstones`) is
already the summary half of a generic sync: two views whose signatures match
exchange nothing. The consolidation (§7 Phase 7) is a single **sync engine** —
one summary-exchange, one quench rule (signature equality), one per-pair rate
bound, one guard ledger — with the table above as a declarative policy list.
The wire does not change: the existing verbs (DELIVER, PULLUP, REPLAYUP,
REPLICATE, HANDOFF) *are* the sync engine's transport; only the emission-side
decision logic consolidates.

What this buys, concretely:

- A new durability requirement becomes a **policy row**, not a 12th mechanism
  with its own guard field, quench rule, and interaction surface.
- The #333 class becomes impossible **by construction**: syncs are idempotent
  and converge to a fixpoint; a signature-matched pair is a no-op; per-pair
  rate bounds are engine-level, not per-mechanism afterthoughts.
- The kill-leak class stays dead structurally: tombstones ride the summary,
  not each mechanism's memory to include them.

## 4. Roles need explicit lifecycle states — the #333 bug was an unmodeled state

A role today encodes its nature across five booleans/fields spread over three
maps: `isRoot`, `backupOf`, membership in `_backupTopics`, `_hostedTopics`,
`mySubscriptions`. The #333 orphan-backup was a **state nobody had modeled**:
`BACKUP whose principal is dead` — reachable through a code path (departure
spray) that no invariant covered, self-perpetuating because the backup's
obligations (subscribe every tick) ran regardless of the principal's
liveness.

The model: a role is in exactly one of four states, each with named
obligations and a named **eviction path**:

| State | Meaning | Obligations | Evicted by |
|---|---|---|---|
| ROOT | routing terminus, stamps | beacon, verify, replicate-to-cohort, serve | demote (closer live root) / idle sweep |
| CHILD | relay in the tree | renew upstream, re-fan | subscriber loss + idle sweep |
| BACKUP | warm copy for a **live** principal | subscribe (election standby) | principal gone + re-homed + `BACKUP_EVICT_MS` |
| HOLDER | host()/app-pinned cache | renew + advertise hw | unhost / TTL |

And the rule the collapse paid for, stated once as an architectural law rather
than buried in a Phase-C comment:

> **The principal-liveness rule.** Standing state on another node may only be
> planted by a principal that is alive to maintain it. A departing node
> transfers principal-ship (HANDOFF) or does nothing; it never plants
> maintenance-requiring state (REPLICATE). Every mechanism that writes remote
> state must name, in the same change, the eviction path for that state.

Phase 8 (§7) makes the state explicit in `makeRole` and extends the rootClaim
transition table to cover BACKUP/HOLDER transitions, so an unmodeled state
becomes a type error in review rather than a 3 a.m. collapse.

## 5. The architecture document — audit verdict

Audited `Axona-Architecture.tex` (self-labeled v4.21.0) against 4.24.1. Full
audit in Appendix B. Summary:

- **Roughly half stands** and is genuinely good: the root-claim state machine
  and its transition table, defer gates and evidence tiers, beacons,
  self-verification, region model, identity/addressing.
- **Stale where it matters most:** replication is described as "full
  cache+tombstones to the cohort **every tick** … idempotent full-state push
  doubles as anti-entropy" — precisely the behavior 4.24.1 removed *for
  collapsing the backbone*. Handoff is described fire-and-forget; the
  HANDOFFACK verb, retry rounds, and fallback don't exist in the doc.
- **Missing entirely:** all four 4.22–4.24.1 convergence mechanisms
  (lw split-union, union-at-root, empty-root probe, delta keepalives) and the
  principal-liveness rule.
- **The dangerous part:** the doc's stated philosophy — *"wrong claims that
  self-correct are cheaper than coordination"* plus full-state push framed as
  cheap idempotent anti-entropy — reads as an endorsement of exactly the
  departure spray that caused #333. An engineer extending the system from
  this doc would have written the 4.24.0 bug **because of** the doc, not
  despite it.
- **The missing invariant:** nothing in the doc (or INVARIANTS.md) states
  bounded-state-under-churn — the property both collapses violated.

The revision is therefore not a re-render but a model correction (§7 Phase 5):
replace the per-mechanism §VIII catalog with the §3 sync model + policy table,
add the §4 role-lifecycle and principal-liveness rule, fix S-1/S-2 staleness,
and grow the "traps" section into real interaction rules.

## 6. New invariants (paid for; tests exist)

**I-10 — Standing state is bounded by demand, never by churn history.**
Per-topic standing state anywhere in the network is O(subscribers + cohort).
No mechanism may create state that accumulates with join/leave *events*; any
write of remote standing state names its eviction path in the same change.
(The #332/#333 collapses; the 4.22.1 winner over 4.24.0 was exactly this
property.) — enforced by `smoke_churn_amplification.mjs` (ack-dropped
burst-publisher churn: zero departure REPLICATE, bounded roles, durability
retained) and `smoke_root_replication.mjs` (delta gate: keepalive when
unchanged).

**I-11 — Bulk work never starves liveness.**
Any loop ingesting or emitting unbounded batches yields to the macrotask queue
at a fixed stride, so heartbeats and liveness traffic interleave; a node must
never be evicted by its peers *because* it was absorbing history.
(The #332 join-storm: bulk ingest → missed heartbeats → mass eviction →
`state=stale`.) — enforced by the `_ingestStampedBatch` yield; full mesh
re-bootstrap hardening tracked in #332.

## 7. The v0.2 program — five phases, each independently shippable

Method unchanged from v0.1: behavior-preserving unless explicitly flagged,
public API and wire unchanged, full suite + churn smoke + axonSpec + one soak
pass identically per phase, one phase per release. *Refactor under test,
never rewrite.*

- **Phase 5 — Contract & doc refresh (S, no code). ✅ DONE 2026-07-16.**
  INVARIANTS.md gained I-10/I-11; the architecture doc was revised per §5
  (sync model + policy table, role natures + principal-liveness rule,
  S-1/S-2 fixed, M-1…M-5 added, philosophy bounded, traps 2→4), re-versioned
  to v4.24.1, rendered, archived. *Writing it also re-sequenced the phases
  below: making every element load-bearing exposed that the policy table is
  TYPED BY ROLE NATURES — so natures must exist in code before the engine
  that declares policies over them, and the hot delivery path doesn't belong
  in the engine's first cut at all.*

- **Phase 6 — Small consolidations + coherence guards (M).**
  (a) The three publish-retry mechanisms ([10]+[11]+[12] in Appendix A: pending
  retry, cold burst, first-publish resend) become one retry policy over
  `_pendingPub` with a variable schedule — three timers become one.
  (b) The three per-role guard fields (`pulledLw`, `probeTries/probeAt`,
  `replSig/replLastFull`) merge into one per-(peer,topic) **sync ledger**
  implemented with the engine's semantics from the start (per-pair summary +
  signature quench) — the guards are where quench bugs (4.22.0 storm) live.
  (c) **Doc↔code coherence guards** (added by Phase 5's lesson — the doc
  rotting into a bug-generator was the root failure): an emission-site lint
  asserting `REPLICATE` is sent from exactly one path (the live-root
  replication sweep — a reintroduced departure spray fails CI, not a fleet),
  and a normative-constants smoke asserting the doc's timing table matches
  `constants.js`. Behavior-preserving; suite is the arbiter.

- **Phase 7 — Explicit role natures (M; was Phase 8a).** `role.state ∈
  {ROOT, CHILD, BACKUP, HOLDER}` with the obligation/eviction table now
  normative in the architecture doc §VIII; rootClaim's transition table
  extended to cover all four natures. Sequenced BEFORE the engine because
  the engine's policy rows are typed by nature (each row names the nature it
  creates on the receiver + its evictor, per the principal-liveness rule) —
  building the engine on the five-field smear would rebuild on the diagnosed
  fault.

- **Phase 8 — The sync engine, repair side (L, the payoff; was Phase 7,
  narrowed).** One `sync(peer, topic, policy)` operation implementing
  summary-exchange over the existing verbs, consolidating the SIX
  repair/durability policies: replay-up (hw), split-union (lw), empty-root
  probe, cohort replication, handoff, union-at-root. The hot delivery path
  (fan-out, replay-on-seat) is explicitly OUT of the first cut: it is
  high-rate, latency-sensitive, its quench machinery (exactly-once dedup,
  since floors) is already unified in topicStore, and no incident has ever
  lived there — it joins later only if it earns its way in. Engine-level
  per-pair rate bounds + signature quench. Gate: full suite +
  `smoke_churn_amplification` + axonSpec + soak A/B vs 4.24.1.

- **Phase 9 — #332 hardening as per-state obligations (M; was Phase 8b).**
  Mesh re-bootstrap after mass eviction and ingest admission caps land as
  obligations of the natures they protect (a BACKUP/CHILD absorbing bulk
  history; a node whose peers evicted en masse) rather than free-floating
  mechanisms — which is only possible once Phase 7's natures exist.

- **Phase 10 — v0.1's deferred Phases 3–4** (AxonaPeer diet + two-transports
  unification; constants → policy groups), unchanged in scope, sequenced
  last because the data-plane risk is retired first.

Sequencing note: the 4.24.1 promotion decision (pending its soak verdict) is
independent of this program — 4.24.1 is the stable baseline the program
refactors *from*. Howard's alert-bot + axonSpec remain the external acceptance
at every phase, as in v0.1.

## 8. What this is not

Unchanged from v0.1: not a rewrite, not a protocol redesign, no flag day, and
no behavior changes smuggled in "while we're in there." The sync engine is a
consolidation of eleven proven mechanisms into one implementation of the thing
they all already do — with the suite, the churn smoke, and the live gates
proving equivalence at every step.

---

## Appendix A — Full mechanism inventory (4.24.1, 2026-07-16)

Thirty-eight mechanisms, grouped; each with trigger, state, constants, and the
invariant it protects. File:line anchors verified against the 4.24.1 tree.

### A. Scheduler
1. **refreshTick** — `repairPlane.js:27`; setInterval 5s; the single periodic
   driver for renewal, replication, probes, retries, metrics, sweeps, beacons,
   verify. All periodic repair lives behind one timer (Phase 2 property).

### B. Renewal / attachment
2. **Adaptive renewal + backoff** — `repairPlane.js:30-70`; RENEW_FAST 5s →
   ×1.5 → RENEW 60s ceiling; renewal doubles as keepalive, failure detector,
   and gap-recovery carrier (since/hw/lw).
3. **Unattached fast-renew + reachable-root claim** — `repairPlane.js:53-61`,
   `rootClaim.claimReachable`; ROOT_CLAIM_MS 6s; a strand never waits on an
   unreachable closer node.
4. **Renewal-clock reset (re-home trigger)** — three reactive writers:
   `_onDeliver` relay change, `pubsubPeerDied`, `pubsubSubscribe`.
5. **Hosted-topic re-announce** — `repairPlane.js:71-78`; hosts advertise hw so
   fresh roots pull their held history.

### C. Root durability / data movement (the consolidation target)
6. **Cohort replication sweep, delta-gated** — `_replicateRoles/_replicateRole`
   `repairPlane.js:202,303`; ROOT_REPLICAS 2; full push only on signature
   change / new member / 60s backstop, else keepalive (4.24.1).
7. **Backup subscribe loop + eviction** — `repairPlane.js:92-107`;
   BACKUP_EVICT_MS 60s; election-by-subscription (4.18.2).
8. **Empty-root probe (birth + sweep)** — `repairPlane.js:219-289`; delay
   800ms, ≤3 tries, fanout 4; PULLUP(sinceHw:0) cohort + lookup path (4.24.0).
9. **Graceful-leave handoff A/B/C** — `pubsubLeaveHandoff`
   `repairPlane.js:436`; parallel heir resolution; HANDOFF_TRIES 2 ×
   HANDOFF_ACK_MS 700 shared windows; fallback = ONE alt-HANDOFF, never
   REPLICATE (4.24.1, the principal-liveness rule).

### D. Publish/kill reliability
10. **Pending pub/kill retry** — `repairPlane.js:109-127`; TTL 30s, 6 tries;
    idempotent re-send toward the current root hint.
11. **Cold-publish burst + first-publish resend** — `repairPlane.js:359-385`;
    5×200ms + 5×400ms waves below COLD_PEER_THRESHOLD 8.
12. **Implicit-ack confirm** — `_confirmPending` `repairPlane.js:397`; the only
    publish confirmation is observing one's own msgId (I-9; no return address).

### E. Election / convergence (consolidated in Phases 1–2)
13. **Beacon emit + immediate announce** — `rootElection.js:31,88`; BEACON_MS
    20s, fanout 6, layers 2.
14. **Beacon ingest + strictly-closer demotion** — `rootElection.js:53`;
    verify-don't-trust; TTL 50s.
15. **Root self-verification** — `rootElection.js:255`; 6s first / 45s steady /
    batch 3; non-blocking lookups (4.18.1 lesson).
16. **Root-hint resolver** — `rootElection.js:141`; cached-hint-now +
    background refresh + iterative escape.
17. **rootClaim state machine** — every isRoot flip; one transition function,
    why-coded log (Phase 1).
18. **Ingress defer-to-root** — `_deferToRoot`; near-miss terminus forwards to
    the beaconed closer root (4.19.0; killed the 20s flap).
19. **Sub-terminal formation + alone-in-the-dark guard** — `wireHandlers.js:86-102`
    (4.19.2); publish-side deliberately ungated.

### F. Departure / liveness
20. **Peer-died sweep** — `repairPlane.js:418`; purge corpse beacons + upstream
    pins, reset renewal clocks.
21. **Idle-role / subscriber / TTL sweep** — `repairPlane.js:144-181`; DROP_MS
    3m, TTL 24h; roles never leak, holds honored.

### G. Wire ingest
22. **PULLUP serve** — `wireHandlers.js:326`; replay delta (or full) up as
    REPLAYUP with tombstones.
23. **PULLUP emission + one-shot lw guard** — `wireHandlers.js:132-141`;
    `pulledLw` re-arms only on decrease (4.22.1 anti-storm).
24. **REPLAYUP ingest, yielding** — `_ingestStampedBatch` `wireHandlers.js:362`;
    dels-first; never re-stamps; macrotask yield /16 (4.24.1, I-11).
25. **HANDOFF ingest + ack** — `wireHandlers.js:402,426`; heir roots, purges
    leaver ghost beacon, never defers back, acks.
26. **REPLICATE ingest** — `wireHandlers.js:440`; union-at-root, else become
    BACKUP (backupOf, lastReplicaAt, _backupTopics).
27. **Root ingress pipeline** — verify → freshness → policy → stamp → cache →
    confirm → fan → deliver → eager replicate (`wireHandlers.js:251,282`).
28. **DELIVER re-fan + upstream re-pin** — `wireHandlers.js:472,504`;
    cache-once, re-fan-once.

### H–L. Tree shape, replay, delivery, metrics, region, reads
29. **Adopt/delegation (widen-before-deepen)** — MAX_DIRECT 20, batch 8.
30. **Replay-to-subscriber** — chunked delta + latest fold + ping + tombstone
    re-send every renewal (4.8.7 leak fix).
31. **since:'latest' one-shot** — `replayLatest` carried once.
32. **Kill/tombstone machinery** — kill ≡ publish + side effect; dels ride
    every migration (I-8).
33. **Exactly-once app delivery** — LRU 8192; kill callback gated on prior
    body delivery.
34. **since-floor bookkeeping** — renewal never re-pulls seen history;
    reset-consumption seeds 0 without deleting.
35. **Demand-driven metrics** — lease 70s / publish 20s / coalesce 8s; any
    root, no special nodes.
36. **Region lock (gated)** — one predicate, six enforcement sites (flagged:
    same scatter pattern rootClaim consolidated).
37. **Pull early-answer** — any cache-holding replica answers; root is not a
    read SPOF.
38. **Cache bounds** — CACHE_MAX 1024 / 16MB byte ceiling.

### Known overlaps (consolidation seams)
- [6]+[7]+[8]+[9]: four mechanisms for "history survives root departure,"
  sharing cohort selection and the replicas/backup fields.
- [22/23]+[8]+[24]: three PULLUP emission sites, two guard fields, one ingest.
- [10]+[11]+[12]: three timers over one `_pendingPub` map, one quench.
- [14]+[15]+[18]+[3]: four isRoot-adjacent reconcilers, distinct reach
  envelopes (by design), one state machine (already consolidated).
- [36]: one region predicate, six scattered call sites.

## Appendix B — Architecture-doc audit (Axona-Architecture.tex @v4.21.0 vs 4.24.1)

**Accurate (stands):** emergent-root rule; rootClaim transition table (matches
the code's why-codes exactly); defer gates + three evidence tiers; beacons +
verify-don't-trust; self-verification cadence; reachable-root asymmetry +
alone-in-the-dark; death sweeps; backup-as-subscribing-child; cohort selection
(findKClosest, non-bridge); replay-up hw rule; pending retry + cold burst;
kill/tombstone I-8; canonical region fold + region lock; idle sweeps + TTLs.

**Stale:** §VIII replication cadence ("full cache+tombstones … every tick …
idempotent full-state push doubles as anti-entropy") — describes the removed
pre-4.24.1 behavior that fueled the collapse. §VIII/§X handoff — fire-and-forget;
no HANDOFFACK verb, no retry rounds, no fallback. Version strings pinned to
4.21.0 throughout. Role field list missing `pulledLw`, `backupOf`,
`lastReplicaAt`, `replSig/replLastFull`, `probeTries/probeAt`.

**Missing:** empty-root probe (4.24.0); lw split-union + one-shot guard
(4.22.x); union-at-root REPLICATE ingest; delta keepalives (4.24.1);
acknowledged-handoff protocol + the principal-liveness rule.

**Structural:** no bounded-state-under-churn invariant anywhere; interaction
rules limited to two "traps"; §II philosophy ("wrong claims that self-correct
are cheaper than coordination") + cheap-idempotent-push framing together imply
the departure spray is safe — the doc would have *caused* #333 in the hands
of a careful reader.
