# Axona Kernel Refactor — Triumvirate-Readiness Review

**Author:** Aster  
**Date:** 2026-08-08  
**Audience:** David, axona.bot, Orion  
**Status:** Review addendum for incorporation before refactor Phase 0  
**Documents reviewed:** `axona-docs/architecture/code-refactor-plan.md`, current `@axona/protocol` testnet source at v4.62.1, and the triumvirate-root design discussion through v0.4  

## Executive decision

The kernel refactor should proceed before the triumvirate-root project. The existing phase order remains correct. Implementing both projects together—or implementing the triumvirate first—would mix structural migration with new distributed behavior and make failures difficult to attribute or roll back.

The refactor plan does, however, need several amendments before Phase 0. They should not implement cohort membership, timekeeper election, or active co-roots. Their purpose is narrower:

> Do not make today's singleton-root coupling, root-specific names, weak cache summary, or mixed write-ingress pipeline permanent parts of the refactored architecture.

The intended outcome is a behavior-preserving refactor whose seams allow the later triumvirate project to add:

- three serving roots;
- one transferable timekeeper duty;
- exact retained-state receipts;
- capability-aware cohort selection;
- independent subscriber forests;
- cohort membership and timekeeper terms;

without reopening the façade, store, routing, delivery, durability, and wire-dispatch layers at the same time.

## Scope boundary

### This review recommends changing now

- ownership boundaries and service names;
- internal interfaces around placement, stamping, storage, delivery, discovery, and evidence;
- characterization fixtures and reliability-ledger entries;
- contract-registry outcome types and correlation vocabulary;
- sync-policy summary/evidence abstraction;
- documentation language that currently presents singleton-root coupling as timeless architecture.

### This review does not authorize changing now

- current root-selection behavior;
- current wire formats or public API;
- cohort member sets or timekeeper fields;
- quorum voting or election frames;
- subscriber redistribution across three roots;
- delivery thresholds such as R2 versus R3;
- direct root-to-root connection management;
- a generic consensus framework;
- any test whose expected result requires triumvirate behavior.

Feature behavior remains outside the refactor. Any behavior correction discovered during refactoring must be isolated in a separate commit, fixture, gate, and rollback decision.

## Baseline correction before Phase 0

The master plan was written against kernel v4.61.0. The current testnet baseline is v4.62.1 at commit `8f34759`, including the dead-root eviction/write-flight work and the E3 sender-plus-incarnation acknowledgment fence.

Before Phase 0 begins:

1. Update measured line counts and source anchors to v4.62.1.
2. Move GH #28/#422 from an open write-blackhole item to a protected regression family.
3. Add the live-gate evidence to the reliability ledger:
   - rooting-relay SIGKILL succession observed in 11 seconds;
   - zombie-window write recovery observed in 29 seconds instead of the previous 2h06m unbounded case;
   - Howard-shape chunked transfer 30/30;
   - axonSpec 11/11, excluding the harness's pre-existing five-second setup timeout.
4. Preserve the source-and-incarnation-bound ingest acknowledgment as an invariant fixture.
5. Keep the distinct durability-confirmation issue visible: current cohort durability evidence is not yet an exact application-level proof that a named receiver retained a particular message.

This update matters because the refactor must preserve the system that actually exists when Phase 0 starts, not the previous release's incident state.

## Finding 1 — Separate root service from stamp authority

### Current coupling

Current `rootClaim` and role-nature language make `ROOT` mean all of the following:

- closest serving anchor;
- stamp and dense-sequence authority;
- beacon authority;
- write verifier;
- cache holder;
- replica principal;
- subscriber/child-forest root;
- replay and fan-out service.

That coupling accurately describes the singleton-root protocol but is not a safe target abstraction. In the later triumvirate design, all three nodes provide cache, replay, subscriptions, children, and fan-out, while only the selected timekeeper stamps PUB/KILL events.

### Required refactor decision

Model the following responsibilities separately, while keeping them bound together in the current compatibility implementation:

```text
LocalPlacement
  current: ROOT | CHILD | BACKUP

Retention
  HOSTED | APP_SUBSCRIBED | HISTORY | METRICS_LEASE

ServingTree
  subscriber/child ownership, renewals, replay, rehome, fan-out

StampAuthority
  current: local singleton root
  future: selected cohort timekeeper

AuthorityDiscovery
  current: one root identity + root epoch
  future: serving cohort + configuration + timekeeper term

OperationalCapability
  SERVE | DRAINING | FORWARD_ONLY | BRIDGE
```

Do not populate future cohort or timekeeper state during the refactor. The current implementation can remain:

```text
if localPlacement == ROOT:
    local node is serving root and StampAuthority
```

The important point is that the interface, store, and delivery tree no longer depend on that equivalence.

### Invariant language

"A topic has exactly one root" should remain documented as the current negotiated protocol's behavior, not be elevated into an unversioned architectural law that all future versions must obey.

The durable authority law is:

> For one topic authority term, at most one stamp authority may create externally committed stamps; conflicting authority claims converge by versioned evidence.

The current singleton-root profile satisfies this by binding root service and stamp authority to the same node. The future cohort profile will satisfy it with a transferable timekeeper.

## Finding 2 — Add three missing service owners

The master plan names `TopicControl` and `SyncEngine`, but not authoritative owners for the topic store, write-ingress pipeline, or subscriber forest. Leaving these unnamed would produce a smaller façade while preserving the most important pub/sub ownership overlap.

### TopicStore

Owns:

- cache entries and byte/count/TTL bounds;
- tombstones and tombstone-first ingestion;
- `msgId` deduplication;
- timestamp/sequence high-water and low-water;
- state summary/digest generation;
- snapshot and delta export;
- retained-state queries used by receipts;
- cache metrics.

Must not own:

- whether the local node is root, backup, child, cohort member, or timekeeper;
- where a snapshot is sent;
- who owns a subscriber branch;
- election or capacity policy.

The existing `topicStore.js` is the natural seed. `SyncEngine` should request `TopicStore.snapshot()` or `TopicStore.delta(cursor)` rather than reaching into `role.cache` and `role.tombstones` directly.

### WriteIngress and StampAuthority

Current root ingress performs validation, deduplication, stamping, cache mutation, durability opening, and delivery in one handler path. Refactor it into an explicit pipeline:

```text
WriteIngress.validate(authorEnvelope)
WriteIngress.deduplicate(topicStore, msgId)
StampAuthority.issue(topic, authorityContext)
TopicStore.apply(stampedEntry)
DurabilityLedger.open(stampedEntry)
TopicDeliveryTree.fanout(stampedEntry)
```

For current behavior, `StampAuthority.issue()` uses the local root's `lastTs` and `seq`. The later triumvirate implementation can replace that adapter with "forward to current timekeeper and await the stamped result" without changing validation, storage, durability, or delivery ownership.

This extraction is behavior-preserving and belongs in the refactor. It is not implementation of the future timekeeper.

### TopicDeliveryTree

Owns:

- subscriber and child maps;
- seating and renewal;
- replay-on-seat;
- child delegation;
- upstream attachment and rehome;
- fan-out and duplicate suppression at the delivery boundary;
- branch teardown and transfer during graceful drain.

The DHT/routing plane should own paths, lookups, synapses, and route execution—not pub/sub subscriber ownership. The phrase "tree maintenance" in the routing layer must be clarified so the axonic delivery tree is not absorbed into `GreedyRouter` or `SynaptomeManager`.

This seam is especially important later: three co-roots will own three subscriber forests, and loss of one co-root must move only its branch ownership while timekeeping and retained-state recovery proceed independently.

## Finding 3 — Replace the universal cache-signature claim

The master plan calls `count : high-water : tombstone-count` the universal quench for replication loops. It is useful as a cheap send-suppression heuristic, but it is not proof that two caches hold the same set.

