# Mesh connectivity: hold and fill (v0.8, Phase 1)

**Status:** design for council review, revision 8, scoped to PHASE 1 on
David's direction of 2026-10-04; written as design follow-through on the
eight implementation rows reviewed 2026-10-04/05 · **Date:** 2026-10-05 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Bridge:** 2.145.0
(`533ad04`) · **Relay launcher:** `axona-relay` `2ff0301` · **Policy set
by:** David · **Author:** axona.bot · **Supersedes:** v0.7 (axona-docs
`95c2ff4`), v0.6 (`4585488`) and v0.5 (`4334504`). Those, v0.4
(`8b9b214`), v0.3 (`0e05955`), v0.2 (`769183f`) and v0.1 (`4ad3741`) stay
in place as record; v0.4's at-cap material is PHASE 2's record, together
with Channel Election v0.12 (`d677234`) and Duty Leases v0.11 (`da10395`)
· **Drivers (v0.8):** what the code taught the design while rows 1, 2, 2b,
3, 4, 5, 6, 10 and 13 were written and reviewed. Aster `fb63049f` (the
"one issue per window" claim needs its scope); `c771508b` (a newcomer's
region claim moves shared load counters); `4c07cab5` and `3717daee` (the
inbound identify contract is a material gap, and a bind-policy hook is not
enough because MeshAuth binds synchronously and ignores the adapter's
return); `d5b37071` (two below-cap opens can both insert, pre-existing);
`1816f5e6`, `181dd4ee`, `97a7f1a4`, `bd3ecd6d` (loss and policy marks need
separate bounds in text, not only in code). Vega `79ccdf05` (row 13 marks
only without an open channel). The bridge fact found in row 2: the
newcomer's nodeId is not bound when the peer-list is sent.

**What changed from v0.7:** the mark bounds are split in the text as they
are in the code (loss ≤ `M_marks`, policy ≤ `M_policy`, total ≤ their sum,
the loss population drives hysteresis). The "at most one attempt per
window" sentence carries its scope. A new section, *Inbound
identification: the acceptance transaction*, replaces the one-line
`identify` rule with a transaction MeshAuth commits or refuses BEFORE any
binding exists; it is NOT IMPLEMENTED, and case 44 points at it. A new
subsection, *Admission at the await*, names the pre-existing two-opens
schedule in `_addByVitality` and the rule that closes it. *Discovery across
cohorts* records that the newcomer's region at admission is a claim
carried in client-hello (row 2b) and what a false claim moves. The repairs
table gains row 2b and an implementation column with the branch each row
sits on. Every review finding from the implementation rounds is carried by
number. Nothing in the transitions, the duty gate or the boundary table
changes.

This document is a design. It changes no code, arms no mechanism, moves no
gate, and runs nothing live. Every file:line is against `270835d` for the
kernel (`src/dht/AxonaPeer.js` unless another file is named), `533ad04` for
the bridge and `2ff0301` for the relay launcher. Deploy is David's.

---

## The question, cut to Phase 1

What is the smallest change that makes sixty stable nodes well connected,
and what does it leave out?

v0.1 answered the first half: hold everything below the limit, fill to the
limit continuously, and repair the eight places where the growth half of the
plasticity loop is cut at the dial. Four revisions later the design also
answered a question nobody had asked yet: how two nodes at cap swap a peer
without breaking an obligation. That answer needs a lease, a lease needs an
authority epoch, and an authority epoch needs root fencing, which is open.
The connectivity fix was waiting on the hardest problem in the system.

The network in production is 52 relays, four or five seats and a few
browsers, with a cap of 50. Nobody is at cap. Nobody swaps. So Phase 1 is
the below-cap design on its own, and the at-cap design waits for a network
that needs it.

## The three phases

| phase | what it delivers | what it needs | what stays open in it |
|---|---|---|---|
| 1, this document | hold below cap; fill to cap; the dial-path repairs; bridge directory and re-contact; a duty gate on existing role state; the kernel's existing duplicate resolution | nothing outside this document and the existing kernel | at-cap plasticity (none); saturated-cohort bridging; the key-absent duplicate case |
| 2 | the at-cap swap: staging, the potential, Duty Leases, Channel Election, the two-sided fence, the three memories | v0.4's at-cap sections; Leases v0.11; Election v0.12; the six adapter prerequisites listed in those files | Aster `76bc93dd` items 1, 2, 4, 6; `0d7f2982` both residuals; the OPEN adapters |
| 3 | root fencing: the epoch certificate Leases §10 depends on | its own design | everything |

A phase label waives nothing. What Phase 1 claims is listed under
*Verification*; what it does not claim is listed under *What this design
does not establish*; what it carries from v0.4 is listed by number.

## What Phase 1 is not

It is NOT a design for a node at cap. At cap the node admits nothing,
retires nothing voluntarily, swaps nothing, reports `at-cap` with its
counts, and keeps discovering into its candidate cache so that a slot
opened by loss is filled at the next tick. That is Rule 1 holding with no
at-cap plasticity. v0.4 named this gap at its rollout step 3; here it is the
steady state of Phase 1.

It is NOT a fix for exclusive topic authority, NOT a choice of cap, NOT an
arming decision, and NOT a liveness proof, as v0.1 said.

It does NOT claim "no obligation without duty-capable at both ends". That
invariant needs the two-sided fence and the lease contract; both are Phase
2. What Phase 1 claims about obligations is weaker and is stated under *The
duty gate*: no VOLUNTARY close in this node's code removes a peer that this
node's own role state names, and every involuntary loss enters the role's
existing recovery path.

It does NOT claim the two ends of a duplicate channel always agree. The
kernel's existing resolution agrees when both ends carry a channel key; when
one does not, the ends can keep different channels and lose the peer. Phase
1 counts that case and does not fix it.

## The two rules, Phase-1 form

### Rule 1: hold everything below the limit

While `peer(ADMITTED) < cap_eff`, no voluntary path removes a peer.

RETAIN is unconditional below cap. ADMIT is qualified only when the gate is
armed: the join lane reserves the last `kJoin` slots inside cap and refuses
a candidate on one-per-id-per-window and lane cooldown
(`AxonaPeer.js:2064–2082`). With the gate off, `admit()` has no lane and no
grace: a bound peer is admitted below cap, as the seed on bind does today
(`:618–626`). The attainable admitted degree is `min(cap, N − 1)` less what
reachability, mutual capacity, policy and the lane each refuse, each
reported by name.

Every deletion from the admitted table carries one reason from a closed
set:

| reason | kind | consults the duty gate |
|---|---|---|
| `loss` | involuntary: class A exhausted, class B, a peer that announced it was leaving | no |
| `policy` | involuntary: identity or admission refusal discovered after admission | no |
| `dup` | the kernel's duplicate resolution closed this channel; the peer keeps its other channel, or is lost if the ends disagreed | no; see *Glare* |
| `cancel` | voluntary: a PENDING record withdrawn; no OPEN channel exists to that identity | yes; true by construction, consulted anyway |
| `refused-grace` | voluntary: a BOUND record refused by the lane or policy, closed after grace; exists only with the gate armed | yes |

"Idle" is not in the set. "Swap" is not in the set. "Cap-change" is not in
the set: lowering `cap_req` retires nothing, ever; the drain under *Bounds*
is loss-only and ends when losses bring the table under the new cap. v0.5
listed a `cap-change` reason beside a rule that forbade it (Aster `c34f3c85`
P1-C); the reason is gone and the rule stands. Anneal prunes below cap today
and is removed. `_addByVitality` at cap is a swap and is skipped before its
open.

### Rule 2: fill to the limit, continuously

While `peer(ADMITTED) < cap_eff`, discover and dial. Stop at cap, or when
the fill stalls, and report which.

The target is cap. `kNear` stays a selection quota for the nearest band.
The tick order:

1. RECONCILE. Every logical peer in BOUND that is not ADMITTED is offered to
   `admit()`, zero new dial. Refusal leaves it BOUND and charged; with the
   gate armed, its grace timer starts.
2. NEIGHBOURS. Candidates from `find_closest_set` and lookahead responses
   into the candidate cache, bounded by `K_cache`.
3. DIRECTORY. Candidates from the bridge sample, when the node holds one.
4. DIAL. Up to `maxPerTick` candidates leave the cache; each reserves a
   pending slot and a channel token before the first frame. A dial that
   cannot reserve is deferred in place and counted `dial-deferred`.

The fill is the existing maintenance pass (`_maintainSynaptome`,
`:1337–1380`) with its target moved from `kNear` to cap, the reconcile step
added before nomination, and its dial routed through `_considerCandidate`
under the guard. It is armed by `RELAY_SYNAPTOME_MAINTAIN=1` as today
(`relay.js:90–91`), and the launcher refuses to arm it without
`RELAY_ATTEMPT_GUARD=1` and `RELAY_ADMISSION_GATE=1`, in the same shape as
the refusal it already makes for a kernel below 4.67.1 (`relay.js:105–113`).
The 2026-06-29 storm was maintenance armed without the guard. The launcher
makes that configuration impossible.

Conditional liveness as v0.1: SUPPLY, MUTUAL CAPACITY, AWAKE, RENDEZVOUS,
FAIR RETRY. When one is false the node reports `fill-stalled` with the
condition, `fill-unknown` when it cannot tell, and infers nothing from one
timeout.

## Channels, peers and transitions

Two records, as v0.3, reduced: no STAGED state, no stage TTL, no epoch.

A CHANNEL record per RTCPeerConnection, keyed by a token `t` minted at
allocation and never reused in the process lifetime, with owner, direction,
the bound identity (null before bind) and a state: ALLOCATED, NEGOTIATING,
OPEN, CLOSING, GONE.

