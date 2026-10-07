# The bridge socket is bootstrap: replace it with a WebRTC channel (v0.1)

**Status:** design for council review, revision 1 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.106.0 (`61c759f`) · **Bridge:** 2.151.0
(`79324aa`), armed on all four bridges at cap 50 · **Policy set by:** David,
2026-10-07 · **Author:** axona.bot · **Builds on:** Bridge fill v0.8
(axona-docs `9b1ed08`) and Mesh connectivity: hold and fill v0.15
(`e4809d2`).

David's direction, 2026-10-07, in full: "Once we establish a websocket
connection to a bridge, we need to replace it with a webrtc connection. The
bridge relay should be the same as a regular relay except that it can
graduate a connected node to make room for a newly introduced node."

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
forwards only to a peer that holds a socket on it (`server.js`, the
`connections.has(to)` check), which on west is east alone. East has read
zero open mesh channels at every reading of the day. Its door, meanwhile,
holds seventeen sockets, five of them bound identities that its node admits
over the socket and would never dial. A bridge whose own population reaches
it only over sockets has a mesh of nobody.

## What this is not

- NOT a change to the fill. Rule 2 runs on the bridge's peer as released in
  2.149.0 and 2.151.0; what changes is what the bridge's channels are made
  of.
- NOT a change to the client's kernel or its dialing rule. A client already
  dials every identity in the peer-list it does not hold (`mesh.js:706`),
  signals through its bridge socket (`web/index.js:523`), and honours a
  4200 graduation once it holds `graduationMeshFloor` mesh peers (3). The
  design uses those three as they are.
- NOT a second channel to a peer. The socket goes away once the channel
  exists; while both exist the socket is the one being retired.
- NOT a bigger door. `BRIDGE_MAX_PEERS` (15) stays the bound on concurrent
  sockets; it becomes a bound on concurrent BOOTSTRAPS, since no socket is
  meant to outlive its newcomer's first channels.
- NOT a new retire policy. `selectMeshRetire` (keyspace balance, then age,
  duties protected) and `selectGraduate` (keyspace balance, then vitality)
  stay; what changes is when a retire is asked for.
- NOT arming. The flags and caps of 2.151.0 are untouched.

## What a bridge does today, in the order a newcomer sees it

1. The newcomer opens a WebSocket. The door admits it (version gate),
   sends `welcome` with TURN credentials, and a `peer-list` of up to
   `anchorK` admitted identities chosen by `selectAnchors`
   (`server.js:1219`, sent at `1249`). The bridge's own node id is NOT in
   that list.
2. The newcomer's mesh dials every listed identity (`mesh.js:706`). Each
   offer travels as a `signal` frame over the socket; the door relays it to
   the target's socket if the target has one (`server.js`, the
   `connections.has(to)` check) and drops it otherwise.
3. The authenticated hello over the socket binds the newcomer's identity;
   `_completeHandshake` admits it into the bridge node's synaptome AS A
   SOCKET PEER (`bridge_axona_node.js:629`). The bridge node now routes
   kernel frames to it over the socket.
4. When the door holds more admitted sockets than `BRIDGE_MAX_PEERS` plus
   the graduation slack (`server.js:585`), `maybeGraduate` closes one
   admitted socket with code 4200, choosing by keyspace balance and
   vitality. The client keeps its mesh and does not reconnect if it holds
   three mesh peers; otherwise it reconnects. The bridge node loses that
   peer entirely: its channel was the socket.
5. The bridge node's own mesh channels come from one place: peers that dial
   it through the other bridge's relay, or that the bridge dials through its
   uplink. East has none. West has 11 to 20.

So a bridge is a relay for everyone else and a node for nobody at its own
door.

## The rule

A bridge is a relay. Its socket is the way in and nothing more:

1. INTRODUCE ITSELF. The peer-list a newcomer receives carries the bridge's
   own node id first, then the anchors. The newcomer's mesh dials the
   bridge exactly as it dials any listed identity (`mesh.js:706`), signalling
   over the socket it already holds.
