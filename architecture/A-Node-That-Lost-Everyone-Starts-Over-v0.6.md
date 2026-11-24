# A node that lost everyone starts over

**v0.6 — 2026-11-24 — axona.bot, for council review. Nothing here is built.**
Replaces v0.5 (`a80e832`). Two figures, on David's ruling; no other change. v0.5
replaced v0.4 (`46415e1`), on which Orion concurred (`392a10dc`), with one change
on David's ruling. v0.4 replaced v0.3 (`4c5548b`). Orion's addendum on v0.2 (`46d7da5f`, LSO2-1 to LSO2-3)
arrived after v0.3 was posted; two of its three items were already in v0.3, and this
version takes the third and its list. v0.3 itself replaced v0.2 (`b734e94`). Orion returned v0.1 in scope (`8924ca73`, LSO-1 to
LSO-3) while v0.2 was being written; this version answers that return. David's
rulings of the afternoon stand as v0.2 recorded them. Kernel read at tag
v4.159.0 (checkout `3655431`); axona-chat at 0.115.0 (`acd30a1`); the PoW collector
at the relay checkout it ran from. Evidence from the collector's log and David's
Chrome console, 2026-11-24.

## What changed from v0.5

- **The burst window is ten seconds.** David: "burst window of ten seconds."
- **A reset asks from two minutes before its mark.** David: "last message asked is
  two minutes."

Both were open questions in v0.5. Both are now in the rule.

## What changed from v0.4

- **A burst has two conditions, and both must hold.** David, on Orion's LSO-3:
  "Orion is correct. Let's add the second condition." More than half the node's
  channels close in the window, AND fewer than three channels to nodes that are not
  a bridge remain open. v0.4 carried this as question 7. It is now part 1.

## What changed from v0.3

- **The list of what a reset keeps and what it clears is written out** (Orion, in
  answer to question 4). Every name on it is in `AxonaManager.js` at v4.159.0; I
  checked that each exists, not what each line of it does.
- **The gap at the mark has an answer that is not a full load** (LSO2-3). The node
  subscribes from a little BEFORE its mark and lets the record of delivered message
  ids drop the repeats.
- **One more figure corrected.** Orion gave the overlap as two minutes and named it
  as the kernel's clock tolerance. That constant is five minutes in the source.

## What changed from v0.2

- **There is one place to hang the rule** (LSO-1). Every lost peer already passes
  through `AxonaPeer._peerDeath`, from the transport's event and from the
  no-channel sweep. The burst is counted there, over channels to nodes that are not
  a bridge.
- **Why the collector sat on one channel is read.** `transport/web/index.js` re-dials
  the bridge only when the mesh is thin AND the bridge's own channel is not bound.
  With the bridge channel bound, a node with one channel never asks for more. Orion
  reads the collector's one connection as that bridge channel; the condition is in
  the source, the identification is Orion's.
- **A root that resets keeps what it holds and hands it on** (LSO-2). v0.2 dropped
  the role and said nothing of the role's cache. Part 2 now carries it.
- **The fear in "What would show this is wrong" is real, with a figure.** Orion
  counted root plus three backups; the source has two backups. The corrected figure
  is below.
- **A neighbour's roll must not read as a burst** (LSO-3). This touches David's "over
  50%" and is put to him as a question, not changed here.

## What changed from v0.1

- **A node resets without its operator.** David: "A node that is not connected is
  dead - basically useless, so a node can reset without its operator." That includes
  a seat. v0.1 asked.
- **A burst is more than half.** David: "If a node suffers a catastrophic loss in a
  very short time, over 50% of its connections, it should reset." v0.1 said "most".
- **A reset is not a restart.** David: "The reset needs to be done in a way that
  does not require a full load of its subscriptions - so this is not like a full
  restart." v0.1 had the node subscribe again "asking for history". Part 2 is
  rewritten: the node keeps what it holds and asks only for what it missed.
- **A regular reset is noted and left out.** David: "We need to consider a regular
  node reset anyway - at least once every 24 hours, but perhaps even more often -
  but we will worry about that later."

## The question

What should a node do after it has been cut off from everyone it knew?

David, 2026-11-24: "When a node gets disconnected like that, it might be best to
simply perform a full reset - start over including with a new transport ID, and once
back online resubscribe fresh."

Two nodes on one Mac answered that question differently on the same morning.

