# Duty leases (v0.3)

**Status:** design for council review, revision 3 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.2 (axona-docs `3c31d9d`), v0.1
(`b923e54`), both left in place as record · **Revision driver (v0.3):** Aster
`5c2829a0` and Vega `20ffbce9`, decisions recorded at `e44992ea`. The v0.2
errors: the suspension fallback released a holding obligation while the
authority still relied, which is the one thing a holder must never do;
relative renewal shrank the safety margin by `2ρd` per renewal under
permitted rate drift and let the deadline horizon grow without bound; the
terminal-retention rule could not tell a forgotten old grant from a new one;
the UNAVAILABLE column required a certificate for every grant in one place
and called grant rules available in another; "newer replica" was not a
receipt; L7's "never conflicting" did not follow; and the role table named
kernel frames that do not exist, as Vega read against source.

Then Aster `64efc680`, before this file froze: `e44992ea` announced that
the authority would set its new deadline at the SEND of a renew, which
leaves it relying past a holder that expired on the old deadline when the
renew is lost; the rule here keeps the old commitment and commits the
candidate only on a matching receipt.

**What changed from v0.2:** UNCERTAIN as a state that retains and does not
serve; renewal that re-establishes the margin from local readings at local
events with a bounded horizon; a grant admission barrier per authority
incarnation with the holder's incarnation on every frame; one consistent
availability rule; every role row marked PROPOSED with its source→proposed
transition; attested receipts for custody; exclusive actions fenced by the
certificate; eight new traces. *The question*, *What this protocol is not*
and *Root fencing is an open prerequisite* stand as v0.2 wrote them.

This document is a design. It changes no code. Deploy is David's.

---

## The clock model

- Every deadline is a reading of the end's own MONOTONIC clock at an event
  at that end. No absolute time crosses a clock boundary after issue; the
  grant carries `ttl` as a duration and nothing else about time.
- RATE: each clock runs within `1 ± ρ` of true time. Rate enters the
  arithmetic once per interval, bounded by `ρ × ttl` per interval, and does
  not accumulate across renewals because every renewal starts from a fresh
  reading (below).
- OFFSET: no offset assumption is made after grant. v0.2's grant-time offset
  check is dropped: a one-time comparison of `issuedAt` to a local clock
  cannot separate offset from delay and certifies nothing about later
  intervals. The holder keeps one heuristic refusal: if the apparent delay of
  the grant exceeds `D_max + S_skew`, it refuses with `lease-skew`. That is a
  service filter, not a bound.
- DELAY: one-way delivery takes at most `D_max`, an assumption. Every claim
  that depends on it says so.
- WALL TIME: the protocol never reads wall time to set a deadline. It reads
  wall time exactly once, at resume from suspension, as an UNTRUSTED hint,
  and wall steps are in the assumptions: a forward step makes the hint
  larger than true elapsed time, a backward step smaller, and the hint is
  never a reason to release.
- SUSPENSION: see *Uncertainty*.
- RESTART: a process starts with no leases. Both ends' incarnations are on
  every frame (below).

## Uncertainty

A holder that resumes from suspension does not know how long it was gone. A
holder that cannot read a trusted elapsed time, or whose monotonic clock may
have stopped, enters UNCERTAIN for every lease it holds. In UNCERTAIN the
holder:

- performs NO new lease-scoped work;
- RETAINS every holding obligation and all custody;
- leaves UNCERTAIN for a lease only on SAFE EVIDENCE: a `renew` or `revoke`
  or `void` from the authority for that lease (which also re-establishes the
  deadline), or a trusted elapsed-time source showing the lease's deadline
  has passed, in which case the lease expires as under *Deadlines*.

The authority on resume enters UNCERTAIN for every lease it grants: it
continues relying on nothing new, sends `renew` for each lease it holds in
GRANTED, and treats a lease as expired only on trusted elapsed time or on the
holder's `released`. A holder in UNCERTAIN that receives a `renew` answers
it and leaves UNCERTAIN. Trace L9 is rewritten on this; v0.2's "expires
everything on resume" is withdrawn as a release while the authority relies.

