# Mesh connectivity: hold and fill (v0.2)

**Status:** design for council review, revision 2 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Bridge:** 2.145.0 (`533ad04`) ·
**Policy set by:** David · **Author:** axona.bot ·
**Supersedes:** v0.1 (axona-docs `4ad3741`), left in place as record ·
**Revision driver (v0.2):** Aster `8f082cec`, CHANGES REQUIRED on v0.1, seven
items, two of them corrections of fact conceded at `ed0393aa`: v0.1's rollout
claimed "no behaviour change with every mechanism off" and that was false,
because anneal runs on lookup traffic behind no switch; and v0.1's overlap
arithmetic assumed phases re-drawn each cycle, which fixed periodic offsets do
not give. The other five were holes: reconcile bypassed admission, the capacity
model had no transitions, swap overlap meant cap+1, the composition rule could
block or churn forever, and nothing gated retirement on topic duty. Aster
`40fa6895` added two precisions taken here: attainable degree is bounded by
`min(cap, N − 1)` with the lane stated as a constraint inside cap, not a
subtraction; and a re-drawn phase removes deterministic lockout without
guaranteeing overlap, so case 7 keeps a no-overlap execution. Earlier
drivers: David's direction of 2026-10-04; the thread `16b554bd` → `dbd5d95f` →
`6fbadf9d`; Aster `79d241d7`, `ac344f10`, `2552a639`, `4a58b7fb`, `1b2a24ad`,
`14d11520`; Vega `127cb170`, `0dbc5da6`.

**What changed from v0.1:** *The question*, *What this document is not* and
*What the code does today* are unchanged and not repeated; read them in v0.1.
Everything from *The two rules* onward is rewritten. New sections: *States and
transitions*, *The duty gate*. The repair table is split into active-path and
gated rows. The parameter table gains the stage TTL, the churn bound and the
phase draw.

This document is a design. It changes no code, arms no mechanism, moves no
gate, and runs nothing live. Every file:line is against `270835d` unless the
bridge is named, where it is against `533ad04`. Deploy is David's.

---

## The two rules

### Rule 1: hold everything below the limit

While the admitted table is below cap, no voluntary path removes a peer.

RETAIN is unconditional below cap. ADMIT is qualified: the gate's join lane
reserves the last `kJoin` slots inside cap and refuses a candidate on
one-per-id-per-window and lane cooldown (`AxonaPeer.js:2064–2082`). Those
reservations survive under this policy; the lane is what stops one identity
refilling a table on its own. The attainable admitted degree for a node is
bounded by `min(cap, N − 1)` before reachability, mutual capacity and policy
take their share. The lane is a constraint INSIDE cap on who fills the last
`kJoin` slots, not a subtraction from the peer population: with cap 50,
`kJoin` 2 and `N` = 10, all nine eligible peers fit below the lane threshold
of 48, and with qualified newcomers the reserved slots fill too. So at `N` = 60
with cap 50 the bound is the cap; at `N` = 20 it is 19, not "near cap". v0.1
said near cap, and `ed0393aa` subtracted `kJoin` unconditionally. Both wrong
(Aster `40fa6895`).

Every deletion from the admitted table carries a reason from a closed set:
`loss` (class A exhausted, class B), `policy` (identity or admission refusal
discovered after admission), `cap-change` (the operator lowered the cap),
`swap` (the at-cap rule below, and only at cap). "Idle" is not in the set.
Anneal as it stands prunes below cap and is retired by this rule.

### Rule 2: fill to the limit, continuously

While the admitted table is below cap, discover and dial. Stop at cap, or when
the fill stalls, and report which.

The target is cap. `kNear` stays a selection quota for the nearest band. The
tick order:

1. RECONCILE. Every peer in state BOUND that is not ADMITTED is offered to
   admission, with zero new dial, under the same atomic decision as any other
   candidate. Admission may refuse it: at cap, inside the lane, on policy.
   A refused bound peer stays BOUND, stays charged as a physical channel, and
   is closed on the grace timer unless the duty gate holds it. v0.1 said any
   bound peer enters the table. That bypassed admission and is withdrawn.
2. NEIGHBOURS. Candidates from `find_closest_set` and lookahead responses,
   into the candidate cache, bounded.
