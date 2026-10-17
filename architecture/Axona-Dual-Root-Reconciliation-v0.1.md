# Axona Dual-Root Reconciliation — design packet v0.9

**Status:** DESIGN, for council review. Nothing built. David's word (direct,
04:1xZ 2026-10-17): "Yes, write it." The review bar is Vega's 8cbecf8b
(council seq 182), frozen before this was drafted. Every line number below
is read from axona-protocol at `6bc3ff4` (tag v4.114.1), the kernel the
fleet runs and the relay vendors at 6547229, and from axona-relay at that
commit.

**v0.2 (04:4xZ 2026-10-17)** answers Aster's BLOCK b312dcf8 (four points,
each verified against source and each holding) and Vega's two change
requests in 1288a677. v0.1's Part 2a said a seat's reconnect skips the
handoff. It does not: `stopRelay` awaits `peer.leave()` before `peer.stop()`
(axona-relay relay.js:417). That mistake came from reading grep hits
instead of the function, and it is stated here because the correction
names what v0.1 could not: the leading candidate for the carrier of the
eleven. The other three points are gaps in the v0.1 mechanism, filled in
Part 4.

**v0.3 (16:2xZ 2026-10-17)** answers Aster's second BLOCK 9b8774c0 on
v0.2, three points, each holding: the step-down ack is terminal-only and
bound to topic, peer, epoch and corr; the multi-round cursor is
(publishTs, msgId), not publishTs alone, because `_syncDelta` selects
strictly greater and an equal-stamp group split across a frame loses its
tail; and the carrier of the eleven is the leading hypothesis, not a
named fact, until a record distinguishes HANDOFF from SPLIT_UNION.

**v0.4 (16:5xZ 2026-10-17)** answers Aster's third BLOCK 436ca7b6 on
v0.3, two points, both holding. The merge in 4(d) had the loser pull
from the winner; the shipped pull ingests at the requester, so the
loser ingested and the winner received nothing. 4(d) is now a two-way
machine with the winner as requester, an OFFER from the loser, both
epochs on every frame, and a terminal ack the loser validates on six
fields. The cursor's order is defined at export, not borrowed from a
cache that has none.

**v0.5 (17:1xZ 2026-10-17)** answers Aster's fourth BLOCK fcc085cf on
v0.4: the tail. A loser that keeps stamping after its snapshot has a
tail the terminal ack never covered, and the shipped high-water pull
does not close it, since `_onSub` pulls only when the subscriber's `hw`
exceeds the root's (wireHandlers.js:343–345) and a split winner can
already hold a higher stamp. v0.5 has no tail: the loser CUTS and GATES
when it binds the pull, forwards every later publish and kill to the
winner, and the export is total. The bound is then a sum of constants
with no publisher term.

**v0.6 (17:4xZ 2026-10-17)** answers Aster's fifth BLOCK 3196ed00 on
v0.5: the gate's forward was not a defined path. v0.5 cited the non-root
reroute at wireHandlers.js:488, and `_reroute` (AxonaManager.js:418–421)
pops one via and sends toward the TOPIC id, which in the split being
repaired can come back to the loser, and the loser is still root while
gated, so that was a new interception path, not the existing non-root
case. v0.6 forwards to the bound winner by name through the write-flight
path the 4.102.0 hold already uses (`_holdIntercept`,
wireHandlers.js:239–249, into `_forwardToRoot`, AxonaManager.js:909),
with a re-entry nonce, with the helper's defer-confirmed demotion
suppressed, and with the write discharged only by the winner's signed
ingest ack.

**v0.7 (17:4xZ 2026-10-17)** answers Aster's sixth BLOCK 93a10c3b on
v0.6: the flight's epoch binding was asserted, not supplied. `_flightOpen`
takes no epoch argument; it reads the local beacon record and stores 0
when there is none (writeFlight.js:79–81), and `_flightComplete` accepts
an ack at any epoch when the flight's epoch is 0 (121). So "keyed on
winnerEpoch" was true only when a fresh beacon for W happened to be
present. v0.7 gives the merge flight an explicit epoch authority: the
`winnerEpoch` carried by the validated PULLUP, passed into the flight,
never 0, never read from a beacon, and states what happens when W
re-mints during the gate.

**v0.8 (18:1xZ 2026-10-17)** answers Aster's consolidated review
2915bb37, which cleared 93a10c3b and raised four obligations on the
machine as a whole, each read and each holding. One: the packet had two
demotion authorities, since (b) demoted on the closest visited node
while 4(d) said step 5 was the only place a root sheds its claim, and
the kernel has two more that demote directly, beacon reconciliation
(rootElection.js:125–127) and the forward helper on attributed
consumption (AxonaManager.js:938–940). Two: the gate was checked at the
handler's entry, and `_ingestPublish` awaits signature verification
(wireHandlers.js:501) and topic derivation (509) before it stamps and
caches (536–541), so a write admitted before the cut could commit after
it. Three: the ack counted ingests, and `_ingestStampedBatch` counts
"held" (782–798) while `_cachePush` evicts at the count and byte caps
(topicStore.js:35–40), so held equal to sent did not prove retention.
Four: the bound treated `VIA_HOP_BUDGET` as a duration; it is 8 hops
(constants.js:295). v0.8 gives merge-capable roots one demotion
authority and inventories every path into it, moves the cut to the
mutation point, replaces counts with a retention manifest and a capacity
admission, and separates safety, which is unconditional, from a bound,
which is conditional on named assumptions.

**v0.9 (18:3xZ 2026-10-17)** answers Aster's BLOCK 9d57e366 on v0.8,
four contradictions, each holding. One: Part 3 had moved to the
kernel's yield predicate while the machine still said XOR-closer, and
that predicate (rootElection.js:125) is asymmetric, not an order: a
closer node at a lower epoch yields to a farther node at a higher epoch,
and the farther node yields back on closeness. v0.9 states one relation,
a total order, and applies it everywhere a winner is named. Two: the
authority inventory guarded callers of `demote()`, and ADOPT never calls
it: `_onAdopt` runs `adoptChild` (wireHandlers.js:437–440), which flips
the root flag directly (rootClaim.js:490). The flag changes in exactly
one function (215), so v0.9 puts the custody gate there. Three: the cut
covered bodies and not tombstones; `_syncIngest` applies dels before
bodies (syncEngine.js:206–207) through `_applyDels`, which awaits proof
verification and then calls `_applyKill` per entry (topicStore.js:
119–121), so a tombstone-only handoff after the cut acked with nothing
transferred. Four: capacity was admitted on the OFFER's figures while L
kept stamping until the cut, pins covered the manifest and not W's own
baseline, and the reserve's exhaustion had no contract. v0.9 sizes at
the cut, pins both, fails closed, and conditions the bound on admission.

**Lineage:** axona.bot 71dc09d7 (the split, seq 2 on the relay-held root),
e508b92a (the fork), 7c7f9383 (amended proposal), c5d18788 and f7260bec
(the lookup reading and the correction that withdrew the bridge framing);
Vega f702cc23, 12838126, 65a75864, 8cbecf8b; Orion c48691c8; Aster
085766f8 and 0ab63c79. David's two direct questions, "Why could these nodes
not find each other?" and "Why is the bridge an issue?", are what Part 2
answers.

## What question this packet answers

When a relay restarts into a topic that a client seat already roots, two
live roots exist and today nothing brings them back to one. Which code
paths let that happen, in what order do they get fixed, and what bound can
the kernel then keep on how long two roots live?

The packet answers the two code questions the council put first, states
the invariant Aster wrote, gives the fixes in Vega's order with the state
each one adds, and names the fences that pin them. It adds two frame
types, `MERGE_OFFER` and `REPLAYACK`, seven fields on three existing
frames, and one field on the SUB. Everything else the merge needs
already ships; what is missing is a trigger that fires, a terminus that
is read, a pull whose outcome is awaited, a pull that runs in the
direction the union needs, and a step-down that waits for its ack.

## What this is NOT

- **Not a bridge problem.** The bridge sits in 0xFF and is never a
  traversal hop. The birth probe's pull is a ROUTED send (`_syncPull`,
  syncEngine.js:120–129, through `_route`, AxonaManager.js:369, which is
  `dht.routeMessage` with a via-hop budget). No direct channel to the
  target is required. Three lookups from a fresh seat on 2026-10-17 03:50Z
  show seats holding direct channels to relays and to each other, relays
  routing through seats, and the two 0xFF peers absent from every path.
  The "behind the door" framing in e508b92a and c5d18788 is withdrawn.
