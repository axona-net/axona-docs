# The bridge socket is bootstrap: replace it with a WebRTC channel (v0.4)

**Status:** design for council review, revision 4 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.106.0 (`61c759f`) · **Bridge:** 2.151.0
(`79324aa`), armed on all four bridges at cap 50 · **Policy set by:** David,
2026-10-07 · **Author:** axona.bot · **Supersedes:** v0.3 (`57b134f`),
v0.2 (`df75291`), v0.1 (`6e795d1`) · **Builds on:** Bridge fill v0.8
(`9b1ed08`), Mesh connectivity: hold and fill v0.15 (`e4809d2`).

David's direction, 2026-10-07, in full: "Once we establish a websocket
connection to a bridge, we need to replace it with a webrtc connection. The
bridge relay should be the same as a regular relay except that it can
graduate a connected node to make room for a newly introduced node."

**What v0.4 changes.** Aster's third review (`dbbad807`) and Vega's
(`07c5ff8e`, `70324096`) found three transition contracts v0.3 left open,
each confirmed at source. (1) v0.3's ownership rule (b) had no direction: a
newcomer's FIRST socket hello arriving after its channel bound would have
promoted the socket and reversed the switch. v0.4 makes the switch
directional and validates the route token before anything else
(§ Ownership). (2) v0.3 reserved channel capacity at bind, but the mesh
acquires a channel at OPEN and enforces its degree there
(`_enforceDegree`, called from `mesh.js:1186`); that pass could retire a
victim make-room had not chosen. v0.4 withdraws the reservation table: the
two existing enforcement points, the degree pass at open and the admission
gate at bind, are the two ledgers, each atomic at its own event, and the
bridge's make-room is a change to the degree pass's selection, not a third
counter (§ Make room). (3) `onSignal` has no attempt generation; a second
offer, answer or ICE under one key replaces what the key holds
(`mesh.js:881–897`). v0.4 carries a generation in the door key and names
the one residual it cannot close from the door alone (§ Signalling
domains). Also taken: Vega's `50252eaa` bind-path correction (already in
`57b134f`); `onPeerLeft` preserves an OPEN channel (`mesh.js:862–864`), so
a socket close cancels an unbound negotiation and never kills a bound
channel, and the fences say so; a first inventory of the request types a
switch can interrupt (§ Frames in flight).

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
  released in 2.149.0 and 2.151.0; its dials open channels that pass
  through the same degree pass as a newcomer's (§ Make room).
- NOT a change to the client's dialing rule. A client already dials every
  entry in the peer-list it does not hold (`mesh.js:706`), signals through
  its bridge socket (`web/index.js:523`), and honours a 4200 graduation
  once it holds `graduationMeshFloor` mesh peers (3), reconnecting
  otherwise (`index.js:843–846`).
- NOT free of client change. One kernel change rides a kernel release and
  every client runs it: the composite's route-token rule and
  identity-scoped death (§ Ownership). A client without it is never
  offered the bridge's reserved id (§ Mixed versions).
- NOT a second channel to a peer in steady state. The socket is superseded
  the instant the channel binds, and a superseded route is never routable
  again.
- NOT a bigger door. `BRIDGE_MAX_PEERS` (15) stays the door's graduation
  target with hysteresis (`server.js:585`, slack 2). The hard bound on
  concurrent sockets is not established by this design.
