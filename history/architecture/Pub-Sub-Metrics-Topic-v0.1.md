# Pub/Sub Metrics as a Derived Topic — subscribe, don't scatter-gather (v0.1)

> **Updated for kernel v4.3.0 (2026-06-25).** Three policy points below were
> superseded; the core idea (metrics as a derived, subscribable topic) is now
> the *only* path:
> - **`peer.metrics()` is no longer a scatter-gather.** It does a one-shot read
>   of the latest *published* snapshot from `metricTopic(T)` (briefly subscribing,
>   returning the freshest replayed snapshot). The on-demand `pubsub:metricsReq`
>   fan-out is gone. §1/§6 below describe the retired mechanism.
> - **Owned topics publish metrics too.** The "owner-only / open-topics-only"
>   privacy carve-out (§6 and the relay-skip in §8) is **reversed**: an owned
>   topic's activity counts are published to its (open) metric topic, so anyone
>   can subscribe. Only the topic's *messages* and *write* capability stay
>   owner-gated. The relay loop now skips **only** metric topics (recursion).
> - **Cadence is ~20 s**, not ~5 min (`DEFAULT_METRICS_INTERVAL_MS`). The 48 h
>   hold ceiling still bounds the rolling history (≈ shorter window at 20 s).
>
> Also in v4.3.0: `peer.unpub()` was removed and `peer.touch()` deprecated —
> unrelated to this note but part of the same release.

**Status:** architecture note / design rationale · **Flagged:** 2026-06-20 ·
**Relates to:** the pub/sub Application API (`peer.metrics(topic)`), the replay
cache + hold-time model (`MAX_HOLD_MS = 48 h`), and `host()`-based relays. This
note records the convention and why metrics move off the per-query scatter-gather
path. Implemented as a **core helper** (`metricTopic()` in `src/pubsub/metrics.js`,
exported from `@axona/protocol`); **no kernel state or wire change** — it is a pure
derivation, additive to the public API.

---

## TL;DR

`peer.metrics(topic)` is a **scatter-gather**: it sends `pubsub:metricsReq` to the
K nodes closest to the topic id, waits ~500 ms, and aggregates their replies. That
is fine for an occasional operator probe. It is **ruinous as an app primitive** —
if every client polls "how many subscribers / posts does this topic have" on a
timer, every poll fans out to K roots, and the cost grows with both the audience
*and* the poll rate. A popular topic watched by 10 000 clients at a 30 s interval
is ~330 scatter-gathers/second hitting its roots, forever.

**Fix:** the topic's **primary root publishes its metrics to a second topic
derived from the first.** Anyone who knows topic `T` can compute
`metricTopic(T)` and `sub()` it — they get the latest snapshot via
replay-on-subscribe and every subsequent update for free. One subscription
replaces an unbounded stream of point queries; the work to compute the metric is
done **once per cycle by one node**, not once per poll by every reader.

Because metric snapshots are ordinary published messages, they **accumulate in
the replay cache and age out at the 48 h hold ceiling** — so a subscriber gets a
**rolling ~48 h history for free** and can watch trends, with zero extra
replace/overwrite machinery. The cache TTL *is* the retention window.

---

## 1. The derivation

```
metricTopic(T) = { region: regionByte(T),
                   name:   "axona:metric:" + T }          // T = resolved 66-hex topic id
```

- `T` is the **resolved** topic id (`deriveTopicId(descriptor)` → 66 hex =
  regionByte ‖ SHA-256(canonical({owner, name, write}))).
- The metric topic **inherits T's region byte**, so it lives in the same regional
  keyspace band as its data topic.
- It is an **open topic** (no `owner` → `write: 'open'`).
- The name uses a **self-identifying reserved namespace** `axona:metric:` rather
  than a bare hash. This is deliberate: a root must be able to look at a topic and
  decide "this is a metric topic, do **not** compute metrics for it" — see the
  recursion guard (§4). A bare `H(T)` would be opaque and unrecognisable.

`metricTopic()` is pure and synchronous (the recursion guard must be a pure
predicate); the caller resolves the data topic first with the public
`deriveTopicId`. The reserved namespace is a frozen constant — changing it is a
flag-day for metric discovery.

```js
import { deriveTopicId, metricTopic } from '@axona/protocol';

const dataId = await deriveTopicId({ region: 'useast', name: 'lobby' });
await peer.sub(metricTopic(dataId),
  (env) => render(JSON.parse(env.message)),
  { since: 'all' });          // since:'all' → latest snapshot + the rolling history
```

