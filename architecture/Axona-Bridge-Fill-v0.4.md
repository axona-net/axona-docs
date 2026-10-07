# A bridge fills too: Rule 2 on the embedded peer (v0.4)

**Status:** design for council review, revision 4 · **Date:** 2026-10-07 · **Kernel in
production:** 4.105.0 (`1c85ef6`) · **Bridge:** 2.148.0 (`d2bd461`) ·
**Policy set by:** David, 2026-10-07 · **Author:** axona.bot ·
**Supersedes:** v0.3 (axona-docs `53cdeca`), v0.2 (`dc4f070`) and v0.1
(`753450b`), which stay in place as the record. **Builds on:** Mesh connectivity: hold and fill
v0.15 (axona-docs `e4809d2`), whose Rule 2 this document applies to a new
kind of node without changing it.

What changed from v0.1 and v0.2, on the reviews of Vega (`e7cd15e6`,
`5b507ccb`), Orion (`0308d084`) and Aster (`ffe5d3b6`): `openConnection`
stays exactly what the kernel takes it for on a transport that has
`connectViaRelay`, a bound-only open that allocates nothing; the dial is
`connectViaRelay`, forwarded to the one sub-transport that has it, with
its ledger; the door dial of v0.1 is gone; an unset, zero, negative or
non-integral cap refuses the fill instead of meaning anything; EXTERNAL
is region coverage and nothing else. v0.4 corrects one row of the cap table
on Vega's read of `uplink.js:79` (`bc0a11e3`): an ABSENT variable does not
leave the mesh cap off today, it substitutes the door's cap. Every finding
is carried at the end.

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
- NOT a change to what `openConnection` means. On a transport that has
  `connectViaRelay` the kernel treats the open as bound-only and issues
  nothing on it (`AxonaPeer.js:5107–5114`, `5133`); the dial, the CONSUME
  and the incarnation all live at the `connectViaRelay` issue
  (`5181–5197`). v0.1 and v0.2 had the composite dial inside the open. That
  was the conflict Aster named, and it is gone.
- NOT a new channel to a socket peer. A peer on one of the bridge's own
  sockets is connected to the bridge over that socket. v0.1 proposed
  offering a WebRTC channel to such a peer; that would be a second channel
  to a peer the bridge can already reach, and it is withdrawn.
- NOT a default cap. A bridge fills toward a number David set and toward
  nothing else. Unset is not a number.
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
232–235). It aggregates `boundPeers()` and fans out `onPeerBound`, carrying
each sub's channel incarnation through unchanged (R8-2). It does not expose
`connectViaRelay`, `mayDial`, `canAllocate`, `allocRefusedFor` or
`onPeerList`.

The two sub-transports open a connection in two different senses. The
WebSocket server's `openConnection(nodeId)` dials nothing: it returns true
when a bound socket for that identity is open and false otherwise
(`ws_transport.js:116–119`). The socket is the channel. The uplink
`webTransport` dials: `connectViaRelay(hex)` initiates a WebRTC channel
through the upstream bridge's signalling (`web/index.js:1272`), under its
own ledger, and returns false for a peer it already owns or has in its mesh
(line 1287), null when its ledger refuses capacity, and the started
negotiation's incarnation otherwise.

What the kernel does with those two. `_considerCandidate` reads
`openIsTheDial = typeof t.connectViaRelay !== 'function'`
(`AxonaPeer.js:5133`). On a transport WITHOUT `connectViaRelay`, the open is
the dial and the CONSUME runs before it. On a transport WITH it, the open is
bound-only: a true is a bind (`'bound'`, token ended), a false falls through
to the eligibility re-read and then to `connectViaRelay`, where a string or
true is an issue (CONSUME in the same step, token attached to the
incarnation, `'held'`), null is a capacity refusal (token released, nothing
counted, `'deferred'`) and false is a dial that could not be issued (token
ended as a failure). Today the composite has no `connectViaRelay`, so a
bridge is on the first path: an open to a socket peer succeeds with zero
dials and an open to anyone else fails and is counted.

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
nine sockets on east that carry an identity, one is in its synaptome. The
other eight are bound and not admitted. Nothing here says they are
eligible; RECONCILE offers each to the admit path and the admit path says
what it says. This document predicts nothing about those eight.

