# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v5

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-05`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v4.md` (f80299d), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V4-REVIEW`, msgId 8260a6a6). D1 and D2 are **closed**;
  Option-1 identity remains **approved in principle**. v5 resolves the two AUTH-B defects
  Aster left open: **defect 1** (resolved-author state must persist independently of
  body-cache residence — revises D4) and **defect 3** (claimRetention is a conservative
  resource bound, not a latest-valid-body proof — revises the D2 claim half). **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design-v5.md`. Builds none of S2.0c-MEMBERSHIP. S2.0c/chunking
  held.

Everything in v4 stands except the two corrections below.

## Defect 1 (revises D4) — the resolved-author verdict outlives the body in cache

v4 claimed that once a valid body resolves a `msgId`, non-matching candidates are purged and
"no inert attacker storage survives." That conflated the **authorization verdict** with
**body-cache residence**. A relay's body cache is count/byte-bounded and can evict a still-live
body **before** `effectiveDeath`. After that eviction, v4's mechanism — which distinguishes
only body-present from body-absent — sees "body-absent" again: a forged kill re-enters the
provisional path, repopulates the candidate set, and Sybil signers repeat this within the
global cap. Post-eviction re-admission reopens the exact storage D4 claimed to close.

v5 separates the verdict from the bytes:

- **Resolved record.** On the first valid body that recomputes to `(topicId, msgId)` —
  `verifyEnvelope` (B-4), `MSGID_DOMAIN_V2` recompute over `{publisher, message, topicId,
  exp}`, and `now ≤ effectiveDeath` — record
  `resolvedPublisher[(topicId, msgId)] = body.publisher` (the pubkey the `msgId` uniquely
  commits) together with that record's `effectiveDeath`. The record is created **only** from a
  verified body and is retained through `effectiveDeath`, **independent of whether the body
  bytes remain in the capacity-bounded cache**.
- **While the resolved record exists**, a kill for that `msgId` is decided immediately, without
  ever re-entering the provisional path: `signer == resolvedPublisher` → authoritative
  tombstone (bounded by `effectiveDeath`); `signer != resolvedPublisher` → **dropped, with no
  candidate admission**. A body later capacity-evicted does not reopen the body-absent branch
  for a resolved identity.
- **Size.** `resolvedPublisher` is a fixed-size tuple (the id key, one pubkey, one
  `effectiveDeath`) — far smaller than the body, retained for the same horizon the
  authoritative tombstone already needs. It is the verdict, not the content. No membership
  state, no consensus.

So D4's purge is both correct and durable: after a body resolves, the candidate set is purged
(v4) **and** the resolved verdict persists to `effectiveDeath` (v5), closing post-eviction
re-admission. The remaining resurrection modes are only the accepted ones (pre-body cap
eviction; pre-body retention expiry; source omission).

New vectors: body-resolved → body **capacity-evicted** → forged kill (dropped, no admission);
body-resolved → body evicted → **genuine** kill (authoritative immediately, no provisional
round-trip).

## Defect 3 (revises the D2 claim half) — claimRetention is a resource bound, not a proof

v4 framed `claimRetention = local-receipt + FUTURE_TOLERANCE_MS + TTL_CEILING + CLOCK_SKEW` as
covering "the latest a valid body could still arrive and live." That holds only under the
causal invariant `body.ts ≤ candidateLocalReceipt + FUTURE_TOLERANCE_MS`, which the protocol
does **not** establish. Option-1 commits `{publisher, message, topicId, exp}` — **not `ts`** —
so a valid author can sign a kill naming a precomputed `msgId`, then later sign a fresh body
carrying that same `msgId` with a far-future `exp`; delayed migration likewise does not reapply
live-ingress `ts` freshness (a migrated record is legitimately old). A valid body can therefore
arrive **after** `claimRetention` elapses.

v5 states it plainly: `claimRetention` is the chosen **conservative resource bound** on how long
a body-absent provisional candidate is held — not a guarantee that every valid body arrives
within it. A valid body arriving after the bound is handled by re-propagation and is
**eventual under an honest path**. If the kill was already dropped at the bound, the body is
**delivered** (not suppressed) until the kill re-propagates — the already-accepted pre-body
retention-expiry resurrection mode, hard-capped by the body's committed `exp` via
`effectiveDeath`. No proof language claims completeness.

