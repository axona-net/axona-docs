# Bridge Air-Gap — Project Plan — v0.2

**Status:** proposed, revision of v0.1 under Aster CP BLOCK c5d8ad09 (B1–B6) and
Vega changes-required dffcdd82 (1–4); for council review before implementation
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Supersedes:** Bridge-Air-Gap-Plan-v0.1.md (sha256 866b123f…), which stays as
the hashed snapshot and is not modified
**Kernel baseline:** `@axona/protocol` v4.88.0; `axona-bridge` 2.130.0; `axona-relay` 0.132.0
**Companions:** council e8282dcd, 8ddaaf85, 29551bee, e611a179, c5d8ad09,
dffcdd82, f79305e0; ops/STATE.md 2026-09-22

---

## 0. What changed from v0.1, block by block

Each block from the review maps to a section below and to a WP4 obligation.
The mapping is the contract for retiring the block; the reviewer who placed it
retires it.

| Block | What it required | Where v0.2 answers it |
|---|---|---|
| B1 capability and role admission | explicit classification with unknown fail-closed; per-connection not per-id; inbound role gates | §7.1 WP1 (classification, dual connections), §7.1.4 (inbound gates), WP4 rows P1–P6 |
| B2 local dispatch is not a blanket exception | enumerated operations, not "self or own-rooted"; per-handler proof; notifications | §7.2 WP2 (the allow-list as a table), §7.2.3 (notifications), WP4 rows I1–I6 |
| B3 directory sync | an explicit directory service or nothing; unselected until decided; gate dependents | §7.3 WP3 (decision D2, the service if chosen), §8 gate |
| B4 audit and proof completeness | real transport peer; inventory plus captures; no growing the list to pass | §7.0 WP0 (method), §7.4 WP4 (H0 harness), §10 |
| B5 boundedness and oracles | cardinality, cleanup, aggregation; refusal propagation per caller; egress oracle | §7.2.4, §7.2.5, WP4 rows O1–O4, L1–L2 |
| B6 evidence and scope | retain qualifications; no overstated attribution; decisions are decisions | §3, §4, §9 |
| Vega (1) picker closure | static audit of every next-hop chooser; named defect path in WP4 | §7.1.3, WP4 P1 |
| Vega (2) allow-list vs transit | discovery replies are not forwards; mesh:signal case | §7.2.2, WP4 I4 |
| Vega (3) directory:sync wire | minimal shape, negative test | §7.3.2, WP4 D3 |
| Vega (4) legacy mix | attempted > 0 with forwarded = 0 | WP4 L1 |

## 1. The question

How does a node join the mesh through the bridge without the bridge ever
carrying that node's traffic?

## 2. What the bridge is NOT

The bridge is NOT a router. It is NOT a fallback route. It is NOT a replica, an
heir, a child relay, or a capable adjacent for any topic except the directory
topics it is named to root. It is NOT the place a relay goes when its own mesh
is thin. A relay with four peers and no route to a target gets a refusal, not a
detour.

The bridge IS the introduction service and the directory host, and it keeps
its connections for those two reasons alone.

## 3. What was measured, and what it does and does not show

On 2026-09-22, between the 05:46Z recreate of east (incarnation d49e6921) and
16:54Z, east moved 84.5 GB over 58 client sockets. Two sockets carried 72.6 GB.
Both were grizzly relays on the Air host: slot 2, 466 roles, mesh fallen from
17 peers at 05:50Z to 5 by 12:51Z; slot 6, 400 roles, 13 peers. Every other
client sat at 0 to 3 KB/s. West's uplink carried 1.5 GB over 12.8 h.

Slot 2's health dump over 11.6 h: 27.2 M lookahead calls (654/s), 135 M
probes (3,246/s) across 5 to 8 synapses, 15.6 M sends answered by a probe. Its
XOR-nearest peers answered "closer" 2.7% of the time each. Its farthest peer,
the bridge, answered "closer" 31% of the time with 5 peers and 74% with 8.

East held 2 roles the whole time, both directory roots.

