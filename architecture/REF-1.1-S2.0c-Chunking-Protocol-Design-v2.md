# REF-1.1 S2.0c — full-state chunking protocol design, v2

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-CHUNKDESIGN-20260810-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy. S2.0c held, S2.1 blocked.
- **Supersedes:** `REF-1.1-S2.0c-Chunking-Protocol-Design.md` (15cd843), which Aster
  reviewed **CHANGES REQUIRED** (`ASTER-COUNCIL-REF11-S20C-CHUNKDESIGN-REVIEW-20260810-05`).
  This v2 resolves findings 1–7. Two of them (F3, F4) were correctness holes in v1;
  they are called out as such below.

## The one enforced invariant

Every produced frame satisfies, measured after encode:

    UTF8_BYTES(encode(complete routed frame)) ≤ MAX_FRAME_TRANSFER_BYTES = 15 KiB

This is the postcondition the tranche gates on. It is the *whole* frame — routing
wrapper, chunk metadata, and payload together — so nothing is subtracted twice
(F1). When the sender budgets an inner payload *before* encoding, it uses

    CHUNK_PAYLOAD_BUDGET = MAX_FRAME_TRANSFER_BYTES − WORST_CASE_WRAPPER − CHUNK_META_MAX

as a proven upper bound, and then still asserts the whole-frame postcondition
after encode; a frame that fails is re-split, never sent.

`MAX_FRAME_BYTES` (1 MiB) stays the separate defensive parser-allocation ceiling.
It is not a transfer guarantee and is never wired until every producer conforms.

### The single-message payload limit shrinks (F1)

`MAX_RELIABLE_PUBLISH_BYTES` today caps the `peer.pub` **envelope**, before the
routing wrapper is added — so a legal ~15 KiB envelope becomes a routed frame
*over* 15 KiB, and v1's "PUB conforms by default" was wrong. v2 redefines the
reliable publish limit as an **inner-envelope** bound proven to keep the encoded
*routed* frame ≤ 15 KiB:

    MAX_RELIABLE_PUBLISH_BYTES := MAX_FRAME_TRANSFER_BYTES − WORST_CASE_ROUTE_WRAPPER

Live DELIVER and PULLRESP carry that same envelope, so they conform once the
envelope limit shrinks. A single message is atomic — it cannot be split by
`msgId` — so a message exceeding this limit is rejected at `peer.pub`, not sent.

## Two commitments, not one hash (F2)

v1's `batchId = hash(topicId ‖ policy ‖ msgIds ‖ delIds)` did not commit to the
transfer the bitset claims complete: it omitted tombstone contents, item metadata,
version, count, and chunk boundaries, so one `batchId` could name different chunk
plans that interleave into a false "complete." v2 commits to the whole logical
transfer *and* its chunk manifest.

The sender builds a **manifest** before emitting:

- `version`, `policy`, `count`, `topicId`, `senderId`;
- `tombstoneCount` (indices `0 … tombstoneCount-1` are the tombstone phase);
- per **item** a digest: `H("axona/chunk/item" ‖ msgId ‖ H(body))` for a message,
  `H("axona/chunk/del" ‖ delId ‖ H(delRecord))` for a tombstone;
- per **chunk index** a digest: `H("axona/chunk/frame" ‖ index ‖ H(chunk bytes))`.

    manifestRoot = H("axona/chunk/manifest" ‖ version ‖ policy ‖ count ‖
                     tombstoneCount ‖ ordered itemDigests ‖ ordered chunkDigests)
    batchId      = H("axona/chunk/batch" ‖ senderId ‖ topicId ‖ policy ‖
                     version ‖ manifestRoot)

Every hash is domain-separated so a `batchId` can never collide with a `msgId` or
another commitment. The manifest travels in the header (index 0); the receiver
learns every per-index chunk digest before it can complete. Rules:

- Assembly is keyed by **authenticated** `senderId + topicId + policy + batchId`; a
  chunk from another authenticated sender cannot contribute.
- `count` is bounded by `MAX_CHUNKS_PER_BATCH` and validated **before** any bitset
  or buffer is allocated (a forged/oversized `count` is rejected, not allocated).
- Immutable fields (`version, policy, count, batchId, manifestRoot, tombstoneCount`)
  are identical on every chunk; a chunk disagreeing is rejected.
- Each chunk's bytes are hashed and matched to the manifest's per-index digest; a
  mismatch or a **conflicting duplicate index** (same index, different digest) is
  rejected.
- Completion requires all indices present *and* `manifestRoot` verified against
  `batchId` — the commitment, not the arrival count.

