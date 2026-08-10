# Axona Leaderless Per-Author Pub/Sub Design

**Status:** design proposal v0.1 — semantic premise accepted; not implementation authorization  
**Date:** 2026-08-09  
**Audience:** David, Council, axona.bot, protocol implementers  
**Scope:** a rootless Axona pub/sub profile based on per-author order, deterministic convergence, adaptive retention, and renewable delivery paths

## Executive decision

This design makes the following product-level assumption:

> **Per-author order plus deterministic convergence is sufficient. Axona does not
> require one real-time, dense, topic-wide sequence.**

That decision removes the need for a root, timekeeper, sequencer lease, or
triumvirate consensus path on ordinary publication. The topic is instead the
convergent union of independently signed author lanes. Every valid event has one
authoritative position in its author's lane; no event claims an authoritative
position relative to events from other authors.

The proposed service has three independent planes:

1. **Event plane:** authors create signed, hash-linked, strictly ordered events.
2. **Retention plane:** an adaptive set of eligible holders retains events,
   tombstones, lane indexes, and compaction evidence with exact receipts.
3. **Delivery plane:** subscribers maintain renewable primary and standby
   upstreams in a redundant delivery DAG.

Any eligible node may validate and ingest a write. Retention does not assign order.
Delivery paths do not own topic state. Topic state does not move merely because a
subscriber changes upstream. After partitions or churn, anti-entropy reconciles
author lanes and the same input set produces the same materialized result.

The design deliberately does **not** synthesize a weaker global order from wall
clocks. Signed timestamps remain useful freshness and presentation hints, but do
not determine validity, conflict resolution, retention, or canonical convergence.

## Relationship to the architecture exploration

This document develops Alternative C from
[`Axona-Pubsub-Architecture-Alternatives-v0.1.md`](Axona-Pubsub-Architecture-Alternatives-v0.1.md).
It retains the separation lessons from the triumvirate work while removing the
`StampAuthority` role entirely.

The design also incorporates the measured result that subscriber orphaning, not
only root durability, dominates loss under churn. A rootless write path is not
enough by itself; continuous subscription renewal and redundant upstreams remain
first-class parts of the system.

Relevant prior documents:

- [`axona-triumvirate-root-design-v0.1.md`](axona-triumvirate-root-design-v0.1.md)
- [`axona-refactor-triumvirate-readiness-review-v0.1.md`](axona-refactor-triumvirate-readiness-review-v0.1.md)
- [`Pubsub-Stability-Root-Election-v0.1.md`](Pubsub-Stability-Root-Election-v0.1.md)
- [`Root-Management-v4.20.1.md`](Root-Management-v4.20.1.md)
- [`Pubsub-Lifecycle-Design-v0.2.md`](../implementation/Pubsub-Lifecycle-Design-v0.2.md)

## 1. Semantic contract

### 1.1 Guarantees

For each topic, Axona guarantees:

- **Authenticity:** a signed event is attributable to its author key.
- **Per-author order:** accepted events from one author form a strict sequence.
- **Per-author integrity:** each event commits to its predecessor.
- **Idempotence:** the same event may arrive by any number of paths without
  changing the result after the first acceptance.
- **Deterministic convergence:** replicas possessing the same valid event set and
  compaction evidence compute the same lane state, visible set, tombstone state,
  fork state, and canonical view digest.
- **Partition tolerance:** different authors may continue publishing in different
  partitions and converge when communication resumes.
- **Creator-authorized retraction:** only the author of an event may kill it.
- **Replay:** a returning subscriber can reconcile from an opaque frontier rather
  than from one scalar topic sequence.
- **Bounded operation:** storage, subscriber state, repair traffic, and pending-gap
  state have explicit limits and degradation rules.
- **Self-healing delivery:** renewable primary and standby upstreams repair
  delivery without electing a topic owner.

### 1.2 Explicit non-guarantees

Axona does not guarantee:

- one dense sequence shared by all topic authors;
- a globally authoritative "next" event;
- real-time consistency across partitions;
- a stable historical interleaving of concurrent authors;
- clock-derived causality between different authors;
- that two observers with different event sets render the same intermediate view;
- that a signed author timestamp is honest; or
- that a write is durable merely because one routing hop accepted it.

### 1.3 Meaning of deterministic convergence

Deterministic convergence is a statement about **equal knowledge**, not
simultaneous observation:

```text
materialize(validatedEventSet, compactionEvidence, topicPolicy) -> TopicState
```

For a fixed protocol version, the function is pure. If replicas have the same
inputs, they produce byte-identical canonical state digests regardless of arrival
order, path, local clock, or node identity.

Replicas with different inputs may temporarily show different states. Repair makes
their inputs equal; no election is required to make their computation equal.

## 2. Design invariants

The following invariants are normative for the proposed profile.

1. **One author key, one lane per topic.** Applications must not use one author key
   concurrently from independent writers. Multi-device applications use distinct
   author keys or coordinate one shared lane head above the protocol.
2. **Sequence numbers are contiguous.** The first event has sequence zero. Every
   successor has `authorSeq = previous.authorSeq + 1`.
