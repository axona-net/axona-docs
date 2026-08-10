# REF-1.1 S2.0c-AUTH — cohort-quorum admission attestation, v2

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTH-DESIGN-20260810-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Status:** hard prerequisite of S2.0c. S2.0c cannot clear until this design and the
  companion `REF-1.1-S2.0c-Chunking-Protocol-Design-v6.md` (F6 patched below) both
  clear. S2.1 blocked.
- **Supersedes:** `REF-1.1-S2.0c-AUTH-Admission-Attestation-Design.md` (v1, c0a9e42),
  reviewed **CHANGES REQUIRED** (`ASTER-COUNCIL-REF11-S20C-AUTH-REVIEW`, seq 755). v2
  resolves the six findings. The v1 direction stands — cohort quorum, new domain,
  no `authorReceipt`, no signed `rootStamp`, fail-closed legacy retention. What v1
  lacked, and v2 supplies, is the one thing that makes the quorum a *transferable*
  proof: **durable authenticated evidence of who the cohort was at admission.**

## The gap v1 missed

v1's proof carried `cohortDigest` but nothing that opens it, and named the cohort by
`(rootNodeHash, epoch)` — coordinates that do not identify a unique cohort, because the
repair plane changes the root's two replicas from live `findKClosest` results and prunes
`role.replicas` **without bumping any epoch** (F2). So a fresh replica could neither open
the digest (F1) nor know which of several same-epoch cohorts admitted the record (F2), and
neither of v1's open options proved *historical* membership (F3): current-routing-view
verification is not proof of who held the seats at admission. v2 designs the missing
history — a **versioned cohort-certificate chain** — and corrects the identity binding
(F4), the issuance/storage protocol (F5), and the legacy completion rule (F6).

## F4 first — the corrected identity binding (everything else depends on it)

Production `nodeId` is **33 bytes**: a 1-byte region prefix followed by a 32-byte hash
component, where the hash component is `SHA-256(transportPub)` masked to the keyspace
(`HASH_MASK`). `rootPubMatchesNodeHash` deliberately compares only that hash component,
because `H(pub)` can never equal the full region-prefixed id. v1's
`signerNodeHash == H(signerPub)` would reject every production identity.

v2:

- The field is `signerNodeId` (33 bytes), not `signerNodeHash`. Same for `rootNodeId`.
- The self-certifying check is: **`hashComponent(signerNodeId) == SHA-256(signerPub) &
  HASH_MASK`** — the exact rule `rootPubMatchesNodeHash` already uses.
- The **region prefix is validated for well-formedness but is not authenticated** by this
  proof; it is routing/placement metadata, self-asserted. The proximity policy (below)
  operates on the hash component's XOR-distance to `topicId`, which *is* bound to the key.
  If authenticated region placement is ever required, the proof must carry the extra
  region evidence to recompute it — called out as a bounded follow-on, out of this tranche,
  not silently assumed.
- Golden-vectored against a real 33-byte id and its transport pubkey.

## F1 — the cohort descriptor and its canonical digest

The proof carries the exact cohort **descriptor**; the digest is over that descriptor, so a
fresh replica can open it.

    member          = { nodeId (33B), transportPub (32B) }
    cohortDescriptor = { topicId, rootNodeId, rootEpoch, cohortVersion,
                         memberCount, members: [ member … ] }   // canonical order

Members are ordered canonically by the hash component's XOR-distance to `topicId`, tie-break
by full `nodeId` ascending. Nominal `memberCount = 3` (root + 2 replicas); a degraded
transition cohort may carry 2 (see F2). The digest binds count, widths, order, and the seat
coordinates:

    cohortDigest = SHA-256( "AXONA_COHORT_DESC_V1"
                            ‖ topicId ‖ rootNodeId ‖ u64(rootEpoch) ‖ u64(cohortVersion)
                            ‖ u8(memberCount)
                            ‖ for each member in canonical order: nodeId(33) ‖ transportPub(32) )

Every attestation signs `cohortDigest`. Golden/rejection vectors cover reordered,
duplicated, omitted, and substituted members, and a descriptor whose recomputed digest does
not match the one the attestations signed.

## F2 + F3 — the versioned cohort-certificate chain (the membership authority)

This is the piece v1 lacked. The kernel has no durable authenticated record of the replica
seats over time, so v2 defines one.

