# REF-1.1 S2.0c — full-state chunking protocol design

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-CHUNKDESIGN-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy. S2.0c held, S2.1 blocked.
- **Follows:** the Option-A decision (Aster seq 714), the WebRTC path-budget
  addendum (seq 717), David's binding 15 KiB multi-hop ruling (seq 720), and the
  code-grounded producer inventory (`REF-1.1-S2.0c-Frame-Ceiling-Inventory.md`,
  67ffd27).

## What a routed frame may carry

A routed frame crosses a chain of forwarders that never negotiate a size with the
origin, so the only budget that is guaranteed to arrive is the one already in use
for a reliable publish: `MAX_RELIABLE_PUBLISH_BYTES` = 15 KiB. Five producers put
more than that on the wire in one frame — REPLICATE and HANDOFF (the whole role
cache), REPLAYUP (a cache delta, worst case the whole cache), the tombstone `dels`
arrays those carry, and the 96 KiB DELIVER-replay chunk. This design splits each
into a batch of chunks that each fit the budget, and it keeps the receiver's
end-state and its completion-dependent signals identical to the monolithic frame.

The binding rule, from every chunk's final serialized bytes:

    encoded chunk bytes ≤ MAX_RELIABLE_PUBLISH_BYTES
                          − worst-case encoded routing/RPC wrapper
                          − chunk-metadata overhead

`MAX_FRAME_BYTES` (1 MiB) stays a separate defensive parser-allocation ceiling.
Every chunk sits below both; the 15 KiB budget binds.

## Two identities, two concerns

The design keeps `msgId` and adds `batchId`. They answer different questions and
must not be conflated — that separation is what makes chunking safe.

- **`msgId` governs DATA.** Every message unions into the cache by `msgId`, exactly
  as today. Duplicate or reordered chunks cannot corrupt the cache: a repeated
  `msgId` is a no-op, a tombstone removes its body whenever it lands. This is the
  property that makes a partial transfer harmless to hold.
- **`batchId` governs COMPLETION.** It identifies one snapshot transfer so the
  receiver can tell "I have every chunk of this snapshot" from "I have unioned some
  data." Idempotent union proves duplicate-safety; it does not prove complete
  transfer. Only a full `batchId` does.

`batchId` is content-addressed: `hash(topicId ‖ policy ‖ ordered msgIds ‖ ordered
delIds)`, computed once at the sender. Same snapshot → same `batchId`, so an
anti-entropy re-send of unchanged state is recognized, not re-assembled from
scratch. Data dedup stays by `msgId` regardless of which batch a message arrives
in, so a message already present from an earlier batch is never re-ingested.

## Chunk frame

Each REPLICATE / HANDOFF / REPLAYUP frame becomes:

    { topicId, from, batchId, index, count, policy,
      dels: [...],      // present only on the leading chunks
      msgs: [...] }      // present only on the trailing chunks

`index` is 0-based, `count` is the total. `count` on every chunk is the
completeness oracle: the receiver needs indices `0 … count-1`. Metadata overhead
per chunk is `batchId` (64 hex) + `index` + `count` + `policy` ≈ 150 bytes, folded
into the budget subtraction above.

**Tombstones lead the batch.** The sender serializes all `_activeDels` into the
first chunks, then message bodies. Combined with the receiver applying a chunk's
`dels` before its `msgs`, a tombstone is present before its body on the in-order
path. Order-independence for the out-of-order path is guaranteed separately, below.

## Sender

Snapshot the role (`_syncSnapshot` for REPLICATE/HANDOFF, `_syncDelta` for
REPLAYUP) as today. Then, instead of one `_route`, pack greedily into chunks by
measured serialized bytes — dels first, then msgs — never crossing the budget, and
emit each chunk as its policy's frame with `batchId`, `index`, `count`. A single
message whose own serialized size exceeds the budget is a hard error surfaced to
the caller, not silently dropped (it should already be impossible: `peer.pub`
caps an enveloped message at the same 15 KiB reliable default).

## Receiver

Per `batchId`, keep an assembly record: `count`, a received-index bitset, and the
policy. On each chunk:

1. Apply `dels` then union `msgs` **immediately**, through the existing
   idempotent ingest. Data lands as it arrives; a partial batch still warms the
   cache, consistent with union semantics.
2. Mark `index` received.
3. When the bitset holds `0 … count-1`, the batch is **complete** — and only then
   fire the completion-dependent signal for its policy.

If the same `batchId` is already complete when a re-sent chunk arrives, re-emit
its completion signal (the sender is retrying because it missed the ack) rather
than silently absorbing it.

## Completeness and recovery under loss

A lost chunk leaves a batch incomplete: the bitset never fills, so no completion
signal fires — partial transfer can never masquerade as completion. Recovery reuses
machinery that already exists, so this design adds no new retry timer:

- **REPLICATE / REPLAYUP** re-send on the standing anti-entropy tick
  (`ROOT_REPLICATE_FULL_MS`). The re-send carries the same or a superseding
  snapshot; content-addressed `batchId` + `msgId` union make it idempotent, and an
  incomplete assembly record is discarded on its TTL.