3. **Every successor names its predecessor.** Sequence alone is not enough;
   `prevEventId` makes omissions and forks directly detectable.
4. **Clocks do not resolve protocol state.** `authorTs` is signed, but canonical
   convergence never compares it across authors.
5. **A fork is an author fault, not a topic election.** The affected lane freezes
   at its last unambiguous prefix. Other lanes continue.
6. **Tombstones are events.** A kill participates in the same author sequence as a
   publish and is reconciled before bodies are exposed.
7. **Possession requires evidence.** A node claims retention only by signing an
   exact receipt for the state it actually holds.
8. **Delivery is soft state.** Every child and upstream relationship expires
   unless renewed.
9. **Routing proximity is not authority.** Being closest to a topic grants neither
   ordering rights nor ownership of retained state.
10. **Garbage collection requires a durable floor.** Local cache pressure may
    discard reconstructible bodies, but semantic history cannot be forgotten in a
    way that permits killed or expired events to resurrect.

## 3. Current-to-target transformation

The current protocol already contains much of the required substrate:

- envelopes are signed by `signerPubkey`;
- signed `seq` is described as per-publisher monotonic order;
- signed `ts` is used for live-ingress freshness;
- `msgId` is author-bound and content-derived;
- topic descriptors are signed and root-verifiable;
- owner-only write policy is derivable from the descriptor;
- kills are signed by the creator and remain effective when they arrive before
  their target body;
- replay, handoff, and replication reverify envelopes and deduplicate by `msgId`;
- tombstones are synchronized independently so a scalar cursor cannot skip them;
  and
- application exactly-once delivery is already keyed by topic and message ID.

The current root adds two pieces that this design removes from authority:

```text
publishTs = root-local receipt time
seq       = dense root-assigned topic sequence
```

The target profile promotes the signed author sequence from freshness metadata to
the authoritative lane position and replaces root-stamped array order with a
convergent event index.

This is not wire-compatible with existing topics. The current `msgId` deliberately
excludes topic, timestamp, and sequence, so two identical payloads by one author
share an ID. The leaderless profile requires event identity to include lane
position and predecessor. It therefore introduces a new envelope domain and a new
topic ordering profile rather than changing old topics in place.

## 4. Topic identity and policy

### 4.1 Immutable descriptor

A leaderless topic descriptor is immutable and includes its ordering profile:

```text
TopicDescriptorV4 {
  region,
  owner,                 // null or Author ID
  name,
  write,                 // "open" or "owner"
  order: "author-lanes-v1",
  retentionPolicyId,
  deliveryPolicyId
}
```

`topicId` is derived from the canonical descriptor. Folding `order` into the topic
hash prevents current root-sequenced and new leaderless events from occupying the
same namespace.

Policy identifiers refer to immutable, versioned policy objects. A policy change
creates a new topic unless a later protocol explicitly introduces an owner-signed
configuration lane. Version one intentionally avoids dynamic ACL ordering.

### 4.2 Write authorization

- `write: "owner"` accepts only events signed by `descriptor.owner`.
- `write: "open"` accepts any structurally valid signed author, subject to ingress
  admission, proof-of-work, and quota policy.
- A descriptor without an owner is necessarily open, preserving the current safe
  derivation rule.

Unsigned anonymous writes are not accepted in `author-lanes-v1`. An application
that needs unlinkable authorship may generate a fresh ephemeral signing key. The
protocol still receives an author lane it can order, validate, rate-limit, and
retract.

## 5. Author event format

### 5.1 Canonical event

```text
AuthorEventV1 {
  kind:          "publish" | "kill",
  topic:         TopicDescriptorV4,
  topicId:       Hex264,
  authorId:      Hex256,
  authorSeq:     U64Hex,
  prevEventId:   Hex256 | null,
  authorTs:      SafeIntegerMilliseconds,

  // kind == "publish"
  message?:      JsonValue,
  contentId?:    Hex256,

  // kind == "kill"
  targetEventId?: Hex256,

  eventId:       Hex256,
  signature:     "ed25519:" + Hex512,
  signerPow?:    String
}
```

`U64Hex` is exactly sixteen lowercase hexadecimal characters. JSON numbers are not
used for the authoritative sequence because JavaScript cannot safely represent the
full unsigned 64-bit range.

The domain-separated signed core is:

```text
core = canonical({
  d: "axona:pubsub-author-event:v1",
  kind,
  topic,
  topicId,
  authorId,
  authorSeq,
  prevEventId,
  authorTs,
  message?,
  contentId?,
  targetEventId?
})

eventId   = sha256(core)
signature = ed25519.sign(authorPrivateKey, utf8(core))
```

The verifier derives `authorId` from or verifies it against the signing key,
recomputes `topicId`, recomputes `eventId`, and verifies the signature.

`eventId` becomes the application deduplication key for this profile. `contentId`
may retain the current `sha256({publisher,message})` identity for applications
that want content equality, but it does not identify an event. When present, a
verifier recomputes it; it is never accepted as an arbitrary author assertion.

### 5.2 Lane formation

The lane key is:

```text
(topicId, authorId)
```

The genesis event must have:

```text
authorSeq   = "0000000000000000"
prevEventId = null
```

For every successor:

```text
parseU64(event.authorSeq) = parseU64(previous.authorSeq) + 1
event.prevEventId         = previous.eventId
```

Authors must persist the most recent lane head. After local state loss, an author
must retrieve and verify its lane before publishing again. It must not guess a
sequence or create a second genesis. Key rotation creates a new author lane; a
future delegation design may connect identities at the application layer.

### 5.3 Live-ingress freshness

`authorTs` preserves the current protection against replaying an old signed event
as a fresh write. A node receiving an event directly from an author applies the
configured skew window before issuing its first retention receipt.

Replication, replay, and anti-entropy do not reapply the wall-clock freshness test
when the event carries valid prior retention evidence. Otherwise a valid event
would become impossible to repair merely because time passed.

`authorTs` is never used to:

- compare different authors;
- select a fork;
- assign retention priority;
- authorize a write;
- expire a tombstone; or
- derive the canonical view.

## 6. Validation and lane state machine

### 6.1 Validation stages

An ingest node evaluates an event in this order:

1. Parse and size-limit the frame.
2. Validate the topic descriptor and recompute `topicId`.
3. Verify author identity, signature, and `eventId`.
4. Verify write authorization.
5. Verify publish-role admission proof and per-author quota.
6. Check direct live-ingress freshness, if applicable.
7. Locate the predecessor or classify the event as pending.
8. Detect duplicate, gap, fork, or valid extension.
9. Validate kind-specific fields.
10. Persist the event before issuing a retained-state receipt.

Cryptographic validity is necessary but not sufficient for lane acceptance.

### 6.2 States

Each event is in exactly one local state:

| State | Meaning |
|---|---|
| `invalid` | Structural, cryptographic, authorization, or policy failure |
| `duplicate` | `eventId` is already known |
| `pending-predecessor` | Valid signature, but `prevEventId` is not available |
| `accepted` | Extends the unique lane head or accepted prefix |
| `fork-evidence` | Conflicts with an accepted event at the same lane position |
| `compacted` | Below a certified retention floor; body need not be stored |

Pending events are not delivered and do not advance a frontier. They are indexed
by `prevEventId`, requested from peers, and bounded by per-author count, bytes, and
age. Exceeding a bound drops the least useful pending body while retaining a small
negative or abuse record.

### 6.3 Fork rule

A fork exists when one author signs incompatible successors for the same lane
prefix, including multiple genesis events.

The protocol does not choose an arbitrary winning branch. It:

1. accepts the common prefix;
2. records both signed conflicting events as an `EquivocationProof`;
3. freezes that author lane at the last unambiguous event;
4. excludes all fork descendants from the materialized topic view; and
5. continues processing every other author lane.

```text
EquivocationProof {
  topicId,
  authorId,
  predecessorId,
  conflictingEventA,
  conflictingEventB,
  proofId = sha256(canonical(sorted(A.eventId, B.eventId)))
}
```

This rule is deterministic, contains the fault, and prevents a late-revealed fork
from rolling back a chosen branch. It also makes the one-key/one-writer invariant
operationally important. Version one recovers by moving the application to a new
author key; same-key lane recovery is intentionally not specified.

## 7. Convergent topic state

### 7.1 State components

The logical topic state is:

```text
TopicState {
  acceptedPrefixByAuthor,
  pendingByPredecessor,
  equivocationProofs,
  activeTombstones,
  compactionFloors,
  retainedBodies,
  canonicalDigest
}
```

The merge operation is set union followed by deterministic validation and
materialization. Invalid material is ignored. New predecessor knowledge may move
an event from pending to accepted. New fork evidence may freeze one lane but does
not modify valid prefixes in other lanes.

### 7.2 Canonical digest

The canonical digest describes logical state, not arrival order:

```text
authorLeaf = hash({
  authorId,
  acceptedHeadSeq,
  acceptedHeadEventId,
  frozenAtEventId,
  forkProofIds,
  compactedThroughSeq,
  tombstoneDigest
})

canonicalDigest = merkleRoot(sortByAuthorId(authorLeaf[]))
```

Equal validated state therefore produces the same digest without requiring a
global event sequence.

### 7.3 Deterministic list presentation

Some applications need a repeatable list even though the protocol does not claim
global temporal order. Axona defines a clock-free canonical linearization for a
fixed event set:

1. Place the first visible event from every unfrozen author lane in a ready set.
2. Select the ready event with the lowest `sha256("axona:merge:v1" || eventId)`;
   break the impossible hash tie by `(authorId, authorSeq, eventId)`.
3. Emit it and place its next visible lane event in the ready set.
4. Repeat until the set is empty.

This is a deterministic topological merge: it always respects per-author order
and requires no clock. It does **not** mean the network observed events in that
order.

A late-discovered author event may change earlier portions of the rendered list.
Applications that cannot tolerate visual movement should render stable per-author
lanes, use arrival-local UI grouping, or establish application-level causal
references. UI order is not protocol authority.

Signed `authorTs` may be displayed and may support an explicitly non-canonical
"approximate time" view. It must never feed the canonical digest.

