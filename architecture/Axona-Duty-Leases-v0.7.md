# Duty leases (v0.7, consolidated)

**Status:** consolidated normative candidate for council review · **Date:**
2026-10-04 · **Kernel in production:** 4.102.0 (`270835d`) · **Policy set
by:** David · **Author:** axona.bot · **Supersedes:** v0.1–v0.6 (axona-docs
`b923e54`, `3c31d9d`, `a415b02`, `02375b6`, `559c50a`, `563339d`), all left
in place as record · **Driver:** Aster `c73bc3c7`, which closed the v0.5
correction round at the design-text level with two normative corrections
(the finite reply relation in place of an unconditional invariant; the
finite failure transition at window expiry) and asked for one text that
carries nothing by reference.

This file carries everything. Where earlier versions disagreed, this text
governs.

This document is a design. It changes no code. It is claimed on no legacy
edge. Deploy is David's.

---

## 1. The question

When one node takes on an obligation to another, when does each end know
the obligation exists, and when does each end know it has ended?

A root enlists backups and replication targets. A host serves a topic. A
handoff moves a role. Today the promise is created by a frame and ended by
nothing in particular. The step-down hold (4.102.0) fences one such
promise, the root's own claim, for five minutes. This document fences the
rest, under an authority it takes as given.

## 2. What this protocol is not

- NOT root fencing. Who the authority is, is decided elsewhere; this
  document says how the authority's promises are held and ended.
- NOT a timeout that means discharge. A lease ends by the authority's
  word or by a bound both ends computed in advance from local readings.
- NOT a global order of authorities. The epoch is a certificate this
  document requires and does not supply (§10).
- NOT persistence. A restart forgets every lease.
- NOT claimed on a legacy edge. A peer without `cap:lease` keeps today's
  paths and their guarantees, which are none.
- NOT available for any real duty until §10's adapter exists. The
  single-authority subprotocol is available for analysis with the
  authority as an assumption, and for nothing else.

## 3. Definitions

| term | meaning |
|---|---|
| AUTHORITY | the end that owns the role: the root for backup, replication and host; the giver for handoff. Taken as given. |
| HOLDER | the end that takes on the obligation. |
| `inc_a`, `inc_h` | the authority's and holder's incarnations, random per process, equality only. |
| `σ` | the pair's current session as the Channel Election document establishes it; every lease frame carries it. |
| `E` | the EPOCH CERTIFICATE for (topic, role), issued and validated by root fencing (§10); constant within one authority incarnation. |
| `L` | `{id, topic, role, authority, holder, E, seq, ttl}`; `id = (inc_a, inc_h, counter)`, counter per (authority incarnation, holder), consecutive. |
| `seq` | increments on every authority frame about `L`; the holder's frames echo the `seq` they answer. |
| `ttl` | the lease's lifetime, a duration; the only time-valued field on the wire. |
| `cand_A(seq)` | a CANDIDATE deadline recorded at the authority at the send of `renew{seq}`; not relied on until committed. |
| `deadline_A`, `deadline_H` | the committed deadlines, each a reading of that end's own monotonic clock at that end's own event. |
| lease-scoped work | work that ends with the lease: serving, forwarding, answering. |
| CUSTODY | data or accepted downstream obligations that survive the lease until confirmed transfer, explicit discharge, or the role's loss policy (§9). |
| `S_skew`, `ρ`, `D_max` | §8. |

## 4. Wire schema

Every frame carries `cls ∈ {request, response}`, `type`, `σ`, `inc_a`,
`inc_h`, `id`, `E`, `seq`. The class is fixed by `type`; no type is in both
classes; a frame whose `cls` does not match its `type` is malformed and
discarded before state dispatch.

