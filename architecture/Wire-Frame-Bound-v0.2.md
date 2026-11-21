# One size limit for everything the mesh carries

**v0.2 — 2026-11-20 — axona.bot, for council review. Nothing here is built.**
Replaces v0.1 (`8cdecf0`), whose single 32 KiB number was wrong. Kernel read at tag
v4.157.0 (`f348b7a`). Measurements from testnet bridge B1 on the diagnostic 4.157.1
(`aece299`, `MESH_IO_DIAG=1`), 20:21Z 2026-11-20 to 00:07Z 2026-11-21.

## The question

How big can one frame be when the mesh carries it?

David's rule, 2026-11-20: two nodes with nothing between them can negotiate a larger
size. A frame the mesh transports crosses nodes whose capability the sender cannot
know, so it must assume the minimum.

The kernel already says this. AxonaPeer.js:492, rule O-5: "a publish must be
RECEIVABLE by any peer on any browser across any path." It then enforces the rule in
one place, on one message type, measured at the wrong point. On 2026-11-20 the
testnet bridge carried routed frames of 247 KB.

## What changed from v0.1

- v0.1 proposed one number, 32 KiB. v0.2 has TWO: a ceiling nothing may cross, and
  a smaller target the kernel aims at when it builds its own frames.
- The ceiling is 64 KiB, on Howard's argument and RFC 8841. The target starts at
  16 KiB, on the memory measurements.
- A bound on the send queue per channel is added. v0.1 played the queue down; a
  departure at 23:14Z left 38.6 MB queued behind closing channels.
- The publish check moves to the frame as sent.

## What this is NOT

It is NOT a fix for how MUCH the network sends. A root re-pushes its whole cache to
two backups every 60 seconds and on every publish. That is 4.158.0's subject.

It is NOT the transport Howard describes as the right long-run answer: a prioritized
queue with chunking, backpressure and each hop's own maximum. His words: "now is NOT
the time to do that." This note is the number to use until then.

It does NOT lower what an app may publish by default.

## Two numbers, and why they differ

**The ceiling: 64 KiB.** RFC 8841 §6.1: a peer advertises the largest message it
will receive; a sender "MUST NOT" exceed it; a peer that advertises nothing is
assumed to accept 64K. So 64 KiB is what every compliant peer takes, and the only
size a sender can rely on without knowing who is on the path. Chrome and Safari
advertise 262,144 and Firefox more, by a developer's test report on the W3C list in
April 2026, which is not a vendor document. MDN's current guidance is "at least 256
kilobytes" on modern browsers and "keep message sizes moderately small." The 16 KB
in RFC 8831 §6.6 is a SHOULD for the case where message interleaving is missing, so
one large message does not hold up the association. It is a courtesy about delay. It
is not a statement of what a peer can receive. Howard's correction on that point
holds.

**The target: 16 KiB.** This one is about memory, not capability. Orion ran the
bridge's own `node-datachannel` 0.32.3 (council `88476b12`): 23 KB frames at 180 a
second stayed flat after a 12 MB warm-up; 234 KB frames kept 39 MB with the queue
under 4.9 MB. On B1, a burst of 55–116 KB frames at 21:25Z left 226 MB behind.
Nobody has measured 64 KB. So the ceiling is safe for delivery and UNPROVEN for the
problem this work exists to fix. The kernel builds its own frames at 16 KiB, inside
the range measured flat, and the number is one constant to raise once a 64 KB burst
has been measured and memory holds.

Both are measured on the serialized frame as it leaves, routing fields included.

## What was measured

Single routed frames, as serialized onto the data channel at B1:

| type | largest seen | why |
|---|---|---|
| `REPLICATE` | 247 KB | `_syncPush` sends the WHOLE cache and every live tombstone in one payload (syncEngine.js:174). No byte budget. |
| `HANDOFF` | same path | Same function. |
| `ROOTBEACON` | 234 KB | With `BEACON_CHUNK` off a beacon lists every topic the root holds (rootElection.js:70). |
| `DELIVER` (replay) | 229 KB | `_replayTo` budgets 96 KiB of message BODIES (wireHandlers.js:1394). The frame is about 2.2 times that. Its tombstone batch has no budget (wireHandlers.js:1424). |

The merge export uses the same 96 KiB of bodies (mergeMachine.js:678) and by the
same arithmetic reaches about 210 KB. Not seen on B1.

**Why bodies and frames differ.** Each message is a JSON string carried inside a
JSON payload inside the routed envelope, and every quote and backslash is escaped
where it is nested. A constructed example: plain text grows 4 percent; quote-heavy
content about doubles. The routed envelope adds its path and waypoint fields on top.

**The same gap breaks the publish limit.** `peer.pub` checks the envelope at 15 KB,
which is 16 KiB less 1 KB for wrapping. It checks BEFORE the nesting. A publish that
passes can leave the node at up to about 31 KB.

**What the beacon options did.** `ANNOUNCE_NEW_ONLY` and `BEACON_CHUNK` went on at
both testnet bridges at 22:47Z. Two departures of visiting nodes, one each side:

| | 21:25Z, off | 23:09–23:14Z, on |
|---|---|---|
| nodes that left | 9 | 4 |
| memory gained at B1 | 226 MB | 107 MB |
| beacons, worst minute | 4,548 frames, 251 MB | 2,036 frames, 38 MB |
| send queue high-water | 6.4 MB | 38.6 MB |

The runs were not the same size, so "half" is a rough reading. What grew memory the
second time was `DELIVER` at 38–103 MB a minute in frames to 229 KB, and `REPLICATE`
to 247 KB.

## The proposal

### 1. Two constants

`WIRE_FRAME_CEILING = 64 KiB`. No routed frame is sent or forwarded above it.
`WIRE_FRAME_TARGET = 16 KiB`. What the kernel's own builders pack to.

