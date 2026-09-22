# Bridge Air-Gap — Project Plan — v0.8 (normative correction to v0.7: implementation findings)

**Status:** proposed; a normative correction under Aster CP 66db253a (Vega
5b939bfb concurs), covering what the WP1 and WP2 implementation found that the
v0.3–v0.7 text did not say. It replaces §7.2.6, restates O6 on a measurement,
amends §7.1.2 and §7.2.4, and adds WP4 rows. It reopens no retired block.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Base:** v0.7 (sha256 0f06b617…) on v0.6 (952e0660…) on v0.5 (f0d5bcbe…) on
v0.4 (cc9ea61a…) on v0.3 (e7b23101…); v0.2 (3e8f8a9a…) and v0.1 (866b123f…);
all frozen
**Companions:** council be98d2a8, 66db253a, 5b939bfb, 431fda23; kernel branch
`air-gap-4.89.0` (f95437d, b8a6780); bridge branch `air-gap-2.132.0` (52968d5,
98dbfc5); both LOCAL until David okays a push; ops/STATE.md 2026-09-22

---

## 0. What this correction adds

| Finding | Where |
|---|---|
| a bridge that uplinks writes to WebRTC data channels; §7.2.6 listed two write points, there are three | §7.2.6 replaced |
| a composite gate is an enforcement point, not proof that no lower send bypasses it | §7.2.6 write point 3 gated at `dc.send` |
| generic transit ATTEMPTS and generic transit WRITES are different numbers | §7.2.6 attempts and writes |
| the class table named no home for the bare admission frames or the bridge's own-table notifications | §7.2.6 `controlBare`, `linkMaintenance`, closed lists |
| the bridge's edge class must hold on every transport, and survive a rebind | §7.1.2 amended |
| the addressee rule is an origin rule, not a receive rule | §7.1.2 amended |
| a local oversize rejection closes 1006 on the bridge's side, on the library in use | WP4 O6 restated, measured |
| past the tracked cap, connections share one bound | §7.2.4 amended |

Unchanged and still INCOMPLETE: §7.2.7 (root discovery, the one-hop own-entry
send, the stale-root receiver rule), WP3 (operator bindings, own-entry paths,
key correspondence), WP4 H0 and rows I1–I4, D1–D16, O1–O5, L1–L3. D7 remains
the operator branch; own-entry handling will pass through those bindings. D8
remains "neither"; every bound below is per connection.

## 7.1.2 (amended) The class holds on every edge of an introduction-only node

What v0.3 said: the transport declares each connection's class, and the bridge
socket declares `introduction`.

What the source showed: a bridge that uplinks into another bridge runs the
kernel's web transport, which forms WebRTC data channels to mesh peers through
that uplink. Those edges declare `transport`. Under the WP1 kernel alone the
bridge would have picked them as hops for its clients' frames.

The rule now: an introduction-only node maps EVERY owned edge to
`introduction`, whatever the owning transport declares. Two switches, both
required:

- `AxonaPeer({ introductionOnly: true })`: `capabilityOf` returns
  `introduction` for any edge the transport calls `transport`. No picker in
  §7.1.3 then sees a transit edge.
- `CompositeTransport({ introductionOnly: true })`: `capabilityFor` maps the
  same way and `_routeFor(id, 'forward')` finds no sub, so a forward is refused
  `NO_TRANSPORT_ROUTE` whichever sub owns the peer.

Rebind: the class is a property of the node, not of a binding. Bind → unbind →
bind again on a new connection moves the connection's generation (a pin taken
before the rebind is stale) and leaves the class `introduction`. The role
matrix is a constructor property of the manager and does not read the
transport; a rebind cannot re-enable a role. Fenced (T2, T6).

Origin and receive are two rules and stay two rules:

- ORIGIN: when THIS node originates a route_msg whose addressee sits on a direct
  edge of any class, that edge is the hop and the frame ends there. This is
  what lets a client send SUB to the bridge it is dialled into, and the bridge
  send its own entry one hop to a directly connected root (§7.2.7). It lives in
  `_greedyNextHopToward` and the composite gate, and nowhere else.
- RECEIVE: when this node FORWARDS a received route_msg, an introduction-edge
  addressee is never the hop. The receive scan in the route_msg handler has no
  addressee exception. With one, a bridge would hand a client's frame to another
  directly connected client, which is the highway by definition.

