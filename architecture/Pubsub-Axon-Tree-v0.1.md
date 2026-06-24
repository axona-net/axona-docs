# Axona Pub/Sub — The Axonic Tree

**v0.1 · draft for stakeholder sign-off · 2026-06-23**

> Purpose: state, from first principles, **how Axona pub/sub works** — clearly
> enough that an engineer can build to it and a reviewer can confirm it is honest.
> This is the design we build *to*. It supersedes the K-closest / `sendDirect`
> root-set model (kernel ≤ v3.11.0), which assumed direct connections that do not
> exist on the overlay.
>
> **The one rule everything obeys:** *Axona pub/sub uses only DHT message routing.
> There are no direct connections between nodes.* A publisher does not know where a
> relay is and cannot connect to one. Every interaction below is a routed message
> delivered, hop by hop, to the one live node closest to a 264-bit target. Any
> design that needs a node to "connect to" a relay it discovered is wrong and is
> rejected on sight.

---

## Terms — read this first

Builds on **Identity-and-Authorship-Model-v0.3**. In short: a **Node ID** is a
264-bit routable address (`[8-bit S2 region] ‖ [256-bit SHA-256(node pubkey)]`); a
**Topic ID** is a 264-bit address derived from `(region, owner?, name, write)`. Both
live in the same key-space; "near" = XOR-close.

- **route(target, …)** — the sole primitive. Walks the DHT and delivers the message
  to the single live node whose Node ID is closest to `target`. If `target` is a
  Topic ID (no node owns it exactly) the terminus is the topic's **root**. If
  `target` is a real Node ID, the terminus is that node (still multi-hop routed —
  *never* a direct socket). "Closest live node" is the whole game.
- **Root** — the live node closest to a Topic ID. Emergent, never elected: a node
  *is* the root iff it is the routing terminus for that Topic ID.
- **Relay** — any node hosting a copy of a topic (a subscriber list + a message
  cache). The root is the apex relay; the tree below it is more relays. A relay is
  also a *subscriber* of its parent.
- **Subscriber** — any node receiving a topic's feed. A relay is a subscriber too.

---

## 1. The actors and the per-topic state

For each topic a node participates in, it holds:

```
role          : 'subscriber' | 'relay'      // relay ⇒ also a subscriber of its parent
subscribers   : Map<NodeId, { lastRenewed, since, via }>   // relays only
cache         : ring buffer ≤ CACHE_MAX (default 1024) of { msgId, ts, body, signer }
lastTs        : highest timestamp this node has stamped   // only meaningful while root
renewVia      : ordered list of waypoint Node IDs (the `via` chain), possibly empty
topicId       : the authoritative routing target
```

There is no global registry, no election, no membership list beyond each relay's own
direct subscribers. The structure is **emergent** from routed messages plus periodic
renewal.

---

## 2. The routing primitive and the `via` list

Every message carries a routing target and an **ordered `via` list** of waypoint Node
IDs:

```
route(target = topicId, via = [w1, w2, …], type, payload)
```

Semantics:

1. If `via` is non-empty, the message routes toward `via[0]` first. On arrival (or on
   exhausting that leg's hop budget), `via[0]` is consumed and the message routes
   toward `via[1]`, and so on.
2. When `via` is empty, the message routes toward `target` (the Topic ID or Node ID).
3. **`target` is always authoritative.** `via` is a sequence of *soft* waypoints. A
   waypoint that no longer exists is not an error: the terminus nearest the dead
   waypoint simply drops it and routes on toward the next waypoint, or toward
   `target` if none remain. A message can never be orphaned by a stale `via`.

**Caps (a waypoint cannot be used to amplify load):**

- **`MAX_VIA = 8`** entries (wire-validation bound on list length; over-long lists are
  rejected — keeps message size sane).
- **`VIA_HOP_BUDGET = 8`** hops to reach each waypoint; if a leg can't complete within
  its budget, the waypoint is abandoned and routing continues to the next target.
- **The global `MAX_HOPS` backstop still applies to the whole journey** and is the
  ultimate bound. A `via` chain that would exceed it fails over to `target` early.

This single field does two jobs: it **stabilises the tree** (§5) and it provides a
**path-unlinkability primitive** (§7). It is built as a list from day one so the
security use needs no second wire change.

---

## 3. The four operations

All four are `route(…)` calls. No other network verbs exist.

### subscribe — `route(target = topicId, via = renewVia, {subscriberId, since})`

The terminus R checks: *am I a waypoint target, or do I host this topic?*

- **R hosts the topic (or is the root):** add/refresh `subscriberId` in R's subscriber
  list, recording the `via` it arrived on. Replay R's cache to the subscriber from the
  `since` hint forward (a `deliver` batch, §below). If `since` is absent, replay the
  whole cache (≤ `CACHE_MAX`).
- **R is merely the node nearest a dead waypoint:** drop that waypoint, re-route toward
  `topicId` (the authoritative fallback). It lands at the real root/relay, which then
  handles it as above. *This is the self-heal: a stale path costs one extra leg, never
  a lost subscription.*
- **R is overloaded** (`subscribers > MAX_DIRECT`, default 20): R delegates (§4).

A subscribe whose route terminates at the **root itself via the root's own renewal**
(the self-loop) is a no-op acknowledgement: "I am still the closest node to this Topic
ID." That self-loop is the steady-state heartbeat; its *failure* (landing on a closer
node) is the migration trigger (§6).

