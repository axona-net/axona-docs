# A bridge that is not the queue

**v0.1 — 2026-11-24 — axona.bot, for council review. Nothing here is built.**
Written on David's word of 2026-11-24 ("Let's construct the design note and get
council response"). Kernel read at tag v4.159.0 (checkout `3655431`); bridge read at
2.195.0 (`c166fc7`). Evidence from the testnet bridge B1's journal, 15:00Z to 15:48Z
on 2026-11-24.

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
default heap limit, and testnet has no relays, so every test node's lookups land on
the bridge's own mesh node. A production bridge hands a new node to relays.

It is NOT a finding about kernel 4.160.0. The clients declared 4.160.0 because they
were built from `main`; whether any option was set in them is not known.

It does NOT say which objects filled the heap. No dump was kept. The 7,305 failed
replies and the heap rose in the same ten minutes; that is a coincidence in time
until someone reads a heap.

And it is NOT a proposal to raise the heap limit. That moves the abort later.

## What exists today

- **The transport answers every request it is sent.** `transport/web/webrtc.js`
  `_handleRequest` awaits the handler and then replies. Nothing counts how many are
  in flight, per peer or in total.
- **The bridge has no way to say "not now".** It measures its own event-loop lag
  (`loop-stall`, `server.js`) and reports a saturated state on `/healthz`. Neither
  is consulted when a socket opens. From 15:30Z the journal shows 8
  `client-hello-grace` and 6 `client-hello-timeout`: it was too slow to greet.
- **Readiness is advice, and it counts the wrong thing.** `peer.ready()` resolves at
  4 table entries, or when the table stops growing for 1.5 s, or at 10 s. A table
  entry is not an open channel, the bridge is one of the entries, and an application
  that never calls it publishes at once. The client reconnects on a schedule
  (`bridge-reconnect-scheduled`) and knows nothing of why it was dropped.

## The proposal

Three parts. Each stands without the others and each is an option, off by default.

### 1. A node holds its own messages until it has peers beyond the bridge

David, 2026-11-24: "We should queue those within the node itself until it has a
minimal number of connections - perhaps five - beyond the bridge. Thus, the bridge
isn't the one managing the queue of these messages."

- A publish, subscribe, kill or pull made before the node holds N OPEN channels to
  nodes that are not a bridge waits in the node. N is five.
- Lookups and signalling are NOT held. The node needs them to get its five.
- The hold ends on a condition, never on a clock: N open channels, OR every node the
  bridge introduced has either opened or failed. A three-host testnet run releases
  at two.
- The queue has a ceiling in messages and in bytes. Past it the call fails back to
  the application with a named error. Nothing is dropped silently.
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

The bot's addition. Parts 1 and 2 live in well-behaved clients and at the door.
Neither covers an old client, a hostile one, or a relay.

- The transport counts requests in flight per peer and in total. Over either limit
  it answers "busy" at once, without running the handler.
- A request whose asker's channel has closed is abandoned where the handler can be
  told, and its answer is not built.

## What it costs

A node's first publish is later by the time it takes to open five channels. On
production that time is not measured for this note. A small network pays the wait
for its introductions to settle. And the door adds one round trip for every node
that meets a busy bridge.

## What would show this is wrong

- A heap read that shows the memory was NOT held by request work. Then part 3 is
  aimed at the wrong thing and the first job is that read.
- A bridge that stalls before it can refuse. David: "The bridge should always have
  enough cycles and head room to support a quick connect/disconnect while processing
  the nodes it has accepted." One thread runs both. If the loop is 65 seconds behind,
  as it was at 15:43:10Z, the refusal is 65 seconds late too. Part 2 holds only if
  "busy" trips long before that, which is a threshold nobody has measured.
- A node with five peers whose traffic still crosses the bridge's mesh node because
  that node is closest in the address space. Then part 1 moves less than it claims.

## Open questions

1. **For Orion.** Does routing ever choose a bridge's mesh node as a transit hop for
   a node that holds other open channels? If it does, is "a bridge is the last
   choice of hop" a fourth part or a different note?
2. **For Aster.** The ticket: is a keyed tag over node id and retry time enough, and
   what does a bridge that restarted do with tickets from its last life?
3. **For Vega.** Which calls are held in part 1? The list above is publish,
   subscribe, kill, pull. Is a subscribe safe to hold, given a held subscribe hides
   an empty topic from the application?
4. **For all.** How much of the 7,305 was application traffic and how much was
   lookup? The log line carries no request type. Without that split nobody can say
   what part 1 alone would have removed.
5. **For David.** Is five right for a browser tab, which opens channels more slowly
   than a relay? And does a refused node on a network with ONE bridge wait, or is
   that network told to run two?

## Relation to work in flight

- **"A bridge introduces only"** (David, 2026-10-30). Part 1 is that rule applied to
  the node's first seconds.
- **Wire-Frame-Bound v0.5** bounds a send queue per channel. Part 1's queue is a
  different queue, in front of it, and should share its ceiling vocabulary.
- **Connection-Headroom v0.2** keeps a slot free so a newcomer can be admitted. Part
  1 depends on a newcomer reaching five peers; a mesh with no free slots starves it.
- **axona-protocol#77**, "enormous memory usage". This morning has that shape. This
  note does not claim to be its cause.
