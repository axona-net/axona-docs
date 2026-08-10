# REF-1.1 S2.0c-AUTH — cohort-quorum admission attestation

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTH-DESIGN-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Status:** a **hard prerequisite** of S2.0c. S2.0c cannot clear or ship until this
  design clears. S2.1 blocked. Written to the council's recommended direction
  (Aster seq 749, Orion seq 751, David's confirmation) after David asked the council
  to recommend on the two open tombstone-authorization questions.
- **Companion:** `REF-1.1-S2.0c-Chunking-Protocol-Design-v6.md` carries the frame
  mechanics and consumes the attestation defined here. This doc owns the trust model.

## The question

When a full-state sync frame carries a tombstone to a fresh replica, what does that
replica check to know the delete was authorized — without keeping the deleted content
alive to prove it?

A tombstone deletes a message. The right to delete belongs to the message's author,
bound by `msgId = contentAddress(authorPubkey ‖ body)`. Once the body is gone there is
nothing left on the replica to recompute that address against. So the authorization has
to travel *with* the tombstone, as a proof the replica can verify against keys it
already trusts, carrying no message content.

## What does not work, and why

**A signature on the kill is not authorization.** `verifyKill` (kill.js) checks the
kill object's Ed25519 signature and explicitly leaves authorization to the caller. Any
key can sign a well-formed kill for any `msgId`. Signature validity proves the killer
holds *a* key, not *the author's* key for *this* message.

**An author-signed receipt over the msgId is self-attestation, not proof** (v5 F1, my
error, Aster seq 744). If the transferable proof is `sign_K({topicId, msgId})`, then any
key `K` can sign both that receipt and a kill for another author's `msgId`; both verify
under `K`, and a fresh replica has no way to tell `K` is not the author. The statement
"the publish path once verified `msgId == contentAddress(author, body)`" is true at
ingest but is *not evidence carried to a fresh replica* — a malicious migration sender
manufactures both objects after the fact. "A node must never mint a receipt it did not
author" is an implementation intention, not an invariant a receiver can check.

**A single root's signature relocates the forgery, it does not remove it** (Aster seq
749). If one root signs "I admitted `{msgId, authorPubkey}`", a malicious or compromised
root signs an arbitrary pairing and the forgery returns one layer down.

The fix has to give a fresh replica a proof that (a) some set of nodes each independently
confirmed `msgId == contentAddress(authorPubkey, body)` against the *real* body at ingest,
and (b) that set is not freely chosen by a single party.

## The attestation object

At ingest, the nodes that admit a message each sign a durable **admission attestation**
over a fixed-width transcript. This is a new signed object, in the shape of the existing
`AXONA_INGEST_ACK_PROOF_V1` transcript (ackProof.js) but with its own domain and its own
fields — reuse of the *construction discipline*, not of the INGESTACK frame (see
"Reuse", below).

    DOMAIN         ASCII "AXONA_ADMISSION_ATTEST_V1"   (fixed bytes, no NUL)
    u8(version)    0x01
    topicId        decoded bytes, canonical id width (33, as idHex emits)
    msgId          decoded bytes, 32 (SHA-256 content address)
    authorPubkey   32 bytes (Ed25519 — the publisher key that content-addresses msgId)
    u64(epoch)     the root incarnation epoch this admission belongs to
    rootNodeHash   decoded bytes, NODE_ID width — the incarnation's root seat
    cohortDigest   32 bytes — H over the epoch's ordered cohort node-hashes (below)
    signerPub      32 bytes — the signer's transport public key
    signerNodeHash decoded bytes, NODE_ID width — MUST equal H(signerPub) (self-cert)

    sig = Ed25519(signerTransportKey, transcript)

Every width is a fixed constant, so the transcript is a fixed-length byte string with no
parse ambiguity — the property ackProof.js relies on for its golden/rejection vectors,
carried here. `signerNodeHash == H(signerPub)` binds the signature to a self-certifying
node identity: a signer cannot claim a cohort seat it does not hold the key for.

A completed **admission proof** for one `msgId` is a set of these signatures — a quorum
of them (below) — plus the `authorPubkey` and the incarnation coordinates they all agree
on. It carries no body and no preimage.

## Cohort quorum, not one signature