A builder packs whole messages until the next one would cross the target, then
starts a new frame. One message larger than the target rides alone, up to the
ceiling.

### 2. Budget the frame, not the bodies

Every builder below counts serialized size. Each cache entry carries its serialized
length precomputed beside its existing `bytes` field, so packing is an addition per
entry.

### 3. The builders

**REPLICATE.** `_syncPush` cuts the snapshot at message boundaries. The receiver's
ingest is a union (`_ingestStampedBatch`): it adds what it lacks and removes
nothing. So N small frames should read as one large frame did, with no receiver
change. The subscriber list and the two leases ride the FIRST frame. The sender
credits a replica when EVERY frame was consumed.

**HANDOFF.** Same cut, with `part: i, of: n`. The heir acks once, on the last part,
with `held` counted across parts. A missing part is a short ack, which the leaver
already treats as no ack (#402) and retries.

**ROOTBEACON.** Make `BEACON_CHUNK` and `ANNOUNCE_NEW_ONLY` the default. A chunk of
256 topics is about 18.5 KB, a little over the target and far under the ceiling;
`BEACON_TOPICS_MAX` drops to fit, or the chunk is cut by size.

**DELIVER replay, its tombstones, the merge export.** Re-budget from 96 KiB of
bodies to the target. `MERGE_F_MAX` and the merge timeout are derived from the frame
size (constants.js:553) and are recomputed; the timeout grows with the frame count.

### 4. The publish check

`peer.pub` measures the frame it is about to route. Over the ceiling, it refuses.
The default limit stays where it is for ordinary content: about 15 KB of plain text
still passes. Quote-heavy content gets less than it does today, because today's
check was not counting what it cost.

An app may raise `maxPublishBytes`. That override is capped at the ceiling for any
routed publish. Larger payloads use the chunk helper, as the error already says.

### 5. A bound on the send queue

`mesh.send` reads `bufferedAmount` before it sends. Above `SEND_QUEUE_MAX` (proposed
4 MB per channel) the send is refused and the caller is told, the same way a closed
channel is told today. The routed layer already handles a failed hop: it tries the
next candidate or reports the message undeliverable.

This is the item most likely to change behaviour, so it has its own switch and is
reviewed alone. It turns a silent 38 MB queue into visible send failures. Whether
the callers above it degrade well is not something I have read.

### 6. A check at the door

`mesh.send` counts frames over the target by type, once a minute. A routed frame
over the ceiling is refused, for every type. That refusal is what a test pins.

## What it costs

A full cache at a 16 KiB target is about fifteen times the frames it is at 247 KB.
Bytes do not change. Each frame carries its own routed envelope, a few hundred bytes
to about 1 KB with a long path, so overhead is 2 to 6 percent.

**The ingest queue is the catch.** It is capped at 4,096 ENTRIES, not bytes
(`INGEST_QUEUE_MAX`). Lyra's night of 11-20 overflowed it 508 times, about 100,000
dropped entries. Fifteen frames where there was one fills it fifteen times faster.
The cap moves to bytes in the same change, or framing trades a memory problem for a
loss problem.

More frames also means more routed sends per second through the same hops. Head-of-
line delay is what RFC 8831 warns of with LARGE messages; many small ones is the
case it recommends.

## Rollout

Three switches, default off, so each can be judged alone:

1. `WIRE_FRAME=1`: the sender changes (REPLICATE, DELIVER, merge export), the
   publish check at frame size, and the ingest cap in bytes. Old receivers read the
   result.
2. `SEND_QUEUE_BOUND=1`: item 5.
3. HANDOFF parts arm last, once every node runs a kernel that reads `part/of`.

The beacon defaults flip in the same release as switch 1.

Test order: testnet bridges and Lyra's hosts, with `MESH_IO_DIAG` on B1 before and
after. What decides it: largest frame by type, and B1's memory across a departure of
nodes like 21:25Z and 23:14Z.

## What would show this is wrong

- B1's memory still steps with every frame under 16 KiB. Then size was not the
  cause, and the suspect is burst rate through the native queue.
- Orion measures a 64 KB burst and memory holds. Then the target can rise and the
  frame count falls by four.
- Some receiver does read a REPLICATE as a complete snapshot. I read `_onReplicate`
  and the union ingest, not every policy hook in `_syncIngest`.
- The queue bound produces more undeliverable messages than the memory it saves is
  worth. One night with switch 2 on and off answers that.

## Open questions

1. **For Aster.** Does anything in `_syncIngest`'s REPLICATE or HANDOFF policy read
   a payload as COMPLETE? And which other types can exceed the ceiling: `MERGEOFFER`
   manifests, `PULLUP` replies, the subscriber list on a full push?
2. **For Orion.** A 64 KB burst of 250 MB inside a minute, the 21:25Z shape. Does
   memory hold? And is a queue behind a closing channel freed at close, or held
   until the PeerConnection is destroyed?
3. **For Vega.** Is a precomputed serialized length per cache entry cheap enough on
   the publish path? The alternative is to stop nesting bodies as strings, which is
   a wire format change.
4. **For David.** Is 4 MB the queue bound, and should switch 2 ship with switch 1 or
   after it has run alone?

## Relation to work in flight

- **4.158.0** (`REPLICATE_DELTA`, built, held by David until the bridge memory work
  is done). Deltas make most eager pushes one message. Framing bounds the full
  pushes that remain. 4.158.0 changes the same function and is rebased onto this.
- **Item 3** (a cut-off host that makes itself root) is untouched.
- **REGION_ROLES** is untouched.
- **Howard's long-run transport** (prioritized queue, backpressure, per-hop
  maximum) would replace items 5 and 6 and let direct links use what they
  negotiated. Not proposed here.
