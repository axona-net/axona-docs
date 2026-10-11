# A routed walk must end at a node that can serve, and must end at all (v0.1)

**Status:** design for council review, revision 1 · **Date:** 2026-10-11 ·
**Kernel in production:** 4.108.0 · **Bridge:** 2.155.0 · **Relay:** 0.151.0 ·
**Author:** axona.bot · **Measurements:** `ops/p2p-strand-808f-20261010T1855Z`,
`ops/p2p-topics-root-20261011T0130Z` (relay-side probe facility, 50 of 51 relays as senders)

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
touch.

The 28 cap walks toward `axona.chat` end at two nodes: David's Firefox tab, whose node id
landed at 899a38, and an older tab of his at 89cbd3. The topic id is 8998d3. The walk
reaches the tab, the tab finds nothing closer, the tab's lookahead sends it back, and the
two trade the message 39 times in 1.8 s.

## The four defects, with the line that owns each

**D1. A hop's lookahead can outlast the request that carries the walk.** `route_msg` is a
recursive await: the origin sends to hop 1 and waits for hop 1's reply, which arrives only
after hop 1 has finished the whole downstream walk (`AxonaPeer.js:1070`, `:1138`). Hop 1
runs `_findCloserInTwoHops` when its own table holds nothing closer (`:1105`). That
lookahead is a `Promise.allSettled` over the entire synaptome and waits for the slowest
probe (`:4780`). One silent synapse costs `DEFAULT_REQUEST_TIMEOUT_MS`, 5000 ms
(`webrtc.js:50`). The origin's request to hop 1 has the same 5000 ms. So the origin times
out while hop 1 is still probing, and the walk is reported `exhausted` at hop 0. The
council's 2026-09-08 bypass at the destination removed this cost where distance is zero
(`:4720`). It left it everywhere else.

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
and why, and it does either inside a bound the origin knows before it sends.

Four changes carry the rule. Each is fenced on its own and each can ship alone.

### R1. The origin's wait is a budget over hops, and a hop acknowledges before it works

A forwarding hop replies to its upstream at once with `{accepted, nextHop}` and carries on.
The origin keeps a per-walk budget, `WALK_BUDGET_MS`, and a per-hop budget,
`HOP_ACK_MS`. A hop that does not acknowledge inside `HOP_ACK_MS` is dead for this walk
and the sender tries its next candidate. The final outcome returns on its own frame,
`route_done`, addressed to `originId`, which every frame already carries (`:1069`).

What this changes: `route_msg` stops being a recursive await. The reply chain becomes
one ack per hop plus one `route_done` from the node that consumed or stopped. A walk
that takes 39 hops costs the origin one ack wait, not 39 nested timeouts.

What this does NOT change: delivery semantics. A publish still returns dispatched, not
accepted. `route_done` is telemetry for the walk, not an acknowledgment to the caller.

### R2. The lookahead returns the first closer answer, over connected peers only

`_findCloserInTwoHops` probes only synapses that pass the same filter greedy applies:
`isConnected` and not in `_deadPeers` (`:1096` to `:1100`). It resolves on the first
reply that is closer than self and never waits for the slowest. A bound `LOOKAHEAD_MS`
ends the probe round with the best answer seen. The council's objection of 2026-09-08
stands: a constant chosen off one RTT sample is a constant chosen off a sample. The
constant here bounds a round that today is unbounded in practice, and §Parameters
leaves its value to David with the measured distribution beside it.

### R3. The walk carries its path, and no hop forwards to a node on it

`route_msg` carries `path`, the last `PATH_MEMORY` node ids. Greedy and the lookahead both
exclude nodes on the path. A node that holds nothing closer outside the path is
terminal, subject to R4. The two-node loop becomes a one-hop stop.

### R4. A terminal must be able to serve, or it forwards to one that can

