# Axona Mesh Signaling: Route First, Repair Through Peers — design packet v0.2.1

**v0.2.1 (18:38Z 2026-10-24)** corrects v0.2 on one source fact (Aster 362a9ff6, SIGR-001): the mesh has no replay guard for an offer that repeats the SAME attempt. `offer-on-open-ignored` refuses a DIFFERENT attempt on an opened state; an equal attempt with an existing connection re-enters `_handleOffer` and `setRemoteDescription` (mesh.js:993-1038, 1526-1542). So a `mesh:signal` is not a class with an idempotency key today, R2 withholds its re-send too until the mesh ignores an equal-attempt duplicate, Q8 widens, and the as-built 4.125.0 re-sends offers. Also: "368 post-wait" is "368 after a send threw", pre-wait or post-wait undistinguished until R3.

**v0.2 (18:30Z 2026-10-24)** records B1 as SHIPPED and what its first read
taught. B1 is kernel 4.125.0 (David "Ship B1 first", Q1(a) of v0.1), on all 48
relays since 17:49Z, armed by environment, OFF everywhere else. The first
23-minute window after the roll read the class B1 targeted at 1, from 34, and
the fix fired 466 times; the headline rate of withheld signals barely moved,
and its composition changed (Part 3, "What B1 changed"). Three things the read
and the reviews found go into the next build of B1 and into B2 (Part 4, R1 to
R4): the step is charged when the send returns, not when it issues; a
re-selection after a pending request is rejected at the peer's death can
duplicate a frame that already left, and only some message classes dedup; and
the walk's completion is accepted from any bound neighbour, not only the hop it
was sent to. Part 6 marks Q1 answered, carries Orion's choices on Q2 and Q4,
and adds Q7 and Q8. Corrections from Aster's reviews are applied where they
touch this packet (4db46bc1, c0cb3c6c, 9051c5a0). David asked for this
revision ("Revise the packet").

**v0.1 (14:56Z 2026-10-24).** David's direction, council 251b774d (04:00Z
2026-10-24): "Any proposal that suggests using the bridge in any other way
than as either entre into the mesh, or as a regular node, is incorrect. … Every
node should be greedy in finding and maintaining connections and should
quickly find them. … Please provide a better solution." He asked for this
packet ("Write the packet"). It folds Aster's replacement design b316b4b2 and
her contracts A1 aaba1e33, A2 c2ff06ce and A3 0eb14d98, Orion's bounds
446f930a and 22fc13fe, and the read-only pass 99ad73ff with Aster's
corrections to it. Line numbers are read from axona-protocol at `7d65378`
(tag v4.124.0) unless marked 4.125.0, where they are read from `0416f3b`
(tag v4.125.0, the change `58c1d6e`).

**Status:** B1 SHIPPED (4.125.0, relays only). A, B2 and C are PROPOSAL, for
council review, nothing built, every flag OFF by default. Build is David's
word after the review, not before.

---

## Part 1. The question

Why is one relayed offer in four never sent?

A node that wants to dial a peer it is not connected to sends its SDP offer
through the mesh, hop by hop, to that peer. In the 23 minutes after the
4.122.0 roll (04:05Z to 04:28Z 2026-10-23) our 48 relays logged 2,030 relayed
offers and answers and withheld 571 of them (28.1%). In the same 23 minutes
after the 4.124.0 roll (02:03Z to 02:26Z 2026-10-24) they logged 2,212 and
withheld 588 (26.6%). In the 23 minutes from 17:42Z after the 4.125.0 roll,
with B1 armed, they logged 2,371 and withheld 598 (25.2%). Between the first
two the lookup walk became acked per step with a 12 s deadline (4.123.0);
between the last two the chosen hop became tentative until its send issues
(4.125.0). Neither moved the rate. Dials that failed, counted as failure marks
over offers sent, ran 45.8%, 51.9% and 44.0%. Those are event ratios, not
joined attempts.

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
- It is NOT a claim that B1 improved connectivity. B1 removed one failure
  class at the relays. The rate of withheld signals did not move, for the
  reason Part 3 gives.

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
carried: no reason 301 (a hop that answers in the pre-4.122.0 shape returns
none); `send-failed` 252; `walk-deadline` 23; `max-hops` 12. Of the 252 send
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