## 8. Publish and commit path

### 8.1 Write flow

```text
Author
  -> any reachable ingress
  -> validate and persist locally
  -> route/gossip to eligible retention holders
  -> collect exact possession receipts
  -> assemble retention certificate
  -> announce committed event to delivery DAG
```

There is no distinguished ingress. Retrying through another ingress is safe
because `eventId` is stable and all operations are idempotent.

### 8.2 Outcome vocabulary

The protocol must not collapse distinct outcomes into one acknowledgement.

| Grade | Evidence |
|---|---|
| `routed` | A transport accepted the next-hop frame |
| `validated` | A node verified the event and lane relation |
| `retained-1` | One eligible holder signed exact retained-state evidence |
| `committed` | The retention policy threshold and diversity constraints are met |
| `announced` | A committed event entered at least one delivery path |
| `observed` | An application subscriber delivered the event once |

The default durable profile does not announce an event as committed until a valid
certificate exists. A policy may permit provisional live delivery during a severe
partition, but the delivery must be labeled `provisional`; it cannot be silently
treated as durable.

### 8.3 Retention receipt

```text
RetentionReceiptV1 {
  topicId,
  eventId,
  eventDigest,
  laneKey,
  authorSeq,
  bodyPresent,
  tombstonePresent,
  policyId,
  holderId,
  holderCapabilityDigest,
  retainedAt,
  receiptExpiry,
  signature
}
```

The receipt describes exact local possession at signing time. A holder may not
issue it before durable local persistence. Receipt expiry forces repair to remain
active rather than treating an ancient acknowledgement as current possession.
Receipt time and expiry affect the operational durability grade only; they do not
enter the topic's canonical state digest.

### 8.4 Retention certificate

```text
RetentionCertificateV1 {
  topicId,
  eventId,
  policyId,
  receipts[],
  certificateId
}
```

Anyone may assemble the certificate. Its validity is a pure function of:

- valid, non-expired holder signatures;
- identical topic, event, and policy identifiers;
- distinct eligible holder identities;
- the minimum holder count; and
- required failure-domain diversity.

The certificate proves possession, not consensus and not global order.

## 9. Adaptive retention cell

### 9.1 Membership without a root

The retention cell is a changing set of eligible holders, not an elected council.
There is no requirement that every observer name exactly the same candidate set at
the same instant. A certificate is valid if its actual receipt set satisfies the
immutable retention policy.

Eligibility can include:

- valid node identity and channel binding;
- publish/retain role proof-of-work or later resource proof;
- declared and measured storage capability;
- topic-region reachability;
- minimum receipt lifetime;
- distinct keyspace or region prefixes; and
- per-holder topic and byte quotas.

This avoids consensus about cell membership, but it does not solve Sybil resistance
by itself. Receipt thresholds are only as strong as holder identity cost and
failure-domain diversity. The implementation must use Axona's existing identity,
proof, and eclipse defenses rather than counting raw connections.

### 9.2 Target policy

An initial policy should distinguish:

```text
W = receipts required to declare commit
R = desired live retained replicas after background repair
D = minimum distinct failure-domain buckets
```

For example, `W=2`, `R=4`, `D=2` may provide a practical starting profile, but
these values require simulation and are not selected by this document.

The important property is that `W`, `R`, and `D` are policy, not a hard-coded
triumvirate. Repair may add or replace holders without moving subscribers.

### 9.3 Repair

Every holder periodically or eventfully checks:

- whether each retained event still has enough unexpired receipts;
- whether holder diversity has collapsed;
- whether a newly eligible, better-diversified peer should receive a copy;
- whether its own departure requires seeding replacements; and
- whether local and peer frontier digests differ.

Graceful departure seeds replacements before withdrawing receipts. Abrupt loss is
repaired when surviving holders, ingress nodes, subscribers, or authors observe an
expired/missing receipt and supply the event to new holders.

## 10. Tombstones and retraction

### 10.1 Kill event

A kill is a normal event in the killer's author lane:

```text
kind          = "kill"
targetEventId = event to retract
```

It is authorized only if `kill.authorId == target.authorId`. A kill may arrive
before its target body. In that case it is retained provisionally and reconciled
before bodies are exposed.

When the target arrives:

- matching author: suppress the target and retain the tombstone;
- different author: reject the kill as unauthorized for that target; or
- missing target: continue retaining the provisional tombstone within policy
  bounds and request the target header.

### 10.2 Tombstone-first reconciliation

Every sync batch processes:

1. compaction floors;
2. fork proofs;
3. tombstones;
4. event headers and predecessors; and
5. publish bodies.

This preserves the current no-resurrection property. A subscriber cursor never
causes tombstone reconciliation to be skipped.

### 10.3 Tombstone garbage collection

Age alone is not sufficient to delete a tombstone. A tombstone may be forgotten
only after a certified per-author compaction floor lies beyond both:

- the target publish event; and
- the kill event.

Any later event at or below that floor is rejected as expired, so an old body
cannot resurrect even after the explicit tombstone body has been removed.

## 11. Replay frontier and anti-entropy