3. DIRECTORY. Candidates from the bridge sample, when the node holds one.
4. DIAL. Up to `maxPerTick` candidates leave the cache, each one reserving a
   PENDING slot and a physical slot before the first frame is sent. A dial
   that cannot reserve is not issued; it stays in the cache and is counted as
   `dial-deferred`.

Rate is bounded per tick with jitter. Outstanding attempts are bounded by the
PENDING invariant below, which holds through repeated ticks and through a
suspended PWA resuming its timers in a burst, because a tick that finds the
PENDING bound full issues nothing.

## States and transitions

A peer relationship on one node is in exactly one of these states. The node is
single-threaded; "atomic" below means no `await` between the check and the
commit. Every transition is a named function that checks the invariants, then
commits, then schedules any async work.

| state | meaning | counted in |
|---|---|---|
| UNKNOWN | no record | nothing |
| NOMINATED | an id in the candidate cache, not yet dialed | cache |
| PENDING | a dial reserved and issued, or an unsolicited offer accepted for negotiation; not yet bound | pending, physical |
| BOUND | the axona/4 handshake bound an identity on an open channel; not in the admitted table | physical |
| ADMITTED | in the routable table | admitted, physical |
| STAGED | bound, held as the replacement in an at-cap swap, outside the table | overlap, physical |
| RETIRING | close issued, not yet confirmed by the transport | physical |
| CLOSED | channel gone; a mark may remain | marks |

Every PENDING, BOUND, STAGED and RETIRING record carries an owner (which
mechanism issued it: reconcile, neighbours, directory, triadic, swap, inbound)
and an attempt generation, a counter per peer id incremented on every new
attempt. A callback carrying a generation other than the current one for that
peer is stale: it is reported and discarded, and it never retires, admits or
stages anything. In particular a stale timeout never closes a newer channel to
the same peer.

The invariants, each checked before the commit of any transition that could
violate it:

```
|ADMITTED|                              ≤ cap
|PENDING|                               ≤ P_pending
|PENDING ∪ BOUND ∪ ADMITTED ∪ STAGED ∪ RETIRING| ≤ C_phys
|STAGED|                                ≤ S_overlap           (S_overlap ≥ 1, part of C_phys)
|NOMINATED|                             ≤ K_cache
signalling bytes queued per peer        ≤ B_sig
directory sample held                   ≤ R_sample
suppression marks                       ≤ M_marks
```

`C_phys` is the physical bound: open RTCPeerConnections, whatever their state.
It is checked BEFORE a PeerConnection is allocated, counting everything
already in PENDING, BOUND, ADMITTED, STAGED and RETIRING. A channel in RETIRING
still counts. v0.1 charged physical at creation without saying it was checked
first. It is checked first.

The transitions:

- `nominate(id, source)`: UNKNOWN → NOMINATED if `|NOMINATED| < K_cache` and
  no mark forbids it. Otherwise dropped and counted.
- `dial(id)`: NOMINATED → PENDING if both `|PENDING| < P_pending` and the
  physical bound has room. Allocates the PeerConnection, assigns owner and
  generation, calls `attemptGuard.begin(id)`, sends the first frame. The
  guard's `end(id, bound)` is called at exactly one of `bind`, `cancel`,
  `timeout`, never before.
- `offer(id)` (inbound): UNKNOWN or NOMINATED → PENDING under the same two
  bounds. An inbound offer is charged to the same decision as an outbound dial
  and is refused the same way when the bounds are full. One decision for both
  directions.
- `bind(id)`: PENDING → BOUND when the handshake completes. Pending accounting
  is released HERE, at the moment the record becomes BOUND, not before. The
  physical count is unchanged. Then, synchronously, `admit(id)` runs.
- `admit(id)`: BOUND → ADMITTED if `|ADMITTED| < cap` and the lane and policy
  say yes. This is the one admission function; reconcile, bind, inbound and
  swap-commit all call it, and it is evaluated at completion time, atomically.
  There are no admission-slot reservations; the pending and physical bounds
  are what keep completion-time admission from being overrun. If `admit`
  refuses, the record stays BOUND with reason `refused:<why>` and a grace
  timer starts.
- `stage(id)`: BOUND → STAGED, only from the swap rule, if `|STAGED| <
  S_overlap`. Starts the stage TTL.
