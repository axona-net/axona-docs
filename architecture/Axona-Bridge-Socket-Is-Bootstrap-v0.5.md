# The bridge socket is bootstrap: replace it with a WebRTC channel (v0.5)

**Status:** design for council review, revision 5 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.106.0 (`61c759f`) · **Bridge:** 2.151.0
(`79324aa`), armed on all four bridges at cap 50 · **Policy set by:** David,
2026-10-07 · **Author:** axona.bot · **Supersedes:** v0.4 (`b28d853`),
v0.3 (`57b134f`), v0.2 (`df75291`), v0.1 (`6e795d1`) · **Builds on:**
Bridge fill v0.8 (`9b1ed08`), Mesh connectivity: hold and fill v0.15
(`e4809d2`).

David's direction, 2026-10-07, in full: "Once we establish a websocket
connection to a bridge, we need to replace it with a webrtc connection. The
bridge relay should be the same as a regular relay except that it can
graduate a connected node to make room for a newly introduced node."

**What v0.5 changes.** Aster's fourth review (`96992789`) and Vega's
(`30bb1947`) found three release-blocking contracts in v0.4, each confirmed
at source. (A) v0.4 left the attempt generation to the door and a fence to
decide whether a stale candidate matters; v0.5 makes the attempt id a
normative field of mesh signalling, carried in every offer, answer and
candidate and checked at both ends, and the fence challenges that
invariant (§ Signalling domains). (B) v0.4 claimed the degree slack bounds
transients; it does not: `_enforceDegree` returns inside `_degreeInterval`
(`mesh.js:758`) before it counts (`:762`), and `_retire` deletes the
peer-map entry before the physical close (`:1591`) while capacity waits on
the transport's `closed` (`:1584–1587`). v0.5 names the degree target as
SOFT and names the allocation LEDGER as the hard, closing-aware bound on
resident peer connections, and puts door-side negotiations on it. The
claim "one negotiation per `cooldownMs`" is withdrawn (§ Capacity). (C) A
retire at OPEN was spent before the gate at BIND could refuse the
newcomer. v0.5 defers the incumbent retire to BIND, after eligibility, and
gives the newcomer's channel provisional capacity on the ledger until then;
an ineligible newcomer retires only its own channel (§ Make room).

## The question

What is a bridge's WebSocket for, once the node on the other end has a kernel
identity and a WebRTC stack? Today it is three things at once: the way in
(welcome, peer-list, the first introductions), the signalling path for the
newcomer's first dials, and a kernel channel the bridge's own node admits
into its synaptome. The first two end naturally when the newcomer is meshed.
The third never does, and it is the only kind of channel the bridge's node
has to its own population.

The afternoon of 2026-10-07 showed the cost. East, armed to fill at 50,
dialled 63 times in twelve minutes and opened nothing: its only signalling
path for a dial is its uplink socket to west, and a bridge's signal relay
forwards only to a peer that holds a socket on it (`server.js:1459`), which
on west is east alone. East has read zero open mesh channels at every
reading of the day. Its door, meanwhile, holds seventeen sockets, five of
them bound identities that its node admits over the socket and would never
dial. A bridge whose own population reaches it only over sockets has a mesh
of nobody.

## What this is not

- NOT a change to the fill's rule. Rule 2 runs on the bridge's peer as
  released; its dials open channels under the same ledger and degree pass.
- NOT a change to the client's dialing rule. A client already dials every
  entry in the peer-list it does not hold (`mesh.js:706`), signals through
  its bridge socket (`web/index.js:523`), and honours a 4200 graduation
  once it holds `graduationMeshFloor` mesh peers (3), reconnecting
  otherwise (`index.js:843–846`).
- NOT free of client change. Two kernel changes ride a kernel release and
  every client runs them: the composite's route-token rule and
  identity-scoped death (§ Ownership), and the attempt id in mesh
  signalling (§ Signalling domains). A client without them is never offered
  the bridge's reserved id (§ Mixed versions).
- NOT a second channel to a peer in steady state. The socket is superseded
  the instant the channel binds, and a superseded route is never routable
  again.
- NOT a bigger door. `BRIDGE_MAX_PEERS` (15) stays the door's graduation
  target with hysteresis (`server.js:585`, slack 2). It is a target; the
  hard bound on concurrent sockets is not established by this design.
- NOT a hard degree cap. The mesh degree is a TARGET with hysteresis and an
  interval; the hard bound on resident peer connections is the allocation
  ledger's (§ Capacity).
- NOT a new retire selector. `selectMeshRetire` and `selectGraduate` stay.
- NOT arming. The flags and caps of 2.151.0 are untouched.
- NOT a delivery proof. § Frames in flight says what each class of frame
  is owed at the switch and what may be lost.

## What a bridge does today, in the order a newcomer sees it

1. The newcomer opens a WebSocket. The door gives the socket a connection
   id, `c` plus a counter that only rises within one process
   (`server.js:1114`), admits it (version gate), sends `welcome` with TURN
   credentials, and a `peer-list` of up to `anchorK` admitted CONNECTION
   IDS chosen by `selectAnchors` (`server.js:1216–1249`). The bridge's own
   id, in either space, is NOT in that list.
