# Axona Applications

**What runs on Axona today, what gets better if it migrates, and what we are building next.**

*Version 0.6 · 2026-07-14 · David A. Smith · davidasmith@gmail.com*

---

## How to read this document

This document has two parts.

**Part I — Existing Applications: A Deep Dive** surveys the applications and
services that would benefit from running on the Axona protocol. It leads with
the highest-impact, lowest-effort case — the managed pub/sub services an
application can replace with the protocol's own primitive — then the
decentralized protocols and centralized realtime services Axona can carry, and
finally the established applications built on a DHT today. The Axona protocol is
a live, browser-native network (`@axona/protocol` **v4.22.0**, running on both
the production and staging networks) with an authenticated handshake, signed and
freshness-bounded messages, and a full pub/sub lifecycle; each entry maps an
application's need onto that surface.

**Part II — Future Applications: Axona Powered** covers the applications we are
building *on* Axona rather than migrating *to* it — `civildefense.io` (the first
end-user app), **SYZL** (the adaptive social feed), a cohort of
**anonymous-broadcast natives** built on the capability no incumbent offers, and
a deliberately open pipeline for what comes next.

> **On the numbers.** Latency figures in Part I are back-of-envelope
> projections from the Axona simulator's 25,000-node benchmark, applied to each
> application's typical workload — the simulator is the scalable testbed where
> protocol changes are measured before deployment. They are projections, not
> field measurements of the migrated application. What is *not* a projection is
> the protocol surface itself — the API verbs, the security properties, the
> lifecycle semantics — which are live and testable today.

---

# Part I — Existing Applications: A Deep Dive

Each entry follows the same shape: what the application or service does, where
it falls short today, and what changes on the Axona protocol. We lead with the
case that is both highest-impact and lowest-effort for the developer — replacing
a managed pub/sub service — because it asks nothing of the application but a
change of transport. *Streaming-class applications — those that become possible
only with the Axona protocol's latency budget but do not exist today — are the
subject of Part II, not this part.*

### What the Axona protocol provides

The analysis throughout rests on a deployed substrate, not a plan. Four
properties carry every case:

- **Browser-native and live.** Axona was designed for the WebRTC environment
  from the start. The reference network runs at <https://axona.net> via the
  `axona-peer` browser node and the `axona-bridge` signaling broker. The bridge
  carries WebRTC offer/answer payloads only and then drops out — it sees no
  application traffic, and any operator can run one. The live network runs a
  **federated bridge pair** (east + west) with a signed on-network directory
  that clients use to discover bridges and fail over.
- **Authenticated, not anonymous-by-accident.** Every peer link is established
  through the `axona/5` authenticated handshake, with the mesh channel-binding
  value bound to the DTLS certificate fingerprints — so a relaying bridge cannot
  transparently MITM "direct" peer traffic.
- **Signed and fresh — or deliberately anonymous.** A published message is an
  Ed25519-signed envelope (format v2) over a domain-tagged core carrying a
  per-publisher monotonic sequence number and timestamp, with a freshness window
  enforced at ingress; replay-to-fresh-subscribers is closed. Signing names a
  location-free *author key*, never the publishing device — and a publisher may
  instead publish **anonymously** by explicit declaration (`ANONYMOUS`), naming
  no key at all. Authorship is a dial, not a default (§ *Anonymous Broadcast*).
- **A real lifecycle, not just fan-out.** Beyond `pub`/`sub`, the kernel
  exposes `unsub`, `pull` (by id *or* latest), `kill` (author-only retraction
  with cohort-replicated tombstones — the single retraction primitive), `host`
  (store-and-serve a topic without subscribing — the durable-relay primitive),
  bounded per-topic queues with deterministic eviction and per-publisher
  quotas, and a hold-time TTL (24 h default, 48 h ceiling, sliding on pull).
  Owned topics carry a network-enforced write policy (only the owner key's
  publishes are accepted by the storing nodes); membership-gated *reading* is
  supported via shared-encryption group keys at the application layer.

These four properties recur throughout the catalogue as the reason each
application benefits.

## Anonymous Broadcast — the Capability No Incumbent Offers

Every service in the next section sells fan-out. **None of them sells fan-out
where the publisher is unlinkable from the message** — because each is a central
operator that terminates every connection, and a connection the operator holds
is a connection the operator can attribute. This is not a policy gap they could
close with a setting; it is structural. To deliver a message, Pusher, Ably, and
PubNub must know which socket sent it, and that socket is the sender. Anonymity,
where these vendors offer it at all, is a promise not to look — not an inability
to.

Axona's fan-out is the same shape but the trust model is inverted, and that
inversion unlocks a capability class the managed tier cannot reach: **a
publisher can reach an arbitrarily large audience while proving nothing about
who or where it is.** Three protocol facts compose into it:

1. **Authorship is a location-free key, never the connecting device.** A publish
   is signed by an *author identity* (`createAuthorIdentity` — a bare keypair
   with no node ID and no region), and the signature travels in the envelope.
   The transport identity that actually carries the packets is a *separate*,
   disposable node key. The protocol deliberately never correlates the two — a
   subscriber learns the author key, never the sender's address.
2. **A publisher may name no key at all.** Passing the `ANONYMOUS` sentinel
   publishes a valid, routable, unsigned message. There is no author to
   subpoena, no key to cluster on. (The trade is explicit and enforced: an
   anonymous message cannot be retracted — no key, no proof it is yours to
   kill.)
3. **There is no operator in the data path.** After the signaling bridge brokers
   the first WebRTC handshake it drops out; messages fan out peer-to-peer along
   the axonal tree. No party terminates a connection it could attribute, and the
   mesh channel-binding stops even the bridge from transparently reading or
   rewriting "direct" traffic.

Put together: **one anonymous publish reaches every subscriber in the region,
routed by the mesh, attributable to no one, expiring on its own.** That is a
primitive with real-world demand that the entire managed-realtime industry is
structurally unable to serve. The applications below are organized by who needs
it.

### Whistleblowing & secure disclosure at scale

