# One size limit for everything the mesh carries, and a queue for each topic

**v0.3 — 2026-11-20 — axona.bot, for council review. Nothing here is built.**
Replaces v0.2 (`284061a`). Kernel read at tag v4.157.0 (`f348b7a`). Measurements
from testnet bridge B1 on the diagnostic 4.157.1 (`aece299`, `MESH_IO_DIAG=1`),
20:21Z 2026-11-20 to 00:07Z 2026-11-21.

## The questions

How big can one frame be when the mesh carries it?

And when frames arrive faster than a node can take them in, WHOSE frames wait and
whose are dropped?

v0.2 answered the first. It answered the second with one cap in bytes on one queue
shared by every topic. David, 2026-11-20: a queue per topic is "a safer, more
flexible and equitable design." v0.3 makes that change.

## What changed from v0.2

- The ingest queue is no longer one array with a cap moved from entries to bytes.
  It is ONE QUEUE PER TOPIC, served in turn, with a cap per topic and a cap on the
  total. This is section 7. It replaces the paragraph "the ingest queue is the
  catch."
- The per-topic queue gets its own switch and arms on receivers BEFORE the framing
  arms on senders.
- A new section lays out the two stages that would follow: a queue per topic on the
  SENDING side, and fairness between topics at nodes that only forward. Neither is
  proposed for build.
- Sections 1 to 6 are v0.2's, unchanged in substance.

## What this is NOT

It is NOT a fix for how MUCH the network sends. A root re-pushes its whole cache to
two backups every 60 seconds and on every publish. That is 4.158.0's subject.

It does NOT lower what an app may publish by default.

It does NOT build the sending-side queue. Howard's long-run transport is a
prioritized queue with chunking, backpressure and each hop's own maximum; his words
were "now is NOT the time to do that." Stages B and C below are that transport's
first two pieces, written down so the inbound queue is built to fit them. They wait.

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

**What the inbound queue did.** Lyra's night of 11-20 logged 508 `ingest-overflow`
warnings on her hosts, about 100,000 dropped entries. The log line carries a count.
It does not say which topic lost the entry, so how the loss was shared between busy
and quiet topics is NOT measured. The code says how it must have been shared; see
section 7.

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
credits a replica when EVERY frame was consumed. Every frame of one push carries the
same push number; section 7 uses it.

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
the callers above it degrade well is not something I have read. Stage B below is
what would replace it.

### 6. A check at the door

`mesh.send` counts frames over the target by type, once a minute. A routed frame
over the ceiling is refused, for every type. That refusal is what a test pins.

### 7. A queue for each topic on the way in

**What is there today.** One array per node (`_ingestEnqueue`, repairPlane.js:539).
Two callers put work on it: an arriving `REPLICATE` (wireHandlers.js:1163) and an
arriving `REPLAYUP` or merge frame (wireHandlers.js:987). `HANDOFF` does not use it.
A pump takes entries from the front in 8 ms slices (`INGEST_SLICE_MS`) so pings are
answered between slices. The cap is 4,096 entries (`INGEST_QUEUE_MAX`), whatever
their size and whatever their topic. Past the cap the ARRIVING entry is dropped.

So one topic in a storm fills the array, and the entry dropped next belongs to
whichever topic arrives next. A quiet topic's single push stands behind 4,096
entries of somebody else's, or is the one thrown away. The node cannot tell the two
topics apart. That is the unfairness, read from the code. Framing at 16 KiB makes
it about fifteen times worse, because a full push becomes fifteen entries.

**The change.** A map from topic to queue. Each queue knows its own bytes.

- **Enqueue** takes the topic and the frame's length beside the work it already
  takes. An entry goes to its topic's queue.
- **The pump serves topics in turn, by bytes.** Each visit gives a topic one
  target frame's worth of credit, 16 KiB. It takes entries from that topic until
  the credit is spent, then moves to the next topic with work. A topic with one
  frame waiting is served within one round, however deep another topic's queue is.
  The 8 ms slice and the yield between slices stay as they are.
- **A cap per topic** (`INGEST_TOPIC_BYTES`, proposed 1 MiB). Over it, that topic
  loses an entry. No other topic does.
