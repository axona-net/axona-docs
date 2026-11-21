# One size limit for everything the mesh carries, and a queue for each topic

**v0.5 — 2026-11-20 — axona.bot, for council review. Nothing here is built.**
Replaces v0.4 (`91c156f`). Vega (`6cfae056`) and Orion (`0bb0a942`) concurred on
v0.3. Aster returned v0.3 in scope (`cfa6ef42`), and returned one rule of v0.4
(`19409fc2`): how a root credits a backup in a fleet of mixed kernels. v0.5 changes
that rule in section 8 and adds its acceptance checks. Nothing else moved. Kernel read at tag v4.157.0 (`f348b7a`). Measurements
from testnet bridge B1 on the diagnostic 4.157.1 (`aece299`, `MESH_IO_DIAG=1`),
20:21Z 2026-11-20 to 00:07Z 2026-11-21.

## The questions

How big can one frame be when the mesh carries it?

And when frames arrive faster than a node can take them in, WHOSE frames wait and
whose are dropped?

v0.2 answered the first. It answered the second with one cap in bytes on one queue
shared by every topic. David, 2026-11-20: a queue per topic is "a safer, more
flexible and equitable design." v0.3 made that change. v0.4 keeps it and answers
a third question the review raised: when may a root say a backup HOLDS what it was
sent?

## What changed from v0.3

- **The weight moves from frame size to the send queue.** Orion measured the
  native library three ways. What a process keeps is the high-water mark of its
  send queue. The bound on that queue is the item that fixes the bridge. It is
  tested in the same testnet candidate as the framing, under its own switch.
- **A newer push no longer replaces an older one in the queue.** Aster: matching
  default cache limits do not prove a later push covers an earlier one. Removed
  from the first build. Section 7 says what proof would bring it back.
- **"Consumed" is not "applied."** Today a root credits a backup when the routed
  verdict says consumed, and the backup says consumed before it has ingested
  anything, and also when it has dropped the push. Section 8 is new: three
  outcomes, an ack per push, and what a multipart HANDOFF acknowledges.
- **A busy channel is not a closed channel.** Section 5 separates the two and
  gives replies headroom.
- **Bytes are bytes.** The ceiling is measured in UTF-8 bytes of the serialized
  frame. The receive queue's accounting is an estimate and is named as one.
- **Acceptance checks** are listed, one per decision.
- **v0.5: a verdict never counts as applied.** v0.4 let a root credit by verdict
  until a backup's first ack. That credits an incomplete first push from a backup
  that would have acked. Two levels of evidence now, kept apart from the first push.

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
Orion then measured the question v0.3 left open (council `0bb0a942`, same library,
a cold process for each run):

| run | send queue | memory after |
|---|---|---|
| 300 MB of 64 KiB frames in three bursts | held under 4 MB | flat, 83 MB |
| 300 MB of 16 KiB frames in three bursts | held under 4 MB | flat, 92–107 MB |
| 250 MB of 55 KiB frames in 5.6 s | no cap, reached 118 MB | +136 MB kept |

And one more: a 24.8 MB queue behind a channel whose far end closed. The queue
went to zero at once. Resident memory did not move. The library frees its queue to
the allocator and the allocator keeps it.

So frame size was the wrong suspect. A process keeps the HIGH-WATER MARK of its send
queues. 64 KiB frames are flat when the queue is bounded, and 55 KiB frames are not
when it is not. The kernel still starts at 16 KiB: with a 4 MB bound per channel a
16 KiB target lets 256 frames wait where a 247 KB frame lets sixteen, and it is the
size RFC 8831 recommends against head-of-line delay. The target is one constant, and
Orion's run says 32 to 48 KiB is already safe once the bound is on.

Both numbers are UTF-8 BYTES of the serialized frame as it leaves, routing fields
included. A JavaScript string's length counts 16-bit units and reads up to three
times low on non-Latin text. One function measures the frame, and WebRTC, the
WebSocket door and the simulator transport all call it.

A hop that negotiated a maximum below 64 KiB keeps its own smaller limit. `mesh.send`
refuses a frame over the channel's negotiated size, whatever the ceiling says.

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
change. Every frame of one push carries the same push number and `part: i, of: n`.