A LOGICAL PEER record per identity, keyed by nodeId, pointing at its current
channel token or none, with a state: NOMINATED, PENDING, BOUND, ADMITTED,
RESTING. A peer record points at a channel only in ALLOCATED, NEGOTIATING or
OPEN; the moment its channel enters CLOSING the pointer is cleared in the
same step. A peer in any state may have older channels in CLOSING; those
belong to the channel table.

### Bounds

```
peer(ADMITTED)                                     ≤ cap_eff
peer(PENDING)                                      ≤ P_pending
chan(ALLOCATED ∪ NEGOTIATING ∪ OPEN ∪ CLOSING)     <  C_phys    at allocation
chan(ALLOCATED ∪ NEGOTIATING, inbound, unbound)    <  C_inbound at allocation
peer(NOMINATED)                                    ≤ K_cache
marks                                              ≤ M_marks
policy set                                         ≤ M_policy
bytes queued per channel                           ≤ B_sig
directory sample                                   ≤ R_sample
```

ONE PHYSICAL BOUND. `C_phys := C_phys_req(cap_req)` by the formula in the
parameter table. There is no effective variant for channels. `allocate` is
one synchronous step: read `chan(all)`; if `chan(all) ≥ C_phys` refuse,
nothing constructed, nothing sent except a signalling refusal for an
inbound offer; else increment, mint `t`, and only then construct the
PeerConnection. At zero headroom nothing is allocated, and the first
`closed(t)` after that is what lets the next allocation through. Lowering
`cap_req` so that `chan(all) ≥ C_phys` refuses every allocation, inbound
and outbound, until closes bring the count under; nothing is closed to
meet the number. This replaces v0.4's `C_phys_eff` / PHYS-DRAINING pair
(Aster `76bc93dd` item 3).

`cap_eff` stays for the admitted table only: on every change to `cap_req`,
`cap_eff := max(cap_req, peer(ADMITTED))` and `DRAINING := cap_eff >
cap_req`. While DRAINING, `admit()` refuses `refused:draining`; each loss or
other retirement recomputes; the drain ends at `cap_eff = cap_req`. Rule 1
holds below `cap_eff` throughout, so a drain never retires a peer.

### Admission at the await

Physical reservation and routing-table admission are two bounds (Aster
`4c07cab5`): `C_phys` can have headroom while `peer(ADMITTED) = cap_eff`.
The kernel's `_addByVitality` (`:4600–4612`) checks the table size, then
`await`s `openConnection`, then inserts. Two calls below cap can both pass
the size check, both await, both resolve true and both insert: size 5 at
cap 4, reproduced by Aster `d5b37071` on `270835d` and on the row-6 pin
alike. It is pre-existing and row 6 did not touch it.

The rule: ADMISSION IS DECIDED IN THE SAME SYNCHRONOUS STEP AS THE INSERT,
never before an `await`. Either the slot is RESERVED before the open
(`peer(ADMITTED) + reserved < cap_eff`, the reservation released on a
failed open) or the size is re-checked after the await and the insert
refused when the table filled meanwhile. On a refused post-await insert
the channel that opened is NOT discharged: it is a BOUND, unadmitted
channel, charged in the ledger, and it takes the same disposition as any
`refused:cap` bind (grace with the gate armed; otherwise it stays BOUND
until reconcile admits it or it is lost). Case 61. This belongs to the
accounting release's combined review, not to any single row.

### The transitions

Each line is one synchronous step. "Dup" says what the same event does a
second time.

- `nominate(id, src)`: refuse if `peer(NOMINATED) = K_cache` or
  `ELIGIBLE(id)` is false (*Marks*: a `policy` mark, a `loss` mark whose
  schedule has not come due, or an unmarked identity under MARKS-FULL or
  POLICY-FULL). Else peer → NOMINATED. Nomination consumes nothing; the
  attempt is consumed at `dial`. Dup: no-op.
- `allocate(owner, dir)`: as *Bounds*. Dup: not applicable; each call mints
  its own `t`.
- `dial(id)`: require NOMINATED, no channel to `id` in any live state (a
  node never dials an identity it holds in PENDING, BOUND or ADMITTED),
  `ELIGIBLE(id)` still true, `peer(PENDING) < P_pending`, then
  `allocate(dialer, out)`. A refusal at the pending bound or at `allocate`
  leaves the peer NOMINATED, consumes no attempt and no token, and is
  counted `dial-deferred`. Then, in one step: `CONSUME(id)` (*Marks*); peer →
  PENDING pointing at `t`; mint completion token `k`; `guard.begin(id, k)`;
  send offer. Dup: no-op.
- `inbound(t)`: an inbound ALLOCATED channel → NEGOTIATING on its first
  frame; no peer record yet.
- `identify(t, id)`: the handshake names `id` on channel `t`. If `id` has no
  record, or is RESTING or NOMINATED: require `ELIGIBLE(id)` (the same
  predicate `nominate` and `dial` use; a marked identity whose schedule has
  come due is accepted inbound exactly as it would be dialed outbound) and
  `peer(PENDING) < P_pending`, else `close(t, refused:<why>)` with no
  attempt consumed; then, in one step, `CONSUME(id)`, peer → PENDING pointing
  at `t`, mint `k`, `guard.begin`. If `id` is PENDING, BOUND or ADMITTED on
  `t_cur ≠ t`: the record is NOT overwritten; the mark is NOT consulted and
  nothing is consumed (the identity is already held; the mark counts
  attempts into a NEW pending record, *Marks*); `t` continues to bind and
  is resolved there (*Glare*), bounded by `C_inbound` and `C_phys`.
- `bind(t)`: channel → OPEN. If the peer record points at `t`: PENDING →
  BOUND; pending released; `guard.end(id, k, true)` consumes `k`; then
  `admit(id)` in the same step. If the peer record points at another OPEN
  channel `t_cur` (the identity is already BOUND or ADMITTED): the
  DUPLICATE row under *Glare* runs; `k` is not involved, it was consumed at
  the first bind. If the peer record points at a PENDING `t_cur` that has
  not bound: peer → BOUND on `t`, pending released, `k` consumed; `t_cur`
  keeps negotiating with no pointer and ends by its own deadline or by the
  duplicate row when it binds. Dup: no-op.
- `admit(id)`: require BOUND, `peer(ADMITTED) < cap_eff`, not DRAINING, and,
  with the gate armed, lane and policy yes. Then peer → ADMITTED storing `t`;
  synaptome insert. On refusal: peer stays BOUND with `refused:<why>`; with
  the gate armed the grace timer starts; with the gate off there is no grace
  and the peer stays BOUND until reconcile admits it or its channel is lost.
  Dup: no-op.
- `retire(id, reason)`: for a gated reason (`refused-grace`, `cancel`),
  `mayRetire(id)` first; refusal changes nothing and is reported. Else:
  channel → CLOSING; pointer cleared; peer → RESTING; synaptome delete; close
  issued; `mark(id, reason)` for `loss` and `policy`. Capacity NOT released.
  Dup: no-op.
- `cancel(id)` from PENDING: `mayRetire` (true, consulted). One step:
  channel → CLOSING; pointer cleared; peer → RESTING; pending released;
  `guard.end(id, k, false)` consumes `k`; close issued; `FAIL(id)` (*Marks*):
  a cancelled attempt is a failed attempt. Dup: no-op by token state.
- `deadline(t)`: a channel in ALLOCATED past `ALLOC_DEADLINE_MS` with no
  first frame, or in NEGOTIATING past `NEGOTIATION_DEADLINE_MS`. One step:
  channel → CLOSING; if a peer points at `t`: pointer cleared, peer →
  RESTING, pending released, `guard.end(id, k, false)`, and `FAIL(id)`
  (*Marks*: a first failure writes the `loss` mark, a failure on a marked
  identity advances its schedule) ONLY IF no OPEN channel to `id` exists
  (Vega `79ccdf05`, row 13). Close issued. Dup: no-op.
- `close(t, reason)`: a channel-addressed close used by the duplicate row,
  by `identify` refusals and by the orphan pass; channel → CLOSING; if a
  peer points at `t`: for `dup`, the pointer moves to the surviving channel
  in the same step and the peer state is unchanged; for any other reason
  the peer is handled as in `retire`, and if it was PENDING the pending
  slot and `k` are consumed in the same step. Never touches a channel other
  than `t`.
- `closed(t)`, prompted: CLOSING → GONE; physical released for `t` only.
  Dup or unknown `t`: stale, reported, discarded.
- `closed(t)`, unprompted: a transport close on a channel in ALLOCATED,
  NEGOTIATING or OPEN → GONE in one step, physical released; if the peer
  record pointed at `t`: pointer cleared, peer → RESTING, pending released
  if it was PENDING, `end(id, k, false)` if `k` is live, `mark(id, loss)`
  if no other OPEN channel to `id` exists. This is the involuntary loss
  row; class B's `_retire` lands here.
- `escalate(t)`: CLOSING past `CLOSE_ESCALATE_MS` → forced `pc.close()`;
  capacity still waits for `closed(t)`.

### The matrix

One row per event, one column per peer state. Each cell is the resulting
peer state and what the step does to counters and tokens; `·` is a no-op.
Channel states follow the list above.

