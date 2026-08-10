# Axona Pub/Sub Architecture Alternatives

**Status:** exploration proposal v0.1 — not implementation authorization  
**Date:** 2026-08-09  
**Audience:** David, Council, axona.bot  
**Scope:** alternatives to the singleton-root, axonic-tree, and triumvirate-root designs for a dynamic, self-healing pub/sub service under high churn

## Executive recommendation

Axona should not begin by choosing a different number of roots. It should first
separate the three responsibilities currently bundled into the word **root**:

1. **Sequencing:** who may assign the next authoritative topic stamp.
2. **Retention:** which nodes demonstrably hold committed messages and tombstones.
3. **Delivery:** which renewable paths carry replay and live events to subscribers.

The most promising alternative to the triumvirate is a **leased topic cell plus a
redundant subscription DAG**:

- a narrow, term-fenced sequencer lease preserves the current global topic order;
- an adaptive storage cell of eligible, failure-diverse holders retains committed
  events with exact retained-state receipts;
- subscribers and child relays maintain renewable primary and standby upstreams,
  forming a delivery DAG rather than a single rooted tree;
- storage membership changes do not rebalance subscriber branches;
- delivery-path failures do not change the stamp authority or storage cohort; and
- ordinary renewal remains the principal healing mechanism.

This design keeps the public pub/sub service and Axona's strongest existing idea —
soft-state subscription renewal — while making the internal architecture less
dependent on any particular serving root.

The recommended migration path is deliberately conservative:

1. harden the current singleton-root profile with honest receipts, event-driven
   rehome, replay-on-seat, and a standby upstream;
2. extract sequencing, retention, and delivery behind separate interfaces;
3. introduce an adaptive storage cell without changing delivery ownership;
4. activate the redundant delivery DAG; and
5. only then decide whether the sequencer should remain a transferable lease or be
   removed through a leaderless per-author log.

## Why revisit the root abstraction

The current root combines too many failure domains. It is simultaneously the:

- closest serving anchor;
- write verifier and stamp authority;
- cache and tombstone holder;
- replication principal;
- replay service;
- subscriber/child-forest owner; and
- initial fan-out point.

The triumvirate-readiness review already recommends separating `TopicStore`,
`WriteIngress`, `StampAuthority`, and `TopicDeliveryTree` while preserving current
behavior. That separation is more important than the later choice between one,
three, or many service nodes.

Axona's measurements also warn against treating root durability as the dominant
problem. The stability-election investigation found:

- 93% of missed deliveries were subscribers orphaned at an old root;
- only 7% were seated subscribers whose delivery route failed; and
- continuously reseating subscribers raised delivery from 41% to 91% without
  reducing root churn.

The triumvirate analysis reached a complementary result: the deployed topology
already produced roughly three warm holders, yet rapid churn still caused loss.
Increasing holder count purchased more repair communication and reduced loss, but
did not create a durability floor. Repair latency, possession evidence, subscription
continuity, and common-mode failure matter more than the number three by itself.

References:

- [`Pubsub-Stability-Root-Election-v0.1.md`](Pubsub-Stability-Root-Election-v0.1.md)
- [`axona-triumvirate-root-design-v0.1.md`](axona-triumvirate-root-design-v0.1.md)
- [`axona-refactor-triumvirate-readiness-review-v0.1.md`](axona-refactor-triumvirate-readiness-review-v0.1.md)
- [`Root-Management-v4.20.1.md`](Root-Management-v4.20.1.md)

## Requirements and preserved properties

Every candidate must be evaluated against the service Axona actually provides,
not only against live-message fan-out.

### Required service behavior

- signed publish and creator-authorized kill;
- bounded retained history;
- replay for late or returning subscribers;
- exactly-once application delivery through `msgId` deduplication;
- self-expiring subscriber and child state;
- dynamic recovery without an operator;
- graceful and abrupt node loss;
- bounded memory, repair traffic, and role population;
- forward-only behavior for incapable nodes and bridges; and
- explicit evidence distinguishing routed, ingested, retained, committed, and
  delivered outcomes.

### Semantics that may be negotiable

The decisive architectural fork is whether Axona requires one dense global order
for every topic.

- If topic-wide dense sequence and a scalar replay cursor are required, some
  fenced stamp authority remains necessary. It can be narrow and replaceable, but
  it cannot be wished away.
