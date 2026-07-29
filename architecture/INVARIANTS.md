# Axona Kernel — Invariants & Structural Rules
*v1.1 — 2026-07-29 · extracted from the root-system refactor (v0.2 Phases 1–8), adopted as the standard for all subsequent restructuring.*

*Deployed kernel as of 2026-07-29: **prod 4.49.0** (bridge 2.103.0, relay 0.92.0 —
both bridges and all 9 backbone relays) · **testnet 4.49.0**. Version numbers
below (e.g. "repairPlane.js, 4.42.0") name the release a fix LANDED IN — they are
provenance, not a claim that it is running.*

> **`/healthz` is the only truth, and this is not a slogan.** On 2026-07-29 the
> figure "prod runs 4.43.0" was taken from a deployment note rather than the
> endpoint. Prod was on 4.48.0. A release was sized as four versions of new
> subsystem when it was four bugfixes, and the error survived a full review pass
> because every reader trusted the same note. **Any version claim used to size,
> gate, or justify work must be read from the running service at the time of
> writing.** Recorded as process rule P6 below.

Every rule here is either **fenced** (a named test fails if it regresses) or **declared unfenced** (the honest drift backlog). A rule that isn't a test drifts — the un-tabled `READ_REPAIR` policy proved it within weeks of the sync engine shipping.

## A. Structural rules (how we build)

| # | Rule | Exemplar | Fence |
|---|------|----------|-------|
| S1 | **One transition site per state.** Every change to a piece of authoritative state goes through a single function emitting a single log line. | `RootClaim._set` (rootClaim.js) — every `isRoot` flip | `smoke_root_claim.mjs` |
| S2 | **Derive, never store, what can drift.** Role natures (ROOT/BACKUP/CHILD) are computed from ground-truth fields (`isRoot`, `backupOf`), never persisted. Killed the #333 drift class structurally. | `roleNature()` (rootClaim.js) | `smoke_role_natures.mjs` |
| S3 | **One operation + typed table + CI-enforced boundary.** N bespoke paths collapse into one parametrized operation behind a complete typed policy table, with one emission site per wire verb — and BOTH properties are tests. | `syncEngine.js` `SYNC_POLICIES` (8 rows) | `smoke_sync_engine.mjs` (table complete + closed at exactly 8 rows) · `smoke_emission_sites.mjs` (one emitter per verb) |
| S4 | **Closed shapes.** A state object declares every field it can ever carry in its one constructor; no runtime graft-ons. | `makeRole()` (rootClaim.js) declares all 20+ fields incl. former graft-ons (`readHolder`, `_warnedSingleton`, `formedAt`, `lastVerify`, `sync.probed`) | **UNFENCED** — needs a shape-freeze test (drift backlog) |
| S5 | **Budgets scale with work.** Any timeout/window bounding O(K) work must scale with K (floor + per-item margin + cap), and prefer progress-aware exits (evidence, not time). Flat constants against variable batches are the mass-leaver bug class. | leave() `handoffMs` (AxonaPeer.js) · Phase B ack window (repairPlane.js, 4.42.0) | `smoke_handoff_scaling.mjs` |
| S6 | **Orchestration under one clock.** Periodic work is decomposed into named, ordered, individually-testable scheduler units invoked by ONE tick — never N independent timers (serial-order-within-tick is an invariant; timer multiplication changes interleaving semantics). | target state for `refreshTick` (planned) | **UNFENCED** — becomes the refreshTick refactor's gate |

## B. Behavioral invariants (what must always hold)