**cohortVersion.** A per-topic-seat `u64` that advances on **every** membership change —
any of the three seats changing — **independent of `rootEpoch`.** `rootEpoch` still advances
only on root incarnation change (E1/E4); a root change also forces a `cohortVersion` bump
because the root is a member. This closes F2: `(rootNodeId, rootEpoch, cohortVersion)` now
identifies a unique cohort.

**The certificate.**

    cohortCert = { cohortDescriptor,
                   prevCohortDigest,          // 0 for genesis
                   transition }               // threshold sigs by the PRIOR cohort

    transition = [ { signerNodeId, signerPub, sig } … ]   // >= threshold(prevMemberCount)
    sig        = Ed25519( signerTransportKey,
                          "AXONA_COHORT_TRANSITION_V1" ‖ prevCohortDigest ‖ cohortDigest )

Cohort version N's certificate references N-1's digest and carries a threshold of N-1's
members signing the N-1 → N transition. `threshold(3) = 2`, `threshold(2) = 2`. This makes
membership a **certificate chain** whose transitions are threshold-authorized by the prior
valid cohort — not by any single root (F3). A root-signed roster is at most an agreement
*hint*; it is never the membership authority.

**Proximity constraint on transitions.** Every member named in a new `cohortCert` must
satisfy the deterministic proximity policy relative to `topicId` — be among the keyspace-
closest under the policy. A transition naming a far or arbitrary member is rejected **even if
threshold-signed.** This is what stops a captured prior cohort from installing arbitrary
sybils: transitions can only appoint keyspace-legitimate successors. The residual — grinding
≥2 proximate seats — is E-1, unchanged and named.

**Genesis and the bootstrap rule.** The first cohort has `prevCohortDigest = 0` and empty
`transition`. It is accepted only under the **E-1 bootstrap assumption**: the genesis members
are trusted on the same basis as controlling a topic's roots at all — keyspace-proximate,
self-certifying identities whose capture costs address grinding. The doc states plainly that
genesis reduces to E-1; the chain adds no security below that floor, it adds *history above
it* so that post-genesis membership cannot be forged by a single party.

**Fresh verification consumes the chain, never live routing.** A verifier walks from a
trusted anchor — genesis under E-1, or a durable **local checkpoint** (a `cohortVersion` the
verifier has itself durably accepted) — forward via `prevCohortDigest` + threshold transition
signatures to the `cohortVersion` the admission attestation names. It never reconstructs
membership from its current routing view. This is the exact failure of both v1 options that
F3 identified.

**Supersession.** A higher `cohortVersion` supersedes a lower one **only if it chains from
it** (or from a common anchor). An uncertified higher version is not a valid supersession.
E3 incarnation conviction still rejects a convicted root seat.

**Churn, overlap, degradation.** Normal churn changes one seat at a time, so cohort N and
N+1 overlap in ≥2 members and N can threshold-sign the transition. Simultaneous loss of ≥2
prior members leaves no threshold available: the chain **cannot advance by transition**.
Recovery is via an authenticated checkpoint or re-bootstrap under E-1, at an explicit
availability cost — a seat that has lost its cohort quorum **cannot mint transferable
authorization** until re-anchored. This is the same posture as the below-quorum rule: retain
state, never fabricate authorization.

**Storage and propagation.** The `cohortCert` chain (a bounded suffix plus the verifier's
local checkpoint) is durable and propagates with topic state, chunked and Merkle-committed
by the v6 frame mechanics like the admission proof itself. A node treats its own durably-
accepted `cohortVersion` as a checkpoint, so it does not carry the chain to genesis forever;
old admission proofs stay verifiable because the chain back to a live checkpoint is retained.

## The admission attestation, v2

    DOMAIN          "AXONA_ADMISSION_ATTEST_V1"   (fixed bytes, no NUL)
    u8(version)     0x01
    topicId         33B (canonical id width)
    msgId           32B (SHA-256 content address)
    authorPubkey    32B
    u64(rootEpoch)
    rootNodeId      33B
    u64(cohortVersion)                              // NEW (F2)
    cohortDigest    32B                             // openable via carried descriptor (F1)
    signerNodeId    33B                             // renamed + corrected (F4)
    signerPub       32B
    sig = Ed25519(signerTransportKey, transcript)

    admissionProof = { authorPubkey, rootNodeId, rootEpoch, cohortVersion,
                       cohortDescriptor,            // opens cohortDigest
                       cohortCertChainSuffix,       // to a trusted anchor/checkpoint
                       attestations: [ … ] }        // >= threshold(memberCount) distinct

