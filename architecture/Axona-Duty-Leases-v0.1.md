# Duty leases (v0.1)

**Status:** design for council review, revision 1 · **Date:** 2026-10-04 ·
**Kernel in production:** 4.102.0 (`270835d`) · **Policy set by:** David ·
**Author:** axona.bot · **Driver:** David's direction of 2026-10-04 ("write the
two protocols now"), after Aster `76bc93dd` and `0d7f2982` showed that
Hold-and-Fill v0.4's duty creation lets an obligation exist at one end and
not the other, and lets a timeout stand in for discharge: a delayed accept
creates a duty against an acceptance already released; a delivered accept
with a delayed first payload releases a duty the other end relies on; no loss
detector tells those schedules from a lost accept. This document is the
contract those rules lacked. Hold-and-Fill (`8b9b214`) depends on it and will
say so.

This document is a design. It changes no code. Deploy is David's.

---

## The question

When one node takes on an obligation to another, when does each end know the
obligation exists, and when does each end know it has ended?

A root enlists backups and replication targets. A host serves a topic. A
handoff moves a role. Each of these is a promise between two nodes that one
will do something for the other for a while. Today the promise is created by
a frame and ended by nothing in particular: a lost channel, a timer, a newer
root. The step-down hold (4.102.0) fences one such promise, the root's own
claim, for five minutes. This document fences the rest.

## What this protocol is not

It is NOT root fencing. Who is the authority for a topic is decided by the
root claim and the step-down hold; this document takes the authority as
given and says how the authority's promises are held and ended. If the
authority is wrong, the lease is wrong, and that is the fencing problem, not
this one.

It is NOT a timeout that means discharge. A lease ends by the authority's
word or by a bound both ends computed in advance. "No traffic for ten
seconds" ends nothing.

It is NOT claimed on a legacy edge. A peer without `cap:lease` is appointed
by the existing frames with the existing guarantees, which are none.

It is NOT persistence. A lease lives in memory. A restart forgets every
lease, as it forgets everything, and the loss path handles it.

## Definitions

- AUTHORITY: the end that owns the role the obligation serves. For backups
  and replication targets, the root. For a served topic, the host. For a
  handoff, the end giving the role away.
- HOLDER: the end that takes on the obligation.
- EPOCH `E`: a counter per (topic, role, authority identity), incremented
  whenever the authority for that role changes. The root claim and the
  step-down hold already produce the event; this document gives it a number
  carried on every lease frame.
- LEASE `L = {id, topic, role, authority, holder, E, seq, ttl, issuedAt}`.
  `id` is unique per lease; `seq` is a per-lease counter the authority
  increments on every frame it sends about `L`; `ttl` is the lease's
  lifetime; `issuedAt` is the authority's clock at issue.
- `S_skew`: the bound on clock difference between any two nodes that this
  protocol assumes. `D_max`: the bound on one-way delivery delay it assumes.
  Both are parameters, and what happens when they are violated is stated.

## States

At the authority, per lease: OFFERED → GRANTED → (RENEWING ↔ GRANTED) →
RELEASED, with VOID reachable from OFFERED and SUSPENDED reachable from
GRANTED on channel loss.

At the holder, per lease: none → HELD → RELEASED, with HELD entered at one
instant and left at one of three.

## The frames

All on a channel that both ends hold duty-capable under Hold-and-Fill's
fence; a lease frame on any other channel is dropped and counted.

```
lease:grant   { L }                      authority → holder   (the offer)
lease:accept  { id, E, seq }             holder → authority
lease:void    { id, E, seq }             authority → holder
lease:renew   { id, E, seq, newExpiry }  authority → holder
lease:renewed { id, E, seq }             holder → authority
lease:revoke  { id, E, seq }             authority → holder
lease:released{ id, E, seq }             holder → authority
```

ORDERING RULE, both ends: for a given `id`, a frame whose `(E, seq)` is lower
than the last processed for that `id` is late and is discarded, and discarded
frames are counted. A frame with a higher `E` than the end's current epoch
for that role supersedes everything the end holds under the lower epoch (see
*Authority change*).

## The lifecycle

**Grant.** The authority creates `L` with `seq = 1`, enters OFFERED, starts
`T_offer`, sends `grant`. It relies on nothing yet.

**Accept.** The holder, on `grant`, enters HELD at the instant it SENDS
`accept{id, E, 1}`, and records `acceptAt` on its own clock. The authority,
on receiving `accept` with matching `(E, seq)` while OFFERED, enters GRANTED
and from this instant relies on the holder. Before this instant it does not.

**Void.** If `T_offer` passes with no accept, the authority sends
`void{id, E, 1}`, enters VOID, and forgets the lease after `T_void`. A LATE
ACCEPT, arriving after the void, is answered with the same `void` again, and
the holder on `void` leaves HELD → RELEASED and reports `lease-voided`. So a
delayed accept never creates a one-sided obligation that lasts: the holder
holds for at most `T_offer + 2·D_max` before the void reaches it, and the
authority never relied on it. This is the first schedule Aster named, and
the answer is the authority's explicit frame, not a holder timer.