## 7.2.6 (replaced) Every physical write, three points, attempts and writes

| # | Write | Site | Gate | Counted where |
|---|---|---|---|---|
| 1 | client socket | `conn.ws.send` inside `sendTo` and `broadcast`, server.js | `airGap.egressWrite('client', msg, meta)` before; `egressWritten` after the send returned | bridge, point `client` |
| 2 | uplink socket | the `WebSocket` subclass `uplink.js` hands the kernel's web transport; its `send` | `egressWrite('uplink')` before `super.send`; `egressWritten` after | bridge, point `uplink` |
| 3 | uplink data channels | `MeshManager._dcWrite` → `dc.send`, kernel mesh.js; every req/res/ntf envelope AND the keepalive pong pass through it | `egressGate.before(frame, peerId)` → `{allowed, cls}`; refused frames are counted and not written; `after(cls)` once `dc.send` returned; installed by `uplink.js` through `webTransport({ egressGate })` | kernel `mesh.egressStats()` {attempts, writes, refused}; bridge, point `datachannel` |

There is no fourth. HTTP responses are not frames. WP4 O2 sends a positive
control through EACH point; point 3's control needs H0 (real WebRTC) and is
INCOMPLETE until H0 exists.

Attempts and writes. At every point and for every class the bridge keeps two
counters: `attempts`, incremented after classification and before the gate;
`writes`, incremented after the physical send returned without throwing.
`forwardedGeneric` is the sum of `genericTransit` WRITES over the three points,
measured at the same site as every other class's writes. `genericTransitAttempts`
is reported beside it. The oracle for the invariant reads `forwardedGeneric ==
0` AND reads the attempts, so a blocked attempt is evidence and a zero is a
measurement. A counter that could only ever read zero would prove nothing; the
writes counter is live, and the unit fence shows it moving when a write past
the gate is simulated.

Classes, disjoint, with precedence where two could apply. Rows 1–10 and 13 are
v0.5's; rows 11 and 12 are new and CLOSED; 13 stays last.

| Order | Class | What it is | Causal record |
|---|---|---|---|
| 1 | `directorySync` | a `directory:sync` request on an uplink, and its `res` | the cadence, or the received sync |
| 2 | `refusalReply` | a `res` carrying `transit-refused` or a `refused:true` verdict | the received frame and its outcome |
| 3 | `discoveryReply` | `res` to `lookup_step`, `find_closest_set`, `local_probe`, `lookahead_probe` | the received frame (`reqType` rides out of band to the write) |
| 4 | `discoveryRequest` | the bridge's own `lookup_step` / `find_closest_set` to a client, §7.2.7 only | the root-discovery job |
| 5 | `controlReply` | bare `pong`, `peer-list` and `turn` IN REPLY, `res` to any other dispatched request | the received frame |
| 6 | `hello` | the bridge's `hello`; the bridge's `hello-ack` on its uplink | the admission event; the uplink handshake |
| 7 | `signalRelay` | bare `signal` to a named admitted connection | the received `signal` |
| 8 | `directoryServe` | DELIVER, replay, PULLRESP for a named topic to its subscriber | the subscription record |
| 9 | `directoryOwnEntry` | own-entry PUB, one hop, own `originId`, named topic | a book change or the cadence |
| 10 | `directoryRepublish` | sync-received entry PUB, one hop | the accepted sync |
| 11 | `controlBare` | the closed list below | the state transition named beside each |
| 12 | `linkMaintenance` | the closed list below | the kernel cadence named beside each |
| 13 | `genericTransit` | any write not matched above; any `route_msg` with a foreign `originId`; any `direct_*` for a non-directory topic; any `__tunneled_direct__` | none; counted as an attempt, never written |

`controlBare`, closed:

| Type | Wire | Emitted on | Destination | Bound | Causal record |
|---|---|---|---|---|---|
| `version-gate` | bare | socket accepted | that socket | once per connection | the connection |
| `welcome` | bare | client-hello passed | that socket | once | the admission |
| `peer-list` | bare | admission (not in reply) | that socket | once | the admission |
| `turn` | bare | admission (not in reply) | that socket | once | the admission |
| `peer-joined` | bare | another socket admitted | every admitted socket | once per admission | that admission |
| `peer-left` | bare | another socket closed | every admitted socket | once per close | that close |
| `client-hello`, `ping`, `peer-list-request`, `turn-refresh` | bare | the bridge as a CLIENT of its upstream | the upstream socket only (point 2) | the client cadences | the uplink lifecycle |

`linkMaintenance`, closed:

| Type | Wire | Emitted on | Destination | Bound |
|---|---|---|---|---|
| `hop_cache`, `lateral_spread`, `reinforce`, `triadic_introduce`, `presence`, `peer-leaving` | ntf | the kernel's own synaptome maintenance (reinforce wave, lateral spread, presence tick, leave) | ONE directly connected neighbour | the kernel's cadences; per connection |
| `ping` | req | the kernel's link liveness | one neighbour | kernel cadence |
| `ping`, `pong` | bare, data channel | the mesh keepalive | one channel | mesh cadence |

Neither list carries a received frame. A frame that does is `genericTransit`
by row 13, whatever its type. One allowed and one forbidden case per added
class are in the unit fence: `reinforce` ntf → `linkMaintenance`; a
`route_msg` with a foreign `originId` → `genericTransit`; `peer-list` on
admission → `controlBare`; the same frame in reply → `controlReply`; an unknown
bare type → `genericTransit`.

## 7.2.4 (amended) The overflow slot

Per-connection bound state exists for the first 256 tracked connections. A
connection past that shares ONE overflow slot: one bucket per type for all of
them together. The cost is stated: a burst by one overflow connection is a
refusal for another. Overflow hits are counted per FRAME (`overflowHits`), not
per connection, because a per-connection count would need per-connection
state, which is what the cap avoids. Today `BRIDGE_MAX_PEERS` is 32, so the cap
is not reached in production; the fence (U5) exercises it with a cap of 4.

## WP4 O6 (restated on a measurement) Oversize and close accounting

Reproduction, retained as evidence: `ws` 8.21.0 on Node 24.14.1; a server with
`maxPayload: 1024`; a client sends 2048 bytes. Observed: server `error` event
with code `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`; client `close` with code 1009;
server `close` with code 1006 and an empty reason. The library sends the 1009
close frame and destroys the socket without waiting for the echo.

Rule: `oversizeLocal` counts the local error event and nothing else; it is the
only proof of a local size rejection. `close1009` counts close events with
code 1009 and stays a neutral close-code observation. On this library a LOCAL
rejection reads `oversizeLocal` 1, `close1009` 0; a PEER-sent 1009 reads
`close1009` 1, `oversizeLocal` unchanged. Both cases are in the bridge fence
with those observed events. A library whose local close event echoed the sent
code would fail the fence; the expectation is then re-measured, never edited
to pass.

## WP4 (rows added)

| Row | What | Fence | State |
|---|---|---|---|
| P7 | bridge-wide class: the composite maps a transport-class sub to introduction; a forward is refused with nothing written; the addressee pass-through still holds; a regular node on the same transport is unaffected | fence_air_gap_capability | done |
| P8 | the data-channel gate sits at `mesh._dcWrite`: a refused frame never reaches `dc.send`; an allowed one is written and `after(cls)` runs; counters at the write site; no gate ⇒ unchanged | fence_air_gap_capability | done |
| T1–T6 | server transport: class unknown / introduction, never transport; rebind moves the generation and keeps the class; partition before handler with one reply per refused request and none for drops or unadmitted sockets; `reqType` to the write; slot release; the matrix does not move with the transport | fence_air_gap_transport | done |
| I5 | two AUTHENTICATED clients, both in the synaptome: A's `route_msg`, `direct_*` and `__tunneled_direct__` addressed to B → refusal verdict to A, nothing at B, generic transit attempts and writes 0 on every point | fence_air_gap_ingress §F | done over point 1 |
| O2(3) | a positive control through the data channel of a real uplink | needs H0 | INCOMPLETE |
| U6 | one allowed and one forbidden case per egress class, attempts and writes split | fence_air_gap_unit | done |

## Everything else

Every line of v0.7, v0.6, v0.5, v0.4 and v0.3 not named above stands as
written.
