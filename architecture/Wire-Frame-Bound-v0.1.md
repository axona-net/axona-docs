# One size limit for everything on the wire

**v0.1 — 2026-11-20 — axona.bot, for council review. Nothing here is built.**
Kernel read at tag v4.157.0 (`f348b7a`). Measurements from testnet bridge B1 on the
diagnostic 4.157.1 (`aece299`, `MESH_IO_DIAG=1`), 20:21Z–22:51Z 2026-11-20.

## The question

How big can one frame on a data channel be?

An app is told 15 KB. `peer.pub` refuses anything larger and points at the chunk
helper (`MAX_RELIABLE_PUBLISH_BYTES`, AxonaPeer.js:4215). The kernel's own traffic
was never told. On 2026-11-20 the testnet bridge carried frames of 239 KB, sixteen
times the limit the apps obey, and it held 1.9 GB of memory that its JavaScript heap
could not account for.

This note proposes ONE limit, measured where the frame leaves, applied to every
message type.

## What this is NOT

It is NOT a fix for how MUCH the network sends. A root re-pushes its whole cache to
two backups every 60 seconds whether or not anything changed, and on every publish.
That volume is 4.158.0's subject (send only what the replica lacks) and stays there.
This note bounds the SIZE of each frame and nothing else.

It is NOT a transport change. No new channel, no SCTP tuning, no allocator setting.
`MALLOC_ARENA_MAX=2` was tried on B1 and bounded nothing.

It does NOT lower what an app may publish.

## What was measured

Four internal types exceed the limit. Sizes are single frames as serialized onto the
data channel, read per minute at B1.

| type | largest frame seen | why |
|---|---|---|
| `REPLICATE` | 239 KB | `_syncPush` sends `_syncSnapshot(role)`: the WHOLE cache and every live tombstone in one payload (syncEngine.js:174). No byte budget. The only bounds are the cache's own, 1,024 messages or 16 MB. |
| `HANDOFF` | same path | Same function, same payload, different type. |
| `ROOTBEACON` | 234 KB | With `BEACON_CHUNK` off a beacon lists every topic the root holds (rootElection.js:70). The receiver reads the first 256 and discards the rest. |
| `DELIVER` (replay) | 207 KB | `_replayTo` budgets 96 KiB of message BODIES per batch (wireHandlers.js:1394). The frame on the wire is 2.2 times that: each body is a JSON string inside a JSON payload inside the routed envelope, and every quote is escaped at each level. The tombstone batch that follows has no budget at all (wireHandlers.js:1424). |

The merge export is framed at the same 96 KiB of bodies (mergeMachine.js:678), so by
the same arithmetic it reaches about 207 KB too. It was not seen on B1 today.

The native layer accepts up to 256 KiB and throws above it. B1 logged zero size
throws from 05:38Z to 22:51Z. So the kernel is not yet losing these messages. It is 17 KB
from losing them, and a topic whose cache passes 256 KiB serialized can no longer
replicate or hand off over WebRTC at all.

## Why the size matters more than the volume

Orion ran both cases through the bridge's own `node-datachannel` 0.32.3 (council
`88476b12`):

- 23 KB frames at 180 a second, 85 MB a minute: resident memory rose 12 MB while
  warming and then stayed flat.
- 234 KB frames with the send queue held under 4.9 MB: 39 MB kept after everything
  drained and the channels closed.

B1 agrees. It ran flat for hours at 80 MB a minute each way. Its memory moved only
in the minutes large frames burst: +64 MB at 20:32Z, and +226 MB at 21:25Z when nine
visiting nodes left and the bridge sent 251 MB of its own beacons in sixty seconds,
about 55 KB each. `bufferedAmount` never passed 6.7 MB in either. The JavaScript
heap stayed at 25–41 MB throughout.

One caution on the mechanism. Orion's explanation is glibc's 128 KiB threshold for
large blocks, allocated on one thread and freed on another. The 21:25Z frames were
55–116 KB, under that line, and memory still stuck. So "keep frames under 128 KiB"
is not a safe bound. The flat case is the one measured at 23 KB.

## The proposal

### 1. One number

`WIRE_FRAME_MAX = 32 KiB`, measured on the serialized frame at the point of send.

Why 32 and not 15: a 15 KB app message is itself about 32 KB on the wire after the
envelope and the escaping. The limit has to admit the largest thing an app is
allowed to publish, alone in a frame. It sits inside the range Orion measured flat
(18–31 KB) and a factor of four under glibc's line.

A frame builder packs whole messages until the next one would cross the limit, then
starts a new frame. A single message that is over the limit by itself rides alone.
That happens only when an app raised `maxPublishBytes` above the default; see the
open questions.

### 2. Measure the frame, not the bodies

Today's budgets count body bytes and the wire carries 2.2 times that. Every builder
below budgets the SERIALIZED size. The cheap way: keep a running count of
`JSON.stringify(entry).length` per entry plus the fixed envelope, which each cache
entry can carry precomputed beside its existing `bytes` field.

### 3. The four builders

