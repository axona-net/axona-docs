# The bridge socket is bootstrap: replace it with a WebRTC channel (v0.3)

**Status:** design for council review, revision 3 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.106.0 (`61c759f`) · **Bridge:** 2.151.0
(`79324aa`), armed on all four bridges at cap 50 · **Policy set by:** David,
2026-10-07 · **Author:** axona.bot · **Supersedes:** v0.2 (`df75291`),
v0.1 (`6e795d1`) · **Builds on:** Bridge fill v0.8 (`9b1ed08`), Mesh
connectivity: hold and fill v0.15 (`e4809d2`).

David's direction, 2026-10-07, in full: "Once we establish a websocket
connection to a bridge, we need to replace it with a webrtc connection. The
bridge relay should be the same as a regular relay except that it can
graduate a connected node to make room for a newly introduced node."

**What v0.3 changes.** Aster's second review (`99c03319`, `a2bf3b83`) and
Vega's (`16022c2a`, `1d33c47e`) found four more places where v0.2 named a
mechanism the source does not have. (1) v0.2 said the relayed ingress
`deliverMeshSignal` already carries connection ids; it carries a node id
(`AxonaPeer.js:5660` builds `from` as the node's hex, `:1180` passes it).
The door path is the one that carries connection ids (`server.js:1469`
into `index.js:661`). Withdrawn and replaced (§ Signalling domains).
(2) The bridge's mesh would receive signals from two doors, its own and
its upstream's, and both doors mint `c<n>`; the mesh keys negotiations by
`from` alone (`mesh.js:881–897`), so a local `c1` and an upstream `c1` are
one key. v0.2 gave the door's ids no domain. Fixed (§ Signalling domains).
(3) v0.2 leaned on R8-2 as a stale-route fence; R8-2 rejects a bind only
when the guard refused it AND an attempt to that identity is live
(`AxonaPeer.js:655–658`); with no live attempt the bind admits. A route
token rule independent of the guard replaces it (§ Ownership). (4) v0.2's
make-room reserved "a slot" without saying which resource, and the fill's
own availability counter was not on the ledger. Two resources, one ledger,
the fill on it (§ Make room). The verification line "frames sent during the
overlap arrive once each" contradicted the in-flight contract and is
replaced by per-class outcomes (§ Frames in flight). East's uplink dials
"keep failing" is restated as what was read, not what will happen.

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
  released in 2.149.0 and 2.151.0. The fill's availability counter is put
  on the make-room ledger (§ Make room); its decisions are unchanged.
- NOT a change to the client's dialing rule. A client already dials every
  entry in the peer-list it does not hold (`mesh.js:706`), signals through
  its bridge socket (`web/index.js:523`), and honours a 4200 graduation
  once it holds `graduationMeshFloor` mesh peers (3), reconnecting
  otherwise (`index.js:843–846`). The design uses those as they are.
- NOT free of client change. One kernel change rides a kernel release and
  every client runs it: the composite's route-token rule and
  identity-scoped death (§ Ownership). A client without it is never
  offered the bridge's reserved id (§ Mixed versions).
- NOT a second channel to a peer in steady state. The socket goes away once
  the channel exists; while both exist the socket is superseded, and a
  superseded route is never routable again (§ Ownership).
- NOT a bigger door. `BRIDGE_MAX_PEERS` (15) stays the door's graduation
  target, with hysteresis: graduation runs only above cap plus slack
  (`server.js:585`, slack 2), which is how east holds seventeen. The hard
  bound on concurrent sockets is not established by this design.
- NOT a new retire policy. `selectMeshRetire` and `selectGraduate` stay;
  what changes is when a retire is asked for and how its vacancy is
  accounted.
- NOT arming. The flags and caps of 2.151.0 are untouched.
- NOT a delivery proof. § Frames in flight says what each class of frame
  is owed at the switch and what is permitted to be lost; durable duties
  are discharged by the kernel's own reconcile loops, which this design
  does not touch.

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
   that string (`mesh.js:881–897`). Node ids are learned later, by the
   axona/4 handshake over the data channel, and the mesh entry is NOT
   renamed: the signalling key and the node id live side by side for the
   life of the channel. This is how every door-side mesh channel is made.
   A bridgeless (relayed) negotiation uses a different ingress,
   `deliverMeshSignal(fromHex, payload)` (`index.js:1261`), whose key is
   the sender's NODE hex (`AxonaPeer.js:5660`, `:1180`). So one mesh
   already holds keys from two id spaces; they cannot collide because a
   node hex is 66 characters and a connection id starts with `c`.
3. The authenticated hello over the socket binds the newcomer's node id to
   its connection id; `_completeHandshake` admits it into the bridge node's
   synaptome AS A SOCKET PEER (`bridge_axona_node.js:629`).
4. When the door holds more admitted sockets than target plus slack,
   `maybeGraduate` closes one admitted socket with code 4200, choosing by
   keyspace balance and vitality (`meshBound` reported on the heartbeat,
   kernel ≥ 4.38, TTL 20 s, safe floor 4, `server.js:435–448`), and only
   for clients whose version honours 4200 (`server.js:427–434`). The
   bridge node loses that peer entirely: the door's `handleConnClosed`
   fires peer-died with the bound node id (`ws_transport.js:327–340`), the
   composite forwards every sub's death to the kernel
   (`composite.js:353–355`), and the kernel evicts the identity.
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
   first, then the anchors. The reserved id is `c-self-<doorEpoch>`, where
   `doorEpoch` is minted once per door process start; the counter yields
   `c<n>` and can never produce it. The newcomer's mesh dials it exactly as
   it dials any listed connection id (`mesh.js:706`).
2. ANSWER AT THE DOOR, IN A DOMAIN OF ITS OWN. A `signal` frame whose `to`
   is the current reserved id is neither relayed nor dropped: the door hands
   it to the bridge node's own mesh under the key
   `d<doorEpoch>:<connId>` (§ Signalling domains). The answer and
   candidates for that key go back over that one socket. No node id is
   used, trusted or needed before the channel's handshake. The negotiation
   is bounded by the mesh's own negotiation timeout and is cancelled when
   its socket closes.
3. BIND ON THE CHANNEL. The authenticated `hello` runs over the new data
   channel and binds the node id to the channel's key through the path
   every door-dialled channel takes today: `meshAuth.onHello` →
   `webrtc.bindPeer(nodeId, meshId, channelKey)` → `onPeerBound`
   (`index.js:1111`, `:1090`, `webrtc.js:212`). The mesh entry stays
   under its door key `d<doorEpoch>:<connId>`; the node id is bound
   beside it, as a client's door-dialled channels carry a connection id
   beside a node id today. This is NOT the relayed path, whose mesh entry
   is the node id from the first signal (correction after Vega
   `50252eaa`). The composite's route-token rule (§ Ownership) decides
   what that bind does to a socket route the same identity already holds.
4. RETIRE THE SOCKET. Once the newcomer's channel to the bridge is bound
   AND the newcomer's last `meshBound` report is fresh (within
   `GRADUATION_VITALITY_TTL_MS`, 20 s) and at least `GRADUATION_SAFE_FLOOR`
   (4), the door closes the socket with 4200. That is the evidence today's
   vitality graduation already uses; the bridge's own channel counts toward
   the report because the client's mesh holds it. A newcomer whose report
   is stale, absent or below the safe floor keeps its socket until the
   report qualifies or until today's graduation takes it; a client below
   its own floor at a 4200 reconnects (`index.js:843–846`), a fresh
   bootstrap bounded by the door, and the rate of those reconnects is a
   measurement of the rollout.
