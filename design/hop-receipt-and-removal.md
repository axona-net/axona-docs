# A receipt at every hop, and removal on silence

Design note v0.2, 2026-11-15. Author: axona.bot, at David's word. Read against
kernel 4.146.0 (`fab49d2`, branch `region-roles`). Nothing here is built.

## The question

When a node hands a message to a connected peer, does it know the peer took it?

Today it does not. This note says what the kernel does now, states the rule
David set on 2026-11-15, and lists what the rule needs before anyone builds it.

## What this is not

It is not a change to routing. The next hop is still the closest usable peer.

It is not end-to-end delivery. A receipt says one hop took the message. It says
nothing about the hops after it.

It is not a heartbeat. The heartbeat asks an idle channel whether it is alive.
The receipt reads the answer off traffic the channel is already carrying.

## What the kernel does now

Four facts, each from the `route_msg` handler in `src/dht/AxonaPeer.js`.

The sender knows the channel reads open, and nothing more. The forwarder
picks its hop from `_usablePeers`, which tests `isConnected`. A hard-stopped
host's channel went on reading open for about 10 s on testnet on 2026-11-14,
one host, one measurement series.

The reply is the whole walk's result. The forwarder awaits
`transport.send(nextHop, 'route_msg', …)` (line 1450). What comes back is
`downstream`: consumed, terminal or exhausted, for every hop after this one.
A hop that is dead and a hop that is alive and waiting on its own next hop
look the same until the request times out. The transports set that timeout at
5,000 ms (`DEFAULT_REQUEST_TIMEOUT_MS`); the walk I measured hung 10,175 ms.

A failed send is not retried. With `LOOKUP_RESELECT` off, which is the
default and the state of testnet and production, the hop returns
`exhausted` (line 1482). With it on, the hop takes the next closest live peer,
and only for an error whose text names a lost channel (`isEdgeLoss`, line 202).
The pattern has no word for a timeout.

A failed send removes nobody. Removal has one body, `_peerDeath` (line
2699). Two things call it: the transport's peer-died event and the no-channel
sweep of 4.132.0. A missed reply is not one of them.

So a node can send into a dead peer, wait seconds, give up, and keep the peer
in its table to be chosen again, and to be named to others.

## Why it matters now

On testnet on 2026-11-14 and 11-15, three of ten runs on this stack had topics
miss their closest host. In each, the topics that missed their closest host were exactly the topics
XOR-closer to one dead host id: 132 of 263 in run RM1, 298 of 576 in RL3,
133 of 285 in RJ1. Some live node still named that host. Which node is not
known; the one control run did not reproduce it.

The `lookahead_probe` handler (line 1032) answers from `node.synaptome` with no
test on the node it names. A table that sheds dead peers fast gives that
handler less to get wrong.

## The rule

David, 2026-11-15:

1. The receiving node sends a receipt the instant the message arrives, before
   it does anything else with it.
2. The sender sees that receipt almost at once, or after a short delay treats
   the connection as dead.
3. A connection that is alive and slow is removed too. Slow is unhealthy.
4. The message is marked unsent and tried again without the failed node.
5. A duplicate that results is acceptable. The system already handles it.

## What the rule needs

### A receipt that is not the walk's result

The receipt is its own frame,
sent by the receiving transport on arrival and before the handler runs. The
walk's result keeps travelling back as it does today. Two answers, two clocks:
a short one for "I have it", the existing one for "here is what happened".

### One removal path

Silence calls `_peerDeath(peer, 'no-receipt')`. That body
already clears the table entry, the incoming entry and the connection, writes
the dead mark, purges the peer's root beacons and schedules a refill. No second
body.

### Retry at the hop that saw the silence

The hop puts the silent peer on the
frame's exclusion set and selects again from its usable peers, as the reselect
code does for a lost channel. If nothing closer is left, the hop is the
terminal or reports exhausted, as now.

### The deadline is derived, not chosen

It must sit above the round trip of a
healthy channel and far below the 5,000 ms request timeout. The project's own
bar is 30 ms in-region. A receipt deadline is a small multiple of the measured
round trip on that channel, with a floor. The multiple and the floor are
David's to set from the RTT matrix; this note names no number because none has
been measured for this purpose.

## Consequences to decide before building

### A slow bridge is removed like any peer

The testnet bridge on one core
logs event-loop stalls of 7 to 13.6 s in every host run. Under rule 3 every
node holding it drops it during a stall. A node whose only peer is the bridge
is then alone. Either that is accepted and the node re-enters by its bridge
socket, or the bridge host is fixed first. The rule should not carve out the
bridge; a bridge is a node.

### A mixed fleet

A 4.131.0 peer sends no receipt. A node that enforced the
rule against it would remove every old peer on first use. The rule must apply
only to a peer that has said it sends receipts, by wire version or a
capability bit, until the fleet is whole.

### Coming back

A removed peer that is alive will dial again. The dead mark
has a schedule (`DeadPeers.fail`). Whether a no-receipt removal uses that
schedule or a shorter one is open.

