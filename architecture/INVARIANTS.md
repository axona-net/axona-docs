# Axona Kernel — Invariants & Structural Rules
*v1.0 — 2026-07-25 · extracted from the root-system refactor (v0.2 Phases 1–8), adopted as the standard for all subsequent restructuring.*
*Deployed kernel as of 2026-07-25: **prod 4.41.0** · **testnet 4.39.0**. Version
numbers below (e.g. "repairPlane.js, 4.42.0") name the release a fix LANDED IN —
they are provenance, not a claim that it is running. 4.42.0 is tagged and HELD;
testnet was rolled back to 4.39.0 on 2026-07-25. `/healthz` is the only truth.*

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
| B1 | The topic tree is **region-homogeneous**; a terminus refuses out-of-region topics. | wireHandlers terminus region check | `smoke_region_lock.mjs` |
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

## C. Process rules (how changes land)

- **Gates are pre-registered, not post-hoc.** The SLO is **fresh-subscriber delivery %**; measurement = **REPS ≥ 5, report mean ± sd** (single runs are directional only); Howard's `axonSpec` remains the external acceptance gate.
- **No behavior change without a disproof** — a failing repro (smoke or live) precedes every fix; the repro becomes the fence.
- **Mechanism freeze during refactor phases** — incident response is (a) revert, or (b) a minimal guard tagged with an issue ID and a removal date. No new mechanisms.
- **Mixed-version compat statement required** for any change touching wire-adjacent behavior (prod runs multiple kernel versions simultaneously — observed 4.35 peers during 4.41).
- **Verify per-claim, not per-narrative** (added after the Finding-0 correction: half the mass-leaver battle was already fought in code; reviews must check each numeric claim against source).

## Drift backlog (declared unfenced)
1. S4 shape-freeze test for `makeRole()` (assert no undeclared fields appear on live roles after a soak pass).
2. S6 one-clock fence — lands with the refreshTick decomposition.
3. B11 explicit tier-order assertion (currently only exercised indirectly).
4. `s2PrefixOfHex` hardcodes an 8-bit region prefix read — correct while `regionBits === 8`; documented in `smoke_hexid.js`, would misread under a non-default `configureKeyspace({regionBits})`.