What these show: the two heavy sockets belong to relays whose fallback path
selects the bridge at a high rate, and the bridge's own profile from an
EARLIER incarnation (ffe958cd, 22:43Z on 09-21) was dominated by request
handling, replies and socket writes. What they do not show: the exact frame
mix on the current incarnation, the causal share of each frame class in the
host's saturation, or any general rate. The CPU profile and the socket bytes
are from different incarnations and are not combined into one claim here. The
frame-mix counter (v1.8, offline) is the instrument that would give the mix.

These figures are the reason for the plan. They are not its acceptance test.

## 4. Why it happens

For the sender ids we run today (0x80 and 0x89 relays and clients, 0xFF
bridges), `_greedyNextHopToward` never selects the bridge for a 0x80 or 0x89
target, because the bridge's XOR distance to such a target exceeds the sender's
own. This is a statement about the region layout we run, not a law for
arbitrary ids, and the capability filter in WP1 does not depend on it.

The fallback does select it. `_findCloserInTwoHops` (AxonaPeer.js ~4066–4160)
probes every synapse in the table with `lookahead_probe`, and returns as the next
hop the ADJACENT peer whose reply named a closer node. A five-peer relay's own
peers rarely know anyone closer; the bridge, with 58 synapses, often does. On
slot 2 the bridge's replies were "closer" 31% to 74% of the time against 2.7%
for each near peer. When the bridge is chosen, its `route_msg` handler
greedy-forwards from its own table, awaits the downstream verdict and replies.

Three things make the bridge available to that path:

- The bridge's synaptome cap is 256 (`bridge_engine.js:27`) against a regular
  node's 50 (`AxonaDomain.js:68`); it binds every completed hello as a synapse
  through `_addByVitality`, which evicts the least-vital synapse only at the cap.
- On the client the bridge is auto-admitted at start from
  `transport.boundPeers()` and stays as long as the socket is up.
- Since 2026-09-19 `dht.bridgeId()` returns null (AxonaPeer.js:3560), so the
  cohort, heir and reachable-closest pickers no longer exclude it.

The per-role maintenance schedule supplies the sends: every 5 s tick, a root
with cache or tombstones pushes a REPLICATE keepalive to two cohort members,
renewals and beacons add to it. At 466 roles that is on the order of 200 own
routed sends a second on slot 2, by the routed-outcomes rows. What share of
the bytes each frame class contributes is the frame-mix question and is not
asserted here.

## 5. The invariant

A connection to a bridge is an introduction edge. An introduction edge is never
a forwarding edge and never a role edge: no path that chooses a next hop or a
role holder may select it, and no inbound frame may assign it a role outside
the named directory topics.

The pickers: greedy, lookahead probe set, lookahead first hop, the route_msg
receive scan, cohort, heir, child promotion, reachable-closest,
capable-adjacent, tunneled direct. The inbound gates: REPLICATE, HANDOFF,
ADOPT, and any self-acquired role.

Enforced on the client, so the bridge is never selected or assigned. Enforced on
the bridge, so a client that does not cooperate, whatever its version, gets one
bounded refusal and nothing is forwarded or seated.

The measure of success is zero generic transit FORWARDS at the bridge and zero
roles seated outside the named directory topics. Not zero attempts: old clients
will keep sending. Attempted, refused and forwarded are counted separately, and
forwarded reads zero.

## 6. Scope and non-goals

In scope: WP0 through WP5 below. Not in scope, by David's decision after the
second council round: the 50-connection cap, triadic closure on high-volume
peers, the disconnect-after-closure off-ramp. The Air mesh collapse is its own
defect. The droplet resize is separate. Live rollout is separate and is WP6.

## 7. Work packages

### 7.0 WP0 — Join dependency audit

Two sources, both required, because a capture alone cannot define a complete
list:

1. Source-path inventory. Every `transport.send`, `notify`, `sendDirect` and
   `routeMessage` caller in the kernel and the web transport, with the
   connection it can select. Every `onRequest` and `onNotification` the bridge
   registers. A table, checked in.