**What a voluntary close costs a request in flight.** A request already
pending to a peer that the gate swap or `_evictAndReplace` then closes is not
rejected at the close: the identity is unbound before the disconnect, so the
loss is not an active-route death and sweeps nothing (webrtc.js:414-418,
:678-716). The request waits for its reply, its stop, or its 5 s timeout. Only
a request outstanding at that moment pays this (Aster 9051c5a0).

### What B1 changed (4.125.0, `58c1d6e`)

With `LOOKUP_RESELECT` on, `_lookupStep`, the `route_msg` forwarder and the
origin send of `routeMessage` each treat the chosen hop as tentative. After
the awaits the hop re-reads liveness; a dead edge takes the next eligible
candidate from the set already collected (the forwarder and the origin re-scan
the usable set, which can change under them: Aster c0cb3c6c); `queried`,
`path`, `trace`, time and `hops` are charged by `commit()` when the send
RETURNS, on the walk's ack or the recursive step's result; each re-selection
logs `lookup-reselect` with kind, hop, the dead id, the next id, why and the
count, and the origin trace carries `failReselects`. `isEdgeLoss` names the
errors that earn a re-selection: no route, not connected, no open channel,
not registered, died, unreachable, channel closed. A timeout or an older hop's
"no handler" does not. OFF is the 4.124.0 order.

**The first read, 17:42Z to 18:05Z, all 48 relays armed** (each start banner
prints `arm SUB_TERMINAL_VERIFY=1 LOOKUP_RESELECT=1`; the roll was staggered
over nine minutes with two Windows restarts, so this window's shape differs
from the two before it). Send failures at our relays with `connected:false`
read 1, from 34. `lookup-reselect` fired 466 times: 368 after a send threw
(243 route, 110 walk, 9 step, 6 origin; the throw's timing, before or after
a wait, is not in the line until R3) and 98 on the re-read before a send.
Every send-threw re-selection sits in the same relay section within two
logged seconds of a `peer-died-evicted` for that peer; 110 dead peers were
re-selected up to nine times each inside those two seconds, with no
mesh-cap-attested, auth-mesh-complete, dc-open or handshake-complete line for
that peer in between. That is several in-flight operations at one relay
resuming after one death. It is an association by section and second, not an
attempt-level proof (Aster 4db46bc1). Withheld signals 598 of 2,371 (25.2%).
The reasons: no reason 462 (from 301), `send-failed` 113 (from 252),
`walk-deadline` 20, `max-hops` 3. The 113: 59 a hop that did not answer in
5 s, 11 no live candidate left, 29 "no route" at hops outside our fleet, 13
a truncated "peer … " text, 1 other. Failure marks over offers sent 836 of
1,900 (44.0%).

**What the read means.** B1 removed the class it was built for at our relays
and did not move the rate, because the rate is now dominated by 462 verdicts
with no reason, which is the shape a hop returns when it runs a kernel older
than 4.122.0. The reasonless shape does not name the node or its version. The
seats, this author's included, run 4.118.0 and are the known population of
that shape; their restart is their owners' and David's.

**Three defects the read and the reviews found in B1 as built.**

1. *Charge on return, not at issue.* `commit()` runs when the send returns.
   A `lookup_walk` or `lookup_step` that was transmitted and then timed out
   leaves the caller's context uncharged while the next hop holds the
   projected body. The lookup ends `send-failed` as it did in 4.124.0 (a
   timeout is not an edge loss, so nothing re-selects), and for the walk the
   origin's deadline still governs a late `lookup_done`. The returned record
   is wrong by one hop: its path omits a hop that was sent to, though
   `fail.hop` names it. A reporting defect (council 599924cb).