The subscriber list and the two leases ride the FIRST frame, and frames 2 to n OMIT
those three fields (Orion, WFB-1). The receiver reads an empty list as "no
subscribers" and a zero as "lease lapsed" (syncEngine.js:382, 401, 405), so a later
frame that carried either would wipe what the first frame installed. Tombstones are
cut across frames with the messages; a batch of them with proofs has no count cap
today and can pass 64 KiB without a single message beside it.

When the sender credits a replica is section 8.

**HANDOFF.** Same cut, with a transfer id and `part: i, of: n`. What the heir
acknowledges is section 8.

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
4 MB per channel) the send is refused.

**Busy is a third answer.** Today a send either left or failed, and a failure means
the channel is gone. A refused send on a full channel means neither. It returns
`busy`, and four things follow:

- `busy` does NOT count toward the channel's send-failure streak (`sendFailures`
  in mesh.js). A peer with a full queue is alive.
- `busy` does not remove the peer from routing or mark a waypoint dead.
- Whether the routed layer tries another candidate on `busy` is decided per kind
  of frame, below. A closed channel's retry rules are NOT inherited.
- The count of `busy` by frame type goes in the minute's `mesh-io` row.

| kind | on `busy` |
|---|---|
| request (a lookup step, a routed message awaiting a verdict) | the caller is told at once; it may try the next candidate, as it does on a timeout, without waiting for the timeout |
| reply (`res`) | sent with headroom, below; refused only above it, and then the requester times out as it would on loss |
| notification with a retry of its own (`REPLICATE`, `ROOTBEACON`, `DELIVER` replay) | dropped and counted; the periodic push or the subscriber's next renewal carries it |
| notification with an ack (`HANDOFF`, merge frames) | the sender's existing ack timer covers it; no new retry |

I have NOT read every caller. That read is the first step of the build, and each row
above is an acceptance check, including the case where the channel closes with
frames refused or still queued.

**Headroom for replies.** A reply to a request already in flight is small and its
loss costs a timeout elsewhere. Replies are admitted up to `SEND_QUEUE_MAX` plus
256 KiB. The headroom is counted in the same `bufferedAmount`; there is one number
per channel. Pings and pongs do not pass through `mesh.send` at all (mesh.js:1859
calls the channel directly), so the heartbeat is untouched.

Stage B below is what would replace this item.

### 6. A check at the door

`mesh.send` counts frames over the target by type, once a minute. A routed frame
over the ceiling is refused, for every type, measured in UTF-8 bytes. That refusal
is what a test pins. A builder packs with a cheap estimate and a margin; the door
measures exactly. A frame refused at the door is a builder's bug, and it is logged
as one.

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

- **Enqueue** takes the topic and a size beside the work it already takes. An
  entry goes to its topic's queue. The size is an ESTIMATE: the sum of the lengths
  of the message strings in the batch, plus a fixed allowance per tombstone and
  per subscriber (Orion's read: the handler is given the parsed payload and no wire
  length, AxonaPeer.js:1389). It is logged as `estBytes` and is never compared with
  the wire ceiling. It reads low by the escaping and by any non-Latin text. A cap of
  1 MiB does not need better.
- **The pump serves topics in turn, by bytes.** Each visit gives a topic one
  target frame's worth of credit, 16 KiB. It takes entries from that topic until
  the credit is spent, then moves to the next topic with work. A topic with one
  frame waiting is served within one round, however deep another topic's queue is.
  The 8 ms slice and the yield between slices stay as they are.
- **A cap per topic** (`INGEST_TOPIC_BYTES`, proposed 1 MiB). Over it, the
  ARRIVING entry for that topic is refused. No other topic loses anything. The
  handler then does not answer `consumed`, so the sender's routed verdict is a
  failure and it credits nothing. That uses machinery that exists.
