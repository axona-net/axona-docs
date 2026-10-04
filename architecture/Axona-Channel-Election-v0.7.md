# Channel election (v0.7, consolidated)

**Status:** consolidated normative candidate for council review · **Date:**
2026-10-04 · **Kernel in production:** 4.102.0 (`270835d`) · **Policy set
by:** David · **Author:** axona.bot · **Supersedes:** v0.1–v0.6 (axona-docs
`b923e54`, `3c31d9d`, `a415b02`, `02375b6`, `559c50a`, `563339d`), all left
in place as record · **Driver:** Aster `c73bc3c7`, which closed the v0.5
correction round at the design-text level and asked for one normative
text carrying nothing by reference, with reviewed assumptions separated
from unexecuted scenarios and from the open adapter prerequisites.

This file carries everything. Nothing is "as an earlier version wrote it".
Where earlier versions disagreed, this text is the one that governs.

This document is a design. It changes no code. It is claimed on no legacy
edge. Deploy is David's.

---

## 1. The question

When two nodes hold more than one open channel to each other, how do both
ends choose the same one to keep, and how does either end know the other
has chosen it?

Two RTCPeerConnections between one pair arise when both dial at once, when
a replacement is dialed while the old channel is still closing, and when
one end's record of the pair is stale. Each PeerConnection is one object
seen from two ends, and the axona/4 handshake gives both ends the same
authenticated CHANNEL KEY for it. The kernel today resolves a duplicate
inside `webrtc.bindPeer` by keeping the smaller key and calling
`mesh.disconnect` on the other (`webrtc.js:229–247`), at each end
independently, with no duty gate, and `onPeerBound` then seeds the
synaptome. "Independently" is the defect: nothing makes the two ends agree.

## 2. What this protocol is not

- NOT a leader election among many nodes. One channel between two nodes.
- NOT a liveness guarantee for the pair. If every channel dies there is
  nothing to elect.
- NOT an ordering of incarnations. A fresh handshake proves the handshake
  is fresh, not that its incarnation is recent or exclusive.
- NOT claimed on a legacy edge. A peer without `cap:elect` keeps
  `bindPeer`'s rule and its guarantees, which are none.
- NOT a fence against a process running elsewhere. Retirement is local.

## 3. Definitions

| term | meaning |
|---|---|
| `K(t)` | the authenticated channel key of channel `t`, identical at both ends, bound to both authenticated identities and the channel's nonce pair. ADAPTER CONTRACT, §11. |
| `inc` | a per-process incarnation, a random 64-bit value drawn at start and carried in the handshake; unique with probability `1 − 2⁻⁶⁴` per pair of processes; compared for EQUALITY only. |
| pair | `(inc_A, inc_B)` as bound by a handshake; the identity of a SESSION. |
| session record | one of CURRENT (≤ 1), UNRETIRED, RETIRED, per peer identity; §6. |
| `S_A` | A's set of keys of channels OPEN to B under the CURRENT pair. Channels of unretired or retired pairs are not in `S`. |
| `r_A` | STATE VERSION per (pair): incremented on every change to `(S_A, g_A, d_A)`; within a session names one exact state. `r_A⁻`/`r_A⁺`: the versions before and after a decision event. |
| `n_A` | ENVELOPE per (pair): incremented on every proposal A sends. Orders frames; `r` orders states. |
| `g_A` | GENERATION per (pair): incremented only when a set decision is cleared by loss of its channel; within a generation a decision never regresses. |
| `d_A` | DECISION: a key or `none`, bound to `g_A`. |
| `q` | REQUEST FLAG on a proposal: set when the sender is `unacked` and re-sending. |
| `ack_A` | `r_B` of the latest proposal A has processed from B, or `∅`. |
| `ans_A` | the largest `n_B` of a request A has answered, per pair. |
| `owed_A` | A's latest sent `ack ≠ r_B`. |
| `unacked_A` | B's latest processed `ack ≠ r_A`. |
| retained-duty record | `(t, source, release evidence)` for a channel kept open for a duty; outside `S`; §7. |

## 4. Wire schema

```
elect:propose {
  σ:    pair (inc_sender, inc_receiver)
  n:    envelope sequence, uint
  q:    request flag, bool
  r:    state version, uint
  g:    generation, uint
  S:    sorted list of channel keys
  d:    channel key or none
  ack:  r of the peer's latest processed proposal, or ∅
}
```

