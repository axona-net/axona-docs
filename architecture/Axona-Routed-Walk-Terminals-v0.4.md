# A routed walk must end at a node that can serve, and must end at all (v0.4)

**Status:** design for council review, revision 4 · **Date:** 2026-10-11 ·
**Kernel in production:** 4.108.0 · **Bridge:** 2.155.0 · **Relay:** 0.151.0 ·
**Author:** axona.bot · **Supersedes:** v0.3 (`370a8ad`), v0.2 (`974e055`), v0.1 (`41b5838`), all preserved ·
**Reviews folded:** Aster `e6615331`, `bde6eeca`, `d0210704` (R1 contracts); Vega `43d0fad6` (R2, R3), `8d528df6` (R1 telemetry, R4 source paths) ·
**Measurements:** `ops/p2p-strand-808f-20261010T1855Z`, `ops/p2p-topics-root-20261011T0130Z`

**What v0.4 changes.** R1 gets one origin settlement transition and the contradiction
Aster found is removed: a receipt never discharges or extends the outcome deadline. An
attempt's `unknown` is a different fact from the origin's `reported(unknown)`. A legacy
timeout at a proxy is the proxy ceasing to wait, reported as unknown with a local reason,
never as a stop. The old → new boundary mints a subwalk identity before it forwards. Hop
telemetry attaches to the walk id, since the reply chain is no longer the walk. R4 names
one capability predicate per production transport, gates every root birth and not only
`promote()`, states what `meshBare` still does, names the door-forward target by wire id
and shows it is a routed terminus that holds roles, and fixes the order against terminal
verification. The promotion row states that `route_done` is telemetry and a publish still
returns dispatched. Three races are added to the fences.

## The question

David wrote to the chat at 01:20Z on 2026-10-11 and the send failed, twice, across a
reload. The jokes chime from the same mesh had landed four times that evening. What is
different about a topic that cannot take a write when its neighbour can?

The answer is in the walk, not in the topic. A routed walk toward `axona.chat` from any
of 50 relays ends one of three ways: it dies at its origin after one request timeout, it
bounces between two nodes until the hop cap, or it ends at a browser tab that cannot
serve. The walk toward `jokes` from the same 50 relays ends at one relay, in one or two
hops, in 160 ms. Same kernel, same fleet, same minute.

## What this is not

This is NOT a fill problem. Hold-and-Fill Rule 2 is armed on every relay and the relays
hold 30 to 50 peers. The walks below fail with the table full.

This is NOT a sparse-keyspace problem, and the 808f story from 2026-10-10 is withdrawn
on this point. The 650 zero-hop failures in the strand run were read as "the sender holds
nothing closer." They are not. Every one of them took 4999 to 6126 ms, which is the
transport's request timeout and nothing else. A walk that holds nothing closer returns
`terminal`, not `exhausted`, and it returns at once.

This is NOT Safari. One Safari tab storming the door makes the symptom louder; the four
defects below are in the kernel and happen with no browser present.

This is NOT a delivery guarantee. A publish still returns dispatched. Nothing here makes
a routed message arrive; it makes the walk end, and say where. No frame in this design
licenses a negative inference: an unknown outcome means the origin stopped waiting, not
that the walk stopped.

This is NOT a proof of the asynchronous contract in R1. The fences are evidence for the
cases they name. The obligation that remains open is stated in the last section.

## What the measurement shows

Every relay routed one probe at each standing topic at 01:30Z. Fifty senders, 200 walks.

| Topic | Outcome | Hops | n | Walk time, min / p50 / max |
|---|---|---|---|---|
| jokes | terminal at ONE relay | 1 to 2 | 50 | 89 / 160 / 398 ms |
| council | exhausted | 0 | 49 | 4999 / 5003 / 5153 ms |
| axona.chat | exhausted | 0 | 18 | 4999 / 5003 / 5153 ms |
| axona.chat | exhausted | 39 (the cap) | 28 | 1663 / 1819 / 4745 ms |
| axona.dev | exhausted | 0 and 39 | 19 and 27 | as above |

The strand run of 2026-10-10 has the same shape over 800 walks: 650 at hop 0 in
4999 to 6126 ms, 12 at hop 1 in 5009 to 7981 ms, 38 at the cap in 3768 to 4990 ms, and
100 terminal walks in 91 to 1242 ms. There is no walk in either run that failed in under
a request timeout and no walk that succeeded in over one. The two populations do not
touch. The timings inform the bounds below. They do not prove any contract about
asynchronous delivery.

