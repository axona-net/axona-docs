# The bridge socket is bootstrap: replace it with a WebRTC channel (v0.2)

**Status:** design for council review, revision 2 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.106.0 (`61c759f`) · **Bridge:** 2.151.0
(`79324aa`), armed on all four bridges at cap 50 · **Policy set by:** David,
2026-10-07 · **Author:** axona.bot · **Supersedes:** v0.1 (`6e795d1`) ·
**Builds on:** Bridge fill v0.8 (`9b1ed08`), Mesh connectivity: hold and
fill v0.15 (`e4809d2`).

David's direction, 2026-10-07, in full: "Once we establish a websocket
connection to a bridge, we need to replace it with a webrtc connection. The
bridge relay should be the same as a regular relay except that it can
graduate a connected node to make room for a newly introduced node."

**What v0.2 changes.** Aster (`2c386b31`, BS-1 to BS-5) and Vega
(`f6a71ef1`, `2b16970f`) read v0.1 against the source and found two
mechanisms that v0.1 got wrong and three that it left open. Wrong: the
socket's close kills the identity even when a channel is bound, because the
door's `handleConnClosed` fires peer-died with the bound node id and the
composite forwards every sub's death straight to the kernel
(`ws_transport.js:327–340`, `composite.js:353–355`); and a door signal
carries no node id before the hello, so "deliver it to the mesh keyed by
the sender's node id" names an id that does not exist yet. Open: what a
frame in flight on the socket is owed at the switch; how a reserved slot
and its victim are tied to one attempt; and what the bridge knows about the
newcomer's mesh when it closes the socket. Each is answered below in its
own section, and the v0.1 claim "nothing in the client changes" is
withdrawn: the composite's death forwarding is kernel code and the client
runs it.

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

- NOT a change to the fill. Rule 2 runs on the bridge's peer as released in
  2.149.0 and 2.151.0; what changes is what the bridge's channels are made
  of.
- NOT a change to the client's dialing rule. A client already dials every
  entry in the peer-list it does not hold (`mesh.js:706`), signals through
  its bridge socket (`web/index.js:523`), and honours a 4200 graduation
  once it holds `graduationMeshFloor` mesh peers (3), reconnecting
  otherwise (`index.js:843–846`). The design uses those as they are.
- NOT free of client change. One kernel change rides a kernel release and
  every client runs it: the composite forwards a sub-transport's death to
  the kernel only when no other sub-transport still owns the identity
  (§ Ownership). Until that kernel is on a client, the design is off for
  that client (§ Mixed versions).
- NOT a second channel to a peer in steady state. The socket goes away once
  the channel exists; while both exist the socket is the one being
  retired, and the moment of the switch is defined (§ Ownership).
- NOT a bigger door. `BRIDGE_MAX_PEERS` (15) stays the door's graduation
  target. It is a target with hysteresis, not a hard cap: graduation runs
  only above cap plus slack (`server.js:585`, slack 2), which is how east
  holds seventeen. The hard bound on concurrent sockets is not established
  by this design and is named as such.
- NOT a new retire policy. `selectMeshRetire` (keyspace balance, then age,
  duties protected) and `selectGraduate` (keyspace balance, then vitality)
  stay; what changes is when a retire is asked for and how its vacancy is
  accounted (§ Make room).
- NOT arming. The flags and caps of 2.151.0 are untouched.
- NOT exactly-once delivery across the switch. § Frames in flight says
  what is owed and what is permitted to be lost.

## What a bridge does today, in the order a newcomer sees it

1. The newcomer opens a WebSocket. The door gives the socket a connection
   id, `c` plus a counter that only rises within one process
   (`server.js:1114`), admits it (version gate), sends `welcome` with TURN
   credentials, and a `peer-list` of up to `anchorK` admitted CONNECTION
   IDS chosen by `selectAnchors` (`server.js:1216–1249`). Peer-list
   entries are connection ids, not node ids. The bridge's own id, in either
   space, is NOT in that list.
2. The newcomer's mesh dials every listed id (`mesh.js:706`). Each offer
   travels as a `signal` frame over the socket with `to` = the listed
   connection id; the door relays it to that socket if it exists and drops
   it otherwise (`server.js:1459–1465`), rewriting `from` as the sender's
   connection id (`server.js:1469`). Both ends of a mesh negotiation key
   their state by the OTHER END'S CONNECTION ID (`mesh.js:881–886`). Node
   ids are learned later, by the axona/4 handshake over the data channel.
   This is how every mesh channel in the network is made today.