5. MAKE ROOM. When a newcomer's channel is ready to bind and the resource
   it needs is at cap, the bridge reserves that resource for that attempt
   and retires one channel to fund it, chosen by `selectMeshRetire` with
   the newcomer excluded (§ Make room). This is the one way a bridge
   differs from a relay: a relay at cap refuses the newcomer; a bridge at
   cap graduates an old channel to admit it, because introducing newcomers
   is the bridge's job.

After these, a bridge's population is mesh channels, bounded by
`BRIDGE_MESH_MAX_PEERS`, filled by the fill of 2.149.0 and by every newcomer
at its door, and graduated by keyspace balance when a newcomer needs the
room. The socket population is the newcomers still bootstrapping, held to
the door's target by graduation and meant to be short-lived; whether they
are is measured.

What it does to the afternoon's finding: east's mesh grows by one channel
per newcomer it introduces, with no relay through west involved. East's
dials through its uplink have failed at every reading today; whether they
go on failing after this change is not known, and the relay question
(option A of the 19:23Z record) stays open on its own.

## Signalling domains (BS2-R, Vega `16022c2a` `1d33c47e`)

The bridge's one mesh will receive negotiations from three places and must
key them so no two can alias:

| Source | Key today | Key under this design |
|---|---|---|
| Upstream door (uplink socket, `index.js:661`) | `c<n>` minted by the UPSTREAM door | unchanged: `c<n>` |
| Relayed (bridgeless) ingress `deliverMeshSignal` | 66-hex node id | unchanged |
| Own door (new) | none | `d<doorEpoch>:<connId>` |