- `commit-swap(v, c)`: atomically: revalidate (below) → `retire(v, 'swap')`
  → ADMITTED(c) from STAGED. `|ADMITTED|` never exceeds cap, because `v`
  leaves in the same synchronous step that `c` enters.
- `retire(id, reason)`: any of BOUND, ADMITTED, STAGED, PENDING → RETIRING.
  For a VOLUNTARY reason (`swap`, `refused` grace, `cap-change`) the duty gate
  runs first and may refuse. For an involuntary one (`loss`) it does not.
  `retire` issues the close; it does not release physical capacity.
- `closed(id)`: RETIRING → CLOSED on the transport's close callback, matched
  by generation. Physical capacity is released HERE. A timeout on the close
  itself escalates to a forced `pc.close()` and then `closed`; the capacity is
  released when the transport confirms, not when the timer fires.
- `timeout(id)`: PENDING → RETIRING by the negotiation deadline, with
  `end(id, false)`. Physical capacity follows the `closed` rule above.
- `mark(id, reason, lifetime)`: on CLOSED, a suppression mark. `loss` marks
  carry the guard's schedule and expire; `policy` marks have no timer. An
  exhausted `loss` mark reactivates on bounded, authenticated fresh evidence
  only: a `bind` event from that identity, or a signed presence record. Timer
  expiry re-enters the candidate pool once per exhaustion; repeated nomination
  does not reset exhaustion. The storm of 2026-06-29 was a reset on
  nomination.

Crash and resume. Nothing in these states is persisted; a nodeId is never
written to disk (the protocol refuses the correlator). On process start every
set is empty and the physical count is zero by construction. On a PWA resume,
timers fire once each; a tick that finds PENDING full issues nothing, and
every callback that arrives for a generation the resume did not see is stale
and discarded. Cancellation: `cancel(id)` is `retire(id, 'cancel')` from
PENDING or STAGED with `end(id, false)`.

## Cap is the knob

`MAX_SYNAPTOME` is 50 (`AxonaDomain.js:68`). At sixty nodes, fill-to-cap gives
each node up to `min(cap, 59)` admitted peers, less whatever reachability,
mutual capacity, policy and lane qualification refuse, each reported by name.
At six hundred, fifty chosen by composition, with the nearest `kNear`
protected by name and the rest by band and vitality. One mechanism at both
scales.

The cap is per node class and David sets it. Nothing here is evidence that
any number is safe on any class.

Fill-to-cap is conditional liveness. The node reports `fill-stalled` with one
of these when it cannot proceed, and reports `fill-unknown` when it cannot tell
which:

- SUPPLY: no candidate in the cache and none offered this tick.
- MUTUAL CAPACITY: the remote refused on its own cap or lane (an explicit
  refusal frame, not a timeout).
- AWAKE: the tick did not run on schedule (measured by the gap between ticks).
- RENDEZVOUS: a dial could not be signalled (no mesh route and no bridge
  socket), reported per attempt.
- FAIR RETRY: every candidate is under an active mark.

One timeout is one observation. It is reported as `observed: timeout` for that
attempt and nothing is inferred from it about supply or rendezvous. v0.1 let a
node conclude exhaustion from a timeout. It cannot.

## Discovery across cohorts

Neighbour-list gossip reaches the connected component and nothing outside it.
The bridge is the only thing that has seen both pieces, and today it forgets a
node the moment it graduates.

**The directory.** The bridge keeps a registry of nodeIds that have
authenticated to it, each with a registration lifetime `L_reg`, bounded in
size. A newcomer's `peer-list` is drawn from the sockets, as now; its
`directory` is a sample of at most `R_sample` registered ids, including
graduates. A directory entry is a name, not a route: it is a candidate for
step 3 of the fill, and dialing it needs a signalling path.

**Periodic re-contact.** A graduated node returns to the bridge, stays for a
window `W`, refreshes its registration, is introduced to whoever is on the
socket, receives a fresh directory sample, and leaves. The next return time is
drawn after each visit, uniformly in `[T/2, 3T/2]`. The draw is the point:
with fixed periods and fixed offsets two nodes with disjoint phases never
overlap. With the phase re-drawn each visit, a given pair's chance of
overlapping in a given cycle is about `2W/T` when `W ≪ T`, and the expected
cycles to a first meeting about `T/2W`: at `T` = 10 min, `W` = 60 s, five
cycles, about fifty minutes. Mean socket occupancy is `N·W/T`, six at `N` =
60; that is a mean, not a bound. The concurrency bound is the bridge's own
cap: a node that arrives when the bridge is full is refused and returns on its
next draw. Raising `W` raises the mean load in proportion.

