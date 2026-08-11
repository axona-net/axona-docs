# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v2

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `REF-1.1-S2.0c-AUTH-B-Design.md` (bd56455), reviewed **CHANGES REQUIRED**
  (Aster, msgId 6fbe31c0). v2 resolves findings F5–F8. Direction unchanged (David: B-prime,
  bounded-resurrection residual accepted). **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design-v2.md`. Builds none of S2.0c-MEMBERSHIP. S2.0c/chunking
  held.

Everything in v1 stands except the four corrections below.

## F5 — authorization requires topic binding, not author match alone

`msgId` excludes `topic`, so a signed kill for topic A can name the same author+message
`msgId` as a body in topic B — a cross-topic kill replay. v1's author-match check was
necessary but not sufficient.

v2: before a claim can authorize a deletion, **all three must agree, each under its own
signature**:

    claim.topicId  ==  role.topicId  ==  deriveTopicId(body.topic)

The signed kill (kill.js) already binds `topicId` in its signed core; the body's envelope
signs its `topic` descriptor (from which `deriveTopicId` recomputes the id). Provisional
claims are **keyed by `(topicId, msgId)`**, never `msgId` alone. A cross-topic replay RED
gate is added.

## F6 — a candidate SET, authorize-if-any-matches (never overwrite/erase)

v1 kept one claim per `msgId` and "discarded the claim on mismatch" — a forged claim could
arrive first, overwrite a genuine one, or be the one inspected, and discarding it on
mismatch could throw away the genuine deletion.

v2 keeps a **bounded, deduplicated candidate set** per `(topicId, msgId)`, each candidate a
verified signed kill keyed additionally by `signerPubkey` (and a signature hash for exact
dedup). On body arrival, after verifying the body:

- authorize the deletion if **any** candidate in the set matches the body's authenticated
  author (`candidate.signerPubkey == envelope.signerPubkey`);
- a candidate that does **not** match is **not** removed on that account — one mismatch never
  erases another candidate. Non-matching candidates simply never authorize.

The set is size-capped per `(topicId, msgId)` and globally. **Cap eviction is an explicit,
accepted additional resurrection mode:** if a genuine candidate is evicted under cap before
its body arrives, the delete is not applied until the kill re-propagates. This is documented
and tested, not silent.

## F7 — a defined body-absent retention bound (the kill cannot prove the body's expiry)

A signed kill carries `kill.ts`, not the body's `exp`, and cannot prove the body's deadline
while the body is absent. v1's "retain until `exp`" had no implementable authoritative
deadline pre-body.

v2: a provisional candidate is retained for a **conservative local bound**
`local-receipt-time + TTL_CEILING + CLOCK_SKEW` — the longest any not-yet-seen body could
still legitimately live (a body present now dies by `exp ≤ ts + TTL_CEILING`; the
conservative bound covers a body first published at claim-receipt time). If the body arrives
within the bound, co-located authorization (F5/F6) decides. If the retention bound elapses
**before** the body arrives, the candidate is dropped and a later body would be delivered —
**this is another bounded-resurrection case**, hard-capped by the body's own signed `exp`
(signed-expiry design) and documented/tested as such. `kill.ts` is never treated as the
body's expiry.

## F8 — honest residual wording + the real test edges

- **"Self-correcting" restated.** Re-suppression via normal kill propagation is **eventual
  under an honest delivery path, not guaranteed under continued omission.** A source that
  keeps omitting the kill keeps the body live until its signed `exp`. The residual is stated
  that way, not as unconditional self-healing.
- **Test matrix adds the real edges:** cross-topic kill replay (F5); forged + genuine claims
  in **both** arrival orders, and forged-first-then-genuine (F6); claim-cap eviction dropping
  a genuine candidate (F6); claim retention expiring before the body (F7); anonymous-body
  and anonymous-target inertness; `authorSeq` vs `rootSeq` separation (shared with
  signed-expiry v2); and the accepted-residual cases hard-bounded by signed `exp`.

## The mechanism, consolidated (with v2 corrections folded in)

1. Migration carries the **signed kill**; `verifyKill` on receipt. Body-absent → a
   **provisional candidate** in the `(topicId, msgId)` set, retained per F7, never
   suppressing by `msgId` alone and never propagated as authorized.
2. On body arrival: verify the body (`verifyEnvelope` B-4 + signed `exp`); require
   `claim.topicId == role.topicId == deriveTopicId(body.topic)` (F5); authorize if **any**
   candidate's `signerPubkey` equals the body's author (F6) → authoritative deletion, bounded
   by the body's signed `exp`; otherwise deliver the body (non-matching candidates retained,
   not erased).
3. An authoritative tombstone migrated to a replica lacking the body reverts to a provisional
   candidate there — suppression is earned locally against a present body, every time.

## Accepted residual (David), restated precisely

Deletion under B-prime is **best-effort against a malicious omitting source, hard-bounded by
the author's signed `exp`, and eventual under an honest path**. Two bounded-resurrection
modes are accepted: (a) omission — a source ships the body without the kill; (b) claim-cap
eviction or pre-body retention expiry — the candidate is gone when the body arrives. Both are
capped by the immutable signed `exp` and both re-suppress once the kill reaches a node that
holds the body. This is weaker than Option A's strict, cold-verifiable deletion — the trade
David accepted — and is recorded as explicit risk acceptance.

## Status

Design v2. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends
on `REF-1.1-S2.0c-Signed-Expiry-Design-v2.md`. Chunking loses its consensus dependency (del
record carries a signed kill); a chunking revision consuming B-prime is a follow-on once both
clear. Submitted for review before any code. S2.0c and chunking held; membership alternative
not retired.
