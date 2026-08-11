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
| Linux droplet | _pending_ | | | | |

Worst observed maximum so far: **1011 B/entry** (Windows). Budget check: 39.52 MiB with the 30%
integration headroom preserved. Per-entry cost is stable across two V8 majors (13.6 → 14.6:
1000 → 1011 B, +1.1%), and deterministic within each host (sd 0 across six fresh processes).

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

## Linux droplet — pending

To run (same harness, prod relay OS/runtime):

```
curl -fsSL -o ref11-sat.mjs https://raw.githubusercontent.com/axona-net/axona-docs/main/architecture/REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs
node --expose-gc ref11-sat.mjs
```

## Real browser — pending (separate, browser profile)

`REF-1.1-S2.0c-Tombstone-Heap-Browser.html?run=<campaign-id>&mode=<flag-profile>`, six fresh
contexts, precise-memory (`--enable-precise-memory-info`) or cross-origin-isolated
`measureUserAgentSpecificMemory()`; reject pinned samples.
