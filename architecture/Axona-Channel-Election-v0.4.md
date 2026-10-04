# Channel election (v0.4)

**Status:** design for council review, revision 4 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.3 (axona-docs `a415b02`), v0.2
(`3c31d9d`), v0.1 (`b923e54`), all left in place as record · **Revision
driver (v0.4):** Aster `c80d1ca1`, decisions recorded at `f23917f7`. The
v0.3 errors: the proof's case 1 used one `r_A` for two versions, the one
condition 2 acknowledged (pre-decision) and the one admission created
(post-decision), and case 2 asserted set equality from an unrelated
acknowledgement; retransmission repair could fire on a delayed repeat after
both ends were quiescent, which the quiescence rule forbade, and its "once"
had no remembered key; a session was treated as new because it differed
from the current one, which lets a delayed old bind masquerade as fresh; and
T5 kept a legacy channel in `S_A` after the session rule had removed it.

Then Aster `172cb805`, before this file froze: "cannot establish a session
because its channel is GONE" was not established, since retained-duty
channels stay open and an old handshake can complete late; the session
rule here is a retired-pair set that refuses a retired incarnation pair
whatever its channel's state, with concurrent live processes on one
identity recorded as an open adapter prerequisite; and the kernel's role-
path cleanup is kept factual, apart from discharge under the lease contract.

**What changed from v0.3:** the proof is a causal-cycle argument over
envelope events with the two decision versions named; a REQUEST flag and a
remembered per-peer request counter make the repair rule executable and
bounded, and quiescence forbids only spontaneous sends; session
establishment requires a fresh authenticated handshake under the adapter
contract, with retirement and replay bounds; old-duty retention is a record
separate from election membership; T5 corrected; T12–T14 added. *The
question*, *What this protocol is not*, the adapter contract, the timeouts,
*Loss, generations, later channels* and the kernel touch points stand as
v0.3 wrote them.

This document is a design. It changes no code. Deploy is David's.

---

## Definitions

As v0.3, with these changes and additions:

- STATE VERSION `r_A` and ENVELOPE `n_A` as v0.3. When a decision is set at
  A, the state version BEFORE that event is `r_A⁻` and the one it creates is
  `r_A⁺ = r_A⁻ + 1`. Condition 2 at A's admission acknowledges `r_A⁻`; every
  proposal A sends after admission carries `r ≥ r_A⁺` and `d_A`.
- REQUEST FLAG `q`: a boolean on the frame, set by a sender that is
  re-sending because it is `unacked`. A frame with `q` set is a REQUEST.
- `ans_A`: the largest `n_B` of a request A has answered, per peer and
  session. Reset to 0 on session transition.
- SESSION `σ` and its establishment: under *Sessions*.

## The frame and the one send rule

```
elect:propose { σ, n, q, r, g, S, d, ack }
```

PROCESSING as v0.3: by increasing `n`; state applied by increasing `r`;
equal `r` with different `(g, S, d)` is malformed; equal `r` reads only
`ack`.

THE SEND RULE, the only one. A sends a proposal when, after processing a
frame or on a local change, any of these holds, and sets `q` as stated:

| trigger | condition | `q` |
|---|---|---|
| state change | `r_A` changed | 0 |
| owed | A's latest sent `ack ≠ r_B` | 0 |
| retry | `unacked_A` and `E_repropose` elapsed since A's last send | 1 |
| answer | a frame with `q = 1` and `n_B > ans_A` was processed; set `ans_A := n_B` | 0 |

Nothing else sends. QUIESCENT as v0.3 (`owed_A` false, `unacked_A` false,
decisions agree) forbids the first three triggers' spontaneous firing (they
are false by definition in quiescence) and does not forbid the fourth: a
quiescent end still answers a request, once per request `n`. That is the
whole repair mechanism and it replaces v0.3's content-comparison rule.