| # | Invariant | Enforced at | Fence |
|---|-----------|-------------|-------|
| B1 | **Region is an optimization, never a wall.** Region prefixes bias placement toward locality; they NEVER decide whether a node may hold, root, or route a topic. A sparse region must roll over into its neighbours. See "B1 in full" below — the region-lock machinery exists and defaults OFF; leaving it off is the invariant. | `isRegionLockEnforced === false` (constants.js) | `smoke_region_lock.mjs` fences the dormant path only — **needs a fence asserting the default stays off** |
| B2 | A joiner **iteratively verifies before self-rooting** (network lookup past the local table). | rootElection `_rootHint_` | `smoke_root_hint.mjs`, `smoke_interloper_convergence.mjs` |
| B3 | **Never defer to a farther node, a ghost, or the departing node** (I-2). | rootClaim `liveCloserRoot` + leaver-beacon purge | `smoke_leave_handoff_burst.mjs` (heir no-defer case) |
| B4 | **Roots union-ingest** — a REPLICATE at a claim-holder merges; it never usurps or is refused. | syncEngine `UNION_AT_ROOT` | `smoke_split_history_union.mjs` |
| B5 | **Handoff completes before notify** on leave — data first, funeral announcement second. | AxonaPeer.leave() step order | `smoke_leave_teardown.mjs`, `smoke_pubsub_leave_handoff.mjs` |
| B6 | A departing **non-root holder hands off unless the root is POSITIVELY alive** (open link now — passive freshness lies during mass teardown). | repairPlane `_rootAliveForLeave` | `smoke_backup_handoff.mjs` |
| B7 | **Every cache migration carries tombstones, applied before bodies** (I-8). | syncEngine `_syncIngest` (all three arms) | `smoke_kill_migration.mjs` |
| B8 | A **kill callback fires only if the body was delivered** to that app. | topicStore `_deliverKillToApp` | `smoke_pubsub_kill.mjs` |
| B9 | **Converge before serving authority** — an empty self-root pulls cohort history before acting as root. | rootClaim `become` → birth probe | `smoke_empty_root_pull.mjs` |
| B10 | **Eviction is principal-liveness-gated** (I-10) — a planted nature is retired only when its principal is gone AND re-homed. | rootClaim `retireBackup` + policy-table `evictor` column | `smoke_sync_engine.mjs` (evictor completeness) |
| B11 | A **mass leaver's sole-copy topics hand off first** (singletons → replicated roots → holders), so a cut-off departure saves the most vulnerable history. | repairPlane job tiering | `smoke_handoff_scaling.mjs` (indirect) — **partial fence** |
| B12 | **A bridge is a bridge — it has no other role. Always.** A bridge transports and introduces; it never holds a topic role (root, backup, child or holder), at any load, in any topology, with no floor exception. | routing refuses it as a next hop (`AxonaPeer.js:647`) · `host()` removed 2026-07-25 · `neverRoot:true` HARD admission refusal (bridge_engine, kernel 4.46.0) | `smoke_role_admission.mjs` (bridge refusal is HARD; floor must not override) — **needs a fence asserting a bridge peer ends with axonRoles empty after bring-up** |
| B13 | **Capacity is measured, never counted.** A node's fitness to hold roles is observed pressure against real protocol deadlines (`servicePressure` = staleness / `DROP_MS`; `helloPressure` = tick lag / `HELLO_DEADLINE_MS`), never `axonRoles.size`. A count is inventory; these measure capability, which is what predicts failure. | `AxonaManager.inspectCapacity()` + `saturated()` (kernel 4.47.0) | `smoke_role_admission.mjs` — asserts MAX_ROLES roles all serviced on time is a HEALTHY node |
| **I-ID** | **Transport identity is ephemeral; author identity is durable.** A node's transport identity (nodeId + keypair) is minted fresh every process start and written to NO persistent store — not a namespace, not a file, not a snapshot, not a container volume. An author identity may and must persist. | kernel: `_writeNamespace('identity')` no-op + `_loadFromPersist` ignores + `snapshot()` carries no identity · relay/MCP: author-only store, `connectPeer()` takes no identity | `smoke_persistence_wiring.js` (restart ⇒ different nodeId; author still persists) · `smoke_snapshot.js` · `fence_transport_identity.mjs` (static, per repo) |

### B1 in full — region is an optimization, reaffirmed 2026-07-26

