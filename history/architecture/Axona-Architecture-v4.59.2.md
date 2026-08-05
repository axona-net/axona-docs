# Axona Architecture v4.59.2

## A reader-oriented architecture and protocol reference

- **Status:** rebuilt from the v4.59.2 implementation
- **Kernel baseline:** @axona/protocol commit 30664923e84419ce81c9b281b7dd7de63fd1e16d
- **Protocol version:** auth axona/5; wire 4.0; kernel 4.59.2
- **Scope:** the peer-to-peer kernel, its routing and pub/sub protocol, and the contracts a bridge or application must honor.

This document describes the behavior the v4.59.2 kernel actually implements. It is written for two audiences:

- **People** should be able to understand the system’s purpose, trust boundaries, failure modes, and operating model without reading source.
- **Implementers and AI systems** should be able to locate stable names, frame fields, state transitions, and testable rules without inferring them from metaphor.

The earlier [draft](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-DRAFT-v4.59.2.md) remains preserved as historical reference. The companion [reconstruction audit and roadmap](/Users/croqueteer/Documents/claude/axona-docs/architecture/Axona-Architecture-v4.59.2-Reconstruction-Audit-and-Roadmap.md) records the gaps this rebuild corrects and the work still needed for a fully independent, clean-room implementation.

## 1. Reading rules and authority

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** express requirements for a compatible implementation when this document identifies a protocol contract. A statement labeled **Implementation fact** describes current code, not necessarily a permanent design promise. A statement labeled **Known deviation** is deliberately not a guarantee.

When this document and a v4.59.2 kernel disagree, the running kernel is the compatibility authority. A future release should turn the frame registry, canonicalization vectors, and transport transcripts into generated artifacts so this exception is unnecessary.

### 1.1 What Axona is

Axona is a decentralized, geographically partitioned overlay:

1. Nodes form authenticated transport channels and maintain a bounded XOR-distance neighbourhood.
2. Topics are deterministic 264-bit addresses with a named region in their high byte.
3. A routed operation travels toward a target address. The closest reachable routing terminus is the acting root for a topic at that moment.
4. The root stamps accepted messages, retains bounded history, and fans messages through a renewable relay tree.
5. Replication, replay, root hints, and handoff repair state after churn. These mechanisms seek convergence; they are not consensus.

Axona does **not** promise global total order, immutable data, geographic proof, Byzantine fault tolerance, or guaranteed delivery in every partition.

### 1.2 The central distinction: architecture versus wire contract

The architecture explains why roots, relays, renewal, and replication exist. Interoperability depends on a separate set of exact facts:

- the JSON codec and canonical byte encoding;
- authenticated handshake transcripts;
- frame names, field names, defaults, and response semantics;
- root and relay transition guards;
- limits, timers, and failure behavior.

This document carries the current operational contract in the sections below. It still does not replace a generated JSON Schema registry and conformance-vector suite; those remain required work for a fully clean-room protocol release.

### 1.3 Important v4.59.2 caveats

| Topic | Current behavior | Do not claim |
|---|---|---|
| Geography | The node-ID region byte is not authenticated during transport admission. | That node location is cryptographically proven. |
| Author replay | The root checks signed timestamp freshness and retained message IDs; it does not keep an author-sequence high-water. | Monotonic author-sequence replay prevention at live ingress. |
| Durability | Replication evidence exists, but local self-delivery can confirm a publish before the cohort gate completes. | That seeing one’s own delivery proves replicated durability. |
| Ordering | A root stamps a dense per-topic stream; partitioned roots can stamp independently. | A network-wide or partition-spanning total order. |
| Reconstruction | The frame registry below gives current emitted shapes, but bridge signalling schemas and machine-readable negative fixtures are not yet published. | That a third party can implement every transport path without conformance artifacts. |

## 2. System map

| Layer | Responsibility | Compatibility boundary |
|---|---|---|
| Application | Chooses topic descriptors, author keys, message payloads, and retention expectations. | Public JavaScript API. |
| Pub/sub manager | Root, relay, backup, replay, cache, kill, pull, handoff, and metrics behavior. | Routed pub/sub message types. |
| DHT and routing | XOR-distance search, greedy routed delivery, two-hop escape, and route verdicts. | route_msg and lookup RPC semantics. |
| Transport | WebRTC or WebSocket channel setup, version negotiation, authentication, and frame encoding. | client/server hello and authenticated hello. |
| Bridge | Rendezvous, signalling, directory/bootstrap, and admission policy. It is not a topic root. | Bridge-specific web transport contract. |

