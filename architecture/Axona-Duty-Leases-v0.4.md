# Duty leases (v0.4)

**Status:** design for council review, revision 4 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.3 (axona-docs `a415b02`), v0.2
(`3c31d9d`), v0.1 (`b923e54`), all left in place as record · **Revision
driver (v0.4):** Aster `c80d1ca1`, decisions recorded at `f23917f7`. Aster
accepted v0.3's renewal rule as correcting the send-before-confirmation
regression for an active lease under the rate assumptions, and the
following remained: the margin argument treated monotonic readings as
timestamps where a local-duration inequality was available; SUSPENDED
recovery committed on receipt-relative time against the predicate the main
rule enforces, and L7b still assigned a deadline at send; the high-water
rule claimed an ordering that out-of-order delivery breaks; frames were
bound to an arrival channel's incarnation and not to a session, and
UNCERTAIN could leave on a replayed renew; the apparent-delay heuristic had
no input once `grant` carried no timestamp; and handoff activation claimed
more than a sent frame can know.

**What changed from v0.3:** the exact margin; recovery as a reservation with
its candidate at send; high-water as a conservative out-of-order refusal
with void-and-reissue and explicit resource limits, and a holder-scoped
lease id; session binding and a frame admission table that precede the
`seq` rule; UNCERTAIN exits only on fresh frames; the heuristic removed;
handoff activation recorded OPEN; traces L7b repaired, L14b, L19–L21 added.
*The question*, *What this protocol is not*, *Root fencing is an open
prerequisite*, *Uncertainty* (except its exit rule), *Availability*, the
role table and *Custody, receipts, exclusive actions* (except handoff
activation) stand as v0.3 wrote them.

This document is a design. It changes no code. Deploy is David's.

---

## The clock model, corrected

As v0.3 for rate, delay, wall time, suspension and restart, with two
changes. The OFFSET bullet and the apparent-delay heuristic are REMOVED:
`grant` carries only `ttl`, so there is no timestamp to compare, and the
safety argument below needs no offset. Monotonic readings are local
durations and nothing else; the document never subtracts one end's reading
from the other's.

## Definitions

- `L = {id, topic, role, authority, holder, E, seq, ttl}` with
  `id = (inc_authority, inc_holder, counter)`, the counter per
  (authority incarnation, holder incarnation), increasing by one per lease
  issued to that holder. The id is holder-scoped by construction, so every
  lookup and barrier below is scoped to the holder without a second rule.
- SESSION `σ`: the pair's current session as established under the Channel
  Election document's *Sessions*: a fresh authenticated handshake on a
  newly opened channel, under the adapter contract. Every lease frame
  carries `σ`.
- `E`, `seq`, incarnations: as v0.3.

## Frame admission

Before any `seq` comparison, a received frame passes, in order:

1. SESSION: `σ` equals the pair's current session; else discarded,
   `lease-retired-session`. A frame from a retired session is discarded
   whatever its incarnations or `seq`.
2. INCARNATIONS: `inc_authority` and `inc_holder` equal the two live
   incarnations of the current session; else discarded, `lease-stale-
   authority` or `lease-stale-holder`. This is implied by 1 once sessions
   carry both incarnations and is kept as a named check.
3. TYPE × STATE: the frame type is admissible in the receiver's state for
   that id, by the table below; else discarded and reported.
4. TERMS: for a live id, the immutable terms (`topic`, `role`, `authority`,
   `holder`, `E`, `ttl`) equal those held; a change is malformed and
   discarded.
5. SEQ: lower than last processed is late and discarded; equal is a
   duplicate and answered idempotently; higher is processed. Gaps allowed,
   as v0.3.

| receiver state | admissible frames |
|---|---|
| holder: none | `grant` (subject to the barrier below) |
| holder: HELD, RENEWING-H | `renew`, `revoke`, `void` (answered with current state), duplicate `grant` (answered with current `accept`) |
| holder: UNCERTAIN | `renew`, `revoke`, `void`; a `renew` is release evidence only if it is FRESH (`seq` above the last processed for that id) |
| holder: RELEASED, VOID (retained) | any frame for the id: answered with the retained terminal |
| authority: OFFERED | `accept` with the grant's `seq` |
| authority: GRANTED, RENEWING | `renewed` matching the outstanding candidate; `released` |
| authority: SUSPENDED | `renewed` matching the outstanding RECOVERY candidate from a holder reporting HELD or RENEWING-H; `released` |
| authority: REVOKING | `released` |
| authority: VOID, RELEASED (retained) | any frame for the id: answered with the retained terminal |

