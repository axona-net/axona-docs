# Mesh connectivity: hold and fill (v0.4)

**Status:** design for council review, revision 4 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Bridge:** 2.145.0 (`533ad04`) ·
**Policy set by:** David · **Author:** axona.bot ·
**Supersedes:** v0.3 (axona-docs `0e05955`), v0.2 (`769183f`), v0.1
(`4ad3741`), all left in place as record ·
**Revision driver (v0.4):** Aster `e343dcf9`, CHANGES REQUIRED on v0.3, six
counterexamples, decisions recorded at `78ca6c15` before this file. The
errors in v0.3: the quarantine's exit forgot every identity evicted while it
held, which is a rejection turned into permission; DRAINING did not block a
staged admission because the precondition it relied on is true during a
drain; glare used local mint order, which two ends can disagree on; a
deadline moved the channel and left the peer pointing at it; the application
fence was one-sided and had no rule for peers that predate it; and two active
repairs depended on rows that were inert at the moment they would be needed.
Then, before this file froze, Aster `192f33c7` against the announced
corrections: a rotating latch is timer-based removal of a policy rejection;
`cap_eff` tracks admitted count and not physical resources; one-way ready
frames do not make duty knowledge simultaneous and SUB/PUB can allocate roles;
and a local duty-bearing override can make two ends resolve glare
differently. And Vega `b8bd9ec3` on the repair table: a never-opened
negotiation failure never reaches `_deadPeers`, so a class-A mark needs a
signal the mesh does not send today; class D is the dial, not a loss;
`closeConnection` has five callers the row left out; the hex fix alone dials
no stranger; the `hop_cache` sender must check the arm flag itself. Earlier
drivers: Aster `a313d87b`, `6866077d`, `8f082cec`, `40fa6895`,
`14d11520`, `79d241d7`, `ac344f10`, `2552a639`, `4a58b7fb`, `1b2a24ad`; Vega
`127cb170`, `0dbc5da6`; David's direction of 2026-10-04.

**What changed from v0.3:** *The two rules*, *Discovery across cohorts*, *The
duty gate* and *The potential* (except epoch validity) stand as v0.3 wrote
them and are not repeated. Rewritten here: channels, peers and transitions;
the three memories (policy set, exhaustion latch, high-water map) in place of
one quarantine; cap and draining with a separate physical bound; glare by
frame; the fence as role-specific duty creation with a stated capability
boundary; three corrections to the loss classes; the repairs with every
`closeConnection` caller classified and two rows corrected; rollout;
verification. New: an appendix of transition traces, one per counterexample,
with resource counts, logical states and frames.

This document is a design. It changes no code, arms no mechanism, moves no
gate, and runs nothing live. Deploy is David's.

---

## Channels, peers and transitions

Two records, as v0.3: a CHANNEL record per RTCPeerConnection keyed by a token
`t` minted at allocation and never reused; a LOGICAL PEER record per identity
keyed by nodeId, pointing at its current `t` or none. v0.4 makes every
transition total: each one names, in order, what happens to the channel, the
peer pointer, the counters, the completion token and the frames, in one
synchronous step, and says what a duplicate event does.

Channel states: ALLOCATED, NEGOTIATING, OPEN, CLOSING, GONE. Peer states:
NOMINATED, PENDING, BOUND, ADMITTED, STAGED, RESTING. A peer record points at
a channel only in ALLOCATED, NEGOTIATING or OPEN; the moment its channel
enters CLOSING, the pointer is cleared in the same step. That is the
peer/channel invariant v0.3 broke in `deadline`.

### Counters and bounds

```
peer(ADMITTED)                                      ≤ cap_eff
peer(PENDING)                                       ≤ P_pending
chan(ALLOCATED ∪ NEGOTIATING ∪ OPEN ∪ CLOSING)      ≤ C_phys
chan(ALLOCATED ∪ NEGOTIATING, inbound, unbound)     ≤ C_inbound   (⊂ C_phys)
peer(STAGED)                                        ≤ S_overlap
peer(NOMINATED)                                     ≤ K_cache
marks                                               ≤ M_marks
latch buckets × entries                             = B_latch × L_bucket, fixed
bytes queued per channel                            ≤ B_sig
directory sample                                    ≤ R_sample
```

Every negotiation attempt is counted AT THE CHANNEL from ALLOCATED, inbound
or outbound, with or without a peer record. `C_inbound` counts inbound
channels from allocation, so several allocations before any frame cannot
evade it. `peer(PENDING)` is a second, smaller bound on attempts that have an
identity; it never substitutes for the channel bounds.

### The transitions

Each line is one synchronous step. "Dup" says what the same event does a
second time.

- `nominate(id, src)`: refuse if `peer(NOMINATED) = K_cache`, or a mark or a
  latch hit forbids `id`. Else peer → NOMINATED. Dup: no-op.
- `allocate(owner, dir)`: refuse if `chan(all) = C_phys`, or `dir = in` and
  `chan(inbound unbound) = C_inbound`. Else mint `t`, channel → ALLOCATED.
  Nothing is sent on refusal; an inbound offer refused here gets a signalling
  refusal frame and no PeerConnection.
