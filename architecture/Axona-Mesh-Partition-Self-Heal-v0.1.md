# Mesh partition self-heal (v0.1)

**Status:** design packet for council review, revision 1 · **Date:** 2026-10-30 ·
**Kernel in production:** 4.125.0 (vendored in relay 0.174.0 on all 48 relays;
the relay repo is at 0.179.0) · **Bridge:** 2.174.0 (`dc7da03`) · **Policy set
by:** David · **Author:** axona.bot · **Builds on:** Mesh connectivity: hold and
fill v0.15 (its *Discovery across cohorts* and *Marks* sections) and Mesh
Signaling: Route First v0.2.1 (its Part 4B). Neither is restated here; where
this packet departs from them it says so.

Written under one rule, stated by David on 2026-10-30 and applied to every
line below: the bridge's job is to introduce new nodes into the mesh, and
otherwise it is a regular node. Anything that relies on the bridge after
introduction is a failed design, and this packet proposes nothing of the kind.

## The question

Forty-eight relays, all healthy by their own report, split into two halves on
2026-10-28 at 18:08Z and were still two halves two days later. The halves are
the host groups: the 20 Windows services on one side, the 19 Mac and Linux
relays on the other. Every lookup for `#council` ends on the Windows side; the
only full copy of `#council` sits on the Mac side; no browser sees the topic.

What in the mesh should have put the halves back together, and why didn't it?

## What this is NOT

This is not a bridge design. No proposal here routes a frame, a signal or a
lookup through the bridge after a node has graduated. The one place the bridge
appears is where it already belongs: the instant a newcomer is introduced.

It is not a kernel change. Nothing here is built. It is not the dual-root
story: the two `#council` roots of 10-17 and 10-28 were a symptom of the same
split and the merge machine healed one of them on 10-28 at 03:02Z; this packet
is about why the split exists at all.

It does not explain the whole routed-failure rate. Of the routed sends that
failed across the fleet in a 30-minute window on 10-30 (15:03Z to 15:33Z, the
relays' own `routed-outcomes` counters summed), 87% were aimed at relays that
were running at the time. That share is what a partition produces. The other
13% has other causes and is out of scope.

## What happened

The timeline, each figure with the read that produced it:

- **10-24 17:41Z.** The 4.125.0 roll. M1 relay slot 6 (`898af3d1`) starts and
  within four minutes holds links to all 20 Windows relays, 6 Air, 5 Linux and
  7 M1 relays (its own `pc-state` log, 139 distinct peers over its life).
- **10-28 14:11Z.** Slot 6's last link to an old Windows relay closes. This is
  one relay's view; the other Mac relays were not read for this event.
- **10-28 18:08:48Z to 18:08:50Z.** All 20 Windows services restart within two
  seconds, each with a new nodeId (their `svc-NN.log` first lines).
- **10-28 18:08:51Z.** The east bridge admits 21 client-hellos within one
  second. Seven of them graduate inside the next 20 seconds; at each
  graduation the bridge's admitted set is 18 to 23 connections, which is the
  restarting cohort plus a couple of clients (`peer-graduated` rows,
  `admitted` field). The peer-list the bridge sent is not logged, so its exact
  members are inferred from that count, not read.
- **10-28 18:10Z to 10-29 05:35Z.** Air relay slot 1 dials current Windows
  relays 48 times. Every offer is routed through the mesh, every one ends
  `reach: lookup-no, result: not-sent` (47 `send-failed`, one
  `walk-deadline`), every attempt times out at 30 s, and every target is then
  marked failed. After 05:35Z the relay never dials a Windows id again. Forty
  minutes before the restart, at 17:30:45Z, the same relay's offer to another
  relay crossed in three hops with a client as the second hop and bound.
- **10-30 15:1xZ.** From the `pc-state` logs of all 19 Air, M1 and Linux
  relays: 0 links to any of the 20 current Windows relays. Among themselves
  they hold 2 to 7 links per host group. Slot 6 reports 25 of 50 mesh slots
  filled, 29 of its own dials refused by its ledger, and no event in five
  days naming any current Windows id. Windows logs record `pc-state` only at
  startup and by bridge connection handle, so the Windows side's links cannot
  be rebuilt from logs; the droplets were not checked.
- **The same window.** Fleet routed failures 28% (M1 51%, Linux 39%, Windows
  29%, Air 20%, droplets 20%; 360 five-second counter windows per relay). The
  most-failed target in the fleet is slot 6, 3,878 failures from 14 relays.
  Its two `#council` backups have failed in both directions since 10-24
  18:58Z (418 `replicate-all-failed`, 653 `root-evicted` for no receipt), so
  the only full copy of `#council` is one process.

So the mesh is two islands with a few transient client links between them.
About 70% of routed sends still land, which is what those links buy.

## Why the mesh did not heal

Four defects, each named at a line in the code that runs today.

**D1. The introduction is whoever is on the socket.** The bridge builds a
newcomer's peer-list from the connections admitted at that instant
(`server.js:1285–1333`) and removes a node from that set when it graduates
(`maybeGraduate`, `:605`, `:644`). A relay that graduated days ago is invisible
to every later newcomer. Twenty relays that restart together are introduced
to each other. This was found on 2026-10-04 and is row 1 of hold-and-fill's
findings; it is still the code in production.

**D2. Nothing discovers across cohorts after graduation.** The only re-contact
in the kernel, `peer-list-request` (`transport/web/index.js:1504`), is sent
while a node is still on the bridge, as a mesh re-warm; the east log shows 17
such requests since 10-28, 12 of them from the Windows cohort in its first
minutes. Hold-and-fill v0.15's *Discovery across cohorts* (a directory with a
lifetime, periodic re-contact) was never built. Discovery by lookup walks a
node's bound peers, so a node learns only the island it is on. Slot 6 learned
no Windows id in five days.

