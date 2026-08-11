# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v4

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-04`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v3.md` (986ddde), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V3-REVIEW-20260811-01`). Option-1 identity **approved in
  principle**. v4 resolves the AUTH-B precision defects: **D2** (one effective cutoff + the
  correct body-absent retention horizon) and **D4** (post-body candidate purge + per-signer
  admission accounting). **Depends on** `REF-1.1-S2.0c-Signed-Expiry-Design-v4.md`. Builds
  none of S2.0c-MEMBERSHIP. S2.0c/chunking held.

Everything in v3 stands except the corrections below.

## D2 — the same effective cutoff, and a long-enough body-absent horizon

**Authoritative tombstone uses `effectiveDeath`.** v3 said the authoritative tombstone is
bounded "by `exp`," but signed-expiry accepts a body until `exp + CLOCK_SKEW`. v4 binds the
authoritative tombstone (and any suppression state) to the **same** `effectiveDeath =
exp + CLOCK_SKEW` the body cache uses (signed-expiry v4 D2). There is no window in which a
body is acceptable but its suppression has already been dropped.

**The body-absent retention horizon must cover the latest a valid body could still arrive
and live.** A not-yet-seen valid body may carry a signed `ts` as late as
`local-receipt + FUTURE_TOLERANCE_MS` (the future-timestamp allowance at its own ingress),
and `exp` as late as `ts + TTL_CEILING`, and remains acceptable until `exp + CLOCK_SKEW`. So
a provisional candidate is retained for:

    claimRetention = local-receipt + FUTURE_TOLERANCE_MS + TTL_CEILING + CLOCK_SKEW

(unless it is proven that `CLOCK_SKEW ≥ FUTURE_TOLERANCE_MS` and that allowance is folded in
— in which case the invariant is named explicitly; v4 states the horizon in full rather than
assume the subsumption). If the body arrives within the horizon, co-located authorization
decides; if the horizon elapses first, the candidate is dropped — a bounded-resurrection
case, hard-capped by the body's own `effectiveDeath` once it does arrive. The exact edge
vector (a body at `ts = local-receipt + FUTURE_TOLERANCE_MS`, `exp = ts + TTL_CEILING`) is a
required test.

## D4 — purge provably-inert candidates once the body commits the publisher

The Option-1 `msgId` commits `publisher`. So **once a valid body recomputes to the target
`msgId`, the authorized author is uniquely determined** — there is exactly one publisher for
that identity. Every candidate whose signer is not that publisher can **never** authorize
any valid representation of the `msgId`; retaining it "inert" (v3) only preserves
attacker-controlled storage. v4:

- **Pre-body:** keep the bounded, deduplicated candidate set (the author is not yet known);
  the keep-all-on-mismatch rule of v3 applies **only** here.
- **On body arrival:** verify the body; authorize with **any** verified candidate whose
  `signerPubkey == the body's committed publisher`, create the authoritative tombstone
  (bounded by `effectiveDeath`) if such a candidate is present, then **discard the entire
  candidate set** for that `(topicId, msgId)` (equivalently: drop every non-matching
  candidate — none can ever authorize). No inert attacker storage survives a resolved body.
- **Admission accounting:** the candidate set is capped **per signer** as well as globally,
  so one signer cannot consume the whole cap and crowd out a genuine candidate before the
  body arrives. **Cap eviction remains the accepted resurrection mode** (a genuine candidate
  evicted before its body arrives waits for the kill to re-propagate).

## Mechanism, consolidated (v4)

1. Migration carries the **signed kill**; `verifyKill` on receipt. Body-absent → a
   **provisional candidate** in the per-`(topicId, msgId)` set (bounded per-signer + global),
   retained for `claimRetention` (D2), never suppressing by `msgId` alone, never propagated
   as authorized.
2. On body arrival: verify the body (`verifyEnvelope` B-4, `MSGID_DOMAIN_V2` recompute over
   `{publisher, message, topicId, exp}`, and `now ≤ effectiveDeath`). The body commits the
   publisher. Authorize with any candidate whose signer equals that publisher →
   authoritative tombstone bounded by `effectiveDeath`; then **purge the candidate set**
   (D4). If no matching candidate, deliver the body and purge non-matching candidates.
3. An authoritative tombstone migrated to a replica lacking the body reverts to a provisional
   candidate there; suppression is earned locally against a present body.

## Accepted residual (David), unchanged

Deletion is best-effort against a malicious omitting source, hard-bounded by the author's
committed `exp` (via `effectiveDeath`), and eventual under an honest path. Accepted
bounded-resurrection modes: (a) omission; (b) claim-cap eviction or pre-body retention
expiry. Both capped by `effectiveDeath`; both re-suppress once the kill reaches a node
holding the body. Explicit risk acceptance.

## Test matrix (v4)

1. **D2 horizon:** a body arriving at `ts = local-receipt + FUTURE_TOLERANCE_MS`,
   `exp = ts + TTL_CEILING` is still matched by a candidate retained to `claimRetention`; a
   shorter horizon would miss it.
2. **D2 no gap:** authoritative tombstone retained to `effectiveDeath` = body-acceptance
   cutoff; no body accepted after suppression dropped.
3. **D4 purge:** after a valid body resolves the publisher, the entire candidate set is
   discarded; a subsequently-arriving forged candidate for the same resolved `msgId` cannot
   re-suppress (the author is settled) — it is inert and not retained.
4. **D4 admission accounting:** one signer cannot fill the global cap; a genuine candidate is
   not crowded out pre-body; cap eviction resurrection is documented.
5. **Standing (v3):** forged claim cannot suppress; genuine co-located deletion; cross-topic
   impossible by construction (`msgId` commits `topicId`); forged+genuine both arrival
   orders; body-`exp` mismatch → different `msgId`; self-correction eventual-under-honest-path.

## Status

Design v4. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends
on `REF-1.1-S2.0c-Signed-Expiry-Design-v4.md`. Chunking loses its consensus dependency (del
record carries a signed kill); a chunking revision consuming B-prime is a follow-on once both
clear. Submitted for review before any code. S2.0c and chunking held; membership alternative
not retired.