- `dial(id)`: require NOMINATED and `peer(PENDING) < P_pending` and
  `allocate(dialer, out)`. Then: peer → PENDING pointing at `t`; mint
  completion token `k`; `guard.begin(id, k)`; send offer. Dup: no-op.
- `inbound(t)`: an inbound ALLOCATED channel → NEGOTIATING on its first frame;
  no peer record yet.
- `identify(t, id)`: the handshake names `id` on channel `t`. If `id` has no
  record or is RESTING or NOMINATED: require `peer(PENDING) < P_pending`, else
  close(`t`, `refused:pending`); then peer → PENDING pointing at `t`, mint
  `k`, `guard.begin`. If `id` already has PENDING, BOUND, ADMITTED or STAGED
  state: the peer record is NOT overwritten; `t` is a second channel and
  goes to `glare(t, t_cur)` below.
- `bind(t)`: channel → OPEN; peer PENDING → BOUND; pending released;
  `guard.end(id, k, true)` consumes `k`; send `mesh:hello-done`. Then
  `admit(id)` in the same step. Dup: no-op.
- `admit(id)`: require BOUND, `peer(ADMITTED) < cap_eff`, not DRAINING, lane
  and policy yes. Then: peer → ADMITTED storing `t` and the cap-policy
  generation; channel `routable := true`; synaptome insert; send
  `mesh:ready`. On refusal: peer stays BOUND with `refused:<why>`, grace
  timer starts. Dup: no-op.
- `stage(id)`: require BOUND, remote `mesh:admit` received on `t` inside its
  TTL, `peer(STAGED) < S_overlap`. Then peer → STAGED; freeze `E`; start
  stage TTL. No `k` exists; `end` is not called.
- `admit-staged(c, v)`: the ten preconditions under *Cap and draining* and
  *The potential*; then one step: `v`'s channel → CLOSING with `swap`,
  `v`'s pointer cleared, `v` → RESTING, `routable := false` on `v`'s channel,
  synaptome delete `v`; `c` → ADMITTED with `t_c` and the generation,
  `routable := true`, synaptome insert `c`, send `mesh:ready` on `t_c`.
- `retire(id, reason)`: for a gated reason, `mayRetire(id)` first; refusal
  changes nothing and is reported. Else: channel → CLOSING; pointer cleared;
  peer → RESTING; `routable := false`; synaptome delete; close issued.
  Capacity NOT released. Dup: no-op.
- `cancel(id)` from PENDING: `mayRetire` (true behind the fence; consulted);
  if refused, nothing changes and `k` is NOT consumed. Else, one step:
  channel → CLOSING; pointer cleared; peer → RESTING; pending released;
  `guard.end(id, k, false)` consumes `k`; close issued. From STAGED: the same
  without `k` and without pending. Dup: no-op by token state.
- `deadline(t)`: require NEGOTIATING past `NEGOTIATION_DEADLINE_MS`. One
  step: channel → CLOSING; if a peer points at `t`: pointer cleared, peer →
  RESTING, pending released, `guard.end(id, k, false)`, `mark(id, loss)`.
  Close issued. Dup: no-op.
- `close(t, reason)`: a channel-addressed close, used by glare and by the
  orphan pass; channel → CLOSING; if a peer points at `t` the pointer is
  cleared and the peer handled as in `retire` with the given reason. Never
  touches a channel other than `t`.
- `closed(t)`: CLOSING → GONE; physical released for `t` only. If the peer
  record still pointed at `t` when the transport reported the close
  unprompted (involuntary), the loss path runs: peer → RESTING, pending
  released if it was PENDING, `end(id, k, false)` if `k` is live, `mark(id,
  loss)`. Dup or unknown `t`: stale, reported, discarded.
- `escalate(t)`: CLOSING past `CLOSE_ESCALATE_MS` → forced `pc.close()`;
  capacity still waits for `closed(t)`.

### Glare

Two channels to one identity. v0.3's override ("a duty-bearing channel wins
regardless of key") was local knowledge, and two ends can hold it about
different channels. v0.4 has three rules, in order, none of them local:

1. NEVER DIAL A HELD IDENTITY. A node issues no dial to an identity it has a
   channel to in PENDING, BOUND, ADMITTED or STAGED. So an outbound dial
   never creates glare against this node's own admitted channel.
2. AN ADMITTED END REFUSES DUPLICATES BY FRAME. When `identify(t_new, id)`
   arrives and this node has `id` ADMITTED on `t_cur`, it answers on `t_new`
   with `mesh:refuse-dup(key(t_cur))` and closes `t_new` by
   `close(t_new, 'dup')`. The other end, on receiving `refuse-dup`, closes
   its side of `t_new` by token and keeps `t_cur`. The admitted channel is
   never the one closed, and both ends agree because the decision is a
   frame, not a local comparison.
3. KEY ORDER FOR THE REST. When neither end has `id` ADMITTED (both channels
   are PENDING or BOUND at both ends), the channel with the smaller
   authenticated channel key wins; the key is derived from the sorted nonce
   pair and is IDENTICAL at both ends; local `t` orders nothing. The loser
   is closed by `close(t_loser, 'glare')`, by token, never by `retire(id)`.

