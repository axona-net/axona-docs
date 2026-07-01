# Team Update — Axona kernel **v4.10.1**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** live on **testnet** — bridge v2.51.1, relay v0.36.0, peer v0.70.0.
**Production is untouched and still on 3.x.** Wire-compatible (WIRE 4.0, no flag day).

> A follow-on to v4.10.0. After the cohort-distribution fix we audited the *rest* of the
> pub/sub API against the same invariant — *a topic's authoritative state lives in the
> K-closest cohort* — and found the read/host paths still assumed a single root. Fixing
> them turned up a bigger surprise: **metrics had been dead on the entire 4.x line.**

---

## TL;DR

1. **Metrics were silently broken since the v3.14 flag-day.** `rootedTopics()` — the
   producer the relay metrics-loop iterates — was dropped in the v3.12 routing-only
   rewrite. So `peer.rootedTopics()` returned `[]`, relays published no snapshots, and
   `peer.metrics(topic)` returned `{stale:true, …zeros}` for every topic. Rebuilt.
2. **Two new metric fields you asked for.** Each snapshot now carries **`current_count`**
   (messages currently in the cache) and **`seq`** (the root's dense *message counter* —
   a monotonic high-water of total events ever emitted, kills included). Use `seq` for
   total-published vs. `current_count` for currently-live, and to spot gaps.
3. **`peer.metrics()` is cohort-aware.** Under v4.10.0 every co-hosting root publishes its
   own snapshot; the reader now aggregates them — **sum** `subscribers` (topic-wide
   total), **max** `current_count`/`seq`/`bytes` (they converge via anti-entropy), and a
   new **`cohortSize`** telling you how many roots reported.
4. **`pull` and `host` route like publish now.** Both used a bare greedy walk that could
   strand on a local minimum — `pull` returned a false "no message", a `host`'s first
   announce was lost until the next heal tick. Both now use the lookup-assist hint.

## What changed for builders

- **`peer.metrics(topic)` returns real data again**, with new `seq` and `cohortSize`
  fields. If you were working around it returning zeros, you can stop.
- No API signature or wire changes. Same `pull`/`host`/`metrics` surface, WIRE 4.0.
- Live dashboards should still prefer `sub(metricTopic(dataId), …)` directly; the
  one-shot `metrics()` now waits a short window to aggregate the cohort.

## Still open (unchanged from v4.10.0)

- **Cold-start subscribe-convergence latency** — a fresh subscriber can strand on a
  greedy local minimum and heal only on the next ~5 s tick. Separate from distribution;
  the next thread.

---

*Deployed 2026-06-30. Verify at `testnet.axona.net/healthz` (`kernelVersion: 4.10.1`).*
