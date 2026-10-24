# Axona Mesh Signaling: Route First, Repair Through Peers — design packet v0.1

**v0.1 (14:56Z 2026-10-24).** David's direction, council 251b774d (04:00Z
2026-10-24): "Any proposal that suggests using the bridge in any other way
than as either entre into the mesh, or as a regular node, is incorrect. … Every
node should be greedy in finding and maintaining connections and should
quickly find them. … Please provide a better solution." He asked for this
packet ("Write the packet"). It folds Aster's replacement design
b316b4b2 and her contracts A1 aaba1e33, A2 c2ff06ce and A3 0eb14d98, Orion's
bounds 446f930a and 22fc13fe, and the read-only pass 99ad73ff with Aster's
corrections to it. Every line number below is read from axona-protocol at
`7d65378` (tag v4.124.0, on the fleet since 02:15Z 2026-10-24; `f873a9e` on
main changes comments only).

**Status:** PROPOSAL, for council review. Nothing built. Everything in Part 4
sits behind flags that are OFF by default. Build is David's word after the
review, not before.

---

## Part 1. The question

Why is one relayed offer in four never sent?

A node that wants to dial a peer it is not connected to sends its SDP offer
through the mesh, hop by hop, to that peer. In the 23 minutes after the
4.122.0 roll (04:05Z to 04:28Z 2026-10-23) our 48 relays logged 2,030 relayed
offers and answers and withheld 571 of them (28.1%). In the same 23 minutes
after the 4.124.0 roll (02:03Z to 02:26Z 2026-10-24) they logged 2,212 and
withheld 588 (26.6%). Between those two rolls the lookup walk became acked
per step with a 12 s deadline (4.123.0), and the rate did not move. Dials
that failed outright, counted as failure marks over offers sent, ran 45.8%
and 51.9%. Those are event ratios, not joined attempts.

Each withheld signal was withheld by one thing: before sending, the origin
runs an iterative lookup for the target and sends nothing if the lookup says
"not found".

## Part 2. What this is NOT

- It is NOT a bridge fallback. A relayed signal that cannot be delivered over
  the mesh is reported as a failure. The bridge introduces a joining node and
  is otherwise an ordinary peer under the same selection, capacity and
  failure rules. Aster withdrew the fallback in b316b4b2; Orion in e9862f68.
- It is NOT a change to the 4.123.0 walk's deadline, nor to the 5 s request
  timeout. The walk stays as it is for pub/sub lookups and root verification.
- It is NOT a table-cleaning pass. The read-only pass found no entry stranded
  by a skipped close (Part 3). The suppressed loss notifications are fences
  and stay.
- It is NOT the Connectivity Floor. Greedy connection seeking is item D of
  Part 4 and belongs to that packet's v0.3, with Aster's C1 and C2 folded in.
  This packet names the interface and nothing more.
- It is NOT a full-mesh, logarithmic-route or partition-prevention claim. A
  bounded search can miss a path that exists. A node in a disconnected
  component, suspended, full, or behind an impossible ICE pair is not made
  reachable by anything here.
- It is NOT a change to custody, topic history, admission, authentication or
  the attempt and incarnation fences. Removing a routing edge is not deleting
  what the peer holds.

## Part 3. What the kernel does today

**The sink.** The web transport hands every outbound signal to
`_relaySignalSink` (AxonaPeer.js:6411-6422). If the node holds any synapse the
sink starts `_relayMeshSignal` and returns true at once: the transport treats
the signal as owned and never sends it by the bridge. Only a node with an
empty table returns false, and that is the cold-bootstrap entry, the one use
of the bridge this packet keeps.

**The veto.** `_relayMeshSignal` (:6428-6466) first awaits `_relayReachable`
(:6470-6482): one iterative `lookup(target)`, its verdict cached for 5 s
(`RELAY_REACH_TTL_MS`, :178). A verdict of not-found ends it: the origin logs
`relay-signal-origin … result:not-sent` with the lookup's reason and returns.
Only a found verdict reaches `routeMessage` (:6303), which forwards the signal
greedily toward the target over live channels with one retry, and ends at a
serving-capable terminal if no closer hop exists.

