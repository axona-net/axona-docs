# Mesh connectivity: hold and fill (v0.3)

**Status:** design for council review, revision 3 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Bridge:** 2.145.0 (`533ad04`) ·
**Policy set by:** David · **Author:** axona.bot ·
**Supersedes:** v0.2 (axona-docs `769183f`), v0.1 (`4ad3741`), both left in
place as record ·
**Revision driver (v0.3):** Aster `a313d87b`, CHANGES REQUIRED on v0.2, six
transition-level contradictions and two on marks and presence, with the
decisions recorded at `d5a37cc6` before this file was written. The plain
errors in v0.2: one state per peer could not represent an old channel
retiring beside a new attempt to the same peer, which case 4 allowed; case 9's
arithmetic refused two requests where one should proceed; the guard's `end()`
would have fired twice; `cancel` was missing from the voluntary reasons; "a
competing inbound bind opens a slot" was backwards; the `closeConnection`
change was scheduled before the duty gate that makes it safe; and *Bilateral*
said both-full is a refusal while case 8 said two full cohorts swap. Aster
`6866077d`, before this file was frozen: a full mark table that drops a new
mark forgets exhaustion into permission, so overflow is a quarantine; nonce
eviction can re-admit a replayed presence record, so each identity carries a
high-water mark; and "no duty by construction" on an unadmitted channel is
only true if pubsub traffic is fenced to admitted peers, so `admit()` is the
transition that opens the fence and every voluntary close consults the gate
regardless. Earlier drivers: Aster `8f082cec`, `40fa6895`, `14d11520`, `79d241d7`, `ac344f10`,
`2552a639`, `4a58b7fb`, `1b2a24ad`; Vega `127cb170`, `0dbc5da6`; David's
direction of 2026-10-04; the thread `16b554bd` → `dbd5d95f` → `6fbadf9d`.

**What changed from v0.2:** *The question*, *What this document is not* and
*What the code does today* stay in v0.1 and are not repeated. *Discovery
across cohorts* stays as v0.2 wrote it except where the remote admit frame is
given its semantics under *Discovery at cap*. Everything else from *The two
rules* onward is rewritten. Saturated-cohort bridging is now listed as
UNSOLVED.

This document is a design. It changes no code, arms no mechanism, moves no
gate, and runs nothing live. Every file:line is against `270835d` unless the
bridge is named, where it is against `533ad04`. Deploy is David's.

---

## The two rules

### Rule 1: hold everything below the limit

While the admitted table is below the effective cap, no voluntary path
removes a peer.

RETAIN is unconditional below cap. ADMIT is qualified: the gate's join lane
reserves the last `kJoin` slots inside cap and refuses a candidate on
one-per-id-per-window and lane cooldown (`AxonaPeer.js:2064–2082`). The lane
is a constraint inside cap on who fills the last slots, not a subtraction
from the peer population. The attainable admitted degree is bounded by
`min(cap, N − 1)` before reachability, mutual capacity, policy and lane
qualification each take their share, and each share is reported by name.

Every deletion from the admitted table carries one reason from a closed set:

| reason | kind | consults the duty gate |
|---|---|---|
| `loss` | involuntary: class A exhausted, class B | no |
| `policy` | involuntary: identity or admission refusal discovered after admission | no |
| `swap` | voluntary, at cap only | yes |
| `cap-change` | voluntary: the operator lowered the cap | yes |
| `cancel` | voluntary: a PENDING or STAGED record withdrawn | yes; trivially true behind the routability fence, consulted anyway |
| `refused-grace` | voluntary: a BOUND record admission refused, closed after grace | yes |

"Idle" is not in the set. Anneal prunes below cap today and is retired by
this rule.

### Rule 2: fill to the limit, continuously

While the admitted table is below the effective cap, discover and dial. Stop
at cap, or when the fill stalls, and report which.

The target is cap. `kNear` stays a selection quota for the nearest band. The
tick order:

1. RECONCILE. Every logical peer in BOUND that is not ADMITTED is offered to
   `admit()`, with zero new dial, under the same atomic decision as any other
   candidate. Refusal leaves it BOUND and charged; the grace timer starts.
2. NEIGHBOURS. Candidates from `find_closest_set` and lookahead responses into
   the candidate cache, bounded.
