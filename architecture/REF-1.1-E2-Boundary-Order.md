# REF-1.1 E2 — boundary-ordering plan

Companion to `REF-1.1-Enforcement-Cutover-Design-v5.md` (§Phases, E2) and
`REF-1.1-E0-Inventory.md`. E2 moves every site in the E0 inventory from raw or
wrapped registration to the canonical `registerFrame(recv, wire, handler,
{registry})`. The design fixes the method — one boundary at a time, baseline
shrinks per site, suite green after each boundary, a differential proves dispatch
byte-identity flag-off and flag-on at every step. It leaves the order to this
document. Nothing here changes the wire, arms an enforcement gate, or bumps the
version: E2 rides the same observe-only 4.63.0 as E1, and no phase ships without
David's go.

## The question E2 has to answer before it can start

`registerFrame` refuses at registration any `(recv, wire)` pair no boundary
registry row declares — it throws (`registerFrame.js:57`, exit criterion 4). So a
site can migrate only if some registry already owns its wire. Not every site does.

The four registries built in S2–S4 cover pub/sub (Boundary-1), transport/auth
(Boundary-2), WebRTC + mesh-auth (Boundary-3), and bridge administration
(Boundary-4). Matching the 38 migration-target sites against every declared row —
by the key `registerFrame` actually uses, `registry.wiring.get(wire)`, not by the
E0 group label — gives:

| E0 group | sites | declaring registry | migratable today |
|---|---|---|---|
| A4 pub/sub wire handlers | 19 | Boundary-1 | yes |
| A5 bridge base-auth (`hello`, `hello-ack`, `cap-attest`) | 3 | Boundary-2 | yes |
| A5 mesh base-auth (`hello`, `hello-sig`) | 2 | Boundary-3 | yes |
| **A1 `mesh:signal`** | **1** | **B3 declares it under the wrong wire (`'signal'`, not `'mesh:signal'`)** | **no — B3 wire-label fix** |
| **A1 DHT-core routing** | **10** | **none** | **no — Boundary-5** |
| **A2 `axona:direct` (request + notify)** | **2** | **none** | **no — Boundary-6** |
| **A3 `__tunneled_direct__`** | **1** | **none** | **no — Boundary-6** |

24 of 38 are homed under the door's key. 14 are not, and they split into two kinds
(council review, Vega `4b66abe0`; both verified against the tree):

- **Thirteen have no registry at all** — the routing plane (`lookup_step,
  lookahead_probe, local_probe, find_closest_set, route_msg, reinforce,
  triadic_introduce, hop_cache, lateral_spread, peer-leaving`) and the
  direct-message plane (`axona:direct` two legs, `__tunneled_direct__`). These get
  the two new registries.
- **One is homed under the wrong wire.** The E0 site is
  `this.onRoutedMessage('mesh:signal')` (AxonaPeer.js:729). B3 declares its
  `mesh:signal` rows under wire `'signal'` (the SDP offer/answer/candidate variant
  label), so `registry.wiring.get('mesh:signal')` on B3 is empty. `signal` is not
  `mesh:signal`. E2.0 corrects the B3 row wire to `'mesh:signal'` before E2.3 — an
  in-place fix, not a new registry.

This is not an E0 defect — E0 enumerated the worklist exactly, which is how both
gaps are visible now instead of at the flag day. It is a precondition: **E2 opens
by homing all fourteen under the key the door uses, or it cannot migrate them.**

## E2.0 — home the 13 orphan sites (precondition)

Two coherent planes are unclaimed, so two new registries, symmetrical with the
existing four — each owns exactly the frames its rows declare, no frame owned
twice:

- **Boundary-5 — DHT routing/core.** The 10 A1 routing frames. `recv` is the DHT
  adapter; every frame is a `transport`-kind leg (`onRequest`/`onNotification`),
  except `mesh:signal`, which already belongs to Boundary-3 and is *not* moved
  here.
- **Boundary-6 — direct messaging.** `axona:direct` (request + notify) and
  `__tunneled_direct__`. This is the plane the `direct_*` fence already guards, so
  the fence and the boundary sit together.

Each new registry is built the way Boundary-1 was: rows with `(type, wire,
transportKind, kind, owningService)`, a `frameWiring` map, a boundary-owned
`mintLive` certifier, default-off shadow. No handler moves in E2.0 — it only
declares the contracts, so the ownership fence and `registerFrame` will accept the
migrations that follow. This is the one open design decision (see below): two new
registries, versus folding direct/tunneled into an existing boundary.

## E2.1–E2.5 — migration order

Confidence descends and blast-radius ascends down this list. Migrate the
boundaries already wrapped and already proven first, spend that tooling and
accumulated confidence, and reach the untested hot path last with the most eyes on
it.