The bridge is infrastructure for reaching peers. It **MUST NOT** be treated as a routable DHT candidate or pub/sub root.

## 3. Identifiers, identities, and geography

### 3.1 Identifier glossary

| Name | Size and form | Meaning |
|---|---:|---|
| Node ID | 66 lowercase hexadecimal characters | Routing and transport identity: one region byte plus a 256-bit key hash. |
| Author ID | 64 lowercase hexadecimal characters in production | The public Ed25519 author key used to sign content. |
| Topic ID | 66 lowercase hexadecimal characters | Region byte plus the hash of a topic descriptor. |
| Message ID | 64 lowercase hexadecimal characters | Content address of author plus application message. |
| Region | 8-bit code, also a canonical human label | Topic placement and routing locality hint. |

### 3.2 Node identity: routable, but not geographic proof

At identity creation, a node ID is constructed as:

    nodeId = regionByte || SHA-256(raw Ed25519 node public key)

The region byte is derived from an S2 cell and then normalized to a canonical Axona region. The key hash is the low 256 bits.

During authenticated transport admission, a peer verifies only that the supplied public key hashes to the **low 256-bit suffix** of the claimed node ID. The high region byte is intentionally **not** cryptographically bound by the handshake.

Consequences:

- The byte is useful for routing and placement policy.
- It is not proof that a peer is physically present in that region.
- A compatible implementation MUST accept a correctly signed node ID whose region byte differs from a locally recomputed geographic value.
- Region-based anti-abuse or compliance claims require evidence outside this protocol.

### 3.3 Author identity: content provenance, independent of transport

An author key is a separate Ed25519 keypair. A publish is signed by an author identity, not by the node identity that carries it. One transport node can act for many authors, and an author can publish through different nodes over time.

This separation gives applications a stable answer to “who signed this content?” without equating that answer to “where was it sent from?” It does not hide all network metadata: the routed wrapper carries an origin node ID, discussed in Section 6.4.

### 3.4 Topic descriptors and deterministic addresses

Every writable topic is described by:

    {
      region: <resolved 8-bit region code>,
      owner: <64-hex author id or null>,
      name: <non-empty string>,
      write: "open" | "owner"
    }

The resolved descriptor determines its address:

    topicId = hex(region) || SHA-256(canonical({ owner, name, write }))

The region byte is selected by the caller. If omitted at the API, it falls back to the local node’s region. There is no global, regionless topic mode in the current descriptor contract.

Policy is part of the address:

- A descriptor without an owner is always open.
- An owned descriptor defaults to owner-only writing.
- An owned descriptor can deliberately be open.
- Changing owner, name, write policy, or region changes the topic ID.

The root recomputes the topic ID from the **signed descriptor** in each envelope before accepting a publish. Owner-only authorization compares the envelope signer to descriptor.owner.

### 3.5 Region placement policy

The kernel contains a region-occupancy rule: when enabled, only an in-region node may root a topic and a clearly unpopulated region is refused. This rule is **disabled by default** in v4.59.2 because many regions may not yet have reachable participants. With the rule disabled, the nearest eligible node can act as root even if it is outside the topic region.

Do not describe region locality as an unconditional production guarantee without also stating whether region lock is enabled on the fleet.

## 4. Bytes, canonicalization, and signed objects

### 4.1 JSON transport codec

Axona transports JSON frames. Standard JSON is extended only for internal values:

| Runtime value | Wire representation |
|---|---|
| BigInt | Decimal string ending in the literal character n, for example "2748n". |
| Set | JSON array of its elements. |
| Node and topic IDs at public boundaries | Lowercase hexadecimal strings; no BigInt encoding needed. |

On decode, any string matching a signed decimal integer followed by n is revived as a BigInt. A field schema must therefore constrain ordinary strings when this ambiguity matters.

### 4.2 Canonical JSON

Hashes and signatures use a custom canonical JSON function, not RFC 8785 or generic “sorted JSON.”

The function recursively sorts object keys lexicographically and emits JSON with JavaScript JSON.stringify value semantics:

- object keys with undefined, function, or symbol values are omitted;
- array elements with those values become null;
- NaN and positive or negative infinity become null;
- negative zero becomes 0;
- string escaping and numeric spelling follow JavaScript JSON.stringify;
- hash and signature bytes are UTF-8 bytes of the resulting string.