- **Not a seat ban.** Forbidding client seats from rooting is one line and
  it is wrong on the night a whole fleet rolls: a seat-only topic then has
  no root and every publish fails instead of forking. A fork is
  recoverable. A refused publish is a message the author believes was
  sent. If David wants a stopgap before this lands, the ban goes on
  `#council` alone, with that outage named.
- **Not "never two roots".** Two isolated terminals cannot tell partition
  from absence. The invariant in Part 3 allows two roots while their
  control paths are disconnected and bounds what happens once a path
  exists.
- **Not a history guarantee past 24 hours.** `TTL_MS` (constants.js:296)
  is a 24-hour hold keyed on the root stamp, enforced on every role cache
  by `_expireCache` (topicStore.js:48–56). A merge unions what both sides
  still hold. The 160 seat-side council entries that did not come across
  on 2026-10-17 were, with one exception noted in Part 2, already past
  that hold.

## Part 1 — what happened, read from logs

Times UTC, 2026-10-16 unless marked. The topic is `#council` in eagle,
id prefix 898be2a9d38e.

| When | Where | What the log says |
|---|---|---|
| 10-15 23:54:57 | linux relay-3 | `root-formed`, born sub-terminal, three `empty-root-probe` tries, nothing found. Council root through the 4.114.1 night. |
| 17:16–17:35 | fleet | relay 0.161.0 roll: Air, M1, Linux, then Windows alone, then droplets. |
| 17:17 | linux relay-3 | restarted; its cache and claim gone. |
| 17:17:42 | nyc3 relay (droplet 167) | `root-formed`, born sub-terminal, `admitted-despite saturated`, cache EMPTY; three `empty-root-probe` tries (fanout 4, 2, 1) found nothing. The pre-roll council history left the relay fleet here. |
| by 17:21:38 | nyc3 relay | `subs:4` (the four seats pinned to it). |
| 17:19:33 | axona-win svc-11 | restarted, fresh id. |
| 17:21:13–17:21:48 | svc-11 | `routed-outcomes` failed 6, 6, 6, 12, 6, 6, 12, 12 per 5 s tick against ok 1–8; every failing target an 0x89 relay; `negotiation-timeout` marks between. Mesh still forming. |
| 17:21:38 | svc-11 | `root-formed`, `root-transition` born sub-terminal, cache empty. |
| 17:21:38 | droplet 167 relay | `root-verify-demote` to svc-11, `why: verify-closer`, `subs:4`. Relay-to-relay, the self-verify worked. |
| 17:21:39, :48, :53 | svc-11 | three `empty-root-probe` tries, fanout 4, inside the failing-routes window. Budget spent. Never re-armed. |
| 17:26:28 | svc-11 | David's "This is a test. Please respond." stamped here; `replicate` to svc-13 the same second. |
| 17:26:28 | droplet 167 relay | `role-nature backup`, principal svc-11. |
| 17:27–00:03 (10-17) | the seats | Vega's 8690c94d, df309d9c and ten axona.bot posts stamped on a root no relay on any host logs. Seat-held. None reached svc-11. |
| 17:30:43 | m1 relay-7 | backup of svc-11. |
| 10-17 00:36–02:10 | this seat | the split found by a cold reader, not by the seat's own view, which read 58 messages and nothing wrong. |
| 10-17 02:22 | this seat | `axona_reconnect`; fresh walk pins svc-11; replay = David's one message. |
| 10-17 02:56–03:07 | Vega, Aster, Orion | each reconnects; each reads the relay-held root. |
| 10-17 03:04:17 | svc-11 | eleven seat-side entries (seq 161–171, 16:46Z onward) ingested, original seqs kept. Leading hypothesis: the leaving seat's HANDOFF (Part 2b); the receiver's record of it is debug only, so the event is not proven. |
| 10-17 03:50 | a fresh seat | three lookups for the topic: 41 hops, 3.6–4.4 s, `found:false`; svc-11 visited at hop 9; last hop a node 0x00aa… from the topic against svc-11's 0x00039d…. |

What the logs do not say: which seat held the seat-side root, what its
lookups returned, and what carried the eleven. An MCP seat writes no log
the host keeps and `axona_status` exposes no role or upstream. Part 5 fixes
that.

## Part 2 — the two code questions, answered first

### 2a. What does a leaving seat's handoff carry?

Everything it holds, if `leave()` runs. `AxonaPeer.leave()`
(AxonaPeer.js:2269) drains pending publishes on evidence, then races
`pubsubLeaveHandoff()` (repairPlane.js:1145) against a bound of
`max(timeoutMs, min(60 s, 2 s + 100 ms × roles))` (2361–2366), then
announces `peer-leaving`. The handoff pushes `_syncSnapshot(role)`
(syncEngine.js:102–107): the whole `role.cache` plus active tombstones.
Singleton roots go first, then replicated roots, then non-root holders,
larger caches first within a tier (1175–1187). Non-root holders hand off
too unless the root is a current direct neighbour (1172, `_rootAliveForLeave`).

A seat's reconnect runs it. `axona_reconnect` (mcp-session.js,
`reconnect()`) awaits `_session.close()`, the session's `close` is
`stopRelay({ peer, transport })` (ops.js:71), and `stopRelay` awaits
`peer.leave?.()` at relay.js:417 before `peer.stop()` at 418 and
`transport.stop()` at 419. So every seat that reconnected on 2026-10-17
ran the drain and the handoff before its transport died. A seat holding a
role with an EMPTY cache pushes nothing (repairPlane.js:1158), which is why
this seat's 02:22Z reconnect carried nothing: it held no council role.

What the handoff carries is therefore the answer to Part 2b, and what it
lacks is a log the host keeps. The heir logs `handoff-ingested` at debug
unless a message was rejected (syncEngine.js:223–224), and the leaver is
gone. Part 5 raises the receiver's line to info on a relay and adds the
leaver's outcome to `axona_status`.

### 2b. Why eleven of seventy-three?

Because of the 24-hour hold, and because the carrier was a role cache.

`_expireCache` (topicStore.js:48–56) shifts every entry whose `publishTs`
is more than `TTL_MS` behind now off the front of `role.cache`. At
03:04:17Z on 10-17 the hold reached back to 03:04Z on 10-16. The eleven
that arrived are seq 161 (16:46Z on 10-16) through 171 (00:03Z on 10-17).
No council post sits between 00:3xZ and 16:46Z on 10-16: the seats were
quiet through that day. So the eleven are exactly the council entries a
role cache could still hold at that moment. The one exception to "already
past the hold" is seq 160 and below only if any of them is younger than
03:04Z on 10-16; the transcript search did not confirm a single one.

The count is explained. The carrier is a hypothesis, and with Part 2a
corrected it has a leading candidate: the HANDOFF of the seat that held
the seat-side root, pushed by `pubsubLeaveHandoff` when that seat's
reconnect ran `leave()`, received at svc-11 by `_syncIngest`'s HANDOFF
branch (syncEngine.js:192–226). On that path the heir applies the
tombstones, ingests the batch by verified union, runs `handoffArrived`
(which yields only to a strictly closer live root, so svc-11 keeps its
claim), and acks the leaver. What source proves is that the reconnect
invokes `leave()` and that HANDOFF is a path compatible with what
arrived. What would prove the event is the receiver's `handoff-ingested`
line, which is debug unless something was rejected, and no relay log on
six hosts holds it. The alternative stays open: a SUB carrying a low
water below the root's (wireHandlers.js:343–348) from any node that held
a council role at 03:04Z. Every seat that re-subscribed was fresh, which
weighs against it and does not close it. A sim that reproduces the
handoff shows the path works; it does not show that this path carried
these eleven. Only a retained record does, and Part 5.1 is where that
record starts being kept.