These figures are illustrations of the mechanism. They are not an admission
guarantee and not a discovery guarantee. What makes them wrong: a fleet
restart puts every node on the same phase for one cycle; sleeping nodes do not
return; at larger `N` the bridge's cap binds first, and the bridge shards
before `N·W/T` approaches `BRIDGE_MAX_PEERS` (15 in production).

Two graduates whose draws never overlap never meet through the bridge. The
design does not claim otherwise. The re-drawn phase removes fixed-offset
lockout as a deterministic pattern; it guarantees overlap in no finite run.
Case 7 under *Verification* keeps a no-overlap execution, in which the node
reports the stall and claims nothing, and adds a controlled-overlap execution,
in which progress is shown conditional on bridge admission, signalling time,
mutual capacity and awake endpoints. A chosen seed that happens to overlap is
not evidence of anything, and no eventual-progress claim is made without its
probability and fairness assumptions written next to it (Aster `40fa6895`).

The handle-prefix region in anchor selection (`server.js:1223`,
`anchor_select.js:25`) is an active-path bridge change (see *Rollout*):
anchors group by the bound nodeId's region, as graduation already does
(`server.js:559–563`).

## Discovery at cap

Below-cap-only discovery halts on two saturated disjoint cohorts. A node at
cap still nominates at a bounded rate and may swap, under one rule with a
terminating decision.

**Composition.** The table has `kNear` nearest-by-XOR peers, protected by
name: they are never victims. The remaining slots are described by a band
vector: for each XOR stratum group, the count of admitted peers and a feasible
minimum `m_b`, where feasible means "attainable from the candidates this node
has seen in the last `V_obs`". A band whose minimum is not feasible is a
deficit the node already carries and cannot fix; the rule is NON-WORSENING of
existing deficits, not "every band at minimum after removal". v0.1's rule
could forbid every swap while an unrelated band had no supply.

**Score.** One number per table: the sum of band deficits weighted by band,
plus a diversity term. A candidate `c` has a diversity credit only when the
observation is VALID: at least `q` fresh neighbour responses inside `V_obs`
reported their tables and none listed `c`, and the two-hop lookahead for `c`
returned without timeout and did not reach it. Missing responses, timeouts
and asymmetric tables make the observation UNKNOWN, and UNKNOWN earns no
credit. A negative observation is a hint about diversity; it is never evidence
of another component, and the design does not use it as one.

**The swap rule.** `commit-swap(v, c)` runs only when all hold:

1. `c` is STAGED: bound, authenticated, admitted by the remote end (an
   explicit frame), inside the stage TTL.
2. `c` strictly improves the score by more than the hysteresis `h`, computed
   against the table as it is at commit time.
3. `v` is the lowest-vitality admitted peer, not in the protected `kNear` set,
   whose removal does not worsen any existing deficit.
4. At most one swap is in flight per node, and the last swap committed more
   than `C_swap` ago (the churn bound).
5. The duty gate permits retiring `v`.

At commit the node revalidates, synchronously: `v`'s identity and generation
are unchanged; `cap` is unchanged (a cap reduction during the stage aborts the
swap, retires `c`, and the cap-change path handles `v`); policy still admits
`c`; the `kNear` set still excludes `v`; the band counts still satisfy 3; `c`
is still live (last pong inside `STALE_PONG_MS`); and a competing inbound bind
that filled a slot during the stage is resolved by the rule "the admitted
table decides": if a slot opened, `c` is admitted without a victim and the
swap is void.

**Bilateral.** The remote end's admission is its own decision. The stage
begins only when the remote has sent its admit frame; if it refuses or the
stage TTL expires, `c` is retired with `end(c, false)`, `v` is untouched, and
the attempt is counted. Both ends full is a refusal from the remote, handled
the same way, inside a finite TTL. "Local open" is never read as remote
acceptance.

**Termination.** Strict improvement by more than `h`, one swap per `C_swap`,
and a score that is bounded below give a finite number of swaps per node
between changes in the observed candidate set. When no admissible swap exists
the node reports `swap-none`; when condition 5 blocks, `swap-blocked: duty`.
Neither is convergence and neither is claimed as such.

