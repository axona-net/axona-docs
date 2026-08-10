# REF-1.1 S2.0c — full-state chunking protocol design, v3

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-CHUNKDESIGN-20260810-03`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy. S2.0c held, S2.1 blocked.
- **Supersedes:** `...-Design-v2.md` (86091be), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-CHUNKDESIGN-REVIEW`, v2 re-review). v3 resolves the six
  new findings; two (circular commitment, integrity≠authorization) were errors, and
  the second surfaces a **pre-existing** security gap in the current unchunked sync
  path — called out below.

v2's frame invariant, per-item acceptance, tombstone-phase gate, REPLAYUP recovery,
state machines, and enforced producer bounds stand. v3 changes the commitment, the
manifest, tombstone authorization, and the liveness rules.

## The commitment is over content, never over frame bytes (F1)

v2 hashed chunk *bytes*, but a chunk carries `batchId`/`manifestRoot` in its
envelope, so those bytes contained a value derived from their own hash — circular.
v3 digests **content**, and every commitment-bearing envelope field is excluded
from every digest input.

Canonical leaf serialization (normative, test-vectored; uses the kernel's existing
`canonical()`):

    msgLeaf(rec)  = H("axona/chunk/leaf/msg/v1"  ‖ canonical({ json, publishTs, msgId, seq }))
    delLeaf(kill) = H("axona/chunk/leaf/del/v1"  ‖ canonical(signedKillObject))

The message leaf binds the **whole stamped record** ingest consumes — `json`,
`publishTs`, `msgId`, `seq` — not `msgId` alone and not the ambiguous "body" (F5).
So a different `{json, publishTs, seq}` under the same `msgId` produces a different
leaf and is rejected.

Leaves are ordered canonically (tombstone leaves first, then message leaves by
`msgId`). The transfer is committed by a **Merkle root** over that leaf sequence:

    transferRoot = merkleRoot(orderedLeaves)          // explicit leaf hashes, no self-reference
    batchId      = H("axona/chunk/batch/v1" ‖ senderId ‖ topicId ‖ policy ‖
                     version ‖ leafCount ‖ tombstoneCount ‖ transferRoot)

No field hashed here is derived from `batchId` or `transferRoot`, so there is no
fixed point. The exact byte schema is normative and ships with test vectors.

## Bounded, self-verifying chunks — no monolithic manifest (F2, F6-reorder)

v2 put the whole manifest in index 0; for a 16 MiB / 1024-message cache the digest
lists alone exceed one 15 KiB frame, and only index 0 could bootstrap the batch.
v3 removes the special header entirely. **Every chunk is self-authenticating.**

A chunk carries: the small fixed **root header** (`batchId, transferRoot, version,
leafCount, tombstoneCount, policy, topicId, senderId, epoch`), its slice of leaves'
**records**, and a **Merkle inclusion proof** for each record's leaf against
`transferRoot`. The header is identical on every chunk (immutable-metadata rule),
so any chunk — arriving in any order — establishes the root and self-verifies; the
"non-header-first" problem disappears (F6). Proof size is `≈ log2(leafCount)` × 32
bytes (≈ 350 bytes at 1100 leaves), so a chunk holds fewer records to keep the
whole encoded routed frame ≤ 15 KiB, asserted after encode.

`MAX_CHUNKS_PER_BATCH` caps `leafCount` per batch, which sets an explicit
**maximum transferable snapshot per batch**. A cache larger than that is sent as an
ordered sequence of **bounded sub-batches**, each with its own `transferRoot`, under
a **transfer-level root** `H(ordered sub-batch roots)`; completion of the logical
transfer requires every sub-batch complete and the transfer-level root verified.
Every header and proof-bearing frame is proven against the same whole-frame
≤ 15 KiB postcondition.

## Tombstone authorization, not just integrity (F4 — error + pre-existing gap)

A manifest-matching tombstone proves only that the authenticated batch sender
supplied those bytes. It does **not** prove the delete was authorized. In the
current code this is a live gap independent of chunking: `_activeDels`
(topicStore.js:92) migrates `{ del, msgId, killTs, signer, seq }` — signer metadata,
**no signature** — and `_applyDels` → `_applyKill` tombstones the `msgId` with **no
verification**. A full KILL frame, by contrast, carries a signed kill object
(`kill.js`, ed25519, `verifyKill()`). So today any authenticated REPLICATE/HANDOFF
sender can tombstone arbitrary messages on a backup.

v3 closes it:

- Tombstones **retain the signed kill object** (`topicId, msgId, killTs,
  signerPubkey, signature`), and migration carries it. The del leaf binds the whole
  signed object.