| cls | type | extra fields |
|---|---|---|
| request | `grant` | `topic, role, ttl` |
| request | `renew` | `ttl` (full terms every time) |
| request | `revoke` | — |
| request | `void` | — |
| response | `accept` | — |
| response | `renewed` | `state` (the holder's state BEFORE processing the renew) |
| response | `released` | — |
| response | `lease-stale`, `lease-stale-authority`, `lease-stale-holder`, `lease-retired-session`, `lease-limit`, `lease-uncertain`, `lease-epoch-invalid` | reason |
| response | `terminal-receipt` | `for ∈ {void, released}` |

## 5. States

Authority, per lease: OFFERED → GRANTED ⇄ RENEWING; OFFERED → VOID;
GRANTED or RENEWING → REVOKING → RELEASED; GRANTED or RENEWING →
SUSPENDED → GRANTED (recovery) or RELEASED (failure); any → UNCERTAIN-A
on untrusted resume (§8.3). VOID and RELEASED are terminal and retained
for `T_term`.

Holder, per lease: none → HELD ⇄ RENEWING-H; HELD or RENEWING-H →
RELEASED; any live state → UNCERTAIN on untrusted resume; UNCERTAIN → HELD
on a fresh authority frame, or → RELEASED on revoke, void, or trusted
expiry. RELEASED is terminal and retained for `T_term`.

Two columns per lease at the holder: CAN-SERVE (lease-scoped work
permitted: HELD, RENEWING-H) and RETAINS (custody and obligation held:
every live state and UNCERTAIN, and RELEASED while custody is undischarged
under §9).

## 6. Frame admission

Before any `seq` comparison, in order; the first failing step discards
the frame and sends the named response where one is listed:

1. CLASS: `cls` matches `type`; else malformed, discard, no response.
2. SESSION: `σ` is the pair's current session; else `lease-retired-session`.
3. INCARNATIONS: `inc_a`, `inc_h` are the live ones; else
   `lease-stale-authority` / `lease-stale-holder`.
4. EPOCH: `E` validates under §10; else `lease-epoch-invalid`. (UNAVAILABLE
   until §10 exists; until then `E` is constant and this step passes.)
5. TYPE × STATE: admissible by the table below; else discard, report.
6. TERMS: for a live id, immutable terms equal those held; else malformed.
7. SEQ: lower than last processed: late, discard. Equal: duplicate, answer
   idempotently from current or retained state, allocate nothing. Higher:
   process. Gaps allowed; every renew carries full terms.

| receiver state | admissible request types | response types processed |
|---|---|---|
| holder: none | `grant` (then §7.1) | — |
| holder: HELD, RENEWING-H | `renew`, `revoke`, `void`, duplicate `grant` | — |
| holder: UNCERTAIN | `renew` (fresh: §8.3), `revoke`, `void` | — |
| holder: RELEASED (retained) | any request: answer `terminal-receipt{released}` | — |
| authority: OFFERED | — | `accept` with the grant's `seq` |
| authority: GRANTED, RENEWING | — | `renewed` matching the outstanding candidate; `released` |
| authority: SUSPENDED | — | `renewed` matching the outstanding RECOVERY candidate (§8.2) |
| authority: UNCERTAIN-A | — | `renewed` matching a post-resume candidate (§8.3) |
| authority: REVOKING | — | `released` |
| authority: VOID, RELEASED (retained) | any request: answer `terminal-receipt`; a late `accept`: answer `terminal-receipt{void}` (§6.1) | all others: nothing |

### 6.1 The finite reply relation

This replaces every earlier "a response never provokes a response":

- A REQUEST may yield at most one RESPONSE per `seq` at the receiver, and
  every repeat of an authenticated request is answered again,
  idempotently (no suppression by `seq`: a lost receipt would otherwise
  never be repaired).
- A late `accept` arriving at a terminal authority yields one
  `terminal-receipt{void}`. Deciding that an `accept` is late uses lease
  state (the authority is VOID or RELEASED for that id); classifying the
  frame uses only wire fields.
- `terminal-receipt` and every other RESPONSE yield nothing.

The relation is finite and acyclic: the only response-to-response edge is
`accept → terminal-receipt`, and `terminal-receipt` has no outgoing edge.

## 7. Capacity

### 7.1 Grant admission at the holder

Per (authority incarnation, holder) the holder keeps the HIGH-WATER
counter, LIVE ids, RETAINED terminals, and IN-FLIGHT grants (received,
not yet answered). A `grant` passes §6, then:

1. `id` live → duplicate, answer current `accept`, allocate nothing.
2. `id` retained → answer the retained terminal, allocate nothing.
3. `counter ≤ high-water` and neither → CONSERVATIVE OUT-OF-ORDER
   REFUSAL, `lease-stale`. The grant may have been legitimate and
   reordered; the authority, on `lease-stale`, voids it and reissues under
   a fresh id. The cost is one round trip; the benefit is that no grant
   below the high-water is ever admitted.
4. SLOT: `LIVE + RETAINED + IN-FLIGHT + 1 ≤ L_slots`; else `lease-limit`,
   nothing allocated.
5. Admit: high-water advances; the slot is reserved; the holder enters
   HELD at the instant it SENDS `accept`, recording `acceptAt` on its own
   clock and `deadline_H := acceptAt + ttl + S_skew`.

A slot is conserved: IN-FLIGHT → LIVE on accept, LIVE → RETAINED on
release or void, RETAINED → free after `T_term`. Release consumes its own
reserved space and is never refused. The bound is per (authority
incarnation, holder); the holder's aggregate is `L_inc × L_slots` over the
authority incarnations it remembers, with Hold-and-Fill's physical and
memory bounds on top; `L_slots` alone implies no whole-process memory
bound. At `L_inc` remembered incarnations a new one is refused and nothing
is evicted.

## 8. Deadlines

### 8.1 The clock model and the margin

Every deadline is a reading of the end's own monotonic clock at an event
at that end. No absolute time crosses a clock boundary; the only
time-valued wire field is `ttl`, a duration. Assumptions: RATE, each clock
within `1 ± ρ` of true time; DELAY, one-way delivery at most `D_max`
(liveness only); WALL TIME, never read for a deadline, read once at resume
as an untrusted hint; SUSPENSION and RESTART, §8.3. No offset assumption.

GRANT. Authority at the send of `grant`: `deadline_A := now_A + ttl −
S_skew`. Holder at the send of `accept`: `deadline_H := now_H + ttl +
S_skew`. With the holder's event later than the authority's by `δ ≥ 0`,
the true-time separation is

```
δ + (ttl + S_skew)/(1 + ρ) − (ttl − S_skew)/(1 − ρ)
  = δ + 2·(S_skew − ρ·ttl)/(1 − ρ²)
```

positive whenever `S_skew > ρ·ttl`, `0 ≤ ρ < 1`, `ttl > S_skew`. A
local-duration argument: no clock offset and no delivery bound is needed
for it. THE AUTHORITY STOPS RELYING BEFORE THE HOLDER STOPS HOLDING, under
RATE.

RENEWAL. At `ttl/3` after its last committed deadline-setting event the
authority sends `renew{seq, ttl}`, records `cand_A(seq) := now_A + ttl −
S_skew` at that send, and enters RENEWING; `deadline_A` is UNCHANGED. The
holder, at processing, sets `deadline_H := max(deadline_H, now_H + ttl +
S_skew)` (non-decreasing) and answers `renewed{seq, state}`. The authority
COMMITS `deadline_A := cand_A(seq)` only when, in one step: the candidate
for `seq` is outstanding (not consumed, not invalidated); `now_A <
deadline_A` (the old commitment still valid); `now_A < cand_A(seq)`; and
the `renewed` matches `id`, both incarnations, `E`, `seq`, `ttl`, with
`state ∈ {HELD, RENEWING-H, UNCERTAIN}`. Commit consumes the candidate. A
`renewed` failing any guard is ignored. Each accepted renewal re-runs the
separation argument from fresh readings at two delivery-ordered events,
so nothing accumulates; the horizon is the last committed deadline, so an
authority whose renewals go unanswered relies no later than that.

VOID. At `T_offer` with no `accept`: `void{seq 2}`, VOID (retained
`T_term`). A late `accept` is answered `terminal-receipt{void}` (§6.1); the
holder on it releases. The holder held for at most `T_offer + 2·D_max`
under DELAY, and the authority relied on nothing.

REVOKE. The authority enters REVOKING, which STOPS RELIANCE, and only
then sends `revoke`; `released` is accounting; REVOKING → RELEASED on
`released` or on `deadline_A`, whichever first.

### 8.2 Loss, SUSPENDED, recovery, failure

Loss of the channel suspends at both ends and releases at neither. When
`deadline_A` passes without a committed receipt the authority is
SUSPENDED and relying on nothing: it records `recovery_origin := that
deadline` and sends RECOVERY RENEWS `{seq+1, …}` on any duty-capable
channel, each with `cand_A(seq) := now_A + ttl − S_skew` at its send. It
commits only when, in one step: the candidate is outstanding; `now_A <
cand_A(seq)`; `now_A < recovery_origin + T_recover`; and the `renewed`
matches with `state ∈ {HELD, RENEWING-H, UNCERTAIN}`. Commit consumes the
candidate and returns to GRANTED.

FAILURE, the finite transition: at `recovery_origin + T_recover` with no
committed receipt, the attempt is FAILED: every candidate of the attempt
is invalidated; no further recovery renews are sent for it; `lease-
recovery-failed` is reported; the lease goes to RELEASED at the authority;
and the role's own recovery runs under its own authorization. Later
traffic for the attempt cannot restore it: any matching `renewed` fails
the outstanding guard. A future recovery is a NEW attempt with its own
`recovery_origin`, its own candidates and its own authorization scope,
never a reset of the old origin. The holder, past its own `deadline_H`
with no frame, expires: CAN-SERVE no, RETAINS per §9.

### 8.3 Uncertainty, at either end

A holder that resumes with untrusted elapsed time enters UNCERTAIN for
every live lease: CAN-SERVE no, RETAINS yes. It leaves UNCERTAIN for a
lease only on: a FRESH authority frame for that id (one that passes §6
with `seq` above the last processed, in the current session), or a
trusted elapsed-time source showing `deadline_H` passed. On a fresh
`renew` it establishes a NEW HOLDING INTERVAL, `deadline_H := now_H + ttl
+ S_skew`, from its own processing event with NO `max` against any
pre-suspension value, and answers `renewed{seq, state: UNCERTAIN}`; the
authority treats that as commit-eligible by the margin argument applied to
those two events. `seq` freshness means an unprocessed frame and nothing
about time; it is not custody evidence. A replayed or already-answered
frame is not release evidence. A pre-suspension deadline is never compared
against a clock whose behaviour across the suspension is unknown. A
holder with no trusted source and no authority frame stays UNCERTAIN,
retaining, indefinitely; intended.

An authority that resumes with untrusted elapsed time enters UNCERTAIN-A
for every lease it grants: it invalidates every pre-resume candidate and
deadline (never read again), and per lease records `resume_origin :=
now_A` at the FIRST post-resume recovery send for that lease, then runs
§8.2's recovery with `recovery_origin := resume_origin` for this
transition only. The two origins are never mixed. Failure at
`resume_origin + T_recover` is §8.2's failure transition.

RESTART forgets every lease at that end. A crashed holder is a lost
holder, handled by the authority's expiry; custody held only in memory is
lost with the process, as today.

## 9. Roles, custody, exclusive actions

Every row is PROPOSED and is UNAVAILABLE until §10. Source first,
proposal second.

| role | source (kernel today) | proposed | grantor → holder | custody release |
|---|---|---|---|---|
| backup | the backup is the RECEIVER of `REPLICATE`: `_onReplicate` → `_syncIngest` → `becomeBackup` (`wireHandlers.js:901–906`, `syncEngine.js:229–243`); sends nothing first | a `grant{backup}` precedes the first `REPLICATE`; `accept` is the frame the source lacks | root → backup | an ATTESTED RECEIPT from the root naming object set, version and coverage; or explicit discharge; or the role's loss policy |
| replication target | as backup | as backup | root → target | as backup |
| host | `peer.host()` is local (`AxonaPeer.js:2727–2768`); no frame, no second node | a NEW root→host lease; `peer.host()` without one stays what it is | root → host | attested transfer, or discharge, or loss policy |
| handoff | `pubsub:handoff`/`handoffack`; the heir calls `_becomeRoot('handoff-heir')` BEFORE the ack (`syncEngine.js:204–219`) | a NEW `handoff:committed` from the heir after its own role lease is HELD and completeness is attested; the giver discharges on `committed`; the heir's early root is an EXCLUSIVE ACTION | giver → heir | `committed` with attestation; ACTIVATION and STOP are fenced events §10 must supply; OPEN |
| the hold's forward | `_holdIntercept` redirects or drops (`wireHandlers.js:206–248`) | nothing; a forward is not an obligation | — | — |
| the epoch | `become()` mints a local `role.epoch`; `demote()` writes `_stepDownHold` locally (`rootClaim.js:372–390`) | not `E`; `E` is §10's certificate | — | — |

CUSTODY survives expiry until: an ATTESTED RECEIPT (object set, version,
coverage; "newer" is not a receipt); an explicit discharge; or the role's
loss policy, named in the role's own design. OVERLAP of an unrevoked old
holder and a replacement is permitted for NON-EXCLUSIVE duties
(forwarding, serving reads, holding a replica); EXCLUSIVE actions (the
single root, acknowledging a handoff) are fenced by §10's certificate and
UNAVAILABLE until it exists. The duty registry Hold-and-Fill's `mayRetire`
reads is every lease in OFFERED, GRANTED, RENEWING, SUSPENDED,
UNCERTAIN-A at the authority and HELD, RENEWING-H, UNCERTAIN at the
holder, plus every undischarged custody.

## 10. Open adapter prerequisites

Required, not supplied:

1. THE EPOCH CERTIFICATE: a value per (topic, role), totally ordered,
   issued by root fencing, validated by the holder. Until it exists:
   supersession, epoch-ordered rejection, any release of another
   authority's lease, every exclusive action, and every role row are
   UNAVAILABLE. What remains available: the single-authority subprotocol,
   for analysis, with the authority as an assumption.
2. SESSION AND HANDSHAKE FRESHNESS: the Channel Election document's §11.
3. HANDOFF ACTIVATION AND STOP: fenced events that cannot overlap.
4. EACH ROLE'S LOSS POLICY: in the role's own design.

## 11. Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `ttl` | 120 s | `ρ × ttl < S_skew` is the condition the arithmetic needs; raise if `ttl/3` renew traffic is measurable on a phone |
| `ρ` | 10⁻⁴ | measured monotonic drift |
| `S_skew` | 5 s | measured spread; on a phone the SUSPENSION rule, not this bound, is the protection |
| `D_max` | 10 s | an assumption; liveness only |
| `T_offer` | 25 s (`≥ 2·D_max` + processing) | a healthy slow link voided |
| `T_recover` | 60 s | the time a role can be without its duty, per role |
| `T_term` | 2 × `ttl` | long enough under `D_max` for any in-flight frame to be answered |
| `L_slots` | 32 per (authority incarnation, holder) | a `lease-limit` report under normal load |
| `L_inc` | 8 | aggregate `L_inc × L_slots` = 256 |
| `cap:lease` | advertised by every capable kernel | the version that ships this |

## 12a. Appendix: reviewed traces and arithmetic

**Margin.** `ρ = 10⁻⁴`, `ttl = 120`, `S_skew = 5`: per-interval rate error
at most 0.012 s; separation at least `2·(5 − 0.012)/(1 − 10⁻⁸) > 0` at
every grant and every accepted renewal; after 1,000 renewals the same.

**L2. Delivered accept, delayed payload** (equal clocks). Grant at 0:
`deadline_A` 115, `deadline_H` 125. Renew sent at 40: `cand` 155;
`deadline_A` still 115; H sets 165, answers; A commits 155 at 44. No
payload for 60 s: H holds (no `D_ack` exists). Separation 10, preserved.

**L17. Lost renew.** Renew sent at 40, lost: A relies until 115, then
SUSPENDED, relying on nothing; H expires lease-scoped work at 125,
retains custody. At no instant did A rely on a released holder.

**L4b. Revoke, released delayed.** REVOKING at 50 (reliance stops), revoke
sent; H releases at 53, `released` delayed to 90; A relied on nothing from
50. The invariant held because reliance stopped before the frame left.

**L12. Horizon.** Renewals at 40, 80, …, each committed on receipt as
`t_send + 115`; renewals stop after the one sent at 400 and acknowledged
at 404: `deadline_A = 515`, no later.

**L19. Out-of-order grants.** Counters 1, 2 issued; 2 delivered first
(admitted, high-water 2); 1 arrives: `lease-stale`; authority voids 1 and
reissues as 3; admitted. One round trip lost; no grant below the high-
water admitted.

**L21c. Repeated batches.** `L_slots` 32, `T_term` 240: admit 16, release
at 60, admit 16 at 70, release at 120; a 33rd at 130 refused; at 300 the
first batch's terminals free; no release refused; sum never above 32.

## 12b. Appendix: unexecuted adversarial scenarios

Expected outcomes, to become tests; not evidence.

**L1.** Delayed accept: `void{seq 2}` at `T_offer`; late accept answered
`terminal-receipt{void}`; holder releases; a replayed grant at the holder
answered with its retained terminal.

**L3b.** Recovery on a new channel with old-channel frames in flight:
ordered by `seq`; a stale `renewed` ignored.

**L7b** (equal-clock, `ρ = 0` illustration). SUSPENDED at 155; recovery
renew `{7}` at 160, `cand` 275; `renewed{7, HELD}` at 200 commits (`275 ≤
H's 285`); at 230 with `T_recover` 60: guard `now_A < 155 + 60` fails →
ignored; at `215` the attempt FAILS (§8.2): candidates invalidated, no
more sends, reported, role recovery, RELEASED at A.

**L9b.** Holder suspension → UNCERTAIN; A's next renew is fresh → new
interval, `renewed{state: UNCERTAIN}`, commit. Variant: no frame ever:
UNCERTAIN indefinitely, retaining.

**L13, L14, L14b.** Forgotten old grant → `lease-stale`; holder restart →
`lease-stale-holder` on renew, re-grant under the new incarnation; a
delayed old grant after holder restart fails §6 step 2.

**L18.** A renew delivered after the holder's deadline meets terminal
retention and extends nothing.

**L20.** Recovery against an UNCERTAIN holder: a fresh renew exits
UNCERTAIN and commits; a replayed one answers `lease-uncertain` and does
not commit.

**L22.** Late matching recovery receipt after window or candidate expiry:
ignored; after commit: ignored (consumed).

**L23, L26.** Authority resume: pre-resume candidates invalidated;
`resume_origin` at the first post-resume send; a receipt inside the fresh
window commits; one past it is ignored and, at `resume_origin +
T_recover`, the attempt FAILS by §8.2's transition, with a new attempt
needing a new origin.

**L24.** Both terminal: a late `void` (request) answered once with
`terminal-receipt`; the receipt (response) answered with nothing.

**L25.** Lost terminal receipt, then the same-`seq` retry: answered again.

**L27.** Late `accept` at a VOID authority: `terminal-receipt{void}`; the
holder, classifying by `cls`, sends nothing; the authority used lease
state to know the accept was late, as §6.1 says.

**L10, L16.** Handoff: the heir acts only after its own lease and an
attestation; the giver discharges only on `committed`; a short receipt
(`v11` for `v12`) is refused and custody retained. UNAVAILABLE under §10.