The 28 cap walks toward `axona.chat` end at two nodes: David's Firefox tab, whose node id
landed at 899a38, and an older tab of his at 89cbd3. The topic id is 8998d3. The walk
reaches the tab, the tab finds nothing closer, the tab's lookahead sends it back, and the
two trade the message 39 times in 1.8 s.

## The four defects, with the line that owns each

**D1. A hop's lookahead can outlast the request that carries the walk.** `route_msg` is a
recursive await: the origin sends to hop 1 and waits for hop 1's reply, which arrives only
after hop 1 has finished the whole downstream walk (`AxonaPeer.js:1070`, `:1138`;
`routeMessage` at `:5582` to `:5661` awaits the same way). Hop 1 runs
`_findCloserInTwoHops` when its own table holds nothing closer (`:1105`). That lookahead
is a `Promise.allSettled` over the entire synaptome, unfiltered, and waits for the
slowest probe (`:4754` to `:4783`). One silent synapse costs `DEFAULT_REQUEST_TIMEOUT_MS`,
5000 ms (`webrtc.js:50`). The origin's request to hop 1 has the same 5000 ms. So the
origin times out while hop 1 is still probing, and the walk is reported `exhausted` at
hop 0. The council's 2026-09-08 bypass at the destination removed this cost where
distance is zero (`:4720`). It left it everywhere else. Vega confirmed the split on vendor
4.108.0: greedy skips `_deadPeers` and unconnected synapses (`:1096` to `:1100`); the
lookahead does not.

**D2. The lookahead has no memory and its first hop need not be closer.** The lookahead
forwards to the first hop whose two-hop answer is closest, and that first hop may be
farther from the target than the node holding the message (`:4800`). The receiving hop
runs greedy, finds the sender closer, sends it back. Nothing on the wire says where the
message has been. The cap is 40 (`AxonaDomain.js:49`), so a two-node loop costs 39 hops
and then reports `exhausted` from whichever node holds it last.

**D3. Any node may be a terminal, and any terminal may root.** A node is terminal when
its connected table holds nothing closer and the lookahead returns nothing (`:1103`,
`:1123`). Nothing asks whether that node can serve what arrives. Five births make a root
from that verdict and none counts a bound mesh peer: `promote()` on a bare terminal
frame (`rootClaim.js:353` to `:359`), and `_becomeRoot` from a terminal SUB
(`wireHandlers.js:297`), a terminal PUB (`:467`, with the comment that the publish side
is not gated on purpose so a solo node can serve its own subscriber), a terminal KILL
(`:1152`), a terminal METRICSON (`:1322`), and a handoff heir (`syncEngine.js:204`). The
alone-in-the-dark guard `meshBare()` (`rootClaim.js:177` to `:190`) blocks the SUB birth
only when every neighbour is the bridge; a tab with one mesh peer passes it. A browser
tab admitted at the door therefore satisfies every test a relay with 50 peers does, and
the topic's root is a tab.

**D4. A starved door node re-offers forever.** The mesh re-warm hook re-requests the
bridge's peer list whenever the mesh stays starved (`AxonaPeer.js:4213`), and
`MeshManager.onPeerList` initiates to every listed peer it does not hold
(`mesh.js:752`). A node whose offers never complete asks again every minute. The Safari tab
at the east door did this 272 times in five hours and sent 5699 relayed signals in the
last hour of it, four times what it received. Nothing in the kernel bounds the asking and
nothing in the bridge bounds the fan-out per socket.

## The rule

A routed walk ends at a node that can serve the message, or it reports where it stopped
and why, or the origin reports that the outcome is unknown, and the origin learns which of
the three on its own clock, inside a bound it set before it sent.

Five changes carry the rule. Each is fenced on its own. R2, R3, R4 and R5 ship alone. R1
ships last and only with its own fences green.

### R2. The lookahead probes connected peers only and locks the first closer answer

`_findCloserInTwoHops` probes only synapses that pass the filter greedy applies:
`isConnected` and not in `_deadPeers` (`:1096` to `:1100`). It locks the FIRST reply whose
two-hop node is closer than self, stops the round, and forwards to that reply's first
hop. This is a change of semantics and it is intended: today's rule is best-among-all-
settled, which buys XOR progress with wall-clock; this rule buys the hop with the fastest
closer reply. A bound `LOOKAHEAD_MS` ends a round that produced no closer reply, with
null. A silent peer costs at most `LOOKAHEAD_MS` and only when every faster peer failed
to beat self.