2. *A re-send after a pending request is rejected at the peer's death can
   duplicate.* `_onPeerLost` rejects pending requests to the dead identity
   with "peer … died" (webrtc.js:688-697). That text is an edge loss, the
   rejection comes after a wait, and the frame may already have left. So the
   bound on a re-selection is not "a candidate, not time": it is one request
   timeout per candidate at most, plus the lookahead, promotion and open
   waits outside it (Aster 4db46bc1, c0cb3c6c). Whether the re-send is safe
   depends on the message class, and today NO class on the relayed-signal
   path has one. A `mesh:signal` offer carries an attempt id, but the mesh's
   guard (`offer-on-open-ignored`, mesh.js:993) refuses only a DIFFERENT
   attempt on an opened state; an offer repeating the SAME attempt at a
   responder that holds a connection re-enters `_handleOffer` and calls
   `setRemoteDescription` again (:1035, :1526-1542), with no cached outcome
   and no body-hash check (Aster SIGR-001). What the provider does with a
   repeated description is its own contract. A pub/sub body carries a msgId
   the ingest dedups on. A `lookup_walk` carries nothing: a duplicated walk
   schedules a second step at the next hop and the origin settles on
   whichever `lookup_done` arrives first. Other routed types hold whatever
   their handler holds. In the first read, 243 of the 368 send-threw
   re-selections were route re-selections, and relayed offers are what the
   forwarder carries; how many re-sent an offer the responder had already
   taken is Part 5's next read.
3. *The walk's completion is accepted from any bound neighbour.* The
   `lookup_done` handler reads neither the transport sender nor the expected
   predecessor; it settles the pending walk on the claimed sourceId and the
   walkId (:7087-7095). `lookup_done` travels by `transport.notify`, one
   bound hop at a time, so a false completion needs a bound neighbour of the
   origin that knows the walkId; the first hop of every walk is both. That
   restriction holds only once bind-after-hello has completed on that
   channel: the mesh forwards non-ping frames to listeners before binding
   and the response matcher reads the message alone (Aster ING-001/002,
   9051c5a0). Not an incident; an attribution gap.

## Part 4. The proposal

Four items. A and B are this packet. C is Aster's A1 contract, stated here
because A and B depend on it. D is the Floor's. B1 is shipped; its revisions
are R1 to R4.

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

Why A comes next: the first read shows the veto's verdicts now dominated by
hops that return no reason. Removing the veto removes the question those hops
cannot answer. What it does not remove is the route's own failure at the same
hops; Part 5's control arm is how that is read.

### B. Repair the path through peers

Two layers, both bounded, both over ordinary peers.

**B1. Re-select at the hop. SHIPPED as 4.125.0; four revisions owed.**

