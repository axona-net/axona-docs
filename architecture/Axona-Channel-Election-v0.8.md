# Channel election (v0.8, consolidated)

**Status:** consolidated normative candidate for council review, second
consolidation · **Date:** 2026-10-04 · **Kernel in production:** 4.102.0
(`270835d`) · **Policy set by:** David · **Author:** axona.bot ·
**Supersedes:** v0.7 (axona-docs `63c2dbe`) and v0.1–v0.6, all left in
place as record · **Driver:** Aster `df0a220c`, the full-text review of the
first consolidation, which found three mismatches the consolidation
introduced or exposed: session admission had regressed to the arrival
channel's pair; the loss transition was described and never executed as a
rule; and every duty-bearing channel had been moved outside `S`, when only
legacy and retired-session channels belong there. Decisions recorded at
`09158726`. Also Vega `148f72f0`, the source read of the first
consolidation: `bindPeer`'s rule does agree at both ends when both keys
are present and fails in two other cases; `onPeerBound` seeds on the first
bind, not after a duplicate close; a loss closes through `_retire` and
must not wait on the duty gate; `allocate()` sits before the session
record. And Orion `e4106f58`, concurring and verifying the parameters.

This file carries everything. Where any earlier version disagrees, this
text governs.

This document is a design. It changes no code. It is claimed on no legacy
edge. Deploy is David's.

---

## 1. The question

When two nodes hold more than one open channel to each other, how do both
ends choose the same one to keep, and how does either end know the other
has chosen it?

Two RTCPeerConnections between one pair arise when both dial at once, when
a replacement is dialed while the old channel is still closing, and when
one end's record of the pair is stale. Each is one object seen from two
ends, and the axona/4 handshake gives both ends the same authenticated
CHANNEL KEY for it. The kernel today resolves a duplicate inside
`webrtc.bindPeer` (`webrtc.js:229–247`): when both channel keys are
present it keeps the smaller and calls `mesh.disconnect` on the other
(`:246`, the only call of `mesh.disconnect` in the tree), and because the
key is the same at both ends (`:223–228`) both ends keep the same channel
in that case. Agreement fails in two other cases, and they are the defect
(Vega `148f72f0`): when either key is missing, `:233` keeps the EXISTING
binding, and the two ends' existing bindings need not be the same channel;
and when each end has bound only one channel, the duplicate branch has not
run at all, and the two sole channels need not match. No duty gate is on
the close in any case. `onPeerBound` seeds the synaptome on the FIRST bind
of an identity (`:255–257`), before any duplicate exists; a duplicate
returns at `:248` without seeding.

## 2. What this protocol is not

- NOT a leader election among many nodes.
- NOT a liveness guarantee for the pair.
- NOT an ordering of incarnations. A fresh handshake proves the handshake
  is fresh, not that its incarnation is recent or exclusive.
- NOT claimed on a legacy edge.
- NOT a fence against a process running elsewhere. Retirement is local.

## 3. Definitions

| term | meaning |
|---|---|
| `K(t)` | the authenticated channel key of channel `t`; identical at both ends; §11 adapter contract. |
| `inc` | per-process incarnation, random 64-bit, carried in the handshake; equality only. |
| pair | the unordered authenticated incarnation pair of a handshake. LOCALLY it is stored as `(inc_self, inc_peer)`; ON THE WIRE a frame carries `(inc_sender, inc_receiver)`; the receiver NORMALIZES a received tuple to `(inc_self, inc_peer)` by its own role before any comparison. |
| channel state | OPEN (axona/4 bound, data channel open), CLOSING (close issued, not confirmed), GONE (confirmed). |
| session record | one of CURRENT (≤ 1), UNRETIRED, RETIRED per peer identity; §6. |
| `S_A` | the set of keys of channels in state OPEN whose pair is CURRENT. Duty-bearing or not. Channels of unretired or retired pairs are never in `S`. |
| `r_A` | STATE VERSION per CURRENT pair: incremented on every change to `(S_A, g_A, d_A)` and on nothing else; names one exact state. `r_A⁻`/`r_A⁺`: before and after a decision event. |
| `n_A` | ENVELOPE per CURRENT pair: incremented on every proposal sent. |
| `g_A` | GENERATION: incremented only when a set decision is cleared by loss of its channel. |
| `d_A` | DECISION: a key or `none`, bound to `g_A`. |
| `q` | REQUEST FLAG: set when the sender is `unacked` and re-sending. |
| `ack_A` | `r_B` of the latest processed proposal from B, or `∅`. |
| `ans_A` | the largest `n_B` of a request A has answered. |
| `owed_A` | A's latest sent `ack ≠ r_B`. `unacked_A`: B's latest processed `ack ≠ r_A`. |
| retained-duty record | `(t, source, release evidence)` for a LEGACY-resolved or RETIRED-SESSION channel kept open for a duty; §7. A current-pair channel with a duty is NOT in this record; it is in `S` and protected by the gate. |

