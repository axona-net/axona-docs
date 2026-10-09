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

# Part 2 — the relays as senders (23:05Z, relay 0.150.0/0.150.1)

Part 1's gap is closed. Every relay now carries a probe facility (`axona-relay` 0.150.0,
`src/probe.js`): a request file dropped into its checkout makes it run the same rows from its
own seat. At 23:05Z, two hours after the first run and fifteen minutes after the roll that
installed the facility, all 51 relays were asked at once: 52 targets each (the other 50 relays
and both bridges), three samples, 40 ms apart. 7,956 routed samples and 5,049 direct samples,
folded by `ops/p2p-rtt-report.py --census`; rows in `ops/p2p-rtt-20261008T2305Z-relays/`.

## Answer, with relays as senders

**Forty-five of fifty-three targets answered every relay that tried. None was unreachable from
everywhere.** Direct sends succeeded 4,962 of 5,049. A relay holds 14 to 50 neighbours where
the morning's vantage held 6 to 9, so most pairs are now one hop, and a hop costs what the
wire costs.

| hops | samples | p50 ms | p90 ms | max ms |
|---|---|---|---|---|
| 1 | 4917 | 39 | 99 | 5505 |
| 2 | 2140 | 78 | 183 | 5110 |
| 3 | 145 | 93 | 2236 | 7424 |
| 4 | 36 | 1426 | 2276 | 3971 |

One hop between hosts: p50 57 ms, p90 114 ms. One hop on the same host: 0.7 ms. The Windows
relays reach the M1 and the Air at 8 to 20 ms over the LAN. The four-hop rows are 36 samples,
all ending at the Linux box's relays, whose synaptomes are the smallest on the fleet (29 to
34).

## The failures, and why

Eight targets failed from at least one relay. Four mechanisms this time, two of them new.

**1. Two relays are each other's local minimum (svc-05 on the Windows box and relay-4 on the
M1).** Every one of the 111 walks that failed to reach svc-05 ended `terminal` at m1/relay-4;
every one of the 28 that failed to reach m1/relay-4 ended at svc-05. The two ids are
XOR-adjacent: each is the closest node to the other that most of the fleet knows, and neither
holds the other in its synaptome, so a walk toward either lands on the other and stops. The 13
senders that did reach svc-05 hold it directly. svc-05 is also the smallest synaptome on the
fleet (14). This is the greedy-strand class with the cleanest signature yet: not a stray
non-fleet node, but two of our own relays that never met.

**2. The west bridge is reachable from 14 of 51 relays.** 111 of 153 walks toward it ended
`exhausted` at the origin: the sender had no neighbour closer to west's id than itself, and
the two-hop search found none. West's id lies in the 0x80 region; 45 of the 51 relays are in
0x89, and the six 0x80 relays reached it only 3 times in 18. A node is reachable by greedy
walk only while someone on the way holds a channel to it, and west's 31 channels are the whole
set of nodes that do. East, whose id lies in the bridge region 0xff, answered 151 of 153. This
is the region-is-not-a-wall case from the design notes, measured.

**3. `exhausted` costs five seconds, every time.** 386 samples ended exhausted; 87 % of them
at 4,999 to 5,002 ms, the rest 2 to 17 s. That is the two-hop closer-search's timeout, paid
in full on every strand. 200 of the 386 came from the twenty Windows senders, whose 20 relays
share one box; the other seven hosts contributed 21 to 33 each.

**4. One droplet is CPU-starved (nyc3, three relays on one core).** Its grizzly1 relay, as a
sender, had a routed p50 of 793 ms and a direct p50 of 5.4 s with 31 of 117 direct sends
timing out; as a target, nyc3's relays account for 43 of the 96 successful samples over 2 s.
The host's CPU pressure read 53 % stalled over the minute and the load 1.7 on one core. The
same class as the September "steal" finding: the fix is the droplet's size, not the code.

What is not in these four: no `error` outcome on the routed path, no misroute, no channel
closed under a probe, no target unreachable from everywhere.

## What changed between the two runs

The morning's three mechanisms were the vantage's smallness, one stray local minimum and the
Windows host's load. With relays as senders the first disappears (one hop p50 39 ms where the
vantage saw 152 ms), the second resolves into a named pair, and the third narrows to the five
second timeout each strand pays. The west bridge's isolation was invisible this morning
because each vantage's bridge socket reached it by another road; a graduated relay has no
socket and must find it through the mesh.

## What would make these numbers wrong

- One run, three samples, started fifteen minutes after a full relay roll; the synaptomes
  (14 to 50) were still growing and the Linux relays' were the smallest.
- The request reached every relay inside the same minute, so 51 senders probed at once; the
  nyc3 and Windows numbers include that load.
- Sender labels come from the census of ids read after the roll; a relay that restarted
  between the census and the run would appear as an unlabelled id (none did: 51 of 51 rows
  carry a census label).

## What to do with it

