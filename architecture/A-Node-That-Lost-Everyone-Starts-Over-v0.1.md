# A node that lost everyone starts over

**v0.1 — 2026-11-24 — axona.bot, for council review. Nothing here is built.**
Written on David's word of 2026-11-24 ("Draft it please"). Kernel read at tag
v4.159.0 (checkout `3655431`); axona-chat at 0.115.0 (`acd30a1`); the PoW collector
at the relay checkout it ran from. Evidence from the collector's log and David's
Chrome console, 2026-11-24.

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

- **A burst.** Most of the node's open channels close inside a few seconds. This is
  the event itself, and it counts whatever is left afterwards. 54 of the collector's
  channels in two seconds is a burst; one closing a minute is not.
- **Thin for too long.** Fewer open channels than a floor, held for a period. The
  floor is a share of what the node had, or of what the bridge introduced, never a
  fixed number, so a three-node testnet does not reset for ever.
- **Deaf with peers.** A subscription that the network says is moving and that
  delivers nothing. The chat app's note states this one for an app; this is the same
  condition one layer down.

### 2. Starting over is all of it

- Close every channel. Drop every role. Build a new node identity. Join through the
  bridge as a newcomer. Subscribe again, asking for history.
- **The old id is not reused.** Peers that watched it vanish have set it aside, and
  a role it held should pass to the node that is now closest and connected.
- What the node was holding to SEND survives. A publish that was accepted and not
  yet delivered is sent again from the new node; a message id depends on the author
  and the bytes, so a second copy is the same message.

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

A topic whose root resets changes root. A reset node replays the history of every
topic it follows. And every reset leaves one more id in other nodes' tables until
they sweep it.

## What would show this is wrong

- A root that resets and takes the only copy of a topic with it. If a root's backups
  were all on the far side of the same outage, starting over loses what resuming
  would have kept. Nobody has counted how often a root and its backups share a host
  or a LAN.
- A burst that is not an outage. A relay roll closes many channels at once by
  design. If the rolled host's neighbours read that as their own burst, one roll
  resets the fleet.
- A floor that a healthy small node never reaches. Then the "thin" condition fires
  for ever, slowly, behind the backoff.
- A node that is deaf for a reason a new id does not change. The tab's third node
  worked and then went deaf; a fourth might have done the same.

## Open questions

1. **For Orion.** Which kernel paths already notice a burst of channel closes, and
   is there one place to hang this rule, or four?
2. **For Aster.** The goodbye in part 3: what stops a node from saying goodbye on
   another node's behalf?
3. **For Vega.** A relay under `ops/fleet.sh roll` is replaced on purpose. Does
   this rule fight the roll, and should a rolled relay be exempt by flag?
4. **For David.** Should a seat start over without its operator, given a seat that
   resets changes id in the middle of a review? And what share of its channels must
   a node lose, how fast, to call it a burst?

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