3. DIRECTORY. Candidates from the bridge sample, when the node holds one.
4. DIAL. Up to `maxPerTick` candidates leave the cache; each reserves a
   pending slot and a channel token before the first frame. A dial that
   cannot reserve is deferred in place and counted `dial-deferred`.

Rate is bounded per tick with jitter. Outstanding attempts are bounded by the
pending invariant, which holds through repeated ticks and a resumed PWA
because a tick that finds pending full issues nothing.

## Channels, peers and transitions

v0.2 gave each peer one state. That cannot hold an old channel retiring
beside a new attempt to the same peer, and the node must hold both. v0.3 has
two records.

**A channel record** exists per RTCPeerConnection, keyed by a channel token
`t` minted at allocation and never reused in the process lifetime. It carries
the owner (which mechanism allocated it), its direction, the peer identity
once bound (null before), and its own state:

| channel state | meaning |
|---|---|
| ALLOCATED | PeerConnection created, no frame sent or received |
| NEGOTIATING | offer or answer in flight; for inbound, before any identity is trusted |
| OPEN | data channel open, axona/4 handshake bound an identity |
| CLOSING | close issued, transport has not confirmed |
| GONE | transport confirmed close; the token is released |

**A logical peer record** exists per identity the node has a reason to track,
keyed by nodeId, and points at its current channel token, or none:

| peer state | meaning | current channel |
|---|---|---|
| NOMINATED | in the candidate cache | none |
| PENDING | a negotiation attempt is in flight | ALLOCATED or NEGOTIATING |
| BOUND | an OPEN channel binds this identity; not in the table | OPEN |
| ADMITTED | in the routable table | OPEN |
| STAGED | bound and held as the replacement in a swap | OPEN |
| RESTING | no current channel; a mark may remain | none |

A peer in any state may ALSO have older channels in CLOSING. They belong to
the channel table, not to the peer record, and the peer record never points
at them.

**The invariants.** `chan(S)` is the number of channel records in the set of
states `S`; `peer(S)` likewise for peer records.

```
peer(ADMITTED)                                   ≤ cap_eff
peer(PENDING)                                    ≤ P_pending
chan(ALLOCATED ∪ NEGOTIATING ∪ OPEN ∪ CLOSING)   ≤ C_phys
chan(NEGOTIATING, inbound, identity = null)      ≤ C_inbound    (part of C_phys)
peer(STAGED)                                     ≤ S_overlap    (S_overlap ≥ 1)
peer(NOMINATED)                                  ≤ K_cache
bytes queued per channel                         ≤ B_sig
directory sample held                            ≤ R_sample
marks                                            ≤ M_marks
```

`C_phys` counts every PeerConnection in existence, in any state including
CLOSING, and is checked BEFORE allocation. A channel in CLOSING is released
only by its own close confirmation. Pre-authentication inbound channels are
bounded by `C_inbound` before any claimed identity is believed; an inbound
offer that would exceed it is refused at the signalling layer and never gets
a PeerConnection.

**The transitions.** The node is single-threaded; atomic means no `await`
between the check and the commit. Every transition checks the invariants it
could violate, commits, then schedules async work.

- `nominate(id, source)`: a peer record in RESTING or none → NOMINATED if
  `peer(NOMINATED) < K_cache` and no mark forbids it; else dropped and counted.
- `allocate(owner, direction)`: mints `t`, creates the channel in ALLOCATED, if
  `chan(all) < C_phys` and, for inbound, `chan(NEGOTIATING inbound unbound) <
  C_inbound`. Returns `t` or refuses. Nothing is sent on refusal.
- `dial(id)`: NOMINATED → PENDING if `peer(PENDING) < P_pending` and
  `allocate(dialer, out)` succeeds. The peer record points at `t`. The
  negotiation attempt gets a COMPLETION TOKEN `k`, distinct from `t`;
  `attemptGuard.begin(id, k)`. Sends the first frame.
- `offer(t)` (inbound, identity unknown): a channel in NEGOTIATING with no
  peer record yet. When the handshake binds an identity, the node looks up or
  creates the peer record and applies the same `P_pending` check it would for
  an outbound dial, counting this attempt; if the check fails the channel is
  closed with `refused:pending` and no peer state changes. One decision for
  both directions, applied at the first moment the direction has an identity.
- `bind(t, id)`: channel → OPEN; peer PENDING → BOUND; `end(id, k, true)`
  consumes `k`. Pending is released here. Then, synchronously, `admit(id)`.