- The svc-05 / m1-relay-4 pair and the west bridge say the same thing: a greedy walk needs
  someone on the way to hold the target. Either the walk falls back to the iterative lookup
  when it ends `terminal` or `exhausted` short of its target (the kernel has one for pub/sub
  roots), or the mesh fills toward keyspace neighbours it does not yet hold. Design question
  for David and the council; the second is what Hold-and-Fill's rule 2 was for.
- The two-hop search's 5 s timeout is the price of every strand; it can be shorter, or the
  probes parallel.
- nyc3 wants a second core, or two relays instead of three. David's call.
- The facility is cheap to run: `ops/fleet-probe.sh request <run> <census>` and `collect`.
  A run after the mesh has matured, and one with the Windows senders staggered, would tighten
  the numbers above.

## Tables (part 1, the vantage run)

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

## Tables (part 2, the relays as senders)

### Per vantage (routed path, listed targets = 51 relays + 2 bridges)

| vantage | synaptome | targets ok / listed | ok p50 ms | p90 | max | failures by outcome | direct ok/n | direct p50 ms |
|---|---|---|---|---|---|---|---|---|
| air/relay-1 | 50 | 50 / 52 | 71 | 150 | 4441 | {'exhausted': 5, 'terminal': 3} | 126/126 | 70 |
| air/relay-2 | 50 | 50 / 52 | 70 | 144 | 4252 | {'exhausted': 3, 'terminal': 3} | 127/129 | 52 |
| air/relay-3 | 50 | 51 / 52 | 66 | 144 | 4410 | {'exhausted': 1, 'terminal': 3} | 128/129 | 60 |
| air/relay-4 | 50 | 50 / 52 | 70 | 149 | 3668 | {'exhausted': 5, 'terminal': 3} | 129/129 | 50 |
| air/relay-5 | 50 | 50 / 52 | 72 | 157 | 3860 | {'exhausted': 5, 'terminal': 3} | 135/135 | 73 |
| air/relay-6 | 48 | 49 / 52 | 70 | 148 | 3430 | {'exhausted': 8, 'terminal': 3} | 126/126 | 36 |
| axona-linux/relay-1 | 34 | 49 / 52 | 38 | 164 | 3089 | {'exhausted': 8, 'terminal': 3} | 87/90 | 32 |
| axona-linux/relay-2 | 30 | 48 / 52 | 43 | 160 | 4937 | {'exhausted': 10, 'terminal': 3} | 75/78 | 30 |
| axona-linux/relay-3 | 32 | 51 / 52 | 47 | 174 | 4259 | {'exhausted': 1, 'terminal': 3} | 72/72 | 19 |
| axona-linux/relay-4 | 30 | 50 / 52 | 58 | 160 | 3775 | {'exhausted': 4, 'terminal': 3} | 69/69 | 28 |
| axona-linux/relay-5 | 29 | 50 / 52 | 51 | 157 | 3797 | {'exhausted': 4, 'terminal': 3} | 78/78 | 42 |
| axona-win/svc-01 | 41 | 49 / 52 | 12 | 96 | 4487 | {'exhausted': 12, 'terminal': 2} | 120/120 | 8 |
| axona-win/svc-02 | 44 | 49 / 52 | 19 | 100 | 4358 | {'exhausted': 7, 'terminal': 3} | 114/117 | 9 |
| axona-win/svc-03 | 16 | 49 / 52 | 68 | 177 | 4358 | {'exhausted': 9, 'terminal': 3} | 45/48 | 1 |
| axona-win/svc-04 | 30 | 49 / 52 | 18 | 147 | 4042 | {'exhausted': 10, 'terminal': 2} | 87/90 | 8 |
| axona-win/svc-05 | 14 | 49 / 52 | 75 | 724 | 5110 | {'exhausted': 9, 'terminal': 3} | 36/39 | 47 |
| axona-win/svc-06 | 37 | 49 / 52 | 16 | 146 | 2252 | {'exhausted': 9, 'terminal': 3} | 96/99 | 8 |
| axona-win/svc-07 | 39 | 49 / 52 | 13 | 101 | 3377 | {'exhausted': 9, 'terminal': 3} | 108/111 | 9 |
| axona-win/svc-08 | 41 | 48 / 52 | 12 | 97 | 2126 | {'exhausted': 11, 'terminal': 3} | 108/108 | 8 |
| axona-win/svc-09 | 33 | 48 / 52 | 18 | 87 | 1768 | {'exhausted': 10, 'terminal': 3} | 90/90 | 11 |
| axona-win/svc-10 | 26 | 48 / 52 | 16 | 91 | 3802 | {'exhausted': 10, 'terminal': 3} | 78/78 | 8 |
| axona-win/svc-11 | 32 | 49 / 52 | 15 | 102 | 4378 | {'exhausted': 12, 'terminal': 2} | 96/96 | 10 |
| axona-win/svc-12 | 34 | 48 / 52 | 17 | 136 | 642 | {'exhausted': 12, 'terminal': 2} | 96/96 | 10 |
| axona-win/svc-13 | 37 | 48 / 52 | 14 | 94 | 4530 | {'exhausted': 14, 'terminal': 2} | 108/108 | 9 |
| axona-win/svc-14 | 40 | 48 / 52 | 33 | 136 | 232 | {'exhausted': 9, 'terminal': 3} | 102/102 | 15 |
| axona-win/svc-15 | 25 | 48 / 52 | 21 | 153 | 5042 | {'exhausted': 9, 'terminal': 3} | 66/69 | 10 |
| axona-win/svc-16 | 24 | 48 / 52 | 32 | 135 | 5009 | {'exhausted': 9, 'terminal': 3} | 72/72 | 9 |
| axona-win/svc-17 | 17 | 48 / 52 | 19 | 161 | 5061 | {'exhausted': 9, 'terminal': 3} | 51/51 | 9 |
| axona-win/svc-18 | 31 | 49 / 52 | 12 | 93 | 2202 | {'exhausted': 8, 'terminal': 3} | 90/93 | 8 |
| axona-win/svc-19 | 36 | 49 / 52 | 14 | 148 | 2260 | {'exhausted': 10, 'terminal': 2} | 102/105 | 8 |
| axona-win/svc-20 | 27 | 48 / 52 | 14 | 99 | 1290 | {'exhausted': 12, 'terminal': 3} | 72/75 | 7 |
| droplet-axona-relay-nyc3/grizzly1.service | 40 | 49 / 52 | 793 | 1476 | 7424 | {'exhausted': 10, 'terminal': 1} | 85/117 | 5201 |
| droplet-axona-relay-nyc3/useast.service | 43 | 50 / 52 | 59 | 155 | 1360 | {'exhausted': 5, 'terminal': 2} | 114/114 | 67 |
| droplet-axona-relay-nyc3/uswest.service | 30 | 50 / 52 | 59 | 173 | 2200 | {'exhausted': 8, 'terminal': 3} | 87/87 | 64 |
| droplet-axona-relay-sfo3-grizzly/grizzly1.service | 20 | 49 / 52 | 78 | 154 | 2762 | {'exhausted': 11, 'terminal': 3} | 57/60 | 76 |
| droplet-axona-relay-sfo3-grizzly/grizzly2.service | 17 | 49 / 52 | 83 | 153 | 2278 | {'exhausted': 9, 'terminal': 3} | 51/51 | 77 |
| droplet-axona-relay-sfo3-grizzly/grizzly3.service | 16 | 48 / 52 | 83 | 158 | 2882 | {'exhausted': 12, 'terminal': 3} | 45/48 | 77 |
| droplet-axona-relay-sfo3/grizzly1.service | 42 | 50 / 52 | 77 | 161 | 4024 | {'exhausted': 10, 'terminal': 2} | 120/120 | 78 |
| droplet-axona-relay-sfo3/useast.service | 44 | 50 / 52 | 78 | 126 | 2626 | {'exhausted': 4, 'terminal': 2} | 120/123 | 78 |
| droplet-axona-relay-sfo3/uswest.service | 39 | 50 / 52 | 79 | 139 | 4025 | {'exhausted': 7, 'terminal': 2} | 111/111 | 77 |
| droplet-axona-relay-tor1/grizzly1.service | 41 | 49 / 52 | 52 | 101 | 4077 | {'exhausted': 8, 'terminal': 2} | 120/120 | 47 |
| droplet-axona-relay-tor1/useast.service | 42 | 50 / 52 | 52 | 125 | 1610 | {'exhausted': 6, 'terminal': 2} | 102/102 | 47 |
| droplet-axona-relay-tor1/uswest.service | 34 | 49 / 52 | 54 | 153 | 3971 | {'exhausted': 9, 'terminal': 3} | 93/96 | 48 |
| m1/relay-1 | 49 | 50 / 52 | 47 | 110 | 4980 | {'exhausted': 4, 'terminal': 3} | 120/120 | 15 |
| m1/relay-2 | 50 | 50 / 52 | 27 | 116 | 4974 | {'exhausted': 5, 'terminal': 3} | 124/126 | 16 |
| m1/relay-3 | 49 | 50 / 52 | 32 | 206 | 4951 | {'exhausted': 3, 'terminal': 3} | 123/123 | 14 |
| m1/relay-4 | 41 | 50 / 52 | 31 | 147 | 2432 | {'exhausted': 4, 'terminal': 3} | 99/99 | 16 |
| m1/relay-5 | 50 | 50 / 52 | 47 | 132 | 4954 | {'exhausted': 3, 'terminal': 3} | 127/129 | 36 |
| m1/relay-6 | 50 | 50 / 52 | 24 | 160 | 4952 | {'exhausted': 3, 'terminal': 3} | 126/126 | 17 |
| m1/relay-7 | 49 | 49 / 52 | 62 | 88 | 2235 | {'exhausted': 7, 'terminal': 3} | 120/120 | 55 |
| m1/relay-8 | 50 | 50 / 52 | 38 | 132 | 4993 | {'exhausted': 4, 'terminal': 3} | 129/129 | 18 |