- The receiver runs `verifyKill()` **before** any durable effect. An unauthorized or
  unverifiable tombstone **fails the batch** and blocks completion and `HANDOFFACK`.
- Until authorship is established a tombstone is **provisional quarantine**: it may
  neither delete a body, nor suppress-then-release, nor fan out, nor be acked.

This is a security-relevant change and gets a `SECURITY-CHANGELOG` entry when it
ships (it hardens the migrated-tombstone path, kill-leak class). Because it affects
the current unchunked path too, it is tracked as a current-path security item with
**public disclosure held until the fix ships**, per the established policy used for
the `find_closest_set` K-clamp (#433).

## Completion, acceptance, and mixed-fleet handoff (F3, F5)

Completion is unchanged from v2 in spirit — every leaf HELD or validly SUPPRESSED,
zero unexplained rejects — but now every accepted item verifies against
`transferRoot`, and every tombstone verifies its kill authorization. A rejected or
unauthorized item fails the batch; a short transfer can never ack.

Mixed fleet (F3): capability is negotiated **before heir selection**. The leaver
picks an heir only from chunk-capable (≥ version) candidates for state larger than
the single-frame cap. No legacy ack and no truncated legacy transfer clears
departure of oversized state. **If no chunk-capable heir can prove full
accepted-state equality, the leaver retains the role and state** (or a defined safe
durable fallback) — it never drops the last copy. State that fits one frame may
still hand off to a legacy heir via the whole-frame path.

## Liveness: a frozen epoch, not preemptible supersession (F6)

v2's "newer snapshot supersedes the active batch" can livelock under sustained
mutation. v3 freezes each transfer at a start **epoch**: a snapshot taken at epoch
E runs to completion and is **non-preemptible**; a newer snapshot does not cancel
it but queues as epoch E+1. One in-flight batch per `(peer, topic)`; the next epoch
starts only after the current completes, fails, or times out. Each frozen batch has
bounded chunks, so it provably completes before the next begins — eventual
completion under continuous mutation, no cancel-loop. (Checkpoint-plus-delta is the
alternative; the frozen epoch is simpler and chosen.) Role change still cancels
cleanly, because the leaver/root no longer owns the topic.

## Receiver, revised (F6-reorder)

Keyed by `(authSenderId, topicId, policy, batchId)`:

| State | Event | Next | Action |
|-------|-------|------|--------|
| — | any chunk, header valid, leafCount ≤ cap, buffers free | ASSEMBLING | allocate bounded assembly from the chunk's own header |
| — | leafCount over cap / no buffer / header inconsistent | (reject) | drop, no allocation |
| ASSEMBLING | chunk, each record's Merkle proof verifies vs transferRoot | ASSEMBLING | tombstone records → verifyKill(); if ok, apply to durable map (quarantined); message records → HOLD until tombstone phase complete |
| ASSEMBLING | any proof / verifyKill fails | FAILED | fail batch; block completion + HANDOFFACK |
| ASSEMBLING | all tombstone leaves present + authorized | (phase) | release held bodies for ingest |
| ASSEMBLING | all leaves HELD/SUPPRESSED, 0 rejects, root verified | COMPLETE | advance high-water; fire completion / HANDOFFACK{batchId,complete} |
| any | assembly bytes/count exceeded / TTL | FAILED/EXPIRED | drop; REPLAYUP → bounded recovery PULLUP(batchId) |
| COMPLETE | re-sent chunk | COMPLETE | re-emit ack, rate-limited |

Bounds unchanged from v2 (`MAX_CHUNKS_PER_BATCH`, inflight-per-peer, global bytes,
TTL, ack re-emit), plus the per-batch max-snapshot the cap implies.

## Test matrix — v2 set plus Aster's additions

Carries v2's cases and adds:

1. Deterministic manifest/batch **construction test vectors** proving no hash cycle
   (canonical leaf + Merkle root golden vectors).
2. Maximum legal cache **and** tombstone snapshot, every header/proof frame ≤ 15 KiB.
3. A transfer spanning **multiple bounded sub-batches**, transfer-level root verified.
4. **Legacy-only heir set** for oversized state → the leaver retains state, no drop.
5. **Unauthorized / unverifiable migrated tombstone** → batch fails, no release, no
   ack.
6. **Non-header chunk arriving first** → self-verifies, no starvation.
7. **Sustained snapshot mutation** → frozen epochs each complete, no starvation.
8. **Exact stamped-record substitution** under the same `msgId` → rejected.

## Status

Design v3. No chunk-size constant, no S2.0c clearance, no S2.1 authorization, no
canary or deploy is implied. The migrated-tombstone authorization gap is filed
separately as a current-path security item. Submitted for review before any
sync-engine code.
