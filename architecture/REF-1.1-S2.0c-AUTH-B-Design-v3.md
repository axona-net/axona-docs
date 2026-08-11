# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v3

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-03`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v2.md` (999cbef). v3 propagates the Option-1 identity model
  (David's ruling: `msgId = hash{publisher, message, topicId, exp}`) into claims, kill
  targets, dedup, and cross-topic handling, as Aster instructed. v2's F6/F7/F8 corrections
  stand; F5 is now subsumed by the identity. **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design-v3.md`. Builds none of S2.0c-MEMBERSHIP.
  S2.0c/chunking held.

## The identity now carries topic and deadline

With Option 1, `msgId` commits to `{publisher, message, topicId, exp}`. Two consequences
flow straight into tombstone authorization:

- **F5 is subsumed.** A kill names a `msgId`; that `msgId` commits `topicId`, so a kill can
  only ever match a body in the same topic. Cross-topic kill replay is impossible by
  construction. The explicit `topicId` agreement check (`kill.topicId == role.topicId ==
  deriveTopicId(body.topic)`) is kept as cheap defense-in-depth and to reject a malformed
  kill early, but it is no longer the sole guard.
- **A kill targets one exact revision.** The `msgId` commits `exp` too, so a kill names a
  single `(topic, content, deadline)` record — not a family of variants. Co-located
  authorization becomes tighter: on body arrival the receiver recomputes
  `hash{publisher, message, topicId, exp}` from the body and it matches the kill's `msgId`
  only if every committed field — including the body's own `exp` — agrees. A body with a
  different deadline is a different `msgId` and is simply not the thing this kill names.

## F6 — a candidate SET, authorize-if-any-matches (unchanged in force)

A forged kill can still name a real `msgId` (the id is public), signed by a non-author's
key. So multiple candidates for one `(topicId, msgId)` remain possible, and one keyed slot
is still unsafe. v3 keeps the **bounded, deduplicated candidate set** per `(topicId,
msgId)`, each candidate a verified signed kill keyed also by `signerPubkey`/signature-hash.
On body arrival, after verifying the body:

- authorize if **any** candidate's `signerPubkey` equals the body's authenticated author;
- a non-matching candidate is never removed on that account — one mismatch never erases
  another;
- the set is size-capped per `(topicId, msgId)` and globally; **cap eviction is a
  documented, accepted resurrection mode** (a genuine candidate evicted before its body
  arrives means the delete waits for the kill to re-propagate).

## F7 — body-absent retention bound (identity helps, but does not fully close it)

The `msgId` commits `exp`, but a body-absent node holds only the *hash* and cannot extract
`exp` from it, and the signed kill carries `kill.ts`, not the body's `exp`. So while the
body is absent the authoritative deadline is still unknown. v3 keeps v2's rule: a provisional
candidate is retained for a **conservative local bound** `local-receipt + TTL_CEILING +
CLOCK_SKEW`. **Once the body arrives**, its `exp` is known (committed by the matched
`msgId`) and the resulting tombstone is bounded by that immutable value. If the retention
bound elapses before the body arrives, the candidate is dropped — **another bounded-
resurrection case**, hard-capped by the body's own signed `exp`. `kill.ts` is never treated
as the body's expiry.

## F8 — honest residual + real test edges (unchanged in force)

Re-suppression via normal kill propagation is **eventual under an honest path, not
guaranteed under continued omission**. The residual is stated that way. Test edges below.

## Mechanism, consolidated (v3)

1. Migration carries the **signed kill**; `verifyKill` on receipt. Body-absent → a
   **provisional candidate** in the `(topicId, msgId)` set (F6), retained per F7, never
   suppressing by `msgId` alone and never propagated as authorized.
2. On body arrival: verify the body (`verifyEnvelope` B-4, signed `exp`, and the `msgId`
   recompute over `{publisher, message, topicId, exp}` — which binds topic and deadline into
   the identity, F5/F1); authorize if **any** candidate's `signerPubkey` equals the body's
   author (F6) → authoritative deletion bounded by the body's committed `exp`; else deliver
   the body, retaining non-matching candidates.
3. An authoritative tombstone migrated to a replica lacking the body reverts to a
   provisional candidate there — suppression is earned locally against a present body.

## Accepted residual (David), restated

Deletion under B-prime is **best-effort against a malicious omitting source, hard-bounded by
the author's committed `exp`, and eventual under an honest path**. Two bounded-resurrection
modes are accepted: (a) omission (body shipped without the kill); (b) claim-cap eviction or
pre-body retention expiry. Both are capped by the immutable committed `exp` and both
re-suppress once the kill reaches a node holding the body. Weaker than Option A's strict
cold-verifiable deletion — the trade David accepted — recorded as explicit risk acceptance.

## Test matrix (v3)

1. **Forged claim cannot suppress:** a kill signed by a non-author for a real `msgId`,
   migrated as a provisional candidate, does not suppress the body when it arrives —
   author-match fails, the body is delivered, the forged candidate is retained-but-inert
   (F6).
2. **Genuine co-located deletion:** `candidate.signerPubkey == body author` **and** the
   body's `{publisher, message, topicId, exp}` recompute matches the kill's `msgId` → the
   body is suppressed, bounded by the committed `exp`.
3. **Cross-topic impossible by construction:** a kill's `msgId` (committing topic A) cannot
   match a body in topic B (F5 subsumed); the explicit topic check also rejects it.
4. **Forged + genuine candidates, both arrival orders:** whichever arrives first, the
   genuine one still authorizes on body arrival; a forged one never erases it (F6).
5. **Cap eviction:** a genuine candidate evicted under cap before its body arrives → the
   delete waits for re-propagation (documented accepted resurrection).
6. **Claim retention expiry before body:** candidate dropped at the conservative bound →
   bounded resurrection, capped by the body's committed `exp` (F7).
7. **Body-`exp` mismatch:** a body whose `exp` differs from the kill's committed revision
   has a different `msgId` and is not this kill's target.
8. **Residual wording:** self-correction is eventual under an honest path only (F8).

## Status

Design v3. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends
on `REF-1.1-S2.0c-Signed-Expiry-Design-v3.md`. Chunking loses its consensus dependency (the
del record carries a signed kill; a chunking revision consuming B-prime is a follow-on once
both clear). Submitted for review before any code. S2.0c and chunking held; membership
alternative not retired.
