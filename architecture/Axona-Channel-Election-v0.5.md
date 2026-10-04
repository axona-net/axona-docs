# Channel election (v0.5)

**Status:** design for council review, revision 5 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.4 (axona-docs `02375b6`) and
earlier, all left in place as record · **Revision driver (v0.5):** Aster
`9e1247d3`, decisions recorded at `17ccbeea`. Aster
recorded the proof, the request identity and the retired-pair direction as
addressing the earlier objections for the stated model. The v0.4 errors
that remained: the session policy was two rules that disagreed (a fresh
unretired pair both became current and had to trigger ambiguity); the
retired set expired on a timer, which reopens the replay hole for a
surviving old process; the proof's integration line named the wrong
version; equal-`r` processing read only `ack` when `q` must be read; and
the repair bound was stated as a traffic bound it is not.

Then Aster `8ed83bb2`, before this file froze: exhaustion is a local
failure-detector observation and not proof of death or surrender; no
deadline bound exists for retained-duty channels; and restart loses the
retired set, which the open adapter must cover.

**What changed from v0.4:** the session policy is one rule with ambiguity
before retirement and retirement only by a justified event; no timed
forgetting; three small corrections; T15 rewritten; T16 added. Everything
else stands as v0.4 wrote it and is not repeated.

This document is a design. It changes no code. Deploy is David's.

---

## Sessions: one rule

The session `σ` is the `(inc_A, inc_B)` pair bound by an axona/4 handshake.
A fresh handshake proves that handshake's freshness and nothing about
incarnation recency or exclusive identity ownership (v0.4). Per peer
identity, each end keeps: the CURRENT pair, if any; the UNRETIRED set
(pairs that have bound and are neither current nor retired); and the
RETIRED set, bounded by `L_sess`.

ON A BIND with pair `p`:

1. If `p` is in the RETIRED set: refuse with `elect-retired`, close the
   channel by token through the duty gate, whatever the connection's state
   and whenever the bind completes.
2. Else if `p` is the CURRENT pair: an ordinary new channel; it joins `S`.
3. Else: `p` enters the UNRETIRED set. If there is a CURRENT pair, the
   identity is now AMBIGUOUS: no admission on any channel of this identity,
   every channel kept under the duty gate, `elect-ambiguous-identity`
   reported. The current pair is NOT retired by this bind. If there is no
   current pair and `p` is the only unretired pair, `p` becomes current.

RETIREMENT happens only on a JUSTIFIED EVENT, of which there are two:

- ADAPTER EVIDENCE of succession: the adapter contract may supply a proof
  that one incarnation of an identity has succeeded another. What that
  evidence is, is OPEN; this document names the requirement and does not
  supply it. When it exists, the superseded pair is retired at once.
- LOCAL OBSERVED EXHAUSTION: every channel of the current pair has reached
  GONE at THIS end, through the kernel's own deadlines and pong timeouts.
  The current pair is then retired at this end, and if exactly one
  unretired pair remains it becomes current; if more than one remains, the
  identity stays ambiguous until all but one are exhausted too.

What exhaustion is and is not (Aster `8ed83bb2`). The kernel's deadline and
pong-timeout are a FAILURE DETECTOR: they report that this end can no
longer reach those channels. They do not prove the old process died, and
they do not prove it surrendered anything; a live old process behind a
partition loses every channel to this end and is exhausted here while
running elsewhere. Retirement is therefore LOCAL: it prevents re-admission
at this observer and fences that process nowhere else. Fencing elsewhere is
the authority adapter's job and is OPEN.

Liveness assumptions for exhaustion to occur at all: this end's reaper
must be running (an awake process; a suspended one detects nothing); and
every channel of the pair must be one the detector CAN retire. A
retained-duty channel is held open by the duty gate for as long as its
duty exists and reaches GONE only by loss; this document asserts NO
deadline bound for it, because no source-backed rule gives one. So a
current pair that includes a retained-duty channel is exhausted only when
that duty's own release or an actual loss takes the channel down, and
until then the identity stays ambiguous. That is conditional, stated, and
not a bound.

