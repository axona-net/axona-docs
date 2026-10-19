# Axona Topic-Derived Encryption

**Version 0.1 — 2026-08-12**
**Status: design proposal for review**

---

## 0. Summary

Axona messages are signed but not encrypted. Any node that relays a message can read it. This document specifies a symmetric encryption layer in which the encryption key is derived from the **topic string** itself.

The property that makes this work: the topic string is already the thing a subscriber must know in order to participate, and it is already the thing an intermediary does *not* need to know in order to route. Routing uses the topic ID, which is a one-way function of the topic string. So the topic string is a shared secret that every legitimate participant already holds and no carrier requires.

The scheme adds no coordination, no key exchange, no key server, and no state. It does not change the wire protocol: the encrypted envelope occupies the payload field, and signing proceeds exactly as it does today.

**What it buys:** an intermediary can no longer passively read, index, or archive the content it relays. Reading becomes an active act requiring a specific guess at a specific topic string, rather than a free byproduct of carrying traffic.

**What it does not buy:** confidentiality against anyone who knows or can guess the topic string. This is by design. For a topic with many subscribers, the topic string is effectively public and the encryption protects nothing an adversary could not obtain by simply subscribing — which is the correct outcome, because nothing was promised there.

---

## 1. Design constraints

These are the constraints the scheme was built against. They are stated first because several of the sharper decisions below only make sense in their light.

1. **Zero coordination.** A subscriber who knows the topic string must be able to decrypt with no handshake, no negotiation, and no contact with any other party. This is the property that makes the scheme deployable across a pub/sub network with no session concept.
2. **Zero stored state.** A publisher must be able to encrypt correctly after a reboot, a restore from backup, or a cold start on a new device, with no persisted counters or ratchets.
3. **No wire protocol change.** The construction must fit inside the existing payload field. Signing, routing, and topic ID derivation are untouched.
4. **Idempotent derivation.** The same topic string must produce the same key on every implementation, on every platform, forever. This forces the salt to be a fixed constant and forces an explicit answer on string normalization (§6.1).
5. **Security scales with topic entropy.** A low-entropy topic name gets little confidentiality, and needs little. A high-entropy topic name gets strong confidentiality. The same mechanism serves both; the user selects their position on that spectrum purely by how they name the topic.

---

## 2. The core construction

### 2.1 Two independent derivations from one secret

The topic string `T` is the root secret. Two values are derived from it, with strict domain separation:

- The **topic ID** — public, appears on the wire, used for routing. *Derived exactly as it is today. This specification does not change it.*
- The **content key** — never appears on the wire, used for encryption.

The critical requirement is that observing the topic ID must reveal nothing about the content key. Because the existing topic ID derivation is a one-way hash of `T`, and because the content key derivation below uses HMAC-based extraction with a distinct domain label, this holds: an adversary in possession of the topic ID has no path to the content key short of recovering `T` itself.

> **Do not derive the content key by hashing the topic ID.** The topic ID is public. Any key derived from it is public. The derivation must root in `T`.

> **Do not derive the content key by plain concatenation into a bare hash** (`SHA-256(T || label)`). Merkle–Damgård constructions are vulnerable to length extension. Use HKDF, which is HMAC-based and does not have this weakness.

### 2.2 Key schedule

```
T          = topic string, normalized per §6.1, encoded UTF-8
SALT       = "axona/topic-encryption/v1"          (fixed ASCII constant)

PRK        = HKDF-Extract(salt = SALT, ikm = T)

K_content  = HKDF-Expand(PRK, info = "axona/content-key/v1",  L = 32)
K_nonce    = HKDF-Expand(PRK, info = "axona/nonce-key/v1",    L = 32)
```

HKDF is instantiated with SHA-256.

The salt is a fixed protocol constant rather than a random value. This is a deliberate concession to constraint 1: a random salt would have to be transmitted and agreed, which reintroduces coordination. The fixed salt provides domain separation between Axona and any other system that might derive keys from the same string, which is the property actually needed here. It provides no protection against precomputation, and none is claimed — see §5.2.