2. The newcomer's mesh dials every listed id (`mesh.js:706`). Each offer is
   a `signal` frame over the socket with `to` = the listed connection id;
   the door relays it to that socket if it exists and drops it otherwise
   (`server.js:1459–1465`), rewriting `from` as the sender's connection id
   (`server.js:1469`). The receiver's web transport hands `frame.from` to
   `mesh.onSignal` (`index.js:661`); the mesh keys the negotiation by that
   string and a later offer, answer or ICE under the same key acts on
   whatever the key holds (`mesh.js:881–897`); there is no attempt id. An
   inbound offer that needs a new peer connection first asks the
   allocation LEDGER (`mayAllocate('in')`, `mesh.js:881–886`) and is refused
   if the ledger says no. When the data channel opens the ledger records
   OPEN (`:1184`) and the mesh runs `_enforceDegree` (`:1186`): it returns
   at once if the last retire is inside `_degreeInterval` (`:758`), else
   above `_degreeMax + _degreeSlack` it retires one open channel chosen by
   `selectMeshRetire` (duties protected, cooldown map). `_retire` marks the
   ledger CLOSING, closes the channel and peer connection, and deletes the
   peer-map entry (`:1584–1591`); the ledger releases capacity on the
   transport's `closed` or its own escalation. The authenticated `hello`
   over the data channel binds the node id to the channel's key
   (`meshAuth.onHello`, `index.js:1111` → `webrtc.bindPeer`, `index.js:1090`,
   `webrtc.js:212` → `onPeerBound`); the mesh entry stays under its
   signalling key with the node id beside it. A bridgeless (relayed)
   negotiation uses `deliverMeshSignal(fromHex, payload)` (`index.js:1261`),
   keyed by the sender's NODE hex (`AxonaPeer.js:5660`, `:1180`).
3. The authenticated hello over the socket binds the newcomer's node id to
   its connection id; `_completeHandshake` admits it into the bridge node's
   synaptome AS A SOCKET PEER (`bridge_axona_node.js:629`). The kernel's
   admission gate decides at bind, at cap by its admit-or-improve rule
   (`_admitOrImprove`, `AxonaPeer.js:2537`).
4. When the door holds more admitted sockets than target plus slack,
   `maybeGraduate` closes one admitted socket with code 4200, choosing by
   keyspace balance and vitality (`meshBound` reported on the heartbeat,
   kernel ≥ 4.38, TTL 20 s, safe floor 4, `server.js:435–448`), and only
   for clients whose version honours 4200 (`server.js:427–434`). The
   bridge node loses that peer entirely: the door's `handleConnClosed`
   fires peer-died with the bound node id (`ws_transport.js:327–340`), the
   composite forwards every sub's death to the kernel
   (`composite.js:353–355`), and the kernel evicts the identity. A
   `peer-left` from a bridge never closes a peer's OPEN channel
   (`mesh.js:841–868`).
5. The bridge node's own mesh channels come from one place: peers that dial
   it through the other bridge's relay, or that the bridge dials through its
   uplink. East has none. West has 11 to 20. A seed bridge with no upstream
   has no mesh at all: `startUplink` returns null (`uplink.js:62`).

So a bridge is a relay for everyone else and a node for nobody at its own
door.

## The rule

A bridge is a relay. Its socket is the way in and nothing more:

1. INTRODUCE ITSELF, IN THE DOOR'S OWN ID SPACE. The peer-list a newcomer
   receives carries one reserved connection id for the bridge itself,
   first, then the anchors. The reserved id is `c-self-<doorEpoch>`,
   `doorEpoch` minted once per door process start; the counter yields
   `c<n>` and can never produce it.
2. ANSWER AT THE DOOR, IN A DOMAIN OF ITS OWN, ONE ATTEMPT AT A TIME. A
   `signal` frame whose `to` is the current reserved id is neither relayed
   nor dropped: the door hands it to the bridge node's own mesh under the
   key `d<doorEpoch>:<connId>`. Every offer, answer and candidate carries
   the offerer's ATTEMPT ID and both ends drop a frame whose attempt id is
   not the one the key currently holds (§ Signalling domains). Answers and
   candidates for that key go back over that one socket. No node id is
   used, trusted or needed before the channel's handshake. The offer asks
   the ledger as every inbound offer does.
3. BIND ON THE CHANNEL. The authenticated `hello` over the data channel
   binds the node id beside the door key through the door-dialled path
   named above. The composite's route-token rule (§ Ownership) decides
   what that bind does to a socket route the same identity holds; the
   admission gate decides identity eligibility at that bind; and only then,
   if the mesh is at its target counting the newcomer, is an incumbent
   retired to make room (§ Make room).
