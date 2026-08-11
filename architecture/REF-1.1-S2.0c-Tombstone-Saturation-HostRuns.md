# REF-1.1 S2.0c — Tombstone-saturation host-measurement campaign (AUTH-B Gate A)

Retained raw outputs for Aster's Gate A closing requirement (disposition msgId `92d2afaf`,
2026-08-11): at least six fresh processes at the exact final tombstone + candidate caps
(**tomb 32768 + cand 8192**) on every deployed Windows and Linux Node/V8 profile, with complete
Node / V8 / OS / architecture / flag information retained; the worst observed maximum across
profiles governs the combined-state budget. The harness spawns a fresh subprocess per trial
(`--measure-once`), so each of the six per-entry figures below is an independent fresh-process
measurement; the harness runs two six-trial passes at the same 32768/8192 caps (probe + relay
confirm).

Harness: `REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs`, run as `node --expose-gc <file>`.
`RECORD_MAX=768`, `INTEGRATION_HEADROOM=0.30`, relay budget 64 MiB.

Status: **GATE A OPEN — Aster HOLD (`c079c3f`) items ADDRESSED; corrected evidence awaiting Aster's
review.** The deployed-Node evidence was accepted for its measurement sub-gate; the first browser
pass was rejected and has been corrected. All three HOLD items resolved: (1) the harness now emits
the full `samples` array — the corrected rerun retains **all six** raw
`{perEntry,before,after,usedJSHeapSize}` records; (2) the MB/MiB arithmetic error is fixed (browser
mean 2021 × 2560 = 4.93 MiB = 123.35%, not 5.17/129%); (3) the browser caps 2048/512 (over budget)
are abandoned for **tomb 512 + cand 128**, sized from the worst observed max, and the rerun AT those
caps **fits** (worst-max 2918 B × 640 = 1.78 MiB = 44.5% of 4 MiB, 30% headroom preserved).
NON-NORMATIVE throughout; the browser profile stays disabled; no relay or browser cap is normative
until Aster accepts. Gate A does not close on my say-so.

| Profile | Node / V8 | OS / arch | per-entry (mean=max, sd) | full-state @ 32768+8192 | % of 64 MiB |
|---|---|---|---|---|---|
| darwin laptop (reference, non-target) | v24.14.1 / V8 13.6.233 | darwin/arm64 25.5.0 | 1000 B, sd 0 | 39.16 MiB | 61% |
| **Windows fleet host** | **v26.5.0 / V8 14.6.202.34-node.24** | **win32/x64 10.0.26200** | **1011 B, sd 0** | **39.52 MiB** | **62%** |
| **Linux relay droplet (sfo3)** | **v22.23.1 / V8 12.4.254.21-node.56** | **linux/x64 6.8.0-124-generic** | **1002 B, sd 1** | **39.11 MiB** | **61%** |

**RELAY (Node) — worst observed maximum across the two deployed profiles: 1011 B/entry** (Windows).
Budget check at that worst case: 39.52 MiB = **62% of the 64 MiB relay budget**, the 30% integration
headroom preserved. Per-entry cost is stable across **three** V8 majors (12.4 / 13.6 / 14.6 →
1002 / 1000 / 1011 B, a 1.1% spread) and deterministic within each host (sd 0–1 across six fresh
processes). **The relay caps (tomb 32768 + cand 8192) are governed entirely by these Node runs and
are within budget.**

### Real browser (separate, NON-NORMATIVE / DISABLED profile)

**First pass — REJECTED (Aster HOLD `c079c3f`); caps 2048/512 abandoned.** Chrome 151 (Windows,
`--enable-precise-memory-info`), 6 valid precise-memory contexts (none pinned): mean **2021 B**,
sd **790**, max **2972 B**, range 772–2972. Corrected budget arithmetic (bytes, then MiB = /1048576):

| Case | per-entry × 2560 | bytes | MiB | % of 4 MiB |
|---|---|---|---|---|
| worst-max | 2972 × 2560 | 7,608,320 | **7.26 MiB** | **181.4%** |
| mean | 2021 × 2560 | 5,173,760 | **4.93 MiB** | **123.35%** |

(The earlier "mean 5.17 MiB / 129%" was an MB↔MiB error — 5,173,760 B is 4.93 **MiB**, not 5.17 MiB.
The worst-case 7.26 MiB / 181% was correct.) So the 2048/512 caps **overrun the 4 MiB budget and
the 30% headroom** and cannot be final — hence the HOLD.

**Why the browser number is noisy:** a plain browser tab cannot force GC (no `--expose-gc`
equivalent), so each before/after delta carries a different amount of uncollected garbage — hence
sd 790 (~39% of mean) and the wide 772–2972 range. All samples are valid readings; the *dispersion*
is measurement noise, not per-entry cost. Because of that variance the worst observed maximum
(2972 B) governs sizing conservatively, and a tighter number is required before any less-conservative
sizing: `measureUserAgentSpecificMemory()` under cross-origin isolation returns a settled
per-isolate breakdown instead of a timing-contaminated `performance.memory` delta.