- **The collector resumed.** At 08:53:42Z it logged 54 connections closed in two
  seconds. At 08:53:44Z it opened one. It opened no other until 18:28:43Z. For nine
  hours and thirty-five minutes it went on being the root of #council, under the
  same id, with one channel.
- **The chat tab started over.** At 08:53:51Z, 08:55:28Z and 08:56:55Z it logged
  "wake after … suspend with 0 peers — rebuilding connection". Each rebuild made a
  new node with a new id and subscribed again. The third received #council for two
  hours and twenty-four minutes.

## What this is NOT

It is NOT a cure for what cut the Mac off. Nothing here says what happened at
08:53Z; the system's power log has no sleep or wake line for that hour.

It is NOT a fix for the tab's later silence. That node went deaf at 11:21Z with
peers present, and no rule about losing peers touches it. The companion note,
"A chat app that knows when a channel has gone deaf" (`4d0d831`), is about that.

**It is recovery: a restart, named as one.** A restart erases the state that would
explain the fault. Part 4 exists because of that.

## What exists today

- **Each program has its own copy of this rule, and each copy asks "do I have a
  peer?"** The chat app's tick treats one peer or more as healthy and rebuilds only
  on zero. The collector's watchdog reconnects after three checks, a minute, with no
  mesh connectivity. The collector had one peer two seconds after it lost 54, so its
  minute never started.
- **A rebuild already means a new id.** `connect()` creates a node identity each
  time it is called. Starting over with a fresh id is what the chat app does now.
- **A node that resumes keeps its roles.** The collector came back as #council's
  root. Nothing asked whether a root with one channel should still be the root.
- **The kernel's own re-dial is narrow.** A client whose bridge socket has graduated
  re-dials the bridge when its mesh thins below a floor. It does not reset the node.
- **The seats are unread.** A seat's operator has a reconnect tool. What a seat does
  by itself after a burst, I have not read.

## The proposal

One rule, in the kernel, so that a relay, a seat, a tab and a script all get it.
An option, off by default.

### 1. Three conditions call for starting over

- **A burst.** More than half of the node's open channels close inside ten
  seconds, AND fewer than three channels to nodes that are not a bridge are left
  open. Both must hold. A node that lost twenty peers when a host was rolled and
  still holds twenty-two has not lost everyone, and does not reset. The
  collector logged 54 channels closed in two seconds; one closing a minute is not a
  burst.
- **Thin for too long.** Fewer open channels than a floor, held for a period. The
  floor is a share of what the node had, or of what the bridge introduced, never a
  fixed number, so a three-node testnet does not reset for ever.
- **Deaf with peers.** A subscription that the network says is moving and that
  delivers nothing. The chat app's note states this one for an app; this is the same
  condition one layer down.

### 2. The node changes who it is and keeps what it knows

A reset replaces the node's place in the mesh. It does not empty the node.

- **What goes.** Every channel. Every role. The node id. The table of peers.
- **What stays.** The list of topics it follows and their handlers. The messages it
  has already received. For each topic, the time of the newest message it holds.
  What it was holding to SEND. **And the cache of every topic it rooted or backed
  up.** Those messages are signed by their authors and name no node, so a new node
  id does not spoil them.
- **How it comes back.** A new node identity. Through the bridge as a newcomer. Then
  one subscribe per topic that asks for messages NEWER than the mark it kept, not
  for the topic's history. The kernel already takes a subscribe with a time, and
  already keeps that mark per topic; a holder is meant never to pull again what it
  holds.
- **The old id is not reused.** Peers that watched it vanish have set it aside, and
  a role it held should pass to the node that is now closest and connected.
- **A root hands on before and after.** If a channel survives, the node runs the
  kernel's leave hand-off before it closes. Once back, it offers what it carried to
  each topic's new root, as a node merging in. Neither step keeps the role.
- A publish that was accepted and not yet delivered is sent again from the new node.
  A message id depends on the author and the bytes, so a second copy is the same
  message.

- **It asks from two minutes before the mark.** The subscribe names a time two
  minutes earlier than the mark. The node kept the ids of the messages it delivered, so a
  message it already has is dropped before the application sees it. A message that
  was published just before the cut and never arrived is inside those two minutes and is
  recovered. Two minutes of one topic, never its history.

The application above the node sees a gap in delivery and then the missing messages.
It does not see its history arrive a second time.

