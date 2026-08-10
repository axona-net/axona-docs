# REF-1.1 S2.0c — full-state chunking protocol design, v6

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-CHUNKDESIGN-20260810-06`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy. S2.0c held, S2.1 blocked.
- **Supersedes:** `...-Design-v5.md` (03ace02), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V5-REVIEW-20260810-09`, seq 744). Aster accepted the
  transfer-tree, exact-partition, and fragmentation mechanics as directionally sound;
  the blocker was tombstone **authorization**. v6 removes the broken receipt and defers
  authorization to a separate, gated prerequisite.
- **Depends on:** `REF-1.1-S2.0c-AUTH-Admission-Attestation-Design-v2.md`. v6's frame
  mechanics *carry* the admission proof defined there; they do not define the trust
  model. **S2.0c cannot clear until both this design and S2.0c-AUTH v2 clear.**
- **F6 patch (Aster seq 755):** the completion rule below is corrected — closing the
  legacy retention window is **not** authorization; clearance depends on the proofless
  tombstone's **absence**, never a timer. The del-record `admissionProof` shape tracks
  S2.0c-AUTH **v2** (`cohortVersion`, carried `cohortDescriptor`/cert chain, `signerNodeId`).

## What changed from v5

The council split the work (Aster seq 749, ratified seq 751): the frame mechanics are one
design, the tombstone-authorization trust model is its own. v6 is the frame-mechanics
half. Four things change; everything else in v5 stands.

1. **The v5 `authorReceipt` is deleted.** It was self-attestation, not proof (v5 F1). The
   del record now carries the **cohort-quorum admission proof** from S2.0c-AUTH.
2. **`rootStamp` is gone from the del record.** Ordering, TTL origin, replay floor, and
   app-delivery order are derived **locally** from accepted-ingest state (S2.0c-AUTH
   closes v5 F4). No migrated timestamp has semantic effect.
3. **The handoff path enforces legacy-tombstone retention** (S2.0c-AUTH Q1): a role
   carrying a proofless legacy tombstone is pinned and does not clear its handoff until the
   locally derived retention window closes.
4. **Completion gates on authorization = a valid admission proof,** not on a receipt
   verifying under the kill signer.

## Standing from v5 (unchanged)

- **F1 — the transfer commitment is a real Merkle tree.** `descriptorLeaf(i) =
  H("axona/chunk/desc/v1" ‖ canonical(descriptor_i))`; `subBatchTreeRoot =
  merkleRoot([descriptorLeaf(0..n-1)])`; `transferRoot = H("axona/chunk/transfer/v1" ‖
  topicId ‖ policy ‖ epoch ‖ senderId ‖ subBatchCount ‖ totalLeafCount ‖
  totalTombstoneCount ‖ subBatchTreeRoot)`; `transferId = H("axona/chunk/transferid/v1" ‖
  transferRoot)`. Per-sub-batch and per-record Merkle inclusion proofs, golden-vectored.
- **F2 — the descriptors prove one exact, gap-free, non-overlapping partition** before any
  body releases, any high-water advances, or any `HANDOFFACK` issues.
- **The frozen-epoch liveness model, per-`batchId` completion oracle, bounded assembly
  buffers, and the ≤ 15 KiB routed-frame postcondition** (the binding budget, David seq
  720) all stand.

## The del record, v6

    delRecord = {
      signedKill:     { d: KILL_DOMAIN, topicId, msgId, ts, seq, signerPubkey, signature },
      admissionProof: { authorPubkey, rootNodeId, rootEpoch, cohortVersion,
                        cohortDescriptor,          // opens cohortDigest (AUTH v2 F1)
                        cohortCertChainSuffix,      // to a trusted anchor/checkpoint (F3)
                        attestations: [ { signerNodeId, signerPub, sig }, … ] }  // ≥ threshold, distinct
    }

`admissionProof` is exactly the object S2.0c-AUTH **v2** defines — a cohort quorum (≥ 2 of
the 3 `{root, replica, replica}` members) of `AXONA_ADMISSION_ATTEST_V1` signatures, plus
the carried `cohortDescriptor` that opens `cohortDigest` and the certificate-chain suffix
that proves *which* cohort admitted the record. It carries no body and no preimage, and no
`rootStamp`. The del leaf binds the whole canonical `delRecord`, so the kill and its
authorization proof are committed together and cannot be recombined across transfers.

## Verification before any effect