| event | none / RESTING | NOMINATED | PENDING on `t` | BOUND on `t` | ADMITTED on `t` |
|---|---|---|---|---|---|
| `nominate` | NOMINATED if room and ELIGIBLE | · | · | · | · |
| `dial` | refused | PENDING; CONSUME; pending+1; `k`; `begin`; or stays NOMINATED on a reserve refusal, nothing consumed | · | · | · |
| `identify(t', id)` | if ELIGIBLE and pending room: PENDING on `t'`; CONSUME; pending+1; `k`; `begin`; else `close(t', refused)` | same | record kept; `t'` binds later | record kept; `t'` binds later | record kept; `t'` binds later |
| `bind(t)` | stale | stale | BOUND; pending−1; `end(k, true)`; then `admit` | · | · |
| `bind(t')`, second channel | stale | stale | BOUND on `t'`; pending−1; `end(k, true)`; `t` unpointed | duplicate row: state kept, pointer → winner, loser CLOSING `dup` | duplicate row: same |
| `admit` | · | · | · | ADMITTED if room, not DRAINING, lane/policy; else `refused:<why>` | · |
| `retire(r)` | · | · | · | RESTING; CLOSING; mark for `loss`/`policy`; gated reasons ask `mayRetire` | same |
| `cancel` | · | RESTING; the nomination is dropped, no channel exists, nothing consumed, no `cancel` reason is recorded | RESTING; pending−1; `end(k, false)`; FAIL; CLOSING | · | · |
| `deadline(t)` | channel only | channel only | RESTING; pending−1; `end(k, false)`; FAIL if no OPEN to `id` | · | · |
| `deadline(t')`, unpointed | channel only | channel only | channel only | channel only | channel only |
| `closed(t)` prompted | GONE; phys−1 | same | same | same | same |
| `closed(t)` unprompted | GONE; phys−1 | same | RESTING; pending−1; `end(k, false)`; FAIL if no OPEN | RESTING; FAIL (`loss`) if no OPEN | RESTING; synaptome delete; FAIL (`loss`) if no OPEN |

Every cell that releases pending or consumes `k` does both in the one step
that clears the pointer. No cell leaves a peer pointing at a CLOSING
channel. Aster `76bc93dd` item 3 asked for this table; the `dup` case
consumes nothing because `k` was consumed at the identity's first bind.
CONSUME and FAIL are the mark automaton's two inputs and are defined under
*Marks*; a `bind` is its third, which deletes the mark.

### Glare: the kernel's existing resolution

Phase 1 adds no election and no refusal frame. Two channels to one identity
are resolved where the kernel resolves them today: in `bindPeer`
(`src/transport/web/webrtc.js:229–247`). When both channels carry a channel
key, derived from the sorted axona/4 nonce pair and IDENTICAL at both ends,
the smaller key wins at both ends and the loser is disconnected with
`duplicate-nodeId`. When either key is absent, the kernel keeps its existing
binding; two ends can then keep different channels, each closes the other's
survivor, and the identity is lost at both. That schedule is Aster
`76bc93dd` item 2 and it exists in production today.

Phase 1 does three things with it. The loser's close is classified `dup`
and the peer record moves to the winner in the same step, so a channel
closed by resolution never leaves a dangling pointer. The key-absent case
is counted `dedup-key-absent` per node, and the loss that follows a
disagreement enters the loss row like any other. The duty gate is NOT
consulted: when the ends agree the identity keeps a channel and no duty is
affected; when they disagree the local gate cannot stop the remote's close.
Phase 1 never dials an identity it already holds, so the only outbound
glare is two ends dialing each other at once, which the key resolves when
both carry it. The step-2 measurement counts `dedup-key-absent` so Phase 2
knows how often the case it fixes occurs.

### Inbound identification: the acceptance transaction

STATUS: NOT IMPLEMENTED, NOT ACCEPTED. Rows 10 and 13 claim outbound only;
the kernel at their pin accepts an inbound bind of a marked identity and
deletes the mark, as `270835d` did, which can bypass not-yet-due pacing and
the full-table refusals (Aster `4c07cab5`). This section is the contract
that replaces that behaviour; code follows review of this text.

WHAT THE CODE DOES. On the mesh path MeshAuth verifies the peer's signed
hello (`mesh-auth.js`, `verifyAuthHello`), then calls the adapter's
`_bindPeer(nodeId, meshId, channelKey)` → `webrtc.bindPeer` (web
`index.js:1065`), which runs the peer-bound handlers SYNCHRONOUSLY
(`webrtc.js:255–259`); the kernel's handler deletes the mark and seeds the
synaptome (`AxonaPeer.js:618–626`). MeshAuth ignores the adapter's return,
sets `st.bound = true`, logs `auth-mesh-complete` and starts CAP_ATTEST
(`mesh-auth.js:221–237`). A transient throw from `_bindPeer` is caught and
`st.verifying` reset so a later frame may retry (the transient-bind-throw
recovery). The bridge hello-ack is a separate path and not this one. So a
boolean hook consulted after `bindPeer` is too late (the mark is already
gone), and skipping `bindPeer` inside the adapter callback refuses nothing
(MeshAuth still completes). Aster `3717daee`.

THE TRANSACTION. After verification and before `_bindPeer`, MeshAuth asks
the kernel's BIND POLICY for one of two outcomes, COMMITTED or REFUSED, and
acts on it; nothing in between is observable to the kernel.

Inputs: the verified `nodeId`; the `meshId`; the channel key; the channel's
incarnation (`state.inc`); and a CURRENT-STATE READ taken at the moment of
the decision, not at the hello's arrival (the state may have changed during
the asynchronous verification).

Decision, in order:
1. HELD. If a POINTABLE live channel (ALLOCATED, NEGOTIATING or OPEN; never
   CLOSING, never a stale mapping) already binds `nodeId`, the identity is
   held: COMMITTED with nothing consumed and no new pending record. The
   second channel is the glare case and `bindPeer`'s key resolution decides
   which survives. `ownsPeer` alone does not establish this; the ledger's
   pointer does.
2. ELIGIBLE. Else `ELIGIBLE(nodeId)` (*Marks*). False → REFUSED,
   `refused:ineligible`.
3. PENDING ROOM. Else `peer(PENDING) < P_pending`. False → REFUSED,
   `refused:pending`, nothing consumed.
4. COMMIT, one synchronous step: the pending record for `nodeId` on
   `meshId` is created, `CONSUME(nodeId)` runs, the completion token is
   minted, and only then does MeshAuth call `_bindPeer`. The peer-bound
   handler's deletion of the mark is now the BIND input of an attempt
   already charged, which is the order *Marks* requires.

REFUSED: MeshAuth does not call `_bindPeer`; `st.bound` stays false; no
`auth-mesh-complete`, no CAP_ATTEST; the channel is cancelled by address,
`mesh.disconnect(meshId, 'refused:<why>')`, which the ledger records as
`cancel`; no loss mark is written (a refusal is not a failure of the
identity); the winning channel of a held identity is never the one closed;
a CLOSING record stays charged until the transport confirms (row 3); the
channel's state latches `refused` so later frames on it are ignored and
never retried into a bind.

BIND FAILURE after COMMIT: `_bindPeer` throws → the pending record and the
completion token are released once, `FAIL(nodeId, 'bind-threw')` runs (an
attempt was charged and ended without a bind), and MeshAuth's transient
recovery stands as today for the next frame, which re-enters the
transaction from step 1.

Absent or not-ready policy: a transport without a policy installed accepts
every verified identity, which is `270835d`'s behaviour and the state of
the rows-10/13 pin, stated; a transport whose policy is installed but not
ready refuses `refused:not-ready` (fail closed). A policy that throws →
REFUSED. Duplicate invocation for one `(meshId, inc)` returns the first
outcome. Pending and token release are exactly once, at bind or at
failure.

Cases 51–60 are the schedules: early loss mark (refused), due loss mark
(committed, consumed, bound), policy mark (refused), unmarked under
MARKS-FULL and under POLICY-FULL (refused), pending-full (refused,
nothing consumed), hook-not-ready (refused), state change during
verification (decided on the current state), repeated progress after
refusal (ignored), held glare (committed with nothing consumed; the key
decides), bind failure (released once, FAIL). They run through the real
MeshAuth → adapter → bind/peerBound chain, not a predicate in isolation.

### Suspension, restart, orphans

As v0.4: identity across suspension is (transport instance, `t`); resume
reconciles deadlines before any tick; a fresh process has empty tables; a
surviving transport runs the orphan pass and adopts nothing; pubsub treats
every role as LOST on reload, which is what a restart means today.

## Marks

One exact, bounded structure. No Bloom filter, no rotation, no presence
reactivation. v0.4's three memories exist because the at-cap design dials
strangers at a rate that made an exact table too small; below cap the dial
rate is bounded by `maxPerTick` and `P_pending` and does not depend on the
mark table at all.

v0.5 described the mark in prose and the prose contradicted itself: inbound
identification tested for the absence of a mark where nomination tested its
schedule, and nothing restored the retry token (Aster `c34f3c85` P1-A). v0.6
makes the mark an automaton with one predicate and three inputs.

### The mark

```
mark = { id, kind ∈ {loss, policy}, cause, at, attempts, dueAt, token }
```

`kind` and `cause` are as row 1 ships them (`DeadPeers.js`); `at` is
wall-clock, descriptive, for the log line, and nothing is timed from it.
`attempts`, `dueAt` and `token` are the automaton's state; `dueAt` is on
the node's MONOTONIC clock (`performance.now`, not `Date.now`), so a
wall-clock step neither extends nor shortens a schedule. `marks ≤ M_marks`,
exact.

### The predicate

```
ELIGIBLE(id) :=
  no mark for id          → not (MARKS-FULL or POLICY-FULL)
  kind = policy           → false
  kind = loss, attempts < A_max   → now ≥ dueAt
  kind = loss, attempts = A_max   → now ≥ dueAt            (REFILL: token := 1)
```