3. The authenticated hello over the socket binds the newcomer's node id to
   its connection id; `_completeHandshake` admits it into the bridge node's
   synaptome AS A SOCKET PEER (`bridge_axona_node.js:629`). The bridge node
   now routes kernel frames to it over the socket.
4. When the door holds more admitted sockets than `BRIDGE_MAX_PEERS` plus
   slack, `maybeGraduate` closes one admitted socket with code 4200,
   choosing by keyspace balance and vitality, and only for clients whose
   version honours 4200 (`server.js:427–431`). The client keeps its mesh
   and does not reconnect if it holds three mesh peers; otherwise it
   reconnects. The bridge node loses that peer entirely: the door's
   `handleConnClosed` fires peer-died with the bound node id
   (`ws_transport.js:327–340`) and the kernel takes the identity out of the
   synaptome.
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
   first, then the anchors. The reserved id is of the door's form but can
   never be allocated to a socket (the counter yields `c<n>`; the reserved
   id is `c-self`, which no counter produces). The newcomer's mesh dials it
   exactly as it dials any listed connection id (`mesh.js:706`).
2. ANSWER AT THE DOOR, KEYED AS TODAY. A `signal` frame whose `to` is the
   reserved id is neither relayed nor dropped: the door hands it to the
   bridge node's own mesh keyed by the SENDER'S CONNECTION ID, which is the
   id the relayed path already supplies to every receiver
   (`deliverMeshSignal(fromId, payload)`, `index.js:1261`; the parameter's
   doc comment says node id, the relayed path passes connection ids, and
   the comment is corrected in the same change). The bridge node's answer
   and candidates for that negotiation go back over that one socket: the
   door is the mesh's outbound signal sink for door-side negotiations
   (`setSignalRelay`, `index.js:1252`), the uplink socket stays the sink
   for everyone else. No node id is used, trusted or needed before the
   channel's handshake. A negotiation is bounded as the kernel bounds every
   mesh negotiation today (its negotiation timeout), and it is cancelled
   when its socket closes.
3. BIND ON THE CHANNEL. The axona/4 handshake runs over the new data
   channel as on any mesh channel; the kernel binds the node id there
   through the same path a relay uses. If that node id is already admitted
   over a socket (the hello landed first), the socket binding is marked
   SUPERSEDED at that instant (§ Ownership). If the hello lands after, it
   finds the identity admitted on the channel and does not re-admit; the
   socket binding is created already superseded.
4. RETIRE THE SOCKET. Once the newcomer's channel to the bridge is bound
   AND the newcomer's last heartbeat report of its mesh size (`meshBound`,
   kernel ≥ 4.38, `server.js:435–448`) is fresh (within
   `GRADUATION_VITALITY_TTL_MS`, 20 s) and at least
   `GRADUATION_SAFE_FLOOR` (4, one above the client's floor of 3), the door
   closes the socket with 4200. That is the evidence today's vitality
   graduation already uses; the bridge's own channel counts toward the
   report because the client's mesh holds it. A newcomer whose report is
   stale or absent, or below the safe floor, keeps its socket until the
   report qualifies or until today's graduation (uptime ceiling, door over
   target) takes it; a client below its own floor at a 4200 reconnects
   (`index.js:843–846`), a fresh bootstrap bounded by the door, and the
   rate of those reconnects is a measurement of the rollout.
5. MAKE ROOM. When a newcomer's channel is ready to bind and the bridge node
   holds `BRIDGE_MESH_MAX_PEERS` channels, the bridge reserves one slot for
   that attempt and retires one channel to fund it, chosen by
   `selectMeshRetire` with the newcomer excluded (§ Make room). This is the
   one way a bridge differs from a relay: a relay at cap refuses the
   newcomer; a bridge at cap graduates an old channel to admit it, because
   introducing newcomers is the bridge's job.

After these, a bridge's population is mesh channels, bounded by
`BRIDGE_MESH_MAX_PEERS`, filled by the fill of 2.149.0 and by every newcomer
at its door, and graduated by keyspace balance when a newcomer needs the
room. The socket population is the newcomers still bootstrapping, held to
the door's target by graduation and meant to be short-lived; whether they
are is measured.