**D3. A missing path is scored as a dead peer.** A dial to a stranger rides a
`mesh:signal` offer through the mesh. When no node can carry it across, the
origin reports `reach: lookup-no, result: not-sent` (`AxonaPeer.js:6514–6521`),
the attempt runs to its 30 s deadline, and the target is marked
(`AxonaPeer.js:808–810`). The mark's schedule (`DeadPeers.js:17–40`) is 30 s,
doubling, exhaustion at the fourth failure, then one attempt per 60 s. The
target was alive. Hold-and-fill's `FAIL(id, cause)` input makes no distinction
between "no answer" and "no path", so a healthy relay on the far island is
treated like a dead one.

**D4. Arming differs by host.** `ops/fleet.sh` arms fill, guard and gate on
Air and M1; the Linux host gets the pools and ledger only; the Windows
manifest (`hosts/axona-win.json`, `relay.env`) carries pools, ledger,
`LOOKUP_RESELECT` and `SUB_TERMINAL_VERIFY` and none of the fill flags. The
Windows island runs no fill at all. It never seeks a stranger.

One thing is read but not explained: why Air slot 1 stopped dialing Windows
ids altogether after 05:35Z, when the mark schedule should have allowed one
attempt per minute per target. The 10-04 reading that marks drop candidates
from maintenance was not re-verified today; `AxonaPeer.js:6296` is the
lookup's probe filter, not the candidate filter.

## The design

Four proposals, each with its invariant, its precondition, the remedy and how
we would see it. P1 is bootstrap-time and belongs to the bridge's one job. P2
and P3 are mesh-native. P4 is operational.

### P1. The introduction represents the mesh, not the socket

*Invariant:* a newcomer's first peer-list contains nodes from outside its own
join cohort whenever such nodes exist.

*Precondition:* the bridge knows nodes that are no longer on its socket, or the
newcomer stays until it has bound outside its cohort.

*Remedy, two shapes, David chooses (Q1):*

- (a) The directory as hold-and-fill v0.15 writes it: graduated nodeIds
  registered with a lifetime, a sample of them in every newcomer's list. The
  registry lives on the bridge, is written at introduction, and is read at
  introduction. Nothing after graduation touches it.
- (b) A graduation gate: a newcomer leaves the bridge only after it holds `k`
  bound peers that were NOT admitted in the same window `T` as itself. Twenty
  relays restarting together would then each wait for a link outside the
  twenty before graduating. No directory, no bridge state beyond the
  admission time it already keeps.

v0.15 also proposes PERIODIC RE-CONTACT: a graduated node returns to the bridge
on a slow timer to be re-introduced. Under the rule this packet is written
to, that is a bridge dependency after introduction, and this packet does not
carry it forward. If David reads re-introduction as introduction, it comes
back; otherwise P2 has to do that work in the mesh.

*Verify:* on testnet, restart a whole host group together; every restarted
node's first peer-list, or its graduation, names at least one node from the
other groups. On production, the bridge logs the peer-list members it sent
(today it logs only the count).

### P2. Peer exchange over the mesh

*Invariant:* a node learns, within a bounded time, every node its own peers
hold a link to. Two islands joined by one client therefore learn each other
through that client.

*Precondition:* the fill is armed on the node (hold-and-fill rule 2), so a
learned id is dialed under the fill budget and the attempt guard.

*Remedy:* a node periodically asks one bound peer, chosen at random, for a
sample of that peer's bound ids, and feeds the sample into its candidate cache.
The reply carries ids only. The ask rides the existing channel; no lookup, no
bridge, no root. This completes the lateral-spread loop that the 2026-10-04
reading found cut at the dial: the ids arrive, and the fill dials them. The
17:30:45Z success on 10-28 shows the path exists today, through a client that
held links to both sides; P2 makes finding such a path a matter of time, not luck.