`REFILL` is the side effect on the exhausted row: when the predicate finds
`attempts = A_max` and `now ≥ dueAt`, it sets `token := 1` and returns
true. It never moves `dueAt`. The window is advanced by ISSUE, not by
refill: CONSUME on an exhausted mark sets `dueAt := now + R_refill` and
`token := 0`, so every later evaluation in that window finds `now < dueAt`
and returns false, whether or not FAIL or BIND has run in between (Aster
`f5237636`: the v0.6 predicate set `dueAt := now` at refill and could issue
twice in one window). The token is therefore a flag that an eligibility
test has been passed and not yet spent; the bound is `dueAt`. No timer
fires, nothing is enumerated, and a mark that is never consulted costs
nothing. One predicate, used by `nominate`, `dial` and `identify` when they
create a NEW pending record: a marked identity whose schedule has come due
is accepted inbound on the same terms it would be dialed outbound.

WHAT THE MARK COUNTS. Attempts this node INITIATES (a dial) or ACCEPTS INTO
A NEW PENDING RECORD (an inbound identification of an identity it does not
hold). A second channel to an identity already PENDING, BOUND or ADMITTED
is not an attempt in this sense: the identity is evidently reachable, the
kernel resolves the duplicate at bind by its channel key (*Glare*), and the
count of such channels is bounded by `C_inbound` and `C_phys`, not by the
mark. The mark exists so that a dead identity is not dialed on every tick;
it says nothing about how many channels a live one may open.

### The inputs

- `FAIL(id, cause)`: an attempt ended without a bind (deadline, cancel,
  unprompted close before OPEN) or an OPEN channel died, and no OPEN channel
  to `id` remains. No mark: write `{loss, cause, at: now_wall, attempts: 1,
  dueAt: now + B, token: 0}`. Marked: `attempts := min(attempts + 1,
  A_max)`, `cause := cause`, `at := now_wall`, `token := 0`, and then ONE
  schedule by the new count: `attempts < A_max` → `dueAt := now +
  B·2^(attempts−1)`; `attempts = A_max` → `dueAt := now + R_refill`. The
  A_max-th failure is the transition INTO exhaustion and takes the
  `R_refill` schedule, not the doubling one (Aster `f5237636`: v0.6 gave it
  both). A failure never lowers `attempts` and never sets the token; mark
  updates preserve the schedule.
- `CONSUME(id)`: the attempt is being ISSUED (the offer is sent, or the
  inbound identification is accepted into a new PENDING record) after every
  reservation succeeded. Unmarked: nothing. Marked, `attempts < A_max`:
  nothing (the attempt is charged at its FAIL, not at issue, so a success
  is free and the counter counts failures). Marked, `attempts = A_max`:
  `token := 0` and `dueAt := now + R_refill`: the window advances at ISSUE.
  A reservation refusal before issue (pending bound, `allocate`,
  `C_inbound`) runs no CONSUME: nothing was issued, nothing is charged, the
  identity stays eligible and the dial is `dial-deferred`.
- `BIND(id)`: the identity bound on our own channel. Delete the mark
  (`:618–626` does this today for `_deadPeers`). The next loss starts at
  `attempts: 1`.

So, FOR A CONTINUOUSLY RETAINED EXHAUSTED MARK, under atomic ISSUE and a
monotonic clock, AT MOST one attempt issues per `R_refill`: ISSUE sets
`dueAt := now + R_refill`, nothing before `dueAt` passes the predicate, and
only ISSUE or FAIL ever moves `dueAt`, each of them later. A FAIL on that
attempt sets `dueAt := now_fail + R_refill`, at or after the ISSUE's bound.
The bound does not span a BIND (which deletes the mark; the next loss
starts at `attempts 1` with the `B` backoff), an eviction under MARKS-FULL
or a restart; those reset the accounting by the stated policy (Aster
`fb63049f`). "At most": supply and scheduling decide whether any attempt
issues at all. It is an attempt-rate bound per identity at this node, not
a channel-rate bound; duplicate inbound channels to a held identity have
resource bounds only (*Glare*). Two nomination sources in one window, an
inbound arrival creating a new record and an outbound dial, compete under
one synchronous predicate and the second finds `now < dueAt`. A replayed or
signed presence record does nothing in Phase 1; there is no presence path.

Between ISSUE and the attempt's end the identity is PENDING, which is the
in-flight state: `dial` refuses a held identity and `identify` on a held
identity consults no mark, so no second attempt in the mark's sense can
start while one is in flight.

### Writers that carry no information

Row 1 ships two writers: `mark()`, which records a cause, and `add()`, the
Set-compatible writer the bridge uses, which carries none. `add()` is
membership only: an identity already marked keeps its mark, its cause and
its schedule. The bridge's handler and the kernel's fire for the same
death, in either order; the kernel's carries the cause (Aster `fb79c09e`,
fixed at `ddaa63a`). The rule generalises: NO WRITER WITHOUT INFORMATION
EVER OVERWRITES A MARK THAT HAS IT.

### Two bounds, one table

One exact table holds both kinds of mark. Each kind has its own bound and
its own count, and the two are never added into one (Aster `1816f5e6`,
`181dd4ee`; the code at row 10 does this and the text now says it):

```
loss marks     ≤ M_marks           drives MARKS-FULL and its hysteresis
policy marks   ≤ M_policy          drives POLICY-FULL
total          ≤ M_marks + M_policy
```

- A `policy` mark is exact, counted against `M_policy`, never evicted
  while the process lives; it leaves only by an explicit revocation event
  (a delete) or by restart, which forgets everything, as today. A `loss`
  mark that becomes a `policy` mark LEAVES the loss count at that instant
  and may lift MARKS-FULL by the rule below; a conversion attempted at
  POLICY-FULL is refused and the mark stays `loss`. No kernel path writes a
  policy mark at `270835d`; the structure accepts the kind.
- MARKS-FULL: when LOSS marks reach `M_marks` the state latches and
  `ELIGIBLE` is false for every unmarked identity, inbound and outbound,
  until loss marks fall below `M_marks − M_hyst`. A new `loss` mark at the
  bound evicts the OLDEST loss mark with `attempts = A_max` and `token = 0`
  (exhausted, waiting on refill), and only such a mark; a policy mark is
  never a candidate; if none exists the new mark is not written and the
  identity is refused by MARKS-FULL. The evicted identity returns as a
  stranger with a fresh counter on its next nomination. That is forgetting,
  bounded: it changes which identity the next dial goes to, never how many
  dials go out, and it happens at most once per new loss, so the rate is
  below the loss rate. It is stated, not hidden.
- POLICY-FULL: when policy marks reach `M_policy`, a new policy mark is not
  written, is counted `policy-refused`, and `ELIGIBLE` is false for every
  unmarked identity until a policy mark is deleted or the process restarts.
  Nothing refused on policy is forgotten into permission while the process
  lives.

v0.7 wrote `marks ≤ M_marks` over one table. That literal bound is not
claimed; this split is the bound.

Aster `76bc93dd` item 4 and `0d7f2982` residuals 1 and 2 are about counting
Bloom filters, rotation tokens and high-water recreation. None of those
structures exists in Phase 1; the findings are retired by removal and
reopen with Phase 2's memories.

## The duty gate, on existing role state

`mayRetire(id)` runs synchronously inside `retire()` for every reason marked
as consulting it. It reads two things.

INSTALLED ROLES: what the kernel already records about this node's roles:
the Role objects `AxonaManager` iterates (the `_roles` iterable
`durability.js:272` takes), `_backupTopics` (`AxonaManager.js:287`),
`_hostedTopics` (`:286`), and the handoff jobs the repair plane tracks
until acked (`repairPlane.js:1091–1292`). From those, the set of peers this
node currently sends to in any role: replication targets and backups of a
root this node holds, the root of a topic this node backs up, the
subscribers a host this node holds serves, every party to a handoff in
flight.

QUEUED ROLE WORK: Aster `c34f3c85` P1-B. A REPLICATE is not processed where
it arrives. `_onReplicate` (`wireHandlers.js:901–907`) hands the body to
`_ingestEnqueue` (`repairPlane.js:424–450`), which runs it inline only when
the slice budget allows and otherwise queues it; `becomeBackup`
(`rootClaim.js:282–296`), which writes `backupOf` and `_backupTopics`, runs
when the queue DRAINS (`syncEngine.js:229–243`). Between arrival and drain
there is an interval in which this node has accepted a duty and its role
state does not show it. A grace close in that interval, with the gate
reading installed roles only, retires the principal; the queued work then
installs a backup of a peer this node just closed voluntarily. So each queue
entry carries its DEPENDENCY, the peer the role work will name, and
`mayRetire(id)` returns false while any queued entry names `id`:
`refuse-grace-blocked: queued-duty`. The pin is released when the entry is
processed (the installed role then protects the peer) or dropped at
overflow. A dropped payload comes back only if its sender is alive and
reachable and anti-entropy's next full push reaches this node inside
`ROOT_REPLICATE_FULL_MS`; after sender loss or a partition it does not come
back, and nothing was accepted, so nothing is owed (Aster `f5237636`: this
is conditional liveness, stated as such). No new structure: the queue is
the structure, and the dependency is a field on the entry it already holds.

THE TRANSFER IS SYNCHRONOUS. At `270835d` the non-root REPLICATE branch
runs `becomeBackup` before its first `await` (`syncEngine.js:229–243`), so
`backupOf` and `_backupTopics` are written in the same macrotask that
dequeues the entry; between the dequeue and the install no other code runs.
The implementation fence asserts that order on three paths: the inline
path, the queued path at the actual `q.shift()` (`repairPlane.js:458`), and
the overflow drop. The pin is cleared in the same step that installs the
role, never before, and a reordering that puts an `await` between the two
fails the fence.

What the queued work does at drain is UNCHANGED: `becomeBackup` installs the
role whatever the principal's channel state. The only way the dependency
can have vanished during the interval is involuntary loss, because the pin
forbids the voluntary one; and a backup of a vanished principal is the
standby successor the repair plane already refuses to prune
(`repairPlane.js:303–336`). Revalidation at install would delete the one
copy of the history the recovery needs. The install proceeds, and
`backup-installed-after-loss` is counted so the interval is visible.

