# REF-1.1 E0 — Frame-registration site inventory

Companion to `REF-1.1-Enforcement-Cutover-Design-v5.md`. This is the deliverable
the v5 `[E0]` footnote deferred: every call site that touches a raw registration
primitive, classified as a migration-target, a named mechanism shim, a primitive
definition, or out of scope — with exact counts, not an approximation.

Scanned against `axona-protocol/src` at the 4.63.0 tree (shadow registry present,
default-off). Line numbers are that tree; treat them as anchors, re-resolve
before editing.

## What "sealed set" means here

The cutover makes one canonical `registerFrame(recv, wire, handler)` the sole
door for frame registration. The raw primitives it replaces as a registration
surface are three:

- `onRequest(type, handler)` — request/response leg
- `onNotification(type, handler)` — fire-and-forget leg
- `onRoutedMessage(type, handler)` — routed (multi-hop) leg

`onMessage` is NOT in this set. `peer.onMessage(handler)` (AxonaPeer.js:2574,
at most one handler) and mesh `onMessage(cb)` (mesh.js:249) are the public
application delivery API. Sealing them would break application compatibility,
which is outside registration discipline. They are listed under §E and stay.

## §A — Migration-targets

Genuine frame registrations. Each routes through `registerFrame` at the cutover.
34 named frames across five groups.

### A1 — DHT core (AxonaPeer, `start`/`_wireDht`) — 11 frames

| wire type | primitive | site |
|---|---|---|
| `lookup_step` | onRequest | AxonaPeer.js:453 |
| `lookahead_probe` | onRequest | AxonaPeer.js:471 |
| `local_probe` | onRequest | AxonaPeer.js:586 |
| `find_closest_set` | onRequest | AxonaPeer.js:610 |
| `route_msg` | onRequest | AxonaPeer.js:636 |
| `reinforce` | onNotification | AxonaPeer.js:486 |
| `triadic_introduce` | onNotification | AxonaPeer.js:514 |
| `hop_cache` | onNotification | AxonaPeer.js:523 |
| `lateral_spread` | onNotification | AxonaPeer.js:524 |
| `peer-leaving` | onNotification | AxonaPeer.js:551 |
| `mesh:signal` | onRoutedMessage | AxonaPeer.js:717 |

### A2 — Direct-message transport legs (AxonaPeer) — 2 frames

| wire type | primitive | site |
|---|---|---|
| `axona:direct` (request) | onRequest | AxonaPeer.js:2587 |
| `axona:direct` (notify) | onNotification | AxonaPeer.js:2603 |

### A3 — Tunneled direct — 1 frame

| wire type | primitive | site |
|---|---|---|
| `__tunneled_direct__` | onRoutedMessage | AxonaPeer.js:3119 |

### A4 — Pub/sub wire handlers (`wireHandlers.js`, the `on()` loop) — 16 frames

Registered through `this.dht.onRoutedMessage(type, h)` at wireHandlers.js:57.
These are ALREADY shadow-wrapped: the `on()` helper consults `reg.wiring` and
calls `reg.wrap(...)` (wireHandlers.js:50-56). S2 threaded the Boundary-1
registry through this loop; the cutover moves them from "wrapped-in-place" to
"registered through the canonical door."

`SUB, UNSUB, PUB, DELIVER, ADOPT, PULLUP, HANDOFFACK, REPLAYUP, HANDOFF,
REPLICATE, KILL, INGESTACK, RECEIPTPROBE, RECEIPTNACK, TOUCH, PULL`
(wireHandlers.js:59-74; `TOUCH` is a retained no-op kept for wire compat.)

### A5 — Mesh/bridge base-auth notifications (`transport/web/index.js`) — 4 frames

Already observe-wrapped (B2/B3 shadow observers).

| wire type | primitive | site | observer |
|---|---|---|---|
| bridge `hello` | onNotification | index.js:939 | b2observe |
| bridge `hello-ack` | onNotification | index.js:940 | b2observe |
| webrtc `hello` | onNotification | index.js:982 | b3observe |
| webrtc `hello-sig` | onNotification | index.js:983 | b3observe |

## §B — Parameterized registrar (dynamic-type family)

One registrar, an open set of wire types. Not a fixed enumeration.

`onDirectMessage(type, handler)` (AxonaPeer.js:4231) lazily installs ONE
`transport.onNotification('direct_${type}')` per distinct app-supplied `type`
(AxonaPeer.js:4235), storing handlers in a Map keyed by `type`. The registrar
migrates; the wire types it produces are app-supplied, so the closed-world set
of `direct_*` frames is a manifest deliverable, not a line in this table. This
is the concrete case the design's `[Q2]` dynamic-import manifest exists for.

## §C — Named mechanism shims (stay as-is)

Re-dispatch of an already-registered handler. Not distinct registrations, so not
migration-targets. The CompositeTransport fan-out is the archetype the v5
footnote named.

| shim | site | what it does |
|---|---|---|
| Composite replay (req) | composite.js:70 | replays stored `_reqHandlers` onto a newly-added sub-transport |
| Composite replay (ntf) | composite.js:71 | same for `_ntfHandlers` |
| Composite fan-out (req) | composite.js:224 | fans `onRequest` across `_subs` |
| Composite fan-out (ntf) | composite.js:229 | fans `onNotification` across `_subs` |
| DHT-adapter passthrough | AxonaPeer.js:3089 | `onRoutedMessage: (t,h)=>peer.onRoutedMessage(t,h)` on the default-dht adapter object |

## §D — Primitive definitions (sealed at E3; not migration-targets)

The method definitions themselves. E3 seals these behind closure-captured
capabilities. 13 sites.

- onRequest defs (6): webrtc.js:400, bridge.js:286, composite.js:222,
  wstransport.js:371, sim/transport.js:380, contracts/Transport.js:189 (abstract)
- onNotification defs (6): webrtc.js:407, bridge.js:291, composite.js:227,
  wstransport.js:378, sim/transport.js:387, contracts/Transport.js:202 (abstract)
- onRoutedMessage def (1): AxonaPeer.js:4223 (`_routedHandlers.set`)

## §E — Out of scope (public API)

`onMessage` — the public application delivery surface. Not sealed by this
cutover; a compatibility migration if it is ever touched, tracked separately.

- `peer.onMessage(handler)` — AxonaPeer.js:2574 (at most one)
- mesh `onMessage(cb)` — mesh.js:249; webrtc.js:145/465 internal plumbing

## Count reconciliation

The v5 dry-run gave an approximate ~24-28 and `[R2]` withdrew it. The exact
figures:

- Migration-targets: **34 named frames** (A1 11 + A2 2 + A3 1 + A4 16 + A5 4)
  plus **1 parameterized registrar** over an open `direct_*` family (B).
- Already shadow/observe-wrapped today: 20 of the 34 (A4 16 + A5 4).
- Named mechanism shims: **5** (C).
- Primitive definitions to seal: **13** (D).
- Out of scope: `onMessage` (E).

The 34 named frames are the finite, enumerable set the AST gate and the runtime
capability boundary must jointly cover; the `direct_*` family is the finite-but-
open case the manifest closes.
