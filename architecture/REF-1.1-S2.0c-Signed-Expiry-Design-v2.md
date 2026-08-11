# REF-1.1 S2.0c — signed immutable message expiry, v2

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-SIGNEDEXPIRY-20260811-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `REF-1.1-S2.0c-Signed-Expiry-Design.md` (bd56455), reviewed **CHANGES
  REQUIRED** (Aster, msgId 6fbe31c0). v2 resolves findings F1–F4. Direction unchanged
  (David: B-prime + signed-expiry). Independent corrective work + prerequisite of
  `REF-1.1-S2.0c-AUTH-B-Design.md`. S2.0c/chunking held.

Everything in v1 stands except the four corrections below.

## F1 — a deterministic deadline that cannot vary across valid representations

`msgId = hash({publisher, message})` excludes `topic`, `ts`, `seq`, `exp`, and the
signature. So one author can sign several valid envelopes with the **same `msgId` and
different `exp`** — "signed" alone does not make `exp` immutable per `msgId`. v1 assumed a
single deadline per `msgId`; that assumption is false.

v2 rule: **a receiver honors the EARLIEST valid signed `exp` it has ever seen for a
`(topicId, msgId)`**, and that choice is monotone-shortening — a later-arriving valid
variant with a longer `exp` never replaces a shorter one already recorded. Why this is
safe:

- Only the author can produce *any* valid variant (the signature covers `exp`), and every
  valid `exp` is clamped `≤ ts + TTL_CEILING`. So no representation can extend life past the
  ceiling, and no holder can forge a longer one.
- A holder presenting a longer-`exp` variant to a replica that already recorded a shorter
  one is ignored (earliest-seen wins). A replica that has only seen the longer variant
  honors it — still author-signed and `≤ ceiling`, so bounded, never an *extension* beyond
  what the author signed.
- The only party who can shorten a message's life is its own author (by signing a short
  `exp`), which is legitimate.

The effective deadline for a `(topicId, msgId)` is therefore `min(exp)` over valid variants
seen — deterministic, non-extendable, fail-short. (Alternative considered and rejected as
heavier: fold a lifetime revision into the content address, which changes `msgId`/dedup
semantics. The earliest-valid-`exp` rule needs no `msgId` change.)

## F3 — the signed envelope is already retained; parse it, do not duplicate it

v1's premise was wrong (owned). The cache does **not** drop signed material: it stores
`json`, which is the **complete serialized signed envelope** (`_ingestPublish(role, json)`
→ `JSON.parse` → `verifyEnvelope`), and `_syncSnapshot`/`_syncDelta` migrate that same
`json`. `signerPubkey`, `signature`, the signed `ts`/`topic`, and (v2) `exp` are all inside
it.

v2 therefore does **not** add sidecar copies of signed fields (duplication invites
disagreement states and inflates the chunking budget). It **parses and verifies the stored
envelope** and derives only a small **effective-expiry index** (the `min(exp)` from F1) for
eviction ordering. The bug being fixed is narrow: eviction and freshness must read the
signed `exp` out of the envelope, not the unsigned sidecar `publishTs`.

**Name collision fixed:** the design distinguishes the envelope's **author `seq`** (signed,
inside the envelope) from the cache entry's **root-assigned dense `seq`** (the gap-detection
counter `_onPub` stamps). v1 called both `seq`; v2 names them `authorSeq` and `rootSeq`.

## F2 — anonymous / legacy records fail closed on migration

A fresh receiver cannot inherit another node's local first-sight time without a portable
authenticated value, so `first-local-sight + TTL_CEILING` **resets every hop** and churn
extends such a record indefinitely. v1's "local bound, non-extendable across migration" is
impossible as written (owned).

v2: an anonymous or legacy record (no verifiable signed `exp`) is **rejected on migration
after the domain cutoff** — it is not migrated at all. A node may still hold its own
locally-ingested anonymous records under a local `first-sight + TTL_CEILING` bound, but such
records are **never transferable**. No non-extendable *network* bound is claimed from
receiver-local state; the fail-closed choice is non-migration.

## F4 — exact versioning and validation

- **Version bump.** Adding `exp` changes the signed core, so `ENVELOPE_DOMAIN` /
  envelope version is bumped and the mixed-fleet cutoff is specified (a pre-`exp` envelope
  is a legacy record under F2).
- **Clamp at sign, reject at verify.** The author clamps `exp ≤ ts + TTL_CEILING` **before
  signing**. `verifyEnvelope` **rejects** a non-finite, non-integer, or out-of-range `exp`
  (including `exp > ts + TTL_CEILING`) — it never mutates a signed value and calls the
  result "verified `exp`" (v1's error).
- **Exact boundary + skew.** Death is `now > exp + CLOCK_SKEW` (reject strictly after);
  `FUTURE_TOLERANCE_MS` bounds a future `ts`/`exp` at ingress. Both constants are named in
  the design with their test edges.
- **Ordering is a separate, explicitly-open issue.** `exp` removes `publishTs` as the
  *lifetime* clock, but `publishTs`/`rootSeq` still drive high/low-water and replay
  **ordering**. v2 does not bind ordering to signed material — it **states that ordering-
  integrity gap is left open** as its own follow-on (an attacker rewriting `publishTs` can
  still perturb replay order, not lifetime), rather than silently pretending it is closed.

## RED test matrix (v1 set plus F1–F4 edges)

Carries v1's cases (per-entry arrival-order-independent eviction; re-ingest after eviction;
fail-closed backcompat) and adds:

1. **Same `msgId`, two valid expiries:** the shorter `exp` wins wherever both are seen; a
   later longer variant never extends an already-recorded shorter deadline (F1).
2. **Signed material read from the stored envelope**, not a sidecar; no duplicated fields;
   `authorSeq` and `rootSeq` are distinct and neither is confused for the other (F3).
3. **Anonymous/legacy on migration:** rejected after cutoff, not migrated; a locally-held
   anonymous record is non-transferable (F2).
4. **Version/validation:** a pre-`exp` domain envelope is treated as legacy; `exp >
   ts + TTL_CEILING` is rejected at verify (not clamped); non-finite/non-integer `exp`
   rejected; boundary + skew edges exact (F4).
5. **Ordering gap acknowledged:** a rewritten `publishTs` cannot change *lifetime* (bounded
   by signed `exp`); the test records that it can still affect replay ordering, which this
   design leaves open.
6. **Golden vectors:** signed core `{d, authorSeq, ts, exp, topic, message}` with rejection
   vectors for tampered/missing/out-of-range `exp`.

## Status

Design v2. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy.
Independent corrective work + prerequisite of `REF-1.1-S2.0c-AUTH-B-Design-v2.md`. Submitted
for review before any code. S2.0c and chunking held.
