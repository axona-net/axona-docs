# Axona Kernel — Architecture Health Scorecard & Refactor Plan
## v1.2 — 2026-07-29 · published after the A+B train reached production

*Supersedes v1.0 (2026-07-25) and v1.1 (2026-07-26); both stay on disk as the
published baselines. This is the first version to carry the full working record —
review passes 2 through 7, the consolidation, PLAN v2, and M18–M21 — rather than
a curated summary of it. It was previously a working draft outside the repo;
David's decision (a) is now made and this is its canonical home.*

**Deployed kernel as of publication: prod 4.49.0 (bridge 2.103.0, relay 0.92.0,
both bridges + all 9 backbone relays) · testnet 4.49.0.** Older sections state
older deployed versions; those are provenance, not current state. **`/healthz` is
the only truth** — a stale version figure in a note, trusted instead of the
endpoint, is what caused the sizing error recorded in Review Pass 7.

### Reading order
- **New here?** § *Scorecard*, then § *PLAN v2*, then § *Review Pass 7*.
- **Following the plan?** § *PLAN v2* as amended by Pass 7's revised execution order.
- **Everything between** is the evidence trail: four code surveys, two external
  review passes (Antigravity, Codex), and the production field report.

---

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

---

# Review pass 2 — kernel 4.48.0 (2026-07-28)

*Brief: "look for issues falling between the cracks; look for patches interacting
improperly with other patches." Grounded in a direct read of `axona-protocol/src`
at 4.48.0 (20,944 LOC / 57 files) plus five executable probes. **Every finding
below was reproduced, not inferred** — the probe and its output are named. Where I
formed a hypothesis and it did NOT reproduce, that is recorded too (§N).*

## Baseline drift since pass 1 (4.41/4.42 → 4.48.0)

| | pass 1 | now | Δ |
|---|---:|---:|---:|
| kernel LOC | 20,415 | 20,944 | +529 |
| `dht/AxonaPeer.js` | 4,251 | 4,342 | +91 |
| `pubsub/AxonaManager.js` | 507 | 769 | **+262** (admission + capacity) |
| `pubsub/repairPlane.js` | 935 | 986 | +51 |
| `pubsub/wireHandlers.js` | 758 | 820 | +62 |
| new file | — | `pubsub/rootElection.js` 291 | — |

Nothing shrank. The two 🔴/🟠 epicentres both grew, and the fastest-growing file
in the kernel is now the one that acquired two new subsystems (4.46 admission,
4.47 capacity) without a home of their own.

## The shape all six findings share

Pass 1's diagnosis was *"the rules were applied to the authority layer, not the
orchestration layer."* That is still true, but it under-describes what is going
wrong now. **Every finding below is a coupling that no single site owns:**

- a function gained a failure mode; four of its five callers learned about it (F1)
- a gate was installed on two of the five paths into the thing it protects (F2)
- a telemetry stamp was placed before the work it attests (F3)
- a revert moved the tree but not the ledger (F4)
- a completeness fence checks declared→shape but never used→declared (F4)
- a 105-step `&&` chain hides everything after its first flake (F5)

Rule 1 ("one transition site per state") worked: `isRoot` is genuinely single-sited
and none of these findings is a root-authority bug. The failures are all at places
where there is **no single site and nobody noticed there wasn't one**. That is the
next rule to write, and §Rules proposes it.

---

## F1 🔴 LIVE CRASH — `claimReachable()` never learned that `become()` can return null

**Patch × patch:** 4.46.0 gave `RootClaim.become()` a nullable return (HARD bridge
refusal). Four of its five call sites were taught to handle `null`
(`wireHandlers.js:102,276,680,796` and `syncEngine.js:177`). The fifth —
`rootClaim.claimReachable()` (`rootClaim.js:298`), the reachable-root fallback
added back in 4.9.x — was not:

```js
const role = m.axonRoles.get(topicBig) || this.become(topicBig, 'reachable-fallback');
this._set(role, true, 'reachable-fallback');      // role === null → TypeError
```

**Reproduced.** A `neverRoot:true` manager (i.e. any bridge running with the
default `BRIDGE_NEVER_ROOT` fence), subscribed to a topic, unattached past
`ROOT_CLAIM_MS`, self-closest-reachable:

```
refreshTick threw: TypeError: Cannot read properties of null (reading 'isRoot')
selfClosestReachable = true
log events    = pubsub:role-refused
```

**Why it is worse than a thrown error.** `refreshTick` is invoked from `start()`
as `this.refreshTick().catch(() => {})` (`repairPlane.js:971`). The throw is
swallowed, so **every tick silently aborts at step 1** and none of the rest of the
tick ever runs again on that node: no beacon emission, no root self-verify, no
cohort replication, no empty-root probe, no pending pub/kill retry, no subscriber
eviction, no mesh re-warm. The process stays green. `/healthz` stays green.

**Reachability in production.** Only a `neverRoot` node can reach it, because
`bridge` is the only HARD refusal today. Both prod bridges run with the fence on
and their embedded peer subscribes to `axona:bridge-directory` — a bridge is also
unusually likely to satisfy `selfClosestReachable` because it has the most
neighbours. This is the same interaction pair that wedged the east bridge for ~50
min on 2026-07-27 (see the `_rerouteDeclined` doc comment, `AxonaManager.js:203`);
that incident's fix closed the reroute loop, not this second door.

**Fix:** two lines — `if (!role) return null;` after the `||`, and make the
`claimReachable` caller in `refreshTick:83` tolerate null. **Fence:** a smoke that
drives every `become()` caller under HARD refusal and asserts the tick completes.

---

## F2 🟠 The admission gate covers 2 of the 5 role-acquisition paths — and the 3 it misses are the ones where refusing would be safe

4.46.0's own doc comment states the design intent precisely:

> *"Real refusal lives where the role is PUSHED and the pusher can re-pick…
> a terminus that refuses drops data."*

That is the right rule. The implementation inverts it for three of the five paths.
A role reaches `axonRoles` through five paths, over four `makeRole` sites:

| path | nature | site | gated? |
|---|---|---|:--:|
| `become()` — routing terminus | ROOT | `rootClaim.js:240` | **yes** (floored — refusal is unsafe here *by design*) |
| `_syncIngest` HANDOFF | ROOT | `syncEngine.js:176` | **yes** (`admitPushedRole`) |
| `_onAdopt` → `adoptChild()` | CHILD | `rootClaim.js:312` | **no** |
| `_syncIngest` REPLICATE | BACKUP | `syncEngine.js:214` | **no** |
| `_readRepair` | HOLDER | `repairPlane.js:483` | **no** |

**Reproduced.** One manager, `neverRoot:true`, in grace — i.e. every reason to
refuse — pushed a role by each route:

```
become()          → ROOT    REFUSED   roles=0
ADOPT             → CHILD   accepted  roles=1
REPLICATE         → BACKUP  accepted  roles=1
read-repair       → HOLDER  accepted  roles=1
HANDOFF           → ROOT    REFUSED   roles=0
```

Two consequences, both live:

1. **A bridge cannot be made a root but can be conscripted as a child relay.** ADOPT
   is the textbook case for refusal — the parent picks a leaf from a set and can
   pick another — and it is ungated. The fence's stated purpose (keep topic-tree
   load off the node whose failure is least tolerable) is only half enforced.
2. **The gate defends a budget it does not control.** `saturated()` measures
   `axonRoles` — *all* natures — while admission covers only the ROOT ones. So an
   unbounded stream of unsolicited REPLICATE/ADOPT can push a node into
   `saturated`, after which it refuses HANDOFFs (a real refusal, with data-loss
   consequences elsewhere) and logs `admitted-despite` for the terminal roots it
   must take anyway. **The natures that can be pushed at a node without limit are
   exactly the ungated ones.**

This is #332's role-bloat mechanism with a gate bolted to the one door it never
came through.

---

## F3 🟠 `servicePressure` is stamped before the work it measures, so it cannot observe starvation

4.47.0 replaced the role COUNT with measured pressure, on the stated grounds that
*"a count is the wrong instrument."* Correct — but `refreshTick` stamps the
freshness field for **every** role, unconditionally, at the top of the tick,
before any work is attempted (`repairPlane.js:52`):

```js
for (const role of this.axonRoles.values()) if (role.sync) role.sync.lastServicedAt = now;
```

So `worstAgeMs` measures *"a tick started while this role existed"*, not *"this
role was serviced"*. Work deferred by `REPLICATE_FULL_BUDGET`, skipped by an
early `continue`, or lost to a mid-tick throw (see F1) all leave the stamp fresh.

**Reproduced.** 1,280 roles on a node with a 32-roles-per-tick full-push budget,
30 ticks (150 s simulated):

```
worstAgeMs      = 0
overdue         = 0 / 1280   (age > ROOT_REPLICATE_FULL_MS = 60s)
servicePressure = 0          threshold 0.6
roles that have NEVER had a full push: 320/1280
```

`saturated()` did return true — via the third clause, `roles >= maxRoles * 8`.
**The count backstop the design says "must never be the primary signal again" is
the only signal that fires in the scenario the pressures were built to replace.**

The arithmetic confirms it is structural, not a tuning miss:

- while ticks run, `servicePressure ≤ refreshInterval/DROP_MS = 5,000/180,000 = 0.028`
- it can only reach the 0.6 threshold if ticks stop for **108 s**
- `helloPressure` reaches 0.6 at a **3 s** tick lag

So `servicePressure` is strictly dominated: any condition that could trip it trips
`helloPressure` 36× earlier. Of the two "independent" pressures, one is a slower
copy of the other, and neither watches the work.

**Fix:** stamp `lastServicedAt` where the servicing happens (inside `_replicateRole`
after a successful push, and at the other per-nature service sites), never up-front.
That single change also makes the `overdue`/`overdueFrac` fields mean what they say.

**Related, same family:** #403 (`_tickLagMax` is an all-time high-water mark with
no decay, so `helloPressure` latches after one ≥8 s tick and only a page reload
clears it). F3 and #403 are the two halves of one problem — **the capacity
subsystem has one metric that can never rise and one that can never fall.**

---

## F4 🔴 PROCESS — the 2026-07-25 revert re-opened four closed findings, and the ledger still says they are closed

`4b2c1b1 revert: restore the v4.39.0 kernel tree as the known-good baseline`
(David-directed, correct call at the time) moved the branch back over v4.42.0. Its
message lists what to re-apply "one at a time". 4.43.0 and 4.44.0 re-landed some.
Diffing `519a30d`(4.42.0) → HEAD, these never came back:

| item | status at 4.48.0 | evidence |
|---|---|---|
| `READ_REPAIR` policy row | **missing** | `_readRepair` calls `_syncPull(…,'READ_REPAIR',…)`; not a key in `SYNC_POLICIES` |
| closed role shape | **missing** | `formedAt`, `lastVerify`, `readHolder`, `_warnedSingleton`, `sync.probed`, `publishes` all grafted at runtime across 4 files |
| `unpub.js` deletion | **missing** | file present; `buildUnpub`/`verifyUnpub`/`UNPUB_DOMAIN` still exported from `src/index.js` — dead code in the *public API* |
| the `mode:'gate'` ownership note | **missing** | — |
| handoff-ack scaling | re-landed ✓ | 4.44.0 |
| hexid/geo smokes | files exist, **never run** | see F5 |

Tasks **#389** and **#392** are marked completed. Their content is not in the tree.

**Two compounding defects made this invisible:**

1. **The guards were inside the reverted commit.** Reverting the work also reverted
   its fence, so nothing could report the regression.
2. **The one surviving fence checks the wrong direction.** `smoke_sync_engine.mjs:55`
   asserts a hardcoded list of 7 names is *present in* `SYNC_POLICIES`. It never
   asserts the reverse — that every policy name passed to `_syncPull`/`_syncPush`
   in the source *exists in* the table. Two names are used and un-tabled today:
   `READ_REPAIR` and the bare `'REPLICATE'` used by leave-handoff Phase B/C. Pass 1
   predicted exactly this leak; the fence written to stop it is blind to it.

