# REF-1.1 S2.0c — signed immutable message expiry, v4

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-SIGNEDEXPIRY-20260811-04`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v3.md` (986ddde), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V3-REVIEW-20260811-01`). Aster: the **Option-1 identity model
  is approved in principle** — "directionally cryptographically sound." v4 resolves the
  precision defects touching this doc: **D1** (time inequalities), **D2** (one effective
  cutoff + body-absent horizon — the signed-expiry half), **D3** (content-address domain +
  canonicalization), and the tracked follow-on for the ordering weakness. Prerequisite of
  `REF-1.1-S2.0c-AUTH-B-Design-v4.md`. S2.0c/chunking held.

Everything in v3 stands except the corrections below.

## D1 — separate the `ts` freshness check from the `exp` policy check

v3 wrongly implied `FUTURE_TOLERANCE_MS` bounds both `ts` and `exp`. A legitimate `exp` is
up to `TTL_CEILING` (24h) in the future, so that check would reject ordinary records. v4
specifies **two independent inequalities**:

- **Signed `ts` (freshness, live ingress only):** `ts` must lie within the live-ingress
  clock-skew / freshness window — `now − FRESHNESS_PAST_MS ≤ ts ≤ now + FUTURE_TOLERANCE_MS`
  (the existing C-2 freshness rule). This gates a *live publish*, not migration.
- **`exp` (author policy, every ingest):** `exp` is a finite safe integer with
  `ts < exp ≤ ts + TTL_CEILING` (upper bound = the absolute ceiling; lower bound: `exp > ts`,
  so an author may choose a shorter life but not a same-instant or past death — early-expiry
  is allowed, zero/negative life is rejected).

**Migration** does **not** apply `FUTURE_TOLERANCE` to `exp`. It checks the **immutable
effective death** (below) against `now`, and re-verifies the envelope signature + `msgId`
recompute. `ts` freshness is a *live-ingress* gate and is not re-applied on migration (a
migrated record is legitimately old).

## D2 — one named effective cutoff (the signed-expiry half)

v3 accepted a body until `now > exp + CLOCK_SKEW` but described the tombstone as bounded "by
`exp`," leaving a `CLOCK_SKEW` window where a body is accepted but no longer suppressed. v4
defines **one** value used **everywhere**:

    effectiveDeath = exp + CLOCK_SKEW

Body cache eviction, replay rejection at ingress, authoritative-tombstone retention (AUTH-B),
and provisional-claim promotion all key on `effectiveDeath` — a body is acceptable **iff**
`now ≤ effectiveDeath`, and any suppression state for that `msgId` is retained until exactly
`effectiveDeath`. No field uses a bare `exp` where another uses `exp + CLOCK_SKEW`. (The
alternative — reject bodies at exactly `exp` and retain tombstones to `exp` — is equally
valid; v4 picks `exp + CLOCK_SKEW` as the single constant and forbids mixing the two.)

The body-absent conservative retention horizon is specified in AUTH-B v4 (D2 claim half),
using the same allowances named here.

## D3 — version the content-address preimage itself

`ENVELOPE_DOMAIN_V4` versions the **signature core**, not the `msgId`. v4 gives the identity
hash its **own** domain tag and a canonical `topicId` encoding:

    msgId = sha256( canonical({ d: MSGID_DOMAIN_V2, publisher, message, topicId, exp }) )

- `MSGID_DOMAIN_V2` is distinct from `ENVELOPE_DOMAIN`, so a future envelope-domain change can
  never accidentally reuse today's content-address semantics, and a pre-Option-1 `msgId`
  (`MSGID_DOMAIN_V1` = the old `{publisher, message}`) is a different, legacy identity.
- `topicId` enters as **one normalized value**: fixed-width (66-hex) **lower-case**
  canonical bytes. Case or width aliases must not mint different IDs for one topic — the
  encoder normalizes before hashing, and verification rejects a non-canonical `topicId`.
- `exp` enters as the same finite integer the signature covers.

Golden vectors: legacy (`V1`) vs new (`V2`) domain produce different `msgId`s for identical
`{publisher, message}`; two casings/widths of one `topicId` produce the **same** `msgId`
(post-normalization) or are rejected pre-normalization; a tampered `exp` changes the `msgId`.

## Tracked follow-on: the unsigned-`publishTs` ordering weakness

v3 left the ordering-integrity gap "explicitly open." v4 makes it a **tracked follow-on
gate**, not a disappearing footnote: `publishTs`/`rootSeq` still drive high/low-water and
replay **ordering**, and an attacker rewriting `publishTs` can perturb ordering (not
lifetime — lifetime is now bound by the signed identity). This is filed as its own item and
**must** be carried forward when chunking consumes high/low-water ordering — it may not be
silently dropped. It does not block the lifetime correction here.

## RED test matrix (v3 set, D1/D2/D3 edges)

1. **D1:** a record with `exp = ts + TTL_CEILING` (24h ahead) is accepted (not rejected as
   "future"); `exp > ts + TTL_CEILING` rejected; `exp ≤ ts` rejected; a stale `ts` rejected
   at **live** ingress but a legitimately-old migrated record is not rejected on `ts` alone.
2. **D2:** a body is accepted iff `now ≤ exp + CLOCK_SKEW`; the authoritative tombstone is
   retained to exactly `exp + CLOCK_SKEW`; no path accepts a body after its suppression
   state has been dropped (no skew-window gap). Exact boundary vector at `exp`, `exp +
   CLOCK_SKEW`, `exp + CLOCK_SKEW + 1`.
3. **D3:** `MSGID_DOMAIN_V2` golden vectors; `V1`-vs-`V2` domain separation; `topicId`
   case/width normalization (same id post-normalize, or rejected); tampered `exp` → different
   `msgId`.
4. **Standing (v3):** signed material read from the stored envelope; anonymous/legacy
   fail-closed on migration; per-entry arrival-order-independent eviction (now keyed on
   `effectiveDeath`).
5. **Ordering follow-on:** a rewritten `publishTs` cannot change lifetime; the test records
   the tracked ordering gate.

## Status

Design v4. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy.
Prerequisite of `REF-1.1-S2.0c-AUTH-B-Design-v4.md`. Submitted for review before any code.
S2.0c and chunking held.