THE DEFERRED-HANDLER INVENTORY at `270835d`. `_ingestEnqueue` has two
callers: `_onReplicate` (`wireHandlers.js:906`), dependency = the principal
(`payload.from`, else `meta.fromId`), and `_onReplayUp` (`:757`),
dependency = NONE: a child's history pushed up to its root creates no role
toward the child. HANDOFF is not queued; its ack must mean "state held"
(`repairPlane.js:417`). Timers (`refreshTick`, `_scheduleMaintain`) read
installed state when they run and carry no payload from a peer. A fence
asserts the caller list of `_ingestEnqueue` and that every caller declares
a dependency or `none`; a new caller without a declaration fails the suite.

If `id` is in either set and the role's handoff or discharge has not
completed, `mayRetire` returns false with the duty named; the caller keeps
the peer and its resources and retries when the role state or the queue
changes.

The per-role field that names each peer is listed in the row-4 branch, and
the branch's fence asserts the registry names every peer that any role on
this node sends to during the kernel suite. A role handler found later that
sends to a peer the registry does not name, or a deferred handler found
later that installs a role from a queued payload without a declared
dependency, is a defect against this document.

WHAT THE GATE COVERS AND WHAT IT DOES NOT. The gate reads this node's role
state. A duty the REMOTE holds toward this node that this node's state does
not record is not protected by the gate; closing that channel is, to the
remote, an involuntary loss, which its recovery path handles as today. No
handler known at `270835d` creates such a duty without also writing this
node's state (a backup appointment writes `_backupTopics` at
`rootClaim.js:288`; a handoff writes the job table), and the fence above is
how that stays true. Involuntary loss never consults the gate. It enters the
role's own recovery: the step-down hold and the reconcile machinery
(4.102.0). Loss is never discharge.

This is weaker than v0.4's fence and it says so. v0.4 claimed that no
obligation could be created on an unadmitted channel; Phase 1 does not fence
application frames, so a BOUND-refused peer (gate armed, lane refused) can
still be appointed by the remote over its channel. The gate then protects
that channel's `refused-grace` close exactly as it protects any other,
because the appointment wrote `_backupTopics`. Aster `76bc93dd` items 1 and
6 are about the fence's timeout and its revoke races; the fence is Phase 2
and both items stay open there.

## The boundary: every operation that stays enabled below cap

Aster `6cbee271` asked that the phase boundary name which existing
operations remain enabled and how each one's admission, retention,
retirement and custody obligations are met without the protocols. This
table is that boundary. "Unchanged" means the code at `270835d` runs as it
does today.

| operation | where | Phase 1 | admission | retention | retirement | custody |
|---|---|---|---|---|---|---|
| seed on bind | `:618–626`, `_seedSynaptomeWithSponsor` | enabled, routed through `admit()` | `admit()` below cap; lane only with gate armed | Rule 1 | by reason only | unchanged |
| `_addByVitality`, below cap | `:4600–4612`, `victim` null | enabled; it is an admit of a bound candidate | `admit()` | Rule 1 | — | unchanged |
| `_addByVitality`, at cap | `:4606–4611` | SKIPPED before the open: no open, no delete, no insert; `vitality-swap-skipped`; an unbound candidate never had a channel, a bound one stays BOUND (Vega `79ccdf05`) | — | the victim stays | — | unchanged |
| `_tryAnneal` | `:4662–4705`, called `:5381–5384` | REMOVED | — | Rule 1 | — | — |
| `_evictAndReplace` | `:4710–4720` | enabled; involuntary, the synapse is already dead; its inline replacement open is the bound-only `openConnection` and opens nothing new; with the fill armed the candidate is nominated into the fill instead (row 12) | `admit()` on bind | — | `loss` | the role's recovery path |
| peer-leaving | `:880–892` | enabled; involuntary, the peer announced it | — | — | `loss` | the role's recovery path |
| `bindPeer` duplicate resolution | `webrtc.js:229–247` | enabled, unchanged; loser classified `dup`; key-absent case counted | — | the winner stays | `dup` | identity kept when the ends agree; a disagreement is a loss |
| gate grace and swap closes | `:1934`, `:1965`, `:2145`, `_clearGracePending :1100–1107` | enabled only with the gate armed; each consults `mayRetire` | — | gate refusal keeps the peer | `refused-grace` | the gate |
| class A re-offer | `mesh.js:1189–1225` | unchanged | — | — | `deadline(t)`; mark only if no OPEN channel | — |
| class B `_retire` | `mesh.js:1248–1292` | unchanged; lands in the unprompted `closed` row; mark with reason, expiring | — | — | `loss` | the role's recovery path |
| graduation watchdog | `web/index.js:165`, `814–822` | unchanged; re-dials the bridge, no peer | — | — | — | — |
| `lateral_spread` sender | `:5360–5372` | unchanged; its dial is bound-only `openConnection` and opens nothing new | `admit()` on a bound candidate | — | — | — |
| triadic → `connectViaRelay` | `:806`, `:4565–4567` | enabled; brought under the guard and the pending bound (rows 8, 11); a dial that cannot reserve is deferred | `admit()` on bind | — | — | — |
| `hop_cache` receiver | `:815` | unchanged; the sender is gated (row 9) | — | — | — | — |
| the fill tick | `_maintainSynaptome :1337–1380` | gated; target cap; reconcile first; dials through the guard | `admit()` | — | — | — |
| step-down hold, reconcile, handoff | `repairPlane.js`, `rootClaim.js`, `syncEngine.js` | unchanged | — | — | — | unchanged: these ARE the custody path |
| REPLICATE, queued | `wireHandlers.js:906` → `_ingestEnqueue :424` → `becomeBackup` at drain | unchanged processing; the queue entry carries its dependency and pins it in `mayRetire` while queued | — | the pin; then the installed role | — | installed at drain whatever the channel state; counted if the principal was lost meanwhile |
| REPLAY_UP, queued | `wireHandlers.js:757` | unchanged; dependency `none` | — | — | — | — |
| role creation, inline | the other `wireHandlers.js` handlers, `peer.host()` | unchanged; no fence | — | — | — | the gate protects the channels the roles name |
| `closeConnection` | `webrtc.js:345–348` | CLOSES (row 5); every caller is one of the rows above, and a test asserts the caller list | — | — | — | — |

Two things the table makes visible. First, below cap the only voluntary
closes are `cancel` and `refused-grace`, and both consult the gate; the
always-on release's safety claim is exactly that sentence, and it is tested
by the caller-list fence, not assumed. Second, custody in Phase 1 is the
kernel's existing custody. Nothing here adds an obligation path and nothing
removes one; what Phase 1 changes is that a voluntary close now asks first,
asks about queued work as well as installed work, and an involuntary close
now leaves a mark that expires.

## Losses

The four classes keep their names, with v0.4's three corrections (Vega
`b8bd9ec3`, confirmed `79ccdf05`) and one more from Vega:

- CLASS A has no signal today; `onNegotiationFailed(peerId, t)` is added
  (row 13), fired from `deadline(t)` and from an unprompted close of a
  channel that never opened. The mark it writes is written ONLY when the
  identity has no OPEN channel; otherwise class A would punch a hole in a
  live route, because `_greedyNextHopToward` and `_localCandidate` skip
  `_deadPeers` (`:4762–4772`). Row 13 ships with row 10 (expiry) in the same
  release, so no always-on mark is a permanent tombstone.
- CLASS B re-dials through `connectViaRelay` always; the bridge socket adds
  introductions and is not a second dial path.
- CLASS C, the graduation watchdog, is unchanged and is a backstop.
  `graduation-collapse` (`8fead6d`) stays on its branch.
- CLASS D is the dial.

No ICE restart.

## Discovery across cohorts

As v0.2: a bridge DIRECTORY of registered nodeIds with lifetime `L_reg`,
sampled at `R_sample` into a newcomer's handshake; PERIODIC RE-CONTACT by a
graduated node every `T` drawn in `[T/2, 3T/2]` for a window `W`, during
which it refreshes its registration, is introduced to whoever is on the
socket, takes a fresh sample and leaves. The arithmetic (`2W/T` per cycle,
`N·W/T` mean occupancy) is illustration, not a guarantee, and v0.2 lists
what makes it wrong: a fleet restart puts every node on one phase for a
cycle; sleeping nodes do not return; the bridge's cap (`BRIDGE_MAX_PEERS`
15) binds first at larger `N`.

The kernel side (the return timer, the sample into the candidate cache) is
gated with the fill. The bridge side (the registry, the sample, the
re-contact admission) is an active bridge change in its own release, with
row 2's anchor-region fix. A returning node that finds the bridge full is
refused and redraws; it is not a newcomer and does not take the nursery's
slot.

THE NEWCOMER'S REGION AT ADMISSION IS A CLAIM. Row 2 found that the bridge
binds a newcomer's nodeId on hello-ack, which arrives after `welcome` and
after the peer-list is sent (`bridge_axona_node.js:302–305`), and that the
4.102.0 client-hello carries no nodeId. So the anchors' regions come from
their bound identities (`connRegion`), and the newcomer's region can only
come from a `nodeId` field in its client-hello (row 2b), which the bridge
reads as an UNTRUSTED SELECTION/ORDER HINT and nothing else: it chooses the
claimant's anchors and orders the claimant's list, and through those
anchors' shared `anchorUses` counters it shifts later newcomers' scores and
steers introductions toward the claimed region (Aster `c771508b`). It is
never a binding, an authentication, a graduation region or a custody
authority; those read the bound identity. Until a kernel with row 2b is
deployed, a newcomer has no region at admission and the affinity pass is
skipped, which loses nothing: before row 2 the affinity grouped by the
connection handle's first two characters, a sequence number.

