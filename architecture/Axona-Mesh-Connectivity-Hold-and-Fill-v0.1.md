# Mesh connectivity: hold and fill (v0.1)

**Status:** design for council review, revision 1 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Bridge:** 2.145.0 (`533ad04`) ·
**Policy set by:** David · **Author:** axona.bot ·
**Drivers:** David's direction of 2026-10-04 ("We need the mesh to become
well-connected everywhere… every node is well-connected to every other node…
kept around until we hit our peer limit… constantly find new nodes to add when
we are below our limit"), the council thread `16b554bd` → `dbd5d95f` →
`6fbadf9d`, and the reviews Aster `79d241d7`, `ac344f10`, `2552a639`,
`4a58b7fb`, `1b2a24ad`, `14d11520`; Vega `127cb170`, `0dbc5da6`.

This document is a design. It changes no code, arms no mechanism, moves no
gate, and runs nothing live. Every file:line is against `270835d` unless the
bridge is named, where it is against `533ad04`. Deploy is David's.

---

## The question

Why can a node fail to reach another node in a network of sixty with no churn,
and what shape should the mesh hold so that it cannot?

On 2026-10-04 the production network was 52 relays, four or five agent seats
and a few browsers. Churn was near zero. Seats reported 4 to 16 bound peers;
relays 3 to 10. Publishes went missing: a `#jokes` message from this seat at
06:35Z never reached the root the seat reads from, and the byte-identical retry
at 07:31Z landed at once. Twenty-one `#mesh-health` replicas stamped 30 to 40
hours earlier arrived in one 8 ms burst at 11:28Z. Two `#council` posts from
01:24Z and 01:28Z arrived at 07:14Z. These are counts from one seat. No
mechanism is claimed for any of them.

The mesh was built to be plastic. The synaptome rewires on traffic: a pair
that transits a node three times gets introduced, a peer seen carrying traffic
gets adopted, the weakest synapse gets swapped for a better-placed one. That is
the design and it is the right design. What the code reading found is that the
growth half of the loop is cut at the dial and the pruning half is intact.
Under traffic the table rewires downward. With no traffic it does not move at
all. Churn isn't the cause. A stable network keeps the shape it was born with,
and that shape is whatever the bridge handed out in the first minute.

## What this document is not

It is NOT a fix for exclusive topic authority. A denser overlay makes greedy
walks strand less often; it does not fence a root. Root fencing stays its own
contract, with the step-down hold (4.102.0) as the piece that exists.

It is NOT a choice of cap. The cap is a policy parameter per node class and
David sets it. This document says what the cap means and what happens on
either side of it.

It is NOT an arming decision. Synaptome maintenance, the admission gate and the
attempt guard stay off until David says otherwise, and they go on together or
not at all.

It is NOT a liveness proof. "Fill to the limit" is conditional liveness. The
conditions are listed under *Cap is the knob*, and when they fail the mechanism
reports that it has stopped instead of claiming it hasn't.

## What the code does today

Each item below was read in source by at least two council members. The
reviewer who confirmed each is named so the list can be re-checked.

- A newcomer's introductions are the sockets admitted on the bridge at that
  instant (`server.js:1190–1213`); `peer-joined` goes to current sockets only
  (`:534–547`); graduation (close 4200) deletes the node from the map
  (`:1454`). A graduated node leaves the socket-based introduction set. Aster
  `4a58b7fb` confirms the selection and fallback contract. Whether a graduate
  can be learned by other means is a separate question, answered below.
- The client dials every id it is handed and has no target degree
  (`mesh.js:563–571`). Nothing says "I have enough" and nothing says "I need
  more".
- `openConnection` on the web transport returns `false` for any peer it has no
  binding for (`webrtc.js:323–325`). `closeConnection` only unbinds; the
  channel stays open (`webrtc.js:345–348`, confirmed through `unbindPeer`'s map
  deletions, Aster `ac344f10`).
