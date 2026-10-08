# Can every node reach every other node, and how long does a message take?

**Run:** 2026-10-08 18:48–19:11Z, production, kernel 4.107.2 / relay 0.149.0 / bridge 2.154.0, two
and a half hours after the fleet roll. **Tool:** `ops/p2p-rtt-matrix.mjs` (vantage) and
`ops/p2p-rtt-report.py` (fold). **Raw rows:** `ops/p2p-rtt-20261008T1848Z/` (workspace, not
published; node ids stay there). **Author:** axona.bot, on David's word.

## What was measured, and what was not

The neuromorphic layer is the mesh of WebRTC channels and the greedy walk over them. A message
to a node you hold a channel to is one hop. A message to any other node is handed to the
neighbour XOR-closest to the target, and so on, until a node holds the target as a neighbour,
or no neighbour is closer and the walk stops. This run measured both:

- **Routed.** `peer.routeMessage(target, '__tunneled_direct__' → local_probe)`: the kernel's
  routed envelope for a direct request. It is forwarded hop by hop; the target runs the
  request and reports `consumed`. The round trip is the whole chain held open end to end.
  Outcomes: `ok` (consumed at the target, with the hop count), `terminal` (the walk reached a
  node with nothing closer in its synaptome and nothing closer two hops out), `exhausted` (the
  origin itself had nothing closer, after the two-hop search), `error`.
- **Direct.** `transport.send(target, 'local_probe')` where the vantage holds a channel to the
  target. One hop by construction.

The relays were NOT the senders. A relay has no probe facility, so the sender on each host was
an ephemeral vantage node started by the tool: same kernel, same address, same door. A vantage
is a newborn, with 6 to 9 neighbours, where a relay on the same host holds 37 to 49. The matrix
is therefore "a new node on host X → every node", not "relay X → every node". The targets were
every node in the fleet census, 51 relays and 2 bridges, each id read from that process's own
log after the roll, plus whatever the vantage discovered on its own (28 unlisted nodes, all in
eagle: browsers, seats, and others).

Eight vantages: the M4, the Air, the M1, the Linux box, the Windows box, and three droplets
(sfo3, tor1, the grizzly droplet). Three samples per pair, 40 ms apart, after a 90 s warm-up.
One run. No repeat.

## Answer

**Fifty-three of fifty-three listed nodes answered at least one vantage. Forty answered every
vantage. No node was unreachable from everywhere.** Direct sends succeeded 179 of 180 times.
Routed round trips, where the walk arrived, cost about 150 ms per hop at the median and most
walks took two or three hops.

| hops | samples | p50 ms | p90 ms | max ms |
|---|---|---|---|---|
| 1 | 144 | 152 | 437 | 1348 |
| 2 | 559 | 192 | 415 | 5261 |
| 3 | 377 | 271 | 912 | 4728 |
| 4 | 71 | 431 | 2586 | 4600 |

Direct, one hop, per vantage: p50 44 to 86 ms. Same-host pairs read 0.4 to 3 ms (loopback).
The 48 rows reported at "0 hops" are the two bridges: the bridge's composite transport reports
the hop count differently, and three tor1 → east samples at 2.5 ms are not a Toronto to New
York round trip. Those 48 are excluded from the hop table above and from the per-host table
where they would mislead; they did consume at the bridge.

The per-vantage, per-host and per-target tables follow the failure analysis.

## The failures, and why

Thirteen targets failed from at least one vantage. They fall into three mechanisms, and one of
them is the sender's, not the network's.

**1. The Windows vantage's walks stalled at the origin (11 targets, 46 samples).** Every one of
those samples is `exhausted` at hops 0 and took 4,999 to 9,671 ms: the greedy step found no
neighbour closer than the vantage itself, and the two-hop search for a closer node hit its
5 s timeout. They cluster in time: twelve consecutive targets failed in one stretch, then the
next targets passed. Direct sends from the same vantage succeeded 26 of 27 at 76 ms, so its
channels were up; what stalled was the lookahead probe to its neighbours. The vantage was the
twenty-first node on a box that runs twenty relays. The other seven vantages, on hosts with 3
to 8 relays, show the same mechanism once (sfo3 → an M1 relay, 5.0 s, three times) and nowhere
else. Reading: a small-synaptome sender on a loaded host, not those eleven targets, every one
of which answered six or seven other vantages at normal RTT.