SATURATED-COHORT BRIDGING stays an unresolved requirement. In Phase 1 two
cohorts both at cap do not join; at `N` = 60 and cap 50 no cohort is at cap.

## The repairs

Row numbers are v0.3's so findings carry. ALWAYS-ON rows run from the
release that carries them and need no arming. GATED rows are inert until
the launcher arms the fill. The last column is where each row's code sits
as of this revision: a branch off `main 0c28c8d` (kernel) or `8747adc`
(bridge), unreleased, version not bumped; "reviewed" means the reviewer
named no remaining code defect at that sha, and nothing more.

| # | defect | where | Phase-1 repair | kind | fence | code |
|---|---|---|---|---|---|---|
| 1 | `_deadPeers` has no reason | `:623`, `:4762–4770` | marks carry a reason; the filter behaves as today; `add()` is membership only | ACTIVE, no behaviour change | `fence_dead_mark_reason` 27 | `row1-dead-mark-reason` `ddaa63a`, reviewed |
| 2 | anchor region reads the handle | `server.js:1223`, `anchor_select.js:25` | candidates carry `region` from `connRegion`; `orderSameRegionFirst`; the newcomer's region is the client-hello claim or null | ACTIVE (bridge) | `smoke-anchor-select` 31 | `row2-anchor-region-by-nodeid` `10a1e9d`, reviewed |
| 2b | the newcomer's nodeId is not bound when the peer-list is sent | `bridge_axona_node.js:302–305`; `web/index.js:303–313` | client-hello carries `nodeId`, an unauthenticated claim; the Boundary-4 row projects and types it, optional | ACTIVE, no behaviour change at the bridge until row 2 | `fence_client_hello_nodeid` 11 | `row2b-client-hello-nodeid` `e7333dd`, reviewed |
| 3 | channel tokens and the two records, reduced | new | `channel_ledger.js`; the tables, bounds and matrix above; no STAGED; escalation forces a second close and releases nothing; pointer eligibility excludes CLOSING; `enforce:false` by default (counts) | ALWAYS-ON bookkeeping | `fence_channel_ledger` 89 | `row3-channel-ledger` `7ad9b4f`, reviewed |
| 4 | duty gate | new | `mayRetire` on `obligationsOf`: installed roles, handoff parties in flight, queued ingest dependencies with a count per principal | ALWAYS-ON predicate | `fence_duty_gate` 56 | `row4-duty-gate` `8953676`, reviewed |
| 5 | `closeConnection` unbinds, does not close | `webrtc.js:345–348` | unbind first, then `mesh.disconnect`; no peer-died for a voluntary close; every caller a classified row | ACTIVE with 4 and 6 | `fence_close_connection` 11 | `row5-close-connection` `5711aee`, reviewed |
| 6 | anneal prunes below cap; `_addByVitality` swaps at cap | `:4662–4705`, `:5381`; `:4606–4611` | anneal call and method removed; `_addByVitality` skipped at cap before its open, `vitality-swap-skipped` | ACTIVE | `fence_no_anneal_below_cap` 17 | `row6-no-anneal` `0e335d5`, reviewed |
| 7 | maintenance skips bound-not-in-table | `:1357` | reconcile calling `admit` | GATED | case 2 | not started |
| 8 | relay fallback outside the guard | `:4545–4566` | `end()` on the consumed token at bind, cancel or deadline | GATED | case 16 | not started |
| 9 | `hop_cache` has no sender | `:815` | sender on the lookup trace, bounded by `LATERAL_K`; the sender checks the arm flag itself | GATED | once per successful lookup; nothing sent with the flag off | not started |
| 10 | `loss` marks never expire | as 1 | the automaton under *Marks*; two bounds, one table; outbound only; inbound is the transaction above, NOT IMPLEMENTED | ALWAYS-ON with 13 | `fence_mark_automaton` 71 | `row10-13-mark-automaton` `75487ad`, reviewed; C's normative half is this text |
| 11 | hex string into BigInt map | `:1315` | pass the BigInt; `connectViaRelay` fallback on `false` behind the guard | GATED | Vega's two-sided fence: unbound neighbour asserts 0 with no fallback and > 0 with it under the guard; BOUND neighbour asserts > 0 with no fallback | not started |
| 12 | fill tick, directory, re-contact | new | Rule 2's four steps; the kernel side of *Discovery across cohorts* | GATED | cases 7, 36 | not started |
| 13 | class A has no signal | `mesh.js:1248–1292` | `onNegotiationFailed`, owned and released at every layer; mark only without an OPEN channel | ALWAYS-ON with 10 | in `fence_mark_automaton` | with row 10 |
| 14 | maintenance can be armed without the guard | `relay.js:90–95` | the launcher refuses any subset of the three arms | ACTIVE (launcher) | case 39 | not started |
| 15 | admission decided before an `await` | `:4600–4612` | *Admission at the await*: reserve before the open or re-check in the insert's step; the extra channel stays charged | ACTIVE with 3 | case 61 | not started; combined review |

The release note for the accounting release names rows 3, 4, 5, 6, 10, 13
as its behaviour change, and says in those words that after it a node
holds and does not yet fill.

## Rollout

1. ROWS 1, 2 AND 14, each alone, on David's word, through
   `RELEASE-PROCEDURE.md`.
2. MEASURE. Open channels with no binding per node; bound and admitted
   peers, distribution; marks by reason; `dedup-key-absent` per node;
   greedy terminal count per topic. Before and after each release from here
   on.
3. LOAD CHECK, before anything is armed: one testnet relay on a 1-core
   droplet is driven to `cap` open PeerConnections by the harness and held
   for one hour. Pass: no swap in use, PSI cpu `some avg10` under 10 %,
   RSS under half the host's memory, steal under 5 %. Fail lowers `cap` for
   that class before step 4. The old west host swapped at far fewer than
   fifty channels; this is the number the review to David named as
   unmeasured.
4. THE ACCOUNTING RELEASE: rows 3, 4, 5, 6, 10, 13 always-on; rows 7, 8, 9,
   11, 12 present and gated. One release, reviewed as one. Between this
   release and arming, a node holds and does not fill.
5. ARM ON TESTNET, TOGETHER: `RELAY_SYNAPTOME_MAINTAIN=1`,
   `RELAY_ADMISSION_GATE=1`, `RELAY_ATTEMPT_GUARD=1` on the testnet relays at
   once, fill target cap. Twenty-four hours of step-2 measurements. Pass:
   admitted-degree minimum at `min(cap, N − 1)` with every shortfall named;
   `peer(PENDING)` never at `P_pending` for more than one guard cycle; a
   forced fleet restart inside the dial budget; `chan(CLOSING)` returning to
   zero within `CLOSE_ESCALATE_MS` of each close; MARKS-FULL for no more
   than one guard cycle under normal load.
6. PRODUCTION, on David's word, one host group at a time, with the step-2
   measurements before and after each group. The launchers change in their
   own commit; arming never rides a kernel release.

## Verification

Each case is an offline test before any live run. Numbers are v0.3's and
v0.4's where the case is carried; Phase-2 cases (8, 11, 12, 14, 15, 22, 23,
24–34) are not in this list.

1. One free slot, concurrent inbound and outbound binds: exactly one is
   admitted; the other stays BOUND `refused:cap`, charged.
2. Reconcile at cap−1 with three existing bindings: one admitted, two
   refused and charged; zero dials.
3. Reserved vacancies, gate armed: inside the lane a non-qualifying
   candidate is refused and a qualifying one admitted.
4. Old channel retiring beside a new attempt to the same peer: both
   counted; `closed(t_old)` releases only `t_old`; the pointer is untouched;
   a `bind` on `t_old` after CLOSING is ignored.
5. PWA suspend and resume: deadlines reconciled first; timers run once;
   `peer(PENDING) ≤ P_pending` throughout; no second dial for an id already
   PENDING.
6. Repeated nominations: an id nominated every tick is dialed on the
   schedule only (`attempts` counts failures, `dueAt` doubles); after
   `A_max` failures it is refused until `R_refill`; a bind deletes the mark
   and the next loss starts at `attempts: 1`.
7. Rendezvous, two executions: no overlap reports `fill-stalled:
   rendezvous` and infers nothing; controlled overlap under the four stated
   preconditions yields one introduction and a bind.
9. Physical bound: at `C_phys − 1`, of two concurrent single-channel
   requests exactly one proceeds; the other is deferred until a
   `closed(t)`.
10. Timeout holds capacity: a NEGOTIATING channel past its deadline is
    CLOSING and counted until the transport confirms; escalation releases
    on confirmation only.
13. Duty gate: a replication target of a root this node holds is not retired
    for `refused-grace`; resources stay charged; after handoff the retry
    proceeds; a class-B loss of the same peer enters the role's recovery
    path without consulting the gate.
16. Guard token: `begin(id, k)` once; `end(id, k, ·)` exactly once at bind,
    cancel or deadline; the duplicate row never calls `end`.
17. Existing duplicate resolution: with both keys present, both ends close
    the same loser and the peer record points at the winner; with a key
    absent at one end, the disagreement closes both channels, the identity
    reaches RESTING with `loss`, and `dedup-key-absent` is 1.
18. Restart with a surviving transport: the orphan pass places every orphan
    in CLOSING and adopts none; the first tick runs only after it.
19. Draining is loss-only: lowering `cap_req` below `peer(ADMITTED)` refuses
    admission, retires nothing, issues no close, reports the gap; the next
    class-B loss lowers `cap_eff` by one; raising `cap_req` ends the drain.
    No `retire` call carries a cap reason anywhere in the kernel.
