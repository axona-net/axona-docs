# Load-Aware Root Placement — anchor vs. root, and a reluctant `defer` (v0.1)

**Status:** design note / proposal · **Flagged:** 2026-07-01 · **Kernel baseline:**
v4.14.0 (held). **Relates to:** the routing-only axon tree
([Pubsub-Axon-Tree-v0.1](./Pubsub-Axon-Tree-v0.1.md)), the region-occupancy rule
(kernel v4.13.0), reachable-root fallback + singleton-root replication (v4.9–v4.11),
and `findKClosest`/`ADOPT`. **Read alongside** the two prior NO-GOs it deliberately
does *not* repeat: [Stability-Weighted Root Election](./Pubsub-Stability-Root-Election-v0.1.md)
(NO-GO — dynamic root movement for *durability* bought ~0 and thrashed) and
[Root Beacon](./Pubsub-Root-Beacon-v0.1.md) (NO-GO past a small radius).

> **Not built. Not approved.** This records a state machine to critique on paper,
> then falsify in `dht-sim` (≥5 seeds, mean±sd) **before** any kernel change. The one
> genuinely new primitive is a local load budget + a `defer` decision; the one genuine
> risk is root thrash. Nothing here ships until the sim earns it.

---

## TL;DR

Root placement today is **load-oblivious**: `_topicDecision` seats the role on whatever
live in-region node is XOR-closest to the topic id, with no capacity input. A node that
sits closest to several hot topics becomes a hotspot the protocol won't relieve — it
absorbs load until it degrades or dies, and only *then* does rootship migrate (reactively,
by failover). We want the root to be able to live at a node that is **not** the closest,
chosen for capacity — without a coordinator, without a trust hole, and without
reintroducing the "root moves and can't be found" convergence failure the beacon fixed.

The proposal splits one conflated thing into two:

- **Anchor** — the node the keyspace points at (XOR-closest, deterministic, found by
  routing). Unchanged. Cheap to find; everyone converges there.
- **Root** — the node actually holding the topic's replay cache and fan-out. Allowed to
  differ from the anchor, **but constrained to the topic's K-closest set** (the ladder
  `findKClosest` already computes and singleton-replication already recruits).

Rootship goes to the **closest candidate in the K-set that is under its load budget**.
Saturated closer candidates *step aside* into a pointer role instead of rooting. Because
the ladder is a pure function of the topic id, anyone can recompute it, discovery stays
coordination-free, and the root is always a **verifiable K-closest member** — never an
arbitrary node. The invariant softens from *"closest node roots"* to *"closest
under-budget node in the K-set roots."*

---

## 1. The problem

`_topicDecision(payload, meta)` returns `handle` / `reroute` / `reject` on exactly two
inputs: am I the routing terminus for this topic id, and am I in the topic's region. No
load, no role count, no queue depth. `_becomeRoot` then seats the role unconditionally,
and there is no `maxRoles` cap anywhere. The only load relief that exists is **per-topic**:
`_accept` delegates *subscribers* of a single hot topic to child relays once a root passes
`MAX_DIRECT = 20` (the "widen before deepen" fan-out tree). Aggregate overload — one node
root for *many* topics, or a topic whose publish/replay volume alone exceeds the node's
bandwidth — has no protocol response. The `_nodeStats` traffic counters on `DHTNode`
**measure** per-node load but feed nothing back into placement.

Consequence: overload is handled by *death and failover*, which under sustained pressure
oscillates — take roles → saturate → drop → the next-closest node inherits the *same* hot
set → repeat. Classic load-oblivious-DHT hotspot, and the flip side of the region-lock
hotspot concern.

## 2. The reframe: anchor vs. root

Separate **where the keyspace points** (anchor — fixed, discoverable) from **where the
work happens** (root — placeable for capacity). Today they're the same node; that identity
is what makes the hotspot unavoidable. Once split, the design question is only: *where does
the root go, and how does everyone still find it* — without a coordinator or added trust.

## 3. Keep the root inside the K-closest ladder (why not a free pointer)

The tempting design — "the anchor holds a pointer to any delegate node" — is rejected:

- A free pointer to an arbitrary node means the anchor must **sign** the redirect and
  subscribers must **trust** the anchor's choice. That breaks Axona's "no privileged
  server; verify placement by XOR distance" property and creates a topic-hijack surface
  (whoever controls the anchor controls the root).
- It's a single fragile pointer with no natural recomputation on anchor churn.

Instead, the candidate roots are the **K nodes XOR-closest to the topic id** — the set
`findKClosest` returns, that subscribe-k targets, and that singleton-root replication
already warms as backups. Rootship is the **closest candidate under budget**. Properties
this buys for free:

- **Verifiable, not trusted.** Any peer can recompute the K-closest and confirm the serving
  root is a legitimate member. Load only *reorders within* the candidate set; it never
  points outside it.
- **Region-correct by construction.** The in-region K-closest *are* the ladder, so
  displacement never crosses a region boundary (the v4.13.0 rule holds without extra checks).
- **Warm failover.** The next candidate already holds a replicated cache.
- **Bounded displacement.** The root is at most K-deep in the ladder, not anywhere on the ring.

## 4. The three mechanics

### 4.1 Local load budget + a `defer` decision
Add a **self-assessed** budget derived from the existing `_nodeStats` counters —
aggregate bytes/sec + active role count + summed direct-subscriber count — compared to a
per-node ceiling. **Never** a peer's *claimed* load (untrusted, grindable). Give
`_topicDecision` a fourth outcome beside `handle`/`reroute`/`reject`:

> **`defer`** — "I am the terminus for this topic, in-region, but over my load budget."

On `defer` the node does **not** seat the role; it hands the topic down the ladder (§4.2).
`handle` still requires terminus ∧ in-region ∧ **under budget**.