Before any durable effect (delete, suppress-then-release, fan-out, ack, high-water
advance), the receiver runs the S2.0c-AUTH **v2** verification in full: `verifyKill` valid;
≥ threshold distinct, same-`cohortVersion`, same-transcript attestations, each self-certifying
(`hashComponent(signerNodeId) == SHA-256(signerPub) & HASH_MASK`, AUTH v2 F4); the
`cohortDescriptor` opens `cohortDigest` and its cohort certificate **chains to a trusted
anchor** (AUTH v2 F3 — never live-routing reconstruction); `signedKill.signerPubkey ==
admissionProof.authorPubkey`; topic agreement with the authenticated `signedKill.topicId`;
the `(rootEpoch, cohortVersion)` not superseded by a certified higher version (E4) and the
incarnation not convicted (E3). Any failure **rejects the record and fails the batch.**
Below quorum, the record may be held locally but creates **no transferable authorization**,
and no handoff discards the only safe copy (#402 holds).

## Local ordering (no trusted migrated stamp)

Once a tombstone is authorized by its admission proof, all ordering and expiry are derived
locally from accepted-ingest state:

- **TTL origin** = the local accepted-ingest time under the absolute-ceiling `maxHoldMs`,
  never a migrated `killTs`.
- **Replay / high-water floor** advances only on transfer-level completion (F2), never on
  a migrated `rootSeq`.
- **App-visible delete order** follows local accepted order.

Untrusted migrated `killTs`/`rootSeq` (if any legacy record still carries them) update
none of `role.seq`, replay/high-water floors, TTL origin, cache ordering, or app-delivery
ordering. This is the v6 side of S2.0c-AUTH F4.

## Legacy-tombstone retention in the handoff path

S2.0c-AUTH Q1 requires legacy (proofless) tombstones to be retained, not authorized, until
a bounded local window closes. v6 enforces it in the frame/handoff mechanics:

- A role carrying any proofless legacy tombstone is **pinned**: its `HANDOFF` does not
  clear, and the leaver retains the role and state, until the last such tombstone ages out
  under the **locally derived** retention TTL (from the local activation checkpoint + max
  tombstone TTL — never a migrated timestamp).
- The retention window is **one fixed span ≤ max tombstone TTL**, closes automatically,
  and cannot be extended by any arriving chunk, descriptor, or peer metadata.
- A pinned role that cannot stay available for the window is an **operator availability
  failure**, surfaced as such — never a trigger to clear the handoff unauthorized.
- Proofless legacy tombstones are **never** minted into new admission proofs and never
  select an authorized branch; they only decay.

After the window, every tombstone in live state carries a quorum admission proof, and the
pin is released by ordinary completion.

## One record larger than the frame budget (v5 F4, unchanged)

    recordId = H("axona/chunk/record/v1" ‖ canonical(complete record))
    fragment = { transferId, subBatchIndex, globalLeafIndex, recordId,
                 fragIndex, fragCount, totalBytes, bytes }

Validate `fragCount`/`totalBytes` against `MAX_FRAGMENTS_PER_RECORD` / `MAX_RECORD_BYTES`
before allocation; reassembly keyed by `(authSenderId, transferId, subBatchIndex,
globalLeafIndex, recordId)`; conflicting duplicate fragments rejected; exact gap-free byte
reconstruction whose hash equals `recordId` **before** the leaf's Merkle proof is checked.
A del record whose admission proof pushes it over the budget fragments by this same
mechanism — the proof is part of the canonical record bytes, so it is Merkle-committed and
reassembly-verified like any other record content. The transfer-global tombstone gate (F2)
waits for complete reassembly **and** a valid admission proof for every del record.

## Completion, acceptance, handoff

Completion is transfer-global (F2): every leaf HELD or validly SUPPRESSED, zero unexplained
rejects, the whole-partition proof holds, **and every tombstone carries a valid quorum
admission proof.** High-water advancement and `HANDOFFACK{transferId, complete}` occur only
at verified transfer-level completion with authorization satisfied. A short or unauthorized
transfer can never ack; the leaver retries and finally cohort-sprays; the last-copy-drop
guard holds.

**Legacy tombstones are not an authorization branch (AUTH v2 F6).** A proofless legacy
tombstone never *completes* a transfer and its retention window closing never *authorizes*
it. It pins its role (above): handoff clearance for that role is permitted only after the
proofless tombstone has **actually expired and been removed** from live and outgoing state —
clearance depends on its **absence**, never on a timer. A proofless tombstone arriving after
the cutoff is **rejected**; it cannot reopen, extend, or pass through the closed window, and
it never selects an authorized branch.

## Test matrix — v5 mechanics plus the authorization split

Carries v5's cases (transfer-tree golden vectors; duplicate/overlapping/missing/relabeled
partitions cannot complete; fragment-count/length abuse and conflicting fragments fail
before allocation; cross-transfer fragment mixing rejected) and changes the authorization
cases to match the split:

1. A del record with a **valid quorum admission proof** completes and applies with **no
   body present**.
2. A del record whose admission proof is **below quorum, off-cohort, duplicate-signer,
   mixed-`cohortVersion`, stale-incarnation, or whose cohort certificate does not chain to
   a trusted anchor** fails the batch (delegated to the S2.0c-AUTH v2 checks; v6 asserts the
   batch fails and nothing releases).
3. **Proof stripping / omission fails closed** — the tombstone is rejected, the batch
   fails, and no legacy branch is selected.
4. A **proofless legacy tombstone** pins its role: the handoff does not clear, the leaver
   retains state, and the pin releases only once that tombstone has **expired and been
   removed** (absence) — never on a closing timer alone and never on arriving peer metadata.
5. A migrated `killTs`/`rootSeq` has **no effect** on `role.seq`, replay/high-water floors,
   TTL origin, cache ordering, or app-delivery ordering.
6. `HANDOFFACK` / high-water **remain blocked** until transfer-level completion *and*
   authorization hold; a **closed retention window is never an authorization branch**, and a
   post-cutoff proofless tombstone is rejected (AUTH v2 F6).
7. A pre-existing record larger than the chunk budget — including one enlarged by its
   admission proof — is fragmented and reassembled with no state loss, or blocks rollout.

## Status

Design v6 (F6-patched; proof shape retargeted to S2.0c-AUTH v2). No chunk-size constant, no
S2.0c clearance, no S2.1 authorization, no canary or deploy is implied. S2.0c clears only
when **both** this design and `REF-1.1-S2.0c-AUTH-Admission-Attestation-Design-v2.md` clear.
Submitted for review before any sync-engine code.
