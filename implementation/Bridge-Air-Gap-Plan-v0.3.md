# Bridge Air-Gap — Project Plan — v0.3

**Status:** proposed, revision of v0.2 under Aster CP residuals 16ab4f80
(B1, B2, B3, B5 open; B4, B6 retired); for council review before implementation
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Supersedes:** v0.2 (sha256 3e8f8a9a…) and v0.1 (sha256 866b123f…), both kept as
hashed snapshots and not modified. v0.3 restates the whole plan so it reads
alone; sections unchanged from v0.2 are marked.
**Kernel baseline:** `@axona/protocol` v4.88.0; `axona-bridge` 2.130.0; `axona-relay` 0.132.0
**Companions:** council e8282dcd, 8ddaaf85, 29551bee, e611a179, c5d8ad09,
dffcdd82, 16ab4f80, 1b240ad1, f9a2d722; ops/STATE.md 2026-09-22

---

## 0. Residual map

| Residual | What it required | Where v0.3 answers it |
|---|---|---|
| B1a role and operation, not topic alone | a matrix: directory topics get local root/service duties only; backup, child, heir, transit denied even there | §7.1.4 matrix, WP4 P5 |
| B1b async pinning | the chosen connection and its generation pinned through probe and dispatch; no fallback to a same-id introduction edge | §7.1.2, WP4 P6 |
| B1c class at every egress | composite routing enforces operation class on uplinks and direct sends too | §7.1.2, §7.2.6 (the bridge's own sends), WP4 O3 |
| B2a undeveloped bridge-to-bridge REPLICATE/HANDOFF row | remove or design separately | §7.2.1: removed; the uplink carries only what §7.2.1 lists |
| B2b nested wrapper | reject the self-addressed `route_msg` wrapper or enumerate it with its own checks | §7.2.1: rejected; only bare frames are dispatched |
| B2c mesh:signal | choose or refuse explicitly | §7.2.1: refused at the bridge; WP4 I4 tests the refusal |
| B2d ping/pong by wire kind | no reply-to-reply | §7.2.1 rows, §7.2.3 |
| B2e sync ack vs no-notification-reply | reconcile | §7.3.2: sync is a request, not a notification |
| B3 sync binding and convergence | ownership binding, canonical fields, timestamps, replay, refresh, deterministic destinations, overlap | §7.3.2, WP4 D2–D5 |
| B5a bounds independent of connection count | fixed slots, overflow aggregate, fixed type taxonomy | §7.2.4 |
| B5b decode reality | frame size, decoder, schema limits; measured path; reproducible budget | §7.2.4, §7.2.5 |
| B5c exclusive outcomes and semantic egress | one outcome per received frame; egress classes; causal link; positive controls; direct socket writes | §7.2.2, §7.2.6, WP4 O1–O5 |
| WP0 finding 1 | the bridge's own `sendDirect` falls back to a routed `__tunneled_direct__` through a client (bridge_engine.js:184–193) | §7.2.6 |
| WP0 finding 2 | unknown notifications are dropped silently and uncounted (ws_transport.js `_handleNotification`) | §7.2.3 |

## 1. The question (unchanged)

How does a node join the mesh through the bridge without the bridge ever
carrying that node's traffic?

## 2. What the bridge is NOT

The bridge is NOT a router. It is NOT a fallback route. It is NOT a replica, an
heir, a child relay, or a capable adjacent for ANY topic, the directory topics
included. It is NOT the place a relay goes when its own mesh is thin.

The bridge IS the introduction service, and for the named directory topics it
IS the local root that serves subscribers directly. Those are its two duties.
"Local root" means it seats subscribers, replays to them and delivers to them
over their own sockets. It does not mean it takes backup, child or heir duty
for those topics from anyone, and it does not mean it forwards.

## 3. What was measured, and what it does and does not show (unchanged from v0.2)

On 2026-09-22, between the 05:46Z recreate of east (incarnation d49e6921) and
16:54Z, east moved 84.5 GB over 58 client sockets. Two sockets carried 72.6 GB,
both grizzly relays on the Air host: slot 2 with 466 roles and a mesh fallen
from 17 peers at 05:50Z to 5 by 12:51Z; slot 6 with 400 roles and 13 peers.
Every other client sat at 0 to 3 KB/s. West's uplink carried 1.5 GB over 12.8 h.

Slot 2's health dump over 11.6 h: 27.2 M lookahead calls (654/s), 135 M probes
(3,246/s) across 5 to 8 synapses, 15.6 M sends answered by a probe. Its
XOR-nearest peers answered "closer" 2.7% of the time each; its farthest peer,
the bridge, 31% with 5 peers and 74% with 8. East held 2 roles the whole time,
both directory roots.

What these show: the two heavy sockets belong to relays whose fallback path
selects the bridge at a high rate, and the bridge's profile from an EARLIER
incarnation (ffe958cd, 22:43Z on 09-21) was dominated by request handling,
replies and socket writes. What they do not show: the frame mix on the current
incarnation, the causal share of each frame class in the host's saturation, or
a general rate. These figures are the reason for the plan, not its acceptance
test.

## 4. Why it happens (unchanged from v0.2)

For the ids we run (0x80 and 0x89 relays and clients, 0xFF bridges),
`_greedyNextHopToward` never selects the bridge for a 0x80 or 0x89 target. That
is the measured region case, not a law for arbitrary ids, and the capability
filter does not depend on it. The fallback `_findCloserInTwoHops` (AxonaPeer.js
~4066–4160) probes every synapse and returns as the next hop the ADJACENT peer
whose reply named a closer node; with 58 synapses the bridge is that peer far
more often than a five-peer relay's own neighbours are. The bridge is available
to that path because its synaptome cap is 256 (`bridge_engine.js:27`) against
50 for a regular node, because the client auto-admits it at start and keeps it
while the socket is up, and because `dht.bridgeId()` has returned null since
2026-09-19. The sends come from per-role maintenance: a REPLICATE keepalive to
two cohort members every 5 s tick per root with cache or tombstones, plus
renewals and beacons; on slot 2 about 200 own routed sends a second.

## 5. The invariant

A connection to a bridge is an introduction edge. An introduction edge is never
a forwarding edge and never a role edge, and the bridge itself takes no role
but local root of the named directory topics.

Pickers that may never select it: greedy, lookahead probe set, lookahead first
hop, the route_msg receive scan, cohort, heir, child promotion,
reachable-closest, capable-adjacent, tunneled direct. Inbound frames that may
never seat a role on it: REPLICATE, HANDOFF, ADOPT. Roles it may never acquire
by itself: any root outside the named directory topics.

Enforced on the client, so the bridge is never selected or assigned. Enforced on
the bridge, so a client that does not cooperate, whatever its version, gets one
bounded refusal and nothing is forwarded or seated. Enforced on the bridge's
OWN sends, so the bridge never uses a client as a hop either.

The measure of success: zero generic transit forwards at the bridge, zero roles
on the bridge outside the matrix in §7.1.4, and every received frame accounted
for by exactly one outcome.

## 6. Scope and non-goals (unchanged from v0.2)

In scope: WP0 through WP5. Not in scope, by David's decision: the 50-connection
cap, triadic closure, the disconnect-after-closure off-ramp. The Air mesh
collapse is its own defect. The droplet resize is separate. Live rollout is
separate and is WP6.

## 7. Work packages

### 7.0 WP0 — Join dependency audit (unchanged in method; two findings added)

Two sources, both required: a source-path inventory of every send site and
every registered handler, and captures on harness H0 of a cold join, a renewal,
a reconnect with new identity, a failed join and a leave. The allow-list is the
intersection. A frame that appears in a capture and not in the inventory is a
finding. If join needs a frame that is transit, §10 applies.

The inventory draft already holds every chooser, every routed send by file and
line, every direct send and notify, every frame the kernel serves, and every
handler the bridge registers. Two findings from it are folded into WP2:

1. `bridge_engine.js:184–193`: the bridge's own `dht.sendDirect` falls back to
   `peer.routeMessage(peerId, '__tunneled_direct__')` when the target client is
   not connected on its socket transport. That routed send leaves through a
   CLIENT as first hop. The bridge is an origin using clients as transport.
   §7.2.6 closes it.
2. `ws_transport.js` `_handleNotification`: a notification with no handler
   returns without a trace. `sendDirect` on a client is a notification named
   `direct_<type>`, so a legacy client's direct pub/sub frames to the bridge
   vanish uncounted today. §7.2.3 counts them.

### 7.1 WP1 — Kernel: connection capability and picker filters

#### 7.1.1 Classification (unchanged from v0.2)

`Synapse` gains `capability`, one of `'unknown'`, `'introduction'`,
`'transport'`. Default `'unknown'`; `'unknown'` is never eligible for forwarding
or roles. `BridgeTransport`'s one bound peer, the bridge's own id, is
`'introduction'`. Peers admitted by `WebRTCTransport` (`auth-mesh-complete`,
`bindPeer`) are `'transport'`. The node-WS transport classifies by the same
rule. A transport that reports a peer without a class leaves `'unknown'`.
Reconnect and identity change remove the synapse; a new connection classifies
afresh. Provenance never carries over.

#### 7.1.2 Pinning the connection through an operation

The class lives on the transport's bound-peer record together with a
`generation` counter that increments on every bind for that id. A send that
chose a connection carries `(id, transport, generation)` to the point of
egress. At egress the transport checks that the record still matches; if the
connection closed or rebound since the choice, the send fails with
`NO_TRANSPORT_ROUTE` and no other connection to that id is tried. This holds
across the asynchronous gap between a lookahead probe and the forward it
informed, and between a picker's choice and a later `_syncPush`.

`CompositeTransport._routeFor(id, opClass)` takes the operation class. For
`'forward'` and `'role'` it returns the sub-transport that owns the id AND
whose record for that connection is `'transport'`; otherwise null, and the
caller gets `NO_TRANSPORT_ROUTE`. For `'introduction'` it returns the bridge
transport by name. There is no fall-through between the two. This is the single
egress gate on the client and, because the bridge runs the same composite,
on the bridge's own sends and its uplink (§7.2.6).

Today the two classes cannot share an id: `BridgeTransport.ownsPeer` is true
only for the bridge's own id, and bridges hold no mesh channel. The pinning
rule above does not depend on that staying true.

#### 7.1.3 The pickers (unchanged from v0.2)

One function, `isTransit(peerId)`, true only when a connection to that id
exists and is `'transport'`. The closed list of callers, from a grep of every
`routeMessage`, `sendDirect`, `_route`, `_send`, `transport.send` and `notify`
site in `src/dht` and `src/pubsub`, is checked in as
`docs/TRANSIT-PICKERS.md` with file and line, and WP4 P1 fails if a chooser
exists that is not in the table: `_greedyNextHopToward`,
`_findCloserInTwoHops` (probe set and `bestPeerId`), the `route_msg` receive
scan, the cohort `want`, `_nearestReachable`, `_pickHeirs`,
`selfClosestReachable`, `pickCapableAdjacent`, `meshBare`, `_promoteChild`,
`_pickChild`, `_emitRootBeacons`, the `sendDirect` routed fallback,
`_evictAndReplace` and `_localCandidate` for the synaptome itself, and
`dht.bridgeId()` reinstated as a list of introduction ids.

Discovery replies name peers to route TO over transport edges. They never make
the responder a hop.

#### 7.1.4 The role matrix

Admission is decided by (topic class, role, operation), not by topic alone.

| Topic class | local root | serve subscribers (SUB, renewal, replay, DELIVER out) | accept backup (REPLICATE in) | accept heir (HANDOFF in) | accept child (ADOPT in) | forward | publish as origin |
|---|---|---|---|---|---|---|---|
| named directory topic | yes, by self-claim only | yes | NO | NO | NO | NO | yes, own entry only |
| any other topic | NO | NO | NO | NO | NO | NO | NO |

The named directory topics: `axona:bridge-directory` in each region of
`bridgeRegions()` plus, until its subscribers age out, the legacy copy in
region `bridge` (0xFF). The set is computed from configuration, not learned
from traffic.

Where it is enforced, all in kernel code shipped in 4.89.0 and switched on by
the bridge's manager configuration:

- `canAcceptRole(topicBig, role, op)` on a bridge-configured manager: HARD
  refusal for every cell marked NO. On regular nodes it is the existing
  behaviour.
- `_onAdopt` (wireHandlers.js ~346): today it calls `adoptChild` with no
  admission check. It gains the check; a bridge refuses ADOPT for every topic.
- `_syncIngest` REPLICATE (syncEngine.js ~242) and HANDOFF (~203): through the
  matrix; a bridge refuses both for every topic, the directory included. A
  bridge that receives another bridge's REPLICATE for a directory copy refuses
  it; bridges do not replicate to one another (§7.2.1).
- `become()` (rootClaim.js ~321) and `_readRepair`: a bridge may self-claim
  root only for a named directory topic.

`role-refused` rows gain `why: 'not-directory'` and `why: 'role-not-allowed'`.
WP4 P5 sends ADOPT, REPLICATE and HANDOFF to a bridge for a named directory
topic and for a foreign topic and asserts refusal for all six.

The consequence for durability is stated, not hidden: a directory copy rooted
on a bridge has no backup on another bridge. Its durability is the book each
bridge keeps and republishes on restart, which is how it works today.

#### 7.1.5 Counters (unchanged from v0.2)

`lookaheadStats()` gains `probesSuppressedByCapability` and
`firstHopsRejectedByCapability`; `_routeStats` gains `noTransportRoute`; the
health dump carries them.

Version: kernel 4.89.0. §7.1.4 is the role-fence follow-up; one decision, D3.

### 7.2 WP2 — Bridge: ingress, outcomes, egress

#### 7.2.1 The allow-list, by wire kind

Every frame on the bridge socket is `{k: 'req'|'res'|'ntf', type, ...}` inside
an `'axona'` envelope, or one of the five bare server frames. The table is by
wire kind, because the reply rule depends on it. Everything not in the table is
refused (requests) or dropped and counted (notifications, responses). Bare
frames outside the five are dropped and counted.

| Frame | Wire kind | Terminates where | Reply | Bound |
|---|---|---|---|---|
| `hello` | ntf, bridge → client | client | none | once per connection |
| `hello-ack` | ntf, client → bridge | bridge | none | once per connection |
| `ping` (bare) | request-like bare frame | bridge | bare `pong` | 1 Hz per connection |
| `pong` (bare, unsolicited) | bare | dropped, counted | none | — |
| `peer-list-request` (bare) | bare | bridge | bare `peer-list` | rate-limited per connection |
| `signal` (bare) | bare | one named admitted connection | forwarded as bare `signal` | size cap; destination must be admitted |
| `turn-refresh` (bare) | bare | bridge | bare reply | per connection |
| `lookup_step`, `find_closest_set`, `local_probe` | req | bridge's own table | res | one table scan; no egress |
| `lookahead_probe` | req | bridge's own table | res | D1: answered (default) or refused |
| `hop_cache`, `triadic_introduce`, `reinforce`, `lateral_spread` | ntf | bridge's own table | none | counted; no egress |
| `presence`, `peer-leaving` | ntf | bridge | none | counted |
| `route_msg` addressed to the bridge's own id, carrying a pub/sub verb for a named directory topic (SUB, UNSUB, PULL, PULLUP) | req | bridge as local root | res: the verdict | schema-validated; the inner verb is dispatched by name from this short list; nothing else nested is dispatched |
| `route_msg` addressed to a named directory TOPIC id for which the bridge is terminal (the 0xFF copy today), same verbs | req | bridge as local root | res: the verdict | as above |
| `directory:sync` | req, bridge ↔ bridge on the uplink only | bridge | res: ok or refused | §7.3.2; only if D2 selects it |
| any other `route_msg`, any `__tunneled_direct__`, any `mesh:signal`, any `direct_*` notification, any `axona:direct` | req or ntf | refused / dropped | res `transit-refused` for req; none for ntf | counted by outcome |

Removed from v0.2: the row allowing REPLICATE and HANDOFF between bridges. No
such protocol is designed; the uplink carries only the rows above.

The nested wrapper is rejected. A `route_msg` addressed to the bridge is
dispatched only when its inner type is one of the four directory verbs and its
topic is named. A `route_msg` carrying `signal`, `lookup_step`, another
`route_msg`, a `__tunneled_direct__` or anything else is refused with one
verdict. No wrapper inherits the table.

`mesh:signal` is refused. The bridge relays signalling only as the bare
`signal` frame to a named admitted connection. A bridge is never a WebRTC
endpoint, so no `mesh:signal` can be addressed to it, and one that arrives is a
routed frame for someone else.

`ping` and `pong` are bare server frames, not the `req/res` pair; `pong` is the
bridge's reply to `ping` and is never replied to; an unsolicited `pong` from a
client is dropped and counted. No `res` is ever answered.

#### 7.2.2 One outcome per received frame

Every received frame is assigned exactly one outcome, and the counters are the
partition. Requests (`req` and the request-like bare frames):

- `dispatchedLocal`: in the table, handled at the bridge, one reply.
- `signalRelayed`: bare `signal` forwarded to its named admitted destination.
- `refusedUnlisted`: type not in the table.
- `refusedTransit`: `route_msg` or `__tunneled_direct__` not addressed to the
  bridge or to a named directory topic it is terminal for.
- `refusedNested`: addressed to the bridge but carrying an inner type outside
  the four directory verbs, or a non-named topic.
- `refusedSchema`: in the table but failing its schema or size check.
- `refusedRate`: in the table but over its per-connection bound.

Notifications (`ntf` and the bare non-request frames):

- `dispatchedLocal`, `droppedUnlisted`, `droppedDirect` (`direct_*`,
  `axona:direct`), `droppedUnsolicited` (`pong`, any `res` with no pending
  id), `droppedSchema`.

`transitAttempted` is defined as `refusedTransit + refusedNested +
droppedDirect + (forwardedGeneric)`, and `forwardedGeneric` is the count of
generic-transit egress (§7.2.6), which the invariant holds at zero. The
relationship WP4 O1 asserts: every received frame is in exactly one bucket,
the buckets sum to frames received, and `forwardedGeneric === 0`.

#### 7.2.3 Refusal and drop, per wire kind

Requests: one `res` `{ ok:false, body:{ error:'transit-refused', outcome } }`;
for `route_msg`, the verdict `{ consumed:false, terminal:true, refused:true,
hops }` so the client ends the walk. Notifications: no reply; dropped and
counted under the outcome above with a FIXED type taxonomy: the listed types,
`direct_*` collapsed to one bucket, and `other`. No map keyed by an
attacker-chosen string. Responses with no pending id: dropped and counted, no
reply. Bare frames outside the five: dropped and counted.

Refusal propagation on the client, per caller, is the WP1 table
`docs/TRANSIT-REFUSAL-CALLERS.md`: each `routeMessage` caller, what it does with
`refused:true`, and its own retry cadence (repair tick, renewal interval, user
retry). No caller retries on the same edge inside its cadence. Non-repair
callers (publish, subscribe, unsubscribe, pull, kill, touch, metricson,
receipt probe, ingest ack) are rows.

#### 7.2.4 Bounds, stated for the real decoder

The decoder is `JSON.parse(data, bigintReviver)` over the whole frame
(server.js:1222). Every received frame is fully decoded before classification.
"Never parsed past the envelope" is withdrawn. The bounds that hold instead:

- Frame size: a `maxPayload` on the websocket server, decision D5 (today the
  `ws` default applies, which is 100 MiB; the plan proposes 64 KiB, with the
  largest legitimate frame measured in WP0 to set it). Over-size frames are
  closed by the server before decode.
- Decode cost is therefore bounded by the frame cap times the frame rate, and
  it is the dominant refusal-path cost, not a constant.
- Schema checks for dispatched rows are closed schemas with field counts,
  string lengths and nesting depth, in the style of the frame-mix validator.
- Counters: fixed-size integers per outcome bridge-wide; per-connection
  counters in a fixed array of `N` tracked slots (D5 proposes `N` = the
  synaptome cap, 256) plus one overflow aggregate for connections beyond the
  slots, so instrumentation is bounded whatever the connection count and does
  not depend on the connection lifecycle being coupled to the synaptome.
- Logging: one aggregated row per minute bridge-wide with the outcome counts
  and the fixed-taxonomy top 8; no per-connection rows on the refusal path.

#### 7.2.5 The load-shape measurement (WP4 L2), made reproducible

Harness H0 on one core of the M4 host (arm64, Node 24), duration 10 minutes,
60 synthetic connections each sending 200 frames a second: a mix of 70% valid
`route_msg` of 300 bytes addressed to foreign ids, 20% `direct_*`
notifications of 2 KB, 10% nested wrappers of 1 KB, all valid JSON. Measured:
`process.cpuUsage()` over the run, event-loop lag p50/p99 (`perf_hooks`
monitorEventLoopDelay), inbound queue depth from the ws backpressure counter,
and the outcome counters. The budget: under 15% of the core and p99 lag under
20 ms at that load. It is a budget for the instrument on that host; it claims
nothing about a droplet with 50% steal.

#### 7.2.6 The bridge's own egress, classified

Every frame the bridge sends is classified at the lowest write, the
`ws.send` in `sendToConn` and the transport's `send`/`notify`, into one of:

- `controlReply`: `res` to a dispatched request, bare `pong`, `peer-list`,
  `turn-refresh` reply, `hello`.
- `signalRelay`: bare `signal` to a named admitted connection, causally
  linked to the received `signal` by connection and sequence.
- `discoveryReply`: `res` to `lookup_step`, `find_closest_set`,
  `local_probe`, `lookahead_probe`.
- `directoryServe`: DELIVER, replay and PULLRESP to a subscriber of a named
  directory topic, over that subscriber's own socket, causally linked to the
  subscription record.
- `directoryOrigin`: the bridge's own entry publish or `directory:sync`,
  causally linked to a book change or the sync cadence, and sent ONLY over an
  `'introduction'`-class egress rule that permits exactly these two frames.
- `genericTransit`: anything else that carries a received frame or a routed
  payload toward another node. The invariant holds this at zero.

This closes WP0 finding 1. The bridge's `dht.sendDirect` (bridge_engine.js
~184) no longer falls back to `routeMessage`; if the subscriber's socket is not
open, the DELIVER fails with `NO_TRANSPORT_ROUTE` and the subscription lapses
on its renewal. The bridge publishes its own entry into the regional copies as
an origin over its clients' sockets; that is `directoryOrigin`, counted and
matched to a book change, not exempted by name.