*Bounds:* one ask per node per `T_pex`, one reply of at most `S_pex` ids,
dials from the sample charged to the same per-tick budget as every other
fill dial. Numbers in Q2.

*Verify:* the fleet link matrix (per-relay `pc-state` rebuild, which needs a
Windows-side log line carrying the nodeId) shows cross-group links on every
host within `k · T_pex` of a staged whole-group restart on testnet. A cold
lookup for `#council` from three fresh peers reaches the holder within the
hop cap.

### P3. A missing path is a deferral, not a loss

*Invariant:* a mark of kind `loss` is written only when an offer was sent and
no bind followed. An offer that was never sent writes no `loss` mark.

*Precondition:* the origin already knows the difference: `result: not-sent`
versus an offer that left.

*Remedy:* on `not-sent`, release the attempt guard's token, write no mark,
and leave the candidate eligible. Whether to keep a separate PATH mark, keyed
on the candidate with its own short schedule so a node does not re-dial an
unreachable id every tick, is Q3. Route First v0.2.1 Part 4B already says an
exhausted path repair "leaves the retry to the negotiation's own deadline and
the dialer's shared budget. No bridge, no root." P3 is the mark-side half of
that sentence.

*Verify:* the Air slot 1 sequence replayed on testnet: 48 `not-sent` offers
leave zero `loss` marks, and the dialer keeps the targets in its candidate
set; when a carrier appears the next dial binds.

### P4. One arming profile per release

*Invariant:* every relay in the fleet runs the same arming set, and a release
that leaves a host behind is reported PARTIAL.

*Precondition:* the arming set is written in one place per host type and read
back by the gate.

*Remedy:* `ops/fleet.sh` HOSTS, `hosts/axona-win.json` `relay.env` and the
droplet drop-ins carry the same `ARM_ENVS`; `ops/release.sh check` reads each
host's process environment and fails the row on a mismatch, as it already
does for `SUB_TERMINAL_VERIFY` on the droplets. Arming the Windows and Linux
fill is a production change under RELEASE-PROCEDURE.md and David's word (Q4).

## Operational standing, outside the design

Nothing in this packet is a restart. Two facts bound what any restart may do
today: the only full `#council` copy is M1 slot 6, with no working backup since
10-24, so slot 6 is not restarted until a backup replicates; and a Windows
relay restarted alone is introduced to the bridge's admitted set at that
instant, which under D1 is clients and the other Windows relays, so a rolling
restart of the Windows fleet does not by itself re-link the islands.

## How we would know

- Fleet link matrix: cross-group links ≥ 1 on every relay; 0 today on all 19
  readable relays.
- Cold lookup for `#council` from three fresh peers: `found: true` within the
  hop cap; 9 of 9 lookups `found: false` at 20 to 23 hops today.
- Routed failures over 30 minutes by the same counter: the 87% share aimed
  at live relays falls to the single digits.
- `#council` backups: `replicate-all-failed` stops; `root-evicted` for no
  receipt stops.

## Questions for David

- **Q1.** P1(a) directory or P1(b) graduation gate, or both. And whether
  v0.15's periodic re-contact is introduction or a bridge dependency.
- **Q2.** `T_pex` and `S_pex`. A first guess: 60 s and 16 ids, which at 48
  relays is under one frame per second fleet-wide.
- **Q3.** Whether `not-sent` carries a PATH mark with its own schedule, or
  only releases the token.
- **Q4.** Whether to arm fill, guard and gate on the Windows and Linux fleets
  now, before P1 to P3 exist. It would make the Windows island seek
  strangers; it would not by itself give it any to find.

## What would make this wrong

- The droplets were not read. If they hold links to both groups, the islands
  are three-way or not islands at all, and the 70% that lands rides the
  droplets, not clients.
- The Windows side's links are inferred from the Mac side's logs. A
  Windows-side read could show links the Mac side has retired.
- The peer-list members at 18:08:51Z are inferred from the admitted count.
- Why Air stopped dialing after 05:35Z is unknown. If the cause is the
  candidate cache and not the marks, P3 alone changes nothing.
- The 28% routed-failure rate sums five-second counter windows; it compares
  relays fairly and is not a count of distinct messages.

## Sources

Read on 2026-10-30, all read-only: east bridge `docker logs` 10-28 18:05Z to
18:30Z and `peer-list-rerequest` since 10-28; `relay-logs/*.log` on Air, M1
and Linux (`pc-state`, `routed-outcomes`, `relay-signal-origin`,
`negotiation-failed-marked`); `svc-*.log` on axona-win; `health-dump` by
SIGUSR1 on M1 slot 6 and Air slot 1; kernel 4.125.0 as vendored in
`axona-relay/vendor/axona-protocol/src`; bridge `src/server.js` at `dc7da03`;
`ops/fleet.sh`, `hosts/axona-win.json`. Recorded in `ops/STATE.md` from 22:20Z
10-29 to 15:5xZ 10-30.
