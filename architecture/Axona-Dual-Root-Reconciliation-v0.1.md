# Axona Dual-Root Reconciliation — design packet v0.1

**Status:** DESIGN, for council review. Nothing built. David's word (direct,
04:1xZ 2026-10-17): "Yes, write it." The review bar is Vega's 8cbecf8b
(council seq 182), frozen before this was drafted. Every line number below
is read from axona-protocol at `6bc3ff4` (tag v4.114.1), the kernel the
fleet runs and the relay vendors at 6547229.

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
each one adds, and names the fences that pin them. It does not propose a
wire verb. Everything the merge needs already ships; what is missing is a
trigger that fires, a terminus that is read, and a step-down that waits
for its ack.

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
| 10-17 03:04:17 | svc-11 | eleven seat-side entries (seq 161–171, 16:46Z onward) ingested, original seqs kept. Nobody asked. |
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

A seat's reconnect does not run it. `axona_reconnect` (mcp-session.js,
`reconnect()`) calls `_session.close()`, and the session's `close` is
`stopRelay({ peer, transport })` (ops.js:71), which is `peer.stop()` then
`transport.stop()` (relay.js:416–419). `stop()` (AxonaPeer.js:1327)
unhooks listeners and tears down. It never calls `leave()`. So on
2026-10-17 four seats re-minted their transports and none pushed a cache
to an heir. The one in-process place a seat's history could have left by
design was never reached.

That is an ops defect in axona-relay's session wrapper, not a kernel
defect, and it is one line: `close()` calls `peer.leave()` before
`stopRelay`. Part 5 carries it. It also changes what Part 2b can mean.

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

The count is explained. The carrier is not named, because no relay on any
of the six hosts, neither bridge, and no droplet logs a council role whose
principal was a seat, and the seats keep no log. Two paths in the kernel
fit the shape, and the fence in Part 6 must show which:

- **SUB with low water.** A subscriber that holds a role advertises `hw`
  and `lw` in its SUB (AxonaManager.js:1319–1320). The root, on seeing
  `lw` below its own, pulls the subscriber's FULL range once per (child,
  lw) as `SPLIT_UNION` with `sinceHw: 0` (wireHandlers.js:343–348). That
  is the post-transition split case the code already names. It needs a
  role-holder to subscribe under svc-11. A fresh seat has no role, so the
  carrier would have to be a node that kept one.
- **REPLICATE or HANDOFF arriving at a root.** A root that receives a
  replica or a handoff from a strictly-closer-or-not peer reconciles by
  `handoffArrived` / `liveCloserRoot` (repairPlane.js:1169–1171, syncEngine.js:86).

One more fact narrows the carrier. The eleven include seq 161–163,
stamped 16:46Z–17:09Z on 10-16, before the roll. No relay held them after
17:17:42Z: linux relay-3 took its cache down, and the nyc3 relay that
replaced it was born empty and its probes found nothing. So the carrier's
cache was seeded from something a SEAT kept, which means a seat that
became root by `sub-terminal` between 17:21:38Z and 17:27Z started with
a cache that was not empty. Where a born root's cache comes from when the
claimant was already a subscriber is the first thing the carrier fence
reads.

Either way the ingest is the verified union by `msgId` that REPLAYUP
already does, and either way it carried a DELTA bounded by what a cache
held. Aster's rule follows: conflict repair pulls full state and does not
rely on a high-water comparison, because split histories are incomparable
by water mark. The TTL bounds "full" to 24 hours, and that is the hold the
network promises anyway.

## Part 3 — the invariant

Two roots for one topic may exist only while their control paths are
disconnected. Once a routed path exists between them, within a stated
bound: one deterministic winner remains, the loser's history and
tombstones are unioned into the winner before the loser sheds ROOT, and
the loser does not release its cache until the winner has confirmed the
union.

The winner is the node XOR-closer to the topic id. A tie is impossible
between distinct ids.

What the invariant does not promise: that a publisher whose walk ends at
a spurious root sees its message at the true root before the bound
elapses. Delivery latency inside the bound is a separate measurement.

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
that is not self, and the demotion target is that node. `demote()`
(rootClaim.js:374–395) is unchanged: it pins upstream, arms the
step-down hold when the target is closer, and re-subscribes with `hw`
and `lw` so the winner pulls what only the loser holds.

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

