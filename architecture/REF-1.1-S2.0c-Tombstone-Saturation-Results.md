# REF-1.1 S2.0c — Tombstone-saturation results v5 (AUTH-B Gate A)

**v5 delta (Aster review msgId d9512e07):** added the missing candidate regression cases —
oversized-record, per-signer competition, per-topic competition — each asserting state and
accounting are **unchanged on refusal** (behavioral now **23/23**). Rebuilt the browser harness to
be **representation-equivalent** to the Node stores (every retained record carries `_bytes`; each
store carries its total bytes/count; the tombstone store carries `minDeath`; both carry
perSigner/perTopic maps) and to measure **one fill per fresh context**, aggregating ≥6 contexts
across page loads (localStorage) with the worst-case max governing sizing. Numbers unchanged.

---



**v4 delta (Aster recut review msgId ce683d98):** fixed a real fail-open — the committed-expiry
guard now lives **inside `SUPPRESS`** (fail-closed before any side effect), not only in the retry
path, so an already-expired authorization can never install a tombstone on the direct-KILL,
late-body, or retry paths (boundary-tested at `effectiveDeath` and `+1`). Restored v2's dropped
byte-cap / oversized-record / per-signer / per-topic regression checks for both stores and added a
promote↔demote accounting-invariant test. Rebuilt the browser harness to instantiate the
**combined** tombstone+candidate state at the 2048/512 caps (it was tombstone-only). Behavioral:
**20/20**. Numbers unchanged (full-state 1000 B/entry, relay 39.06 MiB = 61%). Everything below
stands with those additions.

---



- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Artifacts:** `REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs` (Node), `-Heap-Browser.html`
- **Gate:** Aster Gate A recut review (msgId b8c2d20f, CHANGES REQUIRED). Design only; S2.0c held.

Third pass, resolving Aster's four findings on the recut. Aster independently reproduced the 15
prior checks and the fresh-process benchmark; this pass fixes the modeling gaps she identified.

## Four findings, fixed

1. **Pending-capacity state is now bounded, deduplicated, and expiring.** It no longer lives in a
   separate unbounded array; a body-verified-pending-capacity kill is a **tagged candidate** inside
   the `CandidateStore`, which enforces global + per-signer + per-topic + byte + record limits,
   deduplicates repeated matching kills by `(topicId, msgId, signer)`, and expires entries at
   **ClaimRetention** (`receipt + FUTURE_TOLERANCE_MS + TTL_CEILING + CLOCK_SKEW`). Tests: pending
   overflow refused on the candidate cap; a duplicate-kill flood collapses to one entry; a
   candidate expires at ClaimRetention.
2. **Real body-cache overflow drives demotion.** `BodyCache.put` reports the auto-evicted key and
   the node demotes that key's pending candidate to plain (loses its authorization basis). Tested
   by **overflowing the actual body cache** (not the explicit helper): the overflowed pending
   candidate demotes and is not suppressed on the next retry.
3. **Expiry is faithful to signed-expiry.** A body carries its **committed** `effectiveDeath`
   (never recomputed from local `now + TTL`); `SUPPRESS` and every `reclaimAndRetry` re-check
   `now ≤ body.effectiveDeath`. Test: a pending candidate whose committed death has passed is
   **rejected** on retry even though a slot freed — arrival/retry cannot extend authorization.
4. **The heap benchmark measures the complete deletion state** (`TombstoneStore` **+**
   `CandidateStore`) at the proposed final counts, so the caps are sized so their **sum** fits the
   budget — not the tombstone store alone.

Behavioral: **10/10** (co-located suppress; N+1 refusal→bounded pending with no side effects;
pending bounded; dedup flood; candidate expiry; body-cache-overflow demotion; committed-death
retry rejection).

## Full-state measurement (fresh process per trial)

- Environment: `node v24.14.1, V8 13.6.233, darwin/arm64 25.5.0`. Trials: 6.
- **Complete deletion state @ (tomb 32768 + cand 8192): 999 B/entry, sd 0, max 1000 B.**
- Confirm at the proposed relay split: **39.0 MiB worst-case = 61% of the 64 MiB budget** (30%
  integration headroom preserved).

## Proposed defaults — split across the deletion state

The budget is split across the two bounded stores (deletions outnumber pending claims → ~4:1):

| Parameter | **v11 default** | note |
|---|---|---|
| `TOMBSTONE_RECORD_MAX` / `CAND_RECORD_MAX` | **768 B** | measured max 725 B + margin |
| relay `TOMBSTONE_MAX_COUNT` | **32768** (sublimit 2048) | |
| relay `CAND_MAX` (incl. pending) | **8192** (sublimit 512) | |
| relay full-state worst case | **39.0 MiB = 61% of 64 MiB** | measured, this host |
| browser `TOMBSTONE_MAX_COUNT` / `CAND_MAX` | **2048 / 512** | **NON-NORMATIVE, DISABLED** |

## Honest limits (required before these are normative)

- **OS/runtime:** measured only on `darwin/arm64` Node. Production relays also run on **Linux**
  (droplets) and **Windows** (fleet); the full-state benchmark must be re-run on those before the
  relay defaults are treated as normative. The harness is portable — same `node --expose-gc` run.
- **Browser:** the in-app Chromium **pins** `performance.memory`, so no real-browser number is
  obtainable here. The browser profile is a same-engine V8 **proxy**, kept **non-normative and
  disabled** pending a real-browser run (per Aster's ruling). `-Heap-Browser.html` is the tool.
- **Kernel representation:** if the eventual kernel layout differs from this standalone
  object/Map, re-run before enabling.

## Disposition

Gate A recut v3: full deletion-state model + complete-state measurement, with the OS/browser
confirmations named as explicit pre-enable steps rather than assumed. `AUTH-B v11` carries the
split caps. Gate B (implementation test plan) next. No kernel code, canary, deploy, S2.1 wiring, or
chunking until Aster accepts this recut and the Gate B plan.
