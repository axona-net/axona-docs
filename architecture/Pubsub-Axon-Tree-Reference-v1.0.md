# Axona Pub/Sub — Routing-Only Axon Tree: reference & analysis (v1.0)

Reconstruction-grade description of the **shipped** pub/sub (kernel v4.2.x;
`src/pubsub/AxonaManager.js` + the routing layer in `src/dht/AxonaPeer.js`),
**plus** an evidence-labeled analysis (pros/cons, weakness ledger) and the proposed
churn re-homing fix. Sufficient to rebuild the system and to analyse it
independently. Original design intent: `Pubsub-Axon-Tree-v0.1.md`; this documents
what the code actually does.

**Contents.** Part I — Architecture (§0–§15, reconstruction reference). Part II —
Analysis (§16 performance · §17 security · §18 robustness · §19 scalability · §20
overall + weakness ledger). Part III — §21 the churn re-homing fix.

Evidence labels used in Part II: **[measured]** = data from this codebase's sims this
cycle; **[architectural]** = follows necessarily from the design; **[speculative]** =
reasoned from the code, not tested; **[untested]** = no data either way.

---

# PART I — ARCHITECTURE (reference)

---

## 0. The one invariant

> Pub/sub uses **only DHT message routing**. There are no managed/direct pub-sub
> connections. Every interaction is a routed message delivered, hop by hop, to the
> single live node **XOR-closest to a 264-bit target**. The closest live node to a
> topic id is the **emergent, never-elected ROOT**.

Everything below is a consequence of this rule.

## 1. Identifiers & addressing

- **Node id** — 264-bit: `[8-bit S2 region prefix] ‖ [256-bit SHA-256(pubkey)]`.
- **Topic id** — 264-bit: `regionByte ‖ SHA-256(canonical({owner, name, write}))`,
  where `regionByte` = the explicit region (or, for an owned topic with no region,
  a key-derived region). `deriveTopicIdBig()` in `post.js`.
- **Distance** — XOR of the two 264-bit integers; "closest" = minimum XOR.
- A topic's **root is whatever live node is XOR-closest to its topic id.** Nothing
  is stored that says "X is the root"; it is purely a function of who is alive.

## 2. Routing substrate (`AxonaPeer.routeMessage`)

All pub/sub messages are handed to `dht.routeMessage(targetBig, type, payload, opts)`.
Per hop:

1. **Greedy next hop:** among this node's synaptome (its connected peers), pick the
   one with smallest `peerId XOR target` that is **strictly closer than self** and
   actually connected (dead/disconnected peers skipped). 
2. **Terminal test:** if no connected neighbor is closer, run a **2-hop lookahead**
   (`_findCloserInTwoHops`); if that also finds nothing closer, this node is the
   **routing terminus** (`isTerminal = true`).
3. **Local dispatch:** `_deliverRouted` invokes the registered handler for `type` at
   *every* hop, passing `{ fromId, targetId, hopCount, isTerminal }`. A handler
   returns `'consumed'` to stop routing; any other return ⇒ forward to the next hop
   (bounded by `MAX_HOPS`).
4. **Via waypoints:** `_send` routes toward `via[0]` if the payload carries a `via`
   list, else toward `payload.topicId`. This is how a subscriber is "pinned" to its
   relay yet always falls back to the bare topic id.

The terminus for a bare topic id is, by construction, the closest live node = the root.

## 3. Per-node state

```
axonRoles:        topicId → Role          // topics this node hosts (root or child relay)
  Role = { isRoot, subscribers:Map(subHex→{since,lastRenewed}),
           children:Set(subHex of child relays),
           cache:[{msgId,publishTs,json,bytes}], cacheIds:Set, cacheBytes,
           lastTs,                          // highest stamp emitted (root authority)
           tombstones:Map(msgId→expireTs) }
mySubscriptions:  topicId → {since, lastRenewSent}   // topics this node's APP consumes
_upstream:        topicId → [hex]           // the relay we renew toward (pin)
_rootBeacons:     topicId → {root, exp}     // soft-state root pointer (verify-don't-trust)
_hostedTopics:    Set(topicId)              // host()ed without app consumption
_lastSeenTsByTopic, _appDelivered (exactly-once LRU), _rootHint (cached lookup)
```

A node may simultaneously be: root of some topics, a child relay of others, an app
subscriber of others, and a pure forwarder for traffic that merely passes through.

## 4. Root selection (emergent, never elected)