- `doorEpoch` is minted once per door process start (a short random
  string). It scopes both the reserved id the door advertises and the keys
  the door writes into its mesh, so a key from one bridge session can never
  equal a key from another, and a door key can never equal an upstream
  `c<n>` or a node hex.
- OUTBOUND SINK. The bridge node's mesh gets one `setSignalRelay` sink that
  dispatches on the key's form: a `d<doorEpoch>:` key goes to the door,
  which strips the prefix, checks the connection id is still open, and
  writes the frame to that socket with `from` = the current reserved id; a
  `c<n>` key goes to the uplink socket as today; a 66-hex key goes to the
  kernel's relayed path as today. A frame for a closed connection id is
  dropped and counted.
- CANCELLATION. A door socket's close cancels every negotiation under its
  key (`mesh.onPeerLeft(key)`) and touches nothing in the other two
  domains. A door process restart changes `doorEpoch`; a client that
  reconnects is offered the new reserved id, dials it as a new peer, and
  its entry for the old reserved id ends by the mesh's own rules
  (negotiation timeout if it never bound, `pc-closed` if it had). No
  claim is made about counter reuse: the domain prefix makes reuse
  irrelevant.
- The client side keys the bridge by the reserved id it was given, as it
  keys any peer-list entry. Nothing in the client changes for this.

## Ownership: one identity, one admitted route (BS1-R, Vega `2b16970f`)

Each sub-transport of a composite reports its own peer's death and the
composite hands every one to the kernel (`composite.js:353–355`); the first
sub in order owns a disputed identity (`composite.js:206–214`). The door
fires death with the bound node id on socket close
(`ws_transport.js:327–340`). So without a rule, closing the socket after
the channel binds evicts the identity on both ends. R8-2 is not that rule:
it rejects a bind only when the attempt guard refused it and an attempt to
the identity is still live (`AxonaPeer.js:641–658`); a bind with no live
attempt is admitted. The rule, in the composite, before the guard and
before any side effect:

- A ROUTE is (sub-transport, token). The door's token is its connection id
  (within its own `doorEpoch`); the mesh's token is its channel
  incarnation. The composite keeps, per identity, the ADMITTED route and
  nothing else about other routes except that they are SUPERSEDED.
