# Channel election (v0.6)

**Status:** design for council review, revision 6 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.5 (axona-docs `559c50a`) and
earlier, all left in place as record · **Revision driver (v0.6):** Aster
`48a8a468`, decisions recorded at `93688fed`. Aster recorded as
scoped closures: permanent retired-pair retention, ambiguity before
retirement, and exhaustion distinguished from death, surrender and global
fencing. The v0.5 gaps: the UNRETIRED set was unbounded; exhaustion was
defined only for the current pair and promotion was unspecified; a stall
bound and two "never refused" sentences survived the failure-detector
caveat.

**What changed from v0.5:** one session-record capacity over all three
sets, checked before allocation, with the physical bound applied first;
exhaustion, removal and promotion defined for every tracked pair; the
stall bound withdrawn and the availability tradeoff named; T15's variant
written to the transition; T17 added. Everything else stands as v0.5 and
v0.4 wrote it.

This document is a design. It changes no code. Deploy is David's.

---

## Session records: one capacity

Per peer identity, each end holds SESSION RECORDS in three sets: CURRENT
(at most one), UNRETIRED, RETIRED. ONE bound, `L_sessrec`, covers their
sum. Order of checks on a bind:

1. The bind is a channel first: Hold-and-Fill's physical bound `C_phys`
   and inbound bound apply before anything here; a channel that cannot be
   allocated never reaches session handling.
2. If the pair is in RETIRED: refuse `elect-retired`, close by token
   through the gate. No record is created.
3. If the pair is CURRENT: the channel joins `S`. No record is created.
4. If the pair is in UNRETIRED: the channel joins that pair's channel set
   (not `S`; it is not current). No record is created.
5. Else the pair is new: if `|CURRENT| + |UNRETIRED| + |RETIRED| =
   L_sessrec`, refuse `elect-session-limit`, close by token, create
   nothing. Otherwise create the record in UNRETIRED (or in CURRENT if
   there is no current pair and UNRETIRED is empty).

Moving a record between sets (promotion, retirement) needs no capacity: it
is the same record. So retirement of a tracked pair can never be refused
for space, which is what "reserved by construction" means. `L_sess` as a
separate limit on RETIRED is withdrawn; `L_sessrec` is the only one.

## Exhaustion, removal, promotion, for every pair

EXHAUSTION of a pair, current or unretired, is local observed exhaustion
as v0.5 defines it: every channel of that pair GONE at this end. On
exhaustion the pair's record moves to RETIRED, whichever set it was in.

AMBIGUITY holds while CURRENT exists and UNRETIRED is non-empty, or while
UNRETIRED has more than one pair and CURRENT is empty. It clears when
UNRETIRED becomes empty (its pairs exhausted or, OPEN, superseded by
adapter evidence) with CURRENT intact, which leaves CURRENT and its `S` as
they were; or when CURRENT is exhausted and exactly one pair remains in
UNRETIRED.

PROMOTION: when CURRENT is empty and UNRETIRED holds exactly one pair,
that pair is promoted: its record moves to CURRENT; `S` is rebuilt from
that pair's OPEN channels; the per-session election state for the pair is
reset (`r := 0`, `n := 0`, `g := 0`, `d := none`, `ans := 0`, acks `∅`);
and the first proposal is sent as for a new pair. Nothing from the
previous current session carries over except the retained-duty records,
which are not session state.

T15's two-process variant, written to this: `(a1, b2)` current, `(a1, b3)`
unretired, ambiguous. `b3`'s channels all reach GONE: `(a1, b3)` → RETIRED;
UNRETIRED empty; ambiguity clears; CURRENT `(a1, b2)` and its `S` are
unchanged; elections resume on it. The other order: `b2`'s channels all
GONE first: `(a1, b2)` → RETIRED; CURRENT empty; UNRETIRED = `{(a1, b3)}`;
promotion; `S` rebuilt from `b3`'s channels; fresh election.

## Liveness, and the tradeoff, stated

v0.5's "a restarting peer with no retained duties sees one election stall
of at most the kernel's deadline" is WITHDRAWN. The only liveness claim is
conditional: ambiguity clears when the detector retires the competing
pairs, which needs an awake reaper, channels the detector can retire, and
the kernel's deadline and pong paths firing as their source says; no bound
is stated and no source path is cited for one until it is reviewed on its
own.

v0.5's "never refused" and "costs nothing legitimate" are WITHDRAWN. The
availability tradeoff this design makes, named: at `L_sessrec` an end
refuses legitimate new incarnations of that identity for the life of the
process; a same-incarnation peer that was partitioned away and exhausted
here is permanently refused at this observer when it returns, until this
process restarts. Both are chosen over forgetting a retired pair, because a
forgotten pair is a replay hole; the document says so instead of calling
the refusal free.

## Parameters for David

As v0.5 without `L_sess`; `L_sessrec` 16 per peer identity, with "a
`elect-session-limit` report means an identity has presented sixteen
distinct incarnation pairs in one process life, which is its own finding;
the refusal is the tradeoff above".

## Appendix: traces

T0–T14, T16 as v0.5; T15 as rewritten under *Promotion*.

**T17. Saturation of session records.** `L_sessrec` 4. CURRENT `(a1, b1)`.
Binds arrive with `(a1, b2)`, `(a1, b3)`, `(a1, b4)`: each new, each passes
`C_phys`, each creates an UNRETIRED record; sum 4; ambiguous throughout,
no admission. A bind `(a1, b5)`: sum would be 5 → `elect-session-limit`,
closed by token, no record. `b1`'s channels all GONE: `(a1, b1)` → RETIRED
(a move, no capacity needed; sum still 4). `b2`, `b3` exhausted likewise:
RETIRED. UNRETIRED = `{(a1, b4)}`, CURRENT empty → promotion of `(a1, b4)`;
`S` rebuilt; election. `(a1, b5)` binds again: sum is still 4 (three
retired, one current) → refused `elect-session-limit`; the tradeoff above,
in effect, until restart. A bind `(a1, b1)`: RETIRED → `elect-retired`.
