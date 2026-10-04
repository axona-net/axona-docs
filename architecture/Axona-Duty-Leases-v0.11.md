# Duty leases (v0.11, consolidated)

**Status:** consolidated normative candidate for council review, fifth
consolidation; proposed as a PHASE-2 dependency of Hold-and-Fill, not a
prerequisite of its below-cap behaviour (axona.bot's review of
2026-10-04, pending David) · **Date:** 2026-10-04 · **Kernel in
production:** 4.102.0 (`270835d`) · **Policy set by:** David · **Author:**
axona.bot · **Supersedes:** v0.10 (axona-docs `d677234`) and v0.1–v0.9,
all left in place as record · **Driver:** Aster `59fafa6b`, decisions
recorded at `4362bd06`: the correlated terminal-receipt path existed only
at a holder, so a holder's receipt arriving at a live SUSPENDED authority
was discarded by the response-progression counter; and §4's producer-by-
cause split contradicted L24, where a holder that processed a void
reports cause `void`. L3 closed in that review. Earlier drivers: Aster
`b906d479` (`ad18177a`), `4cc26cc5` (`ad912b7f`), `df0a220c`, `e62bcfb3`;
Vega `148f72f0`; Orion `e4106f58`; decisions at `09158726`. Also Vega `148f72f0`: the
source column is the kernel row for row, with the epoch citation corrected
to the mint sites; Orion `e4106f58`, verifying the parameter bounds; and
Aster `e62bcfb3`: the initial accept commit needs the would-be deadline
ahead as well as the offer window, and DETACHED is a flag on HELD so it
cannot drop out of a row.

This file carries everything. Where any earlier version disagrees, this
text governs.

This document is a design. It changes no code. It is claimed on no legacy
edge. Deploy is David's.

---

## 1. The question

When one node takes on an obligation to another, when does each end know
the obligation exists, and when does each end know it has ended?

A root enlists backups and replication targets. A host serves a topic. A
handoff moves a role. Today the promise is created by a frame and ended by
nothing in particular. The step-down hold (4.102.0) fences the root's own
claim for five minutes. This document fences the rest, under an authority
it takes as given.

## 2. What this protocol is not

- NOT root fencing. The authority is given; §10.
- NOT a timeout that means discharge.
- NOT a global order of authorities.
- NOT persistence.
- NOT claimed on a legacy edge.
- NOT available for any real duty until §10's adapter exists. The
  single-authority subprotocol is available for analysis, with the
  authority as an assumption, and for nothing else.

## 3. Definitions

| term | meaning |
|---|---|
| AUTHORITY | the end that owns the role: the root for backup, replication, host; the giver for handoff. Given. |
| HOLDER | the end that takes on the obligation. |
| `inc_a`, `inc_h` | the two incarnations, random per process, equality only. |
| session | the pair's current session as the Channel Election document establishes it. |
| `E` | the EPOCH CERTIFICATE per (topic, role), §10; constant within one authority incarnation. |
| `L` | `{id, topic, role, authority, holder, E, ttl}`; `id = (inc_a, inc_h, counter)`, counter per (authority incarnation, holder), consecutive. The IMMUTABLE TERMS are `topic, role, authority, holder, E, ttl`; they are fixed at grant and looked up by `id` thereafter. |
| `seq` | increments on every authority REQUEST about `L`; a RESPONSE echoes the `seq` it answers. |
| `cand_A(seq)` | a candidate deadline recorded at the send of `renew{seq}`; LATEST-ONLY: sending a new renew invalidates the previous candidate for the lease. |
| `deadline_A`, `deadline_H` | committed deadlines, each a reading of that end's own monotonic clock at that end's own event. |
| CAN-SERVE / RETAINS | two columns per lease at the holder; §5. |
| lease-scoped work / CUSTODY | §9. |
| `S_skew`, `ρ`, `D_max`, `T_offer`, `T_recover`, `T_term` | §8, §11. |

## 4. Wire schema

Every frame carries `cls`, `type`, `pair` (as the Election document, normalized by the receiver), `inc_a`, `inc_h`, `id`, `E`, `seq`. The class is fixed by type; a frame whose `cls` does not match its `type` is malformed and discarded before state dispatch.