**What is kept, by name.** The subscriptions and their handlers and options, with
their renewal timers reset so they renew at once under the new id. The hosted
topics and the metrics requests. The delivered-id record and the per-topic marks.
The publishes and kills still waiting to be observed, with their routes cleared.
And the carried cache: the signed messages and the tombstones that cover them, from
every role the node gave up without an acknowledged hand-off.

**What is cleared, by name.** Every role, retired through the kernel's own
retirement so a suspended check wakes to a retired role. The backup topics. The
attachment records, so the new id mints a new one. The upstream, the root hint, the
unattached clock, the lookups in flight. The step-down holds, the forwards, the
beacons seen. The pulls outstanding, which named the old id as the asker.

### 3. It says goodbye when it can

Before it closes, the node tells its peers it is leaving, on every channel still
open. A root that leaves with a notice is replaced at once: when the collector was
stopped at 19:12:16Z, a Windows relay logged `terminal-promote` for #council at
19:12:18Z. A node with no channel left has nobody to tell, and its peers find out
on their own clocks.

### 4. It writes down why, first

One log line before anything is torn down: which condition fired, how many channels
were open and how many closed in the window, the roles held, the old id. That line
is the only record of the state the reset destroys.

### 5. It does not flap

Each reset doubles the wait before the next, up to a ceiling, and the wait falls
back only after the new node has stayed above the floor for a period. A node on a
bad network becomes a quiet node, not a stream of new ids.

## What it costs

A topic whose root resets changes root. A reset node asks each topic for what it
missed, which is small when the outage was short. And every reset leaves one more
id in other nodes' tables until they sweep it.

## What would show this is wrong

- A root that resets and takes the only copy of a topic with it. This is real. 39 of
  the 48 relays, and the seats, are on one LAN. A topic has a root and two backups.
  If placement were even, a little over half of topics, 0.54, would have all three
  on that LAN; placement follows the address space and is not even, so the figure
  is a size and not a count. Part 2's carried cache is the answer: the copy
  survives in the node that resets.
- A roll that leaves a node under the floor. The second condition keeps a
  neighbour's roll from reading as a burst when the neighbour still holds three
  channels. A node whose peers were nearly all on the rolled host is left with fewer
  than three, and resets. That is correct for that node and it is still a reset
  caused by a roll; nobody has counted how many nodes are so placed.
- A floor that a healthy small node never reaches. Then the "thin" condition fires
  for ever, slowly, behind the backoff.
- A hole older than two minutes. A node that received message 9 and never message 8
  holds a mark at 9. If 8 was published inside the two minutes before the mark, the
  reset finds it. If 8 was missed an hour earlier, the reset does not, and nothing in
  this note does. Only asking for history would, and that is the full load David
  ruled out. The deaf-channel note is where an old hole is noticed.
- A node that is deaf for a reason a new id does not change. The tab's third node
  worked and then went deaf; a fourth might have done the same.

## Open questions

1. **For Orion.** Which kernel paths already notice a burst of channel closes, and
   is there one place to hang this rule, or four?
2. **For Aster.** The goodbye in part 3: what stops a node from saying goodbye on
   another node's behalf?
3. **For Vega.** A relay under `ops/fleet.sh roll` is replaced on purpose. Does
   this rule fight the roll, and should a rolled relay be exempt by flag?
4. **For Orion.** Part 2 keeps messages and marks across a new identity. Which of
   the kernel's per-topic records are safe to carry over, and which are bound to the
   old id and must be dropped: the role, the upstream, the merge state, the
   subscriber list?
5. **For David.** The "too thin for too long" condition, which you have not ruled
   on: does it stay in, or are the burst and the deaf subscription the only
   triggers for now?

## Relation to work in flight

- **"A chat app that knows when a channel has gone deaf"** v0.1 (`4d0d831`). Its
  part 3 is this note's third condition, built in the app first.
- **"A bridge that is not the queue"** v0.2 (`648ff2b`). A node that starts over is
  a newcomer at the bridge's door. A burst that resets many nodes at once is the
  crowd that note's busy door is for.
- **Connection-Headroom v0.2.** A newcomer needs a slot. A mesh with none makes
  every reset a slow one.
- **The release procedure.** A node that resets picks up nothing new; it runs the
  kernel it started with. Long-lived nodes still need a row in the inventory.
- **A regular reset**, at least once a day, is David's and is not in this note. If it
  is built on this rule it inherits part 2, and a daily reset that reloaded every
  subscription would be the full load he ruled out.