- `admit(id)`: BOUND → ADMITTED if `peer(ADMITTED) < cap_eff` and the lane and
  policy say yes. The one admission function. Called from `bind`, from
  reconcile, and from `admit-staged`. On refusal the peer stays BOUND with
  `refused:<why>` and the grace timer starts. The ADMITTED record stores `t`
  and the generation of the decision.
- `stage(id)`: BOUND → STAGED, from the swap rule only, if `peer(STAGED) <
  S_overlap`, and only after the remote's admit frame has arrived on `t`.
  Starts the stage TTL. The attempt's `k` was already consumed at bind;
  staging has no completion token and never calls `end()`.
- `admit-staged(c, v)`: the swap commit, defined under *Discovery at cap*.
  STAGED → ADMITTED for `c` and ADMITTED → (channel CLOSING, peer RESTING) for
  `v`, in one synchronous step, after every precondition has been evaluated
  and none has mutated anything.
- `retire(id, reason)`: for a voluntary reason listed as consulting the gate,
  `mayRetire(id)` runs first and may refuse with the duty named; on refusal
  nothing changes and the refusal is reported. Otherwise: the peer's current
  channel → CLOSING; the peer → RESTING (or stays, for a swap, until
  `admit-staged` finishes its own step). The close is issued. Physical
  capacity is NOT released.
- `cancel(id)`: `retire(id, 'cancel')` from PENDING or STAGED. From PENDING it
  also consumes `k` with `end(id, k, false)`. From STAGED there is no `k`.
  `mayRetire` is consulted like any voluntary reason; behind the fence below
  it returns true for these states, and the design does not rely on that.

**The routability fence.** A channel carries pubsub traffic, in either
direction, only while its peer is ADMITTED. Before `admit()`, the transport
passes handshake and mesh-control frames (`mesh:signal`, `mesh:admit`, ping,
pong) and drops every application frame with a count, `fence-drop`. `admit()`
is the atomic transition that sets the channel's `routable` flag and inserts
the peer into the synaptome in one step; `retire()` clears the flag in the
same step it moves the channel to CLOSING. Role allocation reads the
synaptome, so no obligation can be assigned to a peer that is not ADMITTED,
and no obligation can arrive over a channel that is not routable. That is the
invariant "a BOUND, STAGED or PENDING peer carries no duty". It is enforced at
the frame boundary and tested there (case 22); it is not assumed from the
handshake.
- `closed(t)`: channel CLOSING → GONE, matched by `t`. Releases that channel's
  physical reservation and nothing else. If the peer record still points at
  `t` (an involuntary close), the peer → RESTING and the loss path runs. If
  the peer record points elsewhere (a newer channel to the same identity), the
  peer record is untouched. A `closed(t)` for a `t` not in the channel table
  is stale, reported, discarded.
- `deadline(t)`: a NEGOTIATING channel past `NEGOTIATION_DEADLINE_MS` → CLOSING
  with `end(id, k, false)` if a peer record owns the attempt. Physical
  capacity follows `closed(t)`. A close that does not confirm inside
  `CLOSE_ESCALATE_MS` gets a forced `pc.close()`; capacity is still released
  only on the transport's confirmation.
- `mark(id, reason, lifetime)`: on a peer reaching RESTING with a `loss` or
  `policy` reason. A mark holds the reason, its lifetime, the retry count,
  and the identity's presence high-water (below). At the bound the rule is a
  QUARANTINE, because a dropped mark would let the same identity look UNKNOWN
  on the next tick and dial again, and "not this cycle" does not bound that.
  When `marks = M_marks` the node enters MARKS-FULL: no identity without a
  mark and not already BOUND or ADMITTED may be nominated or dialed, inbound
  or outbound, until marks fall below `M_marks − M_hyst` by expiry. A new
  `policy` rejection at a full table is always stored, evicting the oldest
  `loss` mark; the evicted identity is now untracked and MARKS-FULL blocks it.
  A `policy` mark is never evicted. MARKS-FULL is reported with its duration.
  The quarantine is conservative on purpose: under mark pressure the node
  stops meeting strangers; it never forgets one it had refused.

**Stale callbacks.** Every transport callback carries `t`. A callback whose
`t` is not in the channel table, or whose `t` is in GONE, is stale: reported
and discarded. A callback for a `t` in CLOSING that reports anything other
than close is ignored. No callback on an old `t` can touch the peer record's
current channel.

