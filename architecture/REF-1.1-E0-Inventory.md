# REF-1.1 E0 — Frame-registration site inventory

Companion to `REF-1.1-Enforcement-Cutover-Design-v5.md`. The deliverable the v5
`[E0]` footnote deferred: every call site that touches a raw registration
primitive, classified, with exact counts.

**The source of truth is a generated manifest, not this prose.** The first cut of
this table was hand-counted and diverged from the tree in three places (council
review, 2026-08-16): A4 was 16 where the tree has 19, `cap-attest` was omitted
from A5, and the `onDirectMessage` passthrough was omitted from the shim list. A
narrative count cannot prove a bounded set when line anchors must be re-resolved.
So the inventory now lives in:

- `axona-protocol/test/REF-1.1-E0-manifest.json` — one row per site
  (`file, line, callee, receiver, wire, classification`), pinned to the tree hash
  it was generated from (`1edb1fd`).
- `axona-protocol/test/fence_e0_manifest.mjs` — the generator and the CI gate. Its
  default run fails if any registration site is added, removed, or reclassified
  versus the committed manifest, and fails closed on any unresolved (aliased /
  computed / loose-literal) registration or a parse-coverage loss.
- `axona-protocol/test/lib/registrationScan.mjs` — the discovery, the same sound
  acorn walk the S5 ownership fence uses (`smoke_boundary_ownership.mjs`),
  extended to the third primitive. A raw registration cannot silently escape it.

This document is the human-readable projection of that manifest. The counts below
are the generator's, not a re-count.

## The sealed set

The cutover makes one canonical `registerFrame(recv, wire, handler)` the sole
door for frame registration. It seals three registration primitives:

- `onRequest(type, handler)` — request/response leg
- `onNotification(type, handler)` — fire-and-forget leg
- `onRoutedMessage(type, handler)` — routed (multi-hop) leg

`onMessage` is NOT in this set. `peer.onMessage(handler)` (AxonaPeer.js:2574, at
most one) and mesh `onMessage(cb)` (mesh.js:249) are the public application
delivery API; sealing them would change application compatibility. They are
enumerated below as out-of-scope and stay regression-tested through the cutover.

## The `[V2]` wire-literal gate — normative scope

Enshrined after council review (Aster, Vega, Orion; axona-protocol testnet
`9859fff`). The E1 wire-literal gate (`test/fence_raw_dispatch_gate.mjs`) requires
every `registerFrame(recv, wire, handler)` call to pass a string-literal or
`T.<name>` wire. To find those calls it resolves which callee names are the door.

**`[V2]` is intentionally a DIRECT name-binding resolver.** It answers one
decidable question: does a callee name resolve, through direct binding
introductions, to `registerFrame`? It binds the door across the finite set of
name-introducer AST node types, each handled wherever it occurs:

1. import specifiers — named (`ImportSpecifier` `imported.name === 'registerFrame'`,
   any source, *not* a resolved re-export graph) / default (`registerFrame.js`) /
   namespace (`registerFrame.js` or the barrel `registry/index.js`);
2. `VariableDeclarator`;
3. `AssignmentExpression '='`;
4. `AssignmentPattern` — parameter default AND destructuring default, any nesting.

Targets are `Identifier` and `ObjectPattern`; the RHS resolves only when it is
directly an already-bound name or a recognized door-namespace member. Alias chains
close under fixpoint; plain and optional call forms are matched. Flow-insensitive,
once-bound-stays-bound — the correct fail-closed over-approximation for a gate.
Teeth NEG-B1…B19 pin every case.

**This is a scoped claim, not "no further syntax exists."** Anything that needs
VALUE-FLOW analysis rather than direct name resolution is OUTSIDE `[V2]` by design
— the E3 runtime capability boundary's job, structurally closed there: a
value-preserving RHS expression (`cond ? registerFrame : g`, `registerFrame ||
fallback`, a sequence, a call/IIFE return); value flow through a container
(`const [f] = [registerFrame]`); computed member `ns['registerFrame']` (`[Q1]`); a
dynamic-import handle `(await import(...)).registerFrame` (`[Q2]`); a third-party
re-exporter's namespace that is neither the definition module nor the barrel.
`[V2]` is the build-time direct-name-binding gate for the E1–E3 window; soundness
is the E3 closure-captured capability, not this gate.

## Generator summary (tree 1edb1fd)

| class | count | meaning |
|---|---|---|
| migration-target | **38** | genuine sealed-primitive registrations → route through `registerFrame` at E1 |
| primitive-definition | **13** | where a sealed primitive is defined → sealed at E3 |
| mechanism-shim | **5** | CompositeTransport fan-out (4) + DHT-adapter `onRoutedMessage` passthrough (AxonaPeer.js:3089) |
| registration-helper | **1** | `wireHandlers.js:57` `dht.onRoutedMessage(type)` — the `on()` door whose 19 concrete wires resolve from `on(T.X)` |
| parameterized-registrar | **1** | `onDirectMessage` → `onNotification('direct_${type}')`; the open `direct_*` family (see §direct-fence) |
| wrapper-passthrough | **2** | `onDirectMessage` definition + its adapter passthrough (AxonaPeer.js:3090) — forwards to the wrapper, not a sealed primitive |
| public-api-out-of-scope | **3** | `onMessage` sites (never sealed) |
| bridge-ws-dispatch | **8** | the bridge WS `dispatch` switch — a separate registration style, not one of the three sealed primitives |