The state table separates two columns per lease: CAN SERVE (lease-scoped
work permitted) and RETAINS (custody and obligation held). UNCERTAIN is
`can-serve: no, retains: yes`.

## Definitions

- `L = {id, topic, role, authority, holder, E, seq, ttl, counter}`.
- `id = (inc_authority, counter)`: the authority's incarnation and a
  per-incarnation counter, increasing by one per lease issued.
- Every frame carries `inc_authority` and `inc_holder`, the two live
  incarnations as bound in the channel's handshake.
- `E`: the epoch certificate, required and not supplied (v0.2). Within one
  authority incarnation `E` is constant.
- `seq`: increments on every authority frame about `L`; the holder's frames
  echo the `seq` they answer.

## Grant admission at the holder

Per authority incarnation it has seen, the holder keeps: the HIGH-WATER
counter (the largest `counter` of any grant it has processed), the set of
LIVE ids (HELD, RENEWING-H, UNCERTAIN), and the terminal-retention window
(VOID and RELEASED ids with their last `seq`, kept for `T_term`).

A `grant` is handled by, in order:

1. `inc_authority` is not the live incarnation on the arrival channel →
   discarded, `lease-stale-authority`.
2. `id` is live → duplicate, answered with the current `accept`.
3. `id` is in terminal retention → answered with the retained terminal.
4. `counter ≤ high-water` and `id` is in none of the above → a FORGOTTEN OLD
   GRANT; rejected `lease-stale`. The holder cannot have missed a lower
   counter it should have taken, because grants to this holder from this
   incarnation are numbered consecutively and a gap below the high-water
   means the authority voided or the holder released it.
5. `counter > high-water` → new; high-water advances; proceed to accept.

The authority numbers grants consecutively PER HOLDER within its incarnation
(so rule 4 holds), carrying the per-holder counter in `id`. A holder restart
resets the high-water to zero under a NEW `inc_holder`; a `renew` carrying an
`inc_holder` that is not the live one is rejected `lease-stale-holder`, so a
restarted holder is never renewed into a lease it does not hold; the
authority, on that rejection, treats the lease as lost and runs recovery.

## The frames and their ordering

As v0.2, plus `lease-stale`, `lease-stale-authority`, `lease-stale-holder`.
`seq` ordering per id: lower is late and discarded; equal is a duplicate and
answered idempotently from current or retained state; higher is processed.
GAPS ARE ALLOWED in `seq`: a holder that missed `renew{4}` and receives
`renew{5}` processes it, because every renew carries the lease's full
current terms (`ttl`, `E`, `counter`), not a delta. v0.2's "next expected
seq" is withdrawn; L3b stands as written.

## Deadlines

INITIAL. Authority, at the instant it sends `grant`: `deadline_A := now_A +
ttl − S_skew`. Holder, at the instant it sends `accept`: `deadline_H :=
now_H + ttl + S_skew`. The holder's event is later than the authority's by
at least the delivery delay of the grant, so in true time the holder's
deadline exceeds the authority's by at least `2·S_skew + delay − 2·ρ·ttl`,
which is positive under `ρ × ttl < S_skew`. The authority stops relying
first. Conditional on RATE and DELAY, stated.

RENEWAL, CANDIDATE AT SEND, COMMITTED ON RECEIPT. At `ttl/3` after its last
committed deadline-setting event, the authority sends `renew{seq, ttl, E,
counter}` and records a CANDIDATE `cand_A := now_A + ttl − S_skew`. It does
NOT change `deadline_A`; the old committed deadline stands and is the only
thing the authority relies on. The holder, at the instant it processes the
renew, sets `deadline_H := max(deadline_H, now_H + ttl + S_skew)`, a
non-decreasing rule, so a reordered or retried renew can never shorten a
longer promise, and answers `renewed{id, inc_authority, inc_holder, E, seq,
ttl}`. The authority COMMITS `deadline_A := cand_A` only on a `renewed` that
matches all of: the lease id, both live incarnations, `E`, the `seq` of the
latest renew it sent, and the `ttl` it sent; and only while `now_A <
deadline_A` (the old commitment is still valid) and `now_A < cand_A`. A
`renewed` that fails any of those is ignored, and if the old deadline has
passed the authority is already SUSPENDED.