- NOT a new retire selector. `selectMeshRetire` and `selectGraduate` stay.
- NOT a third capacity counter. The degree pass at open and the admission
  gate at bind are the two that exist; v0.3's reservation table is
  withdrawn.
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
   `mesh.onSignal` (`index.js:661`), and the mesh keys the negotiation by
   that string (`mesh.js:881–897`); a later offer, answer or ICE under the
   same key acts on whatever the key holds. When the data channel opens the
   mesh runs `_enforceDegree` (`mesh.js:1186`): above cap plus slack it
   retires one open channel chosen by `selectMeshRetire` (duties protected,
   one per interval, cooldown map). The authenticated `hello` over the data
   channel binds the node id to the channel's key (`meshAuth.onHello`,
   `index.js:1111` → `webrtc.bindPeer(nodeId, meshId, channelKey)`,
   `index.js:1090`, `webrtc.js:212` → `onPeerBound`); the mesh entry stays
   under its signalling key with the node id beside it. A bridgeless
   (relayed) negotiation uses `deliverMeshSignal(fromHex, payload)`
   (`index.js:1261`), keyed by the sender's NODE hex (`AxonaPeer.js:5660`,
   `:1180`) from the first signal.
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
   `peer-left` from a bridge, by contrast, never closes a peer's OPEN
   channel (`mesh.js:841–868`).
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
2. ANSWER AT THE DOOR, IN A DOMAIN OF ITS OWN, ONE GENERATION AT A TIME. A
   `signal` frame whose `to` is the current reserved id is neither relayed
   nor dropped: the door hands it to the bridge node's own mesh under the
   key `d<doorEpoch>:<connId>:<gen>`, where `gen` is bumped by the door on
   every `sdp-offer` that socket sends to the reserved id (§ Signalling
   domains). Answers and candidates for that key go back over that one
   socket. No node id is used, trusted or needed before the channel's
   handshake.
3. BIND ON THE CHANNEL. The authenticated `hello` over the data channel
   binds the node id beside the door key through the door-dialled path
   named above. The composite's route-token rule (§ Ownership) decides
   what that bind does to a socket route the same identity holds, and the
   admission gate decides identity capacity at that bind as it does today.
4. RETIRE THE SOCKET. Once the newcomer's channel to the bridge is bound
   AND the newcomer's last `meshBound` report is fresh (20 s) and at least
   `GRADUATION_SAFE_FLOOR` (4), the door closes the socket with 4200. A
   newcomer whose report is stale, absent or below the floor keeps its
   socket until the report qualifies or today's graduation takes it; a
   client below its own floor at a 4200 reconnects, a fresh bootstrap
   bounded by the door, and that rate is a measurement.
5. MAKE ROOM, AT OPEN. When a newcomer's channel to the bridge opens above
   the mesh cap, the degree pass that already runs at that instant selects
   its victim with the newcomer EXCLUDED, under the bridge's cooldown and
   rate budget; if no eligible victim exists the pass retires the
   newcomer's own channel instead, which is a relay's refusal. This is the
   one way a bridge differs from a relay: a relay at cap keeps its old
   channels and the newcomer loses; a bridge at cap keeps the newcomer and
   an old channel loses, because introducing newcomers is the bridge's job.

After these, a bridge's population is mesh channels, bounded by
`BRIDGE_MESH_MAX_PEERS`, filled by the fill of 2.149.0 and by every newcomer
at its door, and graduated by keyspace balance when a newcomer needs the
room. The socket population is the newcomers still bootstrapping, held to
the door's target by graduation; whether sockets are short-lived is
measured.

What it does to the afternoon's finding: east's mesh grows by one channel
per newcomer it introduces, with no relay through west involved. East's
dials through its uplink have failed at every reading today; whether they
go on failing after this change is not known, and the relay question
(option A of the 19:23Z record) stays open on its own.

## Signalling domains (BS2-R, Aster `dbbad807` §3, Vega)

The bridge's one mesh receives negotiations from three sources:

| Source | Key today | Key under this design |
|---|---|---|
| Upstream door (uplink socket, `index.js:661`) | `c<n>` minted by the UPSTREAM door | unchanged |
| Relayed (bridgeless) ingress `deliverMeshSignal` | 66-hex node id | unchanged |
| Own door (new) | none | `d<doorEpoch>:<connId>:<gen>` |

A node hex may begin with `c`; what keeps the three forms apart is the
66-character length and the colons only the door key carries.

- EPOCH. `doorEpoch` scopes the reserved id and every door key to one door
  process. A door restart changes it; a reconnecting client is offered the
  new reserved id and dials it as a new peer; its entry for the old id ends
  by the mesh's own rules (negotiation timeout if unbound, `pc-closed` if
  bound). No claim about counter reuse is made or needed.