Version: bridge 2.132.0. Ordering against the frame-mix branch (2.131.0) is
established by an integration run.

### 7.3 WP3 — Directory convergence without transit

#### 7.3.1 The three facts to prove (unchanged from v0.2)

1. A client's SUB and renewal for a named directory topic reaches the bridge
   that roots it and is dispatched as a directory verb; DELIVER back is
   `directoryServe` over the subscriber's socket.
2. A bridge publishes its own entry into the home and regional copies as an
   origin, bounded by `bridge_directory.js` (POLL_MS 15 s with change
   detection), an enforced bound.
3. A bridge with no clients in a region cannot reach that region's copy
   without transit through another bridge. This is decision D2.

#### 7.3.2 If D2 selects the sync service

`directory:sync` is a REQUEST on the uplink (`k:'req'`), replied with
`{ ok:true }` or `{ ok:false, body:{ error } }`, so it obeys the no-notification-
reply rule and the sender learns refusal. Both directions.

Canonical signed fields, the `buildBridgeEntry` shape as it exists: `url`,
`lat`, `lng`, `label`, `ver`, `ts`, plus `turn` when present. The signature is
the bridge author's Ed25519 over the canonical JSON of exactly those fields.
Ownership binding: the book pins, per `url`, the author public key that first
presented a valid entry for it; a later entry for the same `url` from a
different key is refused and counted, and re-keying a bridge is an operator
action that clears the pin. `nodeId` is not in the entry and is not bound;
the entry names a URL, and the URL is what clients dial.