## The rule for a bridge

Below cap, a bridge runs Phase-1 Rule 2 on its embedded peer, unchanged:

1. RECONCILE. Every identity the composite holds bound and not in the table
   is offered to the admit path, zero dials. On east at 14:49Z eight
   sockets would be offered.
2. NEIGHBOURS. The `findKClosest` rounds over channels the bridge already
   has, nominating as a relay does.
3. DIRECTORY. A relay asks the bridge for introductions. A bridge IS the
   directory: its candidates are its own admitted connections, bound
   identities with regions it can read, plus the peer-lists its uplink
   receives from the other bridge. No re-contact timer is needed; the
   sample is local.
4. DIAL. Nearest-first, under `P_pending`, under the guard's marks, through
   the gate, on the kernel's WITH-`connectViaRelay` path, which is the path
   every relay runs today:
   - The open goes to the composite, which routes it to the owner or
     returns false. The WebSocket server owns a bound socket peer and
     answers true: the socket is the channel, the kernel records a bind,
     nothing is dialled and nothing is consumed. The uplink owns a peer
     already in its mesh and answers true likewise. An unowned peer gets
     false, as today.
   - The dial is `connectViaRelay`, which the composite forwards to its
     DIALER and returns unchanged: the incarnation string, true, false or
     null, each meaning what the kernel already takes it to mean. The dialer
     is the one sub-transport that exposes `connectViaRelay`. On a bridge
     that is the uplink. The dialer refuses a peer it owns or has in its
     mesh (false) and refuses capacity from its own ledger (null); the
     composite invents neither.
   - `mayDial`, `canAllocate` and `allocRefusedFor` are forwarded to the
     SAME dialer, so the ledger the kernel reads before a dial is the ledger
     the dial allocates against. There is one dialer and one ledger. A
     composite with two sub-transports exposing `connectViaRelay` refuses
     to construct; which sub-transport dials is never a preference.

   The door never dials. It has the socket or it does not. Growth on the
   door side is inbound only and bounded by `BRIDGE_MAX_PEERS`; growth the
   fill creates is on the uplink mesh only, through `connectViaRelay`.

At cap, nothing new. The door graduates as it does; the mesh retires as it
does; both prefer to keep what spans the keyspace and both leave duties
alone. A channel the fill opened is an ordinary channel from then on and
is retired on the same two axes as any other.

EXTERNAL, since the word carries the policy: a connection is external to the
bridge when the keyspace region of its bound identity is one no other
connection the bridge holds covers. That is the predicate `selectGraduate`
and `selectMeshRetire` already implement, as "never a region's last
representative, release from the most over-represented region first". It
is a property of the set the bridge holds, not of the peer: the same peer
is external while it is its region's only representative and stops being
external when a second arrives. Each selector reads its own set:
`selectGraduate` counts the door candidates it is handed
(`graduation_select.js:45–48`) and `selectMeshRetire` counts the open mesh
peers `mesh.js:778` passes in. A region held once at the door and once in
the mesh is a last representative to both selectors. No coverage across the
two transports together is claimed; each preserves its own. Arrival is not novelty; a newcomer at the
door is protected by the graduation's minimum uptime, not by this word.
The uplink to the other bridge is protected because it carries a duty, not
because it is external. Nothing here reads geography or an IP.

## One cap, and what the fill counts against it

`BRIDGE_MESH_MAX_PEERS` is read once at construction by TWO resolvers,
and which one runs depends on the triad.