### publish — `route(target = topicId, via, {message})` — **no timestamp**

The original publisher does **not** stamp the message (it cannot; it does not know it
is or isn't the root, and its clock is untrusted). The terminus closest to `topicId`
is the root and does the work (§5): stamp, cache, fan out.

### deliver — `route(target = subscriberId, {message, ts, from})`

A relay fans a stamped message to each of its subscribers. **`from` carries the
relay's own Node ID** — this is what the subscriber records and replays back as the
head of its `via` list on the next renewal (§5). If the receiving subscriber is itself
a relay, it re-fans `deliver` to its own subscribers (the message walks down the tree).

### renewal — every `RENEW_MS` (default 60 s)

For each topic it subscribes to, a node re-issues `subscribe` toward `topicId` with
`via = renewVia` (its remembered path) and `since = lastSeenTs` (so any dropped
`deliver` is recovered as a cache delta — renewal doubles as gap-recovery). A relay
that is not renewed by *any* subscriber for `DROP_MS` (default 180 s = three missed
renewals) tears its topic state down. A subscriber may briefly be attached to two
relays during a transition; this is harmless (deduped by `msgId`).

---

## 4. The tree: overload delegation, pinned by `via`

A topic starts with **one** relay — the root. We do **not** pre-recruit. The tree
grows only under load:

1. Root R's subscriber count exceeds `MAX_DIRECT`. R picks one of its **connections**
   (a synaptome neighbour) C to become a child relay and hands C a subset of its
   subscribers.
2. C becomes a relay, and `subscribe`s toward the Topic ID. That subscription routes to
   R (R is still closest to T), so **C is now a subscriber of R**, and R replays its
   cache *down* to C — populating C's cache so C can serve history to its own
   subscribers.
3. The handed-off subscribers now receive `deliver`s from C, so each records
   `from = C` and renews with `via = [C, …]`. Their renewals route **toward C first**,
   reattaching to C without bouncing back to R — *the tree is stable*. If C ever dies,
   the dead-waypoint fallthrough (§3) routes them back to T and they are re-seated.
4. C overloads → C delegates the same way. Depth grows as `log_MAX_DIRECT(N)`.

A subscribe that reaches a relay already managing the topic is simply added to that
relay's subscriber list; it is **not** forwarded further. Overload is always resolved
*locally* by the relay that feels it.

---

## 5. The root: stamping authority and the timestamp rule

**Only the root stamps**, and stamping authority is defined precisely — because `via`
routing means non-root nodes will see un-stamped messages in transit:

> **Stamping authority = "I am the routing terminus for this Topic ID" (closest to T).
> The *absence* of a timestamp tells that terminus it is the first root to see the
> message and must stamp it.** A `via` waypoint is *not* the terminus for T, so even
> though it sees an un-stamped message it **forwards without stamping**.

The root assigns `ts = max(lastTs + 1, localClock)` and sets `lastTs = ts`. Timestamps
are **strictly increasing**; the stamped message is what enters the cache and the
subscriber feed, and `ts` starts the **48 h** expiry clock. Because one node serialises
a topic, the feed is a single, sortable, enumerable order with **no cross-publisher
clock sync required**.

This one rule does **triple duty**:

1. **Normal publish** — un-stamped in → root stamps.
2. **Forwarding** — a child relay receives an already-stamped message → keeps it,
   does not re-stamp.
3. **Cache handoff on migration / durability (§6)** — a displaced or ahead relay
   replays its *already-stamped* cache toward the root → the root keeps those stamps
   and continues monotonically above them.

**Bad clocks.** If a root inherits cached messages stamped more than a few minutes in
the future (a prior root's clock was wrong), it **discards** them and stamps new
messages with its own local time. The bogus-future messages age out on the 48 h clock.
The total order is therefore strong *within a root's tenure* and *skew-bounded* across
migrations — not a perfect global clock, and we say so.

---

## 6. Self-healing and durability

**Migration to a closer node.** As the network changes, a node closer to a Topic ID
may appear. Renewals (which always target the Topic ID) then terminate at the new node,
which becomes the root. The displaced old root, on its own next renewal, no longer
self-loops — it lands on the new root and becomes its subscriber/child. Via the
timestamp rule (§5, duty 3) it **replays its stamped cache up**, handing history and
the `lastTs` watermark to the new root. The root is thus always the closest node, and
migration is loss-free.

**Abrupt failure.** If a root or relay dies without a graceful handoff, its subscribers'
next renewals fail the `via` leg and fall through to the Topic ID (§3), re-seating
within one renewal cycle (≤ 60 s; up to `DROP_MS` for the dead relay's state to clear).
Because cache is replicated down the tree, history is not gone — but the new root may be
empty. So durability requires one explicit mechanism:

> **Stamped-replay-up.** Renewal acknowledgements carry the relay's **cache
> high-water mark** (its highest `ts`). When a relay renewing toward T lands on a root
> whose high-water is *behind* the relay's own, the relay replays its newer stamped
> messages up. The root keeps them (timestamp rule) and advances `lastTs`. History
> survives abrupt root death as long as any one relay carrying it reattaches.

`via` and stamped-replay-up are orthogonal and compose: `via` preserves *attachment*
through topology change; stamped-replay-up preserves *the cache*. We build both.

---

## 7. `via` as a security waypoint — and its honest ceiling

The same `via` list lets a publisher route deliberately: `publish(topicId, via =
[W_random_in_another_region], …)` sends the message to a waypoint elsewhere *before* it
heads to T. A passive observer at the publisher's network edge sees traffic toward W's
region, not toward T's region. This is the **active** complement to the standing
principle that the envelope discloses *who* (signer) but never *where* (no Node ID /
region is ever placed in the kernel envelope).

**We do not call this anonymity.** Stated honestly:

- **One waypoint is not a mix.** W sees the hop before and the hop after it; a malicious
  W or a global passive observer can still correlate sender → topic. Unlinkability
  against an active or global adversary needs a **multi-hop `via` chain** where no
  single hop knows both ends — which is exactly why `via` is a list. But the guarantee
  a *single* `via` provides is only **path/location unlinkability against a local or
  regional passive observer**.
- **`via` hides path, not identity.** The envelope is still signed → W reads *who*.
  Location-unlinkability composes into real anonymity only with **anonymous publish**
  (the `ANONYMOUS` sentinel) *and* **payload encryption** (app-layer / Model 3 group
  key). `via` alone is "the edge can't tell which topic I feed," not "no one knows it's
  me."
- **It cannot forge tree placement.** A subscriber's `via` only expresses a *preferred
  path*; the relay that actually hosts the topic still decides membership. The only
  party a malicious `via` can hurt is the chooser (routing its own traffic through a
  node it picked).
- **It cannot amplify load** — bounded by `MAX_VIA`, `VIA_HOP_BUDGET`, and the global
  `MAX_HOPS` backstop (§2).

`via` is therefore the *primitive* on which stronger guarantees can later be built, and
a genuine traffic-analysis speed bump today — nothing more, and we will not market it as
more.

---

## 8. How it scales

Let `N` = subscribers to a topic, `f` = `MAX_DIRECT` (default 20).

- **Depth:** `log_f(N)`. 1 M subscribers at f = 20 → ~5 levels.
- **Per-relay load** is `O(f)`, independent of `N`: ≤ f direct subscribers; egress per
  message = f `deliver`s; renewals in ≤ f / `RENEW_MS`, out = 1 / `RENEW_MS`.
- **Total delivery work** = `feed_rate × N` (every message to every subscriber), spread
  across ~`N/f` relays → `feed_rate × f` each. Balanced; horizontal.
- **Cache memory** ≈ `(N/f) × CACHE_MAX × msgSize`, distributed. Replication is the
  price of tree-local late-join and durability.
- **The one axis that does not scale horizontally: root ingest.** Every publish for a
  topic routes to one node. This is the deliberate, accepted cost of a single
  serialisation point that gives a total order. It bounds *per-topic publish
  throughput* at one node's capacity — fine for ~all topics; a true firehose would need
  sharding that breaks total order, which is out of scope.

---

## 9. Honest limitations (stated, not hidden)

1. **Single-root ingest ceiling** — accepted (§8). The price of total order.
2. **Skew-bounded order across migrations** — strong within a tenure, skew-bounded
   across (§5). Not a global clock.
3. **Eventual, not synchronous, delivery** — a dropped `deliver` is recovered on the
   next renewal's cache delta (≤ `RENEW_MS`). No per-message acks by design.
4. **Transient duplicate roots/delivery** — possible if routing briefly terminates off
   the true closest node; harmless, deduped by `msgId`, converged by renewal. Relies on
   routing quality, which we keep measuring at scale.
5. **`via` ≠ anonymity** — §7.
6a. **Live-mesh findings (soak-axon vs the idealised dht-sim).** The dht-sim
   SimNetwork has near-perfect routing → 100 % at N=1000. The live testnet soak
   (`axona-stress/soak-axon`) over real WebRTC surfaced two things the sim could
   not:
   - **Empty-root cache GC (FIXED, v3.14.1).** A root caching messages with zero
     subscribers was torn down by `refreshTick` the instant subscribers hit 0,
     dropping the cache before a late joiner arrived → backlog/gap recovery 0 %.
     A root now persists while it holds non-expired cache (the cache ages out via
     the 48h TTL); regression in `smoke_pubsub_durability`.
   - **Convergence at scale on an imperfect mesh (OPEN).** At ~10 subscribers over
     real WebRTC, ~2 consistently stranded (delivery ~80 %), and a renewal cycle
     did not heal them. Root cause: a single greedy `routeMessage` walk can
     terminate at a *near*-closest node (a transient spurious root), and the
     stranded subscriber's renewal retraces the same greedy path. The old
     K-closest manager used an *iterative* lookup (alpha-parallel, dead-peer
     aware) which converges more robustly. Planned fix: a **lookup-assisted
     subscribe** — use `peer.lookup()` to find the true closest, then route the
     subscribe to that node id — restoring iterative-lookup convergence while
     keeping the single-root model. (Synaptome learning also improves this over
     minutes, but that is too slow for an app.)

6. **Anti-replay is freshness + msgId, not per-publisher seq (Phase 1 reduction).** The
   clean break dropped the old K-closest manager's per-publisher `seq` high-water gate.
   The routing-only root currently gates a live publish by absolute-time **freshness**
   (`checkFreshness`, ±5 min on the signed `ts`) plus content-addressed **`msgId`
   idempotency** (a duplicate is neither re-stamped nor re-fanned). This rejects a
   captured envelope outside the window and any exact re-injection inside it, but does
   **not** detect a same-publisher reorder/replay that is still time-fresh and not
   already cached. Restoring per-publisher monotonic seq detection is a **later
   hardening item** (not addressed in Phase 1/2); its parked smoke lives in the
   `test:legacy-pubsub` set.

---

## 10. Implementation phases (each gated before the next)

Replaces the K-closest / `sendDirect` core in `AxonaManager` wholesale; deletes the
v3.10.0 root-election gate as moot.

- **Phase 1 — routed core (single root, no tree). ✅ DONE (kernel v3.12.0).** The four
  operations on `route(…)` with the `via` list and the §5 stamping rule. Renewal loop,
  `since` gap-recovery, `DROP_MS` eviction. **Gate met:** `smoke_pubsub_fundamental` —
  five subscribers, one root, publish reaches all five — **5/5 across 25 configs**, plus
  late-replay, no-reflood, write-policy enforcement, via self-heal (the case that was
  `[4,4,2]/5` on `sendDirect`).
- **Phase 2 — the tree. ✅ DONE (kernel v3.13.0).** Overload delegation (§4) with `via`
  pinning and dead-waypoint fallthrough; non-root relays cache + re-fan down the tree;
  the root migrates/re-roots on death. **Gate met:** `smoke_pubsub_sweep` — nodes ×
  subscribers × churn (S = 5…160, incl. the sparse case that exposed the v3.10.0
  regression) — **100 % delivery** (pre- and post-churn), **exactly one root**, **fan-out
  ≤ MAX_DIRECT**, depth ~`log_MAX_DIRECT(S)` (1–2 at these sizes), **stable across random
  topologies**. Two invariants the sweep forced out and that any reimplementation must
  keep:
  - **Root-ness = routing terminus, not "I host it."** A node is the root iff a
    bare-topic message (`via` empty) terminates on it (it is the closest). A relay that
    *hosts* a topic but is no longer closest must NOT intercept bare-topic traffic — and
    a non-root relay that *becomes* the closest after the old root dies must be promoted,
    or it reroutes publishes to itself forever.
  - **Widen before deepen.** On overload a relay promotes a *new* sibling child
    (offloading a batch) before forwarding newcomers down into an existing child;
    deepen only when every direct is already a child. Deepen-first degenerates the tree
    into a near-linear chain (the old depth-~21 failure). A promote must actually free a
    slot (≥2 leaves to offload) — "promoting" the sole leaf frees nothing and lets the
    relay creep over `MAX_DIRECT`.
- **Phase 3 — migration + durability. ✅ DONE (kernel v3.14.0).** Stamped-replay-up: a
  `SUBSCRIBE` advertises the sender's cache high-water; a relay/root that is *behind* a
  reattaching subscriber sends `PULLUP`, the subscriber replays its stamped cache delta
  *up* (`REPLAYUP`), and the parent adopts those messages **without re-stamping** (the §5
  "timestamp present → keep it" rule), advances `lastTs`, drops any absurd-future stamp
  (§5 bad-clock rule), and propagates them down. Same handshake covers graceful migration
  and abrupt root death. **Gate met:** `smoke_pubsub_durability` — build a tree, publish
  M, **kill the root abruptly**, heal: the fresh root recovers the **full** pre-death
  history from a surviving cache-bearing relay, a brand-new late subscriber gets all M
  (0 = lost), delivery is monotone, and a post-recovery publish stamps **strictly above**
  the recovered history. Stable across random topologies.
- **Phase 4 — integration. ◑ IN PROGRESS (kernel v3.14.0).** Done: re-vendored the
  browser kernel into dht-sim; wired the `axona` engine + green-tree viz +
  real-kernel harness onto the new manager's tree shape (`role.subscribers` = the
  full delivery tree, `role.children` = the backbone). **Validated over the REAL
  kernel SimNetwork routing** (not the idealised fabric): **100 % delivery at
  N = 120 / 300 / 600 / 1000**, exactly one true root, 0 spurious roots, fan-out ≤
  `MAX_DIRECT`, depth ~2 — confirming the routing-only manager holds up on the
  kernel's greedy + 2-hop routing at scale. Remaining (gated): a multi-subscriber
  delivery-rate scenario in the soak, then the re-vendor/deploy to peer / relay /
  bridge (a coordinated kernel flag-day — needs explicit go-ahead).

Metrics and other side functions (kill/unpub/touch/metrics, and the per-publisher seq
anti-replay reduction noted in §9) change with this and are addressed **after** the core
is functional + deployed, per the standing decision.

---

## Appendix — message shapes (informative)

```
SUBSCRIBE  { topicId, via:[NodeId], subscriberId, since?, hw }  // hw = my cache high-water
PUBLISH    { topicId, via:[NodeId], json }              // no ts — root stamps
DELIVER    { topicId, from:NodeId, msgs:[{json,publishTs,msgId}] }  // routed to subscriberId
ADOPT      { topicId, parent:NodeId, subs:[{subscriberId,since}] }  // delegation (§4)
PULLUP     { topicId, sinceHw, parentId:NodeId }        // "replay your history up to me" (§6)
REPLAYUP   { topicId, msgs:[{json,publishTs,msgId}] }   // stamped history, routed UP
```

Constants (all tunable): `RENEW_MS=60000`, `DROP_MS=180000`, `CACHE_MAX=1024`,
`MAX_DIRECT=20`, `MAX_VIA=8`, `VIA_HOP_BUDGET=8`, `TTL=48h`, global `MAX_HOPS` (existing
backstop).