**Progress.** The first hop may be farther from the target than the node holding the
message; only the two-hop node is closer. The lookahead reply names the two-hop node, and
the forward to the first hop carries it as `via`. A first hop that receives `via` forwards
to that node when it is connected and not on the path, before running its own selection.
Over the pair the walk is strictly closer. When `via` is gone, the first hop selects on
its own, and R3's path memory is what keeps the pair from trading the frame.

The council's objection of 2026-09-08 stands: a constant chosen off one RTT sample is a
constant chosen off a sample. `LOOKAHEAD_MS` bounds a round that today is unbounded in
practice. Its value is David's, in §Parameters, with the measured distribution beside it.
It is a round budget, not a per-probe timeout, and it is not derived from terminal walk
p50.

**Census.** The emit-side counters in `newLookaheadStats` stay, with four added so the
pre/post comparison is still a comparison: `probesSkippedUnconnected`,
`probesSkippedDead`, `lookaheadRoundMs` (a histogram in the same buckets as
`rankSent`), and `viaHonoured` against `viaUnavailable`. `probesEmitted` is not comparable
across the change without the two skip counters. `targetsNearerThanSelf` must trend to
zero once the probe set matches greedy's eligibility; if it stays above zero the filter
is still wrong, and that is the fence. `answeredWithinK` keeps its name and changes its
meaning to the rank of the chosen first hop; the document says so because the old
meaning, whether top-K would have saved the fan-out, is gone with the fan-out.

### R3. The walk carries its path, and no hop forwards onto it

`route_msg` carries `path`, the last `PATH_MEMORY` node ids. The exclusion applies to the
CHOSEN next hop, wherever it was chosen: greedy's scan, the lookahead's first hop, the
`via` commitment, and the lazy mid-walk `openConnection` at `:1130` to `:1137`, which can
otherwise admit a synapse the scans never saw. A node that holds nothing closer outside
the path is terminal, subject to R4.

`path` is new frame data. A 4.108.0 hop drops the field and stays loop-prone until the
fleet is homogeneous, and the promotion record must say so. A window of eight ends the
measured two-node loop; it does not exclude a cycle longer than eight among more than
two nodes, so the hop cap stays as the outer bound.

### R4. A terminal must be able to serve, or it forwards to one that can

**One predicate, one name, every transport.** `transport.servingCapable()` answers
whether this node can hold a root, answer a lookup and deliver to subscribers. Each
production transport implements it:

- the web composite, which browsers AND relays run (`axona-relay/src/relay.js:20` imports
  `transport/web/index.js`): `meshBoundCount() >= SERVE_MESH_FLOOR` and `bridgeState` is
  not door-only. `meshBoundCount` exists (`index.js:1478` to `:1485`; zero means
  bridge-only) and `graduationMeshFloor` is 3 (`:170`).
- the bridge's embedded node: `admission.seated` and not `neverRoot`. Both production
  bridges run `BRIDGE_NEVER_ROOT=0` and hold roles; east held four at 02:00Z.
- any transport without the method: `connect.js:263` already treats a missing
  `meshBoundCount` as "cannot count live". R4 does the same and logs
  `serving-capable-unknown` once; such a node is treated as capable, because refusing
  every terminal on an unknown transport would strand every walk through it. There is
  no such transport in production today, and the log line is there so one cannot appear
  unnoticed.

`SERVE_MESH_FLOOR` and the graduation floor are the same number today, by choice, since
the floor is already the kernel's idea of meshed. Orion's ask whether they should
diverge stays open; a divergence is one constant, not a design change.

**Terminal.** A node declares itself terminal only if `servingCapable()`. A node that
fails the test and holds nothing closer forwards to its closest serving-capable peer. For
a door-only node that peer is the bridge's own node, whose wire id the transport holds
as `bridgeNodeIdBig` (`index.js:794`) and binds as a peer at hello (`:78`). The bridge's
node forwards routed frames (`bridge_axona_node.js:833` to `:850`, the dispatch that a
2.1xx fix made work at all) and holds roles under `BRIDGE_NEVER_ROOT=0`, so it is both a
routed terminus and serving-capable. The kernel no longer excludes the bridge from
closest-reachable reasoning (`bridgeId: () => null`, `AxonaPeer.js:4208`, David's
2026-09-19 experiment), so nothing in rootClaim treats that forward as a hop to
signalling infrastructure. If no capable peer exists, the walk stops with
`{stopped: 'no-capable-terminal'}`.