TRIAD OFF: the resolver the bridge has today, unchanged
(`uplink.js:78–87`): `parseInt(BRIDGE_MESH_MAX_PEERS ??
String(parseInt(BRIDGE_MAX_PEERS ?? '32')))`; a finite positive result sets
`meshDegree.maxPeers` to it, anything else leaves `meshDegree` null. So an
absent variable inherits the door's cap (15 on both production bridges, 32
in code), `'12x'` is 12 and `'1.5'` is 1 because that is what `parseInt`
does, and 0, a negative or an unparseable string is null. Both production
bridges run the 0 row. The fill target is absent on every row. Nothing in
this document moves an unarmed bridge.

TRIAD ON: a second, strict resolver. The variable must be present and must
be a positive integer written as one, digits only. That integer feeds both
`node._maxSynaptome` and `meshDegree.maxPeers`. Anything else refuses
construction with the arming-coherence refusal's words: absent, 0, a
negative, `'1.5'`, `'12x'`, or the door's cap by inheritance. A bridge that
is armed has a ceiling David typed, the same integer on both sides, or it
does not start: a bridge with no ceiling has nothing for "at cap" to mean,
and `selectMeshRetire` would never run against what the fill opened. The
engine's 256 is never a cap: it is what the fill would have read had this
rule not existed, and the fence below is written so that it cannot be.

