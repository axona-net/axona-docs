# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v9

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-09`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Supersedes:** `...-Design-v8.md` (6d40d62), **DESIGN ACCEPTED WITH PRE-CODE GATES**
  (`ASTER-COUNCIL-REF11-S20C-V8-REVIEW`, msgId bbdf622e). v9 changes **only the capacity default
  numbers**, replacing v8's *assumed* values with the **measured** values from Gate A
  (`REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs` + `-Results.md`). No logic, state-machine, or
  security change from the accepted v8 model. Signed-expiry v6 accepted. S2.0c/chunking held.

The whole v8 mechanism — atomic `SUPPRESS`, admission-refusal at capacity (never live-eviction),
local non-transferable authority, per-signer/per-topic sublimits, reclamation retry, case-correct
body-absent / body-present / local-tombstone vectors — stands unchanged. v9 corrects the numbers
Aster's Gate A required be measured, not assumed.

## Measured capacity defaults (replaces v8 blocker-2 table)

Measured per-entry: **726 B canonical**, **~974 B runtime heap** (relay) / **~985 B** (browser).
Runtime heap, not canonical bytes, is the binding memory constraint. v8's assumed 131072 relay
entries measured at **121.8 MiB** — nearly 2× the 64 MiB budget — so the defaults are corrected
down to fit the stated runtime budget with margin:

| Parameter | v8 assumed | **v9 measured** | Basis |
|---|---|---|---|
| `TOMBSTONE_RECORD_MAX` | 512 B | **768 B** | measured max 725 B + margin |
| relay `TOMBSTONE_MAX_COUNT` | 131072 | **65536** | 65536 × 974 B ≈ 60.9 MiB < 64 MiB |
| relay per-signer / per-topic | 8192 | **4096** | count / 16 |
| relay `TOMBSTONE_MAX_BYTES` | 64 MiB | **48 MiB** | `MAX_COUNT × TOMBSTONE_RECORD_MAX` |
| browser `TOMBSTONE_MAX_COUNT` | 8192 | **4096** | 4096 × 985 B ≈ 3.85 MiB < 4 MiB |
| browser per-signer / per-topic | 512 | **256** | count / 16 |
| browser `TOMBSTONE_MAX_BYTES` | 4 MiB | **3 MiB** | `MAX_COUNT × TOMBSTONE_RECORD_MAX` |

**The count cap is primary** (it enforces the runtime-memory budget, since per-entry heap ≫
canonical bytes); the byte cap is a cheap in-process guard that binds at roughly the same point.
The measurement-safe ceilings were 68889 relay / 4259 browser; rounded down to powers of two for
margin against GC/allocator variance.

## Status

Design v9 — measured defaults folded in; v8 model otherwise unchanged and accepted. Gate A
artifact delivered (`-Sim.mjs` + `-Results.md`). Remaining pre-code gate: **B**, the
implementation test plan. No kernel code, canary, deploy, S2.1 wiring, or chunking until Gate A's
numbers and the Gate B test plan are reviewed. Membership remains an unbuilt, not-retired
alternative.
