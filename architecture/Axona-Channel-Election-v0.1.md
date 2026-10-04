# Channel election (v0.1)

**Status:** design for council review, revision 1 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Driver:** David's direction of 2026-10-04 ("write the
two protocols now"), after Aster `76bc93dd` and `0d7f2982` showed that
Hold-and-Fill v0.4's glare rules assume the agreement they need: two ends can
each admit a different channel before either sees the other's, and a refusal
frame is not agreement. This document is the protocol those rules lacked.
Hold-and-Fill (`8b9b214`) depends on it and will say so.

This document is a design. It changes no code. Deploy is David's.

---

## The question

When two nodes hold more than one open channel to each other, how do both
ends choose the same one to keep, and how does either end know the other has
chosen it?

Two RTCPeerConnections between the same pair arise whenever both dial at once,
whenever a replacement is dialed while the old channel is still closing, and
whenever one end's record of the pair is stale. Each PeerConnection is one
object seen from two ends, and the axona/4 handshake gives both ends the same
authenticated CHANNEL KEY for it, derived from the sorted nonce pair. So the
two ends can name the channels identically. What they cannot do today is agree
which one to keep: `mesh-auth` resolves a duplicate by "keep the existing
binding" (`mesh-auth.js:173`, `:222`), and "existing" is local.

## What this protocol is not

It is NOT a leader election among many nodes. It elects one channel between
two nodes, and nothing else.

It is NOT a liveness guarantee for the pair. If every channel between the two
dies, there is nothing to elect, and the pair is back to discovery.

It is NOT claimed on a legacy edge. A peer that does not advertise `cap:elect`
in the axona/4 handshake never enters an election, and the old local rule
applies with the old guarantees, which are none.

## Definitions

- `K(t)`: the authenticated channel key of channel `t`, the same at both ends.
- `S_A`: the SET of keys of channels that end A currently holds OPEN (axona/4
  bound) to peer B. It changes only when a channel binds or enters CLOSING.
- `e`: the pair's ELECTION EPOCH at an end, a counter starting at 0,
  incremented by that end whenever its own set changes.
- `elected`: the key of the channel both ends have elected, if any.
- `H(S)`: a hash over the sorted keys of `S`.

## The frames

One frame, sent on EVERY channel in the sender's set, so no single channel's
loss can hide it:

```
elect:propose { e, S, ack }
```

`e` is the sender's epoch; `S` the sender's set; `ack = H(S_peer)` where
`S_peer` is the latest set the sender has received from the peer, or `∅` if
none. A `propose` carrying an `e` lower than the last `e` seen from that peer
is late and is discarded. A `propose` is sent on every change to the sender's
set and re-sent every `E_repropose` while the pair has no elected channel.

## The rule

At end A, with `S_A` its own current set and `P_B = {e_B, S_B, ack_B}` the
latest proposal received from B:

```
I = S_A ∩ S_B
winner(A) = elected      if elected ∈ I
          = min(I)       otherwise, if I ≠ ∅
          = none         if I = ∅
```

A may ADMIT the channel with key `winner(A)` only when all of:

1. `I ≠ ∅`.
2. `ack_B = H(S_A)`: B's latest proposal was computed knowing A's current
   set.
3. A's own latest proposal carried `ack = H(S_B)`: A has told B it knows
   B's current set.
4. The channel with key `winner(A)` is OPEN at A now.

The tuple `(S_A, P_B, winner)` is the ELECTION EVIDENCE and is stored with
the admission. A channel admitted without evidence is a defect. Every other
channel in `I`, and every channel in `S_A \ S_B` once `E_elect` has passed
with it still absent from B's set, is closed BY TOKEN with reason `elect`.

STICKINESS. Once `elected` is set at an end, it stays the winner for as long
as it is in both sets. A later channel never displaces an elected one, so an
admitted, duty-bearing channel is not closed by a newcomer. `elected` is
cleared only when its channel leaves either set (loss or close), and the
next election starts from `min(I)`.

## Why both ends pick the same channel