| `BRIDGE_MESH_MAX_PEERS` | triad OFF: mesh retire threshold (today's resolver) | triad OFF: fill target | triad ON |
|---|---|---|---|
| absent | the door's cap | none | refuses |
| `0` | off (null); both production bridges | none | refuses |
| negative, or unparseable | off (null) | none | refuses |
| `'12x'`, `'1.5'` | 12, 1 | none | refuses |
| digits only, N > 0 | N | none | fill target N, retire threshold N |

What the one cap bounds, and what it does not. The fill's availability is
`cap − synaptome.size − attempts in flight` (`AxonaPeer.js:1644–1650`), and
the synaptome counts an admitted identity whichever sub-transport carries
it. So the one number is the fill's BUDGET, read the same way whichever
path produced the identity: the check at `AxonaPeer.js:2544` lets
`_admitOrImprove` insert while `synaptome.size` is below the cap, and
RECONCILE and the dial both reach that check. It is a budget, not a
guarantee: two callers can both read it and both insert, and that is the
race left open below. It does not bound the door's sockets, which
`BRIDGE_MAX_PEERS` bounds and which are never allocations of the fill.
Allocations exist on one path only, the uplink's ledger, and that ledger is
the one `mayDial` reads.

The same N lands in two counters that count different things (Vega
`1c28589a`). The fill's availability counts the synaptome, and a socket
admit spends it with zero dials. `meshDegree.maxPeers` counts open mesh
channels only. So on a bridge with S socket admits, the socket and mesh
identities disjoint, every mesh peer admitted and nothing in flight, the
fill stops dialling when the mesh holds N − S channels; the retire line sits
at N plus the slack of 2 (`mesh.js:132`, `762`), S and more above that
population, and between the two the mesh can grow only by inbound channels,
which Phase 1 leaves ungated on every node. Drop any of the three
assumptions and N − S is not the number. That is the same shape an armed relay
has when inbound takes it past its cap, and the Windows census of
2026-10-07 shows unarmed relays at 56 to 69 on inbound alone. It is stated,
not fixed, here. Also stated: `_transportMayDial` (`1653`) is read at the
tick's preflight (`1764`), and a forwarded ledger refusal holds the tick's
dials while availability is still positive, as it does on a relay.

Equal numbers on the fill and the retire are a precondition, not a proof:
the race between an inbound arrival on one path and an admission on the
other is the all-path admission race v0.15 left open, and it stays open
here. The fences below hold the bridge to the same behaviour a relay has
under that race, no better.

## What has to change, and where

Kernel, one change (`composite.js`): a DIALER, the unique sub-transport
exposing `connectViaRelay`, found once when the sub-transports are added
and refused if there are two; `connectViaRelay`, `mayDial`, `canAllocate`
and `allocRefusedFor` forwarded to it with their results unchanged;
`onPeerList` fanned in from every sub-transport that emits it.
`openConnection` is not touched. Rule 2 itself is untouched. This rides a
kernel release.

Bridge, one release:

- Construct the peer with the triad: `synaptomeMaintain`, `attemptGuard`,
  `admissionGate`, each from its own `BRIDGE_*` environment flag, with
  `assertArmingCoherent` ported from the relay launcher so maintenance
  without the guard and the gate refuses to start. Default: all off. The
  2026-06-29 combination becomes impossible to configure.
- One cap, read once, by the table above; the triad with no integer cap
  refuses.
- `/healthz` carries the fill report the relay already logs: state
  (`filling`, `pending`, `at-cap`, `deferred`, `fill-stalled` with its
  reason), cache size, dials and cancels this tick, marks by reason, and
  separately: admitted identities, bound sockets, open mesh channels,
  pending allocations.

Nothing in `ws_transport.js`. Relay launcher: nothing. Apps: nothing.

## Parameters for David

| Parameter | Proposal | What would make it wrong |
|---|---|---|
| Bridge cap (`BRIDGE_MESH_MAX_PEERS`, also the fill target; required to arm) | 50 | 50 is the relay's configured cap, not a measured ceiling for a bridge, and the two bridges are c-2 droplets with 2 vCPU and 4 GB carrying sockets as well. West holds 47 today at service pressure 0.13; the first armed hour tells whether 50 is the number. 256 is not proposed. |
| Arming order | testnet B1 and B2, then west, then east | The testnet has no relays, B1 has one socket and B2 has none; arming there proves only that the triad starts and nothing storms. West at 47 tests the cap. East at 1 tests the fill. |
| Howard's suite | run against an armed testnet bridge before any production arming | The 2026-06-29 revert cites it and nothing else. |

Each of these is a proposal. Running the suite, arming a bridge, and the
load check below each need their own authorization from David.

## Rollout

1. Kernel change (the dialer and the forwarding) and bridge change, each
   reviewed, each released through `RELEASE-PROCEDURE.md`, both with the
   fill off. Between the release and arming a bridge holds exactly as it
   does now.
2. MEASURE before arming, on both production bridges and both testnet
   bridges, each quantity on its own: admitted identities, bound sockets,
   open mesh channels, pending allocations, sockets bound and not admitted
   with the admit path's reason for each, service pressure, tick lag, loop
   stalls. The 14:49Z row above is the first sample.
3. LOAD CHECK (v0.15 rollout step 3, applied to a bridge): one testnet
   bridge driven to cap open channels by the harness and held an hour, with
   its sockets live. Pass: no swap, PSI cpu some avg10 under 10%, RSS under
   half the host's memory. Fail lowers the proposed cap.
4. Arm testnet B1 and B2 with the cap set. Howard's suite. Twenty-four
   hours.
5. Arm west, on David's word. One hour of the step-2 measurements at ten
   minute intervals, then daily.
6. Arm east, on David's word. Same.

## Verification

Fences, each with the fix deleted to prove the fence sees it:

- Dialer selection: a composite over one sub with `connectViaRelay` and one
  without names the first as dialer; a composite over two subs with it
  refuses to construct; a composite over none has no `connectViaRelay`
  and the kernel's `openIsTheDial` reads true, exactly today.
- Forwarding unchanged: for each of the dialer's four answers (incarnation
  string, true, false, null) the composite's `connectViaRelay` returns the
  same value; `mayDial`, `canAllocate` and `allocRefusedFor` return the
  dialer's answers; the kernel's `_considerCandidate` on the composite
  ends in `'held'` with the token attached to that incarnation, `'held'`
  with no incarnation, a counted failure, and `'deferred'` with the token
  released, respectively, and CONSUME runs exactly once and only on the
  two issues.