### 11.1 Replacing scalar `since`

One scalar timestamp or dense topic sequence cannot describe progress across
independent author lanes. The leaderless API uses an opaque frontier:

```text
TopicFrontierV1 {
  topicId,
  policyId,
  authorTrieRoot,
  tombstoneRoot,
  compactionRoot,
  forkProofRoot,
  createdAtHint
}
```

The author trie is keyed by `authorId`. Each leaf commits to:

```text
AuthorFrontierLeaf {
  authorId,
  acceptedHeadSeq,
  acceptedHeadEventId,
  compactedThroughSeq,
  frozenAtEventId,
  tombstoneDigest
}
```

A small topic may inline its author leaves. A large topic stores a content-addressed
frontier manifest and exchanges Merkle branches only for differing authors. The
cursor is portable because it names replicated content, not server-local session
state.

### 11.2 Sync protocol

A reconciliation session proceeds as follows:

1. Exchange topic summary roots and policy identifiers.
2. Descend the author trie only where roots differ.
3. Exchange compaction evidence and fork proofs first.
4. For each differing lane, exchange head metadata and find the newest common
   predecessor or certified floor.
5. Request missing event headers in bounded batches.
6. Request bodies permitted by replay and retention policy.
7. Revalidate, persist, and update receipts.
8. Repeat until roots match or the session budget expires.

The protocol is resumable and idempotent. Every request and response has count,
byte, CPU, and time budgets. Failure to finish one session is not failure of the
topic; the next renewal continues from newer roots.

### 11.3 Subscription modes

Recommended API modes are:

- `from: "all"` — all retained visible events after certified floors;
- `from: "heads"` — the visible head of each active author lane;
- `from: { tail: N }` — the last `N` events in the serving snapshot's canonical
  linearization;
- `from: FrontierRef` — reconcile from a prior opaque frontier; and
- no `from` — live committed events plus renewal repair from the subscription's
  current frontier.

Legacy `since: <timestamp>` cannot be translated exactly. `since: "latest"` may
map to `{tail: 1}` for compatibility, but on an open multi-author topic it means
"the final item in this snapshot's deterministic view," not a permanently
authoritative latest event. Owner-only topics have one lane and retain the familiar
meaning.

## 12. Renewable delivery DAG

### 12.1 Subscription state

Each subscriber or relay maintains:

```text
SubscriptionLease {
  topicId,
  primaryUpstream,
  standbyUpstream,
  leaseExpiry,
  renewalAt,
  frontierRef,
  lastCommittedEventSeen,
  pathDiversity
}
```

The two upstreams should be failure-diverse where possible. They may be retention
holders or forwarding relays. Neither is a topic authority.

### 12.2 Renewal as repair

Every renewal:

- proves the child is still live;
- refreshes expiring parent state;
- reports a compact frontier;
- detects missing committed events;
- validates that primary and standby remain reachable and diverse;
- promotes the standby when the primary is unhealthy; and
- discovers a replacement standby before the promoted lease becomes singular.

The steady-state control loop is therefore also the failure-recovery loop. No
separate tree-rebuild election is needed.

### 12.3 Fan-out

A committed event may enter the DAG from any node holding the event and a valid
retention certificate. Relays verify the certificate, deduplicate by `eventId`,
update their frontier, and forward once per downstream lease.

Receiving the same event on primary and standby paths is expected. Duplicate
suppression is local and bounded. Application exactly-once delivery remains keyed
by `(topicId, eventId)`.

### 12.4 Path loss

- **Primary loss:** promote standby immediately and start replacement discovery.
- **Standby loss:** keep primary, discover a new diverse standby.
- **Both lost:** route toward the topic region and eligible holders, establish one
  path, replay from frontier, then establish the second.
- **Relay overload:** stop admitting new children, shorten advertised capacity,
  and allow leases to migrate naturally.
- **Partition:** retain reachable leases, accept locally committable writes, and
  reconcile when a cross-partition path reappears.

## 13. Compaction and bounded retention

### 13.1 Separate cache eviction from semantic expiry

Local memory pressure may evict a body if other valid holders remain. It must keep
enough header, lane, receipt, and tombstone metadata to detect gaps and prevent
resurrection. This is cache eviction, not protocol expiry.

Semantic expiry advances a certified per-author floor:

```text
CompactionFloor {
  topicId,
  authorId,
  throughSeq,
  throughEventId,
  policyId,
  holderReceipts[],
  floorId
}
```

The certificate says the events through the named prefix are outside the supported
replay window and that the holders retain the compacted index needed to reject
their reintroduction.

Receipts do not give holders discretion to erase arbitrary history. A compaction
floor is valid only when every verifier can recompute that it satisfies the
immutable retention policy from the named converged frontier. Holder signatures
attest possession of the compacted index; the deterministic policy predicate
authorizes the boundary.

Version one's semantic retention rules should therefore be state-based, such as
"retain the newest `N` accepted events per author" or a deterministic topic-view
count. Wall-clock age may guide cache placement and repair priority, but it must
not by itself authorize a canonical floor. A future time-based semantic policy
would need a separately specified trustworthy-time mechanism.