**REPLICATE.** `_syncPush` cuts the snapshot into frames at message boundaries.
The receiver already treats a `REPLICATE` as a union (`_ingestStampedBatch`): it adds
what it lacks and removes nothing. So N small frames mean what one large frame
meant, and an old receiver needs no change. Three things ride the FIRST frame only:
the subscriber list, the metrics lease, the standing lease. The sender credits a
replica when EVERY frame was consumed, not the first.

**HANDOFF.** Same cut. The leaver must know the heir holds all of it, and today the
heir answers one `HANDOFFACK { held, sent }` for one frame. Each frame carries
`part: i, of: n` and the total; the heir acks once, on the last part, with `held`
counted across all parts. A missing part is a short ack, which the leaver already
treats as no ack (#402) and retries.

**ROOTBEACON.** Already solved, and off by default. `BEACON_CHUNK` lists 256 topics
a frame (about 18.5 KB) and `ANNOUNCE_NEW_ONLY` announces a claim by naming that
topic instead of the whole list. Both went on at the two testnet bridges at 22:47Z
today; in the first four minutes after, the beacon was gone from the top two types
by bytes, from 32–63 MB a minute before. The proposal is to make both the default.

**DELIVER (replay) and the merge export.** Change the budget from 96 KiB of bodies
to `WIRE_FRAME_MAX` of frame. Give the tombstone batch the same budget. The merge
export's frame count bound `MERGE_F_MAX` and its timeout are derived from the frame
size (constants.js:553) and must be recomputed; the timeout grows by about the
ratio of frame counts.

### 4. A check at the door

`mesh.send` already serializes the frame. It gains one comparison: a frame over
`WIRE_FRAME_MAX` is counted by type and logged once a minute. Over a second, harder
line (`WIRE_FRAME_REFUSE`, proposed 128 KiB) it is refused for internal types and
the send fails loudly instead of at 256 KiB silently later. The refusal is what
turns "we believe every builder is bounded" into something a test can pin.

## What it costs

Frame COUNT rises by about eight where frames were near the cap. Bytes do not. Each
frame is a routed message with its own envelope, about 300 bytes, so overhead is
around one percent.

**The ingest queue is the catch.** It is capped at 4,096 ENTRIES, not bytes
(`INGEST_QUEUE_MAX`). Lyra's night of 11-20 already overflowed it 508 times, about
100,000 dropped entries. Eight frames where there was one fills it eight times
faster. Framing REPLICATE without changing that cap from entries to bytes would
trade a memory problem for a loss problem. The two changes ship together or not at
all.

## Rollout

One switch, `WIRE_FRAME=1`, default off, covering the three sender changes
(REPLICATE, DELIVER, merge export) and the ingest cap in bytes. HANDOFF parts need
a receiver that understands `part/of`, so that piece arms last, after every node
runs a kernel that reads it. The beacon defaults flip in the same release.

Test order: testnet bridges and Lyra's hosts first, with `MESH_IO_DIAG` on B1 before
and after. The measurement that decides it: largest frame by type, and B1's memory
across a departure of nodes like 21:25Z.

## What would show this is wrong

- B1's memory still steps with every frame under 32 KiB. Then the size was not the
  cause, and the next suspect is the burst RATE through the native queue, which this
  note does not bound.
- Frames under the limit but a root with 3,000 topics still sends megabytes a second
  of them. Then the bound helps the allocator and the event loop pays instead.
- An old receiver that does treat a REPLICATE as a complete snapshot somewhere I did
  not read. I read `_onReplicate` and the union ingest; I did not read every policy
  hook in `_syncIngest`.

## Open questions

1. **For David.** An app may raise `maxPublishBytes` up to 256 KiB
   (`MAX_PUBLISH_BYTES`). Such a message cannot fit any sane frame. Lower the hard
   ceiling to the wire limit, or leave it and let that one message ride alone and
   oversize?
2. **For David.** Is 32 KiB the number, or do you want the wire limit equal to the
   15 KB the apps are told, with the app limit lowered to make room for the
   envelope?
3. **For Aster.** Does anything in `_syncIngest`'s REPLICATE or HANDOFF policy read
   a payload as COMPLETE: clear something because the snapshot did not list it?
4. **For Orion.** Rerun the A/B at 32 KiB with a 250 MB burst in under a minute, the
   21:25Z shape. If that retains memory, the number is too high.
5. **For Vega.** The escaping overhead is 2.2 times on alert-bot payloads. Is
   budgeting the serialized size per entry cheap enough on the publish path, or
   should the envelope stop double-encoding bodies? That second option is a wire
   format change and a larger piece of work.
6. Which other types can exceed the limit? `MERGEOFFER` manifests, `PULLUP`
   replies and subscriber lists on a full push are unread.

## Relation to work in flight

- **4.158.0** (`REPLICATE_DELTA`, built, unreviewed, held by David until the bridge
  memory work is done). Deltas make most eager pushes one message long. Framing
  bounds the full pushes that remain. They do not conflict; 4.158.0 changes the same
  function and should be rebased onto this.
- **Item 3** (a cut-off host that makes itself root) is untouched.
- **REGION_ROLES** is untouched.