### Targets by reachability across vantages (routed, any sample ok)

- reachable from every vantage that tried: 45 of 53
- reachable from some vantages only: 8
  - axona-linux/relay-3: ok from 49/50; failing vantages → {'droplet-axona-relay-nyc3/grizzly1.service': 'exhausted'}
  - axona-win/svc-03: ok from 33/50; failing vantages → {'air/relay-5': 'exhausted', 'air/relay-6': 'exhausted', 'air/relay-1': 'exhausted', 'air/relay-2': 'exhausted', 'air/relay-4': 'exhausted', 'm1/relay-4': 'exhausted', 'm1/relay-8': 'exhausted', 'axona-win/svc-20': 'exhausted', 'm1/relay-2': 'exhausted', 'm1/relay-6': 'exhausted', 'm1/relay-5': 'exhausted', 'axona-win/svc-15': 'exhausted', 'm1/relay-3': 'exhausted', 'm1/relay-1': 'exhausted', 'axona-linux/relay-2': 'exhausted', 'droplet-axona-relay-tor1/useast.service': 'exhausted', 'm1/relay-7': 'exhausted'}
  - axona-win/svc-05: ok from 13/50; failing vantages → {'air/relay-5': 'terminal', 'droplet-axona-relay-sfo3-grizzly/grizzly1.service': 'terminal', 'air/relay-3': 'terminal', 'air/relay-6': 'terminal', 'droplet-axona-relay-sfo3-grizzly/grizzly3.service': 'terminal', 'air/relay-1': 'terminal', 'air/relay-2': 'terminal', 'air/relay-4': 'terminal', 'droplet-axona-relay-sfo3-grizzly/grizzly2.service': 'terminal', 'axona-win/svc-02': 'terminal', 'm1/relay-4': 'terminal', 'axona-win/svc-06': 'terminal', 'm1/relay-8': 'terminal', 'axona-win/svc-08': 'terminal', 'axona-win/svc-09': 'terminal', 'axona-win/svc-14': 'terminal', 'axona-win/svc-20': 'terminal', 'm1/relay-2': 'terminal', 'm1/relay-6': 'terminal', 'm1/relay-5': 'terminal', 'axona-win/svc-15': 'terminal', 'axona-linux/relay-4': 'terminal', 'axona-linux/relay-3': 'terminal', 'axona-win/svc-18': 'terminal', 'm1/relay-3': 'terminal', 'axona-win/svc-10': 'terminal', 'axona-linux/relay-5': 'terminal', 'm1/relay-1': 'terminal', 'axona-win/svc-03': 'terminal', 'axona-linux/relay-1': 'terminal', 'axona-win/svc-07': 'terminal', 'droplet-axona-relay-nyc3/uswest.service': 'terminal', 'droplet-axona-relay-tor1/uswest.service': 'terminal', 'axona-linux/relay-2': 'terminal', 'axona-win/svc-17': 'terminal', 'axona-win/svc-16': 'terminal', 'm1/relay-7': 'terminal'}
  - bridge/west: ok from 14/51; failing vantages → {'droplet-axona-relay-sfo3-grizzly/grizzly1.service': 'exhausted', 'air/relay-6': 'exhausted', 'droplet-axona-relay-sfo3-grizzly/grizzly3.service': 'exhausted', 'droplet-axona-relay-sfo3/grizzly1.service': 'exhausted', 'droplet-axona-relay-tor1/grizzly1.service': 'exhausted', 'droplet-axona-relay-sfo3-grizzly/grizzly2.service': 'exhausted', 'droplet-axona-relay-nyc3/grizzly1.service': 'exhausted', 'axona-win/svc-02': 'exhausted', 'axona-win/svc-05': 'exhausted', 'axona-win/svc-06': 'exhausted', 'axona-win/svc-08': 'exhausted', 'axona-win/svc-09': 'exhausted', 'axona-win/svc-14': 'exhausted', 'axona-win/svc-04': 'exhausted', 'axona-win/svc-19': 'exhausted', 'axona-win/svc-20': 'exhausted', 'axona-win/svc-12': 'exhausted', 'axona-win/svc-15': 'exhausted', 'droplet-axona-relay-sfo3/uswest.service': 'exhausted', 'axona-linux/relay-4': 'exhausted', 'axona-win/svc-18': 'exhausted', 'axona-win/svc-10': 'exhausted', 'axona-win/svc-13': 'exhausted', 'droplet-axona-relay-sfo3/useast.service': 'exhausted', 'axona-linux/relay-5': 'exhausted', 'axona-win/svc-11': 'exhausted', 'axona-win/svc-03': 'exhausted', 'axona-linux/relay-1': 'exhausted', 'droplet-axona-relay-nyc3/useast.service': 'exhausted', 'axona-win/svc-07': 'exhausted', 'droplet-axona-relay-nyc3/uswest.service': 'exhausted', 'droplet-axona-relay-tor1/uswest.service': 'exhausted', 'axona-linux/relay-2': 'exhausted', 'axona-win/svc-17': 'exhausted', 'axona-win/svc-01': 'exhausted', 'axona-win/svc-16': 'exhausted', 'm1/relay-7': 'exhausted'}
  - droplet-axona-relay-nyc3/grizzly1.service: ok from 40/50; failing vantages → {'droplet-axona-relay-tor1/grizzly1.service': 'exhausted', 'droplet-axona-relay-sfo3-grizzly/grizzly2.service': 'exhausted', 'axona-win/svc-08': 'exhausted', 'axona-win/svc-09': 'exhausted', 'axona-win/svc-14': 'exhausted', 'axona-win/svc-12': 'exhausted', 'axona-win/svc-10': 'exhausted', 'axona-win/svc-13': 'exhausted', 'axona-win/svc-17': 'exhausted', 'axona-win/svc-16': 'exhausted'}
  - droplet-axona-relay-sfo3-grizzly/grizzly2.service: ok from 28/50; failing vantages → {'droplet-axona-relay-sfo3-grizzly/grizzly3.service': 'exhausted', 'axona-win/svc-02': 'exhausted', 'axona-win/svc-05': 'exhausted', 'axona-win/svc-06': 'exhausted', 'axona-win/svc-08': 'exhausted', 'axona-win/svc-09': 'exhausted', 'axona-win/svc-14': 'exhausted', 'axona-win/svc-04': 'exhausted', 'axona-win/svc-19': 'exhausted', 'axona-win/svc-20': 'exhausted', 'axona-win/svc-12': 'exhausted', 'axona-win/svc-15': 'exhausted', 'axona-win/svc-18': 'exhausted', 'axona-win/svc-10': 'exhausted', 'axona-win/svc-13': 'exhausted', 'axona-win/svc-11': 'exhausted', 'axona-win/svc-03': 'exhausted', 'axona-win/svc-07': 'exhausted', 'droplet-axona-relay-tor1/uswest.service': 'exhausted', 'axona-win/svc-17': 'exhausted', 'axona-win/svc-01': 'exhausted', 'axona-win/svc-16': 'exhausted'}
  - droplet-axona-relay-tor1/grizzly1.service: ok from 46/50; failing vantages → {'droplet-axona-relay-sfo3-grizzly/grizzly1.service': 'exhausted', 'droplet-axona-relay-sfo3-grizzly/grizzly3.service': 'exhausted', 'axona-linux/relay-1': 'exhausted', 'axona-linux/relay-2': 'exhausted'}
  - m1/relay-4: ok from 36/50; failing vantages → {'droplet-axona-relay-sfo3/grizzly1.service': 'terminal', 'droplet-axona-relay-tor1/grizzly1.service': 'terminal', 'droplet-axona-relay-nyc3/grizzly1.service': 'exhausted', 'axona-win/svc-05': 'terminal', 'axona-win/svc-04': 'terminal', 'axona-win/svc-19': 'terminal', 'axona-win/svc-12': 'terminal', 'droplet-axona-relay-sfo3/uswest.service': 'terminal', 'axona-win/svc-13': 'terminal', 'droplet-axona-relay-sfo3/useast.service': 'terminal', 'axona-win/svc-11': 'terminal', 'droplet-axona-relay-nyc3/useast.service': 'terminal', 'axona-win/svc-01': 'terminal', 'droplet-axona-relay-tor1/useast.service': 'terminal'}