### 13.2 Concurrent floors

Floors are compared per author. A higher valid floor dominates a lower one only
when the higher floor's hash chain includes the lower floor. Concurrent or
incompatible claims do not merge; they become evidence of holder or author fault
and the safer lower verified floor remains active.

Topic-wide count limits are applied to a converged snapshot by deriving per-author
floor proposals from the deterministic view. A holder must not independently
delete semantic history merely because its partial view reached a local count.

### 13.3 Fairness

Open topics need per-author bounds so one author cannot consume the entire pending
or retained budget. Initial policy should include:

- maximum event and message size;
- live-ingress rate per author;
- retained bytes per author;
- pending predecessor count and bytes per author;
- maximum active author lanes per topic cell;
- proof-of-work escalation under pressure; and
- fair-share body eviction before semantic compaction.

## 14. Security and abuse model

### 14.1 Malicious author

A malicious author can:

- emit undesirable but valid content;
- manipulate its display timestamp;
- withhold predecessors;
- create gaps at ingress nodes;
- fork its lane; or
- generate many author identities if identity creation is cheap.

It cannot forge another author, reorder an accepted unique prefix, retract another
author's event, or force a fork in another lane. Forking freezes only its own lane.

### 14.2 Malicious holder

A malicious holder can withhold, delay, lie about capacity, censor its downstreams,
or sign a receipt and later discard data. Expiring receipts, multiple holders,
failure-domain diversity, multi-ingress publication, anti-entropy, and renewable
delivery paths reduce these risks. A contradictory signed receipt is durable fault
evidence but cannot by itself recover lost data.

### 14.3 Eclipse and Sybil risk

Rootlessness removes a named root target but does not remove eclipse risk. An
attacker controlling all apparent eligible holders or both subscriber upstreams
can still censor or falsely satisfy naive replica counts.

The retention and delivery policies must therefore measure identity cost and
diversity, not merely connection count. Tests must include correlated identities,
same-prefix holders, adversarial routing neighborhoods, and churn targeted at the
topic region.

### 14.4 Clock manipulation

A future or past `authorTs` may affect an approximate-time UI but cannot:

- change the canonical merge;
- pin an event against eviction;
- make a kill win;
- authorize a stale event without live-ingress or prior-retention evidence; or
- make a retention certificate valid.

This is the architectural reason to keep clocks out of convergence.

## 15. Component boundaries

The target implementation should expose the following internal interfaces:

### `AuthorEventCodec`

- builds, signs, parses, hashes, and verifies `AuthorEventV1`;
- encodes and compares `U64Hex` safely; and
- derives event and content identifiers.

### `TopicPolicy`

- resolves and validates the immutable descriptor;
- enforces owner/open write rules;
- resolves retention and delivery policy objects; and
- evaluates admission limits.

### `LaneIndex`

- holds accepted author prefixes;
- indexes pending events by predecessor;
- detects forks and constructs proofs;
- advances per-author frontiers; and
- exposes deterministic lane summaries.

### `TopicStore`

- persists event headers, bodies, kills, receipts, certificates, and floors;
- materializes visible state;
- computes canonical digests;
- distinguishes cache eviction from semantic compaction; and
- never owns subscription paths.

### `RetentionEngine`

- selects eligible diverse holders;
- transfers state;
- issues and verifies exact receipts;
- assembles certificates; and
- repairs expired or under-diverse retention.

### `SyncEngine`

- compares frontier Merkle roots;
- reconciles author lanes;
- processes floors, proofs, and tombstones first;
- enforces batch budgets; and
- is shared by holder repair and subscriber replay.

### `DeliveryDag`

- manages primary and standby leases;
- performs renewal-driven repair;
- forwards certified events;
- suppresses duplicates; and
- never decides event validity or order beyond invoking the other components.

### `TopicLocator`

- finds reachable eligible holders and relays;
- ranks path diversity and observed service health;
- treats routing results as candidates, not authorities; and
- supports event-driven invalidation when paths fail.

The prior `StampAuthority` interface has no equivalent in this profile.

## 16. Wire profile

The exact frame encoding remains an implementation task, but the protocol requires
at least these logical messages:

```text
EVENT_PUT             AuthorEventV1 + prior retention evidence
EVENT_RECEIPT         RetentionReceiptV1
EVENT_CERT            RetentionCertificateV1

SUBSCRIBE             topicId + mode/frontier + lease request
SUBSCRIBE_OK          lease + upstream role + summary roots
SUB_RENEW             lease + frontier roots + health
SUB_PROMOTE           standby promotion notice

TOPIC_SUMMARY         frontier/tombstone/compaction/fork roots
AUTHOR_SUMMARY_REQ    bounded trie branch request
AUTHOR_SUMMARY        bounded author leaves
LANE_DELTA_REQ        author + predecessor/floor + body policy
LANE_DELTA            floors/proofs/kills/headers/bodies

COMPACTION_PROPOSE    per-author floor proposal
COMPACTION_RECEIPT    exact compacted-state receipt
```

Every frame is versioned and bounded. Unknown leaderless frames are forwarded only
under an explicit capability rule; they are never interpreted as legacy root
traffic.