**Today.** SecureDrop, GlobaLeaks, and newsroom tip lines route a source to *one
recipient* over Tor — the model is confidential submission, not broadcast. To
reach an audience the source must trust an intermediary (a journalist, an
organization) to republish, and that intermediary becomes both the bottleneck
and the deanonymization risk (metadata, compelled disclosure, compromise).

**What Axona enables.** A source publishes **once, anonymously, to a public
regional topic**, and every subscriber — journalists, watchdogs, the affected
public — receives it directly, with no intermediary who could be pressured to
name the source because no intermediary exists. The 24–48 h hold-time means the
disclosure surfaces to everyone currently watching and then ages out on its own,
rather than persisting as a permanent, subpoena-able record on someone's server.
This is disclosure-as-broadcast, which no current tool offers: the incumbents do
confidential *submission*; Axona does anonymous *publication*.

### Crisis, protest, and censorship-resilient coordination

**Today.** Protest and disaster coordination runs on Telegram/Signal broadcast
channels or Twitter — all of which have a central operator that can be
geoblocked, subpoenaed for the channel admin's identity, or ordered to take the
channel down. FireChat-style mesh apps proved the demand for
infrastructure-independent local broadcast but lacked authenticity, history, and
scale.

**What Axona enables.** A regional topic *is* a broadcast channel with no admin
to identify and no server to seize; the S2 prefix means "everyone near this
incident" is the native audience without anyone maintaining a subscriber list.
Coordinators who *want* accountability sign with a persistent author key (so
followers can verify a message really came from the same source across days);
sources who need deniability publish anonymously. Because the fan-out is the
mesh, there is no chokepoint to censor — taking it down means taking down the
participants, not a server. This is the credible, authenticated successor to the
mesh-messenger idea, with the pieces those apps lacked.

### Anonymous civic and organizational feedback

**Today.** Anonymous surveys, ethics hotlines, and municipal 311-style tip lines
run through a vendor who, by construction, holds the mapping from response to
respondent — so "anonymous" is a policy, and employees and citizens know it.
Genuinely unlinkable feedback at scale has no off-the-shelf product.

**What Axona enables.** An organization hosts a public feedback topic; anyone
publishes to it anonymously and every stakeholder reads the same unfiltered
stream. The absence of an operator is the feature — there is no database
correlating submissions to identities because there is no operator to hold one.
For a company this is a truly anonymous suggestion box; for a city it is a tip
line no administration can quietly mine; for a union it is member communication
the employer cannot enumerate.

### Public accountability & tamper-evident broadcast

**Today.** "Post something that provably came from this key, that everyone can
see, that no platform can silently alter or unpublish" is approximated by
blockchain posts (expensive, permanent, and public-by-accident) or by trusting a
platform not to edit history.

**What Axona enables.** A **pseudonymous** author key (persistent, but tied to no
real-world identity unless the holder chooses) publishes to a public topic;
every message is Ed25519-signed with a monotonic per-author sequence number, so
subscribers get a **tamper-evident, gap-detectable feed** — a dropped or altered
message is visible as a sequence gap or a signature failure. This is the
substrate for anonymous-but-accountable broadcasters: a leaker with a track
record, a pseudonymous analyst, an activist collective posting under one
verifiable identity while its members stay unlinkable. The author key carries
reputation; the humans behind it carry none of the risk.

> **The honest boundary.** Axona provides *content-layer* anonymity —
> unlinkability of author from message, and no operator who terminates an
> attributable connection. It is **not**, by itself, a *network-layer* anonymity
> system: a global passive adversary correlating packet timing at the IP layer
> is Tor's threat model, not Axona's, and the two compose (run the peer over Tor
> for both). What Axona uniquely adds is that the *fan-out itself* is anonymous
> and operator-free — the property Tor's onion services still centralize through
> HSDirs and that no managed pub/sub vendor can offer at all.

## Pub/Sub-as-a-Service — the Managed Realtime Tier

The highest-impact case asks the least of the developer. A class of companies
sells *pub/sub itself* as a service — their product is the WebSocket fan-out an
application would otherwise build and operate, because doing it at scale
(connection management, presence, history, global points of presence) is hard.
The Axona protocol changes the economics directly: fan-out becomes a property of
the mesh, the per-message meter disappears, and so does the operator who could
read the traffic. An application replaces the service with the protocol's own
pub/sub primitive — a change of transport, not of architecture. These services
sort into four tiers by how cleanly Axona displaces them.

### Tier 1 — Realtime client pub/sub (the bullseye)

**Vendors:** Pusher Channels, Ably, PubNub, Firebase Realtime Database,
Supabase Realtime, Azure Web PubSub / SignalR Service, Stream (getstream.io).

**What they sell.** A client subscribes to a channel; a publisher sends; every
subscriber receives it in real time — plus presence, short-term message
history, and reconnect handling. The meter is per-message **and** per
connection-minute **and** per channel-minute (Ably is roughly $2.50 / million
messages + $1 / million connection-minutes), or per monthly-active-user
(PubNub starts near $98/mo for 1,000 MAU). The product is the fan-out
infrastructure you would otherwise run yourself.

**What Axona changes.** This is the closest match in the entire document,
because Axona's pub/sub primitive *is* this product, minus the operator and the
meter. The feature mapping is near-complete:

| Managed-service feature | Axona equivalent |
|---|---|
| Channel / topic | `peer.sub(topic)` over `deriveTopicId` (public or owned) |
| Publish | `peer.pub` — Ed25519-signed, freshness-bounded envelope |
| Presence ("who's online") | `peer.peers` + `onPeerJoin` / `onPeerLeave` — native |
| Message history / "rewind" | replay cache + `peer.pull` (by id *or* latest) + hold-time TTL |
| Channel teardown / revoke | `unsub` / `kill` (author retraction + cohort tombstone) |
| Private channels | Model 3 shared-encryption topic (group key at the app layer) |
| Reach analytics | `peer.metrics` (publishes / subscribers / reshare_count) |