**The rule.** A region prefix biases *where* a topic prefers to live, to keep
traffic near its users. It is a hint to placement and ranking. It is not a
capability boundary, not an admission check, and not a reason to refuse a role.
Nothing outside placement quality may depend on it.

**Why it cannot be load-bearing.** Regions are unevenly populated by nature —
some cells will have a handful of nodes, some none. A region that is allowed to
refuse out-of-region work cannot borrow capacity from next door, so a thin region
degrades to unrooted topics and dropped publishes while healthy neighbours sit
idle metres away in the keyspace. Locality is worth optimizing for and worth
nothing to enforce: the failure mode of a missed optimization is a slower hop,
the failure mode of an enforced wall is data with nowhere to live.

**Current code state, verified 2026-07-26.** `isRegionLockEnforced` resolves to
`false`. The refusal paths exist — `AxonaManager.js:186 _regionOk`, `:387
host-refused-foreign-region`, `wireHandlers.js:67/205/234`, `repairPlane.js:60/511`
— and every one is dormant behind that flag. **The shipped default is correct.**
The hazard is the dormant machinery plus the previous wording of this row, which
described the wall as the invariant and would have led a future reader to flip
the flag *to restore compliance*.

**This is a reaffirmation, not a new decision.** It was settled well before this
entry; [[research_cross_region_selfroot_fix]] records it as "region prefix = HINT
not wall" from the 4.17.1 cross-region fix, where treating the prefix as a wall
had already produced 0 % cross-region delivery. Rewritten here because the row
above said the opposite and because a design draft cited the dormant refusal as
precedent for hard admission refusals — it is not precedent for anything.

**What may depend on region:** ranking candidates, choosing a mint point,
preferring a nearer holder. **What may not:** whether a role can be taken, held,
handed off, or routed to.

### B12 in full — the bridge, and why the fence is absolute

The tempting exception is: what if a bridge is the only candidate for a topic and
refusing loses a publish? Grant the exception and a bridge roots under load,
which is exactly when it can least afford to.

The exception is unnecessary. A bridge is the sole candidate only when the mesh is
so small that it is nearly the only node — a fresh-launch window. Loss there is
uninteresting: transient, with nothing yet stored, and it closes by itself as real
nodes arrive. Trading a permanent architectural property for a few seconds of
empty-network durability is a bad trade.

Three independent doors enforce it, and it is worth knowing all three so nobody
"fixes" one thinking it is the only guard:

1. **Routing** (oldest): `AxonaPeer.js:647` skips the bridge in the greedy
   next-hop scan — `bridge is signaling infra, not a topic root/forwarder`. Mesh
   traffic is never routed toward a bridge at all.
2. **`host()` removed** (2026-07-25): the bridge no longer explicitly hosts the
   directory topic.
3. **`neverRoot`** (kernel 4.46.0): the bridge's own `sub()` can no longer
   self-root. HARD tier — the `admitted-despite` floor may never override it.

A design draft (Saturation-and-Admission v0.5) proposed softening (3) when the
alternative was data loss. Rejected 2026-07-27.

**What B12 means for role delegation (added 2026-07-29).** The scorecard's M21
proposes that a node which cannot take a role *appoints* one that can, and the
bridge is its motivating case — production now measures ~15 refusals/minute/bridge
at steady state, so the demand is real. B12 does not forbid that, but it
**decides its shape**, and this is worth stating before the design is written:

- The **proxy** variant — the bridge keeps beaconing as root and forwards every
  SUB/PUB to a manager — makes the bridge a *forwarder for topic traffic*. Door 1
  (`AxonaPeer.js:647`, "bridge is signaling infra, not a topic root/forwarder")
  forbids exactly that. **Proxy delegation is ruled out by B12.**
- The **referral** variant — the deputy is beaconed as the root, readers converge
  on it directly, and the bridge leaves the data path after introduction — is
  consistent with B12 and with the bridgeless-connection result (4.17.2).