`K_nonce` is separated from `K_content` so that the nonce derivation cannot be used as an oracle against the content key.

### 2.3 Cipher

**XChaCha20-Poly1305**, an authenticated cipher with a 192-bit nonce.

Chosen for three reasons: it is authenticated, so an intermediary cannot tamper with ciphertext undetected even though it cannot read it; it has no timing-sensitive table lookups, so it is safe to implement in software on any platform without hardware AES; and its 192-bit nonce is large enough that a derived nonce (§2.4) has negligible collision probability, which a 96-bit nonce would not.

### 2.4 Nonce: synthetic, with a randomized input

This is the one design decision made on the author's behalf and it should be reviewed explicitly.

An authenticated cipher requires a unique nonce per message under a given key. Catastrophic nonce reuse — the same key and nonce encrypting two different plaintexts — breaks confidentiality outright, not merely for those two messages. Constraint 2 says we cannot maintain a counter. That leaves a random nonce, which fails if the random number generator is weak, uninitialized at boot, or duplicated by a cloned VM or restored snapshot.

The construction here is a synthetic-IV approach that degrades gracefully in exactly that failure case:

```
plaintext_envelope = random_16_bytes || application_payload
N = HMAC-SHA-256(K_nonce, plaintext_envelope) truncated to leftmost 24 bytes
```

The 16 random bytes are prepended to the plaintext before the nonce is computed, so the nonce is a function of the message *and* fresh randomness. The behavior:

- **When the RNG is healthy** — every message has a distinct random prefix, so every message has a distinct nonce, and identical payloads produce different ciphertexts. Full semantic security.
- **When the RNG fails entirely** — the nonce still varies with message content, so distinct messages still get distinct nonces and the key is not compromised. The only leak is that two byte-identical publications produce identical ciphertext, revealing that a repeat occurred. This is a disclosure of equality, not of content, and it is a very large improvement over the key compromise that a fixed or repeated random nonce would cause.

The 16 random bytes are stripped and discarded on decryption.

### 2.5 Associated data

The following are passed as AEAD associated data — authenticated but not encrypted — so that an intermediary cannot move a valid ciphertext to a different topic or a different envelope position and have it still verify:

```
AAD = version_byte || topic_id || <existing envelope header fields>
```

The exact header field set should be fixed during implementation against the current wire structure. At minimum it must include the topic ID.

### 2.6 Wire format

The encrypted envelope replaces the payload field. Nothing outside the payload changes.

| Field | Size | Notes |
|---|---|---|
| `version` | 1 byte | `0x01` for this specification |
| `nonce` | 24 bytes | as derived in §2.4; not secret |
| `ciphertext` | variable | encrypted `plaintext_envelope` |
| `tag` | 16 bytes | Poly1305 authentication tag |

Signing is unchanged: the message is signed as it is today, over the envelope as constructed. The signature therefore covers the ciphertext, which is correct — it attests that a given author published a given opaque blob to a given topic, and that attestation remains verifiable by any node without any ability to read the content.

### 2.7 Decryption

```
1. Read version. Reject unknown versions.
2. Derive PRK, K_content, K_nonce from the known topic string.
3. Decrypt and verify with K_content, the nonce from the envelope, and the AAD.
4. Recompute N from the recovered plaintext_envelope and K_nonce.
   Reject the message if it does not match the nonce on the wire.
5. Strip the leading 16 bytes. The remainder is the application payload.
```

Step 4 is not optional. Without it, the synthetic nonce is merely decorative — an attacker could supply an arbitrary nonce. Verifying that the nonce is the correct function of the recovered plaintext is what binds the construction together.

---

## 3. What this changes operationally

### 3.1 The topic string becomes a secret

This is the most consequential downstream implication and it reaches well beyond the crypto.

