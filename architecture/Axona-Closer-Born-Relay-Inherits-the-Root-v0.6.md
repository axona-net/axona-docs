# Axona Closer-Born Relay Inherits the Root — design packet v0.6

**Status:** DESIGN, for council review, and BUILDING on axona-protocol branch
`closer-born-root` piece by piece on David's word for each piece (Part 4
names what is built). Nothing merged, nothing deployed, every flag default
off. David's word (direct,
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

**v0.3 (01:4xZ 2026-11-03)** adds Part 6, the vanishing holder, from Vega's
second reading (council 5e8e1fa5): a holder that cannot promise the pull ack
holds the root only with a seated successor, and hands off on any shutdown
signal its platform gives it. Vega's seat approves v0.2 for build on David's
word. Vega's node id is the upstream a fresh read found for #mesh-health
after the roll, so a seat holds that root too; the packet applies to it.

**v0.4 (02:1xZ 2026-11-03)** answers Aster's REVISE BEFORE BUILD (council
a6f27bb2), five points, each holding, and records the 01:38Z event that
proved the second of them on production before the packet was built: an
axona.chat client carried council's history to the closer relay by a merge
pull that timed out and left a second root serving a frozen copy (Part 1).
The promises are now convergence under named assumptions (Part 2); the
handoff is a state machine whose incumbent releases nothing before a
correlated terminal ack covering a named high-water mark (Part 3e); 6b's
successor must stay current, and a holder with no reachable successor keeps
the root rather than pretending to a durability it lacks (Part 6); the wire
and rollout contract is stated (Part 7); offline multi-node fences come
before the live split is touched (Part 4). Aster reviewed against `9e66eb5`
mergeMachine.js and syncEngine.js; the existing merge refuses a role-less
winner and warns that silence reads as a legacy winner, and 3b is rewritten
so that retiring not-root cannot turn a lost reply into an authority
transfer.

**v0.5 (03:1xZ 2026-11-03)** folds in Orion's review of v0.4 and the reply
route (council 34db5e6d). C2 calls the return route a hint, not an
authenticated path: a route_msg hop is unsigned and can forge both path and
originator, so no authority rests on the route (Part 2). A newly minted root
epoch is one above the larger of the loser's epoch and every epoch the
minting node already knows for the topic, its own ended generations
included (3b, 3e step 5). Bridges and saturated nodes stay exempt from the
root and from 3b's acceptance, and the verify skips the bridge (3b). A
born-empty role filled by a subscriber's SUB stays STAGING (3a). A renewal
carrying attach is answered with the attach echo whether or not the sender
says it is pinned, because an unpinned SUB with a warm hint reads exactly
like a pinned one (3d). Part 6b's failure-domain fields are named as open
wire work in Part 7. Orion's three return-route defects are fixed on the
branch (b7a2827).

**v0.6 (04:0xZ 2026-11-03)** takes two refinements from Orion's reading of
the 03:47Z state (council c0a842d2). A fresh reader bonded to 898ee95b13,
Orion's own fresh seat: closer than every holder, a CHILD of Aster's root
with all 90 bodies, after losing the epoch comparison to Aster. The reader
pinned it and received nothing, so the SUB crossed and the replay did not.
The replay and the attach echo a SUB earns therefore return by the SUB's
route, like REPLAYUP (3a), and every frame that may carry a return route
keeps 16 path ids (Part 7). 3b now matches 3e step 2: a closer node
offered the win with no role OR a non-root role enters STAGING. Orion's
CUT-1 and CUT-2 are fixed on the branch (06a5ed0).

## What question this packet answers

When a node is born XOR-closer to a standing topic than the node that holds
its root, whatever kind either node is, how does the role, and the history
under it, move to the newborn without a restart, a re-subscribe, or a hand?

## What this is NOT

This is NOT a change to where history is stored, or to
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

At 01:38:02Z on 2026-11-03, with no hand on any seat or relay, the state
moved. An axona.chat 0.103.0 client (east bridge, 01:24:22Z, namespace
peer-app, node 896d6df698) held council's history as a root at epoch 1;
slot 19, born root on a fresh read at 01:01Z and not terminated this time,
ran merge-pull-start from it with 79 offered, logged merge-pull-timeout at
01:41:17Z, and nonetheless holds the 79. A fresh reader at 02:01Z receives
history through 01:35:54Z and nothing after: Aster's seat stays root at
epoch 2 with the live stream; slot 19 is a second root with a frozen copy.
A partial pull became a root that serves. Part 3e exists to make that
impossible.

## Part 2 — the invariant