**Why the veto says no.** In the 4.124.0 window the 588 not-sent verdicts
carried: no reason 301 (a hop on a kernel older than 4.122.0 returns none);
`send-failed` 252; `walk-deadline` 23; `max-hops` 12. Of the 252 send
failures, 129 were "no route to", a send to a table entry with no channel
behind it; 51 were a hop that did not ack a `lookup_walk` within 5 s; 40 were
a `lookup_step` that did not answer within 5 s.

**The 129 "no route to", read.** 34 failed at one of our relays and 95 at a
node whose log we do not hold. In every one of the 34, that relay had logged
`peer-died-evicted` for that very peer before the send: 30 within the same
second, 4 within 2 to 5 s, none re-bound in between. For 17 of the 34 the
failing hop was the origin, so both stamps are on one clock; for the other
17 the stamps are on two hosts at second resolution. 29 deaths were
`pc-closed` (the far end restarting in the roll) and 4 `pong-timeout`. The
window held 657 evictions on our relays against 1,507 delivered signals.

The mechanism is in `_lookupStep`. The step collects candidates from the
table (:6714-6734), then awaits the two-hop lookahead round (:6769, up to
`LOOKAHEAD_MS` 1,500 ms) and sometimes `_addByVitality` (:6784, :6815). A
candidate that dies during the await is deleted and unbound by `onPeerDied`
(:820-849). Back from the await the step has already counted the hop
(`ctx.queried.add`, `path.push`, `hops += 1`, :6790-6805), reads
`isConnected(nextId)` false (:6856), tries the bound-only open, gets false,
and sends anyway (:6896, :6907). The send fails and the whole lookup ends
`send-failed`. The step never re-selects. This is source validation of a
mechanism consistent with the 34 records (Aster 0eb14d98); the logs hold no
attempt join that would prove it per record.

**The 95 at other hops.** Thirteen hops, three of them holding most, with
entries for three nodes that east's log shows reconnecting at 01:51:57Z after
the east recreate, completing the handshake, and being released as meshed
(close 4200) at 02:02Z, one with 1006 at 02:09Z, after 624 to 1,042 s on the
socket. Their cause is not readable from our logs. Neither a stale entry nor
a departure is excluded.

**How an entry enters and leaves the table.** `_seedInsert` (:2972) writes
an entry from five callers: the bound callback (:727), a startup snapshot of
`boundPeers()` (:643), `join` (:1520), `_reconcileBound` over a bound snapshot
(:2301) and admission of an already-bound candidate (:5850). None re-reads
liveness at the moment of the write; a stale snapshot can seed an entry whose
channel has gone. Entries leave on `peer-leaving` (:1098), a gate swap
(:3056), `_evictAndReplace` of a dead-marked synapse (:6107) and the
transport's `onPeerDied` (:820-849). Every kernel caller of `closeConnection`
deletes first or never inserted.

**The close paths that do not notify.** `_retire` (mesh.js:2015) fires
`onPeerLost` only for a channel that had opened and only when `notifyLost` is
true. The retry path (:1981), a replaced never-opened attempt (:1032, gated at
:993 on `openedAt === 0`) and an unreserved attach (:1320) pass false; a
voluntary `closeConnection` unbinds first (webrtc.js:414-418) so the loss is
not a death; a deduplicated duplicate and a superseded route in the composite
are swallowed. Each is a fence against evicting a peer that is still reached.
One path strands an entry for a bounded time: a channel that opened, failed,
retried with `notifyLost:false`, and whose replacement never opens. The
reaper's `negotiation-timeout` retire (:1882) fires no `onPeerLost`
(`wasOpen` false) but the reason is in `NEGOTIATION_FAILED_REASONS` (:177), so
the negotiation-failed listener fires (:2088) and the kernel writes the dead
mark (AxonaPeer.js:798) because `isConnected` is false. Routing skips the
entry from then on and the next lookup step evicts it. The bound is the 30 s
negotiation deadline, serviced by the reaper.

## Part 4. The proposal

Four items. A and B are this packet. C is Aster's A1 contract, stated here
because A and B depend on it. D is the Floor's.

### A. Send without the veto

`_relayMeshSignal` no longer awaits a lookup before sending. With
`SIGNAL_ROUTE_FIRST` on:

- If the target is connected, the signal goes to it directly.
- Otherwise the signal is routed greedily over live neighbours by
  `routeMessage`, as today after a found verdict.
- The 5 s reachability cache is not consulted and not written. The
  `relay-signal-origin` line keeps its shape with `reach: 'route-first'`.
- `_relaySignalSink` is unchanged: a meshed node owns its signal, an unmeshed
  node uses the bridge as its entry. Nothing is handed back to the bridge
  later. Aster's note stands: today's sink cannot revoke ownership after it
  returns true, and this packet does not ask it to.

What the veto was for, and what replaces it: the veto kept a signal off the
mesh when the target could not be found, so an unroutable target did not cost
a walk per ICE candidate. Item B's budget replaces that bound: a signal whose
route exhausts its credits reports failure and stops, and the budget is per
request, not per candidate (one discovery per negotiation, A2).

### B. Repair the path through peers

Two layers, both bounded, both over ordinary peers.

**B1. Re-select at the hop.** This is the fix for the 34, and it applies to
`_lookupStep` and to the `route_msg` forwarder alike. Selection is tentative
until the send is issued:

- After every awaited stage (the lookahead round, `_addByVitality`, the
  bound-only open) the hop re-reads the current route token and liveness for
  its chosen next hop. A dead edge is not sent to.
- On a dead edge the hop takes the next eligible candidate from the set it
  collected, under the same request deadline and credits. The unsent
  candidate is not counted as traversed: `queried`, `path` and `hops` are
  charged at issue, not at selection (A3). The collected set is re-filtered
  against the dead marks and the live set before each pick.
- A send that fails after validation (the channel died between the read and
  the issue) is caught and re-selected the same way, once per credit.
- Re-selection work is bounded as sends are: a hop that exhausts its
  candidates returns `stalled` as today.

**B2. Alternate-path probe at a local minimum.** When greedy routing ends at a
node that is not the target and holds nothing closer, the signal today ends
`terminal-not-target` (104 offers in the 4.124.0 window). With
`SIGNAL_PATH_REPAIR` on, that node may spend the request's remaining credits
on a bounded non-greedy probe:

- Credits are integers, carried in the frame, decremented by every forward
  including a single-path one; `C = 0` stops; a branch splits only what is
  left after its own send; a timed-out branch cannot return credits to a
  branch that may still run (A2). A depth cap and the request deadline ride
  with the credits. Which numbers: Part 6, Q2.
- A probe carries no SDP and no ICE. It asks "do you hold a live channel to
  the target or to a node closer than me?", with the path memory the route
  already carries (`PATH_MEMORY`, AxonaDomain.js:61) so no hop forwards onto
  its own path.
- A hit returns along the inbound channels that carried the probe. The
  record each transit node keeps is soft state with a lifetime bounded by the
  request deadline; an upstream channel that dies before the reply fails
  closed, and the origin's deadline is the only clock. Discovered paths are
  never written into the routing table.
- A target reply is one authenticated outcome per negotiation: offer applied
  once per (origin incarnation, target incarnation, attempt, sequence, kind)
  bound to the body hash; a duplicate arrival by a slower branch returns the
  cached outcome and never applies twice; a changed hash at the same key is a
  conflict and is refused (A2). Late frames after the attempt closes are
  fenced by attempt and incarnation state, not by the soft record's lifetime.
- Exhaustion reports an explicit failure to the origin, releases the
  request's reservation, and leaves the retry to the negotiation's own
  deadline and the dialer's shared budget. No bridge, no root.
- Forwarding never waits for a channel that is still negotiating: a hop with
  no live edge toward the target is a local minimum, not a reason to dial.
  Connection acquisition is item D.

### C. The liveness contract (Aster A1)

Four things the code today conflates are kept apart: a historical hint (a
candidate id from gossip or a snapshot), a bound identity, a physical channel
incarnation, and the CURRENT usable route.

- Routing eligibility follows the current route: an entry is routable only
  while the transport holds a current token and a live channel for it, read
  at every send issue. This is what B1 reads.
- Insertion commit re-reads the same: each of the five seed callers validates
  the token and liveness at the moment of the write, so a stale bound
  snapshot nominates and never certifies.