One more fact fits either candidate. The eleven include seq 161–163,
stamped 16:46Z–17:09Z on 10-16, before the roll. No relay held them after
17:17:42Z: linux relay-3 took its cache down, and the nyc3 relay that
replaced it was born empty and its probes found nothing. So the seat that
became root by `sub-terminal` between 17:21:38Z and 17:27Z started with a
cache that was not empty. Where a born root's cache comes from when the
claimant was already a subscriber is the first thing
`fence_merge_carrier_named` reads; the fence reproduces both candidate
paths from a reconnecting seat and shows that each leaves a record that
distinguishes it, which is the condition under which the next such event
is named rather than argued.

Whichever path carried it, it carried a whole role cache, and the cache
was 24 hours deep. That is the shape of every merge this packet designs: a
full pull, bounded by the hold. Aster's rule follows: conflict repair pulls full state and does
not rely on a high-water comparison, because split histories are
incomparable by water mark.

## Part 3 — the invariant

Two roots for one topic may exist only while their control paths are
disconnected. Once a routed path exists between them, within a stated
bound: one deterministic winner remains, the loser's history and
tombstones are unioned into the winner before the loser sheds ROOT, and
the loser does not release its cache until the winner has confirmed the
union.

The winner is chosen by ONE relation, and it is an order. A claim is
(node id, epoch). A claim that is tombstoned for that topic is out
before the comparison, as the kernel already treats it: tombstones
order rejection. Between two live claims, the one with the HIGHER
epoch wins; at equal epoch, the one XOR-closer to the topic id wins. A
tie on both is impossible between distinct ids. This is lexicographic,
so it is total and pairwise consistent: for any two live claims exactly
one wins, and it wins from either side's view. Every trigger, the
OFFER, the PULL admission at both ends, and every transition in Part 4
apply this relation and no other.

Why this and not the kernel's yield predicate. `rootElection.js:125`
reads `supersedesMine || (closer && !staleClaim)`: a closer node at a
lower epoch yields to a farther node at a higher epoch, and that
farther node, reading the same line from its side, yields back on
closeness. That is two yields and no winner, and a merge machine run on
it would cross offers forever. Why epoch before closeness and not the
reverse: v0.1 through v0.7 said closeness alone, and closeness alone
re-elects a stale incarnation whenever it is nearer, which is what the
epoch mechanism (E4, "higher epoch wins reconciliation") was built to
stop. Epoch first keeps E4; closeness second keeps the keyspace's
placement once incarnations agree. The crossed-claims case, A closer at
epoch 1 and B farther at epoch 2, resolves to B from both sides, and
`fence_dual_root_crossed_claims` pins it. A legacy peer still runs the
yield predicate; Part 4(d)'s mixed-version section says what that
costs.

The custody condition: a root sheds its claim only when it holds
nothing, or when the winner has confirmed retention of everything it
held. "Holds nothing" means an empty cache and no active tombstone.
Every other case goes through the machine in 4(d). This condition
binds the paths that demote today; Part 4(d) lists them.

What the invariant does not promise: that a publisher whose walk ends at
a spurious root sees its message at the true root before the bound
elapses. Delivery latency inside the bound is a separate measurement.
Nor does it promise convergence: Part 4(d)'s last section states what
safety holds without any assumption and what the bound needs.

## Part 4 — the fixes, in Vega's order

Each item: what the code does, what changes, what state it adds, which
fence pins it. The order is (b), (c), (a), (d). Skipping (b) and (c)
leaves both sides self-confirming every 45 s, which is what the night
showed.

### (b) The verify reads the closest VISITED node

**Today.** `_verifyRoots` (rootElection.js:337–368) runs 6 s after
`root-formed` and every 45 s after, three lookups per tick. It takes
`r.path[r.path.length - 1]` as the terminus (354) and demotes only if
that one node is strictly closer than self (358). On 10-17 at 03:50Z a
seat's walk visited the true root at hop 9 of 41 and ended on a node
0x00aa… from the topic. The verify never looked at hop 9.

**Change.** The terminus becomes the strictly-closest node in `r.path`
that is not self. What the verify does with it is no longer a direct
`demote()`: for a root that holds nothing the demotion is as today,
and for a root that holds cache or tombstones the terminus becomes the
candidate winner handed to the merge machine in 4(d), which runs step 1
toward it. `demote()` (rootClaim.js:374–395) itself is unchanged; what
changes is who may call it on a root with custody, which is step 5 and
nothing else. This fixes the SEAT-side false confirm. Relay to relay the verify already worked: the
nyc3 relay demoted to the Windows relay in the same second that relay
formed. The change alters nothing for a walk that converges and
everything for a walk that bounces.

**State added.** None. The path is already returned.

**Fence.** `fence_verify_closest_visited`: a sim root whose lookup path
holds a strictly-closer live node mid-path and a far node last demotes
to the mid-path node within one verify; with the change deleted it
keeps the claim. Red with the fix deleted.

**Risk.** A visited node that is closer but not live. `demote()` already
pairs with a confirming subscribe; an unadopted demotion re-homes by the
existing `_unpinIfWaypointDead` path (AxonaManager.js:1290–1307). The
fence includes that case.

### (c) The lookup converges

**Today.** `lookup()` (AxonaPeer.js:3304–3364) runs `_lookupStep`
(6575) with a `queried` set that is serialised across hops and rebuilt
on receipt (898–923). Each step skips a candidate already in the set
(6625) and adds the next hop (6668). The 10-17 paths show one node
appearing sixteen times in a 41-hop walk, so across real hops the set
does not prevent revisits; whether the set is dropped on a forward, or
the step records a hop without querying, is the first thing to read when
building this item.

**Change.** A walk never visits a node twice, and a walk that cannot
advance returns an explicit terminal outcome (`stalled` with the
closest visited node) instead of running to the hop cap. The lookup's
contract gets its own fence; the route_msg path-memory guard is not
assumed to cover it (Aster 0ab63c79).

**State added.** None beyond the existing set, carried correctly.

**Fence.** `fence_lookup_no_revisit`: a sim ring where two nodes are each
other's closest-known for a key; the walk terminates in at most the ring
size hops with `stalled` and the closest visited node; with the fix
deleted it runs to the cap. Red with the fix deleted.

### (a) The birth probe does not spend its budget on a forming mesh

**Today.** `_emptyRootProbe` (repairPlane.js:634–689) fires 800 ms after
`root-formed`, at most three times, fanout 4, reachable-first ordering
over `findKClosest(fanout+1)` ∪ the lookup path. A try counts whether or
not the routed sends landed. svc-11 fired all three between 17:21:39 and
17:21:53 while its `routed-outcomes` read failed 6–12 per tick, and
never probed again.

**Change.** Today the probe cannot see its own outcome: `_syncPull`
fires `_route` and returns `true` synchronously (syncEngine.js:127–128),
and `_emptyRootProbe` neither awaits nor collects it (repairPlane.js:
680–686). Three changes, all local:

1. `_syncPull` returns the promise `_route` returns. `_route` already
   resolves every send to a verdict of routing's own shape, a transport
   error included (AxonaManager.js:369–377); no caller today reads the
   boolean for anything but the SPLIT_UNION quench, which keeps its early
   `false`.
2. `_emptyRootProbe` collects the fanout's promises with `allSettled`,
   bounded by the via-hop budget's own timeout, and counts the try only
   when at least one verdict is `consumed:true`. A try whose every
   verdict is `consumed:false` or a transport error sets
   `role.sync.probeDeferred = true`, does not increment `probeTries`, and
   does not add its targets to `probed`, so they are eligible again.
3. A deferred probe re-arms ONCE, on the first `refreshTick` after
   whichever comes first: the node's `state` reads graduated, or
   `EMPTY_ROOT_PROBE_INTERVAL_MS` × 4 has passed since the deferral. The
   re-arm clears `probeDeferred`; a second all-failed try defers again,
   at most `EMPTY_ROOT_PROBE_MAX` deferrals, after which the probe stops
   and the 45 s verify is what remains. The fleet-wide routed-outcome
   ratio is not the gate; the verdicts of this topic's own pulls are.

**State added.** `role.sync.probeDeferred` (boolean),
`role.sync.deferrals` (count), `role.sync.deferredAt` (ms).

**Fence.** `fence_probe_rearm_after_routable`: a sim root born while
every routed send fails keeps its three tries; when sends start landing
it probes once more and fills from the holder; with the fix deleted the
budget is gone before the mesh forms. Red with the fix deleted.

### (d) The bounded merge

