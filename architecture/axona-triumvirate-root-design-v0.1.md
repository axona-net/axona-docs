# Axona Triumvirate Root — analysis and implementation design

**Status:** design proposal v0.4  
**Baseline reviewed:** `@axona/protocol` 4.62.1, testnet branch at `8f34759`  
**Audience:** David, Council, axona.bot  
**Scope:** pub/sub root availability, cache durability, subscription service, and incapable-node behavior

## Executive decision

The idea is viable, but the safe form is not three nodes independently behaving as the current root.

Axona already has the physical core of a triumvirate: `ROOT_REPLICAS = 2` means a normal topic has one root and two warm backups. The root eagerly pushes every stamped publish and tombstone to those backups and periodically reconciles the full cache. What is missing is:

1. capability-aware selection, so an incapable node does not occupy a serving position;
2. receipt-confirmed replication, so the system knows a replica holds the data rather than merely knowing a routed send was consumed;
3. active serving by the replicas, including subscription ownership and fan-out;
4. an agreed cohort configuration and safe member replacement; and
5. a timekeeper term and failover rule when publishes enter through different cohort members.

The recommended design is therefore a **three-member root cohort**:

- all three members are equal service roots: each may cache, accept subscriptions, host children, replay, and fan out;
- any member may receive a PUB or KILL;
- one serving member is selected as **timekeeper** for the current term; this is a narrow stamping duty, not the root role;
- a non-timekeeper receiving a PUB or KILL forwards the unchanged author envelope to the timekeeper;
- the timekeeper stamps once and broadcasts the identical stamped event to both peers;
- the two non-timekeepers retain the event and echo it to each other, proving mutual liveness and possession;
- a node that cannot cache and serve is an **ingress proxy**, not a cohort member, and forwards PUB/SUB/KILL to a serving member;
- a bridge may perform that same forward-only ingress function, but remains outside every topic cohort and holds no topic role.

This removes the single serving-root dependency while preserving the current simple timestamp, dense sequence, replay cursor, and live ordering model. Losing the timekeeper does not remove root service: the other two continue serving retained data while they install a successor timekeeper.

## What exists today

The 4.62.1 kernel is not a pure single-copy system:

- Routing sends a topic-addressed message to one emergent root: the closest reachable terminus.
- The root is the only node that verifies live ingress, assigns `publishTs`, increments dense `seq`, and initially fans out.
- The root selects two nearby cohort nodes and sends `REPLICATE` with cache and tombstones.
- Replica receivers become passive `BACKUP` roles, retain the full state, and renew a subscription toward the topic every repair tick.
- A dead root is replaced through the normal subscription/root-claim path; the nearest surviving backup is already warm.
- `REPLICATE` arriving at another root is union-ingested, so transient duplicate roots converge their retained sets.
- Root incarnations, ingest acknowledgments, receipt probes, eviction records, and epoch-ordered rejoin handling now cover the dead-but-responsive root class.
- `neverRoot` is a hard admission refusal. Saturation and not-seated states are soft refusals, with a mandatory floor at a routing terminus to prevent total unavailability.

The important gaps are equally concrete:

- The replica ledger is credited from a routed `consumed` verdict, not an application-level receipt proving that the receiver cached the state. Source comments correctly call the name `replicas` an overclaim.
- Backups do not serve their own subscriber branches while the root is alive.
- A terminal node that hard-refuses and has no remaining `via` cannot discover and forward to a farther eligible root; it reports `undeliverable`.
- Capability is local. `canAcceptRole()` is not part of cohort discovery.
- The root hint and root beacon name one node, not a cohort and epoch.
- Current `lastTs`, dense `seq`, append-only cache insertion, and scalar `since` floor assume one serialization point.

## Why the timekeeper is distinct from the root

Independent stamping can make converged caches deterministic, but it complicates scalar replay cursors, dense gap detection, duplicate ingress, and irrevocable live delivery order. A narrow timekeeper duty preserves all of those properties without reverting to one serving root.

The timekeeper is not a privileged data owner:

- it does not own all subscribers or children;
- it is not the only node that caches, replays, or fans out;
- it does not decide cohort membership alone;
- it only serializes PUB and KILL stamps for one term;
- either other serving member can replace it after a fenced two-member election.

For each accepted event it assigns:

```text
EventStamp {
  cohortEpoch,
  timekeeperTerm,
  timekeeperId,
  publishTs = max(lastIssuedTs + 1, localNow),
  seq = lastIssuedSeq + 1,
  msgId
}
```