Boundedness. Each request `n` is answered at most once by `ans_A`. A delayed
redundant request with `n_B ≤ ans_A` is ignored. A crossed pair of requests
(both ends `unacked`, both set `q`) yields one answer each, and each answer
carries the ack that makes the other end's `unacked` false. A lost answer
leaves the requester `unacked`; it sends a new request after `E_repropose`
with a new `n`, which is answered once. So each lost frame costs at most one
request and one answer, and an answer never provokes an answer because an
answer has `q = 0`. Traces T10 (lost final ack), T12 (delayed redundant
request after quiescence), T13 (crossed requests), T14 (lost answer).

## The rule and admission

As v0.3, with condition 2 read against `r_A⁻` at the moment of admission:
B's latest processed proposal acknowledges A's current state version, which
is `r_A⁻` because admission is the event that creates `r_A⁺`.

## Why both ends pick the same channel: a causal cycle

Event notation. For an end X: `set_X` is the admission event at X, creating
`r_X⁺` and `d_X`. `env_X(n)` is the send of envelope `n` by X; `rcv_Y(n)` its
processing at Y; `rcv_Y(n) → ` happens after `env_X(n)`. Every frame's `r`
is X's state version at `env_X(n)`. Happens-before `≺` is the transitive
closure of program order at each end and `env_X(n) ≺ rcv_Y(n)`.

Invariants (local, as v0.3): I1, state identity: within a session `r_X`
names one exact `(S_X, g_X, d_X)`. I2, decision lock: every envelope X sends
after `set_X` carries `d_X` and `r ≥ r_X⁺`.

Theorem. Within one session and generation, if A admits `a` and B admits
`b`, then `a = b`.

Proof. Let `P_B = env_B(n_b)` be the proposal A's admission relied on, with
state version `r_B(P_B)`, and `P_A = env_A(n_a)` the one B's relied on, with
`r_A(P_A)`. Condition 2 at A: `P_B.ack = r_A⁻`, so `rcv_B(m) ≺ env_B(n_b)`
for some envelope `m` of A carrying `r_A⁻`. Condition 2 at B: `P_A.ack =
r_B⁻`, so `rcv_A(m') ≺ env_A(n_a)` for some `m'` of B carrying `r_B⁻`.

Case E (either relied-on state is post-decision). If `r_B(P_B) ≥ r_B⁺`, then
by I2 `P_B` carries `d_B = b`; A applied it (I1); `winner(A)` returns `b` by
its first line and condition 5 forbids any other: `a = b`. Symmetric if
`r_A(P_A) ≥ r_A⁺`.

Case O (both relied-on states are pre-decision): `r_B(P_B) ≤ r_B⁻` and
`r_A(P_A) ≤ r_A⁻`. Sub-case O= (both equal): `r_B(P_B) = r_B⁻` and `r_A(P_A)
= r_A⁻`. Then A computed `min(S_A(r_A⁻) ∩ S_B(r_B⁻))` and B computed
`min(S_A(r_A⁻) ∩ S_B(r_B⁻))`, the same pair of states by I1, both decisions
`none`: `a = b`.