**Root birth.** The gate goes on `_becomeRoot` itself (`AxonaManager.js:951`), which every
terminal birth calls: `sub-terminal`, `pub-terminal`, `kill-terminal`,
`metricson-terminal`. A node that is not serving-capable gets `null`, and every caller
already handles `null` as a refused birth: the SUB path reroutes or records
`refused-no-forward` (`wireHandlers.js:299` to `:305`), the PUB path forwards or stops
(`:468` onward). The publish-side exception, a solo node rooting on its own publish to
serve its own subscriber, is withdrawn: a solo node is not serving-capable, its
subscriber is itself, and a local deliver does not need a root. `promote()` gets the same
test beside `meta.isTerminal`. The handoff heir (`syncEngine.js:204`) is gated too: an
heir that is not capable answers the handoff `not-capable` and the pusher tries its next
heir, which is a change to the sync engine and is named as one. `meshBare()` stays as it
is; it answers a different question, whether any non-bridge neighbour exists, and R4
does not replace it.

**Order against terminal verification.** The capability test runs first, because it is a
local predicate with no network cost. `_subTerminalVerify`, when armed (`wireHandlers.js:291`;
off in production), runs second and only for a capable node. Self-root is third. A node
that is not capable never reaches the verify, so the two oracles cannot disagree.

### R5. A starved node asks with backoff, and the bridge meters the fan-out

The re-warm re-request backs off: 1 min, 2, 4, up to `REWARM_MAX_MS`, reset on any bound
channel. The bridge counts relayed signals per socket per minute and above
`BRIDGE_SIGNAL_RATE` drops the excess and logs `signal-rate-limited` with the socket.
Neither closes the socket. A node that cannot complete an offer is not a fault to punish.
It is a node that should ask less and cost others less.

### R1. Walk identity, hop receipt, bounded return

R1 replaces the recursive await. It is the only change that adds a reply chain, so it
carries its contract in full.

**Every walk has an identity.** `route_msg` carries `walkId = (originIncarnation,
originSeq)` and `attemptId`, incremented per forward. `originIncarnation` is minted at
peer start and never persisted, so a restarted origin cannot be confused with its own
earlier walk. Each hop keeps `(walkId, attemptId)` and refuses a second frame with the
same pair as a duplicate, and a frame with the same `walkId` and a lower `attemptId` as
stale.

**The origin has one settlement transition.** A walk at its origin is `PENDING` from the
send until exactly one of two events, and the first one wins:

- `PENDING → REPORTED(outcome)` on a valid, timely `route_done` whose subject is this
  walk;
- `PENDING → REPORTED(unknown)` when the origin's monotonic deadline, `WALK_BUDGET_MS`
  from the send, expires.

The caller is told once, at that transition. Every later event, a late outcome, a second
outcome, a receipt, a channel closing, is observational: counted, logged, never
reported. A hop receipt changes nothing at the origin except a counter. It does not
discharge the deadline and it does not extend it. v0.3 said unknown is reported only when
neither a receipt nor an outcome has arrived; that let a receipt-only walk wait for
ever, and it is withdrawn.

**An attempt's unknown is not the origin's unknown.** An attempt is `SENT` until a
receipt arrives (`HELD`) or `HOP_ACK_MS` passes or its channel closes (`UNKNOWN`). An
attempt going `UNKNOWN` sends nothing more for this walk, retries no candidate, and does
not touch the origin's settlement. A walk whose only attempt is `UNKNOWN` is still
`PENDING` and a timely outcome still settles it. This is what keeps a receipt timeout or
a channel closure from producing a second report when the outcome arrives after it.

**Three facts, three frames.** A hop receipt says the hop holds the frame and nothing
else: `{walkId, attemptId, state: 'held'}`. It does not name a next hop, because the next
hop is not chosen until route selection runs. A terminal outcome is `route_done`:
`{subject: walkId, outcome: stopped | terminal | consumed, atNode, hops, reason}`. An
application acceptance, where one exists, is the application's frame and no part of this
contract; a `consumed` walk means a handler ran, not that it accepted.