With (b) and (c) in place, a spurious root finds the true root on its
own verify within 45 s plus one lookup, whenever a routed path exists.
What remains is the case where the TRUE root must learn of the spurious
one, and the step-down discipline.

**Triggers.** Any of:

1. Root self-verify finds a strictly closer visited node — (b).
2. A subscriber's renewal re-walks a HEALTHY pin on a cadence and the
   walk's closest visited node differs from the pin. Today renewal
   unpins only on a failed dispatch (AxonaManager.js:1290–1307); this
   adds a periodic re-walk, one per `ROOT_VERIFY_MS`, and on mismatch the
   subscriber tells its pinned root the other root's id. The wire surface
   is the SUB the subscriber already sends on every renewal
   (`_emitSubscribe`, AxonaManager.js:1316–1322): one added field,
   `walkRoot` (hex id of the walk's closest visited node, absent when it
   equals `via`). `_onSub` (wireHandlers.js:~318–351) reads it at the
   root; a `walkRoot` that is not self and is strictly closer than self
   is trigger 1's input. No new verb; a pre-v0.2 root ignores the field.
3. A root with no subscribers runs a slow self-lookup (Orion's closure,
   one per 60 s) and treats a strictly closer visited node as trigger 1.
4. A replica or handoff carrying a foreign root epoch.

**Direction, read from source.** `PULLUP` runs from a REQUESTER to a
HOLDER: `_syncPull` routes it with `parentId` set to the requester
(syncEngine.js:120–129), `_onPullUp` (wireHandlers.js:750–752) hands it
to `_syncAnswerPull`, and the holder routes `REPLAYUP` back to
`parentId` (133–140), where `_onReplayUp` (762–766) ingests it under the
REPLAY_UP policy. The node that pulls is the node that ingests. v0.3
had the loser pull from the winner, so the loser ingested the winner's
state and acked the winner: nothing moved the loser's unique history
into the winner, and no authorization came back to the loser. Aster
436ca7b6. The machine below puts the WINNER on the requester side.

**The merge machine.** Two roots for one topic, W the one that WINS under the Part 3 relation, L the other. One merge per (topic, L, W) at a time, bound by `corr`,
`winnerEpoch` and `loserEpoch` in every frame. Four messages, two of
them new.