So, without adapter evidence, a peer's restart progresses only after the
old session's duty-free channels have all been retired by the detector and
its duty-bearing ones have been released or lost. The election does not
tell a restart from a concurrent process, because the same observations
cannot. A restarting peer with no retained duties sees one election stall
of at most the kernel's deadline.

RESTART AT THIS END loses the retired set with everything else. The new
local incarnation starts with no sessions, no retired pairs and no
ambiguity, and admits by the rules above as if it had never seen the peer;
its isolation from its own predecessor is that its incarnation differs and
its predecessor's channels are not its channels. What that new incarnation
must establish about succession on recovery, and what fences its own
predecessor if that predecessor is still running, is the OPEN adapter
prerequisite, named here and not supplied.

NO TIMED FORGETTING. The RETIRED set is kept for the life of the process.
`T_session` is removed. At `L_sess` entries the end refuses every new
session for that identity with `elect-session-limit` and forgets nothing.
The only forgetting is process restart, which forgets everything and is
stated. A surviving old process whose pair was retired is refused for the
life of this process; a restarted peer carries a new incarnation and is
never refused by this rule; the only identity refused for ever is the one
that must be. Trace T16: a retired pair binding after any delay.

## Small corrections

- *Integration*: `admit()` requires election evidence whose acknowledged
  version is `r_A⁻`, the pre-decision version condition 2 names at A.
- *Processing*: a frame with equal `r` reads `ack` AND `q`; a request with
  equal `r` is still a request.
- *Boundedness*: the repair mechanism gives PER-REQUEST BOUNDED ANSWERING
  (each request `n` answered at most once) and CONDITIONAL CONVERGENCE
  (under eventual delivery the pair reaches quiescence); it is not a bound
  on traffic, since a delayed answer can make the requester's timer fire
  again with zero loss, and each such retry is one more request with one
  more answer.

## What this design does not establish

As v0.4, and: a bound on how long an identity stays ambiguous without
adapter evidence (it is the kernel's deadlines, not this document's); any
succession evidence (OPEN).

## Parameters for David

As v0.4 without `T_session`; `L_sess` 8, with "a `elect-session-limit`
report means a peer identity has been retired eight times in one process
life, which is its own finding".

## Appendix: traces

T0–T4, T6–T14 as v0.4.

**T15, rewritten. Old bind after a new session, with a retained duty.**
Current `(a1, b1)`; channel `x` under it carries a backup replica (retained-
duty record). B restarts as `b2`; a fresh handshake on `y` binds `(a1,
b2)`: not retired, not current, so `(a1, b2)` enters UNRETIRED and the
identity is AMBIGUOUS: no admission on `y`, no admission on `x`'s session
either, `elect-ambiguous-identity`. `x` and every other `(a1, b1)` channel
reach GONE by the kernel's deadlines (the old process is dead): EXHAUSTION
retires `(a1, b1)`; `(a1, b2)` is the sole unretired pair and becomes
current; the election runs on `S_A = {y}` and elects `y`. A late handshake
on `z` from `b1` now binds `(a1, b1)`: RETIRED → `elect-retired`, closed by
token. Variant: a process `b3` binds `w` while `b2`'s channels are live:
UNRETIRED has `(a1, b2)` current and `(a1, b3)` unretired → ambiguous; no
admission on either; both kept under the gate; the stall lasts until one
pair's channels are exhausted or adapter evidence arrives (OPEN).

**T16. Retired pair binds after a long delay.** `(a1, b1)` retired by
exhaustion at `@A=100`. At `@A=100 000`, a surviving old `b1` process
completes a fresh handshake binding `(a1, b1)`: RETIRED → `elect-retired`,
refused, closed by token. No timer has cleared the entry; nothing was
forgotten. The refusal costs nothing legitimate: a restarted B carries
`b2`.