**The return envelope is its own frame and never breeds.** `route_done` names its
subject walk and travels in an envelope with its own id, `returnId = (senderIncarnation,
senderSeq)`. It goes to the walk's origin over a direct channel when the sender holds
one. Otherwise it is sent as a routed frame of type `route_done` toward the origin with
`hopsLeft = RETURN_HOPS` and no lookahead. A node that receives such a frame and is the
origin consumes it. A node that is not the origin forwards it one greedy hop over
connected peers if `hopsLeft > 0`, else drops it and counts `returnDropped`. No node ever
emits a receipt or a `route_done` for a return envelope. The subject's `walkId` is never
reused as the envelope's id. Delivery of the envelope is conditional, and the contract
says so; the origin's deadline is what bounds the wait.

**What the state memory does and does not give.** Hop entries live `WALK_STATE_MS` and
the table holds at most `WALK_STATE_MAX` entries. Within that window, at a receiver that
has run continuously, a duplicate or stale frame is refused. Outside it the memory gives
nothing: a frame delayed past the window, or arriving at a restarted receiver, is a new
frame to that receiver. That is the replay floor, stated as one because nothing in this
design persists. What bounds a replay beyond the floor is the hop budget and the hop cap,
which bound its cost, not its occurrence. When the table is full a new walk is refused
with `{stopped: 'state-full'}` and counted; nothing is evicted. Origin and proxy records
follow the same two rules: a record lives until its settlement plus `WALK_STATE_MS` for
late-event counting, and a full origin table refuses a new send locally with
`state-full` before any frame leaves.

**Downstream work is bounded by forwards, and only by forwards.** Each frame carries
`hopsLeft`, decremented per forward, and a hop with `hopsLeft = 0` stops with
`{stopped: 'budget'}`. This bounds the number of forwards. It does not bound how long any
one hop holds the frame, and it does not end a walk on a participant that is suspended:
a suspended hop holds its frame until it runs again, and the origin's deadline is what
covers that time from the origin's side. Cancellation is best effort: an origin that gives
up sends nothing, and the walk ends when its hops run out. Nothing rolls back.

**An attempt lives and dies with its channel.** An attempt is pinned to the channel token
it was sent on. If that channel closes before a receipt or an outcome arrives, the
attempt is `UNKNOWN` at once. Nothing is resent on reconnect, and a new channel to the
same peer carries only new attempts.

**Telemetry attaches to the walk.** The hop ledger today pairs a sender's `tx` with the
receiver's `rx` by `hopAttemptId` and stamps `ok` when the nested reply returns
(`AxonaPeer.js:1073` to `:1084`, `:5631` to `:5651`). Under R1 the nested reply is the
receipt, so that `ok` would mean held, not completed. The ledger rows carry `walkId`, the
per-hop pair stays keyed by `hopAttemptId`, and the walk's end is stamped from
`route_done` at the origin, or `unknown` at settlement. A walk with no `route_done` has
hop rows and no end row, which is the true state of knowledge.

**Mode is negotiated per link, and every legacy boundary has a proxy origin.** A node
advertises `r1` in its transport hello on every direct channel, not only in the bridge
hello, because mesh hops are not bridge hops. A link runs R1 only when both ends
advertised it. Legacy frames carry `originId` and `hops` and nothing else of this
contract. The rules at a boundary:

- new → old. The new node adjacent to the legacy segment becomes the PROXY ORIGIN for
  that segment. It records `{walkId, attemptId, legacyRequestId, upstream, deadline}`,
  sends its own receipt upstream, then sends a legacy `route_msg` and awaits the legacy
  reply under the legacy timeout. The legacy reply is translated into exactly one
  `route_done` upstream, with `subject` from the record. A legacy timeout means the proxy
  has stopped waiting; it says nothing about whether the segment is still forwarding. It
  is translated as `{outcome: 'unknown', reason: 'legacy-timeout', atNode: <the proxy>}`,
  where `atNode` names the node that stopped waiting. It is never a `stopped`, because
  nothing stopped that the proxy can see. The budget retained across the segment is the
  legacy hop cap, carried in the legacy `hops` field, and the proxy's own deadline.