Independent implementations should use this algorithm exactly and must verify against golden vectors before signing production data. A future release should publish those vectors rather than relying on prose.

### 4.3 Publish envelope

An accepted publish begins as an envelope:

    {
      msgId: <64-hex>,
      seq: <number>,
      ts: <milliseconds since epoch>,
      topic: <topic descriptor>,
      message: <JSON-serializable application value>,
      signature: "ed25519:" + <128-hex>,      // signed publish
      signerPubkey: <64-hex author public key>, // signed publish
      signerPow: <string>                       // presently inert at difficulty zero
    }

For an unsigned publish, signature, signerPubkey, and signerPow are absent. Applications must request unsigned publication explicitly; the public API does not silently fall back to the node key or anonymous publishing.

Message identity is:

    msgId = SHA-256(canonical({ publisher: signerPubkey-or-null, message }))

The message ID deliberately excludes topic, timestamp, author sequence, and signature. An author who needs two otherwise equal messages to have distinct IDs must include a nonce in the application message.

The signature covers:

    canonical({
      d: "axona:pubsub-envelope:v2",
      seq,
      ts,
      topic,
      message
    })

The descriptor, author sequence, timestamp, and application content are therefore authenticated. The message ID additionally binds the content to the author identity.

### 4.4 Freshness, replay, and ordering

At live root ingress, the kernel verifies the envelope and rejects a signed timestamp more than 300,000 milliseconds from the root’s local clock. This freshness check does not run on replayed cache records.

The envelope contains a signed per-author sequence. **Implementation fact:** v4.59.2 does not maintain a per-author sequence high-water at root ingress. The deployed live-ingress replay defense is the signed timestamp window plus topic-local retained-state deduplication by message ID.

After acceptance, the acting root assigns:

- publishTs: a strictly monotonic root timestamp, at least the current local time;
- seq: a dense per-topic counter, incremented for both publishes and kills.

Delivery carries these root-assigned values as stamped-message metadata. They order one root’s stream. They do not create a global total order across independently operating roots during a partition, and they must not be represented as a cross-partition author order.

### 4.5 Kill object

A per-message kill is always signed:

    {
      kind: "axona:pubsub-kill:v1",
      topicId: <66-hex>,
      msgId: <64-hex target>,
      ts: <milliseconds>,
      seq: <number>,
      signerPubkey: <64-hex author key>,
      signature: "ed25519:" + <128-hex>
    }

Its signature covers:

    canonical({
      d: "axona:pubsub-kill:v1",
      topicId,
      msgId,
      ts,
      seq
    })

The root first verifies the kill signature. If it already holds the target message, it also requires the kill signer to equal the target message’s signer. A kill that arrives before its target is held provisionally; the signer is checked when the message arrives.

## 5. Transport admission and version discipline

### 5.1 Version handshake

Before application frames, the web/signalling channel exchanges:

    client-hello = {
      type: "client-hello",
      version: <application or peer semver>,
      wireVersion: "4.0",
      capabilities: <optional string array>
    }

    server-hello = {
      type: "server-hello",
      version: <server semver>,
      wireVersion: "4.0",
      minPeerVersion: <semver>,
      downloadUrl: <optional string>
    }

Compatibility requires matching wire **major** versions and a peer version at least minPeerVersion. A mismatch uses WebSocket close code 4426, “Upgrade Required.” The current kernel version is 4.59.2; the current wire version is 4.0.

### 5.2 Authenticated hello

The authenticated protocol tag is axona/5. Each side proves possession of its node key with:

    {
      proto: "axona/5",
      nodeId: <66-hex>,
      pubkey: <64-hex raw Ed25519 public key>,
      sig: "ed25519:" + <128-hex>,
      pow: <string, optional/inert at difficulty zero>
    }

The signature is over:

    canonical({ proto, nodeId, pubkey, cbv })

where cbv is a channel-binding value derived independently by both endpoints from the current connection. A replay on another channel has a different cbv and fails signature verification.

The protocol rejects malformed IDs and keys, tag mismatch, invalid suffix binding, invalid signature, missing cbv, and failed transport proof of work. It verifies the node-ID suffix binding described in Section 3.2, not the geographic prefix.

### 5.3 Channel binding

