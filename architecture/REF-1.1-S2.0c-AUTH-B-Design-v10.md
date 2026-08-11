# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v10

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-10`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Supersedes:** `...-Design-v9.md`. v9's capacity defaults were from a unit-level sim with ~5%
  headroom; Aster's Gate A recut (msgId e4b908b9) required an integrated model, repeated
  environment-recorded measurement, and conservative headroom. v10 carries the **conservative,
  worst-case-sized** defaults from the recut (`-Sim.mjs` + `-Results.md v2`). No logic,
  state-machine, or security change from the design **accepted at v8**. Signed-expiry v6 accepted.
  S2.0c/chunking held.

The v8 mechanism stands unchanged. v10 only sets the capacity numbers, now sized from the
worst-case measured per-entry heap with 30% integration headroom (was ~5%), and marks the browser
figure non-normative pending a real-browser measurement.

## Capacity defaults (measurement-driven, conservative)

Measured (6 fresh-process trials; `node v24.14.1 / V8 13.6.233 / darwin-arm64`): relay **980 B/entry
worst-case** in the actual relay runtime; browser **1006 B/entry** as a same-engine V8 Node proxy
(the in-app Chromium pins `performance.memory`, so a real-browser number is deferred). Sized so the
worst case fills ≤ 70% of the budget:

| Parameter | v8/v9 | **v10 (conservative measured)** | budget use |
|---|---|---|---|
| `TOMBSTONE_RECORD_MAX` | 512 / 768 | **768 B** | — |
| relay `TOMBSTONE_MAX_COUNT` | 131072 / 65536 | **32768** | 30.6 MiB = 48% of 64 MiB |
| relay per-signer / per-topic | — / 4096 | **2048** | count / 16 |
| relay `TOMBSTONE_MAX_BYTES` | — / 48 MiB | **24 MiB** | count × record cap |
| browser `TOMBSTONE_MAX_COUNT` | 8192 / 4096 | **2048** (non-normative — confirm in real browser) | ~2.0 MiB = 49% of 4 MiB |
| browser per-signer / per-topic | — / 256 | **128** | count / 16 |
| browser `TOMBSTONE_MAX_BYTES` | — / 3 MiB | **1.5 MiB** | count × record cap |

The count cap enforces the runtime-memory budget (per-entry heap ≫ canonical bytes); the byte cap
is a cheap secondary guard. **Re-run the benchmark before enabling** if the eventual kernel
representation differs from the standalone object/Map layout, and confirm the browser figure on a
real browser build (Aster Gate A condition).

## Status

Design v10 — conservative measured defaults; v8 model unchanged and accepted. Gate A recut
delivered (`-Sim.mjs` integrated + `-Results.md v2` + `-Heap-Browser.html`). Remaining pre-code
gate: **B**, the implementation test plan. No kernel code, canary, deploy, S2.1 wiring, or chunking
until Aster reviews the recut and the Gate B plan. Membership remains unbuilt, not retired.