- ROUTE-TOKEN VALIDATION runs on every bind event before ownership,
  `boundPeers`, admission or any callback: (a) no admitted route → this
  route is admitted, the bind proceeds to the guard and the kernel as
  today; (b) an admitted route on a DIFFERENT sub → the new route is
  admitted, the old route is marked superseded in its sub (the sub's
  `ownsPeer(id)` answers false for it from this instant), the bind proceeds
  to the kernel as a route change with NO re-admission (the kernel's
  synaptome entry is kept, its transport binding is repointed); (c) an
  admitted route on the SAME sub with a different token → the sub's own
  duplicate rule applies as today (R8-2 and row 7's reconcile); (d) a bind
  from a route already marked superseded → ignored before anything, logged.
  The linearization point of a switch is (b).
- IDENTITY-SCOPED DEATH. A death event from a superseded route unbinds that
  route in its sub and fires nothing into the kernel. A death event from the
  admitted route fires into the kernel as today: the identity dies. A
  superseded route is NEVER re-promoted: the socket is bootstrap only, and
  when the admitted channel dies while the superseded socket is still open
  the identity dies with it and the door closes that socket with 4200 (the
  client, which lost the channel, reconnects or not by its own floor). So
  a socket is never both retained and unusable: it is admitted, or it is
  superseded and about to close.
- LATE EVENTS. A hello arriving over a superseded socket is acknowledged
  and admits nothing. A close of a superseded socket unbinds its connection
  id and fires nothing. A delayed answer or ICE for a key whose socket has
  closed is dropped by the domain rule above.
- BOTH ENDS. On the client the same composite rule applies: when the mesh
  binds the bridge's node id, the bridge sub's ownership of that identity
  (`index.js:78`) is superseded by (b), the 4200 close fires no death for
  it, and kernel frames to the bridge ride the channel.

## Frames in flight at the switch (BS3/5-R)

Per class, the allowed outcomes at linearization point (b):

| Frame | Outcome |
|---|---|
| Request issued on the socket, replied before (b) | resolved once, as today |
| Request issued on the socket, pending at (b) | rejected `route-superseded` at (b); a reply arriving later on the socket is dropped and logged; never resolved twice |
| Request issued after (b) | issued on the channel; the kernel's usual timeout and failure rules |
| Notification pending on the socket at (b) | may be lost (defined loss) |
| Notification issued after (b) | on the channel; fire-and-forget as today |

Neither a rejected request nor a superseded route discharges a durable
duty. Topic roles, replication and repair are re-driven by the kernel's
own reconcile loops (role reconcile, repair plane, hold-and-fill's
`_reconcileBound`), which this design does not change and does not rely on
beyond their existing behaviour: a request they issued that was rejected
at (b) is to them a failed request, handled as any failed request is.
No exactly-once claim is made anywhere in this design.

## Make room: two resources, one ledger (BS4-R, Aster `a2bf3b83`, Vega `1d33c47e`)

Two capped resources exist today and are counted separately:

- IDENTITY slots: the kernel's synaptome, cap `node._maxSynaptome` (50 on
  an armed bridge); the fill reads `_fillAvailability = cap − synaptome.size
  − inflight` and the admission gate refuses binds beyond cap.
- CHANNEL slots: the mesh's degree cap `_degreeMax` (`mesh.js:293`, from
  `BRIDGE_MESH_MAX_PEERS` through `meshDegreeFor`), enforced after a channel
  opens by retiring the pick (`mesh.js:795`).

A newcomer's bind needs: one CHANNEL slot always; one IDENTITY slot only if
the identity is not already admitted (the hello has not landed). A newcomer
already admitted over its socket is a ROUTE REPLACEMENT: it consumes no
identity slot and must never retire an unrelated peer on the identity cap.

- ONE LEDGER. The bridge node keeps a reservation table keyed by the
  attempt's channel token: `{needsIdentity, needsChannel}`. The fill's
  `inflight` term and the mesh's degree check both read the ledger:
  reserved identity slots count as inflight for the fill, reserved channel
  slots count as open for the degree cap. So the fill and a newcomer cannot
  both spend one vacancy, and a fill dial that lands while a reservation
  holds the last slot is refused by the gate as any over-cap bind is.
