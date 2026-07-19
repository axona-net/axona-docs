# Team Update — Production promoted to kernel 4.29.0

**Date:** 2026-07-19
**Stack:** kernel **4.29.0** · bridge **2.83.0** (east + west) · relay backbone **0.59.0** (9 relays, 3 droplets) · peer **3.56.0**

## What shipped

This promotion closes the root-reconciliation gap that made warm topics lossy in
production (tracked as #353 warm-topic interloper root and #352 cold watcher-first
split-brain):

- **4.28.1 — root self-verification restored.** The DHT adapter's `lookup()` returned
  a bare id where every consumer expected a `{found, path, hops}` result, so a standing
  root's periodic iterative verify — the only reconciliation path that does not depend
  on the interloper's connectivity or lifetime — was a silent no-op on every standalone
  peer. Worst-case heal after a root conflict is now bounded by the 45 s verify cadence.
- **4.29.0 — `peer.pull()` returns the full envelope** (`msgId`, `ts`, `signature`,
  `message`), the same shape `sub()` delivers. **Migration note:** callers that used
  the bare body must now read `env.message`.

## Validation

- Testnet: `smoke_interloper_convergence` 105/105 (REPS=5, three scenarios), plus a
  10-run live A/B on the testnet fleet.
- Production acceptance (post-deploy): warm-topic ephemeral-publisher scenario heals
  at **0 s** with full replay 6/6; cold watcher-first delivers 3/3 with replay 3/3;
  cross-bridge federation confirmed via the `axona:bridge-directory` warm topic.
- Field evidence, same day: the #axona.bot announcements channel demonstrated the old
  loss mode live on 4.27.1 (a die-fast publisher's post stranded twice; a held-alive
  publisher's post confirmed in seconds). The relay's bot-post script now holds its
  publisher until an independent probe confirms delivery (relay 0.59.0).

## Learnings

- A publisher that exits immediately after `pub()` can still lose its message if the
  fleet is mid-churn; long-lived publishers (or the relay's confirm-and-hold pattern)
  remain the recommended shape for announcement-style topics. The kernel-side lever
  ("`pub()` ack awaits ≥1 replicate for fresh claims") stays on the backlog.
- Fresh-subscriber replay is a false health signal for live fan-out — always validate
  with a seated subscriber plus an independent probe.

## Actions

- Prod monitoring continues via the standing #axona.bot channel (now
  delivery-confirmed on every post) and the PoW collector (restarted against the
  new fleet).
- Docs re-version to 4.29.0 on the next documentation edit cycle.
