# REF-1.1 S2.0c — signed immutable message expiry (independent corrective work)

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-SIGNEDEXPIRY-20260811-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Status:** independent corrective work per Aster's Option-B recommendation (msgId
  c509147c) and David's direction (B-prime + signed-expiry). This closes a **current**
  kernel integrity weakness and is a **prerequisite** of the B-prime tombstone design
  (`REF-1.1-S2.0c-AUTH-B-Design.md`): the immutable deadline defined here is what bounds
  B-prime's accepted resurrection residual. S2.0c and chunking stay held.

## The question

What stops a holder from keeping a message — or a resurfaced deleted message — alive past
its intended lifetime, when the only lifetime signal that survives to a fresh replica is a
number any node can rewrite?

## The weakness, grounded in code

The author signs a timestamp, and the kernel then throws it away:

- **The envelope signs `ts`.** `buildEnvelope`/`verifyEnvelope` (envelope.js) sign a
  domain-tagged core `{ d: ENVELOPE_DOMAIN, seq, ts, topic, message }`. The author's `ts`
  is inside the signature; a tamper breaks it.
- **Ingest discards it.** `_onPub` (wireHandlers.js) re-stamps with the **root's own**
  monotonic clock — `const ts = Math.max(role.lastTs + 1, _now())` — and caches
  `{ msgId, publishTs: ts, json, seq }`. The author-signed `ts`, the `signerPubkey`, and
  the `signature` are **not retained**. The cache holds no signed material at all.
- **Eviction trusts the unsigned stamp, head-only.** `_expireCache` evicts only
  `cache[0]` while `now − cache[0].publishTs > TTL_MS`; `_cachePush` appends in arrival
  order. So expiry is arrival-ordered, not per-entry: an expired entry sitting behind a
  newer head is never evicted, and `publishTs` is an unsigned number.
- **Migration carries only the unsigned stamp.** `_syncSnapshot`/`_syncDelta` emit
  `{ json, publishTs, msgId, seq }`. `_ingestStamped` accepts any finite `publishTs`
  within `FUTURE_TOLERANCE_MS` and does not reject an already-expired stamp or a rewritten
  stamp on an old valid envelope.