The pitch is economic and architectural at once: peers carry the fan-out, so the
marginal cost per message trends to zero and there is no per-connection bill;
and because there is no central relay, Pusher/Ably/PubNub's structural ability
to read every channel's traffic simply does not exist — messages are signed and,
where wanted, end-to-end encrypted. Geographic locality (the S2 prefix) is a
bonus none of these vendors offer natively.

### Tier 2 — Push notifications (complement, not replace)

**Vendors:** Firebase Cloud Messaging (FCM), Apple Push Notification service
(APNs), OneSignal, Airship, Pusher Beams.

Axona delivers "came-online" and event pushes to *connected* peers natively, but
it **cannot wake a closed application** — only the OS push channel (APNs/FCM)
can originate that, and only the platform vendor controls it. So Axona replaces
the in-app realtime layer and **pairs with** FCM/APNs for the wake-the-device
layer; it does not displace them.

### Tier 3 — Durable server-side event streaming (NOT a replacement)

**Vendors:** Apache Kafka / Confluent Cloud, Google Cloud Pub/Sub, AWS SNS +
SQS / Kinesis / EventBridge, Azure Event Hubs / Service Bus, CloudAMQP
(RabbitMQ), Solace PubSub+, IBM MQ.

These are **durable commit logs and queues**: long retention, partitioning,
replay-from-offset, exactly-once or strict FIFO delivery, transactions, and
backend consumers. Axona is deliberately **not** this — its retention is a
bounded queue (≤1024 messages per topic) under a 24–48 h hold-time TTL, its ordering is
per-publisher rather than a global total order, and its delivery is high but
best-effort under churn, not the exactly-once SLA Kafka and Ably market.
Positioning Axona as a Kafka replacement would be the overclaim that
discredits the rest of this document; it is a realtime fan-out layer, not an
event-sourcing backbone.

### Tier 4 — MQTT / IoT brokers (partial)

**Vendors:** HiveMQ Cloud, EMQX Cloud, Azure Event Grid (MQTT), AWS IoT Core.