Timestamps: `ts` must be within `SKEW_MAX` of the receiver's clock in the
future (D6, proposed 5 minutes) and newer than the retained `lastTs` for that
`url`; equal `ts` keeps the retained entry and counts a duplicate; older is a
replay and is refused. Replay state: `lastTs` per `url` is retained for
`2 × TTL` after the entry expires, so an expired entry cannot be revived by an
old replay; after `2 × TTL` the pin is dropped and the url starts fresh.
Refresh: a sender re-sends an unchanged entry at `TTL / 2` so an unchanged
bridge does not expire from the peer's book; change detection sends sooner.
Ingress bound: one accepted sync per peer bridge per `POLL_MS`, extras
counted and refused.

Destination set, deterministic: the receiver republishes an accepted entry
into exactly the copies it roots or publishes to for its OWN configuration:
`{ home, receiverRegion }`. It never derives destinations from the sender's
entry. If sender and receiver share a region the copy receives the entry twice
by two origins with the same signature and `msgId`, which the kernel's
content dedup collapses. No re-export: a republished entry is marked
`viaSync` in the book and is never sent on another uplink; only an entry the
bridge authored itself is sent on its uplinks.

Tests, WP4 D2–D5: two bridges with overlapping regions; unchanged-entry
refresh across `TTL / 2`; expiry then a replay of the expired entry; reconnect
of the uplink mid-sync; three bridges with two uplinks, asserting no entry
crosses two uplinks; a sync with a foreign key for a pinned url; an oversize
sync; a future-skewed `ts`.