The author envelope remains unchanged. The stamped wrapper is immutable. Because only the valid timekeeper may stamp in a term, all caches retain the same timestamp and dense sequence for the message. The physical clock need not be globally exact; it only needs to be sane enough for freshness and TTL policy, while `max(lastIssuedTs + 1, localNow)` supplies monotonicity.

The proposed forwarding loop works if each non-timekeeper echoes the retained stamped event to the other non-timekeeper and acknowledges the timekeeper. A sending node cannot infer remote possession from its own outbound send: an echo/ack must be authenticated, emitted only after cache insertion, and bind the term, sequence, message, and retained state.

## Terminology and capabilities

### Root cohort

For topic `T`, the cohort is an epoch-scoped record:

```text
RootCohort {
  topicId,
  configEpoch,
  configId,          // hash(topicId, configEpoch, ordered members)
  members[1..3],     // ordered by XOR distance, then node id
  timekeeperId,
  timekeeperTerm,
  committedTs,
  committedSeq,
  state              // healthy | degraded-2 | degraded-1
}
```

Each selected member must currently advertise `SERVE` capability. `SERVE` means it can:

- retain the bounded topic cache and tombstones;
- keep cohort soft state and repair timers;
- accept and renew subscriber/child state;
- verify and ingest stamped entries without starving transport liveness; and
- answer receipt and anti-entropy messages.

The timekeeper must additionally be non-draining and pass the cohort's clock-sanity check. A `FORWARD_ONLY` or `BRIDGE` node can never be timekeeper because successor selection depends on retained timestamp/sequence state.

Other local modes are:

- `DRAINING`: no new cohort roles or subscriber branches; transfer existing responsibilities;
- `FORWARD_ONLY`: may route or proxy messages, but creates no topic role;
- `BRIDGE`: signaling/transport and forward-only ingress, never a cohort candidate and never a cache/subscription authority.

An overloaded or soon-to-background peer should move to `DRAINING`, then `FORWARD_ONLY`. A browser that may be frozen without warning cannot be relied upon as a voter or witness merely because its state is small.

### Why a forward-only node must not consume a cohort seat

A forward-only member contributes neither cache durability nor subscription availability. If two of the three closest nodes are forward-only, the apparent triumvirate still has one actual root and one actual copy. It also adds membership churn and failure-detection dependencies.

Therefore selection is **the three closest eligible serving nodes**, not the three closest nodes regardless of ability. A closer incapable routing terminus forwards to the serving cohort but is not counted in its width. If fewer than three serving nodes exist, the cohort honestly reports width two or one.

This is the main departure from the initial proposal, and it is important: forwarding is useful, but it is a routing behavior, not root service.

## Selection and discovery

1. Run iterative `findKClosest(topicId, DISCOVERY_K)` with over-fetch; start with 8 or 12, tune by measurement.
2. Exclude self only when it is not `SERVE`; always exclude bridge identities from cohort membership, while allowing them to forward to the selected cohort.
3. Query or use fresh authenticated soft-state capability for candidates.
4. Sort eligible candidates by XOR distance, then node id.
5. Select the first three that accept a cohort offer.
6. A candidate only becomes a member after returning an application-level `COHORT_ACCEPT` bound to the proposed `configId`.
7. Continue down the candidate list until three accept or the list is exhausted.

Capability claims are self-declared and self-limiting. A false refusal only reduces the liar's duties. A false acceptance is contained by the receipt deadline: the candidate is not credited until it demonstrates retained state and is replaced if it cannot service the role.

No dedicated pub/sub sockets are required. Cohort messages are routed to member node ids through the existing authenticated DHT path. Requiring a permanent direct triangle per topic would violate the routing-only architecture and can exhaust the synaptome connection budget. “Bidirectional” should mean every ordered member can route to and receive authenticated events/receipts from the other two, not that each topic installs three permanent WebRTC channels.

## Publish, kill, and commit flow

### Ingress

1. PUB or KILL routes toward the topic as it does now.
2. A cohort member handles it. An incapable terminus—including a bridge if it is the closest routing terminus—resolves the cohort and proxies it without creating a topic role.
3. If the receiving serving member is not the timekeeper, it validates the basic envelope shape, forwards the unchanged request to the current timekeeper, and opens a bounded write flight.
4. The timekeeper performs authoritative ingress validation and deduplication, stamps once, caches, and sends the identical stamped event to both peers.
5. Each peer caches before echoing the same stamped event to the other non-timekeeper and acknowledging the timekeeper.
6. A co-root may fan out the event only after it has the valid timekeeper stamp. The timekeeper must not expose an event as committed until at least one peer has returned a retained-state receipt.
7. A routing `consumed` verdict is never treated as ingestion.

