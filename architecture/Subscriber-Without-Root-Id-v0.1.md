# A subscriber that is never told which node is the root

**v0.1 — 2026-11-20 — axona.bot, for council review. Nothing here is built.**
Kernel read at tag v4.157.0 (`f348b7a`). Fault evidence from 39 production relay
logs and one seat, 02:50Z–03:32Z 2026-11-21.

## The question

Does a subscriber need to know the node id of the root it is served by?

David, 2026-11-20: "I suggest sending the actual root transport ID is a bad idea and
should be removed." His three reasons:

1. The id is an optimization. A subscribe aimed at the TOPIC should arrive as fast
   as one aimed at the node, and root beacons already cover the root's
   neighbourhood.
2. The id a subscriber holds may not be renewed properly, or at all.
3. Knowing the root's node id may let someone find the physical owner. This is the
   one that matters most.

A node id is the transport id. It is new each time a process starts. The author id
is the stable one and is not the subject here.

## What this is NOT

It does NOT make a root unfindable. The root of a topic is, by construction, the
live node whose id is closest to the topic id, and "who is closest to this id" is
the question the mesh exists to answer. Any participant can ask it. Removing the id
from frames stops TELLING every subscriber and stops them STORING it. It does not
stop a node that goes looking. Section "What would protect the owner" says what
would.

It is NOT a change to how roots find each other. Roots, backups and merging roots
must name one another. That traffic is between role holders.

It does NOT arm `SUB_TERMINAL_VERIFY`, which stays off on David's standing word. One
option below depends on it and says so.

## Where the id goes today

Read in source. Seven places put a root's or parent's node id in front of a node
that only subscribes or publishes.

| # | what | where | who receives it |
|---|---|---|---|
| 1 | `from` on every `DELIVER` | wireHandlers.js:1241–1252 stores it as the PIN (`_upstream`) | every subscriber; it names the PARENT, which is the root or a relay under it |
| 2 | `gen.root` on every `DELIVER` | the generation is `{ root, epoch }`; compared at wireHandlers.js:1207 | every subscriber in the tree, however many relays down; it names the ROOT itself |
| 3 | `delegate` on a handover `DELIVER` | wireHandlers.js:449, 529; read at :1213 | a subscriber being moved to a child relay; it names that relay |
| 4 | the root hint | `_rootHint_`, rootElection.js:270: a fresh beacon record, else the closest-node lookup, cached 60 s | any node that subscribes or publishes; computed locally |
| 5 | `via: [id]` on `SUB`, `PUB`, `KILL`, `TOUCH`, `PULL`, `METRICSON`, `UNSUB` | AxonaManager.js:1610, 1886, 1936, 1961, 2025, 2046 | every HOP the frame crosses reads the waypoint |
| 6 | `ROOTBEACON { root, topics, epochs }` | rootElection.js:55–86; re-forwarded `layer` times | the root's nearest neighbours and theirs, subscribers or not |
| 7 | discovery events and status rows | `_disc('sub-root')`, `_disc('pub-root')`, `term-verify`, `branch-reattach`; the seat status row `upstream` | the APP, and whatever it logs or shows |

Three more name a root between role holders, and are out of scope: `REPLICATE.from`,
the merge frames' winner and loser, and the write-flight ack route.

Not read: whether a signed delivery proof (ackProof.js) identifies the root by key.
If it does, that is an eighth place and the hardest to remove.

## What the pin is for

`_sendSubscribe` (AxonaManager.js:1609): a pinned subscriber renews every 60 seconds
"via the pin." It consults no hint and runs no lookup. The comment is exact: "Steady
state (pinned) is unchanged: no lookup, no hint — renew via the pin."

The pin does two jobs.

**Routing.** The renewal is sent through the pinned node.

**Selecting the parent.** Topic Lifetime accepts a fan-out `DELIVER` as moving the
attachment forward only when it comes "from the parent we currently select (the
pinned upstream)" (wireHandlers.js:1183–1207). And a root that hands a subscriber
down to a child relay does it by naming the child, which becomes the pin.

The second job is why the pin cannot simply be deleted. A tree of relays under a
root works by each subscriber knowing WHICH parent it sits under.

## Tonight's fault is reason 2, live