Rule 2 covers the case where one end has admitted and the other has only
bound: the admitted end's frame decides, and the bound end honours it. Two
different admitted channels between one pair cannot exist, because a channel
is one PeerConnection seen from two ends and admission at either end is of
that same channel. Both channels count against `C_phys` until each confirms
close. Traces A5 and A6 run both arrival orders with an admitted,
duty-capable channel; A13 runs the opposing-choice case Aster named.

### Suspension, restart, orphans

As v0.3: identity across suspension is (transport instance, `t`); resume
reconciles deadlines before any tick; a fresh process has empty tables. A
surviving transport runs the orphan pass: every live PeerConnection it still
holds gets a `t`, goes to CLOSING through `close(t, 'orphan')`, and is never
adopted. The pubsub layer treats every role as LOST on that reload, which is
what a restart already means in the kernel because nothing is persisted;
duties that cannot be reconstructed enter the loss path. Unknown is not
absent.

## Marks, the policy set and the exhaustion latch

v0.3's quarantine forgot an evicted identity when the table emptied. The
latch announced at `78ca6c15` rotated policy rejections out on a timer, which
is the same forgetting on a longer clock. Aster `192f33c7` named the three
things that were being kept in one structure and must be kept in three,
because they have three different forgetting contracts:

| memory | what it remembers | how it is forgotten |
|---|---|---|
| POLICY SET | identities refused on identity or policy | only by an explicit revocation event, or by process restart |
| EXHAUSTION LATCH | identities whose transient retry budget is spent | by rotation, which is a deliberate slow-retry permission, stated below |
| HIGH-WATER MAP | the largest accepted presence timestamp per identity | never while the identity is in either structure above; its overflow rule is below |

**The policy set.** Exact identities, bounded at `M_policy`. A policy
rejection enters it. It leaves only on an explicit revocation event (an
operator action, or a signed revocation the policy layer defines) or when the
process restarts, which forgets everything because nothing is persisted; that
is the existing contract and it is stated, not changed. OVERFLOW: when the
set is full, a new policy rejection is written to the POLICY OVERFLOW FILTER,
a counting Bloom filter that never rotates, is never cleared on time or
occupancy, and is reset only by restart. Its false-positive rate rises as it
fills; every hit is a refusal; `policy-overflow-count` is reported so David
sees when `M_policy` is too small. Nothing written as policy is ever
forgotten into permission while the process lives.

**The exhaustion latch.** `B_latch` time buckets, each a counting Bloom
filter of `L_bucket` cells, rotated every `L_rot`. Written when a loss mark
is evicted for space or expires with its retry budget spent. A hit refuses
nomination and inbound identification with reason `latch`. THE FORGETTING
CONTRACT: rotation after `B_latch × L_rot` re-permits ONE attempt to that
identity, by design: a peer lost for a transient reason is worth one dial
every few hours, and that dial consumes a fresh retry budget. Expiry is not
an authorization event; it is the start of one bounded attempt. Within the
window there are no false negatives; false positives are at the filter's rate
and conservative.

**The high-water map.** Exact `(identity → timestamp)`, bounded at `M_hw`,
written on every accepted presence record and on every mark. A Bloom filter
cannot hold a timestamp; this map can, and it is the only place one lives.
OVERFLOW: when the map is full, an identity with no entry gets NO
reactivation by presence record, only by a bind on our own channel; an
existing entry is never evicted while its identity is in the policy set, the
exhaustion latch or the mark table. Entries for identities in none of those
are evicted oldest-first.

**Marks.** A mark holds reason, lifetime and retry count; `marks ≤ M_marks`.
A `loss` mark on eviction or spent expiry writes the exhaustion latch. A
`policy` mark is a pointer into the policy set and is never evicted; when
the mark table is full of policy marks and a new policy rejection arrives, it
goes to the policy set or its overflow filter directly, with no mark, and
`policy-direct` is reported. MARKS-FULL stays as the occupancy quarantine
(untracked identities refused while `marks = M_marks`, lifting below
`M_marks − M_hyst`); with the three structures above, lifting forgets
nothing.

**One contract for reactivation.** There is no nonce cache. Fresh evidence is
a `bind` from the identity on our own channel, or a signed presence record
inside `PRESENCE_FRESH_MS` of the receiver's clock and strictly above the
identity's high-water in the map; an identity with no map entry has no
presence reactivation. A policy-set identity has no reactivation at all. A
latched identity's presence record is counted and changes nothing. Bounded by
`R_react` and `R_tick`. Case 14 reads this way. Traces A1 and A11 run the
full rotation and the all-policy overflow.

## Cap and draining

`cap_req` is what the operator set. On EVERY change to `cap_req`, the node
recomputes `cap_eff := max(cap_req, peer(ADMITTED))` at that instant and
increments the cap-policy generation `g_cap`. `DRAINING := cap_eff > cap_req`.
While DRAINING: `admit()` refuses with `refused:draining`; `admit-staged`
refuses (below); nothing is retired to meet the number; each involuntary loss
or voluntary retirement for another reason recomputes `cap_eff` and the drain
ends when `cap_eff = cap_req`. A partial raise, 40 to 45 with 50 admitted,
leaves `cap_eff` 50 and DRAINING until 45; a raise to 55 ends it at once with
`cap_eff` 55. `C_phys` derives from `cap_eff`, not `cap_req`, so it never
drops below what is open and follows the drain down.