Two holders can have equal counts, equal high-water timestamps, and equal tombstone counts while containing different message IDs. A future three-member cohort requires exact evidence about which holder retained which entry and whether complete retained sets converge.

### Required abstraction

Each sync policy must name a summary/evidence strategy:

```text
summaryStrategy:
  EMPTY
  TIMESTAMP_FLOOR
  COUNT_HIGHWATER_HINT
  RETAINED_SET_DIGEST
  EXACT_MESSAGE_RECEIPT
```

The current `COHORT_REPLICATE` behavior may continue using `COUNT_HIGHWATER_HINT` for rate gating. The refactor must not label it equality proof or permit durability to infer exact retention from it.

No Merkle tree or new digest wire format is required during the refactor. The interface must merely avoid sealing the existing heuristic into every future policy.

## Finding 4 — Establish a typed evidence hierarchy

The frame registry's normalized outcome type should distinguish the following facts:

```text
ROUTED
  A transport or routing hop accepted/forwarded the frame.

INGESTED
  The intended write authority accepted the operation.

RETAINED
  An authenticated named holder confirms that it stores the exact entry.

COMMITTED_R2
  Two named cohort holders retain the entry.

COMMITTED_R3
  All three cohort holders retain the entry.
```

These are not interchangeable. A `consumed` routing verdict is not retention; successful dispatch is not ingestion; self-delivery is not cohort durability.

The v4.62.1 write-flight acknowledgment is the correct precedent: success is correlated to the message and bound to the expected sender plus authority incarnation.

### Correlation contract

The internal registry/correlation representation should be capable of binding:

```text
topicId
operation
msgId
authenticated sender
authority reference
configuration reference (optional in current profile)
retained-state assertion
state digest (optional by policy)
```

No new fields must be emitted on current wire frames. The contract types must simply avoid assuming that `rootId + rootEpoch` is the only form of authority.

## Finding 5 — Introduce a versioned authority reference and topic locator

Current root beacons, hints, tombstones, and write flights use a raw root identity and root epoch. Refactoring these surfaces directly around `rootHex` and `rootEpoch` would force broad rewrites when stamp authority moves to a timekeeper.

Use an internal versioned reference:

```text
AuthorityRef {
  kind,          // current: singleton-root; future: timekeeper
  nodeId,
  incarnation    // current: root epoch; future: timekeeper term
}
```

Current wire adapters continue encoding/decoding the existing fields.

Likewise, consumers should query a `TopicLocator`:

```text
TopicServiceView {
  servingNodes,
  writeAuthority,
  configuration,
  observedAt,
  evidence
}
```

The current locator returns one serving root and its known backups. The future locator returns the serving triumvirate, cohort configuration, and timekeeper. Routing, write flights, delivery, and sync should consume the view rather than reading raw beacon maps independently.

## Finding 6 — Preserve candidate-set lookup and capability admission

The extracted `LookupService` should expose bounded candidate sets and predicate filtering rather than only a "single closest root" convenience:

```text
findClosest(targetId, {
  limit,
  exclude,
  eligibility,
  budget
})
```

This supports current α-parallel closest-node discovery without a behavior change and later permits:

- selecting three closest eligible serving nodes;
- scanning past candidates that decline service;
- excluding the infrastructure bridge from root service;
- letting a bridge or forward-only routing terminus relay PUB/KILL/SUB to an eligible server;
- replacing a lost cohort member without rebuilding routing logic.

Operational capability must remain separate from reachability. A live connected node may be overloaded, draining, background-bound, bridge-only, or unable to retain a root cache.

## Finding 7 — Keep one scheduler and typed obligations

The current single `refreshTick`/sweep pattern is valuable. Write flights demonstrate the right discipline: one bounded state record per flight and no independent timers to leak.

The refactor should expose an injected clock and one scheduler owner. Topic services register bounded sweeps/obligations; they do not install arbitrary per-topic timers.

Later timekeeper heartbeats, failure detection, member replacement, draining, and election deadlines can then become additional typed obligations in the same scheduler without introducing a competing timing subsystem.