Nonce-oriented transports build an order-independent value:

    cbv = "n:" + min(nonceA, nonceB) + ":" + max(nonceA, nonceB) [+ ":" + extra]

WebRTC additionally binds to transport-specific nonce and fingerprint information. A bridge or browser transport must implement the current mesh hello/hello-sig sequence and timeout behavior, not merely send an authenticated object with the right fields.

### 5.4 Transport privacy boundary

The signed publish envelope excludes node ID and region. That is an envelope-level privacy property.

The routed request wrapper includes originId. Intermediate route participants can observe it along the routed path. Therefore the protocol does **not** provide blanket publisher-location privacy. Any system description must distinguish identity embedded in content from metadata observed during forwarding.

## 6. Routing contract

### 6.1 Distance and candidates

Node and topic IDs occupy the same 264-bit keyspace. Distance is bitwise XOR. A transport bridge is excluded from topic-root and route-next-hop candidacy.

Two search functions are intentionally different:

| Function | Purpose | Behavior |
|---|---|---|
| findKClosest(target, K, { alpha=3, maxRounds=40 }) | Find nearby candidates. | Iteratively queries local closest sets in parallel, merges results, and returns up to K IDs ordered by XOR distance. |
| lookup(target) | DHT discovery and learning. | Uses the lookup-step process and updates routing knowledge; it is not a synonym for findKClosest. |

Root hints use findKClosest(topic, 1) when a fresh root beacon is unavailable.

### 6.2 Routed request shape

A cross-peer routed request uses:

    {
      type: <routed message type>,
      payload: <type-specific object>,
      targetId: <66-hex>,
      hops: <integer>,
      originId: <66-hex>
    }

The public routeMessage API starts with hop count zero and the local node ID as origin unless a caller supplies another fromId. A forwarder increments hops and preserves originId.

The v4.59.2 receiver:

1. Finds a strictly closer connected non-bridge neighbour if one exists.
2. If none exists, performs a bounded two-hop closer check.
3. Calls the local routed handler **at every hop**, before deciding whether to forward.
4. Stops if the handler returns consumed.
5. Stops as terminal if no closer route exists.
6. Stops exhausted if the next hop would exceed MAX_HOPS, currently 40.
7. Attempts lazy channel opening for the chosen next hop before sending.

This ordering matters. A pub/sub handler may intentionally consume, reroute, or defer a message at an intermediate node; handlers are not terminal-only callbacks.

### 6.3 Route verdict

Route results are normalized to one of these shapes:

    { consumed: true,  atNode: <node id>, hops: <number> }
    { consumed: false, atNode: <node id>, hops: <number>, terminal: true }
    { consumed: false, atNode: <node id>, hops: <number>, exhausted: true }

Transport adapters must declare whether they can reliably report these verdicts. A non-reporting adapter must not be credited with durability or waypoint confirmation.

### 6.4 Topic routing decision

Pub/sub messages with a topic target may include a via array:

- If via is empty, the routing terminus acts on the topic.
- If via[0] is this node and it holds the role, it acts.
- If a via waypoint is stale or no longer holds the role, the node removes that waypoint and reroutes toward the topic.
- If region lock is enabled and the terminal node is out of region, it rejects rather than roots the topic.

The configured sender-side via cap is eight entries, and the intended via-leg budget is eight hops. Treat inbound cap enforcement as an audit item until it is explicitly schema-validated at every receiver.

## 7. Pub/sub protocol

### 7.1 Roles and durable state

A node may hold a role for a topic in one primary nature:

| Nature | Principal duties | Typical exit |
|---|---|---|
| Root | Accepts/stamps writes, keeps history, announces itself, verifies closeness, replicates, serves replay. | Demotes to a closer live root or becomes idle. |
| Backup | Holds a warm replicated copy and subscribes upstream as an election standby. | Principal is gone, the backup rehomes or promotes, then retention expires. |
| Child | Relays a parent’s stream, renews upstream, caches, and fans out downward. | Subscribers vanish or parent is lost and it rehomes. |

Holder behavior is orthogonal: an app subscriber or host can retain a topic even without consuming application callbacks.

Per-role state includes subscriber and child sets, ordered cache records, cache message IDs, tombstones, root stamp high-water, dense root sequence, replication ledger, backup relationship, and metrics lease state.

Default bounds are:

| Setting | v4.59.2 value | Meaning |
|---|---:|---|
| MAX_PUBLISH_BYTES | 256 KiB | Absolute publish ceiling. |
| MAX_RELIABLE_PUBLISH_BYTES | 15 KiB | Default reliable WebRTC-safe application limit. |
| CACHE_MAX | 1,024 messages | Retained records per role. |
| CACHE_BYTES | 16 MiB | Retained bytes per role. |
| TTL_MS | 24 hours | Message and tombstone retention horizon. |
| MAX_DIRECT | 20 | Direct subscribers before delegation. |
| ROOT_REPLICAS | 2 | Warm root backups, unless configured otherwise. |
| MAX_ROLES | 96 | Default self-declared role budget. |

Retention-bounded state means deduplication is **topic-local and cache/tombstone-local**, not network-wide forever.

### 7.2 Routed pub/sub frame registry

All of the following are routed message types. Field names are lowercase/camelCase exactly as shown. An implementation should reject malformed values defensively even where legacy handlers currently drop them silently.

| Type | Producer payload | Receiver purpose |
|---|---|---|
| pubsub:sub | { topicId, via, subscriberId, since, hw, lw, latest } | Seat or renew a subscriber; optionally ask a cache-bearing child for missing history. |
| pubsub:unsub | { topicId, via, subscriberId } | Remove a subscriber and child relation. |
| pubsub:pub | { topicId, via, json } | Send an unstamped serialized envelope to the root. |
| pubsub:deliver | { topicId, from, msgs } | Deliver stamped messages or tombstones down the tree. |
| pubsub:adopt | { topicId, parent, subs } | Make the target a child relay and transfer subscriber placements. |
| pubsub:pullup | { topicId, sinceHw, parentId } | Ask a holder to send a stamped cache delta upward. |
| pubsub:replayup | { topicId, msgs, dels } | Send replayed records and tombstones to a requesting parent. |
| pubsub:handoff | { topicId, from, msgs, dels } | Transfer full state to a graceful-leave heir. |
| pubsub:handoffack | { topicId, held, sent } | Report how much handoff state the heir actually held. |
| pubsub:replicate | { topicId, from, msgs, dels } | Push full state or an empty keepalive to a backup/co-root. |
| pubsub:kill | { topicId, via, kill } | Deliver a signed creator retraction to the root. |
| pubsub:pull | { topicId, via, corrId, postHash, requesterId } | Request one known message or the latest retained message. |
| pubsub:pullresp | { corrId, json, publishTs, requesterId } | Return a pull answer to the requester. |
| pubsub:rootbeacon | { root, topics, beaconId, layer } | Advertise one root for a bounded set of topics. |
| pubsub:metricson | { topicId, via, requesterId } | Renew a demand-driven metrics lease at the data-topic root. |
| pubsub:touch | { topicId, via, touch } | Reserved compatibility frame; current handler consumes it without a state change. |
| pubsub:unpub | none | Reserved legacy string; no current sender or handler. |

Shared record shapes are:

    stamped message = {
      json: <serialized envelope>,
      publishTs: <root timestamp>,
      msgId: <64-hex>,
      seq: <root dense topic sequence>
    }

    delivered tombstone = {
      del: true,
      msgId: <64-hex target>,
      killTs: <root timestamp>,
      signer: <author id or null>,
      publishTs: <kill timestamp>,
      seq: <root dense topic sequence>
    }

The root validates and re-verifies stamped records during replay, replication, and handoff ingest. Tombstones are applied before message records in the same batch so a killed body cannot be resurrected by ordering within a batch.

### 7.3 Subscribe, renew, and tree growth

Subscription begins locally, registers the application handler before sending, seeds a replay floor, then routes pubsub:sub toward the topic or a known upstream root.

The default renewal model is adaptive:

- Start or rehome at 5 seconds.
- Multiply stable renewal intervals by 1.5 up to 60 seconds.
- Drop a subscriber after 180 seconds without renewal.
- A changed upstream pin resets renewal to the fast interval.

The subscriber advertises high-water and low-water stamps when it holds cached history. A root can request history that is newer than its high-water or older than its low-water, preventing a split history from remaining permanently divided.

When direct capacity is reached, a relay widens before deepening:

1. It promotes a known leaf subscriber to a child relay when at least two eligible leaves exist.
2. It transfers a bounded batch of other leaves through pubsub:adopt.
3. If widening is impossible, it delegates to the existing child closest to the new subscriber.