## Fresh-replica verification, v2 (in order; any failure rejects and fails the batch)

1. `verifyKill(signedKill)` valid.
2. Each attestation: signature valid under `signerPub` over the exact transcript;
   `hashComponent(signerNodeId) == SHA-256(signerPub) & HASH_MASK` (F4); region prefix
   well-formed.
3. All attestations agree on `{topicId, msgId, authorPubkey, rootEpoch, rootNodeId,
   cohortVersion, cohortDigest}`; `topicId == signedKill.topicId`.
4. `signedKill.signerPubkey == authorPubkey`.
5. `cohortDescriptor` recomputes to `cohortDigest` (F1); signers are **distinct** members
   of the descriptor; `rootNodeId` is the descriptor's root member.
6. **Membership authority (F3):** the descriptor's `cohortCert` chains via
   `prevCohortDigest` + prior-cohort threshold transition signatures — each named member
   proximity-valid — back to a trusted anchor (genesis under E-1 or a durable local
   checkpoint). No live-routing reconstruction.
7. The `(rootEpoch, cohortVersion)` is not superseded by a higher **certified**
   `cohortVersion` the receiver holds for this seat; the root incarnation is not E3-convicted.
8. At least `threshold(memberCount)` distinct valid attestations (nominal 2-of-3).

Rejects: below threshold; duplicate signers; a signer not in the descriptor; a descriptor
that does not chain to a trusted anchor; a proximity-invalid member anywhere in the chain;
mixed `cohortVersion`/`rootEpoch` across attestations; a digest mismatch; an F4 identity
mismatch.

## F5 — the pending-admission protocol

A 2-of-3 proof cannot be committed atomically with the record until ≥2 members have received
and verified the body and their attestations are collected; cohort replication is
asynchronous. v2 defines the intermediate state:

- **accepted-pending.** On a publish reaching the cohort, each member independently verifies
  the body (author signature + `msgId == contentAddress`) and emits its **admission
  attestation** toward an **assembler** — the root by default, or a defined replica successor
  if the root is among the unreachable. The record is `accepted-pending` locally: it may warm
  the local cache, but it is **not transferable-accepted state**, and **no publish
  confirmation implies transferable authorization**, until the completed proof is durably
  committed.
- **Assembly.** The assembler collects ≥2 distinct attestations, builds the `admissionProof`,
  and commits it **atomically** with the accepted record. Only then does the record become
  transferable-accepted.
- **Frames / no extra round trip.** The member's "verified + here is my attestation" carries
  on the existing E2 INGESTACK reply path (piggyback), so no new round trip beyond the
  signatures — but the attestation is a **separate durable object**, never the flight-bound
  INGESTACK frame (a raw INGESTACK still cannot be replayed as an `ADMISSION_ATTEST_V1`; the
  domains differ).
- **Idempotence / retries.** Attestations are content-addressed by their transcript;
  duplicates dedup. A member re-sends its attestation on the standing anti-entropy tick until
  the assembler confirms a durable commit.
- **Crash recovery.** If the assembler crashes before the durable commit, the record stays
  `accepted-pending` (never transferable); a successor assembler re-collects. If fewer than
  two attestations survive, the record cannot become transferable — retained locally, never
  fabricated.
- **Root change mid-assembly.** A pending proof under `cohortVersion` N completes if ≥2 of N's
  members' attestations are durable; otherwise it restarts under N+1, whose cohort re-verifies
  and re-attests. Attestations bind `cohortVersion`, so N and N+1 attestations never mix.

## rootStamp — local ordering (unchanged from v1, closes v5 F4)

The attestation signs admission, not ordering. No `killTs`/`rootSeq` is signed or trusted.
After a tombstone is authorized, TTL origin, local ordering, replay/high-water floor, and
app-visible delete order are derived locally from accepted-ingest state. Untrusted migrated
stamps touch none of `role.seq`, floors, TTL origin, cache ordering, or app-delivery ordering.

## Legacy transition — retention, and F6