- Open is bound-only: an open to a peer the WebSocket stub owns returns
  true with `connectViaRelay` never called and the dialer's ledger
  unchanged; an open to an unowned peer returns false and the kernel then
  calls `connectViaRelay` once.
- Ownership moves while the open is awaited: a peer that becomes owned by
  the dialer's mesh between the kernel's open and its dial gets false from
  the dialer (`web/index.js:1287`) and the kernel ends the token as it does
  for any unissued dial; a peer whose socket closes between open and dial
  is dialled through the dialer once. A late bind from a replaced attempt
  carries its incarnation through `onPeerBound` and the kernel's own
  handlers reject it (`AxonaPeer.js:655–658`; a stale negotiation-failed
  returns before the mark at `721–723`), on the composite as on the web
  transport; the fence drives those handlers, it does not reimplement them. A capacity refusal
  (null) is never followed by a second allocator: the composite has one.
- Arming coherence on the bridge: `BRIDGE_SYNAPTOME_MAINTAIN=1` with either
  companion unset refuses at construction with the relay launcher's words.
- Fill on a bridge, end to end in a harness, with four counters asserted
  separately at every step: admitted identities, bound sockets, open mesh
  channels, pending allocations. A bridge with nine bound sockets, a
  synaptome of one, an empty mesh and a cap of N, armed: after one tick
  admitted = `min(N, 9)`, sockets = 9, mesh = 0, pending = 0 (RECONCILE,
  zero dials); the remaining deficit `N − admitted` is then closed only by
  DIAL through the dialer, each dial raising pending by one and, on bind,
  mesh and admitted by one; sockets never change. Reaching N admitted puts
  N − S channels in the mesh, under the retire line, so this fixture
  asserts that the retire did NOT run.
- Retirement, its own state: a mesh driven by inbound channels to more
  than N plus the slack of 2, with one eligible peer in an over-represented
  region, retires that peer and never the uplink; the same mesh with every
  candidate protected or a last representative retires nothing and
  `selectMeshRetire` returns null.
- Cap resolvers: with the triad off, absent with the default door cap and
  with a custom one, `0`, a negative, `'1.5'`, `'12x'` and an unparseable
  string each produce today's `meshDegree` (door cap, door cap, null, null,
  1, 12, null) and no fill target; with the triad on, every one of those
  refuses and only a digits-only positive integer constructs, with
  `_maxSynaptome` equal to `meshDegree.maxPeers`.

## What this document does not establish

- Why east's eight bound sockets are not in its synaptome. RECONCILE reports
  it; this document predicts nothing.
- That a bridge at 50 routes better than a bridge at 1. That is the
  measurement in step 2, before and after.
- Any effect on the 4.84.0 identity-less cohort. Those sockets carry no
  identity, bind nothing, and are candidates for nothing here.
- Load on a c-2 droplet at cap. Step 3 measures it; nothing here assumes
  the answer.
- The all-path admission race between an inbound arrival and a concurrent
  admission on the other path. Open in v0.15, open here; the fences hold a
  bridge to a relay's behaviour under it.
- Anything about convergence of two bridges both filling toward each other's
  cohorts. Two cohorts both at cap not joining is v0.15's open
  saturated-cohort requirement and it stays open.

## Findings carried