**Suspension and resume.** Identity across a suspension is the pair
(transport instance id, `t`). On resume, the node first reconciles deadlines
against the clock: every NEGOTIATING channel whose deadline has passed goes to
CLOSING through `deadline(t)` before any tick runs. Timers that fired during
suspension are coalesced to one run each.

**Restart.** A fresh process has an empty channel table and an empty peer
table by construction, and nothing is persisted (a nodeId is never written to
disk). That assertion holds only for a transport instance whose objects are
gone. A transport that survives the kernel (a browser tab whose
PeerConnections outlive a kernel reload, a shared Node transport) runs a
RECONCILIATION PASS before the first tick: it enumerates every live
PeerConnection the transport still holds, mints a `t` for each, places it in
CLOSING with reason `orphan`, and lets `closed(t)` release it. Nothing orphaned
is ever adopted into a peer record; identity is re-established only by a new
handshake.

**Glare.** Two channels to the same identity, one each direction, both bound:
the node keeps the one whose `t` was minted first and retires the other with
`cancel`, matching the remote's choice by the sorted-nonce channel key the
mesh layer already uses for duplicate resolution. Both channels count against
`C_phys` until each confirms close.

## Cap is the knob

`MAX_SYNAPTOME` is 50 (`AxonaDomain.js:68`). At sixty nodes, fill-to-cap gives
each node up to `min(cap, 59)` admitted peers, less what reachability, mutual
capacity, policy and the lane refuse, each reported. At six hundred, fifty
chosen by composition. One mechanism at both scales. The cap is per node
class and David sets it.

**Requested and effective.** `cap_req` is what the operator set. `cap_eff` is
what the invariant uses. They differ only while draining: lowering `cap_req`
below `peer(ADMITTED)` sets `cap_eff = peer(ADMITTED)` at that instant, puts
the node in DRAINING, and admission refuses every candidate until
`peer(ADMITTED) ≤ cap_req`, at which point `cap_eff = cap_req` and DRAINING
ends. Draining never retires a peer: Rule 1 still holds below `cap_eff`, and a
duty-bearing peer is never closed to meet a number. DRAINING is reported with
the gap. Raising `cap_req` sets `cap_eff = cap_req` at once.

**Conditional liveness.** The node reports `fill-stalled` with one of SUPPLY,
MUTUAL CAPACITY, AWAKE, RENDEZVOUS, FAIR RETRY (defined as in v0.2) when it
cannot proceed, and `fill-unknown` when it cannot tell which. One timeout is
one observation and infers nothing.

## Discovery across cohorts

As v0.2: a directory of registered nodeIds with lifetime `L_reg` and sample
bound `R_sample`; periodic re-contact with the next return drawn in
`[T/2, 3T/2]`; the arithmetic as illustration only, with the three things that
make it wrong; case 7 in two executions. Nothing here is a guarantee.
Saturated-cohort bridging is UNSOLVED; see *What this design does not
establish*.

## Discovery at cap

### The potential

A table at cap has `kNear` nearest-by-XOR peers protected by name and the
rest described per XOR stratum band `b`:

- `n_b`: admitted peers in band `b`.
- `m_b`: the feasible minimum for `b` under the observation epoch `E`: the
  smaller of the band's configured minimum `M_b` and the number of distinct,
  verified identities in `b` that `E` contains and that are not under a mark.
  Duplicate nominations of one identity count once. Unverified nominations
  (no authenticated source) count zero.
- `E`: the set of neighbour responses and lookahead results received inside
  `V_obs` as of the start of this swap decision, frozen for the decision. A
  response that arrives during the decision is in the next `E`.

The potential is

```
Φ(E) = Σ_b w_b · max(0, m_b(E) − n_b),   w_b = 1 for every b
0 ≤ Φ ≤ Σ_b M_b
```

A swap is admissible only when `Φ_after ≤ Φ_before − h` with `h = 1`,
computed under the same `E`. Between resets of `E`, `Φ` is a non-negative
integer that strictly decreases on every committed swap, so the number of
swaps between resets is at most `Σ_b M_b`. Across resets, the churn bound
`C_swap` limits rate; it proves nothing about convergence and is not claimed
to. A negative observation about a candidate (no neighbour reports it, the
lookahead did not reach it) is NOT in `Φ`. It is a tie-break among candidates
that already lower `Φ` by the same amount, and only when the observation is
VALID: at least `q` responses in `E` and no timeouts among them. Missing or
asymmetric responses are UNKNOWN and are not in `E`.

