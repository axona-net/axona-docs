# The introduction represents the mesh, not the socket (v0.1)

**Status:** design packet for council review, revision 1 · **Date:** 2026-10-31 ·
**Kernel in production:** 4.127.0 on Air and M1 (`cfbe91c`), 4.125.0 on every
other host · **Bridge:** 2.174.0 (`dc7da03`) · **Policy set by:** David,
2026-10-30: "the bridge's job is to introduce new nodes into the mesh, and
otherwise act as a regular node" · **Author:** axona.bot · **Builds on:**
Mesh Partition Self-Heal v0.2 (`87a608a`, its P1), The bridge socket is
bootstrap v0.5 (as built, kernel 4.107.0, bridge branch `socket-bootstrap`
`45e64dd`), Mesh connectivity: hold and fill v0.15 (`e4809d2`, *Discovery
across cohorts*) · **Requested by:** David, 2026-10-31, "Write up P1 as a
design packet for council".

## The question

What does an introduction have to contain for a newcomer to reach the mesh,
and not only the population that happens to hold a socket on the bridge at
that instant?

Twenty Windows relays restarted together at 18:08:48Z on 2026-10-28. Each was
introduced to the others and to nobody else, each graduated by the nursery
clock, and from that minute to this one the twenty hold links only to each
other. P2 and P3, rolled to Air and M1 on 10-30 and 10-31, do what they say:
an armed relay now asks its neighbours who they hold, and stops punishing an
identity the mesh cannot reach. Neither can carry an id across a gap no
channel spans, and the packet that designed them said so. The gap is made at
introduction. This packet is about that minute.

## What this is NOT

- NOT a return to the bridge after introduction. Hold-and-fill v0.15 wrote a
  periodic re-contact; it is withdrawn here, by the rule above, and nothing in
  this packet asks a graduated node to come back for anything but the TURN
  credential it already comes back for.
- NOT a change to P2, P3, the fill, the marks or the guard. They run as
  released.
- NOT a change to graduation's balance rule (`graduation_select.js`): which
  node leaves the bridge when it is full stays the keyspace-balance and
  vitality choice it is.
- NOT the bridge directory of `Bridge-Directory-Enumeration-and-Privacy
  v0.1`. That is the public list of bridges. This is a bridge's private memory
  of the nodes it has introduced, which never leaves it whole.
- NOT a remedy for the islands standing today. A node that is bound to both
  would merge them; this packet says how the next cohort gets one, not how the
  current one does.

## What an introduction is today, in the order a newcomer sees it

Read in bridge `dc7da03` and kernel 4.127.0.

1. **Welcome.** The newcomer's socket is admitted; it holds no identity yet.
   Its region is a claim in the client-hello, or null (`server.js:1198`).
2. **The peer-list.** The bridge draws the anchors from its own CONNECTION
   TABLE, admitted sockets only (`server.js:1291–1312`): `selectAnchors` over
   `connections`, `k` 8, uptime at least 15 s, bounding engaged only when the
   eligible pool is at least `3k` (`anchor_select.js`), same region first
   (`:1324`). With the door flag on, the bridge's own reserved id goes first
   (`:1329–1332`); on east the flag is off (`/opt/axona-bridge/.env` read
   2026-10-31, no `BRIDGE_SOCKET_IS_BOOTSTRAP` line; `BRIDGE_MAX_PEERS=15`,
   `BRIDGE_MESH_MAX_PEERS=50`, `BRIDGE_NURSERY=on`, `BRIDGE_ANCHOR_MIN_POOL=10`).
   The entries are connection handles, `c<n>`, not node ids.
3. **The dials.** The kernel's mesh dials every handle it does not hold
   (`mesh.js:786`, `onPeerList` → `_initiateTo`), signalling through the
   bridge socket, which forwards a frame only to a connection it holds
   (`server.js:1548–1566`: `case 'signal'`, dropped when `connections` lacks
   the recipient). The kernel's directory step nominates the
   same handles into the candidate cache (`AxonaPeer.js`, `onPeerList`).
4. **Graduation.** Above `BRIDGE_MAX_PEERS` plus slack the bridge closes one
   socket per interval with 4200 (`server.js:605–644`): the best-meshed node
   of the most over-represented region, never a region's last member, or
   whoever has sat longest once `GRADUATION_MAX_NURSERY_MS` (600 s) runs out
   (`graduation_select.js:50–79`). The bridge records the graduated id for its
   cooldown (`graduatedRecently`, `:641`) and otherwise forgets it.
