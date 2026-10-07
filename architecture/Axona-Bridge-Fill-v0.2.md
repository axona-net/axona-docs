# A bridge fills too: Rule 2 on the embedded peer (v0.2)

**Status:** design for council review, revision 2 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.105.0 (`1c85ef6`) · **Bridge:** 2.148.0
(`d2bd461`) · **Policy set by:** David, 2026-10-07 · **Author:** axona.bot ·
**Supersedes:** v0.1 (axona-docs `753450b`), which stays in place as the
record. **Builds on:** Mesh connectivity: hold and fill v0.15 (axona-docs
`e4809d2`), whose Rule 2 this document applies to a new kind of node without
changing it.

What changed from v0.1, on Vega's review (`e7cd15e6`): the composite's
routing of an open names its rule instead of a preference, and the door
dial of v0.1 is withdrawn because the socket already is the channel; the
cap says what unset and zero mean. Both findings are carried at the end.

David's direction, 2026-10-07, in full: "A bridge also needs to continuously
build its connections. It should prioritize external connections, as it does
once it is fully populated, but otherwise, it should grow its connections in
the same way regular nodes do."

## The question

Why does the node that introduces everyone hold almost no one? On
2026-10-07 at 14:49Z the east bridge had 21 inbound sockets, had made 799
introductions and graduated 722 peers since its restart at 22:26Z the
evening before, and its own kernel peer held a synaptome of 1 and zero open
mesh channels. West, the same build, held 47 mesh channels and a synaptome
of 47, every one of them opened by somebody else. Neither bridge has
dialled a peer since 2026-06-29. A relay on the same kernel, armed, sits
at 50.

## What this is not

- NOT a change to the WebSocket door. `BRIDGE_MAX_PEERS` (15 on both
  bridges), the nursery, the curated introductions and the graduation that
  frees a slot stay exactly as they are. The door is how newcomers reach
  the network; this document is about what the bridge itself is connected
  to.
- NOT the bridge-side directory of v0.15's *Discovery across cohorts* (the
  registry, the sample, the re-contact admission). That release stands on
  its own. This one uses what the bridge already knows.
- NOT a new rule. Rule 2 of Hold-and-Fill is applied as written: RECONCILE,
  NEIGHBOURS, DIRECTORY, DIAL, under the attempt guard and the admission
  gate, toward a cap. A bridge is a node. The parts that differ are where
  its candidates come from and what the cap is.
- NOT a new channel to a socket peer. A peer on one of the bridge's own
  sockets is connected to the bridge over that socket. v0.1 proposed
  offering a WebRTC channel to such a peer; that would be a second channel
  to a peer the bridge can already reach, and it is withdrawn.
- NOT arming. Arming is David's call per host, as it is for relays. This
  document makes a bridge ABLE to fill and says what it would do.
- NOT a claim about pub/sub delivery. A bridge with more connections routes
  more; whether that moves any delivery number is measured after, not
  asserted before.

## What a bridge does today

The embedded peer is built with no maintenance at all
(`bridge_axona_node.js:166–171`): `new AxonaPeer({ engine, node,
nodeIdentity })`, and the comment beside it says why. 2.48.0 (`7d99a9d`,
2026-06-29) turned `synaptomeMaintain` on; 2.49.0 (`21b7c86`) turned it off
fifty-eight minutes later because Howard's suite regressed. That was
maintenance ALONE, with no attempt guard and no admission gate, which is the
combination the relay launcher now refuses to start
(`axona-relay/src/relay.js:132`, `assertArmingCoherent`). The bridge has
never run the guarded form.

The bridge's node transport is a `CompositeTransport`
(`axona-protocol/src/transport/web/composite.js`) over two sub-transports:
the inbound WebSocket server (`axona-bridge/src/ws_transport.js`) and the
outbound uplink `webTransport` to the other bridge. The composite routes
`openConnection` to whichever sub-transport already OWNS the peer
(`_routeFor`, line 135: an `ownsPeer` method when the sub has one,
`isConnected` otherwise) and returns false for a peer neither owns (lines
232–235). It aggregates `boundPeers()` and fans out `onPeerBound`. It does
not expose `connectViaRelay`, `mayDial`, `canAllocate`, `allocRefusedFor`
or `onPeerList`.

The two sub-transports open a connection in two different senses. The
WebSocket server's `openConnection(nodeId)` dials nothing: it returns true
when a bound socket for that identity is open and false otherwise
(`ws_transport.js:116–119`). The socket is the channel. The uplink
`webTransport` dials: `connectViaRelay(hex)` initiates a WebRTC channel
through the upstream bridge's signalling (`web/index.js:1272`), under its
own ledger, and refuses a peer it already owns or has in its mesh (line
1287). So on a bridge today the kernel's fill would take its
`openIsTheDial` branch: an open to a socket peer succeeds at once with zero
dials, and an open to anyone else returns false.

