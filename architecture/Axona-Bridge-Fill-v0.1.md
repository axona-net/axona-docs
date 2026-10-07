# A bridge fills too: Rule 2 on the embedded peer (v0.1)

**Status:** design for council review, revision 1 · **Date:** 2026-10-07 ·
**Kernel in production:** 4.105.0 (`1c85ef6`) · **Bridge:** 2.148.0
(`d2bd461`) · **Policy set by:** David, 2026-10-07 · **Author:** axona.bot ·
**Builds on:** Mesh connectivity: hold and fill v0.15 (axona-docs `e4809d2`),
whose Rule 2 this document applies to a new kind of node without changing it.

David's direction, 2026-10-07, in full: "A bridge also needs to continuously
build its connections. It should prioritize external connections, as it does
once it is fully populated, but otherwise, it should grow its connections in
the same way regular nodes do."

## The question

Why does the node that introduces everyone hold almost no one? On
2026-10-07 at 14:49Z the east bridge had 21 inbound sockets, had made 799
introductions and graduated 722 peers since its restart at 22:26Z the
evening before, and its own kernel peer held a synaptome of 1 and zero open
mesh channels. West, the same build, held 47
mesh channels and a synaptome of 47, every one of them opened by somebody
else. Neither bridge has dialled a peer since 2026-06-29. A relay on the
same kernel, armed, sits at 50.

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
the inbound WebSocket server, and the outbound uplink `webTransport` to the
other bridge. The composite routes `openConnection` to whichever
sub-transport already OWNS the peer (`_routeFor`, line 135) and returns
false for a peer neither owns. It aggregates `boundPeers()` and fans out
`onPeerBound`. It does not expose `connectViaRelay`, `mayDial`,
`canAllocate` or `onPeerList`, so on a bridge the kernel's fill would take
its `openIsTheDial` branch and every dial to a peer not already connected
would return false.

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
   the gate. A bridge has two dial paths and today has neither wired:
   - THROUGH THE UPLINK. The uplink `webTransport` already has
     `connectViaRelay`, a ledger and `mayDial`; the composite has to forward
     them. This reaches anything the other bridge's mesh can rendezvous.
   - AT THE DOOR. For a candidate on one of its own sockets the bridge is
     that peer's signalling relay already. It can offer over that socket
     directly: no rendezvous, no third party, the same frames it relays for
     everyone else. This is the path a relay does not have and the one that
     makes a bridge different. It is new code in `ws_transport.js`.

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

## What has to change, and where

Kernel, one change (`composite.js`): forward `connectViaRelay`, `mayDial`,
`canAllocate`, `allocRefusedFor` and `onPeerList` to the sub-transport that
implements them, and route `openConnection` for an unowned peer to a
sub-transport that can dial; today it returns false. Rule 2 itself is
untouched. This rides a kernel release.

Bridge, one release:

- Construct the peer with the triad: `synaptomeMaintain`, `attemptGuard`,
  `admissionGate`, each from its own `BRIDGE_*` environment flag, with
  `assertArmingCoherent` ported from the relay launcher so maintenance
  without the guard and the gate refuses to start. Default: all off. The
  2026-06-29 combination becomes impossible to configure.
- One cap, read once: `BRIDGE_MESH_MAX_PEERS` sets both the fill's target
  (`node._maxSynaptome`) and `meshDegree.maxPeers`. A bridge whose fill
  target and whose retire threshold differ would fill past where it
  retires, and the two would fight.
- The door dial in `ws_transport.js`, and `ownsPeer` extended so the
  composite routes the fill's open to it.
- `/healthz` carries the fill report the relay already logs: state
  (`filling`, `pending`, `at-cap`, `deferred`, `fill-stalled` with its
  reason), cache size, dials and cancels this tick, marks by reason.

Relay launcher: nothing. Apps: nothing.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Bridge cap (`BRIDGE_MESH_MAX_PEERS`, also the fill target) | 50, the relay figure | The engine default is 256 and the two bridges are c-2 droplets with 2 vCPU and 4 GB. West holds 47 today at service pressure 0.13; the first armed hour tells whether 50 is the number. 256 is not proposed. |
| Arming order | testnet B1 and B2, then west, then east | The testnet has no relays, B1 has one socket and B2 has none; arming there proves only that the triad starts and nothing storms. West at 47 tests the cap. East at 2 tests the fill. |
| Door dial first, or uplink dial first | door | If the eight unadmitted sockets on east turn out to be refused for a reason the admit path names, the door dial fills nothing there and the uplink path carries the load. |
| Howard's suite | run against an armed testnet bridge before any production arming | The 2026-06-29 revert cites it and nothing else. |

## Rollout

1. Kernel change (composite forwarding) and bridge change, each reviewed,
   each released through `RELEASE-PROCEDURE.md`, both with the fill off.
   Between the release and arming a bridge holds exactly as it does now.
2. MEASURE before arming, on both production bridges and both testnet
   bridges: synaptome size, mesh open, sockets bound and not in the
   synaptome with the admit path's reason for each, service pressure, tick
   lag, loop stalls. The 14:45Z row above is the first sample.
3. Arm testnet B1 and B2. Howard's suite. Twenty-four hours.
4. Arm west, on David's word. One hour of the step-2 measurements at ten
   minute intervals, then daily.
5. Arm east, on David's word. Same.

## Verification

Fences, each with the fix deleted to prove the fence sees it:

- Composite forwarding: a composite over a stub with `connectViaRelay` and a
  stub without routes a dial to the one that has it; an unowned peer dials
  through the dialing sub and the open no longer returns false; `mayDial`
  reads the dialing sub's ledger.
- Arming coherence on the bridge: `BRIDGE_SYNAPTOME_MAINTAIN=1` with either
  companion unset refuses at construction with the relay launcher's words.
- One cap: the constructed peer's `_maxSynaptome` equals the transport's
  `meshDegree.maxPeers` for every value of `BRIDGE_MESH_MAX_PEERS`
  including unset.
- Door dial: an emulated socket peer receives an offer frame from the
  bridge's own identity and the resulting channel is counted by the
  bridge's ledger as outbound.
- Fill on a bridge, end to end in a harness: a bridge with nine bound
  sockets and a synaptome of one, armed, reaches `min(cap, bound)` within
  one tick with zero dials (RECONCILE), then dials toward cap through the
  door, and at cap the retire policy releases from the most over-represented
  region first and never the uplink.

## What this document does not establish

- Why east's eight bound sockets are not in its synaptome. RECONCILE reports
  it; this document predicts nothing.
- That a bridge at 50 routes better than a bridge at 2. That is the
  measurement in step 2, before and after.
- Any effect on the 4.84.0 identity-less cohort. Those sockets carry no
  identity, bind nothing, and are candidates for nothing here.
- Load on a c-2 droplet at cap. Vega's hold-and-fill review named the load
  check before arming (v0.15 rollout step 3); it applies to a bridge as it
  did to a one-core relay droplet, with the bridge's socket load on top.
- Anything about convergence of two bridges both filling toward each other's
  cohorts. Two cohorts both at cap not joining is v0.15's open
  saturated-cohort requirement and it stays open.