One frame type. Sent on every channel in `S`.

## 5. Processing and the one send rule

### 5.1 Processing a received proposal

In order; the first failing step discards the frame and, where marked,
reports:

1. SESSION: `σ` equals the pair bound on the arrival channel; else
   discard. (A retired pair's frames fail here.)
2. ENVELOPE: `n` greater than the last processed `n` from this peer; else
   discard (late or duplicate; triggers nothing).
3. STATE: if `r` greater than the last applied `r`: apply `(r, g, S, d)`.
   If `r` equal: `(g, S, d)` must equal the applied state, else discard and
   report `elect-malformed`; read `ack` and `q` only. If `r` lower inside a
   higher `n`: discard, report `elect-malformed`.
4. GENERATION: if `g` greater than this end's `g`: adopt it; clear `d` if
   this end's decided channel is absent from the received `S`.
5. Record `ack`, evaluate §5.3 (conflict) and §5.2 (send).

### 5.2 The send rule

A sends one proposal when, after processing or on a local change, any
trigger holds; `q` as stated; one send covers several triggers:

| trigger | condition | `q` |
|---|---|---|
| state change | `r_A` changed | 0 |
| owed | `owed_A` | 0 |
| retry | `unacked_A` and `E_repropose` elapsed since A's last send | 1 |
| answer | a processed frame had `q = 1` and `n_B > ans_A`; set `ans_A := n_B` | 0 |

Nothing else sends. QUIESCENT: `owed_A` false, `unacked_A` false,
`d_A = d_B ≠ none`. In quiescence the first three triggers are false by
definition; the answer trigger still fires, once per request `n`.

What this gives: per-request bounded answering (each request `n` answered
at most once) and conditional convergence (under eventual delivery the
pair reaches quiescence). It is not a traffic bound: a delayed answer can
make the requester's timer fire again with zero loss; each such retry is
one request and one answer.

### 5.3 The rule, conflict, admission

```
I = S_A ∩ S_B
winner(A) = d_B      if d_B ≠ none and d_B ∈ I
          = d_A      if d_A ≠ none and d_A ∈ I
          = min(I)   if I ≠ ∅
          = none     otherwise
```

CONFLICT: `d_A ≠ none`, `d_B ≠ none`, `d_A ≠ d_B`, both in `I`. A reports
`elect-conflict` and closes, by token and through the duty gate, the one
of the two channels that carries no admitted duty; if both carry duties
it closes neither and reports `elect-conflict-blocked: duty`; `g` is not
bumped. Conflict is a defect against §9's theorem; this is the recovery.

ADMISSION. A may admit the channel with key `winner(A)` only when all of:

1. `I ≠ ∅` and `winner(A) ≠ none`.
2. `ack_B = r_A`, where `r_A` is A's current version, which at the moment
   of admission is `r_A⁻`.
3. A's latest sent proposal carried `ack = r_B`.
4. `g_B = g_A`.
5. `d_B = none` or `d_B = winner(A)`.
6. The channel with key `winner(A)` is OPEN at A now.
7. The identity is not AMBIGUOUS (§6).

On admission A sets `d_A := winner(A)` (creating `r_A⁺`), stores the
ELECTION EVIDENCE `(σ, r_A⁻, g_A, S_A, d_A, P_B)`, and sends. Every other
channel in `S_A` is closed by token through the duty gate once it is in
`S_B` too, or after `E_elect`.

## 6. Sessions: records, capacity, exhaustion, promotion

Per peer identity: CURRENT (at most one record), UNRETIRED, RETIRED; one
capacity `L_sessrec` over their sum.

ON A BIND with pair `p`, in order:

1. Hold-and-Fill's physical bound `C_phys` and inbound bound apply first;
   a channel that cannot be allocated never reaches this step.
2. `p ∈ RETIRED`: refuse `elect-retired`; close by token through the gate;
   no record.
3. `p = CURRENT`: the channel joins `S`; no record.
4. `p ∈ UNRETIRED`: the channel joins that pair's channel set, not `S`;
   no record.
5. Else, if the sum equals `L_sessrec`: refuse `elect-session-limit`;
   close by token; no record. Otherwise create a record: in CURRENT if
   there is no current pair and UNRETIRED is empty; else in UNRETIRED.

AMBIGUITY holds while CURRENT exists and UNRETIRED is non-empty, or while
UNRETIRED has more than one pair and CURRENT is empty. While ambiguous: no
admission on any channel of the identity; all channels kept under the
duty gate; `elect-ambiguous-identity` reported.

EXHAUSTION of any tracked pair: every channel of that pair GONE at this
end through the kernel's deadlines and pong timeouts. On exhaustion the
record moves to RETIRED (a move; no capacity needed). What exhaustion is:
a local failure-detector observation that this end can no longer reach
those channels. It proves neither that the old process died nor that it
surrendered anything; a live partitioned process is exhausted here while
running elsewhere; retirement fences nothing elsewhere (§11).

CLEARING: ambiguity clears when UNRETIRED empties with CURRENT intact
(CURRENT and `S` unchanged), or when CURRENT is exhausted and exactly one
pair remains in UNRETIRED, which is then PROMOTED: its record moves to
CURRENT; `S` is rebuilt from its OPEN channels; per-pair election state is
reset (`r := 0`, `n := 0`, `g := 0`, `d := none`, `ans := 0`, `ack := ∅`);
the first proposal is sent as for a new pair. Retained-duty records are
not session state and carry over.

NO TIMED FORGETTING. RETIRED is kept for the life of the process. The
only forgetting is process restart, which forgets everything; the new
incarnation starts with no records and admits as if it had never seen the
peer. Succession on recovery, and fencing of a still-running predecessor,
are the adapter's (§11).

THE TRADEOFF, named: at `L_sessrec` an end refuses legitimate new
incarnations of that identity for the life of the process; a
same-incarnation peer that was partitioned away and exhausted here is
permanently refused at this observer until restart. Both are chosen over
forgetting a retired pair, because a forgotten pair is a replay hole.

## 7. Retained duties

A channel carrying a duty is held in a RETAINED-DUTY record, outside `S`,
never closed by the election, never a swap victim. Two sources, kept
apart:

- A duty under a LEASE (Duty Leases): released only by that document's
  discharge evidence, never by a role-state change alone.
- A LEGACY duty under the kernel's existing role path (a `REPLICATE`
  receiver, a `peer.host()`, a root): the kernel today changes that role
  state on a later `REPLICATE`, on `unhost`, or on `rootClaim.demote`.
  Those are facts about what exists; this document does not call them
  proof of custody transfer or discharge. A legacy-duty channel leaves the
  record when the kernel's role state for it is gone and no lease names it.

