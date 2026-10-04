# Duty leases (v0.5)

**Status:** design for council review, revision 5 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.4 (axona-docs `02375b6`) and
earlier, all left in place as record · **Revision driver (v0.5):** Aster
`9e1247d3`. Aster recorded the margin, the conservative refusal and the
holder scoping as correct for the stated model. The v0.4 errors that
remained: a terminal state answered ANY frame with its terminal, so two
terminal ends could exchange receipts for ever with no loss; `L_term` could
refuse a release the lifecycle requires; the UNCERTAIN exit rule and trace
L20 disagreed about whether the reported state is pre- or post-transition,
and the new deadline took a `max` against an untrusted pre-suspension
value; the recovery commit lacked the active-candidate and recovery-window
guards; the authority's UNCERTAIN state had no receiver row; and L7b
compared readings across clocks while claiming a duration argument.

Then Aster `8ed83bb2`, before this file froze: counting only live leases
is unbounded across repeated batches, so one conserved bound covers live,
retained and in-flight; and a repeated request must always be answered or
a lost receipt is never repaired.

**What changed from v0.4:** request and response frame classes; one
conserved slot bound reserved at admission; the UNCERTAIN exit stated exactly, with the
new interval set from the holder's own event and no `max`; four atomic
guards on the recovery commit with candidate consumption; the authority's
UNCERTAIN receiver row; L7b labelled; traces L22–L25 added. Everything
else stands as v0.4 and v0.3 wrote it and is not repeated.

This document is a design. It changes no code. Deploy is David's.

---

## Requests and responses

Every frame is in one of two classes, fixed by type:

| class | frames |
|---|---|
| REQUEST | `grant`, `renew`, `revoke`, `void` |
| RESPONSE | `accept`, `renewed`, `released`, `lease-stale`, `lease-uncertain`, `lease-stale-authority`, `lease-stale-holder`, `lease-retired-session`, `lease-limit`, and every TERMINAL RECEIPT (a retained `void` or `released` sent as an answer) |

A terminal state answers only a REQUEST, with its terminal receipt. A
RESPONSE never provokes a RESPONSE: a terminal receipt arriving at a
terminal end is processed (it may confirm the terminal) and answered with
nothing. Because responses never elicit responses, answering a REPEATED
authenticated request is loop-safe, and so EVERY repeat of a request is
answered, idempotently, from current or retained state. There is no
suppression by `seq`: suppressing a retry would leave a requester whose
first receipt was lost without its receipt for ever (Aster `8ed83bb2`).
Rate limiting, if ever wanted, is a separate rule with its own request-
attempt identity and is not in this document. Trace L24 (both terminal,
no loss: one receipt, then silence). Trace L25 (lost terminal receipt, then
the same-`seq` retry: answered again).

## Slot capacity, one bound

v0.5 as announced counted only live leases, which is unbounded: admit
`L_live`, release them, admit `L_live` again inside `T_term`, and the
terminals accumulate (Aster `8ed83bb2`). There is ONE bound, `L_slots`,
per (authority incarnation, holder), over the sum of:

```
LIVE (HELD, RENEWING-H, UNCERTAIN) + RETAINED (terminals inside T_term) + IN-FLIGHT (grants received and not yet answered)
```

checked ATOMICALLY at grant admission: a grant is admitted only if the sum
is below `L_slots` after counting it, and the slot it takes is reserved at
that instant. A slot is conserved through the lifecycle: IN-FLIGHT → LIVE
on accept, LIVE → RETAINED on release or void, RETAINED → free after
`T_term`. Release never needs new capacity, consumes the space its own
grant reserved, and is never refused. `L_live` and `L_term` as separate
limits are retired; `L_slots` replaces both.

Trace L21c, repeated batches: `L_slots` 32, `T_term` 240 s. Admit 16 (sum
16), release 16 at `t = 60` (sum 16, all retained), admit 16 at `t = 70`
(sum 32), release 16 at `t = 120` (sum 32, all retained), a seventeenth
grant at `t = 130`: sum would be 33 → refused `lease-limit`. At `t = 300`
the first batch's terminals age out (sum 16); grants are admitted again. No
release was refused at any point; the sum never exceeded 32.

## UNCERTAIN: the exit, exactly

`response.state` in every holder response is the holder's state BEFORE it
processed the frame it is answering.

A holder in UNCERTAIN that processes a FRESH authority frame for a lease
(frame admission passes; `seq` strictly above the last processed for the
id; current session):

- on `renew`: establishes a NEW HOLDING INTERVAL, `deadline_H := now_H +
  ttl + S_skew`, from its own processing event, with NO `max` against any
  value recorded before the suspension; answers `renewed{seq, state:
  UNCERTAIN}`; leaves UNCERTAIN for HELD.
- on `revoke` or `void`: releases, answers, leaves UNCERTAIN for the
  terminal.