2. ANSWER AT THE DOOR. A `signal` frame whose `to` is the bridge's own id
   is not relayed and not dropped: the door hands it to the bridge node's
   mesh as terminal ingress (`deliverMeshSignal(fromHex, payload)`, the same
   entry a relayed signal uses). The bridge node's answer and candidates
   for a door peer travel back over that peer's socket: the door is
   registered as the mesh's outbound signal sink for door peers
   (`setSignalRelay`), ahead of the uplink socket, which stays the sink for
   everyone else.
3. BIND ON THE CHANNEL. The axona/4 handshake runs over the new data
   channel as on any mesh channel; the bridge node binds the identity there
   and the kernel admits it through the same path a relay uses. The socket
   peer and the channel peer are one identity; the composite routes to the
   channel.
4. RETIRE THE SOCKET. Once the newcomer's channel to the bridge is bound and
   the newcomer holds `graduationMeshFloor` mesh peers (the bridge counts
   itself), the door closes the socket with 4200. The newcomer keeps its
   mesh, which now includes the bridge. A newcomer that never binds a
   channel to the bridge within the nursery ceiling is graduated as today
   when the door is full, and reconnects if it is not meshed.
5. MAKE ROOM. When a newcomer's channel is ready to bind and the bridge node
   holds `BRIDGE_MESH_MAX_PEERS` channels, the bridge retires one channel
   first, chosen by `selectMeshRetire` (most over-represented region, oldest,
   never a region's last representative, never a duty), so the newcomer is
   admitted. This is the one way a bridge differs from a relay: a relay at
   cap refuses the newcomer; a bridge at cap graduates an old channel to
   admit it, because introducing newcomers is the bridge's job. The retired
   peer is in the mesh already and loses one channel; the anti-thrash
   cooldown (`_inRetireCooldown`) stops it dialling the bridge straight back.

After these, a bridge's population is mesh channels, bounded by
`BRIDGE_MESH_MAX_PEERS`, filled by the fill of 2.149.0 and by every newcomer
at its door, and graduated by keyspace balance when a newcomer needs the
room. The socket population is the newcomers still bootstrapping, bounded by
`BRIDGE_MAX_PEERS` and short-lived.

What it does to the afternoon's finding: east's mesh grows by one channel
per newcomer it introduces, with no relay through west involved. The fill's
dials through the uplink stay as they are and keep failing until the relay
question is settled separately (option A of the 19:23Z record), but the
bridge no longer depends on them for its first channels.

## Two things the code has to settle, named now

ONE IDENTITY, TWO CHANNELS, FOR A MOMENT. While the socket is open and the
channel is binding, the client's composite owns the bridge's id on its
bridge sub-transport and will shortly own it on its WebRTC sub-transport
too; `_routeFor` picks the first sub-transport that owns the peer, and the
bridge sub-transport is added first. Kernel frames to the bridge keep
riding the socket until it closes, then the channel. The bridge side has
the same overlap between `ws_transport` and the uplink mesh. The design
wants: no frame lost at the switch, no double admission, and the socket
closed by the bridge only after the channel is bound. The fence for this is
the first one below.

TWO ID SPACES AT THE DOOR. The door's relayed `signal` frames address by
connection id (`from: id`, `to`), while mesh signalling and `peer-list`
carry 66-hex node ids; `connNodeHex` and the binding maps translate. A
signal to the bridge's own node id arrives before the sender has bound (the
newcomer dials from the peer-list before its hello completes), so the door
must accept a signal from an unbound socket addressed to itself and attach
the sender's identity when the bind lands, or the mesh must bind on the
channel's own handshake and ignore the socket's. The second is what a
relayed dial does today and is the proposed answer; the fence is the second
below.

## What has to change, and where

Bridge, one release:

- `server.js`: the bridge's node id first in `peer-list`; a `signal` with
  `to` = own id delivered to `bridgeNode.deliverDoorSignal(connId,
  payload)`; graduation also triggered by a bound channel to the bridge
  (rule 4), and a make-room retire before a newcomer's bind at cap (rule 5).