Every election close (loser, conflict, retired, limit) runs the duty gate
and is blocked by a duty.

## 8. Timeouts and their actions

| timer | fires when | action |
|---|---|---|
| `E_bind` | a channel OPEN here whose peer has not completed the handshake | close by token, `bind-timeout` |
| `E_elect` | `I = ∅` for `E_elect` after a proposal | keep the minimum local key, close the others by token through the gate, re-propose; after a second `E_elect`, report `elect-stalled`, treat the pair as unreachable this cycle |
| `E_repropose` | `unacked` and no send since | retry trigger (§5.2) |
| kernel deadlines | `NEGOTIATION_DEADLINE_MS`, pong timeout | channel → GONE; may cause exhaustion (§6) |

No timer forgets a retired pair.

## 9. Reviewed arguments and their assumptions

ASSUMPTIONS, each stated once: the adapter contract of §11 (same key at
both ends); monotone `n` and `r` per sender with the processing rule of
§5.1; a decision never regresses within a generation (I2); condition 4
pins one generation; session equality on every processed frame (§5.1
step 1).

INVARIANTS. I1, state identity: within a session `r_X` names one exact
`(S_X, g_X, d_X)`; `ack = r_X` means its sender applied that state. I2,
decision lock: every envelope X sends after its decision event carries
`d_X` and `r ≥ r_X⁺`.

THEOREM. Within one session and generation, if A admits `a` and B admits
`b`, then `a = b`.