### The swap rule

`admit-staged(c, v)` runs only when every one of these holds, evaluated in
this order with no mutation until all have passed:

1. `c` is STAGED on channel `t_c`: OPEN, authenticated, its remote admit frame
   received on `t_c` inside the stage TTL, and `t_c` still OPEN now.
2. `v` is ADMITTED on channel `t_v`, with the identity and generation the
   stage recorded, `t_v` still OPEN now.
3. `v` is not in the protected `kNear` set under the current table.
4. `v` is the lowest-vitality admitted peer, outside `kNear`, whose removal
   does not worsen any existing deficit: for every band, `max(0, m_b − n_b)`
   after removing `v` is no greater than before, except the band that `c`
   fills.
5. `Φ_after ≤ Φ_before − h` under `E`.
6. No other swap is in flight and the last commit was more than `C_swap` ago.
7. `peer(ADMITTED) = cap_eff` (a free slot means `c` goes through `admit()`
   instead and the swap is void).
8. The lane and policy admit `c` (the same decision `admit()` makes).
9. `mayRetire(v)` returns true.

Then, in one synchronous step: `v`'s channel → CLOSING with reason `swap`,
`v` → RESTING, `c` → ADMITTED storing `t_c` and this generation. The invariant
`peer(ADMITTED) ≤ cap_eff` holds at every instruction because `v` leaves in
the same step `c` enters. If any precondition fails, nothing changes; `c`
stays STAGED until its TTL and is then retired with `cancel`.

Outcomes during the stage, each defined:

| event during stage | outcome |
|---|---|
| independent removal opens a slot | swap void; `c` goes through `admit()` and may be refused |
| `v` lost (class B) | swap void; `v`'s loss path; `c` through `admit()` |
| `c`'s channel lost | `c` → RESTING with `loss`; `v` untouched |
| remote revokes admission (explicit frame or channel loss) | `c` retired `cancel`; `v` untouched |
| policy revokes `c` | `c` retired `policy`; `v` untouched |
| `cap_req` lowered | DRAINING; precondition 7 fails; `c` retired `cancel` at TTL |
| `cap_req` raised | precondition 7 fails; `c` through `admit()` |
| stage TTL expires | `c` retired `cancel`; `v` untouched |

**The remote admit frame.** Bound to `t_c`; carries the remote's generation;
valid for the stage TTL; revoked by an explicit revoke frame on `t_c` or by
loss of `t_c`. Local receipt proves admission at the remote at that instant
and nothing about its continuation past the TTL. The protocol frame is
`mesh:admit` with fields (`t_c`-derived channel key, generation, ttl) and is
its own wire change, reviewed as one.

**Both ends full.** The remote refuses, and the refusal is final for this
attempt. v0.2 said in one place that this was a refusal and in another that
two full cohorts swap. They do not. A bounded bilateral staging protocol, in
which two full nodes each stage the other and commit together, is a separate
design and is not in this one. Until it exists, two saturated disjoint
cohorts stay disjoint, and the node at cap reports `swap-none` or
`swap-refused: remote-full`.

## The duty gate

`mayRetire(id)` runs synchronously inside `retire()` for every reason marked
as consulting it. It reads the pubsub duty registry: for every role this node
holds, the peers the role's current contract needs a path to (replication
targets for a root, the root for a backup, the subscriber set a host serves,
every party to a handoff in flight). If `id` is in that set and the handoff
or discharge has not completed, `mayRetire` returns false with the duty named.
The caller keeps the peer and its resources, stops further swaps while the
overlap reserve is held, reports `swap-blocked: duty` or
`refuse-grace-blocked: duty` or `drain-blocked: duty`, and retries when the
registry changes.

Involuntary loss does not consult the gate. It enters the role's own recovery:
the step-down hold and the reconcile machinery in the kernel today. Loss is
never discharge.

## Losses

The four classes keep their names.

- Class A (negotiation failed): one re-offer, offerer-only, inside the
  deadline, as today; then `deadline(t)`, a `loss` mark.