`admit-staged(c, v)` precondition 7 reads: `peer(ADMITTED) = cap_eff` AND not
DRAINING AND `g_cap` at commit equals `g_cap` recorded at `stage()`. A cap
change during the stage, up or down, fails the generation check; the swap is
void; `c` goes through `admit()` if a slot opened, else waits for TTL.

**The physical bound has its own pair.** `cap_eff` counts admitted peers and
says nothing about BOUND, CLOSING or unauthenticated channels. So the
physical bound is not derived from it. `C_phys_req` is computed from
`cap_req` by the formula in the parameter table; `C_phys_eff :=
max(C_phys_req, chan(all))` on every change to `cap_req` or to `chan(all)`;
`PHYS-DRAINING := C_phys_eff > C_phys_req`. While PHYS-DRAINING, `allocate()`
refuses every request, inbound and outbound, with `refused:phys-draining`;
each `closed(t)` recomputes; the state ends when `chan(all) ≤ C_phys_req`.
Nothing is closed to meet the number. The physical invariant is
`chan(all) ≤ C_phys_eff`, which holds at every instant by construction; the
requested bound is approached, never asserted. Trace A12.

## The potential: epoch validity

`E` is frozen at `stage()`. At commit, if the oldest response in `E` is older
than `V_obs`, the commit aborts with `swap-epoch-expired`, `c` stays STAGED
until its TTL, and the next decision recomputes under a fresh `E`. A
candidate id vouched for by an authenticated neighbour's table is a
NOMINATION SOURCE and nothing more; first-party verification is the bind on
our own channel, and only a bound identity counts in `m_b`.

## The fence, two-sided

v0.3's fence was local: this end dropped application frames until it had
admitted. The remote could admit first, send `mesh:admit`, and begin
assigning duties while this end was still STAGED and dropping. v0.4 makes
duty capability a two-sided property.

**Readiness is necessary, not sufficient.** Each end sends `mesh:ready` on
the channel in its own `admit()` step, and a channel is DUTY-CAPABLE at an
end only when that end has sent its own `ready` and seen the other's. That
makes duty-capable two-sided in the end state, and it does not make the two
ends' knowledge simultaneous: one end sees both frames before the other
does. So readiness gates nothing by itself. What creates a duty is a
ROLE-SPECIFIC ACCEPTANCE EXCHANGE on a duty-capable channel.

**Duty creation.** Every obligation between two nodes is created by an
offer/accept pair, and the duty exists at each end at a defined frame:

| obligation | offer | accept | duty exists at the acceptor when | at the offerer when |
|---|---|---|---|---|
| backup appointment | `role:appoint` | `role:accept` | it sends `accept` | it receives `accept` |
| host registration | `host:register` | `host:ack` | it sends `ack` | it receives `ack` |
| handoff | `handoff:offer` | `handoff:accept` | it sends `accept` | it receives `accept` |
| replication target | `repl:enlist` | `repl:ack` | it sends `ack` | it receives `ack` |

An offer is sent only on a channel the offerer holds duty-capable; an offer
arriving on a channel the receiver does not hold duty-capable is dropped,
`fence-drop-duty`, and never queued. A lost `accept` leaves the acceptor
holding a duty the offerer does not know: the acceptor's duty EXPIRES unless
the offerer's first obligation-bearing frame (a replication, a heartbeat, a
handoff payload) arrives inside `D_ack`; on expiry the acceptor reports
`duty-orphaned` and releases. The asymmetry is finite and named.

**Roles created without a peer's consent.** A node becomes root at a
terminal (`sub-terminal`, `pub-terminal`, `terminal-promote`) and a host by
its own `peer.host()`. Those create duties toward peers only through the
exchanges above (appointing backups, enlisting replication targets, serving
subscribers who registered through `sub` on a duty-capable channel). A `sub`
or `pub` that arrives over a channel that is routable but not duty-capable is
FORWARDED (transit) and is not handled terminally for that peer: a terminal
`sub` from a non-duty-capable channel is held in a bounded queue `Q_sub` until
the channel becomes duty-capable or `D_ack` passes, then dropped
`fence-drop-sub`. So "ordinary pubsub" is classified by handler effect, as
Aster required: transit passes on routable; anything whose handler can create
a role involving the peer requires duty-capable on the ingress channel.

**Obligation-capable handlers**, each listed and traced: `sub` terminal,
`pub` terminal, `role:appoint`, `role:accept`, `host:register`,
`handoff:offer`, `repl:enlist`, the step-down hold's `holdFwd` carrying a
`sub`. Any handler found later that can create a duty and is not in this
list is a defect against this document.

**Revocation.** Either end's `mesh:revoke`, or channel loss, clears
duty-capable at that end in one step and runs the role's handoff path for
every obligation that rode the channel; the remote learns by the same frame
or the same loss and does the same. A revoke frame in flight past a new
`accept` is resolved by the generation on the frames: an `accept` carrying a
generation older than the latest `revoke` seen is ignored.