2. Captures on harness H0 (§7.4): a cold client joining, a client renewing, a
   client reconnecting with a new identity, a failed join, a client leaving.
   Every `{k, type}` on the bridge socket, both directions.

The allow-list is the intersection of what the inventory says join needs and
what the captures show join uses. A frame that appears in a capture and is not
in the inventory is a finding. A frame the inventory says join needs and no
capture exercises gets a capture.

If join needs a frame that is transit, §10 applies: the invariant does not grow
an exception to make the trace pass. The design changes, or David decides an
explicit named exception.

### 7.1 WP1 — Kernel: connection capability and picker filters

#### 7.1.1 Classification

`Synapse` (dht/Synapse.js) gains `capability`, one of `'unknown'`,
`'introduction'`, `'transport'`. Default `'unknown'`. `'unknown'` is never
eligible for forwarding or roles. Nothing is `'transport'` until the transport
that admitted the connection says so.

Who sets it:

- `BridgeTransport` binds exactly one peer, the bridge's own id
  (`ownsPeer` in transport/web/bridge.js). Peers it reports through
  `boundPeers()` are seeded `'introduction'`.
- `WebRTCTransport` reports peers that completed mesh admission
  (`auth-mesh-complete`, `bindPeer`). Those are seeded `'transport'`.
- The node-WS transport (relays, sim) classifies at bind by the same rule: the
  dialled bridge is `'introduction'`; admitted mesh peers are `'transport'`.
- A transport that reports a peer without stating a class leaves `'unknown'`.

Reconnect invalidates: on socket close or identity change the synapse is
removed; a new connection classifies afresh. Provenance never carries over: a
peer learned through the bridge and admitted over WebRTC is `'transport'`
because WebRTC admitted it, not because of where it was learned.

#### 7.1.2 Two connections to one id

Today an introduction connection and a transport connection cannot share an id:
the bridge transport owns only the bridge's own id, and bridges hold no mesh
channels. The classification is still stored per connection, on the transport's
bound-peer record, and the synapse reads it from the transport that will carry
the send. `CompositeTransport._routeFor` picks the first sub-transport that
owns the id; WP1 changes it to pick the first sub-transport that owns the id
AND reports `'transport'` for that connection when the send is a forward or a
role frame, and to refuse with `NO_TRANSPORT_ROUTE` when none does. Introduction
operations (§7.2.1) pass through the bridge transport by name, never by falling
through. If a future bridge gains a mesh channel, the two connections carry two
classifications and the rule above already applies.

#### 7.1.3 The pickers

One function, `isTransit(peerId)`, answering true only when a connection to
that id exists and is classified `'transport'`. Every chooser of a next hop or
a role holder calls it. The closed list, from a grep of every `routeMessage`,
`sendDirect`, `_route`, `_send`, `transport.send` and `notify` caller in
`src/dht` and `src/pubsub`, is checked in as `docs/TRANSIT-PICKERS.md` in
axona-protocol with file and line, and WP4 row P1 fails if a caller exists that
is not in the table:

- `_greedyNextHopToward`
- `_findCloserInTwoHops`: probe set built from transit synapses only; no
  non-transit synapse ever assigned as `bestPeerId`, even on a legacy reply
- the `route_msg` receive handler's greedy scan (AxonaPeer.js ~950)
- `findKClosest` result consumers that pick a target to route to: repairPlane
  cohort (`want`), `_nearestReachable`, `_pickHeirs`
- `selfClosestReachable`, `pickCapableAdjacent`, `meshBare`
- `_promoteChild` (wireHandlers.js)
- `sendDirect` fallback to `routeMessage` (AxonaPeer.js ~3635)
- `_emitRootBeacons` basin
- `dht.bridgeId()` reinstated, returning the bound introduction ids (a list,
  not one), as a transitional guard for ids that are not in the synaptome.

`findKClosest` and `lookup_step` may still query an introduction connection.
A discovery reply that names a closer peer is permission to route TO that peer
over a transport edge. It is never permission to use the responder as a hop.