### Timekeeper stamping

The timekeeper performs the current root-ingress checks:

- envelope signature and `msgId`;
- freshness;
- recomputed topic id;
- owner-write policy;
- message/tombstone dedup.

It assigns exactly one canonical stamp:

```text
RootStamp {
  cohortEpoch,
  timekeeperTerm,
  timekeeperId,
  publishTs = max(lastIssuedTs + 1, localNow),
  seq = lastIssuedSeq + 1,
  msgId
}
```

The author envelope remains unchanged. The root stamp is bound to the cohort epoch, timekeeper term, and authenticated timekeeper identity. A stamp from a stale term, a non-timekeeper, or a non-member is rejected or quarantined. Simultaneous duplicate ingress converges naturally because both requests reach the same timekeeper and deduplicate by `msgId`.

### Replication and proof

The timekeeper sends `ROOT_COMMIT` in parallel to the other members. A receiver:

1. verifies the author envelope and topic policy again;
2. verifies `configId`, cohort epoch, timekeeper term/identity, stamp shape, and monotonic sequence;
3. applies tombstones before bodies;
4. appends the canonical entry to its ordered cache;
5. echoes the unchanged committed entry to the other non-timekeeper;
6. only after retention returns `ROOT_ACK {configId, cohortEpoch, timekeeperTerm, msgId, publishTs, seq, stateDigest, held:true}`.

The ack or peer echo must bind the authenticated sender, cohort epoch, timekeeper term, message, timestamp, dense sequence, and state digest. A stale member, stray holder, or wrong term cannot credit the commit.

Each member maintains three separate facts for events it originated or observed:

- peer is a selected cohort member;
- stamped event was dispatched to that peer;
- retained-state receipt was verified from that peer.

The cross-forward loop establishes that the two non-timekeepers are mutually reachable and hold the same event. Their direct acknowledgments let the timekeeper distinguish send from retention. If the timekeeper dies, the two peers exchange high-water and digest state before electing its replacement.

Delivery does not wait for all three, but it does require two known holders. A non-timekeeper that retained a valid event knows the timekeeper cached it before sending and may fan out immediately; the timekeeper waits for one retained-state acknowledgment. Policy should expose:

- `replication=3`: all three receipts;
- `replication=2`: one replica receipt;
- `replication=1`: sole copy, degraded and not yet externally committed;
- `replication=0`: ingest failed or no serving member.

No acknowledgment is sent to the origin publisher; publisher confirmation remains observation, preserving I-9 and location privacy.

### Kill

KILL uses the same timekeeper stamp and commit path. A kill is an ordered tombstone entry, not a side protocol. Every member applies the tombstone before any body in the same or later reconciliation batch.

## Cache convergence

All serving members keep the same bounded cache policy: count, bytes, and TTL. Identical at every instant is impossible in an asynchronous network; the implementable invariant is:

> Every committed entry is sent to every member, receipts expose which members hold it, and surviving members converge to the same retained set after communication resumes.

Use the existing sync engine and its summary/delta gates. Extend the summary to include the cohort configuration, timekeeper term, committed timestamp/sequence high-water, and retained-set digest. Full anti-entropy remains bounded and paced; unchanged state uses small keepalives.

During a partition, only the side retaining a valid two-member commit path may continue treating new stamps as committed. A minority timekeeper may form candidate stamps locally but cannot expose them as committed without one peer receipt. After a new term is elected, old-term uncommitted events are re-forwarded as their original author envelopes for stamping in the current term.

## Subscription placement and delivery

Root beacons and hints advertise the cohort, epoch, and serving members rather than a single root.

For a subscriber `S`, choose its serving member by rendezvous hashing over the current serving set:

```text
owner(T,S) = argmax H(topicId || subscriberId || memberId)
```

This gives deterministic, balanced ownership with minimal movement when membership changes.