PROOF. Events: `set_X` is X's admission; `env_X(n)` the send of envelope
`n`; `rcv_Y(n)` its processing at Y; `≺` is program order at each end
plus `env_X(n) ≺ rcv_Y(n)`, transitively. Let `P_B = env_B(n_b)` be the
proposal A relied on, with version `r_B(P_B)`; `P_A = env_A(n_a)` the one
B relied on, with `r_A(P_A)`. Condition 2 at A: `P_B.ack = r_A⁻`, so some
`m` of A carrying `r_A⁻` has `rcv_B(m) ≺ env_B(n_b)`. Condition 2 at B:
`P_A.ack = r_B⁻`, so some `m'` of B carrying `r_B⁻` has `rcv_A(m') ≺
env_A(n_a)`.

Case E: `r_B(P_B) ≥ r_B⁺` or `r_A(P_A) ≥ r_A⁺`. By I2 the relied-on frame
carries the decision; by I1 the relier applied it; `winner` returns it by
its first line and condition 5 forbids any other. `a = b`.

Case O=: `r_B(P_B) = r_B⁻` and `r_A(P_A) = r_A⁻`. Both computed `min` over
the same `(S_A(r_A⁻), S_B(r_B⁻))` by I1, both decisions `none`. `a = b`.

Case O<: say `r_B(P_B) < r_B⁻`. Then `env_B(n_b) ≺ e_B` where `e_B`
created `r_B⁻`. From condition 2 at A, `rcv_B(m) ≺ env_B(n_b) ≺ e_B`, and
`e_A⁻ ≺ env_A(m)`, so `e_A⁻ ≺ e_B`. From condition 2 at B, `e_B ≺
env_B(m') ≺ rcv_A(m') ≺ env_A(n_a)`. If `r_A(P_A) < r_A⁻` then `env_A(n_a)
≺ e_A⁻`, giving `e_A⁻ ≺ e_B ≺ env_A(n_a) ≺ e_A⁻`, a cycle; impossible. So
`r_A(P_A) = r_A⁻`. Then A had processed `m'` (carrying `r_B⁻`, with `n(m')
> n_b`) before `env_A(n_a)`; A's admission used `P_B` with `r_B(P_B) <
r_B⁻`, so A's latest processed proposal from B at admission was `P_B`
only if `set_A ≺ rcv_A(m')`; in that order `env_A(n_a)` is after `set_A`
and by I2 carries `r ≥ r_A⁺ > r_A⁻`, contradicting `r_A(P_A) = r_A⁻`. By
symmetry the other strict case is impossible. ∎

Each step names an envelope event and its receipt; no step infers receipt
from sending. The theorem is about the stated model; it is not
verification of an implementation or of the adapter.

## 10. Integration with Hold-and-Fill

- On a CAPABLE edge, `webrtc.bindPeer` no longer closes duplicates: it
  records the key and hands the channel to this election; `onPeerBound`
  seeds the synaptome only with election evidence; `mesh.disconnect` is
  called only through `close(t, reason)` under the duty gate. Those three
  are the kernel touch points; any other duplicate close is a defect
  against this document.
- `admit()` requires election evidence whose acknowledged version is
  `r_A⁻` in the current generation; `admit-staged` revalidates `(σ, r_B,
  g_B)` at commit and aborts on a change.
- A bind is a channel first: Hold-and-Fill's `allocate()` runs before §6.
- Retained-duty channels count in `C_phys`.

## 11. Open adapter prerequisites

Named, required, not supplied:

1. THE CHANNEL KEY: identical at both ends, bound to both authenticated
   identities and the nonce pair.
2. HANDSHAKE FRESHNESS: nonces bound to the live connection, not
   replayable onto another.
3. SUCCESSION EVIDENCE: proof that one incarnation of an identity has
   succeeded another, which would retire the superseded pair at once.
4. ONE LIVE PROCESS PER IDENTITY, or an ordering of concurrent
   incarnations. Without it, two unretired pairs stay ambiguous.
5. FENCING ELSEWHERE: what stops a retired-here process acting elsewhere.
6. RECOVERY AFTER RESTART: what a new incarnation must establish about its
   predecessor.

Until each exists and is reviewed, the behaviour that depends on it is
UNAVAILABLE and the document says which: succession-based retirement (3);
disambiguation of concurrent processes (4); any global fence (5); any
claim across a restart (6).

## 12. Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `E_bind` | 30 s | the measured handshake-completion spread |
| `E_elect` | 20 s (`≥ 2·D_max` of the lease document) | a healthy slow link reported stalled |
| `E_repropose` | 5 s | a cost knob only |
| `L_sessrec` | 16 per peer identity | a `elect-session-limit` report is its own finding; the refusal is §6's tradeoff |
| `cap:elect` | advertised by every capable kernel | the version that ships this |

## 13a. Appendix: reviewed traces

Notation: `A:[S, r, g, d]`; `A→B: P{n, q, r, g, S, d, ack}`.

**T0. One end decided, the other not.** After mutual ack on `{x}`:
`A:[{x},1,0,none]`, `B:[{x},1,0,none]`. A admits `x`: `A:[{x},2,0,x]`,
`A→B: P{3,0,2,0,{x},x,1}` delayed. `y` binds at both: `A:[{x,y},3,0,x]`,
`B:[{x,y},2,0,none]`. `A→B: P{4,0,3,0,{x,y},x,1}`; `B→A: P{3,0,2,0,{x,y},
none,1}`. B processes A's `r=3`: `winner = x`; owed → `B→A: P{4,0,2,0,{x,y},
none,3}`. A processes: owed → `A→B: P{5,0,3,0,{x,y},x,2}`. B: conditions
1–7 hold with `winner = x`; admits; `B:[{x,y},3,0,x]`; `B→A: P{5,0,3,0,
{x,y},x,3}`; closes `y` by token. A: quiescent; closes `y`. The delayed
`n=3` arrives at B: lower `n` → discarded.

**T1. Simultaneous opens.** A dials `x`, B dials `y`. Each binds its own
first, proposes `{own}`; neither can admit until both sets are `{x,y}` and
mutually acked; then `min(x,y)` wins at both by O=; quiescent after.

**T9. Stable-set handshake.** Three frames from `{x}` at both ends to
mutual ack; seven from scratch to quiescence with `x` elected.

**T10. Lost final ack.** A's last frame lost; B `unacked`; after
`E_repropose` B sends `q=1`; A answers once (`ans`); quiescent.

**T13. Crossed requests.** Both `unacked`; both send `q=1`; each answers
the other once with `q=0`; quiescent. Two requests, two answers.

**T2. Third channel after election.** `z` binds; carried decision keeps
`x`; both close `z` by token through the gate after both sets include it.

**T3. Loss of the decided channel.** `x` dies; `g` increments at the end
that sees it first; the other adopts `g` on the next proposal; fresh
election over what remains; both admit the same `min`.

**T16. Retired pair binds after a long delay.** `(a1, b1)` retired at
`t=100`; a bind with `(a1, b1)` at `t=100 000`: `elect-retired`; refused;
nothing forgotten.

## 13b. Appendix: unexecuted adversarial scenarios

Hand-written expected outcomes, to become tests; not evidence.

**T4. Local OPEN, remote incomplete.** `E_bind` closes it; no election.

**T7. Quiescence.** One hour, no loss: zero frames.

**T8. Injected conflict.** Both decided differently (a schedule §9 says
cannot arise): the duty-free channel is closed through the gate; if both
carry duties, neither; `g` unchanged.

**T11. Ack-only frames out of order.** Ordered by `n`; state unchanged.

**T12. Delayed redundant request after quiescence.** Lower `n`: not
processed; new `n`: answered once by `ans`.

**T14. Lost answer.** Requester retries with a new `n`; answered once.

**T15. Old bind after a new session, with a retained duty.** `(a1, b1)`
current, `x` under it retained; `b2` binds `y`: UNRETIRED, ambiguous; `b1`'s
channels GONE: exhaustion, `(a1, b1)` → RETIRED, `(a1, b2)` promoted, `S`
rebuilt, election on `{y}`; a late `(a1, b1)` bind: `elect-retired`.
Variant `b3` while `b2` live: ambiguous until one is exhausted (§6) or
adapter evidence (§11).

**T17. Session-record saturation.** `L_sessrec` 4: four pairs tracked, a
fifth refused `elect-session-limit`; exhaustions move records to RETIRED
without freeing capacity; the fifth is still refused after promotion;
§6's tradeoff in effect.

**T18. Malformed.** Equal `r` with different `S`: discarded, reported.
Lower `r` in a higher `n`: discarded, reported.