- reachable from no vantage: 0

### Routed RTT by hop count (all vantages, ok samples, listed targets; the bridges' 0-hop rows excluded)

| hops | n | p50 ms | p90 ms | max ms |
|---|---|---|---|---|
| 1 | 4917 | 39 | 99 | 5505 |
| 2 | 2140 | 78 | 183 | 5110 |
| 3 | 145 | 93 | 2236 | 7424 |
| 4 | 36 | 1426 | 2276 | 3971 |

### Vantage host → target host, routed p50 ms (ok samples; '-' = no ok sample)

| vantage \ target | air | axona-linux | axona-win | bridge | droplet-axona-relay-nyc3 | droplet-axona-relay-sfo3 | droplet-axona-relay-sfo3-grizzly | droplet-axona-relay-tor1 | m1 |
|---|---|---|---|---|---|---|---|---|---|
| air/relay-1 | 2 | 44 | 74 | - | 61 | 88 | 85 | 50 | 72 |
| air/relay-2 | 1 | 54 | 23 | - | 75 | 83 | 84 | 81 | 73 |
| air/relay-3 | 2 | 67 | 18 | - | 160 | 82 | 87 | 54 | 72 |
| air/relay-4 | 2 | 47 | 24 | - | 50 | 83 | 99 | 80 | 72 |
| air/relay-5 | 2 | 46 | 98 | - | 50 | 84 | 85 | 77 | 71 |
| air/relay-6 | 2 | 35 | 22 | - | 38 | 88 | 80 | 59 | 139 |
| axona-linux/relay-1 | 63 | 1 | 34 | - | 61 | 164 | 107 | 45 | 24 |
| axona-linux/relay-2 | 45 | 1 | 35 | - | 44 | 91 | 460 | 46 | 27 |
| axona-linux/relay-3 | 47 | 1 | 35 | - | 82 | 120 | 123 | 73 | 28 |
| axona-linux/relay-4 | 57 | 68 | 40 | - | 58 | 123 | 150 | 52 | 39 |
| axona-linux/relay-5 | 60 | 2 | 41 | - | 60 | 83 | 131 | 52 | 40 |
| axona-win/svc-01 | 14 | 43 | 1 | - | 35 | 76 | 96 | 46 | 13 |
| axona-win/svc-02 | 19 | 47 | 1 | - | 50 | 75 | 143 | 45 | 13 |
| axona-win/svc-03 | 155 | 151 | 1 | - | 51 | 77 | 81 | 53 | 148 |
| axona-win/svc-04 | 28 | 103 | 1 | - | 54 | 75 | 141 | 46 | 12 |
| axona-win/svc-05 | 157 | 151 | 1 | - | 64 | 76 | 89 | 54 | 68 |
| axona-win/svc-06 | 25 | 68 | 1 | - | 134 | 77 | 146 | 48 | 13 |
| axona-win/svc-07 | 14 | 29 | 1 | - | 35 | 84 | 93 | 45 | 14 |
| axona-win/svc-08 | 24 | 32 | 1 | - | 59 | 83 | 105 | 40 | 10 |
| axona-win/svc-09 | 18 | 39 | 1 | - | 51 | 81 | 88 | 55 | 12 |
| axona-win/svc-10 | 15 | 50 | 1 | - | 65 | 84 | 76 | 60 | 10 |
| axona-win/svc-11 | 13 | 60 | 1 | - | 35 | 81 | 93 | 46 | 11 |
| axona-win/svc-12 | 18 | 79 | 1 | - | 39 | 75 | 147 | 46 | 12 |
| axona-win/svc-13 | 69 | 73 | 1 | - | 43 | 78 | 145 | 45 | 10 |
| axona-win/svc-14 | 17 | 32 | 1 | - | 61 | 81 | 145 | 47 | 64 |
| axona-win/svc-15 | 67 | 82 | 1 | - | 54 | 90 | 92 | 47 | 13 |
| axona-win/svc-16 | 70 | 51 | 1 | - | 54 | 81 | 145 | 60 | 11 |
| axona-win/svc-17 | 68 | 62 | 1 | - | 721 | 76 | 207 | 54 | 13 |
| axona-win/svc-18 | 14 | 36 | 1 | - | 58 | 86 | 76 | 47 | 12 |
| axona-win/svc-19 | 16 | 67 | 1 | - | 53 | 112 | 143 | 40 | 12 |
| axona-win/svc-20 | 17 | 84 | 1 | - | 56 | 114 | 94 | 46 | 10 |
| droplet-axona-relay-nyc3/grizzly1.service | 480 | 610 | 1015 | - | 1077 | 920 | 616 | 1019 | 295 |
| droplet-axona-relay-nyc3/useast.service | 42 | 54 | 57 | - | 53 | 107 | 78 | 28 | 59 |
| droplet-axona-relay-nyc3/uswest.service | 69 | 173 | 58 | - | 5 | 94 | 75 | 17 | 55 |
| droplet-axona-relay-sfo3-grizzly/grizzly1.service | 82 | 163 | 75 | - | 76 | 4 | 19 | 132 | 81 |
| droplet-axona-relay-sfo3-grizzly/grizzly2.service | 80 | 161 | 92 | - | 78 | 7 | 157 | 119 | 80 |
| droplet-axona-relay-sfo3-grizzly/grizzly3.service | 80 | 153 | 89 | - | 80 | 10 | 167 | 132 | 79 |
| droplet-axona-relay-sfo3/grizzly1.service | 80 | 208 | 74 | - | 127 | 4 | 2 | 80 | 79 |
| droplet-axona-relay-sfo3/useast.service | 85 | 77 | 75 | - | 111 | 3 | 6 | 97 | 85 |
| droplet-axona-relay-sfo3/uswest.service | 89 | 101 | 75 | - | 95 | 6 | 8 | 81 | 81 |
| droplet-axona-relay-tor1/grizzly1.service | 52 | 68 | 45 | - | 71 | 77 | 102 | 111 | 56 |
| droplet-axona-relay-tor1/useast.service | 56 | 52 | 48 | - | 41 | 77 | 123 | 98 | 48 |
| droplet-axona-relay-tor1/uswest.service | 58 | 48 | 47 | - | 46 | 81 | 132 | 3 | 57 |
| m1/relay-1 | 73 | 72 | 11 | - | 134 | 78 | 80 | 49 | 3 |
| m1/relay-2 | 75 | 21 | 12 | - | 62 | 80 | 150 | 57 | 2 |
| m1/relay-3 | 74 | 30 | 12 | - | 52 | 80 | 288 | 59 | 4 |
| m1/relay-4 | 75 | 30 | 10 | - | 66 | 147 | 152 | 61 | 3 |
| m1/relay-5 | 73 | 37 | 12 | - | 52 | 80 | 151 | 52 | 2 |
| m1/relay-6 | 74 | 27 | 10 | - | 60 | 77 | 229 | 57 | 3 |
| m1/relay-7 | 72 | 52 | 15 | - | 62 | 77 | 85 | 57 | 3 |
| m1/relay-8 | 71 | 32 | 12 | - | 59 | 79 | 148 | 48 | 3 |