- Class B (an open channel died): `_retire` closes dc and pc as today; the
  channel → CLOSING → GONE; the peer → RESTING with a `loss` mark on the
  guard's schedule; the id re-enters the candidate pool when the mark expires;
  a re-dial goes out like any other dial. Exhaustion reactivates on fresh
  evidence only: a `bind` from that identity, or a signed presence record
  that passes all of: its timestamp is inside `PRESENCE_FRESH_MS` of the
  receiver's clock; its timestamp is strictly greater than the HIGH-WATER
  stored in that identity's mark (the largest timestamp ever accepted from
  it); and the reactivation is inside `R_react` per identity per guard
  window and `R_tick` per tick globally. The high-water lives in the mark,
  so it is bounded by `M_marks` and survives nonce-cache eviction; a replayed
  record has a timestamp at or below the high-water and is rejected without
  consulting any nonce cache. There is no separate nonce cache. The clock
  assumption is stated: the signer's timestamps are non-decreasing per
  identity, and the receiver tolerates skew up to `PRESENCE_FRESH_MS`; a
  signer whose clock steps backward cannot reactivate until it passes its own
  high-water, which is the safe failure. If the identity's mark was evicted
  (MARKS-FULL), there is nothing to reactivate and the quarantine applies.
- Class C (graduation watchdog): unchanged, a backstop. `graduation-collapse`
  (`8fead6d`) stays on its branch.
- Class D: the fill.

No ICE restart.

## The repairs, split and ordered

Every row names its kind. ACTIVE-PATH rows change production behaviour the day
they ship and need their own review and David's word. GATED rows are inert
until the launchers arm them. The order is by dependency: nothing that can
voluntarily close a channel ships before the duty gate and the channel
accounting that make a voluntary close safe.

| # | defect | where | repair | kind | depends on | fence |
|---|---|---|---|---|---|---|
| 1 | `_deadPeers` has no reason | `AxonaPeer.js:623`, `:4762–4770` | marks carry a reason; the filter behaves as today | ACTIVE, no behaviour change | — | existing tests unchanged; reason present on every mark |
| 2 | anchor region reads the handle | `server.js:1223`, `anchor_select.js:25` | bound nodeId's region, as `connRegion` | ACTIVE (bridge) | — | two handles in one region are one region |
| 3 | channel tokens and the two records | new | the tables and transitions above | GATED (new code, inert until the fill is armed) | — | cases 4, 5, 9, 10, 17, 18 |
| 4 | duty gate | new | `mayRetire` and the registry | GATED | 3 | case 13 |
| 5 | `closeConnection` unbinds, does not close | `webrtc.js:345–348` | `mesh.disconnect` after `unbindPeer`; every caller classified: anneal (removed by 6), `_evictAndReplace` (involuntary, dead synapse, allowed), gate (off), swap (new, gated) | ACTIVE once 6 lands | 3, 4, 6 | open-PC count after close |
| 6 | anneal prunes below cap, deletes before it opens | `AxonaPeer.js:4662–4705`, called at `:5381` | remove the call; the swap rule replaces it, gated | ACTIVE (stops below-cap pruning) | 4 | table size never decreases below cap under lookup load |
| 7 | maintenance skips bound-not-in-table | `AxonaPeer.js:1357` | reconcile calling `admit` | GATED | 3 | case 2 |
| 8 | relay fallback outside the guard | `AxonaPeer.js:4545–4566` | `end()` on the consumed token at bind, cancel or deadline | GATED | 3 | case 16 |
| 9 | `hop_cache` has no sender | `AxonaPeer.js:815` | sender on the lookup trace, bounded by `LATERAL_K` | GATED | — | once per successful lookup |
| 10 | `loss` marks never expire | as 1 | expiry on the guard's schedule; reactivation rules | GATED | 1, 3 | cases 6, 14 |
| 11 | hex string into BigInt map | `AxonaPeer.js:1315` | pass the BigInt; the integration dial is itself behind the guard flag; with the flag off, `integrate()` returns 0 as today and logs `integrate-skipped: guard-off` | GATED | 3, 8 | two-node test with guard on asserts opened > 0; with guard off asserts 0 dials and the log line |
| 12 | swap rule, directory, re-contact | new | as above | GATED | 3, 4, 5 | cases 7, 8, 11, 12 |

## Rollout

1. ROWS 1 AND 2. No voluntary-close path, no behaviour change in the kernel
   (row 1) and a selection change on the bridge (row 2). Each on its own
   branch, reviewed, released on David's word through `RELEASE-PROCEDURE.md`.
