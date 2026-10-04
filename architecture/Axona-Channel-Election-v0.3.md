# Channel election (v0.3)

**Status:** design for council review, revision 3 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.2 (axona-docs `3c31d9d`), v0.1
(`b923e54`), both left in place as record · **Revision driver (v0.3):** Aster
`5c2829a0` and Vega `20ffbce9`, decisions recorded at `e44992ea`. The v0.2
errors: answering every received proposal made a stable pair exchange frames
forever; the agreement argument inferred receipt from send and let an older
`d = none` be processed after `d = x` in the same epoch; incarnation was
treated as ordered when it is only an equality namespace; a detected conflict
closed both channels and so bypassed the duty gate; a legacy duty was
"awaited as a lease" when the legacy peer never used leases; and the
integration section put the election beside `webrtc.bindPeer`'s own
duplicate close instead of replacing it.

Then Aster `64efc680`, before this file froze: `e44992ea` had one counter
for both state and acknowledgement, so an ack-only update was discarded as
a non-increasing revision, and its send trigger could loop; here state
version and envelope sequence are separate, the triggers are defined on
state versions, and the agreement proof is a two-case argument over any
schedule.

**What changed from v0.2:** state versions and envelope sequences, send
triggers that cannot ack an ack, duplicate suppression and a quiescent
state; election generations and a proof over
sent-and-received history; sessions as the ordered thing and incarnation as
equality only; conflict handling that never closes a duty-bearing channel;
the election as the replacement for `bindPeer`'s close on capable edges, with
the three kernel touch points named; T7 (quiescence) added; T5 rewritten.
*The question*, *What this protocol is not*, the adapter contract and the
timeouts stand as v0.2 wrote them.

This document is a design. It changes no code. Deploy is David's.

---

## Definitions

- `K(t)`: the authenticated channel key, under the adapter contract of v0.2.
- SESSION `σ`: the pair's current session, bound in the live axona/4
  handshake on each channel. A frame carries the session of the channel it
  was sent on; a receiver compares it with the session bound on the channel
  it arrived on, and a mismatch is a frame from a retired session and is
  discarded. Sessions are an EQUALITY namespace. Nothing is ordered by
  session; a retired session's channels are closed through the ordinary
  close path and retiring clears no election state until those channels are
  GONE.
- INCARNATION `inc`: the random 64-bit per-process value in the handshake.
  It is unique with probability `1 − 2⁻⁶⁴` per pair of processes, which the
  document states instead of "never reused". It is part of the session and
  is compared for equality only.
- `S_A`: A's set of OPEN channel keys to B in the current session.
- STATE VERSION `r_A`: a counter per (pair, session), incremented on every
  change to `(S_A, g_A, d_A)` and on nothing else. Within a session, `r_A`
  identifies one exact `(S_A, g_A, d_A)`; an acknowledgement of `r_A` is
  knowledge of that exact state.
- ENVELOPE `n_A`: a counter per (pair, session), incremented on EVERY
  proposal A sends, including ack-only ones. `n` orders frames; `r` orders
  states. They are separate because an ack-only proposal changes `n` and
  not `r`, which is the contradiction Aster `64efc680` found in `e44992ea`.
- GENERATION `g_A`: a counter per (pair, session), incremented only when a
  set decision is CLEARED by loss of its channel. Within a generation a
  decision, once set, never changes and never regresses to `none`.
- `d_A`: A's decision, a key or `none`, bound to `g_A`.
- `ack_A = r_B`: the state version of the latest proposal A has processed
  from B, or `∅`. Because `r_B` identifies `(S_B, g_B, d_B)` exactly, the ack
  names the whole state.

## The frame

```
elect:propose { σ, n, r, g, S, d, ack }
```

PROCESSED at the receiver only if `σ` matches the arrival channel's session
and `n` is greater than the last processed `n` from that peer. A lower or
equal `n` is late or duplicate and triggers nothing. Processing applies the
STATE `(r, g, S, d)` only if `r` is greater than the last applied `r` from
that peer; an equal `r` must carry the same `(g, S, d)` (else `elect-
malformed`, discarded) and only its `ack` is read. A lower `r` inside a
higher `n` is malformed and discarded. So frames are monotone in `n` and
states are monotone in `r`, and an ack-only proposal (same `r`, new `ack`)
is processed through `n`.

