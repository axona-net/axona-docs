# REF-1.1 S2.0c — full-state chunking protocol design, v4

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-CHUNKDESIGN-20260810-04`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy. S2.0c held, S2.1 blocked.
- **Supersedes:** `...-Design-v3.md` (f9ccd47), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V3-REVIEW-20260810-07`, "materially closer"). v4 resolves
  the five v3 findings. v3's content-digest Merkle commitment, self-verifying chunks,
  capability-negotiated handoff, and frozen epoch stand; v4 changes tombstone
  authorization, the sub-batch commitment, oversized-record handling, the del schema,
  and the disclosure record.

## Tombstone authorization needs an author→msgId proof, not just a signature (F1)

`verifyKill` (kill.js) checks only the kill object's signature and explicitly leaves
authorization to the caller; the right to delete is "proven by the same keypair that
proved authorship." Authorship is bound by `msgId = contentAddress(publisher ‖
message)`. So a valid kill signature by *any* key does not prove that key authored the
target, and once the body is tombstoned there is nothing left to recompute the address
against — v3's provisional quarantine had no evidence to resolve.

v4: the transferable del record carries an **author→msgId proof** — the original signed
envelope preimage sufficient to recompute `msgId` and confirm `publisher ==
kill.signerPubkey` — or an explicitly trusted authorization receipt. The proof rides
*in* the del record, so it is available even when the body is absent from cache.
**Signature validity alone never promotes a quarantined tombstone to accepted.** An
oversized preimage is fragmented by the F3 mechanism.

## The del record is one canonical schema, validated before any effect (F4)

    delRecord = {
      signedKill:  { d: KILL_DOMAIN, topicId, msgId, ts, seq, signerPubkey, signature },
      authorProof: <original signed envelope preimage that recomputes msgId>,
      rootStamp:   { killTs, rootSeq }          // root-assigned ordering the migration consumes
    }

Before any durable effect (delete, suppress-then-release, fan-out, ack) the receiver
verifies, in order:

1. `verifyKill(signedKill)` — signature valid;
2. `contentAddress(authorProof) === signedKill.msgId` — the proof names this message;
3. `authorProof.publisher === signedKill.signerPubkey` — the killer is the author;
4. `signedKill.topicId === enclosing topicId` — topic agreement across signedKill,
   rootStamp, and the transfer context.

Any disagreement **rejects the record and fails the batch**. The del leaf (v3-F5) binds
the whole canonical `delRecord`, so `rootStamp` ordering and `signedKill` authorization
are committed together and cannot be recombined across transfers.

## The transfer is one committed object across sub-batches (F2)

    transferRoot = H("axona/chunk/transfer/v1" ‖ topicId ‖ policy ‖ epoch ‖ senderId ‖
                     subBatchCount ‖ totalLeafCount ‖ totalTombstoneCount ‖
                     ordered subBatchRoots)
    transferId   = H("axona/chunk/transferid/v1" ‖ senderId ‖ topicId ‖ policy ‖ epoch ‖
                     transferRoot)

Every chunk carries `{ transferId, subBatchRoot, subBatchIndex, subBatchCount }` and a
Merkle inclusion proof of its `subBatchRoot` under `transferRoot`, in addition to its
v3 per-record proof under `subBatchRoot`. A sub-batch from another transfer, or claiming
a wrong index, fails the inclusion check and is rejected — no mixed-transfer completion.

The tombstone prerequisite is **transfer-global**: no message body in *any* sub-batch is
released, fanned out, or delivered until **every** tombstone-bearing sub-batch of the
transfer is complete *and* every one of its tombstones is authorized (F1/F4).
High-water advancement and `HANDOFFACK{transferId, complete}` occur **only at verified
transfer-level completion** — never at sub-batch completion.

## One record larger than the frame budget is fragmented (F3)

A chunk carries whole records; but historical cache entries admitted under earlier
256 KiB / 96 KiB limits can each exceed the 15 KiB routed budget, and reducing
records-per-chunk cannot shrink a single record. New-ingress rejection does not touch
already-cached state.

v4 defines **bounded byte-fragmentation with authenticated reassembly** for one record:

- a record whose canonical bytes exceed `CHUNK_PAYLOAD_BUDGET` is split into ordered
  fragments `{ recordId, fragIndex, fragCount, bytes }`, each in its own ≤ 15 KiB frame;
- the **leaf digest is over the whole reassembled record**, not a fragment, so a leaf is
  verified against `subBatchRoot` **only after** reassembly;
- the reassembly buffer is bounded (per-record byte cap = the largest legal historical
  record; global reassembly bytes bounded); overflow **fails the batch**, never
  partial-delivers.

This also carries an oversized F1 author-preimage. Fragmentation is required because a
drain-only rollout cannot preserve already-cached oversized state through a safe handoff.

## Disclosure record, corrected (F5 — my error)

v4 corrects the v3 doc: the current-path tombstone-authorization gap (`_activeDels`
migrates unsigned tombstones; `_applyDels`/`_applyKill` apply them with no `verifyKill`)
was **already disclosed to the council** in the submission itself — the affected path and
failure mode are stated there. It is therefore recorded as **disclosed to the council**,
not held. The no-code / no-deploy hold stands, and the remediation is prioritized (it
ships with the tranche and gets a `SECURITY-CHANGELOG` entry). No public issue is opened
ahead of the fix, but the item is not mischaracterized as secret.

## Test matrix — v3 set plus Aster's additions

Carries v3's cases and adds:

1. A **signed kill by a non-author** targeting another author's `msgId` stays
   quarantined / rejected **even when the original body is absent**.
2. Transfer-level proof **rejects a sub-batch from another transfer or at another index**.
3. **No body sub-batch releases** before every transfer-level tombstone sub-batch is
   complete and authorized.
4. `HANDOFFACK` / high-water **remain blocked until every sub-batch completes**.
5. One **pre-existing record larger than the chunk payload budget** is safely fragmented
   and reassembled, or blocks rollout, with **no state loss**.
6. The canonical del schema **rejects a signed-proof / root-stamp disagreement** (topic
   or msgId mismatch across `signedKill` / `authorProof` / `rootStamp`).

## Status

Design v4. No chunk-size constant, no S2.0c clearance, no S2.1 authorization, no canary
or deploy is implied. Submitted for review before any sync-engine code.