FIRST-SESSION INITIALIZATION. When a pair first becomes CURRENT (creation
with no current pair, or promotion), its election state is `r := 0`,
`n := 0`, `g := 0`, `d := none`, `ack := ∅`, `ans := 0`, `S :=` that pair's
OPEN channels; the first proposal is sent at once.

## 4. Wire schema

```
elect:propose {
  pair: (inc_sender, inc_receiver)
  n, q, r, g
  S:   sorted channel keys
  d:   channel key or none
  ack: r of the peer's latest processed proposal, or ∅
}
```

One frame type, sent on every channel in `S`.

## 5. Processing, the send rule, the rule, admission

### 5.1 Processing a received proposal, in order

1. NORMALIZE the frame's pair to `(inc_self, inc_peer)`.
2. CHANNEL: the normalized pair equals the authenticated pair bound on
   the arrival channel; else discard, report `elect-pair-mismatch`.
3. CURRENT: that pair equals CURRENT; else discard. A frame on a retained
   old channel, or on an unretired pair's channel while ambiguous, fails
   here and touches nothing below.
4. ENVELOPE: `n` greater than the last processed `n` from this peer; else
   discard (late or duplicate; triggers nothing).
5. STATE: `r` greater than the last applied: apply `(r, g, S, d)`. `r`
   equal: `(g, S, d)` must equal the applied state, else discard and
   report `elect-malformed`; read `ack` and `q` only. `r` lower in a
   higher `n`: discard, report `elect-malformed`.
6. GENERATION: `g` greater than this end's: adopt it; if this end's
   decided channel is absent from the received `S`, clear `d`.
7. Record `ack`; evaluate §5.4 conflict, §5.4 admission, §5.2 send.

### 5.2 The send rule

| trigger | condition | `q` |
|---|---|---|
| state change | `r_A` changed | 0 |
| owed | `owed_A` | 0 |
| retry | `unacked_A` and `E_repropose` since A's last send | 1 |
| answer | a processed frame had `q = 1` and `n_B > ans_A`; set `ans_A := n_B` | 0 |

Nothing else sends. One send covers several triggers. QUIESCENT:
`owed_A` false, `unacked_A` false, `d_A = d_B ≠ none`; the first three
triggers are false there by definition; the answer trigger still fires,
once per request `n`. This gives per-request bounded answering and
conditional convergence under eventual delivery; it is not a traffic
bound.

### 5.3 Local channel transitions, as rules

| event | effect |
|---|---|
| a channel of the CURRENT pair becomes OPEN | its key enters `S`; `r++`; send |
| a channel of the CURRENT pair enters CLOSING (loss, timeout, or an election close) | its key leaves `S`; `r++`; if it was the decided channel: `d := none`, `g++`; send |
| a channel reaches GONE | nothing further for `S` (it left at CLOSING); counted for exhaustion (§6) |
| a channel of an UNRETIRED or RETIRED pair changes state | no effect on `S`, `r`, `g`, `d`; counted for that pair's exhaustion (§6) |

EXACT-ON-CHANGE. `r` increments only on an actual change to `(S, g, d)`.
Re-evaluating admission when `d` already equals the winner changes
nothing and bumps nothing; a decision is set once per generation.

### 5.4 The rule, conflict, admission

```
I = S_A ∩ S_B
winner(A) = d_B      if d_B ≠ none and d_B ∈ I
          = d_A      if d_A ≠ none and d_A ∈ I
          = min(I)   if I ≠ ∅
          = none     otherwise
```