`PeerLifecycle` may own the master timer's creation and teardown. `TopicControl` owns the meaning and transitions of topic deadlines.

## Required amendments by phase

### Phase 0 — Characterization harness

Add to the existing deliverables:

- v4.62.1 baseline and source map;
- inventory of every singleton-root assumption;
- ownership classification for every per-topic field:
  - placement;
  - retention/store;
  - delivery tree;
  - stamp authority;
  - sync evidence;
  - capability/admission;
- golden traces for:
  - root and backup abrupt loss;
  - two sequential root/cohort losses inside and outside the repair window;
  - child-tree rehome and cache replay-up;
  - source/epoch-bound ingest ack acceptance and rejection;
  - full snapshot versus keepalive durability evidence;
  - duplicate/reordered stamped ingest;
  - bridge-as-routing-only behavior;
- explicit reliability-ledger distinction between current behavior, known defect, and future design requirement.

Phase 0 tests still assert singleton-root behavior. Their added value is showing which component owns each fact and effect.

### Phase 1 — Contract registries in shadow mode

Add to each applicable registry row:

- owning service from the expanded ownership map;
- authority reference shape;
- evidence level produced and required;
- exact correlation fields;
- whether the response proves routing, ingestion, or retention;
- capability/version range;
- bounded payload/work budget;
- idempotency key;
- terminal negative outcome.

Continue shadow-only operation. No acceptance semantics change.

### Phase 2 — Façade and service decomposition

Add these named seams behind the existing façade:

- `TopicStore`;
- `WriteIngress`;
- `StampAuthority` with current singleton-root implementation;
- `TopicDeliveryTree`;
- `TopicLocator`;
- capability/admission policy owned by `TopicControl` or a dedicated `RoleAdmission` service.

The existing `AxonaPeer` API and wire behavior remain unchanged. Differential traces must prove the extracted pipeline preserves validation, stamp, cache, durability, delivery, renewal, and teardown order.

### Phase 3 — Placement lifecycle authority

Clarify that the generalized authority owns local placement transitions, not all future cohort, storage, delivery, and timestamp behavior.

Required properties:

- placement, retention, delivery ownership, and stamp authority are separate concepts;
- current `ROOT | CHILD | BACKUP` remains the compatibility implementation, not a closed architectural universe;
- transition records contain an extensible authority reference rather than hard-coded root identity fields;
- capability/admission gates are consulted before planting remote standing state;
- ordinary placement changes do not directly mutate the topic store or subscriber forest except through named effects.

Do not create `CohortControl` or timekeeper election state in this phase.

### Phase 4 — Sync engine sole repair ownership

Amend policy rows to declare:

- initiator and counterpart relationship rather than only root/backup nature;
- summary strategy;
- evidence produced;
- receipt/correlation rule;
- terminal negative outcome;
- state planted and its evictor;
- retry and work bounds.

Move snapshot and delta construction behind `TopicStore`. Keep hot-path delivery and seat replay outside `SyncEngine`.

The existing `COHORT_REPLICATE` wire behavior can remain. Internally, avoid making "root pushes passive backup" the only representable cohort relationship.

Any change from routed/dispatch evidence to exact receiver-retention evidence is a behavioral correction. It should be implemented after the relevant structural extraction in a separately reviewed and gated change—not smuggled into mechanical moves.

### Phase 5 — Normative specification

Publish the singleton-root behavior as the current negotiated capability/profile. The contract must be accurate about present frames while permitting a later profile such as `root-cohort-v1`.

The normative artifacts should distinguish:

- serving placement from write/stamp authority;
- routing outcomes from retained-state outcomes;
- current root epoch from the generic authority-incarnation concept;
- heuristic sync summaries from exact evidence;
- current singleton locator responses from versioned service views.

Do not publish unimplemented triumvirate frames or states as part of the refactor specification.

## Suggested target ownership map