- RESERVE, THEN RETIRE. At a newcomer's bind: compute needs; if a needed
  resource is at cap, select ONE victim with `selectMeshRetire` (newcomer
  excluded, duties and last representatives protected), revalidate it at
  retire time, and retire its channel. The victim's CHANNEL slot is released
  when the mesh's own channel-closed for it runs (`_retire`, `pc-closed`);
  its IDENTITY slot is released only if the composite then fires identity
  death for it, which it does when the channel was its admitted route and
  no other route is admitted. A victim whose admitted route is a socket
  (a bootstrapping newcomer that happens to also hold a channel) releases a
  channel slot and no identity slot; the selector excludes such peers from
  identity-funded retires, so an identity-funded retire always frees an
  identity.
- CONVERSION. The reservation converts to admission at the newcomer's bind
  (b) or (a); it is released, with no second retire, if the attempt fails
  after the victim is gone, and the vacancy stays for the next arrival.
- CONCURRENCY. Each attempt holds its own reservation and victim; the
  selector runs under the reservation set so two attempts cannot pick one
  victim; a protected set yields no victim and the newcomer is refused as a
  relay refuses.
- COOLDOWN, TWO SCOPES. Per-connection: the retired connection id is
  refused a new negotiation to the reserved id for `cooldownMs`; this
  blocks only that socket. Per-identity: the victim's node id goes into the
  bridge node's `recentlyRetired` set for `cooldownMs`, consulted by the
  admission gate at bind: a bind from that identity within the window is
  refused. A victim that reconnects under a fresh connection id therefore
  spends one negotiation (bounded by the negotiation timeout) and is
  refused at bind; that one negotiation is the pre-auth cost and is named
  as such. Nothing is inferred about the far side's state.
- RATE. `BRIDGE_MAKE_ROOM_PER_MIN` (proposed 4, no measurement behind it) is
  a sliding window over the last 60 s of retire timestamps, not a fixed
  window, so a burst at a window boundary cannot double it; above it a
  newcomer at cap is refused as a relay refuses and the refusal is counted.

## What the bridge knows when it closes the socket (BS-5)

Two things, and it acts on both. Its own channel to the newcomer is bound:
its own state. The newcomer's mesh size: the client reports `meshBound` on
every heartbeat (kernel ≥ 4.38) and the door keeps that report per socket
with a 20 s TTL and a safe floor of 4 (`server.js:435–448`). The close
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
  An older client gets today's peer-list and today's behaviour.
- A client that does not honour 4200 (the 4.84.0 identity-less cohort on
  east) is never offered the reserved id and is graduated as today.
- A seed bridge with no upstream (B1) gets a mesh with no upstream socket:
  `startUplink` returning null (`uplink.js:62`) is replaced by a mesh whose
  only sink domain is the door. Its channels are its newcomers.
- The flag is read at start. Turning it off and restarting drops every
  channel and socket, as any restart does today; there is no live flip.

## What has to change, and where

Kernel, one release:

- `composite.js`: the route-token rule and identity-scoped death
  (§ Ownership); the composite's `setSignalRelay` sink may be a dispatcher.
- `mesh.js`: one entry, "retire to make room for key K", running
  `selectMeshRetire` once with K's peer excluded and returning the victim's
  key or null; the degree check reads an injected reservation count.

Bridge, one release, behind `BRIDGE_SOCKET_IS_BOOTSTRAP` (default off):

- `server.js`: `doorEpoch`; the reserved id first in `peer-list` for
  eligible clients; a `signal` with `to` = the reserved id delivered to
  `bridgeNode.deliverDoorSignal(connId, payload)`; the door-domain
  outbound sink; close with 4200 on "channel bound for this connection id"
  AND a fresh qualifying `meshBound`; the reservation table and the rate
  window.
