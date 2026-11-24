# A bridge that is not the queue

**v0.2 — 2026-11-24 — axona.bot, for council review. Nothing here is built.**
Replaces v0.1 (`e8e7c3a`), which Orion returned in scope (`c85915cf`, BNQ-1 to
BNQ-4). Kernel read at tag v4.159.0 (checkout `3655431`); bridge read at 2.195.0
(`c166fc7`). Evidence from the testnet bridge B1's journal, 15:00Z to 15:48Z on
2026-11-24.

## What changed from v0.1

- **There is a fourth part: a bridge is the last choice of hop** (Orion, BNQ-1).
  v0.1 asked whether routing uses a bridge's mesh node as a transit hop. It does. I
  read the routing file: it names the bridge's id in three places. None of them
  leaves the bridge out of a hop choice, and one picks it as a fallback.
- **Part 1 knows a bridge by what it is, not by which socket it came from** (BNQ-2).
  The transport's live-channel count includes the bridge's own channel, and the
  transport forgets the bridge's id when the socket graduates.
- **Part 1 never empties its queue into a bridge** (BNQ-2). v0.1's release rule did
  that when no other peer opened.
- **The 7,305 failed replies are now attributed by handler** (BNQ-3). Only one
  request handler waits before it replies. v0.1 left the split as an open question.
- **A new case under "What would show this is wrong"** (BNQ-3): a node floods the
  bridge while it is still connecting, before part 1 applies.
- **"Busy" has its own error code** (BNQ-4). Today any failed reply reads as the
  peer being unreachable.

## The question

Who holds the work when a node arrives with more to say than the network can take
from it?

On 2026-11-24 the answer was the bridge. The testnet bridge took 108 short-lived
connections in 48 minutes. Its heap in use read 30 MB at 15:29:51Z, 176 MB at
15:39:37Z and 251 MB at 15:43:10Z, with between 6 and 9 nodes connected. Node printed
"JavaScript heap out of memory" after two collections at 254 MB that took 13 seconds
each, and the process aborted at 15:48:22Z.

In the ten minutes from 15:30Z the bridge's own mesh node logged this 7,305 times:

```
axona:uplink:tx:reply-send-failed {"err":"mesh.send: peer … not open"}
```

A node had asked the bridge something. The bridge did the work. By the time the
answer was ready the node had gone.

## What this is NOT

It is NOT a production incident. That bridge is a 512 MB, one-CPU droplet on Node's
default heap limit, and testnet has no relays, so every test node's traffic lands on
the bridge's own mesh node.

It is NOT a finding about kernel 4.160.0. The clients declared 4.160.0 because they
were built from `main`; whether any option was set in them is not known.

It does NOT say which objects filled the heap. No dump was kept. The failed replies
and the heap rose in the same ten minutes; that is a coincidence in time until
someone reads a heap.

And it is NOT a proposal to raise the heap limit. That moves the abort later.

## What exists today

- **The transport answers every request it is sent.** `transport/web/webrtc.js`
  `_handleRequest` awaits the handler and then replies. Nothing counts how many are
  in flight, per peer or in total.
- **One handler waits, and it is the routed one.** The handlers for `lookup_walk`,
  `find_closest_set` and `lookahead_probe` contain no `await`: each replies in the
  turn the request arrived, while the channel is still open. `route_msg` contains
  four, across a two-hop search, a channel open and a downstream send. So a reply
  that finds its asker gone was, almost always, a routed message. The log line
  carries no request type, which is why this is an argument and not a count.
- **Routing treats the bridge's mesh node as any other peer.** The greedy next hop,
  the two-hop search and the K-closest walk filter nothing by bridge. A comment in
  `findKClosest` says the bridge "must never be returned as a topic's closest node";
  the code under it adds every table member. Orion's probe at 07:00Z walked
  `896f7c551318 → ff3241d4814c → 898962b7cd73 → 898bd7b40333`: the second node is a
  bridge.
- **The bridge has no way to say "not now".** It measures its own event-loop lag and
  reports a saturated state on `/healthz`. Neither is consulted when a socket opens.
  From 15:30Z the journal shows 8 `client-hello-grace` and 6 `client-hello-timeout`.
- **Readiness is advice, and it counts the wrong thing.** `peer.ready()` resolves at
  4 table entries, or when the table stops growing for 1.5 s, or at 10 s. The
  transport's live count, `meshBoundCount()`, is every bound channel including the
  bridge's.
- **Connecting is itself traffic.** `connect()` runs `peer.start()` and
  `peer.ready()` before it returns a peer to the application. A node's own
  integration sends lookups and relayed signalling through the bridge before any
  application call exists.
- **A refusal reads as a death.** `_handleResponse` turns any reply with `ok:false`
  into `TRANSPORT_PEER_UNREACHABLE`.

## The proposal

Four parts. Each stands without the others and each is an option, off by default.

### 1. A node holds its own messages until it has peers beyond the bridge

David, 2026-11-24: "We should queue those within the node itself until it has a
minimal number of connections - perhaps five - beyond the bridge. Thus, the bridge
isn't the one managing the queue of these messages."

- A publish, subscribe, kill or pull made before the node holds N OPEN channels to
  nodes that are not a bridge waits in the node. N is five.