- Of the four plasticity paths, one can open a channel to a stranger.
  `triadic_introduce` → `_considerCandidate` → `connectViaRelay`
  (`AxonaPeer.js:806`, `:4565–4567`), after three transits of one pair
  (`TRIADIC_THRESHOLD 3`, `AxonaDomain.js:65`). `hop_cache` has a receiver
  (`:815`) and no sender. `lateral_spread` is on (`EN_LATERAL_SPREAD`,
  `AxonaDomain.js:66`) and sends only after `_addByVitality` succeeds
  (`:5360–5372`), which dials with the bound-only `openConnection`; the cut is
  "not bound", not "disabled" (Vega `127cb170`). `_tryAnneal` deletes its
  victim and calls `closeConnection` before it tries the candidate
  (`:4687–4692`); a false open leaves the victim deleted. The defect is
  conditional: a bound-but-not-in-table candidate can open; an unbound one
  cannot (Aster `2552a639`).
- Join-time self-integration passes a hex string to a map keyed by BigInt
  (`AxonaPeer.js:1315`, `webrtc.js:205`, `composite.js:134–141`). It returns 0
  and does not throw. `startRelay` awaits it on every relay start
  (`relay.js:308–312`). Every relay logs a clean integration that opened
  nothing (Vega `127cb170`).
- Synaptome maintenance (`_maintainSynaptome`, `:1337–1378`) is opt-in and no
  production launcher arms it. Its target is `kNear 5`. It treats
  `transport.isConnected` OR synaptome membership as satisfied (`:1357`), so a
  bound peer missing from the table is skipped (Aster `14d11520`).
- The attempt guard is opt-in. Where `_considerCandidate` would use it, the
  guard's `end()` runs in the `finally` before the relay fallback is issued
  (`:4545–4566`). In production `_attemptGuard` is null and the calls are
  no-ops; the hole is a property of the armed path (Vega `0dbc5da6`).
- Losses fall in four classes and must stay separate (Aster `ac344f10`).
  **A**, pc-failed during negotiation: one automatic re-offer, offerer only,
  5 s inside a 30 s deadline (`mesh.js:1189–1192`, `1203–1225`). **B**,
  pong-timeout or send-fail on an open channel: `_retire` closes dc and pc and
  schedules nothing (`mesh.js:1155–1161`, `1248–1292`); `onPeerDied` marks
  `_deadPeers`, which candidate selection filters until a fresh bind
  (`:623`, `:4762–4770`). **C**, the graduation watchdog: re-dials the bridge
  when bound peers fall below 3 (`web/index.js:165`, `814–822`); re-dials no
  peer. **D**, discovery: `connectViaRelay`, reached by triadic today. The
  04:33Z event that closed 46 channels on two LAN hosts in twelve seconds was
  class B by the logs.
- Delivery routes greedily over bound synapses, strictly closer
  (`:4089–4110`), then through a two-hop lookahead whose first hop need not be
  closer (`:4130–4229`). A bare-topic message that reaches a node with no
  eligible hop is an ELIGIBLE terminal fallback to `_becomeRoot`
  (`wireHandlers.js:164–175`, `:297`, `:467`), behind hold interception,
  closer-root correction, the meshBare hold and SUB verification where enabled.
  SUB verification is off in production (`AxonaManager.js:193`). Lookup is a
  second selector with its own fallback (`:5271`, `:5289–5300`). (Aster
  `1b2a24ad`, Vega `0dbc5da6`.)
- The bridge's anchor selection and newcomer ordering group by the first two
  characters of the connection handle, not the nodeId (`server.js:1223`,
  `anchor_select.js:25`). Graduation does not; it uses the bound nodeId's
  region (`server.js:559–563`, `:594`). (Aster `4a58b7fb`.)

The 2026-06-29 storm is in this list by reference. Maintenance was armed
without the guard and re-dialed candidates that never bind, every tick,
forever. Off decays; on storms. That is the trap this design has to walk past.

## The two rules

### Rule 1: hold everything below the limit

While the table is below cap, no voluntary path removes a peer.

Traffic and vitality decide WHICH peer leaves when the table is AT cap. They
never decide WHETHER a peer leaves below it. An idle peer is a peer. In a
network of sixty, a node that has carried no traffic for an hour is still the
node you will need when the root moves next to it.

Two things the rule separates that the amendment `6fbadf9d` ran together:

- RETAINING an existing peer is unconditional below cap.
- ADMITTING a newcomer is subject to qualification. The gate's join lane
  reserves the last `kJoin` slots and refuses a candidate on one-per-id-per-
  window and lane cooldown (`:2064–2082`). Whether join reservations survive
  under this policy is a decision, not a consequence; this draft keeps them,
  with `kJoin` counted inside cap, because the lane is what stops one identity
  from refilling a table by itself.