**Expiry, computed in advance at both ends.** The lease expires at the
authority at `issuedAt + ttl − S_skew` on the authority's clock, and at the
holder at `acceptAt + ttl + S_skew` on the holder's clock. Since `acceptAt`
is at least `issuedAt + (clock difference) + delivery`, and the clock
difference is bounded by `S_skew`, the holder's expiry is never earlier than
the authority's: THE AUTHORITY STOPS RELYING BEFORE THE HOLDER STOPS
HOLDING. Expiry at the holder is reported `lease-expired` and is the only
timer-based release in this protocol; it fires only when the authority has
already stopped relying by its own clock, and only if renewal failed for a
whole `ttl`. This is the "delivered accept, delayed payload" schedule: the
holder does not release at `D_ack`; it releases at `ttl`, and the authority
expired first.

**Renew.** The authority sends `renew{id, E, seq+1, newExpiry}` at
`ttl/3` intervals while GRANTED; the holder answers `renewed` and moves its
expiry to `newExpiry + S_skew` on its clock; the authority moves its own to
`newExpiry − S_skew` on receipt of `renewed`. A renew that is not answered
within `ttl/3` is re-sent with the next `seq`; after the lease expires at the
authority, the authority enters SUSPENDED and starts recovery (below). Traffic
does not renew. Idle duties are renewed by frames, so an idle duty is a held
duty.

**Revoke.** The authority sends `revoke{id, E, seq}`; the holder leaves HELD
→ RELEASED at receipt and answers `released`; the authority leaves GRANTED →
RELEASED at `released` or at its own expiry, whichever first. A revoke and an
accept in flight at once are ordered by `(E, seq)`: the accept carries the
grant's `seq`, the revoke a higher one; the holder processes the revoke and
discards nothing it has not yet seen; the authority, on the accept after
having revoked, answers `revoke` again. The late `accept` cannot resurrect a
revoked lease because the authority's state is RELEASED and the ordering rule
discards the lower `seq`.

**Loss.** When the channel carrying `L` is lost at either end, that end does
NOT release. The authority enters SUSPENDED and keeps relying until its own
expiry; the holder stays HELD until its own expiry or until a frame on a new
channel. RECOVERY: the authority re-dials or elects another channel to the
holder (Hold-and-Fill, Channel Election) and, on a new duty-capable channel,
sends `renew` for the same `id`; the holder answers `renewed` and the lease
continues. If no channel exists by the authority's expiry, the authority
treats the duty as failed and runs the role's own recovery (re-enlist another
holder, step down, as today). Loss is never discharge, at either end, and the
two ends' bounds are the same `ttl` arithmetic as expiry.

## Authority change

When the authority for a role changes (a new root), the new authority's
epoch is `E + 1`, carried on its first frame to any holder. A holder that
sees a frame with a higher `E` for the same (topic, role) releases every
lease it holds under lower epochs, reports `lease-superseded`, and accepts
grants only under the new epoch. The old authority's frames, if any arrive,
are late by epoch and discarded. A holder with an old-epoch lease and no
frame from the new authority keeps it until its expiry; the old authority
has by then stopped relying (it stepped down, which is the fencing event),
so the holder's work is at worst wasted, never conflicting with the new
epoch's work, because the holder serves traffic only for the epoch of the
lease it holds and rejects traffic tagged with a lower epoch.

This is where the protocol touches root fencing and no further: it needs the
epoch to be issued by the fencing mechanism, and it gives the fencing
mechanism a way to make its decision reach every holder in bounded time.

## What makes it wrong

- `S_skew` violated: a holder whose clock is behind by more than `S_skew`
  expires late, so the authority has stopped relying and the holder is doing
  unneeded work; a holder ahead by more than `S_skew` expires EARLY, before
  the authority stops relying, which is the one failure that breaks the
  contract. `ttl` is therefore chosen so that `ttl ≫ S_skew`, and a holder
  that detects skew beyond the bound (from `issuedAt` versus its own clock
  at receipt, net of `D_max`) refuses the grant with `lease-skew`.
- `D_max` violated: a late frame is discarded by `(E, seq)`; the lease
  continues on the next renew. A frame delayed past `ttl` is a loss by then.
- A dishonest holder: accepts and does nothing. This protocol detects nothing
  about that; the role's own verification (replication acks, served
  subscribers' receipts) is where that lives.
- A dishonest authority: grants under an epoch it does not own. That is root
  fencing's problem; a holder checks the epoch against the fencing
  mechanism's view and refuses a grant from an authority it does not
  recognize.

## Integration with Hold-and-Fill