#### 7.1.4 Inbound role gates

Filtering selection does not stop a legacy peer from assigning the bridge a
role. Three receivers gain a gate that today they lack or hold only behind the
`neverRoot` boolean:

- `_onAdopt` (wireHandlers.js ~346): today it calls `adoptChild` with no
  admission check. It gains `admitPushedRole(topicBig)`.
- `_syncIngest` for REPLICATE (syncEngine.js ~242): `becomeBackup` on a fresh
  role already passes `admitPushedRole`; it stays, and the gate below makes it
  topic-aware.
- `_syncIngest` for HANDOFF (syncEngine.js ~203): same.
- self-acquired roles through `become()` (rootClaim.js ~321) and
  `_readRepair`: through `admitRole`.

The gate itself: `canAcceptRole(topicBig)` on a node configured as a bridge
refuses HARD for any topic not on its `rootAllowList`. The list is the named
directory topic ids (§7.2.1). This replaces the all-or-nothing
`BRIDGE_NEVER_ROOT` escape hatch that prod runs today with `=0`: the bridge
roots what it is named to root and nothing else. Counters: `role-refused` rows
already exist; they gain `why: 'not-directory'`.

On regular nodes the gate is a no-op. The change is on the bridge's manager
configuration, but the check sites are kernel code and ship in 4.89.0.

#### 7.1.5 Counters

`lookaheadStats()` gains `probesSuppressedByCapability` and
`firstHopsRejectedByCapability`. `_routeStats` gains `noTransportRoute`. The
health dump carries all three.

Version: kernel 4.89.0. The role-fence follow-up already slated for 4.89.0 is
this §7.1.4; it is one decision (§9 D3), not two.

### 7.2 WP2 — Bridge: the ingress allow-list and the refusal

#### 7.2.1 The allow-list, as a table

The bridge dispatches only what is in this table. Anything else is refused
(requests) or dropped and counted (notifications). The table is WP0's output;
the rows below are the current inventory and stand until WP0 confirms or prunes
each one.

| Frame | Kind | Terminates where | Reply | Bound |
|---|---|---|---|---|
| `hello`, `hello-ack` | link | bridge | yes | per connection, once |
| `ping` / `pong` | link | bridge | yes | 1 Hz per connection |
| `peer-list-request` | join | bridge | `peer-list` | rate-limited per connection |
| `signal` | join | one named other client | forwarded as `signal` only | size-capped; to an admitted connection only |
| `turn-refresh` | join | bridge | yes | per connection |
| `lookup_step`, `find_closest_set`, `lookahead_probe`, `local_probe`, `hop_cache` | discovery | bridge's own table | yes | one table scan; no egress |
| `triadic_introduce`, `reinforce`, `lateral_spread`, `presence`, `peer-leaving` | maintenance (ntf) | bridge's own table | none | counted; no egress |
| pub/sub verbs for a named directory topic | directory | bridge as root | verb's own reply | schema-validated; principal-checked for PUB |
| `route_msg` addressed to the bridge's own id carrying one of the above | as above | bridge | verdict | never forwarded |
| `directory:sync` (only if D2 selects it) | directory service | bridge | ack | §7.3.2 |

`signal` is the one row whose payload leaves the bridge toward another client.
It is a point-to-point introduction handoff to a named, admitted connection,
size-capped, and it is NOT counted as transit because it never enters routing.
WP4 row I4 asserts that no `signal` and no `mesh:signal` produces any
`route_msg` egress.

The named directory topics: `axona:bridge-directory` in each region returned by
`bridgeRegions()` (home `eagle`, the bridge's own region, and every region with a
known bridge) plus, until clients that subscribe to it age out, the legacy copy
in region `bridge` (0xFF), which east roots today only because legacy SUBs
terminate there. `DIRECTORY_NEVER_REGIONS` already excludes `bridge` from
publishing. The allowed verbs on those topics: SUB, UNSUB, PULL, PULLUP,
DELIVER (outbound), REPLICATE and HANDOFF between bridges only (§7.3), and PUB
only from a principal whose signer is a known bridge author. Every other verb,
and every verb for any other topic, is refused.