## Receiver phases and the tombstone gate (F3 — v1 correctness hole)

v1 applied every chunk immediately. A body chunk arriving before its tombstone was
cached, fanned out, and **app-delivered**; a later tombstone removed it but could
not un-deliver it. A durable map after arrival does not save an already-delivered
body. v2 gates delivery on an explicit phase order:

1. **Tombstone phase.** Tombstone-phase chunks (`0 … tombstoneCount-1`) are applied
   to the durable tombstone map as they verify. Body-phase chunks that arrive early
   are **held** in the bounded assembly buffer — never applied, never fanned out,
   never delivered.
2. **Tombstone phase complete + verified.** Only when every tombstone-phase index
   is present and its digest matches does the receiver release the body phase.
3. **Body phase.** Held and subsequently-arriving bodies are ingested; each consults
   the now-complete tombstone map, so a tombstoned body is never delivered.

Body delivery therefore never precedes the tombstone that would suppress it, under
any loss or reorder, without unbounded buffering — held bodies are bounded by the
assembly-bytes cap, and a batch that would exceed it FAILS (drops) rather than
delivering early.

## Recovery (F4 — v1 correctness hole)

v1 claimed all three policies recover on the anti-entropy tick. REPLAYUP does not:
it is emitted only in reply to PULLUP, the timer re-sends REPLICATE, and applying a
partial REPLAYUP could advance the receiver high-water to the batch maximum and
**quench** the next high-water-triggered PULLUP (and SPLIT_UNION's pull ledger is
one-shot). v2 makes recovery explicit and per-policy, and forbids the quench:

- **High-water advances only on batch COMPLETION**, never on partial ingest. A
  partial batch leaves high-water where it was, so the normal PULLUP is not
  suppressed.
- **REPLICATE / HANDOFF:** the standing anti-entropy re-send (`ROOT_REPLICATE_FULL_MS`)
  and the HANDOFF retry loop resend the whole batch; content-addressed `batchId` +
  `msgId` union make it idempotent.
- **REPLAYUP:** the receiver drives recovery with a bounded **PULLUP carrying the
  batch identity** (or a missing-index NACK), issued on an incomplete-batch timer,
  with a bounded retry count and a terminal give-up that drops the assembly. This
  recovery pull is exempt from the SPLIT_UNION one-shot ledger — it is a distinct,
  batch-scoped request, not a high-water pull.

Trigger and termination are real and named; nothing is attributed to an unrelated
timer.

## Completion means accepted, not arrived (F5)

`_syncIngest` can reject a malformed, unverifiable, or bad-clock entry. v2 tracks a
per-item **acceptance** status, not mere arrival:

- **HELD** — ingest accepted the message;
- **SUPPRESSED** — the item is a body validly tombstoned by an already-accepted
  tombstone;
- **REJECTED** — malformed / unverifiable / bad clock.

