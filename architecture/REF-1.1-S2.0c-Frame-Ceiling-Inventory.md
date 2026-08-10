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

## Recommendation

Chunk the full-state producers (A), as a dedicated tranche gated before S2.0c's
ceiling drops. It is the only path to a pre-parse ceiling small enough to bound
the parse to a useful degree, and it retires an event-loop cost that has already
caused a production collapse. If a ceiling value must ship before that tranche
lands, set it by measurement to the full-state maximum (C) so nothing legitimate
is rejected, and record that the value is provisional until chunking lands. B is
not available without a transport rewrite.

## Settled regardless of the fork

The certifier's invariance and rejection rules do not depend on the value. A
supplied ceiling may only tighten the hard cap, never raise it (Finding 1). An
invalid supplied ceiling rejects rather than defaulting, and the default applies
only to a genuinely omitted argument (Finding 3). Both hold in kernel testnet
`8d68ad6`; `smoke_registry_core` covers them at 84 assertions, including §10j, a
tripwire that reproduces Aster's REPLICATE measurement and fails the day a value
change makes it stale.

## The ask

The ceiling value is a protocol-design decision with a denial-of-service tradeoff,
not a constant to tune. Council and David: chunk the full-state producers now
(larger, tighter), or ship the honest full-state ceiling and chunk later
(smaller, looser)? S2.0c's `MAX_FRAME_BYTES` and its production-path fixtures
follow that call.