**Change.** A try whose pulls all resolve `consumed:false` (the verdict
`_route` already returns, AxonaManager.js:369–377) does not count against
`EMPTY_ROOT_PROBE_MAX`. The probe re-arms once after the first tick in
which routed outcomes read ok > failed, or after a bounded mesh-ready
criterion (`state=graduated` is the relay's own word for it), whichever
comes first.

**State added.** `role.sync.probeDeferred` (boolean) and the tick's
routed-outcome ratio, which `_tallyRoute` already keeps.

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
   subscriber tells its pinned root the other root's id.
3. A root with no subscribers runs a slow self-lookup (Orion's closure,
   one per 60 s) and treats a strictly closer visited node as trigger 1.
4. A replica or handoff carrying a foreign root epoch.

**Merge.** The root that learns of another root pulls FULL state from
it: a `PULLUP` with `sinceHw: 0`, answered by `REPLAYUP` through the
existing verified union (msgId dedup, tombstone suppression). No new
verb. The pull is one-shot per (peer, epoch) so a refused pull cannot
storm, the 4.22.0 lesson at wireHandlers.js:335–342.

**Step-down.** The XOR-farther root demotes through `demote()` only
after the winner acknowledges the union. The ack rides HANDOFFACK's
existing shape (constants.js:401). Until the ack the loser keeps root
and cache and keeps serving its subscribers. If the ack never comes
within `HANDOFF_TRIES × HANDOFF_ACK_MS` the loser keeps the claim and
the trigger fires again on the next verify.

**State added.** On a root: `role.sync.foreignRoots` (map id → {epoch,
pulledAt, acked}). On a subscriber: `sub.lastWalkRoot`.

**The bound, derived.** Let V = `ROOT_VERIFY_MS` = 45 s, L = one lookup
(observed 3.6–4.4 s on 10-17 at hop cap 41; shorter once (c) holds), A =
`HANDOFF_ACK_MS` × `HANDOFF_TRIES` = 700 ms × 2 plus per-topic margin,
capped 5 s per round. With a routed path between the roots:

- detection ≤ V + L from the moment the path exists, by trigger 1 or 2;
- union ≤ one PULLUP/REPLAYUP round trip, bounded by the via-hop budget;
- step-down ≤ A after the union lands.

So T_recon ≤ V + L + one round trip + A, under three conditions: the
path exists, the loser's cache fits one REPLAYUP, and the winner is
reachable by the routed send. A cache larger than one frame, or a
routed send that resolves `consumed:false`, breaks the bound and the
fence must show the trigger re-firing on the next verify instead of
silence. The figure is not asserted; it is the sum of constants the
code already carries, and it moves if they move.

## Part 5 — ops items, in parallel, not kernel

1. **A seat's reconnect hands off.** `close()` in ops.js:71 calls
   `peer.leave()` before `stopRelay`. One line. Fence: a seat that roots
   a sim topic and reconnects leaves the history on its heir.
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
fence as in the two-pool packet.

| Fence | Pins | Red without |
|---|---|---|
| `fence_verify_closest_visited` | (b) | the mid-path closer node is ignored |
| `fence_lookup_no_revisit` | (c) | the walk revisits and runs to the cap |
| `fence_probe_rearm_after_routable` | (a) | budget spent while routes fail, no re-arm |
| `fence_dual_root_hand_fork` | (d) | two sim roots forked by hand never merge |
| `fence_dual_root_partition` | (d) | two roots on disconnected sides do not merge; merge within T_recon once a path is restored; the loser keeps serving until the ack |
| `fence_dual_root_full_pull` | (d) | a merge that pulls from high water drops the older half |
| `fence_seat_close_hands_off` | Part 5.1 | a reconnecting seat's cache dies with it |
| `fence_merge_carrier_named` | Part 2b | the sim reproduces the 10-17 ingest and the log names the carrier and the policy (`SPLIT_UNION` or handoff) |

The partition fence is the one that proves the invariant. The hand-fork
fence is the one that proves the mechanics. Both run on dht-sim first; the
relay test harness then runs the hand-fork case on a real transport.

## What would make this wrong

- A topic with publishers and no subscribers and a root that never
  self-looks-up. Trigger 3 covers it only if the slow lookup is on.
- A lookup that cannot reach the true root at all, so no path visits
  it. Then (b) has nothing to read and (d) waits for a path. The
  10-17 walks did reach it, from a seat, at hop 9.
- A seat-side root whose cache is larger than one REPLAYUP frame. The
  bound needs the pull chunked, which this packet does not design.
- The carrier of the eleven being neither path in Part 2b. The
  `fence_merge_carrier_named` run answers that before (d) is built.
