# Duty leases (v0.8, consolidated)

**Status:** consolidated normative candidate for council review, second
consolidation · **Date:** 2026-10-04 · **Kernel in production:** 4.102.0
(`270835d`) · **Policy set by:** David · **Author:** axona.bot ·
**Supersedes:** v0.7 (axona-docs `63c2dbe`) and v0.1–v0.6, all left in
place as record · **Driver:** Aster `df0a220c`, the full-text review of the
first consolidation: the receiver table processed no responses at a
holder, so the late-accept receipt was discarded by the table that
elsewhere required its processing; early admission exits could answer an
error with an error without end; the OFFERED→GRANTED commit, the holder's
behaviour on channel loss, terminal non-resurrection on resume and
latest-only candidate tracking were implicit; `renewed` lacked the `ttl`
its commit matched on; and the separation expression was called an
equality. Decisions recorded at `09158726`. Also Vega `148f72f0`: the
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
| response | `terminal-receipt` | `for ∈ {void, released}` | — |

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
   answered with `terminal-receipt`; a late `accept` (the one response
   that completes a request this end originated) is answered with
   `terminal-receipt{void}` REGARDLESS of its `seq` (grant `seq 1` is
   older than void `seq 2`; this row runs before step 8 for that reason);
   every other response is discarded. Stop.
6. TYPE × STATE: the frame type is admissible in the receiver's state by
   the table below; else discard, report (no response for either class).
7. TERMS: for a live `id`, transmitted immutable terms equal the held
   ones; else malformed.
8. SEQ: lower than last processed: late, discard. Equal: duplicate: a
   request is answered again idempotently from current state, allocating
   nothing; a response is discarded. Higher: process. Gaps allowed.

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

EXPIRY at the holder: at `deadline_H` with no frame since, HELD →
RELEASED (`lease-expired` reported), CAN-SERVE no, custody per §9.

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
authority; the role's own recovery runs under its own authorization.
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
UNCERTAIN-A; terminal leases untouched. For each: invalidate every
pre-resume candidate and deadline (never read again); at the FIRST
post-resume recovery send for the lease record `resume_origin := now_A`
and run §8.2's recovery with `recovery_origin := resume_origin`, for this
transition only; the two origins are never mixed. The post-resume
commit's guards are §8.2's, with `state` UNCERTAIN accepted as
commit-eligible by the margin argument applied to the holder's processing
event and the authority's send. Failure at `resume_origin + T_recover` is
§8.2's failure transition.

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

**L3b, L7b, L9b, L13, L14, L14b, L18, L20, L22, L23, L24, L25, L26, L27,
L10, L16.** As the first consolidation's expected outcomes, re-read
against this file's tables: L7b and L26 end in §8.2's FAILED transition;
L24's receipt is a response and is discarded at a terminal end; L27's
authority used lease state to know the accept was late; L20's replayed
renew is answered `lease-uncertain` and does not commit.