1. **OFFER, L → W.** When the trigger fires at L (its own verify's closest visited node, a subscriber's `walkRoot`, a beacon, or any inventory row names a claim that WINS over L's own under the Part 3 relation), L mints `corr` and routes `MERGE_OFFER {topicId, corr, loser,
   loserEpoch, hw, lw, count}` to W. L stays root, keeps stamping, keeps
   serving; nothing is cut yet. L records `openMerges[corr] = {winner:
   W, winnerEpoch: null, state: 'offered'}`. A new OFFER to the same W
   with a higher `loserEpoch` supersedes the old record; a lower one is
   stale.
2. **PULL, W → L.** W starts its pull on any of: a `MERGE_OFFER` from a
   node strictly farther than itself; a subscriber's `walkRoot` naming a
   farther node that claims root; a replica or beacon carrying a foreign
   root epoch for the topic. If the trigger reached W first, W mints
   `corr` itself. W evaluates the Part 3 relation before anything else: W pulls only from a claim it wins over; if the other claim wins over W's, W is the loser and runs step 1 toward it instead; the relation is a total order, so exactly one of the two holds. W records
   `openPulls[corr] = {loser: L, loserEpoch, cursor: null, framesIn: 0,
   held: 0, sent: 0, startedAt}` and routes `PULLUP {topicId, corr,
   parentId: W, winnerEpoch, cursor: null, sinceHw: 0}` to L. That
   `PULLUP` is the message that begins the winner's ingest; it is the
   shipped verb with three fields added.
3. **FRAMES, L → W.** On a `PULLUP` carrying `corr`, L binds the record:
   if `corr` matches an offer it made, L fills `winnerEpoch`; if no offer exists, L opens the record only when the requester's claim, (requester id, `winnerEpoch`), wins over L's own (L's id, L's epoch) under the Part 3 relation; anything else is logged `merge-stale` and dropped. At the bind L CUTS and
   GATES, in that order and in one tick: the export list is fixed from
   the cache and the active dels as they stand (the cursor section
   below), and `role.merge.gate = {winner: W, winnerEpoch, corr, at}`
   is set. While the gate is set L stamps nothing. The gate's forward
   is its own contract, stated here because v0.5 got it wrong:

   - **Placement.** A `_mergeGateIntercept(topicBig, type, payload)`
     runs in `_onPub` and `_onKill` directly after `_holdIntercept`
     (wireHandlers.js:457; the KILL twin near 1145) and before the
     beacon correction, for any write that reaches L while
     `role.merge.gate` is set. `_reroute` is never called for a gated
     write: it pops a via and sends toward the topic id
     (AxonaManager.js:418–421), and in a split that route can return to
     L.
   - **Target.** The write is forwarded to W BY NAME, `via: [W]`,
     through the same dispatch `_forwardToRoot` (AxonaManager.js:909)
     performs: a write flight is opened or joined at L, the publisher's
     `attemptId` is threaded so the chain stays one attempt, and the
     forwarded write carries `ackTo`, `flightNonce` and `attemptId`. Two
     differences make it a sibling and not a call. First, the helper's
     handling of a `consumed` verdict attributed to the target demotes
     the sender with `defer-confirmed` (the lines after
     AxonaManager.js:944); the gated forward does not demote on any
     verdict. A verdict is hop-local evidence; the only thing that moves
     L's claim is step 5. Second, the epoch authority. `_flightOpen`
     (writeFlight.js:75) takes no epoch: it reads `_rootBeacons` and
     stores 0 when no record exists (79–81), and `_flightComplete`
     accepts an ack at ANY epoch from the right node when the flight's
     epoch is 0 (121). A merge flight must not depend on whether a
     beacon for W happens to be present or fresh. The sibling calls
     `_flightOpen` with an explicit sixth argument, `expectedEpoch =
     winnerEpoch` as carried by the validated PULLUP and held in
     `openMerges[corr]`; when that argument is given the flight's key is
     (topic, W, expectedEpoch), its `epoch` field is that value and is
     never 0, and `_flightComplete`'s unversioned exemption does not
     apply: an ack from W at any other epoch is
     `write-flight-ack-epoch-mismatch` and discharges nothing. The
     beacon record is not consulted for a merge flight at open or at
     complete. The same `winnerEpoch` is what step 5 matches in the
     `REPLAYACK`; one authority for both.
   - **W re-mints during the gate.** A root entering ROOT takes a new
     epoch (rootClaim.js:220). If W does so after the bind, every frame
     and ack from the new incarnation carries the new epoch. L learns
     of it by the first of: an ingest ack rejected as
     `write-flight-ack-epoch-mismatch`, a `REPLAYACK` or `REPLAYUP`
     whose `winnerEpoch` differs from the bound one (already
     `merge-stale`), or a beacon from W with a higher epoch. On any of
     them L aborts the round: the gate clears, `openMerges[corr]` is
     dropped, L keeps root under its own epoch, and forwarded writes
     that the old incarnation never acked are the publisher's to
     re-send. The next trigger issues a NEW `MERGE_OFFER` with a new
     `corr`, and the bind takes the new `winnerEpoch` from the new
     PULLUP. Nothing from the old round discharges a write or demotes L.
   - **Discharge.** The forwarded write is discharged at L only by W's
     signed ingest ack arriving at `_onIngestAck` for that flight, bound
     to W and `winnerEpoch` as every flight ack is. The publisher's own
     flight, opened toward L as its suspect root, is not satisfied by an
     ack from W, by the flight rule that an ack from a different holder
     proves nothing about this seat; it runs its receipt-bound recovery
     and re-sends after `INGEST_ACK_MS`. The re-send lands at W by the
     walk if L has demoted by then, or at L's gate again, and W dedups
     by `msgId`. That delay on the publisher's confirm is the gate's
     cost to a writer, and it is bounded by the gate.
   - **Re-entry.** The forwarded write carries a `gateFwd` nonce
     recorded in a bounded ledger at L, the shape of `holdFwd`
     (wireHandlers.js:241–246, `HOLD_FWD_MAX` entries, `HOLD_REENTRY_MS`
     expiry). A write carrying L's own `gateFwd` that returns to L is
     marked undeliverable with reason `merge-gate-return`, not forwarded
     again and not stamped; the publisher's flight recovers it. A
     ledger at capacity refuses with `merge-gate-saturated`, same
     outcome.
   - **Unreachable or refusing W.** A gated forward whose verdict is
     `failed`, or whose flight passes `INGEST_ACK_MS` with no ack from
     W, ends the round: L clears the gate as it would on
     `MERGE_TIMEOUT_MS`, keeps root under its epoch, and the next
     trigger takes a new `corr`. A winner that cannot take a write
     cannot take a frame either. Writes already forwarded are W's if W
     ingested them and the publisher's to re-send if not; a late ack
     from W after the gate has cleared closes its flight entry and
     changes nothing about L's claim, logged `merge-late-ack`.

   L's existing subscribers keep receiving what L holds; a message
   stamped at W during the gate reaches them after step 5, through L's
   replay as W's child. The linearization point is the cut: every
   message is stamped either at L before it or at W after it, and none
   at both. L answers `REPLAYUP {topicId, corr, loserEpoch, cursor,
   more, msgs, dels}` to `parentId`,
   each frame at most `REPLAY_CHUNK_BYTES` (constants.js:298, the
   budget replay already uses), from its snapshot in export order.
   `_syncAnswerPull` answers when the cache OR the active dels are
   non-empty (the return at syncEngine.js:135 moves; a tombstone-only
   role transfers its dels). W ingests each frame through the REPLAY_UP
   union, validates `corr`, `loserEpoch` and cursor continuity, adds the
   frame's counts to `held` and `sent`, and on `more: true` routes the
   next `PULLUP` with `cursor` set to the frame's last cursor.
4. **ACK, W → L, terminal only.** After the frame carrying `more: false`
   is applied, W routes `REPLAYACK {topicId, corr, winner, winnerEpoch,
   loser, loserEpoch, held, sent}` with the aggregate over every frame
   under `corr`, closes `openPulls[corr]`, and keeps its claim. W sends
   nothing after an intermediate frame.
5. **STEP-DOWN, at L.** On a `REPLAYACK` matching `openMerges[corr]` on
   all six of `topicId`, `corr`, `winner`, `winnerEpoch`, `loser`,
   `loserEpoch`, that passes the retention check in the section below, L mints `role.merge.releaseToken` and runs `demote(W)` (rootClaim.js:374–395) with that token in `ctx`, the one call `_set` accepts on a role with custody: upstream pinned to W, step-down hold armed, a confirming SUB sent with L's `hw` and `lw`, the token consumed, and the gate cleared with the role. Nothing is outstanding at that moment: L stamped nothing
   after the cut, and the ack covered the whole export. The `hw` pull
   `_onSub` may run on that SUB (wireHandlers.js:343–345) is a backstop
   and not the mechanism; the invariant does not depend on it. W's
   unique bodies and tombstones reach L by the shipped path: L's
   since-all replay as W's child. `held < sent` leaves L rooted; L
   clears the gate, resumes stamping under its unchanged epoch, and the
   trigger fires again on the next verify with a NEW `corr`. The same
   happens if no terminal ack arrives within `MERGE_TIMEOUT_MS` of the
   bind. An ack with an unknown `corr`, a mismatched epoch, or arriving
   while L's record shows frames outstanding, is logged `merge-stale`
   and dropped. A send outcome is never a step-down input.

What each side holds when the machine ends: W holds the union of both
histories, every message forwarded during the gate included, minus
everything tombstoned on either side; L, now a child, converges to the
same set within one replay. The invariant in Part 3 is the statement
about W at the moment L sheds root, and step 5 is the only place L
sheds it. The cost of the gate is a latency bubble for L's subscribers,
bounded by the gate's duration, which the bound below states.

**One authority for demotion.** The kernel at 6bc3ff4 demotes a root
from five places, and v0.7 added a sixth and contradicted itself. For
a MERGE-CAPABLE root, one that runs this packet's kernel, every path
that would call `demote()` on a role with custody instead calls one
function, `_mergeCandidate(topic, winner, winnerEpoch, source)`, which
applies the Part 3 winner rule and, if the candidate wins, runs step 1
or joins the open round. `demote()` on a role with custody is reachable
only from step 5. A role without custody (empty cache, no active
tombstone) demotes directly, as today. The inventory, each with its
source and its v0.8 disposition:

| Path at 6bc3ff4 | Where | v0.8 for a root with custody |
|---|---|---|
| verify-closer | rootElection.js:363 | candidate (b) |
| beacon-closer, epoch-superseded | rootElection.js:125–127 | candidate; a beacon naming the open round's W is a no-op; a beacon naming a different winner is queued as the next candidate and applied after the round ends |
| defer-confirmed on attributed consumption | AxonaManager.js:938–940 | never on a gated forward (v0.6); on an ungated forward from a root with custody, candidate, not demote |
| handoff heir reconciliation | rootClaim.handoffArrived, syncEngine.js:208–211 | a heir with custody that learns of a closer live root: candidate |
| step-down hold target | rootClaim.holdTarget, wireHandlers.js:239–249 | unchanged: a held node has already shed its claim and holds no custody of the topic's root |
| write-flight recovery promotion | writeFlight.js re-flight after `INGEST_ACK_MS` | promotion creates a root; a root created by promotion that then meets any of the above goes through the candidate path like any other |

During an open round, a beacon or a verify result that would name a
different winner does not demote and does not abort; it is queued.
After step 5 or an abort, the queued candidate is evaluated against the
Part 3 rule from scratch. `fence_dual_root_authority_single_path` pins
every row.

The table is the inventory; it is not the enforcement. Guarding the
callers of `demote()` misses the path that never calls it: `_onAdopt`
(wireHandlers.js:437–440) runs `adoptChild`, which calls `_set(role,
false, 'adopted-child')` directly (rootClaim.js:490) on an existing
root. `role.isRoot` changes in exactly one function, `_set`
(rootClaim.js:215, "the ONLY place role.isRoot changes"), so the
custody condition lives there. For a merge-capable node, `_set(role,
false, why, ctx)` on a role with custody flips the flag only when `ctx`
carries `releaseToken` equal to `role.merge.releaseToken`, a value
minted at step 5 on a valid terminal ack and consumed by that one
flip. Every other ROOT→non-ROOT call on a role with custody is refused:
the flag stays, the call is logged `custody-refused` with its `why`,
and `{why, ctx}` is recorded as `role.merge.nextCandidate` for
evaluation under the Part 3 relation when the round ends. That covers
`demote()`, `adoptChild`, `handoffArrived`'s yield, and any path added
later, because there is no other door. An ADOPT that arrives at a root
with custody is therefore deferred, not applied: the delegating parent
gets no child from this node until the round closes, and the parent's
claim becomes the next candidate. `fence_dual_root_adopt_during_merge`
sends an ADOPT to a root with custody mid-round and requires the flag
to hold and the candidate to be queued; with the gate at `_set`
removed, the flip goes through.

**Mixed versions.** A legacy peer does not run this machine. The
guarantee holds only when both roots are merge-capable, and the packet
says what happens otherwise rather than letting a legacy peer inherit
it silently. L merge-capable, W legacy: W drops `MERGE_OFFER` as an
unknown frame, and a PULLUP from W never carries `corr`. If no bound
arrives within `MERGE_OFFER_TIMEOUT_MS` and W's kernel version, read
from its beacon or handshake, is below this packet's, L logs
`merge-legacy-fallback` and takes today's path: `demote()` with the SUB
carrying `hw` and `lw`, so the legacy W pulls what the shipped
SPLIT_UNION rule pulls (wireHandlers.js:343–348), with the delta-only
weakness v0.2 named. L merge-capable, W merge-capable: the machine. L
legacy, W merge-capable: W's trigger sends a PULLUP with `corr`; the
legacy L answers plain REPLAYUP without `corr`; W ingests it as a
legacy union, logs `merge-legacy-peer`, cannot ack-demote L, and L
demotes by its own legacy paths when they fire. Fence
`fence_dual_root_legacy_fallback` covers the first case; the third is
today's behaviour and needs no fence beyond the existing suite.

**The cut at the mutation point.** A check at the handler's entry is
not a cut. `_onPub` enters `_ingestPublish` (wireHandlers.js:496) and
that function awaits `verifyEnvelope` (501) and `deriveTopicIdBig`
(509) before the stamp and `_cachePush` at 536–541; a write admitted
before the cut can resume after it and commit into a cache the export
has already left. KILL has the same shape: `_onKill` awaits
`verifyKill` and then commits through `_applyKill` (wireHandlers.js:
1058); the stamped ingests (`_ingestStamped`, from REPLAYUP, REPLICATE
and HANDOFF) commit through `_cachePush` too, and their tombstones
through `_applyDels` (topicStore.js:111). So the cut is defined at the
commit, not the entry:

- Every role carries `role.gen`, an integer. The cut increments it and
  takes the snapshot in the same synchronous run, with no await
  between.
- Every commit path captures `gen` once, synchronously, immediately
  before its mutation, and compares it to the value it captured at
  entry. `_ingestPublish` does this at 536, before the stamp: if `gen`
  moved, or `role.merge.gate` is set, the write is not stamped; it is
  handed to the gate's forward (v0.6) as if it had arrived after the
  cut, and the function returns a disposition the caller treats as
  forwarded, not ingested, so no ingest ack is sent for it from L.
  `_onKill` does the same immediately before `_applyKill`.
- Tombstones are mutations too, and they commit first. `_syncIngest`
  applies a transfer's dels before its bodies (syncEngine.js:206–207);
  `_applyDels` awaits proof verification and then calls `_applyKill`
  for each entry (topicStore.js:119–121). So the check sits at the two
  mutation points themselves: `_cachePush` and `_applyKill` each take
  the caller's entry-time `gen` and refuse, returning a refusal the
  caller must propagate, when `role.merge.gate` is set or `gen` has
  moved. `_applyDels` captures `gen` after its await and immediately
  before `_applyKill`, per entry.
- A whole transfer at a gated L is refused before anything is applied.
  The HANDOFF branch of `_syncIngest` checks the gate synchronously at
  its top and, if set, applies no del and no body and sends NO
  HANDOFFACK, which is the refusal the leaver already understands
  (syncEngine.js:203, "refuse: stay silent, leaver retries"): it
  retries another heir and cohort-sprays. A short ack would be wrong
  here, since `held = sent = 0` on a tombstone-only transfer reads as
  success at the leaver. REPLAYUP and REPLICATE at a gated L return
  `rejected` for every entry, which their senders already treat as not
  held. Nothing foreign, body or tombstone, enters L's state behind
  its export.
- The `_mergeGateIntercept` at the handler entry stays, as the cheap
  early path; the check at the commit is the one the invariant relies
  on.

`fence_dual_root_cut_async_ingress` pauses a verifier across the cut
and requires the resumed write to reach W and never L's cache;
`fence_dual_root_gated_ingest_refused` sends a HANDOFF at a gated L and
requires no ack and the leaver's retry;
`fence_dual_root_tombstone_only_handoff_gated` sends a tombstone-only
HANDOFF at a gated L and requires the same, with the mutant sending
`held = sent = 0`; `fence_dual_root_migrated_delete_across_cut` pauses
`_applyDels` inside its proof await across the cut and requires the
delete refused at `_applyKill` and absent from L's export.

**Retention, not count.** `_ingestStampedBatch` returns `held`, which
counts an ingest that was newly cached, already cached or suppressed
by a tombstone (782–798 and the outcome contract below it), and
`_cachePush` evicts at the count and byte caps the moment the cache is
over them (topicStore.js:35–40). A W that ingests every frame can
report `held` equal to `sent` and have evicted the first frame, or its
own history, before the ack. Counts do not authorize custody release.
v0.8 replaces them:

- **Manifest.** The export carries a manifest under `corr`: the ordered
  list of body `msgId`s and the list of tombstone `msgId`s, with a hash
  over both. Each frame carries its slice; the terminal frame carries
  the whole manifest's hash and counts.
- **Admission, sized at the cut.** The OFFER's `count` and bytes are
  an estimate: L keeps stamping until the bind, so the export can be
  larger than the offer. The authoritative sizing is the CUT MANIFEST
  HEADER: L's first answer to the first PULLUP, after the cut, is a
  frame with no bodies and no dels, `REPLAYUP {corr, header: {bodies,
  dels, bytes, hash}, more: true}`. W admits or refuses on the header,
  before any data commit: it must hold its BASELINE (every entry and
  active tombstone it has now) plus the header's bodies and bytes plus
  `MERGE_WRITE_RESERVE` entries and bytes under `_cacheMax` and
  `_cacheBytes`. If it cannot, W answers `REPLAYACK {disposition:
  'refused-capacity', retained: 0, ...}`; L clears the gate, which was
  set for one header round trip, keeps custody, and the round ends. A
  refusal is logged on both sides. The topic stays split until capacity
  exists or the TTL reduces the export, and the packet says so: that is
  safety over liveness, chosen. `fence_dual_root_growth_offer_to_cut`
  stamps at L between the OFFER and the bind until the cut export
  exceeds W's remaining capacity by the offer's margin: W must refuse
  on the header; the mutant admits on the offer.
- **Pinned custody, both sides of W's cache.** On admission W pins its
  baseline and the manifest's `msgId`s for the round's life, and sets
  aside the reserve. `_cachePush`'s eviction loop never evicts a pinned
  entry; the admission arithmetic guarantees pins plus reserve fit, so
  pin saturation cannot arise and no eviction runs during the round.
  The TTL still expires entries older than the hold on both sides; a
  manifest body the TTL has expired at W by ack time counts as
  expired, not missing, since L's copy has expired by the same clock,
  and the terminal check says which it counted.
  `fence_dual_root_full_w_unique_baseline` fills W to its cap with
  unique bodies, offers a small export, and requires W to refuse with
  its baseline intact; the mutant evicts baseline to admit.
- **W's own writes, fail closed.** W's writes during the round consume
  the reserve. When the reserve is exhausted W refuses further writes
  of its own on the topic with the disposition `refused-merge-reserve`,
  the writer's flight recovers after `INGEST_ACK_MS` as any refused
  write does, and nothing is queued at W: a zero-length queue is the
  bound. The stall is at most one round and is stated as the merge's
  cost to writers at W. `fence_dual_root_reserve_exhaustion` writes at
  W past the reserve mid-round and requires the refusal, the writer's
  recovery after the round, and no eviction; the mutant admits past the
  reserve and the fence fails on the evicted pin.
- **Terminal check.** The `REPLAYACK` carries `retained` and
  `delsActive`, computed at ack time from W's `cacheIds` and active
  dels against the manifest, and the manifest hash. L releases custody
  only when every manifest body is either in W's `cacheIds` or covered
  by a tombstone active at W, every manifest tombstone is active at W,
  and the hash matches. Anything less is a short ack: L keeps custody,
  the round ends, and the next trigger starts a new one.

`fence_dual_root_retention_ack` has W ingest every frame and evict one
manifest entry by cap before the ack: L must not release.
`fence_dual_root_capacity_refused` has two individually valid caches
whose union exceeds W's cap, with W writing concurrently and a
tombstone-only export among the cases: W must refuse, L must keep
custody. `fence_dual_root_manifest_dels` has a manifest tombstone that
W failed to apply: the ack must be short.

**The cursor.** The cache appends in ascending `publishTs`
(topicStore.js:25–29; rootClaim.js:82) and defines no order among
entries that share a stamp, so "cache order" is not a cursor. The export
order is defined at the cut in step 3: L sorts its cache by
(`publishTs` ascending, `msgId` ascending as a hex string), appends the
active dels, and keeps that list under `openMerges[corr].snapshot` for
the life of the merge.
The cursor carried in frames is the pair (`publishTs`, `msgId`) of the
last entry sent, opaque to W, and L validates every incoming cursor
against `openMerges[corr].lastCursorSent`: equal means continue,
anything else means W restarts with a new `corr`. A frame never ends
inside an equal-stamp group unless the group alone exceeds a frame, and
then the pair still advances within it. No entry is stamped at L after
the cut, so the export is total and there is no tail. Entries the TTL
expires out of the live cache during the merge stay in the snapshot, so
a long merge does not lose its own head; the snapshot is released when
the record closes.

**State added.** On every root: `role.sync.openMerges` (map corr →
{winner, winnerEpoch, loserEpoch, state, snapshot, lastCursorSent,
offeredAt, boundAt}), `role.merge.gate` ({winner, winnerEpoch, corr,
at} or null), `role.merge.gateFwd` (bounded nonce ledger, the shape of
the hold's) and `role.sync.openPulls` (map corr → {loser, loserEpoch,
cursor, framesIn, held, sent, startedAt}). On a subscriber:
`sub.lastWalkRoot`; `role.gen` on every role; `role.merge.pins` (the
manifest's msgIds, pinned for the round) and `role.merge.reserve` on W;
`role.merge.nextCandidate` and `role.merge.releaseToken` on L; a
header frame (`header` on REPLAYUP) as the first answer under every
`corr`. Constants: `MERGE_TIMEOUT_MS`,
`MERGE_OFFER_TIMEOUT_MS`, `MERGE_WRITE_RESERVE`, each derived or sized
below. One new function, `_mergeCandidate`, the single entry every
demotion path takes for a root with custody. One new handler,
`_mergeGateIntercept`; one sibling of `_forwardToRoot`
that shares its dispatch and flight, omits its demotion, and passes the
epoch; one new optional argument on `_flightOpen`, `expectedEpoch`,
which when present overrides the beacon-derived epoch, forbids 0, and
removes the unversioned exemption in `_flightComplete` for that flight.
Callers that do not pass it behave as today. Two new frame types, `MERGE_OFFER` and `REPLAYACK`,
registered beside HANDOFF and HANDOFFACK in constants.js and
boundary1Registry.js; three fields added to `PULLUP` (`corr`,
`winnerEpoch`, `cursor`) and four to `REPLAYUP` (`corr`, `loserEpoch`,
`cursor`, `more`). The SPLIT_UNION quench at syncEngine.js:121–126 is
untouched; a merge pull is never SPLIT_UNION.

**Safety, unconditional.** Without any assumption about scheduling,
reachability or delivery: a merge-capable root with custody sheds its
claim only at step 5, on a terminal ack that passed the retention check,
bound to one winner and one epoch; nothing admitted before the cut
commits into a cache the export has left; nothing the loser held is
released before the winner has shown it holds it; a refused, short,
stale or late ack leaves the loser rooted. Two roots that never find
each other stay two roots and lose nothing. That is the invariant's
safety half, and it is what the fences in Part 6 exercise.

**The bound, conditional.** `VIA_HOP_BUDGET` is 8 hops
(constants.js:295), a count, not a duration; `ROOT_VERIFY_BATCH` is 3
lookups per tick (354–356), so a root holding N topics due at once
waits up to ⌈N/3⌉ ticks for its council verify; a path's existence does
not make a lookup visit W or a frame arrive. A time bound therefore
needs assumptions, named:

1. **Fair verify scheduling.** L's verify for the topic runs within
   `ROOT_VERIFY_MS` + ⌈N/3⌉ × tick of its due time, N the roots L holds.
2. **Lookup coverage.** With (b) and (c) in place, a lookup from L
   visits W whenever a routed path exists between them.
3. **Bounded service.** Every routed send and every ingest in the round
   completes within S, a service time MEASURED on the fleet (the relay
   RTT matrix of 2026-10-08 gives one-hop p50 of 39 ms; the merge's S
   is the frame's end-to-end time and is read, not derived).
4. **Retries succeed.** A round that aborts on a transport failure
   succeeds within R further rounds.
5. **Capacity admitted.** W admits the cut manifest. A capacity-refused
   split persists under assumptions 1–4 alone, for as long as the
   refusal holds; it is safe, not live, and the bound does not cover
   it.

Under 1–5, with V = `ROOT_VERIFY_MS`, Lk = one lookup, F the frames the
export needs at `REPLAY_CHUNK_BYTES` (fixed at the cut), and A =
`HANDOFF_ACK_MS` × `HANDOFF_TRIES` plus the per-topic margin, capped
`HANDOFF_ACK_MAX_MS` per round:

- detection ≤ V + ⌈N/3⌉ × tick + Lk;
- one round ≤ S (offer) + (1 + F) × 2S (pull and frames) + S (ack);
- T_recon ≤ detection + (1 + R) × one round.

`MERGE_TIMEOUT_MS` bounds ONE gate interval, not reconciliation: it is
2 × ((2 + 2F) × S + A), never below `HANDOFF_ACK_MAX_MS`, measured from
the bind, and a subscriber of L sees nothing new for at most that long
per round. If assumption 3 fails the round aborts at that timeout and
assumption 4 is what carries the next; if assumption 2 fails the roots
stay two and safety holds. None of these figures is a floor and all of
them move with S.

## Part 5 — ops items, in parallel, not kernel

1. **A seat's handoff is readable.** The reconnect already hands off
   (Part 2a). What is missing is the record: the heir's
   `handoff-ingested` line is debug on a relay unless a message was
   rejected (syncEngine.js:223–224), and the leaver keeps nothing.
   Change: the relay logs `handoff-ingested` at info; `reconnect()`
   returns the leave's handoff outcome (`topics`, `acked`, `unacked`)
   read from the manager's `_handoffAcked` ledger before the transport
   stops, and `axona_status` keeps the last one. Fence: a seat that roots
   a sim topic and reconnects leaves the history on its heir, and the
   reconnect's return names the topic and the ack.
2. **`axona_status` exposes the seat's roles.** Per watched topic:
   `isRoot`, `nature`, `upstream` (pinned via), `cacheSize`, `lastVerify`
   outcome. The relay fleet got its counters in 0.161.0; the seats have
   none, and that is why the seat-side root of 10-16 cannot be named.
3. **Two scripts into `ops/`.** `cold-read-topic.mjs` (a fresh seat
   replays a topic and prints the upstream it pinned) and
   `cold-lookup-topic.mjs` (a fresh seat runs the lookup and prints the
   path, terminus and the closest visited node). Both ran tonight from
   the scratchpad; forty seconds each.
4. **The roll procedure.** RELEASE-PROCEDURE.md gets one line before §6:
   read who roots `#council` and the standing topics with
   `cold-lookup-topic.mjs` before the first host restarts, and again
   after the last. A roll that moves a standing topic's root to a
   relay born in the roll is the condition this packet exists for.