Sub-case O< (at least one strictly older): say `r_B(P_B) < r_B⁻`. Then
`env_B(n_b)` precedes the event at B that created `r_B⁻`, call it `e_B`;
`env_B(n_b) ≺ e_B`. By condition 2 at A, `P_B` acknowledges `r_A⁻`, so
`rcv_B(m) ≺ env_B(n_b)` where `m` carries `r_A⁻`; so `rcv_B(m) ≺ e_B`, and
in particular the state `r_A⁻` existed before `e_B`: `e_A⁻ ≺ env_A(m) ≺
rcv_B(m) ≺ e_B`, where `e_A⁻` created `r_A⁻`. Now B's admission relied on
`P_A` with `r_A(P_A) ≤ r_A⁻` and `P_A.ack = r_B⁻`, so `e_B ≺ env_B(m') ≺
rcv_A(m') ≺ env_A(n_a)`. If `r_A(P_A) < r_A⁻`, then `env_A(n_a) ≺ e_A⁻`
(the envelope carried a state older than `r_A⁻`), giving `e_A⁻ ≺ e_B ≺
env_A(n_a) ≺ e_A⁻`, a cycle in `≺`, impossible. So `r_A(P_A) = r_A⁻`: B
relied on A's exact pre-decision state and acknowledged `r_B⁻`. Then
`env_A(n_a)` was sent after `rcv_A(m')` with `m'` carrying `r_B⁻`; A's
admission used `P_B` with `r_B(P_B) < r_B⁻`, but by the time of A's
admission A had processed `m'` carrying `r_B⁻` and `n(m') > n_b` (both
from B, and `m'` carries the later state); A's latest processed proposal
from B at admission is therefore `m'`, not `P_B`, contradicting the choice
of `P_B` as the proposal A's admission relied on, unless `set_A ≺ rcv_A(m')`.
In that last order, `env_A(n_a)` is after `set_A` and by I2 carries `d_A =
a` with `r ≥ r_A⁺ > r_A⁻`, contradicting `r_A(P_A) = r_A⁻`. So sub-case O<
cannot occur with `r_B(P_B) < r_B⁻`; by symmetry it cannot occur with
`r_A(P_A) < r_A⁻`. ∎

What the proof uses: I1, I2, condition 4 (one generation), per-sender
monotone `n` and `r` with the "latest processed" rule, the adapter contract,
and session equality on every processed frame. Each step names an envelope
event and its receipt; no step infers receipt from sending.

## Sessions

The session `σ` is the `(inc_A, inc_B)` pair bound by an axona/4 handshake.
A fresh authenticated handshake proves that THAT HANDSHAKE is fresh: its
nonces are bound to that live connection and cannot be replayed onto
another, under the adapter contract. It does not prove that the incarnation
it carries is the most recent one for the identity, and it does not prove
that only one live process holds the identity (Aster `172cb805`). The
election therefore does not order incarnations. It keeps a set.

THE RETIRED-PAIR SET. Per peer identity, each end keeps the incarnation
pairs it has retired, each for `T_session`, in a bounded set of `L_sess`
entries. ESTABLISHMENT: a bind whose pair is NOT in the retired set and is
not the current session becomes the current session, and the previous
current session's pair is added to the retired set at that instant.
REFUSAL: a bind whose pair IS in the retired set is refused with
`elect-retired`, whatever the state of the connection it arrived on, and
whether it completed before or after the current session was selected.
This is what v0.3's "its channel is GONE" claimed and did not have: an
old-incarnation handshake that completes late is rejected by the set, not
by any property of its channel. Retired-session channels that are already
OPEN and carry duties stay in the retained-duty record and discard any
election frame by session mismatch. OVERFLOW: at `L_sess` the end refuses
every new session for that identity with `elect-session-limit` and reports;
nothing is forgotten into permission. Trace T15.

What the set does not settle, recorded OPEN as an ADAPTER PREREQUISITE: two
live processes holding one durable identity at once (two incarnations of
the same nodeId, neither retired). The election cannot order them. Until
the adapter either guarantees one live process per identity or supplies an
ordering, an end that sees two unretired pairs for one identity admits on
neither, reports `elect-ambiguous-identity`, and keeps both channels open
under the duty gate. Equating handshake freshness with incarnation order is
withdrawn.

## Old-duty retention, separate from membership

A channel that carries a duty under the kernel's existing role path (a
legacy-resolved channel, or a retired-session channel) is held in a
RETAINED-DUTY record: `(t, duty source, release evidence)`. It is not in
`S`. The election never closes it. Two kinds of duty source, kept apart:

- A duty under a LEASE (the Duty Leases document): released only by that
  document's discharge evidence, an attested receipt or an explicit
  discharge, never by a role-state change alone.
- A LEGACY duty under the kernel's existing role path (a `REPLICATE`
  receiver, a `peer.host()`, a root): the kernel today changes that role
  state on a later `REPLICATE`, on `unhost`, or on demotion
  (`rootClaim.demote`). Those events are what EXISTS and are named as
  facts; this document does not call them proof of custody transfer or of
  downstream discharge, because they are not. A legacy-duty channel is
  released from the record when the kernel's role state for it is gone AND
  no lease names it; what that release means for the data it carried is
  whatever it means today, which this document does not improve.

The source mapping stays factual; the receipt and retention requirement is
the lease document's and is not read into the kernel's cleanup.

## Integration with Hold-and-Fill

As v0.3, plus: `admit()` requires election evidence whose `r_B` is the
version condition 2 acknowledged; retained-duty channels are counted in
`C_phys` and are never victims of a swap.

## What this design does not establish

As v0.3, and: that the adapter supplies handshake freshness; that a
retained-duty channel is ever released, which is the role path's clock.

## Parameters for David

As v0.3, plus `T_session` 2 × `E_bind` (long enough for every old-session
channel to pass its deadline) and `L_sess` 8 retired pairs per peer identity
(a `elect-session-limit` report at step 4 means a peer is restarting faster
than `T_session` clears, which is its own finding).

## Appendix: traces

T0, T1, T2, T3, T4, T6, T7, T8, T9, T11 as v0.3, re-read against the one
send rule (T9's frame count is unchanged: three for the handshake, seven
from scratch).

**T5. Legacy duty, then upgrade.** B is legacy; channel `x` was resolved by
`bindPeer`'s rule and carries a backup replica (B is a `REPLICATE`
receiver). `x` is in A's RETAINED-DUTY record, not in `S_A`. B restarts
capable and dials `y`: a fresh handshake establishes session `σ'`;
`S_A = {y}`; the election runs on `{y}` alone and elects `y`. `x` stays open
until a later `REPLICATE` supersedes B's replica or the root demotes B's
role, at which point the record releases and `x` closes through the gate.