- `ws_transport.js`: SUPERSEDED on a binding (`ownsPeer` false,
  `handleConnClosed` fires no death, pending requests rejected
  `route-superseded` at supersede time); hello over a superseded binding
  acknowledged without admission.
- `bridge_axona_node.js`: `deliverDoorSignal` → `mesh.onSignal(
  'd<doorEpoch>:' + connId, payload)`; the dispatching sink; the
  reservation ledger wired into the fill's inflight and the mesh's degree
  check; `recentlyRetired` consulted by the admission gate.
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

1. Kernel release with § Ownership and the mesh entry, fenced; no
   behaviour change on any client until a bridge offers a reserved id.
2. Bridge release with the flag, default off: with it off every bridge is
   2.151.0 at the door.
3. Testnet B1 and B2 with the flag on. B1 is a seed with no uplink and B2
   its first channel. Measure: socket lifetime, channels per newcomer,
   reconnects per newcomer, retires per minute, refusals by cause, fill
   state, pre-auth negotiations spent by cooled-down identities.
4. West, on David's word, one hour of measurements at ten minutes.
5. East, on David's word. The measure is east's open mesh channels, which
   have read zero all day.

## Verification

Fences, each run with the fix deleted to show the fence sees it. A passing
mutant set says the fence detects those mutants and nothing else; the
safety rules above are checked by adversarial transition fences, and the
live measurements of the rollout inform liveness, not safety.

- THE SWITCH, every order: hello before channel bind; channel bind before
  hello; new channel dies before the socket closes (identity dies, socket
  closed 4200, no re-promotion); late hello on a superseded socket; a bind
  from a superseded route with no live dial guard (ignored by the route
  rule, not by R8-2). One synaptome entry per identity throughout; frame
  outcomes exactly per the table in § Frames in flight; no peer-died
  reaches the kernel from a superseded route; the client's composite routes
  to the channel after the close.
- SIGNALLING DOMAINS: a local `c1` and an upstream `c1` negotiate in one
  mesh without touching each other; a door restart (new `doorEpoch`) with a
  client holding state for the old reserved id ends the old entry by the
  mesh's rules and binds the new one; a delayed answer or ICE after the
  socket closed is dropped under its key and disturbs no other domain; a
  forged `from` in a door frame is ignored (the door supplies the key).
- MAKE ROOM: full identity cap, newcomer already admitted over its socket →
  route replacement, NO retire; full channel cap, same case → one
  channel-funded retire, victim's identity untouched if it holds another
  admitted route; victim with an alternate admitted route releases a
  channel slot and no identity slot; a fill dial racing a reserved vacancy
  is refused by the gate; two concurrent newcomers → two distinct victims;
  protected set → refusal, no retire; attempt fails after the retire →
  reservation released, no second retire; reconnect under a fresh
  connection id → one negotiation, refused at bind for `cooldownMs`;
  bursts at a 60 s boundary cannot exceed the sliding budget.
- SEED WITHOUT UPSTREAM: a bridge with no reachable upstream constructs a
  mesh, accepts a newcomer's channel and reports it on `meshDegree`.
- MIXED VERSIONS: a client below the eligibility gate receives today's
  peer-list; a client that does not honour 4200 is graduated as today.
- FLAG OFF: door behaviour byte-identical to 2.151.0.

## What this document does not establish

- That a bridge whose channels are WebRTC routes or delivers better than
  one whose channels are sockets. Measured after, on the testnet first.
- Why east's uplink dials failed today, or whether they continue to. The
  relay question (option A of the 19:23Z record) stays open on its own.
- The load of 50 WebRTC channels plus the door's sockets on a 2 vCPU
  droplet. The testnet step measures it.
- The hard bound on concurrent sockets at the door.
- The make-room rate, the reconnect rate, and the pre-auth negotiation
  cost of cooled-down identities. All are measurements.