"Self-addressed or own-rooted" in v0.1 is withdrawn. A topic the bridge happens
to root that is not in the named set is a defect to be refused, not an
exception to be honoured. A `route_msg` addressed to the bridge's own id that
carries a nested `__tunneled_direct__` is refused; the inner type is never
dispatched.

#### 7.2.2 What counts as a forward

`transitForwarded` increments only when the bridge emits a `route_msg` toward
another node on behalf of a frame it received. Discovery replies, directory
replies, DELIVER to a directory subscriber, and `signal` relay do not increment
it. `transitAttempted` increments on every received `route_msg` or
`__tunneled_direct__` not addressed to the bridge itself, and on every request
whose type is not in the table. `transitRefused` increments on every such frame
that receives the refusal. Under the invariant, attempted equals refused and
forwarded is zero; WP4 asserts the relationship, not just the zero.

#### 7.2.3 The refusal, per kind

Requests: one reply `{ k:'res', ok:false, body:{ error:'transit-refused' } }`.
For `route_msg` the verdict `{ consumed:false, terminal:true, refused:true,
hops }` so the existing client path ends the walk. Notifications: no reply,
because a notification has no correlation id and a reply to a notification is a
new frame class; the frame is dropped and counted under `ntfDropped` by type.
No reply is ever sent to a reply.

Refusal propagation on the client, per caller, is a WP1 table
(`docs/TRANSIT-REFUSAL-CALLERS.md`): for each `routeMessage` caller, what it
does with `refused:true`. The rule: the operation reports failure to its own
caller with `NO_TRANSPORT_ROUTE`, and the next attempt is the operation's own
existing cadence (repair tick, renewal interval, user retry), never an immediate
retry on the same edge. Non-repair callers (publish, subscribe, pull, kill,
metricson, receipt probes) are in the table by name.

#### 7.2.4 Boundedness

Per-connection counters live on the existing `connections` map entry and die
with it. Aggregate counters are fixed-size integers. Refusal logging is one
aggregated row per minute for the whole bridge, `{ attempted, refused, byType:
top 8 }`, not per connection. Under connection churn the counter cardinality is
the live connection count, already bounded by the synaptome cap. The refusal
path does one map lookup and one small write; no allocation proportional to
the refused payload, which is never parsed past `{k, type, targetId}`.

The load-shape budget for WP4 row L2: a bridge with 60 connected legacy relays
each attempting 200 transit frames a second must hold its refusal path under
15% of one core in the harness, with the parse of the envelope counted and the
payload untouched. That is a design budget for the instrument, not a claim
about host headroom.

#### 7.2.5 Egress oracle

Tests do not trust the counter alone. Harness H0 wraps the bridge's
`sendTo`, `broadcast` and `node.transport.send` and records every outbound
`{ type, to }`. The oracle asserts: zero `route_msg` egress; `signal` egress only
to admitted connections named in the received frame; directory DELIVER only to
directory subscribers; and a minimum count of control frames, so a harness with
the oracle unwired fails rather than reading zero.

Version: bridge 2.132.0. Ordering against the frame-mix branch (2.131.0) is
established by an integration run, not asserted.

### 7.3 WP3 — Directory convergence without transit

#### 7.3.1 The three facts to prove

1. A client's SUB and renewal for a named directory topic reaches the bridge
   that roots it as a directory verb and is dispatched under §7.2.1. DELIVER to
   that subscriber is the bridge's own origin send over that client's socket.
2. A bridge publishes its own entry into the home and regional copies as an
   origin, over its clients' transport edges from the bridge's side. This is
   bounded by the publish cadence in `bridge_directory.js` (POLL_MS 15 s, with
   change detection), which is an enforced bound in the bridge, not an
   observation.
3. A bridge with no clients in a region cannot reach that region's copy without
   transit through another bridge. West today has one client. West's publish
   into the eagle copy reaches east as a first hop and is REFUSED under WP2.

