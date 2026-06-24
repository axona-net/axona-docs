# Pub/Sub Root Beacon — v0.1 (spec)

Companion to [Pubsub-Axon-Tree-v0.1](./Pubsub-Axon-Tree-v0.1.md). Targets the
**last-mile convergence failure** measured on the live testnet (§9.6a + the
2026-06-24 attachment/reachability probes): publisher and subscribers run
*independent* iterative lookups on a gappy WebRTC mesh, resolve **different**
nodes as "closest to the topic id," and a publish routed to one never reaches
subscribers homed on the other. The soak quantified the cost — kernel v4.0.0,
16 clean cycles: scale 41 % (healed == initial → no recovery), backlog 63 %,
churn 63 %, gap 56 %, all gated by a root that moves and is hard to find.

The beacon replaces **N independent, error-prone lookups** with **one
authoritative announcement** propagated to the place routing actually needs it:
the XOR-neighborhood of the root, where greedy routing dead-ends.

This is additive — a soft-state caching layer over existing routing. It does
not change root election or the wire's pub/sub semantics; it only adds one new
neighbor-scoped message and a hint cache consulted before falling back to
lookup. Wire stays 4.x (new optional message type; old 4.0 peers ignore it).

---

## 1. Concept

A node that is the **root** for a topic (`role.isRoot && terminus`) periodically
announces *"the root for topic T was last at transportID X"* to the **K nodes
XOR-closest to T** — which, because the root is itself closest to T, are just
the root's own closest mesh neighbors. Recipients:

1. **cache** the pointer `T → X` as soft state with a short TTL, and
2. if still within the basin, **re-forward once** (2-layer recursion) to *their*
   K closest neighbors.

When anyone later routes a publish/subscribe toward T, they consult the cache
first: a fresh, *verified* pointer short-circuits the divergent lookup and
steers the message to the real root. Stale/absent → fall back to today's
greedy + iterative-lookup path. Nothing breaks if beacons are lost; they only
ever *improve* convergence.

Soft state, "last seen here" — eventually consistent hint, never an authority.

---

## 2. Wire (one new type)

```
T.ROOTBEACON = 'pubsub:rootbeacon'
payload = {
  root:    <hex nodeId>,        // who is announcing itself as root
  topics:  [<hex topicId>, …],  // topics `root` currently roots (aggregated)
  beaconId:<hex 16B>,           // dedup key for the flood
  layer:   <int>,               // remaining forward hops (starts at BEACON_LAYERS)
  at:      <ts>,                // root's clock when emitted (soft, advisory)
}
```

Sent via `dht.routeMessage(neighborId, T.ROOTBEACON, payload)` — addressed to a
specific neighbor id, so it lands in **1 hop** (routing-only; not a direct-send
bypass). `root → subscribers` (down-tree) is handled separately and cheaply by
folding the authoritative `root` id into the existing periodic `deliver`/renew,
so subscribers learn the true root, not just their immediate upstream relay.

---

## 3. State (AxonaManager)

```
this._rootBeacons   = new Map();  // topicBig -> { root: hex, at, exp }   inbound cache
this._beaconSeen    = new Map();  // beaconId -> exp                      flood dedup (LRU/TTL)
```

New dht-adapter method (backed by `transport.boundPeers()`):

```
dht.neighbors() -> bigint[]   // currently-connected authenticated peer ids (local, no network)
```

Constants:

```
BEACON_MS        = 20_000   // emit cadence (faster than RENEW_MS=60s so churn heals quickly)
BEACON_TTL_MS    = 50_000   // inbound pointer validity (≈2.5×BEACON_MS: survives a missed beacon, dies within ~1 churn)
BEACON_FANOUT    = 6        // K closest neighbors per layer  → fan-out ≈ K + K² ≈ 42 worst case
BEACON_LAYERS    = 2        // recursion depth (covers the convergence basin)
BEACON_SEEN_MS   = 60_000   // dedup retention
```

---

## 4. Emission (root side)

In `refreshTick`, throttled to `BEACON_MS` (track `_lastBeaconAt`):

```
_emitRootBeacons() {
  const rooted = [...this.axonRoles].filter(([t, r]) => r.isRoot).map(([t]) => t);
  if (!rooted.length) return;
  const neigh = this.dht.neighbors?.() ?? [];
  if (!neigh.length) return;
  // basin ≈ root's own K closest neighbors (root is closest to all topics it roots);
  // aggregate ALL rooted topics into one beacon per neighbor.
  const self = idBig(this.nodeId);
  const basin = neigh.sort((a,b) => cmpXor(a,b,self)).slice(0, BEACON_FANOUT);
  const payload = {
    root: idHex(this.nodeId),
    topics: rooted.map(idHex),
    beaconId: randHex16(),
    layer: BEACON_LAYERS,
    at: this._now(),
  };
  for (const nb of basin) this.dht.routeMessage(nb, T.ROOTBEACON, payload);
}
```

(For a relay rooting many topics across a wide keyspace the single-basin
approximation is coarse; v0.1 accepts it because hosted topics cluster near the
relay's id. v0.2 may bucket topics by sub-prefix and beacon each bucket to its
own basin.)

---

## 5. Receipt + verify-don't-trust + re-forward

