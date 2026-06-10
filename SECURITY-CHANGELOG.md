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

## Kernel v2.33.0 — 2026-06-09  *(in production 2026-06-10)*

### Pub/sub abuse hardening — metrics can't be turned into a reflector, and a retraction is now complete

Wire-compatible with v2.32.0 (no envelope/identity change).

- **Metrics responses go only to the proven requester.** A topic-metrics reply
  is now delivered solely to the cryptographically authenticated channel peer
  that asked — never to an address named in the request payload. A request can
  therefore no longer be turned into a reflection/amplification toward a chosen
  victim, and the redundant tree-wide broadcast that multiplied it is removed.
- **Metrics ownership fails closed.** When a root cannot establish a topic's
  owner (empty replay cache), the owner-sensitive subscriber count is withheld
  rather than disclosed.
- **A retraction removes every copy.** `kill` now drops all cached copies of a
  message's content, not just the first — identical re-gossiped content can no
  longer survive its own retraction.
- **Anonymous publishes can't dodge the flood cap.** Unsigned publishes share a
  single per-publisher quota bucket on open topics, so omitting a signature no
  longer bypasses the per-publisher limit.

## Kernel v2.28.0 — 2026-06-06

### A node authenticates only within its own network; an active publisher's replay protection no longer weakens under load; dropped-message logging is now observable

- **Network isolation by construction.** A node forms an authenticated channel
  only with peers that share its network's protocol epoch. The epoch is folded
  into the value each side signs at connect time, so a peer running a
  separately-deployed, incompatible build of the protocol cannot complete the
  mutual handshake with a current node — at the mesh layer or at the bridge.
  Two networks on different epochs are therefore cryptographically separate:
  no peer in one can be talked, relayed, or cached into an authenticated
  relationship with a peer in the other. The wire-format major is also carried
  in the connection request so the signaling bridge can decline an incompatible
  peer cleanly, with an explicit "please upgrade," instead of admitting it to
  fail silently later.

- **Replay protection holds under load.** Each node tracks a per-publisher
  freshness watermark that rejects a captured message replayed from earlier in
  that publisher's stream. The bounded store that holds those watermarks now
  keeps the *most recently active* publishers, so a continuously-active
  publisher's watermark is retained even while the node is tracking many
  publishers — closing a window where an attacker could have forced an active
  publisher's record out of the cache and then replayed an old message of
  theirs.

- **Silent security drops are now observable.** When a node rejects a hostile or
  malformed message (a bad signature, a stale or oversized publish, an
  unauthorized retraction), that decision is now surfaced through the
  application's logging hook instead of being discarded, so an operator can see
  what a node is refusing and why.

All three are covered by new regression tests, including a test that a
cross-epoch handshake is refused even when the epoch tag is forged to match (the
signature still fails), and a test that an active publisher survives a flood of
others without losing its replay protection.

---

## Kernel v2.23.0 — 2026-06-05

### Published message IDs are now verified content addresses; relay setup is rate-bounded; a failed handshake can't strand a peer

A pre-deployment hardening pass (an adversarial whole-system review, deliberately
broadened beyond the connection layer) produced three protections:

- **Message-ID integrity.** A published message's identifier — the key used to
  fetch it (`pull`) and to retract it (`kill`) — is now verified to be the true
  hash of the message's content at the point a node accepts it. A message whose
  advertised ID does not match its content is rejected, so a published ID
  reliably resolves to exactly the content it names and cannot be made
  unretractable or used to shadow another message's ID. Honest publishers are
  unaffected (their ID already is the content hash).

- **Connection-setup backpressure.** A node now caps how many direct connections
  it will be negotiating at once, so a peer that floods it with introductions to
  many fabricated identities cannot drive unbounded connection-setup work. The
  cap frees itself as negotiations complete or time out, and normal nodes operate
  far below it.

- **Handshake liveness.** A direct-channel authentication that fails partway
  (an identity mismatch, or a transient error while admitting the peer) is now
  always cleanly retryable, so a peer can never be left permanently
  authenticated-but-unusable by a one-off failure.

All three are covered by new regression tests, including a deterministic test for
the handshake-liveness case. None changes the wire format.

---

## Kernel v2.22.0 — 2026-06-05

### A connection that never finishes negotiating can no longer strand a peer

