# Mesh partition self-heal (v0.2)

**Status:** design packet for council review, revision 2 · **Date:** 2026-10-30 ·
**Supersedes:** v0.1 (axona-docs `737bd5a`), left in place as record ·
**Revision driver:** the three reviews of v0.1 on 2026-10-30: Orion `355aed73`
(MPSH-1 to MPSH-5, every cited line re-read in the vendored 4.125.0 tree and
bridge `dc7da03` before it was taken), Vega `7ae3e026` (concurring), Aster
`7dd1f5c6` (six design points, relayed by David) ·
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
(`AxonaPeer.js:808–810`). The mark's schedule (`DeadPeers.js:84–85`) is 30 s,
doubling, exhaustion at the fourth failure, then one attempt per 60 s. The
target was alive. Hold-and-fill's `FAIL(id, cause)` input makes no distinction
between "no answer" and "no path", so a healthy relay on the far island is
treated like a dead one.

The same failure runs through a second table with no refill at all. The
attempt guard (`attemptGuard.js:38`, `:67`, `:101`) sets `expired` on the
fourth failure and `allow` then returns false for the life of the process.
Its only refill is `onFreshRecord` (`:151`), fired by the signed presence
hook (`AxonaPeer.js:876`), and `RELAY_PRESENCE` is not set on any host
(`ops/fleet.sh:40`). Both the guard and the mark are charged by the same
`onNegotiationFailed` (`AxonaPeer.js:801`, `:808`) with the reason
`'timeout'`, never `'not-sent'`. That is why Air slot 1 went silent: twelve
Windows ids, four dials each, 48 in all, then nothing, the question v0.1 left
open (Orion MPSH-1, count re-read from the log). Two more holes in the same
path: the fill removes the candidate from its cache the moment the dial is
`'held'` (`:2211`, after `:5995`), and the undelivered offer leaves its
`RTCPeerConnection`, pending slot and ledger charge standing for the full 30 s.

**D4. Arming differs by host, by design.** `ops/fleet.sh` arms fill, guard
and gate on Air and M1 and says why the rest are not (`:38–42`): the Linux
host, the Windows host and the droplets are the CONTROL POPULATION for the
peer survey. The Windows manifest (`hosts/axona-win.json`, `relay.env`)
carries pools, ledger, `LOOKUP_RESELECT` and `SUB_TERMINAL_VERIFY` and none
of the fill flags. v0.1 called this an oversight. It is a choice, and the
packet's point is narrower: a control arm that is also a whole host group
becomes an island the day that group restarts together. The Windows island
runs no fill. It never seeks a stranger.

Two readings carried as reported evidence, not as verified facts: the
fleet-log counts were read by one seat (Aster, `7dd1f5c6`); and the 10-04
reading that marks drop candidates from maintenance was not re-verified,
`AxonaPeer.js:6296` being the lookup's probe filter. `_usablePeers`
(`:1997`) does skip a marked id, which is why P3 keeps its cooldown out of
the mark table.

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
  registered with a lifetime, a sample of them in every newcomer's hello. Two
  conditions v0.1 missed. The sample travels in its OWN field: the `peers`
  list is bridge connection handles that `mesh.onPeerList`
  (`mesh.js:786`) dials over bridge signalling, and a 66-hex id dropped into
  it is signalled to the bridge, dropped there, and marked as a loss (Orion).
  And an id is no use without a path to it: a newcomer whose only bound
  peers are its cohort routes its offer across that cohort and nowhere else
  (D2). So P1(a) has a precondition: at introduction a node must exist that
  is bound to both the newcomer and the graduated nodes. The bridge can be
  that node as a REGULAR bound mesh peer with its own capped links
  (socket-is-bootstrap v0.5, `bridge_axona_node.js:88–98`, off today). That
  is the bridge acting as a regular node, which the rule allows; it is not
  recurring bootstrap, and v0.2 keeps the two apart as Aster asked.
  Freshness: a registration expires at `L_reg` and is renewed only by the
  node's own traffic through a bound peer that happens to be the bridge, not
  by returning to the socket; storage is bounded at `M_reg` entries, oldest
  evicted; a registered id is validated as 264-bit and not the newcomer
  itself. A registry written once and never refreshed cannot name a
  reachable node for long, and that is the loss v0.15's re-contact was
  paying for; whether this refresh covers it is Q1.