```
_onRootBeacon(payload, meta) {
  if (this._beaconSeen.has(payload.beaconId)) return;          // dedup the flood
  this._beaconSeen.set(payload.beaconId, this._now() + BEACON_SEEN_MS);
  const rootBig = idBig(payload.root);
  for (const tHex of payload.topics) {
    const tBig = idBig(tHex);
    // VERIFY-DON'T-TRUST (anti-poisoning, ties to E-1 eclipse surface):
    // accept only if `root` is at least as close to T as the best node *I*
    // would route to on my own. A beacon pointing somewhere NOT closer than my
    // own knowledge is a lie/stale and is dropped.
    const mine = this._bestKnownClosest(tBig);   // local: nearest of {neighbors ∪ self ∪ cached}
    if (mine != null && xor(rootBig, tBig) > xor(mine, tBig)) continue;
    this._rootBeacons.set(tBig, { root: payload.root, at: payload.at, exp: this._now() + BEACON_TTL_MS });
  }
  // 2-layer recursion: forward once to MY closest neighbors, scoped to the basin.
  if (payload.layer > 1) {
    const neigh = this.dht.neighbors?.() ?? [];
    const self = idBig(this.nodeId);
    const fwd = { ...payload, layer: payload.layer - 1 };
    for (const nb of neigh.sort((a,b)=>cmpXor(a,b,self)).slice(0, BEACON_FANOUT)) {
      if (idBig(nb) === idBig(meta?.fromId ?? 0n)) continue;   // don't bounce back
      this.dht.routeMessage(nb, T.ROOTBEACON, fwd);
    }
  }
}
```

`_bestKnownClosest(tBig)` is **local only** (neighbors + self + live cache) — it
never triggers a network lookup, so the verify step is cheap and can't be used
to amplify traffic.

---

## 6. Consulting the cache (the payoff)

The beacon cache becomes the **highest-priority** source inside `_rootHint_`,
ahead of the lookup-derived hint:

```
_rootHint_(topicBig) {
  const b = this._rootBeacons.get(topicBig);
  if (b && this._now() < b.exp) return b.root;     // authoritative, fresh → use it
  // …unchanged: cached iterative-lookup hint, else trigger bg lookup, else greedy ([])
}
```

This covers publish (`pubsubPublish`) and subscribe (`_sendSubscribe`) at the
source. Plus a **last-mile correction at the relay**: in `_ingestPublish`, if I
receive a PUB but I am *not* the true root and I hold a fresh beacon pointing
elsewhere, re-route to the beacon root instead of accepting it:

```
// _ingestPublish, before stamping/accepting:
const b = this._rootBeacons.get(topicBig);
if (b && this._now() < b.exp && lc(b.root) !== lc(idHex(this.nodeId))
    && !viaPinnedHere) {
  this._send(T.PUB, { topicId: idHex(topicBig), via: [b.root], json });  // forward to real root
  return;
}
```

This is exactly the basin fix: the node that *would* have dead-ended one hop
short is in the basin, holds the beacon, and corrects the final hop.

---

## 7. Churn behavior (answers "what if the anchor/root is churned away")

- The cached pointer is **soft state with a TTL < beacon interval × 2**. A root
  that churns away → its pointers **expire** within ≤ `BEACON_TTL_MS`; routing
  falls back to greedy/lookup until the *new* root's first beacon refreshes the
  basin (≤ `BEACON_MS` after it's established). Worst-case dark window ≈ one
  beacon period, not an outage.
- No single point of failure: the beacon is a *hint*, not a dependency. With
  beacons fully absent the system is **exactly today's behavior** (greedy +
  lookup). It degrades down, never below.
- Composes with the separate **root-stability** work (anchor a stable host()ing
  relay + hysteresis): a still root means beacons rarely go stale. Beacon first
  (additive, low risk); stability second (reduces staleness).

---

## 8. Security

- **Verify-don't-trust (§5)** blocks the black-hole/false-root beacon: a liar
  can only point at a node genuinely closer to T than the receiver's own best —
  i.e. it cannot divert a publish to a *farther* node. It does **not** by itself
  defeat a Sybil placed genuinely close to T (the open **E-1** eclipse/address-
  grinding finding); that remains gated by the existing proximity/PoW work and
  is unchanged by this spec.
- Beacons reuse the signed-envelope plumbing for origin (`meta.fromId` is the
  authenticated sender); the `root`/`topics` claim is advisory and only ever
  *narrows* routing toward a verifiably-closer node.
- Bounded cost (§3): fan-out ≤ `K + K²` per beacon, dedup'd flood, TTL'd caches
  → no amplification, no unbounded state.

---

## 9. Gate (soak) + tests

- **New soak scenario `discovery`** (`axona-stress/soak-axon.mjs`): the exact
  demo flow that fails today — N subscribers settle, then a **brand-new cold
  publisher** connects and publishes within ~2 s (no warm-up). Records
  `coldDeliveryPct`. Baseline today ≈ the scale failure (~40 %); target with
  beacons ≈ ~100 %. Added now so we capture the **before** number and gate the
  change on the **after**.
- **Kernel smoke** `smoke_pubsub_beacon.mjs`: a Fabric variant with *gappy*
  reachability (a publisher whose greedy terminus ≠ the true root) — assert that
  a beacon in the basin corrects the publish to the root and all subscribers
  receive. (The idealized Fabric routes to true-closest, so the gappy variant is
  required to exercise the divergence the beacon fixes.)
- Existing gates (fundamental/sweep/durability) must stay green — the beacon is
  additive and off the critical path when caches are empty.

---

## 10. Phasing

1. `discovery` soak scenario + baseline capture (no kernel change).  ← gate first
2. Kernel: `T.ROOTBEACON`, `dht.neighbors()`, emission, receipt+verify, cache in
   `_rootHint_` + `_ingestPublish` correction; `smoke_pubsub_beacon`.
3. Re-vendor + testnet deploy (wire-compatible, no flag day); re-run soak,
   compare `discovery`/scale/backlog/churn/gap before→after.
4. (separate) root-stability: anchor + hysteresis to minimize beacon staleness.
