# Team Update — connect() is the one bootstrap (2026-07-24, testnet)

**TL;DR: the deeper fix behind the 0x80 cross-region loss. 4.39.0 made the two
bootstrap paths self-integrate by default; 4.40.0 removes the reason the bug was
possible at all — there were too many co-equal ways to bring up a peer, so apps
assembled the setup differently and some assembled it incompletely. `connect()` is
now the single, complete bootstrap: it covers every case, it's exported from the
main barrel, and the lower-level constructors are demoted to advanced building
blocks it composes. Live across the testnet stack.**

---

## Why this release exists

4.39.0 fixed the symptom: `connect()` and no-sponsor `join()` now self-integrate by
default, so a node weaves itself into the mesh instead of sitting at the
passive-adoption churn floor and self-rooting its topics as singletons.

But the *root* cause wasn't a missing line — it was API shape. Bringing up a peer
required assembling `new AxonaPeer` + `transport.start` + `peer.start` + `peer.ready`
+ `peer.integrate` in the right order, and those primitives were all public and
presented as co-equal. So every app assembled its own subset:

| App | Bootstrap | Self-integrated? |
|---|---|---|
| axona-peer | `peer.start()` + explicit `peer.integrate()` | ✅ |
| alert-bot | `peer.join()` (no sponsor) | ❌ |
| civildefense | `connect()` → `peer.ready()` only | ❌ |
| **axona-share** (found this release) | `new AxonaPeer` + `start`, no `integrate()` | ❌ |

Same primitives, four assemblies, three of them wrong. **When the correct setup is
implicit tribal knowledge, apps will get it wrong** — and a self-organizing
protocol whose self-organization is opt-in is a footgun. 4.40.0 makes the right way
the only documented way.

## What shipped (4.40.0)

- **`connect()` covers every legitimate case**, so nothing drops to the
  constructors for setup: added `domain` (shared mesh / several peers in one
  process), `persist`, `rootReplicas`, `maxPublishBytes`, `synaptomeMaintain`
  passthroughs — on top of the existing `bridge`, `location`, `author`, `k`,
  `ready`, `transport`, `nodeIdentity`, `web`.
- **One import:** `connect()` is now exported from the main barrel —
  `import { connect } from '@axona/protocol'`. Safe: the web transport it defaults
  to is loaded via **dynamic import inside `connect()`**, so the barrel gains no
  static WebRTC dependency (sim/server contexts that inject a transport never load
  it).
- **Reframe + demote:** `connect()` is documented as THE bootstrap;
  `new AxonaPeer` + `peer.start`/`join`/`integrate`/`ready` are ADVANCED building
  blocks it composes. Every hand-assembled example now ends with the **required**
  `peer.integrate()`.

## Found and fixed in passing

**axona-share had the original bug in production.** It hand-assembled
`new AxonaPeer + start` and never called `peer.integrate()` — a shipped app sitting
at the churn floor. Fixed (added `peer.integrate()`), cache-bust bumped
0.20.0→0.21.0. On the testnet branch; the live-demo (`main`) fix rides the kernel
promotion or a targeted cherry-pick. axona-minimal already called `integrate()` —
unaffected.

## Tested

- `smoke_connect.mjs` — added a **barrel-export identity** check and a
  **shared-`domain` injection** case (two peers on one domain via `connect()`,
  delivery over the shared mesh). `smoke_self_integrate.mjs` still carries the
  4.39.0 no-sponsor case that fails pre-fix. Full kernel suite green (exit 0).
- dht-sim `test:kernel` 69/69 green on the 4.40.0 vendor.
- Live: `testnet.axona.net/healthz` = **kernel 4.40.0 / bridge 2.94.0**.

## Shipped across the board (testnet)

kernel **v4.40.0** (tag) · relay **0.73.0** · bridge **2.94.0** (deployed to the
droplet) · demo **4.40.0** · dht-sim re-vendored. axona-peer deliberately untouched
(frozen at 4.38.0).

## Docs

The three setup-facing programmer-guide docs re-versioned to **v4.40.0** (`.md` +
hand-edited `.tex` + tectonic-rendered PDF): **AI-Grounding, Quick-Start,
API-Reference**. `connect()` taught as the one bootstrap; the AI-Grounding doc's
"manual assembly" example — which had shown `start` + `ready` *without*
`integrate()`, literally teaching the bug — was corrected. Prior PDFs archived to
`history/programmer-guide/`. (Programmer-Guide + Services-Guide still at
v4.38.0/v4.30.0 — no `connect()` content, version-bump pending for full suite
consistency.)

## What we learned

- **A self-organizing primitive that is opt-in is the real failure mode.** "Almost
  no app invokes it" beats any single missing line as the root cause. Correct-by-
  default > a documented method call.
- **Too many entry points is a security property, not just an ergonomics one.** The
  0x80 loss was, at bottom, API surface area.
- The bridge-as-transport line held throughout: the whole simplification is
  peer-to-peer; `connect()` never routes through or depends on the bridge for
  anything but the initial rendezvous.

## Actions

- **Howard**: your rerun (when it comes) is now against 4.40.0, which supersedes
  4.39.0 on testnet — it contains the self-integration fix plus the API cleanup.
- **App owners (alert-bot / civildefense / axona.chat / standalone axona-share)**:
  posted on #axona.dev — move your bootstrap to `connect()`. Not urgent (4.39.0+
  self-integrates your current paths by default), but it's the clean end state and
  removes the footgun.
- **Prod promotion**: still gated on Howard's clean rerun + a soak; then promote the
  4.39→4.40 line (kernel/relay/bridge) to main together. Prod stays 4.38.0.
- **Follow-ups**: cherry-pick the axona-share fix to the live demo; bump the
  remaining two dev docs to 4.40.0; the doubled-prefix log fix
  (`pubsub:pubsub:singleton-root-confirm`) from a separate session.
