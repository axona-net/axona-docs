# Team Update — kernel v4.17.0 → v4.17.2 on testnet (2026-07-03)

Three point releases landed on testnet today on top of v4.16.1. All are
**wire-4.0** — no flag day, no API change, apps keep working unchanged. Live
versions: bridge app **2.59.0**, peer **3.46.1** (index v0.79.0), relay backbone
**0.44.0** — all report **kernel 4.17.2**. Production stays on the 3.x line
(4.x → prod is a separate, wire-major cutover).

The headline is **4.17.1: cross-region pub/sub now works.** If your app has
participants in more than one region, read that section.

---

## 4.17.1 — cross-region pub/sub delivery restored (the important one)

**Symptom:** a subscriber whose node was in a *different* region than a topic
got **0% delivery**. Intra-region was fine. This broke any app with a fixed
topic region and a geographically spread user base — e.g. a Civil Defense alert
channel, or `axona-minimal`/`axona-peer` where the topic is pinned to us-east but
a user's node is us-west.

**Cause:** the root-hint resolver consulted only *locally-known* peers. A node
in region A holds few or no synapses into region B, so it decided it was itself
the closest node to a region-B topic and formed a **second, disjoint root** —
splitting the topic's tree so the publisher's messages never reached the
subscriber.

**Fix:** before a node roots a topic itself, it now falls back to the network's
**iterative closest-node lookup**, which hops through the mesh and crosses
regions to find the real root. Publisher and subscriber converge on one root
regardless of where their nodes sit.

**The principle, stated plainly:** *the region prefix is a placement HINT, not a
routing wall.* A topic ID still carries its region in the high byte, so topics
land near their region for locality — but that never gates who can reach or
serve them. Any node routes to any topic like any other DHT key.

### What this means for app authors

- **You no longer need node-region == topic-region.** A us-west user can join a
  us-east-pinned channel and receive normally. The `CONVERGENCE RULE`
  (all participants resolve the same *topic* region) still holds — that's about
  computing the same topic ID, and it always did.
- Nothing to change in your code. If you previously worked around this by
  forcing everyone into one region, you can stop.

---

## 4.17.0 — topic durability through node loss + self-root history replay

Shipped earlier in the day (also wire-4.0):

- **Departure-triggered backup promotion.** A topic's cache is replicated from
  its root to nearby backups. Previously a backup waited a fixed ~65 s of
  silence before taking over, so when a root actually *left* the network, new
  subscribers could read an empty topic for that whole window. A backup now
  promotes ~8 s after it observes the root has genuinely left the reachable set,
  while still waiting the full interval for a root that's merely quiet — a
  live-but-lossy root is never split.
- **Self-root history replay.** A node that itself holds a topic's cache and
  subscribes `since:'all'` now replays that history to its own app (its outbound
  SUB carries a high-water mark and wouldn't otherwise self-seat).

---

## 4.17.2 — first-publish delivery hardened against convergence races

Two idempotent reliability tweaks to the publish path (the root dedups by
message ID, so a re-send never double-delivers):

- **Cold-publish burst extended.** A freshly-joined node already re-sent a cold
  publish 5× over the first second while its routing table warmed; it now runs a
  **second, slower wave** (5 more sends over ~2 s) to keep getting fresh shots at
  the true root as integration continues.
- **Warm first-publish double-send.** The **first** publish to a topic — even
  from an already-integrated node — is re-sent once ~200 ms later, so a message
  published in the instant a topic's tree is forming (a subscriber that just
  arrived, a root that just rooted) isn't lost to a single-shot timing race.
  Repeat publishes to that topic stay a single send.

No API or wire change; publish reliability just improves for the cold-start and
first-message cases that mattered most for real-time alerts.

---

## Caveats / known issues

- **Testnet bridge is under-provisioned.** The current droplet (458 MB, 1 vCPU,
  no swap) sheds connections under sustained load, which makes the relay backbone
  flap. Because cross-region routing hops through the relays, a *cold or flapping*
  backbone can transiently strand cross-region delivery (it recovers once the
  mesh re-meshes). Upsizing the droplet is the real reliability fix and is
  pending — independent of the kernel changes above.
- **No cross-region regression test yet.** The 4.17.1 bug shipped undetected; a
  multi-region delivery smoke is on the list so it can't silently return.

## Verifying it yourself

```js
// A us-west node subscribing to a us-east topic now delivers:
const topic = { region: 'useast', name: 'my/channel' };
await sub.peer.sub(topic, onMessage);      // node anywhere → still reaches the useast root
await pub.peer.pub(topic, msg, { signWith }); // delivered
```