### Which frames

`route_msg` forwards are the case measured. The same
transport carries `lookahead_probe`, `find_closest_set`, signals and direct
deliveries. A receipt at the transport covers all of them at once. That is
the simpler build and the wider change.

### Cost

One small frame per message per hop. On a publish that fans to n
subscribers that is n receipts at the root. Not measured.

### Duplicates

Accepted by rule 5. A hop that took the message and whose
receipt was lost forwards it; the retry forwards it again by another peer.
Publishes carry a msgId and are deduplicated. A reviewer should name any
routed frame type that is not idempotent.

## What it does not fix

A node that never sends to the dead peer never misses a receipt from it. That
node keeps the entry until the transport or the sweep removes it, and its
`lookahead_probe` answer can still name it. The answer path needs its own
liveness test. That is a separate, smaller change and should be reviewed on
its own.

It does not explain why 289 two-root topics stood unmerged. That is the
beacon reader's 256-topic limit (`rootElection.js:83`) and the gate at line
109.

## Under David's rule of 2026-11-12

The receipt is evidence the sender lacks today. Acting on its absence is the
cause-level change. The retry recovers one message from a bad state. By the
rule that is a symptom fix, named here as one. It rides on the receipt and has
no timer of its own.

## Fence, when built

- Hold the receipt on a live peer past the deadline. The sender removes it and
  the message arrives by another peer.
- Hard-stop a peer mid-walk. Time from send to removal is the deadline, not
  5,000 ms.
- A peer that sends no receipts and has not claimed to is NOT removed.
- A node with one peer loses it. Assert what the node does next.
- Remove the receipt check. Each test above fails.

## What review found (v0.2)

Orion read v0.1 against the transports on 2026-11-15 (council `5f1abc6e`). Four
findings change what must be built first. I checked the sites marked "read"
against `d60ce3d` myself; the others are his reading.

### Removal on silence must close the channel

`_peerDeath` closes nothing. Its two callers today run after the channel is
already gone. Called on an open channel it leaves the peer bound. On WebRTC the
reconcile pass puts the peer back in the table within a tick while its dead
mark stays. On the bridge link `closeConnection` is empty (`bridge.js:230`,
read), so a one-peer node that marks its bridge dead during a stall keeps the
socket, never reconnects, and holds the mark for the life of the process. The
WebSocket transport unbinds and does not close (`wstransport.js:346`, read).

So "one removal path" in v0.1 was wrong as written. Silence must tear down the
physical channel, and the death body then runs as it does now.

### There is no measured round trip to derive from

`getLatency` returns the constant 50 on the bridge and WebSocket transports
(`bridge.js:318`, `wstransport.js:439`, both read). On the mesh it returns −1
until the first heartbeat pong at 2,000 ms and one unsmoothed sample after.
A deadline derived from round trip needs a real, smoothed measurement on every
transport and a rule for a channel too new to have one.

### The gate for old peers is a capability claim

A wire-version bump closes 4.131.0 peers outright, and the mesh handshake does
not exchange the wire version. The claim has to be additive, in the mesh hello
and in the socket hello. This settles decision 4 unless David says otherwise.

### Three routed frames are not safe to deliver twice

Rule 5 holds for publishes, kills, deliveries, pulls and beacons. Orion names
three frames it does not hold for:

- the routed fallback of a direct send (`__tunneled_direct__`): no message id,
  delivered twice to the app;
- a second `sdp-offer` of the same attempt on a live connection;
- a second merge header (`T.REPLAYUP`), which rewinds the merge cursor.

Each needs its own guard, or an exemption from retry, before the retry is
built.

### Where it lives

Receipt, channel teardown and a fast failed send belong in the transport, on
every request frame. Choosing another peer stays in routing. A request to one
named peer (`lookahead_probe`, `find_closest_set`) has no other peer to try; it
fails at the receipt deadline in place of 5,000 ms. Cost by his count: a
request today is two frames per hop and becomes three.

### A cause this note did not know

Orion names why a dead member can stay in a table: two channels to one node
bound under two ids, the second wins, and the death of the second is discarded
as stale (`composite.js:375–379`; the counter `routeStats.deathStaleToken` is
there, read). On testnet at 06:15Z on 2026-11-15 my 4.131.0 seat named a host
36 s after its hard stop, 5,038 times. Whether that counter moved on the seat
is not read. If it did, that defect is a cause in its own right and is not
fixed by a receipt.

## Build order this implies

1. Round trip measured and smoothed on every transport.
2. The capability claim.
3. Guards on the three frames.
4. Receipt and teardown in the transport.
5. Retry in routing.

Each is a separate review. None is started.

## Decisions for David

1. The deadline: the multiple of measured round trip, and the floor.
2. Transport-wide, or `route_msg` only.
3. The bridge: accept removal during a stall, or fix the bridge host first.
4. The gate for old peers: a capability claim, per review, unless you say otherwise.
5. Whether the answer-path liveness test is built with this or before it.
