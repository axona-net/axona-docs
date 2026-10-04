# Duty leases (v0.2)

**Status:** design for council review, revision 2 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Supersedes:** v0.1 (axona-docs `b923e54`), left in
place as record · **Revision driver (v0.2):** Aster `70416996`, CHANGES
REQUIRED on v0.1, decisions recorded at `f1d2c8f1`. The v0.1 errors: revoke
let the authority keep relying after the holder had released, which breaks
the one invariant the protocol exists for; renewal carried an absolute time
across two clocks, which does not preserve the separation the initial
arithmetic gave; the clock model was a single receipt-time skew check; `void`
reused `seq 1`; terminal states had no replay barrier; the epoch was a local
counter presented as a global order, which it is not; host authority was
stated two ways; and lease-scoped work and custody were one thing.

**What changed from v0.1:** a monotonic-clock model with drift, suspension
and restart stated; REVOKING as a state entered before the frame is sent;
relative renewal; terminal-state retention with idempotent replies; the
lease id scoped to the authority's incarnation; root fencing as an OPEN
prerequisite with an epoch certificate, and every epoch-dependent behaviour
marked UNAVAILABLE until it exists; a role table with grantor and holder per
role and the handoff commit boundary; custody as a second kind of duty; six
new traces. *The question* and *What this protocol is not* stand as v0.1
wrote them, with one addition under *not*: it is NOT a global order of
authorities.

This document is a design. It changes no code. Deploy is David's.

---

## The clock model

Every deadline in this protocol is a reading of the end's own MONOTONIC
clock (`performance.now()`, `process.hrtime`), never wall time. Assumptions,
each a parameter:

- RATE: each clock runs at a rate within `1 ± ρ` of true time, and
  `ttl × ρ ≪ S_skew`, so drift over one lease is inside the skew bound.
- OFFSET: at any instant the two ends' clocks differ by at most `S_skew`
  after subtracting delivery delay; this is what the initial arithmetic uses
  and it is checked once, at grant.
- DELAY: one-way delivery takes at most `D_max`. This is an assumption. A
  frame that took longer is handled by ordering and by the deadlines, and
  every claim conditional on `D_max` says so.
- STEPS: wall-clock steps do not exist for this protocol because it does not
  read the wall clock.
- SUSPENSION: a suspended process's monotonic clock may stop or may continue;
  on resume, an end compares the elapsed wall time of the suspension (which
  it can read once, at resume) with the remaining time on every lease it
  holds or grants, and treats any lease whose remaining time is less than the
  suspension as EXPIRED at the resume instant. Conservative at both ends; a
  holder discards work, an authority runs recovery.
- RESTART: a process starts with no leases; its `inc` (the incarnation drawn
  at start, as in Channel Election) is embedded in every lease id it issues,
  so frames from a previous incarnation of the same identity are rejected by
  the id.

## Definitions

As v0.1, with: `L.id = (inc_authority, counter)`; `E` is an EPOCH CERTIFICATE,
not a counter (below); the authority's deadline and the holder's deadline are
each a monotonic reading at that end.

## Root fencing is an open prerequisite

v0.1 numbered a local role-change event and called it an epoch. Two
competing new roots can each choose `E + 1`; a restart forgets what `E` was;
and the five-minute step-down hold fences one node's own retake, not the
global order of authorities. None of that is a comparable global order.

This protocol REQUIRES, and does not supply, an EPOCH CERTIFICATE for each
(topic, role): a value issued by the root-fencing mechanism, totally ordered
for that (topic, role), that a holder can validate against the fencing
mechanism's own view. Every lease frame carries it. A holder rejects a grant
whose certificate it cannot validate, with `lease-epoch-invalid`.

UNTIL THAT MECHANISM EXISTS AND IS REVIEWED, the following are UNAVAILABLE:
supersession of a lease by a higher epoch; rejection of a late frame by
epoch; any claim that a new authority's grant releases an old authority's
lease. What remains available without it: every rule below that uses `seq`
within one lease, the expiry arithmetic, revoke, renewal, loss and recovery,
all scoped to a single authority incarnation. The document says, per rule,
which column it is in.