- GENERATION. `onSignal` has no attempt generation of its own. The door
  supplies one: `gen` for a socket starts at 1 and is bumped on each
  `sdp-offer` that socket sends to the reserved id. An answer or ICE from
  that socket is delivered under the CURRENT gen key. On a bump the door
  calls `mesh.onPeerLeft` on the previous gen key, which cancels an unbound
  negotiation and leaves an OPEN channel alone (`mesh.js:862–864`); an open
  previous-gen channel plus a new offer is then a same-identity second
  channel, settled by the sub's duplicate rule at bind (§ Ownership (c)).
- ORDERING. A WebSocket delivers one socket's frames in order, so every
  frame the client sent before offer B arrives before B and is attributed
  to A's key; every frame sent after B is B's. The RESIDUAL is a client
  continuation of attempt A that fires after the client itself moved to B
  (an async candidate callback resuming after a reset) and so arrives after
  B's offer. The door cannot distinguish it. Its fate is a fence, not a
  claim: the fence feeds a stale candidate from A after B's offer and
  records whether B's peer connection rejects it or is mutated. If it is
  mutated, the generation must travel inside the signal payload, which is a
  kernel change to mesh signalling and is named here as the fallback.
- SINK. One dispatching `setSignalRelay` routes by key form: a door key to
  the door, which strips the prefix, checks the connection id is open and
  the gen is current, and writes the frame with `from` = the current
  reserved id; a `c<n>` key to the uplink socket; a 66-hex key to the
  relayed path. A frame for a closed socket or a stale gen is dropped and
  counted.
- CANCELLATION. A door socket's close calls `onPeerLeft` on its current gen
  key: unbound negotiation cancelled, bound channel untouched. Nothing in
  the other two domains is touched.
- AGGREGATE BOUND. One live negotiation to the reserved id per socket (the
  gen rule), so unbound door-side negotiations number at most the open
  sockets, which the door's target and slack hold near 17; a cooled-down
  identity that reconnects under a fresh connection id spends one
  negotiation and is refused at bind (§ Make room), so repeats are one per
  `cooldownMs` per identity after it is known.

## Ownership: one identity, one admitted route, one direction (BS1-R, Aster §1, Vega `07c5ff8e`)

Each sub-transport reports its own peer's death and the composite hands
every one to the kernel (`composite.js:353–355`); the first sub in order
owns a disputed identity (`composite.js:206–214`). R8-2 rejects a bind only
when the attempt guard refused it and an attempt is live
(`AxonaPeer.js:641–658`). The rule, in the composite, before the guard and
before any side effect:

- A ROUTE is (sub, token): the door's token is its connection id within
  its `doorEpoch`; the mesh's token is its channel key with generation.
  Each sub keeps the CURRENT token per identity it holds. The composite
  keeps, per identity, the ADMITTED route and the set of SUPERSEDED routes;
  the record outlives the admitted route until every superseded route has
  closed.
- STEP 0, TOKEN VALIDATION, before (a)–(d): a bind whose (sub, token) is
  not that sub's current token for the identity, or is in the identity's
  superseded set, is ignored and logged. This runs even when the identity
  has no admitted route, so a retired token cannot re-admit after identity
  death, and it is independent of R8-2.
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
- (c) Same sub, different token → step 0 has already ignored a non-current
  token; a bind on the sub's current token while an older channel of the
  same sub is still open is the sub's existing duplicate case (row 7's
  reconcile), cited not changed.
- (d) A bind from a superseded route is caught by step 0.
- IDENTITY-SCOPED DEATH. A death from a superseded route unbinds that route
  in its sub and fires nothing into the kernel. A death from the admitted
  route fires into the kernel as today and the identity dies; its
  superseded sockets are closed by the door with 4200 (the client, which
  lost the channel, reconnects or not by its own floor). A superseded route
  is NEVER re-promoted. A socket is admitted, or superseded and bound for
  closure; never retained and unusable.
- BOTH ENDS. On the client, when the mesh binds the bridge's node id, the
  bridge sub's ownership of that identity (`index.js:78`) is superseded by
  (b), the 4200 close fires no death for it, and kernel frames to the
  bridge ride the channel.

## Frames in flight at the switch (BS3/5-R, Aster §"durable duties")