- (b) A graduation gate: a newcomer leaves the bridge only after it holds `k`
  bound peers that were NOT admitted in the same window `T` as itself, OR the
  nursery clock (`GRADUATION_MAX_NURSERY_MS`, 600 s, `server.js:465`) runs
  out, in which case it graduates anyway and the bridge logs
  `graduated-cohort-only`. On a cold boot or a roll larger than the bridge's
  cap (`BRIDGE_MAX_PEERS`, 15 on east, 32 by default at `:436`) no older
  peer exists and the gate is vacuous by the same clock; the log line is the
  signal that the fleet came up as one cohort. Today's region check in
  `graduation_select.js:76` could not help: region is the id's top byte, the
  20 Windows, 8 M1 and 5 Linux relays all share `89`, so one Windows relay
  satisfied the "not a region's last member" rule until all twenty restarted.

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

*Invariant:* every bound channel of a node is asked for its peers at least
once per `d · T_pex`, where `d` is the node's bound degree, and a NEWLY bound
channel is asked within `T_pex`. Two islands joined by one client therefore
learn each other through that client while the client's links last.

*What P2 cannot do:* merge two components with no surviving channel between
them. No mesh-only exchange can. With no cross-link the fleet's observable
state is PARTITIONED (the link matrix below reads 0 across groups) and only
an introduction, P1, merges it. v0.1 claimed more than this.

*Precondition:* the fill is armed on the node (hold-and-fill rule 2), so a
learned id is dialed under the fill budget and the attempt guard.

*Remedy:* every `T_pex` a node asks ONE bound channel, the one it has not
asked for longest (an unasked channel first), for a sample of that peer's
bound ids drawn uniformly without replacement from the peer's usable set,
`M ∪ I`, minus the asker, the peer itself and any door handle. Today's
`local_probe` and `find_closest_set` (`AxonaPeer.js:1133`, `:1158`) read the
synaptome only, which is `M`; a browser tab that spans two islands sits in
`I` as often as not when `M` is full, so a sample drawn from `M` alone misses
the one peer that matters (Orion). The ids go into the candidate cache under
a per-source cap, so sixteen ids from one peer cannot starve the near and
band entries behind the cache's full refusal (`:1849`). The reply carries
ids only. The ask rides the existing channel; no lookup, no bridge, no root.
This completes the lateral-spread loop that the 2026-10-04 reading found cut
at the dial: the ids arrive, and the fill dials them. The 17:30:45Z success
on 10-28 shows the path exists today, through a client that held links to
both sides.

*Bounds:* one ask per node per `T_pex`; one reply of at most `S_pex` ids,
each validated as a 264-bit id; a responder answers one asker per channel
per `C_pex` and ignores the rest; dials from the sample charged to the same
per-tick budget as every other fill dial; a per-source cap of `S_pex` cached
entries per peer. At 48 relays, `T_pex` 60 s and `S_pex` 16: 0.8 asks and
0.8 replies per second fleet-wide, 1.6 frames, about 25 KB a minute of ids.
v0.1 wrote "under one frame per second", which counted the asks and not the
replies (Aster). Numbers in Q2; they are test parameters, not targets.

*Verify:* the fleet link matrix (per-relay `pc-state` rebuild, which needs a
Windows-side log line carrying the nodeId) shows cross-group links on every
host within `d · T_pex` of a staged whole-group restart on testnet WITH one
surviving cross-link, and reads PARTITIONED, with no false progress, in the
same restart with none. A cold lookup for `#council` from three fresh peers
reaches the holder within the hop cap. Three lookups are not a repair; the
matrix is.

### P3. A missing path is a deferral, not a loss

*Invariant:* a mark of kind `loss`, and an attempt-guard failure, are written
only when an offer REACHED the target and no bind followed. An offer the mesh
could not deliver writes neither.

*Precondition:* the origin knows the difference. Today it does by the
pre-send veto, `reach: not-sent` (`AxonaPeer.js:6515`). Under Route First
v0.2.1 Part 4A that veto goes away and the offer is sent onto hop one, so
"not sent" stops existing; what remains is the route's verdict,
`consumed !== true` with `terminal-not-target` or `exhausted`
(`:6533–6539`), and a B2 probe that carries no SDP. P3 is keyed on CONFIRMED
NON-DELIVERY in either world, and never on a post-send transport timeout,
which is ambiguous (Orion MPSH-2).