2. MEASURE. Open channels with no binding per node; bound and admitted peers,
   distribution; marks by reason; greedy terminal count per topic. Before and
   after each release from here on.
3. THE GATED RELEASE. Rows 3, 4, 7–12, and rows 5 and 6 which are active but
   depend on 3 and 4. Full suite, manifests, fences, council review. Rows 5
   and 6 ship in this release because their safety argument is rows 3 and 4;
   they are the behaviour change in it, and the release note says so. On
   David's word.
4. ARM ON TESTNET, TOGETHER. Maintenance, gate and guard on the testnet relays
   at once, fill target at cap. Twenty-four hours of step-2 measurements.
   Pass: admitted-degree minimum at `min(cap, N − 1)` with every shortfall
   named; `peer(PENDING)` never at `P_pending` for more than one guard cycle;
   a forced fleet restart inside the budget; swap rate at or below `1/C_swap`;
   `chan(CLOSING)` returning to zero within `CLOSE_ESCALATE_MS` of each close.
5. PRODUCTION, on David's word, one host group at a time, with the step-2
   measurements before and after each group. The launchers change in their
   own commit; arming never rides a kernel release.

## Verification

Offline cases, each a test before any live run.

1. One free slot, concurrent inbound and outbound binds: exactly one is
   admitted; the other stays BOUND `refused:cap`, charged, and closes on
   grace unless the gate holds it.
2. Reconcile at cap−1 with three existing bindings: one admitted, two refused
   and charged; zero dials.
3. Reserved vacancies: inside the lane a non-qualifying candidate is refused
   and a qualifying one admitted; reconcile candidates follow the same rule.
4. Old channel retiring beside a new attempt to the same peer: both channels
   in the table, both counted; `closed(t_old)` releases only `t_old`; the peer
   record's current channel is untouched; a `bind` on `t_old` after it entered
   CLOSING is ignored.
5. PWA suspend and resume: deadlines reconciled first; timers run once;
   `peer(PENDING) ≤ P_pending` throughout; no second dial for an id already
   PENDING.
6. Repeated nominations: an id nominated every tick is dialed on the guard's
   schedule only; after exhaustion, nomination and timer expiry do not
   re-dial; a bind from that identity does; a replayed presence record does
   not.
7. Rendezvous, two executions: (a) no overlap: `fill-stalled: rendezvous` or
   `fill-unknown`, nothing inferred, no convergence reported; (b) controlled
   overlap under four stated preconditions: one visit yields an introduction
   and a bind.
8. Two full disconnected cohorts: the node at cap reports `swap-none` or
   `swap-refused: remote-full`; `peer(ADMITTED)` never exceeds `cap_eff`; no
   claim of bridging is made or tested.
9. Physical bound: at `C_phys − 1` with pending room, of two concurrent
   single-channel requests exactly one proceeds and one is deferred; after
   one `closed(t)`, the deferred one proceeds.
10. Timeout holds capacity: a NEGOTIATING channel past its deadline is
    CLOSING and counted until the transport confirms; forced escalation
    releases on confirmation only.
11. Swap stage: `peer(ADMITTED) = cap_eff` and `peer(STAGED) = 1` throughout;
    commit lands at `cap_eff`; each row of the during-stage table produces its
    stated outcome; a `mayRetire(v)` false leaves the table untouched and
    reports `swap-blocked: duty`.
12. Potential: a plateau of interchangeable candidates produces at most one
    swap per `C_swap` and then `swap-none`; `Φ` strictly decreases per commit
    under a fixed `E`; a deficient unrelated band does not block an improving
    swap; a `kNear` peer is never the victim; UNKNOWN observations earn no
    tie-break.
13. Duty gate: a replication target of a root this node holds is not retired
    for `swap`, `cap-change` or `refused-grace`; resources stay charged; after
    handoff the retry proceeds; a class-B loss of the same peer enters the
    role's recovery path without consulting the gate.
14. Reactivation: an exhausted `loss` mark reactivates on a bind, or on a
    fresh signed presence inside `PRESENCE_FRESH_MS` with an unseen nonce,
    bounded by `R_react` and `R_tick`; on nothing else.
15. Marks at the bound: at `M_marks` the node is MARKS-FULL; an identity
    nominated on every tick for ten ticks with no mark is never dialed; a
    fresh set of `2·M_marks` identities arriving one per tick dials at most
    until the table fills and then none; a new `policy` rejection at a full
    table is stored and the evicted `loss` identity is blocked by the
    quarantine, not re-dialed; a `policy` mark is never evicted; the
    quarantine lifts only below `M_marks − M_hyst`.