`_topicDecision(payload, meta)` classifies a topic-targeted message at the current node:
- **bare topic id (no via) + terminal →** `handle` (this node is the root)
- bare topic id + not terminal → `forward`
- via[0] === self + I host it → `handle`; via[0] === self + I don't → `reroute`
- via[0] ≠ self + terminal (waypoint is dead) → `reroute` (pop via, route on)

When a node `handle`s a bare-topic SUB/PUB and has no role for it, it calls
`_becomeRoot()` (creates a root Role) and `_maybePromoteRoot()` sets `isRoot=true`.
**That is the entire election: "I am the closest reachable node, therefore I am the
root."** No vote, no quorum, no announcement required.

## 5. How a publish reaches the root

The root **is** the closest live node, so a publish "reaches the root" exactly when
greedy routing converges to that node. Three things make that robust:

1. **Greedy routing to terminus** (§2): `peer.pub` → route `T.PUB` toward the topic
   id → terminates at the closest reachable node.
2. **Root-hint pinning** (`_rootHint_`): the publisher consults a fresh **root beacon**
   (or a cached background lookup) and, if known, pins `via = [root]` so the publish
   routes straight to the known root — bypassing greedy local minima on a gappy mesh.
   Non-blocking: it sends immediately with whatever hint it has, refreshing in the
   background.
3. **Last-mile correction** (`_onPub`): if a node that is *acting* as the terminus
   holds a fresh beacon naming a root **strictly closer** to the topic than itself, it
   forwards the publish there and **demotes** the spurious root it had claimed (so a
   near-miss node on a sparse mesh stops intercepting). Strictly-closer-only is a
   verify-don't-trust gate — a beacon can never divert a publish to a *farther* node.

So: a non-closest node can *transiently* act as root during convergence, but beacons
+ the strictly-closer forward pull the publish onto the true (closest) root, and that
node demotes the impostor. At steady state the publisher is pinned and it is one routed
walk to the root.

**Root ingest** (`_ingestPublish`): verify signature + msgId (B-4) → freshness (C-2) →
recompute topic id and confirm it matches → enforce write policy (an `owner`-write
topic requires `signerPubkey === owner`) → dedup by msgId → **STAMP**
`ts = max(lastTs+1, now)` (the single monotonic serialization point — this is what
gives the topic a total order) → cache → fan out → deliver locally.

## 6. The tree (bounded fan-out)

A root does not hold thousands of subscribers directly. `_accept`:

- Under `MAX_DIRECT = 20` direct subscribers → seat directly.
- At capacity → **widen before deepen**: `_promoteChild` promotes one leaf
  subscriber to a **child relay** and hands it a batch of `DELEGATE_BATCH = 8` other
  leaves via an `ADOPT` message. Further overflow when all directs are already
  children → `_pickChild` delegates the newcomer to the child **XOR-closest to it**.
- Result: a bushy tree, depth ≈ `log_20(S)` for S subscribers.

A node told to `ADOPT` (`_onAdopt`) creates a **non-root** Role, sets
`_upstream = [parent]`, accepts the handed-off subscribers, and **subscribes UP**
toward the topic (pinned via its parent) to receive the live feed + cache replay.

**Pinning:** whenever a node receives a `DELIVER`, it sets `_upstream` to the
`from` of that deliver (`_onDeliver`). So a subscriber renews toward *its relay*, not
the root — the root never sees most subscribers' renewals.

## 7. Message flow

- **Publish:** `peer.pub` → signed envelope → route `T.PUB` (via root hint) → root
  `_ingestPublish` (stamp/cache/fan) → `_fanout` routes a `T.DELIVER` to each direct
  subscriber.
- **Relay re-fan** (`_onDeliver` at a child relay): pin upstream to `from`; for each
  message not already cached, cache once and `_fanout` DOWN to its own subscribers
  once (excluding the sender); deliver to local app if subscribed.
- **Exactly-once app delivery:** `_deliverToApp` dedups on `topic:msgId` via an LRU;
  a pure relay (not app-subscribed) stores+forwards but does not consume.

## 8. Subscription & renewal

- `peer.sub` → `pubsubSubscribe`: record in `mySubscriptions`, `_sendSubscribe` →
  route `T.SUB` toward the topic (pinned via `_upstream` if set, else the root hint,
  else bare topic id). The SUB carries `since` (gap recovery) and `hw` (high-water,
  for durability §9).
