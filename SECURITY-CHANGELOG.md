# Axona Security Changelog

A running, public record of security-relevant changes to the Axona protocol
kernel (`@axona/protocol`) and the applications that ride on it
(<https://axona.net>, the demo, the signaling bridge, and the simulator).

Axona is **self-authenticating**: every guarantee below is enforced by
cryptography the peers carry themselves. None of these fixes introduces — or
depends on — a certificate authority, a central trust server, or a
reputation/identity-management service. A node's identity is its own keypair;
the network verifies it directly.

Entries are newest-first and keyed to the kernel version in which the change
shipped. axona.net and the demo track the kernel version; the deployed build is
always visible in each app's version row and at the bridge's `/healthz`.

---

## Kernel v2.6.0 — 2026-05-30

### Mesh traffic is now cryptographically bound to its own connection

Direct peer-to-peer links (the WebRTC "mesh") are now bound to the actual
encrypted channel they run over. Each side folds its connection's DTLS
certificate fingerprint into the mutual identity proof, so the authentication
succeeds **only** when both peers are talking over the same end-to-end channel
they each negotiated.

**What this protects:** the signaling broker (bridge) relays connection setup
but is explicitly *untrusted* for the contents of peer traffic. This change
removes any path by which a broker positioned between two peers could
transparently interpose on a link that both peers believe is direct — the
identity proofs no longer verify if the channel has been split. The
untrusted-broker assumption that Axona's architecture rests on is now enforced,
not just intended.

**Design notes:** the binding **fails closed** — if a link can't establish the
channel binding it does not authenticate, rather than falling back to a weaker
mode. Whether to apply channel binding is a local decision each peer makes
about its own connection, so it cannot be downgraded by a remote party.

> **Operator note (flag-day):** because v2.6.0 peers bind their identity proofs
> to the channel and earlier peers do not, the two will not form *direct* mesh
> links with each other during a mixed-version window. Broker connectivity and
> relayed delivery are unaffected, and direct links re-form automatically once
> both ends are on v2.6.0. Reload all instances together to minimize the window.

---

## Kernel v2.5.0 — 2026-05-30

### Assurance: the authentication path is now independently testable, and the app surfaces routing truth

This release contains no behavior change to the protocol's guarantees; it
hardens our ability to *prove* they hold and to *notice* when they don't.

- The peer-to-peer authentication handshake was extracted into a standalone,
  directly testable unit, and covered by a new integration test that drives the
  real handshake across the same conditions production peers experience. A
  companion headless test harness stands up multiple real peers over real
  WebRTC against a real broker and asserts that every link is mutually
  authenticated end-to-end. (This harness is also able to *catch* the class of
  regression that motivated it — it fails loudly if authentication silently
  stops binding links.)
- Applications now expose **routing truth**: a health signal that distinguishes
  "connections are open" from "connections are *authenticated and routing*,"
  and flags the degraded state where channels exist but no authenticated
  routing is flowing. The reference app shows an authenticated-peer count
  directly in its status panel.

---

## Kernel v2.4.1 — 2026-05-30

### Mesh authentication now binds reliably

A correctness defect in the mesh handshake caused the two endpoints to derive
mismatched channel-binding values, so authenticated direct links frequently
failed to establish and traffic silently fell back to relayed paths. The
binding value is now derived identically on both sides, so authenticated
peer-to-peer links form as intended. (No weakening of the check was involved —
the check was simply never able to succeed; this restores it.)

---

## Kernel v2.4.0 — 2026-05-29

### Security hardening batch + exactly-once delivery

A set of fixes from a full post-handshake security review:

- **Signature verification tightened.** Removed a placeholder code path under
  which an unsigned, non-authentic publication could be accepted as if it had a
  valid signature. All publications now require a genuine signature to verify.
- **Subscription requests can no longer be aimed at a third party.** A peer may
  now only subscribe or unsubscribe *itself* — established by the
  cryptographically proven identity of the channel it's speaking on — closing a
  reflection/amplification vector where one peer could enroll a victim as the
  target of a feed.
- **Private keys can be made non-extractable.** Browser peers can hold their
  signing key in a form that cannot be read back out by page script, so a
  cross-site-scripting incident or a malicious dependency cannot exfiltrate a
  peer's long-term identity.
- **Key-consistency check on load.** Loading a stored identity now verifies the
  private key actually matches its public key (a sign-then-verify probe),
  catching a corrupted or swapped key at load time instead of silently
  producing unverifiable signatures later.
- **Exactly-once delivery to the application.** Reworked pub/sub delivery so a
  message is handed to the application exactly once, eliminating a bug where a
  periodic re-subscribe could re-deliver earlier messages on a timer.

---

## Kernel v2.2.0 – v2.3.0 — 2026-05-29

### Authenticated identity handshake (`axona/4`) — the foundation

The core upgrade the rest of this list builds on. Every peer's node identifier
is derived from its public key; the `axona/4` handshake makes a peer **prove**,
on every connection, that it possesses the private key for the identity it
claims:

- **Bind** — the presented public key must hash to the claimed node identifier.
- **Possess** — an Ed25519 signature demonstrates control of the matching
  private key.
- **Channel** — the signature is bound to the specific live connection, so a
  captured proof cannot be replayed onto a different link.

This shipped across all three transports (browser/WebRTC, Node, and the
in-process simulator) and through the bridge's embedded peer, with
cross-transport domain separation so a proof valid on one kind of link cannot be
replayed onto another. Together this closes node-identity spoofing and
impersonation: a peer can no longer claim an identifier it does not hold the key
for.

---

## Foundational properties (in place since the 1.0 line)

- **Key-derived identifiers.** A node's 264-bit identifier embeds the SHA-256 of
  its public key, so the identity space is not squat-able by name alone.
- **Signed publications.** Application messages are Ed25519-signed and carry a
  verifiable envelope; topic ownership is cryptographically checkable.
- **No central authority.** Bootstrapping uses a signaling broker for
  connection setup only; the broker is never a trust root for identity or
  message content.

---

## Scope and ongoing work

This changelog records resolved items. Axona's security review is an ongoing,
adversarial process — findings are tracked privately and hardened in batches,
and this document is updated as each ships. Responsible-disclosure reports are
welcome via the project maintainers.

*Last updated: 2026-05-31.*