The module also exports `isMetricTopic(descriptor)` (the recursion-guard
predicate), `isMetricTopicName(name)`, `dataTopicIdOf(descriptor)` (the inverse),
and the `METRIC_NAMESPACE` constant.

**Why core, not std.** This derivation and its recursion guard are a *protocol
convention*: clients and infrastructure roots must compute them byte-for-byte
identically, exactly like `deriveTopicId` (its sibling in `src/pubsub/post.js`).
The `std/` library is for *optional* app-layer helpers, and — decisively — the
relay, peer, and dht-sim all vendor **`src/` only** (their `sync-protocol.sh`
copies no `std/`). Putting the helper in core means it ships in every vendored
kernel through the existing sync, so the relay metric loop (§2) imports it with
**no dependency on std and no vendoring-script change**.

---

## 2. Who computes, and when

The **primary root of `T`** (the live node closest to `T`'s id — already the node
that aggregates `metricsReq` and holds the authoritative replay state) recomputes
metrics for `T` on a **~5-minute cadence** and `pub()`s a signed snapshot to
`metricTopic(T)`.

Crucially this is **self-triggered on the root's own liveness for `T`**: a relay
already `host()`s/roots a set of topics; for each non-metric topic it roots, it
runs the metric timer. No external request, no client-driven trigger. When a topic
goes cold (no roots), its metrics simply stop updating — which is itself the
honest signal (the last snapshot ages out of cache within 48 h).

A snapshot is the same shape `metricsReq` returns today, plus a timestamp and the
computing node's id:

```json
{ "topic": "<T>", "ts": 1718900000000, "by": "<rootNodeId>",
  "current_count": 1, "subscribers": 42, "posts": 17, "bytes": 81920 }
```

---

## 3. Rolling history (the trend window)

Metric snapshots are **ordinary published messages**. They are **not** overwritten
each cycle — each 5-minute snapshot is a new message with its own `msgId`
(`msgId = SHA-256(signerPubkey + message)`; distinct `ts` → distinct content →
distinct id, so the upsert does *not* collapse them). They accumulate in the
metric topic's replay cache and **age out at the `MAX_HOLD_MS = 48 h` ceiling**.

Consequences, all of which fall out for free:

- A new subscriber doing `since: 'all'` receives **the whole retained history**
  (≈ up to 576 snapshots at 5 min / 48 h) and can plot a trend immediately, then
  receives live updates as they publish.
- A subscriber only wanting "now" reads the **latest** (`pull(metricTopic(T))`
  with no msgId → latest).
- **No replace/overwrite/compaction machinery** — the bounded replay cache + hold
  ceiling already implement exactly the retention we want. The cache TTL *is* the
  trend window.

If 48 h × 5 min ever proves too coarse/fine, the only knob is the publish cadence;
retention is fixed by the hold ceiling and needs no new code.

---

## 4. The recursion guard

A metric topic is itself a topic with a root. If that root naively ran the metric
timer, it would compute *metrics-of-the-metrics* and publish them to
`metricTopic(metricTopic(T))`, ad infinitum.

The guard is the reason for the self-identifying namespace: **a root MUST skip any
topic for which `isMetricTopic(descriptor)` is true.** The check is on the
wire-visible signed descriptor `{ region, owner, name, write }` — the `name`
starts with `axona:metric:`, so the root recognises it and never schedules a
metric cycle for it. Metric topics are therefore served (replayed, held, killed)
like any other topic, but never *measured*.

---

## 5. Trust model — advisory, signed, not authoritative

The metric topic is **open**, so *anyone* can publish to it. A subscriber must
treat a snapshot as a **hint**, not a proof:

- The snapshot **is signed** (the computing relay signs with its identity), so a
  subscriber can pin trust to a known relay's `signerPubkey` and ignore the rest.
- The protocol **cannot statelessly prove** a metric snapshot is authoritative —
  counting subscribers/posts is inherently a soft, replicated, eventually-
  consistent quantity, and a malicious open publisher can post a fake snapshot.
- Mitigations are app-level and advisory: prefer snapshots signed by a relay in
  the app's trusted-roots set (the same first-party reputation the bridge
  directory uses); show the freshest few and let divergent ones be visible rather
  than silently picking one.

This is an acceptable bar because metrics are **decoration, not a security
control** — nothing in the protocol gates on them. Where an app needs a trustworthy
count it must derive it from data it can verify, not from this topic.

---

## 6. `peer.metrics()` stays — but owner-only (kernel v3.5.0)