Today a topic string is a routing input. Under this scheme it is also a decryption key. Every place a topic string is currently handled casually becomes a key-handling site:

- Topic strings must not be written to logs, telemetry, crash dumps, or analytics.
- Topic strings must not appear in URLs, query strings, or anywhere they might be captured by an intermediary or a browser history.
- Topic strings at rest on a device warrant the same storage protection as a private key.
- Any UI that displays a topic string is displaying a credential, and should be designed accordingly.
- The QR-code out-of-band exchange pattern already in use for Axona applications is the right delivery mechanism and its role becomes more important, not less.

### 3.2 Components that read content must know the topic string

Anything that today inspects payloads must now hold the topic string to continue working. This includes indexers, search services, moderation tooling, archival services, and bots. Under this design each of those becomes an ordinary subscriber that must be given the topic string like any other participant — which is architecturally correct and consistent with the pub/sub model, but it is a change and it should be enumerated before rollout rather than discovered during it.

Pure transport components — relays, bridges routing on topic ID — are unaffected. They never needed the payload.

### 3.3 Naming convention for private topics

Because entropy in the topic string *is* the security level, private topics should be named from a cryptographic random source, not chosen by a human. A recommended form is 128 or more bits of randomness rendered in a case-insensitive alphabet.

A human-readable label should be carried as **application metadata separate from the topic string**, so that people can identify a channel in their interface without the label weakening the derivation. A topic named `project-falcon-internal` is a topic an adversary will guess.

### 3.4 Revocation is a naming operation

There is no key rotation and no forward secrecy in this design, by decision. Removing a participant's access is performed socially rather than cryptographically: mint a new high-entropy topic string, distribute it to everyone who should retain access, and stop publishing to the old topic.

A useful pattern for continuity: publish a final message to the old topic containing the new topic string. Everyone still subscribed — including the removed party — receives it, so this is appropriate only for succession where the departing participant is not adversarial. For genuine exclusion, the new topic string must be delivered out of band to each retained member.

---

## 4. Threat model

### 4.1 What this defends against

**Passive bulk reading by carriers.** The primary goal. A relay handling large volumes of traffic cannot read, index, or retain the content of what it forwards. Surveillance of the network's content becomes an active, targeted, per-topic effort rather than an automatic byproduct of participation in transport.

**Opportunistic content harvesting.** An operator who casually logs payloads gets nothing usable.

**Tampering in transit.** The AEAD tag means an intermediary cannot alter ciphertext undetected, independently of the existing signature.

**Compelled disclosure by a relay operator.** A relay operator ordered to produce message content cannot comply, because they do not hold the topic strings and never did. This is the same structural argument as the location–identity separation: the material was never collected.

### 4.2 What this does not defend against

**Anyone who knows the topic string.** Explicitly out of scope. Knowledge of the topic is the access boundary, and it is the same boundary that governs subscription.

**Guessing a low-entropy topic string.** An adversary can test a dictionary of candidate topic strings against observed ciphertext, and a successful decryption confirms the guess. This costs the adversary work proportional to the guess space. It also gains them nothing they could not have obtained by subscribing to the guessed topic directly, which is the reason it is acceptable.

**Metadata analysis.** This is the most significant residual exposure and it should be understood clearly. Encryption hides payload content. It does not hide:

- the topic ID a message was published to
- the message size
- the timing and frequency of publication

An intermediary can therefore observe that a particular topic ID carries traffic of a characteristic size on a characteristic schedule, and can fingerprint and track a topic's activity pattern without reading a single word. Where this matters, padding messages to fixed size buckets and introducing timing jitter are the standard mitigations, and both are application-layer choices this specification deliberately leaves open.

**Replay.** An intermediary can retain and re-inject a previously valid signed message. Encryption does not change this, and it is a pre-existing property of the protocol rather than something introduced here. Applications requiring replay resistance should include a sequence number or timestamp inside the encrypted payload and reject stale or duplicate values.

