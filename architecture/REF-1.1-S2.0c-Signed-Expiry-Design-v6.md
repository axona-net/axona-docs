# REF-1.1 S2.0c — signed immutable message expiry, v6

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-SIGNEDEXPIRY-20260811-06`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v5.md` (afd66f1), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V5-REVIEW`, msgId 64b6dd1f). The V2 topicId/domain/V1-preservation
  contract is **accepted**; the claimRetention residual is **accepted**. v6 resolves the one
  defect touching this doc: **blocker 2** — the byte-exact `publisher` width was wrong (it is the
  64-hex signer key, not the 66-hex topic/node id). Prerequisite of
  `REF-1.1-S2.0c-AUTH-B-Design-v6.md`. S2.0c/chunking held.

Everything in v5 stands except the correction below.

## Blocker 2 (revises D3 width) — publisher is 64-hex, topicId is 66-hex

v5 wrote `publisher` as a 66-hex value. That is wrong, and I verified the truth in the shipped
kernel rather than take it on faith (`src/pubsub/envelope.js`):

- `buildEnvelope` sets `signerPubkey = identity.authorId ?? identity.pubkeyHex`, and the comment
  and code agree that **in production `authorId === pubkeyHex`, the raw 32-byte Ed25519 public
  key**.
- `verifyEnvelope` rejects a signed envelope unless `pkBytes.length === 32` (i.e. 64 hex chars).
- The 66-hex width is the **region-prefixed** topic / node id (one region byte + 32) — a
  different, wider identity that must not be used for `publisher`.

So the `publisher` committed into the Option-1 `msgId` is **64 lowercase hex** (32-byte Ed25519
verification key), and `topicId` is **66 lowercase hex**. v6 pins the two widths distinctly:

    msgId = sha256( canonical({ d: MSGID_DOMAIN_V2, exp, message, publisher, topicId }) )

- **`publisher`:** exactly 64 lowercase hex — `^[0-9a-f]{64}$` — the 32-byte Ed25519 key, at the
  production keyspace profile; or JSON `null` for the fenced anonymous case (anonymous stays
  local-only / non-transferable). Any other form (66-hex, upper-case, non-hex, wrong length) is
  **rejected before hashing**.
- **`topicId`:** exactly 66 lowercase hex — `^[0-9a-f]{66}$` — the region byte + 32. Rejected
  before hashing if non-canonical.
- **Profile note (matches the shipped sim-relaxed path).** Under a shrunk sim keyspace profile
  (`configureKeyspace`, `AUTH_VERIFY_RELAXED`), `signerPubkey`/`authorId`/`topicId` are the
  profile's truncated ids and enter `computeMsgId` at that width, exactly as they already do
  today. 64/66 are the **normative production widths**; the sim profile is not a production
  identity and its records are non-transferable to production by the flag-day cutoff.

**Golden and rejection vectors, byte-exact:** (a) a valid 64-hex `publisher` + 66-hex `topicId`
preimage + digest; (b) rejection of a **66-hex `publisher`** (the exact v5 mistake — wrong
width); (c) rejection of a **64-hex `topicId`**; (d) rejection of upper-case / non-hex in either
field; (e) an assertion that `publisher` width (64) and `topicId` width (66) are distinct in the
preimage; (f) `null` publisher (anonymous) is accepted only on the local, non-transferable path.

## Standing from v5 (accepted, unchanged)

- **D3 (topicId/domain/V1):** literal `d = "axona:pubsub-msgid:v2"`; `canonical()` total, key-sorted
  (C-1) so the serialized order is `d, exp, message, publisher, topicId`; `topicId` one normalized
  66-hex value; legacy `MSGID_DOMAIN_V1` preserved byte-for-byte with **no** `d` field, never
  re-hashed; V1-vs-V2 decided by the flag-day cutoff.
- **D1/D2:** two time inequalities (live-ingress `ts` freshness vs `ts < exp ≤ ts + TTL_CEILING`);
  one `effectiveDeath = exp + CLOCK_SKEW` used everywhere.
- **Defect 3 (claimRetention):** a conservative resource bound, not a latest-valid-body proof
  (`msgId` excludes `ts`); later valid bodies rely on re-propagation / eventual-under-honest-path.

## RED test matrix (v6)

1. **Width contract (blocker 2):** 64-hex `publisher` accepted; 66-hex `publisher` rejected
   pre-hash; 66-hex `topicId` accepted; 64-hex `topicId` rejected; upper-case / non-hex rejected;
   `publisher` ≠ `topicId` width asserted in a golden preimage.
2. **Byte-exact preimage (v5 D3, retained):** V2 preimage + digest; V1 no-`d` preimage + digest
   for the same `{publisher, message}` → different id; tampered `exp` → different id.
3. **D1/D2 (retained):** `exp = ts + TTL_CEILING` accepted, out-of-range rejected; body accepted
   iff `now ≤ exp + CLOCK_SKEW`; boundary vectors at `exp`, `exp + CLOCK_SKEW`, `+1`.
4. **Ordering follow-on (retained):** a rewritten `publishTs` cannot change lifetime; tracked
   gate carried forward into chunking.

## Status

Design v6. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Prerequisite
of `REF-1.1-S2.0c-AUTH-B-Design-v6.md`. Submitted for review before any code. S2.0c and chunking
held.