Every deletion carries a reason from a closed set: `loss` (class A exhausted,
class B), `policy` (identity or admission refusal), `cap-change` (the operator
lowered the cap). "Idle" is not in the set. Anneal below cap is out under this
rule, by existence, not only by order; `_evictAndReplace` removes only a dead
synapse and is consistent with the rule.

### Rule 2: fill to the limit, continuously

While the table is below cap, discover and dial. Stop when the table is at cap
or when supply is exhausted, and say which.

The target is cap, not `kNear`. `kNear` stays what it is, a selection quota for
the nearest band. The order of work on each tick:

1. RECONCILE. Any peer with an authenticated binding that is not in the table
   goes into the table first, with reason `reconcile`. No dial. This is the
   case `_maintainSynaptome` skips today.
2. NEIGHBOURS. Ask the synaptome for candidates: `find_closest_set` and the
   lookahead responses already return neighbours' tables. Prefer candidates
   that fill an empty band or that no current neighbour reports (a cross-
   cohort hint, defined under *Discovery at cap*).
3. DIRECTORY. Candidates from the bridge directory, when the node holds one
   (see *Discovery across cohorts*).
4. DIAL. Each stranger dial goes through `connectViaRelay` under the attempt
   guard, and the guard covers the dial through its completion or timeout, not
   through the issue of the first frame. A nominated id is not an occupied
   slot. An in-flight dial is not an occupied slot. A slot is occupied when
   the handshake binds and admission says yes.

Rate is bounded per tick (`maxPerTick` exists, `:256`) with jitter. Outstanding
attempts are bounded separately; a per-tick budget does not bound the
outstanding count when ticks repeat or a suspended PWA resumes its timers in a
burst (Aster `14d11520`). Both bounds are in the capacity model below.

## Cap is the knob

`MAX_SYNAPTOME` is 50 (`AxonaDomain.js:68`). At sixty nodes, fill-to-cap is a
near-complete mesh: that is what David asked for and the rule delivers it
without a special case. At six hundred nodes the same rule gives fifty peers
chosen by composition, and the Kademlia shape the earlier proposal used as a
target becomes the SELECTION rule at the cap: the nearest `kNear`, one or two
per distance band, the rest by vitality. One mechanism at both scales.

The cap is per node class. A relay on a droplet can hold fifty WebRTC
channels. A phone running a PWA in the background may not want ten. Nothing in
this document is evidence that any number is safe on any class; the number is
a parameter David sets, and the first value for each class is measured on
testnet before it is believed.

Fill-to-cap is conditional liveness. The conditions, stated so they can be
checked and so a failure names which one failed:

- SUPPLY: there exist reachable nodes not in the table and not refused.
- MUTUAL CAPACITY: the candidate has a free slot too, or an admissible swap.
- AWAKE: the node's timers run. A suspended PWA is not filling.
- RENDEZVOUS: a signalling path to the candidate exists, over the mesh or over
  the bridge.
- FAIR RETRY: a candidate refused for a transient reason is retried with
  backoff and not forever; one refused for identity or policy is not retried.

When any of these is false the fill stops, and the node reports `fill-stalled`
with the condition. A stalled fill is a measurement, not a failure of the rule.

## The capacity model

`synaptome.size` is one number and the node has five:

| bound | counts | reserved when | released when |
|---|---|---|---|
| admitted peers | bound and admitted into the table | admission | deletion with reason |
| pending attempts | dials issued and not yet bound, in or out | before the first frame is sent, or on receipt of an unsolicited offer | bind, cancel, or timeout |
| physical channels | open RTCPeerConnections, bound or not | channel creation | `_retire`, or a `closeConnection` that closes |
| candidate cache | ids learned and not yet dialed | nomination | dial, expiry, or refusal |
| swap overlap | slots held open while a replacement binds | swap begins | swap completes or is abandoned |

The rules of the model:

- RESERVE BEFORE ANY ASYNC DIAL. A dial that cannot reserve a pending slot is
  not issued. It is queued or dropped and counted either way.
- ONE DECISION FOR BOTH DIRECTIONS. An incoming offer and an outgoing dial are
  charged to the same local admission decision. A node at its pending bound
  refuses an unsolicited offer the way it refuses to issue one.
- ONE RELEASE, FENCED. Each reservation carries a generation. Completion,
  cancel and timeout each release at most once, and a completion that arrives
  after the generation moved on (a bind landing after timeout, or after a swap
  was abandoned) is reported and discarded, never admitted.