What it does to the afternoon's finding: east's mesh grows by one channel
per newcomer it introduces, with no relay through west involved. The fill's
dials through the uplink stay as they are and keep failing until the relay
question is settled separately (option A of the 19:23Z record), but the
bridge no longer depends on them for its first channels.

## Ownership: one identity, one admitted route (BS-1, Vega `2b16970f`)

Today an identity can be owned by two sub-transports of one composite and
the composite picks the first in order (`composite.js:206–214`); the
client adds its bridge sub first (`index.js:700`), the bridge adds its door
first (`bridge_axona_node.js:171`). Each sub reports its own peer's death
and the composite hands every one to the kernel (`composite.js:353–355`).
The bridge door reports death with the bound node id and rejects that
peer's pending requests when the socket closes (`ws_transport.js:327–340`).
So in v0.1's rule 4 the 4200 close would have evicted the identity the
channel had just admitted, on both ends. The rule:

- A ROUTE is (sub-transport, channel token). The door's token is the
  connection id; the mesh's token is its channel incarnation. An identity
  has at most one ADMITTED route; any other route it holds is SUPERSEDED.
- THE LINEARIZATION POINT is the kernel's bind of the node id on the
  channel. Before it, the socket route is admitted and frames go there.
  At it, the socket route becomes superseded and the composite routes
  frames to the channel: `_routeFor` skips a sub whose ownership of the
  identity is superseded (a sub exposes `ownsPeer(nodeId)` → false once
  superseded; the door does this itself, the client's bridge sub does the
  same for the bridge's identity when the mesh binds it). After it, the
  socket's close is a route close, not an identity death.
- IDENTITY-SCOPED DEATH. The composite forwards a sub's peer-died to the
  kernel only when, after that sub has released the identity, `_routeFor`
  finds no sub that still owns it. A death from a superseded route is
  logged and swallowed. This is the one kernel change; it is in the
  composite, so the client and the bridge get it from the same release.
- LATE EVENTS ARE IMMUNE. A hello arriving over a superseded socket is
  acknowledged and does not admit (rule 3). A close of a superseded socket
  unbinds the connection id and fires nothing into the kernel. A stale
  channel incarnation is already rejected by R8-2 (`AxonaPeer.js:641–658`).
  Connection ids within one process never repeat (`server.js:1114`), so a
  delayed answer cannot meet a newer socket with the same id; across a
  bridge restart every socket is gone, so nothing delayed survives to be
  misdelivered.
- BOTH ENDS. On the client the same composite rule applies: when the mesh
  binds the bridge's node id, the bridge sub's ownership of that id is
  superseded, the 4200 close of the socket fires no death for it, and
  kernel frames to the bridge ride the channel. The client's bridge sub
  today owns exactly the bridge identity (`index.js:78`), so this is one
  flag on one sub.

## Frames in flight at the switch (BS-3)

What the contract owes, and no more:

- A request issued on the socket route before the linearization point and
  still pending at supersede time is REJECTED at that instant with a named
  error (`route-superseded`), before the socket closes. The kernel's
  existing handling of a failed request applies: a request that failed
  without a reply is retried or abandoned by the caller's own rule, with
  the message ids the caller already uses. No new retry layer, no
  exactly-once claim. A request whose side effect landed on the far side
  before the reply was lost is the same case as a reply lost on any
  channel today.
- A notification in flight on the socket at supersede time may be lost.
  That is DEFINED LOSS, the same loss a notification suffers on any closing
  channel, and nothing in the kernel treats a notification as durable.
- A frame issued after the linearization point rides the channel. Nothing
  is issued on a superseded route.
- Fence: a request pending on the socket at the switch is rejected with
  the named error and never resolved twice; a reply arriving on the socket
  after supersede is dropped and logged; a delayed reply does not resolve
  a request re-issued on the channel.

## Make room: a reservation, one victim, one attempt (BS-4)

- A newcomer's bind at cap creates a RESERVATION tied to that attempt's
  channel token. Pending reservations are counted separately from admitted
  identities: the test for "at cap" is `admitted + reservations ≥ cap`.
- The reservation selects ONE victim with `selectMeshRetire`, the newcomer
  excluded, and REVALIDATES the victim at retire time (still present, not a
  duty, not a region's last representative); if revalidation fails, the
  selector runs once more over the remaining set, and if no victim is
  eligible the reservation is dropped and the newcomer is refused as a
  relay refuses. A victim is retired at most once per reservation, a
  reservation retires at most one victim.
- A CLOSE IS NOT CAPACITY. The victim's slot counts as freed only when the
  kernel's peer-died for it has run; until then the reservation holds the
  newcomer's place and no other attempt can spend it. If the newcomer's
  attempt fails after the victim is gone, the reservation is released and
  the vacancy stays for the next arrival; no second retire is made for it.
- Concurrent newcomers each hold their own reservation and their own
  victim; the selector is run under the reservation set so two attempts
  cannot pick the same victim.
- COOLDOWN IS LOCAL TO WHO RETIRED. The retired peer sees a channel close,
  not a retire; it may dial the bridge again on its next peer-list. The
  BRIDGE keeps the anti-thrash mark: a connection id it retired within
  `cooldownMs` is refused a new negotiation to the reserved id for that
  long (the door already keeps `graduatedRecently` for sockets; this is the
  same map for channels). Nothing is inferred about the far side's state.
- RATE. The door's target does not bound retires per minute. Proposed for
  David: at most `BRIDGE_MAKE_ROOM_PER_MIN` retires per minute per bridge,
  default 4; above it a newcomer at cap is refused as a relay refuses, and
  the refusal is counted. Four is a proposal with no measurement behind
  it; the testnet step measures the arrival rate it has to cover.

## What the bridge knows when it closes the socket (BS-5)

Two things, and it acts on both. Its own channel to the newcomer is bound:
that is its own state. The newcomer's mesh size: the client reports
`meshBound` on every heartbeat (kernel ≥ 4.38), and the door already keeps
that report per socket with a freshness TTL of 20 s and a safe floor of 4
for vitality graduation (`server.js:435–448`). v0.1 said "the client meets
its floor" without saying how the bridge would know; the answer was in the
door the whole time. The close waits for a fresh qualifying report. A
client that never reports (older kernel, or not yet pinged) is not closed
on this rule and falls to today's graduation, as the vitality path already
falls back. The remaining cost is a client whose mesh drops between its
report and the close, which is the case the safe floor of one above the
client floor was set for; the measure is reconnects per newcomer on the
testnet.

## Mixed versions, legacy clients, seed bridges, rollback (BS-5)

- A client whose kernel lacks the composite change of § Ownership would
  evict the bridge from its synaptome on the 4200 close. The door already
  gates graduation on client version (`server.js:427–431`); the same gate,
  raised to the kernel that carries § Ownership, decides whether a client
  is offered the reserved id at all. An older client gets today's
  peer-list and today's behaviour.
- A client that does not honour 4200 (the 4.84.0 identity-less cohort on
  east) is never offered the reserved id and is graduated as today.
- A seed bridge with no upstream (B1) gets a mesh with no upstream socket:
  `startUplink` returning null (`uplink.js:62`) is replaced by a mesh whose
  relay sink is the door alone. Its channels are its newcomers.
- The flag is read at start. Turning it off and restarting drops every
  channel and socket, as any restart does today; there is no live flip,
  and a live flip is not proposed.

## What has to change, and where

Kernel, one release:

- `composite.js`: superseded ownership honoured by `_routeFor`;
  identity-scoped death forwarding; `deliverMeshSignal` doc comment names
  the connection id. Fence first.
- `mesh.js`: one entry, "retire to make room for token T", running
  `selectMeshRetire` once with T's peer excluded and returning whether a
  victim was retired; reservation accounting lives in the bridge.

Bridge, one release, behind `BRIDGE_SOCKET_IS_BOOTSTRAP` (default off):

- `server.js`: the reserved id first in `peer-list` for eligible clients;
  a `signal` with `to` = reserved id delivered to
  `bridgeNode.deliverDoorSignal(connId, payload)`; close with 4200 on the
  bridge node's "channel bound for this connection id" event; the
  make-room reservation table and rate counter.
- `ws_transport.js`: a SUPERSEDED state on a binding (`ownsPeer` false,
  `handleConnClosed` fires no death, pending requests rejected
  `route-superseded` at supersede time); hello over a superseded binding
  acknowledged without admission.
- `bridge_axona_node.js`: `deliverDoorSignal` → the mesh's
  `deliverMeshSignal(connId, payload)`; the mesh's `setSignalRelay` set to
  "the sender's socket for door-side negotiations, else the uplink
  socket"; on channel bind of an identity the door holds, supersede the
  socket binding and emit the event the door closes on.
- `uplink.js`: the mesh exists without an upstream.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Position of the reserved id in `peer-list` | first | Every listed id is dialled at once (`mesh.js:706`); first costs nothing and gets the bridge's channel earliest. |
| When the socket closes | channel bound AND a fresh (20 s) `meshBound` report ≥ `GRADUATION_SAFE_FLOOR` (4) | The existing vitality constants; a high reconnect rate on the testnet says raise the safe floor or shorten the TTL. |
| Make-room rate | `BRIDGE_MAKE_ROOM_PER_MIN` 4 | No measurement behind it; the testnet arrival rate sets it. |
| Retire cooldown on the bridge | `cooldownMs` as the mesh's existing retire cooldown | Shorter thrashes, longer starves a region's only route; measured. |
| Client eligibility | kernel ≥ the release carrying § Ownership | Below it the client evicts the bridge on 4200. |
| `BRIDGE_MAX_PEERS` | 15, unchanged, a graduation target with slack 2 | The hard bound on sockets is not established here. |

## Rollout

1. Kernel release with § Ownership and the mesh entry, fenced; no
   behaviour change on any client until a bridge offers the reserved id.
2. Bridge release with the flag, default off: with it off every bridge is
   2.151.0 at the door.
3. Testnet B1 and B2 with the flag on. B1 is a seed with no uplink and
   B2 its first channel. Measure: socket lifetime, channels per newcomer,
   reconnects per newcomer, retires per minute, refusals, fill state.
4. West, on David's word, one hour of measurements at ten minutes.
5. East, on David's word. East is where the finding lives; the measure is
   east's open mesh channels, which have read zero all day.

## Verification

Fences, each run with the fix deleted to show the fence sees it. A passing
mutant set says the fence detects those mutants; it does not say the
mechanism is correct for cases the fence does not pose, and the live
measurements of the rollout are the second half of verification.

- THE SWITCH, in every order: hello before channel bind, channel bind
  before hello, close during bind. One synaptome entry for the identity
  throughout; frames sent during the overlap arrive once each; pending
  socket requests rejected `route-superseded` once; the socket closed by
  the bridge with 4200 only after the channel bound; no peer-died reaches
  the kernel for a superseded route; the client's composite routes to the
  channel after the close.
- THE DOOR'S ID SPACE: a `signal` to the reserved id from a socket that
  has not bound is delivered to the mesh keyed by its connection id and
  answered over that socket; a forged `from` in the frame is ignored
  (the door supplies the sender); a signal for a negotiation whose socket
  closed is dropped; a reused connection id cannot occur within a process
  (asserted on the generator).
- MAKE ROOM: at cap, one reservation, one victim, revalidated; two
  concurrent newcomers retire two distinct victims; a protected set
  refuses the newcomer with no retire; a newcomer failing after the retire
  releases the reservation and no second retire follows; a retired
  connection id is refused the reserved id for `cooldownMs`; the per-minute
  budget refuses and counts above it.
- SEED WITHOUT UPSTREAM: a bridge with no reachable upstream constructs a
  mesh, accepts a newcomer's channel and reports it on `meshDegree`.
- MIXED VERSIONS: a client below the eligibility gate receives today's
  peer-list and is never offered the reserved id; a client that does not
  honour 4200 is graduated as today.
- FLAG OFF: door behaviour byte-identical to 2.151.0 (peer-list without
  the reserved id, relay drops a signal to it, graduation as today).

## What this document does not establish

- That a bridge whose channels are WebRTC routes or delivers better than
  one whose channels are sockets. Measured after, on the testnet first.
- The fate of the fill's dials through the uplink to the other bridge's
  mesh peers. That is the relay question (option A of the 19:23Z record)
  and it stays open.
- The load of 50 WebRTC channels plus the door's sockets on a 2 vCPU
  droplet. The testnet step measures it.
- The hard bound on concurrent sockets at the door.
- The make-room rate and the reconnect rate. Both are measurements.