## 17. Failure behavior

| Failure | Required behavior |
|---|---|
| Ingress dies before any receipt | Author retries the same event through another ingress |
| Ingress dies after one receipt | Surviving holder continues replication; author retry is idempotent |
| Holder count falls below `W` | Event loses current commit evidence; repair seeks new receipts and status becomes explicit |
| Holder count remains at least `W` but below `R` | Continue serving and repair in background |
| Subscriber primary dies | Promote standby and reconcile frontier |
| Both upstreams die | Re-route to holders/relays, replay, then restore diversity |
| Network partitions | Each partition progresses where policy can be satisfied; lanes converge after healing |
| Same author writes in two partitions | If both extend the same head, the lane forks and freezes at that head |
| Different authors write in two partitions | Both lanes progress and later merge without conflict |
| Kill arrives before target | Retain provisionally, process before exposing a later body |
| Old killed body reappears | Tombstone or compaction floor suppresses it |
| Author clock is far future | Direct freshness policy may reject; canonical state is never reordered by the clock |
| Pending predecessor never arrives | Bound and eventually evict pending body; do not advance the lane |
| Conflicting compaction floors | Retain the lower safe floor and surface signed fault evidence |

## 18. Migration plan

### Phase 0 — reference model

Build a pure deterministic model before changing network code. The model accepts
events in arbitrary permutations and emits lane states, visible sets, proofs,
frontiers, and canonical digests. Exhaustive small-state permutation tests are a
release gate.

### Phase 1 — component extraction

Complete the current refactor boundaries without changing legacy behavior:

- isolate envelope validation;
- isolate `TopicStore` from delivery roles;
- make sync operate on an abstract frontier;
- make retention receipts honest and exact; and
- make delivery leases independent of root identity.

### Phase 2 — author-lane shadow index

On a test profile, derive diagnostic per-author indexes from current signed
envelopes. Do not treat current `seq` as contiguous and do not expose the shadow
index as protocol truth. Measure:

- restart monotonicity;
- multi-device author-key reuse;
- observed gaps and duplicates;
- author cardinality per topic;
- frontier size; and
- replay and reconciliation cost.

This phase validates assumptions and informs limits.

### Phase 3 — new wire domain and topic namespace

Implement `author-lanes-v1` only for newly derived topics. Require signed authors,
contiguous per-topic counters, predecessor links, and new event IDs. Legacy and
leaderless events do not merge.

### Phase 4 — adaptive retention

Enable multi-ingress writes, exact holder receipts, retention certificates, and
Merkle lane reconciliation. Keep delivery conservative until retention behavior
passes churn and partition gates.

### Phase 5 — renewable delivery DAG

Enable primary/standby subscription leases and event injection from any certified
holder. Measure orphan interval, repair latency, duplicate load, and delivery
continuity under correlated churn.

### Phase 6 — opt-in production profile

Expose leaderless topics as an explicit application choice. Existing topics remain
on their current semantics. No implicit migration or compatibility translation is
permitted.

## 19. Design process and decision gates

### 19.1 Resolved decisions

| Decision | Resolution | Reason |
|---|---|---|
| Topic-wide dense order | Not required | Per-author order and convergence satisfy the product need |
| Write sequencer | Removed | It provides no required semantic after the order decision |
| Cross-author clocks | Non-authoritative | Prevents a disguised weak timekeeper |
| Author chain | Contiguous sequence plus predecessor hash | Detects gaps, omission, and equivocation directly |
| Fork resolution | Freeze affected lane at common prefix | Deterministic, fault-contained, no arbitrary rollback |
| Anonymous writes | Ephemeral signed identity required | Ordering and creator-authorized kill require an author |
| Legacy coexistence | Separate topic namespace and wire domain | Existing IDs and replay cursors have different meaning |

### 19.2 Open decisions

The following require evidence before protocol freeze:

1. Exact `W`, `R`, `D`, receipt lifetime, and diversity policy.
2. Holder eligibility and Sybil-cost mechanism.
3. Frontier manifest chunking and trie fan-out.
4. Pending-predecessor bounds and recovery request schedule.
5. Default replay behavior for open topics with many authors.
6. Compaction proposal and certificate thresholds.
7. Whether provisional delivery is exposed in the first production profile.
8. How applications declare or discover distinct keys belonging to one human or
   multi-device identity without weakening lane semantics.
9. Maximum author cardinality and fair-share storage policy.
10. Whether content equality needs a standardized `contentId`.

### 19.3 Falsification-first prototypes

Each open decision should be tested by trying to break the design, not only by
demonstrating a happy path.

#### Prototype A — convergence kernel

Generate valid, invalid, duplicated, missing, forked, killed, and compacted events.
Deliver every small set in every permutation. Require identical state digests.

#### Prototype B — frontier scale

Measure summary bytes, diff CPU, and replay latency for topics with 1, 10, 1,000,
and 100,000 active authors under sparse and dense updates.

#### Prototype C — retention under churn

Compare fixed three-holder retention with adaptive `W/R/D` policies under the same
independent and correlated failure traces. Measure certified possession, not
membership intention.