## Grant admission at the holder: a conservative refusal

Per (authority incarnation, holder incarnation), the holder keeps the
HIGH-WATER counter, the LIVE ids and the RETAINED terminals. A `grant` with
`counter ≤ high-water` that is neither live nor retained is REFUSED with
`lease-stale`. This is a CONSERVATIVE OUT-OF-ORDER REFUSAL, not a claim
that the grant was forgotten: consecutive numbering does not order
delivery, and a grant issued first and delivered second is refused by this
rule. The authority, on `lease-stale`, VOIDS that id and reissues the duty
under a fresh id with a higher counter. The cost is one extra round trip for
a reordered grant; the benefit is that no forgotten grant can be admitted,
because admission needs `counter > high-water`. Trace L19.

RESOURCE LIMITS, each explicit: `L_live` live leases per (authority
incarnation, holder); `L_term` retained terminals per holder; `L_inc`
remembered authority incarnations with their high-waters per holder. At any
limit the holder REFUSES the frame that would exceed it, with `lease-limit`,
and reports; it never evicts a live lease, a retained terminal inside
`T_term`, or a remembered incarnation's high-water to make room. Nothing is
forgotten into permission; at the limit the holder takes on nothing new.

## Deadlines and the exact margin

INITIAL: authority `deadline_A := now_A + ttl − S_skew` at the send of
`grant`; holder `deadline_H := now_H + ttl + S_skew` at the send of
`accept`. Both are LOCAL DURATIONS from local events. In true time, with the
holder's event later than the authority's by `δ ≥ 0` and rates within
`1 ± ρ`, the holder's deadline minus the authority's is at least

```
δ + (ttl + S_skew)/(1 + ρ) − (ttl − S_skew)/(1 − ρ)
  = δ + 2·(S_skew − ρ·ttl)/(1 − ρ²)
```

which is positive whenever `S_skew > ρ·ttl`, `0 ≤ ρ < 1`, `ttl > S_skew`.
That is the whole safety argument, Aster `c80d1ca1`'s formula: a local-
duration inequality that needs no clock offset and no upper bound on
delivery; delivery finiteness is a liveness matter only. v0.3's phrasing
that read monotonic readings as timestamps is withdrawn.