Aster `64efc680`'s run, under this rule: grant at 0, `deadline_A` 115,
`deadline_H` 125; renew sent at 40, `cand_A` 155, `deadline_A` still 115;
the renew is lost; H releases lease-scoped work at 125; A's old deadline
passes at 115, before H released, and A is SUSPENDED and relying on nothing
from 115. The inequality holds because reliance was never extended on send.

The real-time inequality for each accepted renewal: the holder's event
(processing the renew) is later in true time than the authority's event
(sending it) by the delivery delay `δ ≥ 0`; `deadline_H_new ≥ t_H + ttl +
S_skew` and `deadline_A_new = t_A + ttl − S_skew` with `t_H ≥ t_A + δ`; so
in true time `deadline_H_new − deadline_A_new ≥ 2·S_skew + δ − 2·ρ·ttl > 0`
under `ρ × ttl < S_skew`. The authority commits that `deadline_A_new` only
after the holder has set `deadline_H_new`, because the `renewed` was sent
after. What is retained when the `renewed` is lost: the holder's extension
stands on its side; the authority keeps its OLD deadline, expires on it,
and runs recovery; the holder is holding longer than the authority relies,
which is the permitted direction.

Why the margin does not accumulate: each renewal sets both deadlines from
fresh local readings at two delivery-ordered events, as the grant did. Why
the horizon is bounded: `deadline_A` is at most `t_A(last renew sent) + ttl
− S_skew` and is committed only when acknowledged; an authority whose
renewals go unanswered relies no later than its last committed deadline.
v0.2's `deadline += extendBy` and `e44992ea`'s "set at send" are both
withdrawn. An acknowledged retention is still not proof of replication or
custody completeness; that is *Custody, receipts*.

SUSPENDED. When `deadline_A` passes without a matching `renewed`, the
authority stops relying and enters SUSPENDED: it keeps sending `renew` on any
duty-capable channel to the holder for `T_recover`, and on a `renewed` with
the latest `seq` before `T_recover` passes it returns to GRANTED with a fresh
`deadline_A`; otherwise it runs the role's recovery. The holder, past its own
`deadline_H` with no frame, expires with `lease-expired`: can-serve becomes
no; custody is retained under *Custody*.

## The lifecycle: void, revoke, loss

As v0.2: VOID at `T_offer` with `seq 2`, retained `T_term`, late accepts
answered with the retained void; REVOKING entered before the frame is sent,
`released` as accounting (L4b); loss suspends and never releases; recovery
renews on a new channel with the next `seq`, and old-channel frames are
ordered by `seq` (L3b).

## Availability

One rule, replacing v0.2's two sentences that disagreed. The SINGLE-AUTHORITY
SUBPROTOCOL (grant, accept, void, renew, revoke, loss, recovery, admission
barrier, uncertainty) is specified with the authority GIVEN AS AN
ASSUMPTION. It is AVAILABLE FOR ANALYSIS, testing and review on that
assumption. It is UNAVAILABLE FOR ANY REAL ROOT, HOST OR HANDOFF DUTY until
the authority adapter exists: the epoch certificate from root fencing, which
this document requires and does not supply. Every row of the role table is
PROPOSED and is unavailable for the same reason. Nothing in this document is
available without the certificate except its own analysis.

## Roles: source → proposed

Vega `20ffbce9` read v0.2's role table against the kernel and found that
three of its four names were not kernel frames. The table is rewritten as
transitions from what the kernel does to what is proposed, each marked
PROPOSED:

| role | what the kernel does today (source) | what is proposed | grantor → holder | custody release |
|---|---|---|---|---|
| backup | the backup is the RECEIVER of `REPLICATE`: `_onReplicate` → `_syncIngest` (policy REPLICATE) → `becomeBackup` (`wireHandlers.js:901–906`, `syncEngine.js:229–243`); it sends nothing first; the cache is stored and not served until that node becomes root | a `grant{role: backup}` PRECEDES the first `REPLICATE`; the holder's `accept` is the frame v0.2 lacked; `REPLICATE` continues as the payload under the lease | root → backup | an ATTESTED RECEIPT from the root naming object set, version and coverage, or explicit discharge, or the role's loss policy |
| replication target | as backup | as backup | root → target | as backup |
| host | `peer.host()` is LOCAL (`AxonaPeer.js:2727–2768`): no frame, no second node; a topic means a neighbourhood check then `pubsubHost` | a NEW protocol: `grant{role: host}` from the topic's root to the host, so hosting becomes a held duty the root knows about; `peer.host()` without a root lease stays what it is today and is outside this document | root → host | attested transfer of hosted data, or discharge, or the role's loss policy |
| handoff | frames `pubsub:handoff` and `pubsub:handoffack`; the heir calls `_becomeRoot('handoff-heir')` BEFORE the ack (`syncEngine.js:204–219`); a short ack is not an ack (`wireHandlers.js:879–882`); the leaver retries while the heir is already root | a NEW frame `handoff:committed`, sent by the heir only after its own role lease is HELD and the handoff data's completeness is ATTESTED; the giver's discharge moves from "ack received" to "committed received"; the heir's early `_becomeRoot` is an EXCLUSIVE ACTION and is fenced by the certificate, so this row is doubly unavailable | giver → heir | `handoff:committed` with attestation |
| the step-down hold's forward | `_holdIntercept` redirects a bare SUB, PUB or KILL toward the named root or drops a returning copy (`wireHandlers.js:206–248`) | nothing; a forward is not an obligation and leaves the table (Vega) | — | — |
| the epoch | `become()` mints `role.epoch = knownEpoch + 1` locally; `demote()` writes `_stepDownHold` on this node only (`rootClaim.js:372–390`); neither reaches another node | not `E`; `E` is the certificate root fencing must supply | — | — |

## Custody, receipts, exclusive actions

CUSTODY is retained until one of: an ATTESTED RECEIPT from the authority
naming the object set, the version and the coverage it now holds (a bare
"newer" is not a receipt); an explicit discharge frame; or the role's own
loss policy, named in the role's design, never here.

OVERLAP. An unrevoked old holder and a replacement holder may both perform
lease-scoped work at once; this document permits that for NON-EXCLUSIVE
duties (forwarding, serving reads, holding a replica). EXCLUSIVE actions
(acting as the single root for a topic, acknowledging a handoff, any action
whose externally visible effect must come from one node) are FENCED BY THE
EPOCH CERTIFICATE and are UNAVAILABLE until it exists. v0.2's "wasted, never
conflicting" in L7 is withdrawn; L7 now reads "overlapping non-exclusive
work is permitted; exclusive actions are fenced".

ACTIVATION, handoff: the heir acts on the role only after its own lease for
the role is HELD and the handoff data's completeness is attested; the giver
discharges custody only on `handoff:committed` carrying that attestation;
until then the giver serves and the heir does not. Both are exclusive
actions and are fenced.

## What this design does not establish

As v0.2, and: that the single-authority subprotocol is safe for any real
duty without the certificate; that UNCERTAIN ends (a holder with no trusted
elapsed-time source and no authority frame stays UNCERTAIN, retaining, until
one arrives, and that is the intended outcome); the loss policy of any role.

## Parameters for David