4. RETIRE THE SOCKET. Once the newcomer's channel to the bridge is bound
   AND the newcomer's last `meshBound` report is fresh (20 s) and at least
   `GRADUATION_SAFE_FLOOR` (4), the door closes the socket with 4200. A
   newcomer whose report is stale, absent or below the floor keeps its
   socket until the report qualifies or today's graduation takes it; a
   client below its own floor at a 4200 reconnects, a fresh bootstrap
   bounded by the door, and that rate is a measurement.
5. MAKE ROOM, AT BIND, AFTER ELIGIBILITY. A newcomer's channel opens into
   provisional capacity on the ledger. At its bind, if step 0 and the gate
   accept it and the mesh counting it stands at or above its target, one
   incumbent is retired by `selectMeshRetire` with the newcomer excluded,
   under the sliding budget; if the budget is spent or no eligible
   incumbent exists, the NEWCOMER's own channel is retired and the bind is
   refused, which is a relay's refusal. If step 0 or the gate refuses the
   newcomer, only its own channel is retired; no incumbent is touched and
   no budget is spent. This is the one way a bridge differs from a relay:
   a relay at cap keeps its old channels and the newcomer loses; a bridge
   at cap keeps an eligible newcomer and an old channel loses, because
   introducing newcomers is the bridge's job.

After these, a bridge's population is mesh channels, held near
`BRIDGE_MESH_MAX_PEERS`, filled by the fill and by every newcomer at its
door, and graduated by keyspace balance when an eligible newcomer needs the
room. The socket population is the newcomers still bootstrapping, held to
the door's target by graduation; whether sockets are short-lived is
measured.

What it does to the afternoon's finding: east's mesh grows by one channel
per newcomer it introduces, with no relay through west involved. East's
dials through its uplink have failed at every reading today; whether they
go on failing after this change is not known, and the relay question
(option A of the 19:23Z record) stays open on its own.

## Signalling domains and the attempt id (Aster `96992789` A, Vega `30bb1947`)

The bridge's one mesh receives negotiations from three sources:

| Source | Key today | Key under this design |
|---|---|---|
| Upstream door (uplink socket, `index.js:661`) | `c<n>` minted by the UPSTREAM door | unchanged |
| Relayed (bridgeless) ingress `deliverMeshSignal` | 66-hex node id | unchanged |
| Own door (new) | none | `d<doorEpoch>:<connId>` |

A node hex may begin with `c`; what keeps the three forms apart is the
66-character length and the colon only the door key carries.

- EPOCH. `doorEpoch` scopes the reserved id and every door key to one door
  process. A door restart changes it; a reconnecting client is offered the
  new reserved id and dials it as a new peer; its entry for the old id ends
  by the mesh's own rules (negotiation timeout if unbound, `pc-closed` if
  bound).
- ATTEMPT ID, NORMATIVE AND END TO END. Mesh signalling gains one field.
  The offerer mints an attempt id when it builds an offer and puts it in
  the offer; the responder stores it with the key and echoes it in its
  answer and in every candidate; the offerer puts it in every candidate it
  sends. On receipt, at either end, a frame whose attempt id differs from
  the one the key currently holds is DROPPED and counted
  (`signal-stale-attempt`); a new offer with a new attempt id for a key
  that holds an unbound negotiation replaces it (the old attempt's frames
  are stale from that instant); a new offer for a key that holds an OPEN
  channel is a same-identity second channel settled at bind by the sub's
  duplicate rule. Every asynchronous continuation in the negotiation
  (`setRemoteDescription` then send, candidate flush, ICE callbacks)
  captures the attempt id it started under and validates it against the
  key's current attempt before applying any effect. This is a kernel change
  in `mesh.js`, and it is what makes the door's relabelling safe: the door
  does not need to tell attempt A's late candidate from attempt B's; the
  receiver's check does. No reliance is placed on any WebRTC runtime
  rejecting a stale candidate.
- COMPATIBILITY. A frame with no attempt id is accepted as belonging to the
  key's current attempt (legacy). The bridge offers its reserved id only to
  clients on a kernel that carries the field (§ Mixed versions), so door
  negotiations to the bridge never run legacy.
- SINK. One dispatching `setSignalRelay` routes by key form: a door key to
  the door, which strips the prefix, checks the connection id is open, and
  writes the frame with `from` = the current reserved id; a `c<n>` key to
  the uplink socket; a 66-hex key to the relayed path. A frame for a closed
  socket is dropped and counted.
- CANCELLATION. A door socket's close calls `onPeerLeft` on its key: an
  unbound negotiation is cancelled, an OPEN channel is left alone
  (`mesh.js:862–864`), and OPEN is not BOUND: an open-but-unbound door
  channel is provisional capacity (§ Capacity) and is reaped by the mesh's
  negotiation deadline and vitality as today if it never binds.

## Ownership: one identity, one admitted route, one direction (Aster, Vega `07c5ff8e`)

Each sub-transport reports its own peer's death and the composite hands
every one to the kernel (`composite.js:353–355`); the first sub in order
owns a disputed identity (`composite.js:206–214`). R8-2 rejects a bind only
when the attempt guard refused it and an attempt is live
(`AxonaPeer.js:641–658`). The rule, in the composite, before the guard and
before any side effect:

- A ROUTE is (sub, token): the door's token is its connection id within its
  `doorEpoch`; the mesh's token is its channel key plus attempt id. Each
  sub keeps the CURRENT token per identity it holds. The composite keeps,
  per identity, the ADMITTED route and the set of SUPERSEDED routes; the
  record outlives the admitted route until every superseded route has
  closed.
- STEP 0, TOKEN VALIDATION, before (a)–(d): a bind whose (sub, token) is
  not that sub's current token for the identity, or is in the identity's
  superseded set, is ignored and logged. This runs even when the identity
  has no admitted route, so a retired token cannot re-admit after identity
  death, and it is independent of R8-2. A bind callback that arrives after
  its channel was retired (a `dc.onopen` continuation after a self-refusal)
  is caught here: its token is no longer current.
- (a) No admitted route → this route is admitted; the bind proceeds to the
  guard and the kernel as today.
- (b) DIRECTIONAL. An admitted SOCKET route and a binding MESH route → the
  mesh route is admitted, the socket route is superseded (its sub's
  `ownsPeer` answers false from this instant), the kernel sees a route
  change with no re-admission. This is the linearization point. An
  admitted MESH route and a binding SOCKET route (the newcomer's first
  hello landing after its channel bound) → the socket route is created
  SUPERSEDED at birth: hello acknowledged, nothing admitted, the socket
  stays open for signalling and the peer-list until rule 4 closes it.
  Socket → mesh is the only direction a switch runs.
- (c) Same sub, current token, while an older channel of the same sub is
  still open → the sub's existing duplicate case (row 7's reconcile), cited
  not changed.
- (d) A bind from a superseded or retired route is caught by step 0.
- IDENTITY-SCOPED DEATH. A death from a superseded route unbinds that route
  in its sub and fires nothing into the kernel. A death from the admitted
  route fires into the kernel as today and the identity dies; its
  superseded sockets are closed by the door with 4200 (the client, which
  lost the channel, reconnects or not by its own floor). A superseded route
  is NEVER re-promoted.
- BOTH ENDS. On the client, when the mesh binds the bridge's node id, the
  bridge sub's ownership of that identity (`index.js:78`) is superseded by
  (b), the 4200 close fires no death for it, and kernel frames to the
  bridge ride the channel.

## Capacity: what is soft, what is hard, what bounds pre-auth work (Aster B, Vega)

Three counters exist and v0.4 conflated them. Named here with the event
each acts at and what each bounds:

| Counter | Acts at | Nature | What it bounds |
|---|---|---|---|
| Mesh degree (`_degreeMax`, slack, `_degreeInterval`) | channel open (`:1186`) and, in this design, newcomer bind | SOFT target: returns inside the interval before counting (`:758`); hysteresis slack; one retire per pass | nothing in a burst inside the interval; the number of OPEN channels in steady state, near target |
| Allocation ledger (`mayAllocate`, OPEN / CLOSING / gone) | offer (`:881–886`), dc-open (`:1184`), retire (`:1584`), transport `closed` | HARD, closing-aware: a closing peer connection holds its slot until `closed` or escalation | RESIDENT peer connections, including those closing and those open but unbound |
| Door target (`BRIDGE_MAX_PEERS`, slack) | graduation pass | SOFT target with hysteresis | admitted sockets, near target; no hard aggregate bound |

- The degree is a target. A burst of opens inside `_degreeInterval` is not
  counted until the next pass; the mesh may stand above target plus slack
  by that burst, as it does on every relay today, and this design does not
  change that. The text of v0.4 that said slack alone bounds transients is
  withdrawn.
- The ledger is the hard bound on resident peer connections, and door-side
  negotiations are on it: an offer to the reserved id asks `mayAllocate('in')`
  through the same `onSignal` path as any inbound offer (`:881–886`), the
  open records OPEN, a retire records CLOSING, and the slot is released at
  `closed`. PROVISIONAL capacity (open-but-unbound door channels awaiting
  bind) is ledger capacity like any other; it is not counted by the degree
  pass as a retire candidate and does not trigger an incumbent retire at
  open (§ Make room). Its bound is the ledger's inbound allowance.
- PRE-AUTH WORK is bounded by the ledger, not by cooldown. v0.4's "one
  negotiation per `cooldownMs` per identity" is WITHDRAWN: a cooled-down
  identity on a fresh socket is unknown to the door until its channel's
  hello, and each fresh attempt spends an offer, a peer connection and ICE
  before the gate refuses it at bind. What limits that spend is (i) the
  ledger's inbound allowance, (ii) one live attempt per socket (a new offer
  replaces the previous attempt under the same key), and (iii) the door's
  graduation target on sockets. None of these is a per-identity rate; a
  per-identity pre-auth rate would need a field the hello supplies and is
  not proposed here.
- The socket target does not establish a hard aggregate bound on sockets
  either; that stays in § What this document does not establish.

## Make room: deferred to bind, after eligibility (Aster C, Vega)

v0.4 retired an incumbent at open and let the gate refuse the newcomer at
bind; the retire was then spent for nothing. v0.5 orders it the other way:

- AT OPEN: the newcomer's channel is provisional. The degree pass that runs
  at open (`:1186`) treats provisional channels as neither count nor
  candidate when the bridge's policy is injected; otherwise it runs as
  today. No incumbent is retired for a provisional channel.
- AT BIND, in order: step 0 token validation; the admission gate's
  eligibility (identity cooldown `recentlyRetired`, then admit-or-improve
  at `_admitOrImprove`); then, if eligible and the open channels COUNTING
  the newcomer stand at or above `_degreeMax`, `retireForNewcomer(key)`:
  `selectMeshRetire` over the incumbents with the newcomer excluded,
  duties and last representatives protected, identities in the bridge's
  cooldown excluded, under the sliding 60 s budget. One victim retired →
  the bind completes and the newcomer is admitted. No victim (protected
  set) or budget spent → the newcomer's own channel is retired and the
  bind is refused as a relay refuses.
- INELIGIBLE at step 0 or the gate → the newcomer's own channel is retired;
  no incumbent touched; no budget spent. Wasted incumbent retirement is
  therefore not permitted and does not occur by construction; what the
  design pays instead is provisional ledger capacity for the time between
  open and bind, bounded by the ledger and by the negotiation deadline.
- The retire-at-bind is outside `_enforceDegree` and so outside its
  interval early return; the budget is the bridge's sliding window, and the
  pass's own one-retire-per-interval rule does not apply to it.
- A bind callback after the newcomer's self-refusal (`dc.onopen` continues
  after the degree pass) is caught by step 0: the retired token is not
  current; no ownership is reopened and no work restarts.
- A NEWCOMER already admitted over its socket (hello first) is a route
  replacement under (b): no identity decision, and no incumbent retire,
  because its channel replaces the socket in the same count; the degree
  pass sees one more open channel and, if above target plus slack, behaves
  as it does on a relay today.
- COOLDOWN, TWO SCOPES, BOTH AFTER IDENTIFICATION. Per-identity: the
  victim's node id in `recentlyRetired` for `cooldownMs`, consulted by the
  gate at bind. Per-connection: the victim's connection id refused a new
  negotiation to the reserved id for `cooldownMs`. Neither bounds pre-auth
  work (§ Capacity).
- RATE. `BRIDGE_MAKE_ROOM_PER_MIN` (proposed 4, no measurement behind it) is
  a sliding window over the last 60 s of incumbent retire timestamps.

## Frames in flight at the switch

Per class, the allowed outcomes at the linearization point:

| Frame | Outcome |
|---|---|
| Request issued on the socket, replied before the switch | resolved once, as today |
| Request issued on the socket, pending at the switch | rejected `route-superseded` at the switch; a reply arriving later on the socket is dropped and logged; never resolved twice |
| Request issued after the switch | on the channel; the kernel's usual timeout and failure rules |
| Notification pending on the socket at the switch | may be lost (defined loss) |
| Notification issued after the switch | on the channel; fire-and-forget as today |

What a rejected request can interrupt, from the `send`/`request`/
`routeMessage` call sites under `src/dht`, `src/pubsub` and the handshake
at `61c759f` (counts are call sites):

| Type | Sites | What its caller does on failure today |
|---|---|---|
| `lookup_step`, `find_closest_set`, `local_probe`, `lookahead_probe` | 1, 1, 1, 2 | idempotent reads; the lookup's own iteration re-issues to the next candidate |
| `route_msg` | 3 | the carrier for routed delivery; `_relayMeshSignal` retries once (`AxonaPeer.js:5661–5666`); pub/sub publish retries byte-identical under content dedup (`msgId = sha256(publisher, message)`) |
| `mesh:signal` | 1 | carried by `route_msg`; a lost signal fails the negotiation, which the mesh's deadline ends |
| `axona:direct`, `__tunneled_direct__` | 1, 1 | application direct messages; semantics are the application's |

This is an inventory of request types and their callers' existing failure
handling. It is not a proof, and it is not an inventory of durable
obligations: topic roles, replication, repair and any authenticated
discharge or retention certificate are driven by the kernel's reconcile
loops and are outside what a transport switch can discharge or revoke. The
implementation fence for § Ownership runs each request type across the
switch and records the outcome against this table. No exactly-once claim
is made anywhere.

## What the bridge knows when it closes the socket

Its own channel to the newcomer is bound, and the newcomer's last
`meshBound` heartbeat report with its age (`server.js:435–448`). The close
waits for a fresh qualifying report. A client that never reports is not
closed on this rule and falls to today's graduation. The remaining cost is
a client whose mesh drops between its report and the close, the case the
safe floor was set for; the measure is reconnects per newcomer on the
testnet.

## Mixed versions, legacy clients, seed bridges, rollback

- A client whose kernel lacks § Ownership would evict the bridge from its
  synaptome on the 4200 close; one that lacks the attempt id would run
  legacy signalling against the door. The door already gates graduation on
  client version (`server.js:427–434`); the same gate, raised to the kernel
  that carries both, decides whether a client is offered the reserved id.