- **HANDOFF** re-sends within the existing leave loop (`HANDOFF_TRIES`, then a
  cohort spray as REPLICATE). The heir's `HANDOFFACK` now carries `{ batchId,
  complete }` and is emitted **only** on a complete batch; an incomplete transfer
  is not acked, so the leaver's unacked path retries and finally cohort-sprays —
  the last-copy-drop guard (#402) still holds because "acked" now means "complete."

Per-gap NACK (the receiver requesting only missing indices) is a bandwidth
optimization, not a correctness requirement, and is deliberately out of this
tranche. Whole-batch re-send with content-addressed dedup is the correct baseline.

## Tombstone safety under loss, duplication, reordering

The invariant to preserve: a tombstone suppresses its body regardless of the order
the two arrive in, and regardless of which chunks are lost and re-sent. It rests
on one property the receiver must guarantee:

**The tombstone map is durable and monotone within TTL, and every cache insert
consults it.** A tombstone, once applied, is never forgotten until its TTL; a body
insert checks the map and is rejected if tombstoned. Then:

- tombstone-before-body (in-order, or tombstone chunk arrives first): the body is
  rejected on insert.
- body-before-tombstone (reorder, or the tombstone chunk is delayed): the body is
  cached, and the later `_applyDels` removes it.

Tombstones-first batch ordering narrows the transient window in which a body is
briefly cache-visible before its tombstone; the durable map closes it for
correctness. **Implementation requirement to verify:** confirm `_cachePush`
consults the active-tombstone map on insert; today `_syncIngest` orders dels
before msgs within a frame, which is sufficient only inside one frame — chunking
makes the per-insert check load-bearing, and it must be enforced, not assumed.

## Budget and timing interactions

- **`REPLICATE_FULL_BUDGET` (32 full pushes / tick, round-robin) becomes a CHUNK
  budget.** A 1024-message cache is ~70 chunks; emitting them in one tick would
  starve other topics and block the loop. The round-robin cursor advances across
  chunks, so a large batch spans several ticks. This bounds per-tick event-loop
  work — the same class of blocking behind the join-storm collapse (#332).
- **The I-11 time-sliced ingest queue improves.** REPLICATE/REPLAYUP already queue
  their ingest; each queued unit is now a ≤15 KiB parse+verify instead of one
  16 MiB parse, which is strictly better for loop responsiveness. HANDOFF stays
  inline (as today) but per-chunk, so its inline cost is bounded too.
- **Leave / handoff deadlines scale with chunk count.** `HANDOFF_ACK_MS +
  HANDOFF_ACK_PER_TOPIC_MS` must gain a per-chunk margin (or scale by
  `ceil(bytes/budget)`), capped by `HANDOFF_ACK_MAX_MS`, so a many-chunk topic is
  not marked failed mid-transfer.
- **Assembly buffers are bounded (DoS).** Cap concurrent incomplete batches per
  peer, cap total buffered bytes, and TTL incomplete batches. An attacker sending
  many `count`-large first-chunks must not exhaust receiver memory. This bound is a
  first-class security requirement of the tranche.

## Suggested constants (measured, not final)

- `CHUNK_PAYLOAD_BYTES` = `MAX_RELIABLE_PUBLISH_BYTES` − measured worst-case
  wrapper − chunk metadata (≈ 15 360 − ~450). Fixed at the measured value in code.
- `MAX_INFLIGHT_BATCHES_PER_PEER`, `MAX_ASSEMBLY_BYTES`, `ASSEMBLY_TTL_MS` — receiver
  buffer bounds.
- `CHUNKS_PER_TICK` — the re-expressed REPLICATE budget.

## The other producers

- **DELIVER replay:** `REPLAY_CHUNK_BYTES` drops from 96 KiB to the same
  `CHUNK_PAYLOAD_BYTES`. Its per-subscriber replay is already chunked, so only the
  bound changes; a gate must prove a maximum replay chunk crosses a multi-hop path.
- **direct / notify:** `axona:direct` carries arbitrary application payloads with no
  cap and can route multi-hop. Bound it: reject (or chunk via the same batch
  mechanism) a `message` whose routed frame would exceed the budget. Rejecting with
  a typed error is the minimum; chunking is optional and app-visible.
- **PUB override:** the 256 KiB `maxPublishBytes` override is multi-hop-unsafe and
  is documented for node-only fleets. Keep the default at 15 KiB; the design does
  not change PUB, only records the override as out-of-contract for routed paths.
- **mesh:signal, find_closest_set:** verify worst-case serialized size against the
  budget; `find_closest_set` ties to the open `payload.K` clamp (#433).

## Production-path test matrix

Every case measures final serialized UTF-8 through the real encode + routed
wrapper, and drives actual transports:

1. **Byte boundary:** a chunk at exactly `CHUNK_PAYLOAD_BYTES` accepted;
   boundary + 1 rejected. Multibyte (3-byte BMP) payloads counted as bytes.
2. **Single-message max:** the largest legal single message fits one chunk.
3. **Tombstone frames:** a maximum/bounded tombstone-only batch chunks and
   reassembles.
4. **Multi-chunk success:** a full cache batch reassembles to the exact monolithic
   end-state over (a) WebRTC DataChannel, (b) bridge/WebSocket, (c) a mixed
   multi-hop path.
5. **Loss:** a dropped chunk leaves the batch incomplete, no completion signal;
   the anti-entropy / handoff re-send completes it.
6. **Duplication / reordering:** arbitrary chunk order and duplicates reassemble to
   the same end-state.
7. **Partial no-ack:** an incomplete HANDOFF batch yields no `HANDOFFACK`; the
   leaver retries and cohort-sprays; no last-copy drop.
8. **Tombstone-before-body:** across loss, duplication, and reordering, a tombstoned
   body is never app-delivered and never survives in the cache.
9. **Every chunk ≤ both** the 15 KiB transfer budget and `MAX_FRAME_BYTES`.
10. **Budget:** a large-cache topic emits ≤ `CHUNKS_PER_TICK` and does not starve
    other topics or block the loop beyond the per-tick bound.
11. **Assembly DoS:** many incomplete batches are bounded by the buffer caps.

## Status

Design only. No chunk-size constant is cleared until the transport-path evidence
(cases 1, 4, 9) exists. Submitted with the producer inventory for review before
any sync-engine code. S2.0c held, S2.1 blocked, no canary or deploy.