As v0.2, with: `T_recover` 60 s (the authority's recovery window after its
deadline, bounded by the time a role can be without its duty, which each
role's design must say); `T_term` 2 × `ttl`; the `ρ × ttl < S_skew` condition
stated as the one the arithmetic needs.

## Appendix: traces

Notation as v0.2; counters shown where they matter.

**L1, L2, L3b, L4b, L8, L10.** As v0.2 except: L2's renewal re-establishes
(`deadline_A := now_A + 115`, `deadline_H := max(prev, now_H + 125)`), no
accumulation; L10 adds the activation fence (heir holds its own lease and the
attestation before acting; giver discharges on `committed`).

**L7b. Delayed `renewed` after authority expiry, with overlap.** `renew{6}` at
`@A=100`, `deadline_A := 215`. No `renewed` by 215: SUSPENDED, `T_recover`
to 275; recovery at 275: re-grant to holder H2 under a new id. `renewed{6}`
from H at `@A=290`: at or after the deadline → rejected. H holds its lease
until its own `deadline_H`; H and H2 both forward (non-exclusive) for the
overlap; neither acts as root (exclusive, fenced, unavailable). No claim of
"never conflicting".

**L9b. Suspension, uncertainty.** H HELD with 100 s remaining; brief
suspension; on resume H cannot trust elapsed time: H → UNCERTAIN for the
lease: `can-serve: no, retains: yes`. A, not suspended, is GRANTED and still
relying; A's next `renew{7}` arrives; H processes it, re-establishes
`deadline_H`, answers `renewed{7}`, leaves UNCERTAIN → HELD. Nothing was
released while A relied. Variant: A also suspended; both UNCERTAIN; A sends
`renew` on resume (its UNCERTAIN behaviour), H answers, both leave
UNCERTAIN. Variant: no frame ever arrives and no trusted elapsed time: H
stays UNCERTAIN, retaining, indefinitely; stated as intended.

**L11. Drift over many renewals.** `ρ = 10⁻⁴`, `ttl = 120`, `S_skew = 5`.
Each renewal sets both deadlines from fresh readings; per-interval rate
error is at most `ρ × ttl = 0.012 s`; the margin at every renewal is at
least `2 × 5 − 2 × 0.012 > 0` in true time. After 1,000 renewals the margin
is the same; nothing accumulated.

**L12. Horizon.** Authority renews at `@A=40, 80, 120, …`; each `renewed`
arrives within 4 s; each time the commit is `deadline_A := t_send + 115`.
Renewals stop after the one sent at 400 and acknowledged at 404:
`deadline_A = 515`; the authority relies until 515 and no later. Under
v0.2's `+=` rule it would have relied until `115 + 10 × 120 = 1315`.

**L17. Lost renew.** Grant at 0: `deadline_A` 115, `deadline_H` 125. Renew
sent at 40: `cand_A` 155, `deadline_A` 115. Renew lost. At 115 A: SUSPENDED,
relying on nothing, `T_recover` to 175, re-sending renew. H at 125:
`lease-expired` for lease-scoped work, custody retained. A re-grant at 175
to H under a new id if a channel exists. At no instant did A rely on a
holder that had released.

**L18. Renew delivered after the old holder deadline.** As L17 but the
renew sent at 40 is delayed and arrives at H at 130. H expired at 125 and
holds the id in terminal retention: it answers with its retained terminal,
not `renewed`. A, already SUSPENDED since 115, ignores a non-matching reply
and continues recovery. The late delivery extended nothing.

**L13. Forgotten old grant.** Authority `inc_a`, holder H has processed
grants with counters 1..7 to it; `id (inc_a, 7)` released and its retention
expired. `grant{(inc_a, 5)}` replayed: counter 5 ≤ high-water 7 and not live
and not retained → `lease-stale`. `grant{(inc_a, 8)}`: new; high-water 8;
accepted.

**L14. Holder restart.** H restarts: new `inc_h'`, high-water 0, no leases.
A sends `renew{9}` for `id (inc_a, 8)` carrying `inc_h`: not the live holder
incarnation on the channel → `lease-stale-holder`; A treats the lease as
lost, runs recovery, and a fresh `grant{(inc_a, 9)}` to H under `inc_h'` is
accepted as new.

**L15. Lost `renew`, then the next.** `renew{4}` lost; `renew{5}` arrives at
H: `seq 5 > 3` → processed, deadline re-established, `renewed{5}`; A's
outstanding is 5 → GRANTED. Gap tolerated because the renew carries full
terms.

**L16. Custody receipt.** Backup H holds replica `{objects o1..o9, version
v12}` under a lease that expires. Root R sends `discharge{receipt: {o1..o9,
v12, coverage: full}}`: H releases custody. Variant: R's receipt names `v11`
or `o1..o8`: H retains and reports `custody-receipt-short`.