- `_onSub` at the handling relay/root: become/promote root or accept; seat (or
  delegate per §6); then `_replayTo` sends the cache delta newer than `since` plus a
  **repin ping** (a possibly-empty DELIVER so the subscriber pins `_upstream` to this
  relay).
- **Renewal** (`refreshTick`, every `refreshIntervalMs`, gated by `RENEW_MS = 60 s`):
  app subscriptions and non-root relays with subscribers re-send their SUB toward
  `_upstream`. This single act is **keepalive + failure detector + self-heal +
  gap-recovery** all at once. A relay evicts a subscriber after `DROP_MS = 180 s`
  (3 missed renewals).

## 9. Durability — stamped-replay-up (§6 of design)

Each relay/root caches up to `CACHE_MAX = 1024` messages / `16 MB`, held `TTL = 24 h`
keyed on the stamp. A `SUB` advertises the sender's high-water `hw`. If the receiving
node is **behind** (`hw_received > my high-water`) it routes a `PULLUP` to the
subscriber; the subscriber answers with `REPLAYUP` carrying its stamped cache delta;
the receiver **ingests without re-stamping** (keeps the existing `publishTs`, advances
its `lastTs` above it) and re-fans down. This carries a topic's recent history across
**abrupt root death** (a fresh empty root rebuilds its history from any surviving
cache-bearing subscriber/relay that reattaches) and graceful migration.

## 10. Failure recovery — how the tree reconnects

This is the crux. There is **no explicit "relay died" notification.** Recovery is
entirely a consequence of the via-fallback routing rule + renewal:

- **A waypoint that is gone falls through to the topic id.** A subscriber/relay renews
  toward `_upstream = [relay]`. The SUB routes toward `via[0] = relay`. If the relay
  is dead/unreachable, the node closest to it sees `via[0] ≠ self` + terminal →
  `reroute` → pops the via → routes toward the **bare topic id** → reaches whoever is
  now closest → that node `_accept`s (and `_becomeRoot`/promotes if it's the root
  position) and replies with a repin DELIVER. The renewer is re-seated, now pinned to
  the new node. *"A dead waypoint always falls through to the topic id and re-seats."*

- **Child relay dies:** its subscribers' next renewal can't reach it → fall through to
  the topic id → re-seat at the surviving tree (the root, which may re-delegate them to
  a sibling child). Their subtree, if they were themselves a sub-relay, comes with them
  once *they* re-home.