20. Fences for every repair row, each failing with the repair removed.
21. `smoke_root_stepdown_hold` 83/83 and the full suite green at every step.
35. Class A mark: a negotiation that never opens produces
    `onNegotiationFailed` and a `loss` mark when no OPEN channel to that
    identity exists; the same channel produces no `onPeerLost`.
36. `_addByVitality` at cap: no `openConnection` call, no synaptome delete,
    no insert, `vitality-swap-skipped` counted; below cap the bound
    candidate is admitted through `admit()`.
37. Class A beside a live channel: a second negotiation to an identity that
    holds an OPEN channel fails; no mark is written; routing through the
    live channel is unchanged.
38. Marks at the bound: at `M_marks`, an identity nominated on every tick
    for ten ticks with no mark is never dialed; a new `loss` mark evicts
    only an exhausted mark waiting on refill; with none to evict the new
    mark is not written and the identity is refused; a `policy` mark is
    never evicted; POLICY-FULL refuses every unmarked identity until a
    revocation.
43. Exhaustion and refill: after `A_max` failures a dial at `dueAt − 1` is
    refused; at `dueAt` the predicate refills the token and one dial
    issues; the dial fails; the identity is refused until `now + R_refill`;
    then exactly one more issues. Across three refill windows exactly three
    attempts issue. The schedule is unchanged by a wall-clock step of ±1 h
    between windows.
44. Eligible inbound with a retained mark, NOT IMPLEMENTED: the
    acceptance transaction's due-loss-mark schedule (case 52): an identity
    exhausted at this node, with its refill due, offers inbound; the
    transaction COMMITS, CONSUME sets `dueAt := now + R_refill`, the bind
    deletes the mark; the same arrival one second before `dueAt` is refused
    `refused:ineligible` and consumes nothing (case 51). An inbound
    identification for an identity already held on a pointable channel is
    case 59: committed with nothing consumed, resolved under *Glare*.
45. Nomination then reservation refusal: a marked, eligible identity is
    nominated; `dial` finds `peer(PENDING) = P_pending`; the peer stays
    NOMINATED, `attempts` and `token` are unchanged, `dial-deferred` is 1;
    after a pending slot frees, the dial issues and the token is consumed
    then. A cancel from PENDING counts as a failure.
46. Queued duty (Aster `c34f3c85` P1-B): gate armed; a REPLICATE from
    principal P is accepted on a channel whose peer is BOUND-refused; the
    body is queued (the inline budget is spent by a prior ingest); the grace
    timer fires before the queue drains: `mayRetire(P)` returns false with
    `queued-duty`, the channel stays, resources stay charged; the queue
    drains, `backupOf = P` is installed; the grace retry: `mayRetire(P)`
    returns false on the installed role. Variant: the queue overflows and
    the entry is dropped: no pin, the grace close proceeds, no role is
    installed, the payload returns by anti-entropy and is pinned on
    arrival. Variant: P's channel is lost involuntarily while queued: the
    role is installed at drain, `backup-installed-after-loss` is 1, the
    standby is not pruned. Variant: a REPLAY_UP queued from child C pins
    nothing and a grace close of C proceeds.
47. `_ingestEnqueue` callers: the fence lists `_onReplicate` (dependency
    principal) and `_onReplayUp` (none); a third caller added without a
    declaration fails. Transfer order: on the inline path and at the queued
    `q.shift()`, `backupOf` is installed and the pin cleared in one step
    with no `await` between; an injected `await` before the install fails
    the fence; the overflow drop clears nothing because nothing was pinned.
48. ELIGIBLE → CONSUME → ELIGIBLE with no FAIL or BIND between: `attempts =
    A_max`, `token 0`, `dueAt 100`, `now 100`: the first predicate refills
    and returns true; ISSUE sets `dueAt := 100 + R_refill`; a second
    predicate at `now 100`, and at every instant before `100 + R_refill`,
    returns false; exactly one attempt issues in the window. Variant: the
    attempt FAILs at `now 130`: `dueAt := 130 + R_refill`; still one.
49. Outbound ISSUE, then inbound identify while PENDING: this node dials
    marked, eligible `x` (CONSUME, `dueAt` advanced); before the bind, `x`
    offers inbound on a second channel; `identify` finds `x` PENDING,
    consults no mark, consumes nothing, lets the channel bind; the two bind
    in either order and *Glare* keeps one; `chan(all)` counted both until
    each `closed(t)`; the mark saw one attempt. If both channels fail, the
    unpointed one's deadline is channel-only and the pointed one's deadline
    runs FAIL once.
50. Entering exhaustion: at `attempts = A_max − 1` a FAIL sets `attempts =
    A_max` and `dueAt := now + R_refill`, not `now + B·2^(A_max−1)`; the
    next predicate before `dueAt` is false; at `dueAt` it refills.
51. (inbound, NOT IMPLEMENTED) Early loss mark: a marked identity offers
    before `dueAt`; the transaction refuses `refused:ineligible`; no
    `_bindPeer`, `st.bound` false, no `auth-mesh-complete`, no CAP_ATTEST;
    the channel is cancelled by address; no loss mark is written; the mark's
    `attempts` and `dueAt` are unchanged.
52. (inbound) Due loss mark: the same identity at `dueAt`; committed in one
    step (pending record, CONSUME, token) before `_bindPeer`; the bind
    deletes the mark; `peer(PENDING)` returns to its prior value at bind.
53. (inbound) Policy mark: refused `refused:ineligible`; the policy mark is
    untouched.
54. (inbound) Unmarked identity under MARKS-FULL: refused; under
    POLICY-FULL: refused; after the full state lifts the same identity is
    committed.
55. (inbound) Pending-full: `peer(PENDING) = P_pending`; an eligible
    identity is refused `refused:pending` and nothing is consumed; after one
    pending release it is committed.
56. (inbound) Hook not ready: refused `refused:not-ready`; with no policy
    installed at all, accepted as `270835d` does, and the fence says which
    it exercised.
57. (inbound) State change during verification: the identity is unmarked
    when the hello arrives and marked (not due) before verification
    completes; the decision reads the current state and refuses; the
    reverse (marked at arrival, due at decision) commits.
58. (inbound) Repeated progress after refusal: a second hello or a late
    frame on the refused channel is ignored; no second decision, no bind,
    no retry.
59. (inbound) Held glare: the identity holds an OPEN channel here; a second
    inbound channel is committed with nothing consumed (no CONSUME, no new
    pending record) and `bindPeer`'s key picks the survivor; with the held
    channel CLOSING instead of OPEN the identity is NOT held and the
    transaction runs its steps 2–4.
60. (inbound) Bind failure after commit: `_bindPeer` throws; the pending
    record and token are released once; `FAIL(nodeId, 'bind-threw')`
    advances the mark; MeshAuth's transient recovery lets the next frame
    re-enter the transaction from step 1; nothing is released twice.
61. Admission at the await (row 15): size 3, cap 4; two `_addByVitality`
    calls pass the size check and await; both opens resolve true; exactly
    one inserts, the table ends at 4, the second channel is BOUND and
    charged in the ledger, not discharged, and takes the `refused:cap`
    disposition. The same schedule on `270835d` ends at 5.
39. Launcher: `RELAY_SYNAPTOME_MAINTAIN=1` without `RELAY_ATTEMPT_GUARD=1`
    or without `RELAY_ADMISSION_GATE=1` is refused with the three names in
    the message; all three arm.
40. Zero headroom: at `chan(all) = C_phys` an allocation is refused with
    nothing constructed; after one `closed(t)` the next allocation
    proceeds.
41. ALLOCATED deadline: a channel allocated and never sent a frame goes to
    CLOSING at `ALLOC_DEADLINE_MS`; pending and `k` are released if a peer
    pointed at it.
42. Unprompted close of an OPEN channel: GONE in one step, physical
    released, pointer cleared, `loss` mark if no other OPEN channel exists.

## Findings carried

Every finding against v0.4, by number, with its Phase-1 disposition.
"Retired by removal" means the mechanism the finding is about is not in
Phase 1 and the finding reopens with it in Phase 2.