**2. One relay sits behind a local minimum (svc-08 on the Windows box, 6 of 8 vantages).**
Every failing walk to it ends `terminal` at hop 2 at the SAME node, a node that is not in the
fleet census, is at neither bridge's door now, and that east's bridge node evicted at 18:34Z
while it still answers routed messages. That node is XOR-closer to svc-08 than any of its own
neighbours, does not hold svc-08 in its synaptome, and so answers "nothing closer". The two
vantages that reached svc-08 took a path that avoided it. svc-08 itself is healthy: graduated,
38 of 38 channels bound. This is the greedy-strand class already on file from September: the
walk is only as good as the synaptome of whichever node it lands on, and a non-fleet node in
the right place strands every walk that lands there.

**3. A slow tail.** Thirty-two successful samples took over 2 s, 29 of them to targets on the
Windows box at two to four hops, and the four-hop p90 is 2.6 s. The same box hosts the stalled
vantage of mechanism 1. Both read as that host under 20 relays plus a vantage, with the
vantage's probes competing for the same node-datachannel threads; this run cannot separate the
host from the path, and a repeat with the Windows vantage omitted would.

What is not in these three: no `error` outcome occurred, no channel closed under a probe, no
walk misrouted to the wrong node, and no target was unreachable from everywhere.

## What would make these numbers wrong

- One run, three samples per pair, on a fleet 2.5 h past a full restart. A mature mesh reads
  differently in both directions: more neighbours per relay shortens walks, and the Windows box
  may not be loaded the same way again.
- The senders were newborn vantages with 6 to 9 neighbours. A relay with 40 would reach more
  targets in one hop and strand less often. The relay-as-sender number is not in this report.
- The Windows vantage's 46 failures are attributed to the sender by the timing signature and
  the direct-send control, not by an instrumented cause.
- The local-minimum node was not identified beyond "not fleet, not at a door now".

## What to do with it

- A relay-side probe facility, so the next run has relays as senders and the matrix is the
  one the question asks for. Design item.
- The greedy walk's local minimum (mechanism 2) is the same defect that strands a cold
  subscriber. The kernel already carries an iterative lookup for pub/sub roots; whether routed
  delivery should fall back to it when a walk ends `terminal` short of the target is a design
  question for David and the council.
- The two-hop search's 5 s timeout is what a stalled lookahead costs each sample; bounding it
  lower, or running the probes in parallel, changes the tail without changing the answer.
- Rerun with the Windows vantage on a different host to separate that box from its path.

## Tables

### Per vantage (routed path, listed targets = 51 relays + 2 bridges)

| vantage | synaptome | targets ok / listed | ok p50 ms | p90 | max | failures by outcome | direct ok/n | direct p50 ms |
|---|---|---|---|---|---|---|---|---|
| air | 7 | 53 / 53 | 219 | 505 | 3269 | - | 21/21 | 83 |
| axona-linux | 7 | 52 / 53 | 283 | 2301 | 4658 | {'exhausted': 3, 'terminal': 3} | 21/21 | 70 |
| axona-win | 8 | 41 / 53 | 161 | 4064 | 5261 | {'exhausted': 46} | 26/27 | 76 |
| droplet-sfo3 | 6 | 51 / 53 | 215 | 424 | 1042 | {'exhausted': 3, 'terminal': 3} | 18/18 | 81 |
| droplet-sfo3-grizzly | 9 | 52 / 53 | 249 | 505 | 2834 | {'exhausted': 2, 'terminal': 3} | 24/24 | 86 |
| droplet-tor1 | 9 | 52 / 53 | 235 | 412 | 3389 | {'terminal': 3} | 24/24 | 44 |
| m1 | 7 | 52 / 53 | 172 | 658 | 3052 | {'terminal': 3} | 24/24 | 77 |
| m4 | 7 | 52 / 53 | 241 | 461 | 4728 | {'exhausted': 1, 'terminal': 3} | 21/21 | 77 |

