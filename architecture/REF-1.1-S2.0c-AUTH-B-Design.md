# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Status:** the tombstone-authorization design for S2.0c, per Aster's B-prime
  recommendation (msgId c509147c) and David's direction (B-prime + signed-expiry, with
  explicit acceptance of the bounded-resurrection residual). **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design.md` — the immutable signed deadline is what bounds
  the residual below. Replaces the S2.0c-AUTH admission-attestation stack and its
  membership-consensus prerequisite (S2.0c-MEMBERSHIP): **B-prime builds none of that.**
  S2.0c and chunking held.

## The question

How does a fresh replica honor a deletion during full-state migration, without a
transferable authorization proof and without a membership-consensus layer — such that a
forged deletion can never suppress another author's content?

## The one idea

**A migrated tombstone is a provisional claim, and a claim only becomes a deletion where
the body is present to prove the killer is the author.** Suppression is never decided by
`msgId` alone. That single rule removes forged-hint censorship — the failure that sank the
earlier B-recut — with no membership history and no consensus.

## Mechanism

**Migration carries the signed kill.** REPLICATE / HANDOFF / REPLAYUP carry the complete
**signed kill object** (kill.js: `{ d: KILL_DOMAIN, topicId, msgId, ts, seq, signerPubkey,
signature }`), not today's unsigned `_activeDels` shape. On receipt the node runs
`verifyKill` (signature valid, well-formed). That proves *someone* signed a kill for this
`msgId` — it does **not** prove authorization.

**A body-absent kill is a PROVISIONAL claim.** Keyed by `msgId`, stored bounded (below). A
provisional claim:

- does **not** suppress or delete anything by `msgId` alone;
- does **not** app-deliver anything;
- is **never** propagated onward as an authorized deletion — a node re-emits the signed
  kill as a provisional claim, re-verifiable from scratch by the next hop.

**Authorization happens co-located, on body arrival.** When the body for `msgId` arrives by
any path, before any app delivery the receiver:

1. Verifies the body — `verifyEnvelope` (author signature + `msgId ==
   contentAddress(signerPubkey, message)`, the B-4 check) and the signed expiry
   (signed-expiry design). An expired or unverifiable body is rejected outright.
2. Looks up a provisional claim for `msgId`. If one exists, compares
   `claim.signerPubkey` to the body's authenticated author (`envelope.signerPubkey`):
   - **Match** → **authoritative deletion.** Suppress the body, do not app-deliver, record
     an authoritative tombstone (co-located-verified), bounded by the body's signed `exp`.
   - **Mismatch, or anonymous target** (the body is unsigned, or the claim's signer is not
     the author) → **discard the claim, accept and deliver the body.** A kill by a
     non-author can never suppress another author's content. (This matches kill.js's own
     note that an anonymous message has no `signerPubkey` to match, so nobody can kill it.)

**Tombstones are authoritative only where co-located-verified.** An authoritative tombstone
that later reaches a fresh replica *without* the body reverts to a **provisional** claim
there — that replica cannot check author-match without the body. The rule is uniform and
needs no trust in the sender: suppression is earned locally, against a present body, every
time.

## What bounds the claim's life (signed-expiry dependency)

A provisional claim need only outlive the possibility of its body. The body's death is its
**immutable signed `exp`** (signed-expiry design). So a provisional claim is retained until
`exp` (where the `msgId`'s signed deadline is known from a co-resident record or the kill's
own bound) or a local bound otherwise, then dropped. Provisional-claim storage is capped
per topic and globally, like any inbound buffer; overflow drops oldest claims (a dropped
claim only weakens *early* suppression, never authorizes anything).

## The accepted residual: bounded resurrection under malicious omission (David)

B-prime does **not** defeat a malicious migration source that **omits** a real kill and
ships the retained body to a fresh replica. That replica verifies the body, finds no
provisional claim, and delivers it — a resurrection. This is the residual David has
explicitly accepted, and it is **bounded and self-correcting**:

- **Bounded:** the resurfaced body still dies at its **immutable signed `exp`** — the
  attacker cannot extend it (signed-expiry design). Resurrection lasts at most the message's
  own remaining signed lifetime, never longer.
- **Self-correcting:** the authoritative signed kill re-propagates by the normal kill path
  (eager K-closest cohort delivery; where the body is present it is co-located-authorized
  and suppressed). Omission only delays, within the signed deadline.
- **Attacker cost:** the source must already be an accepted migration source for the topic
  and must *choose* to omit — it gains at most a bounded, self-healing re-exposure, never a
  durable forged deletion or a censored message.

Deletion under B-prime is therefore **best-effort against a malicious omitting source,
hard-bounded by the author's signed deadline** — not the strict, cold-verifiable deletion
Option A provides. That trade is the decision David made; it is recorded here as an explicit
risk acceptance, not a design detail.

## What B-prime does NOT need (the simplification)

- **No membership consensus, no cohort-certificate chain, no fork-safe transitions, no
  authenticated genesis, no forward-secure keys.** The entire S2.0c-MEMBERSHIP subsystem is
  not built.
- **No admission attestation, no new signing domains, no quorum.** Reuses the existing
  signed kill (kill.js) and signed envelope (envelope.js) verified where the body is present.
- **No authenticated-migration-origin requirement for tombstone safety.** The co-located
  author check removes censorship without it; migration-origin trust remains a general
  concern but is not load-bearing for deletion authorization here. (This is exactly the
  finding-3 requirement B-recut needed and B-prime does not.)
- **No suppression-by-msgId.** The property that made B-recut censorable is absent by
  construction.

## Chunking interaction

The chunking del record now carries the **signed kill object** (a provisional claim) —
which the chunk transport already knows how to carry and size. Chunking v6's
admission-proof / cohort-descriptor / certificate-chain fields are **removed**; the
authorization layer it depended on collapses to "carry the signed kill, authorize
co-located." Chunking v6 needs a revision (a v7) to consume B-prime; that is a follow-on
once this and the signed-expiry design clear. The Merkle transfer-tree, exact partition, and
fragmentation mechanics are unaffected.

## Test matrix (gates before any code clears)

1. **No forged-hint censorship:** a kill signed by a non-author for another author's
   `msgId`, migrated as a provisional claim, does **not** suppress the body when it arrives
   — author-match fails, claim discarded, body delivered.
2. **Genuine co-located deletion:** `claim.signerPubkey == body author` → the body is
   suppressed, not delivered, and recorded as an authoritative tombstone bounded by signed
   `exp`.
3. **Anonymous target:** an unsigned body can never match a claim → delivered; a kill naming
   an anonymous `msgId` is inert.
4. **No suppression by msgId alone:** a provisional claim with no body present neither
   deletes, nor blocks, nor delivers anything.
5. **Never propagated as authorized:** a node forwarding state re-emits the signed kill as a
   provisional claim; the next hop re-verifies from scratch and does not treat it as
   pre-authorized.
6. **Reversion on migration without body:** an authoritative tombstone migrated to a replica
   that lacks the body becomes provisional there and does not suppress until the body arrives
   and author-match holds.
7. **Bounded resurrection under omission (accepted residual):** a source omits the kill and
   ships the body → the body is delivered but dies at its immutable signed `exp`; a later
   normal kill re-suppresses where the body is present. The resurrection window never exceeds
   the signed deadline.
8. **Claim storage bounded:** provisional-claim count/bytes are capped; overflow drops
   oldest claims and never authorizes a deletion.

## Status

Design only. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy.
Depends on `REF-1.1-S2.0c-Signed-Expiry-Design.md`; supersedes the S2.0c-AUTH /
S2.0c-MEMBERSHIP direction, which is not built. Submitted for review before any code.
S2.0c and chunking held.