1. **Boundary-1 — pub/sub (19).** First. Already S2 `reg.wrap` shadow-wrapped; the
   S3 differential smoke already proves flag-off/flag-on identity on exactly these
   rows; E1 already proved `registerFrame` wires and observes identically to the
   wrap on this boundary. The delta is the smallest one E2 has: wrapped-in-place →
   registered-through-the-door. Highest confidence, so it sets the pattern the
   rest follow.
2. **Boundary-2 — transport base-auth (3).** `hello`, `hello-ack`, `cap-attest`,
   already `b2observe`-wrapped. Auth path, but base-auth notifications are
   contained and already observed.
3. **Boundary-3 — WebRTC + mesh-auth (3).** `hello`, `hello-sig` (already
   `b3observe`-wrapped) plus `mesh:signal`, the one B3 site not yet wrapped —
   a single routed handler with its own standing smoke (`smoke_mesh_signal`).
4. **Boundary-6 — direct messaging (3).** After E2.0 declares it. Small,
   self-contained, adjacent to the `direct_*` fence. Never wrapped, so a fresh
   migration, but only three sites.
5. **Boundary-5 — DHT routing/core (10).** Last, and deliberately. `lookup_step`,
   `route_msg`, `find_closest_set` run on the hot path of every lookup; the plane
   was never wrapped and has no existing differential. It gets the most care: a
   per-frame differential, extra REPS, and the routing sim as a gate beyond the
   suite.

**Boundary-4 (bridge administration) has zero migration-targets.** Its frames are
the bridge WS `dispatch` switch — a separate registration style, out of the three
sealed primitives, out of scope for the cutover. B4 does not appear in E2.

## Per-boundary procedure (identical each step)

1. Move that boundary's N sites to `registerFrame(recv, wire, handler, {registry})`,
   one commit per boundary — so rollback is one `git revert`.
2. The E0 baseline shrinks by N; the baseline-diff gate confirms exactly those N
   raw references left and no new one appeared.
3. `npm test` green.
4. The differential dispatches each migrated frame flag-off and flag-on and
   asserts byte-identical handler input and return value.
5. The boundary ownership fence stays green over the migrated tree.

A missed or miswired site shows up as a behavior change in step 4 or a red suite
in step 3, before the wire — which is the whole point of migrating under observe
with the flag off.

## What stays fixed through E2

WIRE_VERSION 4.0. Kernel 4.63.0 — the version and the enforcement arm together at
the E4 flag day, not here. Shadow default-off, so every flag-off path is
byte-identical to today. No deploy. The `direct_*` E4-arming criterion (an
explicit allowlist required before enforce-true) is untouched by E2 and still
waits at E4.

## E2.0 preconditions (council review, 2026-08-16)

David ruled two new registries (Boundary-5 routing, Boundary-6 direct). All three
seats accepted the plan; the changes below are required before E2.1 begins (Aster
`ASTER-E2-SITE-IDENTITY` CHANGES-REQUIRED, Orion `d8be77be`, Vega `4b66abe0`):

1. **Machine-checked coverage, keyed by site — not by wire.** Every E0 migration
   target appears exactly once across the B1–B6 wiring; the count is 38; the check
   fails for an unowned or a multiply-owned target. It cannot key on the wire
   string: `hello` is two sites (B2 bridge + B3 mesh), and `axona:direct` is two
   sites under one wire. A wire-keyed map of 38 would lie. Key by stable site
   identity — call-site / source primitive plus wire. Recompute the 24/14 counts
   from that gate, not by assertion.
2. **The wiring lookup must carry `transportKind`.** `axona:direct` is one wire on
   two primitives — `onRequest` (AxonaPeer.js:2599) and `onNotification` (:2615).
   Today `frameWiring` maps one wire to one row, and `registerFrame` reads a single
   `transportKind`. One row cannot select both, and the B1/B3 variant split shares
   a wire *and* a kind so it does not cover this. Fix the lookup to
   `(wire, transportKind)` (or distinct equivalent keys) in E2.0, before any
   migration reads a B6 row.
3. **Home `mesh:signal` under its real wire.** Add/correct a B3 row keyed
   `{ wire: 'mesh:signal', transportKind: 'routed' }` (the `onRoutedMessage` label
   at AxonaPeer.js:729) before E2.3. B3's `signal` rows are not that key.
4. **B5/B6 fully specified and smoke-tested** — `type, wire, transportKind, kind,
   owningService` — before migrations consume their rows.
5. **Audit the B1–B3 differentials for a hidden B5 dependency.** Identify whether
   any B1–B3 differential exercises a raw B5 routing path; if it does, migrate that
   dependency first or state it explicitly outside the differential claim, so the
   "B5 last" ordering is auditable rather than assumed.

E2.0 stays contract declaration and proof only — no handler moves. The `direct_*`
E4 explicit-allowlist arming rule is untouched. E2.1+ and every deploy stay HELD
for David.