The alternative to D2 stays: require every bridge to hold at least one client
in each region it publishes to, a deployment constraint.

### 7.4 WP4 — Offline verification matrix

Harness H0 (unchanged): two axona-relay processes with real WebRTC
(node-datachannel) plus one bridge on the node-WS transport plus one synthetic
wire client, one host. Out of its reach and named: NAT traversal, TURN, browser
stacks, meshes beyond three nodes.

Rows, each with a pass condition; absent instrumentation FAILS.

Pickers:
- P1 static audit: every caller in `docs/TRANSIT-PICKERS.md` exists and calls
  `isTransit`; no chooser outside the table. Named: `_greedyNextHopToward`,
  `_findCloserInTwoHops`.
- P2 lookahead: the bridge is the only closer-knowing synapse; no probe to it,
  no first hop through it, `NO_TRANSPORT_ROUTE`.
- P3 cohort, heir, child, capable-adjacent, reachable-closest: the bridge is
  the only candidate; never chosen.
- P4 provenance and classification: through-bridge peer admitted over WebRTC
  is `'transport'`; bridge is `'introduction'`; reconnect and identity change
  re-classify; unclassified is `'unknown'` and never selected.
- P5 role matrix: ADOPT, REPLICATE, HANDOFF to a bridge for a named directory
  topic AND for a foreign topic; six refusals; self-claim of a foreign topic
  refused; self-claim of a directory topic allowed.