- If per-author order plus deterministic convergence is sufficient, Axona can use
  a leaderless log and remove the write-path sequencer entirely.

This choice should be explicit. A leaderless design that quietly emulates total
order with wall clocks will recreate a weaker, harder-to-audit sequencer.

## Design space

| Design | Churn behavior | Ordering | Retention | Principal cost |
|---|---|---|---|---|
| Hardened singleton root | Whole serving tree may rehome after root loss | Existing dense total order | Root plus receipt-honest warm holders | Root remains a service bottleneck |
| Triumvirate | About one third of branches move after one co-root loss | Transferable timekeeper | Three active serving holders | Membership, election, and three subscriber forests |
| Topic cell + redundant delivery DAG | Retention and delivery heal independently; most path failures switch locally | Narrow sequencer lease | Adaptive receipt-confirmed cell | Extra leases and sharper internal interfaces |
| Leaderless per-author log | No sequencer failover; any eligible holder may ingest | Per-author causal order with deterministic merge | Adaptive replicated cell | No dense topic sequence; frontier cursors |
| Pure gossip mesh | Rapid live-path graft/prune repair | Partial or arrival order | Opportunistic unless paired with stores | Traffic, duplicate suppression, weak late replay |
| Erasure-coded retention swarm | Strong cold-history survival under independent losses | Orthogonal to delivery | Any `k` of `n` fragments | Reconstruction and metadata overhead |
| Regional serving federation | Local failures disturb one region's subscribers | Global sequencer or merge policy required | Per-region copies | Cross-region reconciliation and partition semantics |

## Alternative A — hardened singleton root

This is the smallest change and the appropriate control baseline for every larger
experiment.

Keep one emergent root as the stamp and serving authority, with passive warm
holders, but add:

1. retained-state receipts before a holder is credited;
2. event-driven subscriber rehome on fresh authority evidence;
3. replay on every successful seat or reseat;
4. one hot standby upstream lease per child or subscriber relay;
5. failure-domain-aware holder selection where evidence exists;
6. seed-before-advertise replacement; and
7. typed terminal outcomes when no eligible serving node can be found.

The standby upstream should track authority term and committed high-water but need
not normally deliver the live stream. On primary loss it immediately requests
replay from `lastDelivered + 1`, becomes primary, and starts another standby
search. Brief dual delivery is acceptable because the application boundary already
deduplicates by `msgId`.

### Strengths

- directly attacks the measured subscriber-orphaning failure;
- preserves every current wire and ordering assumption;
- has the smallest mixed-version and security surface;
- provides an honest baseline for judging whether active co-roots are worth their
  control-plane cost.

### Limitations

- the root is still a write, replay, and initial-delivery bottleneck;
- standby leases reduce failover delay but do not remove root dependency;
- one root loss can still cause broad control-plane movement;
- storage width remains coupled to one root's repair scheduler.

## Alternative B — leased topic cell plus redundant subscription DAG

This is the recommended strategic design.

```text
publisher
    |
    v
write ingress ---> term-fenced sequencer lease
                         |
                         v
                  adaptive topic store cell
                    /    |    |    \
             holder A holder B ... holder K
                         |
                         v
              renewable delivery DAG
                 /                 \
          primary upstream     standby upstream
                 \                 /
                      child relay
                          |
                      subscribers
```

### B.1 Sequencer lease

`StampAuthority` is a narrow service. It validates the current authority term and
returns a stamp; it owns no subscriber map and need not own a large retained cache.

Illustrative state:

```text
StampLease {
  topicId,
  authorityTerm,
  holderId,
  committedSeq,
  committedTs,
  expiresAt,
  witnessSetId
}
```

The lease is granted or renewed only with evidence from a sufficient subset of the
current storage cell. A successor reconciles committed high-water before issuing
the first stamp in the next term. A stale lease cannot commit because storage
holders reject old-term writes.

The lease is deliberately not the same thing as a serving root. Losing it pauses
new PUB/KILL commits but does not remove retained history or subscriber paths.

### B.2 Adaptive storage cell

The topic store cell is selected through rendezvous or DHT candidate discovery
over eligible serving nodes. Its desired width is policy, not protocol identity.

Illustrative policy:

```text
quiet topic:        desired holders = 3
ordinary topic:     desired holders = 5
high-churn topic:   desired holders = 7
commit threshold:  2 or policy-selected W
repair target:      restore desired width asynchronously
```

A node counts as a holder only after an authenticated receipt proves it retained
the precise topic, authority term, message, tombstone state, and state digest.
Routing `consumed` is never retention evidence.

Selection should optimize for both locality and diversity:

- begin with a bounded XOR-near candidate band;
- exclude incapable, draining, and bridge nodes;
- prefer independent observed failure domains where available;
- retain healthy incumbents through hysteresis;
- avoid replacing a holder only because a marginally closer peer appeared; and
- seed a replacement before advertising it or removing the incumbent.

The storage cell repairs data. It does not own subscriber branches.

### B.3 Redundant subscription DAG

Each child relay maintains at least two independently selected renewable upstream
leases:

```text
SubscriptionLease {
  topicId,
  subscriberOrChildId,
  upstreamId,
  mode,                 // PRIMARY | STANDBY
  authorityTerm,
  lastDeliveredSeq,
  leaseExpiresAt
}
```

The primary normally sends replay and live events. The standby receives small
term/high-water updates and stays able to serve the next replay range. A primary
failure therefore becomes a local mode switch rather than global tree
reconstruction.

To prevent two supposedly independent paths from sharing the same immediate
failure domain, standby selection should exclude the primary's first-hop channel,
prefer a different storage or relay basin, and expose when diversity cannot be
achieved.

Renewal is the healing loop:

1. renew primary and standby before expiry with jitter;
2. include the last delivered authority term and sequence;
3. receive current high-water and replay or proof-of-current-state;
4. on primary timeout, promote the standby immediately;
5. request replay for the missing range;
6. search for a new standby; and
7. let obsolete seats expire without explicit distributed cleanup.

### B.4 Commit and delivery

An illustrative publish flow is:

1. any ingress validates shape and routes the unchanged author envelope toward the
   current stamp lease;
2. the sequencer validates author, topic, freshness, policy, and deduplication;
3. it assigns one term-bound stamp;
4. storage holders validate and retain it;
5. after `W` exact retained-state receipts, the event becomes committed;
6. any storage or delivery node may inject the committed event into the delivery
   DAG; and
7. duplicate paths converge at `msgId` deduplication.

KILL is an ordered tombstone through the same path, never a side protocol.

### B.5 Failure behavior

| Failure | Immediate behavior | Repair |
|---|---|---|
| Sequencer disappears | Reads, replay, and live delivery of committed events continue; new writes queue within a bound | Storage witnesses reconcile high-water and grant a higher term |
| One storage holder disappears | No subscriber movement | Select, seed, receipt-confirm, then count a replacement |
| Primary upstream disappears | Child promotes standby and requests the missing range | Child selects a new standby through ordinary renewal |
| Both upstreams disappear | Child performs fresh bounded discovery and replay | Normal subscription healing; no authority change |
| Correlated storage loss below commit threshold | Reads from surviving holders continue where possible; new commits pause | Recruit enough holders, reconcile, then resume |
| Partition | Only a side with a valid stamp lease and commit threshold may create committed events | Higher-term evidence fences stale authority on heal |

### B.6 Why this may outperform the triumvirate

- A co-root loss in the triumvirate moves roughly one third of subscriber branches;
  a storage-holder loss in this design moves none.
- Delivery capacity can scale with subscribers without enlarging the authority
  quorum.
- Storage durability can scale with risk without creating more active roots.
- A transient relay failure heals at the affected branch rather than changing the
  topic's cohort configuration.
- Sequencer, storage, and delivery metrics identify which responsibility failed.
- The number of holders and delivery parents can change independently.

### B.7 Costs and risks

- two upstream leases increase control traffic and state;
- lease selection can create correlated paths unless diversity is measured;
- a term-fenced sequencer still requires a small consensus-like transition;
- injection from multiple holders increases duplicate pressure;
- role and evidence vocabularies must be exact or the design will silently
  recouple its planes;
- dynamic storage width must not become an unbounded memory or repair amplifier.

## Alternative C — leaderless per-author topic log

If Axona can relax dense global order, it can remove the stamp authority entirely.

Each author emits a signed hash-linked sequence:

```text
AuthorEvent {
  topicId,
  authorId,
  authorSeq,
  previousHash,
  hlc,
  bodyOrTombstone,
  signature
}
```

