# Channel election (v0.2)

**Status:** design for council review, revision 2 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.1 (axona-docs `b923e54`), left in
place as record · **Revision driver (v0.2):** Aster `70416996`, CHANGES
REQUIRED on v0.1, decisions recorded at `f1d2c8f1`. The v0.1 errors: the
elected key was local and absent from the frame, so an end that had elected
and an end that had not could satisfy every admission condition on the same
sets and choose different channels; an acknowledgement of a set hash proved
receipt of a past proposal, not knowledge of the current one, and broke under
ABA and restart; "one round trip" was asserted in an asynchronous network;
T2 and T3 started from a state T1 had already left; the shared channel key
was used without being named as an adapter contract; and a legacy-to-capable
upgrade could close a channel carrying an admitted duty.

**What changed from v0.1:** the frame carries incarnation, decision and a
structured acknowledgement; processing is monotone in (incarnation, epoch);
an elected end answers every proposal; conflict is detected and closes both
channels; `E_bind` covers a locally open channel whose remote never
completed; the adapter contract for the key is stated; T0 is added before
T2; T2 and T3 are rebuilt. *The question* and *What this protocol is not*
stand as v0.1 wrote them.

This document is a design. It changes no code. Deploy is David's.

---

## Definitions

- `K(t)`: the authenticated channel key of channel `t`. ADAPTER CONTRACT: the
  mesh's axona/4 handshake must supply, for every channel, a key that is
  identical at both ends and bound to both authenticated identities and the
  channel's nonce pair. The protocol assumes this and does not establish it;
  if the handshake cannot supply it, the protocol does not run on that edge.
- `inc`: a per-process INCARNATION, a random 64-bit value drawn at process
  start and carried in the axona/4 handshake. It is never persisted and never
  reused.
- `S_A`: the set of keys of channels that end A holds OPEN to B, in A's
  current incarnation.
- `e_A`: A's election EPOCH for the pair: starts at 0 per incarnation,
  increments on every change to `S_A`, never repeats within an incarnation.
- `d_A`: A's DECISION for the pair: the key A has elected, or `none`.
- `ack_A = (inc_B, e_B, H(S_B), d_B)` of the latest proposal A has processed
  from B, or `∅`.

## The frame

```
elect:propose { inc, e, S, d, ack }
```

Sent on every channel in `S` on: every change to `S`; every change to `d`;
receipt of any proposal from the peer (reception-triggered reply); and every
`E_repropose` while `d = none`. An end that has elected still answers every
received proposal, so a lost acknowledgement is repaired by the peer's next
retransmission.

MONOTONE PROCESSING at the receiver: a proposal whose `inc` differs from the
`inc` in the peer's handshake on the channel it arrived on is from another
incarnation and is discarded. A proposal whose `(inc, e)` is lower than the
last processed from that peer is late and is discarded. Equal `(inc, e)` with
different `ack` or `d` is a refinement in the same epoch and is processed.
ABA on sets cannot occur within an incarnation because `e` never repeats.

## The rule

At end A, with its own `S_A`, `d_A`, and `P_B = {inc_B, e_B, S_B, d_B, ack_B}`
the latest processed proposal from B:

```
I = S_A ∩ S_B
winner(A) = d_B        if d_B ≠ none and d_B ∈ I
          = d_A        if d_A ≠ none and d_A ∈ I
          = min(I)     if I ≠ ∅
          = none       otherwise
```

If `d_A ≠ none`, `d_B ≠ none`, `d_A ≠ d_B` and both are in `I`: CONFLICT. A
closes both channels by token with reason `elect-conflict`, clears `d_A`,
bumps `e_A`, proposes, and reports. The same happens at B when it sees the
same pair. Conflict is a defect in this protocol, not a tolerated state, and
the trace set must show it cannot arise from the rules; the close is the
recovery if a future reader finds a schedule that produces it.

A may ADMIT the channel with key `winner(A)` only when all of:

1. `I ≠ ∅` and `winner(A) ≠ none`.
2. `ack_B = (inc_A, e_A, H(S_A), d_A)`: B's latest proposal was computed
   knowing A's current incarnation, epoch, set and decision.
3. A's own latest proposal carried `ack = (inc_B, e_B, H(S_B), d_B)`: A has
   told B it knows B's current state.
4. `d_B = none` or `d_B = winner(A)`.
5. The channel with key `winner(A)` is OPEN at A now.