5. **After.** The graduated node's socket is gone. `requestPeerIntroductions`
   needs an open socket (`web/index.js:1503`), so the fill's directory step
   reads `unavailable` for the life of the process. The one return that exists
   is the TURN refresh re-dial (`web/index.js:654–690`), which a 2.155.0
   bridge answers with welcome and 4200 and NO peer-list (`server.js:479`).

So a node's whole supply of introductions is one list, drawn from one
instant's socket population, bounded at 15 on east. Twenty relays restarting
in three seconds are that population. Region could not separate them: every
Mac, Linux and Windows relay carries region `89`, so the "last member"
rule (`graduation_select.js:76`) was satisfied by any of them.

## The invariant

A newcomer's introduction names at least one node that was not admitted in
the newcomer's own window, and gives the newcomer a path to signal to it.

Two things have to be true for that, and today neither is:

- **The bridge has to know such a node.** After graduation its connection
  table does not; the id survives only in a cooldown map.
- **The newcomer has to be able to reach it.** An id is not a path. A
  newcomer's offer to a 66-hex id is routed over the mesh when the newcomer
  is meshed and falls to the bridge socket when it is not (`web/index.js:
  554–580`), and the bridge forwards only to a socket it holds. A graduated id
  dropped into the `peers` list is signalled to nobody and marked as a loss
  (Orion, MPSH-3). Something bound to both the newcomer and the older
  population has to exist at the moment of the first dial.

## The design, in the order each part needs the one before

### P1.0 The bridge is a peer

*What it is.* The bridge socket is bootstrap v0.5, as built in kernel 4.107.0
and bridge branch `socket-bootstrap` `45e64dd`, behind
`BRIDGE_SOCKET_IS_BOOTSTRAP` (default off; `socket_bootstrap.js:26–40`:
`BRIDGE_PROVISIONAL_MAX` 20, `BRIDGE_BIND_DEADLINE_MS` 15 s,
`BRIDGE_MAKE_ROOM_PER_MIN` 4, `BRIDGE_SOCKET_BOOTSTRAP_MIN_KERNEL` 4.107.0,
`BRIDGE_SOCKET_BOOTSTRAP_COOLDOWN_MS` 60 s). The newcomer's first channel is
to the bridge itself, under the bridge's reserved id; the bridge's own node
holds mesh channels, up to `BRIDGE_MESH_MAX_PEERS` (50), filled by the fill
and by every newcomer at its door; the socket is retired once the newcomer is
bound and meshed. Fences `fence_route_token` (44), `fence_mesh_attempt` (32),
`fence_socket_bootstrap` (51). It has never run on a production bridge.

*Why it is P1's first part.* It satisfies both halves of the invariant with
nothing new. The bridge's node is bound to the newcomer the moment the door
channel binds, and bound to the older population through its own mesh. An
offer from the newcomer toward any node the bridge holds a channel to routes
through the bridge as a hop, as through any relay. And P2, released, then does
the rest: the newcomer asks the bridge who it holds, the bridge's usable set
is the sample, and the fill dials across. A cohort of twenty that restarts
together is introduced to the bridge first, and through the bridge to
everyone the bridge holds. That is the bridge acting as a regular node with
many links, which the rule allows, and it is not a return to the socket.

*Invariant:* every newcomer binds one mesh channel to the bridge before its
socket is retired, and the bridge's mesh holds at least one channel to a node
admitted before the newcomer's window.

*Precondition:* the bridge's own mesh FILLS. v0.5 recorded that east dialled
63 times in twelve minutes on 2026-10-07 and opened nothing, because its only
signalling path for a dial was its uplink. With the door on, east's mesh grows
by one channel per newcomer at its door with no uplink involved (v0.5 § The
rule); whether its fill dials beyond that succeed is a measurement. The two
bridges' current mesh populations were NOT read for this packet: the health
reads were refused by the operator's permission classifier on 2026-10-31,
and this packet says so instead of guessing.

*Remedy:* arm `BRIDGE_SOCKET_IS_BOOTSTRAP=1` on west, measure for an hour,
then on east, by v0.5 § Rollout. Every relay is on 4.107.0 or later, so no
client runs the legacy path at the door. No kernel change.