Per class, the allowed outcomes at the linearization point:

| Frame | Outcome |
|---|---|
| Request issued on the socket, replied before the switch | resolved once, as today |
| Request issued on the socket, pending at the switch | rejected `route-superseded` at the switch; a reply arriving later on the socket is dropped and logged; never resolved twice |
| Request issued after the switch | on the channel; the kernel's usual timeout and failure rules |
| Notification pending on the socket at the switch | may be lost (defined loss) |
| Notification issued after the switch | on the channel; fire-and-forget as today |

What a rejected request can interrupt. The kernel's peer-to-peer request
types at `61c759f`, from the `send`/`request`/`routeMessage` call sites
under `src/dht`, `src/pubsub` and the handshake (counts are call sites):

| Type | Sites | What its caller does on failure today |
|---|---|---|
| `lookup_step`, `find_closest_set`, `local_probe`, `lookahead_probe` | 1, 1, 1, 2 | idempotent reads; the lookup's own iteration re-issues to the next candidate |
| `route_msg` | 3 | the carrier for routed delivery; `_relayMeshSignal` retries once (`AxonaPeer.js:5661–5666`); pub/sub publish retries byte-identical under content dedup (`msgId = sha256(publisher, message)`), so a repeat is at-least-once with dedup, never a duplicate message |
| `mesh:signal` | 1 | carried by `route_msg`; a lost signal fails the negotiation, which the mesh's timeout ends |
| `axona:direct`, `__tunneled_direct__` | 1, 1 | application direct messages; semantics are the application's |

This is an inventory of types and their callers' existing failure
handling, not a proof that each caller is safe under `route-superseded`;
the implementation fence for § Ownership runs each type across the switch
and records the outcome against this table. No durable duty (topic role,
replication, repair) is discharged by a request's success or failure: those
are re-driven by the kernel's reconcile loops, which this design does not
change and does not depend on beyond their existing behaviour. No
exactly-once claim is made anywhere.

## Make room: the two counters that exist (BS4-R, Aster §2, Vega)

v0.3's reservation table is withdrawn. Two enforcement points exist and
each is atomic at its own event:

- CHANNEL capacity is acquired at OPEN. `_enforceDegree` runs when the data
  channel opens (`mesh.js:1186`, body `:755–800`): above `_degreeMax +
  _degreeSlack` it selects one open channel with `selectMeshRetire` (duties
  protected via one obligation read per pass, cooldown map, one retire per
  interval) and retires it. The newly opened channel is already in `open`;
  nothing is debited twice. On a bridge with the flag, the SAME pass is the
  make-room: (i) the channel that just opened is EXCLUDED from the
  candidates, (ii) candidates in the bridge's identity cooldown are
  excluded, (iii) the pass is refused when the sliding 60 s retire budget is
  spent, and (iv) if (i)–(iii) leave no eligible victim, the pass retires
  the NEWLY OPENED channel, which is what a relay's refusal looks like from
  the newcomer. Hysteresis is unchanged: the mesh may stand above cap by at
  most the slack between a victim's retire and its close, as it does today;
  no reservation authorises more.
- IDENTITY capacity is acquired at BIND. The admission gate decides at the
  bind with its existing admit-or-improve rule (`_admitOrImprove`,
  `AxonaPeer.js:2537`): at cap a newcomer is admitted only by displacing a
  worse-placed peer, else refused as on a relay. `needsIdentity` is not a
  stored flag: if the newcomer's socket hello landed first, the identity is
  already admitted and the channel bind is a route replacement under
  § Ownership (b), consuming nothing; if not, the gate decides now. The
  bridge adds no identity-funded retire; v0.3's was withdrawn because the
  gate already holds that decision and holds it atomically.
- WHAT CAN GO WRONG BETWEEN THE TWO. A channel that opened (debited) and
  never binds is reaped by the mesh's negotiation timeout or vitality, as
  today. A victim retired at open whose close has not run leaves the mesh
  above cap within slack, as today. A fill dial that opens during that
  window passes the same degree pass and is itself a candidate for
  exclusion (it is the newly opened one) or refusal (budget). Nothing waits
  on a promise: the two decisions are made at their own events with the
  state at that instant.