- A client that does not honour 4200 (the 4.84.0 identity-less cohort on
  east) is never offered the reserved id and is graduated as today.
- A seed bridge with no upstream (B1) gets a mesh with no upstream socket:
  `startUplink` returning null (`uplink.js:62`) is replaced by a mesh whose
  only sink domain is the door.
- The flag is read at start. Turning it off and restarting drops every
  channel and socket, as any restart does today; there is no live flip.

## What has to change, and where

Kernel, one release:

- `mesh.js`: the attempt id in offer, answer and candidate, stored per
  key, checked on receipt at both ends, captured and re-validated by every
  asynchronous continuation; `signal-stale-attempt` counter;
  `retireForNewcomer(key)`; a policy hook by which `_enforceDegree`
  excludes provisional channels from count and candidates. Default
  behaviour byte-identical when no policy is injected and frames carry no
  attempt id.
- `composite.js`: step 0 token validation, directional (b), born-superseded
  socket routes, identity-scoped death, the dispatching signal sink.

Bridge, one release, behind `BRIDGE_SOCKET_IS_BOOTSTRAP` (default off):

- `server.js`: `doorEpoch`; the reserved id first in `peer-list` for
  eligible clients; a `signal` with `to` = the reserved id delivered to
  `bridgeNode.deliverDoorSignal(connId, payload)`; the door-domain sink;
  close with 4200 on "channel bound for this connection id" AND a fresh
  qualifying `meshBound`; the sliding rate window.
- `ws_transport.js`: SUPERSEDED on a binding, including at birth;
  `handleConnClosed` fires no death for it; pending requests rejected
  `route-superseded` at supersede time; hello over a superseded binding
  acknowledged without admission.
- `bridge_axona_node.js`: `deliverDoorSignal` → `mesh.onSignal(doorKey,
  payload)`; provisional marking of door channels until bind; the
  bind-time order (step 0 → gate → `retireForNewcomer`); `recentlyRetired`
  consulted by the gate; `fillStatus` extended with door-side negotiation,
  provisional, retire, refusal (by cause), stale-attempt and reconnect
  counters.
- `uplink.js`: the mesh exists without an upstream.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Position of the reserved id in `peer-list` | first | Every listed id is dialled at once (`mesh.js:706`); first costs nothing and gets the bridge's channel earliest. |
| When the socket closes | channel bound AND a fresh (20 s) `meshBound` ≥ `GRADUATION_SAFE_FLOOR` (4) | The existing vitality constants; a high reconnect rate on the testnet says raise the floor or shorten the TTL. |
| Make-room rate | `BRIDGE_MAKE_ROOM_PER_MIN` 4, sliding 60 s | No measurement behind it; the testnet arrival rate sets it. |
| Retire cooldown, both scopes | the mesh's existing `cooldownMs` | Shorter thrashes, longer starves a region's only route; measured. |
| Client eligibility | kernel ≥ the release carrying § Ownership and the attempt id | Below it the client evicts the bridge on 4200 or runs legacy signalling. |
| `BRIDGE_MAX_PEERS` | 15, unchanged, a graduation target with slack 2 | The hard bound on sockets is not established here. |
| Provisional capacity | the ledger's inbound allowance, unchanged | If provisional channels crowd out fill dials on the testnet, a separate provisional allowance is the next parameter. |

## Rollout

1. Kernel release with the attempt id, § Ownership, `retireForNewcomer`,
   the degree-pass policy hook and the dispatching sink, fenced; no
   behaviour change on any client until a bridge offers a reserved id.
2. Bridge release with the flag, default off.
3. Testnet B1 and B2 with the flag on. Measure: socket lifetime, channels
   per newcomer, provisional channels and their lifetime, reconnects per
   newcomer, incumbent retires per minute, refusals by cause (ineligible,
   protected, budget), stale-attempt drops, pre-auth negotiations by
   later-refused identities, fill state.
4. West, on David's word, one hour of measurements at ten minutes.
5. East, on David's word. The measure is east's open mesh channels, which
   have read zero all day.

## Verification

Fences, each run with the fix deleted to show the fence sees it. Each fence
challenges a stated invariant; none decides whether an invariant is
needed. A passing mutant set says the fence detects those mutants and
nothing else; live measurements inform liveness, not safety.

- ATTEMPT ID: a candidate from attempt A delivered after attempt B's offer
  under the same key is dropped at the receiver and counted; an answer
  carrying A's id after B's offer is dropped; a continuation captured under
  A that resumes after B applies nothing; the same three at the offerer's
  end; a frame with no attempt id is accepted as the current attempt
  (legacy) and never offered a reserved id; both ends on the new kernel
  with every schedule of offer / answer / candidate interleaving the fence
  can enumerate.
