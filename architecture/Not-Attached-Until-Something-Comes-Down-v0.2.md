# Not attached until something has come down

**v0.2 — 2026-11-24 — axona.bot, for council review.** Replaces v0.1 (`5d50d18`).
Part 4 is built on two branches and not merged: kernel `6551bb3`, relay `3bc0f62`.
Parts 1 to 3 are not built. Kernel read at tag v4.159.0 and at `6551bb3`. Evidence
from the relay logs of three hosts and David's Chrome console, 2026-11-24.

## What changed from v0.1

Orion's review (`76becce8`) corrected two things v0.1 said, and I read both in
source before changing them.

- **The renewals were already answered.** v0.1 said a pinned subscriber renewing on
  a quiet topic gets no answer. On this fleet it does. Topic Lifetime is on by
  default, so every renewal from a node that is not the root carries an attachment
  nonce, and a root with `ATTACH_ECHO` answers any renewal that carries one, with an
  empty frame when it has nothing new. All 48 relays carry `ATTACH_ECHO` and
  `RETURN_ROUTE`; v0.1 had re-read only three hosts.
- **So the sixty seconds was not it.** The answer is sent in the same step that
  records the way back. A breadcrumb cannot expire in that time. The answers to the
  deaf tab were sent and failed on the way down. v0.1 offered the equal constants as
  the likely reason; that reading is withdrawn.
- **A beacon is not proof.** v0.1 let part 1 count "a beacon it accepts". A beacon
  travels neighbour to neighbour and reaches a node whose own deliveries all fail.
  Part 1 now counts only a delivery addressed to this subscriber.
- David, the same afternoon: "Two minutes is a good place to start. We can modify it
  later." Question 4 is closed.

## The question

When does a subscriber know it is attached?

Today: when its SUBSCRIBE has travelled up and been consumed. On 2026-11-24 a
browser tab met that test for more than nine hours and received nothing. Its
subscribes went up. The relays' sends toward it are named as failed on 3,214 log
rows: 1,370 on Windows, 716 on M1, 1,128 on Linux. No relay held a channel to it.

The same day four relays merged the same client into themselves about once a
minute on four small topics. Each relay acknowledged the merge. The client never
stepped down. An acknowledgement is a message that has to travel down.

One fact, seen twice: **up worked and down did not, and nothing in the kernel asks
about down.**

## What this is NOT

It is NOT the reset note or the deaf-channel note. Those recover a node that is
already deaf. This is why it went deaf.

It is NOT shown end to end. The readings below are of source. No log line today
says where on the way down a reply to this subscriber was lost. The kernel counts
return routes used, delivered and fallen back, and until part 4 is deployed no log
prints them.

## What exists today

- **Attachment is judged upward.** `_unpinIfWaypointDead` drops an upstream only
  when the routed SUBSCRIBE comes back with a verdict of failed
  (`AxonaManager.js` 1777). A consumed SUBSCRIBE keeps the pin and slows the
  renewals, by half again each time, to one a minute.
- **There is a way back, and it is armed.** `RETURN_ROUTE` is set in `ops/fleet.sh`
  on the rows for Air, M1 and Linux, and in the Windows host's record. The droplets
  carry theirs in a file on each droplet; `ops/fleet.sh` records that they were armed
  on 2026-11-04, and I did not re-read those files today. A relay that consumes a SUBSCRIBE records the path it came by and sends its
  replies down the reverse of it (`_noteReturn`, `_returnFor`).
- **The way back lives sixty seconds, and that is as long as the gap between
  renewals.** `RETURN_ROUTE_TTL_MS` and `RENEW_MS` are both 60,000. This matters for
  a message published late in the gap. It does not matter for the answer to a
  renewal, which leaves at once.
- **A way back that fails once is thrown away.** One undelivered reply deletes the
  breadcrumb, and the reply goes "by the own lookup". For a node no relay holds a
  channel to, that lookup is the send that fails.
- **An answer is sent, by two options together.** With Topic Lifetime on, every
  renewal carries an attachment. With `ATTACH_ECHO` on, a root answers every renewal
  that carries one (`_accept`, `_replayTo`). Turn either off and a pinned subscriber
  on a quiet topic is not answered. Nothing on the subscriber waits for the answer.
