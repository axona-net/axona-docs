# REF-1.1 S2.0c — signed immutable message expiry, v3

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-SIGNEDEXPIRY-20260811-03`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v2.md` (999cbef). v2's F1 fix (earliest-seen `exp`) was
  **stop-shipped** by Aster (`ASTER-COUNCIL-REF11-S20C-EXPIRY-F1-20260811-01`, via David
  msgId 05789caf): earliest-seen is a *local* monotone rule that gives a cold replica no
  unique deadline. **David chose Option 1** (identity-level binding). v3 replaces the F1
  fix accordingly; v2's F2/F3/F4 corrections stand. Independent corrective work +
  prerequisite of `REF-1.1-S2.0c-AUTH-B-Design-v3.md`. S2.0c/chunking held.

## F1, resolved: the deadline is part of the content-addressed identity

`msgId` must uniquely and immutably determine the deadline for a **cold** replica — one
with no history, no checkpoint, no membership. Earliest-seen cannot: a fresh replica that
sees only the longer-`exp` representation accepts it, and a malicious source withholds the
shorter one (the accepted omission model). The only cold-verifiable answer is to make the
deadline part of the identity.

**v3 (Option 1):**

    msgId = sha256( canonical({ publisher, message, topicId, exp }) )

where `publisher` is `signerPubkey` (or `null` anonymous), `message` the payload, `topicId`
the derived 66-hex topic id, and `exp` the author-signed absolute expiry (ms). The envelope
signed core gains `exp`:

    signedCore = { d: ENVELOPE_DOMAIN_V4, authorSeq, ts, exp, topic, message }

Verification at any replica, cold or warm:

1. `verifyEnvelope` — the author signature covers `{…, exp, …}`;
2. recompute `msgId = sha256(canonical({publisher, message, topicId, exp}))` and require it
   equals `env.msgId`.

Because the `msgId` **commits to `exp`**, every representation carrying that `msgId`
necessarily carries the same `exp`. Two different expiries are two different `msgId`s — two
distinct records — so there is nothing to "select" and nothing to extend. The effective
deadline is `exp`, read straight off a content-address-verified envelope. No earliest-seen
rule, no history.

**This closes F5 (cross-topic) at the same layer.** `msgId` now commits `topicId`, so the
same author+message on two topics has two different `msgId`s, and a kill (which names a
`msgId`) can only ever match a body in the same topic. The explicit `topicId` agreement
check is retained as defense-in-depth (below and in AUTH-B v3), but cross-topic replay is
now impossible by construction.

**`ts` stays signed but out of the identity** (consistent with #140's "drop ts from the
id"): `exp`, not `ts`, is what the deadline needs, and two variants with the same `exp` and
different `ts` share a `msgId` and a deadline — harmless for lifetime (their only difference,
replay ordering, is the separately-open F4 issue).

## Ripple of the identity change (stated, not incidental)

- **`computeMsgId`** changes from `{publisher, message}` to `{publisher, message, topicId,
  exp}`. Flag-day: bump `ENVELOPE_DOMAIN` to V4 and specify the mixed-fleet cutoff.
- **Dedup** by `msgId` is now inherently topic- and expiry-scoped — a stricter, more correct
  identity. An idempotent retry re-sends the byte-identical envelope (same `exp`) → same
  `msgId` → still dedups; only a deliberately different `exp` mints a new id, which is
  correct.
- **`pull(msgId)`** interface is unchanged (callers pull an id they already hold).
- **Kill targets** now name an id that commits `topicId`+`exp`, so a signed kill targets one
  exact revision.
- **Consumers that compute a content address** (peer.pub, kill targeting, apps) must include
  `topicId`+`exp`. This revises the deliberate #140 design (approved by David as Option 1).

## Standing from v2 (F2/F3/F4)

- **F3:** the signed envelope is already retained as `json` — parse/verify it, derive only an
  effective-expiry index; no sidecar duplication; `authorSeq` (signed, in the envelope) vs
  `rootSeq` (root dense counter) named distinctly.
- **F2:** anonymous / legacy records (no committed `exp` — i.e. a pre-V4 `msgId`) fail
  closed: rejected on migration after the cutoff, never migrated. A locally-ingested
  anonymous record lives under a local `first-sight + TTL_CEILING` bound and is
  non-transferable.
- **F4:** clamp `exp ≤ ts + TTL_CEILING` **before signing**; `verifyEnvelope` **rejects** a
  non-finite/non-integer/out-of-range `exp` (never mutates); death is `now > exp +
  CLOCK_SKEW`; `FUTURE_TOLERANCE_MS` bounds future `ts`/`exp`. Per-entry, arrival-order-
  independent eviction. `publishTs`/`rootSeq` still drive replay **ordering**; that
  ordering-integrity gap is left **explicitly open** as its own follow-on, not silently bound.

## Anonymous messages

An unsigned envelope has no `signerPubkey` and cannot commit a signed `exp`; its `msgId`
(pre-V4 form or an unsigned V4 with `publisher: null`) yields a **local** deadline only
(`first-local-ingest + TTL_CEILING`), non-transferable. Whether anonymous publishes remain
permitted is a separate policy question; their lifetime is fenced either way.

## RED test matrix (v2 set, F1 case replaced)

1. **Identity binds the deadline:** two envelopes with the same `{publisher, message,
   topicId}` and different `exp` have **different `msgId`s**; each verifies; a cold replica
   reads exactly one `exp` per `msgId` (F1). A tampered `exp` breaks both the signature and
   the `msgId` recompute.
2. **Cross-topic impossible by construction:** the same author+message on two topics has two
   `msgId`s; a kill for one cannot match the other (F5 subsumed).
3. **F3/F4/F2 edges** as in v2 (stored-envelope parse not sidecar; clamp-at-sign/reject-at-
   verify; anonymous/legacy fail-closed on migration; per-entry eviction; boundary+skew).
4. **Ordering gap acknowledged:** a rewritten `publishTs` cannot change lifetime (bound by
   committed `exp`); it can still affect replay ordering — left open.
5. **Golden vectors:** `msgId = sha256(canonical({publisher, message, topicId, exp}))` and
   signed core `{d: ENVELOPE_DOMAIN_V4, authorSeq, ts, exp, topic, message}`, with rejection
   vectors for tampered/missing/out-of-range `exp` and a `msgId`/`exp` mismatch.

## Status

Design v3. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy.
Independent corrective work + prerequisite of `REF-1.1-S2.0c-AUTH-B-Design-v3.md`. Submitted
for review before any code. S2.0c and chunking held.