Each child subscribes upward and fans accepted delivery downward. A dead via pointer is removed and renewal falls back to the topic address, making the tree renewable rather than permanently pinned.

### 7.4 Publish path

The publish path is:

1. The application resolves a topic descriptor and builds a signed or explicit-anonymous envelope.
2. The publisher serializes the envelope and routes pubsub:pub toward a root hint or the bare topic ID.
3. The acting root parses the envelope, verifies signature and message ID, checks freshness, recomputes the descriptor’s topic ID, applies the write policy, and performs topic-local deduplication and tombstone suppression.
4. The root assigns publishTs and dense topic seq, caches the record, fans it out, and begins replication as configured.
5. Relays cache a stamped record once, refan it once, and deliver it to local application callbacks.

The root does not treat a wire wrapper timestamp as authoritative. Only the signed envelope timestamp is used for live freshness; only root-assigned stamp metadata orders retained topic history.

There is intentionally no universal publish acceptance reply. A returned message ID means the local API constructed and dispatched an envelope; it is not proof that a root accepted or durably replicated it.

**Known deviation — self-observation and durability:** a self-subscribed publisher can receive local delivery before the cohort replication gate has established durable evidence. The current code labels this path unresolved. Operators and applications must not claim that local observation alone proves replicated durability.

### 7.5 Replay, repair, and replication

Renewal replays cache entries newer than the subscriber’s requested timestamp. The latest mode adds the newest retained entry even if it falls below the timestamp floor. Active tombstones are replayed independently of that floor so a node that missed an old kill can heal.

Replication has three related modes:

| Mode | Direction | Purpose |
|---|---|---|
| Replay-up | Child or holder to requesting parent/root. | Recover missing stamped history after reattachment or an empty root. |
| Replicate | Root to warm backup or co-root. | Keep full state available across abrupt root loss; may send empty keepalives. |
| Handoff | Departing root to nominated heir. | Move full cache and tombstones before graceful departure. |

The root normally maintains two warm backups. Full root replication is delta-aware with a 60-second anti-entropy backstop. Replication work is paced: up to 32 full sends per tick, receiver ingest queue limit 4,096, with an 8-millisecond ingest slice.

An empty newly rooted topic probes nearby cache holders after a short delay. This prevents a newly closer, empty root from permanently hiding history still held by an older root or backup.

### 7.6 Pull semantics

A pull can name a specific message ID or request the latest record:

    pull(msgId, { topic, timeoutMs })

Any holder with a cached match may answer early. A latest pull may therefore return a recently replicated record rather than a globally freshest one; anti-entropy narrows that window. A caller needing an exact content-addressed record should pull by message ID.

The richer pullOutcome result distinguishes:

    { kind: "response", envelope: <envelope> }
    { kind: "response", envelope: null }
    { kind: "timeout", timeoutMs: <number> }
    { kind: "invalid-response", reason: <string> }

An envelope:null response means one responder said it holds nothing. It is not proof that the network holds nothing. The simpler pull API collapses non-successful outcomes to null for compatibility.

### 7.7 Kill semantics

A root stamps a valid kill as an ordered event, removes the target from cache, records a tombstone, fans the tombstone down the tree, and eagerly replicates it to the cohort. Tombstones persist for the retention window and suppress a later replay of the target body.

Only the original signed author can kill a signed message. Unsigned messages have no cryptographically provable creator and therefore cannot be killed through this mechanism.

## 8. Root convergence and lifecycle

### 8.1 What “root” means

A root is not elected through a global consensus round. It is the node currently acting as the routed terminus or a confirmed handoff heir for a topic. A live topology can temporarily have more than one root while routes, beacons, and replicated state converge.

The correct invariant is:

> Subject to connectivity, authenticated routing, timer progress, and no continuing partition, competing roots that learn of a strictly closer live root should converge by demotion, reattachment, and state union.

It is incorrect to state “exactly one root exists at all times.”

### 8.2 Root evidence and guards

Roots announce bounded root beacons every 20 seconds, with a 50-second pointer lifetime. Receivers accept a beacon only when it is not farther from the topic than the best local candidate. A node that is itself rooted demotes promptly when it learns of a strictly closer root.

A candidate may defer to a closer root only when that root has sufficiently live evidence:

1. fresh verified lookup evidence;
2. a directly reachable authenticated neighbour; or
3. for one-shot publish/kill correction, a fresh beacon under the looser forwarding rule.

The node must never defer to a farther node, an expired beacon, or a departing handoff source.

New roots verify themselves after 6 seconds and then every 45 seconds. A subscribed but unattached node can claim a reachable-root fallback after 6 seconds if it is the closest node it can actually reach. The fallback prioritizes reachable service over indefinitely waiting for a closer but unreachable hint.

### 8.3 Join, leave, and handoff

Joining first establishes transport and mesh participation. A newly joined node may transport immediately, but role management has a 90-second grace period and paced admission to avoid join storms starving transport keepalives.

On graceful leave:

1. A departing root selects a successor candidate.
2. It sends pubsub:handoff with cache and tombstones.
3. The heir ingests and reports pubsub:handoffack with held and sent counts.
4. The leaver retries twice when evidence is incomplete.
5. Remaining unacknowledged state is sprayed to a nearby cohort through replication.

The acknowledgement is intentionally evidence-bearing: a short acknowledgement is not treated as proof that the transfer succeeded.

Abrupt loss is different. Recovery depends on a remaining holder, backup, or subsequent replay-up; the protocol cannot restore data that no reachable node retained.

### 8.4 Persistence and restoration

The public snapshot format records routing and subscription metadata, not application callbacks. AxonaPeer.fromSnapshot is a **static** method. It deliberately expects a fresh transport identity on restoration; it does not resurrect the former node ID from the snapshot.

Application code must re-register subscription handlers after restore. Persistence or snapshot restore does not by itself prove that a topic’s cache is durably present elsewhere.

## 9. Operational limits and failure behavior

### 9.1 Important timing values

| Value | Default |
|---|---:|
| Fast renewal | 5 seconds |
| Stable renewal ceiling | 60 seconds |
| Subscriber eviction | 180 seconds |
| Root claim fallback | 6 seconds |
| First root verification | 6 seconds |
| Ongoing root verification | 45 seconds |
| Root beacon cadence | 20 seconds |
| Root beacon lifetime | 50 seconds |
| Metrics lease | 70 seconds |
| Metrics publication cadence | 20 seconds |
| Handoff acknowledgement base window | 700 milliseconds |
| Handoff tries | 2 |
| Maximum routed hops | 40 |

Timers describe liveness policy, not a hard real-time service-level agreement. A suspended process, disconnected topology, exhausted role budget, or non-reporting transport can delay or prevent the expected repair.

### 9.2 Admission and capacity

Nodes may refuse pushed roles when they are in post-join grace, saturated, or beyond their paced admission budget. A routing terminus treats soft capacity pressure differently: it is generally still allowed to form a root because refusal would otherwise drop a routed operation with no alternative.

Bridges are a hard exception: a bridge declares that it never roots. This prevents signalling infrastructure from accidentally becoming application storage.

### 9.3 Expected failure outcomes

| Failure | Expected response |
|---|---|
| Stale via waypoint | Remove the waypoint and reroute toward the topic. |
| Root hint points at a dead peer | Let liveness and freshness guards expire it; renew or correct toward another root. |
| Lost subscriber relay | Subscriber rehomes on fast renewal or receives a new delivery pin. |
| Empty new root with surviving history | Probe nearby holders and ingest replay-up. |
| Lost graceful handoff | Retry, then replicate to the cohort. |
| Pull timeout | Return a timeout outcome, not a confident negative. |
| Malformed or unauthorized publish | Drop at root ingress; a sender may receive no application-level acknowledgement. |
| Region lock on with no known in-region node | Fail pre-send where discoverable; otherwise do not root out of region. |

## 10. Security model and non-goals

### 10.1 What is authenticated

- The transport peer proves possession of a node key and binds it to the low 256 bits of node ID.
- A signed envelope proves possession of an author key over descriptor, timestamp, author sequence, and content.
- A signed kill proves possession of an author key over a specific topic and message target.
- Owner-only writes are enforced from the signed descriptor and signer identity.
- Message IDs detect mutation of author-plus-content.

### 10.2 What is not authenticated or guaranteed

- The node-ID region byte is not an attested physical location.
- Transport routing metadata, including originId, is not hidden from route participants.
- An author sequence is not currently enforced as a root-side anti-replay high-water.
- A root’s local delivery is not proof of replicated durability.
- A root’s dense sequence does not provide a total order across a partition.
- A local cache miss or one responder’s negative pull is not proof of global absence.
- The system does not provide consensus, linearizability, or Byzantine membership control.