*Verify:* after the next whole-cohort restart on the testnet, the fleet link
matrix shows every newcomer bound to the bridge within `BRIDGE_BIND_DEADLINE_MS`
of its door channel opening, and a channel from a newcomer to a pre-restart
node within `d · T_pex` of that bind. A cold lookup for a standing topic
reaches its holder within the hop cap.

### P1.a The introduction carries a sample of the graduated

*What it is.* The bridge keeps a REGISTRY of the ids it has graduated: the
`graduatedRecently` map it already writes at `server.js:641`, kept for
`L_reg` instead of the cooldown, bounded at `M_reg` entries with the oldest
evicted, each id validated as 66-hex at write. Every peer-list carries, in a
field of its own named `graduated` and never in `peers`, a sample of
`R_sample` ids drawn uniformly without replacement from the registry, minus
the newcomer itself. The kernel nominates the sample into the candidate cache
as source `directory`, the path the `onPeerList` handler already takes for
`peers`; the mesh does NOT dial the sample, because a 66-hex id is not a
connection handle (Orion, MPSH-3), and the dials come from the fill under its
budget, through whatever path the newcomer holds.

*Why it is second.* With P1.0 on and a fleet at or below the bridge's mesh
cap, the bridge's own channels already span every cohort and the sample adds
nothing. The sample is for the fleet larger than the cap, where the bridge
holds a balanced subset and a newcomer's cohort could still miss the half of
the mesh the bridge is not bound to; and for a bridge whose door is off. It
makes the registry the bridge's memory of the mesh, which it has today only
as a cooldown.

*Freshness, without a return.* A registered id is not refreshed. It expires
at `L_reg`, and a dead one costs the newcomer one dial that P3 turns into a
path cooldown doubling toward ten minutes (4.127.0). That is the whole cost
of a stale entry, and it is why v0.15's re-contact is not needed: the
re-contact existed to keep the registry warm, and a warm registry is worth
less than the rule it breaks.

*Privacy.* The registry never leaves the bridge whole. A newcomer sees
`R_sample` ids per admission, drawn at random, which is the "partition the
view" shape of `Bridge-Directory-Enumeration-and-Privacy v0.1` § 5.2; the
public `/healthz` carries the registry's size and nothing in it. A requester
that re-admits to redraw is bounded by the door's identity cooldown and by
`BRIDGE_MAX_PEERS`.

*Invariant:* every peer-list sent while the registry is non-empty names at
least one graduated id outside the newcomer's admission window.

*Precondition:* a path, which is P1.0's channel to the bridge, or any bound
anchor that holds a link to the sampled id. Without one the nominations sit in
the cache and the fill's dials end `not-sent`, which P3 defers; no harm, no
gain.

*Remedy:* bridge: the registry write at graduation, the sample at list time,
the `graduated` field; kernel: `onPeerList` reads the field and nominates;
both behind one bridge flag, `BRIDGE_GRADUATED_SAMPLE`, default off; a kernel
without the field ignores it.

*Verify:* a bridge fence: twenty admissions in one window, then a
twenty-first, whose list carries `R_sample` ids none of which was admitted in
that window, and whose `peers` carries no 66-hex id. A kernel fence: the
sample is nominated as `directory`, is never dialled by the mesh, and is
dialled by the fill under its budget.

### P1.b The graduation gate

*What it is.* A newcomer is graduated only if its introduction REACHED
outside its cohort: its peer-list carried at least one anchor admitted more
than `T_cohort` before it, or at least one `graduated` id, or the door flag
is on and its channel to the bridge has bound; failing all three it is held
until the nursery clock (600 s) runs out, and then graduated anyway with a
log line `graduated-cohort-only` that names the cohort's size. On a cold boot,
or a restart larger than `BRIDGE_MAX_PEERS`, no older node exists and the gate
is satisfied by the clock alone; the log line is the record that the fleet
came up as one cohort.

*Why it is third.* It changes nothing about who is introduced to whom; it
only refuses to call a node meshed when the bridge can see that it was
introduced to its own cohort and nobody else. With P1.0 or P1.a on it is
satisfied by construction and costs nothing; with both off it holds a cohort
at the door for up to ten minutes, which is the time an older node has to
arrive and be anchored to the cohort's lists.

*Invariant:* no node is graduated by vitality or uptime whose only
introductions were its own window.

*Precondition:* the bridge keeps, per admitted connection, the admission
times of the anchors it listed and whether a `graduated` id was listed. Both
are the bridge's own records.