- The DUTY REGISTRY that `mayRetire(v)` reads is the set of leases in
  OFFERED, GRANTED, SUSPENDED or HELD whose other party is `v`. A channel is
  never voluntarily retired while such a lease exists; a swap or grace close
  that would do so is blocked and reported, as v0.4 says.
- The role-specific offer/accept table in v0.4 is this protocol: `appoint`
  is `grant` with `role = backup`; `enlist` is `grant` with `role =
  replication`; `register` is `grant` with `role = host` and the registering
  node as authority; `handoff:offer` is `grant` with `role = handoff`.
- `D_ack` and `duty-orphaned` are removed from v0.4. Their job is done by
  `T_offer` and `void` at the authority and by `ttl` at the holder.
- The duty-capable fence stays: lease frames travel only on duty-capable
  channels. The invariant becomes "no obligation outside a lease in a valid
  epoch", which is what Aster `76bc93dd` item 6 asked for in place of "both
  flags true at once".

## What this design does not establish

- Who the authority is. Root fencing.
- That a holder does the work it accepted. The role's verification.
- Anything on a legacy edge.
- Simultaneity. The authority relies from `accept` receipt; the holder holds
  from `accept` send; the gap is one delivery and is bounded by `D_max`.
- Behaviour when `S_skew` is violated in the early direction, beyond the
  refusal at grant time.

## Parameters for David

| parameter | proposed | condition that changes it |
|---|---|---|
| `ttl` | 120 s | must stay ≫ `S_skew`; raise if renew traffic at `ttl/3` is measurable on a phone |
| `T_offer` | 10 s | the measured accept round trip |
| `T_void` | `ttl` | long enough for any late accept to be answered |
| `S_skew` | 5 s | measured clock spread across the fleet; relays run NTP, phones may not |
| `D_max` | 10 s | the measured 99th percentile frame delay in production |
| `cap:lease` | advertised by every capable kernel | the version that ships this |

## Appendix: traces

Notation: authority A, holder H; `A:STATE(seq)`, `H:STATE`; clocks as `@A=`,
`@H=`; `ttl` 120, `S_skew` 5, `T_offer` 10.

**L1. Delayed accept.** `@A=0` A sends `grant{seq 1}`, OFFERED. H receives at
`@H=4`, sends `accept`, HELD, `acceptAt = 4`. Accept delayed 20 s. `@A=10`:
`T_offer` passes; A sends `void{seq 1}`, VOID. `@A=24` accept arrives: A is
VOID; A re-sends `void`. H receives `void` at `@H≈28`: HELD → RELEASED,
`lease-voided`. A relied on nothing; H held for 24 s and did work for a
lease that never existed at A. Bounded by `T_offer + 2·D_max`.

**L2. Delivered accept, delayed payload.** `@A=0` grant; `@H=2` accept,
HELD, `acceptAt 2`, H expiry `2 + 120 + 5 = 127`. `@A=4` accept arrives,
GRANTED, A expiry `0 + 120 − 5 = 115`. No payload for 60 s. H still HELD (no
`D_ack`). `@A=40` A sends `renew{seq 2, newExpiry 160}`; H answers; H expiry
`165`, A expiry `155`. Payload arrives at `@A=70`: H is holding. Correct.

**L3. Renewal fails, then loss.** As L2 to `@A=40`. The channel dies at
`@A=50`. A: SUSPENDED, still relying until `155`. H: HELD until `165`. A
re-dials; a new duty-capable channel is elected at `@A=90`; A sends
`renew{seq 3, newExpiry 210}` on it; H answers; both continue. Variant: no
channel by `@A=155`: A treats the duty as failed, runs the role's recovery
(re-enlists another holder). H releases at `@H=165` with `lease-expired`,
having done ten seconds of unneeded work. A stopped relying first.

**L4. Revoke races accept.** `@A=0` grant seq 1. `@A=3` A decides to revoke
before the accept arrives: `revoke{seq 2}`, RELEASED. `@A=5` accept{seq 1}
arrives: lower `seq` than last processed (2) → discarded; A re-sends
`revoke`. H: received grant at `@H=2`, sent accept, HELD; receives
`revoke{seq 2}` at `@H≈6`: RELEASED, `released`. Neither end holds anything
by `@=8`.

**L5. Authority change.** H holds `L` under `E = 4` from root R1. R1 steps
down (hold); R2 becomes root with `E = 5` and sends `grant{E 5}` for the same
role to H. H: releases `L` (`lease-superseded`), accepts the new grant under
`E 5`. A late `renew{E 4}` from R1 arrives: lower epoch → discarded. H serves
only `E 5` traffic.

**L6. Skew beyond bound.** H's clock is 20 s ahead. `grant{issuedAt 0}`
arrives at `@H=25` (true delay 5). H computes apparent delay `25 − 0 = 25 >
D_max + S_skew = 15`: refuses with `lease-skew`. A gets no accept, voids at
`T_offer`. No lease; the failure is reported, not hidden.