**The capability boundary.** A peer that does not advertise `cap:fence` in
the axona/4 handshake is a LEGACY peer. On a legacy edge: no staging, no
`mesh:admit`, `mesh:ready` or `mesh:revoke`; bind → admit as today; the
peer is duty-capable on admission as today; and THE DUTY-FENCE INVARIANT IS
NOT CLAIMED. Behaviour toward a 4.102.0 peer is unchanged, which means its
guarantees are unchanged, which means none. The invariant "no obligation
without duty-capable at both ends" holds only on edges where both ends
advertise `cap:fence`, and the design says so in those words. A mixed
network has the invariant on its capable edges and the old behaviour on the
rest, and the measurement at step 2 counts both.

## Losses: three corrections

Vega `b8bd9ec3` read the loss classes against the vendored kernel.

- CLASS A HAS NO SIGNAL TODAY. A negotiation that never opened ends in
  `_retire('negotiation-timeout')` with `openedAt` still 0, and `_retire`
  fires `onPeerLost` only for a channel that had opened (`mesh.js:1248–1292`).
  A never-opened failure never reaches `_deadPeers`, so "a loss mark, as
  today" was wrong. The mesh gains `onNegotiationFailed(peerId, t)`, fired
  from `deadline(t)` and from `closed(t)` on a channel that never opened; the
  kernel's death callback writes the mark from it. Row 13 in the repairs.
- CLASS B RE-DIALS THROUGH THE RELAY PATH ALWAYS. A lost peer is unbound
  whether or not the bridge socket is open, and `openConnection` will not
  dial an unbound peer in either case. The re-dial is `connectViaRelay`,
  signalled through the mesh when a route exists, through the bridge socket
  when one is open and no route exists, and reported `fill-stalled:
  rendezvous` when neither. The bridge socket adds introductions; it is not a
  second dial path.
- CLASS D IS THE DIAL, NOT A LOSS. The inventory keeps four classes because
  Aster `ac344f10` asked that they stay separate; D is "discovery-triggered
  relay dial" as named there, and Rule 2 says when it runs. It is not a loss
  and the losses section no longer lists it as one.

## The repairs: callers, always-on rows, two row corrections

As v0.3's table, with these changes.

**Rows 3 and 4 are ALWAYS-ON** from the release that carries them: the
channel and peer records with their counters, and the duty gate. They are
bookkeeping and a predicate, issue no dial, and run whether or not the fill
is armed. Rows 5 and 6 depend on always-on prerequisites, not on arming.

**Row 5, `closeConnection`, every caller classified.** Vega `b8bd9ec3`
listed the ones v0.3 left out. In production at `270835d`:

| caller | line | victim | class under this design |
|---|---|---|---|
| `_tryAnneal` | `:4689` | live, before the open | removed by row 6, same release |
| `_addByVitality` | `:4609` | live, after a successful open, at cap | a swap at cap; replaced by the gated swap rule; until armed, the close is skipped and the victim stays, reported `vitality-swap-skipped` |
| `_evictAndReplace` | `:4715` | already dead | involuntary; allowed |
| peer-leaving | `:888` | the departing peer | involuntary; allowed |
| gate grace and swap closes | `:1934`, `:1965`, `:2145` | live | run only with the gate armed; gated |
| the swap rule | new | live | gated; through the duty gate |

So with rows 3, 4, 5, 6 in one release and `_addByVitality`'s close skipped
until the swap rule is armed, no live channel is closed by a voluntary path
that the duty gate does not cover. That is the window Vega named, closed by
packaging and by the skip, and the release note says both.

**Row 9, `hop_cache` sender:** the sender checks the maintenance arm flag
itself before sending; standing on the lookup path is not a gate, as
`lateral_spread` shows (`EN_LATERAL_SPREAD` true, sends today when its
condition is met).

**Row 11, the hex fix:** passing the BigInt makes `openConnection` return
`false` correctly for an unbound neighbour instead of returning `false` by
accident; it dials nothing. The repair is the key type PLUS the
`connectViaRelay` fallback on `false`, behind the guard, with the pending and
physical bounds applied per dial. The two-node fence asserts `opened > 0`
only with the fallback present; with the fallback removed it asserts 0, which
is the fence.

**Row 13, new:** `onNegotiationFailed` from the mesh to the kernel's death
callback, so class A writes a mark. ALWAYS-ON with row 3; it adds a signal
and changes no close.

Rows 7, 8, 9, 10, 11, 12 stay gated. The release note names rows 3, 4, 5, 6
and 13 as its behaviour change.

## Rollout

1. Rows 1 and 2, each alone, on David's word.
2. Measure, as v0.3.
3. The accounting release: rows 3, 4, 5, 6, 13 always-on; rows 7 through 12
   present and gated. One release, reviewed as one, with the appendix traces
   as its tests. On David's word. Between this release and arming, anneal is
   gone and the swap rule is not yet armed, so nothing substitutes at cap;
   that is Rule 1 holding with no at-cap plasticity, and losses still remove
   peers. The gap is stated here, as Vega asked, and it is the intended
   state of a node that holds and does not yet fill.
4. Arm on testnet, together, as v0.3, with two added pass conditions: the
   latch's `latch-fp-possible` count stays below `F_fp` over 24 h, and
   `MARKS-FULL` holds for no more than one guard cycle under normal load.
5. Production, on David's word, one host group at a time.

## Verification