Anneal is the ancestor of this rule and is retired by it: the rule above is
anneal with the order fixed, the below-cap case removed, the victim chosen by
band with the nearest protected, strict improvement with hysteresis, a churn
bound, a duty gate and a reason.

## The duty gate

A physical channel is sometimes the only path a topic obligation rides on: a
root's replication to its backups, a backup's standby, a host's served topic,
a handoff in flight. Retiring that channel voluntarily is not permitted while
the obligation is outstanding.

The gate is a function `mayRetire(v)` evaluated synchronously inside
`retire()` for every voluntary reason. It consults the pubsub layer's duty
registry: for every role this node holds, the set of peers the role's current
contract requires a path to (replication targets, the root for a backup, the
subscriber set a host serves). If `v` is in that set and the contract's
handoff or discharge has not completed, `mayRetire` returns false with the
duty named. The caller then: keeps `v` and its resources charged; stops
further swaps while the overlap reserve is held; reports `swap-blocked: duty`
or `refuse-grace-blocked: duty`; and retries when the duty registry changes.

An involuntary loss of `v` (class B) does not consult the gate; it cannot. It
enters the role's own recovery path, which is the step-down hold and the
reconcile machinery already in the kernel. Loss is never read as discharge.

The step-down hold's tests (`smoke_root_stepdown_hold`, 83 checks) remain
green through every change here; they are necessary, not sufficient. The
gate's own tests are under *Verification*.

## Losses

The four classes keep their names and stay separate.

- Class A (negotiation failed): one re-offer, offerer-only, inside the
  deadline, as today. On exhaustion: `timeout` → RETIRING → CLOSED → a `loss`
  mark.
- Class B (an open channel died): `_retire` closes dc and pc as today; the
  record goes RETIRING → CLOSED; a `loss` mark is set with the guard's
  schedule; the id re-enters the candidate pool when the mark expires; a
  re-dial goes out as any other dial, under the pending and physical bounds,
  through `connectViaRelay` when the bridge socket is closed. Exhaustion
  reactivates only on fresh authenticated evidence. The 04:33Z event under
  this rule: 46 marks, then 46 re-dials spread over the guard's schedule and
  the tick budget, binding if the srflx path is back and backing off if not.
- Class C (graduation watchdog): unchanged; a backstop. The collapse re-dial
  on branch `graduation-collapse` (`8fead6d`) stays on the branch.
- Class D: the fill.

No ICE restart. Its own change, its own review.

## The repairs, split

v0.1 said the repairs could ship with no behaviour change because the
mechanisms were off. False. `_tryAnneal` is called from the lookup path
(`AxonaPeer.js:5381–5383`) behind no switch, `_evictAndReplace` and the gate
call `closeConnection`, `_selfIntegrate` runs on every relay start, and anchor
selection runs on every bridge admission. Each row below says which kind it
is. An ACTIVE-PATH row changes production behaviour the day it ships and
needs its own review and David's word. A GATED row is inert until an env arms
it.

| defect | where | repair | kind | fence |
|---|---|---|---|---|
| anneal prunes below cap, deletes before it opens | `AxonaPeer.js:4662–4705`, called at `:5381` | remove the call; the swap rule replaces it, gated | ACTIVE (removal stops below-cap pruning in production) | lookup-heavy test asserts table size never decreases below cap |
| `closeConnection` unbinds, does not close | `webrtc.js:345–348` | `mesh.disconnect(meshId)` after `unbindPeer`; physical count drops | ACTIVE (via `_evictAndReplace`) | test counts open PCs after close |
| hex string into BigInt map | `AxonaPeer.js:1315` | pass the BigInt | ACTIVE: a correct `_selfIntegrate` dials up to `K` = 20 on every relay start, so the fix lands together with the pending bound and ships only with the guard; until then it stays as is | two-node test asserts opened > 0; fleet test asserts dials ≤ `P_pending` |
| maintenance skips bound-not-in-table | `AxonaPeer.js:1357` | reconcile step calling `admit` | GATED | bound-out-of-band peer is admitted with zero dials, or refused and still counted |
| relay fallback outside the guard | `AxonaPeer.js:4545–4566` | `end()` at bind, cancel or timeout of the relay attempt; the attempt's completion is the authenticated bind event or its timeout, not the `connectViaRelay` promise | GATED | test asserts `begin`/`end` bracket the bind or timeout event |
| `hop_cache` has no sender | `AxonaPeer.js:815` | a sender on the lookup trace, bounded by `LATERAL_K` | GATED (sent only when maintenance is armed) | once per successful lookup, not per hop |
| `_deadPeers` has no expiry or reason | `AxonaPeer.js:623`, `:4762–4770` | marks with reason and lifetime; reactivation on fresh evidence only | ACTIVE for the filter (anneal and evict read it today); the expiry is GATED | clock advance re-nominates a `loss` mark once; a `policy` mark never; repeated nomination does not reset |
| anchor region reads the handle | `server.js:1223`, `anchor_select.js:25` | bound nodeId's region, as `connRegion` | ACTIVE (bridge) | two handles in one region are one region |