- COOLDOWN, TWO SCOPES. Per-connection: the retired channel's connection id
  is refused a new negotiation to the reserved id for `cooldownMs` (the
  door's `graduatedRecently` pattern). Per-identity: the victim's node id
  goes into the bridge node's `recentlyRetired` set for `cooldownMs`,
  consulted by the admission gate at bind; a reconnect under a fresh
  connection id spends one negotiation and is refused at bind. That one
  negotiation is the pre-auth cost.
- RATE. `BRIDGE_MAKE_ROOM_PER_MIN` (proposed 4, no measurement behind it) is
  a sliding window over the last 60 s of retire timestamps.
- PROTECTION HOLDS. `selectMeshRetire`'s protections (duties, a region's
  last representative) are unchanged and apply to the make-room pass; a
  protected set yields no victim and (iv) applies.

## What the bridge knows when it closes the socket (BS-5)

Its own channel to the newcomer is bound, and the newcomer's last
`meshBound` heartbeat report with its age (`server.js:435–448`). The close
waits for a fresh qualifying report. A client that never reports is not
closed on this rule and falls to today's graduation. The remaining cost is
a client whose mesh drops between its report and the close, the case the
safe floor was set for; the measure is reconnects per newcomer on the
testnet.

## Mixed versions, legacy clients, seed bridges, rollback

- A client whose kernel lacks § Ownership would evict the bridge from its
  synaptome on the 4200 close. The door already gates graduation on client
  version (`server.js:427–434`); the same gate, raised to the kernel that
  carries § Ownership, decides whether a client is offered the reserved id.
- A client that does not honour 4200 (the 4.84.0 identity-less cohort on
  east) is never offered the reserved id and is graduated as today.
- A seed bridge with no upstream (B1) gets a mesh with no upstream socket:
  `startUplink` returning null (`uplink.js:62`) is replaced by a mesh whose
  only sink domain is the door.
- The flag is read at start. Turning it off and restarting drops every
  channel and socket, as any restart does today; there is no live flip.

## What has to change, and where

Kernel, one release:

- `composite.js`: step 0 token validation, directional (b), born-superseded
  socket routes, identity-scoped death, the dispatching signal sink.
- `mesh.js`: `_enforceDegree` takes an injected policy `{exclude, extraCooldown,
  budgetOk, refuseNewcomer}` that a bridge supplies and nothing else does;
  default behaviour byte-identical.

Bridge, one release, behind `BRIDGE_SOCKET_IS_BOOTSTRAP` (default off):

- `server.js`: `doorEpoch`; per-socket `gen`; the reserved id first in
  `peer-list` for eligible clients; a `signal` with `to` = the reserved id
  delivered to `bridgeNode.deliverDoorSignal(connId, gen, payload)` with the
  gen bump and previous-gen cancellation on `sdp-offer`; the door-domain
  sink; close with 4200 on "channel bound for this connection id" AND a
  fresh qualifying `meshBound`; the sliding rate window.
- `ws_transport.js`: SUPERSEDED on a binding, including at birth;
  `handleConnClosed` fires no death for it; pending requests rejected
  `route-superseded` at supersede time; hello over a superseded binding
  acknowledged without admission.
- `bridge_axona_node.js`: `deliverDoorSignal` → `mesh.onSignal(doorKey,
  payload)`; the degree-pass policy; `recentlyRetired` consulted by the
  admission gate; `fillStatus` extended with door-side negotiation, retire,
  refusal and reconnect counters.
- `uplink.js`: the mesh exists without an upstream.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Position of the reserved id in `peer-list` | first | Every listed id is dialled at once (`mesh.js:706`); first costs nothing and gets the bridge's channel earliest. |
| When the socket closes | channel bound AND a fresh (20 s) `meshBound` ≥ `GRADUATION_SAFE_FLOOR` (4) | The existing vitality constants; a high reconnect rate on the testnet says raise the floor or shorten the TTL. |
| Make-room rate | `BRIDGE_MAKE_ROOM_PER_MIN` 4, sliding 60 s | No measurement behind it; the testnet arrival rate sets it. |
| Retire cooldown, both scopes | the mesh's existing `cooldownMs` | Shorter thrashes, longer starves a region's only route; measured. |
| Client eligibility | kernel ≥ the release carrying § Ownership | Below it the client evicts the bridge on 4200. |
| `BRIDGE_MAX_PEERS` | 15, unchanged, a graduation target with slack 2 | The hard bound on sockets is not established here. |