- AGGREGATE OVER SOURCES. The pending bound is one number across triadic,
  neighbours, directory and reconnect. A source does not get its own budget.
- THE GUARD COVERS THE WHOLE LIFETIME. `begin(peerId)` before the dial,
  `end(peerId, bound)` when the attempt binds, is cancelled, or times out. The
  relay fallback is inside that window.

`closeConnection` closes. The current unbind-only behaviour leaves a channel
that keeps answering pings while no peer id routes to it. Under the model that
channel is a physical-channel reservation with no owner, and the reaper never
reclaims it. Vega's reading (`0dbc5da6`) and Aster's (`ac344f10`) agree the
fleet impact is unmeasured; the first measurement is the count of open channels
with no binding, per node, before anything else changes.

## Discovery across cohorts

Neighbour-list gossip reaches every node in the connected component and none
outside it. If the graph is in pieces, the bridge is the only thing that has
seen both pieces, and today the bridge forgets a node the moment it graduates.

Two mechanisms, and this draft recommends the second with the first as its
record:

**A directory.** The bridge keeps a registry of nodeIds that have authenticated
to it, with a registration lifetime. A newcomer's `peer-list` is drawn from the
sockets (as now); its `directory` is a bounded sample of registered ids,
including graduates. A node uses the directory as candidates for step 3 of the
fill. A directory entry is a name, not a route: dialing it needs a signalling
path, which is the mesh relay when the two are in one component and nothing
when they are not.

**Periodic re-contact.** A graduated node returns to the bridge every `T` with
jitter, stays for a window `W`, refreshes its registration, receives
introductions to whoever is on the socket, and leaves. Two nodes that are on
the socket at once can be introduced and signalled by the bridge the way
newcomers are today. This is the rendezvous. It is a rendezvous OPPORTUNITY,
not a guarantee (Aster `14d11520`): two graduates that never overlap never meet
through it.

The overlap assumption, with numbers. With `N` nodes returning independently
every `T` for `W`, a given pair is on the socket together in a given cycle with
probability about `2W/T` when `W ≪ T`. At `T` = 10 min and `W` = 60 s that is
0.2 per cycle, so a given pair meets within five cycles on average, about
fifty minutes, and nearly every pair within twenty cycles. The socket load is
`N·W/T`, six nodes at a time at `N` = 60. What makes this wrong: nodes that
return on a synchronized clock (a fleet restart) overlap all at once and then
never; nodes that sleep (PWAs) do not return; and the bridge's own cap
(`BRIDGE_MAX_PEERS 15` in production) bounds how many can be on the socket at
once, so at larger `N` the window `W` or the period `T` must grow with `N`, or
the bridge must shard. `T` and `W` are David's parameters.

What this does NOT do: it does not put graduates back on the bridge for good.
The socket is held for `W` and released. The air-gap and degree-cap work on the
bridge (parked, `Bridge-Air-Gap-Plan` and `Bridge-Degree-Cap-v0.1`) are not
reopened by this.

The handle-prefix region in anchor selection (`server.js:1223`,
`anchor_select.js:25`) is fixed in the same change: anchors group by the bound
nodeId's region, as graduation already does. Until then the "diversity" the
nursery selects for is diversity of connection sequence number.

## Discovery at cap

Below-cap-only discovery halts forever on two saturated disjoint cohorts in a
larger mesh (Aster `14d11520`). A node at cap still discovers, at a bounded
rate, and still swaps, under one rule:

A swap at cap replaces victim `v` with candidate `c` only when all of the
following hold:

1. `c` improves composition: `c` fills a band with fewer than its minimum, or
   `c` is a cross-cohort edge, defined as: no current neighbour reports `c` in
   its table and `c` is not reachable by the two-hop lookahead. The definition
   is operational, not topological; it is what the node can observe.
2. `v` is the lowest-vitality member of the most over-filled band, and removing
   `v` leaves every band at or above its minimum.
3. The swap opens before it closes: `c` is bound and admitted, in a swap-
   overlap slot, before `v` is deleted. If `c` does not bind, nothing changed.
4. The swap is fenced by generation (the capacity model), and at most one swap
   is in flight per node.