These are convergence properties, NOT finite-time guarantees. No node can
know the global closest node through a partition, asymmetric routing, loss
or churn. Each property below holds once the conditions stated after I4
have held long enough; while they do not, the topic is in a named degraded
state and says so.

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

I4. A subscriber whose root moved re-pins to the new root, without
    re-subscribing, within one renewal period after the conditions below
    hold.

Conditions. (C1) Candidate set: the nodes that hold a role for T plus the
nodes on T's lookup path as observed by the holder; closeness is computed
over that set only, never assumed global. (C2) Stable reachability: the
request and its reply each have a route, in the direction they travel, for
the length of one handoff; a one-way route helps only when the request
travels that way AND a return path exists for the reply: the reverse of
the request's own hops (80fe76eb), loop-free, bounded by a TTL and by hop
count, refused when expired. It is a HINT. A hop on it is unsigned and can
forge the path and the originator alike; authority and history rest on
signed envelopes, corr and peer identity, never on the route. (C3) No concurrent second handoff for T
at either node. While any condition fails the holder stays authoritative,
the candidate stays a stager, and the role row reports `handoff: pending`
or `degraded: <reason>`.

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
in the other (the 80fe76eb mechanism, built once, used here). The same
holds for a SUB: its replay DELIVER, and the attach echo of 3d, go back by
the SUB's route with the own lookup as fallback. On 2026-11-03 03:47Z a
fresh reader's SUB reached a holder of all 90 council bodies and the
reader received none.

A born-empty role that receives a SUB whose high-water is above its own
does not pull from that subscriber into a serving ROOT, which is what the
legacy fallback's demote-and-SUB did to slot 19 at 01:38Z. It enters
STAGING and treats the subscriber and that subscriber's upstream as the
first holders to ask. A staged role created only for that purpose is
discarded when its pull times out; the incumbent's candidate gate clears
without tombstoning the stager, so the next verify offers again.

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
naming it the winner, for a topic it holds no role in or only a non-root
role (a CHILD or a BACKUP), from a loser with custody, ACCEPTS: it enters STAGING under 3e and, on the terminal ack,
takes the root at one above the larger of the loser's epoch and its own
known epoch for the topic, which already folds its role, beacons,
tombstones and the generations it ended (`_knownEpoch`, rootElection.js).
A bare loser-plus-one can mint at or below a generation this node ended
earlier. The not-root refusal is retired for an offer
that names a winner; it stays only for a malformed or stale offer. The R4
serving-capable gate (transport/web/index.js, AxonaPeer.js, AxonaManager.js
per ae6d73d2) stops deciding role placement: a node below the graduation
floor still routes and still takes a role when it is the closest. Two
exemptions stay, because neither is about serving capacity. A bridge never
holds a root or a backup (`_neverRoot`, AxonaManager.js); `_verifyRoots`
does not skip the bridge today though `_bestKnownClosest` does, and it will.
A saturated node refuses through `admitPushedRole` as now. Either refusal
deletes any beacon naming the refuser. The offer
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

Change: a renewal that carries `attach` is answered with an attach-echoing
DELIVER even when there is no history to send. The receiver cannot tell an
unpinned sender from a pinned one: an unpinned SUB with a warm hint sends
`via` naming that hint (AxonaManager.js `_sendSubscribe`), which is what a
pinned SUB sends. The cost is one small DELIVER per direct child per
renewal period. A node unattached past the claim window
refreshes its hint through the network lookup. A root that completed a
handoff tells its subscribers the winner's id on their next renewal.

### 3e. The cutover state machine

Two nodes, incumbent H (holds ROOT, custody) and candidate R (closer).
States at R: NONE, STAGING, PULLING, READY, ROOT. States at H: ROOT,
OFFERED, DRAINING, RELEASED.

1. H nominates R from its verify walk and sends OFFER(topic, H, R, epochH,
   corr). H stays ROOT and keeps accepting publications.
2. R, with no role or a non-root role, enters STAGING: it creates a staged
   role that serves NO subscriber and stamps NO publication. A stale,
   duplicate or reordered OFFER (epoch below one already staged, or a corr
   already closed) is refused with a reason; a second contender for T while
   R is STAGING is refused `busy`.
3. R pulls a consistent snapshot: bodies AND tombstones, cut at a named
   high-water mark HW = (publishTs, msgId), the export order the Dual-Root
   packet defines. R then pulls the tail above HW until a pull returns
   empty. Every frame carries topic, corr, both epochs.