The cap. `BRIDGE_MESH_MAX_PEERS` is 0 on both bridges, which the kernel reads
as unbounded (`uplink.js:77–87`). The bridge engine's `MAX_SYNAPTOME` is
256, the "highway tier" (`bridge_engine.js:27`). The fill's target is
`node._maxSynaptome ?? domain.MAX_SYNAPTOME` (`AxonaPeer.js:1647`), and the
kernel never sets `_maxSynaptome`. So a bridge armed with nothing else
changed would fill toward 256.

What "prioritize external connections, as it does once it is fully
populated" is in the code. At the door, over `BRIDGE_MAX_PEERS`,
`selectGraduate` (`graduation_select.js`) releases one admitted socket: from
the most over-represented keyspace region first, never a region's last
representative, and within the region the best-meshed peer, the one whose
departure the mesh absorbs. In the mesh, over `meshDegree.maxPeers`,
`selectMeshRetire` (`mesh_degree.js:60`) does the same with age in place of
vitality and never touches a channel that carries a duty. Both policies keep
the set the bridge holds spanning the address space and release the
connections the bridge's own cohort can spare. That is the policy David
named. It already exists on both sides and it is not changed here.

The readings behind the question, 14:45Z to 14:49Z on 2026-10-07, both
bridges on 2.148.0 / 4.105.0:

| | WebSocket connections | synaptome | mesh open | mesh cap | dials ever |
|---|---|---|---|---|---|
| east | 21 (12 of them the identity-less 4.84.0 cohort) | 1 | 0 | off | 0 |
| west | 1 (east's uplink) | 47 | 47 | off | 0 |

West's 47 are all inbound: peers that reached it through east's mesh and
opened channels to it. East's uplink mesh has opened nothing, and of the
nine sockets on east that carry an identity, one is in its synaptome. Why
the other eight are bound and not admitted is the first thing RECONCILE
would report, and this document does not guess at it.

## The rule for a bridge

Below cap, a bridge runs Phase-1 Rule 2 on its embedded peer, unchanged:

1. RECONCILE. Every identity the composite holds bound and not in the table
   is offered to the admit path, zero dials. On east at 14:49Z that is
   eight sockets.
2. NEIGHBOURS. The `findKClosest` rounds over channels the bridge already
   has, nominating as a relay does.
3. DIRECTORY. A relay asks the bridge for introductions. A bridge IS the
   directory: its candidates are its own admitted connections, bound
   identities with regions it can read, plus the peer-lists its uplink
   receives from the other bridge. No re-contact timer is needed; the
   sample is local.
4. DIAL. Nearest-first, under `P_pending`, under the guard's marks, through
   the gate. The open goes to the composite, and the composite applies ONE
   rule, in this order:
   - A peer some sub-transport OWNS is opened by that sub-transport. For a
     socket peer that is the WebSocket server, whose open returns true with
     no dial: the socket is the channel, and admission proceeds as it does
     for any bound peer. For a peer already in the uplink's mesh it is the
     uplink, which likewise has nothing to dial.
   - A peer NO sub-transport owns is dialled by the sub-transport that
     exposes `connectViaRelay`. On a bridge that is the uplink and only the
     uplink. If no sub-transport exposes it the open returns false, as it
     does today.

   This is not a preference between two dialers. A bridge has one dialer.
   The door never dials; it either has the socket or it does not.

At cap, nothing new. The door graduates as it does; the mesh retires as it
does; both prefer to keep what spans the keyspace and both leave duties
alone. A channel the fill opened is an ordinary channel from then on and
is retired on the same two axes as any other.

EXTERNAL, since the word carries the policy: a connection is external to the
bridge when it reaches a part of the network the bridge's other connections
do not already span, measured as the keyspace region of the bound identity.
A newcomer at the door is external by definition until it is meshed. The
uplink to the other bridge is external and is protected as a duty. Nothing
here reads geography or an IP.

## One cap

`BRIDGE_MESH_MAX_PEERS` is read once at construction and feeds two places:
the fill's target (`node._maxSynaptome`) and the mesh's retire threshold
(`meshDegree.maxPeers`). The three cases:

| `BRIDGE_MESH_MAX_PEERS` | fill target | mesh retire threshold | may the fill arm? |
|---|---|---|---|
| unset | 50 | 50 | yes |
| 0 | none | off, as today | NO: construction refuses the triad |
| N > 0 | N | N | yes |

Unset is 50 because 50 is the kernel's `MAX_SYNAPTOME` and the figure every
armed relay runs at; the bridge engine's 256 is not a cap anyone chose for
a 2 vCPU droplet. Zero keeps today's behaviour exactly for a bridge that is
not armed, and makes an unbounded fill impossible to configure: a bridge
with no ceiling has nothing for "at cap" to mean, and `selectMeshRetire`
would never run against what the fill opened. The refusal uses the same
words as the arming-coherence refusal.

## What has to change, and where

Kernel, one change (`composite.js`): forward `connectViaRelay`, `mayDial`,
`canAllocate`, `allocRefusedFor` and `onPeerList` to the sub-transport that
implements them, and route an open for an unowned peer to the sub-transport
that exposes `connectViaRelay`, by the rule above. Rule 2 itself is
untouched. This rides a kernel release.

Bridge, one release:

- Construct the peer with the triad: `synaptomeMaintain`, `attemptGuard`,
  `admissionGate`, each from its own `BRIDGE_*` environment flag, with
  `assertArmingCoherent` ported from the relay launcher so maintenance
  without the guard and the gate refuses to start. Default: all off. The
  2026-06-29 combination becomes impossible to configure.
- One cap, read once, by the table above.
- `/healthz` carries the fill report the relay already logs: state
  (`filling`, `pending`, `at-cap`, `deferred`, `fill-stalled` with its
  reason), cache size, dials and cancels this tick, marks by reason.

Nothing in `ws_transport.js`. Relay launcher: nothing. Apps: nothing.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Bridge cap (`BRIDGE_MESH_MAX_PEERS`, also the fill target) | 50, the relay figure, which is also what unset means | The two bridges are c-2 droplets with 2 vCPU and 4 GB. West holds 47 today at service pressure 0.13; the first armed hour tells whether 50 is the number. 256 is not proposed. |
| Arming order | testnet B1 and B2, then west, then east | The testnet has no relays, B1 has one socket and B2 has none; arming there proves only that the triad starts and nothing storms. West at 47 tests the cap. East at 1 tests the fill. |
| Howard's suite | run against an armed testnet bridge before any production arming | The 2026-06-29 revert cites it and nothing else. |

## Rollout

1. Kernel change (composite forwarding and the routing rule) and bridge
   change, each reviewed, each released through `RELEASE-PROCEDURE.md`,
   both with the fill off. Between the release and arming a bridge holds
   exactly as it does now.
2. MEASURE before arming, on both production bridges and both testnet
   bridges: synaptome size, mesh open, sockets bound and not in the
   synaptome with the admit path's reason for each, service pressure, tick
   lag, loop stalls. The 14:49Z row above is the first sample.
3. Arm testnet B1 and B2. Howard's suite. Twenty-four hours.
4. Arm west, on David's word. One hour of the step-2 measurements at ten
   minute intervals, then daily.
5. Arm east, on David's word. Same.

## Verification

Fences, each with the fix deleted to prove the fence sees it:

- Composite forwarding: a composite over a stub with `connectViaRelay` and a
  stub without routes an unowned open to the one that has it and the open
  no longer returns false; an owned open goes to the owner and the dialer
  is never called; `mayDial` reads the dialer's ledger; with no dialer
  present the unowned open returns false.
- Socket peer, zero dials: a composite over an emulated WebSocket server
  that owns a bound peer opens that peer with the server's open, the
  dialer's `connectViaRelay` is not called, and the dialer's ledger counts
  no outbound.
- Arming coherence on the bridge: `BRIDGE_SYNAPTOME_MAINTAIN=1` with either
  companion unset refuses at construction with the relay launcher's words;
  the full triad with `BRIDGE_MESH_MAX_PEERS=0` refuses with the cap's
  words.
- One cap: for unset, 0 and each of several N, the constructed peer's
  `_maxSynaptome` and the transport's `meshDegree.maxPeers` take the values
  in the table.
- Fill on a bridge, end to end in a harness: a bridge with nine bound
  sockets and a synaptome of one, armed, reaches `min(cap, bound)` within
  one tick with zero dials (RECONCILE), then dials toward cap through the
  uplink, and at cap the retire policy releases from the most
  over-represented region first and never the uplink.

## What this document does not establish

- Why east's eight bound sockets are not in its synaptome. RECONCILE reports
  it; this document predicts nothing.
- That a bridge at 50 routes better than a bridge at 1. That is the
  measurement in step 2, before and after.
- Any effect on the 4.84.0 identity-less cohort. Those sockets carry no
  identity, bind nothing, and are candidates for nothing here.
- Load on a c-2 droplet at cap. Vega's hold-and-fill review named the load
  check before arming (v0.15 rollout step 3); it applies to a bridge as it
  did to a one-core relay droplet, with the bridge's socket load on top.
- Anything about convergence of two bridges both filling toward each other's
  cohorts. Two cohorts both at cap not joining is v0.15's open
  saturated-cohort requirement and it stays open.

## Findings carried

| From | Finding | Disposition |
|---|---|---|
| Vega `e7cd15e6` | "a sub that can dial" names no order; the door path would never receive the open | CLOSED in v0.2: the composite's rule is owner first, then the one sub-transport exposing `connectViaRelay`; the door never dials, so there is no order to choose. The v0.1 door dial is withdrawn. |
| Vega `e7cd15e6` | the one-cap fence requires equality "including unset" and the note did not say what unset takes | CLOSED in v0.2: the *One cap* table. Unset is 50 for both; 0 keeps today's mesh behaviour and refuses the fill; N is N for both. |
