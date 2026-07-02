# Team Update — kernel v4.16.1 on testnet (2026-07-02)

A same-day point release on top of this morning's 4.16.0 roll (bridge v2.56.0,
relay fleet v0.41.0, peer v3.44.0 — all report kernel 4.16.1). Wire stays 4.0:
no flag day, no API change, apps keep working unchanged.

## The change: metrics answer immediately

Demand-driven metrics (v4.12.0) armed a publish lease when you subscribed to
`metricTopic(T)`, but the root produced its **first** snapshot only on its next
internal refresh tick — so a subscriber that had just turned metrics on waited
up to ~5 s (worst case ~20 s across root churn) for its first count.

As of v4.16.1 the root **answers the moment the lease arms**: the first
snapshot rides back at routing latency, arriving with (or before) your
data-topic replay — independent of whether anyone has ever published to or
watched the topic. A topic with no messages answers too: `current_count: 0`
is a real "nothing here," distinct from silence.

Measured live on testnet after the deploy: **first snapshot 0.3 s** after the
metric subscribe (was 2.2 s), then the unchanged ~20 s cadence. The lease
still lapses ~70 s after the last metric subscriber leaves.

### What this means in practice

```js
await peer.sub(topic, onMessage, { since: 'all' });            // data
await peer.sub(metricTopic(await deriveTopicId(topic)),        // metrics
               onSnapshot, { since: 'all' });                  //   → first count ~instantly
```

- Subscribe to metrics **right after** the data subscription; the first count
  arrives roughly alongside the data replay. This is the intended pattern for
  capacity hedges (e.g. Civil Defense: `current_count` approaching the 1000
  message cap → drop the subscription and re-subscribe to the four S2 child
  topics).
- **Render silence as *unknown*, never as zero.** Until the first snapshot (or
  the data replay) lands, "no activity" isn't an answer yet — a
  `current_count: 0` snapshot is. Under churn the answer can still take a few
  seconds while the root re-homes.
- The one-shot `peer.metrics()` now normally succeeds within its default
  1.5 s window even on a never-watched topic; `stale: true` means the answer
  lost a churn race — retry, or prefer the standing subscription.

## Release-engineering hardening (same day)

The kernel-consumer release rituals are now scripted with tests as hard gates —
this deploy was their first live run:

- **axona-bridge**: `scripts/repin-kernel.sh <tag>` does the pin bump, lockfile
  regeneration, an `npm ci` reproducibility check, and refuses to commit unless
  `npm test` (the embedded-peer smoke, un-rotted and now 10/10) passes against
  the freshly installed kernel.
- **axona-relay**: `npm run sync:protocol` copies the kernel tree **whole** (no
  more hand-maintained file lists — those silently dropped `connect.js` last
  cycle), verifies completeness with a tree diff, and gates on `npm test`
  (all-file syntax + an import-load smoke of the entire vendored kernel graph).

Housekeeping: the relay's fleet logs are no longer tracked in git, and the
long-stray `net.axona.relay` LaunchAgent (a leftover pointed at the prod
bridge) is retired.

## Docs

The developer doc set is re-versioned to 4.16.1. The metrics sections of the
API Reference, Programmer Guide, and AI Grounding file now state the new
timing contract: first snapshot at routing latency, ~20 s cadence, ~70 s
lease, silence-is-unknown.

## Verification

Post-deploy on 4.16.1: soak scale scenario **100% delivery (initial + healed,
ordering intact)**; cold-topic metrics probe first snapshot **0.3 s**,
snapshots served cross-peer by fleet relays. The soak's kill scenario remains
red as before the deploy — pre-existing, under separate investigation.
