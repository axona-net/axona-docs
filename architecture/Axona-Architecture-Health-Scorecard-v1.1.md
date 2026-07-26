# Axona Kernel — Architecture Health Scorecard & Refactor Plan
## v1.1 — 2026-07-26 · re-review after the rollback and 4.43.0

*Supersedes v1.0 (2026-07-25), which stays on disk as the published baseline.
Deployed kernel as of this writing: **prod 4.43.0 · testnet 4.43.0** (one version
everywhere). v1.0 was written against prod 4.41.0 / testnet 4.39.0, mid-rollback.*

Everything below was verified against the working tree, not carried over from v1.0.

---

## 1. Where the plan actually stands

v1.0's revised sequencing had 7 steps. Status, measured:

| # | Step | v1.0 status | **Actual, 2026-07-26** |
|---|------|---|---|
| 0 | Pre-register SLO + gates (REPS≥5) | planned | **done, then changed** — see §4 |
| 1 | Free wins (delete unpub.js, table READ_REPAIR, close graft-ons, hexid/geo smokes) | planned | **code done; hexid/geo smokes WRITTEN BUT NEVER WIRED** (§3) |
| 2 | **Fix leave-handoff scaling** (Finding 0) | landed in 4.42.0 | **NOT IN THE SHIPPED KERNEL** (§2) |
| 3 | Handoff lifecycle telemetry | planned | not started |
| 4 | Internal boundary moves (crypto/canonical out of pubsub/) | planned | not started |
| 5 | refreshTick → ordered schedulers under one clock | planned | not started |
| 6 | AxonaPeer strangler carve | planned | not started |
| 7 | Exports narrowing rides 5.0 | deferred | still deferred, correctly |

## 2. The most important finding: Step 2 was undone by the rollback

Finding 0 in v1.0 records the leave-handoff scaling fix as *"FIXED in 4.42.0: window =
HANDOFF_ACK_MS + 25ms×batch (cap 5s), progress-aware with stall-exit; fenced by
test/smoke_handoff_scaling.mjs (K=68 herd: 0 unacked, was 68/68)."*

**4.42.0 was deliberately excluded from 4.43.0** — it never passed its gate and was
deployed nowhere, so leaving it out looked free. It wasn't free: it took Step 2 with it.

Verified:

```
v4.42.0:src/pubsub/constants.js
  HANDOFF_ACK_PER_TOPIC_MS = 25    // per-unacked-topic margin
  HANDOFF_ACK_MAX_MS       = 5000  // per-round cap

HEAD (4.43.0):src/pubsub/constants.js
  HANDOFF_ACK_MS = 700   // per-attempt ack wait      ← and nothing else
```

`repairPlane.js:878` is back to `const deadline = Date.now() + HANDOFF_ACK_MS;` — one
flat shared window per round — and the comment at `repairPlane.js:819` still asserts the
bound holds *"regardless of topic count"*, which is precisely the claim Finding 0
disproved with the K=68 herd arm (6,880 ms against a 5,000 ms budget).

**So prod today runs the unscaled handoff.** The single highest-priority item in the
plan, the one justified by live pain, is not in service.

Worse, the *fence survived while the fix did not*. `test/smoke_handoff_scaling.mjs` is
still on disk and imports the two constants that no longer exist, so it dies with a
`SyntaxError` — and nobody noticed, because it was never wired into `npm test` (§3).

**Recoverable cheaply:** the constants and the window logic exist in the `v4.42.0` tag.
This is a cherry-pick of a small, wire-compatible, heir-side-unchanged change plus its
fence — not a re-derivation.

## 3. New finding: the refactor's gains are not held by CI

v1.0's Rule 3 says *"A rule that isn't a test drifts."* The corollary it missed:

> **A test that isn't wired into CI is not a test.**

Measured across the kernel's 137 `smoke_*` files:

- **102** are referenced by `npm test`.
- **23** sit in `test:legacy-pubsub` — the deliberate Phase 1 quarantine (#222). Fine.
- **13 are referenced by no script at all.**

Those 13, run individually just now:

| result | test | note |
|---|---|---|
| PASS | `smoke_hexid.js` | **Step 1 wrote this** to close the "#1 fan-in, 18 importers, no tests" gap |
| PASS | `smoke_geo.js` | **Step 1 wrote this too** |
| PASS | `smoke_ghost_read.mjs` | #364 part-1 fence |
| PASS | `smoke_departure_hint.mjs` | #364 bridge-hint fence |
| PASS | `smoke_leave_handoff_burst.mjs` | handoff burst fence |
| PASS | `smoke_restart_handoff.mjs` | 60s, restart durability |
| PASS | `smoke_leave_teardown.mjs` | 9s |
| PASS | `smoke_root_reconcile.mjs` | (`..._reach.mjs` *is* wired; the base one isn't) |
| PASS | `smoke_public_topics.mjs` | |
| PASS | `smoke_standalone_lookup.mjs` | |
| PASS | `smoke_turn_encode.mjs` | #343 regression |
| **FAIL** | `smoke_handoff_scaling.mjs` | imports constants deleted by the rollback (§2) |
| **FAIL** | `smoke_resubscribe.js` | `am._onReplayBatch is not a function` — stale after a Phase 1/8 rename |

**11 of 13 pass.** They are not broken, they are simply not running. Wiring them is close
to free and immediately restores coverage that the refactor already paid for — including
the two tests Step 1 was specifically credited with delivering.

This reframes Step 1 from "done" to "code done, verification unhooked," and it is the
cheapest high-value work on the board.

## 4. What the recent changes add to the ruleset

Three items earned their place since v1.0. All are enforced in code today.

**Structural rule 5 — authority follows the ADDRESS, never ownership or interest.**
`host(topic)` refuses a topic the node's address is not near
(`HOST_NOT_IN_NEIGHBOURHOOD`, `errors.js:182`, `AxonaPeer.js:2113`), fenced by
`smoke_host_address_rule.mjs` (12 checks, both directions). This is the rule the
#axona.bot outage bought. It generalises the same way rules 1–3 did: the failure it
prevents is *an authority that holds nothing answering as though it holds everything*.

**Behavioural invariant I-ID — transport identity is ephemeral, author identity is
durable.** In `INVARIANTS.md` with an enforcement map: behavioural fences (restart
against the same store ⇒ different nodeId, with a positive control that author keys
persist) plus a per-repo static scan, because the behavioural tests could not see four
of the five persistence sites that existed.

**Structural rule 6 — no special-case topics.** The bridge directory used to be an
exception: its own `host()` call, its own pinned descriptor. It is now an ordinary topic
with an hourly heartbeat, and freshness *is* the liveness signal. The general form: when
a subsystem needs an exception to a rule, the exception is usually a missing mechanism.
The directory's real problem was "my launch publish can be lost into an empty mesh" —
solved properly by *republishing*, not by privileging itself.

## 5. What the recent changes change about the plan

**(a) The root system's assessment needs an amendment.** v1.0 said root *authority* is
single-sited and healthy, root *triggering* is diffuse. Both still true. But #397 adds a
third axis v1.0 didn't name: **root convergence has a hard scale ceiling.**
Reconciliation reach is `ROOT_REPLICAS` = 2 (`constants.js:63`;
`repairPlane.js:535` asks for 6 candidates, `:552` keeps 2), so two roots merge only
while N ≤ 3 — sim: MERGED 5/5 at N=3, SPLIT 0/5 at N=4…40, fenced by
`smoke_root_reconcile_reach.mjs`. Clean authority does not help if a second root can
never be absorbed. This belongs in the scorecard as a named structural risk, not just an
open ticket.

**(b) Step 5 (refreshTick) gains direct empirical support.** The 2026-07-26 soak
(5 cycles, prod-parity kernel, 32/40 green) failed *only* in live-delivery/convergence
paths. The durability paths — `backlog` and `gap`, both `since:'all'` replay — were 5/5
at 100%, and `restart`'s full-timeline recovery was 100% in every rep. Live convergence
is orchestrated by `refreshTick` and the wire handlers; stored history is the authority
layer. **The soak's failure boundary falls exactly on the scorecard's 🟢/🟠 boundary.**
That is the strongest evidence yet that the debt epicentre and the defect epicentre are
the same place, and it argues for keeping Step 5 ahead of Step 6 (AxonaPeer carve),
which the plan already does.

**(c) The gate definition has changed.** v1.0's H6 pre-registered "SLO = fresh-subscriber
delivery %, REPS≥5 mean±sd, Howard's axonSpec." Two amendments from experience:

- **Gates run on PROD, not testnet.** Testnet at N≈12 cannot exercise the regime the
  system runs in; a clean result there is weak evidence and a dirty one is
  unattributable. If a testnet soak is used at all it needs a fleet of **≥40 nodes**.
- **Do not reach for machine load as the explanation.** The 2026-07-26 soak refuted it
  outright: every failure sat at `loadPerCore` 0.67–1.03 while the five busiest reps
  (2.89, 1.87, 1.78, 1.69, 1.56) all passed — idle 79% ok vs busy 82%. "The laptop was
  busy" has been the reflex reading of sub-100% soak numbers; it is not always available,
  and treating it as a default hides real signal.

**(d) The build-integrity class is now fenced, and it belongs in the ruleset.**
`check_kernel_pin.mjs` (bridge/chat/share, in `npm test` *and* the deploy workflows)
asserts declared pin == lockfile == installed `KERNEL_VERSION`. It exists because three
repos in one release declared 4.43.0 while installing 4.42.0 or 4.38.0. Generalised:
**verify the artifact, never the manifest** — the same reflex as "check the residual, not
the exit code."

## 6. Revised sequencing (supersedes v1.0 §"REVISED sequencing")

| # | Step | Cost | Why here |
|---|------|---|---|
| **1** | **Wire the 11 passing orphans into `npm test`**; delete or fix `smoke_resubscribe.js` | trivial | Restores already-paid-for coverage. Nothing else should be built on an unhooked harness. |
| **2** | **Re-land Step 2 from the `v4.42.0` tag** — scaled ack window + its fence — and gate it on prod | small | The #1 live-pain fix is currently not in service. Cherry-pick, not re-derivation. |
| **3** | **Add a CI guard: every `test/smoke_*` file must be referenced by some npm script** | trivial | Makes §3 unrepeatable. This is Rule 3 applied to the test suite itself. |
| **4** | Handoff lifecycle telemetry (offered/acked/received) | low | Heir side is still invisible; needed to diagnose #400 and to attribute #2's effect. |
| **5** | Internal boundary moves (crypto/canonical out of `pubsub/`) | low | Unchanged from v1.0. Safe, unblocks later work. |
| **6** | `refreshTick` → ordered schedulers under ONE clock (H2), behind prod-scale gates | med-high | Now empirically the defect epicentre (§5b). |
| **7** | #397 — decide whether reconciliation reach becomes an iterative lookup | med | Design question, not a bug; but it caps convergence at N≤3 today. |
| **8** | AxonaPeer strangler carve | high | Unchanged. Still the largest liability, still last. |
| **9** | Exports narrowing rides 5.0 | breaking | Unchanged. |

Steps 1–3 are hours, not days, and two of them are pure verification hygiene. They should
land before any structural work resumes.

## 7. Unchanged from v1.0

The scorecard table, the three cross-cutting risks (AxonaPeer god-object; orchestration
never got the rules; boundary leaks blocking safe refactoring), rules 1–4, the behavioural
invariant list, and H1–H11 all stand as written. `transport/` remains explicitly deferred.
The mechanism freeze during refactor windows (H8) is worth restating given how much
incident work landed since v1.0.

## 8. Open question for David

Step 2 (re-landing the handoff scaling fix) means taking a change out of the 4.42.0 tag
we deliberately excluded. The rest of 4.42.0 stays excluded and still owes its own gate.
Confirm that a **targeted cherry-pick** is preferred over re-gating 4.42.0 as a whole —
the cherry-pick is far smaller and is the only part of 4.42.0 with a live-pain
justification.
