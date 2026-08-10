# REF-1.1 S2.0c — full-state chunking protocol design, v5

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-CHUNKDESIGN-20260810-05`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy. S2.0c held, S2.1 blocked.
- **Supersedes:** `...-Design-v4.md` (4f80a40), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V4-REVIEW-20260810-08`). v5 resolves the five v4 findings.
  Finding 3's privacy fork was decided by David: **compact creator-signed receipt;
  authorization dropped for pre-cutoff kills.**

Everything from v4 stands except the five items below.

## 1. Transfer commitment is a real Merkle tree (F1)

v4's flat `transferRoot = H(context ‖ ordered subBatchRoots)` cannot back a
logarithmic inclusion proof. v5:

    descriptorLeaf(i) = H("axona/chunk/desc/v1" ‖ canonical(descriptor_i))
    subBatchTreeRoot  = merkleRoot([descriptorLeaf(0) … descriptorLeaf(n-1)])
    transferRoot      = H("axona/chunk/transfer/v1" ‖ topicId ‖ policy ‖ epoch ‖
                          senderId ‖ subBatchCount ‖ totalLeafCount ‖
                          totalTombstoneCount ‖ subBatchTreeRoot)
    transferId        = H("axona/chunk/transferid/v1" ‖ transferRoot)

Each sub-batch carries its descriptor and a Merkle inclusion proof of
`descriptorLeaf(i)` under `subBatchTreeRoot`; each chunk still carries its per-record
proof under its own `subBatchRoot`. Canonical descriptor schema and the proof
algorithm ship with golden vectors.

## 2. The descriptors prove one exact, disjoint partition (F2)

    descriptor_i = { subBatchIndex, subBatchRoot, globalLeafStart, leafCount,
                     tombstoneLeafCount }

Completion requires proving the descriptors form a **gap-free, non-overlapping
partition**: sorted by `globalLeafStart`, each `globalLeafStart == previous start +
previous leafCount`, the first starts at 0, the last ends at `totalLeafCount`, and
`Σ tombstoneLeafCount == totalTombstoneCount` with tombstone leaves occupying the
canonical prefix. Duplicated, omitted, overlapping, or tombstone-relabeled ranges
fail this proof. **No body releases, no high-water advances, and no `HANDOFFACK`
issues until the whole-partition proof plus every required authorization holds.**

## 3. Tombstone authorization: a compact receipt, no retained content (F3 — David's decision)

The privacy problem in v4: carrying the original envelope to prove authorship keeps
deleted content alive in every replica. **Decision (David): use a compact
creator-signed author→msgId receipt; drop authorization for pre-cutoff kills.**

**Receipt.** At publish, while the body is available, the author mints

    authorReceipt = sign_author( canonical({ d: "axona/authored/v1", topicId, msgId }) )

binding the author's public key to `msgId` with **no content**. Relays store it with
the cache entry so it can accompany a future tombstone. The canonical del record
becomes:

    delRecord = { signedKill:    { d: KILL_DOMAIN, topicId, msgId, ts, seq,
                                   signerPubkey, signature },
                  authorReceipt: <creator signature over {authored, topicId, msgId}>,
                  rootStamp:     { killTs, rootSeq } }        // untrusted; see §5

**Verification before any effect:** `verifyKill(signedKill)` valid; `authorReceipt`
verifies under `signedKill.signerPubkey` over the same `(topicId, msgId)`; topic
matches the authenticated `signedKill.topicId`. The receipt is trusted as a creator
attestation: the publish path already verifies `msgId = contentAddress(author, body)`
at ingress (B-4), so a genuine receipt can only have been minted by the true author
for a real message; a node must never mint a receipt for a `msgId` it did not author.
The tombstone carries **no body and no preimage** — deletion stays deletion.

**Legacy transition (David).** Messages published before the receipt cutoff (a
protocol-version/epoch marker) have no receipt. Their tombstones carry none and are
**accepted without author-proof** — authorization is dropped for pre-cutoff kills.
Post-cutoff kills **must** carry a valid receipt or the tombstone fails the batch.
The exception is bounded: it covers only pre-cutoff messages and ages out with TTL.
This is recorded in the `SECURITY-CHANGELOG` when it ships (the unsigned-migrated-
tombstone gap it closes is disclosed to the council).

## 4. Fragment authentication and allocation (F4)

    recordId = H("axona/chunk/record/v1" ‖ canonical(complete record))
    fragment = { transferId, subBatchIndex, globalLeafIndex, recordId,
                 fragIndex, fragCount, totalBytes, bytes }

Before allocation: validate `fragCount` and `totalBytes` against caps
(`MAX_FRAGMENTS_PER_RECORD`, `MAX_RECORD_BYTES`). Reassembly is keyed by
`(authSenderId, transferId, subBatchIndex, globalLeafIndex, recordId)`; conflicting
duplicate fragments (same index, different bytes) are rejected. The receiver requires
an **exact, gap-free byte reconstruction** whose hash equals `recordId` **before** it
computes the record leaf and checks the leaf's Merkle proof. The transfer-global
tombstone gate (§2) waits for complete reassembly **and** authorization of every
fragmented del record and its receipt. A bounded buffer caps memory; coherent
reassembly is what `recordId` equality proves.

## 5. rootStamp is untrusted, with explicit guards (F5)

The signed kill does not sign the later root stamp, so a batch sender can forge
`killTs`/`rootSeq`. v5 treats `rootStamp` as **untrusted**: topic binding comes only
from the authenticated `signedKill.topicId` (v4's claim that `rootStamp` joins topic
agreement is withdrawn — its schema has no topic). `killTs` is accepted only within a
clock-sanity window; `rootSeq` may order a tombstone **within already-authorized
state** but may never advance high-water or completion past the transfer-level proof
(§2). A forged-future or non-monotone `rootStamp` cannot advance ordering or
high-water. (A signed root receipt is the stronger alternative; it is deferred unless
one already exists to reuse, since the untrusted-with-guards path needs no new root
signing surface.)

## Test matrix — v4 set plus Aster's additions

Carries v4's cases and adds:

1. A flat-list / forged transfer proof **fails**; indexed transfer-tree golden
   vectors **pass**.
2. Duplicate, overlapping, missing, or relabeled sub-batch leaf ranges **cannot
   complete**.
3. Deletion authorization **never exposes or app-delivers retained content** — the
   receipt carries none; a pre-cutoff tombstone with no receipt is accepted without
   any body.
4. Fragment-count / length abuse and conflicting duplicate fragments **fail before
   unsafe allocation or delivery**.
5. Fragments from another transfer, sub-batch, or leaf position **cannot mix**.
6. A forged-future or non-monotone `rootStamp` **cannot advance ordering or
   high-water**.
7. A post-cutoff kill **without** a valid receipt **fails**; a pre-cutoff kill
   without one is accepted (legacy exception).

## Status

Design v5. No chunk-size constant, no S2.0c clearance, no S2.1 authorization, no
canary or deploy is implied. Submitted for review before any sync-engine code.