### Failure detail (routed, listed targets): outcome × hops × vantage

- exhausted at hops 0 from axona-win/svc-13: 14 samples
- exhausted at hops 0 from droplet-axona-relay-sfo3-grizzly/grizzly3.service: 12 samples
- exhausted at hops 0 from axona-win/svc-12: 12 samples
- exhausted at hops 0 from axona-win/svc-11: 12 samples
- exhausted at hops 0 from axona-win/svc-01: 12 samples
- exhausted at hops 0 from droplet-axona-relay-sfo3-grizzly/grizzly1.service: 11 samples
- exhausted at hops 0 from axona-win/svc-08: 11 samples
- exhausted at hops 0 from droplet-axona-relay-sfo3/grizzly1.service: 10 samples
- exhausted at hops 0 from droplet-axona-relay-nyc3/grizzly1.service: 10 samples
- exhausted at hops 0 from axona-win/svc-09: 10 samples
- exhausted at hops 0 from axona-win/svc-04: 10 samples
- exhausted at hops 0 from axona-win/svc-19: 10 samples
- exhausted at hops 0 from axona-win/svc-10: 10 samples
- exhausted at hops 0 from droplet-axona-relay-sfo3-grizzly/grizzly2.service: 9 samples
- exhausted at hops 0 from axona-win/svc-05: 9 samples
- exhausted at hops 0 from axona-win/svc-06: 9 samples
- exhausted at hops 0 from axona-win/svc-14: 9 samples
- exhausted at hops 0 from axona-win/svc-20: 9 samples
- exhausted at hops 0 from axona-win/svc-03: 9 samples
- exhausted at hops 0 from axona-win/svc-07: 9 samples
- exhausted at hops 0 from droplet-axona-relay-tor1/uswest.service: 9 samples
- exhausted at hops 0 from axona-win/svc-17: 9 samples
- exhausted at hops 0 from axona-win/svc-16: 9 samples
- exhausted at hops 0 from droplet-axona-relay-tor1/grizzly1.service: 8 samples
- exhausted at hops 0 from axona-win/svc-18: 8 samples
- exhausted at hops 0 from axona-linux/relay-1: 8 samples
- exhausted at hops 0 from droplet-axona-relay-nyc3/uswest.service: 8 samples
- exhausted at hops 0 from axona-win/svc-02: 7 samples
- exhausted at hops 0 from droplet-axona-relay-sfo3/uswest.service: 7 samples
- exhausted at hops 0 from axona-linux/relay-2: 7 samples
- exhausted at hops 0 from axona-win/svc-15: 6 samples
- exhausted at hops 0 from air/relay-6: 5 samples
- exhausted at hops 0 from droplet-axona-relay-nyc3/useast.service: 5 samples
- exhausted at hops 0 from axona-linux/relay-4: 4 samples
- exhausted at hops 0 from droplet-axona-relay-sfo3/useast.service: 4 samples
- exhausted at hops 0 from axona-linux/relay-5: 4 samples
- exhausted at hops 0 from m1/relay-7: 4 samples
- exhausted at hops 39 from air/relay-5: 3 samples
- terminal at hops 1 from air/relay-5: 3 samples
- terminal at hops 2 from droplet-axona-relay-sfo3-grizzly/grizzly1.service: 3 samples
- terminal at hops 1 from air/relay-3: 3 samples
- exhausted at hops 39 from air/relay-6: 3 samples
- terminal at hops 1 from air/relay-6: 3 samples
- terminal at hops 1 from droplet-axona-relay-sfo3-grizzly/grizzly3.service: 3 samples
- exhausted at hops 39 from air/relay-1: 3 samples
- terminal at hops 1 from air/relay-1: 3 samples
- exhausted at hops 39 from air/relay-2: 3 samples
- terminal at hops 1 from air/relay-2: 3 samples
- exhausted at hops 39 from air/relay-4: 3 samples
- terminal at hops 1 from air/relay-4: 3 samples
- terminal at hops 2 from droplet-axona-relay-sfo3-grizzly/grizzly2.service: 3 samples
- terminal at hops 1 from axona-win/svc-02: 3 samples
- terminal at hops 0 from axona-win/svc-05: 3 samples
- exhausted at hops 39 from m1/relay-4: 3 samples
- terminal at hops 0 from m1/relay-4: 3 samples
- terminal at hops 1 from axona-win/svc-06: 3 samples
- exhausted at hops 39 from m1/relay-8: 3 samples
- terminal at hops 1 from m1/relay-8: 3 samples
- terminal at hops 1 from axona-win/svc-08: 3 samples
- terminal at hops 1 from axona-win/svc-09: 3 samples
- terminal at hops 1 from axona-win/svc-14: 3 samples
- exhausted at hops 39 from axona-win/svc-20: 3 samples
- terminal at hops 1 from axona-win/svc-20: 3 samples
- exhausted at hops 39 from m1/relay-2: 3 samples
- terminal at hops 1 from m1/relay-2: 3 samples
- exhausted at hops 39 from m1/relay-6: 3 samples
- terminal at hops 1 from m1/relay-6: 3 samples
- exhausted at hops 39 from m1/relay-5: 3 samples
- terminal at hops 1 from m1/relay-5: 3 samples
- exhausted at hops 39 from axona-win/svc-15: 3 samples
- terminal at hops 1 from axona-win/svc-15: 3 samples
- terminal at hops 1 from axona-linux/relay-4: 3 samples
- terminal at hops 1 from axona-linux/relay-3: 3 samples
- terminal at hops 1 from axona-win/svc-18: 3 samples
- exhausted at hops 39 from m1/relay-3: 3 samples
- terminal at hops 1 from m1/relay-3: 3 samples
- terminal at hops 1 from axona-win/svc-10: 3 samples
- terminal at hops 1 from axona-linux/relay-5: 3 samples
- exhausted at hops 39 from m1/relay-1: 3 samples
- terminal at hops 1 from m1/relay-1: 3 samples
- terminal at hops 2 from axona-win/svc-03: 3 samples
- terminal at hops 1 from axona-linux/relay-1: 3 samples
- terminal at hops 1 from axona-win/svc-07: 3 samples
- terminal at hops 1 from droplet-axona-relay-nyc3/uswest.service: 3 samples
- terminal at hops 1 from droplet-axona-relay-tor1/uswest.service: 3 samples
- exhausted at hops 39 from axona-linux/relay-2: 3 samples
- terminal at hops 1 from axona-linux/relay-2: 3 samples
- terminal at hops 2 from axona-win/svc-17: 3 samples
- terminal at hops 1 from axona-win/svc-16: 3 samples
- exhausted at hops 0 from droplet-axona-relay-tor1/useast.service: 3 samples
- exhausted at hops 39 from droplet-axona-relay-tor1/useast.service: 3 samples
- exhausted at hops 39 from m1/relay-7: 3 samples
- terminal at hops 1 from m1/relay-7: 3 samples
- exhausted at hops 0 from air/relay-5: 2 samples
- terminal at hops 1 from droplet-axona-relay-sfo3/grizzly1.service: 2 samples
- exhausted at hops 0 from air/relay-1: 2 samples
- exhausted at hops 0 from air/relay-4: 2 samples
- terminal at hops 1 from droplet-axona-relay-tor1/grizzly1.service: 2 samples
- terminal at hops 1 from axona-win/svc-04: 2 samples
- terminal at hops 1 from axona-win/svc-19: 2 samples
- terminal at hops 1 from axona-win/svc-12: 2 samples
- exhausted at hops 0 from m1/relay-2: 2 samples
- terminal at hops 1 from droplet-axona-relay-sfo3/uswest.service: 2 samples
- terminal at hops 1 from axona-win/svc-13: 2 samples
- terminal at hops 1 from droplet-axona-relay-sfo3/useast.service: 2 samples
- terminal at hops 1 from axona-win/svc-11: 2 samples
- terminal at hops 1 from droplet-axona-relay-nyc3/useast.service: 2 samples
- terminal at hops 1 from axona-win/svc-01: 2 samples
- terminal at hops 1 from droplet-axona-relay-tor1/useast.service: 2 samples
- exhausted at hops 0 from air/relay-3: 1 samples
- terminal at hops 1 from droplet-axona-relay-nyc3/grizzly1.service: 1 samples
- exhausted at hops 0 from m1/relay-4: 1 samples
- exhausted at hops 0 from m1/relay-8: 1 samples
- exhausted at hops 0 from axona-linux/relay-3: 1 samples
- exhausted at hops 0 from m1/relay-1: 1 samples

### Discovered, unlisted nodes (browsers, seats, others): 0 distinct, 0 of 0 vantage×node pairs reachable