- P6 pinning: the chosen transport edge closes between probe and forward
  while the introduction edge to the same id remains (sim transport); the send
  fails `NO_TRANSPORT_ROUTE`; no fallback.

Ingress:
- I1 zero transit: four sparse nodes and the bridge; publish, subscribe, get;
  `forwardedGeneric === 0`, oracle agrees.
- I2 hostile and legacy: `route_msg` to a foreign id, nested wrapper carrying
  `signal`, nested `__tunneled_direct__`, a foreign-topic verb, a `direct_*`
  notification, an unsolicited `pong`, a `res` with no pending id; one
  outcome each, zero egress beyond the reply, no retry inside the caller's
  cadence.
- I3 per-row terminal proof: for each table row, the oracle shows only the
  row's own egress class while the handler runs.
- I4 signalling: bare `signal` to a named admitted connection relays once;
  `mesh:signal` is refused; oversize and unknown-destination `signal` dropped.
- I5 notifications: unlisted, `direct_*` and `axona:direct` dropped and
  counted in the fixed taxonomy; no reply.
- I6 directory ingress: PUB from an unknown key, from a wrong key for a pinned
  url, over-size, and a replay; refused.

Directory:
- D1 two bridges, both with clients: both copies converge.
- D2 two bridges, one without in-region clients: converges only through the
  selected D2 mechanism, or the row records that it does not and §10 applies.
