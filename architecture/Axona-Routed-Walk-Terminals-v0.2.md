# A routed walk must end at a node that can serve, and must end at all (v0.2)

**Status:** design for council review, revision 2 · **Date:** 2026-10-11 ·
**Kernel in production:** 4.108.0 · **Bridge:** 2.155.0 · **Relay:** 0.151.0 ·
**Author:** axona.bot · **Supersedes:** v0.1 (`41b5838`), preserved ·
**Reviews folded:** Aster `e6615331` (R1, mixed fleet, return path, fences), Vega `43d0fad6` (R2, R3, census, rollout) ·
**Measurements:** `ops/p2p-strand-808f-20261010T1855Z`, `ops/p2p-topics-root-20261011T0130Z`

**What v0.2 changes.** R1 is rewritten as a walk-identity and receipt contract: a missing
hop receipt is an unknown, never a death; the walk carries an identity that lets a fork be
refused; a hop receipt, a terminal outcome and an application acceptance are three
different facts; the mode is negotiated per link and a legacy boundary translates once.
`route_done` has a bounded return contract and the origin reports outcome-unknown on its
own clock. R2 states its tie-break and its census. R3 applies to the chosen next hop,
names the frame it changes, and keeps the hop cap. The budgets are reconciled. Nine
adversarial fences are added. R1 moves to last in the rollout.

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
a routed message arrive; it makes the walk end, and say where.

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
asynchronous delivery, and the fences, not the tables, are what establish R1.

The 28 cap walks toward `axona.chat` end at two nodes: David's Firefox tab, whose node id
landed at 899a38, and an older tab of his at 89cbd3. The topic id is 8998d3. The walk
reaches the tab, the tab finds nothing closer, the tab's lookahead sends it back, and the
two trade the message 39 times in 1.8 s.

## The four defects, with the line that owns each

**D1. A hop's lookahead can outlast the request that carries the walk.** `route_msg` is a
recursive await: the origin sends to hop 1 and waits for hop 1's reply, which arrives only
after hop 1 has finished the whole downstream walk (`AxonaPeer.js:1070`, `:1138`). Hop 1
runs `_findCloserInTwoHops` when its own table holds nothing closer (`:1105`). That
lookahead is a `Promise.allSettled` over the entire synaptome, unfiltered, and waits for
the slowest probe (`:4754` to `:4783`). One silent synapse costs
`DEFAULT_REQUEST_TIMEOUT_MS`, 5000 ms (`webrtc.js:50`). The origin's request to hop 1 has
the same 5000 ms. So the origin times out while hop 1 is still probing, and the walk is
reported `exhausted` at hop 0. The council's 2026-09-08 bypass at the destination removed
this cost where distance is zero (`:4720`). It left it everywhere else. Vega confirmed the
split on vendor 4.108.0: greedy skips `_deadPeers` and unconnected synapses
(`:1096` to `:1100`); the lookahead does not.

**D2. The lookahead has no memory and its first hop need not be closer.** The lookahead
forwards to the first hop whose two-hop answer is closest, and that first hop may be
farther from the target than the node holding the message (`:4800`). The receiving hop
runs greedy, finds the sender closer, sends it back. Nothing on the wire says where the
message has been. The cap is 40 (`AxonaDomain.js:49`), so a two-node loop costs 39 hops
and then reports `exhausted` from whichever node holds it last.

**D3. Any node may be a terminal.** A node is terminal when its connected table holds
nothing closer and the lookahead returns nothing (`:1103`, `:1123`). Nothing asks whether
that node can serve what arrives: hold a root, answer a lookup, deliver to subscribers. A
browser tab admitted at the door with a thin or empty mesh satisfies the test as well as a
relay with 50 peers. `rootClaim.js:356` then lets the terminal become root. The topic's
root is a tab.

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
closer reply. Progress is still strict, since the lock requires closer than self. A bound
`LOOKAHEAD_MS` ends a round that produced no closer reply, with null. A silent peer costs
at most `LOOKAHEAD_MS` and only when every faster peer failed to beat self.

The council's objection of 2026-09-08 stands: a constant chosen off one RTT sample is a
constant chosen off a sample. The constant here bounds a round that today is unbounded
in practice. Its value is David's, in §Parameters, with the measured distribution beside
it. It is a round budget, not a per-probe timeout, and it is not derived from terminal
walk p50.

**Census.** The emit-side counters in `newLookaheadStats` stay, with three added so the
pre/post comparison is still a comparison: `probesSkippedUnconnected`,
`probesSkippedDead`, `lookaheadRoundMs` (a histogram in the same buckets as
`rankSent`). `probesEmitted` is not comparable across the change without the two skip
counters. `targetsNearerThanSelf` must trend to zero once the probe set matches greedy's
eligibility; if it stays above zero the filter is still wrong, and that is the fence.
`answeredWithinK` keeps its name and changes its meaning to the rank of the chosen first
hop; the document says so because the old meaning, whether top-K would have saved the
fan-out, is gone with the fan-out.

### R3. The walk carries its path, and no hop forwards onto it