- OWNERSHIP, every order: channel bind then FIRST socket hello (socket born
  superseded); hello then bind (switch at (b)); channel dies before the
  socket closes (identity dies, socket closed 4200, no re-promotion); a
  retired token's bind after identity death (step 0); a `dc.onopen`
  continuation after the newcomer's self-refusal (step 0, no ownership
  reopened, no work restarted); a same-sub bind on a non-current token with
  no live dial guard (step 0, not R8-2); one synaptome entry per identity
  throughout; frame outcomes per the table; no peer-died from a superseded
  route; the client's composite routes to the channel after the close.
- CAPACITY: a burst of opens inside `_degreeInterval` is NOT bounded by
  target plus slack (the fence asserts the soft behaviour and the ledger
  bound, not a hard degree bound); a retire's slot is held on the ledger
  until `closed`; provisional channels count on the ledger and not in the
  degree pass; repeated fresh sockets by one cooled-down identity each
  spend pre-auth work up to the ledger's allowance and are each refused at
  bind (the fence asserts the ledger bound and the refusal, and asserts
  that NO per-identity pre-auth rate holds).
- MAKE ROOM AT BIND: eligible newcomer at target → one incumbent retired,
  newcomer excluded, then admitted; ineligible newcomer (cooldown, gate
  refusal, step 0) → its own channel retired, no incumbent touched, budget
  unchanged; protected set or budget spent → newcomer's channel retired and
  bind refused; hello-first newcomer → route replacement, no retire;
  full-cap → retire → late ineligibility cannot occur (the order is fenced
  by deleting the eligibility step and watching the incumbent fall);
  window-boundary bursts cannot exceed the sliding budget.
- SEED WITHOUT UPSTREAM: a bridge with no reachable upstream constructs a
  mesh, accepts a newcomer's channel and reports it on `meshDegree`.
- MIXED VERSIONS: a client below the eligibility gate receives today's
  peer-list; a client that does not honour 4200 is graduated as today.
- FLAG OFF / NO POLICY / NO ATTEMPT ID: door behaviour byte-identical to
  2.151.0; `_enforceDegree` and `onSignal` byte-identical to 4.106.0.

## As built (2026-10-08, kernel `socket-bootstrap` 69a09f9, bridge `socket-bootstrap` 45e64dd)

David said "Let's build" at about 21:40Z on 2026-10-07. The build follows
this note with the differences below, each found by a fence or a review
during the build and recorded here so the note and the code say the same
thing. Nothing is released or armed; both branches are pushed for review.

- A NEW ATTEMPT AGAINST AN OPEN CHANNEL IS IGNORED, not settled at bind.
  § Signalling domains said a new offer for a key holding an open channel
  becomes a second channel settled by the duplicate rule. The mesh keeps one
  state per key, so a second channel under one key cannot exist; the build
  drops the new offer (`offer-on-open-ignored`) and lets the open channel's
  own heartbeat free the key. No unauthenticated frame closes an
  authenticated channel.
- THE LEDGER DOES NOT BOUND PROVISIONAL OPEN CHANNELS (Aster `156d2e1d`,
  Vega `ee0796a3`): `enforce` is false by default and the inbound count
  covers pre-open records only, and the negotiation deadline is cleared at
  open. § Capacity's "its bound is the ledger's inbound allowance" is
  replaced in the build by the mesh degree policy's own two bounds:
  `BRIDGE_PROVISIONAL_MAX` (20; the newest provisional above it is retired)
  and `BRIDGE_BIND_DEADLINE_MS` (15 s; an open channel still unbound that
  long is retired). The ledger stays what it is.
- THE GATE IS SPLIT INTO DECISION AND COMMIT. `_admitOrImprove` mutated
  (lane state, insert), so it could not be a preflight (Aster `156d2e1d`).
  The kernel now has `_gateDecision` (pure) and `_gateCommit`;
  `gatePreflight(sponsor)` is public and the bridge's bind policy calls it
  before any retire. The preflight predicts the commit exactly within one
  synchronous tick because both run the same decision code.
- THE BIND POLICY SITS IN THE COMPOSITE. `setBindPolicy(fn)` is consulted
  for a bind that would admit a new route, after step 0 and before any
  kernel handler; never for a switch. The bridge's policy runs: identity
  cooldown → `gatePreflight` → at the mesh cap counting the newcomer:
  budget → dry-run victim → retire one incumbent → pass. A refusal closes
  the newcomer's own channel on the next tick (unbind first, so no death is
  reported) and touches no incumbent.
- THE TRIGGER IS "ABOVE THE TARGET", NOT "AT OR ABOVE" (Vega `ca661612`).
  § Make room said an incumbent is retired when the open channels counting
  the newcomer stand at or above the target. That is off by one: with the
  newcomer counted, a count EQUAL to the target fits the target and nothing
  is retired (49 incumbents + 1 = 50 at cap 50); one above it retires one
  (50 + 1 = 51). The code and the fence (eight incumbents at cap 8 admit
  with no retire; the ninth retires one) say the latter; this note now does.
- A REFUSAL CLOSES BY TOKEN. The refused channel is closed one tick later
  through the transport only if the identity still sits on it; if the
  identity bound elsewhere in that tick, the refused key alone is retired
  and the identity's current channel is untouched (Vega `ca661612`).