The cohort for a topic at an incarnation is the root seat plus its replication
successors — the same `ROOT_REPLICAS = 2` nearest reachable neighbours the root already
replicates admitted state to (constants.js; E2 INGESTACKs come from exactly this set).
Root + 2 replicas = **three** cohort members. The quorum rule:

**An admission proof requires at least 2 of the 3 distinct cohort attestations,** each
signed by a distinct cohort member, each over the same `(topicId, msgId, authorPubkey,
epoch, rootNodeHash, cohortDigest)`, each issued only after that signer independently
verified the original envelope — its author signature and `msgId == contentAddress` —
at ingest (the B-4 check each of them already runs).

Quorum is what makes the proof mean more than one party's say-so. Forging an admission
proof now requires two distinct cohort members to sign a false pairing, not one.

**Where the quorum's strength actually rests — stated plainly.** Two-of-three only raises
the bar if the three seats are not all choosable by one attacker. They are constrained by
keyspace proximity: the cohort is the nodes *closest to the topicId*, and node identity is
`nodeHash = H(transportPub)`, self-certifying and not freely assignable. An attacker who
wants two cohort seats for a target topic must land two ground-out node identities in the
topic's neighbourhood. That is the address-grinding cost tracked as security item **E-1**
(open, out of scope here). So this design reduces tombstone forgery to *the same trust
basis as controlling a topic's roots in general* — grinding ≥2 keyspace-proximate seats —
and no lower. It does not claim to solve E-1. It removes the strictly weaker
"any single key" and "any single root" forgeries, which is the whole of what v5's receipt
and the single-root alternative failed to do. The residual is named, not hidden.

## Issuance

Admission attestations are minted at ingest, while the body is present and verified —
never reconstructed later from migrated state:

1. A publish reaches the topic's cohort. Each cohort member runs the ingest checks it
   already runs: author signature valid, `msgId == contentAddress(authorPubkey, body)`
   (B-4), topic binding correct.
2. On success, each member signs one `AXONA_ADMISSION_ATTEST_V1` transcript for
   `(topicId, msgId, authorPubkey)` at the current incarnation, and returns it toward
   the cohort so the completed proof can be assembled.
3. The completed proof (≥2 distinct member signatures) is stored **atomically with the
   accepted cache record** for that `msgId` (see "Storage"). A message present in the
   cache without a stored admission proof is a state error, handled fail-closed.

Issuance rides the existing ingest path; it does not add a round trip on the read or
write hot path beyond the signatures the cohort members compute locally. The proof is
minted once, at admission, and then only ever *carried* — never re-derived.

## Verification at a fresh replica

When a tombstone arrives carrying an admission proof, before any durable effect (delete,
suppress-then-release, fan-out, ack, high-water advance) the receiver checks, in order —
any failure rejects the record and fails the batch:

1. `verifyKill(signedKill)` — the kill signature is valid.
2. The proof carries ≥2 attestation signatures; each verifies under its own `signerPub`
   over the exact transcript; each `signerNodeHash == H(signerPub)`.
3. All attestations agree on `(topicId, msgId, authorPubkey, epoch, rootNodeHash,
   cohortDigest)`. `topicId` equals the authenticated `signedKill.topicId`.
4. `signedKill.signerPubkey == authorPubkey` — the killer is the attested author.
5. The signers are **distinct**, and each `signerNodeHash` is a member named by
   `cohortDigest` (the digest opens to the ordered cohort node-hashes; each signer's hash
   is one of them, and `rootNodeHash` is the root member).
6. The signers are keyspace-proximate to `topicId` — each `signerNodeHash` sits within the
   topic neighbourhood the receiver can verify (the strongest local check; see the open
   question).
7. The incarnation `(rootNodeHash, epoch)` is not **superseded** by a higher epoch the
   receiver already knows for this topic seat (E4 reconciliation ordering), and is not a
   tombstoned/convicted incarnation (E3).

The verifier **rejects**: fewer than quorum signatures; duplicate signers; a signer whose
node-hash is outside the epoch's cohort; mixed-epoch signatures; a stale or superseded
incarnation; a `signerNodeHash` that does not equal `H(signerPub)`; any transcript-field
disagreement across the signatures or with the kill.

## Below quorum