CONFLICT: `d_A ≠ none`, `d_B ≠ none`, `d_A ≠ d_B`, both in `I`: report
`elect-conflict`; close by token, through the duty gate, the one of the
two channels that carries no duty; if both carry duties, close neither
and report `elect-conflict-blocked: duty`; `g` unchanged. A defect against
§9; this is the recovery.

ADMISSION. A may admit the channel with key `winner(A)` only when all of:

1. `I ≠ ∅` and `winner(A) ≠ none`.
2. `ack_B = r_A` (A's current version, which at admission is `r_A⁻`).
3. A's latest sent proposal carried `ack = r_B`.
4. `g_B = g_A`.
5. `d_B = none` or `d_B = winner(A)`.
6. The channel with key `winner(A)` is OPEN at A now.
7. The identity is not AMBIGUOUS (§6).
8. `d_A = none` (exact-on-change: an end that has already decided does
   not re-admit).

On admission: `d_A := winner(A)` (creating `r_A⁺`), store the EVIDENCE
`(pair, r_A⁻, g_A, S_A, d_A, P_B)`, send. Every other channel in `S_A` is
closed by token through the duty gate once it is in `S_B` too, or after
`E_elect`. A duty on a losing channel blocks its close and is reported;
the pair then runs two channels until the lease releases it.

## 6. Sessions: records, capacity, ambiguity, exhaustion, promotion

Per peer identity: CURRENT (at most one record), UNRETIRED, RETIRED; one
capacity `L_sessrec` over their sum.

ON A BIND with normalized pair `p`, in order:

1. Hold-and-Fill's physical bound `C_phys` and inbound bound apply first.
   In the kernel's order the PeerConnection is constructed in
   `mesh._attachPc` (`mesh.js:770–773`), the handshake runs, then
   `bindPeer`. If `C_phys` is a HARD bound on physical PeerConnections,
   its reservation must precede construction in `_attachPc`; a check after
   construction can reject the excess but cannot prevent the transient
   allocation (Aster `e62bcfb3`). Hold-and-Fill's `allocate()` is proposed,
   not in this source; the integration contract it must meet, mapped and
   not yet supplied: every outbound, inbound and retry constructor;
   reserve-then-rollback on failure; provisional capacity for a channel
   whose identity is not yet known. The session record is created only
   for a channel that holds a reservation.
2. `p ∈ RETIRED`: refuse `elect-retired`; close by token through the
   gate; no record.
3. `p = CURRENT`: the channel is a current-pair channel (§5.3 OPEN row
   applies when it opens); no record.
4. `p ∈ UNRETIRED`: the channel joins that pair's channel set, not `S`;
   no record.
5. Else, if the sum equals `L_sessrec`: refuse `elect-session-limit`;
   close by token; no record. Otherwise create the record: in CURRENT if
   no current pair exists and UNRETIRED is empty (then FIRST-SESSION
   INITIALIZATION, §3); else in UNRETIRED.

AMBIGUITY holds while CURRENT exists and UNRETIRED is non-empty, or while
UNRETIRED has more than one pair and CURRENT is empty. While ambiguous: no
admission on any channel of the identity (condition 7); all channels kept
under the duty gate; `elect-ambiguous-identity` reported.

EXHAUSTION of any tracked pair, current or unretired: every channel of
that pair GONE at this end. The record moves to RETIRED (a move; no
capacity needed). Exhaustion is a local failure-detector observation: this
end can no longer reach those channels. It proves neither that the old
process died nor that it surrendered anything; retirement fences nothing
elsewhere.

AFTER EVERY EXHAUSTION, of any pair, the PROMOTION PREDICATE is
evaluated: `CURRENT = ∅ AND |UNRETIRED| = 1`. When it holds, the one
unretired pair is promoted: its record moves to CURRENT; FIRST-SESSION
INITIALIZATION (§3) runs for it; retained-duty records are not session
state and carry over. Ambiguity clears when UNRETIRED empties with CURRENT
intact (CURRENT, `S` and its election state unchanged) or when the
predicate promotes.

NO TIMED FORGETTING. RETIRED is kept for the life of the process. The only
forgetting is process restart, which forgets everything; the new
incarnation starts with no records. Succession on recovery and fencing of
a still-running predecessor are the adapter's (§11).

THE TRADEOFF, named: at `L_sessrec` an end refuses legitimate new
incarnations of that identity for the life of the process; a
same-incarnation peer that was partitioned away and exhausted here is
permanently refused at this observer until restart. Both are chosen over
forgetting a retired pair, because a forgotten pair is a replay hole.

## 7. Retained duties

Two populations, kept apart:

- A CURRENT-pair channel that carries a duty is in `S`, takes part in the
  election, carries election frames, and is PROTECTED by the duty gate:
  no election close (loser, conflict, limit) closes it while the duty
  exists. The gate protects; it never removes from `S`.
- A LEGACY-resolved channel (resolved by `bindPeer`'s rule on a legacy
  edge) or a RETIRED-SESSION channel that carries a duty is in the
  RETAINED-DUTY record, outside `S`, never an election participant,
  never closed by the election, released only by: for a lease duty, the
  lease document's discharge evidence; for a legacy duty, the kernel's
  own role-state change (a later `REPLICATE`, `unhost`, `rootClaim.demote`)
  AND no lease naming it, those being facts about today's kernel and not
  proof of custody transfer.

Trace T19: the first duty attaches to the sole elected current channel;
frames keep travelling on it; its later loss runs §5.3's CLOSING row and
the lease document's loss path.

## 8. Timeouts and their actions

| timer | fires when | action |
|---|---|---|
| `E_bind` | a channel OPEN here whose peer has not completed the handshake | close by token, `bind-timeout` (§5.3 CLOSING row if current) |
| `E_elect` | `I = ∅` for `E_elect` after a proposal | keep the minimum local key, close the others by token through the gate, re-propose; after a second `E_elect`, `elect-stalled` |
| `E_repropose` | `unacked` and no send since | retry trigger |
| kernel deadlines | `NEGOTIATION_DEADLINE_MS`, pong timeout | channel → CLOSING → GONE; §5.3; may cause exhaustion |

No timer forgets a retired pair.

## 9. Reviewed argument and its assumptions

ASSUMPTIONS: the adapter contract (§11, same key at both ends); §5.1's
processing order; `r` exact-on-change (§5.3) so `r` names one state (I1);
a decision never regresses within a generation (I2); condition 4 pins one
generation; §5.1 steps 2–3 ensure every processed frame is of the CURRENT
pair at both ends.

THEOREM. Within one current pair and one generation, if A admits `a` and
B admits `b`, then `a = b`.

PROOF. Events: `set_X` is X's admission; `env_X(n)` the send of envelope
`n`; `rcv_Y(n)` its processing at Y; `≺` is program order at each end plus
`env_X(n) ≺ rcv_Y(n)`, transitively. Let `P_B = env_B(n_b)` be the proposal
A relied on, with version `r_B(P_B)`; `P_A = env_A(n_a)` the one B relied
on, with `r_A(P_A)`. Condition 2 at A: `P_B.ack = r_A⁻`, so some `m` of A
carrying `r_A⁻` has `rcv_B(m) ≺ env_B(n_b)`. Condition 2 at B: `P_A.ack =
r_B⁻`, so some `m'` of B carrying `r_B⁻` has `rcv_A(m') ≺ env_A(n_a)`.

Case E: `r_B(P_B) ≥ r_B⁺` or `r_A(P_A) ≥ r_A⁺`. By I2 the relied-on frame
carries the decision; by I1 the relier applied it; `winner` returns it by
its first line; condition 5 forbids any other. `a = b`.

Case O=: `r_B(P_B) = r_B⁻` and `r_A(P_A) = r_A⁻`. Both computed `min` over
`(S_A(r_A⁻), S_B(r_B⁻))` by I1, both decisions `none`. `a = b`.

Case O<: say `r_B(P_B) < r_B⁻`. Then `env_B(n_b) ≺ e_B` where `e_B` created
`r_B⁻`. From condition 2 at A, `rcv_B(m) ≺ env_B(n_b) ≺ e_B` and `e_A⁻ ≺
env_A(m)`, so `e_A⁻ ≺ e_B`. From condition 2 at B, `e_B ≺ env_B(m') ≺
rcv_A(m') ≺ env_A(n_a)`. If `r_A(P_A) < r_A⁻` then `env_A(n_a) ≺ e_A⁻`,
giving `e_A⁻ ≺ e_B ≺ env_A(n_a) ≺ e_A⁻`, a cycle; impossible. So `r_A(P_A)
= r_A⁻`. Then A processed `m'` (carrying `r_B⁻`, `n(m') > n_b`) before
`env_A(n_a)`; A's admission used `P_B` with `r_B(P_B) < r_B⁻`, so `P_B` was
A's latest from B at admission only if `set_A ≺ rcv_A(m')`; in that order
`env_A(n_a)` is after `set_A` and by I2 carries `r ≥ r_A⁺ > r_A⁻`,
contradicting `r_A(P_A) = r_A⁻`. By symmetry the other strict case is
impossible. ∎

No step infers receipt from sending. The theorem is about the model; it
is not verification of an implementation or of the adapter.

## 10. Integration with Hold-and-Fill

- On a CAPABLE edge, `webrtc.bindPeer` records the key and hands the
  channel to this election instead of closing (`:229–247`); the FIRST-BIND
  seeding in `onPeerBound` (`:255–257`) seeds the synaptome only with
  election evidence, which is the change at that site; and the election's
  VOLUNTARY closes (loser, conflict, retired, limit) go through `close(t,
  reason)` under the duty gate, which is the one place `mesh.disconnect`
  is called for a duplicate. Those three are the kernel touch points for a
  second chooser. INVOLUNTARY loss is not one of them: `mesh._retire`
  (pong-timeout, never-opened negotiation; classes A and B) closes dc and
  pc without `mesh.disconnect` and does not consult the duty gate, because
  a dead channel must not wait on a lease; it reaches this document only
  as §5.3's CLOSING row. "Any other duplicate close is a defect" means a
  second chooser, not a loss (Vega `148f72f0`).
- `admit()` requires election evidence whose acknowledged version is
  `r_A⁻` in the current generation; `admit-staged` revalidates `(pair,
  r_B, g_B)` at commit and aborts on a change.
- A bind is a channel first: `allocate()` runs before §6.
- Current-pair duty channels are in `S` and in `C_phys`; retained-duty
  channels are outside `S` and in `C_phys`; neither is a swap victim.

## 11. Open adapter prerequisites

Required, not supplied: (1) the channel key, identical at both ends,
bound to both identities and the nonce pair; (2) handshake freshness,
nonces bound to the live connection; (3) succession evidence, which would
retire a superseded pair at once; (4) one live process per identity, or an
ordering of concurrent incarnations; (5) fencing elsewhere; (6) recovery
after restart. Until each exists and is reviewed, the behaviour that
depends on it is UNAVAILABLE: succession-based retirement (3);
disambiguation of concurrent processes (4); any global fence (5); any
claim across a restart (6).

## 12. Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `E_bind` | 30 s | the measured handshake-completion spread |
| `E_elect` | 20 s | a healthy slow link reported stalled |
| `E_repropose` | 5 s | a cost knob only |
| `L_sessrec` | 16 per peer identity | a `elect-session-limit` report is its own finding; the refusal is §6's tradeoff |
| `cap:elect` | advertised by every capable kernel | the version that ships this |

## 13a. Appendix: reviewed traces

Notation: `A:[S, r, g, d]`; `A→B: P{n, q, r, g, S, d, ack}`.

**T0. One end decided, the other not.** After mutual ack on `{x}`:
`A:[{x},1,0,none]`, `B:[{x},1,0,none]`. A admits `x`: `A:[{x},2,0,x]`,
`A→B: P{3,0,2,0,{x},x,1}` delayed. `y` binds OPEN at both (§5.3 OPEN row):
`A:[{x,y},3,0,x]`, `B:[{x,y},2,0,none]`. `A→B: P{4,0,3,0,{x,y},x,1}`; `B→A:
P{3,0,2,0,{x,y},none,1}`. B processes A's `r=3`: `winner = x`; owed → `B→A:
P{4,0,2,0,{x,y},none,3}`. A: owed → `A→B: P{5,0,3,0,{x,y},x,2}`. B:
conditions 1–8 hold with `winner = x`; admits; `B:[{x,y},3,0,x]`; `B→A:
P{5,0,3,0,{x,y},x,3}`; closes `y` by token (§5.3 CLOSING row: `S={x}`,
`r=4`, `d` unchanged since `y` was not decided). A: quiescent; closes `y`
likewise. Delayed `n=3` at B: lower `n` → discarded.

**T1. Simultaneous opens.** Each binds its own first, proposes `{own}`;
neither admits until both sets are `{x,y}` and mutually acked; `min(x,y)`
at both by O=; quiescent.

**T9, T10, T13.** The three-frame handshake; one lost final ack repaired
by one request and one answer; crossed requests, two answers, silence.

**T2. Third channel after election.** `z` binds; carried decision keeps
`x`; both close `z` through the gate.

**T3. Loss of the decided channel, as §5.3 executes it.** `x` (decided)
enters CLOSING at A: `S_A = {}`, `r++`, `d := none`, `g := 1`, send (on no
channel, until a re-dial opens `w`: OPEN row, `S = {w}`, `r++`, send
`P{…, g=1, {w}, none, …}`). B sees `x` die: same row; `w` binds at B;
processes A's `g=1`: step 6 adopts; `I = {w}`; mutual ack; both admit `w`
by O=; quiescent.

**T16. Retired pair binds after a long delay.** `elect-retired`; refused;
nothing forgotten.

## 13b. Appendix: unexecuted adversarial scenarios

Expected outcomes to become tests; not evidence.

**T4** local OPEN, remote incomplete: `E_bind`. **T7** quiescence: zero
frames in an hour. **T8** injected conflict: the duty-free channel closed
through the gate, or neither. **T11** ack-only out of order: by `n`.
**T12** delayed redundant request: lower `n` ignored, new `n` answered once.
**T14** lost answer: new request, one answer. **T18** malformed: equal `r`
different `S`, lower `r` in higher `n`: discarded, reported.

**T15. Old bind after a new session, with a retained duty.** `(a1, b1)`
current; `x` under it carries a backup replica and is IN `S` (a current-
pair duty channel, §7 first population). `b2` binds `y`: UNRETIRED;
ambiguous; no admission. `b1`'s channels all GONE: exhaustion; `(a1, b1)`
→ RETIRED; `x` is now a retired-session channel: it leaves `S` by the
CLOSING row when it closed, and if it is still OPEN at retirement it moves
to the retained-duty record (§7 second population); promotion predicate:
`CURRENT = ∅ AND |UNRETIRED| = 1` → `(a1, b2)` promoted; initialization;
election on `{y}`. A late `(a1, b1)` bind: `elect-retired`. Variant `b3`
while `b2` live: ambiguous until one is exhausted or §11 (3).

**T17. Session-record saturation.** As v0.7: four tracked, a fifth
refused; exhaustions move records without freeing capacity; still refused
after promotion; §6's tradeoff.

**T19. First duty on the sole elected channel, then loss.** `x` elected and
alone in `S`; a backup lease attaches to `x`: `x` stays in `S`, frames
travel on it, the gate protects it from any election close. `x` is lost:
CLOSING row (`S = {}`, `r++`, `d := none`, `g++`), the lease document's
loss path for the duty, re-dial, fresh election.

**T20. Old retained-channel traffic during a new session.** A frame from
`b1` arrives on retained channel `x` after `(a1, b2)` is current: step 2
passes (the frame's pair is `x`'s pair), step 3 fails (not CURRENT):
discarded; `n`, state, acks untouched.

**T21. Unretired-channel traffic while ambiguous.** `(a1, b2)` current,
`(a1, b3)` unretired; a frame on `b3`'s channel: step 3 fails; discarded.
A frame on `b2`'s channel: processed, but condition 7 forbids admission.

**T22. Pair normalization.** A receives `(inc_B, inc_A)` from B;
normalizes to `(inc_A, inc_B)`; compares with the channel's `(inc_A,
inc_B)`; equal; proceeds. A frame carrying a tuple that normalizes to a
different pair than the channel's: step 2 fails, `elect-pair-mismatch`.