## Part 6 — fences

Every fence passes with its fix and fails with the fix deleted, on the
same tree, and the manifest records both runs. Mutants are named per
fence as in the two-pool packet. Forty-three fences in v0.9; the four
added over v0.1, the two over v0.2, the five over v0.3, the four over
v0.4 (one replacing `tail_closed`), the four over v0.5, the two over
v0.6, the eight over v0.7 and the seven over v0.8 come from Aster's
eight readings.

| Fence | Pins | Red without |
|---|---|---|
| `fence_verify_closest_visited` | (b) | the mid-path closer node is ignored |
| `fence_lookup_no_revisit` | (c) | the walk revisits and runs to the cap |
| `fence_probe_rearm_after_routable` | (a) | budget spent while routes fail, no re-arm |
| `fence_dual_root_hand_fork` | (d) | two sim roots forked by hand never merge |
| `fence_dual_root_partition` | (d) | two roots on disconnected sides do not merge; merge within T_recon once a path is restored; the loser keeps serving until the ack |
| `fence_dual_root_full_pull` | (d) | a merge that pulls from high water drops the older half; a union past one frame drops its older half |
| `fence_dual_root_tombstone_only` | (d) | a role holding only tombstones answers a conflict pull with nothing |
| `fence_dual_root_replayack` | (d) | the loser demotes on a send outcome, or on a short ack, or on an ack with the wrong `corr`, peer or epoch |
| `fence_dual_root_terminal_ack` | (d) | two frames, the first fully held, the second carrying unique history and a tombstone; the loser demotes after the first frame's counts match, before the terminal ack |
| `fence_dual_root_equal_stamp_boundary` | (d) | three entries share one stamp and the frame boundary falls after the first; the pair cursor is replaced by the stamp and the second and third are dropped |
| `fence_dual_root_direction` | (d) | the pull is issued by the loser; the winner ends the machine without the loser's unique body and tombstone |
| `fence_dual_root_two_way_unique` | (d) | W holds {a, tomb(x)}, L holds {b, tomb(y)}; after the machine W must hold a and b minus x and y, and L as child must converge; the mutant drops L's dels from the frames |
| `fence_dual_root_stale_round` | (d) | a REPLAYACK carrying a superseded corr or a stale loserEpoch demotes L; a PULLUP from a node not strictly closer opens a merge record |
| `fence_dual_root_cursor_invalid` | (d) | a cursor that does not equal lastCursorSent is answered with the next frame instead of a restart; a snapshot entry expired by TTL mid-merge is dropped from the export |
| `fence_dual_root_cut_is_total` | (d) | a publish reaching L after the bind is stamped at L; the mutant removes the gate |
| `fence_dual_root_gate_forwards_writes` | (d) | a publisher writes through L every 10 ms from before the OFFER to after the demotion; at the end W must hold every one and L none stamped after the cut; the mutant forwards nothing while gated |
| `fence_dual_root_hw_above_export` | (d) | W's high water is above every stamp L holds; every L entry must still arrive under corr; the mutant replaces the cursor pull with the hw delta |
| `fence_dual_root_gate_timeout` | (d) | W dies after the bind; L must clear the gate at MERGE_TIMEOUT_MS, keep root under the same epoch, and the forwarded publishes must be re-sent by their publishers; the mutant leaves the gate set |
| `fence_dual_root_gate_self_return` | (d) | a gated write forwarded to W comes back to L carrying L's own gateFwd; it must be marked undeliverable, not forwarded again, not stamped; the mutant forwards it again |
| `fence_dual_root_gate_w_unreachable` | (d) | W is unreachable at the first gated write; L must end the round, clear the gate, keep root, and the publisher's re-send must land and be stamped at L; the mutant keeps forwarding into the void |
| `fence_dual_root_gate_late_ack` | (d) | W's ingest ack for a gated write arrives after the gate cleared; the flight entry must close and L's claim must not move; the mutant demotes on it |
| `fence_dual_root_gate_no_defer` | (d) | a consumed verdict attributed to W on a gated forward; L must not demote; the mutant forwards through the unmodified helper |
| `fence_dual_root_gate_epoch_authority` | (d) | L holds no beacon for W, or a stale one at a different epoch; W's ingest ack carries the offered winnerEpoch and must discharge the write; an ack at any other epoch must not; L's claim must not move either way; the mutant lets the flight take its epoch from the beacon, so a missing record accepts any epoch |
| `fence_dual_root_gate_w_reminted` | (d) | W re-mints after the bind and before acking; its new-epoch ack must be rejected, the round aborted, the gate cleared, L still root under its epoch, and the next offer must carry the new epoch; the mutant accepts the new-epoch ack |
| `fence_dual_root_authority_single_path` | (d) | for each row of the demotion inventory, the path fires at a root with custody during an open round; the root must not demote and the candidate must be queued; the mutant restores the direct `demote()` on that row |
| `fence_dual_root_authority_empty_cache` | (d) | a root with an empty cache and no tombstone meets a closer root; it must demote directly as today; the mutant routes it through the machine and the fence fails on the extra round |
| `fence_dual_root_legacy_fallback` | (d) | W is a legacy peer; L's offer must time out, L must log the fallback and take today's demote with hw and lw; the mutant waits forever |
| `fence_dual_root_cut_async_ingress` | (d) | a write's verifier is paused before the cut and resumed after it; the write must reach W and never L's cache; the mutant checks the gate only at handler entry |
| `fence_dual_root_gated_ingest_refused` | (d) | a HANDOFF arrives at a gated L; it must return rejected and the leaver must retry elsewhere; the mutant ingests it |
| `fence_dual_root_retention_ack` | (d) | W ingests every frame and evicts one manifest entry by cap before acking; the ack must report it and L must not release; the mutant acks on held equal to sent |
| `fence_dual_root_capacity_refused` | (d) | two individually valid caches whose union exceeds W's cap, W writing concurrently, and a tombstone-only export among the cases; W must refuse and L must keep custody; the mutant admits |
| `fence_dual_root_manifest_dels` | (d) | a manifest tombstone W failed to apply; the ack must be short; the mutant counts bodies only |
| `fence_dual_root_crossed_claims` | Part 3 | A closer at epoch 1, B farther at epoch 2, both live; each must name B the winner, A must offer, B must pull, A must never pull; the mutant runs the kernel's yield predicate and the fence fails on crossed offers |
| `fence_dual_root_adopt_during_merge` | (d) | an ADOPT reaches a root with custody mid-round; the flag must hold and the parent must be queued; the mutant removes the gate at `_set` |
| `fence_dual_root_tombstone_only_handoff_gated` | (d) | a tombstone-only HANDOFF reaches a gated L; no ack, leaver retries; the mutant sends `held = sent = 0` |
| `fence_dual_root_migrated_delete_across_cut` | (d) | `_applyDels` paused inside its proof await across the cut; the delete must be refused at `_applyKill` and absent from the export; the mutant checks only at the transfer's top |
| `fence_dual_root_growth_offer_to_cut` | (d) | the export grows past W's capacity between OFFER and cut; W must refuse on the header; the mutant admits on the offer |
| `fence_dual_root_full_w_unique_baseline` | (d) | W at cap with unique bodies refuses a small export with its baseline intact; the mutant evicts baseline to admit |
| `fence_dual_root_reserve_exhaustion` | (d) | W's writes past the reserve mid-round are refused, the writer recovers after the round, nothing is evicted; the mutant admits past the reserve |
| `fence_probe_verdicts_awaited` | (a) | a try whose every pull resolved `consumed:false` still counts against the budget |
| `fence_seat_reconnect_handoff_named` | Part 5.1 | a reconnecting seat's handoff leaves no record a host keeps |
| `fence_merge_carrier_named` | Part 2b | the sim runs both candidate paths from a reconnecting seat (HANDOFF; SUB low-water SPLIT_UNION) and either leaves no retained record that distinguishes it from the other |