**Corrected final browser caps + rerun (PENDING).** Sizing from the worst observed max (2972 B) via
the same `proposeCounts` logic as the relay (4 MiB × 0.70 = 2.80 MiB usable ÷ 2972 ≈ 987 entries →
power-of-2, ~4:1): **tomb 512 + cand 128** (combined 640 = 1.81 MiB at worst-max = **45% of 4 MiB**,
large headroom to absorb the GC variance). The harness (`-Heap-Browser.html`, now HARNESS_VERSION
`v5`) is set to these caps and emits every raw `samples` record. **Pending: rerun ≥6 fresh contexts
at 512/128 (fresh run ID), retain all six raw records, and confirm the re-measured worst-max still
fits budget + headroom.** Until that rerun is accepted, the browser profile stays disabled and no
browser cap is normative. **None of this affects the relay caps** — those are governed by the Node
runs (worst-max 1011 B = 62% of the 64 MiB relay budget) and are within budget.

---

## Windows fleet host — raw output (2026-08-11, operator: David)

Node v26.5.0, V8 14.6.202.34-node.24, win32/x64 10.0.26200. Launch: `node --expose-gc ref11-sat.mjs`.

```
REF-1.1 S2.0c — Tombstone-saturation sim v3 (full deletion state). gc: true

1. Behavioral coverage
  ok   4 co-located kills suppressed
  ok   N+1 refused -> bounded pending candidate  — PENDING_CAPACITY:REFUSED_GLOBAL_COUNT/ADMITTED
  ok   refusal: no fanout/cache-removal/purge/eviction
  ok   pending-capacity is bounded (cand global cap refuses overflow)  — admit=2 ref=1
  ok   duplicate KILL flood deduped (1 admit, rest DUP)  — ADMITTED/DUP/DUP total=1
  ok   candidate expires at claimRetention
  ok   A is pending after tomb-full refusal
  ok   body-cache overflow demoted A (auto-eviction)  — dem=1
  ok   demoted-A not suppressed on retry (body gone)
  ok   retry after committed effectiveDeath is rejected  — suppressed=1
  ok   direct KILL at effectiveDeath suppresses (boundary)
  ok   direct KILL at effectiveDeath+1 dropped, no tombstone
  ok   late matching body past committed death does not suppress
  ok   suppress() directly rejects already-expired
  ok   tombstone byte-cap refuses 2nd  — SUPPRESSED/PENDING_CAPACITY:REFUSED_GLOBAL_BYTES/ADMITTED
  ok   tombstone oversized-record refused
  ok   tombstone per-signer sublimit binds (2 of 3)  — ok=2
  ok   tombstone per-topic sublimit binds (2 of 3)  — ok=2
  ok   candidate byte-cap refuses when full  — ADMITTED/REFUSED_CAND_BYTES
  ok   candidate oversized-record refused, accounting unchanged  — REFUSED_RECORD_TOO_LARGE
  ok   candidate per-signer competition refuses 3rd, accounting unchanged  — REFUSED_CAND_SIGNER
  ok   candidate per-topic competition refuses 3rd, accounting unchanged  — REFUSED_CAND_TOPIC
  ok   promote/demote preserve count/bytes/sublimit/claimRet  — {"total":1,"bytes":688,"sig":1,"top":1,"cr":1000086435000}

2. Full-state heap measurement (tombstones + candidates), multi-trial
   node=v26.5.0 v8=14.6.202.34-node.24 os=win32/x64 10.0.26200
   full-state @ (tomb 32768 + cand 8192): per-entry mean=1011B sd=0 max=1011  (1011,1011,1011,1011,1011,1011)
   relay proposed (tomb 32768 + cand 8192): confirm total 39.52 MiB worst-case = 62% of 64 MiB

3. Proposed defaults (relay measured on THIS host only; Linux/Windows + real browser required before normative)
   TOMBSTONE_RECORD_MAX=768
   relay:   TOMBSTONE_MAX_COUNT=32768 sublimit=2048  CAND_MAX=8192 sublimit=512
   browser: TOMBSTONE_MAX_COUNT=2048 CAND_MAX=512  (NON-NORMATIVE, DISABLED — pane pins performance.memory; real-browser run required)

RESULT: 23 behavioral checks passed, 0 failed.
```

## Linux relay droplet (sfo3) — raw output (2026-08-11)

Prod relay backbone droplet `143.110.224.247` (sfo3), the deployed relay OS/runtime (bare-metal
checkout, systemd `axona-relay@grizzly{1,2,3}`). Node v22.23.1, V8 12.4.254.21-node.56,
linux/x64 6.8.0-124-generic, 1 vCPU / 961 MB. Harness downloaded to `/tmp`, run with
`oom_score_adj=900` so the harness (not any relay) would be the OOM victim under pressure; the file
was removed afterward. Host memory came back healthy (avail 276→287 MB, swap −15 MB), relays
untouched.

