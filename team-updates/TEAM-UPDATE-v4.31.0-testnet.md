# Team Update — Kernel v4.31.0 on Testnet: The "Missing 10%" Is Fixed

**Date:** 2026-07-21 · **Kernel:** 4.31.0 (testnet) · **Prod:** remains 4.29.0 pending acceptance

## TL;DR

The ~10% of publishes that permanently vanished after a publisher restart — the
failure Howard measured at 9–13% across three golden-path runs, immune to any
amount of waiting or re-subscribing — is root-caused and fixed. A gracefully
departing node was silently discarding every topic history it held as a
**backup replica**; only *rooted* topics were handed off. When churn had moved
the last surviving copy of a message onto such a backup, the message died with
it. Kernel v4.31.0 closes the gap: **deterministic harness recovery went from
82.5% to 100% — zero losses in 800 messages across 100 trials.** It is live on
testnet now.

**Ask: Howard, please rerun your exact 3-repetition experiment.** Same script,
same waits. Expected result: ~0% loss. That rerun is our production-promotion
gate.

## What was tested

- A new **deterministic in-process restart harness** (`test/smoke_restart_handoff.mjs`)
  reproducing the golden-path scenario — publish, graceful root handoff +
  publisher departure + subscriber churn, renewal windows, newcomers, publisher
  rejoin, fresh `since:'all'` late joiner — on byte-identical topologies per
  trial, immune to machine load.
- A **loss-classification diagnostic** (`test/diag_restart_loss.mjs`) that tracks
  every message's holders before churn, after churn, and at replay, bucketing
  each loss as publish-time, replication-time, handoff-time, or replay-time.
- The full kernel suite (96 smokes), Howard's axonSpec over real WebRTC against
  the live testnet, and a new gate smoke for the fix itself.

## Results

| Measure | Before | After |
|---|---|---|
| Where the loss lives | **100% HANDOFF_GAP** — every lost message was safely replicated before churn, then vanished at departure | — |
| Deterministic recovery (100 trials, 800 msgs) | 82.5% | **100%** |
| Restart harness, full-timeline recovery | 85% | **100%** |
| Restart harness, live POST delivery | 93.6% / 90% | **93.6% / 90%** (unchanged) |
| Full kernel suite | — | **96/96** |
| axonSpec (live, real WebRTC) | — | **11/11 × 2** |

Zero loss at publish time, replication time, or replay time — the entire
failure was the departure path. That is exactly why the experiments behaved as
they did: the same publishes failed every run and never came back, because no
surviving copy existed anywhere to replay from.

## The fix (two parts, both mattered)

1. **Departing non-root holders now hand off their cache too** — gated on
   *strict* root liveness. The handoff is skipped only when the topic's root is
   a current, directly-connected neighbour at the moment of leaving. Beacons
   and keepalives deliberately do **not** count: they stay "fresh" for tens of
   seconds after a root dies, so on a mass teardown every passive signal lies.
   The asymmetry drives the default — a wrong "alive" loses data forever; a
   wrong "dead" costs one redundant message that reconciliation absorbs.
2. **The push is a replication, not a handoff.** Our first cut had the heir
   *adopt the root role* on receipt, and the paired harness immediately caught
   the consequence: multiple departing backups minted competing roots and live
   delivery dropped (90% → 60% of trials clean). Re-sending the same cache as a
   REPLICATE — union-merged at a root, stored as a backup elsewhere — landed
   the history without disturbing root election. Live delivery returned to the
   pre-fix baseline exactly.

## Learnings

- **Deterministic beats black-box for this class of bug.** Weeks of live soak
  A/Bs could say "roughly 10% is lost" but not *where*; the paired in-process
  harness answered it in one run, then caught a regression in the first fix
  attempt that the live soak would likely have blurred into noise.
- **Passive liveness signals cannot gate durability decisions.** Anything with
  a TTL is a lie during the window that matters most (mass teardown).
- The bug predates the recent refactors — it was identical on 4.29.0 and
  4.30.0. The Phase 8 sync engine is exonerated *and* made the fix a two-line
  policy choice (`REPLICATE` vs `HANDOFF` nature) instead of new machinery.
- Ritual gotcha: `npm install --package-lock-only` does **not** re-resolve a
  GitHub tag pin; the lockfile silently kept the old kernel commit. Use a full
  `npm install <pkg>@github:...#vX.Y.Z` when re-pinning.

## Deployed (testnet)

| Component | Version |
|---|---|
| Kernel | 4.31.0 (`8e4f626`, tag pushed; includes 4.30.0 Phase 8 sync engine) |
| Testnet bridge | 2.84.0 (healthz confirms kernel 4.31.0) |
| Relay fleet (useast ×9) | 0.61.0 |
| Peer app (testnet) | 4.1.0 |

Acceptance so far: publish → `since:'all'` replay round-trip verified live.
SECURITY-CHANGELOG carries the v4.31.0 entry.

## Actions

- **Howard:** rerun the 3-rep golden-path experiment against testnet (this is
  the promotion gate). Expected: ~0% loss.
- **Everyone:** testnet churn testing welcome — restarts, mass leaves, and
  publisher kill-and-rejoin are exactly the paths this release changes.
- **On green:** user-gated promotion of the 4.31.0 line to production
  (bridges + relay backbone + peer), then the docs re-version cycle.

*Written by axona.bot · questions on #axona.dev*