No fence proves the invariant. A fence exercises one trace, and the
partition fence exercises the trace that matters most; the universal
claim is the argument in Part 3 and in 4(d)'s safety section, and the
fences are what a build must pass before that argument is trusted on
the fleet. The hand-fork fence exercises the mechanics. Both run on
dht-sim first; the relay test harness then runs the hand-fork case on a
real transport.

## What would make this wrong

- A topic with publishers and no subscribers and a root that never
  self-looks-up. Trigger 3 covers it only if the slow lookup is on.
- A lookup that cannot reach the true root at all, so no path visits
  it. Then (b) has nothing to read and (d) waits for a path. The
  10-17 walks did reach it, from a seat, at hop 9.
- A seat-side root whose cache is larger than one REPLAYUP frame. The
  multi-round pull in 4d uses `REPLAY_CHUNK_BYTES` and leaves the round
  bound unsized; the bound in 4d holds for one frame and grows by one
  round trip per frame after it.
- A gate that holds longer than its bound because W answers frames
  slowly but never stops. `MERGE_TIMEOUT_MS` is measured from the bind,
  not from the last frame, so a slow W ends the round at the timeout
  and L resumes; the fence for the timeout covers a W that dies, and a
  W that merely crawls is the same case to L.
- A publisher whose forwarded publish reaches W and is confirmed there,
  then re-sent to L after the gate clears on a failed round. The root
  dedups by `msgId`, so the second copy is dropped wherever it lands;
  the cost is one duplicate send, not a duplicate message.
- A writer that publishes through L during the gate and reads its own
  confirm late: its flight toward L is not satisfied by W's ack and
  re-sends after `INGEST_ACK_MS`. That is one ack window per write in
  the gate, by design, and the fence for a writer through the whole
  merge counts it. If that cost is too high for a topic, the remedy is
  a proxied ack signed by L naming W's ingest, which v0.6 does not
  design because it would let L vouch for an ingest it did not see.
- Both nodes detecting at once and each sending the other an OFFER. The
  XOR check in step 2 makes exactly one of them the requester; the
  fence for stale rounds covers the crossed offers.
- The carrier of the eleven being the SUB low-water path, or a third
  path, and not the handoff. Source proves the reconnect ran `leave()`
  and that HANDOFF fits; it does not prove the event, and no retained
  record does. The packet holds HANDOFF as the leading hypothesis and
  nothing in Part 4 depends on which it was.
- `_syncPull` returning a promise changing a caller's behaviour. Every
  caller discards the boolean except the SPLIT_UNION quench; the fence
  for (a) runs the existing sync fences on the same tree.
