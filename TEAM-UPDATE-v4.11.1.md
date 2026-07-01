# Team Update — Axona kernel **v4.10.1 → v4.11.1**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** live on **testnet** — bridge v2.53.0, relay v0.38.0, peer v0.72.0.
**Production is untouched and still on 3.x.** Wire-compatible across this whole range
(WIRE 4.0, no flag day).

> A consolidated update for the pub/sub reliability + read-path work that landed after
> the v4.10.0 cohort-distribution fix. Three threads: **metrics came back from the dead**,
> **cold-start publishes stopped getting lost**, and **reads now answer from the nearest
> replica**. Supersedes the separate v4.10.1 and v4.11.0 notes.

---

## 1 · Metrics were silently dead on the entire 4.x line — rebuilt (v4.10.1)

`rootedTopics()` — the producer the relay metrics-loop iterates — was dropped in the
v3.12 routing-only rewrite. So `peer.rootedTopics()` returned `[]`, relays published no
snapshots, and `peer.metrics(topic)` returned `{stale:true, …zeros}` for every topic
across all of 4.x. Rebuilt, with two new fields and cohort awareness:

- **`current_count`** — messages currently in the cache (live, non-expired/non-killed).
- **`seq`** — the root's dense *message counter*: a monotonic high-water of total events
  ever emitted on the topic (kills included). Use `seq` for total-ever vs.
  `current_count` for currently-live, and to spot gaps.
- **`peer.metrics()` is cohort-aware.** Under the v4.10.0 model every co-hosting root
  publishes its own snapshot; the reader now collects them over a short window and
  aggregates — **sum** `subscribers` (each root reports only its own subset → the sum is
  the topic-wide total), **max** `current_count`/`seq`/`bytes` (they converge across the
  cohort via anti-entropy; max tolerates a lagging member), plus **`cohortSize`** = how
  many roots reported.

**How to use it.** For a live dashboard, prefer `sub(metricTopic(dataId), …)` directly
(one subscription, latest + rolling trend). The one-shot `peer.metrics(topic)` is a
convenience that waits a short window to aggregate the cohort. Metric topics are **open**
(anyone can subscribe) and advisory — check `signer` for provenance.

## 2 · Cold-start publishes stopped getting lost — cold-publish burst (v4.11.0)

A publish is routed toward a topic's address and held by the node closest to it. A
freshly-joined node's routing table is too sparse to reach that node reliably, so its
first publish could strand at the wrong node — and a publish is **one-shot** (subscribers
renew every few seconds; a publish never re-routes itself), so a cold-start strand was a
silently lost message.

The instructive part: we first tried the obvious fix — hold `ready()` until the node is
well-integrated before allowing a publish. It made things **worse**, because *outbound
traffic is exactly what integrates a newcomer* (a node becomes reachable once its sends
populate its neighbours' routing tables). Waiting removes the very thing that fixes the
problem.

So instead, while a node is still cold (fewer than 8 peers), `pub` re-sends the **same**
signed envelope up to 5× over ~1 second. It's idempotent end-to-end (the root dedups by
message id, so subscribers still see exactly one), each send both integrates the node
*and* gets a fresh shot at the true root as the table converges, and it **self-disables**
the instant the node is warm (a warm publish is a single send). The existing slow retry
still backstops afterward. Live cross-peer delivery went from ~85% to **95.5%**, with node
setup staying fast.

## 3 · Reads now answer from the nearest replica — pull cache-hit early-answer (v4.11.1)

`peer.pull` routes toward the topic like a publish (this replaced the old bare greedy walk
that could strand at a local minimum and return a false "no message"). v4.11.1 sharpens
it: a pull for a **specific message** (`pull(msgId)`) is a read of *immutable, replicated*
state — `msgId = H(publisher‖message)` — so **any node en route that already holds it can
answer, without reaching the root.** The routed PULL now short-circuits at the first
replica it crosses (a cohort member, a child relay, or a `host()` node), which lowers
latency and lets a pull that would otherwise strand toward the root be served by any
cache-holder it passes. A cached message is by definition not tombstoned at that node (a
kill drops it from cache), so this can't resurrect a killed message.

**Scope:** by-msgId only. A **pull-latest** (no msgId → "give me the newest") still
resolves at the topic root/terminus, because a lagging replica's newest could be older
than the root's — latest needs the authoritative answer.

`host` also routes lookup-assisted now (v4.10.1), so an infra node's first keyspace
announce lands at the true root instead of stranding until the next heal tick.

## What changed for builders

- **No API, signature, or wire changes anywhere in this range.** Same `pub` / `pull` /
  `host` / `metrics` surface, WIRE 4.0. If you worked around `metrics()` returning zeros,
  you can stop; `seq` and `cohortSize` are new fields on the result.
- The cold-publish burst and pull early-answer are internal and automatic — no knobs.
- **The publisher still gets no delivery ack** and learns nothing about where any
  subscriber is; transport identity stays unlinked from author identity throughout.

## Still open

- **Cold *kill* symmetry.** A retraction (`kill`) is a publish-with-a-side-effect, so a
  cold kill can strand like a cold publish did; today it relies on the slower background
  retry. Extending the cold-publish burst to `kill` is the natural next step.

---

*Deployed 2026-07-01. Verify at `testnet.axona.net/healthz` (`kernelVersion: 4.11.1`).*
