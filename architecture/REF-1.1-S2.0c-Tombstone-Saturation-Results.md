# REF-1.1 S2.0c — Tombstone-saturation results (AUTH-B Gate A)

- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Artifact:** `REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs` (run: `node --expose-gc …`)
- **Gate:** Aster pre-code Gate A (disposition msgId bbdf622e). Design only; S2.0c held.

## What was asked

Before any kernel code, prove the AUTH-B v8 capacity model under simultaneous count / byte /
signer / topic limits, pending-capacity candidate pressure, reclamation + retry, and
body-eviction-before-retry — measuring **both** canonical retained bytes **and** actual runtime
heap, and adjusting the defaults if measurement disagrees. It did.

## Behavioral result — 11/11

The standalone v8 tombstone store (admission-refusal at capacity, never live-eviction; per-signer
and per-topic sublimits; reclaim only expired) passes every required scenario:

- fills to N live tombstones; **N+1 genuine kill refused** (global count) with **no live eviction**;
- one signer fills its per-signer sublimit, its next kill refused, a **different signer still admits**;
- one topic fills its per-topic sublimit, its next kill refused;
- at capacity a matching kill is **refused (pending-capacity)**, then **slot reclamation lets the
  retry succeed**;
- a **body evicted before retry** is not admitted on reclamation (lost co-location basis).

## Measurement — the defaults were wrong, and are corrected

Deterministic per-record structure (topicId 66-hex, msgId 64-hex, signerPubkey 64-hex,
effectiveDeath, retained signed kill):

| Quantity | Assumed (v8) | **Measured** |
|---|---|---|
| canonical bytes / record | ≤ 512 (`TOMBSTONE_RECORD_MAX`) | **726 B** (max 725) |
| runtime heap / entry (relay) | — | **974 B** |
| runtime heap / entry (browser) | — | **985 B** |
| relay heap at assumed 131072 | ≤ 64 MiB | **121.8 MiB — EXCEEDS ~1.9×** |
| browser heap at assumed 8192 | ≤ 4 MiB | **7.69 MiB — EXCEEDS ~1.9×** |

Runtime heap per entry (~974 B) is materially larger than canonical bytes (~726 B) — JS string
(2 B/char + header), object, and Map-entry overhead. `TOMBSTONE_RECORD_MAX` is an accounting
proxy; the **runtime-heap-per-entry × count** is what actually spends the memory budget, and it
is the binding constraint.

## Corrected normative defaults (measurement-driven)

Sized so the full live set fits the stated **runtime** budget with margin (heap ≈ 974 B/entry):

| Parameter | v8 assumed | **v9 (measured)** | Fit |
|---|---|---|---|
| `TOMBSTONE_RECORD_MAX` | 512 B | **768 B** | measured max 725 B + margin |
| relay `TOMBSTONE_MAX_COUNT` | 131072 | **65536** | 65536 × 974 B ≈ 60.9 MiB < 64 MiB |
| relay per-signer / per-topic | 8192 | **4096** | count / 16 |
| browser `TOMBSTONE_MAX_COUNT` | 8192 | **4096** | 4096 × 985 B ≈ 3.85 MiB < 4 MiB |
| browser per-signer / per-topic | 512 | **256** | count / 16 |

(The measurement-safe ceilings were 68889 relay / 4259 browser; rounded down to the nearest power
of two for a clean margin against GC and allocator variance.) The byte cap stays as a cheap
in-process guard, but the **count** cap is what enforces the memory budget and should be treated
as primary. `TOMBSTONE_MAX_BYTES` follows as `MAX_COUNT × TOMBSTONE_RECORD_MAX`
(relay 48 MiB, browser 3 MiB) so the two caps bind at roughly the same point.

## Disposition

Gate A is satisfied by this artifact, subject to Aster's review of the numbers. `AUTH-B v9`
folds the corrected defaults into the design (measurement-driven values only; no logic change from
the accepted v8 model). Next pre-code deliverable: the implementation test plan (Gate B). No
kernel code, canary, deploy, S2.1 wiring, or chunking until both are reviewed.