- old → new. A new node that receives a legacy frame mints a SUBWALK identity,
  `walkId' = (its own incarnation, its own seq)`, records the mapping
  `{walkId', legacyRequest, deadline}` before it forwards anything, and runs the
  downstream walk under `walkId'`. Downstream receipts and the downstream `route_done`
  correlate to `walkId'` at this node and go no further. It never sends a receipt
  upstream. It answers the legacy request ONCE, in the legacy shape, when the downstream
  outcome arrives or its deadline expires, whichever is first; on expiry it answers
  `exhausted`, the legacy word for unknown. It never sends `route_done` toward the
  frame's `originId`.
- new → old → new. The two rules compose. The proxy origin holds the first record, the
  far node holds the subwalk record, the far node settles the legacy request, the legacy
  reply reaches the proxy, the proxy translates once.

A mode is pinned per attempt and an attempt whose channel is gone is already `UNKNOWN`,
so no attempt ever finishes in its old mode over a new channel.

## Parameters for David

| Name | Proposed | Why this value | What would make it wrong |
|---|---|---|---|
| `LOOKAHEAD_MS` | 1500 | A round budget; replies today arrive inside one hop's time | A fleet where a closer reply takes longer than a hop |
| `PATH_MEMORY` | 8 | The loop seen is two nodes; eight covers four such pairs | A cycle longer than eight that greedy cannot leave |
| `SERVE_MESH_FLOOR` | 3 | The graduation floor, already the kernel's idea of meshed | A node class that serves at one or two peers |
| `REWARM_MAX_MS` | 600000 | Ten minutes, the Hold-and-Fill re-contact period | A mesh that should recover faster after a storm |
| `BRIDGE_SIGNAL_RATE` | 600/min | Chrome tabs at the same door ran 150 to 250/h; Safari 5699 | A legitimate burst at join of a large list |
| `HOP_ACK_MS` | 1000 | Terminal walks measured 89 to 1242 ms end to end | A hop that takes longer to hold a frame than a walk takes today |
| `WALK_BUDGET_MS` | 8000 | One legacy timeout plus the slowest measured terminal walk, with room for a mixed chain | A legitimate walk over 8 s; re-measure after R2 and R3 remove the 5 s stalls |
| `WALK_STATE_MS` | 30000 | Longer than any budget, shorter than a reconnect | Delayed frames arriving after 30 s, which the replay floor already concedes |
| `WALK_STATE_MAX` | 4096 | A relay at 50 peers sees tens of walks a second at most; 4096 is minutes of them | A publisher burst that fills it, which then refuses walks instead of forgetting |
| `RETURN_HOPS` | 2 | One hop reaches the origin in every measured case; two covers one dead channel | A return path longer than two, which then drops and reports unknown |

The budgets are reconciled as follows. Acceptance in production is on the walks as they
are today, with no R1 on the fleet: every walk ends `terminal`, `consumed` or `stopped`
with a reason, and none ends by timeout; the measured terminal distribution, 89 to
1242 ms, is the yardstick, and a walk over one legacy request timeout is a failure of
acceptance. `WALK_BUDGET_MS` is R1's deadline for reporting unknown and is longer than
acceptance on purpose, because a mixed chain can carry one legacy timeout inside it. Its
value is re-measured after R2 and R3 ship, since they remove the stalls it was sized
against. The R1 fence with a 6 s hop exercises the receipt, not acceptance.

## Rollout

R2 and R3 ship first, together, kernel only. Their acceptance measurement is the topic
probe above: zero walks at hop 0 over 2 s, zero walks at the cap. R3's `path` field and
R2's `via` field are ignored by 4.108.0 hops and the promotion record states the fleet is
loop-prone until homogeneous. R4 ships second, with the root-birth gate; its promotion
record names the withdrawn solo-publish exception. R5 is a kernel knob and a bridge knob
and can ship any time. R1 ships last, behind the per-link capability, after its fences
and only on David's word, since it is the one change that alters what a legacy node
receives. R1's promotion record states in its first line that `route_done` is telemetry
for the walk and that a publish still returns dispatched, so no operator reads it as a
delivery acknowledgment.

## Verification

Each change gets a fence that fails with the fix deleted. A fence is evidence for the
case it names and nothing wider.

- R2: a synaptome entry that never answers. Today the lookahead takes 5 s. With R2 it
  returns the closer answer in one RTT and the silent peer is never probed. A second
  fence asserts `targetsNearerThanSelf` is zero over a run that today counts it. A third
  gives the first hop a live `via` and asserts it forwards there before selecting.
- R3: two nodes each closer to the target than the other's table can see. Today the
  walk runs to the cap. With R3 it stops at the second node in one hop. A second fence
  puts the loop partner on the path and behind the lazy mid-walk open.
