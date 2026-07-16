# Diagnosis — the 4.22.1 alert-bot read misses, reproduced and attributed

*2026-07-15 · follow-up to [NOTE-Howard-4.22.1-alertbot-misses.md](./NOTE-Howard-4.22.1-alertbot-misses.md).
Reproduction: `axona-stress/soak-axon.mjs` `scenarioAlertbot`, instrumented. Field
corroboration: Howard's expanded-`axonRoles` run [`4.22.1A-alert-bot.txt`](./4.22.1A-alert-bot.txt).*

## TL;DR

The three candidate mechanisms from the note map to the task's (a)/(b)/(c):

| # | Mechanism | Verdict |
|---|---|---|
| (a) | Leave-handoff **time** shortfall (700+ roots can't hand off in the ~5s window) | **REFUTED** |
| (b) | Fresh reader **self-roots an empty topic** instead of pulling from the holder | **DOMINANT** |
| (c) | Convergence **lag** at high fan-out | **REFUTED** (misses are sticky, not slow) |

A secondary **durability** failure (the note's hypothesis 3) is also real but distinct
from (a): the leave-handoff is *fire-and-forget with no ack/retry*, so when heir
resolution fails it silently transfers nothing — independent of the time bound.

**The lever is reader-side rooting, not the handoff window/concurrency.** A node that
claims root for a topic it holds no history for must pull from / probe the cohort
(prior holder) before serving as an authoritative empty root, or defer the empty
claim until it has. Kernel 4.23.2's stall-exit fixes the ~5s leave *hang* but does
**not** touch (b) or durability — consistent with the note.

## How it was reproduced

Howard's worst run was 1389 topics in **0x47 (easteu), which the relay backbone does
not cover** — so the cold publisher is the XOR-closest live node for ~all its topics
and *sole-roots* them. That is the regime the leave-handoff and reader-rooting paths
are actually stressed in.

The soak defaults to `useast`, which sits on top of the relay fleet — there the
publisher roots only ~10-13% of its own topics (the relays absorb rooting), so the
(a)/(b) machinery is barely exercised (verified: 3-4/30). **Publishing into easteu
restores the sole-root regime** (verified: 30/30 rooted), matching Howard.

Instrumentation added to `scenarioAlertbot` (observe-only; env `ALERTBOT_DIAG=1`):
- **publisher role snapshot at leave** — how many expected topics it roots (the handoff workload) via `health().axonRoles`.
- **`LEAVE_TIMEOUT_MS`** — vary the handoff window (`peer.leave({timeoutMs})`): 5000 (field) vs 90000 (wide).
- **reader role snapshot** — per missed topic, is the reader `isRoot && cacheSize==0` (the (b) smoking gun)?
- **lag re-check** — re-tally after a 45s renewal window (`recoveredByLag`) to catch (c).
- **cross-region holder-exists oracle** — a prober in `useast` subscribes to each missed easteu topic **by 66-hex id**; being far in XOR it *defers and pulls* instead of self-rooting. Recovers ⇒ a holder exists ⇒ (b). Also misses ⇒ history gone ⇒ durability. The oracle is self-validating: it recovered **40/40 when data existed** and **0/40 when it didn't**.

## Evidence

### First-session sweep (clean fleet), easteu, leave 5s

```
topics=  93   recov=100%   zero=0    leaveMs= 49  pubRooted= 93/93
topics= 489   recov=100%   zero=0    leaveMs= 80  pubRooted=489/489
topics=1389   recov=97.5%  zero=36   leaveMs=119  pubRooted=1388/1389
              → all 36 misses: reader isRoot & cacheSize==0 ; byLag=0
topics=1389   leave=90000ms  recov=99.9%  zero=0  leaveMs=182   (wide window UNUSED)
```

Faithful to Howard: his 483-topic easteu run was 100% (mine: 489 → 100%); his 1389 →
4.5% missed (mine: 2.6%). The residual appears at ~1389, not at 483 — **it is not a
simple function of topic count**, matching the note's observation.

### (a) — REFUTED

`leaveMs` is **13–478 ms in every run** and `leaveSaturated=false` everywhere — the
handoff never approaches the 5s bound. Widening the window to 90s changed nothing
(`leaveMs=182`, i.e. it didn't even use the extra budget). The handoff *dispatches*
1389 sole-rooted topics in ~120ms; the time window is not the constraint.

Field agrees: only **11/51 misses were publisher-rooted** at disconnect (0x80,
publisher rooted just 18/370) — leave-handoff cannot be the dominant path.

### (c) — REFUTED

`recoveredByLag=0` in **every** run — not one missed topic recovered during the 45s
renewal window. Field: the same `published-N-received-0` topics were still 0 at 600s.
The empty-self-root state is **sticky, not slow**.

### (b) — DOMINANT (recoverable: the holder has the data, the reader serves itself nothing)

Cross-region oracle, on runs where the handoff *did* run (`leaveMs` 270–478ms):
**`holderExists = 40/40` and `36/40`** — a live holder demonstrably had the history,
while the same-region reader had self-rooted an empty role (`isRoot, cacheSize:0`) and
never pulled it.

**Field corroboration (independently verified in `4.22.1A-alert-bot.txt`):**
- Of the reader's 100 visible root entries at timeout, **57 are `isRoot:true, cacheSize:0`** (empty self-roots) vs 43 that got a holder to replay up.
- Axona Main's id-intersection of the miss list against the role dumps: **42/51 misses (82%) are reader empty-self-roots; 0 misses show the reader rooting a non-empty cache;** 9/51 fall in the console-truncated tail.
- `cacheSize≥1` = a holder found the new root and replayed up; `cacheSize:0` = that reconciliation never arrived. So the mechanism is: **the heir/holder never learns of (or never pushes to) the reader's closer empty root within the window.**

### Secondary — durability (the note's hypothesis 3), distinct from (a)

On runs where `leaveMs≈11–15ms`, the oracle returned **`gone=40/40`** — no holder
anywhere. Here the leave-handoff resolved *no heir* (`findKClosest`/`lookup` returned
only self on a thin/degraded routing table) and, being **fire-and-forget**
(`_route(heir, HANDOFF)` with no delivery confirmation or retry), silently transferred
nothing. This is a *durability* loss, not a *window* loss — the fix is delivery
confirmation + retry (and/or proactive cohort replication), not a bigger timeout.

## Caveat on absolute rates — testnet fleet degradation

Late runs (after sustained high-fan-out easteu churn) collapsed to ~0% recovery with
`leaveMs≈11ms` / `gone=40/40`, and even **489 topics failed at 0%** after a 9-minute
rest — the small testnet fleet's routing for the 0x47 keyspace had degraded so heir
resolution stopped working. These catastrophic *rates* are a **fleet artifact, not
clean kernel behavior** (the harness's own `loadPerCore`/residue warnings anticipated
this). Trust the **first-session rates**, the **oracle mechanism split**, and the
**uncontaminated field data** — all three agree.

## Recommended fixes (in priority order)

1. **(b), primary — reader-side rooting.** When a node would `become`/`claimReachable`
   root for a topic with an empty cache, it must first **pull from the cohort / prior
   holder** (probe the K-closest for existing history) — or **defer the empty root
   claim** — rather than passively serving itself nothing and waiting to be
   discovered. This is the 82%-of-field-misses path.
2. **Durability, secondary — handoff delivery guarantee.** Give the leave-handoff an
   ack + bounded retry (or lean on proactive cohort replication) so a HANDOFF that
   fails to resolve/land does not silently lose the only copy. Note this is about
   *confirmation*, not the 5s *window* or the 8-way concurrency.

Neither lever is the handoff bound/concurrency the task flagged as the (a) lever —
because (a)-as-time-bound is refuted.

## Artifacts

- Instrumented harness: `axona-stress/soak-axon.mjs` `scenarioAlertbot`
  (`ALERTBOT_DIAG`, `REGION=easteu`, `ALERTS`/`CELLS` scale knobs, `PROBE_REGION`,
  `LEAVE_TIMEOUT_MS`).
- Raw results: `axona-stress/results/ab/diag-sweep.jsonl`, `diag-replicate.jsonl`,
  `diag-drained.jsonl`, `diag-rested.jsonl`.
- Rooting probe: `axona-stress/probe-rooting.mjs` (region rooting-fraction check).