*Remedy:* a predicate in `maybeGraduate` before `selectGraduate`, reading the
connection's introduction record; the ceiling basis is exempt. No kernel
change, no wire change.

*Verify:* a bridge fence: twenty admissions in one window with no registry
and the door off are not graduated on vitality at 20 s; one anchor admitted
`T_cohort` earlier lets them graduate; at the ceiling they graduate with the
log line.

## Operational standing

Nothing here is built. P1.0 is built and off; P1.a and P1.b are not built.
Nothing in this packet arms, restarts or deploys anything. The two bridges'
mesh populations were not read. Every count above is from the 10-28 record,
the code, and the east `.env`.

## How we would know

- The fleet link matrix after a staged whole-cohort restart on the testnet:
  with P1.0 on, every newcomer bound to the bridge and to at least one
  pre-restart node within `d · T_pex` of its bind; with the door off and
  P1.a on, the same through an anchor; with both off and P1.b on, the cohort
  held at the door and logged.
- The bridge's own mesh degree, read from its health endpoint by the operator,
  hourly after the door is armed: it must rise by one per newcomer and hold
  near its cap. If it does not fill, P1.0's precondition is false and P1.a
  carries the load alone.
- A cold lookup for `council` from a fresh eagle peer: found, within the hop
  cap. It has read `found:false` at every reading since 10-28.
- The registry's size on `/healthz` against `M_reg`; `graduated-cohort-only`
  lines per day, which should be zero outside cold boots.

## Questions for David

- **Q1.** Arm the door, west first and then east, before anything else in
  this packet is built. It is built, fenced and off, and it is the one part
  that needs no new code.
- **Q2.** Build P1.a now as the fallback for a fleet above the bridge's mesh
  cap, or wait for the door's hour of measurements.
- **Q3.** `R_sample` 16, `L_reg` 24 h, `M_reg` 4096, `T_cohort` 60 s. All are
  test parameters; `M_reg` is about 270 KB of ids.
- **Q4.** Whether the registry survives a bridge restart. The proposal is no:
  it is bootstrap state, and a bridge that comes up cold has no mesh to
  remember until it introduces one.

## What would make this wrong

- The bridge's mesh may not fill. v0.5 recorded east opening nothing in
  twelve minutes of dials; the door changes the newcomer side of that and
  not the fill side. Unread for this packet.
- A bridge bound to both islands is one hop that every cross-island offer
  crosses until P2 spreads direct links. That is a hotspot for the minutes
  it lasts, bounded by the fill's three dials a tick and by P3's backoff;
  it is not measured.
- `BRIDGE_MESH_MAX_PEERS` 50 holds the present fleet of 48 and not the next
  one. Above it the bridge holds a balanced subset, which is P1.a's case.
- The door has fences and no production hour. v0.5 lists what only the
  testnet can establish.
- `T_cohort` 60 s is a guess at a restart's width. The 10-28 cohort came up
  in three seconds; a roll by hand takes minutes and would read as several
  cohorts, each gated against the one before, which is harmless.
- The TURN credential re-dial is the one return that exists and is left
  alone. If a future reading shows it carrying introductions, that is
  recurring bootstrap and is out.

## Sources

Read on 2026-10-31, all read-only: bridge `src/server.js` at `dc7da03`
(`:405–428`, `:429–494`, `:583–650`, `:1198`, `:1280–1340`, `:1481–1493`,
`:1548–1566`),
`src/graduation_select.js`, `src/anchor_select.js`,
`src/socket_bootstrap.js:26–62`, `src/bridge_axona_node.js:88–102`; kernel
4.127.0 `src/transport/web/index.js` (`:129`, `:554–580`, `:654–690`,
`:1503`, `:1665–1676`), `src/transport/web/mesh.js:786`; east
`/opt/axona-bridge/.env` (arming lines only); axona-docs `Axona-Bridge-Socket-
Is-Bootstrap-v0.5.md` (§ The rule, § Signalling domains, § As built, § What
this document does not establish), `Axona-Mesh-Connectivity-Hold-and-Fill-
v0.15.md` (§ Discovery across cohorts, § What this design does not establish,
§ Parameters), `Bridge-Directory-Enumeration-and-Privacy-v0.1.md` (§ 5),
`Axona-Mesh-Partition-Self-Heal-v0.2.md` (D1, D2, P1, Q1). Recorded in
`ops/STATE.md` from 01:35Z 2026-10-31.