Note the interaction with defect 1: the resolved record only exists once **some** valid body
has resolved the identity. In the pre-kill / future-body case no body has resolved yet, so the
provisional candidate is what is held; its expiry at `claimRetention` is the accepted
resurrection mode, and a later body re-opens co-located authorization normally.

New vector: **pre-kill / future-body** — author pre-signs a kill for a precomputed `msgId`; the
candidate is retained to `claimRetention`; the body is signed later with a far-future `exp` and
arrives after the bound → candidate already dropped → body delivered → re-propagated kill (or,
if a body had previously resolved, the `resolvedPublisher` record) authorizes suppression.
Documented as accepted resurrection, not a defect.

## Mechanism, consolidated (v5)

1. Migration carries the **signed kill**; `verifyKill` on receipt. If a `resolvedPublisher`
   record exists for `(topicId, msgId)`, decide immediately (defect 1). Otherwise body-absent →
   a **provisional candidate** in the per-`(topicId, msgId)` set (bounded per-signer + global),
   retained for `claimRetention` as a resource bound (defect 3), never suppressing by `msgId`
   alone, never propagated as authorized.
2. On body arrival: verify the body (`verifyEnvelope` B-4, `MSGID_DOMAIN_V2` recompute over
   `{publisher, message, topicId, exp}`, `now ≤ effectiveDeath`). Record
   `resolvedPublisher[(topicId, msgId)]` (defect 1). Authorize with any candidate whose signer
   equals that publisher → authoritative tombstone bounded by `effectiveDeath`; then **purge the
   candidate set** (v4 D4). If no matching candidate, deliver the body and purge non-matching
   candidates.
3. An authoritative tombstone migrated to a replica lacking the body reverts to a provisional
   candidate there **unless** that replica holds a `resolvedPublisher` record for the id;
   suppression is earned locally against a present body or a held resolved verdict.

## Accepted residual (David), unchanged in force

Deletion is best-effort against a malicious omitting source, hard-bounded by the author's
committed `exp` (via `effectiveDeath`), and eventual under an honest path. Accepted
bounded-resurrection modes: (a) source omission; (b) pre-body claim-cap eviction or
pre-body `claimRetention` expiry (defect 3). Both capped by `effectiveDeath`; both re-suppress
once the kill reaches a node holding the body or a `resolvedPublisher` record. Explicit risk
acceptance.

## Test matrix (v5)

1. **Resolved-verdict durability (defect 1):** body resolves `(topicId, msgId)` → body
   capacity-evicted before `effectiveDeath` → a forged kill (non-author signer) is dropped with
   no candidate admission; the provisional path is not re-entered.
2. **Resolved-verdict genuine kill (defect 1):** same setup, a genuine kill (signer ==
   `resolvedPublisher`) is authoritative immediately, bounded by `effectiveDeath`.
3. **Resolved record expiry:** at `effectiveDeath` the resolved record is dropped; no path
   accepts a body or a kill for that id afterward.
4. **claimRetention as resource bound (defect 3):** pre-kill / future-body — candidate dropped
   at `claimRetention`, later valid body delivered, re-propagated kill re-suppresses; recorded
   as accepted resurrection, no completeness claim.
5. **D4 purge (v4, retained):** after a valid body resolves, the candidate set is discarded; a
   later forged candidate for the resolved id is inert and dropped via the resolved record.
6. **D2 no-gap (v4, retained):** authoritative tombstone and resolved record both retained to
   `effectiveDeath` = body-acceptance cutoff; no body accepted after suppression dropped.
7. **Standing (v3):** forged claim cannot suppress; genuine co-located deletion; cross-topic
   impossible by construction (`msgId` commits `topicId`); forged+genuine both arrival orders;
   body-`exp` mismatch → different `msgId`.

## Status

Design v5. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends on
`REF-1.1-S2.0c-Signed-Expiry-Design-v5.md`. Chunking loses its consensus dependency (the del
record carries a signed kill); a chunking revision consuming B-prime is a follow-on once both
clear. Submitted for review before any code. S2.0c and chunking held; membership alternative
not retired.