This is the finding with the longest reach. It is not a code bug — it is that
**"reverted" and "completed" can both be true of the same change, and the ledger
only records one of them.**

---

## F5 🟠 The gate is dark — `npm test` truncates, and 15 smokes are not in it at all

`npm test` is a single `&&` chain of **105** scripts. A failure at step *k* means
steps *k+1…105* never run, and the exit code says only "something failed".

**Measured, 3 runs on this machine:** 2 × FAIL at suite **11 of 105**
(`smoke_transport_web_reconnect.js`, assertion *"re-handshake completed after the
502 storm"*), 1 × PASS. That same file passes **5/5 standalone** — it is
load-sensitive, not broken. So on two runs in three, **94 of 105 wired suites did
not execute** and nobody would know which.

Separately, **15 smoke/repro/fence files are not referenced by any npm script**
(task #401 says 10 — the real count is 15):

```
diag_restart_loss  repro_howard_chunks  repro_lossy_restart  smoke_departure_hint
smoke_geo  smoke_ghost_read  smoke_hexid  smoke_leave_handoff_burst
smoke_leave_teardown  smoke_public_topics  smoke_restart_handoff  smoke_resubscribe
smoke_root_reconcile  smoke_standalone_lookup  smoke_turn_encode
```

Two of them — `smoke_hexid.js` and `smoke_geo.js` — are the smokes added by task
**#392** *specifically because* `hexid.js` is the #1 fan-in module in the kernel
(18 importers) and had no test. They have never run in CI. Also orphaned:
`smoke_ghost_read` (#364's fence), `smoke_root_reconcile`, `smoke_departure_hint`,
`smoke_leave_handoff_burst`.

I ran all 15. **14 pass. One is dead:** `smoke_resubscribe.js` calls
`am._onReplayBatch`, a method removed in the v3.12 routing-only clean break —

```
smoke threw: TypeError: am._onReplayBatch is not a function
```

— so it has been unrunnable for **36 kernel releases** and nothing said so.

---

## N. Hypothesis tested and REFUTED (recorded so it is not re-chased)

`pubsubUnsubscribe()` does not clear `_unattachedSince`, `_rootHint`, or
`_publishedTopics`, so I expected a re-subscribe to skip the `ROOT_CLAIM_MS`
confirmation window and self-claim root immediately. **It does not reproduce**:
`claimReachable()` deletes the `_unattachedSince` entry when it fires, and the
read-repair path re-arms its own rate limit. Probed both the self-closest and
not-closest variants; `_unattachedSince` was unset at the first tick after
re-subscribe in each. No finding. (Per-claim verification, per the pass-1 lesson.)

**Adjacent, low severity, real:** `resetState()` clears 12 of ~25 mutable fields —
it misses `_unattachedSince`, `_pendingKill` (while clearing `_pendingPub`),
`_publishedTopics`, `myMetricsRequests`/`_metricsWanted`/`_metricsFwdAt`,
`_burstTimers`, `_verifyInflight`, `_ingestQueue`, and the `_tickLag*` counters.
It has **no callers anywhere** in the kernel, tests, relay, bridge or dht-sim — so
it is a latent trap rather than a live bug. It is nonetheless reachable by any
consumer, because the `exports` map opens every sub-path (pass 1, risk 3b).

---

## Rules this pass adds (candidates for INVARIANTS.md, each with its fence)

Pass 1's four structural rules stand. These four are what the six findings above
have in common; each is stated so that a test can enforce it.

5. **A nullable return is a protocol change.** When a function gains a failure
   mode, the change is not done until every call site handles it. *Fence:* a test
   that forces the failure and exercises each caller. (F1)
6. **Gate the population you measure.** If a budget or pressure is computed over a
   set, the admission gate must sit on **every** path that inserts into that set —
   or the budget must be computed over only the gated subset. *Fence:* enumerate
   creation sites, assert each is gated. (F2)
7. **Telemetry is stamped by the work, not by the intention to work.** A freshness
   mark goes after the operation it attests, conditional on the operation having
   happened. *Fence:* starve the work, assert the metric moves. (F3, #403)
8. **Completeness fences run used→declared, not just declared→shape.** Checking
   that the table is well-formed is not checking that the code uses only what the
   table declares. *Fence:* scan the source for policy/verb literals, assert each
   is a table key. (F4)
9. **A revert re-opens every finding it reverts.** Reverting is a change to the
   ledger as well as the tree: each reverted item returns to open with its own
   re-land entry, and the re-land is not complete until its fence is back.
   *Fence:* a release checklist item that diffs the reverted commit against HEAD. (F4)
10. **A suite that can truncate is not a gate.** Run every step, report every
    result, fail once at the end; and no test file exists that no script runs.
    *Fence:* a CI guard that every `test/*.mjs|js` is referenced by a script. (F5)

---

## Recommended sequencing (slots into the pass-1 revised table)

| # | step | why here | risk |
|---|------|---|---|
| **0a** | **F1 null guard + fence** | live silent tick-death on both prod bridges; two lines | none |
| **0b** | **F5 test harness: de-`&&` the runner, wire the 15 orphans, delete or fix `smoke_resubscribe`** | *do this before anything else structural* — every step below needs a gate that actually reports | none |
| **0c** | **F4 re-land audit**: diff `519a30d`→HEAD, re-apply READ_REPAIR row, closed role shape, `unpub.js` deletion; add the used→declared fence | restores the pass-1 step-1 baseline that the ledger already claims | low |
| 1 | **F3** stamp `lastServicedAt` at the service sites + **#403** decaying `_tickLagMax` | fixes both halves of the capacity subsystem together; needs David's window choice for #403 | low-med |
| 2 | **F2** gate ADOPT and REPLICATE (refuse-with-teeth: the pusher can re-pick), leave `become()` floored | changes admission behaviour fleet-wide → sim + soak A/B, pre-registered SLO | med |
| 3 | *(unchanged from pass 1)* handoff telemetry → boundary moves → `refreshTick` decomposition → AxonaPeer carve → exports at 5.0 | | |

**0a–0c are all pre-refactor hygiene and none of them changes protocol behaviour.**
They are worth doing as one batch: the refactor's remaining steps are exactly the
kind of change that a truncating, partly-orphaned test suite cannot be trusted to
gate.

## Open question for David

Pass 1 asked (a) whether to commit this scorecard to `axona-docs/architecture/`.
Task #391 is marked completed and `Axona-Architecture-Health-Scorecard-v1.0.md`
and `v1.1.md` are both in the repo — so pass 1's content landed. **This pass
should ride the same route as v1.2**, but F4 is a finding *about the record itself*
being wrong, so it also argues for the reverse: keep the working draft here and
publish only what has been re-verified against the tree. My recommendation is to
publish, with the F4 table included verbatim — a health scorecard that hides its
own bookkeeping failure is the thing it is warning about.

---

# Review pass 3 — kernel 4.48.0 (2026-07-28 Deep-Dive)

*Brief: "look for issues falling between the cracks; look for issues caused by patches interacting improperly with other patches." Added following a deep structural audit of the `axona-protocol/src` source files at 4.48.0.*

## Finding 6 🟠 helloPressure High-Water Mark Lacks Decay (Transient Spikes Permanent Lock)

**Interaction of telemetry × admission gate:** 4.47.0 introduced `helloPressure` computed as `this._tickLagMax / HELLO_DEADLINE_MS` ([AxonaManager.js:323](file://axona-protocol/src/pubsub/AxonaManager.js#L323)). However, `_tickLagMax` is updated as an all-time absolute high-water mark:
```js
if (this._tickLagMs > this._tickLagMax) this._tickLagMax = this._tickLagMs;
```
There is no decay mechanism. 
- If the event-loop spikes for >3.0 seconds just once (e.g. during heavy GC, engine startup, or browser tab suspension/backgrounding), `_tickLagMax` is permanently set to a value that forces `helloPressure` >= 0.6.
- This permanently locks the node into a `saturated() === true` state ([AxonaManager.js:339](file://axona-protocol/src/pubsub/AxonaManager.js#L339)).
- Consequently, the node permanently refuses HANDOFFs (risking data loss) and enters a degraded routing state indefinitely, even if the event-loop recovered immediately after the transient spike.

---

## Finding 7 🔴 Sync-Engine Mismatch: `READ_REPAIR` and `REPLICATE` Bypass `SYNC_POLICIES`

**Rule 8 (Completeness fences) violation:** The sync engine defines all policies in `SYNC_POLICIES` ([syncEngine.js:43](file://axona-protocol/src/pubsub/syncEngine.js#L43)). But:
- `_syncPull` is called in [repairPlane.js:518](file://axona-protocol/src/pubsub/repairPlane.js#L518) with the policy name `'READ_REPAIR'`, which is completely missing from `SYNC_POLICIES`.
- `_syncPush` is called in [repairPlane.js:895-896](file://axona-protocol/src/pubsub/repairPlane.js#L895-L896) with the policy name `'REPLICATE'`, which is also missing from `SYNC_POLICIES` (the table defines `'COHORT_REPLICATE'` and `'UNION_AT_ROOT'`).
- The test [smoke_sync_engine.mjs](file://axona-protocol/test/smoke_sync_engine.mjs) checks "declared → shape" (asserting that a hardcoded list of keys exists in the table) but completely fails to check the "used → declared" direction (scanning the source for literal policyName parameters), leaving this silent table-code divergence invisible to the CI.

---

## Finding 8 🟠 Un-gated Role Creation Sites Bypass the Admission Gate (Role Bloat)

**Patch × patch interaction:** The admission gate (introduced to limit role-bloat/memory overhead) only gates `become()` (ROOT) and HANDOFF ingest. The other three paths to role creation:
- `adoptChild()` (CHILD) in [rootClaim.js:312](file://axona-protocol/src/pubsub/rootClaim.js#L312)
- `_syncIngest` backup replication (BACKUP) in [syncEngine.js:214](file://axona-protocol/src/pubsub/syncEngine.js#L214)
- `_readRepair` (HOLDER) in [repairPlane.js:483](file://axona-protocol/src/pubsub/repairPlane.js#L483)
all call `makeRole(topicBig, false)` and append directly to `m.axonRoles` without any gate or budget check.
- This allows an external peer or a swarm of subscriptions to force a node into `saturated()` state by flooding it with ungated replica/backup/holder roles.
- Once saturated, the node begins refusing critical handoffs (ROOT/heir), despite the node having never had a say in the incoming role count that saturated it.

---

## Finding 9 🟡 Porting Scars: Non-existent `AxonaEngine.js` reference in `AxonaPeer.js`

In [AxonaPeer.js:97](file://axona-protocol/src/dht/AxonaPeer.js#L97), there is a JSDoc type import referencing a non-existent file:
```js
* @param {import('./AxonaEngine.js').AxonaEngine} opts.engine
```
`AxonaEngine.js` does not exist in `src/dht/`. This is a porting fossil left over from `dht-sim`'s engine code.

---

## Finding 10 🟡 Deprecation Debt: `touch.js` is Dead Weight

While `T.TOUCH` has been deprecated and turned into a `no-op` in [wireHandlers.js:40](file://axona-protocol/src/pubsub/wireHandlers.js#L40) (*"kept for wire compat"*), `touch.js` (129 LOC) is still fully imported, `AxonaPeer.js` still builds touches, and `src/index.js` still exports `touch` primitives.

---

## Rules this pass adds (candidates for INVARIANTS.md)

11. **High-water metrics must decay.** Any metric that can cause a node to enter a degraded or saturated state based on event-loop lag or performance spikes must have a decay interval or windowed decay.
12. **Gated collections require gated insertions.** If `saturated()` is evaluated against the size of a collection (e.g. `axonRoles.size`), all insertion paths into that collection must be subject to the gate.

---

## Recommended sequencing additions

- **0d** | **F1 null guard + become fallback logic** | Safe, critical two-line fix to prevent silent event-loop crash on `neverRoot` nodes.
- **0e** | **Verify / resolve 'REPLICATE' and 'READ_REPAIR' policy names** | Update the codebase or the `SYNC_POLICIES` table so the used policy names align.
- **0f** | **Add decay to `_tickLagMax`** | Prevent transient performance spikes from permanently locking the node in `saturated` mode.
- **0g** | **Clean up `touch.js` and dead `AxonaEngine.js` references** | Housekeeping/hygiene.

---

# Review pass 4 — kernel 4.48.0 (2026-07-28 Contract and State-Path Audit)

*Scope: new findings only. I re-read the scorecard first, then traced the
remaining public/legacy entry points and every path that serializes or restores
peer state. Each finding was reproduced against the source tree; no application
or example code was used as evidence.*

## Finding 11 🔴 Two public pub/sub APIs describe different kernels; the older one crashes in the supported standalone mode

`AxonaPeer` is exported as the concrete implementation of the public `DHT`
contract. That contract names `subscribe(topicName, handler)`,
`unsubscribe(sub)`, and `publish(topicName, payload)`. `AxonaPeer` still
implements those three methods, but each unconditionally delegates to the
removed/migrating multi-node engine:

```js
const axon = this._engine.axonFor(this._node);
return axon.subscribe(/* ... */);   // analogous in unsubscribe/publish
```

The same constructor expressly supports standalone `{ domain, node }` peers
with `engine === null`; the current public API is instead `sub()` / `unsub()` /
`pub()` with descriptor topics and explicit author identity. In that supported
mode the inherited DHT methods are therefore not a legacy compatibility path;
they are an unguarded null dereference.

**Reproduced** with a real standalone `AxonaDomain` + `NeuronNode`, no engine:

```
peer.subscribe('t', fn)  -> TypeError: Cannot read properties of null (reading 'axonFor')
peer.unsubscribe({})     -> TypeError: Cannot read properties of null (reading 'axonFor')
peer.publish('t', {...}) -> TypeError: Cannot read properties of null (reading 'axonFor')
```

This is more than a cosmetic porting scar. There are two exported application
contracts whose topic, authorisation, and error semantics differ; one is live
only for the simulator engine and one is live for production. A refactorer (or
any consumer coding from `contracts/DHT.js`) is led toward an API that fails
outside that engine. It also makes it unsafe to claim that `AxonaPeer` conforms
to the DHT contract.

**Decision required:** either (a) split the engine-only adapter from
`AxonaPeer` and stop presenting the old `DHT` pub/sub methods as its contract,
or (b) retain them temporarily but fail deliberately with a typed
`LEGACY_ENGINE_API_UNAVAILABLE` migration error. They cannot safely delegate to
`pub()` mechanically: string topics omit region/ownership semantics, and
`publish()` omits the required authorship choice. **Fence:** construct a
standalone peer and exercise every exported public operation; no path may throw
an internal `TypeError`.

## Finding 12 🔴 `fromSnapshot()` is a shape-restoration helper, not the fully functional peer its contract claims

`snapshot()` correctly removes the transport identity. `fromSnapshot()` then
tries to rebuild a usable peer, but it crosses the unfinished engine→domain
migration in the wrong direction:

- its signature accepts `engine` but not `domain`, even though standalone
  `AxonaPeer` construction is documented and supported through `domain`;
- when no engine is supplied it injects `{ onEvent: () => () => {} }` as a
  pretend engine/domain, which has neither routing configuration nor the peer
  registry of `AxonaDomain`;
- when the caller does not supply a node it creates a plain object whose `id`
  is the fresh identity's **hex string**, rather than a `NeuronNode` whose id is
  canonical `BigInt`.

**Reproduced** from a standalone peer's real `snapshot()`:

```
const restored = await AxonaPeer.fromSnapshot(snapshot, { nodeIdentity: fresh });
await restored.start();                 // resolves
await restored.lookup(1n);              // TypeError: Cannot mix BigInt and other types
await restored.pub(topic, body, opts);  // PublishError: no AxonaManager available
```

The existing `smoke_snapshot.js` verifies the envelope, pending-subscription
list, and `pub()` only with an injected mock manager. It never starts the
default restored peer or routes through it, while the test comment calls the
restored peer "fully functional." This masks a public lifecycle path that is
valid enough to instantiate, reports success from `start()`, and then fails at
first real use.

**Fix shape before mechanism:** make restore take the same explicit runtime
dependencies as construction (`domain`, node/coordinates, transport, manager
or manager factory), or reject incomplete input at construction. Never invent
a partial engine. Rehydrate canonical `NeuronNode`/`Synapse` objects through
one codec. **Fence:** JSON snapshot → fresh identity → restore → `start()` →
standalone lookup and a two-peer sim pub/sub round trip.

## Finding 13 🔴 Persistence is three incompatible half-paths: it silently drops hosting, never checkpoints synaptome changes, and restores invalid synapses

The peer advertises and comments a persistence lifecycle for synaptome,
subscriptions, and hosting. The actual ownership boundaries do not meet:

1. `host()` and `unhost()` mark the `hosting` namespace dirty at four sites,
   but `_writeNamespace()` has no `hosting` case and `_loadFromPersist()` has
   no hosting load. The debounce consumes the dirty bit successfully without
   writing anything.
2. `_writeNamespace('synaptome')` exists, but no source call marks
   `synaptome` dirty—not on bound-peer admission, candidate insertion, eviction,
   or leave. Thus automatic persistence never creates or updates that namespace.
3. `snapshot()` correctly serializes canonical BigInt peer ids as hex. Both
   `_loadFromPersist()` and `fromSnapshot()` insert those hex strings and plain
   objects directly into `node.synaptome`, bypassing `Synapse`/`asId`. The first
   XOR operation then mixes a string with a BigInt.

**Reproduced:**

```
await peer.host(); await debounce;
await persist.load('hosting')  -> undefined

// Load one snapshot-format synapse into a real NeuronNode:
typeof mapKey         -> 'string'
typeof synapse.peerId -> 'string'
await peer.lookup(targetBigInt)
  -> TypeError: Cannot mix BigInt and other types
```

This is a patch-interaction failure between the privacy-motivated identity
persistence removal, the earlier snapshot format, and subsequent host()/peer
lifecycle additions. It is especially hazardous because the adapter reports no
write failure: the state is simply absent after a clean shutdown, while a
manually written old-format synaptome can make a restarted peer fail only when
it routes.

**Fix:** decide the supported persisted state explicitly, then give it one
versioned serializer/deserializer owned at the peer boundary. That codec must
construct `Synapse` with `asId`, and either persist+restore hosting/keyspace
intent or remove the four dirty marks and all promises/comments that it does.
Every mutation that is declared durable must mark its namespace; unknown
namespaces must fail loudly rather than be silently dropped. **Fences:**

- host/unhost survives a complete persistence round trip if hosting is
  supported;
- a changed synaptome is actually written after the debounce;
- restored synaptomes have BigInt map keys and `Synapse` instances;
- a restored peer performs a routing operation without a type error.

## Sequencing addition

Treat Findings 11–13 as **pre-carve contract hygiene**, after the already
listed 0a–0c gate work and before the `AxonaPeer` strangler work. They do not
call for a broad refactor first: each has a small, testable boundary decision.
The essential rule is: **there is one production contract and one canonical
state codec.** Legacy engine conveniences may remain, but only behind an
explicit adapter—not as a second, partially functional public path.

---

# CONSOLIDATION — validation of all four passes, master list, and plan (2026-07-28)

*Brief: "validate the comments, re-analyze the code base with these comments in
mind, then generate a master list of items to address along with a plan."*

**Method.** Every claim in passes 2–4 was re-checked against the 4.48.0 tree
independently of the pass that raised it — including my own, because two
reviewers agreeing is not evidence. Where a claim could be executed, it was
executed. Verdicts below cite what was run.

**Live-version context, measured now:** `bridge.axona.net`, `bridge-west.axona.net`
and `testnet.axona.net` all report bridge **2.101.0 / kernel 4.48.0**. Every
finding below is therefore in production, not staged.

---

## 1. Validation table

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| **F1** | `claimReachable()` ignores `become()`'s nullable return → TypeError kills the rest of every tick on a `neverRoot` node | ✅ **CONFIRMED** | Executed: `TypeError: Cannot read properties of null (reading 'isRoot')` from `refreshTick`; 4 of 5 `become()` callers guard, `rootClaim.js:298` does not |
| **F2 / F8** | Admission gates 2 of 5 role-acquisition paths; ADOPT/REPLICATE/read-repair ungated | ✅ **CONFIRMED** (independently raised twice) | Executed on a `neverRoot`+in-grace node: become REFUSED, HANDOFF REFUSED, ADOPT/REPLICATE/read-repair **all accepted** |
| **F3** | `servicePressure` stamped before the work → cannot observe starvation | ✅ **CONFIRMED**, plus **prod confirmation** | Local: 1280 roles, 320 never full-pushed, `overdue=0`, `servicePressure=0`. Prod (Howard, 0x80 main net, 200% CPU): 546 roles, `saturated=false`, `servicePressure` 0.024–0.028 = the derived ceiling `5000/180000` |
| **F4** | The 2026-07-25 revert re-opened 4 closed findings; ledger still says closed | ✅ **CONFIRMED** | `git diff 519a30d HEAD`: READ_REPAIR row, closed role shape, `unpub.js` deletion, gate-ownership note all absent; `unpub.js` still exported from `src/index.js`; tasks #389/#392 marked complete |
| **F5** | `npm test` truncates; 15 smokes orphaned; one is dead | ✅ **CONFIRMED** | 3 `npm test` runs → 2 FAIL at suite **11 of 105** (load-sensitive; passes 5/5 standalone). 15 orphans enumerated; `smoke_resubscribe.js` throws `am._onReplayBatch is not a function` — dead since v3.12 |
| **F6** | `_tickLagMax` never decays → transient spike permanently saturates | ✅ **CONFIRMED — and far worse than stated.** See §2/N1 | Executed: one 60 s gap → `helloPressure=11`, `saturated=true`, `admitPushedRole=false`; **still true after 2 050 healthy ticks (~2.8 h)** |
| **F7** | `READ_REPAIR` and `REPLICATE` used as policy names but absent from `SYNC_POLICIES`; fence only checks declared→shape | ✅ **CONFIRMED** (same defect as F4 item 1) | Used names: COHORT_REPLICATE, EMPTY_ROOT_PROBE, HANDOFF, **READ_REPAIR**, REPLAY_UP, **REPLICATE**, SPLIT_UNION. Table keys: 7, missing both. `smoke_sync_engine.mjs:55` asserts a hardcoded list is *in* the table, never the reverse |
| **F9** | `AxonaPeer.js:97` JSDoc imports a non-existent `./AxonaEngine.js` | ✅ **CONFIRMED** | `src/dht/` contains no `AxonaEngine.js`; 6 further `AxonaEngine` prose references remain |
| **F10** | `touch.js` is dead weight but fully wired | ✅ **CONFIRMED** (128 LOC, not 129) | File present; `AxonaPeer.js:55` imports `buildTouch`; `src/index.js:178` exports the primitives; `wireHandlers.js:40` handler is a documented no-op |
| **F11** | The `DHT` contract's `subscribe`/`unsubscribe`/`publish` null-deref on a standalone peer | ✅ **CONFIRMED** | Executed on a real `AxonaDomain` + `NeuronNode` + `simTransport` peer (`_engine === null`): all three throw `TypeError: Cannot read properties of null (reading 'axonFor')` |
| **F12** | `fromSnapshot()` returns a peer that starts and then fails at first use | ✅ **CONFIRMED**, every sub-claim | Executed: `start()` resolves; `restored._node.id` is a **string**; `_engine` is `{onEvent}`; `restored.lookup(1n)` → `TypeError: Cannot mix BigInt and other types` |
| **F13** | Persistence: hosting silently dropped, synaptome never marked dirty, restored synapses invalid | ✅ **CONFIRMED**, all three | `_markPersistDirty` call sites: `subscriptions`×2, `hosting`×4, **`synaptome`×0**. `_writeNamespace` handles identity/synaptome/subscriptions/wireVersion — **no `hosting` case**. `_loadFromPersist` sets `synaptome.set(s.peerId /* hex string */, {plain object})`, bypassing `Synapse`/`asId` |
| **N (pass 2)** | `_unattachedSince` carried across unsub/re-subscribe | ❌ **REFUTED** — recorded so it is not re-chased | `claimReachable` deletes the entry; probed both self-closest and not-closest variants, unset at first tick after re-subscribe |

**Nothing in passes 3 or 4 was wrong.** Passes 2 and 3 independently found the
same three defects (F2≡F8, F3-sibling≡F6, F4-item-1≡F7), which is corroboration,
not new surface. Pass 4 is entirely new surface: it is the only pass that left
the pub/sub subsystem and audited the *contract and state-serialization*
boundaries, and it found three P1s there. That is itself a finding about our
review coverage — see §3 R6.

---

## 2. NEW issues found during validation (David: these are the alerts)

### N1 🔴🔴 The latch is not a slow drift — one backgrounded browser tab saturates a peer *forever*

Pass 3 described F6 as a risk from "heavy GC, engine startup, or browser tab
suspension." Measured, it is worse than a risk; it is the normal life of a
browser peer:

```
steady 5s ticks                tickLagMs=    0  maxMs=    0  helloPressure= 0   saturated=false  handoffAccepted=true
after ONE 60s tab suspension   tickLagMs=55000  maxMs=55000  helloPressure=11   saturated=true   handoffAccepted=false
after 50 healthy ticks (250s)  tickLagMs=    0  maxMs=55000  helloPressure=11   saturated=true   handoffAccepted=false
after 2050 healthy ticks (2.8h)tickLagMs=    0  maxMs=55000  helloPressure=11   saturated=true   handoffAccepted=false
```

- `helloPressure` lands at **11 — eighteen times the 0.6 threshold** — from a
  single 60 s gap. The threshold needs only 3 s.
- The instantaneous lag returns to **0** immediately. The node is *demonstrably
  healthy* and *permanently declared saturated*.
- 2.8 h of perfect ticks does not move it. Only a page reload does.
- **iOS suspends JS on screen lock; Android throttles a backgrounded tab to
  ~1/min after ~5 min.** So on 4.47.0+ **every mobile browser peer that has ever
  been backgrounded is permanently saturated**, and `admitPushedRole` returns
  false for the life of that page — it refuses every HANDOFF, which is the path
  that carries a departing node's *last copy* of a topic's history.
- axona.chat and demo.axona.net are browser apps. Kernel 4.48.0 is live on prod.

This is the highest-severity item in the whole review and it reverses the
priority I gave #403 this morning: it is not a tidy-up behind F1, it is a P0
alongside it.

### N2 🔴 F1 is *armed on production right now*, not theoretical

- Both prod bridges run kernel 4.48.0 (measured).
- `bridge_engine.js:227` — `neverRoot = process.env.BRIDGE_NEVER_ROOT !== '0'`,
  i.e. **on by default**; nothing sets it to `0` on prod.
- `bridge_directory.js:202` — the embedded peer calls `peer.sub(...)` on the
  directory topic **in every bridge region**, so `mySubscriptions` is non-empty.

Every precondition for the crash is satisfied on both prod bridges. Whether it
has fired depends on `selfClosestReachable` for those topics, which I cannot
determine from outside (see N4). The east bridge already wedged once on the
*other* door of this same interaction pair (2026-07-27, ~50 min).

### N3 🟠 `_flushDirtyToPersist` reports success for a namespace it cannot write

This is the mechanism *underneath* F13.1, and it generalises beyond hosting:

```js
this._persistDirty.clear();               // cleared BEFORE the write
for (const ns of namespaces) {
  try { await this._writeNamespace(ns); } // unknown ns → falls through, returns undefined
  catch (err) { ...; this._persistDirty.add(ns); }   // only a THROW re-queues
}
```

`_writeNamespace` is a chain of `if (ns === …)` with no `else`. An unknown
namespace does not throw, so it is indistinguishable from a successful write:
the dirty bit is consumed, nothing is retried, nothing is logged. Any future
namespace added to `_markPersistDirty` without a matching write case will be
silently dropped in exactly the same way. **The fix is one `else` that throws** —
and it converts F13.1 from a silent data-loss bug into a loud one.

### N4 🟠 We cannot tell from outside whether N1 or N2 has fired on prod

`GET https://bridge.axona.net/healthz` returns, in full:

```json
{ "status": "ok", "version": "2.101.0", "kernelVersion": "4.48.0" }
```

No roles, no admission, no capacity, no tick telemetry. The kernel *has*
`health().admission` (4.46.0) with exactly the fields needed — the bridge simply
does not surface them. So the two most severe findings in this review are, on our
own production infrastructure, unobservable. This also blocks the diagnostic
Howard is running for us on his nodes from being run on ours.

### N5 🟡 `peer.touch()` still puts traffic on the wire for a handler that ignores it

Beyond F10's dead-weight point: `touch()` is documented `@deprecated` and the
receiver is a no-op, but `pubsubTouch()` still calls `this._send(T.TOUCH, …)`
and `_onTouch` still participates in reroute (`wireHandlers.js:719`). So a caller
following the (still-exported, still-working-looking) API generates routed
messages that are guaranteed to accomplish nothing.

---

## 3. Re-analysis: what the four passes say together

Pass 2 proposed that every finding was "a coupling no single site owns." Passes
3 and 4 confirm the shape and extend it in one important way. Sorting all
thirteen findings by *what kind of seam* they sit in:

| Seam | Findings |
|---|---|
| **A contract changed and not every implementor followed** | F1 (nullable return), F11 (contract methods that outlived their engine), F12 (restore signature never migrated engine→domain) |
| **A gate/measurement covers less than the thing it governs** | F2/F8 (2 of 5 paths), F3 (stamp before work), F6/N1 (no decay), F13.2 (namespace never marked) |
| **A declaration and its use drifted apart, unfenced** | F4 (revert vs ledger), F7 (used→declared unchecked), F9, F10/N5 |
| **A failure is indistinguishable from success** | F5 (`&&` truncation), F13.1+N3 (unknown namespace = silent OK), F12 (`start()` resolves on a broken peer) |

The fourth row is the one pass 4 added and it is the most dangerous, because it
is the row where **the system tells us it is fine**. F1 (swallowed throw),
N1 (healthy node reports saturated), F3 (starving node reports 0 pressure),
N4 (healthz says "ok"): in every case the observable and the reality are
decoupled *in the safe-looking direction*.

**Two rules to add (13, 14), alongside pass 2's 5–10 and pass 3's 11–12:**

13. **Silence is not success.** Any dispatch on a name — namespace, policy,
    verb, nature — must have an `else` that throws or logs loudly. Falling
    through a chain of `if`s is a bug, not a default.
14. **A health surface must be able to report ill health.** If a component can
    enter a degraded state, its external surface must expose the field that
    shows it, and a test must assert the field changes when the state does.

**R6 — a note on review coverage.** Three passes stayed inside `pubsub/` and
found overlapping defects; the one pass that audited contracts and state
serialization found three P1s nobody else touched. The next review should be
scoped by *boundary* (contract, persistence, transport, identity), not by
subsystem.

---

## 4. MASTER LIST

Deduplicated across all four passes. **P0** = live production harm today ·
**P1** = correctness/contract defect · **P2** = hygiene, process, or debt.
"Fence" = the test that must exist before the item is closed.

| ID | Sev | Item | Source | Fence |
|---|:--:|---|---|---|
| **M1** | **P0** | `_tickLagMax` decay — one tab suspension permanently saturates a browser peer and makes it refuse every HANDOFF | F6 + N1 | suspend-and-recover: after a 60 s gap and N healthy ticks, `saturated()` is false |
| **M2** | **P0** | `claimReachable()` null guard — silent tick-death on every `neverRoot` node; armed on both prod bridges | F1 + N2 | drive every `become()` caller under HARD refusal; the tick completes |
| **M3** | **P1** | Gate the 3 ungated role paths (ADOPT, REPLICATE, read-repair), or compute saturation over only the gated subset | F2 / F8 | enumerate creation sites; assert each is gated |
| **M4** | **P1** | Stamp `lastServicedAt` at the service sites, not at tick top; make `overdue`/`overdueFrac` mean what they say | F3 | starve the work; assert the metric moves |
| **M5** | **P1** | One production pub/sub contract: split the engine-only adapter out of `AxonaPeer`, or fail with a typed `LEGACY_ENGINE_API_UNAVAILABLE` | F11 | standalone peer exercises every exported operation; no internal `TypeError` |
| **M6** | **P1** | `fromSnapshot()` takes the same explicit dependencies as construction, or rejects incomplete input; never invents a partial engine | F12 | snapshot → fresh identity → restore → `start()` → standalone lookup + 2-peer sim round trip |
| **M7** | **P1** | One versioned state codec at the peer boundary: `Synapse`/`asId` on restore; persist hosting or delete the four dirty marks and the claims | F13 | 4 fences as written in F13 |
| **M8** | **P1** | `_writeNamespace` throws on an unknown namespace; flush stops reporting success for writes it did not perform | N3 | mark an unknown namespace dirty; the flush logs and re-queues |
| **M9** | **P1** | De-`&&` the test runner (run all, report all, fail once at the end) | F5 | runner exits 1 with a full per-suite summary |
| **M10** | **P1** | Wire the 15 orphaned smokes; fix or delete the dead `smoke_resubscribe.js`; CI guard that every `test/*` is referenced | F5 | the guard itself |
| **M11** | **P1** | Re-land the 4.42.0 items the revert dropped: `READ_REPAIR` row, `'REPLICATE'` naming, closed role shape (6 graft-ons), `unpub.js` deletion + export removal | F4 + F7 | used→declared policy-name fence; role-shape fence |
| **M12** | **P1** | Bridge `/healthz` surfaces `health().admission` (roles, seated, saturated, refusals, capacity) | N4 | fetch healthz; assert the fields exist and move under load |
| **M13** | P2 | Delete `touch.js`, its `AxonaPeer` import, its `src/index.js` exports; keep only the wire-compat no-op receiver | F10 + N5 | export-surface snapshot test |
| **M14** | P2 | Remove the `AxonaEngine.js` JSDoc import and the 6 stale prose references | F9 | — |
| **M15** | P2 | `resetState()` — complete it or delete it (12 of ~25 fields; no callers anywhere) | pass 2 §N | — |
| **M16** | P2 | Record rules 5–14 in `INVARIANTS.md`, each mapped to its fence | passes 2–4 | H10's enforcement map |
| **M17** | P2 | Reconcile the task ledger with the tree: #389/#392 are not in the code; add a revert-reopens-findings checklist step | F4 rule 9 | release-checklist item |

Carried forward unchanged from the existing backlog and *not* re-derived here:
#338, #339, #341, #344, #350, #393, #397, #399, #400, #402.

---

## 5. PLAN

Five phases. Phases A and B are the only ones that touch production behaviour
urgently; C is the gate that everything after it depends on; D and E are the
refactor proper, which is where we were trying to get to.

### Phase A — stop the bleeding (P0, today, no behaviour redesign)

**A1. M2 — `claimReachable` null guard.** Two lines. `if (!role) return null;`
plus a null-tolerant caller in `refreshTick:83`. Zero protocol change.
**A2. M1 — `_tickLagMax` decay.** The only open design question in Phase A, and
it is **yours to pick**: a windowed maximum (e.g. max over the last N ticks) or
an exponential decay toward the instantaneous lag. My recommendation is a
**sliding window of 12 ticks (~60 s)**: it keeps the "one bad tick is a real
signal" property that motivated the high-water mark, while guaranteeing recovery
within a minute of the cause clearing. A decay constant has no natural units here;
a tick window does.
**Gate:** both fences above + full suite + Howard's `axonSpec` + a testnet soak
before prod. **Then promote**, because both defects are live on prod today.

### Phase B — make the system able to report its own ill health (P1, small)

**B1. M8** — `_writeNamespace` throws on unknown namespace (turns M7's silent
loss loud *before* we fix it). **B2. M12** — bridge `/healthz` exposes
`health().admission`. **B3.** Re-run Howard's capacity sampler against our own
prod bridges once B2 lands — that answers N2 (has F1 fired?) with a measurement
instead of an inference.

*Rationale for putting B before C: right now we cannot see whether Phase A
worked on prod. B is what makes A verifiable.*

### Phase C — the gate (P1, prerequisite for everything below)

**C1. M9** de-`&&` the runner · **C2. M10** wire the 15 orphans, kill the dead
one, add the guard · **C3. M11** re-land the reverted 4.42.0 items *with* the
used→declared fence · **C4. M17** reconcile the ledger.

**Nothing in Phase D or E may start before C is green.** Phase D changes
admission behaviour fleet-wide and Phase E moves public contracts; a suite that
truncates at step 11 of 105 and silently omits 15 more cannot gate either.

### Phase D — close the gates and fix the measurements (P1, needs A/B evidence)

**D1. M3** gate ADOPT + REPLICATE with refuse-with-teeth (the pusher can
re-pick); leave `become()` floored — that asymmetry is correct and deliberate.
**D2. M4** move the service stamp to the service sites.
**Gate:** sim + soak A/B with the pre-registered SLO (fresh-subscriber
delivery %, REPS ≥ 5, mean ± sd). D1 in particular can only be judged by whether
role counts fall *without* delivery falling.

### Phase E — contract and state hygiene, then the carve (P1 → the refactor)

**E1. M5** one production pub/sub contract · **E2. M6** honest restore ·
**E3. M7** one versioned state codec · **E4. M13/M14/M15** dead-weight removal ·
**E5. M16** INVARIANTS.md with the enforcement map.

Then, and only then, the pass-1 refactor sequence resumes: handoff telemetry →
internal boundary moves (crypto/canonical out of `pubsub/`) → `refreshTick`
decomposition into ordered units under one clock (H2) → the `AxonaPeer` strangler
carve → `exports` narrowing at 5.0.

**Why E precedes the carve.** You cannot strangler-carve a class that exports two
contradictory public contracts and a restore path that fabricates its own
dependencies: every carve step would have to preserve behaviour that is already
wrong. E is what makes the carve's "no behaviour change" gate meaningful.

### What needs you before work starts

1. **M1's window** — sliding window vs decay, and the length. My recommendation
   is 12 ticks; the fix is blocked on your number, and it is now a P0.
2. **M5's shape** — remove the legacy `DHT` pub/sub methods from `AxonaPeer`
   (clean, breaks any consumer still calling them) or keep them behind a typed
   migration error (safe, keeps a dead surface). Consumer audit needed either way
   — `dht-sim` is the one plausible caller.
3. **Phase-A promotion** — A1/A2 are prod-affecting kernel changes on the same
   day they are written. Normal ritual is testnet soak first; both defects are
   live now, so confirm you want the usual gate rather than an expedited one.

---

# Review Pass 5 — Antigravity Analysis of the Plan (2026-07-28)

*Contributor: Antigravity (AI coding assistant for axona-chat and peer integrations).*

I have reviewed the consolidation plan and master list. As the agent responsible for pair-programming the reference chat client, my analysis focuses on how these kernel-level adjustments impact application-level correctness and browser node stability.

## 1. Endorsement of P0/P1 Classifications

*   **M1 (helloPressure decay):** This is a critical P0. During the development of the chat client, we observed unexplained gaps in message replay history and silent handoff failures. The discovery in N1 explains this completely. Because mobile browsers and desktop tabs throttle background execution to ~1 min intervals, *every* backgrounded client has been permanently marked saturated. A client that cannot accept handoffs is a dead end for historical message replication.
*   **M2 (claimReachable null guard):** This is a low-effort, high-impact P0. Swallowing the rejection in `refreshTick` is particularly insidious because the node appears healthy on the outside (and passes basic `/healthz` checks) but ceases all background repairs.

## 2. Decision Recommendations

### M1's Decay: 12-Tick (~60s) Sliding Window (Recommended)
An exponential decay constant (e.g., $decay = lag \times 0.95$) requires floating-point math and decay tuning. In contrast, a **12-tick sliding window** is conceptually simple and matches browser lifecycle realities. If a tab is suspended for 5 minutes, it recovers exactly 60 seconds after the user brings it back to the foreground. This provides a deterministic recovery period that can be verified via automated browser testing.

### M5's Shape: Legacy API Deprecation Error (Recommended)
We should **fail with a typed `LEGACY_ENGINE_API_UNAVAILABLE` error** rather than deleting the legacy pub/sub methods outright or leaving them to throw raw `TypeErrors`. If `dht-sim` or external tools still target the synchronous `DHT.js` interface, a structured exception will alert the developer immediately during integration, rather than leading to silent failures.

### Phase-A Promotion
Because M1 (permanent background saturation) and M2 (silent tick-death) directly degrade the production network's replication guarantees, I recommend **expediting the Phase-A release**. A standard 24h testnet soak is sufficient to verify that the 12-tick sliding window behaves as expected under simulated backgrounding, after which it should be pushed to production.

## 3. Analysis of the Refactor Sequencing (Phases C, D, and E)

*   **Phase C is the correct bottleneck.** In previous sessions, edits like `READ_REPAIR` and the closed role shapes were lost during a revert because the CI was blind to the regression. We must not touch the orchestration layer (`repairPlane.js`) or split `AxonaPeer` until we have de-`&&`'d the runner and enabled the used$\rightarrow$declared policy fence.
*   **Aligning F13's persistence boundaries is a prerequisite for the AxonaPeer carve.** Finding 13.3 shows that snapshots restore plain objects and hex strings into `synaptome`, causing runtime crashes during subsequent routing calculations. If we attempt to carve `AxonaPeer.js` while it has an invalid state-restoration codec, we will spend days debugging type conversions inside the DHT routing layer.

Overall, the plan is structurally sound and directly resolves the bugs that have been degrading P2P performance in the chat application. I am ready to begin Phase A as soon as the design choices are approved.

---

# Review Pass 6 — Codex (OpenAI GPT-5) — Analysis of the Plan (2026-07-28)

*Contributor: Codex, an OpenAI GPT-5 coding agent. This is an independent
architecture and code review of the consolidated plan, informed by the protocol
source, test execution, and the preceding review passes.*

## Position

The plan has the right central insight: this is not yet primarily a large
refactor. It is a production-correctness recovery followed by making the code
safe to refactor. Its A → B → C → D → E ordering is therefore substantially
better than starting with the `AxonaPeer` carve or a broad `refreshTick`
cleanup. In particular, doing the state/contract repair before the carve makes
the carve a behaviour-preserving change rather than a migration of undefined
behaviour.

I endorse the two P0s, the recommendation for a bounded tick-lag window, and
the rule that no orchestration or public-contract carve begins until the test
gate is credible. The remaining work is to make the transitions between those
phases just as explicit as the findings themselves.

## Amendments I would make before execution

1. **Add a small release-evidence gate before Phase A promotion, without
   delaying the P0 fixes for the whole Phase-C runner repair.** The current
   runner's `&&` chain cannot establish that a "full suite" actually exercised
   all expected suites. For A1/A2, define the exact direct test commands and
   the two new deterministic fences, record their results, and run the current
   suite separately as advisory evidence. Phase C remains the point at which
   the suite again becomes a trustworthy universal gate; this addition merely
   prevents a known blind spot from being called proof during an urgent release.

2. **Make M1 an admission-state design, not only a data-structure swap.** A
   12-tick rolling maximum is the clearest starting policy: it preserves the
   signal from a genuine recent stall and provides a deterministic recovery
   bound. Its test matrix must include a foreground peer, a delayed-but-still
   useful peer, a backgrounded browser returning to service, and repeat
   suspend/recover cycles. The invariant is not simply that the stored maximum
   declines; it is that `saturated()` eventually becomes false after healthy
   operation and that a new real stall becomes true again promptly.

3. **Treat B2 as an observability interface with an exposure decision.** The
   bridge needs the admission fields to operate the network, but roles,
   capacity, and refusal counts can also be useful targeting information. Put
   the detailed form on an operator-authenticated endpoint or otherwise make
   the intended public exposure an explicit decision; retain a safe aggregate
   public health signal if that is required. In either case, alerts should be
   tied to the same field definitions used by the tests, so `/healthz: ok`
   cannot coexist indefinitely with a permanently saturated bridge.

4. **Keep D1 behind caller-closure tests, not role-count tests alone.** Gating
   `ADOPT`, `REPLICATE`, and read-repair changes a distributed request path.
   For every newly declined path, the sender must re-pick, re-route, or record
   a deliberate terminal result; it must not retain a pending role or retry a
   saturated target forever. The existing delivery, replication, and latency
   SLOs are the right outcome measures, but each refusal path also needs a
   local closure test. This is the main place where a correct local gate could
   still produce worse network behaviour.

5. **Turn Phase E into explicit compatibility transitions.** M5, M6, and M7
   each change a boundary that consumers or persisted state may already depend
   on. Give each a written old-form → new-form table, a versioned codec/migration
   rule where state survives process lifetime, and a removal release criterion.
   A typed legacy-API error is a good interim M5 outcome, but it should include
   the supported replacement in its message and have an expiry/removal owner;
   otherwise it becomes another permanent patch layer.

## Recommended execution shape

Keep the five phases, with one operational addition: **A0: release evidence**
immediately before Phase-A promotion. A0 consists only of the direct,
deterministic P0 fences, an explicit testnet soak record, and a rollback signal
derived from the new/temporary admission telemetry. It is deliberately not a
sixth refactor phase.

Within the existing sequence, I would use this dependency order:

`A1/A2 → B1/B2 → A0 promotion evidence → C → D → E1–E3 → E4/E5 → internal moves → ordered refreshTick decomposition → AxonaPeer carve → 5.0 export narrowing.`

The minor distinction inside E matters. Contract and state work (E1–E3) gives
the later structural moves a stable boundary. Dead-surface cleanup and invariant
documentation then make the carve smaller and its ownership rules enforceable.
Retain compatibility re-exports while moving internal modules; make export
narrowing a separately reviewed major-version change rather than collateral
damage from file movement.

## Completion criteria for the refactor proper

Before calling the carve complete, I would require more than a line-count or
file-layout outcome:

- one owner and one clock for each `refreshTick` phase;
- no nullable or declined state introduced without every caller being fenced;
- one declared-to-used policy/verb map checked in CI;
- one canonical runtime/state codec, with restore-to-live-operation tests;
- one complete test manifest whose reported count is checked; and
- operational telemetry capable of disproving the claim that a bridge is
  healthy.

Those are durable constraints on future modifications. They address the
"patches on patches" failure mode directly: a later patch must either preserve
an owned contract or fail a named fence, instead of quietly creating another
parallel behaviour.

---

# PLAN v2 — after review passes 5 and 6 (2026-07-28)

*Supersedes §5 of the consolidation. Passes 5 (Antigravity) and 6 (Codex) both
endorse the A→B→C→D→E shape and the two P0s; what follows is what I am changing
because of them, what I am declining, and what I am adding on top.*

## Amendments ACCEPTED

**A0 — release-evidence gate before Phase-A promotion (Codex #1). Accepted; this
was a real hole.** My Phase-A gate said "full suite + axonSpec + soak". But F5 —
my own finding — establishes that the current `&&`-chained runner cannot show
that a full suite ran, and Phase C is what fixes it. I was proposing to gate an
urgent production release on an instrument I had just documented as unreliable.
A0 therefore consists of: the two new deterministic fences named individually,
the specific direct test commands and their recorded results, the soak record,
and a named rollback signal. The legacy suite runs as *advisory* evidence only,
and is labelled as such.

**M1 is an admission-state change, not a data-structure swap (Codex #2).
Accepted.** My fence ("after a 60 s gap and N healthy ticks, `saturated()` is
false") only tests recovery. A window that recovers is worthless if it no longer
detects. The fence becomes a four-case matrix, and the invariant is two-sided:
`saturated()` must become false after sustained healthy operation **and** must
become true again promptly on a genuine new stall.

| case | expectation |
|---|---|
| foreground peer, steady ticks | never saturated |
| genuinely slow peer (sustained lag near the deadline) | saturated, stays saturated |
| backgrounded browser returning to service | saturated during, false within one window after |
| repeated suspend/recover cycles | no ratchet — recovery each time |

**B2 needs an exposure decision (Codex #3). Accepted, and I had missed the
security angle entirely.** Roles, capacity and refusal counts are targeting
information: a public endpoint that says "this bridge is saturated, holds N
roles, is refusing" tells an attacker precisely where and when placement
pressure will succeed. That cuts against our own E-1 placement-defence work.
**Decision: detailed admission fields go on an operator-authenticated endpoint;
`/healthz` keeps a public boolean-ish aggregate that can still go non-ok.** The
non-negotiable part is that `/healthz: ok` must not be able to coexist
indefinitely with a permanently saturated bridge — that is the N4 defect and it
is fixed by the aggregate, not by the detail.

**D1 needs caller-closure tests, not just role-count outcomes (Codex #4).
Accepted, and it generalises F1.** Gating ADOPT and REPLICATE creates new
decline paths, and F1 is precisely what an unhandled decline path does: the east
bridge wedged because a refusal had nowhere to go. `_rerouteDeclined` and
`_undeliverable` exist for exactly this reason on the PUB/SUB/KILL paths. So
every newly-declined path must have a defined terminus — the sender re-picks,
re-routes, or records a deliberate terminal result; it must never retain a
pending role or retry a saturated target indefinitely. Role counts falling is
not evidence of success on its own.

**Phase E as explicit compatibility transitions (Codex #5). Accepted.** Each of
M5/M6/M7 gets a written old-form → new-form table, a versioned codec or
migration rule wherever state outlives a process, and a **named removal release
plus an owner**. A typed `LEGACY_ENGINE_API_UNAVAILABLE` must name its
replacement in the message and carry an expiry — otherwise it is just another
permanent patch layer, which is the failure mode this whole review exists to
end.

**Carve completion criteria (Codex, closing section). Accepted as the
definition of done** for the refactor proper, replacing any line-count or
file-layout measure: one owner and one clock per `refreshTick` phase · no
nullable/declined state without every caller fenced · one declared↔used
policy/verb map in CI · one canonical state codec with restore-to-live-operation
tests · one test manifest whose reported count is checked · telemetry capable of
disproving "this bridge is healthy".

**M5 = typed error (both passes agree).** Accepted, with Codex's expiry
condition attached.

**M1 window = 12 ticks (~60 s), rolling maximum (both passes agree with my
recommendation).** Settled unless David overrides.

## Amendment DECLINED / CORRECTED

**"A 24 h testnet soak is sufficient" (Antigravity, Phase-A promotion).
Corrected — not declined, but the reasoning is wrong in a way that matters.**
Testnet does not have the scale to make a soak statistically meaningful (a real
soak needs ≥40 nodes; our standing practice is to soak against prod). More
importantly, **M1 and M2 are not proven by a soak at all** — both have
deterministic, clock-driven fences that either pass or fail. The soak's job here
is *only* to catch collateral damage, and a testnet soak can do that. So: run
it, and label it as regression evidence, not as proof of the fix. Calling a soak
"sufficient verification" of a deterministic fix is how we get percentages
without conditions attached.

## Additions of my own

**1. Ship A and B as ONE release train.** M1/M2/B1 are kernel; B2 is the bridge,
which re-pins the kernel anyway. Two prod bridge deploys in one day is strictly
worse than one. The train is: kernel **4.49.0** (A1 + A2 + B1) → re-vendor →
bridge **2.102.0** (B2) → single coordinated deploy, east first per the standing
runbook. Codex's dependency order (`A1/A2 → B1/B2 → A0 → C`) is preserved; this
just says the two phases share a release, not a deploy window each.

**2. Predict and monitor the direction M1 pushes.** Un-latching makes nodes
*less* saturated, therefore *more* willing to accept roles — which is the
correct direction (they were refusing wrongly), but it means **role counts on
browser peers will rise after A ships**, and the ungated paths from M3 are still
ungated until Phase D. That is a predictable, monitorable effect and it belongs
in A0's rollback signal: if role counts on a class of node rise without a
corresponding delivery improvement, roll back rather than reason about it.

**3. Do not let M4 lag far behind M1.** Between A and D, saturation detection
rests almost entirely on the newly-windowed `helloPressure`, because
`servicePressure` structurally cannot fire (F3) and the count backstop is far
off. That is still strictly better than today — today's signal is
over-sensitive and stuck — but it is a single-signal regime, and it should not
be the steady state for long. M4 moves into Phase D's first slot, ahead of D1.

## Consolidated execution order

```
A1  claimReachable null guard            ─┐
A2  _tickLagMax 12-tick rolling window    │ kernel 4.49.0
B1  _writeNamespace throws on unknown ns ─┘
B2  bridge admission telemetry (authenticated detail + public aggregate) → bridge 2.102.0
A0  release evidence: named fences + direct commands + soak record + rollback signal
        ↓ (single coordinated prod deploy, east first)
C   test gate: de-&& the runner · wire 15 orphans · used→declared fence · re-land 4.42.0 items · reconcile ledger
        ↓ (nothing below starts until C is green)
D   D0 = M4 service-stamp  →  D1 = gate ADOPT/REPLICATE/read-repair behind caller-closure tests + SLO A/B
        ↓
E   E1 M5 contract · E2 M6 restore · E3 M7 state codec  →  E4 dead surface · E5 INVARIANTS.md
        ↓
    internal boundary moves → ordered refreshTick decomposition → AxonaPeer carve → 5.0 export narrowing
```

## Corroborating field evidence recorded (pass 5)

Antigravity reports that the chat client has shown **unexplained gaps in message
replay history and silent handoff failures** during development. On the N1
mechanism those are the expected symptom: a backgrounded browser peer is
permanently saturated, `admitPushedRole` returns false for the life of the page,
and it therefore refuses the HANDOFF that carries a departing node's last copy.
That is a third independent system exhibiting the predicted signature — recorded
here as corroboration, not as proof, since it was not instrumented at the time.

---

# M18 + M19 — load shedding, and the missing primitive underneath it (2026-07-28)

*Raised by David: "how are we dealing with a role-overloaded node that should
not take on additional work?" and "the bridge refuses all roles — how does it do
this successfully when it is closest to the topic id?" Both questions found gaps
that none of the six review passes listed. Everything below is measured.*

## M19 🔴 A refusal at a routing terminus DROPS the message — there is no next-closest fallback

This is the more fundamental of the two, so it comes first: **M18 cannot be built
until M19 exists.**

**Measured.** A `neverRoot` node that is the topic-closest terminus:

| incoming | outcome |
|---|---|
| bare-topic `PUB` (`via: []`) — the normal path | **nothing forwarded**; `role-refused` + `undeliverable`; 0 roles. The message is gone. |
| `PUB` carrying a surviving via waypoint | forwarded one hop — the only case that survives |
| `ADOPT` (be a CHILD relay) | **accepted** — so "refuses all roles" was never true; it refuses ROOT only |

`_rerouteDeclined` (`AxonaManager.js:222`) pops one via hop and returns true only
if a *different* node remains. With no via — which is what an ordinary publish
carries — it returns false and the caller calls `_undeliverable`. That is
deliberate and it is the right local behaviour: the alternative, falling through
to the topic id, hands the message straight back to the same node and spins the
process. That loop is what took the east bridge down for ~50 minutes on
2026-07-27.

So the kernel today has exactly two answers to "should I take this role?" —
**accept**, or **drop it and say so**. It has no way to say **"not me, try them."**

The design already knew half of this. `become()`'s comment reads: *"a terminus
that refuses drops data"* — which is precisely why every SOFT reason is floored
at terminal sites. The HARD bridge fence was allowed through that gap on the
grounds that a bridge rooting is worse than a topic losing a message. That trade
was made knowingly, but its cost has never been stated: **any topic whose
keyspace neighbourhood is closest to a bridge has no home, and publishes to it
are dropped.**

**Why production has not shown this.** Topic ids are region-prefixed, and each
region has 9 relays plus browser peers, so a bridge is rarely the closest node to
any given topic. That is a *probabilistic* escape, not a designed one. It gets
worse as regions thin out — exactly the sparse-region case where
`isRegionLockEnforced=false` is supposed to let topics roll over to neighbours.

**The missing primitive: DECLINE-WITH-REDIRECT.** A refusing terminus should
answer the sender with "I decline; the next-closest candidates I know are
[A, B, C]", and the sender re-routes excluding the decliner. Neither taking the
work nor destroying the message.

That one primitive is load-bearing for **three** separate roadmap items:

- **M3** (gate ADOPT/REPLICATE/read-repair) — Codex's D1 amendment already says
  every newly-declined path needs a defined terminus. This *is* that terminus.
- **M18** (shedding, below) — a shed is a refusal in the opposite direction; it
  needs somewhere to send the work.
- **M19** itself — the bridge fence stops costing data.

**Fences:** a declining terminus emits a redirect, not a drop; the sender
re-routes and the topic lands on the next-closest admitting node; a chain of
refusals terminates (bounded redirect budget) rather than ping-ponging; and the
`undeliverable` path remains for the genuine case where nothing routable will
take it.

## M18 🟠 There is no load shedding — admission controls intake only

**Measured.** `saturated()` is read at **three sites, all admission**
(`canAcceptRole`, `admitPushedRole`, `inspectAdmission`). Nothing else in the
kernel consults it. `axonRoles.delete` appears **once**, in the refresh tick's
idle sweep, and its condition is *idleness* — no subscribers, no held history,
not keyspace-pinned, not a backup, no metrics lease, not subscribed, not hosted.
Never *pressure*.

So a node that becomes overloaded **after** acquiring its roles — through churn,
through neighbours departing, through its own host slowing down — has no way to
give anything back. The only exits from a role are that role going idle, or
`leave()`.

**This explains a pattern in our own incident history:** every overload event so
far has ended in a restart, because **a restart is the only shedding mechanism
we have.**

**Shape of the fix.** On sustained pressure (not a spike — the A2 window is
exactly the signal that distinguishes them), a saturated node hands its
*least-essential* roles to cohort members that pass admission, using the handoff
machinery that already exists and was scaled in 4.42/4.44:

- **shed order:** BACKUP first (a redundant copy, cheapest to move) → CHILD →
  never a sole-copy ROOT, and never a role whose `replicas.size === 0` and
  `cache.length > 0`. `inspectHosting().singletonRoots` already counts exactly
  that set.
- **evidence, not optimism:** a shed proceeds only on positive proof the
  recipient *admitted* it — the same rule that fixed the leave handoff (#361,
  #363). A fire-and-forget shed is data loss with extra steps.
- **hysteresis:** shed until below a *lower* threshold than the one that
  triggered it, or a node oscillates on the boundary.

**The danger, stated plainly.** Shedding under load is the exact shape that
caused **#333** — the 4.24.0 regression where churn multiplied topic state and
collapsed the backbone twice. A shed that lands on an equally-loaded neighbour is
a cascade, and a cascade under churn is how we lost the backbone before. So M18
requires, non-negotiably: M19's redirect (somewhere to send it), M4's honest
pressure signal (something true to trigger on), D1's caller-closure discipline,
and a sim A/B that specifically measures *whether the shed propagates* — not just
whether the shedding node got better.

**Sequencing.** M19 → M4 → M3 → **M18**, all inside Phase D, in that order.
M18 is last because it is the only one that can make things worse if the three
below it are not already true.

## The generalisation worth keeping

> **Refusal without redirection is just loss.**

We have spent this whole review adding the ability for nodes to say *no*
— the bridge fence, the admission gate, saturation. Every one of those is
half a mechanism. A distributed system where a node can decline but cannot
redirect has not moved the work; it has deleted it. The next phase should treat
"where does the declined work go?" as part of the definition of every refusal,
not as a follow-up.

---

# M20 🟡 Root-beacon disclosure is unbounded on emit, while every comparable surface is capped (2026-07-28)

*Raised by David after tracing what a node announces on becoming root. Recorded
as a deliberate-decision item, NOT a change to make now — see "Why not to touch
this yet".*

## The observation

`_emitRootBeacons` (`rootElection.js:31`) builds the announcement as:

```js
const rooted = [];
for (const [t, r] of this.axonRoles) if (r.isRoot) rooted.push(t);
...
topics: rooted.map(idHex),          // ← every root this node holds, no cap
```

Reach is `BEACON_FANOUT` 6 × `BEACON_LAYERS` 2 ≈ **42 nodes**, re-emitted every
`BEACON_MS` (20 s) and immediately on every root transition. So a node
unilaterally hands ~42 neighbours a complete **topic → node map** of everything
it roots, unrequested.

**The asymmetry is visible inside the beacon mechanism itself.** The RECEIVE
side is already capped — `payload.topics.slice(0, 256)` (`rootElection.js:59`) —
but that is a D-1-class inbound-parsing bound protecting the receiver from a
hostile sender. Nothing bounds what an *honest* sender discloses.

Compare the sibling surfaces, all of which were deliberately bounded:

| surface | disclosure | bound |
|---|---|---|
| `local_probe` reply | my neighbours | **8** (`LOCAL_PROBE_MAX`, D-4) — *"too few to cheaply map the mesh"* |
| bridge `/healthz` public | health verdict | **1 derived bit** (B2, today) |
| bridge `/healthz` authed | roles, capacity, refusals | operator token (B2, today) |
| root beacon `topics[]` | **every topic I root** | **none** |

The `local_probe` cap exists verbatim because *"that's a cheap map of our
neighbourhood for eclipse targeting."* A root beacon is the same class of
artefact one layer up: a map of which node holds which topics. We bounded the
peer map and left the topic map open.

## Why this is defensible, and why it still deserves a decision

**The honest case for leaving it open:** the pointer is exactly what correct
routing would compute anyway. An attacker can already learn "who roots topic T"
by routing a `PULL` at T and seeing who answers. The beacon does not reveal a
secret; it saves an adversary the probe traffic. And `_onRootBeacon`'s
verify-don't-trust rule means the disclosure cannot be *weaponised* to misdirect
— a forged beacon can only name a node at least as close as honest routing.

**The case that it is still a gap:** it converts an O(topics) active probing
cost into a passive, free, continuous feed delivered to 42 nodes without asking.
That is precisely the distinction D-4 drew for the peer map. And placement
defence (E-1) is about making targeting expensive; a free topic→node census
undercuts that.

There is also a **bandwidth** dimension nobody has costed. For R roots, each
beacon body is ≈ 69 B × R, sent to 6 neighbours and re-forwarded by each:
≈ 42 sends per announce round, every 20 s. At R = 500 that is ~34 KB per beacon
and ~1.4 MB per round per relay. **R has never been measured on prod** — Howard's
546 was total roles, not roots — so this is arithmetic, not a finding. Measuring
R is a prerequisite to arguing either way.

## Why NOT to touch this yet

The beacon is load-bearing for **three** separate incident fixes:

- the last-mile correction for greedy-routing strands,
- the cold-publish timing gap (measured 0% discovery before the immediate announce),
- split-brain resolution — a receiver **demotes** its own claim on a strictly-closer beacon.

Capping `topics[]` naively would silently stop advertising some roots, and an
unadvertised root is exactly the "reader isRoot, cacheSize 0, sticky" condition
that cost us the 4.24.0 cycle. **A disclosure cap here is a convergence change
wearing a privacy costume**, and it must be gated like one.

## What to do

1. **Measure R first** — root counts per node class (relay / browser / bridge)
   on prod, via B2's authed admission endpoint once 4.49.0 + 2.102.0 are live.
   `inspectRoles()` already distinguishes `isRoot`. Without R, both the privacy
   and the bandwidth arguments are speculation.
2. **Then decide explicitly**, and write the decision down either way. Options,
   cheapest first: leave open with a stated rationale; cap at K-closest-to-each-
   *recipient* (each neighbour hears the topics it is most likely to need, which
   is also the routing-useful subset); or split into a bounded periodic beacon
   plus unbounded immediate announce on transition only.
3. **Fence whichever is chosen** against the three incidents above —
   `smoke_pubsub_beacon`, `smoke_root_reconcile`, `smoke_cold_burst` — before it
   ships.

**Owner:** folds into the E-1 placement-defence work rather than Phase D.
Nothing here is urgent; the point of recording it is that the asymmetry was never
a decision, and the next person to look at the beacon should find that stated
rather than infer consent from silence.

---

# M21 💡 PROPOSAL — role delegation: separate WHERE work lands from WHO does it (2026-07-28)

*Proposed by David. Unlike M18–M20 this is a DESIGN PROPOSAL, not a measured
defect — recorded here so the reasoning survives, with the objections attached.
Nothing below is implemented and nothing is scheduled.*

## The proposal

An overloaded node that is the topic-closest terminus does not refuse. It picks
a **manager** — a lightly-loaded node it is connected to, ideally somewhat near
the topic id — and delegates the role. Thereafter it forwards: a SUB arrives, it
goes to the manager, which adds the subscriber; a PUB arrives, it goes to the
manager, which stamps and fans out. As far as the network is concerned, the
address-closest node is still providing the service.

The bridge is the motivating special case (it may never root, but it can appoint
someone who can). The general case is any node that would be pushed over its
budget by one more role.

## Prior art: half of this already exists

The axon tree **already delegates** — just not the claim. At
`MAX_DIRECT` = 20 direct subscribers a relay promotes a child and hands it a
batch of `DELEGATE_BATCH` = 8 via ADOPT (`wireHandlers.js:170`, `_delegateTo`).
Fan-out load is already poolable.

What M21 adds is delegating the **root claim itself**. That is a categorically
larger step, and the whole difficulty sits in that difference.

## Why it is a strong idea

1. **It is the third answer M19 says we lack.** Today a terminus can only accept
   or drop. "I accept, and I appoint someone" is neither — and crucially it
   **requires no change to any sender**. Routing still terminates where it always
   did. A redirect protocol changes every sender; this changes none of them.
2. **It makes capacity poolable.** Today capacity is strictly per-node and the
   keyspace decides who bears load; nothing lets an idle node relieve a drowning
   one unless the address space happens to route that way. Delegation decouples
   *where work lands* from *who performs it*. That is a bigger prize than the
   bridge case that prompted it.
3. **Bridges are uniquely well-placed to choose.** A bridge holds the most
   connections and therefore the best view of who is idle. If any node should be
   making placement decisions, it is that one.

## The deep problem: it introduces a SECOND source of authority

Today authority is **derived from the address**, and that makes it
*independently checkable by anyone*: any node can compute "is X closest to T?"
without trusting a third party. That single property is what lets
`_onRootBeacon` safely accept hints from strangers, and it is what
verify-don't-trust rests on.

Delegation adds: **"I am root because the address-holder said so."** That is not
independently checkable. It requires a signed, expiring grant, and then
revocation — which in a partitioned network is genuinely hard. Without it,
"X delegated to me" is a topic-capture primitive.

**Two live mechanisms will actively dismantle a deputy.** A manager is by
construction *not* closest to the topic, so:

- `_verifyRoots` (`rootElection.js:255`) has every root periodically confirm via
  iterative lookup that it is still the terminus. The deputy finds a closer node
  and **demotes itself**.
- `_onRootBeacon` (`rootElection.js:69`) demotes any claim beaten by a
  strictly-closer beacon. Any honest neighbour dissolves the deputy.

Those are not obstacles to route around: they are the two guards that keep
*exactly one root per topic* true, and each was installed after an incident. A
deputy needs an exemption from both — and an exemption is only safe if the grant
is verifiable. **The authority question is therefore not a detail to add later;
it is the design.**

## Failure modes

**Manager dies.** It held the cache, so this is a root death with all the same
durability machinery required. Worse: replication targets are computed from the
*topic id*, and the manager is not near the topic id, so its cohort selection is
wrong — it replicates to nodes a reader will never route to. That is **#362**
(out-of-region replicas: durable but unfindable) in a new costume.

**Principal dies. This is the dangerous one.** The manager holds a role for a
topic it is not near, with a principal that no longer exists, and *nothing tells
it*. It keeps serving. Meanwhile routing re-terminates at the next-closest node,
which mints a fresh root — split brain, with stale subscribers pinned to a ghost.

This is precisely the **#333** bug class. From the kernel's own comment:
*"a BACKUP whose principal was dead — a state nobody had modeled —
self-perpetuated into the backbone collapse."* A DEPUTY with a dead principal is
the identical shape. **We have been bitten by exactly this once, and it cost a
backbone.** Any delegation design that does not answer it first is repeating a
known failure.

**Chains.** May a manager sub-delegate? Without a hop limit, chains multiply
latency and failure points. With one, the limit case is… M19's redirect.

## What it does not fix, and what it costs

**Does not fix:** the production measurement is 546 roles at 200% CPU, with the
overwhelming majority arriving via **ADOPT and REPLICATE — neither gated**. That
node also could not tell it was overloaded (`servicePressure` structurally pinned
at 0.028). So delegation without **M4** (honest measurement) is a mechanism that
never triggers, and without **M3** (gate the pushed paths) the roles arrive
through doors delegation never sees.

**Costs:** total network work goes UP — one extra hop per message, permanently —
and the delegating node stays in the hot path for every message on every
delegated topic. It reduces load on the delegator, not on the system.

## The variant worth building instead: REFERRAL WITH A LEASE

There is a fork hidden in the proposal. If the manager fans out directly,
subscribers see `from = manager` and **re-pin to it on the first delivery** — the
delegation self-dissolves into a direct relationship within one cycle. That
looks like a bug against "the bridge provides the service", but it is arguably
the point, and leaning into it removes both failure modes by construction:

- the grant is **signed by the principal and carries an expiry** — authority
  becomes checkable and self-revoking, no revocation protocol needed;
- the deputy is exempt from verify-demotion **only while it holds a live grant**;
- the deputy is **beaconed as the root**, so readers converge on it directly and
  the principal leaves the data path after introduction — consistent with
  everything else here (*the bridge is bootstrap-only, not data-path*, proven in
  the 4.17.2 bridgeless work);
- **renewal is the liveness proof in both directions**: principal dies → grants
  stop renewing → the deputy expires cleanly instead of serving as a ghost;
  deputy dies → the principal re-delegates. This reuses the renewal-as-failure-
  detector pattern the system already runs everywhere, rather than inventing a
  second one.

That is *referral with a lease* rather than *permanent proxying*, and it turns
both failure modes into timeouts instead of unmodeled residual state.

## Sequencing

**After M19, not instead of it.** A redirect is the degenerate case of a
delegation with no grant. Building the simple one first buys the decline-path
plumbing, the caller-closure tests (D1), and — most importantly — **real data on
how often a terminus actually needs to decline**. If declines are rare,
delegation is over-engineering; if they are constant, delegation is obviously
right and we will know exactly where to put it.

Order: **M19 → M4 → M3 → M18 → M21**.

## Open questions to settle before any implementation

1. Does the deputy **beacon as root** (referral, principal exits) or does the
   principal keep beaconing (proxy, principal stays in path)? These are different
   systems; pick one deliberately.
2. Grant lifetime, and what a deputy does when a renewal is merely *late* versus
   *stopped* — the same evidence-vs-time distinction that fixed the leave handoff.
3. Does a delegated role count against the **deputy's** admission budget? It must,
   or delegation is a budget-laundering primitive.
4. Whose cohort does the deputy replicate to — the topic's, or its own? (The
   topic's, per #362, which means the deputy must compute a cohort it is not part
   of.)
5. Sub-delegation: permitted with a hop cap, or forbidden outright?

---

# Review Pass 7 — FIELD REPORT: the A/B train shipped to production (2026-07-29)

*Not a review pass in the earlier sense. Passes 1–6 were readings of code; this is
what the code did when it met production. Recorded because it answers a question
the plan had explicitly deferred, and answers it in a way that changes the order
of work.*

## What shipped

The A+B train went out as PLAN v2 §Additions-1 specified — one release, one
coordinated deploy, east first:

```
kernel 4.49.0 (A1 + A2 + B1) → bridge 2.103.0 (B2) → relay 0.92.0
east bridge → west bridge → 3 relay droplets × 3 units, one droplet at a time
```

Both prod bridges and all nine backbone relays are on it. Zero errors on any
host, functional round-trips confirmed by independent probe sessions.

**A correction that matters to this document.** PLAN v2 and the M-items were
written believing production ran **4.43.0**. It ran **4.48.0**. The figure came
from a deployment note and was never checked against `/healthz`. So 4.46
(axonic admission) and 4.47 (capacity as measurement) were *already carrying
production traffic* while this scorecard reasoned about them as pending. The
A/B train was a four-fix bugfix release against defects live in prod, not the
introduction of a subsystem. Nothing in the analysis is invalidated — but the
risk framing was wrong in the safe direction, and the lesson is the one this
document keeps rediscovering: **a version claim used to size work must be read
from the running service.**

## A1 is confirmed in production — and the numbers are the finding

A1 was the null dereference in `claimReachable` on a `neverRoot` node. A bridge
*is* `neverRoot`, so the first role refusal killed `refreshTick` inside its own
swallowing `catch` for the life of the process. Before B2 there was no way to
observe it: `/healthz` returned the literal string `ok` regardless of state.

With the operator endpoint live:

| | east | west |
|---|---:|---:|
| `refusals.bridge`, first ~25 min (bridges only) | 6 | — |
| immediately after the 9-relay roll | 1050 | 826 |
| ~40 min later | 1256 | 1030 |
| `tickStalls` / `loop.stalls` throughout | 0 | 0 |
| `tickLagMaxMs` (12-tick window) | 2 | 3 |
| `tickLagPeakMs` (all-time) | 409 | 63 |

`refreshTick` survived every one. That is ~2,286 executions of a code path that
had never run anywhere before, on machines where the same event previously
killed maintenance permanently and silently.

**A2 also has its first real evidence.** East absorbed a **409 ms** stall — five
times anything seen in ten hours of testnet soak — and the window returned to
2 ms. On 4.48.0 that reading would have latched at 409 forever, and at a larger
value would have pinned the bridge `saturated` permanently. Mechanism confirmed;
recovery *from actual saturation* (≥0.6) still unobserved, since 409 ms is
helloPressure ≈ 0.08.

## THE CONSEQUENCE: M21's decisive question is answered, and B2 answered it

M21 closed with a sequencing argument (`M19 → M4 → M3 → M18 → M21`) resting on
one empirical unknown, stated there verbatim:

> *"real data on how often a terminus actually needs to decline. If declines are
> rare, delegation is over-engineering; if they are constant, delegation is
> obviously right and we will know exactly where to put it."*

**Declines are constant.** Two rates, with conditions attached — kernel 4.49.0,
prod, region eagle, 9-relay backbone plus ordinary browser population:

- **Burst:** ~1,000 refusals per bridge across a rolling restart of nine relays.
  Each joining node attempts ~100+ role placements that route to a bridge.
- **Steady state:** ~**15 refusals/minute/bridge** with nothing unusual
  happening — east 1256 → 2210 and west 1030 → 1982 across a later ~65 min
  window with no fleet restart in it. It never reaches zero.
  *(An earlier draft of this section said ~5/min, estimated from the first
  post-roll window while the burst was still draining. The steady-state figure
  is three times that. Corrected rather than left for a later reader to
  re-derive.)*

The plan intended to *build M19* in order to learn this. It did not have to:
**B2 — the smallest item in the entire train, a telemetry change — produced the
number that decides a design question scheduled four items later.** That is the
strongest available argument for the position this document already takes in
Phase 0 ("trustworthy observation precedes measuring regressions"), and it
should be read as a general rule, not a lucky break: *when a plan defers a
decision pending data, ask first whether an observability change can produce the
data without the mechanism.*

## What the measurement says about the bridge specifically

M21 called the bridge "the motivating special case." The data says it is not a
special case — **it is the highest-frequency case**, and it is structurally
different from the general one:

1. A bridge is permanently in the keyspace and is therefore periodically
   topic-closest, exactly like any other node.
2. A bridge holds the most connections, so more placements route through it.
3. A bridge can **never** accept. Not "is currently full" — *cannot ever*.

So every one of those ~2,286 placements was routing work that terminated in
nothing. A bridge is not a node that is sometimes saturated; **it is a permanent
hole in the keyspace, positioned precisely where connectivity is densest.**

## M21 SPLITS IN TWO — and the bridge half is buildable much earlier

This is the substantive change to the plan. M21 treated delegation as one
mechanism. The production data separates it into two with different dependencies:

**M21-S — STRUCTURAL delegation (the bridge case).** The decline condition is
`neverRoot`: static, known at configuration time, never changes, never
oscillates.

**M21-L — LOAD-TRIGGERED delegation (the general case).** The decline condition
is "I am over budget": dynamic, measured, and reversible.

M21's own strongest objection applies only to the second:

> *"delegation without **M4** (honest measurement) is a mechanism that never
> triggers"*

True for M21-L — a node that cannot tell it is overloaded will never delegate.
**False for M21-S.** A bridge does not need to measure anything to know it will
refuse; it knows before it starts. Consequently:

| | M21-S (bridge) | M21-L (general) |
|---|---|---|
| needs M4 honest measurement | **no** | yes, absolutely |
| trigger | static config | live pressure |
| oscillation risk (delegate ↔ reclaim) | **none** — never wants it back | real, needs damping |
| deputy selection | easy — bridge sees everyone | hard — who is idle? |
| grant renewal cadence | slow, it is a standing fact | must track load |

**M21-S is a strictly smaller problem than the one M21 analysed, and it is the
one with the measured demand behind it.** It can be built before M4 and before
M3; M21-L still cannot.

## What does NOT get easier, and must not be waved through

**The authority problem is untouched.** Structural does not mean checkable.
Today authority is derived from the address and independently verifiable by
anyone; a deputy's claim is "the address-holder said so," which is not. The
signed expiring grant, and the exemption from `_verifyRoots` (rootElection.js:255)
and `_onRootBeacon` (rootElection.js:69), are required exactly as M21 states —
those two guards exist to keep *one root per topic* true and each was installed
after an incident.

**One genuinely new question the structural case raises:** `neverRoot` is a
declared property of a node. If it were declared *on the wire* (handshake or
beacon) rather than held privately, "this node cannot root, so its delegation is
expected" becomes something a third party can reason about — closer to checkable
than a load claim can ever be, since load is unfalsifiable from outside and
`neverRoot` is at least a stable, attributable assertion. **Open question, not a
design:** does publishing `neverRoot` make the grant verifiable, or does it only
move the trust from "X says it delegated" to "X says it cannot root"? Settle
this before building, because it is the difference between an exemption that is
safe and one that is a topic-capture primitive.

**The dead-principal failure mode is unchanged and is still the one that cost a
backbone (#333).** Referral-with-a-lease answers it — grants stop renewing, the
deputy expires cleanly rather than serving as a ghost — and the bridge case does
not weaken that requirement at all.

**Bridges leaving the data path is the right end state anyway.** M21's referral
variant has the deputy beacon as root and the principal exit after introduction.
For a bridge that is not a compromise, it is the architecture we already claim
and proved in the 4.17.2 bridgeless work. M21-S and *the bridge is bootstrap-only,
not data-path* point the same way.

## Two observability defects found in the same week — widen M4

M4 is currently scoped as honest *service* measurement. Two independent findings
this week say the scope is too narrow:

1. **F3 / M4 proper** — `servicePressure` structurally pinned at 0.028 while a
   node held 546 roles at 200% CPU. A number that cannot move.
2. **#411 (new)** — `axona_status` reports the synaptome under the name `mesh`.
   `synaptomeSize` and `peers` are the same set counted twice, and neither is a
   count of live WebRTC channels. **This produced a false conclusion during this
   very deployment**: a routing-table refill after a bridge restart was read and
   reported as a mesh collapse, which would have implied the bridge is on the
   data path — the opposite of the property the system rests on. Corrected only
   by reading kernel source, because no operator surface exposes channel count.

The common failure is not inaccuracy, it is **a name that does not match its
referent**. M4 should therefore cover: *every operator-facing metric names what
it actually measures, and the load-bearing properties have a metric at all.*
"Did the mesh survive?" is the central question for a protocol whose thesis is
that the bridge is not on the data path, and today it cannot be answered from
the outside.

## Revised execution order

Only two edges change. The A/B train is done; M19's data-gathering rationale is
discharged; M21-S is unblocked from M4.

```
A1 A2 B1 B2 ─ SHIPPED TO PROD 2026-07-29 (kernel 4.49.0 / bridge 2.103.0 / relay 0.92.0)
        ↓
C   test gate  ── unchanged, still blocks everything below
        ↓
D0  M4 service-stamp + metric-naming audit (now includes #411)
        ↓
D1  gate ADOPT/REPLICATE/read-repair behind caller-closure tests + SLO A/B
        ↓
        ├─ M19 redirect  ── still wanted for decline-path plumbing and D1 closure,
        │                   but NO LONGER the way we learn whether declines are common
        │
        └─ M21-S structural delegation (bridge)  ── may start after C, in parallel
                                                    with D; does NOT wait for M4
        ↓
M18 → M21-L load-triggered delegation  ── still strictly after M4
        ↓
E …  (unchanged)
```

**Why M21-S still waits for C and not for D:** it introduces a second authority
source, and C is what makes the test suite capable of showing a full run. An
authority change gated on an instrument that cannot report its own completeness
repeats the A0 mistake this plan already caught once.

## Open decisions for David

1. **Build M21-S against the bridge case now (after C), or hold all delegation
   until M4?** The measured demand (~2,286 declines/40 min) argues for now; the
   second-authority-source risk argues for care, not delay.
2. **Publish `neverRoot` on the wire?** Prerequisite to answering whether a
   structural grant can be made independently checkable.
3. **Does a delegated role count against the deputy's admission budget?** M21
   open question 3 — unchanged, and it must be yes or delegation launders budget.
4. **#411 into M4's scope, or a standalone fix now?** It is small, and it already
   caused one wrong production conclusion.
