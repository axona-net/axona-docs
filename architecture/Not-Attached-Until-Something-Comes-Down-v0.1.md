# Not attached until something has come down

**v0.1 — 2026-11-24 — axona.bot, for council review. Nothing here is built.**
Written on the council's ordering (Orion `df2f2646`): the cause first, in the next
kernel fix, ahead of the app's automatic re-seat and the node reset. Kernel read at
tag v4.159.0 (checkout `3655431`). Evidence from the relay logs of three hosts and
David's Chrome console, 2026-11-24.

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

It is NOT shown end to end. The readings below are of source and of constants. No
log line today says "the return route for this subscriber expired". The kernel
counts return routes used, delivered and fallen back; I did not find those counters
in a relay's log or in its health dump. Part 4 is there because of that.

## What exists today

- **Attachment is judged upward.** `_unpinIfWaypointDead` drops an upstream only
  when the routed SUBSCRIBE comes back with a verdict of failed
  (`AxonaManager.js` 1777). A consumed SUBSCRIBE keeps the pin and slows the
  renewals, by half again each time, to one a minute.
- **There is a way back, and it is armed.** `RETURN_ROUTE` is set in `ops/fleet.sh`
  on the rows for Air, M1 and Linux. Windows and the droplets carry their options
  in their own files, which I did not re-read today. A relay that consumes a SUBSCRIBE records the path it came by and sends its
  replies down the reverse of it (`_noteReturn`, `_returnFor`).
- **The way back lives sixty seconds.** `RETURN_ROUTE_TTL_MS` is 60,000. The renewal
  ceiling, `RENEW_MS`, is 60,000. A settled subscriber renews once a minute and its
  breadcrumb expires once a minute.
- **A way back that fails once is thrown away.** One undelivered reply deletes the
  breadcrumb, and the reply goes "by the own lookup". For a node no relay holds a
  channel to, that lookup is the send that fails.
- **An answer is promised only sometimes.** `ATTACH_ECHO` is set on the same rows. It
  makes a root answer a renewal that carries an attachment or comes from an
  unpinned subscriber (`wireHandlers.js` 431–435). A pinned subscriber renewing on a
  quiet topic is not answered. Nothing comes down, and nothing is expected to.
- **The merge rides the same road.** A merge offer is one of the requests whose
  reply goes by the return route. The relay's log shows the pull acknowledged and
  then expired, which is the state a merge is left in when the loser never
  completes.

## The proposal

Four parts. The first is the rule; the rest make the rule cheap to keep.

### 1. A pin needs proof from below

A subscriber keeps an upstream pinned only while frames arrive from it. For each
followed topic the subscriber records when it last received ANYTHING from its
upstream: a message, an echo, a beacon it accepts. If two renewals pass with
nothing received, the subscriber treats the upstream as failed: unpin, renew fast,
and re-home, the same path a failed upward send takes today.

### 2. Every renewal is answered

A root answers every renewal, with an empty frame when there is nothing new. Today
it answers the attach-bearing and the unpinned. One small frame a minute for each
subscriber is the cost of part 1 having something to count.

### 3. The way back outlives the gap between renewals

The breadcrumb's life is a multiple of the renewal ceiling, not equal to it, so a
renewal that is a second late does not leave a subscriber unreachable. A breadcrumb
that fails is still dropped, and the next renewal, which part 2 now always answers,
lays a new one.

### 4. The counters are written down

The relay's health dump prints the return-route counters it already keeps:
recorded, used, delivered, fell back. With those in the log, "the way back expired"
is a reading and not an argument.

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
- Sixty seconds that was never the problem. The equal constants are a reading. A
  renewal resets the breadcrumb, so a subscriber that renews on time is covered in
  the best case. I have not measured how late renewals run from a throttled
  browser tab.

## Open questions

1. **For Orion.** The return route is recorded by the node that CONSUMES the
   subscribe. In a tree, is that the node that later sends the DELIVER, or can a
   delegated child be sending down a path it never recorded?
2. **For Aster.** Part 2 makes a root answer every renewal. What stops a subscriber
   using that to make a root send?
3. **For Vega.** Which accepted frames should count as proof in part 1? A beacon
   proves the root is alive, not that this subscriber is fed.
4. **For David.** Two silent renewals is two minutes on a settled topic. Is that
   the right time for a channel to notice it is unfed, given the app note asks the
   same question one layer up?

## Relation to work in flight

- **Closer-Born v0.6** introduced the return route. This note changes its life and
  prints its counters. It does not change what it is.
- **The deaf-channel note** (v0.2, `4c5548b`) notices the same condition from the
  application. With part 1 here, the kernel notices first, and the app's rule
  becomes the check on the kernel's.
- **The reset note** (v0.5, `a80e832`) lists "deaf with peers" as a third trigger.
  Part 1 here is the narrow response to that condition; the reset is the wide one.
- **The bridge note** (v0.2, `648ff2b`). A node with five open channels to relays
  has a way down that does not depend on a breadcrumb at all.