Any eligible storage holder can validate and retain an event. The topic view is the
convergent union of author feeds. A deterministic presentation order can use:

```text
(hlc, authorId, authorSeq, msgId)
```

This is a display order, not proof that the network observed all events in that
order. Late insertion is normal. Per-author order and causal references remain
strong.

Replay uses an opaque frontier, a compact author-version vector, or periodic topic
checkpoints rather than one scalar `since` value. Creator-authorized KILL remains a
signed tombstone targeting a `msgId`; concurrent body/tombstone arrival converges by
the tombstone-first rule.

### Strengths

- no leader or timekeeper failover;
- any eligible holder can accept a valid write;
- partitions can continue independently and converge after healing;
- naturally compatible with multi-path gossip and replicated storage;
- malicious or failed storage nodes cannot forge author events.

### Limitations

- no dense topic-wide sequence;
- replay cursors and gap detection become more complex;
- user interfaces may observe late reordering;
- topic configuration updates need their own authority and conflict rules;
- bounded queues must evict deterministically from a partially ordered set;
- convergence is not the same as real-time consistency.

This is the best availability design of the set, but also the largest semantic
change. It deserves a separate product-level decision before protocol design.

## Alternative D — pure gossip delivery mesh

A gossip mesh uses periodic graft/prune repair rather than a rooted subscription
tree. Each subscriber or relay maintains several topic peers, forwards unseen
messages, scores peers by observed behavior, and repairs the mesh continuously.

This is attractive for live dissemination under churn, but insufficient as the
whole Axona pub/sub service because it does not by itself provide:

- authoritative bounded retained history;
- a reliable late-subscriber replay source;
- exact retained-state evidence;
- deterministic topic-wide sequence;
- a clear durability commitment; or
- cheap operation for very large numbers of mostly idle topics.

The useful role for gossip is therefore as an optional **delivery plane over a
retained topic cell**, not as the retention authority. Low-volume topics may use
the primary/standby DAG; high-volume topics may graduate to a bounded mesh.

## Alternative E — erasure-coded retention swarm

Instead of retaining every full message at every holder, encode retained batches
into `n` fragments recoverable from any `k` fragments. Repair replaces lost
fragments before the available count falls below `k`.

This is attractive for long retained histories or large media payloads, but less
useful for the small, immediate messages that dominate chat and control topics.
It also does not solve subscription continuity or ordering. Treat it as a future
`TopicStore` policy, composable with either the leased-cell or leaderless design,
not as a replacement for the delivery architecture.

## Alternative F — regional serving federation

Each region maintains a local delivery and replay service for the topic, while
regional cells exchange committed events. Subscriber churn is mostly local and a
regional failure does not directly disturb other forests.

The difficult question is authority:

- one global sequencer preserves total order but remains a cross-region write
  dependency;
- one sequencer per region requires deterministic merge and partition rules; or
- per-author logs remove the regional sequencing conflict.

Regional federation is useful for scale and correlated-failure isolation, but it
should follow the sequencing decision rather than conceal it.

## Cross-cutting design rules

### 1. Renewal is the repair protocol

Do not add a separate membership system when expiring subscription leases already
provide the correct lifecycle. Extend renewals with cursor and authority evidence.

### 2. Possession requires a receipt

`sent`, `routed`, and `consumed` are not evidence that a node retained an event.
Only an authenticated, event-bound receipt emitted after local insertion can credit
durability.

### 3. Seed before advertise

A replacement is not serving merely because it accepted a role. It becomes serving
after required state is retained and independently acknowledged.

### 4. Diversity is a first-class metric

XOR proximity is valuable for routing locality but insufficient for durability.
Where observable, selection should avoid identical host, deployment generation,
network provider, regional basin, and first-hop channel.

### 5. Children are repair witnesses, not quorum voters

Child caches can restore practical availability and should offer retained events
upward after reattachment. They cannot define the authoritative commit floor
because not every delivery is guaranteed.

### 6. Degraded operation must be explicit

Expose storage width, commit grade, path diversity, and replay lag. Never silently
claim `R3`, dual-path service, or committed state when the evidence supports less.

### 7. Keep state proportional to live obligations

Role population must remain `O(active subscriptions + desired holders)`, not
`O(churn events)`. Leases, bounded flight tables, and expiry are mandatory.