- FOUR CODE-REVIEW DEFECTS FIXED BEFORE THE 4.107.0 TAG (Aster `8fb51cdb`
  `3d778257`, Vega `580255ec`): the refusal callback fenced the door KEY,
  which a later attempt can reuse, so it captures the refused channel's
  incarnation and returns when the key no longer holds it; the composite's
  existing-peer REPLAY admitted a new route without the bind policy and now
  runs the same admission as live delivery; a REPEATED death from a
  superseded socket was forwarded once its entry was cleared, and a death
  from a sub-transport that is not the identity's admitted route is now
  swallowed wherever a bootstrap route is involved (a composite with no
  bootstrap sub keeps its earlier forwarding), with the sub-transport's
  route token riding on the death so a same-sub stale death is fenced; the
  door fires a death only for the identity's current connection and keeps
  a newer binding when an older socket closes. `channelIdFor` names the
  admitted route's token, skips superseded sub-transports and recurses into
  a nested composite. Fences J1–J8 (kernel) and H1–H5 (bridge).
- A FIFTH, FOUND DURING THE PROMOTION (Aster `88f4c2f7`, `16e50f0a`),
  closed on a successor to 4.107.0: the compositional token contract was
  missing. In 4.107.0 a composite forwards a child's death WITHOUT a token,
  so a parent's stale-token check never runs for a nested child and every
  nested death is forwarded, stale or not (the behaviour before the route
  rule; nothing is swallowed, no identity is left behind). Forwarding the
  token alone would have been worse: a child's inner switch fires no bind
  upward, the parent's admitted token for the child would stay the inner
  socket's, and the child's real mesh death would read as stale and be
  swallowed. The successor does both halves: a composite announces its
  route changes (`onRouteChanged`), a parent follows the token for a child
  that is its admitted route and announces onward, and a death is forwarded
  with the forwarding level's admitted token, so every level validates the
  same way. Fences J9–J12 (two and three levels, stale and admitted
  deaths). An earlier wording here said "ghost identity, reachable in
  production"; that described the half-fixed state, not the shipped one,
  and is withdrawn.
- THE MESH RETIRE EVICTS THE VICTIM'S IDENTITY SYNCHRONOUSLY, so the
  kernel's own admit-or-improve, running after it for the newcomer, sees a
  table below cap and does not swap a second incumbent. One newcomer costs
  at most one incumbent. The order is fenced.
- A MISSING ATTEMPT ID IS REQUIRED ON DOOR SESSIONS (Aster `156d2e1d` 4).
  `setAttemptPolicy({requireFor})`: on the bridge every own-door key, on the
  client every `c-self-*` key; a frame without an id there is dropped and
  counted, never accepted as legacy.
- `dc.onopen` RE-VALIDATES ITS STATE after the degree pass (Vega `4cd16bde`):
  a channel the pass retired starts no heartbeat and no path poll.
- A SEED BRIDGE'S MESH is a `meshOnly` web transport: no upstream socket, no
  handshake awaited, its only signalling domain the door sink.
- THE DOOR'S OWN DEATH HANDLER bypassed the composite. The bridge registers
  a death handler directly on its WebSocket transport to mark dead peers;
  it marked a born-superseded identity dead on socket close. It now asks
  the composite's route record first. Lesson for the note: every handler a
  bridge registers directly on a sub-transport is outside the route rule.
- A KERNEL PIN WITHOUT THE SURFACES REFUSES with the flag on
  (`assertKernelSurfaces` at `startUplink`), as the arming refuses a bad
  cap. With the flag off a bridge on an older kernel is unchanged.
- THE BORN-SUPERSEDED `return` in the bridge's handshake is not what
  protects the identity; the composite's rule is, and the existing
  synaptome check already skips a second admission. The return saves work.
  Named here because the fence's mutant set showed it.

Fences: kernel `fence_route_token` (44) and `fence_mesh_attempt` (32),
bridge `fence_socket_bootstrap` (51, pin-gated), with thirteen mutants
caught across the three; suite 215/216 on the kernel with the one failure a
pre-existing random setup draw in `smoke_empty_root_pull` that passes on
rerun; the bridge chain green against the new kernel. The verification
section above lists what these fences establish and what only the testnet
measurements can.

## What this document does not establish

- That a bridge whose channels are WebRTC routes or delivers better than
  one whose channels are sockets. Measured after, on the testnet first.
- Why east's uplink dials failed today, or whether they continue to.
- A hard bound on open channels in a burst inside `_degreeInterval`, or on
  concurrent sockets at the door. Both are soft targets today and stay so.
- A per-identity bound on pre-auth work. The ledger bounds the aggregate;
  nothing here bounds one identity's repeated fresh sockets.
- That every request type in the inventory is safe under
  `route-superseded`, or that the inventory of durable obligations is
  complete; the inventory names callers' existing handling and the fence
  records outcomes.
- The load of 50 WebRTC channels plus the door's sockets on a 2 vCPU
  droplet. The make-room rate, the reconnect rate and the provisional
  lifetime. All are measurements.
