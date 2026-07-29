# Axona Kernel — Architecture Health Scorecard & Refactor Plan
*v1.0 — 2026-07-25. Committed to axona-docs (David approved).*
*Deployed kernel as of 2026-07-25: **prod 4.41.0** · **testnet 4.39.0**. Where this
document cites 4.40–4.42 it is naming the release a change LANDED IN, not a
release in service — 4.42.0 is tagged and held, and testnet was rolled back to
4.39.0 on 2026-07-25. Check `/healthz` for ground truth, never a document.*
*Grounded in 4 parallel code surveys of `/Users/croqueteer/Documents/claude/axona-protocol/src` (source-of-truth). Kernel = 20,415 LOC / 57 files.*

## Context / why
Post-refactor (v0.2 Phases 1–8) we are "patching out patches." David asked (2026-07-25): formulate a plan to continue the refactor toward a clear, maintainable workspace; analyze component structural health; and specifically — how robust/rule-governed is the root system since the refactor, and do those rules generalize to other components?

## Scorecard (🟢 healthy · 🟡 ok-with-gaps · 🟠 debt · 🔴 worst)
| Subsystem | LOC | Health | Reason |
|---|---:|:--:|---|
| persistence/ | 635 | 🟢 | Clean interface + 2 swappable adapters; depends only on errors. |
| contracts/ | 671 | 🟢 | Pure interface layer, depends on nothing, stable. |
| identity/ | 484 | 🟢 | Small/focused; only blemish = inherited misfiled ed25519. |
| pubsub — AUTHORITY (rootClaim 328, syncEngine 211, topicStore 165, post 248, envelope 297, constants 234, ids 12) | ~1.6k | 🟢 | The refactor landed here: single-transition, derived natures, typed table + CI fences. |
| utils/ (hexid 352, geo 394, s2 350, region-names 445) | 1,541 | 🟡 | Good code, but hexid.js (#1 fan-in, 18 importers) & geo.js have NO dedicated tests. |
| pubsub — ORCHESTRATION (repairPlane 935, wireHandlers 758) | ~1.7k | 🟠 | `refreshTick` god-method (~15 of ~24 timers); the live handoff bug lives here. |
| transport/ (web/mesh 1061, web/index 1022, webrtc 596, handshake 343) | 5,634 | 🟠 | handshake.js = 185 commits/343 LOC (extreme churn); layering inversion into pubsub. |
| dht/AxonaPeer.js | 4,251 | 🔴 | 21% of whole kernel in one file. God-object; dead "verbatim from AxonaEngine" porting scars; references a non-existent AxonaEngine.js. |

Largest files: AxonaPeer.js 4251 · transport/web/mesh.js 1061 · transport/web/index.js 1022 · pubsub/repairPlane.js 935 · pubsub/wireHandlers.js 758 · crypto/noble-ed25519.js 599 · transport/web/webrtc.js 596 · transport/node/wstransport.js 507 (= AxonaManager.js 507).

## Three cross-cutting structural risks
1. **AxonaPeer.js god-object (4,251 LOC)** — largest single liability; 4× next file; still carries AxonaEngine porting scars.
2. **Orchestration layer never got the rules** — repairPlane's `refreshTick` (repairPlane.js:29–229). "Authority is clean, orchestration is not." Today's live `handoff-unacked` bug is here (`pubsubLeaveHandoff`, repairPlane.js:743–918, ~175 lines).
3. **Boundary leaks that BLOCK safe refactoring:**
   - Shared crypto (`pubsub/ed25519.js`) + serialization (`pubsub/post.js` `canonical`) are misfiled inside pubsub/, so transport/ and identity/ reach UP into pubsub → inverted layering.
   - `package.json` `exports` opens EVERY sub-path → internals (pubsub/AxonaManager etc.) are de-facto public API (~65 tests import them directly). Must close before internals can be safely restructured.

## The reusable ruleset (seed of INVARIANTS.md) — proven by the root/authority layer
**Structural rules ("how we build"):**
1. **One transition site per state** — every change to authoritative state goes through a single function + single log line (cf. `RootClaim._set`, rootClaim.js:179–191).
2. **Derive, never store, what can drift** — computed natures (roleNature, rootClaim.js:53–57) structurally killed the #333 drift class.
3. **One operation + typed table + CI-enforced boundary** — consolidate N bespoke paths into one parametrized op AND fence with a test (`smoke_emission_sites.mjs`, `smoke_sync_engine.mjs`). A rule that isn't a test drifts (see the already-leaking un-tabled READ_REPAIR).
4. **Closed shapes** — a role/state object declares all fields in one constructor; no runtime graft-ons (5 already violate: readHolder, _warnedSingleton, sync.probed, formedAt, lastVerify).

**Behavioral invariants (verbatim seeds, all enforced in code today):** region-homogeneous tree · verify-before-claim · never defer to farther/ghost/departing node (I-2) · union-ingest at roots · handoff-before-notify · hand off only on positive proof successor is alive · tombstones-applied-before-bodies (I-8) · kill-fires-only-if-body-delivered · converge (pull) before serving authority · liveness-gated eviction (I-10).

## Root system — answer to David's specific question
- **Robustness:** markedly better-structured than its incident history predicts, but not yet *simple* — it's the disciplined residue of ~a dozen incidents. Authority is genuinely single-sited: 1 canonical boolean (isRoot), 1 transition fn, 1 log/flip; 15 mechanisms all funnel through it.
- **Rules established?** YES — rules 1/2/3 above are the three that account for the good state.
- **Biggest remaining risk:** root *authority* is single-sited but root *triggering* is still diffused across `refreshTick` + wire handlers as ~12 incident-specific guards → the next churn/loss edge lands "in the seams between the guards," not inside rootClaim.js. Un-tabled READ_REPAIR = early leak of the table's authority.
- **Generalize?** Yes — proven by contrast: parts WITH the rules are clean; repairPlane (WITHOUT them) is the debt epicenter AND the live-bug site.

## Live evidence backing the plan (acceptance run, kernel 4.41 prod, region 0x80)
- Metrics stale-at-5s = 100%; at 25s = 41/110 fresh (real current_count) → lease + snapshot-cadence latency (~one ~20s cycle after METRICSON arms). Residual stale-at-25s correlates with churned-root topics.
- Delivery: 20/116 topics → 0 to a fresh subscriber; 68 handoff-unacked on departure (publisher held 92 axons).
- **Synthesis: metrics-staleness and fresh-subscriber loss share ONE cause — unstable roots.** A churned root can neither serve replay nor publish a snapshot. Root/handoff stability is the single lever for both.

## Plan
- **Phase 0 — Metrics (done, findings above).** Trustworthy observation precedes measuring regressions. Ties to the Reporting-Task telemetry (out-of-band HTTP-POST collector; correlation IDs {topicId,msgId,nodeId,role,event,ts,seq}; handoff lifecycle as paired first-class events; async/batched/bounded emission to avoid observer effect).
- **Phase 1 — Publish this scorecard** as shared baseline.
- **Phase 2 — Write & CI-enforce `INVARIANTS.md`** from the ruleset. Makes "reuse the rules" real.
- **Phase 3 — Close the boundary FIRST** (cheap, unblocks all): move ed25519/canonical out of pubsub/ into shared crypto/codec; narrow `exports` map to connect()+AxonaPeer so internals stop being public.
- **Phase 4 — Apply rules worst-first, behind sim+soak A/B gates, no behavior change without a disproof:**
  - **4a. Handoff seam** in repairPlane (live pain + priority + rule-free) — decompose refreshTick into named schedulers; lift root-triggering behind an explicit policy like migration already is.
  - **4b. AxonaPeer.js** — carve god-object along seams it already imports (pubsub facade / DHT routing / lifecycle); delete AxonaEngine scars.
- **Phase 5 — Extend Phase-6 doc↔code coherence guards** to enforce invariants going forward.

---

# Fable review (2026-07-25) — amendments after adversarial pass + experiments

## Finding 0 — CORRECTED 2026-07-25 during implementation
**Correction:** leave()'s OUTER handoff bound already scales with role count — `handoffMs = max(timeoutMs, min(60s, 2000 + 100×roleCount))` (AxonaPeer.js:1112), so prod leavers had 11–23s, not the flat 5s the review claimed (that arithmetic held only for the mock's parameters). Phase A heir resolution is also already parallel (8-way) with singleton-roots-first priority. The REAL unscaled piece was narrower: the per-round ack window — 2 rounds × one flat shared 700ms — while heir-side ingest is O(K). "Unacked" = "acked late" (the code's own Phase C words); every late topic fell through to a SINGLE unconfirmed Phase C fallback = sole-copy history on one fire-and-forget send. FIXED in 4.42.0: window = HANDOFF_ACK_MS + 25ms×batch (cap 5s), progress-aware with stall-exit; fenced by test/smoke_handoff_scaling.mjs (K=68 herd: 0 unacked, was 68/68; no-ack path still bounded). Lesson for the record: half this battle had already been fought (outer bound, Phase A) — the review found the unfought half but over-claimed the fought half; verify per-claim, not per-narrative.

## Finding 0 (original statement, partially superseded above): leave-handoff does not scale with role count
The plan's "unstable roots" claim was under-diagnosed. The sharper mechanism, now proven:
- **Constants are batch-size-invariant while work is O(roles held):** `leave()` total budget 5,000ms (AxonaPeer.js:1034, connect.js:189 uses defaults); handoff = 2 rounds × ONE shared 700ms ack window (`HANDOFF_ACK_MS=700`, `HANDOFF_TRIES=2`, constants.js:233); round-1 re-resolves every unacked heir with a SERIAL awaited `findKClosest` (repairPlane.js:841) → cost = unacked × lookup RTT. The code itself admits the race: *"'unacked' usually meant 'acked late'"* (repairPlane.js:889).
- **Mock proof** (`axona-protocol/test/diag_handoff_scaling.mjs`, 3 arms): K=8+slow-acks → 483ms fine; K=68+instant-acks → 1,114ms fine; **K=68+herd-delayed-acks → 6,880ms — blows the 5s leave budget**. Interaction effect confirmed; K alone and latency alone are both fine.
- **Prod truncation path:** leave() races handoff at 5s → returns → alert-bot process EXITS → all in-flight retries/fallbacks die → history stranded → `handoff-unacked` + zero-delivery.
- **Per-node attribution (corrects the earlier report):** the definitive run's 68 warnings split publisher=5, run1-subscriber=45, run2-subscriber=18. The catastrophic leavers are the CONFIRM SUBSCRIBERS — 90s-old nodes that burst-subscribe 116 topics, accrue ~211 axons (subscribe-terminal self-rooting + holders), then leave. **The test harness injects the churn class it measures** (observer effect, first order). Fire-only single-node arm: 23 roots → 16 unacked (single runs are directional; the controlled mock is the proof).
- **Existing test gap:** `smoke_leave_handoff_burst.mjs` covers (many×instant-ack) and (one×no-ack) but not the product (many×slow) — why CI never caught it.
- **Fix directions (small, testable — NOT a refactor):** budget ∝ role count (leave timeoutMs and/or per-round window scaled by K); chunked handoff with per-chunk ack windows; parallel bounded-concurrency round-1 re-resolve; accept late acks to cancel Phase C fallback. All wire-compatible (no protocol change; heir side unchanged).

## Review holes (H1–H11, summarized)
- **H1** Diagnose-and-fix gate before any refactor (now satisfied by Finding 0; minimal fix precedes restructuring).
- **H2** `refreshTick` decomposition trap: sections run in fixed serial order per tick — "named schedulers" must be ordered units under ONE clock, never N independent timers.
- **H3** Old Phase 3 conflated: internal crypto/canonical relocation = safe/early; `exports`-map narrowing = SEMVER-MAJOR (relay/dht-sim vendor the kernel; audit all consumer deep-imports; ride a planned 5.0).
- **H4** Prod is mixed-version (jibot on 4.35) — every handoff change needs a wire-compat statement.
- **H5** Phase 0 overstated: latency characterized ≠ telemetry built; handoff lifecycle events (offered/acked/received) land before/with the handoff work — heir side is still invisible.
- **H6** Pre-register gates: SLO = fresh-subscriber delivery %, REPS≥5 mean±sd, Howard's axonSpec external gate.
- **H7** AxonaPeer carve needs strangler steps + done-definition — the "AxonaEngine" scars are the fossil of a previously abandoned carve.
- **H8** Mechanism freeze during refactor window: incident response = revert or tagged minimal guard w/ removal date; no new mechanisms.
- **H9** transport/ (🟠, handshake 185 commits/343 LOC) explicitly deferred — say so; hexid/geo tests into the early batch (#1 fan-in).
- **H10** INVARIANTS.md needs an enforcement map (each invariant → its specific test); unmapped remainder = declared drift backlog.
- **H11** Spot-verify subagent-sourced scorecard numbers before committing to axona-docs (handoff constants verified by hand ✓).

## REVISED sequencing (supersedes the plan above)
| # | Step | Risk |
|---|------|------|
| 0 | Pre-register SLO + gates (REPS≥5) | none |
| 1 | Free wins: delete unpub.js, table READ_REPAIR, PUB_DURABLE drift, close 5 role graft-ons, hexid/geo smokes | low |
| 2 | **Fix leave-handoff scaling** (Finding 0; repro = diag_handoff_scaling.mjs promoted to smoke; budget∝K + chunked windows + parallel re-resolve; compat-checked) | med |
| 3 | Handoff lifecycle telemetry (with Howard's Reporting-Task collector) | low |
| 4 | Internal boundary moves (crypto/canonical out of pubsub/) | low |
| 5 | refreshTick → ordered schedulers under one clock, behind gates | med-high |
| 6 | AxonaPeer strangler carve, per-step green, defined end-state | high |
| 7 | Exports narrowing rides planned 5.0 (consumer audit first) | breaking |

## Pending decisions (David)
- (a) Commit scorecard + draft INVARIANTS.md to `axona-docs/architecture/`? (Recommend yes, after H11 verification pass.)
- (b) Sequencing: RESOLVED by review — diagnose-then-fix first (done: Finding 0), safe boundary work early, breaking exports change deferred to 5.0. Awaiting confirmation of the revised table.

## Also found (free wins)
- `pubsub/unpub.js` (118 LOC) is dead code (T.UNPUB RESERVED, no handler) — deletable.
- alert-bot bugs (Howard's repo, reported on #axona.dev): dryRun pollutes killCache w/ numeric eventNames → next kill run crashes; image-chunk path passes {name} where {eventName} expected → metrics() name:undefined throws uncaught; kill loop has no guard for unknown `source` in users dict.
