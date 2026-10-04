# Duty leases (v0.6)

**Status:** design for council review, revision 6 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.5 (axona-docs `559c50a`) and
earlier, all left in place as record · **Revision driver (v0.6):** Aster
`48a8a468`. Aster recorded as scoped closures: the conserved capacity, the
request-only terminal answering with repeat answering, fresh holding
intervals, and the atomic recovery guards. The v0.5 gaps: the authority's
post-resume recovery window had no valid origin once pre-resume deadlines
were invalidated; `void` appeared in both frame classes, so a receiver's
own state was being used to classify; and the slot admission inequality
contradicted its own traces.

**What changed from v0.5:** a post-resume recovery-window origin of its
own; the frame class on the wire and a terminal-receipt type; admission as
`≤` after counting with the aggregate scope stated; traces L26, L27.
Everything else stands as v0.5, v0.4 and v0.3 wrote it.

This document is a design. It changes no code. Deploy is David's.

---

## The frame class, on the wire

Every frame carries `cls ∈ {request, response}` and a `type`. The
classes are fixed by `type`, and no `type` is in both:

| cls | types |
|---|---|
| request | `grant`, `renew`, `revoke`, `void` |
| response | `accept`, `renewed`, `released`, `lease-stale`, `lease-uncertain`, `lease-stale-authority`, `lease-stale-holder`, `lease-retired-session`, `lease-limit`, `terminal-receipt` |

`terminal-receipt { for ∈ {void, released}, id, seq }` is the ONLY thing a
terminal state sends as an answer; a retained `void` is never re-sent as a
`void`. An original or retried `void` from an authority that is voiding is
`type void, cls request`, whatever that authority's state for other
leases. Receivers classify by `cls` and `type` on the wire and never by
their own state and never by "retained". The invariant "a response never
provokes a response" is then checkable at the frame boundary: a receiver
sends nothing in reply to any frame with `cls = response`.

Trace L27: authority A is VOID for id 9 (retained). A late `accept{9, seq
1}` (`cls response`) arrives: a response, so A sends nothing by the
invariant; but the holder needs its receipt, so the rule for terminal
states is stated as: a terminal state answers a REQUEST with
`terminal-receipt`, and ALSO answers a late `accept` (the one response that
expects a reply, because it completes a request the terminal end
originated) with `terminal-receipt{void}`; `accept` is listed as the single
exception, by type, on the wire. The holder receives `terminal-receipt`
(`cls response`): releases if not already, sends nothing. Both ends
classified by `cls`; neither consulted its own state.

## The post-resume recovery window

The authority-UNCERTAIN transition has its own window origin. At resume
the authority invalidates every pre-resume candidate and deadline for its
leases (v0.5) and records, per lease, `resume_origin := now_A` at the
instant of the FIRST post-resume recovery send for that lease (not at the
resume itself; the send is the first event whose reading the transition
uses, and nothing earlier is trusted). Guard 3 for this transition reads
`now_A < resume_origin + T_recover`. It is used only for the authority-
UNCERTAIN transition; the ordinary SUSPENDED window keeps its origin at the
committed deadline that opened recovery, and the two are never mixed.
Guards 1, 2 and 4 are unchanged.

Trace L26: authority resumes; its monotonic clock is discontinuous across
the suspension (untrusted). Lease 5 is marked UNCERTAIN; its old candidate
(seq 7) and deadline are invalidated, never read. First post-resume
recovery send for lease 5 at `now_A = 1000` (a reading on the post-resume
clock): `resume_origin := 1000`, `cand(8) := 1115`. A late `renewed{7}`
arrives: guard 1 fails (candidate 7 invalidated at resume) → ignored. A
`renewed{8, HELD}` arrives at 1050: guards 1–4 hold (`1050 < 1115`, `1050 <
1000 + 60`) → commit, candidate 8 consumed. A second `renewed{8}` at 1070:
guard 1 fails → ignored. Had the first `renewed{8}` arrived at 1070 instead:
guard 3 fails (`1070 ≥ 1060`) → ignored, recovery continues with `seq 9`
and a new candidate, the origin unchanged.

## Slot admission, exact

A grant is admitted when `LIVE + RETAINED + IN-FLIGHT + 1 ≤ L_slots`, the
new grant counted; so with `L_slots` 32 the 32nd is admitted and the 33rd
refused, as L21b and L21c show. A duplicate `grant` for a live or retained
id is answered idempotently and allocates nothing; the count is of ids,
not of frames.

SCOPE. `L_slots` is per (authority incarnation, holder). The aggregate a
holder may hold is `L_inc × L_slots` across the authority incarnations it
remembers, and Hold-and-Fill's physical and memory bounds apply on top of
that; `L_slots` alone implies no whole-process memory bound and the
document does not claim one.

## What this design does not establish

As v0.5, and: the `accept` exception is the one place a response is
answered; the traces check that no other response is.

## Parameters for David

As v0.5; `L_inc × L_slots` is the holder's aggregate and is 8 × 32 = 256
leases at the proposed values.

## Appendix: traces

L1–L25 as v0.5, with L24 re-read under the `cls` rule (A's late `void` is
`cls request`; H's `terminal-receipt` is `cls response`; A sends nothing).
L26 and L27 as above.