- **A cap on the total** (`INGEST_TOTAL_BYTES`, proposed 16 MiB). Over it, entries
  are removed from the topic holding the MOST bytes until the total fits, in a loop,
  because one large arrival can displace several small entries. `REPLICATE` entries
  go before `REPLAYUP` and merge frames, which belong to a numbered exchange. An
  entry removed this way had already answered `consumed`; section 8 says how its
  sender learns.
- **No replacement in the first build.** v0.3 let a newer full push remove an
  older one still waiting. Orion argued root and backup hold the same window.
  Aster's answer holds against source: the window is a constructor option
  (`replayCacheSize`, `replayCacheBytes`, AxonaManager.js:119), so two nodes can
  differ, and what a cache keeps depends on its own arrival order, its own
  evictions and the retractions it holds. Queued pushes stay independent. To bring
  replacement back, a receiver would have to show, before discarding a queued
  part, that every message and every retraction in it is in the newer push or
  already applied. That is a comparison of id lists, and it is not designed here.
- **An older push does not overwrite a newer one's first frame.** The queue is
  first in, first out per topic, and frames can still arrive out of order over
  different routes. The receiver remembers the newest push number it has applied a
  first frame from, per topic and sender. A first frame from an OLDER push still
  has its messages ingested and its subscriber list and leases ignored (Orion,
  WFB-2, narrowed to what survives without replacement).
- **The fast path stays.** With every queue empty and nothing running, an arrival
  is ingested inline, as today.
- **The duty gate still sees every waiting peer.** `queuedDependencies()` is read
  by the gate that decides whether a peer may be let go (AxonaManager.js:1556). An
  entry names the peer it depends on. With many queues the node keeps one count per
  peer, raised at enqueue and lowered at dequeue, at refusal and at removal. A
  removed entry that left its peer counted would hold that peer forever; a test
  pins every exit. `_ingestIdle()` and `resetState()` read and clear the new
  queues and the counts (Orion, WFB-3).
- **The overflow line names its topic and its reason**: refused over the topic
  cap, or removed over the total. Then the next night's log answers what
  11-20's could not.

**Both caps are guesses.** 1 MiB is four of the largest pushes seen. 16 MiB is one
sixtieth of the testnet bridge's memory. Lyra's night with the new log line sets
them.

**What a test pins.** One topic delivers 10,000 frames. A second topic delivers
one. The second topic's frame is ingested within one round of the pump, and the
first topic's losses are all its own. On today's code the same test drops the
second topic's frame.

### 8. What counts as a replica updated

**What is there today.** `_onReplicate` puts the work on the queue and answers
`consumed` (wireHandlers.js:1163–1164). It answers the same when the queue was full
and the work was thrown away, because the enqueue returns nothing either way. The
root writes its durability ledger from that verdict. So on Lyra's night of 11-20,
about 100,000 queued entries were dropped, and every dropped `REPLICATE` among
them had already told its root it was held.
The 60-second re-push hides it most of the time. It is still a ledger that says
more than is true, and framing would have built "every frame consumed" on top of it.

**Three outcomes, named.**

- **Queued.** The routed verdict `consumed`. It means the frame reached the backup
  and was accepted to its queue. Nothing more.
- **Applied.** The backup ingested the part: verified, stored, role state updated.
- **Rejected.** Refused at arrival (no `consumed`; the sender sees a failed
  verdict), or removed from the queue later under the total cap.

**A replica update is complete** when the backup has APPLIED every part of one push.
The backup says so: one `REPLICATED { topicId, push, parts, held }` to the root
when the last distinct part of that push has been applied, where `held` is the
count of messages it now holds for the topic. Aster's ruling: a positive ack per
push. A notice only on rejection leaves silence meaning two things, applied and
lost.

**Two levels of evidence, never mixed.** The root's ledger records them in
separate fields for each backup and push:

- **Dispatched.** Every part's routed verdict was `consumed`. This is what the
  ledger records today under the name of a credit. It says the frames reached the
  backup's queue.
- **Applied.** A `REPLICATED` for that push number arrived from that backup with
  `parts` equal to what was sent.

A verdict NEVER raises a push to applied. Not for the first push, not for a backup
that has never acked, not while waiting. v0.4's rule, "credit by verdict until the
first ack," is withdrawn.

