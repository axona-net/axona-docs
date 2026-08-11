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

Status: **NON-NORMATIVE until Aster reviews the full campaign** (Windows + Linux Node + a real
browser). The browser profile stays disabled; no relay cap is normative until then.

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

### Real browser (separate, NON-NORMATIVE / DISABLED profile — combined caps tomb 2048 + cand 512)

| Browser | UA | per-entry (6 valid contexts) | combined-state @ 2560 | vs 4 MiB browser budget |
|---|---|---|---|---|
| Chrome 151 (Windows, `--enable-precise-memory-info`) | Win64 x64 | mean **2021 B**, sd **790**, max **2972 B**, range 772–2972 | worst 7.26 MiB / mean 5.17 MiB | worst **181%** / mean **129%** |

**The browser number is high-variance and does NOT gate the relay.** A plain browser tab cannot force
GC (no `--expose-gc` equivalent), so each fresh-context before/after delta captures a different
amount of uncollected garbage — hence sd 790 (~39% of mean) and the 772–2972 range. All six samples
are valid precise-memory readings (none pinned). Consequences: (1) the browser per-entry runs
~2–3× the Node per-entry, confirming the Node figure was never a safe browser proxy — exactly why
this real run was required; (2) at the measured cost the current NON-NORMATIVE browser caps
(2048/512) **overrun the 4 MiB browser budget** (181% worst / 129% mean), so the browser profile
**stays disabled** and its caps must be sized down before it is ever enabled. Before that sizing is
treated as final, a **GC-settled** browser figure via `measureUserAgentSpecificMemory()` under
cross-origin isolation is worth taking — it returns a settled per-isolate breakdown rather than a
timing-contaminated `performance.memory` delta, and would replace the noisy worst-max with a tight
one. Relay sizing does not wait on that; only the (disabled) browser profile does.

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

## Real browser — raw output (2026-08-11, operator: David, Windows/Chrome)

Chrome 151.0.0.0 (Win64 x64), launched with `--enable-precise-memory-info` in an isolated profile,
`REF-1.1-S2.0c-Tombstone-Heap-Browser.html?run=cary-win-2026-08-11&mode=precise-memory`, six fresh
page-load contexts. All six samples valid (real precise-memory readings, none pinned). Final
aggregate context (`window.__result`):

```json
{
  "engine": "chromium",
  "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/151.0.0.0 Safari/537.36",
  "harness": "v4", "runId": "cary-win-2026-08-11", "mode": "precise-memory",
  "tombN": 2048, "candN": 512, "combined": 2560,
  "thisContext": { "perEntry": 772, "before": 3145428, "after": 5122373, "usedJSHeapSize": 5149992, "valid": true },
  "validSamplesThisRun": 6, "need": 6, "storeError": null,
  "aggregate": { "mean": 2021, "sd": 790, "max": 2972, "sizeBy": "worst-case max" },
  "status": "ok — 6 valid fresh-context samples under this run ID; worst-case max governs sizing",
  "completed": true
}
```

Per-context per-entry samples spanned 772–2972 B (two individually recorded here: the 5th context
1598 B, the 6th 772 B); aggregate mean 2021, sd 790, max 2972. See the browser-measurement caveat
above — the variance is GC-timing, not per-entry cost, and a `measureUserAgentSpecificMemory()` /
COI run is the way to a tight number before the browser profile is sized. **Campaign status: all
three required measurement classes (Windows Node, Linux Node, real browser) are now measured and
retained; relay caps are within budget on the Node worst-max; the browser profile remains disabled.**