Consequence (Aster's B-review finding 1): **any holder — not only the author — can replay
the original signed envelope with a fresh wire `publishTs` and extend the message's
effective lifetime**, and `cacheIds` dedups only while resident so a re-ingest after
eviction is not caught. The effective deadline is attacker-controlled today.

## The fix: derive the deadline from signed material, retain it, enforce per entry

**1. The effective deadline is author-signed and immutable.** Add a signed `exp`
(absolute expiry, ms) to the envelope's signed core:

    signedCore = { d: ENVELOPE_DOMAIN, seq, ts, exp, topic, message }

`exp` is author-chosen, **clamped at verification to `ts + TTL_CEILING`** (the protocol
absolute ceiling; an author may ask for less, never more). A record's effective death is
its verified `exp` — a value inside the signature, so no holder can extend it. (A minimal
fallback that adds no new signed field: reuse the already-signed `ts` and define
`deadline = ts + TTL_CEILING`. It is strictly weaker only in that the author cannot choose
a shorter life; the security property is identical. The explicit signed `exp` is
recommended.)

**2. Retain the signed material so a fresh replica can re-derive and re-verify.** The cache
entry and every migration frame carry the fields needed to re-verify the author signature
and read `exp`: `{ signerPubkey, signature, seq, ts, exp, topic }` alongside the existing
`{ msgId, json }`. Any replica re-runs `verifyEnvelope` (author signature + `msgId ==
contentAddress(signerPubkey, message)`) and reads the verified `exp`. This keeps expiry
**author-authoritative** — no root-signed stamp, no new trust root. Cost: cache entries
grow by roughly a signature + pubkey + the small signed scalars; this **increases
full-state frame size and is a direct input to the S2.0c chunking budget** — noted, not
incidental.

**3. Enforce per entry, arrival-order independent.** Eviction removes **every** entry with
`now > exp`, not just `cache[0]` — a deadline-indexed structure or a full sweep, so an
expired entry behind a newer head cannot survive. Ordering by arrival for replay is
unchanged; *expiry* no longer rides on it.

**4. Reject expired on every ingest — live and migration.** Any ingested record (live PUB,
REPLICATE, HANDOFF, REPLAYUP, DELIVER-replay) whose verified `exp < now − CLOCK_SKEW` is
**rejected**, never cached. The unsigned wire `publishTs` is no longer a lifetime input; it
survives at most as advisory replay ordering, never as a death clock. A re-ingest after
eviction carries the record's own signed `exp`, so it is rejected exactly when it should
be — the replay-after-eviction hole closes.

**5. Anonymous / unsigned messages.** An unsigned envelope has no `signerPubkey` and no
signature, so it cannot carry an author-signed `exp`. Its deadline is a **local** bound:
`first-local-ingest + TTL_CEILING`, derived from the receiver's monotonic clock and **not
extendable across migration** (a migrated anonymous record inherits the receiver's local
first-sight bound, never a peer-supplied stamp). This is weaker than the signed path but
bounded and non-forgeable locally. Whether anonymous publishes remain permitted at all is a
separate policy question; this design fences their lifetime either way.

**6. Backward compatibility fails closed.** A record lacking verifiable signed-expiry
material (a pre-cutoff cache entry, or a peer that has not upgraded) is **never trusted for
lifetime**: it is either rejected after a migration cutoff or held only under the bounded
legacy retention window (`first-local-sight + TTL_CEILING`, non-extendable), never granted a
longer life than the ceiling from local first sight. Missing signed material never yields a
*longer* life than the strict path.

## Interaction with the rest of the tranche

- **Prerequisite of B-prime.** B-prime accepts a bounded resurrection residual under
  malicious omission; "bounded" means **bounded by the signed `exp`** defined here. Without
  this, B-prime's residual is unbounded (an omitting attacker could pair omission with a
  rewritten stamp). With it, a resurfaced killed body still dies at its immutable author-set
  deadline.
- **Chunking.** Retaining signed material enlarges cache entries and full-state frames — it
  makes the oversized-frame problem the chunking tranche exists to solve slightly larger,
  and its byte cost must be measured against the 15 KiB routed budget.
- **This is independent of the A/B choice** and worth landing on its own: it closes a live
  lifetime-extension weakness in the shipped kernel.

## RED test matrix (gates before any code clears)

1. **Rewritten migrated stamp cannot extend lifetime:** an old signed envelope re-sent with
   a fresh wire `publishTs` is bounded by its signed `exp`; the rewritten stamp has no
   effect. (Aster gate a.)
2. **Per-entry, arrival-order-independent expiry:** an expired entry behind a newer cache
   head is evicted; head-only eviction is absent. (Aster gate b.)
3. **Re-ingest after eviction:** a record re-ingested after its `cacheIds` entry was evicted
   is rejected iff past its signed `exp`.
4. **Future-tolerance edges:** `exp`/`ts` at the `FUTURE_TOLERANCE_MS` and `CLOCK_SKEW`
   boundaries accept/reject exactly at the specified edge; `exp > ts + TTL_CEILING` is
   clamped, not honored.
5. **Fail-closed backcompat:** a record without verifiable signed-expiry material never gets
   a life longer than `first-local-sight + TTL_CEILING`; a mixed-version migration does not
   extend any lifetime.
6. **Anonymous bound:** an unsigned record's life is `first-local-ingest + TTL_CEILING`,
   local-clock derived, unaffected by any migrated stamp.
7. **Golden vectors:** the extended signed core `{d, seq, ts, exp, topic, message}` and its
   verification, with rejection vectors for a tampered `exp`, a missing `exp`, and
   `exp > ts + TTL_CEILING`.

## Status

Design only. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy.
Independent corrective work + prerequisite of `REF-1.1-S2.0c-AUTH-B-Design.md`. Submitted
for review before any code. S2.0c and chunking held.