RENEWAL, as v0.3's corrected rule: candidate `cand_A(seq) := t_send + ttl −
S_skew` recorded at the send of `renew{seq}`; the old committed `deadline_A`
stands; the holder sets `deadline_H := max(deadline_H, now_H + ttl +
S_skew)` at processing and answers `renewed{seq, state}` where `state` is
its holder state at processing; the authority commits `deadline_A :=
cand_A(seq)` only on a `renewed` whose `seq` names the latest candidate and
whose `state ∈ {HELD, RENEWING-H}`, and only while `now_A < deadline_A` and
`now_A < cand_A(seq)`. A duplicate `renewed` for an already-committed `seq`
resets nothing (the candidate is consumed on commit). The margin at every
accepted renewal is the same formula with `δ` the delay of that renew.

RECOVERY, a reservation of the same shape. When `deadline_A` passes without
a matching `renewed`, the authority is SUSPENDED and relying on nothing; the
old commitment has expired and there is nothing to keep. It sends
`renew{seq}` as a RECOVERY RENEW on any duty-capable channel, recording
`cand_A(seq) := t_send + ttl − S_skew` at the send, for up to `T_recover`.
It commits `deadline_A := cand_A(seq)` only on a `renewed{seq, state}` with
`state ∈ {HELD, RENEWING-H}`: the holder was still holding at processing.
A holder that has expired, is terminal, or is UNCERTAIN answers with its
retained terminal or `lease-uncertain`, and the authority does not commit.
Aster's counterexample (recovery sent at 120, processed at 120 with
`deadline_H` 245, reply at 140): the candidate is `120 + 115 = 235 ≤ 245`;
a receipt-relative `140 + 115 = 255` is never computed. v0.3's "fresh
`deadline_A`" in SUSPENDED and L7b's assignment at send are both withdrawn.
Traces L7b (repaired), L20.

## Uncertainty: the exit rule

As v0.3, with the exit made exact: a holder in UNCERTAIN leaves it for a
lease only on a FRESH authority frame for that id, meaning one that passes
frame admission in the current session with `seq` strictly above the last
processed for the id, or on a trusted elapsed-time source showing the
deadline passed. A replayed or already-answered `renew` is not release
evidence. A deadline recorded before the suspension is never compared
numerically against a clock whose behaviour across the suspension is
unknown; UNCERTAIN exists so that comparison is not made.

## Handoff activation: OPEN

v0.3 said the heir acts once HELD and attested, and the giver serves until
it receives `committed`. A sent `committed` tells the heir nothing about the
giver's receipt, so for a bounded interval both or neither may be acting.
That is an EXCLUSIVE action and it is fenced by the epoch certificate the
authority adapter must supply: the adapter defines the heir's ACTIVATION
event and the giver's STOP event so that they cannot overlap, by the
certificate's order. Until the adapter exists, handoff activation is
recorded OPEN and no completed handoff guarantee is claimed. The row in the
role table says so.

## What this design does not establish

As v0.3, and: the handshake freshness the session binding needs (the
adapter); handoff activation (the adapter); that a reordered grant is ever
admitted (it is refused and reissued).

## Parameters for David

As v0.3, plus: `L_live` 16 per (authority incarnation, holder); `L_term`
256; `L_inc` 8; each with the condition "a `lease-limit` report at step 4
means the limit is too small for that class".

## Appendix: traces

L1, L2, L3b, L4b, L8, L9b, L10, L11, L12, L13, L15, L16, L17, L18 as v0.3,
re-read against frame admission.

**L7b, repaired.** `renew{6}` sent at `@A=100`: `cand_A(6) = 215`,
`deadline_A` stays at its last commit, 155. No `renewed` by 155: SUSPENDED,
relying on nothing from 155. Recovery renew `{7}` sent at 160: `cand_A(7) =
275`. H2 is enlisted separately at 220 under a new id (non-exclusive overlap
permitted; exclusive actions fenced, unavailable). `renewed{6, HELD}` from H
arrives at 290: `seq 6` is not the outstanding candidate (7) → ignored. If
`renewed{7, HELD}` had arrived at 200: committed, `deadline_A = 275`, with
H's `deadline_H ≥ t_H(renew 7) + 125 ≥ 160 + 125 = 285 > 275`.

**L14b. Delayed old grant after holder restart.** Holder restarts: new
`inc_h'`, new session `σ'`. A `grant{(inc_a, inc_h, 3)}` from the old
session arrives late on a channel of `σ'`: frame admission step 1 fails
(session mismatch) → `lease-retired-session`, discarded. It never reaches
the barrier. The authority learns by `lease-stale-holder` on its next
renew, voids, and reissues under `(inc_a, inc_h', 1)`.

**L19. Out-of-order grants.** Authority issues `(inc_a, inc_h, 1)` then
`(inc_a, inc_h, 2)`; `2` is delivered first: high-water 2, accepted. `1`
arrives: `1 ≤ 2`, not live, not retained → `lease-stale` (a conservative
refusal; the grant was legitimate and reordered). Authority voids `1` and
reissues as `3`: `3 > 2`, accepted. One round trip lost; no forgotten grant
admitted.

**L20. Recovery against an uncertain holder.** SUSPENDED at 155; recovery
renew `{7}` sent at 160, `cand 275`. H is UNCERTAIN after a suspension. H
processes `renew{7}`: it is FRESH (`seq 7 > 6`), so H leaves UNCERTAIN, sets
`deadline_H`, answers `renewed{7, HELD}`. A commits 275. Variant: the
frame reaching H is a replay of `renew{6}`: not fresh; H stays UNCERTAIN,
answers `lease-uncertain`; A does not commit.

**L21. Resource limit.** Holder has `L_live` = 16 live leases from
`inc_a`. A seventeenth `grant`: refused `lease-limit`, reported; no live
lease evicted; the authority reissues elsewhere.