- **A cap on the total** (`INGEST_TOTAL_BYTES`, proposed 16 MiB). Over it, the
  entry dropped comes from the topic holding the MOST bytes, not from the topic
  that happened to arrive.
- **A newer full push replaces an older one still waiting.** Two full `REPLICATE`
  pushes from the same root for the same topic are in the queue; the older is
  removed. This is where a storm's backlog goes: today each of them is verified and
  ingested in order, and most of that work installs what the next push installs
  again. The push number from section 3 is what says which frames belong together.
  Merge frames and `REPLAYUP` are never replaced. Neither are 4.158.0's deltas,
  each of which carries messages no later frame repeats.
- **The fast path stays.** With every queue empty and nothing running, an arrival
  is ingested inline, as today.
- **The duty gate still sees every waiting peer.** `queuedDependencies()` is read
  by the gate that decides whether a peer may be let go (AxonaManager.js:1556). An
  entry names the peer it depends on. With many queues the node keeps one count per
  peer, raised at enqueue and lowered at dequeue, at drop and at replacement. A
  dropped entry that left its peer counted would hold that peer forever; a test
  pins all four exits.
- **The overflow line names its topic and its reason**: over the topic cap, over
  the total, or replaced by a newer push. Then the next night's log answers what
  11-20's could not.

**Both caps are guesses.** 1 MiB is four of the largest pushes seen. 16 MiB is one
sixtieth of the testnet bridge's memory. Lyra's night with the new log line sets
them.

**What a test pins.** One topic delivers 10,000 frames. A second topic delivers
one. The second topic's frame is ingested within one round of the pump, and the
first topic's losses are all its own. On today's code the same test drops the
second topic's frame.

## What follows, and is not proposed here

The inbound queue protects a node from what others send it. It does nothing about
what the node itself sends, and nothing at a node that only passes frames along.
Those are two more stages. They are written here so stage A is built to fit them.

### Stage B. A queue for each topic on the way out, at the node that builds the frame

**What is there today.** Nothing of ours. Every routed send goes through one
function, `AxonaManager._route` (line 595; 18 message types, about 36 call sites),
then the routing layer, then `mesh.send`, and into the native library's queue for
that channel. That queue has no limit. At 23:14Z it held 38.6 MB.

**The shape.** Between `_route` and the channel, a queue per topic, served in turn
by bytes exactly as on the way in. The channel is fed only while its
`bufferedAmount` is under a low mark. Control traffic that belongs to no topic
(pings, lookups, acks) has its own queue and goes first.

**What it buys beyond item 5.** Item 5 refuses a send when the channel is full and
leaves the caller to cope. Stage B makes the builder WAIT. `_syncPush` does not
build its next frame until its topic's queue has room. A full push overtaken by a
newer one while it waits is never serialized at all. That is backpressure, and it
removes the cost at its source where item 5 only reports it.

**What makes it a larger job.**

- Four timers start when a frame is handed to `_route` and would run out while the
  frame waits: `HANDOFF_ACK_MAX_MS` (5 s), `INGEST_ACK_MS` (4 s), `MERGE_S_MAX_MS`
  (250 ms a frame), `ROOT_FWD_MS` (2 s). Each must start when the frame LEAVES the
  queue. That is a change at every one of their call sites.
- `_route` knows the topic and does not know the channel. `mesh.send` knows the
  channel and does not know the topic. Where the queue sits between them is the
  first design decision, and I have not read the routing layer closely enough to
  make it.
- Those call sites today assume a send either left or failed. A third answer, "wait",
  reaches all of them.

### Stage C. Fairness between topics at a node that only forwards

**What is there today.** A forwarding node takes a routed frame and sends it on
(`AxonaPeer` `route_msg` handler, line 1278 to 1472). First come, first sent. One
topic's storm through a hop delays every other topic through that hop.

**The shape.** The same queue per topic, at the forwarder.

**What stands in the way.** A forwarder would have to know which topic a frame
belongs to. Today the topic is inside the payload, which a forwarder has no reason
to read. Putting a topic label in the routed envelope tells every hop on the path
what topic a frame serves. The protocol's rule so far is that an envelope discloses
who published and not where they are; whether it may also disclose the topic to
every hop is David's decision before any of this is designed. A label that groups
frames without naming the topic is possible and unexamined.