Cases 1 through 23 as v0.3, with these rewritten or added. Each case in the
appendix is an offline transition trace: initial counts and states, the
event sequence, and after each event the counts, the peer and channel
states, the frames emitted, and the invariants checked.

14. Reactivation: a bind, or a signed presence inside `PRESENCE_FRESH_MS`
    and strictly above the high-water read from the mark or the latch,
    bounded by `R_react` and `R_tick`; no nonce anywhere; a replayed record
    fails the high-water whether or not any mark survives.
15. The three memories (traces A1, A11): a policy rejection is refused after
    full latch rotation, after MARKS-FULL lifts, and after `M_policy`
    overflow, and is released only by a revocation event; an exhausted loss
    identity is refused until rotation and then gets exactly one attempt that
    consumes a fresh budget; a high-water entry is never evicted while its
    identity is in any structure; an identity with no map entry has no
    presence reactivation.
32. Physical draining (trace A12): lowering `cap_req` with `chan(all)` above
    the new `C_phys_req` refuses every allocation, closes nothing, and ends
    when closes bring `chan(all)` under the requested bound.
33. Glare by frame (trace A13): with `id` admitted at one end and bound at
    the other, both ends close the same new channel; with neither admitted,
    both ends close the same loser by key; no duty-capable channel is ever
    the one closed, at either end.
34. Duty creation (trace A14): an `appoint` on a non-duty-capable channel is
    dropped; on a duty-capable channel the duty exists at the acceptor on
    sending `accept` and at the offerer on receiving it; a lost `accept`
    expires at the acceptor after `D_ack` with `duty-orphaned`; a terminal
    `sub` from a non-duty-capable channel is queued and then dropped; a
    `revoke` older than a later `accept` by generation is ignored.
35. Class A mark: a negotiation that never opens produces
    `onNegotiationFailed` and a `loss` mark; the same channel produces no
    `onPeerLost`.
24. Draining and the stage (trace A2): 50 admitted, `cap_req` 50 → 40:
    `cap_eff` 50, DRAINING, `g_cap`+1; a stage in flight fails at commit on
    `g_cap`; `admit()` refuses `refused:draining`; a loss brings admitted to
    49, `cap_eff` 49; `cap_req` → 45: still DRAINING; → 55: ends, `cap_eff`
    55; `C_phys` follows `cap_eff` at each step.
25. Glare (traces A5, A6): both arrival orders; the smaller key wins at both
    ends; a duty-capable admitted channel wins regardless of key; the loser
    is closed by token; the peer record never changes its pointer to the
    loser; both channels count until each `closed(t)`.
26. Identify on an existing record (trace A7): an inbound identification for
    an identity that is PENDING, BOUND, ADMITTED or STAGED does not overwrite
    the record and resolves by glare.
27. Deadline and cancel totality (trace A3): after `deadline(t)` no peer
    points at a CLOSING channel, pending is released, `k` is consumed, a
    loss mark exists; a refused `cancel` consumes nothing and changes
    nothing; duplicates are no-ops.
28. `C_inbound` from allocation (trace A4): `C_inbound` inbound allocations
    with no frame yet; the next inbound offer is refused at signalling with
    no PeerConnection; `peer(PENDING)` is zero throughout.
29. Two-sided fence (trace A8): remote admits and sends `ready` and a backup
    appointment while this end is STAGED: appointment dropped
    `fence-drop-duty`; this end admits, sends `ready`, channel becomes
    duty-capable, the next appointment is accepted; `revoke` from either end
    clears it and runs handoff; a legacy peer is admitted and duty-capable by
    the old path with no `admit`/`ready` frames.
30. Orphan pass with duties (trace A9): a reload with a surviving transport
    holding a channel that carried a root's replication: the channel is
    closed as orphan; the role is LOST and enters the loss path; nothing is
    assumed discharged.
31. Epoch expiry (trace A10): a stage whose `E` ages past `V_obs` before
    commit aborts `swap-epoch-expired` with no table change.

## Appendix: transition traces

Notation. Counts as `[adm/pend/phys/in/stg/marks]`. Peer states as
`id:STATE(t)`. Frames as `→ frame` (sent) and `← frame` (received). Each
trace starts from the counts it names and checks the invariants after every
step. The traces are the tests; the numbers are the test's expected values.

**A1. Exhaustion, eviction and rotation.** `M_marks` 4, `B_latch` 2, `L_rot`
1 h, `M_policy` 8, `M_hw` 8. Start `[0/0/0/0/0/4]`, marks `{a,b,c,x}` all
`loss`, `x` exhausted, map holds `hw_x`. Policy rejection of `p`: `p` →
policy set; mark table full of loss marks, so oldest loss mark `x` is evicted
→ exhaustion latch bucket 0 gets `x`; map keeps `hw_x` (x is latched); marks
`{a,b,c,p}`; MARKS-FULL. Marks `a`, `b` expire with budget left: marks
`{c,p}`; MARKS-FULL lifts. `nominate(x)`: latch hit, refused `latch`.
Presence from `x` with ts ≤ `hw_x`: rejected on the map. Rotate twice: bucket
0 cleared; `nominate(x)`: proceeds, ONE attempt, new retry budget; `hw_x`
still in the map, so a replay is still rejected. `nominate(p)`: refused,
policy set, at every step including after rotation. Invariant: `p` is never
nominated; `x` is nominated exactly once per full rotation.