- D3 sync negatives: embedded destination, oversize, unknown key, replay.
- D4 overlapping regions, refresh at `TTL / 2`, expiry then replay.
- D5 three bridges, two uplinks: no entry crosses two uplinks; uplink
  reconnect mid-sync.

Oracles and bounds:
- O1 partition: outcomes sum to frames received; `forwardedGeneric === 0`;
  `transitAttempted` equals its definition.
- O2 unwired instrumentation fails the run: each interception point (the
  `ws.send` in `sendToConn`, `transport.send`, `transport.notify`) must record
  a known positive-control frame sent through it during setup, or the run
  fails.
- O3 semantic egress: every egress is in exactly one class of §7.2.6, with
  `directoryServe` and `directoryOrigin` matched to their causal records
  (subscription, book change) and any unmatched frame classed
  `genericTransit`.
- O4 refusal propagation: each caller in `docs/TRANSIT-REFUSAL-CALLERS.md`
  surfaces `NO_TRANSPORT_ROUTE` and waits its own cadence.
- O5 the bridge's own sends: a DELIVER to a subscriber whose socket is closed
  fails `NO_TRANSPORT_ROUTE` with no routed fallback (WP0 finding 1).
- L1 legacy mix: `transitAttempted > 0` and `forwardedGeneric === 0` with an
  old client present.