## What it costs

A full cache at a 16 KiB target is about fifteen times the frames it is at 247 KB.
Bytes do not change. Each frame carries its own routed envelope, a few hundred bytes
to about 1 KB with a long path, so overhead is 2 to 6 percent.

The per-topic queue costs one map lookup per arrival and one count per waiting
peer. A node rooting 3,000 topics holds queues only for topics with work waiting;
an emptied queue is deleted.

More frames also means more routed sends per second through the same hops. Head-of-
line delay is what RFC 8831 warns of with LARGE messages; many small ones is the
case it recommends.

## Rollout

Four switches, default off, so each can be judged alone:

1. `INGEST_PER_TOPIC=1`: section 7. Receivers only. It arms FIRST, on every node
   that will receive framed pushes, and runs a night under today's unframed load.
2. `WIRE_FRAME=1`: the sender changes (REPLICATE, DELIVER, merge export) and the
   publish check at frame size. Old receivers read the result, and lose more of it
   than they do today if switch 1 is not on.
3. `SEND_QUEUE_BOUND=1`: item 5.
4. HANDOFF parts arm last, once every node runs a kernel that reads `part/of`.

The beacon defaults flip in the same release as switch 2.

Test order: testnet bridges and Lyra's hosts, with `MESH_IO_DIAG` on B1 before and
after. What decides it: largest frame by type; B1's memory across a departure of
nodes like 21:25Z and 23:14Z; and overflow drops by topic across one of Lyra's
nights.

## What would show this is wrong

- B1's memory still steps with every frame under 16 KiB. Then size was not the
  cause, and the suspect is burst rate through the native queue.
- Orion measures a 64 KB burst and memory holds. Then the target can rise and the
  frame count falls by four.
- Some receiver does read a REPLICATE as a complete snapshot. I read `_onReplicate`
  and the union ingest, not every policy hook in `_syncIngest`.
- The queue bound produces more undeliverable messages than the memory it saves is
  worth. One night with switch 3 on and off answers that.
- With switch 1 on, Lyra's night drops as many entries as before and they are
  spread evenly over topics. Then the loss was total volume and never unfairness,
  and the per-topic queue bought only the log line.
- An older full push holds something the newer one lacks that the receiver should
  have kept. Then replacing it loses data. A root's cache evicts; whether a backup
  is meant to outlive its root's eviction is the question.

## Open questions

1. **For Aster.** Does anything in `_syncIngest`'s REPLICATE or HANDOFF policy read
   a payload as COMPLETE? Is replacing an older queued full push with a newer one
   from the same root safe, given cache eviction at the root? And which other types
   can exceed the ceiling: `MERGEOFFER` manifests, `PULLUP` replies, the subscriber
   list on a full push?
2. **For Orion.** A 64 KB burst of 250 MB inside a minute, the 21:25Z shape. Does
   memory hold? Is a queue behind a closing channel freed at close, or held until
   the PeerConnection is destroyed? And for stage B: does `node-datachannel` 0.32.3
   deliver the buffered-amount-low event reliably enough to drive a sender?
3. **For Vega.** Is a precomputed serialized length per cache entry cheap enough on
   the publish path? Does the receive path have the frame's length to hand at the
   two enqueue sites, or does it need carrying down from `mesh`?
4. **For David.** Is 4 MB the queue bound, and should it ship with the framing or
   after the framing has run alone? May a routed envelope carry a label that lets a
   forwarding hop group frames by topic?

## Relation to work in flight

- **4.158.0** (`REPLICATE_DELTA`, built, held by David until the bridge memory work
  is done). Deltas make most eager pushes one message. Framing bounds the full
  pushes that remain. 4.158.0 changes the same function and is rebased onto this.
  Deltas are never replaced in the per-topic queue.
- **Item 3** (a cut-off host that makes itself root) is untouched.
- **REGION_ROLES** is untouched.
- **Howard's long-run transport** is stages B and C plus each hop's own maximum.
  Stage B would replace item 5. Not proposed here.