16. Guard token: `begin(id, k)` once; `end(id, k, ·)` exactly once at bind,
    cancel or deadline; a stage cancel of a bound channel never calls `end`.
17. Glare: two bound channels to one identity resolve to one by the sorted
    channel key; both count until each confirms close.
18. Restart with a surviving transport: the reconciliation pass places every
    orphan in CLOSING and adopts none; the first tick runs only after it.
19. Draining: lowering `cap_req` below `peer(ADMITTED)` refuses admission,
    retires nothing, reports the gap; raising it ends the drain.
20. Fences for every repair row, each failing with the repair removed.
21. `smoke_root_stepdown_hold` 83/83 and the full suite green at every step.
22. Routability fence: an application frame over a BOUND, STAGED or PENDING
    channel is dropped and counted `fence-drop`; a role allocation never
    names a peer outside the synaptome; `admit()` flips `routable` and
    inserts into the synaptome in one step, and `retire()` clears it in the
    step it moves the channel to CLOSING; a frame that arrives between the
    two is dropped.
23. Presence replay after eviction: a signed record accepted once, then
    replayed after the mark's retry count was reset by expiry, is rejected on
    the high-water; a record with a timestamp inside the freshness window but
    not above the high-water is rejected; a signer whose clock stepped back
    cannot reactivate until its timestamps pass the high-water.

## What this design does not establish

- That any cap is safe on any class.
- That re-contact meets any pair in bounded time.
- That a denser mesh ends split roots; the Monte Carlo in `16b554bd` is a
  model figure.
- The fleet impact of unbind-only `closeConnection`; measured at step 2.
- The cause of the 04:33Z event.
- Global convergence of the at-cap rule; it terminates between epoch resets
  and reports.
- SATURATED-COHORT BRIDGING, an UNRESOLVED REQUIREMENT. David's objective is
  connectivity everywhere. Two full cohorts with no free slot on either side
  do not join under this design, and refusal is recorded as the limitation,
  not as an answer. A bounded bilateral staging protocol is the candidate
  remedy and is its own design.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| cap, relay / seat | 50 | PSI pressure on a 1-core droplet at 50 channels |
| cap, browser / PWA | 12 | a 24 h phone run with battery and memory flat |
| `kJoin` | 2 | a measured need for more newcomer lanes |
| `P_pending` | 8 | fill time to cap over ten minutes at N = 60 with supply present |
| `C_phys` | cap + `P_pending` + `S_overlap` + `C_inbound` + 4 | the open-channel-with-no-binding count at step 2 |
| `C_inbound` | 4 | inbound refusal count at step 4 |
| `S_overlap` | 1 | never above 2 without a measured reason |
| `K_cache` | 64 | cache eviction rate at step 4 |
| `M_marks` / `M_hyst` | 256 / 32 | MARKS-FULL duration at step 4; a quarantine that holds for more than one guard cycle under normal load means `M_marks` is too small |
| fill tick / per tick | 15 s / 3 | the step-4 storm check |
| guard schedule | 30 s, ×2, 4 attempts | unchanged until a measured reason |
| stage TTL / `CLOSE_ESCALATE_MS` | 30 s / 10 s | measured bind and close times |
| `h` / `C_swap` | 1 / 5 min | swap rate at step 4 |
| `q` / `V_obs` | 3 / 60 s | lookahead response rates at step 2 |
| `M_b` per band | 1, `kNear` in the nearest | the swap rule's floor |
| `PRESENCE_FRESH_MS` / `R_react` / `R_tick` | 60 s / 1 per identity per guard window / 3 | replay counts at step 4 |
| re-contact `T` / `W` / draw | 10 min / 60 s / `U[T/2, 3T/2]` | grow `T` with N; shard the bridge first |
| `L_reg` / `R_sample` | 24 h / 16 | registry size at the bridge |
| refused-grace | 60 s | gate blocks at step 4 |

## Where the code stands

Nothing in this document is implemented. v0.1 is at `4ad3741` and v0.2 at
`769183f` as record. Branch `graduation-collapse` (`8fead6d`) stays
unreleased. The first change is row 1, on its own branch with its fence, and
it comes to council before anything else moves.