```
2. Full-state heap measurement (tombstones + candidates), multi-trial
   node=v22.23.1 v8=12.4.254.21-node.56 os=linux/x64 6.8.0-124-generic
   full-state @ (tomb 32768 + cand 8192): per-entry mean=1001B sd=1 max=1002  (1001,1000,1000,1000,1001,1002)
   relay proposed (tomb 32768 + cand 8192): confirm total 39.11 MiB worst-case = 61% of 64 MiB

3. Proposed defaults (relay measured on THIS host only; Linux/Windows + real browser required before normative)
   TOMBSTONE_RECORD_MAX=768
   relay:   TOMBSTONE_MAX_COUNT=32768 sublimit=2048  CAND_MAX=8192 sublimit=512
   browser: TOMBSTONE_MAX_COUNT=2048 CAND_MAX=512  (NON-NORMATIVE, DISABLED — pane pins performance.memory; real-browser run required)

RESULT: 23 behavioral checks passed, 0 failed.
```

(All 23 behavioral checks passed identically to the Windows run.)

## Real browser — first pass, SUPERSEDED (2026-08-11, operator: David, Windows/Chrome)

Chrome 151.0.0.0 (Win64 x64), `--enable-precise-memory-info` in an isolated profile,
`…-Heap-Browser.html?run=cary-win-2026-08-11&mode=precise-memory` (harness v4, caps 2048/512), six
fresh contexts. All six valid (none pinned). **This pass was REJECTED under Aster HOLD `c079c3f`:**
its caps overrun the 4 MiB budget, and the displayed `window.__result` omitted the per-context
`samples` array, so only two of the six raw records were captured (5th = 1598 B, 6th below). Final
context as reported:

```json
{
  "harness": "v4", "runId": "cary-win-2026-08-11", "mode": "precise-memory",
  "tombN": 2048, "candN": 512, "combined": 2560,
  "thisContext": { "perEntry": 772, "before": 3145428, "after": 5122373, "usedJSHeapSize": 5149992, "valid": true },
  "validSamplesThisRun": 6, "need": 6, "storeError": null,
  "aggregate": { "mean": 2021, "sd": 790, "max": 2972, "sizeBy": "worst-case max" }
}
```

## Real browser — corrected rerun, raw output (2026-08-11, operator: David, Windows/Chrome)

Chrome 151.0.0.0 (Win64 x64), `--enable-precise-memory-info` in a fresh isolated profile, harness
**v5** at caps **tomb 512 + cand 128** (combined 640), `run=cary-win-2026-08-11-b`,
`mode=precise-memory`, six fresh contexts, all valid (none pinned). **All six raw records retained**
(Aster HOLD item 1 satisfied):

| # | perEntry (B) | before | after | usedJSHeapSize |
|---|---|---|---|---|
| 1 | 2918 | 621040 | 2488647 | 2588670 |
| 2 | 2840 | 621040 | 2438523 | 2539324 |
| 3 | 2687 | 2816263 | 4536259 | 4554691 |
| 4 | 2683 | 4831702 | 6549002 | 6567450 |
| 5 | 2354 | 6844881 | 8351553 | 8370033 |
| 6 | 2580 | 8648004 | 10299128 | 10317640 |

Aggregate: **mean 2677, sd 182, max 2918 B/entry** (`sizeBy: worst-case max`). Variance is far
tighter than the first pass (sd 182 = 6.8% of mean, vs 39%); the worst observed maximum still
governs sizing.

**Budget check at the final caps (worst-max 2918 B × 640):**

| Case | bytes | MiB | % of 4 MiB |
|---|---|---|---|
| worst-max | 2918 × 640 = 1,867,520 | **1.78 MiB** | **44.5%** |
| mean | 2677 × 640 = 1,713,280 | 1.63 MiB | 40.8% |

**PASS:** 44.5% is well under the 70% ceiling, so the full 30% integration headroom is preserved
(~55% budget remaining at the worst case). The corrected browser caps **tomb 512 + cand 128** fit
the 4 MiB budget with margin under the measured worst-case per-entry cost.

Standing caveat (unchanged): `performance.memory` under `--enable-precise-memory-info` is still
GC-timing-sensitive, so this worst-max is conservative. A tighter cross-origin-isolated
`measureUserAgentSpecificMemory()` figure remains the path before proposing any *less*-conservative
(larger) browser caps; 512/128 is the conservative interim. **The browser profile stays DISABLED and
NON-NORMATIVE regardless** — this rerun establishes only that the sizing fits its budget.

**Campaign evidence is now complete and awaiting Aster's review** (all three classes: Windows Node,
Linux Node, corrected real-browser rerun with full raw retention). Gate A stays OPEN until Aster
accepts this corrected evidence; kernel code / canary / deploy / S2.1 / chunking remain gated. The
relay caps (tomb 32768 + cand 8192, Node worst-max 1011 B = 62% of 64 MiB) are unaffected.