Fact 3 is decision D2 (§9). Nothing that depends on it is implemented until
David decides it.

#### 7.3.2 If D2 selects a directory service

`directory:sync`, a notification on the bridge-to-bridge uplink, in both
directions:

- payload: exactly one entry, the sender's own, `buildBridgeEntry` shape,
  signed by the sender's bridge author; no topic id, no destination, no nested
  frame; size cap 2 KB;
- cadence: on change and at most once per POLL_MS; ingress bound: one accepted
  per peer bridge per POLL_MS, extra dropped and counted;
- on receipt: verify signer is a known bridge author (the book), dedup by
  `(url, issuedTime)`, drop older, then republish INTO THE RECEIVER'S OWN
  REGIONS as origin, never into the sender's regions, never re-exported to a
  third bridge (no re-export loop by construction: an entry is republished only
  by a bridge that received it directly from its author);
- expiry: entries age out of the book on the existing TTL.

WP4 row D3 sends a sync frame with an embedded destination, an oversize
payload, an unknown signer, and a replay; each is refused and `transitForwarded`
stays zero.

The alternative to D2 is to require every bridge to hold at least one client in
each region it publishes to, which is a deployment constraint, not a protocol.

### 7.4 WP4 — Offline verification matrix

Harness H0: two axona-relay processes with real WebRTC (node-datachannel) plus
one bridge on the node-WS transport, all on one host, plus one synthetic client
that speaks the wire protocol directly. This is the smallest arrangement that
exercises signalling and direct admission for real. What it cannot establish:
NAT traversal, TURN, browser WebRTC stacks, and mesh behaviour beyond three
nodes; those are named as out of the offline proof and belong to WP6.

Rows, each with a pass condition; a row whose instrumentation is absent FAILS.

Pickers (P):
- P1 static audit: every caller in `docs/TRANSIT-PICKERS.md` exists in source
  and calls `isTransit`; a grep finds no chooser outside the table. Named:
  `_greedyNextHopToward`, `_findCloserInTwoHops`.
- P2 lookahead: a relay whose only closer-knowing synapse is the bridge; assert
  no probe is sent to the bridge and no first hop is the bridge; operation
  reports `NO_TRANSPORT_ROUTE`.
- P3 cohort, heir, child, capable-adjacent, reachable-closest: a table where
  the bridge is the only candidate; assert it is never chosen.
- P4 provenance: a peer discovered through the bridge and admitted over WebRTC
  is `'transport'`; the bridge is `'introduction'`; reconnect and identity
  change re-classify; a transport that reports no class leaves `'unknown'` and
  `'unknown'` is never selected.
- P5 inbound roles: a legacy root sends ADOPT, REPLICATE and HANDOFF to the
  bridge for a non-directory topic; assert refused, no role seated,
  `role-refused why:'not-directory'`.
- P6 same id, two connections: constructed on the sim transport; assert the
  send selects the transport connection and refuses when only the introduction
  one exists.

Ingress (I):
- I1 zero transit: four sparse nodes and the bridge; publish, subscribe, get;
  `transitForwarded === 0` exactly, oracle agrees.
- I2 hostile and legacy: `route_msg`, nested `__tunneled_direct__`, a pub/sub
  verb for a foreign topic, a self-addressed nested tunnel; each gets one
  refusal, zero egress, no retry inside the caller's cadence.
- I3 per-handler terminal proof: for each row of §7.2.1, the oracle shows no
  `route_msg` egress while the handler runs.
- I4 `signal` and `mesh:signal`: relay to a named admitted connection only;
  zero routing egress; oversize and unknown-destination dropped.
- I5 notifications: an unlisted notification is dropped and counted; no reply
  is emitted; a reply-shaped frame gets no reply.
- I6 replay and directory: a replayed sync, an expired entry, a PUB from an
  unknown signer into a directory topic; each refused.