A batch **completes** only when every manifest item is HELD or SUPPRESSED, with
**zero** REJECTED items and the `manifestRoot` verified. Aggregate `sent/held/
rejected/suppressed` accounting is bound to the completion signal. `HANDOFFACK`
carries `{ batchId, complete:true }` only on that accepted-state equality — a short
transfer can never ack, so the last-copy-loss class (#402) cannot recur.

**Mixed fleet:** the chunked frame carries a `version`. A heir that emits only the
legacy `{ held, sent }` ack, with no batch-completion evidence, does **not** clear a
chunked handoff; the leaver treats it as incomplete and keeps retrying / cohort-
spraying. A pre-version heir is handed the whole transfer under the reduced
single-frame cap, never a chunked one.

## Sender state machine (F6)

| State | Event | Next | Action |
|-------|-------|------|--------|
| IDLE | snapshot due (REPLICATE/HANDOFF/REPLAYUP) | SNAPSHOT | freeze cache view, build manifest + batchId |
| SNAPSHOT | manifest built | EMITTING | enqueue chunks on the fair scheduler |
| EMITTING | scheduler slot | EMITTING | emit next chunk (round-robin across topics AND peers); tombstone chunks first |
| EMITTING | all chunks emitted | AWAIT_ACK | arm ack/complete timer |
| AWAIT_ACK | completion evidence (HANDOFF) / anti-entropy quiet (REPLICATE) | COMPLETE | update replica/durability ledger |
| AWAIT_ACK | timeout, tries left | EMITTING | resend missing/whole batch (same batchId) |
| AWAIT_ACK | tries exhausted | FALLBACK | HANDOFF → cohort spray; REPLICATE → next tick |
| any | role change / topic reassigned | CANCEL | drop batch, release state |
| any | newer snapshot for same (peer,topic) | SUPERSEDE | cancel old batchId, start new |

Fair scheduling replaces `REPLICATE_FULL_BUDGET`'s monolithic push budget with a
**chunk** budget: at most `CHUNKS_PER_TICK` chunks leave per tick, round-robin
across topics and peers, so a large batch spans ticks and no topic starves.

## Receiver state machine (F6)

Keyed by `(authSenderId, topicId, policy, batchId)`:

| State | Event | Next | Action |
|-------|-------|------|--------|
| — | first chunk, count ≤ MAX_CHUNKS_PER_BATCH, buffers available | ASM_TOMB | allocate bounded assembly; record manifest |
| — | count over cap / no buffer / manifest invalid | (reject) | drop chunk, no allocation |
| ASM_TOMB | tombstone chunk verifies | ASM_TOMB | apply to durable tombstone map |
| ASM_TOMB | body chunk verifies | ASM_TOMB | HOLD (bounded); do NOT apply/deliver |
| ASM_TOMB | all tombstone indices held+verified | ASM_BODY | release held bodies for ingest |
| ASM_BODY | body chunk verifies | ASM_BODY | ingest (HELD/SUPPRESSED/REJECTED) |
| ASM_BODY | all items HELD/SUPPRESSED, 0 REJECTED, root verifies | COMPLETE | advance high-water; fire completion signal / HANDOFFACK |
| any | conflicting duplicate index / digest mismatch | (reject) | reject chunk; batch may FAIL |
| any | assembly bytes/count bound exceeded | FAILED | drop batch (never deliver) |
| any | TTL elapsed incomplete | EXPIRED | drop; REPLAYUP → arm recovery PULLUP |
| COMPLETE | re-sent chunk of same batchId | COMPLETE | re-emit ack (rate-limited by ACK_REEMIT_MIN_MS) |

## Bounds (F6)

`MAX_CHUNKS_PER_BATCH`, `MAX_INFLIGHT_BATCHES_PER_PEER`, `MAX_GLOBAL_ASSEMBLY_BATCHES`,
`MAX_ASSEMBLY_BYTES` (global and per-peer), `ASSEMBLY_TTL_MS`, `ACK_REEMIT_MIN_MS`,
`REPLAYUP_RECOVERY_TRIES`. Count is validated before allocation; an authenticated
peer cannot pin more than its share of assembly memory.

## Every oversized producer is enforced, not documented (F7)

Before the pre-parse ceiling is wired, each producer is bounded at emission:

- **PUB:** the reduced `MAX_RELIABLE_PUBLISH_BYTES` is enforced for any message that
  may route. The 256 KiB override is legal only on an **enforced single-hop seam**
  (a direct, non-routed embedded path), checked at emission — not a comment.
- **direct / notify:** the same reduced routed-message cap is enforced; an oversized
  `message` is rejected with a typed error (chunking optional, app-visible).
- **DELIVER replay:** `REPLAY_CHUNK_BYTES` drops to `CHUNK_PAYLOAD_BUDGET`; the
  tombstone-DELIVER array is bounded/chunked through the same batch mechanism.
- **mesh:signal, find_closest_set:** bounded at emission; `find_closest_set` clamps
  `payload.K`, closing #433 as part of this tranche.

## Test matrix (production-path, final serialized UTF-8, real transports)

Carries the v1 cases (byte boundary ±1, multibyte, multi-chunk reassembly over
WebRTC / bridge / mixed, loss, duplication/reorder, partial-no-ack,
tombstone-before-body, chunk ≤ both limits, budget, assembly DoS) and adds, per
Aster:

1. **Conflicting duplicate index** — same index, different digest → rejected, batch
   not completed.
2. **Forged / oversized count** — rejected before allocation.
3. **Mixed chunk plans sharing a claimed batchId** — manifest/commitment mismatch →
   rejected; no false completion.
4. **Rejected entry blocks completion** — one REJECTED item → no completion, no
   HANDOFFACK.
5. **Partial-high-water REPLAYUP recovery** — a missing chunk does not advance
   high-water; the recovery PULLUP completes the batch; it is not quenched.
6. **Legacy-ack refusal** — a legacy `{held,sent}` ack does not clear a chunked
   handoff.
7. **Snapshot mutation mid-batch** — supersession cancels the old batchId cleanly;
   no interleave.
8. **Global / per-peer assembly pressure** — bounds hold under many incomplete
   batches from one and many peers.

## Status

Design v2. No chunk-size constant, no S2.0c clearance, no S2.1 authorization, no
canary or deploy is implied. Submitted for review before any sync-engine code.