The authority treats `renewed{seq, state: UNCERTAIN}` for an outstanding
candidate as COMMIT-ELIGIBLE: the holder's new deadline was set from the
holder's processing event and the candidate from the authority's send, so
the margin inequality applies to that pair of events as to any renewal.
What `seq` freshness means and does not mean, stated: a fresh frame is one
the holder has not processed; it says nothing about when it was sent
relative to the holder's resume, and under unbounded transit delay a
fresh renew still establishes the new interval from the holder's processing
instant, which is the safe direction because the holder holds at least as
long as that. It is not evidence for custody release. The admission table,
this rule and L20 use these words.

## Recovery commit: four guards, atomic, consuming

The authority, SUSPENDED and sending recovery renews, commits
`deadline_A := cand_A(seq)` only when all four hold at the instant it
processes the `renewed`:

1. OUTSTANDING: the candidate for that `seq` exists and has been neither
   consumed nor invalidated.
2. ACTIVE: `now_A < cand_A(seq)`.
3. WINDOW: `now_A < deadline_opened + T_recover`, where `deadline_opened`
   is the committed deadline whose passing opened recovery.
4. MATCH: the `renewed` names that `seq`, both live incarnations, `E`, the
   `ttl` sent, and `state ∈ {HELD, RENEWING-H, UNCERTAIN}`.

On commit the candidate is CONSUMED. On the candidate's own expiry
(`now_A ≥ cand_A(seq)`) or on the window's end, the candidate is
INVALIDATED. A matching `renewed` arriving after either is ignored
(trace L22). All four guards and the commit are one synchronous step; no
return to a relying state happens outside it.

THE AUTHORITY'S UNCERTAIN STATE, receiver row: an authority that resumed
with untrusted elapsed time holds, per lease, an UNCERTAIN mark; it issues
a recovery renew for each and records its candidate at that send, AFTER
resume; it accepts a `renewed` only for a candidate issued after resume,
by guard 1 (pre-resume candidates are invalidated at resume); it never
compares any pre-resume deadline, which is why those candidates are
invalidated, never evaluated (trace L23).

## Small correction

L7b's numbers are an EQUAL-CLOCK, `ρ = 0` illustration and are labelled so;
the duration inequality under *Deadlines and the exact margin* is the
argument for arbitrary offsets and rates.

## What this design does not establish

As v0.4, and: any temporal meaning of `seq` freshness; that an UNCERTAIN
holder ever leaves UNCERTAIN (it does so only on an authority frame or
trusted elapsed time, and may wait indefinitely, which is intended).

## Parameters for David

As v0.4 without `L_live` and `L_term`; `L_slots` 32 per (authority
incarnation, holder), with "a `lease-limit` report at step 4 under normal
load means `L_slots` is too small for `T_term` at that grant rate".

## Appendix: traces

L1–L21 as v0.4 (L20 re-read against the exit rule above; L7b labelled).

**L21b. Saturation with live leases.** `L_slots` 32: 32 live. `revoke` on
lease 3: released; slot 3 converts to retained for `T_term`; the sum stays
32; a new `grant`: refused `lease-limit`; after `T_term` slot 3 frees (sum
31) and the next grant is admitted. No release was refused at any point.

**L22. Late matching recovery receipt.** SUSPENDED at 155; recovery renew
`{7}` sent at 160, `cand 275`, window to 215. `renewed{7, HELD}` arrives at
230: guard 3 fails (window ended at 215; candidate invalidated then) →
ignored; the authority stays in recovery or has run the role's recovery.
Variant: arrives at 280: guard 2 fails (`cand` 275 passed) → ignored.
Variant: arrives twice at 200 and 205: first commits and consumes; second
fails guard 1 → ignored.

**L23. Authority resume.** The authority resumes with untrusted elapsed
time holding leases 1–3 GRANTED. All three get UNCERTAIN marks; their
pre-resume candidates and deadlines are invalidated, never compared. It
sends recovery renews `{seq+1}` for each at resume, recording candidates at
those sends. Holder responses matching those candidates commit by the four
guards; a `renewed` for a pre-resume `seq` fails guard 1.

**L24. Both terminal.** A is VOID for id 9 (retained), H is RELEASED for
id 9 (retained). A's retained `void{9, seq 2}` reaches H as a late
REQUEST: H answers once with its terminal receipt `released{9}`. The
receipt reaches A: a RESPONSE at a terminal end; A processes it (confirms
terminal) and sends nothing. Silence. A replay of the same `void{seq 2}`
at H: equal `seq`, duplicate request → answered once more (idempotent),
which again provokes nothing at A.

**L25. Lost terminal receipt, then retry.** A is VOID for id 9; A's
retained `void{9, seq 2}` reaches H (RELEASED); H answers `released{9}`;
the receipt is LOST. A, still wanting its accounting, re-sends `void{9,
seq 2}` after its retry interval: equal `seq`, a repeated request → H
answers `released{9}` again, idempotently. It arrives. A confirms. No
suppression blocked the repair; the repeated answer provoked nothing at A
because a receipt is a response. Variant, delayed duplicate of a live
`renew{5}`: both deliveries answered with the same `renewed{5}`; the
authority's guard 1 ignores the second (candidate consumed).