- R4: a door-only node with an empty mesh placed closest to the target. Today it is
  terminal and becomes root. With R4 it forwards to the bridge's node and never roots.
  One fence per birth: SUB, PUB, KILL, METRICSON, handoff heir, and `promote()`. A
  seventh asserts the capability test runs before the verify when the verify is armed.
- R5: a node whose offers always fail. Today it asks every minute. With R5 the fifth ask
  comes after 16 minutes, and the bridge log shows the rate limit before the storm.
- R1, receipt: a hop that sleeps 6 s before forwarding. The origin sees the receipt in
  under `HOP_ACK_MS` and `route_done` at 6 s.
- R1, receipt only: a receipt arrives and no outcome ever does. The origin reports
  `unknown` at `WALK_BUDGET_MS`, once; the receipt neither delayed nor cancelled it.
- R1, receipt lost, outcome arrives: the receipt frame is dropped, the hop forwards, a
  valid `route_done` arrives inside the deadline. The origin reports that outcome, not
  unknown, and never forks.
- R1, receipt lost, nothing arrives: the origin reports `unknown` at `WALK_BUDGET_MS`,
  once.
- R1, attempt unknown then outcome: the attempt's channel closes, the attempt is
  `UNKNOWN`, a timely outcome arrives. One report, the outcome.
- R1, same-turn race: the deadline timer and a valid outcome are both queued in one
  turn, in both orders. Exactly one report, and it is whichever ran first.
- R1, suspended origin with a queued late outcome: the origin is suspended past its
  deadline; on resume a valid outcome is already queued ahead of the overdue timer. One
  report, the outcome, and the timer's firing is observational.
- R1, duplicate `route_done`: two arrive for one subject; the second is rejected and
  counted.
- R1, return envelope: the sender holds no direct channel; the envelope forwards once,
  then the next node is not the origin and `hopsLeft` is 0; it drops and counts, and no
  receipt or `route_done` is emitted for the envelope.
- R1, state capacity: `WALK_STATE_MAX` walks held; the next is refused `state-full` and
  nothing is evicted. The same at an origin, before any frame leaves.
- R1, replay past the floor: a duplicate delayed past `WALK_STATE_MS` is accepted as new;
  the fence asserts the hop budget bounds its forwards and the document's floor holds.
- R1, restart: a `route_done` whose subject is from a previous incarnation is rejected.
- R1, channel gone: the channel an attempt was sent on closes before any reply; the
  attempt is `UNKNOWN` at once and nothing is resent on the next channel to that peer.
- R1, telemetry: a walk with a lost `route_done` has hop rows and no end row; a walk
  settled unknown has an end row stamped `unknown` at the origin's settlement time.
- R1, mixed chains: new → old → new with a slow legacy middle, and old → new → old with
  a slow legacy suffix. The legacy upstream receives exactly one reply of the legacy
  shape, from the node that received the legacy frame; that node holds a subwalk record
  before it forwards; the proxy origin translates once; no `route_done` reaches a legacy
  origin; a legacy timeout yields `unknown` with reason `legacy-timeout` and the proxy
  as `atNode`, and the fence asserts the downstream segment was still forwarding when
  the proxy reported.

Acceptance in production is the same probe that found this: every relay routes one probe
at each standing topic, and every walk ends `terminal` at one node per topic inside the
measured terminal distribution.

## What this document does not establish

Why the Safari tab's offers never complete. The bridge sees signals both ways and no
channel. WebKit's timer throttling of background tabs fits the minute cadence and the
30 s bind deadline, and it is not verified. That needs the tab's console.

Whether R1's receipt frame costs a measurable round trip on walks that succeed today.
The terminal walks above are 89 to 1242 ms over one to three hops; one more frame per
hop is inside that spread, and it is a claim until measured.

Whether a cycle longer than `PATH_MEMORY` occurs in production. None was seen in 1000
walks; the hop cap stays because none seen is not none possible.

The full asynchronous contract of R1. The fences above are evidence for the cases they
name. What is not shown is that no interleaving of lost receipts, late outcomes, legacy
segments, suspensions and reconnects can make an origin report an outcome it did not
receive, or report twice. The settlement transition is written so that a proof has one
state to argue about; writing it down is not discharging it. R1 does not ship until the
obligation is discharged or David accepts the residual.