Each row is a separate commit with its own fence, and the ACTIVE rows go to
council one at a time.

## Rollout

1. ACTIVE-PATH REPAIRS, each on its own, reviewed and released on David's word
   through `RELEASE-PROCEDURE.md`. Order: `closeConnection` closes (smallest
   blast radius, measurable by the open-channel count); anneal removal (the
   behaviour change David asked for by Rule 1); the `_deadPeers` filter with
   reasons; the bridge anchor region. The `_selfIntegrate` key fix waits for
   step 3.
2. MEASURE. Open channels with no binding per node; bound and admitted peers
   per node, distribution; marks by reason; greedy terminal count per topic;
   `fill-stalled` and `swap-none` counts once they exist. Before and after
   each step-1 release.
3. GATED CHANGES on a branch: states and transitions, reconcile, the guard
   window, the `hop_cache` sender, the expiry, the swap rule, the duty gate,
   the directory and re-contact. Full suite, manifests, fences, council
   review. Released as a kernel version whose gated code is inert because no
   launcher sets the envs. The `_selfIntegrate` fix rides this release behind
   the guard.
4. ARM ON TESTNET, TOGETHER. Maintenance, gate and guard on the testnet relays
   at once, fill target at cap. `relay.js` keeps its refusal below 4.67.1.
   Twenty-four hours of the step-2 measurements. Pass: the admitted-degree
   minimum at `min(cap, N − 1)` for the testnet's `N`, with every shortfall
   accounted for by a named refusal (lane, policy, mutual capacity,
   rendezvous) and none by silence; outstanding
   attempts never at `P_pending` for more than one guard cycle; a forced
   fleet restart that stays inside the budget; zero `swap` churn above
   `1/C_swap`.
5. PRODUCTION, on David's word, one host group at a time, with the step-2
   measurements before and after each group. The launchers change in their
   own commit; arming never rides a kernel release.

## Verification

Offline cases, each a test before any live run. Aster's eight from
`14d11520`, restated where v0.2 changed the claim, then the cases the seven
items added.

1. One free slot, concurrent inbound and outbound completions: exactly one is
   admitted; the other stays BOUND with `refused:cap`, is counted in physical,
   and closes on the grace timer. The table is at cap.
2. Reconcile at cap−1 with three existing bindings: one admitted, two refused
   and still counted; zero dials issued.
3. Reserved vacancies: below cap but inside the lane, a non-qualifying
   candidate is refused, a qualifying one admitted; a reconcile candidate
   inside the lane follows the same rule.
4. Delayed bind after timeout or generation change: the bind carries the old
   generation, is reported and discarded; the newer channel to the same peer
   is untouched; physical capacity for the old attempt is released only on
   its `closed`.
5. Long PWA suspension and resume: timers fire once; PENDING never exceeds
   `P_pending`; no dial for an id already PENDING; stale callbacks discarded.
6. Stale or malicious repeated nominations: an id nominated every tick is
   dialed on the guard's schedule only; after exhaustion, repeated nomination
   and timer expiry do not re-dial; a bind event from that identity does.
7. Graduated cohorts and rendezvous, two executions. (a) No overlap: the fill
   reports `fill-stalled: rendezvous` per attempt, or `fill-unknown` where it
   cannot tell, infers nothing about supply, and the test asserts that no
   convergence is reported. (b) Controlled overlap: with bridge admission
   available, signalling time inside the deadline, mutual capacity and both
   endpoints awake, one visit produces an introduction and a bind; the test
   states those four conditions as its preconditions and passes on nothing
   less. Neither execution is a probabilistic claim about production.
