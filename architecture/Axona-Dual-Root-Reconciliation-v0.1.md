# Axona Dual-Root Reconciliation — design packet v0.5

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
winner by the reroute the kernel already runs for a non-root
(wireHandlers.js:488; 1143–1145), and the export is total. The bound is
then a sum of constants with no publisher term.

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
and `lw` so the winner pulls what only the loser holds. This fixes the
SEAT-side false confirm. Relay to relay the verify already worked: the
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

**The merge machine.** Two roots for one topic, W the XOR-closer, L the
farther. One merge per (topic, L, W) at a time, bound by `corr`,
`winnerEpoch` and `loserEpoch` in every frame. Four messages, two of
them new.

1. **OFFER, L → W.** When the trigger fires at L (its own verify finds a
   strictly closer visited node, or a subscriber's `walkRoot` names
   one), L mints `corr` and routes `MERGE_OFFER {topicId, corr, loser,
   loserEpoch, hw, lw, count}` to W. L stays root, keeps stamping, keeps
   serving; nothing is cut yet. L records `openMerges[corr] = {winner:
   W, winnerEpoch: null, state: 'offered'}`. A new OFFER to the same W
   with a higher `loserEpoch` supersedes the old record; a lower one is
   stale.
2. **PULL, W → L.** W starts its pull on any of: a `MERGE_OFFER` from a
   node strictly farther than itself; a subscriber's `walkRoot` naming a
   farther node that claims root; a replica or beacon carrying a foreign
   root epoch for the topic. If the trigger reached W first, W mints
   `corr` itself. W checks XOR before anything else: a node that is not
   strictly farther is not a loser, and if the other node is closer, W
   is the loser and runs step 1 toward it instead. W records
   `openPulls[corr] = {loser: L, loserEpoch, cursor: null, framesIn: 0,
   held: 0, sent: 0, startedAt}` and routes `PULLUP {topicId, corr,
   parentId: W, winnerEpoch, cursor: null, sinceHw: 0}` to L. That
   `PULLUP` is the message that begins the winner's ingest; it is the
   shipped verb with three fields added.
3. **FRAMES, L → W.** On a `PULLUP` carrying `corr`, L binds the record:
   if `corr` matches an offer it made, L fills `winnerEpoch`; if no
   offer exists, L opens the record only when the requester is strictly
   closer than L for the topic and carries a `winnerEpoch`; anything
   else is logged `merge-stale` and dropped. At the bind L CUTS and
   GATES, in that order and in one tick: the export list is fixed from
   the cache and the active dels as they stand (the cursor section
   below), and `role.merge.gate = {winner: W, corr, at}` is set. While
   the gate is set L stamps nothing. A bare PUB or KILL that reaches L
   is rerouted to W exactly as a non-root reroutes one today
   (wireHandlers.js:488 for PUB; 1143–1145 for KILL), and as the
   4.102.0 step-down hold already does for a held node; the publisher's
   pending re-send (`PENDING_PUB_TTL_MS`, constants.js:302) covers a
   forwarded publish that W does not confirm. L's existing subscribers
   keep receiving what L holds; a message stamped at W during the gate
   reaches them after step 5, through L's replay as W's child. The
   linearization point is the cut: every message is stamped either at L
   before it or at W after it, and none at both. L answers `REPLAYUP
   {topicId, corr, loserEpoch, cursor, more, msgs, dels}` to `parentId`,
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
   `loserEpoch`, with `held` equal to `sent`, L runs `demote(W)`
   (rootClaim.js:374–395): upstream pinned to W, step-down hold armed, a
   confirming SUB sent with L's `hw` and `lw`, and the gate cleared with
   the role. Nothing is outstanding at that moment: L stamped nothing
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
offeredAt, boundAt}), `role.merge.gate` ({winner, corr, at} or null)
and `role.sync.openPulls` (map corr → {loser, loserEpoch, cursor,
framesIn, held, sent, startedAt}). On a subscriber: `sub.lastWalkRoot`.
One constant, `MERGE_TIMEOUT_MS`, derived below. Two new frame types, `MERGE_OFFER` and `REPLAYACK`,
registered beside HANDOFF and HANDOFFACK in constants.js and
boundary1Registry.js; three fields added to `PULLUP` (`corr`,
`winnerEpoch`, `cursor`) and four to `REPLAYUP` (`corr`, `loserEpoch`,
`cursor`, `more`). The SPLIT_UNION quench at syncEngine.js:121–126 is
untouched; a merge pull is never SPLIT_UNION.

**The bound, derived.** Let V = `ROOT_VERIFY_MS` = 45 s, L = one lookup
(observed 3.6–4.4 s on 10-17 at hop cap 41; shorter once (c) holds), A =
`HANDOFF_ACK_MS` × `HANDOFF_TRIES` = 700 ms × 2 plus per-topic margin,
capped 5 s per round. With a routed path between the roots:

- detection ≤ V + L from the moment the path exists, by trigger 1 or 2;
- union ≤ one OFFER hop plus F PULLUP/REPLAYUP round trips, F the
  number of frames the loser's export needs at `REPLAY_CHUNK_BYTES`,
  each bounded by the via-hop budget; F is fixed at the cut, since no
  entry is stamped at L after it, so a continuing publisher does not
  move F; F is 1 for a council-sized cache;
- step-down ≤ A after the terminal ack lands.

The gate lasts from the bind to the terminal ack or to
`MERGE_TIMEOUT_MS`, whichever is first, so `MERGE_TIMEOUT_MS` is set
from the same terms: (1 + F) via-hop budgets plus A, times two for one
retry round, and never less than `HANDOFF_ACK_MAX_MS`. A subscriber of
L sees nothing new for at most that long.

So T_recon ≤ V + L + (1 + F) round trips + A, under three conditions: the
path exists, the loser's cache fits one REPLAYUP, and the winner is
reachable by the routed send. A cache larger than one frame, or a
routed send that resolves `consumed:false`, breaks the bound and the
fence must show the trigger re-firing on the next verify instead of
silence. The figure is not asserted; it is the sum of constants the
code already carries, and it moves if they move.

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
fence as in the two-pool packet. Twenty-two fences in v0.5; the four
added over v0.1, the two over v0.2, the five over v0.3 and the four
over v0.4 (one replacing `tail_closed`) come from Aster's four
readings.

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
| `fence_probe_verdicts_awaited` | (a) | a try whose every pull resolved `consumed:false` still counts against the budget |
| `fence_seat_reconnect_handoff_named` | Part 5.1 | a reconnecting seat's handoff leaves no record a host keeps |
| `fence_merge_carrier_named` | Part 2b | the sim runs both candidate paths from a reconnecting seat (HANDOFF; SUB low-water SPLIT_UNION) and either leaves no retained record that distinguishes it from the other |

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