Conceptually adjacent — topics, retained messages (≈ Axona's replay-latest),
QoS tiers — and Axona's geo-locality is genuinely attractive for regional
device fleets. But these brokers win on **backend data-plane bridging** (dozens
of connectors into Kafka, Kinesis, databases) and device-constrained QoS that
Axona does not provide. Axona fits *peer-to-peer* device coordination, not the
industrial-broker role with enterprise integrations.

### The honest gap list (what Tier 1 displacement requires)

To genuinely displace Ably/Pusher/PubNub rather than merely resemble them, four
gaps must be stated plainly:

1. **No exactly-once / no global ordering SLA** — per-publisher sequence only;
   high delivery, not guaranteed delivery.
2. **Short, bounded history** — minutes-to-days, not the months of stored
   messages PubNub sells.
3. **No managed support / uptime SLA** — Axona is infrastructure you adopt, not
   a vendor you page at 3 a.m.
4. **Presence and fan-out at PaaS scale are unproven** — the claim needs the
   friction-realistic benchmark before it is field-credible.

The trade is explicit: you give up the SLA, the durability, and the managed
support; you get no per-message fee, no operator able to read your traffic, and
geographic locality for free. For the large class of realtime features that do
not need a durability guarantee — chat, presence, live cursors, notifications,
feeds — that is a favorable trade, and it is exactly the class Tier 1 vendors
serve.

## Anonymous Broadcast — the Native Capability

Everything in the previous section could, in principle, be bought from a
vendor. This section is different: it is the capability that has **no managed
equivalent to buy** — publishing to a large group of subscribers *without the
publisher being identifiable, locatable, or dependent on any operator's
permission*. It is Axona's most distinctive capability, and it falls out of
four design decisions that were made for other reasons:

1. **Authorship is a dial, not a default.** Every publish names its signer
   explicitly. The dial has three positions: **anonymous** (`ANONYMOUS` — no
   key, no linkage between any two messages), an **ephemeral author** (a
   session-scoped pseudonym: messages within the session are linkable to each
   other, and to nothing else), and a **durable author** (a persisted key — a
   pseudonym with continuity, the foundation of reputation without identity).
2. **A signature names *who*, never *where*.** The author key is location-free
   by construction — it carries no node ID, no region, no device linkage. The
   envelope format deliberately contains no field for the publisher's network
   location, and the protocol refuses to add one. Even a fully signed feed
   discloses only the continuity of its byline.
3. **There is no delivery acknowledgment — as a privacy invariant, not a
   limitation.** A publish carries no return address, and no receipt ever
   flows back. This is what keeps the *transport* identity (the disposable,
   per-session connection ID) permanently uncorrelated with the *author*
   identity. An ack channel is exactly the correlation oracle a deanonymizer
   would want; Axona refuses it on principle.
4. **The publisher sends once, regardless of audience size.** Fan-out is the
   network's job: a single publish routes to the topic's coordinator and
   spreads through an axonal tree at bounded per-node cost. A broadcaster with
   a million subscribers has the same network footprint at the publish site as
   one with ten — the audience is invisible to anyone watching the publisher's
   link, and the publisher is invisible to anyone watching a subscriber's.

Add the properties the rest of this document already established — no central
operator to log, subpoena, or pressure; messages that expire by protocol
(24–48 h) rather than persisting into evidence; geographic topics that make
*local* anonymous broadcast a primitive — and a distinct application space
opens up. The entries below survey its existing occupants; Part II sketches
the natives.

> **The honest boundary, stated first.** Axona provides *publisher anonymity
> against the network and against any operator* — there is no party positioned
> to know who published. It is **not Tor**: it does no onion routing and adds
> no cover traffic, so an adversary who can watch *your own* network link can
> see that you published *something* (though not reliably what, or to whom).
> For most of the applications below — where the threat is the platform, the
> subpoena, or the crowd — that is the right boundary. Where the threat model
> includes a global passive observer, Axona composes with, rather than
> replaces, an anonymizing transport. Three more limits, equally plain:
> an anonymous message can never be retracted (`kill` requires the author key
> — no key, no proof of authorship); anonymity brings no Sybil resistance
> (one person can be many, so anonymous topics must never carry votes or
> counts that matter); and flooding of open topics is bounded only by the
> per-publisher queue quota, so moderation is a client-side, application-layer
> concern — there is, by design, no one to appeal to.

### Broadcast channels (the Telegram-channel shape)

**Today.** The dominant one-to-many medium in much of the world is the
Telegram channel: one publisher, an unbounded subscriber list, push fan-out.
News organizations, diaspora communities, and — in several countries — the
only functioning independent press operate this way. **Where it falls
short.** Telegram sees every message, every subscriber list, and every
publisher's account; channels are blocked, throttled, or handed over at the
platform's discretion, and the platform is a single legal and technical
pressure point for every channel at once.

**What Axona changes.** A channel is an owned topic: the durable author key
*is* the byline, subscribers verify every message against it, and the
network — not a platform — carries the fan-out. There is no subscriber list
held anywhere (a subscription is a relationship between the subscriber and
the mesh, not a row in the publisher's database), no account to seize, and no
platform to pressure. The trade is retention: Axona holds the recent window
(24–48 h), so the channel's *archive* is an application-layer concern — a
`host()` relay run by the publisher, or by any reader who cares. For the
channel whose job is *

A cohort of protocols already run the right *shape* — signed messages fanned out
through a relay layer — but pay for it with operator-run relays or homeservers
that are the centralization and availability weak point. For these, Axona is not
a rewrite: it is a better transport that drops the relay as a single point of
failure. In each case Axona supplies the **fan-out and discovery layer**, not
the protocol's own identity or data model — those ride as opaque, app-signed
payloads.

### Nostr

**What it is.** "Notes and Other Stuff Transmitted by Relays" — clients publish
secp256k1-signed events to a handful of independently-operated relays and read
from several at once for coverage. **Where it falls short.** Relay availability
is fragile, popular relays face moderation and centralization pressure, and a
client must redundantly POST each event to N relays for reach.

**What Axona changes.** A Nostr event (with its own signature intact) becomes
the opaque payload of an Axona publish; relays become axonal-tree topics. One
publish fans out through the mesh instead of N redundant relay uploads, relay
operators stop being load-bearing, and geographic locality routes events toward
the people near them. Axona replaces the *relay layer*, not Nostr's npub
identity.

### Waku / WalletConnect

**What it is.** Waku (libp2p gossipsub, the successor to Ethereum's Whisper)
carries privacy-preserving messages for the Status/Logos stack; WalletConnect
relays end-to-end-encrypted session messages between a wallet and a dApp.
**Where it falls short.** Both still lean on a relay tier the user does not
control.

**What Axona changes.** Encrypted session and messaging payloads map onto a
Model 3 shared-encryption topic — the protocol carries opaque ciphertext and the
relay operator disappears. WalletConnect's "pair wallet and dApp, exchange
encrypted requests" is a two-party encrypted topic, which is natively what Axona
does.

### Farcaster

**What it is.** A "sufficiently decentralized" social network: hubs store and
propagate messages (casts, reactions) and gossip them via libp2p gossipsub,
while identity and the username registry live on-chain. **Where it falls
short.** The hub-to-hub gossip layer is the operational weight; running a hub is
non-trivial.

**What Axona changes.** Axona becomes the hub gossip transport — message
propagation rides axonal trees with bounded per-relay cost and geographic
locality — while the on-chain registry stays exactly where it is. The
decentralization story improves without touching the identity layer.

### Matrix

**What it is.** Federated real-time communication: homeservers federate over the
server-to-server API, and each room is replicated across the participating
homeservers. **Where it falls short.** A homeserver is a single point of failure
and a load/centralization point for all of its users; the long-running P2P
Matrix experiments exist precisely to remove it.

**What Axona changes.** Axona offers the transport and discovery those P2P
experiments need: room events become a topic, handle/room discovery becomes a
lookup, and a user's reachability stops depending on one homeserver's uptime.
Durable room history stays an app-layer concern (a peer or service that retains
it), since Axona's hold-time is bounded.

### Bluesky / AT Protocol

**What it is.** Personal Data Servers (PDSes) hold user repos; a central
**Relay** crawls them and emits a global "firehose" of repo commits that App
Views index. **Where it falls short.** The Relay is a massive centralized
aggregation-and-fan-out point — the firehose is, structurally, one enormous
pub/sub channel run by one party.

**What Axona changes.** The firehose rebroadcast becomes an axonal-tree topic
(or a set of them, partitioned by region or collection), and PDS discovery
becomes a DHT lookup. This is the largest lift in this cohort — the AT Protocol
has a lot of moving parts — but it is also the clearest case of a centralized
pub/sub firehose that Axona's primitive is shaped to carry.

## Realtime Apps Currently Renting Centralized Infrastructure

The previous cohort already thinks in pub/sub. This one does not — these
applications buy a realtime layer (a CDN, a WebSocket PaaS, a game backend)
because building one is hard. Axona's axonal trees plus S2 geographic locality
are the thing they would otherwise rent.

### Peer-assisted CDN & P2P video

**Today.** Peer5 (now part of Microsoft), Streamroot (Lumen), CDNBye, and THEO's
P2P module form a WebRTC mesh among viewers to share HLS/DASH segments,
offloading the origin CDN and cutting bandwidth cost — especially for live
events where everyone wants the same segment at the same instant.

**What Axona changes.** This is a near-ideal fit: a live stream's segment topic
fans out through an axonal tree, and the S2 prefix clusters the swarm by region
so peers pull from neighbors, not across oceans. Axona supplies the mesh
formation, locality, and fan-out these products hand-build, with signed segments
and no central coordinator tracking who watched what.

### Collaborative editing & multiplayer

**Today.** CRDT libraries (Yjs, Automerge) need a sync transport plus
"awareness" (live cursors, presence); teams either run a `y-websocket` server or
buy a multiplayer backend — Liveblocks, PartyKit, Cloudflare Durable Objects,
Convex, Ably Spaces.

**What Axona changes.** A document becomes a topic: CRDT update messages publish
to it, and awareness/presence is native (`peer.peers` + join/leave). Because
CRDTs converge from any order of opaque updates, Axona's carry-opaque-bytes
model fits cleanly, and per-publisher sequence numbers give each editor's stream
a stable order. Durable document persistence remains app-layer (a peer or
service that retains the doc), since Axona's queue and hold-time are bounded —
the honest boundary of the fit.

### Live data feeds

**Today.** Sports scores, financial tickers, live blogs, election and flight
trackers — one publisher, a high-frequency update stream, and a large read-only
audience — served today by CDN-plus-WebSocket stacks or a Tier 1 pub/sub vendor.

**What Axona changes.** This is the pub/sub sweet spot with nothing working
against it: the data is inherently ephemeral (the TTL is a feature, not a
limitation), the audience is read-only (no membership complexity), and fan-out
to a geo-distributed crowd is exactly what axonal trees do. Of every category in
this document, live feeds need the least from Axona to work well.

### Partial fits

- **Multiplayer game netcode & matchmaking** (Photon, Colyseus, Nakama,
  Hathora, Playroom): matchmaking discovery maps onto a DHT lookup, and
  peer/relay state sync onto the mesh — a good fit for non-authoritative or
  lockstep designs. Authoritative twitch shooters still want a server tick, and
  the hardest cases are latency-bound, though the S2 prefix helps regional
  matchmaking.
- **Feature-flag / config streaming** (LaunchDarkly streaming, ConfigCat):
  pushing flag updates to clients is a small, clean pub/sub topic — a tidy fit,
  modest in scope.
- **Software & game-patch distribution** (npm/apt/container registries, game
  patchers): DHT discovery plus swarm delivery is BitTorrent's pattern applied
  to updates — strong on bandwidth economics, bounded by the need for an
  authoritative signed manifest (which the app supplies).

### Where Axona does not fit

To keep the catalogue honest, three categories are explicit non-targets.
**Distributed coordination and config stores** (etcd, ZooKeeper, Consul) require
strong consensus (a CP system); Axona is not a consensus protocol and should not
pretend to be. **Durable event-sourcing and data pipelines** are the Tier 3
streaming case already excluded. And **strong-consistency databases and search
indices** need guarantees a best-effort fan-out mesh does not provide. Axona is
a realtime discovery-and-fan-out layer; where the requirement is consensus or
durable total order, the right answer is a different tool.


## Applications Built on a DHT Today

The remaining applications already run a DHT — for peer discovery, content
addressing, or descriptor lookup — and would gain from swapping it for the
Axona protocol's locality-aware routing and pub/sub fan-out. These are
higher-effort migrations than the pub/sub services above — they touch an
application's existing overlay — but the latency and architecture wins are
substantial.

## BitTorrent (Mainline DHT)

**What it does.** Mainline DHT is BitTorrent's trackerless peer-discovery
layer: a torrent's `info_hash` maps into the keyspace, swarm peers register
under that key, and new peers query the DHT to find the swarm.

**Current implementation.** Kademlia, 160-bit IDs, K=8 buckets, α=3 parallel
queries. The largest production DHT in the world by node count (estimated
10–20 M nodes at peak).

**Performance & shortfall.** Cold-start `get_peers` latency is typically
5–30 s, dominated by the iterative α-parallel walk through globally-scattered
random-ID peers. Modern clients hide this behind a centralized tracker for the
first discovery round; the DHT is the tracker-resistance *backup*, not the
primary path — precisely because the cold-start latency is unacceptable for a
primary path.

**What Axona changes.** Mainline lookups translate directly (same operation,
same data model). Projected lookup latency drops to **~250–300 ms at 25K
nodes** — a 20–100× improvement that collapses the user-visible delay below the
threshold where tracker fallback adds value. The qualitative shift: the DHT
becomes *the* discovery layer, not a fallback.

## IPFS / Filecoin / libp2p

**What it does.** Content-addressable storage: content is referenced by a CID,
and the libp2p Kad-DHT routes lookups to peers that announced they hold it.

**Current implementation.** libp2p Kad-DHT (Kademlia variant), default K=20,
α=3, tens of thousands of nodes.

**Performance & shortfall.** CID lookup averages 1–5 s; provider-record
retrieval adds 1–3 s; end-to-end first-byte from cold cache is 5–15 s —
25–300× slower than a centralized HTTP CDN (50–200 ms). The IPFS gateway tier
exists to paper over this with centralized servers. Separately, `libp2p-pubsub`
(gossipsub) for IPNS updates carries its own mesh-scaling challenges.

**What Axona changes.** DHT-layer lookups drop to **~250–300 ms** (projection),
making end-to-end first-byte ~500 ms–1 s — a 10–20× improvement that turns
CDN-replacement viability from hypothetical into a real question. Axona's axonal
pub/sub trees would replace gossipsub for IPNS updates with bounded per-relay
fan-out cost. The combination makes IPFS deployable on browser-class
infrastructure for both halves, which it currently is not.

## Ethereum (discv5)

**What it does.** discv5 is Ethereum's peer-discovery layer — how a new node
finds peers — using a Kademlia variant with verifiable-identity ENRs.

**Performance & shortfall.** Cold-start peer acquisition takes 30 s to several
minutes (Kademlia walk + per-peer ENR verification round-trips). For an
on-demand join (fresh validator, new searcher) that is operational friction;
mempool gossip via gossipsub adds a latency-sensitive scaling dimension the
static Kademlia table cannot adapt to.

**What Axona changes.** Discovery latency drops 10–50× for the DHT layer
(projection). The locality-aware bootstrap gives new nodes regionally-sensible
initial peer sets — which matters more for Ethereum than BitTorrent because
mempool propagation is latency-sensitive. Axona's axonal trees are a natural fit
for "broadcast a transaction to all interested validators in a region,"
addressing the gossipsub limitation directly. *Axona's authenticated handshake
maps cleanly onto discv5's identity requirements — the migration does not
trade away ENR-style verifiable identity.*

## Bitcoin Block / Transaction Propagation

**What it does.** Bitcoin propagates blocks/transactions through a P2P mesh:
DNS-seed bootstrap, `addr`-message peer discovery, gossip propagation.

**Performance & shortfall.** Full-block propagation averages 1–3 s (compact
blocks reduce the announce to a few hundred ms plus re-request); mempool tx
latency is 50–200 ms. The flooded gossip is **not locality-aware** — a US-east
→ Asia transaction may route through Europe — and MEV concentrates around peers
with privileged low-latency access to miners.

**What Axona changes.** Locality-aware discovery solves regional clustering;
nodes find nearby peers by default and transactions propagate along short-path
edges. Compact-block propagation becomes routed pub/sub: every node subscribes
to a block-announcement topic, the miner publishes, the axonal tree fans out at
**~100 ms at 50K nodes** (projection). The tree is built once and reused rather
than re-running inventory exchange per peer per round, and peer-to-miner latency
becomes a property of geography rather than peering relationships — the
privileged-peer problem partially dissolves.

## Tor Onion Services v3

**What it does.** Self-authenticating, location-hidden endpoints; descriptor
lookup is mediated by the HSDir hash ring.

**Performance & shortfall.** Rendezvous takes 5–15 s end-to-end, dominated by
Tor circuit setup; the descriptor lookup itself adds 1–3 s. HSDir nodes are
infrastructure-tier (a centralization concession), and descriptor caching is
short-lived — popular services see fetch storms.

**What Axona changes.** The descriptor lookup itself drops to **~300 ms**
(projection), though the Tor circuit still dominates total cost. The structural
benefit is decentralizing the HSDir tier: Axona's hop-caching deposits
descriptors at any node along the lookup path, widening the descriptor-fetch
tier beyond designated relays. The directory-authority trust model is unchanged
— Axona widens the cache tier, it does not replace Tor's anonymity design.

## Storj / Sia (Decentralized Storage)

**What it does.** Files are sharded, encrypted, and replicated across provider
nodes; the DHT mediates shard placement and retrieval.

**Performance & shortfall.** Storj shard retrieval is 200–800 ms for a 4 KB
shard (dominated by the connection to a remote provider, not the lookup);
provider discovery at edge is ~1 s. Placement is **region-blind** — a Berlin
user may hold shards in São Paulo.

**What Axona changes.** Locality-aware placement: shards land on providers in
the user's S2 cell with high probability, dropping retrieval to the regional
budget (**~100–200 ms**, projection). Repair coordination (replacing a shard
when a provider drops) becomes an axonal-tree topic with high delivery under
churn — and the new lifecycle verbs give it explicit semantics: a provider
going offline is a `kill`/tombstone event, not an inference from silence.

## Tox / Briar (Peer-to-Peer Messengers)

**What it does.** Serverless P2P messengers. Tox uses a Kademlia DHT for contact
discovery; Briar uses a hybrid local + overlay routing.

**Performance & shortfall.** Tox contact-availability checks take 2–10 s; NAT
makes initial establishment slower. **Group chat is expensive** — every message
goes to every member, making large groups infeasible — and "contact came
online" requires polling because there is no real pub/sub.

**What Axona changes.** Contact discovery drops to **~250 ms** (projection),
comparable to a centralized messenger's offline-status check. Group chat becomes
a pub/sub topic: bounded per-hop fan-out scaling to thousands of members; "came
online" becomes an automatic event. Crucially, the membership and privacy story
is now real, not aspirational: a private group is a **shared-encryption topic**
(group key distributed at the app layer; the protocol carries opaque ciphertext
and gates nothing it shouldn't), and `kill`/`unsub`/`host` give first-class
leave/remove/teardown. This is the first P2P messenger architecture that scales
to large groups with a centralized service's latency profile *and* a credible
membership model.

## YaCy (Decentralized Search)

**What it does.** A P2P search engine — each peer crawls part of the web; a
custom DHT mediates shared indexing and query distribution.

**Performance & shortfall.** Queries take 2–30 s (index lookup + query
distribution, both ~log N on a high ~200–500 ms per-peer constant). Against
Google's ~200 ms median this is unusable interactively — the UX gap is why YaCy
stayed a research curiosity.

**What Axona changes.** DHT-layer query distribution drops to **~250 ms**
(projection); shard-level result caching via hop caching makes an interactive
YaCy-like engine plausible. Ranked aggregation across shards is a separate
algorithmic problem, and beating Google needs decades of ranking infrastructure
— but the *latency floor* stops being the disqualifying factor.

## Radicle (Decentralized Git Forge)

**What it does.** P2P git collaboration; repositories addressed by peer-ID, a
DHT layer for repository discovery, custom routing for pull requests.

**Performance & shortfall.** Repository discovery is 1–3 s; change-set
propagation is 5–30 s — making "find a project, browse it" feel slow vs GitHub
and "watch this repo" poll-based rather than push-based.

**What Axona changes.** Repository discovery drops to **~300 ms** (projection);
change-set propagation becomes a `commits-on-this-repo` axonal topic with
**~200 ms** fan-out, making the forge interactive in the GitHub sense, not just
browsable. The signed-envelope sequence numbers give watchers a tamper-evident,
gap-detectable commit feed for free.

## Handshake / ENS (Decentralized DNS)

**What it does.** Decentralized name resolution; ownership recorded on-chain, a
DHT-like layer caches recent lookups.

**Performance & shortfall.** Hot cached lookups are <100 ms; cold lookups hit
the chain and take seconds to minutes, so cache hit-rate dominates. The cache
tier is operated by infrastructure peers (a centralization tradeoff) because
random-Kademlia caching does not scale.

**What Axona changes.** Hop caching makes the cache tier *implicit*: every
routed lookup deposits its result at intermediate nodes, popular names accrue
shortcuts naturally, and the explicit caching infrastructure becomes
unnecessary. Cold-cache latency drops because the routing itself is faster.

## WebTorrent / WebRTC P2P

**What it does.** BitTorrent for browsers over WebRTC data channels, bridged to
Mainline DHT for peer discovery (most browsers cannot speak Mainline directly).

**Performance & shortfall.** Discovery is 5–30 s (Mainline latency + bridge
overhead). The **Mainline-DHT bridge is a centralization concession driven
entirely by the protocol's inability to run in browsers** — the bridge
operators are a single point of failure and surveillance.

**What Axona changes.** Axona *is* a browser-native DHT — this is the cleanest
fit in the catalogue. WebTorrent on Axona eliminates the *discovery* bridge:
peer discovery runs in-browser at the regional budget (**100–300 ms**), and the
browser becomes a first-class P2P participant. (Axona still uses a lightweight
*signaling* bridge for WebRTC NAT traversal, but it carries no application or
discovery traffic and drops out once peers are connected — a categorically
smaller role than the Mainline-DHT bridge it replaces.) The connection-cap
analysis shows this is sustainable on browser-class infrastructure.

## Mastodon-Style Federations (No DHT Today)

**What it does.** A federation of independent ActivityPub servers; users follow
accounts on other servers, and the home server fetches/serves federated content.

**Current implementation.** No DHT. Discovery via WebFinger (centralized
per-domain handle resolution); cross-server delivery via direct HTTP push from
publisher's home to each subscriber's home.

**Performance & shortfall.** Home servers (often small VPS) show 200–2000 ms
under load; popular-post federation can lag by minutes due to per-subscriber-
server fan-out. The **home-server-as-bottleneck** pattern means a viral post on
a small instance can take the instance down, because every other instance's
followers fetch from the publisher's home.

**What Axona changes.** This is the application that becomes *architecturally
different*. Handle resolution becomes an Axona lookup (independent of
home-server load). Status delivery becomes an axonal-tree topic per
follower-graph cluster: a viral post fans out via the tree at bounded per-relay
cost, never saturating any single home server. Home servers keep durable storage
and WebFinger origin authority, but the fan-out load moves to the DHT layer —
making small servers stop being single points of failure for their users' reach.

## Summary of improvements

Latency figures are back-of-envelope projections from the Axona simulator's
25K-node benchmark, to be confirmed on the friction-realistic model.

| Application | Current bottleneck | Axona improvement |
|---|---|---|
| BitTorrent (Mainline) | 5–30 s cold lookup | ~300 ms; primary path possible |
| IPFS / Filecoin | 5–15 s first-byte | ~1 s; CDN-replacement viable |
| Ethereum discv5 | Multi-minute join, mempool latency | ~1 s join, locality-aware mempool |
| Bitcoin propagation | Region-blind, MEV-prone | Locality-aware, axonal-tree announce |
| Tor onion services | DHT minor; HSDir centralization | Wider HSDir tier, faster lookups |
| Storj / Sia | Region-blind shard placement | Locality-aware shards + repair pub/sub |
| Tox / Briar messengers | Slow group chat, polling status | Pub/sub group chat, push status, real membership |
| YaCy | 5–30 s queries | ~300 ms DHT layer; interactive plausible |
| Radicle | 5–30 s changeset propagation | ~200 ms via axonal pub/sub |
| Handshake / ENS | Cold-cache slow | Implicit caching via hop caching |
| WebTorrent | Mainline-DHT discovery bridge | Discovery bridge eliminated; browser-native |
| Mastodon-style federation | Home-server bottleneck | Decentralized fan-out via axonal trees |

**The pattern.** The DHT layer is rarely the *only* bottleneck, but it is
consistently *a* bottleneck, and moving to Axona consistently moves it out of
the user-visible critical path. The biggest beneficiaries are the interactive
applications (messengers, search, dev forges) where DHT latency sits in the
user's path; the least are those where the DHT is already a small fraction of
total latency (Tor circuits, Storj's remote-provider connection). The
application that becomes *architecturally different* is the federation pattern,
because Axona's pub/sub primitive replaces the home-server fan-out those
patterns suffer under.

**Honest framing.** We keep the federation claim modest: the architecture is
*enabled*, not necessarily preferable in every dimension. And the latency
figures are simulator projections, to be confirmed against the friction-realistic
model before they are quoted as field results. What is not in question is the
protocol surface they run on — authenticated, signed-and-fresh, with a real
pub/sub lifecycle, live today.

---

# Part II — Future Applications: Axona Powered

Part I asked "what gets better if an existing app migrates?" Part II asks the
opposite: "what do we build that *only* Axona makes practical?" These are
applications designed Axona-native from the first line — they consume the
pub/sub lifecycle, the geographic locality, the signed-and-fresh envelopes, and
the no-central-operator property as load-bearing features, not conveniences.

## civildefense.io — the flagship

**What it is.** A tap-to-report incident map. A user taps a location to register
a concern; reports propagate over anonymous peer-to-peer with a **24-hour
expiry**, surfacing on a shared regional map without any central server holding
the data.

**Why it is Axona-native.** Every primitive the app needs is a protocol
primitive:

- **Geographic locality is the product.** The S2 cell prefix in every nodeId
  means a report is relevant to, and routes toward, the people physically near
  it — at zero coordination cost. An incident map is, structurally, a
  geographically-keyed pub/sub feed, which is exactly what Axona routes.
- **Expiry is a first-class semantic now, not a side effect.** The original
  brief leaned on implicit expiry through the replay-cache LRU. With the 4.x
  lifecycle, the 24-hour window is the **hold-time TTL** (24 h default, 48 h
  ceiling), an explicit, principled bound — reports age out deterministically
  rather than whenever the cache happens to evict them.
- **Signed, fresh, and tamper-evident.** Reports are Ed25519-signed envelopes
  with per-publisher sequence numbers and a freshness window — so a stale or
  replayed report cannot be re-injected at a fresh subscriber, which matters
  acutely for an incident feed.
- **Anonymous publish is the load-bearing property.** A report names a
  location-free author key — or no key at all (`ANONYMOUS`) — never the
  reporting device, and the `axona/5` handshake plus mesh channel-binding means
  reports travel end-to-end without a central operator and without a relaying
  bridge able to read or rewrite them. A resident can flag an incident to
  everyone nearby without exposing who or where they are — the anonymous-
  broadcast primitive of Part I, as an end-user product.

**What it still needs from us.** A membership-gated variant (e.g., a verified
responder channel) wants **Model 3 shared-encryption group keys** — the group
key is distributed at the application layer and the protocol carries opaque
ciphertext. civildefense.io is one of the two worked references (alongside the
open-source reference app) driving that app-layer group-key design.

**Status.** First end-user application; the primitive fit is why it came
together in weeks rather than quarters.

## SYZL — the adaptive social feed

**What it is.** A swipe-based decentralized social feed where every gesture
trains your network: **swipe right to `SYZL`** a post (it reshares to your
followers and your connection to the publisher strengthens), **swipe left to
`FYZL`** it (it stops, and the connection weakens). Ranking runs transparently
on your own device from your own swipe history — there is no algorithm operator
and no server-side ranking. *(Full product brief:
[`SYZL-Brief.md`](SYZL-Brief.md).)*

**Why it is Axona-native.**

1. **The mechanism mirrors the protocol.** Axona's neuromorphic routing
   strengthens useful connections and prunes the rest; SYZL does the same one
   layer up, with user attention as the learning signal. Same algorithm,
   different layer — the protocol's own story retold for end users.
2. **No central operator, no engagement-maximization incentive.** No ads, no
   rage-bait amplification, no shadowbanning; ranking runs only on-device.
3. **Verifiable reach without surveillance.** Publishers see reach
   (`publishes` + `reshare_count`) via `peer.metrics` without learning *who*
   reshared — the privacy property Axona was built for, surfaced at the app
   layer.
4. **Connection-sharing as a feature, not a leak.** Because subscriptions are
   first-class protocol objects, "share my graph" is a native operation;
   recipients adopt connections selectively, with provenance.

**Lifecycle fit.** SYZL is almost entirely application-layer over
`@axona/protocol`: `pub`/`sub` for posts, reshares, and connection-list cards;
`pull` for referenced bodies; `metrics` for the reach dashboard; `unsub` for
dropping a rotated-out connection cleanly. The hill-climb + simulated-annealing
exploration that keeps the feed alive is ~200 lines on top of `lookup`/`peers`.

**SYZL Anywhere.** A companion Manifest-V3 browser extension that lets a user
`SYZL` any page, selection, or image in one click, running the user's Axona peer
in a background service worker — which doubles as keeping the network warm while
the user browses. ~6 weeks, ~70% code-shared with the PWA composer.

## Anonymous-broadcast natives — built on the capability no incumbent has

The Part I *Anonymous Broadcast* cohort is a menu of applications that are more
interesting built *fresh* on Axona than migrated, because their defining feature
— reach an audience while proving nothing about the sender — is a protocol
primitive nowhere else. These are the leading Part II candidates; each is
almost entirely application-layer over `pub`(`ANONYMOUS`)/`sub`, plus a
persistent author key where accountability is wanted.

- **A disclosure wire.** A source publishes anonymously to a regional or
  topical channel; journalists and watchdogs subscribe. No SecureDrop instance
  to run, no single recipient to compromise, no permanent server-side record —
  the disclosure fans out to everyone watching and ages out on the hold-time.
  The app is a reader with a verification pane (signature/anonymous badge,
  sequence-gap detection) and a compose box that defaults to `ANONYMOUS`. The
  hard parts are protocol defaults; the app is a week of UI.
- **A censorship-resilient community broadcast.** A neighborhood, campus, or
  movement gets an authenticated broadcast channel with no admin to unmask and
  no server to seize — the credible successor to FireChat-class mesh apps, with
  the authenticity, history, and scale they lacked. Coordinators sign; sources
  stay anonymous; the S2 prefix makes "everyone nearby" the default audience.
- **A pseudonymous publishing platform.** One persistent author key, a public
  topic, a tamper-evident signed feed — a "substack for pseudonyms" where the
  key carries reputation and the human carries none of the exposure. Reach is
  visible to the author (`metrics`: publishes + subscriber count) without ever
  revealing *who* subscribed.
- **A truly anonymous feedback channel.** An org or municipality hosts a public
  topic; stakeholders publish anonymously; everyone reads the same unfiltered
  stream. No vendor holding the response→respondent map, because there is no
  vendor.

## The rest of the pipeline — others as we invent them

This section stays deliberately open. Further near-term candidates from Part I,
none yet committed:

- **A browser-native swarm transport.** WebTorrent's discovery bridge
  eliminated — large-file or live-media distribution among browser peers with no
  Mainline-DHT intermediary.
- **A large-group P2P messenger.** Tox/Briar's group-chat ceiling lifted by
  pub/sub fan-out plus Model 3 shared-encryption membership.
- **A federated-feed fan-out layer.** The Mastodon-style "viral post on a small
  instance" failure removed by moving fan-out to axonal trees while home servers
  keep storage and identity.

As each of these graduates from idea to product, it gets its own brief in this
folder and a row in Part II.

## What the Axona-powered applications share

Across civildefense.io, SYZL, the anonymous-broadcast natives, and the pipeline,
the same five properties keep recurring as the reason the app is *possible*, not
merely *cheaper*:

1. **Geographic locality for free** — the S2 prefix puts relevance and routing
   in the same place at zero coordination cost.
2. **Pub/sub with a real lifecycle** — `pub`/`sub`/`unsub`/`pull`/`kill`/`host`,
   bounded queues, and hold-time TTL turn "fan a message out" into a managed,
   expiring, revocable feed.
3. **Signed, fresh, end-to-end-secure messages** — authenticity, freshness, and
   MITM-resistance are protocol defaults, so the application never has to bolt
   them on.
4. **Authorship as a dial** — a location-free author key, a pseudonym, or
   `ANONYMOUS`, per message — so an app can offer accountable, pseudonymous, and
   fully anonymous publishing from the *same* primitive, a combination no
   central operator can structurally provide.
5. **No central operator** — ranking, membership, reach, and *attribution* live
   on-device and in the mesh, which removes the surveillance-and-incentive
   failure mode common to their centralized counterparts.

These are the same properties Part I shows existing applications *reaching
toward* through bridges, gateways, and caching tiers. The forward-looking bet of
Part II is that designing for them from the first line produces applications the
migration path cannot — because the protocol's defaults are the product's
features.