Unchanged in intent from v1: never accept a proofless tombstone as authorized; pin roles
carrying legacy tombstones until a locally derived window (local activation checkpoint + max
tombstone TTL, never `killTs`) closes; one fixed self-closing window; a pinned node that
cannot stay available is an operator failure, not a downgrade.

**F6 correction (also patched in v6):** closing the window is **not** authorization. Handoff
clearance for a role carrying legacy tombstones is permitted only after every such tombstone
has **actually expired and been removed** from live and outgoing state — clearance depends on
their **absence**, never on a timer as authorization. A proofless tombstone arriving after the
cutoff is **rejected**; it cannot reopen, extend, or pass through the closed window.

## Reuse — unchanged discipline

Reuse the ackProof fixed-width, domain-separated, reject-on-width/domain transcript
discipline; the transport-key↔node-id-hash binding (`rootPubMatchesNodeHash`, corrected per
F4); E1 root incarnation, E3 conviction, E4 epoch supersession; golden/rejection-vector
discipline. Define new domains — `AXONA_ADMISSION_ATTEST_V1`, `AXONA_COHORT_DESC_V1`,
`AXONA_COHORT_TRANSITION_V1` — so no INGESTACK or ack-proof frame can be replayed as any of
them. Do not weaken INGESTACK correlation.

## Design test matrix, v2

1. One malicious cohort member (or one malicious root) cannot produce a valid proof —
   a single signature never reaches threshold.
2. Two of three valid, same-`cohortVersion`, same-transcript attestations verify at a fresh
   replica with no body.
3. `cohortDigest` opening: reordered / duplicated / omitted / substituted members fail;
   a descriptor whose recomputed digest differs from the signed one fails (F1).
4. **Same-`{rootNodeId, rootEpoch}` cohort churn:** two distinct cohorts under one root epoch
   are distinguished by `cohortVersion`; a proof from cohort A does not verify as cohort B (F2).
5. **Historical verification after churn:** a proof from an earlier `cohortVersion` still
   verifies via the certificate chain to a trusted anchor, without any live-routing check (F3).
6. **Thin-view rejection:** a proof whose chain does not reach a trusted anchor fails closed;
   a permissive current-topology acceptance is absent (F3).
7. **Forged root-only roster:** a cohort transition signed by the root alone (below threshold,
   or naming proximity-invalid members) fails (F3).
8. **Certificate-chain supersession:** an uncertified higher `cohortVersion` does not supersede;
   a certified one does.
9. **Corrected identity (F4):** a real 33-byte `signerNodeId` whose hash component equals
   `SHA-256(signerPub) & HASH_MASK` verifies; a literal `H(pub) == nodeId` check is absent;
   a mismatched hash component fails.
10. **Pending admission (F5):** no body becomes transferable-accepted and no publish
    confirmation implies authorization before ≥2 attestations are durably committed; assembler
    crash and mid-assembly root change recover without fabricating authorization.
11. **Post-cutoff proofless arrival (F6):** rejected; cannot reopen/extend/pass the closed
    window; legacy clearance depends on absence, not timer.
12. A raw `AXONA_INGEST_ACK_PROOF_V1` frame cannot be replayed as any V2 domain object.
13. Migrated `killTs`/`rootSeq` has no semantic ordering, TTL, replay-floor, or app-delivery
    effect.
14. Golden vectors: canonical `AXONA_ADMISSION_ATTEST_V1`, `AXONA_COHORT_DESC_V1`, and
    `AXONA_COHORT_TRANSITION_V1` bytes for fixed inputs; rejection vectors for each failure.

## Open note for the council (not a blocker to review)

The cohort-certificate chain adds a per-topic-seat membership log the kernel does not have
today. Its transition cost is bounded (one threshold-signed cert per membership change, chain
truncated at local checkpoints), but it interacts with **#397** (root reconciliation reach is
`rootReplicas = 2`, so a second root beyond the cohort is permanent) and with E4 epoch
supersession. If the council would rather the membership-history layer be its own reviewed
sub-design (as S2.0c-AUTH was split from v6), I will split it; I have kept it inline because
the attestation is not a transferable proof without it. Flagging the choice rather than
assuming it.

## Status

Design only. No admission-attestation code, no chunk-size clearance, no S2.0c clearance, no
S2.1 authorization, no canary, no deploy. Hard prerequisite of S2.0c; depends on its own
clearance and the v6 chunking clearance. Submitted for review before any code.