On admission A sets `d_A := winner(A)` and proposes at once (a `d` change is
a send trigger). The tuple `(S_A, d_A, P_B)` is the ELECTION EVIDENCE and is
stored with the admission. Every other channel in `S_A` is closed by token
with reason `elect` once it appears in `S_B` too (so both ends close the same
channel) or once `E_elect` has passed with it absent from `S_B`.

STICKINESS, now shared. A decision, once set, is carried in every proposal,
so the peer adopts it (first line of `winner`) before it can satisfy
condition 2 for any later set. A later channel never displaces a decided
one. A decision is cleared only when its channel leaves either set.

## Why both ends pick the same channel

The schedule that broke v0.1: both sets `{x}`; A reaches mutual ack and
admits `x`; A's final acknowledgement is delayed; `y < x` binds at both
ends; both exchange proposals for `{x, y}`; A keeps `x` by local stickiness;
B, with no decision, takes `min = y`.

Under v0.2: A's admission sets `d_A = x` and sends `propose{…, S={x,y} once
y binds, d=x, …}`. For B to admit anything on `{x, y}`, condition 2 at B
requires B to hold A's proposal computed on `S_A = {x,y}`, and every such
proposal carries `d_A = x`. So the first line of `winner(B)` yields `x`. B
cannot admit `y`. Trace T0.

The general argument. Suppose A admits `a` and B admits `b` with `a ≠ b`.
Each admission required the other end's latest proposal computed on the
admitting end's current `(S, d)`. Order the two admissions by the proposals
they relied on. Whichever admission happened second relied on a proposal
from the first admitter computed after that admitter's decision was set,
because a decision change triggers a proposal and processing is monotone in
epoch within an incarnation. That proposal carried the first decision, so
the second admitter's `winner` returned the first decision by its first
line, and condition 4 forbade admitting anything else. So `b = a`. The
argument assumes the adapter contract (same key at both ends), monotone
processing, and that a decision is never set without the proposal that
follows it being sent on every channel in `S`.

What this does not give: a bound on the delay between the two admissions.
Under eventual delivery the second admission happens; under nothing else
does it happen by a deadline. `E_elect` is the only bound and it ends in a
report, not an admission.

## Timeouts

- `E_bind`: a channel OPEN at this end whose peer has not completed the
  axona/4 handshake (no proposal and no handshake completion seen on it)
  within `E_bind` is closed by token with reason `bind-timeout`. This is the
  local counterpart of the mesh's negotiation deadline, which covers only
  channels this end has not opened. T4 is rewritten on it.
- `E_elect`: as v0.1; a pair with `I = ∅` through `E_elect` keeps its minimum
  key, re-proposes, and reports `elect-stalled` after a second `E_elect`.
- `E_repropose`: as v0.1, while `d = none`.

## Loss, later channels, legacy

Loss of the decided channel: as v0.1, with the decision cleared at the end
that sees the loss first and the clearing carried in its next proposal; the
other end clears on receipt or on its own loss event, whichever first; the
next election runs from `min(I)` with both decisions `none`.

Later channels: as v0.1; the decision in the frame is what makes the
newcomer lose at both ends.

Legacy edges: as v0.1, with one addition. When a peer recorded as legacy
first advertises `cap:elect` (an upgrade mid-session), the capable end does
not run an election close against any channel that carries an admitted duty
on that edge: every election close goes through the duty gate, and a blocked
close leaves both channels open and reports `elect-blocked: duty` until the
duty is released by its lease.

## Integration with Hold-and-Fill

As v0.1, with: `admit()` requires election evidence whose `d` names the
channel; `admit-staged` revalidates `(inc_B, e_B)` at commit and aborts on a
change; every election close consults the duty gate; the `inc` in the
handshake is the same incarnation Hold-and-Fill's channel tokens are scoped
to.

## What this design does not establish

- A bound on admission delay between the ends.
- The adapter contract; it is assumed.
- Agreement against a peer that sends inconsistent proposals on different
  channels in the same epoch; the conflict rule closes both channels, which
  is a denial of the pair by that peer, bounded by `E_elect`.
- Anything on a legacy edge.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `E_bind` | 30 s (`NEGOTIATION_DEADLINE_MS`) | the measured spread between the two ends' handshake completion |
| `E_elect` | 20 s | must satisfy `E_elect ≥ 2·D_max` of the lease protocol's delay bound, or a pair on a healthy slow link is reported stalled before one exchange completes (Orion `4ee99568`) |
| `E_repropose` | 5 s | lost-proposal rate at step 4 of Hold-and-Fill; with the decision carried in every frame, retransmission cannot diverge the two ends, so this is a cost knob, not a safety one |
| `cap:elect` | advertised by every capable kernel | the version that ships this |

## Appendix: traces

Notation: `A:[S, e, d]`; frames `A→B: P{e, S, d, ack}` with `ack` written as
the peer's `(e, H(S), d)`; `inc` omitted where both incarnations are fixed.

**T0. The v0.1 counterexample.** Start after mutual ack on `{x}`:
`A:[{x},1,none]`, `B:[{x},1,none]`, both acks current. A admits `x`:
`A:[{x},1,x]`, `A→B: P{1,{x},x,(1,H{x},none)}` DELAYED. `y` binds at both:
`A:[{x,y},2,x]`, `B:[{x,y},2,none]`. `A→B: P{2,{x,y},x,(1,H{x},none)}`;
`B→A: P{2,{x,y},none,(1,H{x},none)}`. B receives A's `P{2,…,x,…}`: `I =
{x,y}`, `d_A = x ∈ I` → `winner(B) = x`; condition 2 at B needs A's ack of
`(2, H{x,y}, none)`: not yet; B sends `P{2,{x,y},none,(2,H{x,y},x)}`. A
receives: condition 2 at A holds (B acked A's current state); A's last ack
was `(1,…)`; A sends `P{2,{x,y},x,(2,H{x,y},none)}`; A keeps `d_A = x`
(already admitted). B receives: condition 2 holds, condition 3 holds (B's
last ack was `(2,H{x,y},x)`), condition 4: `d_A = x = winner(B)`. B admits
`x`, sets `d_B = x`, closes `y` by token. A, on B's next proposal with `d_B
= x`, closes `y` by token. The delayed `P{1,{x},x,…}` arrives at B last:
lower `e` than 2 → discarded. Both hold `x`.

**T1. Simultaneous opens.** As v0.1's six steps, with `d` carried: no
decision is set until step 5, where A admits `min(x,y)` and its proposal
carries it; B at step 6 adopts it by the first line of `winner`. Same
result; now by the rule, not by luck.

**T2. A third channel after election.** Start after T1 with `x` elected and
`y` GONE at both ends: `A:[{x},3,x]`, `B:[{x},3,x]`. `z` binds at B only:
`B:[{x,z},4,x]`, `B→A: P{4,{x,z},x,(3,H{x},x)}`. A: `I = {x}`, `d_B = x ∈ I`
→ winner `x`, unchanged; A replies `P{3,{x},x,(4,H{x,z},x)}`. `z` binds at
A: `A:[{x,z},4,x]`, proposes. Both now have `I = {x,z}`, both decisions `x`;
both close `z` by token with reason `elect`. No admission changed.

**T3. Loss of the decided channel.** Start as T2's start. `x` dies at A
first: `A:[∅,4,none]`; A has no channel to propose on; A re-dials (Hold-and-
Fill class B), opens `w`: `A:[{w},5,none]`, `A→B: P{5,{w},none,(3,H{x},x)}`.
B sees `x` die: `B:[∅,4,none]`; `w` binds at B: `B:[{w},5,none]`; B receives
A's proposal: `I = {w}`, decisions none → winner `w`; B replies
`P{5,{w},none,(5,H{w},none)}`; A: conditions hold, admits `w`, `d_A = w`,
proposes; B adopts `w`, admits. One channel, both ends.

**T4. Local open, remote incomplete.** `x` is OPEN at A (A's side of the
handshake done); B never completes. A: `[{x},1,none]`, proposes on `x`; no
proposal, no handshake completion from B. At `E_bind` A closes `x` by token,
`bind-timeout`; `A:[∅,2,none]`. The pair returns to discovery. No election
ran because the key was never bound at B.

**T5. Legacy peer, then upgrade.** B lacks `cap:elect`; A admits `x` by the
old rule and a backup lease rides it. B restarts capable and dials `y`; B's
handshake now advertises `cap:elect` and a new `inc`. A's election would
close one of `x`, `y`: `x` carries an admitted duty on a legacy edge; the
duty gate blocks the close of `x`; `winner` under the rules is `min(x,y)`;
if that is `y`, A reports `elect-blocked: duty`, admits nothing new, keeps
both open, and re-runs when the lease on `x` is released or renewed onto a
decided channel by the lease protocol's recovery.

**T6. Restart mid-election.** A: `[{x},3,none]` with `inc_A`. A restarts:
new `inc_A'`, `[∅,0,none]`; `x` is gone with the process. B holds a late
proposal from `inc_A`: discarded on arrival because the channel it arrives
on, if any, carries `inc_A'` in its handshake. B's `x` deadlines out. Fresh
election on the next channel.
