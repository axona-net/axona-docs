# Note for Howard — use `peer.ready()` instead of the synapse-count loop

**TL;DR:** your instinct to *not* hand-roll the connect gate was right — the
kernel now owns it. Replace your `connect()` wait loop with one line:
`await this.peer.ready(...)`. Needs kernel **≥ 4.8.2**.

## Background (what your tests found)

Your `axonSpec2.js` runs surfaced two real bugs, both now fixed on testnet:

1. **Wrong/foreign root in a crowded region** — a topic's root is the node
   XOR-closest to the Topic ID; on the shared testnet that was often a node
   (frequently the *bridge*) that couldn't serve, so the subscribe stranded and
   nothing was delivered. Fixed in **v4.8.1**: the bridge is excluded from
   root candidacy, and the bridge now fences off older kernels
   (`STRICT_MIN_KERNEL`) so the island is clean. Your move to `uscentlw` was the
   right call — it's an uncontended region.
2. **Subscribing before the mesh formed** — your updated `connect()` skips the
   synapse wait on v4 (`if (parseInt(this.version) < 4)`), so it subscribes when
   `connected to 1 node` (just the bridge). The SUB strands in a not-yet-formed
   mesh and heals only slowly (we saw your 16–36 s first-delivery and the 60 s
   `beforeAll` timeouts). That's exactly what `peer.ready()` fixes.

## The change

In your `connect()`, replace this:

```js
if (parseInt(this.version) < 4) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const size = this.synaptomeSize;
    if (size >= synapseCount) break;
    await this.constructor.delay(200);
  }
}
```

with this (drop the version guard entirely — it's the same for v4):

```js
// Wait for the mesh to converge before any sub/pub. Kernel-owned, so you don't
// have to poll synaptome yourself, and it won't hang in a small mesh.
await this.peer.ready({ minPeers: synapseCount, timeoutMs });
```

That's it. `peer.ready()` returns `{ ready, peers, ms, reason }` if you want to
log it (e.g. `this.log('mesh ready', r.peers, r.reason, r.ms + 'ms')`).

## How `peer.ready()` decides

Resolves as soon as **any** of:

- `synaptome.size >= minPeers` — a healthy mesh formed (usually < 1 s on the
  testnet bridge). `reason: 'minPeers'`.
- the synaptome **stopped growing** for `stableMs` (default 1500 ms) — a small
  mesh converged to whatever is available. This is the key fix for your old gate:
  a 3-node mesh resolves at 2 synapses instead of hanging forever waiting for
  `synapseCount = 4` it can never reach. `reason: 'stable'`.
- `timeoutMs` elapsed — resolves `ready: false` (it never throws). `reason: 'timeout'`.

Options (all optional): `{ minPeers = 4, timeoutMs = 10000, stableMs = 1500, pollMs = 150 }`.

## What you'll see

Running your suite against testnet with this change (kernel ≥ 4.8.2):

- nodes connect to ~18–21 peers in ~1 s,
- **initial** and **after-kill** phases deliver in **single-digit milliseconds**,
- **restart** phase is mostly clean but still occasionally times out.

That restart flake is on us, not your harness: when a topic's peer-root *leaves*
and the new subscribers must re-converge on a fresh root, there's a residual we're
fixing next (a liveness-based root re-route). It's worse in `uscentlw` because no
infra relay hosts that region yet — if you want it rock-solid sooner, we can stand
up a relay there, or you can `host()` the topic on your own always-on node.

## One requirement

You must be on kernel **≥ 4.8.1** or the testnet bridge will reject you with close
code **4426** ("kernel … below minimum") — that's the version fence that keeps the
island clean. `npm update @axona/protocol` (or re-point your local checkout) to
**4.8.2** to get `peer.ready()` as well.