The scatter-gather `peer.metrics(topic)` is **not removed**, but it is narrowed
to an **owner-only** reader: the root answers only the **owner of an owned**
(`write:'owner'`) topic — the cached publisher anchor must equal the proven
requester — and **refuses open / public / synthetic-regional topics outright**
(an empty cache, where ownership is indeterminate, also fails closed). So a
non-owner can no longer aim a K-root fan-out at any topic; open topics are read
only through the published metric topic. This shrinks the on-demand amplification
surface to owner-authenticated requests while giving an owner a private,
immediate read of their own topic (and an operator/debug probe). Rule of thumb:

| Need | Use |
|------|-----|
| Continuous per-user display of an **open** topic's metrics | `sub(metricTopic(T))` |
| Trend / history over the last ~48 h | `sub(metricTopic(T), …, {since:'all'})` |
| An **owner** reading their own **owned** topic, on demand | `peer.metrics(T)` |
| Open-topic public count | `sub(metricTopic(T))` — `metrics()` refuses it |

---

## 7. Cost comparison

Let a topic have **N** watchers polling every **P** seconds, K-closest fan-out
**K**, metric cadence **C** (≈ 300 s).

| | Root-side work | Wire fan-outs |
|---|---|---|
| `metrics()` polling | `N/P` reqs/s × K roots | `N·K/P` per second |
| Derived metric topic | **1 compute per C** at one root | snapshot fan-out once per C, then routed delivery to current subscribers |

The derived topic decouples cost from **both** the audience size and the poll
rate: the expensive part (counting) happens **once per cadence at one node**
regardless of how many are watching, and distribution rides the normal pub/sub
delivery path the subscribers were already paying for.

**Observed on testnet (2026-06-20, single keyspace-hosting relay).** One relay
republishing every 8 s: cycle 1 = `{rooted:535, published:299, skipped:236}`;
cycle 2+ = `{rooted:833, published:299, skipped:534}`, `failed:0`. The recursion
guard converges exactly as designed — the ~298 metric topics created in cycle 1
are rooted by cycle 2 (rooted +298) and recognised + skipped (skipped +298), so
`published` plateaus at the open-topic count. Two scale notes follow:

- **Topic count roughly doubles** — each open data topic spawns one metric topic.
  Bounded by the same replay-cache caps; the guard ensures it does not cascade.
- **A metric topic accrues one snapshot per rooting relay per cadence** (distinct
  `ts` ⇒ distinct `msgId` ⇒ all retained). That is the intended "multiple advisory
  sources, sign-pinnable" history (§5), but on a large fleet it is the dominant
  consumer of a metric topic's cache budget — a future cap (keep the freshest N
  per signer, or per-signer quota) is the natural lever if it bites.

---

## 8. Status & scope

- **Shipped (kernel v3.4.0):**
  - *Derivation* — core helper `src/pubsub/metrics.js` (`metricTopic`,
    `isMetricTopic`, `isMetricTopicName`, `dataTopicIdOf`, `METRIC_NAMESPACE`),
    exported from `@axona/protocol`, + `smoke_metric_topic`. Pure, additive, no
    wire change; reaches every relay via the normal `src/` vendor.
  - *Read side (mechanism)* — `peer.rootedTopics()` (`AxonaManager.rootedTopics`)
    enumerates the topics a node roots, each with its signed descriptor + a
    local metric snapshot (`current_count`, `subscribers`, `bytes`), no network.
    Covered by `smoke_rooted_topics`.
- **Shipped (relay v0.16.0):** the **publish side** — `src/metrics-loop.js`
  (`startMetricsLoop`). Every ~5 min it walks `peer.rootedTopics()` and publishes
  a signed snapshot to `metricTopic(T)` for each **open** topic, skipping metric
  topics (recursion guard) and owned topics (privacy). Env: `RELAY_METRICS`
  (default `1`), `RELAY_METRICS_INTERVAL_MS`. Signed by an ephemeral per-process
  author (advisory provenance). Unit-tested in `test/metrics-loop.test.mjs`.
- **Next:** deploy the relay fleet on v0.16.0 + kernel 3.4.0 (testnet first) and
  verify live — a client `sub(metricTopic(T))` receives snapshots for a warm open
  topic, and neither metric nor owned topics get republished.
- **Out of scope:** a verifiable/authoritative count (see §5); per-app trust
  policy beyond "prefer trusted-root signatures"; tuning cadence vs. the 48 h
  retention (§3); a stable (non-ephemeral) relay metrics author.