So the fork M21 left open is already closed for the bridge case: **referral, not
proxy.** A delegating bridge must exit the path, not sit in it. Whether the
*grant* can be made independently checkable (e.g. by declaring `neverRoot` on the
wire) is still open and must be settled before implementation — an unverifiable
grant is a topic-capture primitive, not a delegation. See that doc for the correction,
including a reroute-loop claim that turned out to be speculation — a `'consumed'`
return ends the walk, and the bridge's own re-send finds a relay.

### I-ID in full — why this one is not a preference

Every other invariant here protects correctness. This one protects **people**, so it
gets stated plainly.

A `nodeId` that survives restarts is a durable correlator. It links a node's sessions
to one another over time; that links them to an IP; and that locates a person. The
countervailing benefit is **nil** — transport IDs are ephemeral by construction, and a
node returning under its old id gains nothing, because the mesh has already
restructured and healed around its absence. All cost, no benefit.

None of the following justify breaking it. Each is a signal the *design* is wrong:
reconnection continuity, role or route retention across restarts, debugging or log
correlation, deduplicating concurrent processes, or reputation keyed on a node.
(Bridge reputation is keyed on the bridge URL precisely so its signer can rotate.)

Author identity is the opposite case: place-free, meant to be durable and
recognizable, and for owned topics it *is* the authority — `owner` and `write` fold
into the topic id. Durable WHO, ephemeral WHERE. The envelope names a signer, never
a node and never a region ([[Publisher location stays out of the protocol]]).

Found 2026-07-25 in five places at once — the kernel's persistence namespace, the
kernel's own `snapshot()` escape hatch (which embedded the private key), the MCP
peer's `~/.axona` store, the relay README + systemd example, and two stale key files
on production bridges. The static fence exists because the behavioural tests could
not see four of those five.

## C. Process rules (how changes land)

- **Gates are pre-registered, not post-hoc.** The SLO is **fresh-subscriber delivery %**; measurement = **REPS ≥ 5, report mean ± sd** (single runs are directional only); Howard's `axonSpec` remains the external acceptance gate.
- **No behavior change without a disproof** — a failing repro (smoke or live) precedes every fix; the repro becomes the fence.
- **Mechanism freeze during refactor phases** — incident response is (a) revert, or (b) a minimal guard tagged with an issue ID and a removal date. No new mechanisms.
- **Mixed-version compat statement required** for any change touching wire-adjacent behavior (prod runs multiple kernel versions simultaneously — observed 4.35 peers during 4.41).
- **P6 — Read deployed versions from the running service.** Any version used to size, gate, or justify work comes from `/healthz` (or the equivalent live surface) at the time of writing, never from a note, a memory, or a previous document. Cost of the miss: a release mis-sized by four versions, uncaught through a full review pass (2026-07-29).
- **Verify per-claim, not per-narrative** (added after the Finding-0 correction: half the mass-leaver battle was already fought in code; reviews must check each numeric claim against source).

## Drift backlog (declared unfenced)
1. S4 shape-freeze test for `makeRole()` (assert no undeclared fields appear on live roles after a soak pass).
2. S6 one-clock fence — lands with the refreshTick decomposition.
3. B11 explicit tier-order assertion (currently only exercised indirectly).
4. **Metric names must match their referents.** Two live cases: `servicePressure`
   structurally pinned at 0.028 while a node held 546 roles at 200% CPU; and
   `axona_status` reporting the synaptome under the name `mesh` (`synaptomeSize`
   and `peers` are the same set counted twice, and neither counts live WebRTC
   channels) — which produced a false "the mesh collapsed" report during the
   2026-07-29 prod deploy, i.e. a claim that the bridge is on the data path, the
   opposite of B12. **No operator surface currently exposes live channel count**,
   so "did the mesh survive?" cannot be answered from outside. Needs a fence and
   a rename.
5. `s2PrefixOfHex` hardcodes an 8-bit region prefix read — correct while `regionBits === 8`; documented in `smoke_hexid.js`, would misread under a non-default `configureKeyspace({regionBits})`.