The two ends compute on the same pair of sets. Condition 2 says B's proposal
was computed on A's current `S_A`; condition 3 says A has acknowledged B's
current `S_B`. B admits under the mirror conditions. If both conditions hold
at both ends, both are computing `winner` on `(S_A, S_B)` with the same
`elected`, and `min` and `∈` are the same function at both ends. So:

- SAFETY. No end admits a channel that is not in both sets, because admission
  requires `winner ∈ I`. Two different channels cannot be admitted at the two
  ends under mutually acked sets, because the function is the same.
- A WINDOW EXISTS. Between A admitting and B admitting, B's set may change
  (a third channel binds at B). Then B re-proposes with a higher `e`; A's
  evidence is for an older `e_B`, and A does not re-admit on it; A re-runs
  the rule on the new `P_B`: stickiness keeps `elected` if it is still in
  both sets, which it is unless it was lost. So the window changes nothing
  unless the elected channel itself died, which is the loss case below.
- LIVENESS, conditional. If the two sets stop changing, each end's next
  proposal acks the other's final set inside one round trip, conditions 2
  and 3 hold at both ends, and both admit the same channel. If the sets never
  stop changing, no channel is admitted; that is the correct outcome for a
  pair that cannot hold a channel open, and it is bounded by `E_elect`
  below.

What this does not give: simultaneity. One end admits before the other, for
up to one round trip plus delivery jitter. Hold-and-Fill's two-sided duty
fence is what makes that window harmless for obligations; this protocol
makes it harmless for the channel.

## Simultaneous opens, in full

A dials `x`; B dials `y`; both bind at both ends in some order.

1. `x` binds at A: `S_A = {x}`, `e_A = 1`, A sends `propose{1, {x}, ∅}` on
   `x`.
2. `y` binds at B: `S_B = {y}`, `e_B = 1`, B sends `propose{1, {y}, ∅}` on
   `y`.
3. A receives B's proposal on `y` only once `y` binds at A. Say `y` binds at A
   now: `S_A = {x, y}`, `e_A = 2`, A sends `propose{2, {x,y}, H({y})}` on
   both. A computes `I = {x,y} ∩ {y} = {y}`, but condition 2 fails: B's ack
   is `∅ ≠ H({x,y})`. No admission.
4. `x` binds at B: `S_B = {x, y}`, `e_B = 2`; B has A's `{x,y}` proposal, so B
   sends `propose{2, {x,y}, H({x,y})}` on both. B computes `I = {x,y}`,
   `winner = min(x, y)`; condition 2: A's latest ack is `H({y}) ≠ H({x,y})`.
   No admission yet.
5. A receives B's `{2, {x,y}, H({x,y})}`: condition 2 holds; A's own last
   ack was `H({y})`, so A sends `propose{2, {x,y}, H({x,y})}` (same `e`, new
   ack; a proposal differing only in `ack` does not bump `e`). Condition 3
   now holds. A admits `min(x, y)` and closes the other by token.
6. B receives A's new proposal: condition 2 holds at B; B admits `min(x, y)`
   and closes the other by token.

Both close the same channel. Neither admitted before the other's set was
known and acknowledged. Trace T1 in the appendix carries the counts.

## Timeouts

- `E_elect`: if `I = ∅` for longer than `E_elect` after a proposal, the end
  closes every channel in `S_A \ S_B` except its own minimum key, re-proposes,
  and if `I` is still empty after a second `E_elect`, reports
  `elect-stalled` and treats the pair as unreachable for this cycle. A
  channel that one end bound and the other never did is a channel that is
  dying; its deadline closes it and the set shrinks.
- `E_repropose`: while no channel is elected, proposals are re-sent so a
  lost proposal does not hold the pair forever.
- Both are bounded by the channel deadline already in the mesh
  (`NEGOTIATION_DEADLINE_MS`, 30 s): a channel that never opens leaves the
  set by itself.

## Loss of the elected channel

When the elected channel enters CLOSING at either end, that end clears
`elected`, removes the key from its set, bumps `e`, and proposes. The other
end learns it either by the same loss (a channel dies at both ends) or by the
proposal. The next election starts from `min(I)` over what remains. An
obligation that rode the lost channel is the lease protocol's problem, by
loss, not by this one.

