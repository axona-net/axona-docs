# REF-1.1 S2.0c — inbound frame-size inventory and the pre-parse ceiling fork

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-FRAMECEIL-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel traced:** 4.62.2. Analysis only. No dispatch change, no deploy. S2.0c
  held, S2.1 blocked.
- **Answers:** Aster's S2.0c re-review Finding 2
  (`ASTER-COUNCIL-REF11-S20C-REREVIEW-20260810-02`), which reproduced a
  legitimate 1,076,365-byte REPLICATE frame that a 1 MiB certifier ceiling
  rejects.
- **Status:** Option A CHOSEN (Aster seq 714), design-direction authorization
  only — not code clearance. This v1 inventory had two producer errors, corrected
  below; the tranche's complete, code-grounded inventory supersedes this file.

## Corrections (Aster seq 714, verified in code)

Two rows in the v1 table below are WRONG and one class was missing:

- **DELIVER (subscriber replay) is ALREADY chunked**, not a full-cache producer.
  `_replayTo` (`wireHandlers.js:747`) flushes a batch once it would exceed
  `REPLAY_CHUNK_BYTES` = 96 KiB. It is bounded already.
- **PULLRESP carries ONE cached `json` value or null** (`wireHandlers.js:947`),
  not history. It is a single-message producer, not full-state.
- **UNCAPPED producers were omitted.** Tombstone `dels` arrays ride inside
  REPLICATE/HANDOFF and can also be sent as a DELIVER tombstone array; the
  tombstone map has TTL expiry but NO `CACHE_MAX`/`CACHE_BYTES`-equivalent count
  or byte ceiling. `replayCacheSize`/`replayCacheBytes` are configurable and NOT
  clamped to the `CACHE_MAX`/`CACHE_BYTES` defaults, so those defaults alone do
  not prove a global maximum. Direct/RPC and `notify` payloads are arbitrary
  application JSON with no demonstrated producer-side frame cap. Lookup,
  handshake, and signaling maxima need explicit production-path evidence, not
  omission.

So the ~48 MiB "honest ceiling" (Option C) is NOT honest: it is both too weak a
pre-parse bound AND unproven to admit every legitimate frame (unbounded
tombstones, configurable caches, uncapped direct/notify). The demonstrated
unchunked full-state producers are exactly **REPLICATE, HANDOFF, REPLAYUP**.

## What value may the pre-parse frame ceiling take?

The certifier reads a byte count and refuses to `JSON.parse` a frame above it.
That ceiling has to clear the largest frame the protocol legitimately sends on
the decode site it guards. Set it too low and legitimate state synchronization
becomes an uncertified no-op. The first S2.0c pass set it to 1 MiB from the
`peer.pub` envelope limit alone. That was the wrong producer.

## The ceiling is per decode site, not per frame family

A decoder learns a frame's family from its `type` field, which exists only after
`JSON.parse`. The three decode sites — `node/index.js`, `web/index.js`,
`web/mesh.js` — each parse every family that arrives on their channel through one
`JSON.parse` call. So a pre-parse ceiling cannot vary by family. One number has
to hold for every producer that reaches that site.

This rules out per-family certifier variants at the pre-parse seam. A variant
keyed on family would need the family before the parse that reveals it. Splitting
the decode sites by family is a transport rewrite, not a certifier change.

## Inventory: every producer on the shared ingress

Three size classes reach the node, bridge, and mesh decoders.

| Class | Frames | Bound (chars) | Producer |
|-------|--------|---------------|----------|
| Full-state | REPLICATE, HANDOFF, REPLAYUP, DELIVER (replay), PULLRESP (history) | `CACHE_BYTES` = 16 MiB, `CACHE_MAX` = 1024 msgs | `syncEngine._syncSnapshot` / `wireHandlers` replay map the whole role cache into one `msgs` array |
| Single message | PUB | `MAX_PUBLISH_BYTES` = 256 KiB | `peer.pub`, one signed envelope, capped at `AxonaPeer.js:1812` |
| Control | SUB, UNSUB, KILL, TOUCH, PULL, PULLUP, METRICSON, ROOTBEACON, RECEIPTPROBE, RECEIPTNACK, INGESTACK, HANDOFFACK, ADOPT | ids + scalars; ADOPT ≤ `MAX_DIRECT` = 20 subscribers | routed control payloads |

`peer.pub` is not the largest producer. Five frames carry the whole role cache.
`_syncSnapshot` maps `role.cache` into `{ json, publishTs, msgId, seq }` per entry
with no chunking, and a subscriber's replay does the same. `cacheBytes` counts
`entry.json.length + 80` — JS string-length **chars** — capped at
`CACHE_BYTES` = 16 MiB.