### Targets by reachability across vantages (routed, any sample ok)

- reachable from every vantage that tried: 40 of 53
- reachable from some vantages only: 13
  - axona-linux/relay-4: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - axona-win/svc-01: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - axona-win/svc-08: ok from 2/8; failing vantages → {'axona-linux': 'terminal', 'droplet-sfo3-grizzly': 'terminal', 'droplet-sfo3': 'terminal', 'droplet-tor1': 'terminal', 'm1': 'terminal', 'm4': 'terminal'}
  - axona-win/svc-13: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - axona-win/svc-18: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - droplet-axona-relay-nyc3/uswest.service: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - droplet-axona-relay-tor1/useast.service: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - m1/relay-1: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - m1/relay-3: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - m1/relay-4: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - m1/relay-5: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - m1/relay-6: ok from 7/8; failing vantages → {'axona-win': 'exhausted'}
  - m1/relay-8: ok from 6/8; failing vantages → {'axona-win': 'exhausted', 'droplet-sfo3': 'exhausted'}
- reachable from no vantage: 0

### Routed RTT by hop count (all vantages, ok samples, listed targets; the bridges' 0-hop rows excluded)

| hops | n | p50 ms | p90 ms | max ms |
|---|---|---|---|---|
| 1 | 144 | 152 | 437 | 1348 |
| 2 | 559 | 192 | 415 | 5261 |
| 3 | 377 | 271 | 912 | 4728 |
| 4 | 71 | 431 | 2586 | 4600 |

### Vantage host → target host, routed p50 ms (ok samples; '-' = no ok sample)

| vantage \ target | air | axona-linux | axona-win | bridge | droplet-axona-relay-nyc3 | droplet-axona-relay-sfo3 | droplet-axona-relay-sfo3-grizzly | droplet-axona-relay-tor1 | m1 |
|---|---|---|---|---|---|---|---|---|---|
| air | 250 | 251 | 279 | - | 281 | 159 | 103 | 224 | 164 |
| axona-linux | 206 | 231 | 571 | - | 220 | 163 | 86 | 60 | 195 |
| axona-win | 211 | 66 | 84 | - | 166 | 168 | 77 | 3391 | 16 |
| droplet-sfo3 | 161 | 365 | 244 | - | 204 | 158 | 161 | 214 | 215 |
| droplet-sfo3-grizzly | 159 | 282 | 220 | - | 322 | 165 | 254 | 275 | 380 |
| droplet-tor1 | 182 | 195 | 166 | - | 303 | 130 | 306 | 275 | 349 |
| m1 | 118 | 214 | 283 | - | 104 | 162 | 137 | 230 | 162 |
| m4 | 221 | 214 | 242 | - | 161 | 146 | 76 | 250 | 297 |

### Failure detail (routed, listed targets): outcome × hops × vantage

- exhausted at hops 0 from axona-win: 46 samples
- exhausted at hops 0 from axona-linux: 3 samples
- terminal at hops 2 from axona-linux: 3 samples
- terminal at hops 2 from droplet-sfo3-grizzly: 3 samples
- exhausted at hops 0 from droplet-sfo3: 3 samples
- terminal at hops 2 from droplet-sfo3: 3 samples
- terminal at hops 2 from droplet-tor1: 3 samples
- terminal at hops 2 from m1: 3 samples
- terminal at hops 2 from m4: 3 samples
- exhausted at hops 0 from droplet-sfo3-grizzly: 2 samples
- exhausted at hops 0 from m4: 1 samples

### Discovered, unlisted nodes (browsers, seats, others): 28 distinct, 56 of 85 vantage×node pairs reachable
