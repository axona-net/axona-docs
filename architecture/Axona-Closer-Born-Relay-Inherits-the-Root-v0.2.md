# Axona Closer-Born Relay Inherits the Root — design packet v0.2

**Status:** DESIGN, for council review. Nothing built. David's word (direct,
01:1xZ 2026-11-03): "Analysis seems to be complete. Let's move forward with the
fix. If a relay is born closer, it should inherit the root - or backup if it
closer than a backup." Every line number below is read from axona-protocol at
`9e66eb5` (tag v4.128.0), the kernel the fleet runs since 20:34Z 2026-11-02,
through Orion's source reading (council ae6d73d2) and axona.bot's verification
of it (3442b125). The live #council split of 2026-11-02 is the fence this
packet must pass, and it stays untouched until the fix is driven against it.

**v0.2 (01:2xZ 2026-11-03)** answers Part 5 by David's word: "Every node can hold
a topic root or backup." The qualifier "serving-capable" is gone from the
invariant and from every mechanism. Role placement is XOR closeness among
ALL nodes that hold a role for the topic or that its walk reaches; a seat
born closer inherits from a relay and a relay from a seat by the same
machine; no node answers not-root to an offer that names it the winner from
a loser with custody; the R4 serving-capable gate no longer decides where a
role sits. The reply route of 80fe76eb carries every kind of node, which is
why it is built first.

## What question this packet answers

When a node is born XOR-closer to a standing topic than the node that holds
its root, whatever kind either node is, how does the role, and the history
under it, move to the newborn without a restart, a re-subscribe, or a hand?

## What this is NOT

This is NOT a change to where history is stored, to the wire format, or to
who may publish. It is NOT the cross-island signalling remedy of 80fe76eb,
though it depends on the same fact: a reply must travel the route the request
arrived on. It does NOT decide whether a council seat may hold a root; David decided
that in Part 5: every node may.
It is NOT a restart of Windows slot 19 or a reload of Aster's seat.

## Part 1 — what happened, read from logs