## Experiment matrix

The first phase should be simulation and instrumentation, not a wire change.

### Candidates

1. current singleton root plus existing backups;
2. hardened singleton with exact receipts and event-driven rehome;
3. triumvirate with active co-root forests;
4. leased topic cell plus primary/standby delivery DAG; and
5. leaderless per-author log plus the same delivery DAG.

### Fault arms

- independent random churn at several rates;
- correlated loss of two nearby holders;
- full regional or deployment-generation loss;
- sequencer/root SIGKILL during an in-flight publish;
- primary upstream loss while the subscriber is otherwise healthy;
- simultaneous loss of both upstream paths;
- browser freeze without graceful drain;
- asymmetric partition and delayed receipts;
- incapable closest routing terminus;
- saturation and repeated admission decline;
- rolling mixed-version deployment; and
- burst resubscription after common-mode recovery.

### Required metrics

Measure failure categories independently:

1. event never reached a valid ingest authority;
2. event ingested but did not reach the commit threshold;
3. committed event lost from retained storage;
4. subscriber had no live delivery path;
5. subscriber had a path but lacked replay continuity;
6. delivery arrived more than once at the application boundary;
7. authority could not safely issue a new stamp; and
8. repair exceeded its message, time, or state budget.

Report:

- existing-subscriber live delivery rate;
- fresh and returning subscriber replay completeness;
- committed-event survival and vulnerability-window duration;
- write unavailability and p50/p95/p99 commit latency;
- orphan duration distribution;
- repair messages and bytes per failure;
- duplicate rate before and after application dedup;
- maximum per-node subscriber, holder, and flight state;
- storage-cell repair time;
- delivery-path recovery time; and
- observed path and holder failure-domain diversity.

Use seed-paired comparisons and stratify by churn rate, topology, failure
correlation, and publication timing. Soaks are regression evidence; deterministic
failure fences remain required for every state transition.

## Decision gates

### Gate 1 — semantics

Decide whether dense topic-wide order and a scalar replay cursor remain
non-negotiable. If yes, retain a sequencer lease. If no, prototype the per-author
log before designing a more elaborate timekeeper election.

### Gate 2 — measured value of the second upstream

The primary/standby design must materially reduce orphan duration and improve
delivery without unacceptable renewal traffic or correlated-path collapse.

### Gate 3 — separation proof

Demonstrate that changing storage membership moves no subscriber branches and
that changing delivery parents changes neither storage membership nor stamp
authority.

### Gate 4 — honest durability

No holder is counted before an exact retained-state receipt. The test suite must
prove that dispatch, routing consumption, empty keepalives, and stale digests do
not credit durability.

### Gate 5 — bounded repair

Every failure arm must converge within declared message, time, memory, and role
budgets. A design that heals by producing an unbounded resubscription storm is not
self-healing.

### Gate 6 — correlated-failure advantage

The adaptive cell must outperform the triumvirate under at least one realistic
correlated failure model without regressing independent-churn performance enough
to erase the gain.

## Recommended next design artifact

Write a focused **Renewable Delivery DAG v0.1** specification before expanding the
triumvirate control plane. It should define:

- primary and standby lease state;
- upstream diversity constraints;
- renewal and replay messages;
- promotion and replacement transitions;
- duplicate suppression;
- failure and overload behavior;
- exact state bounds; and
- deterministic tests for single-path and dual-path loss.

This component is useful under every viable retention model: hardened singleton,
triumvirate, adaptive topic cell, or leaderless log. It addresses the failure mode
Axona has already measured and allows the larger authority decision to be made
with better evidence.

## Bottom line

The triumvirate is viable, but it should not be treated as the only route to a
stronger pub/sub base. Its main benefit comes from separating timekeeping from
serving and making warm copies active. Those benefits can be obtained more
flexibly by separating sequencing, retention, and delivery altogether.

The recommended architecture is therefore:

> **A narrow fenced sequencer lease, an adaptive receipt-confirmed storage cell,
> and a renewable primary/standby delivery DAG.**

If Axona later decides that dense topic-wide order is not essential, replace the
sequencer with a leaderless per-author log while retaining the same storage and
delivery planes. The pub/sub API remains central in either case; what changes is
that no single root abstraction is asked to be the service, the database, and the
ordering authority at once.