- Eligibility is updated on every route disappearance or replacement,
  independently of failure marking. A duplicate or superseded close preserves
  the survivor (the fences stay); a retry with no live replacement does not
  preserve old eligibility past the deadline.
- The six deterministic cases are fences (Part 5, F7).

### D. Be greedy about connections (the Floor, by reference)

Every node seeks and keeps neighbours through its neighbours' introductions,
near and random, verified by a real dial, under one shared issue budget with
the attempt guard (:783-797), the dead-mark automaton (:798, :836), the
maintain tick (:2309) and the walk deadline. At small populations a node
seeks every admissible reachable peer within its caps; at larger populations
it maintains bounded-degree coverage. No census, no privileged directory.
That is the Connectivity Floor packet with Aster's C1 (a nominated candidate
earns a budgeted verification dial; only the authenticated channel counts)
and C2 (one time-window budget, issue-time reservations, old generations
settle their own, "class-blocked" means below the effective target) folded
in. Its v0.3 is the next document; this packet does not restate it. A denser
mesh makes A and B short: a signal to a mutual neighbour is one hop.

### Flags

| flag | default | gates |
|---|---|---|
| `LOOKUP_RESELECT` | OFF | B1 in `_lookupStep` and the `route_msg` forwarder |
| `SIGNAL_ROUTE_FIRST` | OFF | A; requires `LOOKUP_RESELECT` |
| `SIGNAL_PATH_REPAIR` | OFF | B2; requires `SIGNAL_ROUTE_FIRST` |

Off, every path is byte-identical to 4.124.0. The wire frames for B2 (the
probe, its reply, the credits and the outcome ack) are new contracts: a hop
without them answers "no handler" and the probe treats that hop as a wall.
Mixed-version behaviour is Part 6, Q4.

## Part 5. How we would know

Fences on real AxonaPeers over the sim transport, bound-only, as the web
transport behaves. Each fence has mutants that delete the fix; each must go
red.

- **F1 re-select after the await.** A chain where the chosen next hop is
  killed during the lookahead round. Off: the lookup ends `send-failed` at
  that hop with `connected:false` (today's 34). On: the hop takes its next
  candidate and the target is found; the killed candidate is absent from
  `path` and not counted in `hops`. Mutants: skip the re-read; charge at
  selection; re-select without re-filtering the dead marks.
- **F2 validation-then-loss.** The channel dies between the liveness read and
  the send. On: caught, re-selected once, found. Mutant: no catch.
- **F3 route first.** A relayed offer with no lookup before it, delivered over
  two hops; the origin line reads `reach: 'route-first'`; the reach cache is
  neither read nor written. Mutant: the veto back in.
- **F4 the budget.** Credits decrement on single-path forwards; `C = 0` stops;
  a split hands out only what remains; a timed-out branch cannot recycle
  credits; the depth cap and the deadline each end a probe alone. Mutants:
  one per rule.
- **F5 once per negotiation.** Two branches deliver the same offer; the target
  applies it once and answers both with the same outcome; a changed body at
  the same key is refused; a frame arriving after the attempt closed is
  dropped by the incarnation fence, not by a timer. Mutants: apply twice;
  accept the changed hash; drop the fence.
- **F6 the reverse path.** The reply follows the inbound channels; a transit
  node whose upstream dies before the reply fails closed and the origin ends
  at its deadline; no discovered path lands in any table. Mutants: write the
  path; keep forwarding past a dead upstream.
- **F7 the liveness contract.** Aster's six: opened → retry → replacement never
  opens; voluntary close without a prior kernel delete; close between open and
  seed; a stale bound-snapshot reconcile; a duplicate or superseded loss after
  replacement; a failed negotiation beside a live alternate. Each asserts the
  table, the eligibility and the mark, not only the log.
- **F8 the fences stay.** Each suppressed notification (retry,
  attempt-replaced, attach-unreserved, voluntary close, dedup loser, superseded
  route) still evicts nothing live. Mutant: strip one.

**On the fleet,** the same two readings as Part 1, with `ops/signal-trace-
tally.py` over equal windows at equal positions after a roll: relayed signals
not sent, and failure marks over offers sent. With `SIGNAL_ROUTE_FIRST` on,
`not-sent` is replaced by the route's own outcomes (`delivered`,
`terminal-not-target`, `exhausted`, `send-failed`), so the number to watch is
offers that reached the target (`offer-recv` at the far end, joined by attempt
id as in 7ce27c7c) over offers issued. A control arm exists for the first
time: the flag off on half the relays, on on the other half, same window.
Neither reading proves a dial opened; `answer-applied` and the ICE outcome say
that.

