# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v6

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-06`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v5.md` (afd66f1), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V5-REVIEW`, msgId 64b6dd1f). claimRetention (defect 3) is
  **accepted**; the resolved-author direction is accepted **in principle**. v6 resolves the
  one AUTH-B blocker: **blocker 1** — the v5 `resolvedPublisher` map was an unbounded second
  cache. v6 replaces it with a bounded invariant: the durable verdict lives only in
  **deletion state**, which is already bounded. **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design-v6.md` (blocker 2, publisher width). Builds none of
  S2.0c-MEMBERSHIP. S2.0c/chunking held.

Everything in v5 stands except the correction below.

## Blocker 1 (revises v5 defect-1) — the durable verdict lives in bounded deletion state

v5 minted a `resolvedPublisher[(topicId, msgId)]` tuple for **every** verified body and required
holding it to `effectiveDeath`, independent of the bounded body cache. Most messages are never
killed, and body eviction does not release the tuple, so an attacker publishing N unique valid
bodies at maximum TTL mints N tuples — an unbounded second cache. "Same horizon the tombstone
needs" does not bound cardinality, because unkilled messages have no tombstone. v6 removes the
per-body map.

The resolved-author verdict is only ever consulted to adjudicate a **kill**. A kill is deletion
state, and deletion state is already bounded (per-publisher + per-topic deletion accounting under
the active-message quota, Phase A #4/#5). So v6 keeps the durable verdict **only where deletion
state already lives**:

- **A body with no kill stores nothing beyond the bounded body cache.** No verdict, no tuple.
- **When a kill is co-located-authorized against a present body** (signer == body author, the
  `MSGID_DOMAIN_V2` recompute matches), the resulting **authoritative tombstone** already carries
  the resolved publisher and its `effectiveDeath`. **The tombstone *is* the durable verdict.**
  Tombstones are bounded deletion state — admitted under the same per-signer + global accounting
  as any kill — not one-per-message.
- **Post-body-eviction authorization** (the case v5's map existed for):
  - **Tombstone present** for `(topicId, msgId)`: a later kill is adjudicated against it —
    `signer == tombstone.publisher` → confirmed/redundant; `signer != tombstone.publisher` →
    **dropped, no candidate admission**. The body is already suppressed; its bytes may leave and
    re-enter the cache freely.
  - **No tombstone** (the body was never killed while present): a kill arriving after the body is
    evicted enters the **bounded provisional candidate set** (per-signer + global cap, v4 D4). It
    never suppresses without a matching body; when a body re-propagates, co-located authorization
    decides. This is the accepted resurrection / re-propagation residual — now explicitly covering
    "forged (or genuine) kill after eviction with no prior tombstone." Bounded by the candidate
    cap, hard-capped by the committed `exp` via `effectiveDeath`.

## The bounded invariant

- **Durable verdicts = the tombstone population**, bounded by deletion-state accounting.
- **Transient claims = the provisional candidate set**, bounded by per-signer + global caps.

Neither set grows per un-killed message. An attacker publishing N unique valid bodies at maximum
TTL creates N entries in the **bounded body cache** (evicted under its own count/byte cap) and
**zero** durable verdicts (no kills). There is no second cache to saturate. "Retained through
`effectiveDeath`" now applies only to tombstones — exactly the horizon a tombstone already needs.

**Trade vs v5, stated plainly:** v5 dropped a post-eviction forged kill for free via the verdict
lookup; v6 instead admits it to the bounded candidate set (it consumes a capped slot and never
suppresses). v6 trades that small bounded cost for removing the unbounded verdict cache — the
correct trade under adversarial load, and the one Aster's blocker requires.

## Mechanism, consolidated (v6)

1. Migration carries the **signed kill**; `verifyKill` on receipt.
   - If an **authoritative tombstone** exists for `(topicId, msgId)`: adjudicate against it
     (matching signer confirmed; mismatch dropped, no admission).
   - Else body-absent → a **provisional candidate** in the per-`(topicId, msgId)` set (bounded
     per-signer + global), retained for `claimRetention` (v5 defect-3 resource bound), never
     suppressing by `msgId` alone.
2. On body arrival: verify the body (`verifyEnvelope` B-4, `MSGID_DOMAIN_V2` recompute over
   `{publisher, message, topicId, exp}`, `now ≤ effectiveDeath`). Authorize with any candidate
   whose signer equals the body's committed publisher → **authoritative tombstone** bounded by
   `effectiveDeath` (this tombstone is the durable verdict); then purge the candidate set (v4
   D4). If no matching candidate, deliver the body and purge non-matching candidates. **No
   per-body verdict is stored when there is no kill.**
3. An authoritative tombstone migrated to a replica lacking the body stays authoritative there
   (it is the verdict); a kill for it is adjudicated against it. Absent both body and tombstone,
   a kill is a bounded provisional candidate.

## Accepted residual (David), unchanged in force

Deletion is best-effort against a malicious omitting source, hard-bounded by the author's
committed `exp` (via `effectiveDeath`), and eventual under an honest path. Accepted
bounded-resurrection modes: (a) source omission; (b) pre-tombstone claim-cap eviction or
`claimRetention` expiry; (c) **body-evicted-with-no-prior-tombstone**, where a kill waits as a
bounded provisional candidate for the body to re-propagate. All capped by `effectiveDeath`; all
re-suppress once a kill and a body co-locate. Explicit risk acceptance.

## Test matrix (v6)

1. **Saturation / bounded invariant:** publish N unique valid bodies at max TTL → N bounded-cache
   entries, **zero** durable verdicts; N+1 → cache eviction under cap, still zero verdicts. No
   unbounded growth.
2. **Body-evicted + forged kill, no prior tombstone:** forged kill enters the bounded candidate
   set, never suppresses; cap accounting holds; ages out at `claimRetention`.
3. **Body-evicted + genuine kill, no prior tombstone:** genuine kill is a bounded candidate;
   suppresses when a body re-propagates (co-located auth); documented resurrection window.
4. **Tombstone present + later forged kill:** dropped, no candidate admission.
5. **Tombstone present + later genuine kill:** confirmed/redundant, no duplicate state.
6. **Tombstone durability:** a tombstone (the verdict) is retained to `effectiveDeath` even if the
   body is capacity-evicted; no body accepted after suppression dropped (D2 no-gap).
7. **Standing (v3):** forged claim cannot suppress; genuine co-located deletion; cross-topic
   impossible by construction (`msgId` commits `topicId`); body-`exp` mismatch → different `msgId`.

## Status

Design v6. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends on
`REF-1.1-S2.0c-Signed-Expiry-Design-v6.md`. Chunking loses its consensus dependency (the del
record carries a signed kill); a chunking revision consuming B-prime is a follow-on once both
clear. Submitted for review before any code. S2.0c and chunking held; membership alternative not
retired.