### 4.2 Step-aside = ADOPT the next candidate + hold a recomputable pointer
Reuse the existing **ADOPT** frame (it already carries "become root for this topic, take
these subscribers, here is the cache high-water"). A deferring anchor:

1. Computes the ladder, picks the **next candidate under budget** (probing the ladder,
   nearest-first; a candidate answers a cheap capacity ping).
2. Sends it `ADOPT` (role + current subscriber cohort + high-water) — it becomes the root.
3. Keeps a lightweight local `{ role: 'anchor', redirect: rootId }` — no cache, no fan-out.

Then, for traffic that still routes to the anchor (new joiners): **SUB / PULL get a redirect
reply** (like an HTTP 302) carrying the resolved `rootId`; the subscriber caches it and
thereafter talks to the root directly, so the anchor is a **one-time indirection, not a
per-message tax**. **PUB** is simply forwarded down (publish already routes through the tree;
we never ack the publisher — the no-ack-to-publisher invariant is untouched, since a redirect
is a subscriber-facing reply, not a publish ack).

**Bounded to one hop:** a deferring node hands to the next *under-budget* candidate, never to
another deferrer, and the ladder is recomputable — so there are **no redirect chains**.

### 4.3 Hysteresis — or it thrashes
This is the load-bearing safety property. A node must **not** reclaim a topic the instant its
load dips, or roots ping-pong and you get the storms the beacon/stability notes warn about.
Rules:

- **Sticky shed.** After deferring a topic, mark it shed for a cooldown; don't re-terminate it.
- **Dwell to reclaim.** Reclaim only when local load stays below a *lower* threshold (band gap)
  for a dwell window — asymmetric thresholds, not a single line.
- **Honor what you serve.** Subscribers you already hold are load you *keep*, not load you dump;
  `defer` gates **new** role formation, it does not evict a healthy existing root.

## 5. Discovery & convergence

A joiner routes toward the topic id → lands on the anchor (unchanged, cheap). If the anchor
is the root, done (today's path). If the anchor stepped aside, it redirects once to the
resolved root, which the joiner caches. Worst case is **+1 hop for a cold joiner**, amortized
away by caching. Existing subscribers are unaffected — they were moved by `ADOPT` at
step-aside time and already talk to the new root.

## 6. Churn

- **Root dies** → next ladder candidate takes over from its warm replicated cache. This is
  literally today's reachable-root fallback, generalized from *closest-reachable* to
  *closest-reachable-**and-under-budget***.
- **Anchor dies** → the new XOR-closest node becomes anchor, recomputes the ladder, and
  rediscovers the serving root via the replication cohort / anti-entropy (or one probe down
  the ladder). Pure soft state; self-heals.

## 7. When the whole K-set is saturated

This is **not** a routing failure to paper over — it is a **capacity signal**: the topic's
region genuinely lacks nodes to serve demand. Handle it as such, in order:

1. **Widen K** — pull in more of the in-region neighborhood as candidates.
2. **Surface it** — emit a health/metric signal that the region is under-provisioned
   (reuse the derived metric topic).

Do **not** fall back to an out-of-region node — that recreates exactly the cross-region
hotspot the v4.13.0 region-lock forbids.

## 8. Code touch-points (if approved after sim)

- `src/utils/hexid.js` / node — a load model: `nodeLoad()` from `_nodeStats` + a budget
  constant + `_overBudget(topic)` with **asymmetric** thresholds and cooldown/dwell state.
- `AxonaManager._topicDecision` — add the `defer` outcome (terminus ∧ in-region ∧ over-budget).
- `AxonaManager._onSub/_onPub/_onPull` — on `defer`: ladder-probe → `ADOPT` next candidate →
  install `{ redirect }` anchor state; SUB/PULL answer with a **redirect** reply; PUB forwards.
- Redirect handling client-side — cache the resolved root per topic; invalidate on
  root-unreachable and re-resolve down the ladder.
- Reuse: `findKClosest` (ladder), `ADOPT` (handoff + cohort + high-water),
  `_selfClosestReachable` (generalize to `_selfClosestReachableUnderBudget`).
- **Wire:** ADOPT is unchanged; the only addition is a lightweight redirect reply. If we can
  piggyback `rootId` on an existing SUB/PULL ack, this stays **wire-compatible (no flag day)** —
  to be confirmed against the frame set.

## 9. Risks and the validation bar

- **Thrash is the primary risk.** Prior art is explicit: stability-weighted root election was
  a NO-GO (durable-root gain 48→52%, inside noise, prototype worse) and beacon-radius widening
  stormed past a small radius. **Difference in objective:** we are not chasing marginal
  durability — we are avoiding node *death*, a sharper and more defensible trigger. But the
  mechanism is still dynamic root movement, so it inherits the thrash failure mode and must
  earn its place.
- **Methodology bar (non-negotiable):** single-seed sim delivery % is noise. Any claim here
  needs **≥5 seeds, mean±sd**. Success = (a) hotspot node's peak load materially reduced,
  (b) delivery %/convergence **not** worse than the load-oblivious baseline, (c) no observable
  root oscillation under steady load.
- **Load metric honesty.** Budget must be self-measured from real counters; a peer's claimed
  capacity is never trusted for placement (grinding surface).
- **Eclipse surface.** Confirm `defer` doesn't hand an attacker a cheaper way to push a topic
  onto a chosen node than the existing K-closest admission already allows (it shouldn't — the
  root stays within the verifiable K-set).

## 10. Open questions

- **Budget shape** — bytes/sec vs. role-count vs. subscriber-count, and the ceiling (fixed?
  device-class-relative? adaptive to observed capacity?).
- **Threshold band + dwell** — the actual numbers that avoid thrash; find them in sim, don't
  guess them in the kernel.
- **Ladder probe cost** — is a capacity ping per candidate acceptable, or should candidates
  gossip a coarse load hint (careful: hints from peers are advisory only, never authoritative)?
- **Interaction with the fan-out tree** — a hot *single* topic is already offloaded by
  `MAX_DIRECT` delegation; `defer` is for *aggregate* overload. Confirm the two compose (a
  node can shed whole topics while still running the per-topic tree for the ones it keeps).

## Next step

Prototype the `defer` path + load model in `dht-sim` and measure against §9's bar before any
kernel work. If it can't beat the load-oblivious baseline on peak-load-reduction **without**
hurting delivery/convergence across ≥5 seeds, it does not ship — same discipline that retired
stability-weighted root election.