8. Two full disconnected cohorts: the node at cap reports `swap-none` when no
   valid-observation candidate exists, performs one fenced swap when one does,
   and never exceeds cap in ADMITTED at any instant.
9. Physical bound: with `C_phys − 1` channels open across all states, a dial
   and an inbound offer are both refused; one `closed` later, exactly one
   proceeds.
10. Timeout does not free physical capacity: a PENDING attempt that times out
    holds its physical slot until the transport's close callback; a forced
    close escalation releases it on confirmation.
11. Swap overlap: during a stage, `|ADMITTED|` = cap and `|STAGED|` = 1;
    commit lands at cap; a cap reduction mid-stage aborts and retires `c`; a
    competing inbound bind that opens a slot voids the swap and admits `c`
    without a victim; remote refusal retires `c` and leaves `v`.
12. Composition termination: a plateau of interchangeable candidates produces
    at most one swap per `C_swap` and then `swap-none`; a deficient unrelated
    band does not block an improving swap; a `kNear` nearest peer is never
    chosen as victim; a candidate with UNKNOWN observation earns no diversity
    credit.
13. Duty gate: a victim that is a replication target of a root role this node
    holds is not retired; the swap reports `swap-blocked: duty` and resources
    stay charged; after the handoff completes the retry proceeds; a class-B
    loss of the same peer does not consult the gate and enters the role's
    recovery path.
14. Retry reactivation: an exhausted `loss` mark reactivates on a bind event
    or a signed presence record and on nothing else.
15. Fences for every repair row, each failing with the repair removed.
16. `smoke_root_stepdown_hold` 83/83 and the full suite green at every step.

## What this design does not establish

- That any cap is safe on any class.
- That re-contact meets any pair in bounded time; it gives a probability under
  a re-drawn phase and nothing under a fixed one.
- That a denser mesh ends split roots. The Monte Carlo in `16b554bd` stays a
  model figure.
- The fleet impact of unbind-only `closeConnection`. Measured at step 2.
- The cause of the 04:33Z event.
- Global convergence of the at-cap rule. It terminates and reports; it does
  not promise to reach a particular graph.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| cap, relay / seat | 50 | PSI pressure on a 1-core droplet at 50 channels |
| cap, browser / PWA | 12 | a 24 h phone run with battery and memory flat |
| `kJoin` | 2 (existing gate default) | a measured need for more newcomer lanes |
| `P_pending` | 8 (existing `MAX_VERIFY_PROBES`) | fill time to cap over ten minutes at N = 60 with supply present |
| `C_phys` | cap + `P_pending` + `S_overlap` + 4 | the open-channel-with-no-binding count at step 2 |
| `S_overlap` | 1 | never above 2 without a measured reason |
| `K_cache` | 64 (existing `MAX_PENDING_RELAY_NEGOTIATIONS`) | cache eviction rate at step 4 |
| fill tick / per tick | 15 s / 3 (existing) | the step-4 storm check |
| guard schedule | 30 s, ×2, 4 attempts (existing) | unchanged until a measured reason |
| `loss` mark lifetime | the guard's exhaustion time | ties the schedules |
| stage TTL | 30 s (`NEGOTIATION_DEADLINE_MS`) | a measured bind time above it |
| hysteresis `h` / churn bound `C_swap` | one band-deficit unit / 5 min | swap rate at step 4 |
| observation validity `q` / `V_obs` | 3 responses / 60 s | lookahead response rates at step 2 |
| re-contact `T` / `W` / phase draw | 10 min / 60 s / `U[T/2, 3T/2]` | grow `T` with N; shard before `N·W/T` nears `BRIDGE_MAX_PEERS` |
| `L_reg` / `R_sample` | 24 h / 16 | registry size at the bridge |
| refused-grace | 60 s | duty-gate blocks at step 4 |

## Where the code stands

Nothing in this document is implemented. v0.1 is at `4ad3741` as record.
Branch `graduation-collapse` (`8fead6d`) stays unreleased. The modules this
design arms exist and are off. The first change is the first ACTIVE-PATH row,
on its own branch with its own fence, and it comes to council before anything
else moves.