A node declares itself terminal only if it is serving-capable: a mesh of at least
`SERVE_MESH_FLOOR` bound peers and not a door-only node. The web transport already
counts bound mesh channels (`meshBoundCount`, `index.js:1485`) and already knows whether
it is at the door (`bridgeState`). A node that fails the test and holds nothing closer
forwards to its closest serving-capable peer, which for a door-only node is the bridge's
own node, reachable over the socket it holds. If no such peer exists, the walk stops
with `{stopped: 'no-capable-terminal'}` and the origin learns it from `route_done`.

Root claim follows the same test. `rootClaim.js:356` becomes root only when
`meta.isTerminal` AND the node is serving-capable. A browser can still root a topic. It
has to have a mesh first.

### R5. A starved node asks with backoff, and the bridge meters the fan-out

The re-warm re-request backs off: 1 min, 2, 4, up to `REWARM_MAX_MS`, reset on any bound
channel. The bridge counts relayed signals per socket per minute and above
`BRIDGE_SIGNAL_RATE` drops the excess and logs `signal-rate-limited` with the socket.
Neither closes the socket. A node that cannot complete an offer is not a fault to punish.
It is a node that should ask less and cost others less.

## Parameters for David

| Name | Proposed | Why this value | What would make it wrong |
|---|---|---|---|
| `HOP_ACK_MS` | 1000 | Terminal walks measured 89 to 1242 ms end to end | A hop that takes longer than a whole walk today |
| `WALK_BUDGET_MS` | 8000 | One timeout plus the slowest terminal walk | A legitimate walk over 8 s, none seen |
| `LOOKAHEAD_MS` | 1500 | Probe replies arrive in the same window as a hop | A fleet where a closer answer takes longer |
| `PATH_MEMORY` | 8 | Loops seen are two nodes; 8 covers a hop cap of 40 cheaply | A loop longer than 8 that greedy cannot leave |
| `SERVE_MESH_FLOOR` | 3 | The graduation floor, already the kernel's idea of meshed | A class of node that serves at 1 or 2 peers |
| `REWARM_MAX_MS` | 600000 | Ten minutes, the bridge re-contact period in Hold-and-Fill | A mesh that should recover faster after a storm |
| `BRIDGE_SIGNAL_RATE` | 600/min | Chrome tabs at the same door ran 150 to 250/h; Safari 5699 | A legitimate burst at join of a large list |

## Rollout

R2 and R3 are kernel-only and change no frame. They ship first, together, and the topic
probe above is the acceptance measurement: zero walks at hop 0 over 2 s, zero walks at
the cap. R4 is kernel-only and ships second, with the root-claim gate. R1 adds a frame
and ships behind a capability flag in the client hello so a mixed fleet keeps the old
reply chain until both ends speak the new one. R5 is a kernel knob and a bridge knob and
can ship any time.

## Verification

Each change gets a fence that fails with the fix deleted, as the house rule requires.

- R1: a hop that sleeps 6 s before forwarding. Today the origin reports `exhausted` at
  hop 0 in 5 s. With R1 the origin sees the ack in under 1 s and `route_done` at 6 s.
- R2: a synaptome entry that never answers. Today the lookahead takes 5 s. With R2 it
  returns the closer answer in one RTT and the silent peer is never probed.
- R3: two nodes each closer to the target than the other's table can see. Today the
  walk runs to the cap. With R3 it stops at the second node in one hop.
- R4: a door-only node with an empty mesh placed closest to the target. Today it is
  terminal and becomes root. With R4 it forwards to the bridge's node and never roots.
- R5: a node whose offers always fail. Today it asks every minute. With R5 the fifth ask
  comes after 16 minutes, and the bridge log shows the rate limit before the storm.

Acceptance in production is the same probe that found this: every relay routes one probe
at each standing topic, and every walk ends terminal at one node per topic in under a
request timeout.

## What this document does not establish

Why the Safari tab's offers never complete. The bridge sees signals both ways and no
channel. WebKit's timer throttling of background tabs fits the minute cadence and the
30 s bind deadline, and it is not verified. That needs the tab's console.

Whether R1's ack frame costs a measurable round trip on walks that succeed today. The
terminal walks above are 89 to 1242 ms over one to three hops; one more frame per hop is
inside that spread, and it is a claim until measured.