71 rows total. 24 of the 38 migration-targets are already shadow/observe-wrapped
today (A4's 19 through the S2 `reg.wrap`; A5's 5 through B2/B3 observers), so E1
moves them from wrapped-in-place to registered-through-the-door.

## Migration-targets (38)

### A1 — DHT core (AxonaPeer) — 11
`lookup_step` (onRequest, :453), `lookahead_probe` (:471), `local_probe` (:586),
`find_closest_set` (:610), `route_msg` (:636); `reinforce` (onNotification, :486),
`triadic_introduce` (:514), `hop_cache` (:523), `lateral_spread` (:524),
`peer-leaving` (:551); `mesh:signal` (onRoutedMessage, :717).

### A2 — Direct-message transport legs (AxonaPeer) — 2
`axona:direct` request (onRequest, :2587) and notify (onNotification, :2603).

### A3 — Tunneled direct — 1
`__tunneled_direct__` (onRoutedMessage, :3119).

### A4 — Pub/sub wire handlers (wireHandlers.js `on()` loop) — 19
Registered through `dht.onRoutedMessage(type, h)` (:57), already S2 `reg.wrap`
shadow-wrapped. The `on(T.*)` calls at wireHandlers.js:59-77:
`SUB, UNSUB, PUB, DELIVER, ADOPT, PULLUP, HANDOFFACK, REPLAYUP, HANDOFF,
REPLICATE, KILL, INGESTACK, RECEIPTPROBE, RECEIPTNACK, TOUCH, PULL, PULLRESP,
ROOTBEACON, METRICSON`. (The first cut stopped at PULL — the missing three,
PULLRESP/ROOTBEACON/METRICSON, are the correction.)

### A5 — Mesh/bridge base-auth notifications (transport/web/index.js) — 5
All already observe-wrapped: bridge `hello` (:939, b2observe), `hello-ack` (:940,
b2observe), webrtc `hello` (:982, b3observe), `hello-sig` (:983, b3observe), and
`cap-attest` (:987, b2observe — carries the write-flight-ack-v1 capability codec;
omitted from the first cut).

## The `direct_*` fence (parameterized registrar)

`onDirectMessage(type, handler)` (AxonaPeer.js:4231) lazily installs one
`transport.onNotification('direct_${type}')` per app-supplied `type`
(AxonaPeer.js:4235). The wire is computed.

Council decision (Aster + Vega, 2026-08-16): `[Q2]`'s dynamic-import/loader
manifest closes the module graph; it does NOT close an application-supplied
runtime registration-name family. So this is not merely a `[Q2]` manifest case.
E1 must give it its own fence:

1. route it through the canonical registration gateway;
2. define the admissible type source, validation, and lifecycle;
3. fail closed for an unapproved dynamic type past the migration boundary;
4. show no raw `transport.onNotification` remains in this path.

Do NOT weaken `[V2]` (the wire-literal rule) to admit a computed
`direct_${type}` — that would be a new primitive. `onDirectMessage` stays the
single parameterized registrar for the family; the manifest tracks it as one site.

**STATUS — UNMET E1 EXIT-CONDITION, BLOCKS E2 (David's steer, 2026-08-16).** The
E1 door + gates landed and cleared their review; the `mintLive` hardening landed
(Aster F1 — the observation certifier is registry-owned, no public caller path).
This fence did NOT land in the E1 gate slice — allowlisting `onDirectMessage` is
not the fence (Aster F2 = Vega V3). Per both seats' offered alternative and
David's steer, the fence is recorded here as an explicit **unmet E1 exit-condition
that blocks E2**: it must be delivered as its own dedicated, reviewed slice —
design the admissible-type source (the open question: a static manifest of
approved `direct_*` types vs a registration-time allowlist), then the four
requirements above with tests for an approved type, a rejected unapproved type,
and the no-raw-`onNotification` proof — **before any E2 boundary migration
begins**. E2/E3/E4 and deploy remain held for David.

## Definitions to seal at E3 (13)

`onRequest` (6): webrtc.js:400, bridge.js:286, composite.js:222, wstransport.js:371,
sim/transport.js:380, contracts/Transport.js:189 (abstract).
`onNotification` (6): webrtc.js:407, bridge.js:291, composite.js:227, wstransport.js:378,
sim/transport.js:387, contracts/Transport.js:202 (abstract).
`onRoutedMessage` (1): AxonaPeer.js:4223.

## Out of scope

`onMessage` — the public delivery API (AxonaPeer.js:2574, mesh.js:249, plus
webrtc plumbing). Never sealed; stays regression-tested. `bridge-ws-dispatch` —
the WS message switch, a separate registration style outside the three sealed
primitives.

## Line anchors

All line numbers are the `1edb1fd` tree and are re-derived by the generator, not
maintained by hand. Regenerate (`node test/fence_e0_manifest.mjs --write`) after
any tree change; the CI gate fails on drift.