A direct connection that fails to establish — ICE never completes across a hard
NAT, no TURN path, the far side goes away mid-handshake — used to leave the
half-formed peer recorded indefinitely with no live channel and nothing to clean
it up (the health checks that retire dead links only run on connections that
actually opened). As with the v2.21.0 case, a peer left in that state was treated
as "already connecting," so the node would never try again — it could stay
unable to reach that peer directly until a restart.

Now every connection attempt is given a bounded window to succeed; if it hasn't
opened in time it is fully retired, so the node cleanly tries again later
(bridge-free) the next time it encounters that peer. This also caps a
previously-unbounded reconnect retry loop. The result: no peer can get
permanently stuck "half-connected," which is the failure mode that only appears
once a network is large enough to have peers behind difficult NATs.

This was found by a dedicated pre-deployment stability review specifically
looking for more failure modes of this class (a deliberately adversarial pass,
since each prior review had surfaced one). It is the same liveness-hardening
family as v2.21.0 and is covered by a new regression test.

---

## Kernel v2.21.0 — 2026-06-05

### A dropped direct channel always heals — no peer can wedge unreachable

A peer whose direct `RTCPeerConnection` reached the terminal `closed` state out
from under it (the far side closing, or an abrupt network drop) was left
recorded as a known peer with no live channel. Because the peer was still
"known," the self-healing reconnect path treated it as already-in-progress and
**never re-established the connection** — so a peer that dropped this particular
way could become permanently unreachable directly, falling back to multi-hop
relaying through others indefinitely.

Now a channel that closes out from under us is fully released, so the node
**re-forms the direct connection on its own** (bridge-free, via a freshly
relayed handshake through the existing mesh) the next time it sees that peer.
This closes a liveness gap that would otherwise surface only once a deployed
network experienced real churn at scale. The complementary `failed`-state
recovery path is unchanged. Guarded by a dedicated regression test.

This shipped alongside the at-scale verification that the network forms direct,
authenticated peer-to-peer connections **without the signaling bridge** — over
genuinely multi-hop relayed signalling (origin and target sharing no common
neighbour, so a single relay is impossible), with the bridge process killed, and
with the routing substrate that carries the signalling measured at 10,000 nodes
(99.5% delivery, 100% reachability). The bridge remains only the optional
cold-start rendezvous for a node's very first edge.

---

## Kernel v2.20.0 — 2026-06-05

### Bridgeless connection is now the default and self-driving; a dropped peer rejoins routing

The network no longer depends on the signaling bridge to form new direct
connections in steady state — and it now does so on its own:

- **On by default.** Peer-relayed signaling (`meshRelay`) is enabled by default.
  The bridge bootstrap path is byte-for-byte unchanged (it signals by ephemeral
  connection id, never a node id, so the relay never intercepts it); the bridge
  remains only the cold-start rendezvous for a node's very first edge.
- **Autonomous.** When a node learns of a peer it has no channel to (peer-driven
  discovery), it forms the new direct WebRTC edge by relaying the signaling
  through the existing mesh — no bridge involved. The resulting channel is still
  authenticated end-to-end (`axona/4` + DTLS-fingerprint binding), so a relaying
  peer can carry the signaling but cannot impersonate an endpoint or read the
  channel.
- **A peer that drops and reconnects rejoins the routing table.** A fan-out
  dedup made the "peer bound" notification fire only once per peer for the
  lifetime of a subscription, so a peer that left and came back (churn, or a
  bridgeless reconnect) could end up connected-but-unrouted — silently absent
  from the routing table. The notification is now re-armed when a peer departs,
  so a returning peer is re-admitted and is reachable again.

Verified end-to-end over real WebRTC with the **bridge process killed**: a node
autonomously forms an authenticated direct channel to a peer introduced purely
peer-to-peer, and re-admits it to its routing table — with no bridge in
existence. Removing the bridge as a hard dependency for new connections
eliminates a single point of dependency in the network's liveness.

---

## Kernel v2.19.0 — 2026-06-05

### Routing tables drop a dead peer immediately; bridgeless connect verified end-to-end

Two routing-integrity fixes, surfaced by an end-to-end verification of
bridgeless connection (a node forming a new authenticated direct channel to a
peer with the signaling bridge **process killed**):