- **R1, charge at invocation.** The step charges `queried`, `path`, `trace`,
  time and `hops` the moment `transport.send` is invoked, and reverses the
  charge only when the send throws an edge loss BEFORE any wait (the
  composite's "no route", the bound-only open's false, the sim's "no open
  channel"). A rejection that arrives after a wait, "peer … died" included,
  keeps the charge: the frame may have left, so the hop was issued. The
  returned record then names every hop that was sent to.
- **R2, re-send only with an idempotency key.** After a post-wait rejection
  the step re-selects only for a message class whose receiver dedups: a
  pub/sub body by msgId; a `mesh:signal` once the mesh ignores an offer or
  answer that repeats the attempt it already holds for that peer (today it
  does not, SIGR-001); a `lookup_walk` once the receiver holds a per-walk
  `(walkId, hop)` set. Q8 chooses, per class, whether to add the guard or to
  forbid the re-send. A class with no key ends `send-failed` as 4.124.0 did.
  Pre-wait edge losses re-select for every class, because nothing left.
- **R3, the trace carries the error.** `lookup-reselect` adds the thrown
  text (60 chars, as `fail.err` does) and whether the rejection was pre-wait
  or post-wait, so the next read separates the two.
- **R4, the bound, stated.** A hop's re-selection work is bounded by the
  candidates it collected (the lookup) or the usable set it re-scans (the
  route). Its time is bounded by one request timeout per candidate it issued
  to, plus the lookahead round, the promotion and the open before the first
  issue. No absolute deadline rides with it; the origin's walk deadline and
  the caller's own timeout are the outer bounds, as before B1.

**B2. Alternate-path probe at a local minimum.** When greedy routing ends at a
node that is not the target and holds nothing closer, the signal today ends
`terminal-not-target` (104 offers in the 4.124.0 window, 61 in the 4.125.0
one). With `SIGNAL_PATH_REPAIR` on, that node may spend the request's
remaining credits on a bounded non-greedy probe:

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
- The probe's reply is accepted only from the hop the probe was sent to,
  carried in the probe's own record at the origin and at each transit node.
  This is the same rule C2 applies to the walk.

### C. The liveness and ownership contract (Aster A1, extended)

Four things the code today conflates are kept apart: a historical hint (a
candidate id from gossip or a snapshot), a bound identity, a physical channel
incarnation, and the CURRENT usable route.

- **C1.** Routing eligibility follows the current route: an entry is routable
  only while the transport holds a current token and a live channel for it,
  read at every send issue. This is what B1 reads. Insertion commit re-reads
  the same: each of the five seed callers validates the token and liveness at
  the moment of the write, so a stale bound snapshot nominates and never
  certifies. Eligibility is updated on every route disappearance or
  replacement, independently of failure marking. A duplicate or superseded
  close preserves the survivor (the fences stay); a retry with no live
  replacement does not preserve old eligibility past the deadline.
- **C2, completion attribution.** A `lookup_done` is accepted at the origin
  and at each transit node only from the hop that node sent the walk to, read
  as the transport sender of the frame, and only while bind-after-hello has
  completed on that channel. The origin returns its `done` promise without
  waiting on the first step beyond the step's own request timeout, so the
  walk deadline bounds the caller in every case (today the caller waits on a
  legacy first hop's recursive fallback, LKC-001). `stop()` and `leave()`
  settle every pending walk.
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

| flag | default | state | gates |
|---|---|---|---|
| `LOOKUP_RESELECT` | OFF | shipped 4.125.0; armed on the 48 relays by env | B1 in `_lookupStep`, the `route_msg` forwarder and the origin send |
| `SIGNAL_ROUTE_FIRST` | OFF | proposal | A; requires `LOOKUP_RESELECT` |
| `SIGNAL_PATH_REPAIR` | OFF | proposal | B2; requires `SIGNAL_ROUTE_FIRST` |

Off, every path is byte-identical to the release before it. The wire frames
for B2 (the probe, its reply, the credits and the outcome ack) are new
contracts: a hop without them answers "no handler" and the probe treats that
hop as a wall. Mixed-version behaviour is Part 6, Q4. R1 to R4 and C2 change
no wire shape except R3's log line.

## Part 5. How we would know

Fences on real AxonaPeers over the sim transport, bound-only, as the web
transport behaves. Each fence has mutants that delete the fix; each must go
red. F1, F2 and F8 shipped with 4.125.0 as `fence_lookup_reselect` (14
checks, seven mutants red, the death forced by a wrapper on the awaited
stage, OFF reproducing the 4.124.0 record).

- **F1 re-select after the await.** A chain where the chosen next hop is
  killed during the lookahead round. Off: the lookup ends `send-failed` at
  that hop with `connected:false` (today's 34). On: the hop takes its next
  candidate and the target is found; the killed candidate is absent from
  `path` and not counted in `hops`, and zero walk sends reach it. SHIPPED.
- **F2 validation-then-loss.** The channel dies between the liveness read and
  the send. On: caught, re-selected once, found. SHIPPED.
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
  route) still evicts nothing live. SHIPPED in part (the OFF controls).
- **F9 charge at invocation (R1).** A send that times out after transmission
  leaves the hop in `path` and `hops`; a pre-wait edge loss leaves it out.
  Mutants: charge on return; never reverse.
- **F10 re-send by class (R2).** A post-wait rejection re-sends a pub/sub
  body and the ingest holds it once; re-sends a `mesh:signal` only when the
  mesh's equal-attempt guard exists, and the responder's `_handleOffer` runs
  once for that attempt; re-sends a `lookup_walk` only when the receiver's
  per-walk set exists, and that receiver schedules no second step; ends
  `send-failed` for a type with no key. Mutants: re-send a keyless type; drop
  either guard.
- **F11 completion attribution (C2).** A `lookup_done` from a bound neighbour
  that is not the sent-to hop is dropped and logged; one from the sent-to hop
  settles the walk; the origin's `done` settles at the deadline while its
  first step is still pending to a legacy hop; `stop()` settles every pending
  walk. Mutants: accept any sender; await the first step; leave the map.
- **F12 the trace (R3).** `lookup-reselect` carries the error text and the
  pre-wait or post-wait mark. Mutant: drop either.

**On the fleet,** the same readings as Part 1, with `ops/signal-trace-
tally.py` over equal windows at equal positions after a roll: relayed signals
not sent, and failure marks over offers sent, plus, since 4.125.0, send
failures at our relays with `connected:false` and `lookup-reselect` by kind
and reason. The 4.125.0 window is the baseline for R1 to R4: 466
re-selections, 368 after a send threw (timing unmarked until R3), the class at 1; the next read counts, per responder and attempt id, offers
received more than once (`offer-recv` twice for one attempt) against the
4.124.0 window. With `SIGNAL_ROUTE_FIRST` on,
`not-sent` is replaced by the route's own outcomes (`delivered`,
`terminal-not-target`, `exhausted`, `send-failed`), so the number to watch is
offers that reached the target (`offer-recv` at the far end, joined by attempt
id as in 7ce27c7c) over offers issued. A control arm exists for the first
time: the flag off on half the relays, on on the other half, same window.
Neither reading proves a dial opened; `answer-applied` and the ICE outcome say
that. Two gaps to know when reading: the bridge's own `route_msg` wrapper
emits no `relay-signal-hop`, so a signal that transits a bridge has no hop row
there (council c5d11f8b, Aster 0a389bde); and a reasonless verdict names a
response shape, not a node or a version.

## Part 6. Questions, with the reviews so far

Each open item is written as its question with its choices.

**Q1. Does B1 ship alone first?** ANSWERED by David: "Ship B1 first". Shipped
as 4.125.0, armed on the relays, read once (Part 3). Orion 22fc13fe and
Aster 0eb14d98 had concurred with (a).

**Q2. What are the numbers for B2's budget?** Orion proposed 8 credits and a
depth of 4 and a latency under 200 ms (446f930a); Aster declined them as
unratified (c2ff06ce), and the packet agrees nothing here derives them.
Choices: (a) take Orion's numbers as the first arm and measure; (b) derive
them from a hop histogram of delivered signals over one full day, then set
credits at the 95th percentile of hops plus one split and the depth cap at
the 99th (Orion's formula, c0a0b59a, recorded as the candidate under (b));
(c) make them domain constants and let the first fleet window decide. The
packet recommends (b), before any build of B2. Orion takes (b). David's word
is open.

**Q3. What does the origin do when the search exhausts?** Today a withheld
offer leaves the dialer to wait out the 30 s negotiation deadline and mark the
peer. Choices: (a) same: report failure, release the reservation, let the
deadline run; (b) end the attempt at once with a new reason so the dialer's
budget moves to its next candidate within the same tick. Aster's A2 asks that
an uncertain timed-out send keep its spent budget and its dedup identity
either way. The packet recommends (b) only if the attempt guard already
distinguishes "ended by route exhaustion" from "ended by deadline"; it does
not today (:792). Open.

**Q4. Mixed versions.** A hop without the B2 frames answers "no handler". Choices:
(a) treat it as a wall and spend no credit on it; (b) treat it as a wall and
charge one credit, so a mesh of old hops exhausts fast; (c) do not ship B2
until the door floor passes the version that carries it. The packet
recommends (b); Orion takes (b). A and B1 need no new frame. Open.

**Q5. The 95 failures at other hops.** Their cause is unread. Choices: (a)
accept that this packet does not address them and say so in its results; (b)
add the origin's `relay-signal-origin` line to the apps and seats so the next
window reads them; (c) ask the seat owners to restart on 4.124.0 and re-read.
The packet recommends (a) and (b) together; (b) is a logging change, not a
design one. Open.

**Q6. The Floor's open word.** Does 40 mean M ∪ I or inbound only? Still
David's, carried from Connectivity Floor v0.2; item D waits on it.

**Q7. Do the seats restart now?** 462 of the 598 withheld signals in the
4.125.0 window carry no reason, the shape of a pre-4.122.0 hop, and the four
seats run 4.118.0. Choices: (a) each owner restarts their seat on the current
relay checkout now, and the next equal window says how much of the 462 was
them; (b) wait for A, which removes the question the old hops cannot answer;
(c) both. The packet recommends (a): it is the one lever that costs no code.
The Claude app restart is David's to trigger.

**Q8. What does a re-send need, per class (R2)?** For `mesh:signal`: (a) the
mesh ignores an offer or answer repeating the attempt it holds for that peer
(one guard at mesh.js:993, before `_handleOffer`); (b) forbid the re-send and
end `send-failed` after a post-wait rejection, as 4.124.0 did; (c) leave it,
and let the provider decide what a repeated `setRemoteDescription` does. For
`lookup_walk`: (a) a per-walk `(walkId, hop)` set at the receiver, bounded
and aged by the walk deadline; (b) forbid; (c) leave it, since the origin
settles on the first `lookup_done`. The packet recommends (a) for both. (c)
is the as-built 4.125.0 behaviour for both and is what the fleet runs today;
if (a) waits, (b) is the safe interim and costs the 34-class back only for
the post-wait case.

Standing reviews: Aster b316b4b2, aaba1e33 (A1), c2ff06ce (A2), 0eb14d98 (A3),
f0012884, 4db46bc1, c0cb3c6c, 9051c5a0 (corrections, applied); Orion e9862f68,
446f930a, cc9aeca6, 22fc13fe, c0a0b59a, 121bd7a0 (adopts the corrections);
Vega 6fdd5036 and 44faed22 (concur, no bridge fallback; the scale, PWA and
migration challenge Aster asked of Vega is still open).

## Part 7. What would make this wrong

- The race is a mechanism consistent with 34 records in the 4.124.0 window
  and with the 466 re-selections of the 4.125.0 window, by section and
  second. No record proves it per attempt; these logs hold no attempt join.
  If a future window with a join showed those sends issued BEFORE the
  eviction stamp, B1 is still correct and the records would have another
  cause.
- The 95 at other hops are the larger population and are unexplained. If they
  are stale entries at nodes that never run `onPeerDied` for a socket-closed
  peer, C addresses them only on nodes that ship C.
- The 462 reasonless verdicts are read as old hops. If a current-kernel hop
  returns no reason on some path this packet has not read, Q7 moves nothing.
- Dropping the veto could send more signals toward targets that are not
  there. The budget bounds each request, not the sum; a dialer that nominates
  many dead candidates spends many requests. The Floor's C1 and the dead-mark
  automaton are the bound on that, and neither is measured here.
- B1's re-send after a post-wait rejection duplicates frames today for every
  class on the signal path, offers included. If the next read shows
  responders taking an attempt's offer twice and the provider doing anything
  with it beyond an error, R2 moves ahead of A, and (b) of Q8 ships at once.
- No control arm has been run. Part 5's half-fleet arm is the first.
- A probe hit is a path that existed when probed. A channel on it can die
  before the reply; F6 bounds the wait, it does not make the path hold.