- L2 load shape as §7.2.5.

Author tests alone are not acceptance. Vega's independent code challenge runs
against a tagged commit after the plan is accepted. Aster CP reviews the
design against this document.

### 7.5 WP5 — Docs and versions (unchanged from v0.2)

Architecture note section; wire protocol additions (`capability`, `refused`,
`transit-refused`, `directory:sync` if selected, the outcome taxonomy);
SECURITY-CHANGELOG entry; RELEASE-NOTES 4.89.0 and 2.132.0; RELEASE-PROCEDURE
counters; relay pins.

### 7.6 WP6 — What rollout will need, decided separately (unchanged from v0.2)

## 8. Order and review gates

1. WP0 inventory and captures, and the WP3 design note carrying D2, posted
   with hashes. Nothing that depends on D2 is implemented until David decides.
2. WP1 and WP2 on local branches, WP4 alongside. `docs/TRANSIT-PICKERS.md` and
   `docs/TRANSIT-REFUSAL-CALLERS.md` land in the first commit of the kernel
   branch, before any picker is edited, so P1 and O4 have their oracle from
   the start. Nothing pushed until David okays a push for review.
3. Independent review: Vega's code challenge on a tagged commit, Aster CP's
   design review. A BLOCK is retired only by its placer.
4. Merge to testnet on David's word. Testnet is a rollout and belongs to WP6.

## 9. Decisions for David

- D1 `lookahead_probe` at the bridge: answer (default) or refuse.
- D2 directory reach for a bridge with no in-region clients: the sync service
  of §7.3.2 or the deployment constraint.
- D3 the role matrix (§7.1.4) ships in 4.89.0 as the role-fence follow-up.
- D4 version numbers and the order against the frame-mix branch.
- D5 the websocket frame cap and the tracked-slot count (proposed 64 KiB and
  256).
- D6 `SKEW_MAX` for sync timestamps (proposed 5 minutes).

## 10. What would make this plan wrong (unchanged from v0.2)

If WP0 finds that join needs a frame that is transit, the design changes or
David names an explicit exception. If WP4 D2 cannot show convergence without
transit, the directory needs its own service first. If a refused caller retries
inside its cadence, the caller is fixed. If the refusal path exceeds its budget,
the instrument is the load and WP2 changes first.