- A SUB reaching the wrong member is forwarded to `owner(T,S)`.
- A forward-only node performs the same forwarding without creating a role.
- The owner seats the subscriber, replays its local cache, and may create children using the existing widen-before-deepen logic.
- Only the owning co-root fans to that subscriber branch, avoiding three normal deliveries per message.
- App-level `msgId` dedup remains a final safety net during reconfiguration.
- If the owner disappears, the next renewal or cohort-change notification selects the next rendezvous owner and replays from the subscriber's `since` floor.
- A draining member transfers child/subscriber batches to their new owners before leaving when possible.

Each co-root therefore acts as a real root to its own child forest. The three forests share one committed topic log.

## Failure detection and reconfiguration

Current periodic replication/backup renewal already creates the right conversation. Add typed receipts rather than a second unrelated heartbeat system.

### Missing non-timekeeper

1. The timekeeper or other peer observes repeated missing cache receipts/keepalive acknowledgments.
2. It marks the member suspect, probes once, and stops assigning new subscriber branches to it.
3. The timekeeper proposes the next eligible candidate; the other surviving member confirms the successor configuration.
4. The other surviving member and candidate acknowledge the proposed `configId`.
5. The candidate is seeded before it is advertised as serving.

### Missing timekeeper

1. The two surviving members detect the missed timekeeper heartbeat/receipt deadline and obtain the same bounded failure evidence used by dead-root eviction.
2. They exchange `TK_STATUS` containing the old cohort epoch/term, highest committed `publishTs`, highest committed `seq`, retained-set digest, and any missing-range request.
3. They reconcile retained events before opening the new term. The successor floor is:

   ```text
   floorTs  = max(memberB.committedTs,  memberC.committedTs)
   floorSeq = max(memberB.committedSeq, memberC.committedSeq)
   ```

4. The new timekeeper is selected deterministically from eligible survivors—recommended: the closest serving survivor to the topic id, with node id as tie-break.
5. Both survivors bind one vote to `TIMEKEEPER_ELECT {oldTerm, newTerm=oldTerm+1, newTimekeeperId, floorTs, floorSeq, configId}`.
6. The new timekeeper initializes `lastIssuedTs=floorTs` and `lastIssuedSeq=floorSeq`. Its first stamp is:

   ```text
   publishTs = max(localNow, floorTs + 1)
   seq       = floorSeq + 1
   ```

7. It broadcasts the new-term record and resumes writes. A replacement third member can be recruited and seeded concurrently; the two old survivors are sufficient to fence the old term.

The floor must come from **committed** state held by the survivors, not merely from the new timekeeper's local clock or cache before reconciliation. Requiring at least one peer retention receipt before any event is externally committed guarantees that every externally visible old-term timestamp survives in at least one of the two voters.

If the old timekeeper stamped an event but neither peer retained it, that event was never committed. Should it reappear, its old-term stamp is discarded and its unchanged author envelope is sent to the current timekeeper for a new stamp.

Two disjoint successor terms cannot both obtain 2-of-3 votes unless a member double-votes. Each member therefore persists or retains in cohort state one `votedTerm`/`votedFor` decision per prior term. A returning old timekeeper that observes a higher term immediately steps down and synchronizes.

### Timekeeper liveness

The timekeeper sends a small periodic term/high-water heartbeat when traffic is idle. Both peers acknowledge it and continue their own mutual liveness exchange. More importantly, the timekeeper cannot commit or fan out a new event without at least one peer's retained-state receipt. This quorum-on-use fence prevents an isolated old timekeeper from creating an externally visible competing history after the other two elect a successor.

### Only one member reachable

With only one cohort member reachable, it cannot safely prove that the old timekeeper or a two-member majority is gone. The safe default is to continue reads/replays, recruit at least one eligible replacement, and then install a new term with two votes. An availability-first degraded-solo override is possible after dead-root evidence and a long lease expiry, but it reintroduces split-term risk and should be explicit, loud, and separately tested.

This is the key safety/availability choice: two-member election preserves one timeline; solo election preserves writes during extreme isolation but may create a fork.

### Incapability transition

- `DRAINING` is voluntary and graceful: stop new admissions, transfer subscriber branches, ensure at least one other cache receipt, propose replacement, then retire the role.
- Sudden backgrounding is treated as failure; no mechanism can rely on a tab announcing suspension before it happens.
- Recovery from overload requires fresh capability evidence before re-admission; time alone is not evidence of health.

## Churn and abrupt-loss behavior

Two independent responsibilities must be recovered:

1. **Timekeeper duty:** serialization of new PUB/KILL stamps.
2. **Serving-tree duty:** cache/replay and the subscriber/child forest owned by the lost co-root.