- **Root dies:** the old root's **direct children** (sub-axons + direct subscribers)
  renew → upstream unreachable → fall through to the topic id → reach the **new
  closest live node** → it becomes root and adopts them. **Leaves under a surviving
  sub-axon do NOT re-home** (their upstream — the sub-axon — is alive); only the broken
  backbone link re-homes. Stamped-replay-up (§9) restores the new root's history from
  the reattaching cache-bearing relays (their `hw` > the fresh root's 0). The **root
  beacon** accelerates convergence: the basin learns the new root, and renewers consult
  `_rootHint_` to pin straight to it.

- **The re-home latency = `RENEW_MS` (≈ 60 s).** A node does not detect a dead upstream
  until its next renewal. This renewal-gated window is the measured "orphaning" gap: a
  subscriber seated at the old root is absent from the new root's subscriber set until
  it renews, so publishes in that window miss it. (Empirically the dominant churn loss;
  the open work is event-driven re-home — re-subscribe immediately on a beacon that
  names a new root — and/or root-side subscriber-set handoff on promotion.)

- **GC** (`refreshTick`): evict stale subscribers (`DROP_MS`); expire cache &
  tombstones (`TTL`); tear down a Role that is empty **and** not locally needed — kept
  if it is a root still holding non-expired history, app-subscribed, explicitly
  `host()`ed, or keyspace-hosted.

## 11. Root beacon (soft-state convergence aid; `Pubsub-Root-Beacon-v0.1`)

A root announces `{root: me, topics:[…]}` to its `BEACON_FANOUT = 6` XOR-closest
neighbors (the topic basin), recursive `BEACON_LAYERS = 2`, every `BEACON_MS = 20 s`
and immediately on promotion. Receivers **verify-don't-trust**: accept the pointer
only if `root` is at least as close to the topic as their own best-known node (so a
liar can't divert traffic to a farther node); cache it for `BEACON_TTL = 50 s`; if a
strictly-closer root is named and they had wrongly claimed root, **demote and renew
toward the named root**; forward once within the basin. Consumed by `_rootHint_`
(pin via) and the `_onPub` last-mile correction (§5). It is a *hint layer* over
routing — never authoritative, never required for correctness.

## 12. Security gates (in the publish/subscribe path)

- **B-4** signature + `msgId` verification at root ingest and on replay-up.
- **C-2** envelope freshness (seq + TTL + domain separation) on live ingress.
- **Write policy:** `write:'owner'` topics drop any publish whose `signerPubkey ≠ owner`.
- **Topic-id recomputation:** the root recomputes the topic id from the signed
  descriptor and drops a mismatch (a publish can't be routed to a topic it isn't for).
- **Subscriber-origin (B-1):** a SUB's `subscriberId` must be the authenticated sender.
- **Beacon verify-don't-trust** (§11); inbound size/count caps (D-1); exactly-once.

## 13. Wire messages (all routed)

`sub, unsub, pub, deliver, adopt, pullup, replayup, kill, unpub, touch, pull,
pullresp, rootbeacon` — see the `T` table in `AxonaManager.js`. `pub` carries **no**
timestamp (the root stamps); `deliver` carries the stamped messages + the relay's id
(`from`, used for pinning); `adopt` carries the parent id + the handed-off subscriber
batch.

## 14. Tunable constants (current)

| const | value | meaning |
|---|---|---|
| `RENEW_MS` | 60 s | re-subscribe cadence (= the re-home / orphan window) |
| `DROP_MS` | 180 s | evict a subscriber after 3 missed renewals |
| `MAX_DIRECT` | 20 | direct subscribers before a relay delegates |
| `DELEGATE_BATCH` | 8 | subscribers handed to a newly promoted child |
| `CACHE_MAX` / `CACHE_BYTES` | 1024 / 16 MB | per-relay cache bound |
| `TTL_MS` | 24 h | message hold (keyed on root stamp) |
| `MAX_VIA` / `VIA_HOP_BUDGET` | 8 / 8 | waypoint list + per-leg hop caps |
| `BEACON_MS` / `_TTL` / `_FANOUT` / `_LAYERS` | 20 s / 50 s / 6 / 2 | root beacon |
| `MAX_PUBLISH_BYTES` / `MAX_RELIABLE_PUBLISH_BYTES` | 256 KB / 15 KB | publish size cap / reliable floor |

## 15. Properties & known limits (for independent analysis)

- **Total order** per topic from the single root stamp; **exactly-once** app delivery.
- **Convergence-sensitive:** a single greedy walk (not iterative lookup) can strand on
  a sparse/gappy mesh; beacons + non-blocking background lookup + renewal heal it over
  a renewal cycle. Clean mesh → 100% first-shot; imperfect mesh → converges.
- **Churn fragility is renewal-gated re-homing,** not root identity: the measured loss
  under churn is subscribers orphaned at a changed root until their next `RENEW_MS`
  renewal (§10) — not root-thrash per se. Open fix: event-driven re-home + root-side
  subscriber handoff.
- **Relays/roots are ordinary peers** — no privilege; a relay is just an always-on node
  that tends to win the closest-position and (optionally) `host()`s. Stability-weighted
  root election was investigated and rejected (it doesn't move delivery; see
  `Pubsub-Stability-Root-Election-v0.1.md`).

---

# PART II — ANALYSIS

## 16. Performance

**Pros.** Total order is free — one root stamp per topic gives a serialization point
+ exactly-once app delivery with no consensus round. Bounded fan-out tree
(`MAX_DIRECT=20`, depth ≈ log₂₀N) → few hops/delivery, no flooding, no node buried by
fan-out. Steady state is cheap (pinned subscribers renew via their relay, not the root).

**Cons.** **[architectural]** The root is a per-topic serialization bottleneck —
every publish funnels through one node (verify Ed25519 + freshness + stamp + fan-out);
a hot topic's throughput is one node's CPU, with no horizontal scaling.
**[measured-ish]** Publish latency = route-to-root + tree depth, and route-to-root is
variable on a sparse mesh (greedy convergence). **[architectural]** Replay-on-join cost
scales with the relay's cache (≤24h / 1024 msgs).

## 17. Security

**Pros (tested by smokes).** Layered ingest gates: B-4 publisher signature +
content-hash `msgId`; C-2 freshness (anti-replay); write-policy (owner-only topics
reject non-owner publishes); topic-id recomputation (no misrouting to another topic);
B-1 subscriber-origin; D-1 size/count caps. Beacon **verify-don't-trust** (a hint is
accepted only if it names a root at least as close → can never divert to a *farther*
node). Dual-key identity: envelope discloses **who**, never **where**.

**Cons / risk surface.** **[speculative]** The root is a powerful, capturable position
— it sees the entire subscriber set (metadata/social-graph) and can **censor** by
dropping a publish or omitting subscribers from fan-out (capability is real in code; no
adversarial test). **[speculative, ties to open E-1]** Closer-Sybil capture — root-ness
is pure XOR-closeness, so grinding a key to land nearest a topic id legitimately
captures its root; beacon verify-don't-trust does NOT stop a genuinely-closer Sybil.
**[architectural]** Intermediary relays cache + re-fan plaintext envelopes (content +
metadata transit untrusted peers; mitigated only by app-layer encryption). **[open —
Phase A #4]** Root DoS via publish flood (no per-publisher quota). **[untested]**
kill/unpub/touch are thin stubs; abuse surface unexamined.

## 18. Robustness

**Pros.** Self-healing with no explicit failure detector — a dead upstream falls
through to the topic id and re-seats; "who delivers to you" *is* "who you renew
toward," so a relay change re-pins on the next delivery. Durability across root death
via stamped-replay-up; 24h hold + replay-on-join for late/reload subscribers;
exactly-once app delivery.

**Cons.** **[measured]** Renewal-gated re-homing → ~60s orphan window is the dominant
churn loss (relay-poor + 30%/round Lindy → ~46–56% delivery; 93% of misses = subscribers
not seated at the current root; forcing immediate re-seat → 91%). **Addressed by
adaptive renewal in v4.2.3 (§21): 43% → 75%.**
**[measured]** Convergence-sensitivity — a single greedy walk strands on sparse/gappy
meshes (~80% at scale historically; cold-topic discovery 0% pre-beacon, 75–100% variable
with it). **[speculative]** Split-root during convergence until beacon + strictly-closer
correction reconcile (coded; worst-case duration uncharacterized). **[untested]**
History-loss window — if the only cache-bearing node holding recent history churns before
reattaching, stamped-replay-up has nothing to recover from.

## 19. Scalability

**Pros.** Per-node fan-out bounded (20); beacon reach basin-scoped (tens of nodes near
the topic, not global) → scales with topic count, not network size; no global state.
**[measured]** Validated to ~1000 peers in dht-sim (real kernel, idealized mesh): 100%
delivery, depth ~2–4, fan-out ≤20.

**Cons.** **[architectural]** Single root = per-topic throughput ceiling (no horizontal
scaling of a hot topic). **[untested — the open scaling question]** Root re-subscribe
load during a root change at thousands of subs — argued bounded by tree fan-out (only the
backbone re-homes; leaves under surviving sub-axons don't), but the harness could NOT
cleanly measure it; **no trustworthy number exists**. **[untested]** Live scale beyond
~1000 / small testnet. **[speculative]** Tree balance under skewed subscriber-id
distributions; beacon traffic at high per-node topic density (cap 256 topics/beacon).

## 20. Overall quality + weakness ledger

**Pros.** Conceptual economy — one invariant, ~960 lines, no separate membership
protocol to desync → genuinely analyzable. Clean layered security with tests; honest,
documented limits; total-order + exactly-once first-class. **Cons.** The churn
re-homing fix (§21) is designed but unbuilt; side functions are stubs; a structural
tension (renewal cadence trades background traffic against orphan window); two
load-bearing claims unmeasured (large-scale live delivery; root-change load).

| Tier | Weakness |
|---|---|
| **Known / measured** | 60s renewal-gated orphan window dominates churn loss (41→91% with re-seat) · single greedy walk strands on sparse mesh (~80% scale) · per-topic single-root throughput ceiling (architectural) |
| **Speculative** | Root capture via closer-Sybil → censorship + subscriber-set metadata leak (ties to open E-1) · intermediary relays see plaintext · root DoS via publish flood (Phase A #4) · split-root reconciliation latency |
| **Untested** | Root-change re-subscribe load at thousands of subs · live scale beyond ~1000 · stamped-replay-up under lost/adversarial history · tree balance under skewed ids · beacon traffic at high topic density · kill/unpub correctness |

**Center of gravity:** excellent at low churn + bounded fan-out, with total order +
exactly-once as real strengths; the weakness center is **churn behavior in the
relay-poor (mobile) regime**, where the measured problem is **subscription re-homing
latency** (§21), not root election or routing — plus an inherent single-root
throughput/centralization axis from the total-order choice.

---

# PART III — THE CHURN RE-HOMING FIX (§21; adaptive renewal IMPLEMENTED in kernel v4.2.3)

## 21.1 Problem

A subscriber renews toward its pinned `_upstream` every `RENEW_MS = 60 s`. When its
relay/root churns out, it stays seated at the dead position until that next renewal
falls through to the topic id and re-seats — a ~60s **orphan window** during which
publishes miss it. **[measured]** This is the dominant churn loss: 93% of misses are
subscribers not seated at the current root.

## 21.2 The fix — adaptive renewal (IMPLEMENTED, kernel v4.2.3)

**Correction to an earlier idea:** "event-driven re-home via a root beacon" does NOT
work — beacons reach the topic's basin (the root's XOR-closest neighbors), but the
tree's sub-axons and leaves are promoted from *subscribers* with **random ids**,
scattered across the keyspace and not in the basin. An already-attached subscriber
almost never receives the beacon. The lever that reaches **every** subscriber is the
one it already owns: its **renewal timer**.

**Shipped mechanism — adaptive subscriber renewal** (`AxonaManager`, v4.2.3):
- A subscription renews at an **adaptive interval**, not a flat 60s. It starts at a
  **fast floor `renewFastMs = 5s`** on subscribe, and **backs off ×1.5 toward the
  `renewMs = 60s` ceiling** on each *stable* renewal.
- A **re-pin** — a `DELIVER` whose `from` differs from the current `_upstream`, i.e. a
  relay change after a churn (`_onDeliver`) — **snaps the interval back to the fast
  floor**. So a subscriber that just re-homed monitors its new attachment closely and
  re-homes quickly again if it too churns.
- The refresh tick was lowered to 5s so the fast floor can actually fire.
- Net: **sustained churn keeps re-pinning → subscribers stay near 5s → fast re-home;
  calm → they back off to 60s → cheap.** Self-tuning: fast exactly when (and where)
  churn is happening; no extra steady-state traffic when stable. Wire-compatible (local
  timing only — no flag day). `DROP_MS=180s` (≥3× ceiling) unchanged.

**Still future (not built):** root-side subscriber-set handoff on graceful promotion
(the new root inherits the table, zero gap + no herd). Lower priority — mobile churn is
mostly *hard* (background/kill/signal-loss), where adaptive renewal already carries the
win, and handoff only helps the graceful case.

## 21.3 Why it helps mobile

Mobile = constant session turnover (2–3 min visits, backgrounding, signal loss). At that
churn rate some relay in your path is almost always freshly-churned, so 60s re-homing keeps
you chronically partially-orphaned → the ~50% collapse. Event-driven re-home makes
re-attachment track the **churn timescale (seconds)** not the **renewal timescale (a
minute)** — the tree heals faster than it breaks. Handoff makes the common graceful case
(a closer node joins) free.

## 21.4 Evidence status

- **[measured] The lever (`renewMs` sweep).** Relay-poor, 30%/round Lindy churn, real
  kernel: delivery **60s → 43%, 12s → 58%, 5s → 82%** (monotonic) — renewal cadence is
  the lever, and it reproduces the `REHOME` proxy's ~91% via the *real* mechanism.
- **[measured] The shipped fix (adaptive renewal, v4.2.3).** Same scenario, no override:
  **43% → 75% ± 18** (matches the flat-5s point, since sustained churn keeps subscribers
  near the fast floor). Unit-pinned by `smoke_adaptive_renewal` (backoff sequence +
  re-pin reset); full kernel suite green; wire-compatible.
- **[measured caveat]** High variance (±18) — this is the harsh stress case; the residual
  gap to 100% is inherent convergence/transient loss plus the *first-hit-after-calm*
  window (a long-stable subscriber backed off to the 60s ceiling whose root suddenly dies
  still waits up to 60s — rare under sustained churn, which keeps it fast).
- **[unmeasured]** New-root re-subscribe load at thousands (the herd) — adaptive renewal
  does not *worsen* it (re-subscribes are spread over each node's own timer, not
  synchronized), but the absolute load is still unmeasured. Root-side handoff (the herd
  mitigation for graceful changes) is not built.
- **[not deployed]** v4.2.3 is committed + tagged but not yet re-vendored to the fleet /
  re-validated live — gated on the deploy decision.