From 03:01Z 2026-11-21 two subscribers of #council heard nothing: my seat and
David's Chrome tab. His Firefox tab heard nothing until he reloaded it. Publishes
went through the whole time.

- The node both deaf subscribers were pinned to is the Windows relay service 07.
  It is alive.
- That relay has been ROOT for #council since 2026-11-19 18:06:22Z. A closer node
  has also been root. Every 45 seconds for two days the relay found the closer node
  and logged `root-verify-demote`: 2,666 times.
- The log line's name is wrong for this case. On a root that holds messages,
  `_rootVerifyCandidate` (rootElection.js:522) does not demote. It records a merge
  candidate and sends an offer (`_mergeCandidate`, AxonaManager.js:1185). The offer
  has not completed in two days. Why is not read.
- From 03:01:05Z the relay's routed sends to the closer node are logged as failed,
  every five seconds. That is the minute the subscribers went deaf.
- My seat renewed through its pin the whole time. The relay accepted every renewal.
  So the seat never asked again who the root was.

A subscribe aimed at the topic id would not have been held by the relay's
acceptance. Whether it would have reached the closer node is the measurement in
"What would show this is wrong."

## Has aiming at the topic been tried? Yes, and it lost messages

The source records it (AxonaManager.js:1576–1608). Kernel 4.64.0 dropped the root
hint from the subscribe path and sent subscribes bare toward the topic id, "on the
theory that the synaptome finds the current-best terminal on its own." Measured: on
a WARM mesh it did. On a COLD mesh the greedy walk stopped at a local minimum short
of the root, and a fresh subscriber's history replay fell to 25–55 percent against
100 percent established (GH #418, #397). The hint was restored.

So reason 1 holds on a warm mesh and failed on a cold one, measured. Any design that
removes the id from the subscriber has to put the correction somewhere else.

## The proposal

Move the knowledge from the subscriber into the mesh. The subscriber aims at the
topic. A node that receives a subscribe it should not seat passes it on toward the
node that should. The subscriber is never told who that was.

### 1. Subscribes, renewals and unsubscribes carry no waypoint

`SUB`, its renewal and `UNSUB` go toward the topic id with `via` empty, always. The
pin is not used for routing. Publishes, kills, touches and pulls likewise.

### 2. The correction happens where the walk ends

Two mechanisms already exist for this, and both run at the node where a subscribe
arrives, not at the subscriber:

- `_liveCloserRoot` and `_deferToRoot` (wireHandlers.js, in `_onSub`): a node with
  no role that knows a strictly closer live root forwards the subscribe to it.
- `_verifyTerminalOwnership` (AxonaManager.js): a node about to seat a subscribe
  first asks the iterative lookup whether it IS the closest, and forwards if
  it is not. This is `SUB_TERMINAL_VERIFY`. It is OFF on David's standing word.
  4.157.0 changes how that check judges whether the closer node can be reached and
  bounds a forward that comes back to its sender; it has run on testnet only.

The forward names the closer root in a waypoint. That waypoint is seen by the hops
between a stranded node and the root. Those are nodes in the root's own
neighbourhood, the same set the beacon already reaches. No subscriber sees it.

### 3. `DELIVER` stops naming nodes

- `from` goes. The receiver learns nothing from it that the proposal still uses.
- `gen.root` becomes an opaque generation tag. A subscriber only ever tests two
  generations for "same root, epoch not lower." A tag the root mints once per
  generation, a random value, with the epoch beside it, answers that test and names
  nobody. A hash of the root's id would NOT do: with a few hundred nodes on the
  mesh it is reversed by trying each of them.
- The selected parent is recognised by a token, not an id. A subscribe already
  carries an attempt nonce that the reply echoes (`attach`). The parent returns a
  seat token with the reply to that attempt, and stamps it on its fan-out. "From
  the parent we currently select" becomes "carries the seat token we hold."

### 4. Handover to a child relay without naming the child

Today the root sends `delegate: <child id>` and the subscriber re-aims at the
child. Without ids, the root forwards the subscriber's own subscribe to the child,
the child replies with a new seat token, and the subscriber's attachment moves when
that reply arrives. The subscriber sees a new token and a new sender on its channel
and is told no id.

For this to hold, a renewal aimed at the topic must reach the SAME child and not
climb to the root every 60 seconds. That needs a relay holding a seat to take a
renewal that passes through it. `_onSub` says a relaying node "still seats
subscribers below"; whether it does so for a frame merely passing through, I have
NOT read. This is the part most likely to change the design.

### 5. Hints stay local and stop travelling

A node may still compute who is closest to a topic. It does that from its own
routing table and is told nothing new. What changes is that the answer is no longer
written into `via` on a frame that crosses other nodes.

### 6. The app is told less

`sub-root`, `pub-root`, `term-verify` and `branch-reattach` stop carrying an id
prefix. The seat status row shows whether a topic is attached and for how long, not
to whom. Relay logs are a separate decision: the fault above was found by them.

## What would protect the owner

Reason 3 deserves a plain answer. With everything above built:

- A subscriber is no longer TOLD the root's id, and no longer stores it.
- A node that wants it runs a closest-node lookup on the topic id and has it.
- A node with a direct channel to the root sees the far end of that channel.

So the proposal removes the id from every passive reader and from every stored
record, and leaves it available to a node that looks. What would close the rest is a
different decision: which nodes may be a root at all. If a root is always a relay
and never a person's device, then the id that can be found is a relay's. The
same-region role rule (2026-11-13) and "a bridge never holds a role" (2026-11-12)
are decisions of that kind. Whether a browser or a phone may ever root a topic is
not answered here, and it is the question that decides how much reason 3 is worth.

## What it costs

- **One more hop for some renewals.** A renewal aimed at the topic that lands on a
  node short of the root is forwarded once. On a warm mesh the walk ends at the
  root and costs nothing extra.
- **Cold subscribes.** The 4.64.0 loss returns unless item 2 works on a cold mesh.
  That means the terminal check ARMED, which is David's separate word.
- **A wire change.** Old receivers read `from` and `gen.root`. New senders must
  keep sending them until no old receiver remains, which makes this a two-release
  change: read both first, then stop sending.
- **Diagnosis.** A subscriber that cannot say whom it follows is harder to debug.
  Tonight's first clue was the `upstream` field on a status row.

## Rollout

Three switches, default off.

1. `SUB_TO_TOPIC=1`: item 1 for subscribes and renewals only. No wire change. The
   pin is still recorded and still selects the parent; it is no longer a waypoint.
   This alone answers reason 2 and can be measured against tonight's fault.
2. `OPAQUE_ATTACH=1`: items 3 and 4. The wire change, read-both first.
3. Item 6 with the release that turns switch 2 on by default.

Testnet first, with Lyra's hosts, cold and warm.

## What would show this is wrong

- Cold subscribe with switch 1 on and the terminal check off replays under 100
  percent. Then switch 1 cannot ship without arming the check.
- With switch 1 on, a subscriber under a child relay re-attaches to the root on
  every renewal. Then the tree does not survive item 1 and item 4 must come first.
- In tonight's state, a subscribe aimed at #council from my seat still ends at the
  Windows relay and is seated there. Then the fault is the two roots and not the
  pin, and this note would not have prevented it.
- An opaque tag breaks a comparison I did not find. I read the `DELIVER` handler's
  attachment decision; I did not read every reader of `gen`.

## Open questions

1. **For David.** May a person's device root a topic? If roots are always relays,
   reason 3 is largely met by that rule and this note becomes mostly about reason 2.
2. **For David.** Is switch 1 alone, with no wire change, the first build?
3. **For Aster.** Topic Lifetime's attachment rules are yours. Does a seat token
   in place of the parent's id keep every fence in TL-B07, B11, B12 and B13?
4. **For Orion.** Does a relay holding a seat take a renewal that passes through
   it, or only one that ends at it?
5. **For Vega.** Does a delivery proof identify the root by key?

## Relation to work in flight

- **The #council fault** is live and is its own investigation. The two roots and
  the merge offer that never completes are not this note's subject.
- **4.157.0** carries the terminal-check changes item 2 leans on.
- **Wire-Frame-Bound v0.5** is untouched. Both notes change `DELIVER`; the second
  to be built rebases on the first.
- **Publisher location privacy** (the envelope discloses who, not where) is the
  same principle applied to publishers. This applies it to roots.
