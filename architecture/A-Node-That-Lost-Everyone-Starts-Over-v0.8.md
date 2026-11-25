# A node that lost everyone starts over

**v0.8 — 2026-11-25 — axona.bot, for council review.** Replaces v0.7 (`5c3de2d`).
Aster returned the note in scope (`d6a06d39`) with conditions on custody and on the
limit; this version takes them. v0.7 replaced v0.6 (`971e89e`),
on which Orion's concurrence carried (`76becce8`), with one part added on David's word.
Of the rule itself only a COUNT is built, on a branch and not merged: kernel
`3e0433b` logs a burst and resets nothing. v0.6 replaced v0.5 (`a80e832`) with two
figures on David's ruling. v0.5
replaced v0.4 (`46415e1`), on which Orion concurred (`392a10dc`), with one change
on David's ruling. v0.4 replaced v0.3 (`4c5548b`). Orion's addendum on v0.2 (`46d7da5f`, LSO2-1 to LSO2-3)
arrived after v0.3 was posted; two of its three items were already in v0.3, and this
version takes the third and its list. v0.3 itself replaced v0.2 (`b734e94`). Orion returned v0.1 in scope (`8924ca73`, LSO-1 to
LSO-3) while v0.2 was being written; this version answers that return. David's
rulings of the afternoon stand as v0.2 recorded them. Kernel read at tag
v4.159.0 (checkout `3655431`); axona-chat at 0.115.0 (`acd30a1`); the PoW collector
at the relay checkout it ran from. Evidence from the collector's log and David's
Chrome console, 2026-11-24.

## What changed from v0.7

Aster's return. I read the two kernel paths it names before writing this.

- **Hand off first, goodbye second.** A peer that hears the goodbye closes its
  channel to the leaver at once. v0.7 said the node "tells its peers it is leaving"
  and, elsewhere, "runs the kernel's leave hand-off before it closes", without an
  order between them. The kernel's own leave already puts the data first, and says
  why: on 2026-07-21, with the order reversed, 173 of 173 hand-offs came back to the
  leaver and reached nobody. Part 3 now states the order.
- **The goodbye cannot be forged, and the note now says how.** The existing
  peer-leaving notice names its subject from the authenticated transport, never
  from the payload. v0.7 asked Aster what stops a node saying goodbye for another.
  That is the answer, and it was already in the kernel.
- **An acknowledgement is not custody.** Today a hand-off counts as acknowledged
  unless the reply carries two counts and one is short. A reply with no counts is
  taken as good. The carried copy is now released only on a stricter receipt,
  spelled out in part 2.
- **One limit, and it follows the node.** v0.7 doubled the wait "each reset". A
  reset mints a new id, so a limit kept under the old id starts again at nothing.
  Part 5 now keeps one limit across all triggers and carries it over.

## What changed from v0.6

- **The application is told.** David, 2026-11-24: "We need an event for the
  application when the network is reset." Part 6 is new. v0.6 said only that the
  application "sees a gap in delivery and then the missing messages". It had no way
  to know why, or that the node it was is gone.

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
  each topic's new root, as a node merging in. Neither step keeps the role. The old
  role stays retired: the new node does not take it back because it holds the
  cache.
- **The carried copy is let go only on a receipt.** What the node carries is the
  bodies no successor has confirmed and the tombstones that cover them. It drops
  that copy for a topic only when a reply arrives that is bound to four things: the
  successor it meant, the id of this transfer, the topic's generation, and a
  manifest listing the bodies and the live tombstones. A reply that is short, that
  names another transfer or an older generation, or that never comes, leaves the
  copy where it is. The acknowledgement the kernel uses for a merge is bound in
  this way already and is the model.
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

The order is fixed: hand-off first, goodbye second. The goodbye is the kernel's
existing peer-leaving notice. A peer that receives it drops the leaver and closes
its channel at once, so anything sent after it has no road. The subject of that
notice is taken from the authenticated transport and not from what the notice says,
so a node can announce only its own departure.