### 10.3 Proof of work

Transport and publish proof-of-work fields exist as self-binding mechanisms. At the current default difficulty zero, they are inert. Treat proof-of-work as scaffolding until a deployment sets, documents, and monitors a nonzero difficulty.

## 11. Application and integration API

### 11.1 Bootstrap

connect is a module factory, not an AxonaPeer instance method:

    const { peer, author, disconnect } = await connect({
      bridge: "wss://…",
      location: { lat, lng },
      author: true
    })

It creates or accepts a node identity, prepares transport, creates an AxonaPeer, starts it, waits for mesh readiness unless disabled, and attempts self-integration. A Node environment needs a WebRTC implementation or injected transport.

### 11.2 Core peer calls

| Call | Purpose |
|---|---|
| peer.pub(topic, message, { signWith }) | Build and route a signed or explicit-anonymous envelope; returns its message ID. |
| peer.kill(topic, msgId, { signWith }) | Build and route a creator-signed kill. |
| peer.sub(topic, handler, { since }) | Register a handler and subscribe. Handler is required. since is live tail, latest, all, or a timestamp. |
| peer.unsub(topic) | Stop every local subscription to that topic. |
| peer.host() | Host the local keyspace neighbourhood. |
| peer.host(topic) | Host a specific nearby, same-region topic subject to address checks. |
| peer.pull(msgId, { topic, timeoutMs }) | Read a record or latest; compatibility API may return null for several outcomes. |
| peer.pullOutcome(msgId, { topic, timeoutMs }) | Read with explicit response, timeout, and malformed-response distinction. |
| peer.snapshot() | Serialize peer routing/subscription metadata. |
| AxonaPeer.fromSnapshot(state, options) | Static restoration constructor; handlers and old node identity are not restored. |
| peer.leave({ drain, notify, timeoutMs }) | Attempt graceful handoff and departure. |

For writes, a string topic must be a complete descriptor object or be resolved through the write-oriented API. For reads, a caller may use either a full descriptor or a shared 66-hex topic ID.

### 11.3 Bridge and browser integration

An interoperable browser or bridge-adjacent implementation needs more than the kernel API:

- client/server version hello;
- authenticated mesh hello and channel binding;
- WebRTC signalling and nonce sequence;
- bridge admission policy and wire-version gate;
- bridge directory/bootstrap behavior;
- restart/readiness/health signals.

These are transport and deployment contracts, not incidental UI details. They should be published as a versioned bridge transport specification before claiming third-party browser interoperability.

## 12. Reconstruction checklist

An implementation based on this document should be able to answer each question without guessing:

1. Can it encode and decode every JSON and BigInt field identically?
2. Can it reproduce the canonical bytes, envelope ID, envelope signature, kill signature, and auth transcript?
3. Can it distinguish node identity suffix verification from a geographic claim?
4. Can it send a route_msg with the exact field names and interpret every route verdict?
5. Can it run both nearest-set search and side-effecting lookup without conflating them?
6. Can it serialize, validate, and dispatch every pub/sub type in the frame registry, including pubsub:pullresp?
7. Can it model root, backup, child, and holder state; replay, tombstone, replication, and handoff behavior?
8. Can it state when its observation is merely local, when it is a routed acceptance indication, and when replication evidence is actually available?
9. Can it survive the described churn cases without inventing a global total order or consensus guarantee?

The remaining work for a true clean-room release is measurable:

- publish machine-readable schemas and negative fixtures for every frame;
- publish canonicalization, handshake, and signature test vectors;
- publish bridge signalling and close-code behavior;
- run black-box interoperability tests across simulator, WebRTC, and WebSocket paths;
- gate future documentation releases on those conformance tests.

## 13. Concise mental model

Axona routes toward deterministic, region-addressed topics. The node that presently terminates that route acts as root and stamps accepted writes. Relays form a renewable tree, cache stamped history, and reattach after churn. Roots and backups exchange retained state so surviving holders can converge after a loss or transition. Cryptographic authorship is separate from transport location, and the network’s safety claims are explicitly bounded by connectivity, retention, and evidence.

That is the protocol’s useful promise: a repairable, content-authenticated, geographically aware pub/sub overlay—not a hidden consensus system.