- **Some senders have no way back recorded at all.** Orion names four; I have read
  two. A child handed a subscriber by its parent accepts it without ever having seen
  its subscribe, so it holds no breadcrumb for it. And a hop keeps the long path
  only where `RETURN_ROUTE` is set, which no browser sets, so a subscribe that
  crosses a browser late in a long path arrives with its origin cut off. The other
  two, a promoted backup and a relay that re-sends a subscribe as its own, are
  Orion's readings and not yet mine.
- **The merge rides the same road.** A merge offer is one of the requests whose
  reply goes by the return route. The relay's log shows the pull acknowledged and
  then expired, which is the state a merge is left in when the loser never
  completes.

## The proposal

Four parts. The first is the rule; the rest make the rule cheap to keep.

### 1. A pin needs proof from below

A subscriber keeps an upstream pinned only while deliveries arrive from it. For each
followed topic the subscriber counts renewals sent since it last accepted a delivery
addressed to it: a message, or the empty answer to a renewal. A beacon does not
count. Before it sends the next renewal it looks at the count. At two, the
subscriber treats the upstream as failed: unpin, renew fast, and re-home, the same
path a failed upward send takes today. Two full gaps have then passed: two minutes
on a settled topic.

### 2. Every renewal is answered

A root answers every renewal, with an empty frame when there is nothing new. Today
that holds only where two other options are both on. Part 1 must not depend on
them: the answer becomes part of this option. A root sends an empty answer to one
subscriber no more often than a floor allows, so a subscriber that renews in a
tight loop cannot make a root send in one.

### 3. The way back outlives the gap between renewals

The breadcrumb's life is a multiple of the renewal ceiling, not equal to it, so a
message published late in the gap still has a way down. A breadcrumb that fails is
still dropped, and the next renewal lays a new one. This part no longer explains
the deaf tab. It stays because the equality is a hole of its own.

### 4. The counters are written down

The relay's health dump prints the return-route counters the kernel already keeps:
recorded, used, delivered, fell back. Built on branches `6551bb3` and `3bc0f62`,
Orion ACCEPT. Orion names what the counts still do not show: a way back refused at
the first hop moves no counter, and expiry and eviction are not counted apart.

## What it costs

One answer for each renewal, where today a quiet topic sends none. A subscriber
that re-homes on two silent renewals will, on a slow path, re-home when it did not
need to. And a root keeps each breadcrumb longer, inside the cap it already has.

## What would show this is wrong

- A tab that is deaf with a live way back. If the counters, once printed, show
  replies delivered by return route to a subscriber that received nothing, the
  break is further down, at a hop that drops a frame it accepted.
- A re-home that lands in the same place. A tab with no channel to any relay may
  find every upstream reachable only by the same road. Part 1 then loops: unpin,
  re-home, silence. The bridge note's five peers and the reset note are what break
  that loop, not this one.
- A merge that still repeats. If every renewal is answered and the loser still
  never completes, the acknowledgement is failing for a reason of its own.
- Sixty seconds that was never the problem. This one has come true for the deaf
  tab. Part 3 is now argued on its own ground.

## Open questions

1. **For Orion.** The return route is recorded by the node that CONSUMES the
   subscribe. In a tree, is that the node that later sends the DELIVER, or can a
   delegated child be sending down a path it never recorded?
2. **For Aster.** Part 2 makes a root answer every renewal. What stops a subscriber
   using that to make a root send?
3. **For Vega.** Part 1 now counts only a delivery addressed to the subscriber.
   Is there a frame I have left out that proves this subscriber is fed?
4. **For Aster.** Orion proposes that a browser hop keep the long path for these
   requests, as it already does for a signal frame. That puts up to sixteen node ids
   in a frame crossing a browser. Is that acceptable?

## Relation to work in flight

- **Closer-Born v0.6** introduced the return route. This note changes its life and
  prints its counters. It does not change what it is.
- **The deaf-channel note** (v0.2, `4c5548b`) notices the same condition from the
  application. With part 1 here, the kernel notices first, and the app's rule
  becomes the check on the kernel's.
- **The reset note** (v0.6, `971e89e`) lists "deaf with peers" as a third trigger.
  Part 1 here is the narrow response to that condition; the reset is the wide one.
- **The bridge note** (v0.2, `648ff2b`). A node with five open channels to relays
  has a way down that does not depend on a breadcrumb at all.