| cls | type | transmitted beyond the common fields | derived or looked up |
|---|---|---|---|
| request | `grant` | `topic, role, ttl` | `authority, holder` from the session's identities |
| request | `renew` | `ttl` | every immutable term from `id`; a transmitted `ttl` that differs from the held one is malformed |
| request | `revoke` | — | all from `id` |
| request | `void` | — | all from `id` |
| response | `accept` | — | all from `id` |
| response | `renewed` | `ttl`, `state` (the holder's state BEFORE processing the renew) | all else from `id` |
| response | `released` | — | — |
| response | `lease-stale`, `lease-stale-authority`, `lease-stale-holder`, `lease-retired-session`, `lease-limit`, `lease-uncertain`, `lease-epoch-invalid` | `reason` | — |
| response | `terminal-receipt` | `for ∈ {void, released}` (the producer's terminal state); `cause`, orthogonal to role, from the PRODUCER-BY-CAUSE MATRIX below; `seq` by the PRODUCER'S ROLE: an authority carries the last request seq it SENT for the id; a holder carries the last request seq it PROCESSED for the id. Never the seq of the frame it answers; no void or revoke seq is fabricated for a holder expiry or an authority recovery failure. Correlation is by `id`, session, incarnations and `E`, never by seq equality with another frame and never by cause. | — |

PRODUCER-BY-CAUSE MATRIX for `terminal-receipt`:

| producer | cause | meaning | `for` | `seq` |
|---|---|---|---|---|
| authority | `void` | it voided the offer | `void` | last sent request seq |
| authority | `revoke` | it revoked | `released` | last sent request seq |
| authority | `recovery-failed` | its recovery attempt failed | `released` | last sent request seq |
| authority | `peer-terminal` | it terminalized on the holder's receipt | `released` | last sent request seq |
| holder | `void` | it processed the authority's void | `released` | last processed request seq |
| holder | `revoke` | it processed the authority's revoke | `released` | last processed request seq |
| holder | `expired` | its own deadline passed | `released` | last processed request seq |
| holder | `peer-terminal` | it terminalized on the authority's receipt | `released` | last processed request seq |

## 5. States

AUTHORITY, per lease: OFFERED → GRANTED ⇄ RENEWING; OFFERED → VOID;
GRANTED or RENEWING → REVOKING → RELEASED; GRANTED or RENEWING →
SUSPENDED → GRANTED (recovery commit) or RELEASED (failure); any LIVE
state (OFFERED, GRANTED, RENEWING, SUSPENDED, REVOKING) → UNCERTAIN-A on
untrusted resume. VOID and RELEASED are TERMINAL, retained for `T_term`,
and are never left except by forgetting after `T_term`; a resume never
touches them.

HOLDER, per lease: none → HELD; HELD ⇄ RENEWING-H; HELD or RENEWING-H →
RELEASED on revoke, void, terminal-receipt, or trusted expiry; any LIVE
holder state → UNCERTAIN on untrusted resume; UNCERTAIN → HELD on a fresh
renew, → RELEASED on revoke, void, terminal-receipt or trusted expiry.
RELEASED is TERMINAL, retained for `T_term`.

DETACHED is a FLAG on HELD and RENEWING-H, not a state: set on
trusted-clock channel loss, cleared on any frame for the lease on a new
channel. A flagged lease is HELD for every rule, row, renewal-eligibility
check and registry entry in this document; the flag changes exactly one
thing, the CAN-SERVE column below. One added name would otherwise drop
out of every row that says HELD (Aster `e62bcfb3`).

| holder state | CAN-SERVE | RETAINS |
|---|---|---|
| HELD, RENEWING-H, flag clear | yes | yes |
| HELD, RENEWING-H, flag `detached` | yes, non-exclusive work only | yes |
| UNCERTAIN | no | yes |
| RELEASED (retained) | no | custody until §9's release event |

## 6. Frame admission

In order; the first failing step discards the frame. WHAT A FAILING STEP
SENDS is governed by §6.1: a failing REQUEST may be answered once with the
named denial; a failing RESPONSE is never answered, only discarded and
reported.

1. CLASS: `cls` matches `type`; else malformed.
2. SESSION: `pair`, normalized, equals the channel's pair and the current
   session; else `lease-retired-session` (request only).
3. INCARNATIONS: `inc_a`, `inc_h` are the live ones; else
   `lease-stale-authority` / `lease-stale-holder` (request only).
4. EPOCH: `E` validates under §10; else `lease-epoch-invalid` (request
   only). UNAVAILABLE until §10; until then `E` is constant and passes.
5. TERMINAL ROW: if the receiver is TERMINAL for `id`: a request is
   answered with `terminal-receipt{for, cause, seq}` as §4 defines it; a
   late `accept` (the one response that completes a request this end
   originated) is answered with `terminal-receipt{void, cause void}`
   REGARDLESS of its `seq` (grant `seq 1` is older than void `seq 2`; this
   row runs before step 9 for that reason); a `released` or a
   `terminal-receipt` correlated by `id`, session, incarnations and `E`
   (NOT by cause: cause equality across ends is not expected, since a
   terminal authority may hold cause `void` while its holder reports
   `expired` after a lost void) is handled by the CONFIRMATION-ONLY
   OPERATION, which records exactly one of two FACTS, changes no state,
   sends nothing, and is idempotent:
   - `released{seq}` whose `seq` echoes a `revoke` or `void` this end
     SENT for the id establishes "the peer processed my specific
     cancellation": the CANCELLATION-ACKNOWLEDGED mark for that seq.
   - `terminal-receipt{for, cause, seq}` establishes "the peer is
     terminal for this id, by its own cause": the PEER-TERMINAL mark with
     that cause. It does NOT establish that any particular revoke or void
     was processed; a holder that expired on its own is terminal without
     having processed anything.
   `released` carries no cause and needs none; its echoed `seq` is its
   fact. Every other response is discarded. Stop.
6. CORRELATED TERMINAL-RECEIPT, at ANY receiver with a LIVE `id` in an
   ELIGIBLE state (holder: HELD, RENEWING-H, UNCERTAIN; authority:
   GRANTED, RENEWING, SUSPENDED, REVOKING, UNCERTAIN-A): a
   `terminal-receipt` whose `id`, session, incarnations and `E` match is
   validated and PROCESSED ONCE, whatever its `seq` relative to this end's
   counters, which are never compared with it (the receipt's seq is the
   producer's own, under the matrix, and is not an echoed response): at a
   holder, the lease → RELEASED with cause `peer-terminal`, custody per
   §9; at an authority, the lease → RELEASED with cause `peer-terminal`
   and the PEER-TERMINAL fact recorded with the producer's cause (§6.1).
   Only after that transition do further receipts for the `id` fall to
   the terminal row of step 5. Stop. The seq rule of step 9 applies to
   requests and to echoed responses (`accept`, `renewed`, `released`) and
   to nothing else; a first terminal receipt never reaches it.
7. TYPE × STATE: the frame type is admissible in the receiver's state by
   the table below; else discard, report (no response for either class).
8. TERMS: for a live `id`, transmitted immutable terms equal the held
   ones; else malformed.
9. SEQ, requests and the remaining responses: lower than last processed:
   late, discard. Equal: duplicate: a request is answered again
   idempotently from current state, allocating nothing; a response is
   discarded. Higher: process. Gaps allowed. The authority's request
   progression (`seq` on grant, void, renew, revoke) and the holder's
   response correlation (echoing the answered seq) are separate counters
   and are never compared with each other.

| receiver state | REQUESTS processed (→ transition) | RESPONSES processed (→ transition) |
|---|---|---|
| holder: none | `grant` → §7.1 | — |
| holder: HELD, RENEWING-H (flag clear or `detached`) | `renew` → deadline rule §8.1, send `renewed`; `revoke` → RELEASED, send `released`; `void` → RELEASED, send `released`; duplicate `grant` → send current `accept` | `terminal-receipt` → RELEASED, custody per §9 |
| holder: UNCERTAIN | `renew` (fresh, §8.3) → HELD with a new interval, send `renewed{state: UNCERTAIN}`; `renew` (not fresh) → stay, send `lease-uncertain`; `revoke`, `void` → RELEASED, send `released` | `terminal-receipt` → RELEASED |
| authority: OFFERED | — | `accept` → §8.1 guarded commit → GRANTED; `lease-stale`, `lease-limit`, `lease-stale-*`, `lease-retired-session`, `lease-epoch-invalid` → VOID the offer, report, reissue under a fresh id where the reason permits |
| authority: GRANTED, RENEWING | — | `renewed` → §8.1 commit guards; `released` → RELEASED; `lease-uncertain` → report, keep the candidate; `lease-stale-holder` → treat as loss, run §8.2 |
| authority: SUSPENDED | — | `renewed` → §8.2 recovery guards; `released`, `terminal-receipt` → RELEASED |
| authority: UNCERTAIN-A | — | `renewed` → §8.3 post-resume guards; `released`, `terminal-receipt` → RELEASED |
| authority: REVOKING | — | `released`, `terminal-receipt` → RELEASED |

### 6.1 The finite reply relation

- A REQUEST may yield at most one RESPONSE per `seq` at the receiver; every
  authenticated repeat is answered again, idempotently; a request failing
  admission at steps 2–4 is answered once with the named denial.
- A late `accept` at a terminal authority yields one `terminal-receipt
  {void}` (step 5).
- `terminal-receipt` and every other RESPONSE yield NOTHING, whether it is
  processed or fails admission at any step. Two ends that disagree about
  the session exchange at most one denial each way, because the second
  denial, being a response, is discarded.

Classifying uses wire fields; deciding that an `accept` is LATE uses lease
state (the authority is terminal for that `id`). The relation is finite
and acyclic: `accept → terminal-receipt` is its only response-to-response
edge and `terminal-receipt` has no outgoing edge.

## 7. Capacity

### 7.1 Grant admission at the holder

Per (authority incarnation, holder): HIGH-WATER counter, LIVE ids,
RETAINED terminals, IN-FLIGHT grants. A `grant` that passed §6:

1. `id` live → send current `accept`, allocate nothing.
2. `id` retained → send the retained terminal, allocate nothing.
3. `counter ≤ high-water`, neither → `lease-stale`: a CONSERVATIVE
   OUT-OF-ORDER REFUSAL (the grant may have been legitimate and
   reordered; the authority voids it and reissues under a fresh id; one
   round trip lost; nothing below the high-water is ever admitted).
4. SLOT: `LIVE + RETAINED + IN-FLIGHT + 1 ≤ L_slots`; else `lease-limit`.
5. Admit: high-water advances; the slot is reserved; the holder enters
   HELD at the instant it SENDS `accept`, with `acceptAt` on its own clock
   and `deadline_H := acceptAt + ttl + S_skew`.

A slot is conserved: IN-FLIGHT → LIVE → RETAINED → free after `T_term`.
Release consumes its own reserved space and is never refused. The bound is
per (authority incarnation, holder); the aggregate is `L_inc × L_slots`;
Hold-and-Fill's physical and memory bounds apply on top; at `L_inc` a new
incarnation is refused and nothing is evicted.

## 8. Deadlines

### 8.1 Clock model, margin, grant, renewal, void, revoke

Every deadline is a reading of the end's own monotonic clock at an event
at that end. The only time-valued wire field is `ttl`, a duration.
Assumptions: RATE, each clock within `1 ± ρ`; DELAY, one-way delivery at
most `D_max` (liveness only); WALL TIME, never read for a deadline, read
once at resume as an untrusted hint; no offset assumption.

GRANT, the guarded commit. The authority sends `grant{seq 1}`, enters
OFFERED, records `offerAt := now_A`, and relies on nothing. It commits
OFFERED → GRANTED, and RELIES FROM THAT INSTANT, only when, in one step:
an `accept` arrives that correlates exactly (`id`, session, both
incarnations, `E`, `seq 1`); the authority is still OFFERED for that `id`;
`now_A < offerAt + T_offer`; AND `now_A < offerAt + ttl − S_skew`, the
deadline it would commit to, still ahead. The two time guards are both
needed: the proposed defaults put the offer window before the deadline,
but that ordering is not a consequence of the parameter constraints
(Aster `e62bcfb3`). On commit, `deadline_A := offerAt + ttl − S_skew`
(the send event's reading, not the receipt's). The holder is HELD from the
send of `accept` with `deadline_H := acceptAt + ttl + S_skew`.

THE MARGIN, a LOWER BOUND. With the holder's event later than the
authority's by `δ ≥ 0` and rates within `1 ± ρ`, the true-time separation
`deadline_H − deadline_A` is at least

```
δ + (ttl + S_skew)/(1 + ρ) − (ttl − S_skew)/(1 − ρ)
  = δ + 2·(S_skew − ρ·ttl)/(1 − ρ²)
```

which is positive whenever `S_skew > ρ·ttl`, `0 ≤ ρ < 1`, `ttl > S_skew`.
The actual separation under variable bounded rates is at least this; the
expression is not the actual value. A local-duration argument; no offset
and no delivery bound is needed. The authority stops relying before the
holder stops holding, under RATE.

RENEWAL. At `ttl/3` after its last committed deadline-setting event the
authority sends `renew{seq, ttl}`, records `cand_A(seq) := now_A + ttl −
S_skew` at that send (LATEST-ONLY: the previous candidate for the lease is
invalidated), and enters RENEWING; `deadline_A` is unchanged. The holder,
at processing, sets `deadline_H := max(deadline_H, now_H + ttl + S_skew)`
and answers `renewed{seq, ttl, state}`. The authority COMMITS `deadline_A
:= cand_A(seq)` only when, in one step: the candidate for `seq` is the
latest and not consumed; `now_A < deadline_A`; `now_A < cand_A(seq)`; the
`renewed` matches `id`, both incarnations, `E`, `seq`, and the sent `ttl`;
`state ∈ {HELD, RENEWING-H, UNCERTAIN}` (the `detached` flag is not a state and does not affect eligibility). Commit consumes
the candidate and returns to GRANTED. Each accepted renewal re-runs the
margin from fresh readings; the horizon is the last committed deadline.

VOID. At `offerAt + T_offer` still OFFERED: send `void{seq 2}`, enter VOID
(terminal, retained). A late `accept` is handled by §6 step 5.

REVOKE. Enter REVOKING, which STOPS RELIANCE; then send `revoke`;
`released` is accounting; REVOKING → RELEASED on `released` or
`terminal-receipt`, or on `deadline_A`, whichever first.

EXPIRY at the holder: at `deadline_H`, unconditionally, HELD or
RENEWING-H → RELEASED (`lease-expired` reported), CAN-SERVE no, custody
per §9. `deadline_H` moves only through the renewal rule; no duplicate,
irrelevant or late frame postpones it.

### 8.2 Channel loss, SUSPENDED, recovery, failure

CHANNEL LOSS with trusted clocks releases nothing at either end. The
holder sets the `detached` flag on its HELD or RENEWING-H lease:
`deadline_H` unchanged; non-exclusive lease-scoped work continues; the
flag clears on any frame for the lease on a new channel. The authority
stays in its state with `deadline_A` unchanged; it enters SUSPENDED only
when `deadline_A` passes without a committed receipt, not at the loss.
Detected loss (`mesh._retire` from the reaper, `mesh.js:1140/1150/1160`)
is kept apart from elective duplicate retirement; neither a timeout nor a
comment proves peer-process death or custody discharge.

SUSPENDED: the authority relies on nothing; records `recovery_origin :=
that deadline`; sends RECOVERY RENEWS `{seq+1, ttl}` on any duty-capable
channel, each with a latest-only `cand_A(seq)` at its send. It commits
GRANTED only when, in one step: the candidate is the latest and not
consumed; `now_A < cand_A(seq)`; `now_A < recovery_origin + T_recover`;
the `renewed` matches with `state ∈ {HELD, RENEWING-H,
UNCERTAIN}` (flag irrelevant). Commit consumes the candidate.

FAILURE, the finite transition: at `recovery_origin + T_recover` with no
committed receipt, the attempt is FAILED: every candidate of the attempt
is invalidated; no further recovery renews are sent for it;
`lease-recovery-failed` is reported; the lease goes to RELEASED at the
authority with cause `recovery-failed`, so its terminal receipts carry
that cause and the authority's last sent request seq (§4); the role's own
recovery runs under its own authorization.
Later traffic for the attempt cannot restore it. A future recovery is a
NEW attempt with its own `recovery_origin`, candidates and scope, never a
reset of the old origin. The holder, past `deadline_H`, expires (§8.1).

### 8.3 Uncertainty at either end

HOLDER. On resume with untrusted elapsed time: every live lease →
UNCERTAIN (CAN-SERVE no, RETAINS yes). It leaves UNCERTAIN for a lease only
on a FRESH authority frame (passes §6, `seq` above the last processed,
current session) or a trusted elapsed-time source showing `deadline_H`
passed. On a fresh `renew`: a NEW HOLDING INTERVAL `deadline_H := now_H +
ttl + S_skew` from its own processing event, NO `max` against any
pre-suspension value; answer `renewed{seq, ttl, state: UNCERTAIN}`; →
HELD. `seq` freshness means an unprocessed frame and nothing about time;
it is not custody evidence. A pre-suspension deadline is never compared
against a clock whose behaviour across the suspension is unknown. A
holder with no trusted source and no frame stays UNCERTAIN, retaining,
indefinitely; intended.

AUTHORITY. On resume with untrusted elapsed time: every LIVE lease →
UNCERTAIN-A, carrying its PRE-RESUME INTENT; terminal leases untouched.
For each: invalidate every pre-resume candidate and deadline (never read
again). What UNCERTAIN-A then does depends on the intent, and the three
are never merged:

- Intent GRANTED, RENEWING or SUSPENDED: RECOVERY. At the FIRST
  post-resume recovery send record `resume_origin := now_A` and run
  §8.2's recovery with `recovery_origin := resume_origin`, for this
  transition only; the two origins are never mixed; `state` UNCERTAIN is
  commit-eligible by the margin argument applied to the holder's
  processing event and the authority's send; failure at `resume_origin +
  T_recover` is §8.2's transition.
- Intent REVOKING: CANCELLATION. The authority had stopped relying and
  was awaiting accounting; it re-sends `revoke` with the next seq and
  never a renew, so no post-resume renew can overtake the revoke. Its
  origin is its own and is FINITE: `cancel_origin := now_A` at the LOCAL
  ENTRY into the cancellation attempt on resume, whether or not a channel
  exists to send on; retries (on any channel that appears) never reset it.
  `released` echoing this attempt's revoke seq → RELEASED with the
  accounting confirmed; a `terminal-receipt` from the holder → RELEASED
  with the peer known terminal (§6 step 5's two facts); failing both,
  RELEASED at `cancel_origin + T_recover` with the accounting reported as
  unconfirmed. Custody, if any, is retained independently under §9. A
  repeated untrusted resume is the invalid-clock case, not a retry: it
  opens a fresh attempt with a fresh `cancel_origin` and keeps the
  cancellation intent.
- Intent OFFERED: OFFER RECONCILIATION. The authority had never committed
  and never relied; it sends `void` with the next seq, enters VOID, and
  reports; a late `accept` meets the terminal row. An unaccepted grant
  never becomes an active lease by resuming.

REPEATED RESUME while already UNCERTAIN-A: every candidate of the earlier
post-resume attempt is invalidated; a new attempt opens with a fresh
attempt identity and a fresh `resume_origin` at its first send; the intent
carried is the one recorded at the first resume (a REVOKING lease does
not become a recovery because it was resumed twice).

RESTART forgets every lease at that end; a crashed holder is a lost
holder, handled by the authority's deadline; in-memory custody is lost
with the process, as today.

## 9. Roles, custody, exclusive actions

Every row is PROPOSED and UNAVAILABLE until §10.

| role | source (kernel today) | proposed | grantor → holder | custody release |
|---|---|---|---|---|
| backup | the backup is the RECEIVER of `REPLICATE` (`wireHandlers.js:901–906`, `syncEngine.js:229–243`); sends nothing first | `grant{backup}` precedes the first `REPLICATE`; `accept` is the frame the source lacks | root → backup | ATTESTED RECEIPT naming object set, version, coverage; or explicit discharge; or the role's loss policy |
| replication target | as backup | as backup | root → target | as backup |
| host | `peer.host()` is local (`AxonaPeer.js:2727–2768`) | a NEW root→host lease; `peer.host()` without one stays what it is | root → host | attested transfer, discharge, or loss policy |
| handoff | `pubsub:handoff`/`handoffack`; the heir roots BEFORE the ack (`syncEngine.js:204–219`) | a NEW `handoff:committed` after the heir's own role lease is HELD and completeness is attested; the giver discharges on it; the heir's early root is an EXCLUSIVE ACTION | giver → heir | `committed` with attestation; ACTIVATION and STOP are §10's fenced events; OPEN |
| the hold's forward | `_holdIntercept` (`wireHandlers.js:206–248`) | nothing; not an obligation | — | — |
| the epoch | `_set` writes `role.epoch` on every promotion to root (`rootClaim.js:220`) and `become()` for a role born root (`:327`), each a local `knownEpoch + 1`; `demote()` writes only the local step-down hold (`:372–390`) and mints nothing (Vega `148f72f0`) | not `E`; nothing here reaches another node | — | — |

CUSTODY survives expiry until an ATTESTED RECEIPT (object set, version,
coverage), an explicit discharge, or the role's loss policy named in the
role's own design. OVERLAP of an old holder and a replacement is permitted
for NON-EXCLUSIVE duties; EXCLUSIVE actions are fenced by §10's
certificate and UNAVAILABLE. The registry Hold-and-Fill's `mayRetire`
reads: every non-terminal authority state and every non-terminal holder
state, plus undischarged custody.

## 10. Open adapter prerequisites

Required, not supplied: (1) the EPOCH CERTIFICATE per (topic, role),
totally ordered, issued by root fencing, validated by the holder; until
it exists supersession, epoch-ordered rejection, release of another
authority's lease, every exclusive action and every role row are
UNAVAILABLE, and the single-authority subprotocol is available for
analysis only; (2) session and handshake freshness, the Election
document's §11; (3) handoff ACTIVATION and STOP as non-overlapping fenced
events; (4) each role's loss policy.

## 11. Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `ttl` | 120 s | `ρ × ttl < S_skew`; raise if `ttl/3` renew traffic is measurable on a phone |
| `ρ` | 10⁻⁴ | measured monotonic drift |
| `S_skew` | 5 s | measured spread; on a phone §8.3 is the protection |
| `D_max` | 10 s | an assumption; liveness only |
| `T_offer` | 25 s | `≥ 2·D_max` + processing; a healthy slow link voided |
| `T_recover` | 60 s | the time a role can be without its duty, per role |
| `T_term` | 2 × `ttl` | under `D_max`, any in-flight frame answered |
| `L_slots` | 32 per (authority incarnation, holder) | a `lease-limit` report under normal load |
| `L_inc` | 8 | aggregate 256 |
| `cap:lease` | advertised by every capable kernel | the version that ships this |

## 12a. Appendix: reviewed arithmetic and traces

**Margin.** `ρ = 10⁻⁴`, `ttl = 120`, `S_skew = 5`: lower bound on
separation at least `2·(5 − 0.012)/(1 − 10⁻⁸) > 0` at every grant and every
accepted renewal; unchanged after 1,000 renewals.

**L2** (equal clocks). Grant at 0, accept at 2, commit at 4: `deadline_A`
= `offerAt + 115` = 115, `deadline_H` 127. Renew at 40: `cand` 155; H 165;
commit 155 at 44. Payload at 70: H holding.

**L17.** Renew lost: A relies to 115 then SUSPENDED; H expires at 127; the
authority stopped first.

**L4b.** REVOKING at 50, reliance stops; `released` delayed to 90; A relied
on nothing from 50.

**L12.** Renewals committed as `t_send + 115`; the last acknowledged send
at 400 → 515, no later.

**L19.** Counters 1, 2; 2 first (admitted); 1 → `lease-stale`; voided and
reissued as 3.

**L21c.** `L_slots` 32, repeated batches; the 33rd refused; no release
refused; sum never above 32.

## 12b. Appendix: unexecuted adversarial scenarios

Expected outcomes to become tests; not evidence.

**L1.** Delayed accept: void at `T_offer`; late accept → §6 step 5 →
`terminal-receipt{void}`; the holder processes it (table row) → RELEASED.

**L28. OFFERED commit guards.** An `accept` with `seq 1` arriving at
`offerAt + T_offer + 1`: the authority already sent `void`, is VOID → step
5. An `accept` with `seq 2` (malformed echo): fails the `seq 1` guard →
discarded. Reliance starts at the commit instant, not at the send of
`grant`.

**L29. Holder on channel loss.** HELD, channel lost at 60 with trusted
clocks: HELD with the `detached` flag, `deadline_H` unchanged, non-exclusive work
continues; a `renew` on a new channel at 90: processed → flag cleared. Variant:
no channel by `deadline_H`: RELEASED by expiry.

**L30. Reciprocal stale-session denials.** A and B disagree about the
session. A's `renew` (request) at B fails step 2: B answers
`lease-retired-session` once. That denial (response) at A fails step 2 at
A: discarded, reported, NOT answered. One denial each way at most.

**L31. Terminal non-resurrection.** Authority VOID for id 9, retained;
resume with untrusted elapsed time: id 9 untouched (terminal); live id 10
→ UNCERTAIN-A.

**L32. Latest-only candidates.** `renew{5}` sent, `cand(5)`; `renew{6}`
sent before any receipt: `cand(5)` invalidated, `cand(6)` latest; a
`renewed{5}` arriving now: not the latest → ignored; `renewed{6}` →
commit.

**L33. Stale or limit at OFFERED.** `grant` answered `lease-limit`: the
authority voids the offer, reports, and does not reissue to that holder
until a later grant succeeds elsewhere or the holder's capacity frees.
`lease-stale`: void and reissue under a fresh id.

**L3b. Recovery on a new channel with old-channel frames in flight.**
GRANTED; `renew{3}` sent on channel `c1` at 80; `c1` dies at 81 (holder:
`detached` flag); `deadline_A` passes at 115 → SUSPENDED, `recovery_origin`
115; new channel at 120; recovery `renew{4}` on it, latest-only (`cand(3)`
invalidated). H processes `renew{4}` first (`renew{3}` lost): extends,
`renewed{4, ttl, HELD}`; flag cleared. A: candidate 4 is the latest, within
window → commit, GRANTED. A late `renew{3}` at H: `3 < 4` → discarded. A
late `renewed{3}` at A: not the latest → ignored.

**L7b** (equal-clock, `ρ = 0`). SUSPENDED at 155, `recovery_origin` 155,
`T_recover` 60; `renew{7}` at 160, `cand` 275. `renewed{7, HELD}` at 200:
guards hold → commit 275. Variant: no receipt by 215 → FAILED (§8.2):
candidates invalidated, no more sends, `lease-recovery-failed`, RELEASED,
role recovery. A `renewed{7}` at 230: the attempt is failed → ignored.

**L9b. Holder suspension.** HELD, 100 s remaining, suspended; on resume
elapsed time untrusted → UNCERTAIN (CAN-SERVE no, RETAINS yes). A's next
`renew{8}`: fresh (`8 >` last processed) → new interval `now_H + 125`,
`renewed{8, ttl, UNCERTAIN}` → HELD; A commits by §8.2's guards. Variant:
no frame ever: UNCERTAIN indefinitely, retaining; intended.

**L13. Forgotten old grant.** Holder has processed counters 1..7 for
`(inc_a, inc_h)`; `id 7` released and its retention expired.
`grant{counter 5}` replayed: `5 ≤ 7`, not live, not retained →
`lease-stale`. `grant{counter 8}`: new; admitted; high-water 8.

**L14. Holder restart.** H restarts: `inc_h'`, new session. A sends
`renew{9}` for `(inc_a, inc_h, 8)`: step 2 (session) fails →
`lease-retired-session` once; A treats the lease as lost, runs §8.2 and,
on failure, the role's recovery; a fresh `grant{(inc_a, inc_h', 1)}` under
the new session is admitted.

**L14b. Delayed old grant after holder restart.** `grant{(inc_a, inc_h,
3)}` from the old session arrives on a channel of the new session: step 2
fails → `lease-retired-session`, discarded; never reaches §7.1.

**L18. Renew delivered after the holder's deadline, receipt at a live
authority.** A had processed `renewed{4}` (its last processed response
seq is 4). H expires at `deadline_H` with no authority frame: RELEASED
with cause `expired`; its last processed request seq was 4. A's
`deadline_A` passes: SUSPENDED; A sends recovery `renew{5}`. H is
terminal → step 5 → `terminal-receipt{for released, cause expired, seq
4}` (the holder's own last processed request seq; no void or revoke seq
exists or is invented). At A, live and SUSPENDED (eligible): step 6
correlates by id, session, incarnations and E, ignores that `seq 4` equals
A's last processed response seq, and processes it ONCE → RELEASED with
cause `peer-terminal`, PEER-TERMINAL fact recorded with cause `expired`.
A duplicate of the receipt: A is now terminal → step 5 → the
confirmation-only operation, idempotent, nothing sent. Nothing extended.

**L20. Recovery against an UNCERTAIN holder.** As L9b's first variant for
a fresh renew. Replayed `renew{6}` (`6 ≤` last processed): not fresh →
stays UNCERTAIN, `lease-uncertain`; A reports and keeps the candidate.

**L22. Late matching recovery receipt.** `renewed{7}` after the window:
guard 3 fails → ignored. After the candidate's own expiry: guard 2 fails.
Twice inside the window: the second fails guard 1 (consumed).

**L23. Authority resume, GRANTED intent.** Leases 1–3 GRANTED; resume
untrusted → UNCERTAIN-A with intent GRANTED; pre-resume candidates
invalidated; first post-resume `renew{seq+1}` records `resume_origin`;
receipts matching post-resume candidates commit by the four guards; a
`renewed` for a pre-resume seq fails guard 1.

**L24. Both terminal.** A VOID for id 9 (its last sent request seq 2), H
RELEASED for id 9 (cause `void`, last processed request seq 2). A's
retained `void{2}` reaches H as a request: step 5 → H answers
`terminal-receipt{released, cause void, seq 2}` once. The receipt reaches
A: a response at a terminal end correlated by id, session, incarnations
and E → the CONFIRMATION-ONLY OPERATION sets A's PEER-TERMINAL mark with
cause `void`; it does not set CANCELLATION-ACKNOWLEDGED for seq 2, because
a terminal receipt proves the peer is terminal, not that it processed
this void; no state change; nothing sent. A replay of `void{2}` at H:
answered again, idempotent; the second receipt at A: the mark is already
set, nothing sent. Variant: H had expired on its own (cause `expired`)
before the void arrived: its receipt carries cause `expired`; A's
PEER-TERMINAL mark records that cause; the two ends' causes differ and
nothing requires them to agree.

**L25. Lost terminal receipt, then retry.** As L24 with the first receipt
lost; A re-sends `void{2}`; H answers again; it arrives; the confirmation-
only operation sets the PEER-TERMINAL mark. Variant establishing the
other fact: H, still HELD, receives `revoke{5}`, releases and answers
`released{5}`; at A the echoed seq 5 matches a revoke A sent → the
CANCELLATION-ACKNOWLEDGED mark for seq 5.

**L26. Authority resume, post-resume window.** As L23; a `renewed{8,
HELD}` at `resume_origin + 50` commits (`T_recover` 60); one at `+70`:
guard 3 fails; at `+60` the attempt FAILS by §8.2; a new attempt needs a
new origin.

**L27. Late accept at a VOID authority.** H sent `accept{1}` late; A is
VOID (seq 2): step 5, the late-accept exception → `terminal-receipt{void,
seq 2}`. H, HELD, receives it: step 6 (correlated terminal-receipt) →
processed once → RELEASED; H sends nothing (a response). A used lease
state to know the accept was late; both classified the frames by `cls`.

**L10. Handoff** (UNAVAILABLE under §10). Giver G grants `handoff` to V;
V HELD on accept; G keeps custody and serves; V obtains its own role lease
from the root; V attests completeness and sends `handoff:committed`; G
discharges and REVOKING → RELEASED its handoff lease. No `committed`: G's
handoff lease expires at its deadline; G still holds custody and serves;
nothing lost.

**L16. Custody receipt.** Backup H holds `{o1..o9, v12}`; root R sends
`discharge{receipt: {o1..o9, v12, coverage: full}}`: H releases custody.
Receipt naming `v11` or `o1..o8`: H retains, reports
`custody-receipt-short`.

**L34. Lost void, late accept, first receipt, repeated receipt.** A sends
`grant{1}` at 0 (OFFERED); H processes it at 4, sends `accept{1}` (HELD,
last processed request seq 1); the accept is delayed. At 25 A: `T_offer`
→ `void{2}`, VOID (terminal seq 2); the `void` is LOST. At 40 `accept{1}`
reaches A: step 5, late-accept exception → `terminal-receipt{void, seq
2}`. At 44 the receipt reaches H (HELD, live id): step 6: correlated,
processed ONCE → RELEASED, terminal seq 2 recorded; H sends nothing. At 50
a duplicate receipt arrives: H is now RELEASED (retained) → step 5 → a
response at a terminal end → discarded. Counters: H's request counter
stayed at 1 throughout; the receipt's seq 2 was never compared with it.

**L35. Delayed revoke across resume.** GRANTED; A enters REVOKING at 50
(reliance stops), sends `revoke{5}`, which is delayed. A resumes at 60
with untrusted elapsed time: UNCERTAIN-A with intent REVOKING →
CANCELLATION: re-sends `revoke{6}`; sends no renew. H receives `revoke{6}`
first: RELEASED, `released{6}`. The delayed `revoke{5}` arrives: H is
terminal → step 5 → `terminal-receipt{released}`; A processes → confirms
RELEASED. At no point was a renew sent, so nothing overtook the revoke.

**L36. Unaccepted grant across resume.** OFFERED at 0; A resumes at 10
untrusted: UNCERTAIN-A with intent OFFERED → OFFER RECONCILIATION: sends
`void{2}`, VOID, reports. H's late `accept{1}` at 30: step 5 → `terminal-
receipt{void, 2}`; H releases. The grant never became active.

**L37. Double resume.** UNCERTAIN-A (intent GRANTED), attempt 1 with
`resume_origin` 1000 and `cand(8)`. A second untrusted resume: attempt 1's
candidates invalidated; attempt 2 opens at its first send with
`resume_origin` fresh and `cand(9)`; intent stays GRANTED. A `renewed{8}`
arriving now: guard 1 fails (attempt 1 invalidated) → ignored;
`renewed{9}` commits.