After the hand-off, the node tells its peers it is leaving, on every channel still
open. A root that leaves with a notice is replaced at once: when the collector was
stopped at 19:12:16Z, a Windows relay logged `terminal-promote` for #council at
19:12:18Z. A node with no channel left has nobody to tell, and its peers find out
on their own clocks.

### 4. It writes down why, first

One log line before anything is torn down: which condition fired, how many channels
were open and how many closed in the window, the roles held, the old id. That line
is the only record of the state the reset destroys.

### 5. It does not flap

There is ONE limit for the node, whichever condition fired: a burst, a thin mesh or
a deaf subscription all draw on the same count. The limit belongs to the process
and not to the node id, so it is carried across the reset with the subscriptions;
a new id does not start with a clean record. Each reset doubles the wait before the
next, up to a ceiling, and the wait falls
back only after the new node has stayed above the floor for a period. A node on a
bad network becomes a quiet node, not a stream of new ids.

### 6. The application is told

A reset is not silent to the program above the node. The kernel raises an event the
application can listen for, twice.

- **Before.** `resetting`, raised after the log line of part 4 and before any
  channel is closed. It carries which condition fired, the counts from that line,
  the old node id and the time. An application that shows a status can say
  "reconnecting" from this moment and not from the first failed send.
- **After.** `reset`, raised when the new node has channels and has asked every
  topic for what it missed. It carries the old id, the NEW id, how long the node
  was away, how many topics were asked again, and how many pending sends were sent
  again. An application that shows its node id changes it here.
- **If it does not come back.** `reset-failed`, raised each time an attempt ends
  with no channels, carrying the attempt number and the wait before the next. A
  `resetting` with no `reset` after it is otherwise indistinguishable from a hang.

What the application must do on these events: nothing. Its subscriptions, its
handlers and its pending sends carry over by part 2. The events are for what only
the application knows: what to show a person, and what to re-check of its own.

What the events are NOT. They are not a request for permission; an application
cannot veto a reset. They are not the log line; a relay with no application above
it still writes part 4. And a handler that throws does not stop the reset.

The peer already has a general listener for kernel events and separate ones for a
peer joining and leaving. These three go through a listener of their own, so an
application does not have to filter the general stream to find them.

**The count can raise an event before the reset exists.** The log-only detector on
branch `3e0433b` knows the moment a reset WOULD fire. It can raise `loss-burst` to
the application at that moment, with the same counts. The chat app could then
start its own rebuild on a burst and not only on zero peers, which is the case the
collector fell through. That is a smaller change than the reset and does not wait
for it.

## What it costs

An application that shows a status now has three more states to show. A topic whose
root resets changes root. A reset node asks each topic for what it
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
2. **For Aster.** Answered in v0.8: the peer-leaving notice names its subject from
   the authenticated transport. Still open: the receipt in part 2 needs a transfer
   id and a manifest on the hand-off frames, which they do not carry today. Is a new
   field on HANDOFF and HANDOFFACK acceptable, or a new pair of frames?
3. **For Vega.** A relay under `ops/fleet.sh roll` is replaced on purpose. Does
   this rule fight the roll, and should a rolled relay be exempt by flag?
4. **For Orion.** Part 2 keeps messages and marks across a new identity. Which of
   the kernel's per-topic records are safe to carry over, and which are bound to the
   old id and must be dropped: the role, the upstream, the merge state, the
   subscriber list?
5. **For David.** The "too thin for too long" condition, which you have not ruled
   on: does it stay in, or are the burst and the deaf subscription the only
   triggers for now?
6. **For David.** Part 6. Is the event wanted now, raised by the burst count on
   `3e0433b` so the chat app can act on it, or only with the reset itself? And is
   one listener with three events right, or do you want one event carrying a phase?
7. **For Aster.** `reset` hands the application the old id and the new one
   together. A page script that reads both can link two node ids that the network
   otherwise cannot. Is that the application's own business, or a leak?

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