**T10. One lost final ack.** From T9, A's last frame (`ack r2`) is lost. B
is `unacked`; after `E_repropose` B sends `P{n5, q=1, r2, …, ack r2}`. A
processes: `q = 1`, `n5 > ans_A` → `ans_A := 5`, A answers `P{n5, q=0, r2,
x, ack r2}`. B processes: `unacked_B` false; quiescent. A quiescent. One
request, one answer.

**T12. Delayed redundant request after quiescence.** From T10's quiescent
end state, B's earlier request `n5` is delivered again by a slow path (new
arrival, same `n`): `n5 ≤ last processed n` at A → not processed at all. A
new redundant request `P{n6, q=1, …}` from B, one B sent before
receiving A's answer: `n6 > ans_A` → answered once, `ans_A := 6`; B, already
quiescent, processes the answer (nothing owed, nothing unacked): silence.

**T13. Crossed requests.** Both `unacked` after a double loss; both send
`q = 1` requests, `n_A = 7`, `n_B = 7`. Each processes the other's: `7 >
ans` → each answers once with `q = 0`, carrying the ack the other needs.
Each processes the answer: `unacked` false, `q = 0` so no answer to an
answer. Quiescent. Two requests, two answers.

**T15. Delayed old bind after the new session, with a retained duty.**
Session `σ1 = (a1, b1)` current; channel `x` under `σ1` carries a backup
replica (retained-duty record). B restarts as `b2`; a fresh handshake on
`y` binds `(a1, b2)`: not retired, not current → current session `σ2`;
`σ1` enters A's retired set. An old-incarnation handshake on channel `z`,
started under `b1` before the restart, completes NOW with pair `(a1, b1)`:
in the retired set → refused `elect-retired`, `z` closed by token through
the gate (no duty on `z`). `x` stays: in the retained-duty record, not in
`S`, its election frames discarded by session mismatch, its replica held
until the lease document's evidence or, being legacy, the kernel's role
state for it is gone. The election runs on `S_A = {y}` under `σ2`.
Variant: a second process `b3` with B's identity binds `w` while `b2` is
live and unretired: two unretired pairs → `elect-ambiguous-identity`; no
admission on `y` or `w`; both kept open; reported; OPEN prerequisite.

**T14. Lost answer.** From T10, A's answer `n5` is lost. B remains
`unacked`; after `E_repropose` sends `P{n6, q=1, …}`; A: `6 > ans_A = 5` →
answers once. B processes; quiescent. Each loss costs one request and one
answer; no answer provokes an answer.