## Roles: who grants, who holds

| role | authority (grantor) | holder | custody at expiry |
|---|---|---|---|
| backup | the root | the backup | the backup's replica is CUSTODY until the root confirms it holds a newer one or discharges it |
| replication target | the root | the target | as backup |
| host | the ROOT of the topic | the host | the hosted data is CUSTODY until transferred or discharged |
| handoff | the GIVER (the current role holder under the root's certificate) | the receiver | the giver retains custody until `handoff:committed` arrives from the receiver under the receiver's lease |

v0.1's "host is the authority" is withdrawn: the host holds a lease from the
root to serve; the registering node is the holder. The handoff's commit
boundary is the row above: the giver's duty is not discharged by the
receiver's `accept`; it is discharged by `handoff:committed`, a frame the
receiver sends only after it holds its own lease for the role and has the
custody.

## Two kinds of duty

LEASE-SCOPED WORK ends when the lease ends: serving a subscriber, forwarding
for a backup, answering as a host. CUSTODY is data or an accepted downstream
obligation that does not vanish when the lease does: a replica, hosted
messages, a handoff in flight. Custody survives expiry until one of three
events, each named per role in the table: confirmed transfer, explicit
discharge by the authority, or an explicitly accepted LOSS POLICY (the role
says, in its own design, when custody may be dropped unconfirmed; this
protocol never decides that). The duty registry reads both kinds, and
`mayRetire(v)` is false while `v` is party to either.

The safety property is scoped to the crash assumption: a crashed holder is a
lost holder, which the authority's expiry handles; custody held only in
memory is lost with the process, as it is today, and this document does not
change that. It says so instead of claiming unconditional holding.

## States

Authority, per lease:

```
OFFERED → GRANTED → RENEWING → GRANTED → …
OFFERED → VOID
GRANTED | RENEWING → REVOKING → RELEASED
GRANTED | RENEWING → SUSPENDED → GRANTED (recovery) | RELEASED (expiry)
```

Holder, per lease: `HELD → RENEWING-H → HELD`, `HELD | RENEWING-H →
RELEASED`. RENEWING at either end is a held, relied-upon state and the
registry treats it as HELD/GRANTED for the duty gate.

Terminal states VOID and RELEASED are RETAINED for `T_term` with the lease's
last `(E, seq)`; any frame for that id during retention is answered with the
terminal frame (`void` or `revoke`) and nothing else happens. After `T_term`
the id is forgotten; a frame for a forgotten id is answered `lease-unknown`
and ignored. A grant arriving for an id the holder has in RELEASED is NOT a
new lease; a new lease has a new id.

## The frames and their ordering

As v0.1, plus `lease:lease-unknown`, `lease:epoch-invalid`, `handoff:committed`.
`seq` starts at 1 on `grant` and increments on EVERY authority frame about
the lease, so `void` after `grant` carries `seq 2`, the first `renew` carries
the next value, and so on. The holder's frames echo the `seq` they answer.

ORDERING at both ends, per id: a frame whose `seq` is lower than the last
processed is late and is discarded; a frame whose `seq` EQUALS the last
processed is a duplicate and is answered idempotently (the same reply as
before, from the retained state); a frame with a higher `seq` is processed.
`E` ordering is UNAVAILABLE until the certificate exists; within one
authority incarnation `E` is constant and `seq` is total.

## The lifecycle

**Grant and accept.** As v0.1: the authority OFFERED at send with `T_offer`;
the holder HELD at the instant it sends `accept{id, E, 1}`, recording
`acceptAt` on its monotonic clock; the authority GRANTED at receipt, and
relying from then.

**Void.** At `T_offer` with no accept: `void{id, E, 2}`, VOID (retained
`T_term`). A late `accept{…,1}` during retention: lower `seq` than 2 →
answered with the retained `void`. A replayed `grant{…,1}` at the holder
after it has RELEASED on the void: the holder's retained terminal answers
`released`; nothing is resurrected. Trace L1 as v0.1 with the corrected
`seq`.

**Deadlines, initial.** Authority: `issuedAt_mono + ttl − S_skew`. Holder:
`acceptAt_mono + ttl + S_skew`. Under the offset assumption, the holder's
true deadline is later than the authority's by at least `S_skew` net of
drift; the authority stops relying first. This is the v0.1 argument, now
stated as conditional on RATE and OFFSET.

**Renewal, relative.** At `ttl/3` after grant and after each renewal, the
authority sends `renew{id, E, seq, extendBy}` with `extendBy = ttl` (a
duration) and enters RENEWING. The holder, on a `renew` whose `seq` is the
next expected, sets `deadline_H := deadline_H + extendBy` (its own clock, its
own current deadline, never decreasing) and answers `renewed{id, E, seq}`,
entering RENEWING-H → HELD. The authority, on a `renewed` whose `seq`
matches the OUTSTANDING renew and which arrives BEFORE its current deadline,
sets `deadline_A := deadline_A + extendBy` and returns to GRANTED. A
`renewed` for any other `seq` is ignored. A `renewed` arriving at or after
the authority's deadline is rejected: the authority is already SUSPENDED and
runs recovery, and the holder's extension stands on its side only, which is
safe because the holder holding longer than the authority relies is the
permitted direction. Because both ends add the same duration to their own
deadlines, the initial separation is preserved through every renewal; no
absolute time ever crosses the clock boundary after issue. Renewal of an
expired HELD is forbidden: the holder answers `lease-unknown` or its retained
terminal; a new lease is a new grant.

**Revoke, reliance first.** The authority enters REVOKING, WHICH STOPS
RELIANCE, and only then sends `revoke{id, E, seq}`. The holder, on `revoke`,
releases at receipt and answers `released`. The authority leaves REVOKING →
RELEASED on `released` or on its own deadline, whichever first; `released`
is accounting. At no instant does the authority rely on a holder that has
received `revoke`. Trace L4b.

**Loss and recovery.** As v0.1: SUSPENDED at the authority, HELD at the
holder, no release at either end; recovery is a `renew` on a new
duty-capable channel carrying the next `seq`; old-channel frames still in
flight are ordered by `seq` like any other, and a `renewed` for an older
`seq` arriving on the old channel after the new renew is ignored. Trace L3b.

## Authority change

UNAVAILABLE until the epoch certificate exists. When it does: a holder that
validates a certificate higher than the one on a lease it holds releases
that lease with `lease-superseded`, custody rules still applying, and
accepts grants only under the new certificate; frames under the old
certificate are discarded. A higher number alone releases nothing; a
validated certificate does.

## Integration with Hold-and-Fill

As v0.1, with: the registry includes RENEWING and RENEWING-H; the role table
above replaces v0.4's offer/accept table; `D_ack` and `duty-orphaned` are
withdrawn; custody is a registry entry of its own kind; every behaviour that
Hold-and-Fill derives from `E` is UNAVAILABLE with the certificate.

## What this design does not establish

- A global order of authorities. Root fencing, open.
- That a holder does the work it accepted. The role's verification.
- Unconditional holding across crash or suspension. Scoped to the
  assumptions above.
- The loss policy for any role's custody. Each role's own design.
- Anything under `D_max` violation beyond ordering and deadlines.
- Anything on a legacy edge.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `ttl` | 120 s | `ttl × ρ ≪ S_skew`; raise if renew traffic at `ttl/3` is measurable on a phone |
| `ρ` | 10⁻⁴ | the measured monotonic drift across the fleet |
| `S_skew` | 5 s | measured clock spread; NTP on relays, nothing on phones. On a phone the OFFSET assumption is not checkable past grant time; the SUSPENSION rule above is what protects a throttled or sleeping holder, and a holder that cannot read elapsed wall time at resume treats every lease as expired (Orion `4ee99568`) |
| `D_max` | 10 s | an assumption; the 99th percentile at step 2 is the first check of it |
| `T_offer` | 25 s | must satisfy `T_offer ≥ 2·D_max + processing`, or a grant and an accept each at the delay bound are voided on a healthy slow link (Orion `4ee99568`; v0.1's 10 s violated it) |
| `T_term` | 2 × `ttl` | long enough for any in-flight frame under `D_max` to be answered |
| `cap:lease` | advertised by every capable kernel | the version that ships this |

## Appendix: traces

Notation as v0.1; `seq` shown; clocks monotonic.

**L1. Delayed accept.** `grant{1}` at `@A=0`, OFFERED. Holder HELD at
`@H=4`. Accept delayed. `@A=10` `void{2}`, VOID (retained). `@A=24`
`accept{1}` arrives: `seq 1 < 2` → answered with the retained `void{2}`. H
on `void`: RELEASED, retained; a replayed `grant{1}` at `@H=40` is answered
`released`. Nothing resurrected.

**L2. Delivered accept, delayed payload.** As v0.1; `renew{2, extendBy 120}`
at `@A=40`; H: `deadline_H 127 → 247`; A on `renewed{2}` at `@A=44`:
`deadline_A 115 → 235`. Separation preserved (12 → 12, both clocks).

**L3b. Recovery with old-channel frames in flight.** GRANTED, `renew{3}` sent
on channel `c1` at `@A=80`; `c1` dies at `@A=81`; SUSPENDED, relying until
`deadline_A`. New channel `c2` elected at `@A=90`; `renew{4}` on `c2`. H
receives `renew{4}` first (c1's `renew{3}` was lost): processes, extends,
`renewed{4}`. A: outstanding is `seq 4` → extends, GRANTED. Later `renew{3}`
arrives at H by a surviving path: `seq 3 < 4` → discarded. H's late
`renewed{3}`, if any, at A: not the outstanding seq → ignored.

**L4b. Revoke of an established lease, released delayed.** GRANTED/HELD.
`@A=50` A enters REVOKING (reliance stops here), sends `revoke{5}`. H
receives at `@H=53`: RELEASED, sends `released{5}` DELAYED. A at `@A=53`
onward relies on nothing. `released{5}` arrives at `@A=90`: REVOKING →
RELEASED. The window `@A=50..90`: A not relying, H not holding. The
invariant held because reliance stopped before the frame left.

**L5. Authority change.** UNAVAILABLE; trace retained as the target behaviour
once the certificate exists, labelled as such.

**L7. Delayed `renewed` after authority expiry.** `renew{6}` sent at `@A=100`,
`deadline_A 115`. H extends to its own `deadline_H + 120` and sends
`renewed{6}`, delayed. `@A=115`: no `renewed` → SUSPENDED → recovery
(re-grant to another holder at `@A=120` under a new id). `renewed{6}`
arrives at `@A=130`: at or after the deadline → rejected; the original lease
is RELEASED at A. H holds the original until its own extended deadline, then
`lease-expired`; the work is wasted, never conflicting: A stopped relying at
115.

**L8. Duplicate grant after terminal release.** H RELEASED on `revoke{5}`,
retained. `grant{1}` for the same id replayed: `seq 1 < 5` → answered with
the retained `released`. After `T_term`: `lease-unknown`.

**L9. Suspension.** H HELD with 40 s remaining; the tab is suspended for 90 s.
On resume, H reads elapsed wall time 90 > 40 → EXPIRED at resume; H discards
lease-scoped work and keeps custody under the role's policy. A had expired
H's lease on its own clock at the original deadline and run recovery.

**L10. Handoff commit boundary.** Giver G holds role R under certificate `E`.
G grants `handoff` to receiver V: `grant{1}`; V HELD on `accept`. G keeps
custody and keeps serving. V obtains its own lease for R from the root (a
separate grant, root → V). V, holding both, sends `handoff:committed`. G, on
`committed`, discharges custody and REVOKING → RELEASED its handoff lease.
If `committed` never arrives: G's handoff lease expires at G's deadline; G
still holds custody and still serves; the handoff failed, nothing was lost.
