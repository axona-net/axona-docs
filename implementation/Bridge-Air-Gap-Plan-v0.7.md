# Bridge Air-Gap — Project Plan — v0.7 (normative correction to v0.6, B3 only)

**Status:** proposed; a SHORT normative correction under Aster CP 089b319b,
covering only the open B3 point: the own-entry bootstrap path and the
mechanical key correspondence. It adds to v0.6 §7.3.3 and replaces nothing
else. B1, B2, B4, B5 and B6 are retired at design-plan level.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Base:** v0.6 (sha256 952e0660…) on v0.5 (f0d5bcbe…) on v0.4 (cc9ea61a…) on
v0.3 (e7b23101…); v0.2 (3e8f8a9a…) and v0.1 (866b123f…); all frozen
**Companions:** council 089b319b, 6ac166c1; ops/STATE.md 2026-09-22

---

## 0. What this correction adds

| Point | Where |
|---|---|
| a bridge cannot attest its own URL, so its own entry had no accepted path | §7.3.5 own-entry rule, two positive paths, expressly limited |
| `nodeIdHex` is an identifier, not the key bytes | §7.3.6 key correspondence |
| D7 consequence and the recommended first scope | §9 D7 restated |

Nothing in v0.6 is superseded. No self-dial is introduced.

## 7.3.5 (new) The own-entry bootstrap rule

A bridge's own entry has two positive paths and no others.

Path A, a bridge ingests its own entry locally. When the bridge roots a copy,
its own entry is written into that copy by the local root without any
attestation, because the bridge holds the node key and the author key that
signed it. The validator step "attestation by a trusted verifier" is skipped
only for an entry whose `bridgeBinding.nodeIdHex` corresponds (§7.3.6) to the
bridge's own node key. No other entry takes this path.

Path B, a relay accepts its directly dialled bridge's own entry on the
relay's own evidence. A relay dialled one URL, `dialledUrl`, and received an
auth hello proving possession of one node key, `helloKey`, bound to that
channel. That pair is the relay's own verification of that URL, made by the
relay itself, and it stands in for a `urlAttestation` for exactly one case: a
directory PUB arriving over that same connection whose `bridgeBinding`
satisfies `canonical(bridgeBinding.url) === canonical(dialledUrl)` and whose
`nodeIdHex` corresponds (§7.3.6) to `helloKey`. Such a PUB is accepted as the
bridge's own entry with no `urlAttestation`. The rule is limited by
construction: it applies to one URL (the one this relay dialled), one key (the
one this relay verified), one connection (the dial itself), and it is never
carried into republication. A third-party entry republished by that bridge
still needs a `urlAttestation` under v0.6 §7.3.3, signed by that bridge for a
URL it dialled. Nothing here lets a bridge attest its own URL to anyone.

What is refused, unchanged: an entry whose binding names a URL the relay did
not dial; an entry from any connection other than the relay's own bridge dial
that lacks a trusted attestation; a self-signed binding with no attestation and
no matching dial; an attestation by a verifier other than the relay's own
bridge.

Tests, WP4:
- D13 positive, Path A: a bridge that roots a copy ingests its own entry;
  the copy serves it to a subscriber.
- D14 positive, Path B: a relay that dialled bridge X accepts X's own entry
  over that dial with no attestation; the relay's copy serves it.
- D15 negative: the same relay refuses, `signerUnbound`, an entry for X's URL
  arriving over a different connection; an entry naming a URL the relay did
  not dial; a self-signed binding for an unrelated URL; an attestation signed
  by a verifier that is not the relay's own bridge.
- D16 negative: bridge Y republishes X's entry to a relay that dialled Y; the
  relay refuses unless Y's attestation for X's URL is present and verifies
  (Y dialled X), proving Path B is not inherited by republication.

## 7.3.6 (new) Key correspondence, mechanically

`nodeIdHex` is a node identifier derived from the node's Ed25519 public key;
it is not the key bytes. Every object that carries `sigNode` also carries
`nodePubkeyHex`, the public key used to make that signature. The verifier:

1. checks `pubkeyMatchesNodeId(nodePubkeyBytes, nodeIdHex)` (handshake-auth.js
   :195, the same derivation the auth hello uses), refusing on mismatch;
2. verifies `sigNode` with `nodePubkeyBytes` over the canonical bytes;
3. then, and only then, compares `nodeIdHex` against the trusted source for
   the case at hand: the attestation's `nodeIdHex` (v0.6 §7.3.3), the relay's
   `helloKey` (§7.3.5 Path B), the bridge's own key (Path A), or the
   operator-provisioned binding (D7).

A payload-supplied public key is therefore usable only through step 1 and one
of the trusted sources in step 3; it never establishes trust by itself. The
same three steps apply to `urlAttestation`, with `verifierPubkeyHex` and
`verifierNodeIdHex`. `sigAuthor` is verified with `authorPubkeyHex`, which is
the author key as the entry's std/message signer already carries it.

## 9 (D7 restated)

D7 is now a choice between two complete branches, with Aster's recommendation
recorded and not selected here:

- D7-operator: explicit operator-provisioned `(url, nodeIdHex, nodePubkeyHex,
  authorPubkeyHex)` bindings on every bridge and relay; no attestation object,
  no dial-derived trust, no quarantine transitions except by provisioning.
  Deployment consequence: adding a bridge means provisioning its binding on
  every bridge and every relay fleet host before its entry is accepted
  anywhere. Aster CP recommends this as the finite first implementation.
- D7-attestation: v0.6 §7.3.3 attestations plus §7.3.5 own-entry paths plus
  §7.3.6 correspondence, with quarantine as v0.6 §7.3.4. Deployment
  consequence: a bridge's entry propagates to a relay only after that relay's
  own bridge has dialled the new bridge and attested it.

Either branch satisfies the B3 design as reviewed. The plan implements the one
David names.

## Everything else

Every line of v0.6, v0.5, v0.4 and v0.3 not named above stands as written.