#### Prototype D — delivery continuity

Compare one renewable upstream, primary/standby, and higher redundancy under the
existing high-churn simulator. Determine the measured value of each extra path.

#### Prototype E — adversarial authors

Exercise timestamp manipulation, predecessor withholding, fork floods, ephemeral
identity floods, oversized pending chains, and kill-before-body patterns.

### 19.4 Release gates

#### Gate 1 — deterministic convergence

All replicas with the same valid input set produce identical canonical digests
across arrival permutations, restarts, and sync batch boundaries.

#### Gate 2 — per-author integrity

No accepted lane can contain a missing predecessor, duplicate position, or
ambiguous successor. Forks freeze exactly one author at the same prefix everywhere.

#### Gate 3 — tombstone safety

No body becomes visible after an authorized kill or certified floor, including
kill-before-body, replay, handoff, compaction, and stale-peer reinjection cases.

#### Gate 4 — honest durability

Every `committed` outcome is backed by the configured number and diversity of
current exact receipts. Every loss of that evidence is observable.

#### Gate 5 — bounded repair

Pending chains, Merkle diffs, renewal work, duplicate caches, receipts, and child
leases remain within explicit limits during sustained churn and adversarial input.

#### Gate 6 — delivery advantage

The renewable delivery DAG materially improves the measured orphan interval and
end-to-end delivery rate over the current tree under identical fault traces.

#### Gate 7 — compatibility isolation

No legacy client, bridge, cursor, or event can be misinterpreted as leaderless
traffic, and no leaderless topic silently falls back to root-sequenced semantics.

## 20. Required deterministic tests

At minimum, the implementation suite must cover:

- one author, in-order delivery;
- one author, reverse arrival order;
- missing predecessor followed by repair;
- duplicate event over multiple ingress and delivery paths;
- two authors with every arrival interleaving;
- partitioned writes by different authors followed by convergence;
- same-author concurrent successors producing identical fork proofs;
- fork descendants arriving before and after proof completion;
- multiple genesis events from one author;
- author restart after retrieving the verified head;
- author state loss attempting an invalid second genesis;
- kill after target;
- kill before target;
- forged kill by another author;
- tombstone arriving through a different path from the body;
- cursor ahead of the target body but missing its tombstone;
- semantic compaction followed by stale-body reinjection;
- conflicting or insufficient compaction receipts;
- receipt expiry and adaptive replacement;
- one retention holder loss;
- correlated holder loss in one failure domain;
- primary upstream loss;
- primary and standby loss;
- replay/live race with application exactly-once delivery;
- malicious future and past author timestamps;
- 64-bit sequence boundary encoding and comparison;
- pending-predecessor quota exhaustion;
- open-topic author-flood fairness;
- frontier manifest loss and reconstruction; and
- byte-identical state digests across process restart and implementation language.

## 21. Operational observability

Operators and simulations need metrics that reveal semantic health rather than only
role count:

- active author lanes per topic;
- accepted, pending, compacted, and frozen events;
- predecessor gap count and age;
- fork proofs by author and topic;
- active tombstones and provisional kills;
- canonical digest disagreement duration;
- frontier manifest size and diff depth;
- receipt count, age, and failure-domain diversity per event cohort;
- committed-to-under-replicated transitions;
- repair bytes and time to restore `R`;
- subscriber primary/standby diversity;
- lease promotion and dual-path loss counts;
- replay lag by author lane;
- duplicate suppression rate;
- provisional versus committed delivery; and
- semantic compaction floor by author.

No dashboard should report a topic as healthy solely because it can name three
members. Health is demonstrated by convergent state, current possession evidence,
and working renewable delivery paths.

## 22. Consequences

### Benefits

- no root or timekeeper failover on the write path;
- writes by different authors continue independently during partitions;
- retention and delivery scale and heal independently;
- subscriber repair does not move topic authority because there is none;
- cryptographic author lanes make gaps and equivocation explicit;
- creator-authorized kill remains natural;
- adaptive holders avoid treating the number three as an invariant; and
- the system's steady-state subscription behavior is also its repair behavior.

### Costs

- author keys become stateful writers that must preserve or retrieve lane heads;
- one author key cannot safely be used concurrently on independent devices;
- replay cursors become frontier objects rather than scalars;
- deterministic list order may change after late discovery;
- large open topics require scalable frontier manifests and fair-share policy;
- retention certificates and compaction floors add protocol objects;
- fork handling is deliberately strict; and
- existing root-sequenced topics cannot migrate transparently.

## Bottom line

Once per-author order and deterministic convergence are accepted, the triumvirate's
timekeeper is solving a problem Axona no longer requires. The stronger base is not
a different committee size. It is a decomposition:

> **Signed author lanes provide order. Adaptive receipt-confirmed holders provide
> durability. Renewable primary/standby paths provide delivery. Merkle
> anti-entropy makes all three self-healing under churn.**

The resulting service remains pub/sub at its center. Authors publish; subscribers
renew and reconcile; holders repair retained history; relays forward without
becoming authorities. Churn changes paths and replica placement, but it does not
require the system to elect a new truth.