They must not be represented by one role transition. Losing a non-timekeeper changes the serving cohort but does not stop stamping. Losing the timekeeper pauses new commits but does not stop the other two roots from serving retained data or maintaining their trees.

### One non-timekeeper disappears instantly

Suppose A is timekeeper and C disappears:

- A and B continue accepting and committing writes with two known holders.
- C's subscriber/child forest is orphaned. Its children detect the missing upstream through renewal/repin timeouts, route SUB again, and are assigned to A or B until replacement D is serving.
- A proposes D, B confirms the new cohort configuration, and D is seeded with cache and tombstones before it is advertised.
- Once D is ready, rendezvous ownership is recalculated and renewed subscribers distribute across A, B, and D.
- If an external PUB reached C immediately before the failure but C did not finish forwarding it to A, normal publisher retry/observation recovers it. If A received it, C's later death is irrelevant to the write.

Service impact is therefore limited mainly to C's share of the subscriber forest. With balanced ownership, roughly one third of branches reconnect; timekeeping and the other two thirds continue.

### The timekeeper disappears instantly

Suppose A disappears and B/C survive:

- B and C continue replaying retained data and serving their existing child forests.
- They queue a bounded number of new author envelopes rather than inventing stamps.
- They reconcile committed high-water/digests, elect the deterministic successor in `timekeeperTerm + 1`, and then drain the queue through the new timekeeper.
- A's own subscriber/child forest rehomes independently of the election.

In-flight cases are deterministic:

- **Neither B nor C retained the last candidate:** it was uncommitted; discard the old stamp and retry the author envelope in the new term.
- **At least one retained it:** its timestamp/sequence is in the survivor floor and the peer echo repairs the other survivor before election.
- **Both retained it:** election starts immediately above their common high-water.
- **A exposed it before any peer retained it:** the design invariant was violated; a successor cannot know the externally visible timestamp. Tests must fence this path.

Write interruption is detection + reconciliation + election time, not full tree reconstruction time. Replacement of the third member may occur after stamping resumes because B and C already form the old cohort's two-member fence.

### Two members disappear instantly

Only one original member remains, so the system can still serve whatever that member retained but cannot safely prove a new timekeeper term by itself.

| Survivor | Immediate behavior | Safe write recovery |
|---|---|---|
| Old timekeeper | Serves its retained cache/tree; does not commit new solo stamps | Recruit and seed one eligible member, install a two-vote cohort/term, then resume |
| Non-timekeeper | Serves its retained cache/tree; queues new author envelopes | Recruit and seed one eligible member, jointly elect a timekeeper above the survivor floor, then resume |

The lost two roots' forests reattach through ordinary SUB renewal. In a balanced cohort, about two thirds of branches are displaced. If every branch attaches to the sole survivor before replacements are seated, its subscriber/fan-out load can temporarily approach three times normal. Recovery should therefore recruit replacements before broadly advertising a one-member cohort, apply renewal jitter/backoff, and preserve admission headroom.

#### Important durability limit

A two-holder commit tolerates any **one** root loss, not every two-root loss. If an event has reached A and B but not C, and A/B disappear together, survivor C lacks an event that may already have been delivered.

There are three policy choices:

1. **Require all three receipts before external delivery.** Survives any two root losses, but every write waits for the slowest member and becomes unavailable whenever cohort width is below three.
2. **Commit at two holders, upgrade asynchronously to three.** Recommended for availability. The event is `R2` during a short vulnerability window and `R3` after the third receipt. Metrics must expose both states.
3. **Commit at two and rely silently on downstream caches.** Not acceptable as a guarantee, although the axonic trees often provide useful recovery evidence.

Axonic child caches materially improve practical survival. Every co-root fans into a distinct tree; orphaned children that retained a message can reattach and replay/pull their cache upward, potentially restoring an event absent from the sole surviving co-root. This is an excellent recovery path, but children are not quorum voters and cannot be the only basis for the timestamp floor because delivery to every child is not guaranteed.

### Churn amplification from the three serving trees

The triumvirate localizes a root failure rather than eliminating tree churn:

- one root loss moves approximately one third of subscriber branches;
- two root losses move approximately two thirds;
- replay traffic is proportional to displaced subscribers and their `since` floors;
- timekeeper loss adds a write pause only when the lost root held that duty;
- recruiting a replacement adds one bounded cache/tombstone seed plus anti-entropy.

