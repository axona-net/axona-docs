# REF-1.1 S2.0c — Tombstone-saturation results v2 (AUTH-B Gate A)

- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Artifacts:** `REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs` (Node, `node --expose-gc`),
  `REF-1.1-S2.0c-Tombstone-Heap-Browser.html` (real-browser probe)
- **Gate:** Aster Gate A recut (msgId e4b908b9, CHANGES REQUIRED). Design only; S2.0c held.

Recut of the Gate A artifact after Aster's two findings: the first sim modelled only the
tombstone store (faking retry and body-eviction), and sized limits with ~5% headroom off a
single Node reading. Both are addressed.

## 1. Integrated behavioral coverage — 15/15

The sim now runs a full node model — `BodyCache` + `CandidateStore` + `TombstoneStore` +
pending-capacity queue + oldest-body-first scheduler + an atomic `SUPPRESS` — and passes:

- 4 co-located kills suppressed; **N+1 refused on count → retained pending**; refusal **removed no
  body** and caused **no fanout / cache-removal / candidate-purge / live-tombstone eviction**
  (side-effect counters asserted unchanged);
- **real reclamation → retry**: a short-lived tombstone expires, a genuinely pending candidate
  (body still present) is admitted on the next `reclaimAndRetry`;
- **real body eviction → demotion**: a pending candidate whose body is evicted is not admitted on
  reclaim and reverts to a body-absent candidate;
- **byte-cap refusal** (`REFUSED_GLOBAL_BYTES`) and **oversized-record refusal**
  (`REFUSED_RECORD_TOO_LARGE`);
- candidate global + per-signer caps; tombstone per-signer and per-topic sublimits under
  competition.

## 2. Measurement — repeated, environment-recorded, honest

Each trial is a **fresh Node process** (`--measure-once`) so a prior fill's heap high-water mark
cannot make a later fill read ~0 B/entry (the flaw in the first version's single-process loop).

- Environment: `node v24.14.1, V8 13.6.233.17-node.44, darwin/arm64 25.5.0`. Trials: 6.
- **Relay @ 65536 — measured in the actual supported relay runtime (Node):** per-entry
  mean **979 B**, sd **1 B**, max **980 B** (978/979/979/980/979/980). Tight variance.
- **Browser @ 4096 — Node V8 proxy:** mean **1005 B**, sd **1 B**, max **1006 B**.

**Real-browser probe — could not measure here (reported, not faked).** The companion HTML reads
`performance.memory.usedJSHeapSize`, but the in-app Electron/Chromium pane **pins** that value to a
constant `10,000,000` for anti-fingerprinting — a 300k-entry fill still shows a **0-byte delta**. A
precise browser number needs a browser launched with `--enable-precise-memory-info`, or
`measureUserAgentSpecificMemory()` under cross-origin isolation; neither is available in this
environment. The browser profile below therefore rests on the **same-engine (V8) Node proxy** and
is **explicitly non-normative** until a real-browser run confirms it — the HTML is the tool to do
that on a proper browser build.

## 3. Conservative sizing — worst-case + 30% integration headroom

Sized from the **worst-case** per-entry (not the mean), reserving **30%** of the budget for the
eventual kernel representation, allocator variance, and surrounding store metadata (the previous
~5% was too thin):

| Parameter | measured basis | **v10 default** | budget use |
|---|---|---|---|
| `TOMBSTONE_RECORD_MAX` | 725 B canonical max | **768 B** | — |
| relay `TOMBSTONE_MAX_COUNT` | 980 B/entry worst-case (Node, supported runtime) | **32768** | 30.6 MiB = **48%** of 64 MiB |
| relay per-signer / per-topic | count / 16 | **2048** | — |
| relay `TOMBSTONE_MAX_BYTES` | count × record cap | **24 MiB** | — |
| browser `TOMBSTONE_MAX_COUNT` | 1006 B/entry (V8 proxy — **confirm in real browser**) | **2048** | ~2.0 MiB = **49%** of 4 MiB |
| browser per-signer / per-topic | count / 16 | **128** | — |
| browser `TOMBSTONE_MAX_BYTES` | count × record cap | **1.5 MiB** | — |

The relay figure is measured in its real runtime and is proposed as normative. The browser figure
is a conservative proxy pending a real-browser confirmation (and, per Aster, a re-run if the
eventual kernel representation differs from this standalone object/Map layout).

## Disposition

Gate A recut delivered: integrated behavioral coverage + repeated, environment-recorded,
conservatively-headroomed measurement, with the real-browser limitation reported honestly rather
than papered over. `AUTH-B v10` carries the conservative defaults (browser marked non-normative
pending a real-browser run). Gate B (implementation test plan) next. No kernel code, canary,
deploy, S2.1 wiring, or chunking until Aster reviews this and the Gate B plan.