Council's root has been Aster's seat since 13:36:08Z on 2026-11-01, the
minute that seat started: role ROOT, epoch 2, cache 72, subs 8 at 01:08Z on
2026-11-03 (Aster's own row). Through the afternoon of 2026-11-02 two droplet
relays born in the 16:0xZ roll held a second root each, with a merged copy of
the history (merge-admitted 89 bodies at 17:47:41Z on 143, 92 on 159). The
159 root looped for four hours: verify-closer nominated 898f899668, a node
four bits from the topic that holds no root; the root planted a verified
beacon for it before it accepted, the node answered not-root, the beacon
stayed, the next write was forwarded to it, its receipt never came, it was
evicted and tombstoned, the root promoted itself, and the next verify planted
the beacon again (159 journal, 64 council rows, 16:06Z to 20:33Z).

The 20:3xZ roll killed both relay roots. From then on a fresh subscriber's SUB
walk terminates at Windows slot 19, which is XOR-closer to the topic than
Aster's seat. Slot 19 is born root with an empty cache, runs the empty-root
probe against four direct neighbours that hold no role for the topic (each
answers consumed and sends nothing), and terminates 180 s after the read
(slot 19 log, three cycles at 20:35Z, 21:01Z, 22:01Z). The seats stay
children of Aster's root and keep receiving its fan-out; a fresh reader
receives nothing. Jokes healed in the same hour because a metrics lease from
an open app kept its empty relay root alive long enough for a re-walking
holder to fill it (topicLifetime.js: `role.metricsOn > now` blocks
termination). Nothing leases council.

## Part 2 — the invariant

For a standing topic T:

I1. ROOT for T is held by the node closest to T, by XOR distance, among the
    nodes that hold any role for T or that T's walk reaches. Every node
    kind may hold it: relay, seat, client.

I2. The replica set for T is the next-closest nodes, as many as the kernel's
    replica count names. A node born closer than the farthest replica takes
    that slot; the displaced replica is released.

I3. History follows the role. A node that takes ROOT or a replica slot pulls
    the holder's cache before it serves a single subscriber, and the holder
    does not drop its cache until the pull is acknowledged.

I4. A subscriber whose root moved re-pins to the new root within one renewal
    period without re-subscribing.

The precondition for every mechanism below is the same: a node R exists
with d(R, T) < d(H, T), where H is the current holder of the role, and R
and H can route to each other by at least one direction. R and H may each
be a relay, a seat or a client.

## Part 3 — the mechanisms

### 3a. The newborn pulls from a holder, not from a neighbour

Today `_emptyRootProbeTry` (repairPlane.js) ranks direct synaptome neighbours
first and `_onPullUp` (wireHandlers.js:919) answers consumed before any role
check, so a role-less neighbour counts as a fruitful try and the three tries
are spent on nodes that hold nothing. `_syncAnswerPull` (syncEngine.js:153)
answers from ANY role with a cache, children included, so the history holder
would have answered had it been asked.

Change: a PULLUP at a node with no role for the topic answers a NACK that
the prober does not count as a try. The prober orders candidates by evidence
of holding: the upstream named by the SUB that birthed the root, then the
lookup path's nodes closer than self, then direct neighbours. The REPLAYUP
answer returns over the route the PULLUP arrived on, with the own lookup as
the fallback, so an island that can be reached in one direction is answered
in the other (the 80fe76eb mechanism, built once, used here).

### 3b. The holder hands off to a closer node

Today `_verifyRoots` (rootElection.js:380-394) nominates any strictly closer
visited node, plants a verified beacon for it before it accepts, and ignores
`_rootTombstoned`; `_rootVerifyCandidate` logs root-verify-demote whether or
not a demotion happened; `_onReplayAck` on a not-root refusal clears the
candidate and leaves the beacon (mergeMachine.js:613-622); `_onMergeOffer`
answers not-root for any node without an isRoot role (mergeMachine.js:380).

Change, in four parts. The beacon is written only when the nominee's
acceptance arrives, and a refusal deletes any beacon for that node. The
verify consults the tombstone set and does not re-nominate a tombstoned
node inside its window. A node of any kind that receives a MERGE_OFFER
naming it the winner, for a topic it holds no role in, from a loser with
custody, ACCEPTS: it creates the root role at the loser's epoch plus one and
runs the existing merge pull. The not-root refusal is retired for an offer
that names a winner; it stays only for a malformed or stale offer. The R4
serving-capable gate (transport/web/index.js, AxonaPeer.js, AxonaManager.js
per ae6d73d2) stops deciding role placement: a node below the graduation
floor still routes and still takes a role when it is the closest. The offer
travels the verify walk's route, own lookup as fallback.

### 3c. Replicas inherit the same way

On each verify the root recomputes the replica set from its walk. A node
closer than the farthest current replica is sent the replicate request the
kernel already uses to seat a backup; the displaced backup is released with
the existing release path. A newborn that finds itself closer than a
replica but not closer than the root takes the replica slot and does not
claim root. A seat or a client takes a replica slot by the same rule and
serves pulls from it.

### 3d. Subscribers follow the root

Today a caught-up renewal from an existing subscriber calls `_replayTo` with
ping false (wireHandlers.js:405) and no DELIVER is sent, so a subscriber that
lost its pin never receives the attach echo that would re-pin it; and
`_rootHint_` (rootElection.js:252-290) consults the network only when the
local closest is null or self, so a child with a closer local neighbour never
learns of a new root.

Change: a renewal from a subscriber with no pin, or whose pin names a node
that has handed off, is answered with an attach-echoing DELIVER even when
there is no history to send. A node unattached past the claim window
refreshes its hint through the network lookup. A root that completed a
handoff tells its subscribers the winner's id on their next renewal.

## Part 4 — fences

Unit, each one a mutant that today's suite would pass:

- rootElection: no beacon before acceptance; a not-root refusal deletes the
  beacon; a tombstoned node is not re-nominated; root-verify-demote is logged
  only on a demotion.
- mergeMachine: a node of any kind with no role, offered the win by a loser
  with custody, creates the root and pulls; a malformed or stale offer is
  still refused; the loser keeps its cache until the terminal ack.
- repairPlane and wireHandlers: a role-less PULLUP answers NACK and is not
  counted; the candidate order is holder evidence first; the REPLAYUP
  returns on the inbound route.
- wireHandlers: a caught-up renewal from an unpinned subscriber receives an
  attach-echoing DELIVER; the hint refresh runs on the network past the
  claim window.

Integration, against the live split, in two legs because the two sides run
different code until David's hand reloads a seat:

- Leg 1, relays only: with the fix rolled to the Windows fleet and no seat
  touched, a fresh reader of #council bonds to slot 19 and receives every
  body Aster's seat holds, within one probe cycle of the read. This proves
  3a with the reply route.
- Leg 2, seats reloaded by their owners: Aster's seat hands council off to
  slot 19 on its next verify; the seats re-pin to slot 19 within one renewal
  period; a post from any seat reaches a fresh reader. This proves 3b and
  3d. The 159 journal's six-event cycle, replayed in the simulator against
  a closer node that holds no role, must end at the first offer with the
  closer node as root and the loser's cache under it.

## Part 5 — product question for David, answered

Asked in v0.1: should a council seat be serving-capable for standing topics
at all? David, 01:2xZ 2026-11-03: "Every node can hold a topic root or
backup." So a seat holds root until a closer node of any kind is born, and
3b must work across islands every time, in both directions. That is the
case the packet is written for, and it puts the reply route of 80fe76eb
first in the build order.

## What would make this wrong

Closeness is measured among reachable nodes, and reachability differs by
island; a closer relay that no direction can route to inherits nothing, and
the packet then rests entirely on the 80fe76eb reply route, which is not
built. The replica count and the renewal period are named by the kernel and
not quoted here; a fence that assumes a number must read it from source. The
159 loop is read from one journal; a second root on 143 ran the same code
for the same hours and its journal has not been read row by row. Leg 1 of
the integration test needs a Windows roll, which is David's hand, and a
roll is itself the event that produced the split.
