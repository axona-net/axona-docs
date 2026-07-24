# Team Update — 4.40.0 promoted to production (2026-07-24)

**TL;DR: the 4.39→4.40 line is live on prod. Both bridges, the 9-relay backbone,
demo.axona.net, and axona.chat are on kernel 4.40.0. This ships the self-integration
fix (the 0x80 cross-region loss) and the connect()-single-bootstrap API to
production — and cures the long-open-tab delivery loss in axona.chat. Same-day
promotion (additive + wire-compatible), directed by David; Howard's 0x80 rerun +
soak remain the recommended confirming gate.**

---

## What went to prod

| Surface | Before | After |
|---|---|---|
| bridge east (bridge.axona.net) | 2.92.1 / 4.38.0 | **2.94.0 / 4.40.0** |
| bridge west (bridge-west.axona.net) | 2.92.1 / 4.38.0 | **2.94.0 / 4.40.0** |
| relay backbone (sfo3/nyc3/tor1, 9 units) | 4.38 line | **4.40.0** (all active) |
| demo.axona.net apps | 4.38 | **4.40** (axona-minimal ?v=0.24.0, axona-share ?v=0.21.0) |
| github.io/axona-share (standalone) | 4.38 | **4.40** (v0.15.0) |
| **axona.chat** | 4.38.0 | **4.40.0** (v0.33.0, CI success) |

axona-peer untouched (frozen at 4.38.0).

## What this ships to prod

- **The 0x80 fix (4.39.0):** `connect()` and no-sponsor `join()` self-integrate by
  default — a node weaves into the mesh instead of sitting at the passive-adoption
  churn floor and self-rooting topics as singletons.
- **The API simplification (4.40.0):** `connect()` is the single, complete,
  barrel-exported bootstrap; the constructors are demoted to advanced building
  blocks. This is the *root-cause* fix — too many co-equal entry points were why
  apps assembled setup incompletely.
- **axona.chat's long-open-tab cure:** pre-4.39 peers never self-integrated, so a
  browser tab left open drifted to the churn floor and its subscriptions went deaf
  (surfaced as "no new messages in an open page"). 4.40 keeps a long-open tab woven
  into the mesh.
- **Two shipped apps' missing-`integrate()` bug fixed:** both the demo and standalone
  **axona-share** hand-assembled the peer without `peer.integrate()` — the same bug
  in production. Fixed in both.

## Promotion ritual (as run)

1. `testnet:main` — axona-protocol (kernel 4.40.0 + app fixes); bridge/relay `main`
   were already current.
2. Prod bridges east then west — Docker `git pull main && compose build bridge &&
   up -d bridge` (rebuild the bridge service only; Caddy/TURN never dropped). Both
   healthz → 4.40.0.
3. Relay backbone — one droplet at a time (sfo3 → nyc3 → tor1), `git pull main` +
   restart the 3 units; vendored kernel confirmed 4.40.0, all active.
4. Apps — axona.chat re-pin+build+deploy (CI); demo + standalone axona-share
   cache-busted (`?v` bump forces browsers to fetch the 4.40 kernel).

## Acceptance

- Both bridges `/healthz` = **kernel 4.40.0 / bridge 2.94.0**.
- **Live prod pub/sub round-trip confirmed** (publish→independent-probe on
  bridge.axona.net, `confirmed:true`).
- Demo apps serving the new cache-bust (v=0.24.0 / v=0.15.0); axona.chat CI deploy
  **success**.

## Honest gate note

This was a **same-day, un-soaked** promotion, directed by David. The risk is lower
than a normal promotion — the 4.39/4.40 changes are **additive and wire-compatible**
(no flag day; 4.38 ↔ 4.40 interoperate on wire 4.0), the full kernel suite is green,
and the repro is validated — but it skipped the two gates we normally hold on:
**Howard's clean 0x80 rerun** (not yet received) and an **overnight soak** on the
4.39/4.40 line. Both remain the recommended confirming step; watch #axona.dev for
Howard's rerun against the now-4.40 stack.
