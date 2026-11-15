# A receipt at every hop, and removal on silence

Design note v0.4, 2026-11-15. Author: axona.bot, at David's word. Read against
kernel 4.147.0 (`d60ce3d`, branch `region-roles`). Nothing here is built.

v0.3 is one contract. v0.1 said silence calls `_peerDeath` and that duplicates
are safe everywhere. Both were wrong. Orion (council `5f1abc6e`) and Aster
(`62a92819`) showed why, and v0.2 left the corrections in an appendix beside
the errors. This version removes the errors.

## The question

When a node hands a message to a connected peer, does it know the peer took it?

Today it does not.

## What this is not

It is not a change to routing. The next hop is still the closest usable peer.

It is not end-to-end delivery. A receipt says one hop took the message.

It is not a heartbeat. The heartbeat asks an idle channel whether it is alive.
The receipt reads the answer off traffic the channel already carries.

It is not the lookahead answer filter (4.147.0) and not the beacon reader's
256-topic limit. Those are separate changes.

## What the kernel does now

Each line was read at `d60ce3d`.

The sender knows the channel reads open, and nothing more. A hard-stopped
host's channel went on reading open for about 10 s on testnet on 2026-11-14,
one host, one measurement series.

The reply a forwarder awaits is the whole remaining walk's result
(`AxonaPeer.js` `route_msg` handler). A dead hop and a slow walk look the same
until the request times out at 5,000 ms.

A failed send is not retried with `LOOKUP_RESELECT` off, which is the default.
With it on, a timeout is not among the errors that reselect.

A failed send removes nobody. The death body `_peerDeath` is reached by the
transport's peer-died event and by the no-channel sweep. `_peerDeath` is
bookkeeping: it clears table entries and writes the dead mark. It closes no
channel.

`getLatency` returns the constant 50 on the bridge and WebSocket transports
(`bridge.js:318`, `wstransport.js:439`). On the mesh it returns −1 until the
first heartbeat pong and one unsmoothed sample after.

A response is matched to its request by id alone. The WebSocket transport
knows which connection a response arrived on and does not pass it to
`_handleResponse` (`wstransport.js:451–491`).

## The rule

David, 2026-11-15:

1. The receiver sends a receipt the instant the message arrives.
2. No receipt after a short delay means the connection is dead.
3. A connection that is alive and slow is removed too. Slow is unhealthy.
4. The message is tried again without the failed node.
5. A duplicate is acceptable where the system handles it.

Rule 5 as David gave it was "duplicate is fine, the system handles that
properly". Review found three frame types where the system does not. They are
listed under Duplicates. The rule stands for every type that is guarded; a type
that is not guarded is not retried.

## The contract

### Two clocks, three outcomes

A request has three states: issued, accepted by the hop, answered.

The receipt moves it from issued to accepted. It starts nothing else. It does
not resolve the sender's promise. It does not discharge any duty the result
discharges: ingestion acknowledgement, merge, custody.

The result moves it from accepted to answered, on the existing clock.

No receipt by the deadline means the delivery is UNKNOWN. It is not proof the
message was not delivered. That is why retry needs the duplicate guards.

A result that arrives before its receipt counts as the receipt.

A result that is late after a receipt arrived is a slow WALK. It does not evict
the hop. Only a missing receipt does.

The sender can tell four failures apart: no receipt, route superseded,
admission refused, result timed out.

### What a receipt is bound to

A receipt is valid only for the peer it was expected from, the channel
generation the request was sent on, and the request id. A receipt on another
connection, from an older generation, or for an unknown id is ignored.

The existing response path matches on id alone. The receipt path must not copy
it. Whether that weakness matters for existing requests is a separate question
and is not settled here.

### Where the receipt is sent

By the receiving transport, on a request frame, after the frame is
authenticated and accepted into a bounded queue, and before the handler runs.

A receipt never elicits a receipt. A result never elicits a receipt.

Frames with no id today (notifications, auth, bootstrap) are outside the first
scope. They are not retried and not timed.

### Removal on silence

Silence retires the CHANNEL INSTANCE the request was sent on. It does not act
on whatever route the peer has now.

The order is: capture the failed instance and its generation when the request
is issued; on the deadline, close and unbind that instance through its
lifecycle owner; settle every timer that belonged to it; then report one death
for it. The existing death body runs from that report, as it does today.

Three consequences follow.

A deadline that belongs to an old socket does not close the WebRTC channel
that replaced it. `CompositeTransport.closeConnection` acts on the current
route (`composite.js:613`); the new path must not call it for an old instance.

Ten requests that expire together retire the instance once and write one dead
mark. They do not feed ten failures to the backoff schedule.

A one-peer node that loses its bridge this way must be able to reconnect.
Today `BridgeTransport.closeConnection` is empty and the node transport only
unbinds. The bridge socket's real close-and-reconnect path has to be driven,
and the test is that the node is back on the mesh, not that an entry left a
table.

### Retry

Retry lives in routing: the forwarder, the origin send, the lookup step. The
transport fails the send fast; routing picks another peer.

The hop that saw the silence puts the silent peer on the frame's exclusion set
and selects again. Path memory, exclusions and hop budget carry across the
retry. There is one overall deadline and one attempt budget for the operation.

A request to one named peer (`lookahead_probe`, `find_closest_set`) has no
other peer. It fails at the receipt deadline.

### Duplicates

A retry on another peer is a NEW hop request with a new id. A hop request id is
therefore not a duplicate key.