**A11. All-policy overflow and full rotation.** `M_marks` 4, `M_policy` 4.
Marks `{p1..p4}` all policy; policy set `{p1..p4}` full. Rejection of `p5`:
no mark written (`policy-direct`); policy set full → overflow filter gets
`p5`; `policy-overflow-count` 1. `nominate(p5)`: overflow hit, refused.
Rotate the exhaustion latch through every bucket (`B_latch × L_rot`):
`nominate(p5)` still refused; `nominate(p1)` still refused. MARKS-FULL lifts
when a policy mark is revoked by event: `p2` revoked → removed from set and
marks; `nominate(p2)` proceeds. Restart: everything empty, as today, stated.
Invariant: no policy identity is nominated before its revocation event.

**A12. Physical draining.** cap 50, `C_phys_req(50)` 63, `[48/2/60/1/0/3]`
with 10 channels in CLOSING. `cap_req` → 30: `cap_eff` 48 (DRAINING),
`C_phys_req(30)` 43, `C_phys_eff` = max(43, 60) = 60, PHYS-DRAINING. Inbound
offer: `allocate` refuses `refused:phys-draining`, no PeerConnection. Dial:
refused the same. Ten `closed(t)`: `chan(all)` 50, `C_phys_eff` 50, still
PHYS-DRAINING. Seven losses: admitted 41, `cap_eff` 41, `chan(all)` 43,
`C_phys_eff` 43 = `C_phys_req`, PHYS-DRAINING ends; allocation resumes;
DRAINING continues until admitted ≤ 30. Invariant: `chan(all) ≤ C_phys_eff`
at every step; nothing was closed to meet a number.

**A13. Glare, opposing local choices.** End A: `m:ADMITTED(t3)`,
duty-capable. End B: `m` is A; B has `t3` BOUND (A admitted, B refused on
lane). B dials A: forbidden by rule 1 (B holds a channel to A). Inject the
dial anyway (a legacy B): A receives `identify(t8, B)`; A has B ADMITTED on
`t3` → `→ mesh:refuse-dup(key(t3))` on `t8`, `close(t8, 'dup')`. B receives
`refuse-dup`: closes its `t8` by token, keeps `t3`. Both ends end with `t3`
only. Now the symmetric case: neither admitted, A `PENDING(t4)`, B
`PENDING(t5)`, keys `K5 < K4`: both compute the same loser `t4`; both close
`t4`; both re-point to `t5`. At no step does either end close a channel the
other end keeps.

**A14. Duty creation.** Channel `t` admitted at A, STAGED at B. A sends
`role:appoint` on `t`: at B the channel is not duty-capable → dropped,
`fence-drop-duty`, not queued. B admits: `→ mesh:ready`; both ends now
duty-capable. A resends `appoint`; B `→ role:accept`: duty exists at B now;
A receives it: duty exists at A. Lost-accept variant: B's `accept` is lost;
B holds a duty; no replication arrives inside `D_ack`; B reports
`duty-orphaned` and releases; A, never having received `accept`, holds
nothing. Terminal `sub` from B while `t` is routable at A but not
duty-capable: queued in `Q_sub`; `D_ack` passes with no `ready` from B:
dropped `fence-drop-sub`; with `ready` arriving first: handled, B is a served
subscriber. `revoke` with generation 3 arrives after an `accept` with
generation 4: the accept stands; a `revoke` with generation 5 clears it and
runs handoff.

**A2. Draining versus the stage.** cap 50, `[50/0/51/0/1/0]` with `c:STAGED
(t_c)`, `g_cap` 7, `E` frozen. `cap_req` → 40: `cap_eff` 50, DRAINING,
`g_cap` 8. `admit-staged(c, v)`: precondition 7 fails on `g_cap` 8 ≠ 7 and
on DRAINING → void; `c` stays STAGED; `[50/0/51/0/1/0]`. Stage TTL →
`cancel(c)`: `[50/0/51→50 on closed/0/0/0]`. Loss of `v2` (class B):
`[49/0/…/0/0/1]`, `cap_eff` 49, still DRAINING. `cap_req` → 45: `cap_eff`
49, DRAINING. `cap_req` → 55: `cap_eff` 55, not DRAINING, `g_cap` 10;
`admit()` of a BOUND peer now succeeds. `C_phys` at each step is computed
from `cap_eff` (50, 50, 49, 49, 55) and is never below `chan(all)`.

**A3. Deadline and cancel totality.** `[10/1/11/0/0/0]`, `q:PENDING(t9)`
NEGOTIATING, `k9` live. `deadline(t9)`: one step → `t9` CLOSING, pointer
cleared, `q:RESTING`, `[10/0/11/0/0/1]` (mark `q loss`), `end(q, k9, false)`
consumed, `→ close`. Second `deadline(t9)`: no-op. `closed(t9)`:
`[10/0/10/0/0/1]`. Invariant: no peer points at a CLOSING channel at any
instant. Cancel: `r:PENDING(t10)`; `cancel(r)` with `mayRetire` refusing
(injected): nothing changes, `k10` live; `cancel(r)` permitted: one step →
CLOSING, pointer cleared, RESTING, pending released, `k10` consumed, `→
close`. Duplicate `cancel(r)`: no-op.