| From | Finding | Disposition |
|---|---|---|
| Vega `e7cd15e6` | "a sub that can dial" names no order; the door path would never receive the open | CLOSED: there is one dialer, found by construction; the door never dials. |
| Vega `e7cd15e6` | the one-cap fence requires equality "including unset" and the note did not say what unset takes | CLOSED (v0.3 table): unset refuses the fill and leaves the mesh as today. |
| Vega `5b507ccb` | defaulting unset to 50 makes 0 mean 50 once the triad is on; the fence's "equal including unset" is the refuse; 50 is David's value | CLOSED: adopted as written. v0.2's unset = 50 withdrawn. |
| Orion `0308d084` | route socket peers to a door direct-offer dialer first, uplink second; outbound accounting for the door offer | NOT ADOPTED: `ws_transport.js:116–119` opens a bound socket peer by returning true with no dial, because the socket already carries the kernel's frames; an offer to that peer would be a second channel to a node already reached. The ownership rule gives the order without a second dialer. Rollout and the Howard gate stay as proposals needing David's authorization. |
| Aster `ffe5d3b6` BF-A | the composite dialing inside `openConnection` conflicts with the kernel's WITH-`connectViaRelay` path: issue without the issue-time CONSUME, no incarnation returned | CLOSED: `openConnection` untouched and bound-only; the dial is `connectViaRelay` forwarded with its result unchanged; the four-answer fence. |
| Aster `ffe5d3b6` BF-B | route and ledger must be one operation; no forwarding to "the first sub with a method"; no second allocator after a refusal; fence the concurrent cases | CLOSED: one dialer, its ledger for all three reads, two dialers refuse construction, null is never followed by another allocator; fences for ownership moving during the await, socket closing during the await, late bind by incarnation. The all-path admission race stays open and is listed as such. |
| Aster `ffe5d3b6` BF-C | the socket open succeeds without a mesh offer, so the fixture must assert admitted identities, socket paths, mesh channels and pending allocations separately, and say which deficit remains and what closes it; do not call the eight sockets eligible | CLOSED: the four counters in the fence and on `/healthz`; the remaining deficit is `N − admitted`, closed by DIAL through the dialer only; the eight are "offered", eligibility unstated. |
| Aster `ffe5d3b6` | EXTERNAL conflated region novelty with being a newcomer | CLOSED: external is a property of the set the bridge holds, measured as region coverage, the predicate the two selectors already implement; arrival is not novelty; the uplink is protected by duty. |
| Aster `ffe5d3b6` | reject an absent, non-positive or non-integral cap when armed | CLOSED: the triad-ON resolver accepts a digits-only positive integer and refuses everything else. |
| Aster `ffe5d3b6` | the relay's 50 is not a proven all-path ceiling; rollout, load and the suite need their own authorization | CLOSED in text: the parameters table says so; the load check is rollout step 3. |
| Vega `bc0a11e3` | the v0.3 table's unset row said "off, as today"; today an absent variable substitutes `BRIDGE_MAX_PEERS` into the mesh cap (`uplink.js:79`) and only 0 leaves it null (line 87); production is the 0 row; the late-bind clause is already the kernel's (`AxonaPeer.js:641–642`, `655–658`, `721–723`) | CLOSED in v0.4: the table's absent row now says what the code does and the unarmed bridge is unchanged row by row; the late-bind fence is stated as driving the kernel's own handlers with the forwarded incarnation. |
| Vega `05d37ca3`, Aster `c35329e2`, Vega `94f3339a` | the refusing rows must not be rewritten to null when the triad is off: today's resolver inherits the door cap when absent and `parseInt`s junk; "bounds ADMISSION across both paths" overstates the check at `AxonaPeer.js:2544`; a fill that stops at N admitted holds N − S mesh channels, under the retire line, so retirement needs its own fixture plus a protected/no-eligible case; each selector counts its own population | CLOSED in v0.4: two resolvers, today's verbatim when off and a digits-only positive integer when on, with the fixture list; the budget sentence; the N − S line with its three assumptions and the slack of 2; retirement and null-retirement fixtures; the selectors' populations named, no cross-transport coverage claimed. |
| Vega `1c28589a` | the one-cap table writes one N into two counters that count different things; `_transportMayDial` at preflight can hold the tick while availability is positive; a forwarded refusal stays null | CLOSED in text: *One cap* names the gap of S socket admits between the fill's stop and the retire line, and the preflight hold, both as relay behaviour carried over, neither fixed here. |