Guarded today by a message id or a seen-set: publish, kill, deliver, pull and
its response, pull-up, root beacon, topic-terminated.

Not guarded:

- the routed fallback of a direct send (`__tunneled_direct__`): no message id,
  the app's callback fires twice;
- a second `sdp-offer` of the same attempt on a live connection;
- a second merge header (`T.REPLAYUP`), which rewinds the merge cursor and
  asks for the header again.

Each needs a stable operation key or a handler that is idempotent. Until it has
one, that type is not retried. The registry of retry-enabled types is explicit
and is audited whole, not by example.

### The deadline

It is derived from a measured round trip on that channel. No such measurement
exists on two of three transports today.

Before any deadline is chosen the note needs: a real round trip on the bridge
and WebSocket transports; smoothing and a variance term on all three; a rule
for a channel too new to have a sample; the clock started when the frame
leaves the send queue, so local queueing is not charged to the peer; a test
that tells a stalled SENDER from a stalled receiver.

A deadline may rest only on samples THIS end timed. Step 1 (kernel 4.148.0)
keeps two kinds: `own`, and `reported`, the far end's figure carried to us. On
a mesh channel one end pings and the other answers; the answering end holds
reported samples and none of its own (`mesh.js:1756`; Orion `2eaa7286`). A peer
could then set the figure its own removal is judged by. Before step 4, the
answering end must time the channel itself.

A receipt does not escape a stalled event loop. The frame waits in the
receive buffer until the loop runs again, receipt and handler alike. On
testnet on 2026-11-15 the door channel to a one-core bridge read 76 to 331 ms
at rest and 12.8 to 25.4 s during a run, six channels, two runs, while the
bridge logged loop stalls of 2.1 to 8.5 s. The pong that produced those
figures is sent in the same synchronous turn a receipt would be. So a receipt
separates "accepted" from a slow WALK. It does not separate it from a stalled
PROCESS, and rule 3 removes that process's channels.

The multiple and the floor are David's, set from those measurements. This note
names no number.

### Old peers

A peer is held to the rule only on a channel where it has said it sends
receipts. The claim is made per authenticated channel, not once per node.

It cannot ride on the wire version: the mesh handshake does not exchange it,
and a major bump closes 4.131.0 peers outright.

It cannot be an unsigned field beside the existing proof. The auth transcript
signs proto, node id, public key and the channel binding
(`handshake-auth.js:77`). The claim goes in an authenticated exchange on the
channel or in a signed extension an old peer ignores.

A peer that makes no claim is treated exactly as today.

### Bounds

Pending receipts, their timers and their bytes are capped per channel. An
attempt budget bounds retries per operation. A receipt adds one frame to a
request and its result: two frames per hop become three. That is a count. Its
cost in CPU and latency is not measured, and has to be, under fan-out and
against the testnet bridge that stalls 7 to 13.6 s per run.

## Consequences David should see before building

A slow bridge is removed like any peer. During a stall every node holding it
drops it and must reconnect. The rule does not carve out the bridge; a bridge
is a node. Either that is accepted, or the bridge host is fixed first.

Removal is physical. A removed peer that is alive dials again. Whether it
waits out the dead-mark schedule or a shorter one is open.

## A cause this note does not fix

A dead member can stay in a table when two channels to one node were bound
under two ids and the death of the winning one is discarded as stale
(`composite.js:375–379`, counter `routeStats.deathStaleToken`; Orion). On
testnet on 2026-11-15 that counter read 0 on 24 hosts across eight runs. On
the 4.131.0 seat that named a dead host 5,038 times it is not read. The new
timer path must not reproduce it: a deadline for a superseded token is dropped
and counted, and is not acted on.

A node that never sends to a dead peer never misses a receipt from it. The
lookahead answer filter covers that case.

## Under David's rule of 2026-11-12

The receipt is evidence the sender lacks today. Acting on its absence is the
cause-level change. The retry recovers one message from a bad state. By the
rule that is a symptom fix, named here as one. It rides on the receipt and has
no timer of its own.

## Build order

Each step is its own review. None is started.

1. Round trip measured and smoothed on every transport.
2. The authenticated capability claim.
3. Guards on the three unguarded frame types, or their exemption.
4. Receipt, binding, and retirement of the failed instance, in the transport.
5. Retry in routing.

## Fence, when built

- A handler takes effect and its receipt is lost. The retry does not repeat
  the effect, for each stateful type.
- A duplicate same-attempt offer, a duplicate tunneled direct call, a duplicate
  merge header after a data page.
- A receipt from the wrong peer, from an old generation, and after the
  deadline. Each is ignored.
- A result before its receipt.
- An old socket's deadline after a replacement channel has bound. The
  replacement stays.
- Ten deadlines at once. One retirement, one dead mark.
- A prompt receipt and a slow walk. The hop is not removed.
- A node loses its only peer and is back on the mesh.
- A cold channel with no sample. A stalled sender.
- Retry budget spent. The operation ends.
- A peer that makes no claim is not timed and not removed.
- Remove the receipt check. The tests above fail.

## Decisions for David

1. The deadline's multiple and floor, after step 1 brings measurements.
2. The bridge: accept removal during a stall, or fix the bridge host first.
3. The three unguarded types: guard each, or exempt them from retry.
4. Whether a removed live peer waits the dead-mark schedule or a shorter one.
5. Whether step 1 starts now. It changes no behaviour and is needed either way.
