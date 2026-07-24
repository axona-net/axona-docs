# Team Update — Bootstrap self-integrates by default (2026-07-23, testnet)

**TL;DR: Howard's 0x80 cross-region pub/sub loss was never in the routing or
durability code — those are sound and complete. The self-integration primitive
(a node proactively discovering its own neighbourhood) only ran on
`join(sponsor)`. The two one-call bootstrap paths every real app uses —
`connect()` and no-sponsor `join()` — silently skipped it, so nodes sat at the
passive-adoption churn floor and self-rooted their topics as singletons in sparse
regions. Kernel v4.39.0 makes both bootstrap paths self-integrate by default.
Star-topology repro went 0% → 100%. On testnet now.**

---

## The bug

A node has to *weave itself in* after it connects: run `findKClosest(ownId)` and
open authenticated channels so its neighbours **adopt** it — because
reachability-to-you lives in your neighbours' routing tables, not yours. That
primitive (`_selfIntegrate`, kernel v4.7.0, sim-validated to lift a fresh node
from a 7–27% reachability floor to ~95–98% in one pass) already exists and works.

The defect was purely *where it was invoked*. It only ran inside `join(sponsor)`.
The paths apps actually use went around it:

| Bootstrap path | Runs self-integration? |
|---|---|
| `peer.integrate()` (explicit) | ✅ yes — this is why **axona-peer** worked |
| `peer.join()` — **no sponsor** | ❌ returned early, before `_selfIntegrate` |
| `connect()` → `peer.ready()` | ❌ `ready()` is a passive wait, never integrates |

**alert-bot** bootstraps with no-sponsor `join()`; **civildefense** bootstraps
with `connect()`. So Howard's publisher, subscriber, *and* hosts all sat at the
churn floor — reachable only from whoever dialed them, their routing tables
populated only by ambient inbound adoption. In a relay-poor region (0x80) that
never surfaces the topic-closest peers, so:

- the publisher **self-roots** its topics with an empty cohort → **singleton
  roots** (nothing to eager-replicate to, nothing to hand off to on leave), and
- a fresh subscriber has **no meshed path** to the true root.

Result: deterministic 0% cross-region delivery. Every durability mechanism we've
built — eager cohort replication, leave-handoff with fallback, read-repair —
depends on `findKClosest(topic)` returning reachable in-region peers, and an
un-integrated node's table never has them.

## How we proved it

A new dht-sim A/B harness (`harness/pubsub-discovery-repro.mjs`) over the real
shipped kernel, region A hosts + region B publisher/subscriber, one bridge:

| arm | singletonRoots(pub) | delivery | singleton-confirm |
|---|---|---|---|
| `full` (omniscient control) | 0 | **100%** | 0 |
| `star` (empty bridge only) | **10** | **0%** | **10** |
| `bootstrap` (K≥2 seed + self-integration) | 0 | **100%** | 0 |

`star` reproduced Howard exactly; `bootstrap` (a small random welcome-frame seed
+ the self-integration the fix now runs) converged to 100% **even when the
publisher's seed contained no region-A host** — the peer-to-peer discovery finds
them. K_SEED=1 was flaky; **K≥2 reliably 100%**.

## The fix (v4.39.0)

- `connect()` runs `peer.integrate()` after `ready()` (the bridge welcome has
  seeded peers to query by then).
- No-sponsor `join()` self-integrates when a transport is present.
- Both best-effort, and a genuine standalone peer (no transport / empty
  neighbourhood) still returns instantly — `_selfIntegrate` no-ops.

The bridge stays **transport-only** throughout: self-integration is
`findKClosest` over the *mesh*, peer-to-peer; the bridge is excluded from routing
hops and from every topic role (root/child/replica/heir). The fix removes a
footgun — the P2P self-organization we already ship stops being opt-in.

## Tested

- `test/smoke_self_integrate.mjs` — **new no-sponsor case** (fails pre-fix:
  synaptome stays at the single seed; passes post-fix: weaves in, a non-seed
  neighbour adopts it). Full kernel suite green (100+ smokes, exit 0).
- dht-sim `test:kernel` 69/69 green on the 4.39.0 vendor.
- Live: testnet.axona.net bridge `/healthz` now reports **kernel 4.39.0 /
  bridge 2.93.0**.

## Shipped across the board (testnet)

- **kernel** `@axona/protocol` v4.39.0 (tag pushed)
- **axona-relay** v0.72.0 (re-vendored)
- **axona-bridge** v2.93.0 (re-pinned + lockfile) — deployed to the testnet droplet
- **dht-sim** re-vendored (+ the repro harness)
- **axona-peer** deliberately **untouched** (frozen at 4.38.0)

## What we learned

- When a self-organizing primitive exists but is opt-in, "almost no app invokes
  it" is the real failure mode. Correct-by-default beats a documented method call.
- The bridge-as-transport / bridge-never-in-the-overlay line held under pressure:
  the fix is entirely peer-to-peer, no bridge authority.
- `seesHost` (a publisher's local `findKClosest`) is a noisy lagging signal;
  `deliveryPct` + `singletonRoots` are the authoritative ones.

## Actions

- **Howard**: pull axona-protocol testnet (v4.39.0) and rerun the golden path —
  alert-bot + civildefense inherit the fix through npm-link, no app change. Verify
  the handshake reads 4.39.0.
- **Open (separate task)**: the sole-copy honesty signal logs under a doubled
  prefix `pubsub:pubsub:singleton-root-confirm` (one-char bug in
  `wireHandlers.js`); fix + operator-alert on the correct name.
- **Prod promotion**: gate on Howard's clean rerun + a soak on 4.39.0, then
  promote kernel/relay/bridge to main.