Use deterministic rendezvous ownership so surviving subscribers do not all select the same root. Reconfiguration must be idempotent: a subscriber may renew through multiple paths, but only its current owner fans out normally. Existing `msgId` app dedup handles brief overlap.

### Preventing churn-induced role thrash

Always selecting the instantaneous three closest peers would cause unnecessary cohort changes. Add:

- incumbent preference: do not replace a healthy member merely because a slightly closer peer appeared;
- minimum healthy dwell time before a candidate is eligible;
- capacity and `DRAINING` checks before admission;
- a replacement hysteresis threshold;
- a sticky timekeeper: ordinary non-timekeeper replacement does not rotate the timekeeper;
- separate `cohortEpoch` and `timekeeperTerm`, so membership changes do not reset the timestamp stream.

Abrupt backgrounding is treated as failure, not graceful drain. Graceful drain uses the same state machine but seeds the replacement and transfers subscriber ownership before removal, making the abrupt path a tested subset rather than a separate design.

## Probability and reliability

There is no honest single failure probability without fleet measurements because the three closest nodes are correlated by region, routing neighborhood, deployment generation, and load. The useful first-order model is:

Let `s` be the probability that one selected serving member is both capable and reachable during the relevant operation, conditionally independent of the others.

- single active root unavailable: `1 - s`;
- no usable member in a three-member cohort: `(1 - s)^3`;
- fewer than two usable members, so a strict 2-of-3 commit is unavailable: `(1 - s)^3 + 3s(1 - s)^2`.

For churn, let each member's independent instantaneous-loss rate be `λ` and let `R` be the time from the first loss until a replacement is fully seeded. Conditional on one member already being lost, the probability that either remaining member is also lost during that repair window is approximately:

```text
P(second loss before repair) = 1 - exp(-2λR) ≈ 2λR
```

Illustratively, with a 24-hour per-node mean lifetime and a 30-second repair window this is about 0.069% per first-loss event; with a one-hour mean lifetime it is about 1.65%. These are not production predictions: browser backgrounding, regional failures, and rolling deployments are correlated, so measured common-mode risk and the actual repair-time distribution dominate the independent model.

| Per-member usability `s` | Single root unavailable | No usable triad member | Strict 2-of-3 unavailable |
|---:|---:|---:|---:|
| 0.70 | 30.0% | 2.7% | 21.6% |
| 0.80 | 20.0% | 0.8% | 10.4% |
| 0.90 | 10.0% | 0.1% | 2.8% |
| 0.95 | 5.0% | 0.0125% | 0.725% |

These numbers show the availability benefit when any one member may serve. They do not predict production loss.

Common-mode failure dominates quickly. If `c` is the probability of a failure that affects the whole nearby cohort, a simple conditional model is:

```text
P(no service) = c + (1-c)(1-s)^3
```

At only 1% common-mode risk and `s=0.9`, the no-service probability is about 1.1%, not 0.1%. Selection must therefore avoid shared failure domains where the network exposes them, and deployment must remain one-node-at-a-time.

Current Axona evidence supports caution:

- the shipped median is already three warm holders per topic;
- abrupt full-fleet replacement still lost 2.2% of topics at a 1.2-second replacement interval;
- increasing replica count helped but did not install a reliability floor;
- the architecture's measured conclusion is that timely communication, not holder count alone, determines survival.

This design should substantially reduce **service interruption** because any serving member owns subscriptions and can answer. It should also reduce the thin unseeded-cohort tail because membership requires cache receipts. It does not eliminate catastrophic correlated loss, partitions, implementation defects, or malicious cohort members.

Before assigning a production probability, run A/B simulations and testnet fault injection. If zero failures occur in `N` independent failure windows, the rough 95% upper bound is `3/N` (the rule of three). Demonstrating less than 0.1% therefore needs at least 3,000 representative windows with zero failures; less than 0.01% needs about 30,000.

## Pros

- Removes the single serving-root dependency for reads, subscriptions, and child forests.
- Makes the existing root-plus-two physical copies useful during normal operation, not only after promotion.
- Lets an incapable closest node forward without becoming a data black hole.
- Spreads subscriber and fan-out load across three nearby nodes.
- Makes missing replica state observable through real receipts.
- Reuses existing K-closest discovery, bounded cache, sync ingest, tombstones, root epochs, dead-root flights, subscription renewal, and child delegation.
- Speeds recovery: a surviving co-root already has both data and subscribers.
- Keeps publisher-location privacy and content-addressed idempotence.