| Concern | Sole policy owner | Data owner | Effect owner |
|---|---|---|---|
| Public API | `AxonaPeer` façade | composed services | façade delegates only |
| Peer start/stop/join/leave | `PeerLifecycle` | lifecycle state | scheduler/transports through interfaces |
| Synapse lifecycle | `SynaptomeManager` | synaptome | transport connector |
| Greedy routing | `GreedyRouter` | route-local state | DHT transport adapter |
| K-closest discovery | `LookupService` | bounded lookup flights | router/transport adapter |
| Topic placement | placement authority under `TopicControl` | placement record | named transition effects |
| Capability/admission | `RoleAdmission` or explicit `TopicControl` subpolicy | capability record | accept/decline/drain effects |
| Topic data | `TopicStore` | cache/tombstones/stamp high-water/digest | none beyond local mutation |
| Write processing | `WriteIngress` | bounded pending write record | `StampAuthority`, store, durability, delivery |
| Stamp issuance | `StampAuthority` | current authority clock/sequence | returns stamped entry only |
| Subscriber forest | `TopicDeliveryTree` | subscribers/children/upstream | SUB/DELIVER/replay/rehome |
| Repair/state transfer | `SyncEngine` | policy/flight ledger | router plus `TopicStore` import/export |
| Durability | `DurabilityLedger` | evidence state per message | no delivery mutation |
| Authority discovery | `TopicLocator` | observed service view | lookup/beacon adapters |
| Wire validation/correlation | per-boundary registry | contract metadata | invokes owning service |

## Refactor exit conditions for future readiness

The refactor is ready for the later triumvirate project when all of the following are true:

1. No wire handler directly allocates a root stamp, mutates a cache, and fans out in one uninterruptible method.
2. `TopicStore` can import/export stamped state without knowing the node's placement.
3. `TopicDeliveryTree` can rehome a subscriber forest without changing stamp authority.
4. `StampAuthority` can be replaced without changing envelope validation, storage, or delivery interfaces.
5. Write-flight and receipt correlation use a versioned authority reference internally.
6. Registry outcomes distinguish routed, ingested, retained, and committed evidence.
7. Sync summaries are policy-selected and no heuristic is labeled universal equality proof.
8. Lookup returns bounded candidate sets and supports eligibility/admission filtering.
9. Root service, retention, delivery-tree ownership, and stamp authority have separate owners in the static ownership map.
10. All current singleton-root behavior remains covered by differential traces and mixed-version tests.
11. No triumvirate wire behavior or state exists in the shipping refactor unless separately authorized.

## Risks if the plan is not amended

Without these changes, the later triumvirate project would need to reopen:

- `rootClaim` because root placement still implies stamp authority;
- `wireHandlers` because ingress validation, stamping, storage, durability, and delivery remain coupled;
- `syncEngine` because root-to-passive-backup is hard-coded;
- `topicStore` because state summaries do not prove equality;
- `writeFlight` because flights are keyed only to singleton roots;
- routing and beacons because consumers read a single root directly;
- subscriber state because no delivery-tree owner exists;
- durability because routing/dispatch evidence cannot prove cohort retention.

That would make the triumvirate a second refactor plus a distributed-systems feature at the same time—the exact sequencing David wants to avoid.

## Recommendation to axona.bot

Keep the six-phase refactor sequence and shadow-first deployment discipline. Before Phase 0, revise the master plan to incorporate the ownership and contract amendments in this document.

The highest-value changes are:

1. explicitly add `TopicStore`, `WriteIngress`, `StampAuthority`, `TopicDeliveryTree`, and `TopicLocator` to the target architecture;
2. separate root service from stamp authority at the interface level while preserving their current binding;
3. replace the universal cache-signature claim with policy-selected summary/evidence strategies;
4. add the routed/ingested/retained/committed evidence hierarchy;
5. generalize internal authority and lookup references without changing current wire formats;
6. update Phase 0 to v4.62.1 and preserve the new dead-root eviction evidence as regression fixtures.

These are refactor decisions, not premature implementation of the triumvirate. They reduce the amount of code the later project must disturb and make its safety arguments independently testable.
