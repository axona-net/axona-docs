# REF-1.1 S2.0c — signed immutable message expiry, v5

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-SIGNEDEXPIRY-20260811-05`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v4.md` (f80299d), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V4-REVIEW`, msgId 8260a6a6). D1 (time inequalities) and D2 (one
  `effectiveDeath`) are **closed**; Option-1 identity remains **approved in principle**. v5
  resolves the one defect touching this doc: **defect 2** — a single byte-exact preimage
  contract for the content address. It also pins the `ts`/`msgId` fact that AUTH-B v5 relies on
  for its claimRetention correction (defect 3). Prerequisite of
  `REF-1.1-S2.0c-AUTH-B-Design-v5.md`. S2.0c/chunking held.

Everything in v4 stands except the correction below.

## Defect 2 (revises D3) — one byte-exact preimage, chosen not offered

v4 said "fixed-width (66-hex) lower-case canonical bytes" and left the two ambiguities Aster
flagged: whether `topicId` enters `canonical()` as **66 lower-case ASCII hex characters** or as
**33 raw bytes**, and whether a non-canonical input is **normalized** or **rejected**. v5 picks
one normative path for each and pins the literal domain.

    msgId = sha256( canonical({ d: "axona:pubsub-msgid:v2",
                                exp, message, publisher, topicId }) )

- **Literal domain string:** `d = "axona:pubsub-msgid:v2"`, same family and style as
  `KILL_DOMAIN = "axona:pubsub-kill:v1"`. This value is the content-address domain and is
  distinct from `ENVELOPE_DOMAIN` (the signature core). A future envelope-domain change cannot
  reuse it.
- **Exact object under `canonical()`:** the five fields shown. `canonical()` is the total,
  JSON-valid, lexicographically key-sorted encoder from C-1, so the serialized key order is
  fixed as `d, exp, message, publisher, topicId` regardless of construction order. Field types:
  `d` string; `exp` the finite integer the signature covers (no float, no string); `message`
  the payload value exactly as `canonical()` already serializes it on the wire; `publisher` the
  signer public key as its 66-hex lower-case string, or JSON `null` for an anonymous record
  (anonymous stays local-only / non-transferable per the anon fence — its id is not a
  migratable V2 identity); `topicId` as specified next.
- **`topicId` is one representation — the 66-char lower-case ASCII hex STRING, not raw bytes.**
  That is the exact form `deriveTopicId` already returns and the form `topicId` carries
  everywhere else in the kernel, so no byte-conversion step is introduced.
- **Non-canonical `topicId` is REJECTED, not normalized.** Verification requires
  `topicId` to match `^[0-9a-f]{66}$`; any other width, upper-case, or non-hex input is
  rejected **before** hashing. There is no normalization pass — the value is canonical by
  construction (`deriveTopicId`) and reject-on-non-canonical at ingest. This removes the
  normalize-or-reject ambiguity by choosing reject.
- **Legacy V1 is preserved byte-for-byte.** `MSGID_DOMAIN_V1` is the shipped #140 hash with
  **no `d` field**: `sha256(canonical({ message, publisher }))` (key-sorted). v5 does **not**
  inject a `d` into V1 and does **not** re-hash or change any existing id. The `d` field exists
  only in V2. A record is V1 or V2 by the flag-day cutoff (`ENVELOPE_DOMAIN` version), never by
  re-deriving an id.

**Golden vectors are byte-exact, not relational.** For a fixed `{publisher, message, topicId,
exp}` check in: (a) the exact `canonical()` preimage bytes and (b) the `sha256` digest for V2;
(c) the exact V1 preimage bytes + digest for the same `{publisher, message}`, showing a
**different** id and **no** `d` field; (d) rejection vectors for a 64-hex, an upper-case, and a
non-hex `topicId` (each rejected pre-hash); (e) a tampered `exp` → a different V2 id.

## The `ts`/`msgId` fact AUTH-B v5 depends on (supports defect 3)

`ts` stays signed but **outside** the identity: Option-1 commits `exp`, not `ts`. Two variants
with the same `{publisher, message, topicId, exp}` and different `ts` share one `msgId` and one
deadline. And migration does **not** reapply live-ingress `ts` freshness (D1 — a migrated
record is legitimately old). Together these are exactly why AUTH-B v5 treats `claimRetention`
as a conservative **resource** bound rather than a proven latest-valid-body horizon: an author
can precompute a `msgId`, sign a kill for it, and sign the body later with a far-future `exp`,
so a valid body can arrive after the local retention bound. The lifetime is still hard-bounded
by the committed `exp` via `effectiveDeath`; only the completeness of a single node's retention
window is disclaimed.

## Standing from v4 (D1/D2, unchanged)

- **D1:** two independent inequalities — signed `ts` in the live-ingress freshness / clock-skew
  window (C-2, live only, not reapplied on migration); `exp` a finite safe integer with
  `ts < exp ≤ ts + TTL_CEILING`. Migration checks the immutable `effectiveDeath`, never "`exp`
  within `FUTURE_TOLERANCE` of now."
- **D2:** one `effectiveDeath = exp + CLOCK_SKEW` used everywhere (body cache eviction, replay
  rejection, authoritative-tombstone and resolved-record retention, provisional promotion). No
  field mixes bare `exp` with `exp + CLOCK_SKEW`.

## RED test matrix (v5)

1. **Byte-exact preimage (defect 2):** V2 preimage bytes + digest golden vectors; V1 preimage +
   digest for the same `{publisher, message}` with no `d` and a different id; `topicId`
   rejection vectors (64-hex / upper-case / non-hex, rejected pre-hash); tampered `exp` →
   different V2 id.
2. **Domain separation:** `MSGID_DOMAIN_V2` vs the legacy V1 no-`d` form produce different ids;
   `d` is never injected into a V1 record.
3. **D1 (retained):** `exp = ts + TTL_CEILING` accepted; `exp > ts + TTL_CEILING` rejected;
   `exp ≤ ts` rejected; stale `ts` rejected at live ingress, legitimately-old migrated record
   not rejected on `ts`.
4. **D2 (retained):** body accepted iff `now ≤ exp + CLOCK_SKEW`; suppression state retained to
   exactly `exp + CLOCK_SKEW`; boundary vectors at `exp`, `exp + CLOCK_SKEW`, `+1`.
5. **ts-outside-identity (supports defect 3):** two bodies with same `{publisher, message,
   topicId, exp}` and different `ts` share a `msgId`; a rewritten `ts` cannot change lifetime.

## Tracked follow-on: the unsigned-`publishTs` ordering weakness

Unchanged from v4: `publishTs`/`rootSeq` still drive high/low-water and replay **ordering**; a
rewritten `publishTs` perturbs ordering, not lifetime. Filed as a tracked follow-on gate,
carried forward when chunking consumes high/low-water ordering; does not block the lifetime
correction here.

## Status

Design v5. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy.
Prerequisite of `REF-1.1-S2.0c-AUTH-B-Design-v5.md`. Submitted for review before any code.
S2.0c and chunking held.