*Remedy:* on confirmed non-delivery, the owning negotiation, and only its
current incarnation, aborts its `RTCPeerConnection` at once (releasing the
pending slot and the ledger charge without the 30 s wait), releases its guard
token without charging an attempt, writes no `loss` mark, and keeps the
candidate in the cache under its bound. The candidate gets a PATH cooldown,
`noPathUntil`, short and jittered, scoped to the candidate and the path
generation, stored on the candidate or the guard and NEVER in `DeadPeers`,
because `_usablePeers` (`:1997`) and the lookup's probe filter (`:6296`)
skip a marked id. Without the cooldown the fill's nearest-first order
(`:2174–2177`) keeps an unreachable cross-island id at the head of the cache
and it eats every one of the three dials a tick allows (Orion MPSH-5). Late
deadline and late success events for a negotiation already ended are fenced
by incarnation, as Route First A1 states. The attempt guard follows the
mark's refill: exhaustion ends at `R_refill`, not at process death, whether
or not presence is armed (MPSH-1). Route First v0.2.1 Part 4B already says an
exhausted path repair "leaves the retry to the negotiation's own deadline and
the dialer's shared budget. No bridge, no root." P3 is the mark-side half of
that sentence.

*Verify:* the Air slot 1 sequence replayed on testnet: 48 undelivered offers
leave zero `loss` marks and zero expired guard records, the dialer keeps the
twelve targets in its cache, each is re-dialed on its cooldown and no more
often, and when a carrier appears the next dial binds. The same replay with
delivered offers that time out at ICE writes the marks it writes today.

### P4. One arming profile per release

*Invariant:* every relay in the fleet runs the same arming set, and a release
that leaves a host behind is reported PARTIAL.

*Precondition:* the arming set is written in one place per host type and read
back by the gate.

*Remedy:* `ops/fleet.sh` HOSTS, `hosts/axona-win.json` `relay.env` and the
droplet drop-ins carry one declared arming set per host; `ops/release.sh
check` reads each host's EFFECTIVE flags from the process environment, as it
already does for `SUB_TERMINAL_VERIFY` on the droplets, and reports any
drift from the declaration by name. A control population stays a control
population if David wants one; the gate then shows it as declared, not as
drift. Arming the Windows and Linux fill is a production change under
RELEASE-PROCEDURE.md and David's word (Q4), and nothing in this review arms
anything.

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

Before any of that, on a seeded simulation and then a staged isolated
fleet (Aster's matrix): two components with no cross-link, which must read
PARTITIONED and nothing else; two components with one transient cross-link
that lives 2 to 4 minutes, the browser-tab case; saturated peers, churn,
stale and hostile samples, burst restarts, every budget at its bound; an
undelivered offer against a delivered offer that times out at ICE, with a
stale-generation race between them; and a read of the Windows and droplet
links and of the peer-list members the bridge actually sends. Measured:
cross-component links, time to first link as a distribution, routed
failures, backup receipts, bytes and concurrent work, not counts alone.

## Questions for David

- **Q1.** P1(a) directory or P1(b) graduation gate, or both. And whether
  v0.15's periodic re-contact is introduction or a bridge dependency.
- **Q2.** `T_pex`, `S_pex`, `C_pex` and the per-source cap, as test
  parameters: 60 s, 16 ids, 30 s, 16 entries. At 48 relays that is 1.6
  frames and about 25 KB a minute fleet-wide.
- **Q3.** Answered by the reviews and taken: a PATH cooldown on the
  candidate, jittered, scoped to candidate and path generation, outside
  `DeadPeers`. Open: its length, and whether the attempt guard's refill
  should follow `R_refill` with presence off.
- **Q4.** Whether the Windows and Linux fleets stay the control population
  now that a control arm has been seen to become an island, or whether they
  are armed with fill, guard and gate. Arming would make the Windows island
  seek strangers; it would not by itself give it any to find.

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
- TURN. The bridge mints a 2 h TURN credential at admission
  (`server.js:1250`); a graduated relay renews it by a turn-refresh re-dial.
  If cross-host links need a TURN relay candidate and the credential had
  lapsed, an offer could be DELIVERED and still fail at ICE, which reads as
  `timeout`, not `not-sent`. Air's 48 all read `not-sent`, so this is not
  what the log shows; a Windows-side or droplet read could show it (Orion).

## Sources

Read on 2026-10-30, all read-only: east bridge `docker logs` 10-28 18:05Z to
18:30Z and `peer-list-rerequest` since 10-28; `relay-logs/*.log` on Air, M1
and Linux (`pc-state`, `routed-outcomes`, `relay-signal-origin`,
`negotiation-failed-marked`); `svc-*.log` on axona-win; `health-dump` by
SIGUSR1 on M1 slot 6 and Air slot 1; kernel 4.125.0 as vendored in
`axona-relay/vendor/axona-protocol/src`; bridge `src/server.js` at `dc7da03`;
`ops/fleet.sh`, `hosts/axona-win.json`. Recorded in `ops/STATE.md` from 22:20Z
10-29 to 15:5xZ 10-30.