**A4. `C_inbound` from allocation.** `C_inbound` 4. Four inbound offers:
four `allocate(in)` → `[0/0/4/4/0/0]`, all ALLOCATED, no frame, no peer
record. Fifth offer: `allocate` refuses; `→ signal:refused` with no
PeerConnection; `[0/0/4/4/0/0]`. `peer(PENDING)` is 0 throughout. One
`identify(t1, s)`: `s:PENDING(t1)`, `[0/1/4/3/0/0]` (t1 now bound-direction
counted out of `in`). Invariant: `chan(in, unbound) ≤ 4` at every step.

**A5. Glare, order one, duty-bearing winner.** `m:ADMITTED(t3)`, duty-capable
(both `ready` seen), carrying a root's replication. Inbound `identify(t8,
m)`: record not overwritten; `glare(t8, t3)`: `t3` is duty-capable → wins
regardless of key; `close(t8, 'glare')` → `t8` CLOSING; `m` still points at
`t3`; `[…/phys +1 until closed(t8)]`. No frame on `t3` changes; replication
continues. Invariant: a duty-capable channel is never the loser.

**A6. Glare, order two, key decides.** `n:PENDING(t4)` outbound, key `K4`.
Inbound `identify(t5, n)`, key `K5 < K4`: `glare(t5, t4)` → `t5` wins;
`close(t4, 'glare')`; `n`'s pointer moves to `t5` in the same step; pending
count unchanged (one attempt, re-pointed); `k4` consumed `end(n, k4, false)`
and a new `k5` begun. At the remote, the same keys give the same winner, so
both ends close `t4`'s pair. Invariant: both ends agree on the loser by key.

**A7. Identify on an existing record.** `s:STAGED(t6)`. Inbound
`identify(t7, s)`: record stays STAGED on `t6`; `t7` resolves by glare
(`t6` is not duty-capable, so key decides); if `t7` wins, the STAGED record
re-points to `t7` and the remote's `admit` must be re-received on `t7`
before commit; `E` is unchanged; if `t7` loses, `close(t7)`.

**A8. Two-sided fence.** Capable peers. Remote admits first: `← mesh:admit`,
`← mesh:ready`, `← backup-appoint` while this end is STAGED: appointment
dropped `fence-drop-duty`; `ready` recorded on `t`. This end `admit-staged`:
`→ mesh:ready`; channel duty-capable; next `← backup-appoint` accepted and
the role's contract now lists the peer. `← mesh:revoke`: duty-capable
cleared in one step; the backup role's handoff path runs; `routable` stays
true until `retire`. Legacy variant: handshake without `cap:fence`: bind →
admit; no `admit`/`ready` frames; duty-capable on admission; a
`backup-appoint` is accepted at once, as on 4.102.0.

**A9. Orphan pass with duties.** Reload with a surviving transport holding
`t2`, which carried this node's root replication to `b1`. Orphan pass:
`close(t2, 'orphan')`, never adopted. Pubsub on reload: every role LOST; the
root role for that topic enters the loss path (the step-down hold and
reconcile as today); no discharge is assumed; `[0/0/1→0/0/0/0]` after
`closed(t2)`.

**A10. Epoch expiry.** `stage(c)` at `T0` freezes `E` with oldest response at
`T0 − 50 s`, `V_obs` 60 s. Commit attempted at `T0 + 15 s`: oldest response
now 65 s old → `swap-epoch-expired`; no table change; `c` STAGED; next
decision recomputes `E`.

## What this design does not establish

As v0.3, and: that the latch's false-positive rate is acceptable on any
class before step 4 measures it; that the readiness exchange is complete
for obligation paths this trace set did not name, which is why every path is
listed and any path found later is a defect against this document.
SATURATED-COHORT BRIDGING stays an unresolved requirement.

## Parameters for David

As v0.3, plus:

| parameter | proposed | condition that changes it |
|---|---|---|
| `B_latch` / `L_bucket` / `L_rot` | 4 / 1024 cells / 1 h | `latch-fp-possible` at step 4; one re-attempt per lost peer every 4 h is the slow-retry contract |
| `M_policy` / overflow filter | 1024 exact / 4096 cells, never rotated | `policy-overflow-count` > 0 means `M_policy` is too small |
| `M_hw` | 2048 | map-overflow refusals at step 4 |
| `C_phys_req(cap)` | cap + `P_pending` + `S_overlap` + `C_inbound` + 4 | the open-channel-with-no-binding count at step 2 |
| `D_ack` / `Q_sub` | 10 s / 16 | `duty-orphaned` and `fence-drop-sub` counts at step 4 |
| `F_fp` | 1 % of nominations over 24 h | the same measurement |
| `cap:fence` | advertised by every capable kernel | the version that ships the fence; the invariant is claimed on no edge without it |

## Where the code stands

Nothing in this document is implemented. v0.1, v0.2 and v0.3 stand as record
at `4ad3741`, `769183f`, `0e05955`. Branch `graduation-collapse` (`8fead6d`)
stays unreleased. The first change is row 1, on its own branch, and comes to
council before anything else moves.