4. R sends ACK(corr, HW', bodies, dels), where HW' covers everything it
   holds. H validates the ack on all six fields and that HW' is at or above
   its own high-water at the moment of the ack; if H stamped more since,
   R pulls again (step 3).
5. On a valid terminal ack H enters DRAINING: it redirects new publications
   to R with R's id, tells subscribers on their next renewal, and only then
   demotes to a replica of R; R enters ROOT at one above the larger of
   epochH and R's own known epoch for T (3b). H seats its replicas at once
   rather than on the next refresh tick.
6. Timeouts never transfer authority. A pull that times out leaves R in
   STAGING or discards the staged role; H stays ROOT. A lost or late ACK is
   retried with the same corr; H never demotes on silence. The legacy
   fallback that reads silence as a winner is removed for this path.

The 01:38Z event is step 3 timing out while the staged copy was already
serving: in this machine the copy could not serve before step 5.

What retiring not-root means, precisely. A node offered the win for a
topic it holds no role in enters STAGING instead of refusing. It does NOT
become authoritative on the offer alone, and a lost reply or partial pull
leaves it a stager. Not-root remains the answer to an OFFER that fails
validation.

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
  body Aster's seat holds up to the HW its handoff names, within one probe
  cycle of the read, once C1 to C3 hold. This proves
  3a with the reply route.
- Leg 2, seats reloaded by their owners: Aster's seat hands council off to
  slot 19 on its next verify; the seats re-pin to slot 19 within one renewal
  period; a post from any seat reaches a fresh reader. This proves 3b and
  3d. The 159 journal's six-event cycle, replayed in the simulator against
  a closer node that holds no role, must end at the first offer with the
  closer node as root and the loser's cache under it.

Offline multi-node, deterministic, in the simulator, BEFORE the live split
is touched (Aster a6f27bb2 point 5). Each is a scenario with a seeded clock:
one-way route in each orientation (offer arrives, ack lost; offer lost);
partition during STAGING and heal; publish and delete concurrent with
PULLING, each landing before and after HW; ACK missed, delayed, duplicated
and reordered; incumbent crash in DRAINING; candidate crash in PULLING;
replica loss during 6b; a mixed-version peer at each position (old H, old
R, old subscriber); a field of role-less nodes that NACK forever, which
must end at the probe's own budget (Part 7). A fence asserts no message
is lost or duplicated relative to HW and that exactly one node stamps
publications at every instant.

Built on `closer-born-root` (kernel 4.129.0), each on David's word, each
default off:

- 9ee9391 and 852036f, the two red fences: a partial pull never serves, and
  a subscriber's fill is not authority. 852036f's first scene was wrong and
  is corrected in d105ceb; a third root cut from the winner both ways is
  condition C2 failing, recorded in the fence and not asserted.
- f8489bc, the reply route for mesh:signal (`SIGNAL_RETURN_ROUTE`), and
  b7a2827, Orion's three defects in it.
- 06a5ed0, Orion's CUT-1 and CUT-2 in the cutover: a transient refusal
  and a winner re-minted mid-round are each offered again.
- a9ee5d5, the return routes for pub/sub (manager `returnRoute`, domain
  `RETURN_ROUTE`): a SUB, MERGE_OFFER or PULLUP leaves a breadcrumb keyed by
  its originator and the node it names, and frames sent back to that node
  go by the reverse of its hops before the own lookup. A SUB re-sent by an
  intermediate returns to its subscriber through the re-sender.
- d105ceb, the first cut of 3e step 6 (`cutover`): an aborted merge round
  is offered again, and an unanswered offer never demotes the loser.

- 1016d18, a whole merge round crossing a one-way island end to end in the
  simulator; 4ad9480, Orion's RR-1..3 in the return routes.
- 0ff547b and fb383b0, 3b under cutover: a closer node with no root role
  (or a CHILD or BACKUP) stages, pulls, and takes ROOT only when the loser's
  merge-bearing SUB completes the round, at one above the larger of its
  known epoch and the loser's. The loser keeps stamping through a staged
  round. A staged role takes no PUB or KILL, and a role created only to
  stage serves no SUB. Orion's 3B-1..4 are in fb383b0.
- e0ec9ab, a characterization of the verify's reach (below).

Not built: 3c, 3d's attach echo on every attach renewal, 6b, Part 7's
capability gate, and PULL and PULLRESP on the return route.

## Part 5 — product question for David, answered

Asked in v0.1: should a council seat be serving-capable for standing topics
at all? David, 01:2xZ 2026-11-03: "Every node can hold a topic root or
backup." So a seat holds root until a closer node of any kind is born, and
3b must work across islands every time, in both directions. That is the
case the packet is written for, and it puts the reply route of 80fe76eb
first in the build order.

## Part 6 — the vanishing holder

Every node may hold a root (Part 5). A root that is about to vanish, a
closing chat tab or a seat whose host app quits, cannot keep I3's promise
that its cache survives until the pull is acknowledged. Vega named three
paths (5e8e1fa5); this packet takes all three, in this order.

6a. Hand off on the shutdown signal. A seat already does: `stopRelay` awaits
    `peer.leave()` before `peer.stop()` (Dual-Root packet, Part 2a). The same
    handoff runs for any ROOT or replica holder that receives a shutdown
    signal its platform gives it: the seat's stop, a relay's SIGTERM, and in
    the browser the unload path, which Chrome throttles and freezes (PWA
    report, 11-02) and which is therefore a best effort, not the guarantee.

6b. Hold the root only with a current successor. A holder that cannot
    promise the pull ack, which today means any node whose process is not a
    service, accepts ROOT under 3e only while at least one replica is
    CURRENT: it acknowledged a pull at or above the holder's high-water
    within one renewal period. The replica's failure domain is named in its
    seat record (host, process kind); a replica on the same host as the
    holder does not count. If the replica falls behind or disappears, the
    holder re-seats one before stamping beyond one renewal of lag, and if
    none is reachable it keeps the root and reports `degraded: no-successor`
    rather than promising a durability it lacks. A service can crash too:
    6b states availability while a successor is current, not durability.

6c. A lease for standing topics. Jokes healed because an open app's metrics
    lease kept its empty root alive long enough to be filled; council has no
    lease. A standing topic may carry a lease that keeps its root alive
    across the gap between a vanished holder and the next fresh read. This
    is a product choice with a cost in idle roots, and it is named here for
    David, not decided.

The fence for 6b: in the simulator, a closer ephemeral node offered the win
stays a replica until a second node has pulled the cache, then takes the
root; the loser's cache is released only after that pull's terminal ack.

## Part 7 — wire and rollout compatibility

This packet changes the wire. Named so that leg 1 can run with old seats.

- New frames or fields: OFFER gains `hw` and a `stage` disposition; a
  PULLUP NACK `no-role` (a new disposition on the existing REPLAYACK);
  ACK gains `hwCovered`; the return route rides route_msg as built for
  mesh:signal: the request's R3 `path` (a signal frame keeps 16 ids, other
  frames PATH_MEMORY) is reversed at the terminal into `rpath` on the reply.
  No new frame. Every frame that may carry a return route (mesh:signal,
  MERGE_OFFER, PULLUP, SUB) keeps 16 path ids; others keep PATH_MEMORY.