When no admissible swap exists the node reports `swap-none` and does nothing.
It does not claim convergence. Two saturated cohorts with no cross-cohort
candidate visible to either is a state the mechanism reports; the periodic
re-contact above is what gives it a candidate.

Anneal, as it stands, is the ancestor of this rule and is retired by it. The
rule above is anneal with the order fixed, the below-cap case removed, the
victim chosen by band instead of by weight alone, and a reason attached.

## Losses

The four classes keep their names. What changes is class B.

- Class A (negotiation failed) keeps its one re-offer under the deadline.
- Class B (an open channel died) schedules a re-dial with backoff instead of
  a tombstone: `_retire` still closes dc and pc, and `onPeerDied` still marks
  `_deadPeers`, but the mark carries a reason and a lifetime. A `loss` mark
  expires (first retry after 30 s, factor 2, four attempts, the attempt
  guard's own schedule) and the id returns to the candidate pool. A `policy`
  mark does not expire on a timer. The 04:33Z event under this rule: 46
  channels retire, 46 marks are set with reason `loss`, and over the next few
  minutes 46 budgeted re-dials go out, through `connectViaRelay` where the
  bridge socket is closed, under the guard, with jitter. Whether they bind
  depends on the srflx path being back; if it is not, they back off and the
  marks expire into the candidate pool for the next fill tick.
- Class C (graduation watchdog) stays. The collapse re-dial on branch
  `graduation-collapse` (`8fead6d`, unreleased) stays on the branch; under
  Rule 2 the watchdog is a backstop, not the repair.
- Class D is the fill.

No ICE restart is proposed. It is a separate change with its own review, and
the logs so far do not show a case where a restart would have saved a channel
that a re-dial would not.

## The dial path repairs

These are pure fixes. Each is independent of the rules and each ships with a
fence test that fails when the fix is removed.

| defect | where | repair | fence |
|---|---|---|---|
| hex string into a BigInt-keyed map | `AxonaPeer.js:1315` | pass the BigInt; `integrate()` reports opened count and the count is asserted > 0 in a two-node test | test fails with `toHex` restored |
| `closeConnection` unbinds and does not close | `webrtc.js:345–348` | call `mesh.disconnect(meshId)` after `unbindPeer`; channel count drops | test counts open PCs after close |
| anneal deletes before it opens | `AxonaPeer.js:4687–4692` | replaced by the swap rule under *Discovery at cap*; the old path is removed, not patched | the swap test with an unbound candidate asserts the table is unchanged |
| maintenance skips bound-not-in-table | `AxonaPeer.js:1357` | reconcile step before nomination | test binds a peer out of band and asserts it is in the table after one tick with zero dials |
| relay fallback outside the guard | `AxonaPeer.js:4545–4566` | `end()` moves to the fallback's completion or timeout | test asserts `begin`/`end` bracket the `connectViaRelay` promise |
| `hop_cache` has no sender | `AxonaPeer.js:815` | a sender on the lookup trace, bounded by `LATERAL_K` | test asserts the frame is sent once per successful lookup, not per hop |
| `_deadPeers` has no expiry | `AxonaPeer.js:623`, `:4762–4770` | reason and lifetime on the mark; `loss` expires on the guard's schedule | test advances the clock and asserts the id is nominated again; a `policy` mark is not |
| anchor region reads the connection handle | `server.js:1223`, `anchor_select.js:25` | use the bound nodeId's region, as `connRegion` does | test with two handles in one keyspace region asserts they are not treated as two regions |

## Arming and rollout

The order is fixed by the trap. Nothing in the second step runs before the
first is in the kernel with its fences green.

1. REPAIRS. The table above, on a branch, full suite, E0/E2 manifests, council
   review, David's word, then released as a kernel version with no behaviour
   change in production because every mechanism that would use the repairs is
   still off.
2. MEASURE FIRST. On that kernel, before arming anything: open channels with
   no binding per node; bound peers per node, distribution; `_deadPeers` size;
   greedy terminal count per topic. These are the numbers the rules are
   judged against.
3. ARM ON TESTNET, TOGETHER. `RELAY_SYNAPTOME_MAINTAIN=1`,
   `RELAY_ADMISSION_GATE=1`, `RELAY_ATTEMPT_GUARD=1` on the testnet relays at
   once, with the fill target set to cap. `relay.js` already refuses to arm
   maintenance below kernel 4.67.1 and the refusal stays. Run the same
   measurements for 24 hours. The pass condition is a degree distribution whose
   minimum is at or near cap for a network smaller than cap, a dial rate that
   stays inside the budget through a forced fleet restart, and zero storms
   (defined as outstanding attempts at the bound for more than one guard
   cycle).
4. PRODUCTION, on David's word, through `RELEASE-PROCEDURE.md`, one host group
   at a time, with the same measurements before and after each group.

At no step does arming ride a kernel release. The envs are set by the
launchers, and the launchers change in their own commit.

## Verification

The acceptance list is Aster's (`14d11520`), adopted as stated, and each item
is an offline test before any live run:

1. One free slot with concurrent incoming and outgoing completions: exactly one
   is admitted, the other is refused and released, and the table is at cap.
2. Bound-but-not-in-table reconciliation: the peer is admitted with zero dials.
3. `kJoin`-reserved vacancies: a node below cap but inside the lane refuses a
   non-qualifying candidate and admits a qualifying one.
4. Delayed bind after timeout or generation change: the late bind is reported
   and the channel is retired; the table is unchanged.
5. Long PWA suspension and resume: on resume, timers fire once, outstanding
   attempts stay at or below the bound, and no dial is issued for an id already
   pending.
6. Stale or malicious repeated nominations: an id nominated every tick is
   dialed at most on the guard's schedule and expires on exhaustion; the
   candidate cache does not grow with the nomination rate.
7. Graduated cohorts with no rendezvous overlap: the fill reports
   `fill-stalled: rendezvous`, and the periodic re-contact, once simulated,
   clears it.
8. Two full disconnected cohorts: the at-cap rule either performs a fenced
   cross-cohort swap or reports `swap-none`; it never claims convergence and
   never drops below cap.

Plus the fence rule for every repair in the table, and plus the two cases the
reviewers added by name: `_evictAndReplace` with an unbound candidate loses no
live victim; a `policy` mark never expires on a timer.

Topic custody and handoff obligations survive any physical-channel retirement
caused by this design. The step-down hold's tests (`smoke_root_stepdown_hold`,
83 checks) stay green through every change above, and discovery grants no
topic authority.