SEND TRIGGERS, evaluated after processing any proposal and on any local
change. Let `owed_A` be true when A's latest SENT ack is not `r_B` (A has
not yet acknowledged B's current state). Let `unacked_A` be true when B's
latest processed `ack` is not `r_A` (B has not yet acknowledged A's current
state). A sends when: its `r_A` changed; or `owed_A`; or `unacked_A` and
`E_repropose` has elapsed since A's last send. A does NOT send on receipt of
a proposal that leaves `owed_A` false, whatever its `ack` says, which is
what prevents an ack-of-ack: an ack is sent at most once per peer state
version, and a peer's acknowledgement of A's state is not itself a state
change. One send covers both triggers when both are true.

RETRANSMISSION REPAIR. A proposal with a new `n` whose content `(r, g, S,
d, ack)` equals the last processed from that peer is the peer REPEATING
ITSELF, and a peer repeats itself only when it is `unacked` (the
`E_repropose` trigger). If that repeated frame's `ack = r_A`, the peer has
A's state and is still repeating, so the peer must be missing A's
acknowledgement of ITS state: A re-sends its current proposal once,
immediately. If the repeated frame's `ack ≠ r_A`, A is `unacked` and the
`E_repropose` trigger covers it. Loop-freedom: A's re-send is, to B, either
a first receipt of A's acknowledgement (B's `unacked_B` becomes false and B
stops) or a repeat (B re-sends only if still `unacked_B`, which A's
acknowledgement makes false). Each lost frame costs at most one repeat and
one re-send. Trace T10.

QUIESCENT: a pair is quiescent at an end when `owed_A` is false, `unacked_A`
is false, and `d_A = d_B ≠ none`. A quiescent end sends nothing until its
`r` changes or a proposal arrives that makes `owed_A` or `unacked_A` true.
Trace T7 (silence), T9 (the three-frame handshake), T10 (one lost final
ack), T11 (ack-only frames out of order).

## The rule

At end A, with `S_A`, `d_A`, `g_A`, and `P_B = {σ, r_B, g_B, S_B, d_B, ack_B}`
the latest processed proposal from B:

```
I = S_A ∩ S_B
winner(A) = d_B        if d_B ≠ none and d_B ∈ I
          = d_A        if d_A ≠ none and d_A ∈ I
          = min(I)     if I ≠ ∅
          = none       otherwise
```

CONFLICT: `d_A ≠ none`, `d_B ≠ none`, `d_A ≠ d_B`, both in `I`. A reports
`elect-conflict` and closes, by token and through the duty gate, the one of
the two channels that carries NO admitted duty; if both carry duties, A
closes neither, reports `elect-conflict-blocked: duty`, and the pair runs two
channels until a lease releases one. A never bumps `g` on conflict. Conflict
is a defect against this document; the proof below is the claim that the
rules do not produce it, and the handling is the recovery if a reader finds a
schedule that does.

ADMISSION. A may admit the channel with key `winner(A)` only when all of:

1. `I ≠ ∅` and `winner(A) ≠ none`.
2. `ack_B = r_A`: B's latest processed proposal acknowledges A's current
   state version, hence A's current `(S_A, g_A, d_A)`.
3. A's latest sent proposal carried `ack = r_B`.
4. `g_B = g_A`.
5. `d_B = none` or `d_B = winner(A)`.
6. The channel with key `winner(A)` is OPEN at A now.

On admission A sets `d_A := winner(A)`, which bumps `r_A` and sends a
proposal. The tuple `(σ, r_A, g_A, S_A, d_A, P_B)` is the ELECTION EVIDENCE,
stored with the admission. Every other channel in `S_A` is closed by token
and through the duty gate once it is in `S_B` too, or after `E_elect`.

## Why both ends pick the same channel, over any schedule

Two invariants, both local and both checkable:

- I1 (STATE IDENTITY). Within a session, `r_X` names exactly one
  `(S_X, g_X, d_X)`; a frame's `ack = r_X` means its sender has applied that
  exact state. This holds because `r` increments on every state change and
  the receiver applies states only in increasing `r`.