## Cons and risks

- It is a significant protocol change, not a simplification of the implementation.
- Cohort membership and reconfiguration become a distributed state machine.
- The timekeeper is a narrow write-path dependency: new PUB/KILL latency pauses during its detection and election, although reads and subscriptions continue through the other co-roots.
- A timekeeper election is a small distributed state machine and requires term fencing, two votes, and committed high-water reconciliation.
- Requiring one peer receipt before fan-out slightly increases first-delivery latency but is what makes successor timestamp floors trustworthy.
- Every active replica adds cache verification, fan-out, subscription, and repair load.
- Dynamic capacity claims can flap; draining and hysteresis are mandatory.
- Three closest nodes often share correlated network, region, and rollout failures.
- Active membership expands the attack surface for eclipse/Sybil placement and forged state. This design is crash-tolerant, not Byzantine fault tolerant.
- Permanent direct triangles would exhaust connection budgets; routed logical links are required.
- Mixed-version rollout needs an explicit capability gate and a complete legacy fallback.
- Existing Q2 durability-confirmation debt must be resolved or carefully isolated; active replicas should not build on the current delivery-before-durability ambiguity.

## Complexity estimate

The current kernel provides roughly half of the required data-plane substrate, but little of the active membership/control plane.

### Recommended staged design

High complexity, but tractable as a sequence of fenced releases:

1. **Receipt-honest cohort recruitment** — moderate: replica ack/decline, capability query, scan past incapable candidates, truthful metrics.
2. **Capability-aware terminal proxying** — moderate: PUB/KILL/SUB forwarding to eligible candidates with bounded flights and typed terminal failure.
3. **Active replica subscription serving** — high: cohort beacons/hints, rendezvous ownership, branch transfer, duplicate suppression.
4. **Timekeeper failover and cohort reconfiguration** — high: term heartbeats, two-member election, committed high-water reconciliation, stale-term fencing, configuration epochs, votes, and solo-degraded policy.
5. **Rollout and soak** — high operational risk: mixed-version gates, churn A/B, loss/partition matrix, production canary.

A focused implementation is plausibly four to eight engineering weeks plus soak time, even with axona.bot producing code quickly. The schedule is driven by adversarial tests and rollout evidence, not typing speed.

### Three independent stamping roots

Viable only if Axona weakens live-order and scalar-cursor semantics. The complexity moves into ordered insertion, vector/overlap replay cursors, duplicate-stamp resolution, and late insertion. The selected timekeeper model is simpler for the current protocol because it retains one dense monotonic stamp stream while still distributing every root service function.

## Implementation map for axona.bot

### New module

Add `src/pubsub/rootCohort.js` as the sole authority for:

- cohort configuration and epoch transitions;
- member capability and receipt ledgers;
- member suspect/replace/drain transitions;
- subscription owner calculation;
- timekeeper term, heartbeat, election, and committed-floor reconciliation;
- structured transition logging.

Do not scatter cohort transitions across `wireHandlers`, `repairPlane`, and `rootClaim`. Those modules call the state machine; they do not write its fields directly.

### Role state

Extend a role with one nested record rather than parallel loose fields:

```text
cohort: {
  configEpoch,
  configId,
  members: Map(nodeId -> {mode, capabilityAt, receiptAt, digest}),
  timekeeperId,
  timekeeperTerm,
  committedTs,
  committedSeq,
  votedFor,
  state
}
```

Keep `subscribers`, `children`, cache, tombstones, `lastTs`, and `seq` on the role. The timekeeper alone advances `lastTs`/`seq`; every member advances its committed high-water only from a valid timekeeper-stamped event it retains. Derive nature/mode from ground facts; do not add drifting booleans such as `isCoRoot`, `canServe`, and `isTimekeeper` independently.

### Wire additions

Names are provisional:

- `pubsub:cohort-offer`
- `pubsub:cohort-accept`
- `pubsub:cohort-decline`
- `pubsub:root-commit`
- `pubsub:root-ack`
- `pubsub:commit-cert`
- `pubsub:timekeeper-heartbeat`
- `pubsub:timekeeper-status`
- `pubsub:timekeeper-elect`
- `pubsub:cohort-propose`
- `pubsub:cohort-vote`
- `pubsub:cohort-state`
- `pubsub:cohort-leave`