If fewer than a quorum of cohort attestations are reachable — a thin region, a partition,
a transient cohort — the record **may remain locally held or pending, but no transferable
tombstone authorization is created, and no handoff may discard the only safe copy of the
state.** A leaver that cannot assemble a quorum proof retains the role and its state
(the last-copy-drop guard, #402, still holds because "authorized" now means "quorum
proof present"). Missing proof never means authorized, and never selects a legacy branch
(see "Legacy transition"). This is a liveness cost paid to keep authorization honest: the
alternative — accepting an unbacked tombstone to make a handoff complete — is exactly the
forgery this design removes.

## rootStamp: derive ordering locally (closes v5 F4)

The admission attestation signs **admission**, not ordering. It does not carry `killTs`
or `rootSeq`, and a migrated `rootStamp` is treated as untrusted with no semantic effect.
After a tombstone is authorized by a quorum proof, the receiver derives everything ordering-
or expiry-related **locally, from its own accepted-ingest state**: the TTL origin, local
ordering, the replay/high-water floor, and app-visible delete order. Untrusted migrated
`killTs`/`rootSeq` must never update `role.seq`, a replay or high-water floor, a TTL origin,
cache ordering, or app-delivery ordering. This closes F4 with no new signed surface and no
expansion of the quorum receipt into a general root-stamping authority — which would
re-introduce exactly the trusted-single-writer problem quorum exists to remove.

## Legacy transition — time-bounded retention (Q1; David + council)

Messages admitted before this design ships have no admission proof. A body-absent,
proofless tombstone does not prove *when* its target was published — `killTs` is chosen by
the signer — so "proofless ⇒ pre-cutoff ⇒ authorized" would re-open the current arbitrary-
tombstone gap and could force post-cutoff targets through the legacy branch (Aster F2).
The transition therefore **never accepts a proofless tombstone as authorized.** Instead:

- A node establishes a **non-forgeable local activation checkpoint** from trusted local
  deployment state and monotonic time — never `killTs`, never peer-supplied metadata.
- Every role that carries a legacy (proofless) tombstone is **pinned/retained**. Its
  handoff does not clear until the last such tombstone has aged out under a **locally
  derived TTL** (the existing absolute-ceiling `maxHoldMs`, measured from the local
  checkpoint, not from any migrated timestamp).
- The transition is **one fixed window of at most the maximum tombstone TTL.** It closes
  automatically and cannot be extended by arriving peers or records.
- A pinned node that cannot stay available for that window is an **operator availability
  failure** requiring operator handling — it is never permission to downgrade deletion
  authorization.

After the window, no proofless tombstone exists in live state, and every tombstone in
circulation carries a quorum admission proof. The window is bounded, self-closing, and
introduces no authorization downgrade — so it is not a documented risk acceptance, it is
protocol behaviour. It gets a `SECURITY-CHANGELOG` entry when it ships, describing the
migrated-unsigned-tombstone gap it closes (topicStore.js `_activeDels` migrates unsigned
tombstones; `_applyDels`/`_applyKill` apply with no `verifyKill` today).

## Reuse — machinery, not the frame

Reuse the *primitives* the D1 ack-proof work already built and vectored, and the E1/E4
incarnation checks:

- transport-key Ed25519 signing over a fixed-width, domain-separated transcript;
- the reject-on-width, reject-on-domain, reject-on-purpose discipline (ackProof.js
  `hexToBytes` width checks; the load-bearing domain/version bytes);
- `rootPub`/transport-key ↔ node-hash binding (self-certifying identity);
- the root incarnation `(nodeId, epoch)` from E1, epoch supersession from E4, incarnation
  conviction from E3;
- golden-vector / rejection-vector discipline (ackProof.vectors.js) — an independent
  implementer must reproduce the exact admission-attestation bytes.

Do **not** reuse the INGESTACK frame itself as a durable admission receipt. It is
purpose-, attempt-, `ackTo`-, `flightNonce`-, and flight-bound; it carries no
`authorPubkey` and no cohort/quorum semantics; it is a live-flight correlation object, not
a long-lived transferable proof. Admission attestation is a **new purpose and transcript**
under a **new domain**, so a raw INGESTACK can never be replayed as an
`AXONA_ADMISSION_ATTEST_V1` (the signed bytes differ; the verifier recomputes a different
transcript and the signature fails — the same purpose-separation property R7 established).
INGESTACK's correlation properties are left intact.

## Storage, propagation, downgrade resistance

- The completed quorum proof is stored **atomically** with the accepted cache record for
  its `msgId`, and **propagated with every state copy** (REPLICATE, HANDOFF, REPLAYUP) —
  it is part of the record, chunked and Merkle-committed alongside it by the v6 frame
  mechanics.
- **Stripping or omission fails closed.** A record whose proof is missing or malformed is
  not treated as authorized and does not select the legacy branch. A tombstone whose proof
  a legacy hop dropped is rejected, not downgraded — and a valid creator kill for a
  post-cutoff message is never left permanently unverifiable, because the proof travels
  inside the Merkle-committed record and a hop that alters it breaks the commitment
  (v6 F1/F2) rather than silently degrading it.
- The cutoff marker and any capability negotiation are authenticated and bound to the
  stored record; an attacker cannot omit a proof to force legacy treatment (the window is
  gated on the local checkpoint, not on proof presence).

## One open question for the council

The verification rule 6 — "the signers are keyspace-proximate to `topicId`" — is the
point where a fresh replica needs to agree on *who the epoch's cohort was*. Two
constructions, and I want the council's call rather than a guess:

- **(i) Keyspace-proximity self-verification.** The receiver accepts a signer if its
  self-certifying `signerNodeHash` sits within the topic neighbourhood the receiver can
  compute from its own routing state, and `cohortDigest` opens to a set that is
  keyspace-consistent. No extra signed roster. Weakness: neighbourhood knowledge differs
  across nodes, so "within the cohort" is a local judgement; a receiver with a thin view
  may reject a valid proof (fails closed — safe but a liveness cost).
- **(ii) A signed cohort roster.** The root incarnation publishes a signed roster naming
  its cohort for the epoch, and `cohortDigest` commits to it. The receiver verifies the
  roster signature and cohort membership against it. Weakness: the roster is root-signed,
  so it must be constrained (the named members must themselves be keyspace-proximate and
  self-certifying) or a malicious root names sybils and the quorum collapses to (i)'s
  threat anyway — which argues (ii) buys agreement, not extra security, and only if the
  proximity constraint on roster members is enforced.

My inclination is **(i)** for the trust core (it adds no root-signed authority and fails
closed) with `cohortDigest` as an integrity binding over the ordered proximate set, and to
treat (ii) as an optional agreement aid layered on top only if operational
false-rejections under thin views prove to be a problem in the canary. Both reduce to the
E-1 grinding residual for their security; they differ only in how a receiver agrees on
membership. I will spec whichever the council directs in the next revision.

## Design test matrix

1. One malicious cohort member (or one malicious root) cannot produce a valid admission
   proof — a single signature never reaches quorum.
2. Two of three valid, same-epoch, same-transcript cohort attestations verify; a
   fresh replica with no body accepts the authorized delete.
3. Duplicate signers (same key twice) do not reach quorum.
4. An off-cohort signer (node-hash not in `cohortDigest` / not keyspace-proximate) is
   rejected even with a valid signature.
5. Mixed-epoch attestations fail; a stale or superseded incarnation (lower epoch, or E3-
   convicted) fails.
6. `signerNodeHash != H(signerPub)` is rejected before quorum counting.
7. A raw `AXONA_INGEST_ACK_PROOF_V1` frame cannot be replayed as an admission attestation
   (domain/transcript differ; signature fails).
8. Proof stripping or omission fails closed — the tombstone is rejected, never downgraded
   to legacy, and a valid post-cutoff creator kill is not left permanently unverifiable.
9. Below quorum: the leaver retains state; no handoff clears on an incomplete proof; no
   transferable authorization is minted.
10. The legacy retention window closes from the local checkpoint + max TTL only, and
    cannot be extended by any peer-supplied `killTs`/metadata.
11. A migrated `rootStamp` (`killTs`/`rootSeq`) has no effect on `role.seq`, replay/high-
    water floors, TTL origin, cache ordering, or app-delivery ordering.
12. Golden vectors: canonical admission-attestation bytes for a fixed
    `(topicId, msgId, authorPubkey, epoch, rootNodeHash, cohortDigest, signerPub)` an
    independent implementer must reproduce; matching rejection vectors for each failure
    above.

## Status

Design only. No admission-attestation code, no chunk-size clearance, no S2.0c clearance,
no S2.1 authorization, no canary, no deploy is implied or approved by this document. This
design is a hard prerequisite of S2.0c; S2.0c depends on its clearance and on the
companion v6 chunking design clearing. One question (cohort membership authority) is put
to the council. Submitted for review before any code.