- I2 (DECISION LOCK). Within a generation, once `d_X` is set it is carried,
  unchanged, by every later proposal of X, because `d` never regresses
  within `g` and `d` is part of the state `r` names.

Theorem. In one session and one generation `g`, if A admits `a` and B
admits `b`, then `a = b`.

Proof. Let A's admission evidence be `P_B` with state version `r_B*`, and
B's be `P_A` with state version `r_A*`. Condition 2 at A says `P_B` acks
A's state at admission, call it `r_A°`; condition 2 at B says `P_A` acks
B's state at admission, `r_B°`. Compare `r_A*` (the A-state B relied on)
with `r_A°` (A's state when A admitted). Two cases, exhaustive because `r`
is totally ordered per sender:

Case 1, `r_A* ≥ r_A°`. B relied on an A-state at or after A's admission.
By I2 that state carries `d_A = a`. By I1 B applied it. So `winner(B)`
returns `a` by its first line and condition 5 forbids any other key: `b = a`.

Case 2, `r_A* < r_A°`. B relied on an A-state from before A's admission,
so that state has `d_A = none` (a decision set before admission would have
been A's admission). Symmetrically compare `r_B*` with `r_B°`: if `r_B* ≥
r_B°` then by the same argument with roles swapped `a = b`. Otherwise both
ends relied on pre-admission states of each other, both with `d = none`.
Then A computed `winner(A) = min(S_A(r_A°) ∩ S_B(r_B*))` and B computed
`winner(B) = min(S_A(r_A*) ∩ S_B(r_B°))`. Condition 2 at A says B's state
`r_B*` acked `r_A°`, so B applied `S_A(r_A°)` before producing `r_B*`; B's
set at `r_B*` and at `r_B°` differ only if a channel bound or left at B in
between, and any such change would have bumped `r_B` past `r_B*`, making
B's admission evidence `P_A` ack a `r_B°` that `P_B` did not carry; so
`S_B(r_B*) = S_B(r_B°)` and likewise `S_A(r_A*) = S_A(r_A°)`. Both minima
are over the same set: `a = b`. ∎

What the proof uses: I1, I2, condition 4 (one generation), the adapter
contract (same keys at both ends), and session equality on every processed
frame. It names only states the admitting end APPLIED; it never infers
receipt from sending. It covers every schedule, not T0's.

## Sessions and their transition

The pair's SESSION is the `(inc_A, inc_B)` pair bound by the handshake on a
channel. The authoritative transition: when a channel binds whose handshake
carries a pair different from the current session (one end restarted), the
new pair becomes the current session at the instant of that bind, and the
old session is RETIRED at that end. Retiring means: old-session channels are
removed from `S` and take no part in any election; they are kept open for
whatever duties they carry and are closed only through their duties' own
release and the duty gate; a frame carrying the old session, arriving on any
channel, is discarded. One election runs at a time, over the current
session's channels only. Old and new channels coexist only across a restart,
and the old ones are dying by the kernel's own deadlines. The other end
learns the transition from the same handshake, so both ends retire the same
session on the same bind.

## Loss, generations, later channels

When the decided channel enters CLOSING at an end, that end clears `d`,
increments `g`, bumps `r`, and proposes. The other end, on processing a
proposal with a higher `g`, adopts the higher `g`, clears its own `d` if its
decided channel is the one that left `S_peer`, and proposes. Condition 4
keeps the two ends from admitting across generations. A loss is the only
event that increments `g`.

Later channels: as v0.2; a carried decision makes the newcomer lose at both
ends, and the newcomer's close goes through the duty gate (a newcomer never
carries a duty, so the gate is trivially true, and is consulted anyway).

## Legacy edges and the kernel's own close

Today the kernel resolves two channels to one identity inside
`webrtc.bindPeer`: it keeps the smaller `channelKey` and calls
`mesh.disconnect` on the other (`webrtc.js:229–247`), at each end
independently, with no duty gate, and `onPeerBound` then seeds the synaptome
(Vega `20ffbce9`). This protocol does not sit beside that. On a CAPABLE edge
(both ends advertise `cap:elect`), `bindPeer` no longer closes: it records
the key and hands the channel to the election; the election's `min(I)` is
`bindPeer`'s smaller-key rule, now applied to mutually acknowledged sets and
through the duty gate; `onPeerBound` seeds the synaptome only with election
evidence. On a LEGACY edge, `bindPeer`'s close stays as it is, the invariant
is not claimed, and a duty on such a channel is governed by whatever the
kernel's role path does today; it is not awaited as a lease.

The three kernel touch points, named for the source→proposed map:
`webrtc.bindPeer` (duplicate resolution), `onPeerBound` (synaptome seeding),
`mesh.disconnect` (the close). Any other place that closes a duplicate is a
defect against this document.

## Integration with Hold-and-Fill

As v0.2, with: `admit()` requires election evidence in the current
generation; `admit-staged` revalidates `(σ, r_B, g_B)` at commit; `close(t,
'elect')` and `close(t, 'elect-conflict')` both run `mayRetire` and are
blocked by a duty.

## What this design does not establish

- A bound on admission delay between the ends.
- The adapter contract; assumed.
- Agreement against a peer that violates the malformed rule on purpose;
  bounded by `E_elect`, reported, not corrected.
- Anything on a legacy edge.
- That a pair with two duty-bearing channels ever converges to one; it does
  not until a lease releases one, and that is the lease protocol's clock.

## Parameters for David

As v0.2, with `E_repropose` applying only to non-quiescent pairs.

## Appendix: traces

Notation: `A:[S, r, g, d]`; frames `A→B: P{r, g, S, d, ack=(r_B, g_B, d_B)}`;
`σ` fixed.

**T0. The v0.1 counterexample.** After mutual ack on `{x}`: `A:[{x},1,0,none]`,
`B:[{x},1,0,none]`. A admits `x`: `A:[{x},2,0,x]`, `A→B: P{2,0,{x},x,(1,0,none)}`
DELAYED. `y` binds at both: `A:[{x,y},3,0,x]`, `B:[{x,y},2,0,none]`.
`A→B: P{3,0,{x,y},x,(1,0,none)}`; `B→A: P{2,0,{x,y},none,(1,0,none)}`. B
processes A's `r=3`: `winner = x` (carried decision); condition 2 at B needs
A's ack of `(2,0,none)`: not yet; ack-needed → `B→A: P{2,0,{x,y},none,
(3,0,x)}`. A processes: condition 2 at A holds; A's last ack was `(1,…)` so
ack-needed → `A→B: P{3,0,{x,y},x,(2,0,none)}`. B processes: conditions 1–6
hold with `winner = x`; B admits `x`: `B:[{x,y},3,0,x]`, sends
`P{3,0,{x,y},x,(3,0,x)}`; closes `y` by token through the gate. A processes:
acks name current `(3,0,x)` at both ends, decisions agree → QUIESCENT; A
closes `y`. The delayed `r=2` from A arrives at B: lower than 3 → discarded.

**T1. Simultaneous opens.** As v0.2, with `r` and `g`; quiescent after both
admit.

**T2. A third channel after election.** From quiescence on `x`:
`A:[{x},5,0,x]`, `B:[{x},5,0,x]`. `z` binds at B: `B:[{x,z},6,0,x]`,
`B→A: P{6,0,{x,z},x,(5,0,x)}`. A: `winner = x`; A's ack was `(5,…)` → ack-
needed → `A→B: P{5,0,{x},x,(6,0,x)}` (no revision change at A). `z` binds at
A: `A:[{x,z},6,0,x]`, proposes. B processes: ack-needed → replies. Both now
ack `(6,0,x)`; decisions agree; both close `z` through the gate; quiescent.

**T3. Loss of the decided channel.** From quiescence on `x`: `x` dies at A:
`A:[∅,6,1,none]`. A re-dials; `w` binds at A: `A:[{w},7,1,none]`,
`A→B: P{7,1,{w},none,(5,0,x)}`. B sees `x` die: `B:[∅,6,1,none]`; `w` binds:
`B:[{w},7,1,none]`; processes A's `g=1`: same generation; `I = {w}`; ack-
needed → `B→A: P{7,1,{w},none,(7,1,none)}`; A: conditions hold (condition 4:
`g` equal); A admits `w`, `d=w`, `r=8`, proposes; B adopts `w`, admits;
quiescent.

**T4. Local open, remote incomplete.** As v0.2 (`E_bind`).

**T5. Legacy peer with a duty, then upgrade.** B is legacy; `x` was resolved
by `bindPeer`'s rule and carries a backup replica (a kernel REPLICATE
receiver, not a lease). B restarts capable, dials `y`. A's election now runs
on the capable edge for `y` only: `S_A = {x, y}` where `x` is a legacy-
resolved channel. The election never closes `x`: `x` carries a duty under the
kernel's own role path, and the gate blocks; A reports `elect-blocked: duty`
and admits nothing new on `y` until the kernel's role path releases `x` (a
new root, a REPLICATE from elsewhere, or the step-down hold's own clock).
Nothing is awaited as a lease.

**T6. Restart mid-election.** As v0.2, with sessions: the new handshake
binds a new `σ`; a late frame from the old `σ` arrives on a channel bound to
the new one and is discarded by session mismatch.

**T7. Quiescence.** From T0's final state, no loss, no new channel, for one
hour: zero `elect:propose` frames at either end. `E_repropose` does not fire
because the pair is quiescent. A duplicate of B's last proposal injected at A
triggers nothing.

**T9. Stable-set handshake, three frames.** Both hold `{x}` only.
`A→B: P{n1, r1, g0, {x}, none, ∅}`. B processes (`owed_B` true, `unacked_B`
true): `B→A: P{n1, r1, g0, {x}, none, ack r1}`. A processes: `owed_A` true
(A has not acked `r_B = 1`), `unacked_A` false: `A→B: P{n2, r1, g0, {x},
none, ack r1}`. B processes: `owed_B` false (already acked r1), `unacked_B`
false: silence. A admits `x` (conditions hold at A after B's frame): `r_A`
→ 2, `d = x`, `A→B: P{n3, r2, g0, {x}, x, ack r1}`. B: applies state r2,
`owed_B` true: `B→A: P{n2, r1, …, ack r2}`; B's conditions hold with
`winner = x` (carried): B admits, `r_B` → 2, `B→A: P{n3, r2, {x}, x, ack
r2}`. A: `owed_A` true: `A→B: P{n4, r2, x, ack r2}`. B: nothing owed, nothing
unacked, decisions agree: QUIESCENT. A likewise. Seven frames in all for a
full election from scratch; three for the initial handshake.

**T10. One lost final ack.** From T9, A's last frame `P{n4, …, ack r2}` is
lost. B: `unacked_B` true (B's latest from A acks r1, not r2). After
`E_repropose` B re-sends `P{n4, r2, x, ack r2}`: same content as B's `n3`,
new `n`. A processes (`n4 > n3`): content equals the last processed from B
and `ack = r_A`: RETRANSMISSION REPAIR fires; A re-sends `P{n5, r2, x, ack
r2}` once. B processes: A's acknowledgement of r2 is now received;
`unacked_B` false, `owed_B` false, decisions agree: QUIESCENT. A: nothing
owed, nothing unacked: QUIESCENT. One repeat and one re-send for one loss.

**T11. Ack-only frames out of order.** A sends `P{n2, r1, …, ack r1}` then,
after B's state change to r2, `P{n3, r1, …, ack r2}`. B receives `n3` then
`n2`: `n3` processed (ack r2 read, `unacked_B` false); `n2` has lower `n`:
discarded. Had `n2` arrived first, `n3` would then be processed and the
newer ack read; order of application is by `n`, state unchanged (r1 both).

**T8. Conflict handling.** Injected: `A:[{x,y},9,0,x]`, `B:[{x,y},9,0,y]`
(a schedule the rules do not produce). A processes B's proposal: conflict;
`y` carries no duty at A → `close(y, 'elect-conflict')` through the gate;
report. B likewise closes `x` if `x` carries no duty at B. If `x` carries a
duty at B: B closes nothing, reports `elect-conflict-blocked: duty`; the pair
runs `x` and `y` until the lease on `x` releases; `g` is not bumped.