## Part 6. Questions, with the reviews so far

Each open item is written as its question with its choices.

**Q1. Does B1 ship alone first?** It is one function's control flow, fenced by
F1 and F2, measurable by the 34-class count, and it is useful whether or not A
ever ships. Choices: (a) ship `LOOKUP_RESELECT` as its own release, default
OFF, arm it on the relays, read one window, then review A and B2; (b) hold it
inside this design and ship once. The packet recommends (a). Orion 22fc13fe
ratified the re-selection; Aster 0eb14d98 confirmed the mechanism and asked
that it charge at issue.

**Q2. What are the numbers for B2's budget?** Orion proposed 8 credits and a
depth of 4 and a latency under 200 ms (446f930a); Aster declined them as
unratified (c2ff06ce), and the packet agrees nothing here derives them. The
4.124.0 window shows delivered routes at 2 hops typically and walks that
wandered to 35. Choices: (a) take Orion's numbers as the first arm and
measure; (b) derive them from a hop histogram of delivered signals over one
full day, then set credits at the 95th percentile of hops plus one split;
(c) make them domain constants and let the first fleet window decide. The
packet recommends (b), before any build of B2.

**Q3. What does the origin do when the search exhausts?** Today a withheld
offer leaves the dialer to wait out the 30 s negotiation deadline and mark the
peer. Choices: (a) same: report failure, release the reservation, let the
deadline run; (b) end the attempt at once with a new reason so the dialer's
budget moves to its next candidate within the same tick. Aster's A2 asks that
an uncertain timed-out send keep its spent budget and its dedup identity
either way. The packet recommends (b) only if the attempt guard already
distinguishes "ended by route exhaustion" from "ended by deadline"; it does
not today (:792).

**Q4. Mixed versions.** A hop without the B2 frames answers "no handler". Choices:
(a) treat it as a wall and spend no credit on it; (b) treat it as a wall and
charge one credit, so a mesh of old hops exhausts fast; (c) do not ship B2
until the door floor passes the version that carries it. The packet
recommends (b). A and B1 need no new frame.

**Q5. The 95 failures at other hops.** Their cause is unread. Choices: (a)
accept that this packet does not address them and say so in its results; (b)
add the origin's `relay-signal-origin` line to the apps and seats so the next
window reads them; (c) ask the seat owners to restart on 4.124.0 and re-read.
The packet recommends (a) and (b) together; (b) is a logging change, not a
design one.

**Q6. The Floor's open word.** Does 40 mean M ∪ I or inbound only? Still
David's, carried from Connectivity Floor v0.2; item D waits on it.

Standing reviews: Aster b316b4b2, aaba1e33 (A1), c2ff06ce (A2), 0eb14d98 (A3),
f0012884 (count corrections, applied); Orion e9862f68, 446f930a, cc9aeca6,
22fc13fe; Vega 6fdd5036 and 44faed22 (concur, no bridge fallback; the
scale, PWA and migration challenge Aster asked of Vega is still open).

## Part 7. What would make this wrong

- The race is a mechanism consistent with 34 records. If an attempt join on
  a future window showed those sends issued BEFORE the eviction stamp, B1 is
  still correct and the 34 would have another cause.
- The 95 at other hops are the larger population and are unexplained. If they
  are stale entries at nodes that never run `onPeerDied` for a socket-closed
  peer, C addresses them only on nodes that ship C.
- Dropping the veto could send more signals toward targets that are not
  there. The budget bounds each request, not the sum; a dialer that nominates
  many dead candidates spends many requests. The Floor's C1 and the dead-mark
  automaton are the bound on that, and neither is measured here.
- No control arm has been run. Part 5's half-fleet arm is the first.
- A probe hit is a path that existed when probed. A channel on it can die
  before the reply; F6 bounds the wait, it does not make the path hold.