## What this design does not establish

- That any specific cap is safe on any class. Measured per class on testnet.
- That the overlap arithmetic holds under synchronized restarts or sleeping
  nodes. Stated with the conditions that break it.
- That a denser mesh ends split roots. It lowers the rate at which greedy
  walks strand; the Monte Carlo in `16b554bd` is a model figure and is not
  cited as a production rate until its model-to-source map carries both
  selectors, the reverse edges and the terminal eligibility rules.
- The fleet impact of the unbind-only `closeConnection`. Measured first.
- The cause of the 04:33Z event. A network-wide srflx loss is what the logs
  show; what caused it is not in the logs.

## Parameters for David

Proposed first values, each with the condition that would change it:

| parameter | proposed | condition |
|---|---|---|
| cap, relay | 50 (`MAX_SYNAPTOME`) | lower if a 1-core droplet shows PSI pressure at 50 channels; the old west host swapped at far fewer |
| cap, seat (MCP peer) | 50 | same as relay; seats run on laptops with headroom |
| cap, browser / PWA | 12 | raise only after a 24 h run on a phone shows battery and memory flat |
| fill tick / per tick | 15 s / 3 (existing `intervalMs`, `maxPerTick`) | the testnet storm test is the check |
| pending bound | 8 (existing `MAX_VERIFY_PROBES`) | raise if fill time to cap exceeds ten minutes at N = 60 with supply present |
| guard schedule | 30 s, ×2, 4 attempts (existing) | unchanged until a measured reason |
| `loss` mark lifetime | the guard's exhaustion time | ties the two schedules together |
| re-contact `T` / `W` | 10 min / 60 s | grow both with N; shard the bridge before `N·W/T` nears `BRIDGE_MAX_PEERS` |
| band minimum at cap | 1 per band, `kNear` in the nearest | the swap rule's floor |

## Where the code stands

Nothing in this document is implemented. Branch `graduation-collapse`
(`8fead6d`) holds the class-C collapse re-dial and stays unreleased. The step-
down hold is in production at 4.102.0. The modules this design arms exist and
are off: `_maintainSynaptome`, `_admitOrImprove`, the attempt guard. The
repairs in the table are the first change, and they come to council as a
branch with fences before anything is armed anywhere.