## The number that drives the ceiling

A full cache is up to 16 MiB of chars. The certifier counts UTF-8 **bytes**, and
a BMP char encodes to as many as 3 bytes, so a legitimate full-state frame reaches
roughly 48 MiB on the wire before the routed envelope. Aster's 70-entry
reproduction — 1,076,365 bytes, well under both the 1024-message and 16 MiB cache
limits — sits at the low end of that range. A ceiling that never rejects a
legitimate frame, with the cache contract as it stands today, has to clear ~48
MiB.

A ~48 MiB pre-parse ceiling admits a 48 MiB adversarial parse. It is honest — it
never drops legitimate sync — and it is weak. It is also strictly tighter than
the status quo, where every decode site calls `JSON.parse` with no size guard at
all.

## The fork

**A — chunk the full-state producers below a small documented ceiling.**
REPLICATE, REPLAYUP, and DELIVER-replay are idempotent union-ingest: a receiver
unions each frame into its cache, so splitting a cache across several frames
changes nothing it observes. HANDOFF carries an ack that would move to a final
chunk. Chunking lets the ceiling drop to ~1 MiB and bounds per-frame ingest work,
which is the same event-loop-blocking cost that drove the join-storm collapse
(GH #332). It is a producer-side change in `syncEngine` with its own gates:
receiver reassembly under loss, HANDOFF ack timing, REPLICATE_FULL_BUDGET
interaction.

**B — per-frame-family certifier variants.** Infeasible at the pre-parse seam, as
above. The family is unknown before the parse the ceiling guards.

**C — one honest ceiling at the full-state maximum.** Derive `MAX_FRAME_BYTES`
from `CACHE_BYTES` plus UTF-8 expansion plus the routed envelope, measured through
`_syncSnapshot` + `wire.encode`. Keeps S2.0c to the certifier. Never rejects a
legitimate frame. Leaves the pre-parse allocation bound at tens of MiB.

## Decision (Aster seq 714): Option A, as the next reviewable tranche

Chunk the full-state producers. Option C rejected. The tranche must:

- Complete the decode-site producer inventory from actual send/encode paths —
  correcting DELIVER and PULLRESP, and including tombstones, direct/notify,
  lookup, handshake, and signaling.
- Establish ONE transport hard cap only after every producer sharing that decode
  site is either bounded below it or moved to a separately bounded decode seam.
- Chunk REPLICATE, HANDOFF, REPLAYUP by measured UTF-8 serialized bytes,
  including routed/RPC wrapper overhead — not inner `json.length` alone.
- Bound or chunk tombstone transfer, preserving the invariant that a tombstone
  suppresses its body even under chunk loss, duplication, and reordering.
- Define batch identity, chunk index/count or finality, retry/dedup semantics,
  and completeness evidence. Idempotent union makes duplicate data safe; it does
  not by itself prove complete transfer under loss.
- Emit `HANDOFF_ACK` and any durability/receipt evidence only after all required
  chunks for a transfer are accepted. Partial transfer must never masquerade as
  completion.
- Specify how chunk count interacts with `REPLICATE_FULL_BUDGET`, ingest queue
  limits, leave/handoff deadlines, anti-entropy retries, and event-loop bounds.
- Add production-path tests: exact byte boundaries and multibyte expansion;
  maximum single-message frames; maximum/bounded tombstone frames; multi-chunk
  success; loss, duplication, reordering; partial-transfer no-ack;
  tombstone-before-body safety; and every chunk at or below the final
  `MAX_FRAME_BYTES`.

The provisional 1 MiB constant stays UNWIRED until the tranche shows every
legitimate producer conforms. S2.0c held, S2.1 blocked, no canary or deploy.

## Settled regardless of the fork

The certifier's invariance and rejection rules do not depend on the value. A
supplied ceiling may only tighten the hard cap, never raise it (Finding 1). An
invalid supplied ceiling rejects rather than defaulting, and the default applies
only to a genuinely omitted argument (Finding 3). Both hold in kernel testnet
`8d68ad6`; `smoke_registry_core` covers them at 84 assertions, including §10j, a
tripwire that reproduces Aster's REPLICATE measurement and fails the day a value
change makes it stale.

## Next deliverable

The chunking-protocol design (batch/chunk/finality/ack semantics, tombstone
bounding, budget interactions) plus the corrected code-grounded producer
inventory, submitted for review before any sync-engine code. This file records
the decision and the corrections; the tranche's inventory supersedes the v1 table
above.
