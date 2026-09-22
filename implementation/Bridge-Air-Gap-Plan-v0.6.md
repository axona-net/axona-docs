# Bridge Air-Gap — Project Plan — v0.6 (normative correction to v0.5)

**Status:** proposed; a SHORT normative correction under Aster CP e8b544f1,
covering only the open B3 and B5 points. It replaces exactly the lines named in
§0 and leaves every other line of v0.5, v0.4 and v0.3 in force. B1, B2, B4 and
B6 are retired at design-plan level and are not reopened.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Base:** v0.5 (sha256 f0d5bcbe…) on v0.4 (cc9ea61a…) on v0.3 (e7b23101…);
v0.2 (3e8f8a9a…) and v0.1 (866b123f…); all frozen and unmodified
**Companions:** council e8b544f1, 7c8b790d; ops/STATE.md 2026-09-22

---

## 0. What this correction supersedes

| Inherited line | Status | Replaced by |
|---|---|---|
| v0.5 §7.2.7 relay rule, "a node key already present in a directory entry the relay holds whose chain began with its own bridge" | superseded | §7.3.3 below (the attestation object, or D7) |
| v0.5 §7.3.2 "URL ownership by the receiver's own outbound dial … on an inbound uplink … until such a dial exists on the normal uplink cadence" | superseded in part | §7.3.4 below (quarantine; no dial-eligibility from a claim) |
| v0.5 §9 D8 "a per-connection undecoded-bytes-per-second cap applied before decode" as an aggregate bound | superseded | §7.2.4 D8 restated below |
| v0.5 WP4 O6 "`oversizeCloses` counts server-side close events with code 1009" | superseded | O6 restated below |
| v0.5 WP4 O6 "the partition's denominator is decoded frames"; v0.4 §7.2.2 step 0 `closedOversize` as an ingress outcome | superseded | §7.2.2 denominator restated below |

Everything else stands.

## 7.3.3 (new) Trust evidence for a URL, and who may assert it

A dual-signed `bridgeBinding` proves that an author key and a node key agree on
a URL. It proves nothing about whether anyone verified that the node answers at
that URL. That verification is a separate object with a separate signer.

`urlAttestation = { url, nodeIdHex, verifiedTs, verifierNodeIdHex, sigVerifier }`.
`sigVerifier` is the Ed25519 signature of the VERIFIER's node key over the
canonical bytes of `{url, nodeIdHex, verifiedTs}`. A bridge may sign one only
for a URL it dialled itself, on its existing uplink policy, and whose auth
hello it verified with the node key `nodeIdHex` (§7.3.2 channel binding).
`verifiedTs` is the time of that hello and is valid under the same
`[now − MAX_AGE, now + SKEW_MAX]` window. Depth is ONE: an attestation is
never re-signed or forwarded as evidence by a bridge that did not perform the
dial; a bridge that receives one and wishes to assert the URL must dial it and
sign its own.

The validator at a relay root: a directory PUB for a named topic is accepted
only if the payload carries a `bridgeBinding` that verifies AND a
`urlAttestation` for the same `url` and `nodeIdHex` whose `verifierNodeIdHex`
is the node key of the bridge the relay itself dialled, verified against that
key as the relay received it in its own auth hello. That key is the relay's
one trust root, and it comes from the relay's own channel binding, not from any
directory content. A PUB carrying only a self-signed binding, or an attestation
by any other verifier, is refused `signerUnbound` and counted. Expiry is the
window; revocation is the operator unpin on the verifying bridge, after which
that bridge signs no new attestations for the URL and existing ones age out
within `MAX_AGE`.

At a bridge that roots a copy, the same validator applies with the bridge's
own node key as the verifier, that is, the bridge accepts into its own copy
only URLs it has itself dialled and attested, or operator-provisioned ones.

The alternative remains D7: explicit operator-provisioned
`(url, nodeIdHex, authorPubkeyHex)` bindings on every bridge and relay, with no
attestation object and no dial-derived trust. Neither is selected here.

Canonical URL matching, for every comparison above: scheme must be `wss`;
host is lowercased ASCII, IDNA hosts refused; the port is made explicit (443
when absent); no path, query, fragment or trailing slash is permitted; two
URLs match only when their canonical strings are byte-equal.

## 7.3.4 (replaces the inbound-uplink paragraph of v0.5 §7.3.2) Quarantine

A URL claimed in a `bridgeBinding` or in an entry received on an INBOUND
uplink, or in any entry not yet attested, is held in a quarantine set. The
quarantine set is not an input to discovery, to the book's dial-candidate
ranking, or to uplink policy. No dial is ever initiated because a claim was
received. The only URLs the uplink policy may dial are the operator seeds and
book entries that were themselves accepted under §7.3.3 (attested by a trusted
verifier or operator-provisioned). A quarantined claim leaves quarantine only
when an attestation from a trusted verifier arrives for it, or the operator
provisions it. Until then it is served to nobody and republished nowhere.

## 7.2.4 (D8 restated) The aggregate bound

A per-connection undecoded-bytes-per-second cap is a per-connection bound. It
becomes a bridge-wide bound only together with a bound on the number of
connections, and no such bound is proposed here. D8 is therefore two separate
choices for David, neither made here: (a) a per-connection pre-decode byte cap,
labelled as per-connection; (b) a separately approved global inbound budget
(a bridge-wide frames-per-second or bytes-per-second ceiling with
drop-and-count), which is the only thing that bounds the aggregate. With
neither, L2 and L3 remain the stated measurements and the plan claims no
aggregate bound.

## 7.2.2 (denominator restated) What the partition counts

The partition's denominator is application messages delivered to the decoder,
INCLUDING those the decoder rejects. `droppedInvalid` is inside the partition.
Transport-level rejections, where no message reaches the decoder, are outside
the partition and are reported beside it under their own labels (§O6). v0.4's
step 0 `closedOversize` is withdrawn as an ingress outcome; v0.4's O1 reads
"buckets sum to messages delivered to the decoder".

## WP4 O6 (restated) Oversize and close accounting

Two labels, never merged:

- `oversizeLocal`: counted from the local `ws` error event whose code is
  `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH` (the receiver's own max-payload
  rejection), per connection. This is the only event that proves a local size
  rejection.
- `close1009`: counted from the close event with code 1009, per connection,
  as a neutral label, because a remote peer can send that code.

O6 tests both sources: a frame over the cap sent by the harness must produce
one `oversizeLocal` and one `close1009` on that connection; a peer-sent close
frame with code 1009 must produce one `close1009` and zero `oversizeLocal`.
Both are transport rejection events outside the §7.2.2 partition.

## Everything else

Every other line of v0.5, v0.4 and v0.3 stands as written. D1–D8 remain
David's, with D8 now the two choices of §7.2.4 and D7 the alternative to
§7.3.3.