## Rollout

1. Kernel release with § Ownership, the degree-pass policy hook and the
   dispatching sink, fenced; no behaviour change on any client until a
   bridge offers a reserved id.
2. Bridge release with the flag, default off.
3. Testnet B1 and B2 with the flag on. Measure: socket lifetime, channels
   per newcomer, reconnects per newcomer, retires per minute, refusals by
   cause (no victim, budget, cooldown), stale-gen drops, pre-auth
   negotiations by cooled-down identities, fill state.
4. West, on David's word, one hour of measurements at ten minutes.
5. East, on David's word. The measure is east's open mesh channels, which
   have read zero all day.

## Verification

Fences, each run with the fix deleted to show the fence sees it. A passing
mutant set says the fence detects those mutants and nothing else; the
safety rules are checked by adversarial transition fences, and live
measurements inform liveness, not safety.

- OWNERSHIP, every order: channel bind then FIRST socket hello (socket born
  superseded, nothing re-admitted, socket stays open until rule 4); hello
  then bind (switch at (b)); channel dies before the socket closes
  (identity dies, socket closed 4200, no re-promotion); a retired token's
  bind after identity death (ignored by step 0); a same-sub bind on a
  non-current token with no live dial guard (ignored by step 0, not by
  R8-2); one synaptome entry per identity throughout; frame outcomes per
  the table; no peer-died from a superseded route; the client's composite
  routes to the channel after the close.
- SIGNALLING DOMAINS: a local `c1` and an upstream `c1` in one mesh; door
  restart with surviving client state; delayed answer or ICE after socket
  close dropped under its key; a second offer on one open socket bumps the
  gen, cancels the unbound previous gen and leaves an OPEN previous-gen
  channel alone; a stale candidate from gen A arriving after gen B's offer
  (outcome recorded; a mutation of B triggers the payload-generation
  fallback); a forged `from` ignored.
- MAKE ROOM AT OPEN: newcomer channel opens above cap → one victim, newcomer
  excluded; full identity cap with the socket hello already admitted →
  route replacement, gate not consulted, no retire on the identity side;
  full identity cap without a prior hello → the gate's admit-or-improve
  decides, cited outcome; protected set → the newcomer's own channel is
  retired (refusal); budget spent → refusal; identity in cooldown
  reconnecting under a fresh connection id → one negotiation, refused at
  bind; a fill dial opening during a victim's close window → passes the
  same pass; channel debit counted exactly once in every state;
  window-boundary bursts cannot exceed the sliding budget.
- SEED WITHOUT UPSTREAM: a bridge with no reachable upstream constructs a
  mesh, accepts a newcomer's channel and reports it on `meshDegree`.
- MIXED VERSIONS: a client below the eligibility gate receives today's
  peer-list; a client that does not honour 4200 is graduated as today.
- FLAG OFF: door behaviour byte-identical to 2.151.0; `_enforceDegree`
  with no policy byte-identical to 4.106.0.

## What this document does not establish

- That a bridge whose channels are WebRTC routes or delivers better than
  one whose channels are sockets. Measured after, on the testnet first.
- Why east's uplink dials failed today, or whether they continue to.
- The fate of a late attempt-A candidate after attempt-B's offer; a fence
  decides, and the payload-generation fallback is named.
- That every request type in the inventory is safe under
  `route-superseded`; the inventory names callers' existing handling and
  the fence records outcomes.
- The load of 50 WebRTC channels plus the door's sockets on a 2 vCPU
  droplet. The hard bound on concurrent sockets at the door.
- The make-room rate, the reconnect rate, and the pre-auth negotiation
  cost of cooled-down identities. All are measurements.