- **A dead peer is evicted from the routing table the moment its channel
  dies.** Previously a peer was only ever *admitted*; a dropped peer — most
  importantly the bridge after it goes down — lingered in every node's
  synaptome until lazy cleanup, and greedy routing could keep selecting that
  dead, address-space-near peer as a next hop. Routing now evicts on the
  transport's authenticated peer-death signal, so the table reflects only live,
  bound channels. This both makes **bridgeless peer-relayed connection work
  when it matters most** (right after the central bridge drops) and shortens
  the window in which a departed or non-responsive peer can sit in a routing
  path.

- **Routed forwarding only ever hands a message to a directly-connected
  neighbour.** A fallback path could forward toward a peer two hops away as if
  it were adjacent; it now forwards to the verified first hop. This keeps
  multi-hop delivery (including relayed WebRTC signaling) from dead-ending one
  hop short.

The security properties of a relayed connection are unchanged and were
re-confirmed end-to-end over real WebRTC with the bridge dead: the channel is
authenticated by `axona/4` + DTLS-fingerprint binding regardless of who relayed
the SDP, so a relaying peer can carry the signaling but cannot impersonate an
endpoint or read the resulting channel. Removing the bridge as a hard
dependency for new connections eliminates a single point of dependency in the
network's liveness.

---

## Kernel v2.17.0 — 2026-06-04

### Bridgeless connection (peer-relayed signaling) stays authenticated end-to-end

A new, **capability-flagged** path lets two peers negotiate a fresh direct
WebRTC channel by relaying the WebRTC signaling (SDP offer/answer + ICE)
*through an existing peer* — a routed `mesh:signal` carried over the mesh —
instead of through the signaling bridge. This removes the bridge as a
single point of dependency for forming new connections. The security property
that makes it safe:

- **A relay can carry the signaling but cannot impersonate either endpoint or
  read the resulting channel.** The channel the signaling bootstraps is still
  authenticated end-to-end by the `axona/4` handshake (each side proves its
  pubkey hashes to its nodeId suffix) **and** bound to the actual DTLS
  certificate fingerprints (finding A-1). A relaying peer that rewrote the SDP
  to insert its own certificate would produce divergent fingerprints, so the
  mutual signature fails and no channel binds. The relay therefore sees the same
  metadata the bridge already sees (who is connecting to whom) and **nothing
  more** — it can drop or delay a negotiation, never man-in-the-middle it.
- **No new signed-object type, no weaker check.** The signaling payload is
  opaque to relays and needs no signature of its own precisely because the
  connection it bootstraps authenticates itself; a forged or tampered
  `mesh:signal` can at worst fail to produce a valid channel, never produce an
  unauthenticated one. Inbound `mesh:signal` reuses the existing size/rate caps.
- **Off by default.** The path ships behind a `meshRelay` capability flag; with
  it disabled the connection behaviour is byte-for-byte the bridge-only path.
  Validated across three layers before shipping — topology, real kernel routing,
  and a headless real-WebRTC harness (A↔C formed through B with the bridge
  closed; fingerprints cross-match; `axona/4` binds end-to-end).

---

## Kernel v2.16.0 — 2026-06-03

### Keep-alive (`touch`) authority follows topic ownership

The keep-alive that lets a message's hold-time be refreshed (`touch`) is gated
by **topic ownership**, matching the access model already used for `unpub` and
owned-topic metrics — not message authorship:

- **Open topics** (ownerless — a public topic, or a synthetic region-keyed
  anchor `prefix‖0^256`): **anyone** may keep a message alive. These topics
  have no owner, so the keep-alive is a shared, public capability — appropriate
  for community feeds and regional rooms.
- **Owned topics** (anchored at a real identity): **only the owner** may. The
  touch must be signed by the key whose `sha256(pubkey)` is the owner nodeId's
  256-bit suffix (the same pubkey↔nodeId bind `unpub` enforces; no registry, no
  gatekeeper).

In every case a `touch` can only **extend** a message's life up to its absolute
48 h ceiling — never beyond it — so neither an owner nor an open-topic
participant can pin a message indefinitely.

---

## Kernel v2.15.0 — 2026-06-03

### Retraction now reliably removes a message everywhere

The creator-only retraction (`kill`, kernel v2.10.0) is strengthened so that
retracting a message **reliably removes it across the topic's relays and keeps
it removed**:

- **No surviving copies.** A relay that acquired a message through the replay
  path (the history a node receives when it subscribes) now retains the content
  hash that retraction matches on. Previously such a copy wasn't matchable, so
  it could linger on that relay and be re-served to later subscribers after the
  author had retracted the message. A retraction now reaches those copies too.
- **No resurrection.** The replay path now honors the retraction tombstone, so
  a lagging relay replaying its older history can no longer re-introduce a
  message the author already retracted.

This keeps the original guarantee honest: retraction remains **best-effort
redaction, not a cryptographic un-send** (a reader who already received a
message can keep it, and anonymous/unsigned messages have no provable creator
and so can't be retracted) — but within the network a retracted message is now
consistently dropped rather than able to reappear. Self-authenticating as
before: the authority to retract is the same keypair that signed the message,
with no registry or central gatekeeper.

> Also in this kernel: a **keep-alive** (`touch`) lets a message's hold-time
> expiry be reset — bounded by the same absolute ceiling a read already
> respects — without re-publishing. Its authorization model is refined in
> v2.16.0 (above).

---

## Kernel v2.10.0 — 2026-05-31

### Message lifecycle you control — retract, remove, and bounded retention

The pub/sub layer gained owner/creator-controlled lifecycle operations and
bounded retention. Each new authority is **self-authenticating** — proven by
the same keypair that proved authorship/ownership, with no registry or central
gatekeeper:

- **Retract a message (creator-only).** A publisher can retract a message it
  sent; the topic's hosting nodes accept the retraction only if it's signed by
  the **same key that signed the original message**, drop it, and forward a
  delete marker to current subscribers so they can clear their local copy. A
  short-lived tombstone stops a lagging node from re-circulating it. (It is
  best-effort redaction, not a cryptographic un-send — a reader who already
  received a message can keep it — and an anonymous/unsigned message has no
  provable creator and so can't be retracted.)
- **Remove a topic's queue (owner-only).** The topic owner — the identity whose
  key the topic id is derived from — can clear, or fully destroy, the topic's
  message queue. Ownership is verified two ways at once: the signer's key must
  bind to the claimed owner id, and that id must derive the topic id. No one
  else can clear another's topic.
- **Anti-flood quota on open topics.** On open (anyone-may-publish) topics, a
  single publisher can occupy only a bounded fraction of the message queue, so
  one party can't flush everyone else's messages out. Owner-gated topics are
  governed by their publisher rules instead.
- **Bounded retention + hold time.** Every topic holds a bounded number of
  messages with deterministic, replica-consistent eviction, and each message
  has a hold time with a hard ceiling (default 24 h, max 48 h) after which it
  expires and is swept — so nothing is retained indefinitely, and a read can
  extend a message's life only up to that ceiling.

All of the above is **additive and interoperable** — older peers simply don't
honor the new control messages — so it shipped without a flag-day. It builds
on the v2.9.0 signed sequence/timestamp: eviction order, "latest", and hold-
time are all anchored to fields under the publisher's signature.

---

## Kernel v2.9.0 — 2026-05-31

### A captured message can't be replayed back into the feed (envelope freshness)

Every signed pub/sub message now carries, *under its signature*, a freshness
window and a per-publisher sequence number — so a message a node legitimately
sent can't be **captured and re-injected later** as if it were live:

- **Freshness window.** A signed message's timestamp is now covered by the
  signature, and the topic's hosting nodes reject a live publish whose signed
  timestamp is outside a bounded window of the present. A recorded message
  therefore stops being accepted as "new" once it ages out — an attacker can no
  longer rebroadcast last week's signed message to people who subscribe today.
  Crucially, the check is on the *signed* timestamp, not the unsigned routing
  metadata a replayer would control. (This is distinct from the legitimate
  *replay-to-late-subscribers* feature, where a topic's own hosting node serves
  its cached history to a peer that just subscribed — that path is unchanged.)
- **Per-publisher sequence.** Each publisher stamps a monotonically increasing
  number under the signature, seeded from the wall clock so it keeps climbing
  across restarts. A hosting node tracks how far each publisher has advanced and
  rejects a message that tries to rewind well behind that point — i.e. a replay
  from earlier in the publisher's own stream — while still tolerating benign
  network reordering of genuinely live messages. This also gives every topic a
  deterministic ordering, the foundation for "give me the latest" semantics.
- **Explicit domain separation on signatures.** The data a publisher signs is
  now tagged with an explicit, versioned context label, so a signature produced
  for a pub/sub message can never be lifted and presented as a valid signature
  in a different part of the protocol, and there is no delimiter ambiguity in
  what was signed.

Together these close the message-replay gap that signing alone didn't cover:
before, a signature proved *who wrote* a message but not *when* or *in what
order*, so a valid old message stayed valid forever. This is a coordinated
upgrade — the freshness and sequence fields are mandatory, so all peers, the
bridge, and the demo move to v2.9.0 together — but it changes only what nodes
*verify*, not any stored data.

---

## Kernel v2.8.0 — 2026-05-31

### A peer earns its place in the routing table — gossip can't poison it (eclipse prevention)

Hardening of how a node builds and maintains its routing table, to resist an
**eclipse attack** (an adversary surrounding a node so it can only talk through
attacker-controlled hops):

- **Routing entries now require first-party verification.** A peer named in a
  routing-gossip message (a "you should know this node" hint) is treated only as
  a *candidate*. On the production transports it becomes an actual routing entry
  only after this node has itself connected to it and completed the `axona/4`
  identity handshake — so a peer that can't prove the identity it claims is never
  admitted, and forged gossip can't inject hops into the table. Candidate
  verification is budget-limited so a flood of hints can't induce a connection
  storm.
- **Reinforcement can't pin an unverified entry.** A "this route was useful"
  signal now only applies to an entry whose peer is currently identity-bound,
  so it can't be used to keep a stale or unverified entry artificially alive in
  the table.
- **Neighbourhood disclosure is bounded.** A query for "who do you know" returns
  a small, capped sample rather than the node's whole neighbour set, so an
  attacker can't cheaply map the topology to plan a surrounding.

This is the routing-layer complement to the v2.6.0 channel binding: that stops a
broker interposing on a link; this stops an adversary capturing which links a
node has at all. As before, it's local enforcement — fully interoperable with
earlier peers (no flag-day) — and applies on the identity-binding transports;
the in-process simulator keeps its prior behavior. Eclipse resistance in any
open, permissionless network is a matter of raising cost, not a binary: this
turns "forge a gossip message" into "run, identity-verify, and sustain real
well-positioned nodes," which is a dramatically higher bar. (The buildup cost of
verified admission was measured first — a ~2 s join-time warm-up traded for
flat steady-state latency, no failure tail, and ~5× less connection load — and
pairs with staggered bootstrap so the join experience doesn't regress.)

---

## Kernel v2.7.0 — 2026-05-31

### Pub/sub trust boundary: a peer can only act for itself, and only where it belongs

A batch of hardening to the publish/subscribe layer so that membership and
message flow can't be driven by a peer on behalf of others, and so that
resource use is bounded by what a peer can legitimately request:

- **Subscriptions can only ever be made for the requesting peer.** Across
  *every* path — including multi-hop routed subscribe/unsubscribe, not just
  the direct one — a node now enrolls (or removes) only the cryptographically
  authenticated peer that delivered the request. A peer can no longer name a
  third party as the subscriber, closing a reflection/amplification vector
  where one peer could aim a topic's feed (and its catch-up backlog) at a
  victim.
- **A node only hosts topics it's actually responsible for.** Becoming a
  relay point for a topic now requires being among the nodes closest to that
  topic's address. A flood of messages for arbitrary topics can no longer make
  uninvolved nodes allocate per-topic state, closing a memory-exhaustion vector
  that could crash browser peers.
- **Forged-signature messages are rejected at the entry point.** A signed
  message whose signature doesn't verify is now dropped where it first enters
  the relay tree, before it is cached or forwarded — so spoofed-signature spam
  can't be amplified outward before the edge rejects it. (Anonymous/unsigned
  messages are unaffected.)
- **Canonical encoding is now total and standards-aligned.** The byte encoding
  underlying every signature and content hash always emits valid JSON with a
  stable key order and matches what the wire produces, eliminating a class of
  signer/verifier mismatches and signature-collision hazards. No change for any
  message that verified before.
- **Inbound payloads are bounded.** Per-message size and per-batch count caps
  on the network-facing handlers prevent a single inbound message from forcing
  an unbounded allocation.

All of the above are local enforcement changes — fully interoperable with
earlier peers (no flag-day).

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

*Last updated: 2026-06-10.*