Directory (D):
- D1 two bridges, both with clients: both copies converge.
- D2 two bridges, one without in-region clients: converges only through the
  D2 mechanism, or the row records that it does not and §10 applies.
- D3 sync negatives as §7.3.2.

Oracles and bounds (O, L):
- O1 counter relationships: `attempted === refused + forwarded` and
  `forwarded === 0` under I1 and I2.
- O2 unwired instrumentation fails the run.
- O3 legitimate egress is enumerated and matched, not waived.
- O4 refusal propagation: each caller in `docs/TRANSIT-REFUSAL-CALLERS.md`
  observed to surface `NO_TRANSPORT_ROUTE` and to wait its own cadence.
- L1 legacy mix: `transitAttempted > 0` and `transitForwarded === 0` with an
  old client present; bridge-local directory handling does not increment
  forwarded.
- L2 load shape: 60 synthetic relays at 200 attempts a second each; refusal
  path under the §7.2.4 budget; counters bounded; one log row per minute.

Failed and cancelled joins, renewal, reconnect with identity change, and a
client leaving mid-join are captures in WP0 and rows under P4 and I2.

Author tests alone are not acceptance. Vega's independent code challenge runs
against a tagged commit after the plan is accepted. Aster CP reviews the
design against this document.

### 7.5 WP5 — Docs and versions

Architecture note: "The bridge is an introduction, not a road", §5 verbatim.
Wire protocol: the `refused` verdict field, the `transit-refused` error, the
`capability` classification, and `directory:sync` if selected.
SECURITY-CHANGELOG: an entry, since this is a boundary. RELEASE-NOTES for
4.89.0 and 2.132.0. RELEASE-PROCEDURE: the counters to read after any later
promotion. Relay pins follow the kernel.

### 7.6 WP6 — What rollout will need, decided separately

Not authorised here. When David decides it: a fresh baseline on the incarnation
being replaced, the three transit counters and the role-refused counter read
before and after, join success for a cold client, the directory converging in
every named copy, and a rollback that is the previous image with the same
`.env`. Zero forwards does not prove host headroom; parsing, probes, refusal
replies, signalling and CPU steal are measured separately.

## 8. Order and review gates

1. WP0 inventory and captures, and the WP3 design note carrying decision D2,
   posted with hashes. No implementation of anything that depends on D2 until
   David decides D2.
2. WP1 and WP2 on local branches (`air-gap-4.89.0` in axona-protocol,
   `air-gap-2.132.0` in axona-bridge), WP4 growing alongside. Nothing pushed
   until David okays a push for review.
3. Independent review: Vega's code challenge on a tagged commit, Aster CP's
   design review against this document. A BLOCK is retired only by its placer.
4. Merge to testnet on David's word. Testnet is a rollout and belongs to WP6.

## 9. Decisions for David, each with what depends on it

- D1 `lookahead_probe` at the bridge: keep answering (discovery, one table
  scan) or refuse (one fewer frame class on a saturated host). WP2 table row
  and WP4 I3 depend on it. The plan as written answers it.
- D2 directory reach for a bridge with no in-region clients: the
  `directory:sync` service (§7.3.2), or the deployment constraint. WP3, WP4 D2
  and D3, and the uplink allow-list row depend on it.
- D3 whether the inbound role gate (§7.1.4) ships in 4.89.0 as the role-fence
  follow-up. WP1 §7.1.4 and WP4 P5 depend on it.
- D4 version numbers 4.89.0 and 2.132.0, and the order against the frame-mix
  branch, which an integration run establishes.

## 10. What would make this plan wrong

If WP0 finds that join needs a frame that is transit, the design changes or
David names an explicit exception; the allow-list is not grown to pass a test.
If WP4 D2 cannot show convergence without transit under the chosen D2, the
directory needs its own service before anything ships. If a refused caller
retries inside its cadence, §7.2.3's table is wrong for that caller and WP1
fixes the caller. If the bridge's refusal path exceeds the §7.2.4 budget, the
instrument is the load and WP2 changes before rollout is considered. Each of
these is a WP4 row, not a rollout surprise.