- 6b's failure domain is not on the wire today. A capability field naming
  a service process and a host hash is needed before 6b can count a
  successor on a distinct host; until it exists 6b cannot be built.
- Versioning: each new field is ignored by an old node by construction
  (unknown fields are dropped). A node advertises `handoff:1` in its
  capability attest; a holder runs 3e only toward a candidate that
  advertises it, and the existing merge path otherwise. Old seats in leg 1
  therefore keep today's behaviour, and slot 19 running new code must not
  stage from an old incumbent.
- Budgets: a NACK does not consume the useful-holder try budget but does
  consume a separate bounded probe budget of time and frames per topic;
  when it is spent the probe stops and the root reports
  `degraded: no-holder-found`. A field of role-less nodes ends there.

## What would make this wrong

Closeness is measured among reachable nodes, and reachability differs by
island; a closer relay that no direction can route to inherits nothing, and
the packet then rests entirely on the 80fe76eb reply route, which is not
built. The replica count and the renewal period are named by the kernel and
not quoted here; a fence that assumes a number must read it from source. The
159 loop is read from one journal; a second root on 143 ran the same code
for the same hours, and 16 rows of its journal are read in council
ea3d8e60. Leg 1 of
the integration test needs a Windows roll, which is David's hand, and a
roll is itself the event that produced the split.

The verify sees two channel-hops, no farther. On a standalone peer (every
seat, browser and relay built on the default adapter) the lookup the root's
self-verify calls is findKClosest, not the DHT walk. It asks only peers this
node holds an open channel to, and learns the ids their answers name. None
of the four production transports (WebRTC, composite, bridge, Node
WebSocket) opens a channel on send; each refuses an unbound peer at once.
So one verify pass names a closer holder only if it sits within the node's
neighbours' neighbours, counting a bridge as the channel for the peers it
relays. A closer holder three channel-hops away stays invisible until
synaptome fill opens a nearer channel, and 3b cannot start without that
nomination. Fence characterize_findk_chain_reach (e0ec9ab) pins the
behaviour; Orion 06b0739f read the transports. A verify that walks farther
is a separate change, not built.
