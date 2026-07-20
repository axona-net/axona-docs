# Team Update — Axona kernel **v4.8.2**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** the **4.x line runs on testnet** — `testnet.axona.net`,
`demo-testnet.axona.net`, the testnet relay fleet. **Production is untouched and
still on 3.x.** The wire-4 partition from v4.0.0 still holds.

> Supersedes the **v4.8.0** update. This covers the **live cross-peer
> reliability** work (v4.8.1 + v4.8.2): why pub/sub was flaky on the shared
> testnet, what we fixed, and a new `peer.ready()` API you should adopt.
>
> **Correction to the v4.8.0 update:** two claims there were wrong and are
> retracted — (1) the "10–30 s connect is a benign red herring" line (it was an
> artifact of one 3-node test config, not a general truth), and (2) the
> "verified live" delivery claim (that test used a useast topic + a single
> sample; the real cross-peer case was still flaky). The corrected picture is
> below.

---

## TL;DR

1. **Flaky live cross-peer delivery is largely fixed** — diagnosed to **keyspace
   contention**, fixed across v4.8.1 + v4.8.2. An uncontended region is now 8/8;
   a contended region went from ~5/8 to ~9/10.
2. **The bridge is no longer eligible to be a topic root (v4.8.1).** It was being
   picked as the XOR-closest "root" for same-region topics and couldn't serve →
   subscribes stranded. Now excluded from root candidacy.
3. **`STRICT_MIN_KERNEL` lets a bridge fence off older kernels (v4.8.1).** The
   client-hello now carries `kernelVersion`; testnet floors at 4.8.1 to isolate a
   clean island.
4. **New API: `await peer.ready()` (v4.8.2).** Await mesh convergence before your
   first `sub`/`pub`. This is the single most important change for app authors —
   see §3.
5. **You must be on kernel ≥ 4.8.1 to connect to testnet** (the bridge rejects
   older with close 4426).

---

## 1. What was actually wrong: keyspace contention

A topic's **root** is the live node XOR-closest to the Topic ID. Because a node's
id is `region-byte ‖ hash(pubkey)` and a topic's id is `region-byte ‖ hash(...)`,
the closest node to a topic is almost always **some node in the same region**.

In a **crowded** region (e.g. uswest `0x80`: the bridge, relays, many browser
tabs all sharing the `0x80` prefix), the root often landed on a node that
**couldn't serve** — and the routed subscribe-k stranded there, so the topic tree
never formed (`role=—` everywhere, zero delivery). In an **empty** region the
only candidates were the test nodes themselves, which always cooperate → 100%.

We proved this with a hop-trace on the live testnet: in the failures, every
subscribe and publish routed to the **bridge's** node id and stopped there.

## 2. The fixes (v4.8.1)

- **Bridge excluded from topic-root candidacy.** `findKClosest` / the root hint /
  the greedy next-hop selectors now skip `transport.bridgeNodeIdBig`. The bridge
  brokers connections; it is never a topic root. (Necessary, but on its own only
  removed the most common bad winner — other foreign nodes remained.)
- **`STRICT_MIN_KERNEL` admit gate.** The client-hello carries `kernelVersion`;
  set `MIN_KERNEL_VERSION`… (note: env is **`STRICT_MIN_KERNEL`**) on the bridge
  to reject (close 4426) any client below the floor. Testnet floors at **4.8.1**,
  which isolates a clean single-kernel island from older 4.x nodes that can't
  root. Together with bridge-exclusion, a contended region went **5/8 → 9/10**.

> Note on STRICT_MIN_KERNEL: it's an **operator** knob for testnet hygiene, not a
> default. Gating on *exact* kernel everywhere would Balkanize the network (every
> point release its own island); the standing partition remains the wire major.

## 3. New API — `await peer.ready()` (v4.8.2)  ← adopt this

The remaining slowness wasn't routing — it was **subscribing too early**. If you
`sub`/`pub` the instant after `join()`, your synaptome is still just the bridge;
the SUB strands in a not-yet-formed mesh and heals only over slow renewal cycles
(we measured 16–36 s first delivery, sometimes past a test's timeout).

`peer.ready()` waits for the mesh to converge first:

```js
await peer.join();
const { ready, peers, ms, reason } = await peer.ready({ minPeers: 4, timeoutMs: 8000 });
// now sub/pub — delivery is immediate
```

Resolves as soon as **any** of:
- `synaptome.size >= minPeers` — a healthy mesh formed (usually <1 s), `reason:'minPeers'`;
- the synaptome **stopped growing** for `stableMs` — a small/relay-poor mesh
  converged to whatever is available (a 3-node mesh resolves at 2, **never hangs**
  waiting for an unreachable count), `reason:'stable'`;
- `timeoutMs` elapsed — `ready:false`, `reason:'timeout'` (never throws).

This replaces any hand-rolled "loop until N synapses" gate. **Measured impact**
on the civildefense suite: initial-phase delivery **16–36 s → 5–18 ms**; full
suite ~0 → passing reliably.

**As an app:** call `await peer.ready()` once after `join()`, before your first
subscribe. Nothing else changes.

## 4. Honest status & what's left

- **Cold-start (subscribe-after-join): fixed** by `peer.ready()`.
- **Contention (wrong/foreign root): fixed** by bridge-exclusion + the
  STRICT_VERSION island.
- **Still open — convergence after churn.** When a topic's peer-root *leaves* and
  new subscribers must re-converge on a fresh root (the suite's "restart" phase),
  there's a residual flake. The fix is a **liveness-based root re-route**
  (re-subscribe fast when the elected root doesn't ack / churns) — next on the
  list. Regions with a stable hosting relay are far less exposed; a region with
  no infra host (e.g. `uscentlw`) feels it most.
- **Also queued:** verify-at-delivery (a subscriber should re-verify the envelope
  signature before app delivery — flagged in the v4.8.0 update §7, still open).

---

## 5. Versions in this release

| Component        | Version  | Note |
|------------------|----------|------|
| `@axona/protocol`| **4.8.2**| kernel (tagged); adds `peer.ready()` |
| axona-bridge     | 2.42.0   | re-pin @v4.8.2; `STRICT_MIN_KERNEL=4.8.1` on testnet |
| axona-peer       | 3.41.0   | re-vendored |
| axona-relay      | 0.26.0   | re-vendored |
| Axona Minimal    | 0.13.0   | demo app |

Bridge-exclusion + STRICT_VERSION landed in **v4.8.1**, `peer.ready()` in
**v4.8.2**. All wire-compatible within wire-4 — no flag day.

*Kernel `@axona/protocol` v4.8.2 · testnet only · production remains on 3.x.*