**Compromise of a subscriber.** Any subscriber holds the permanent key and can disclose all past and future content on that topic. There is no forward secrecy and no post-compromise recovery.

---

## 5. Rejected alternatives

Recorded so the reasoning is not relitigated later.

### 5.1 Key rotation and forward secrecy

Rejected. Rotation requires that every participant learn the new key, which reintroduces the key distribution and coordination problem the scheme exists to avoid. It would convert a stateless derivation into a synchronized protocol with membership tracking. The benefit — revocation and forward secrecy — is obtained more cheaply and more simply by minting a new topic string (§3.4). The problem being solved does not require the cryptographic form of revocation.

### 5.2 Random per-topic salt

Rejected. A random salt cannot be reproduced by an uncoordinated subscriber, so it would have to be transmitted, which reintroduces coordination and provides an adversary the salt anyway. A fixed constant salt provides the domain separation actually needed. Precomputation resistance is not claimed and is not required, because a successful precomputation attack yields only what subscription would have yielded.

### 5.3 Memory-hard key derivation (Argon2, scrypt)

Considered and set aside for v1, but worth revisiting. A memory-hard KDF would raise the cost of dictionary attacks against low-entropy topic names by orders of magnitude. The arguments against including it now: it does not change the outcome for the topics that matter — a guessed public topic yields nothing an adversary could not subscribe to — and it imposes a per-derivation cost on every participant that is difficult to calibrate across the range of devices Axona targets, from phones to constrained always-on nodes. The recommendation is to keep HKDF for v1 and treat a memory-hard variant as a candidate for a future version byte, applied selectively to topics that declare themselves low-entropy.

### 5.4 Asymmetric encryption

Rejected as a mismatch. Public-key encryption addresses the problem of encrypting to a specific recipient. Axona has no recipients — it has topics and subscribers, and the publisher does not and should not learn who is subscribed. Symmetric encryption under a topic-derived key is the construction that matches the pub/sub shape. The existing ed25519 signing already covers the authentication half of the problem.

---

## 6. Open items for implementation

### 6.1 Topic string normalization

**This must be settled before any implementation ships, and it is the single most likely source of silent interoperability failure.**

The key is derived from the bytes of the topic string. Any two implementations that disagree on those bytes will derive different keys and fail to communicate, with a failure mode — authentication tag mismatch — that looks like corruption rather than like a normalization bug.

Required decisions:

- **Unicode normalization form.** NFC is the standard recommendation. It must be mandatory and applied before derivation.
- **Case sensitivity.** If topic strings are case-insensitive anywhere in the system, they must be case-folded before derivation, using a specified folding algorithm.
- **Whitespace and control characters.** Trimming and rejection rules must be explicit.
- **Encoding.** UTF-8, stated normatively.

Whatever is chosen must match the normalization already applied in the existing topic ID derivation, or the two will diverge and a subscriber will route correctly while failing to decrypt.

### 6.2 Version negotiation and mixed traffic

The version byte allows future changes to the construction, but a policy is needed for the transition period during which some publishers encrypt and some do not. A per-topic declaration seems preferable to per-message detection, but this is unspecified here. There is also a downgrade concern worth thinking through: a subscriber that accepts both cleartext and encrypted messages on the same topic can be fed cleartext by an adversary.

### 6.3 Associated data field set

§2.5 specifies the topic ID as mandatory AAD content. The full set should be fixed against the current envelope structure, with attention to which header fields an adversary could otherwise usefully alter.

### 6.4 Padding policy

Whether to specify a standard padding scheme at this layer, or leave message-size concealment entirely to applications. Leaving it open is defensible, but if size fingerprinting turns out to matter in practice, a standard bucketed padding scheme is far easier to adopt if it was anticipated in the format.

### 6.5 Test vectors

A published set of test vectors — topic string, derived key, nonce, plaintext, ciphertext — is required for this to be implementable independently. Given §6.1, the vectors should deliberately include topic strings that exercise normalization edge cases.