Every response binds `topicId`, `configEpoch`, `configId`, authenticated sender, and the specific request/entry it answers. Apply existing inbound count/byte caps and time-sliced ingest.

### Existing files affected

- `constants.js`: wire types, deadlines, discovery width, caps, and obligations.
- `AxonaManager.js`: cohort state construction, inspect surfaces, capability state, terminal proxy entry points.
- `rootClaim.js`: retain legacy single-root transitions; bridge into cohort membership/timekeeper terms without allowing two state machines to write the same fact.
- `rootElection.js`: cohort beacon/hint acceptance and epoch ordering.
- `wireHandlers.js`: cohort ingress, commit/ack, active SUB ownership, replay/fan-out.
- `repairPlane.js`: candidate scanning, receipt-aware anti-entropy, suspect/replace, draining.
- `syncEngine.js`: retained-set digest, committed timestamp/sequence floor reconciliation, and cohort convergence.
- `writeFlight.js`: target current timekeeper term rather than one root incarnation; retain source/epoch/term ack binding.
- `dispatch.js`: no semantic inference; cohort evidence remains receipt-based.

### Backward compatibility

- Gate activation on an authenticated `root-cohort-v1` capability from all selected members.
- If fewer than two compatible serving nodes exist during rollout, use the legacy root-plus-backup behavior.
- Old nodes may route through or subscribe under a cohort member without understanding the cohort.
- New wire handlers must be safe to ignore by legacy peers; no new semantics should be inferred from silence.
- Enable on testnet per topic or feature flag, then roll one node at a time.

## Acceptance matrix

At minimum, add deterministic tests for:

1. three closest eligible members selected; bridge and incapable nodes excluded;
2. incapable closest terminus forwards PUB, KILL, and SUB without creating a role;
3. cohort offer decline scans to the next candidate;
4. replica credit only after source/epoch/config/msg/digest-bound receipt;
5. stale, forged, wrong-member, and wrong-epoch receipts cannot credit;
6. concurrent PUBs entering all three members are forwarded to one timekeeper and receive one canonical dense order;
7. simultaneous duplicate PUB/KILL ingress remains idempotent at the timekeeper;
8. tombstones reach every member before killed bodies can replay;
9. rendezvous subscription ownership is balanced and produces one normal fan-out path;
10. one member SIGKILL: uninterrupted serving and replacement to width three;
11. timekeeper SIGKILL: two survivors reconcile committed high-water, elect the deterministic successor, and its first timestamp is strictly greater than the old committed maximum;
12. two member deaths: safe mode continues reads, pauses new commits, recruits a second voter, and later reconstitutes; optional degraded-solo behavior is separately fenced;
13. asymmetric links: no send or cross-forward is misread as receipt;
14. network partition: no two 2-of-3 timekeeper terms; an optional solo override is tested separately for fork detection and union-on-heal;
15. draining/background transition transfers branches and does not plant unbounded state;
16. bulk seeding yields to liveness and obeys the full-push budget;
17. all candidates incapable returns a typed failure, never false `ok`;
18. mixed 4.62.1/cohort-v1 fleet falls back safely;
19. app exactly-once and `since:'all'` hold through every reconfiguration;
20. role population remains `O(subscribers + cohort)`, not `O(churn events)`.

Then run:

- full kernel and axonSpec suites;
- churn, interloper, lossy-restart, root-reconcile, dead-root, handoff, and Theseus A/B;
- correlated failure-domain experiments, not only independent random kills;
- 3,000+ representative fault windows before making a sub-0.1% availability claim;
- live testnet gates: kill each cohort position, background a serving browser, saturate a member, and verify from an independent fresh subscriber.

## Recommendation

Proceed as a **cohort-serving extension of the existing root-plus-two-backups system**, with one transferable timekeeper duty and with forward-only nodes excluded from the three service seats.

The first implementation milestone should be deliberately smaller than active co-roots:

> A terminal incapable node or bridge can discover and forward to an eligible cohort member; the selected timekeeper stamps once; all three serving members replicate the identical event with exact retained-state receipts.

That milestone directly solves the minimal-supporting-root problem and fixes a known evidence gap without replacing Axona's timestamp, sequence, or scalar replay model. Once it survives testnet and churn A/B, activate subscription serving on the two confirmed replicas, then add timekeeper election and full cohort reconfiguration.

This path gives Axona the operational simplicity the idea is aiming for—a topic is served by a small redundant unit—while keeping the hard parts explicit and independently testable.