| finding | about | Phase 1 |
|---|---|---|
| Aster `76bc93dd` 1 | duty timeout is not discharge; `D_ack`, `duty-orphaned` | retired by removal; the fence is Phase 2; the lease is Leases v0.11 |
| Aster `76bc93dd` 2 | glare assumes agreement; both ends admitted | NOT FIXED and stated: the kernel's existing resolution is used, its key-absent disagreement is counted; Election v0.12 is the Phase-2 fix |
| Aster `76bc93dd` 3 | `C_phys` derived two ways; A12 zero headroom; ALLOCATED expiry; unprompted close; `close(t, glare)` and pending; one table | CLOSED IN TEXT: one physical bound; strict `<` at allocation; `ALLOC_DEADLINE_MS`; two `closed` rows; the `dup` cell; the matrix |
| Aster `76bc93dd` 4 | latch spacing; one-attempt token; Bloom counters; policy overflow; high-water recreation | retired by removal; the exact mark table's forgetting is stated under *Marks* |
| Aster `76bc93dd` 5 | row 5 must gate the whole `_addByVitality` transaction | CLOSED IN TEXT: at cap the call is skipped before the open; below cap it is an admit |
| Aster `76bc93dd` 6 | capable-edge invariant under revoke races; accept-handler list; terminal PUB | retired by removal; the invariant is not claimed in Phase 1 |
| Aster `76bc93dd`, appendix | "the traces are the tests" | Phase 1 has no appendix; the cases above are tests to be written, not traces and not a proof |
| Aster `0d7f2982` 1 | high-water recreation is not a replay proof | retired by removal; no presence reactivation in Phase 1 |
| Aster `0d7f2982` 2 | a Bloom bucket cannot issue one token per identity | retired by removal; the token is an exact field on an exact mark |
| Aster `0d7f2982`, closing | mark every behaviour that relies on the contracts unavailable | DONE: the at-cap swap, staging, the fence and presence reactivation are not in Phase 1; the always-on release's claim is the boundary table's sentence and its caller-list fence |
| Vega `79ccdf05`, row 5 | skipping the close alone lets the insert run; a grace close of a channel the call did not create | CLOSED IN TEXT: skipped before the open; no grace timer; an unbound candidate never had a channel |
| Vega `79ccdf05`, callers | `_clearGracePending` missing | CLOSED IN TEXT: on the gated row |
| Vega `79ccdf05`, row 11 | the fence's bound case | CLOSED IN TEXT: the two-sided fence in row 11 |
| Vega `79ccdf05`, row 13 | an always-on mark with gated expiry is a permanent tombstone; a mark beside a live channel punches a hole | CLOSED IN TEXT: rows 10 and 13 ship together always-on; a mark is written only without an OPEN channel |
| Aster `6cbee271` | the boundary must name enabled operations and their obligations | DONE: *The boundary* |
| Aster `c34f3c85` P1-A | mark eligibility vs mark existence; no token refill transition | CLOSED IN TEXT (v0.6, reopened by `f5237636`, closed again v0.7): ELIGIBLE / FAIL / CONSUME / BIND; issue-advanced `dueAt`; the mark counts new pending records only; one exhaustion schedule; cases 6, 43, 44, 45, 48, 49, 50 |
| Aster `f5237636` P1-A (1) | REFILL set `dueAt := now`; CONSUME did not advance it; two issues per window | CLOSED IN TEXT: REFILL never moves `dueAt`; CONSUME on an exhausted mark sets `dueAt := now + R_refill`; case 48 |
| Aster `f5237636` P1-A (2) | identify on a PENDING identity bypassed the predicate while case 44 refused the loser | CLOSED IN TEXT: duplicate channels to a held identity are allowed and are the glare case, bounded by `C_inbound` and `C_phys`; the mark counts new pending records; case 44 rewritten; case 49 |
| Aster `f5237636` P1-A (3) | the A_max-th failure had two schedules | CLOSED IN TEXT: one FAIL rule by the post-increment count; case 50 |
| Aster `c34f3c85` P1-B | queued REPLICATE installs `backupOf` after a grace close | CLOSED AT DESIGN LEVEL (`f5237636`): the queue entry carries its dependency and pins it in `mayRetire`; install at drain unchanged, counted after loss; the deferred-handler inventory with its fence; the synchronous pin-to-role transfer fenced on three paths; overflow re-delivery stated as conditional liveness; cases 46, 47 |
| Aster `fb63049f` | the "one issue per window" claim needs its scope | CLOSED IN TEXT (v0.8): *The inputs* states the bound for a continuously retained mark under atomic ISSUE and a monotonic clock, as "at most", resets by BIND/eviction/restart named, attempt-rate not channel-rate |
| Aster `09f59626`, `38ea5f3e`, Vega `c6a1919a` | row 3 at its first pin: escalation released capacity; dedup winner skipped the ledger; bound set retained history; zero meant default; pointer could settle on CLOSING | CLOSED IN CODE at `72fe6c4` and `7ad9b4f` (Aster `75cd61d8`); carried into the text: escalation forces a second close and releases nothing; pointer eligibility excludes CLOSING (*The transitions*, *Glare*) |
| Aster `01bb6555`, `5916c35a` | row 4: one in-flight slot; fence copied the path; handoff marker lifetime | CLOSED IN CODE at `8953676`: a count per dependency; real-path fence with a negative control; the marker is orchestration from job construction to return, not send completion, not discharge, stated at the site and under *The duty gate* |
| Aster `2f945b42` | row 5: the trust statement of the fence's caller list | RECORDED: a static allowlist, not execution of each caller's classification; packaging with rows 4 and 6 restated |
| Aster `d5b37071`, `4c07cab5` (cap map) | two below-cap opens both insert; physical reservation ≠ admission | CLOSED IN TEXT (v0.8): *Admission at the await*, row 15, case 61; pre-existing at `270835d`; code not started |
| Aster `c771508b` | a newcomer's region claim moves shared load counters | CLOSED IN TEXT (v0.8): *Discovery across cohorts*, the claim's side effects named; in code at bridge `10a1e9d` |
| Aster `4c07cab5`, `3717daee` | inbound identify is a material gap; a bind-policy hook after `bindPeer` is too late and skipping `bindPeer` refuses nothing in MeshAuth | OPEN IN CODE, SPECIFIED IN TEXT (v0.8): *Inbound identification: the acceptance transaction*, cases 51–60; NOT IMPLEMENTED |
| Aster `1816f5e6` A, B | row 13 subscription leaked across stop/restart; fence copied the callback | CLOSED IN CODE at `75487ad` (Aster `97a7f1a4`): owned and released at every layer; installed-callback fence with a mutant that fails it |
| Aster `1816f5e6` C, `181dd4ee`, `97a7f1a4`, `bd3ecd6d` | loss and policy marks share one table; the text said `marks ≤ M_marks` | CODE at `75487ad` verified under the split interpretation; NORMATIVE HALF CLOSED IN THIS TEXT: *Two bounds, one table* (loss ≤ `M_marks`, policy ≤ `M_policy`, total ≤ their sum, loss drives hysteresis, conversion and deletion defined); pending Aster's read of this revision |
| Vega `79ccdf05` row 13 (carried) | a class-A mark beside a live channel punches a hole | IN CODE at `75487ad`: mark only without an OPEN channel, fenced through the installed callback |
| Aster `c34f3c85` P1-C | `cap-change` retirement contradicts the drain rule | CLOSED IN TEXT: the reason is removed; draining is loss-only; case 13 on `refused-grace`; case 19 rewritten |
| Aster `fb79c09e` | row 1: `add()` overwrote a known cause | CLOSED IN CODE at `ddaa63a` and stated under *Marks*: a writer without information never overwrites a mark that has it |

## What this design does not establish

- That any cap is safe on any class before step 3 measures it.
- That re-contact meets any pair in bounded time.
- That a denser mesh ends split roots; the Monte Carlo in `16b554bd` is a
  model figure.
- The fleet impact of a `closeConnection` that closes; measured at step 2.
- The cause of the 04:33Z event.
- That the two ends of a duplicate channel agree when a key is absent. They
  may not. Counted.
- That no obligation exists on an unadmitted channel. Not claimed.
- Any at-cap behaviour beyond holding. A node at cap does not swap.
- That the inbound acceptance transaction is implemented. It is not; the
  rows-10/13 pin accepts an inbound bind of a marked identity and deletes
  the mark, as `270835d` does.
- That a reviewed row is accepted as part of the whole: every "reviewed"
  in the repairs table is a finite disposition on that row's pin, and the
  combined pin, with the grace-overflow and close/duty interactions, row
  3's physical retention under real closes and row 15's schedule, has not
  been built or reviewed.
- Anything about the fleet: no row has run on a relay, a bridge or a
  browser; every fence is offline, with a sim transport or a fake
  RTCPeerConnection.
- SATURATED-COHORT BRIDGING, an UNRESOLVED REQUIREMENT, as every revision
  has said.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| cap, relay / seat | 50 | step 3's load check on a 1-core droplet |
| cap, browser / PWA | 12 | a 24 h phone run with battery and memory flat |
| `kJoin` | 2 | a measured need for more newcomer lanes |
| `P_pending` | 8 | fill time to cap over ten minutes at N = 60 with supply present |
| `C_phys_req(cap)` | cap + `P_pending` + `C_inbound` + 4 | the open-channel-with-no-binding count at step 2 |
| `C_inbound` | 4 | inbound refusal count at step 5 |
| `K_cache` | 64 | cache eviction rate at step 5 |
| `M_marks` / `M_hyst` / `M_policy` | 256 / 32 / 1024 (loss bound / loss hysteresis / policy bound; total ≤ 1280) | MARKS-FULL duration at step 5; `policy-refused` > 0 means `M_policy` is too small |
| fill tick / per tick | 15 s / 3 (`:256–258`) | the step-5 storm check |
| `B` / `A_max` / `R_refill` (the guard schedule) | 30 s, ×2 / 4 / 60 s (`relay.js:94–95`) | unchanged until a measured reason; `R_refill` is one issued attempt per exhausted identity per window |
| `ALLOC_DEADLINE_MS` / `NEGOTIATION_DEADLINE_MS` / `CLOSE_ESCALATE_MS` | 5 s / 30 s / 10 s | measured allocation, bind and close times |
| re-contact `T` / `W` / draw | 10 min / 60 s / `U[T/2, 3T/2]` | grow `T` with N; shard the bridge first |
| `L_reg` / `R_sample` | 24 h / 16 | registry size at the bridge |
| refused-grace | 60 s | gate blocks at step 5 |

## Where the code stands

Eight branches, listed in the repairs table's last column, each off main
`0c28c8d` (kernel) or `8747adc` (bridge), each unreleased, none
version-bumped, each with a finite reviewer disposition naming no
remaining code defect at its head: rows 1, 2, 2b, 3, 4, 5, 6 and 10+13. No
combined branch exists. Rows 7, 8, 9, 11, 12, 14 and 15 are not started.
The inbound acceptance transaction is not started. Every suite result
quoted in a council post was run alone on the author's machine; two
wall-clock-sensitive smokes each flaked once when a second suite or a
fence shared the machine and pass alone. v0.1 through v0.7 stand as
record. Branch `graduation-collapse` (`8fead6d`) stays unreleased. Channel
Election v0.12 and Duty Leases v0.11 are frozen as Phase-2 candidates and
are not revised until Phase 2 is reached. What runs next, the combined
pin or a release of the no-behaviour-change rows, is David's.