- `bridge_axona_node.js`: `deliverDoorSignal` → the uplink mesh's
  `deliverMeshSignal` with the sender's node id; the uplink mesh's
  `setSignalRelay` set to "a door peer's socket if the target holds one,
  else the uplink socket"; the make-room call into the mesh's retire with
  the newcomer named.
- `uplink.js`: the uplink `webTransport` is the bridge node's mesh whether
  or not an uplink exists; a root bridge with no upstream (B1 today) still
  needs a mesh — today `startUplink` returns null and the composite has no
  dialer and no mesh. A seed bridge gets a mesh with no upstream socket.

Kernel: `mesh.js` grows one entry, "retire to make room for `peerId`",
which runs `selectMeshRetire` once with the newcomer excluded and returns
whether room was made; the composite forwards it. Nothing in the client.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Position of the bridge's id in `peer-list` | first | A newcomer dials in list order and `maxPerTick`-like pacing on the client side does not exist for the peer-list: every listed id is dialled at once (`mesh.js:706`). First costs nothing and gets the bridge's channel earliest. |
| When the socket closes | channel bound AND `graduationMeshFloor` (3) met, the bridge counted | A client with the bridge as its only mesh peer would be cut off at 1; the floor stays the client's existing 3. |
| Make-room at cap | one `selectMeshRetire` per newcomer bind, newcomer excluded | A burst of newcomers at cap retires one old channel each; the door cap (15) bounds the burst. Whether 15 retires in a minute is acceptable is measured on the testnet. |
| `BRIDGE_MAX_PEERS` | 15, unchanged, now a bootstrap bound | If sockets outlive their bootstraps the bound binds the door again; the fence watches socket lifetime. |

## Rollout

1. Bridge release with the behaviour behind one flag, `BRIDGE_SOCKET_IS_BOOTSTRAP`, default off: with it off every bridge is 2.151.0.
2. Testnet B1 and B2 with the flag on. B1 is a seed with no uplink: it gets a mesh without an upstream (the `uplink.js` change) and B2 is its first channel. Measure: socket lifetimes, channels per newcomer, retires per minute, fill state on both.
3. West, on David's word, one hour of measurements at ten minutes.
4. East, on David's word. East is where the finding lives; the measure is east's open mesh channels, which have read zero all day.

## Verification

Fences, each with the fix deleted to prove the fence sees it:

- The switch: an emulated newcomer binds over the socket, dials the bridge
  from the peer-list, binds over the channel; the bridge node holds ONE
  synaptome entry for the identity throughout; kernel frames sent during
  the overlap arrive once each; the socket is closed by the bridge with
  4200 only after the channel bound; the client's composite routes to the
  channel after the close.
- Two id spaces: a `signal` to the bridge's own id from a socket that has
  not yet bound is delivered to the mesh and answered over that socket; the
  identity is bound by the channel's handshake; the socket's later hello
  does not re-admit.
- Make room: a bridge at `BRIDGE_MESH_MAX_PEERS` receives a newcomer's bind;
  one channel is retired by the selector (most over-represented region,
  never a last representative, never a duty), the newcomer is admitted, the
  retired peer is in cooldown and does not re-dial for `cooldownMs`; at cap
  with every channel protected or a last representative nothing is retired
  and the newcomer is refused as a relay refuses.
- Seed without upstream: a bridge with no reachable upstream still
  constructs a mesh, accepts a newcomer's channel and reports it on
  `meshDegree`.
- Flag off: byte-identical door behaviour to 2.151.0 (peer-list without
  self, relay drops a signal to self, graduation as today).

## What this document does not establish

- That a bridge whose channels are WebRTC routes or delivers better than
  one whose channels are sockets. Measured after, on the testnet first.
- The fate of the fill's dials through the uplink to the other bridge's
  mesh peers. That is the relay question (option A of the 19:23Z record)
  and it stays open; this design removes the bridge's dependence on it for
  its own population, no more.
- The load of 50 WebRTC channels plus 15 sockets on a 2 vCPU droplet. The
  testnet step measures it.
- Whether a burst of newcomers at cap retires too fast. The make-room rate
  is a measurement, not a parameter chosen here.