- A push with a part removed from the backup's queue is incomplete there. The
  backup sends nothing for it. The root holds it at dispatched. The next periodic
  push is the repair, as today. No new retry.
- An ack that never arrives, or arrives after a newer push to the same backup was
  sent, leaves its push at dispatched. A late ack is logged and credits nothing
  current.
- **Capable or not.** A backup is KNOWN capable once the root has had any
  `REPLICATED` from it, or, where the two are neighbours, once it has attested the
  capability on the channel (`CAP_ATTEST`, a new contract beside
  `write-flight-ack-v1`). A push to a known-capable backup that stays at
  dispatched is counted as `ack-overdue`. A push to any other backup that stays at
  dispatched is counted as `dispatched-only`. Neither is applied. The first count
  is a fault to look at; the second is an old kernel or a first ack not yet seen,
  and the ledger does not guess which.
- Whatever reads the ledger to decide a topic is safely replicated must say which
  level it requires. I have not read those readers. Until each is read, they see
  the dispatched field under its old name and behave as today, and the applied
  field is new information beside it.
- Cost: one frame of about 200 bytes per push per backup. A root with 3,000 topics
  and two backups each receives 100 a second at the 60-second cadence. That is
  volume on the path this note exists to relieve, and it is stated here so it is
  judged. 4.158.0's deltas are single-part pushes and are acked the same way.

**HANDOFF in parts.** The leaver must know the heir holds all of it before it lets
go. Each part carries the transfer id and `part: i, of: n`. The heir keeps the set
of DISTINCT parts it has applied for that transfer id. It sends one
`HANDOFFACK { xfer, parts, held, missing }`:

- when all n distinct parts are applied: `missing` empty, `held` counted across
  the whole transfer;
- when its wait for the transfer runs out with parts absent: `missing` lists them.