`route_msg` carries `path`, the last `PATH_MEMORY` node ids. The exclusion applies to the
CHOSEN next hop, wherever it was chosen: greedy's scan, the lookahead's first hop, and the
lazy mid-walk `openConnection` at `:1130` to `:1137`, which can otherwise admit a synapse
the scans never saw. A node that holds nothing closer outside the path is terminal,
subject to R4.

`path` is new frame data. v0.1 said R2 and R3 change no frame; that was wrong for R3 and
is corrected here. A 4.108.0 hop drops the field and stays loop-prone until the fleet is
homogeneous, and the promotion record must say so. A window of eight ends the measured
two-node loop; it does not exclude a cycle longer than eight among more than two nodes,
so the hop cap stays as the outer bound.

### R4. A terminal must be able to serve, or it forwards to one that can

A node declares itself terminal only if it is serving-capable: a mesh of at least
`SERVE_MESH_FLOOR` bound peers and not a door-only node. The web transport already
counts bound mesh channels (`meshBoundCount`, `index.js:1485`) and already knows whether
it is at the door (`bridgeState`). A node that fails the test and holds nothing closer
forwards to its closest serving-capable peer, which for a door-only node is the bridge's
own node, reachable over the socket it holds. If no such peer exists, the walk stops
with `{stopped: 'no-capable-terminal'}`.

Root claim follows the same test. `rootClaim.js:356` becomes root only when
`meta.isTerminal` AND the node is serving-capable. A browser can still root a topic. It
has to have a mesh first.

Whether `SERVE_MESH_FLOOR` is the graduation floor or a separate number is Orion's ask
and open; v0.2 keeps them equal and names the choice.

### R5. A starved node asks with backoff, and the bridge meters the fan-out

The re-warm re-request backs off: 1 min, 2, 4, up to `REWARM_MAX_MS`, reset on any bound
channel. The bridge counts relayed signals per socket per minute and above
`BRIDGE_SIGNAL_RATE` drops the excess and logs `signal-rate-limited` with the socket.
Neither closes the socket. A node that cannot complete an offer is not a fault to punish.
It is a node that should ask less and cost others less.

### R1. Walk identity, hop receipt, bounded return

R1 replaces the recursive await. It is the only change that adds a reply chain, so it
carries the contract below in full. Aster's four objections to v0.1 are the structure of
this section.

**A missing receipt is an unknown.** A hop that has not answered may be dead, may have
forwarded, or may have consumed. v0.1 let the sender try the next candidate on silence.
That forks the walk. v0.2 does not: the sender waits `HOP_ACK_MS`, then marks the attempt
`unknown` and stops. The origin learns `outcome-unknown` on its own clock. No candidate is
retried inside one walk.

**Every walk has an identity.** `route_msg` carries `walkId = (originIncarnation,
originSeq)` and `attemptId`, incremented per forward. `originIncarnation` is minted at
peer start and never persisted, so a restarted origin cannot be confused with its own
earlier walk. Each hop keeps `(walkId, attemptId)` for `WALK_STATE_MS` and refuses a
second frame with the same pair as a duplicate, and a frame with the same `walkId` and a
lower `attemptId` as stale. The hop cap is unchanged and still applies.

**Three facts, three frames.** A hop receipt says the hop holds the frame and nothing
else: `{walkId, attemptId, state: 'held'}`. It does not name a next hop, because the next
hop is not chosen until route selection runs, and v0.1's promise of `nextHop` in the ack
was a promise the hop could not keep. A terminal outcome is `route_done`:
`{walkId, stopped | terminal | consumed, atNode, hops}`. An application acceptance, where
one exists, is the application's frame and no part of this contract; a `consumed` walk
means a handler ran, not that it accepted.

**The return path is bounded and separate from the walk.** `route_done` goes to `originId`
over a direct channel when the stopping node holds one, else by one routed hop toward
`originId` with its own `walkId` and no lookahead, else it is dropped. Its delivery is
conditional, and the contract says so: the origin keeps a monotonic deadline,
`WALK_BUDGET_MS`, and on expiry reports `outcome-unknown` to the caller. It never
synthesises a remote stop location or reason. A `route_done` that arrives late, or for a
`walkId` the origin does not hold, is rejected and counted. A suspended origin (a PWA in
the background) enforces its deadline when it next runs; wall-clock notification while
suspended is not promised.

**Downstream work is bounded too.** The origin's deadline stops nothing downstream. Each
frame carries `hopsLeft`, decremented per forward, and a hop with `hopsLeft = 0` stops
with `{stopped: 'budget'}`. Cancellation is best effort: an origin that gives up sends
nothing, and the walk ends when its hops run out. Nothing rolls back.

**Mode is negotiated per link, and a boundary translates once.** A node advertises `r1`
in its transport hello on every direct channel, not only in the bridge hello, because
mesh hops are not bridge hops. A link runs R1 only when both ends advertised it. At a
boundary the rule is fixed in both directions:

- new → old: the new hop sends a legacy `route_msg`, awaits the legacy reply with the
  legacy timeout, and translates that reply into exactly one `route_done` upstream. It
  sends its own receipt upstream first, so the new upstream is not waiting on the legacy
  suffix.
- old → new: the new hop never sends a receipt to a legacy upstream, because a legacy
  upstream reads the first reply as the final outcome. It runs the downstream walk and
  answers the legacy request once, with the legacy shape, when `route_done` arrives or
  its own deadline expires, whichever is first. On expiry it answers `exhausted`, which is
  the legacy word for unknown.

A mode is pinned per attempt. A link whose capability changes mid-walk, by reconnect,
finishes the attempt in the mode it started, and the next attempt renegotiates.

## Parameters for David

| Name | Proposed | Why this value | What would make it wrong |
|---|---|---|---|
| `LOOKAHEAD_MS` | 1500 | A round budget; replies today arrive inside one hop's time | A fleet where a closer reply takes longer than a hop |
| `PATH_MEMORY` | 8 | The loop seen is two nodes; eight covers four such pairs | A cycle longer than eight that greedy cannot leave |
| `SERVE_MESH_FLOOR` | 3 | The graduation floor, already the kernel's idea of meshed | A node class that serves at one or two peers |
| `REWARM_MAX_MS` | 600000 | Ten minutes, the Hold-and-Fill re-contact period | A mesh that should recover faster after a storm |
| `BRIDGE_SIGNAL_RATE` | 600/min | Chrome tabs at the same door ran 150 to 250/h; Safari 5699 | A legitimate burst at join of a large list |
| `HOP_ACK_MS` | 1000 | Terminal walks measured 89 to 1242 ms end to end | A hop that takes longer to hold a frame than a walk takes today |
| `WALK_BUDGET_MS` | 8000 | One legacy timeout plus the slowest measured terminal walk, with room for a mixed chain | A legitimate walk over 8 s, none seen |
| `WALK_STATE_MS` | 30000 | Longer than any budget, shorter than a reconnect | Duplicate frames arriving after 30 s |

The three budgets are reconciled as follows. Acceptance in production is on the walks as
they are today, with no R1 on the fleet: every walk ends `terminal`, `consumed` or
`stopped` with a reason, and none ends by timeout; the measured terminal distribution,
89 to 1242 ms, is the yardstick, and a walk over one legacy request timeout is a failure
of acceptance. `WALK_BUDGET_MS` is R1's deadline for reporting unknown and is longer than
acceptance on purpose, because a mixed chain can legitimately carry one legacy timeout
inside it. The R1 fence with a 6 s hop exercises the receipt, not acceptance.

## Rollout

R2 and R3 ship first, together, kernel only. Their acceptance measurement is the topic
probe above: zero walks at hop 0 over 2 s, zero walks at the cap. R3's `path` field is
ignored by 4.108.0 hops and the promotion record states the fleet is loop-prone until
homogeneous. R4 ships second, with the root-claim gate. R5 is a kernel knob and a bridge
knob and can ship any time. R1 ships last, behind the per-link capability, after its
fences and only on David's word, since it is the one change that alters what a legacy
node receives.

## Verification

Each change gets a fence that fails with the fix deleted.

- R2: a synaptome entry that never answers. Today the lookahead takes 5 s. With R2 it
  returns the closer answer in one RTT and the silent peer is never probed. A second
  fence asserts `targetsNearerThanSelf` is zero over a run that today counts it.
- R3: two nodes each closer to the target than the other's table can see. Today the
  walk runs to the cap. With R3 it stops at the second node in one hop. A second fence
  puts the loop partner on the path and behind the lazy mid-walk open.
- R4: a door-only node with an empty mesh placed closest to the target. Today it is
  terminal and becomes root. With R4 it forwards to the bridge's node and never roots.
- R5: a node whose offers always fail. Today it asks every minute. With R5 the fifth ask
  comes after 16 minutes, and the bridge log shows the rate limit before the storm.
- R1, receipt: a hop that sleeps 6 s before forwarding. The origin sees the receipt in
  under `HOP_ACK_MS` and `route_done` at 6 s.
- R1, receipt lost after forwarding: the receipt frame is dropped, the hop forwards
  anyway. The origin reports `outcome-unknown` at `WALK_BUDGET_MS` and never forks.
- R1, duplicate `route_done`: two arrive for one walk; the second is rejected and counted.
- R1, silent return path: `route_done` is dropped. The origin reports `outcome-unknown`
  on its deadline and names no remote reason.
- R1, origin suspension: the origin's clock is stopped past the deadline and resumed. It
  reports `outcome-unknown` on resume, once.
- R1, origin restart: a `route_done` for a walk from a previous incarnation is rejected.
- R1, capability change: a link renegotiates mid-walk; the attempt finishes in its
  starting mode and the next attempt uses the new one.
- R1, mixed chains: new → old → new with a slow legacy middle, and old → new → old with
  a slow legacy suffix. The legacy upstream receives exactly one reply of the legacy
  shape; the new upstream receives one receipt and one `route_done`.

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