- **A bridge is a node whose id is in the bridge region (top byte `0xff`) or that
  attests it never holds a role.** Not "the node my socket went to": a second
  bridge was never that, and the first stops being that when the socket graduates.
- Lookups and signalling are NOT held. The node needs them to get its five.
- The hold ends on a condition, never on a clock: N open non-bridge channels, OR
  every node the bridge introduced has opened or failed AND at least one non-bridge
  channel is open. A three-host testnet run releases at two.
- **With no non-bridge channel open, nothing is released.** The held calls stay held
  until a peer joins, or fail back to the caller at the queue's ceiling. They are
  never sent to a bridge, which refuses every role: the journal shows 975
  `role-refused` in those 23 minutes.
- The queue has a ceiling in messages and in bytes. Past it the call fails back to
  the application with a named error.
- A publish's promise resolves when the message is SENT, so a script that publishes
  and exits either waits or learns it did not publish.

### 2. A busy bridge refuses at the door and remembers who it refused

David, 2026-11-24: "if the bridge is busy, when a new node connects, the bridge can
tell it to try again in a few seconds, perhaps a random amount between 2 and 4 and
disconnect. The node then waits and tries again. It can tell the bridge that it has
already tried, so the bridge can prioritize it."

- "Busy" is read from event-loop lag, heap in use and requests in flight. NOT from
  the connection count, which read 9 while the heap died.
- A busy bridge answers the hello with a retry time drawn between 2 and 4 seconds
  and closes. A second refusal doubles the range.
- The refusal carries a ticket: the retry time and the node's id under the bridge's
  key. A node that returns with a valid ticket is admitted ahead of one without. A
  node that only SAYS it tried before gets nothing for saying so.
- A refused node tries the other bridge in the bridge directory first, and waits
  only if both refuse.

### 3. A node bounds the requests it has in flight

- The transport counts requests in flight per peer and in total. Over either limit
  it answers "busy" at once, without running the handler.
- **"Busy" is its own code, `TRANSPORT_PEER_BUSY`.** The caller skips that hop and
  picks another. It does NOT mark the peer dead, drop its table entry or close its
  channel.
- A request whose asker's channel has closed is abandoned where the handler can be
  told, and its answer is not built.
- `reply-send-failed` gains the request type and, for a routed message, the routed
  type. That one line would have settled what this note argues.

### 4. A bridge is the last choice of hop

Orion, BNQ-1. For a target that is not itself in the bridge region:

- The greedy next hop, the two-hop search's fan-out and the K-closest walk leave out
  every bridge while one usable non-bridge peer exists.
- With no non-bridge peer, the bridge is used. A node with only a bridge must still
  be able to look up its first peers.
- A target IN the bridge region, such as the bridge directory, routes as it does
  today.

## What it costs

A node's first publish is later by the time it takes to open five channels. On
production that time is not measured for this note. A small network pays the wait
for its introductions to settle. The door adds one round trip for every node that
meets a busy bridge. And part 4 removes a hop that is sometimes the shortest one.

## What would show this is wrong

- A heap read that shows the memory was NOT held by request work. Then part 3 is
  aimed at the wrong thing and the first job is that read.
- A bridge that stalls before it can refuse. David: "The bridge should always have
  enough cycles and head room to support a quick connect/disconnect while processing
  the nodes it has accepted." One thread runs both. If the loop is 65 seconds behind,
  as it was at 15:43:10Z, the refusal is 65 seconds late too. Part 2 holds only if
  "busy" trips long before that, which is a threshold nobody has measured.
- **A flood that is all connecting and no application.** A harness that calls
  `connect()` in a loop and exits sends integration lookups and relayed signalling
  and never reaches a publish. Part 1 holds nothing of that. Parts 2, 3 and 4 carry
  the whole of it. The journal's 2,479 `signal-relay` rows say some of the morning
  was this.
- A cross-region walk that needed the bridge as its only short path. Part 4 then
  lengthens or fails a route that works today. Nobody has counted how many such
  routes production carries.

## Open questions

1. **For Aster.** The ticket: is a keyed tag over node id and retry time enough, and
   what does a bridge that restarted do with tickets from its last life?
2. **For Vega.** Which calls are held in part 1? The list is publish, subscribe,
   kill, pull. Is a subscribe safe to hold, given a held subscribe hides an empty
   topic from the application?
3. **For Orion.** Part 4 as written leaves the bridge out "while one usable
   non-bridge peer exists". Is one enough, or does a node with a single weak peer
   then lose the lookups the bridge was answering?
4. **For David.** Is five right for a browser tab, which opens channels more slowly
   than a relay? And does a refused node on a network with ONE bridge wait, or is
   that network told to run two?

## Relation to work in flight

- **"A bridge introduces only"** (David, 2026-10-30). Parts 1 and 4 are that rule
  applied to the node's first seconds and to every hop after.
- **Wire-Frame-Bound v0.5** bounds a send queue per channel. Part 1's queue is a
  different queue, in front of it, and should share its ceiling vocabulary.
- **Connection-Headroom v0.2** keeps a slot free so a newcomer can be admitted. Part
  1 depends on a newcomer reaching five peers; a mesh with no free slots starves it.
- **axona-protocol#77**, "enormous memory usage". This morning has that shape. This
  note does not claim to be its cause.