The leaver treats any ack with a non-empty `missing`, and any ack for a different
transfer id, as no ack. Its retry stays active (#402). A duplicate part is applied
once and counted once. Retractions ride in the part that carries them and are
applied with that part; a message whose retraction arrived in an EARLIER part must
still be refused when its body arrives in a later one, and a test pins that order
and the reverse.

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

Five switches, default off, each judged alone. Framing and the queue bound are
tested in the SAME testnet candidate, as Aster and Orion both ask.

1. `INGEST_PER_TOPIC=1`: section 7. Receivers only. Arms FIRST, on every node that
   will receive framed pushes, and runs a night under today's unframed load.
2. `REPLICA_ACK=1`: section 8's ack and crediting. Receivers send, roots credit.
3. `WIRE_FRAME=1`: the sender changes (REPLICATE, DELIVER, merge export) and the
   publish check at frame size.
4. `SEND_QUEUE_BOUND=1`: item 5.
5. HANDOFF parts arm last, once every node runs a kernel that reads them.

The beacon defaults flip in the same release as switch 3 (Vega's condition).

This work is separate from the production decision on the tagged 4.157.0. Aster asks
that the 4.157.0 decision follow B1's overnight readback; that is David's call.

## Acceptance checks

Each is a test that fails on today's code or on the change with one line removed.

1. **Ceiling.** A routed frame of 64 KiB plus one UTF-8 byte is refused at
   `mesh.send`, at the WebSocket door and in the simulator. A frame of 20,000
   three-byte characters is measured as 60,000 bytes.
2. **Negotiated limit.** On a channel that negotiated 32 KiB, a 40 KiB frame is
   refused.
3. **Builders.** A full cache of 1,024 messages leaves as frames none over the
   ceiling and none but a lone oversized message over the target; the union of the
   frames is the cache; frames 2 to n carry no `subs` and no lease fields.
4. **Tombstones.** 500 tombstones with proofs and no messages leave as several
   frames, each under the ceiling.
5. **Fair service.** One topic delivers 10,000 frames, a second delivers one. The
   second is applied within one round. Every refusal is the first topic's.
6. **Total cap.** With the total exceeded, removals come from the largest topic,
   REPLICATE before merge frames, in a loop until the total fits.
7. **Duty gate.** After enqueue, dequeue, refusal and removal, the per-peer count
   is what the queues hold. `_ingestIdle()` resolves and `resetState()` leaves no
   count behind.
8. **Older first frame.** A first frame of push 4 arriving after push 5's leaves
   push 5's subscriber list in place and still ingests its own messages.
9. **Credit.** A backup that refuses a push at arrival answers no `consumed`, and
   the push is not even dispatched. Four cases beside it, each on the FIRST push
   to that backup:
   - positive control: a capable backup applies every part and acks. Applied.
   - a capable backup has one part removed from its queue. No ack. Dispatched,
     never applied.
   - a capable backup applies every part and its ack is lost. Dispatched, never
     applied. On a second push after an earlier ack, the same loss counts as
     `ack-overdue`.
   - compatibility control: a backup on a kernel without the ack. Dispatched,
     counted `dispatched-only`, never applied, and the readers of the old field
     behave as today.
10. **HANDOFF.** All parts: one ack, `missing` empty. One part withheld: an ack
    with `missing`, and the leaver retries. A duplicated part: counted once. A
    retraction in part 1 and its body in part 2, and the reverse: the body is not
    held.
11. **Busy.** A send over the bound returns `busy`, raises no failure streak and
    evicts nobody. Each row of the table in item 5 behaves as written. A channel
    closed with refused and queued frames leaves no caller waiting past its own
    timer.
12. **Reply headroom.** With the queue at the bound, a reply is sent and a data
    frame is refused.
13. **On B1,** before and after: largest frame by type; send-queue high-water;
    resident memory and swap across a departure of nodes; `busy` and overflow
    counts by type and topic; restarts and out-of-memory kills.

## What would show this is wrong

- B1's memory still steps with every frame under 16 KiB. Then size was not the
  cause, and the suspect is burst rate through the native queue.
- With the queue bound on and frames unframed, B1 is flat. Then the bound alone
  was the fix and framing is a courtesy about delay. Orion's runs point this way.
- With the queue bound on, B1 still steps when nodes leave. Then some send path
  does not pass through `mesh.send`. Orion names the WebSocket door as unmeasured.
- Some receiver does read a REPLICATE as a complete snapshot. I read `_onReplicate`
  and the union ingest, not every policy hook in `_syncIngest`.
- The queue bound produces more undeliverable messages than the memory it saves is
  worth. One night with switch 4 on and off answers that.
- The ack per push costs more traffic than the false credits it removes are worth.
  A night's count of acks beside a night's count of refused and removed pushes
  answers that.
- With switch 1 on, Lyra's night drops as many entries as before and they are
  spread evenly over topics. Then the loss was total volume and never unfairness,
  and the per-topic queue bought only the log line.

## Open questions

1. **For Aster.** Is the capability rule enough: known capable by a prior ack or
   by attestation between neighbours, with no advertisement for a backup several
   hops away? Does anything in `_syncIngest`'s REPLICATE or
   HANDOFF policy read a payload as COMPLETE? Which other types can exceed the
   ceiling: `MERGEOFFER` manifests, `PULLUP` replies, the subscriber list on a full
   push?
2. **For Orion.** Does the WebSocket door queue the same way, and does it need the
   same bound? The 21:25Z step had sends through it that the instrument did not
   count.
3. **For Vega.** Is a precomputed serialized length per cache entry cheap enough on
   the publish path, given the door now measures exactly and the builder only
   estimates?
4. **For David.** May a routed envelope carry a label that lets a forwarding hop
   group frames by topic? Only stage C needs it, and stage C is not proposed.

## Relation to work in flight

- **4.158.0** (`REPLICATE_DELTA`, built, held by David until the bridge memory work
  is done). Deltas make most eager pushes one message. Framing bounds the full
  pushes that remain. 4.158.0 changes the same function and is rebased onto this.
  A delta is a single-part push and is acked as one.
- **Item 3** (a cut-off host that makes itself root) is untouched.
- **REGION_ROLES** is untouched.
- **Howard's long-run transport** is stages B and C plus each hop's own maximum.
  Stage B would replace item 5. Not proposed here.