## Later channels

A channel that binds after an election: the binding end adds its key, bumps
`e`, proposes. Stickiness keeps `elected`; the new channel is not in the
winner's place and is closed by token with reason `elect` once both ends'
sets include it (so both close the same one) or once `E_elect` passes.

A replacement dialed on purpose (a re-dial after loss) is the ordinary case:
`elected` is already clear, so the new channel wins by `min` once both sets
agree.

## Legacy edges

A peer without `cap:elect` gets no `propose` frames; the mesh's existing
duplicate rule applies on that edge; the invariant "both ends keep the same
channel" is not claimed there. A capable peer that receives a `propose` from
a peer it recorded as legacy treats the capability as newly advertised and
enters the election.

## Integration with Hold-and-Fill

- `identify(t, id)` for an identity that already has channels enters this
  election instead of the glare rules of v0.4; the glare section is replaced
  by a reference to this document.
- `admit(id)` requires election evidence naming the channel, in addition to
  its cap, lane and policy checks; `admit-staged` revalidates the evidence at
  commit and aborts on an epoch mismatch.
- The closes this protocol issues are by token, through `close(t, 'elect')`,
  and consult the duty gate like any voluntary close; the gate is trivially
  true for a channel that was never admitted.

## What this design does not establish

- Simultaneous admission at both ends. One round trip of asymmetry exists and
  is stated.
- Agreement under a peer that lies about its set. A dishonest peer can keep
  the pair in election forever; that is a denial of the pair, not a split,
  and is bounded by `E_elect`.
- Anything on a legacy edge.
- That the election is cheap at high channel churn. One proposal per set
  change per channel; at `n` channels, `O(n)` frames per change. Bounded by
  `C_phys`.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `E_elect` | 10 s | the measured bind-time spread between two ends of one channel |
| `E_repropose` | 5 s | lost-proposal rate at step 4 of Hold-and-Fill |
| `cap:elect` | advertised by every capable kernel | the version that ships this |

## Appendix: traces

Notation: `A:[S_A, e_A, elected]`, frames as `A→B on t: propose{…}`.

**T1. Simultaneous opens.** As the six steps above. Final: both `elected =
min(x,y)`, both closed the other by token, evidence stored at both: `(S =
{x,y}, P = {2, {x,y}, H({x,y})}, winner)`.

**T2. Stale ack.** After T1, `z` binds at B only: `B:[{x,y,z}, 3]`, B proposes
`{3, {x,y,z}, H({x,y})}`. A receives: `I = {x,y}`; `elected ∈ I` → winner
unchanged; condition 2 holds (B acked A's current set); A proposes `{2,
{x,y}, H({x,y,z})}`. `z` binds at A: `A:[{x,y,z}, 3]`, proposes `{3, {x,y,z},
H({x,y,z})}`; both now have `I = {x,y,z}`, `elected` sticks; both close `z`
by token with reason `elect`. No admission changed.

**T3. Loss of the elected channel.** After T1 with `elected = x`: `x` dies.
A: `[{y}, 3, none]`, proposes `{3, {y}, H({x,y})}`. B sees the loss too:
`[{y}, 3, none]`, proposes `{3, {y}, H({y})}` after receiving A's. A
receives: condition 2 needs `ack = H({y})`: holds. A's own last ack was
`H({x,y})`: A proposes `{3, {y}, H({y})}`; condition 3 holds; A admits `y`.
B likewise. One channel, both ends.

**T4. One end never binds.** A binds `x`; B never completes the handshake on
`x` (it will deadline at 30 s). A: `[{x}, 1]`, proposes; nothing arrives;
`I = ∅` through `E_elect`; A keeps its minimum (`x`), re-proposes; the
deadline closes `x` at both ends; `S_A = ∅`; `elect-stalled` reported after
the second `E_elect`; the pair returns to discovery.

**T5. Legacy peer.** B lacks `cap:elect`. A binds `x`, B binds `x`; A sends no
`propose`; A admits by the old rule; the invariant is not claimed. A later
duplicate `y`: `mesh-auth`'s existing resolution applies at each end
independently, as today.
