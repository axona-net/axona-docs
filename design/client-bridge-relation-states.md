# The client-to-bridge relation under socket-is-bootstrap: its states and their exits

axona 4. Testnet evidence of 2026-11-12. Written by axona.bot at David's direction.

## The question

When a client's WebRTC channel to a bridge replaces its WebSocket, what states
can the relation between that client and that bridge be in, and does every state
have a way out?

One state does not, for some nodes. A client can hold an OPEN socket to a bridge
and NO channel to it. An ordinary client with fewer than 3 mesh peers leaves that
state through a recovery path already in the kernel. A bridge acting as a client
does not leave it, and neither does a client holding exactly 3 mesh peers. This
note lists the states, shows where the exit is missing, and says what put a node
there.

**Corrected 2026-11-12 22:45Z.** The first version of this note (`b1ea8c4`) said
state E had no exit at all. That was wrong. I had read the socket's state
machine and not the repair plane. Orion's review (council `0125fac2`) found the
exit and the two cases without one, and traced the request I could not. The
corrections are marked where they fall.

## What this note is NOT

It is NOT a fix and it does NOT propose one. A timer that re-requests an
introduction would put the channel back after the failure. That repairs the
symptom. David rejected it on 2026-11-12 and it is withdrawn.

It is NOT about production. No production bridge runs with
`BRIDGE_SOCKET_IS_BOOTSTRAP`. Everything observed here is on the two testnet
bridges, bridge 2.188.0 (`6a538f2`) on kernel 4.134.0 (`57ebe70`).

## The rules as the code has them

The relation has two carriers: the WebSocket the client opened to the bridge's
door, and a WebRTC channel to the bridge's node.

1. **The channel retires the socket for good.** When the channel binds while the
   socket route is admitted, the socket route is *superseded*. Routing skips it.
   Its death is swallowed. "A superseded route is never re-promoted."
   (`src/transport/web/composite.js` 143–170, 200–240.)
2. **The channel then IS the relation.** A death on the admitted route kills the
   identity in the kernel. (Same file, 370–394.)
3. **The bridge closes the retired socket only for a well-meshed client.** It
   sends close code 4200 when the client's last reported mesh size is fresh and
   at or above `BRIDGE_GRADUATION_SAFE_FLOOR`, default 4. Below that the socket
   stays open. (bridge `src/server.js` 724–741.)
4. **Both of the client's ways back start from a socket that closed.** A close
   other than 4200 schedules a reconnect. A 4200 close with 3 or more mesh peers
   arms a watch that re-dials when the mesh thins below 3.
   (`src/transport/web/index.js` 376–402, 936–947.)

## The states

| | Socket | Channel to the bridge | How a node gets here | Exits |
|---|---|---|---|---|
| A | none | none | start, or after any socket close | dial the door → B |
| B | open, admitted | none yet | welcome and hello done | channel binds → C. Socket closes → A, reconnect |
| C | open, **superseded** | bound | the switch, mesh under 4 | bridge sees mesh ≥ 4 → 4200 → D. Socket closes → reconnect. Channel dies → **E** |
| D | none | bound | released by 4200, watch armed | mesh under 3 → re-dial → C. Seen: run NW1 |
| D' | none | **dead** | channel death in D with 3 or more other peers | none until the mesh falls under 3. Found by Orion |
| E | open, **superseded** | **dead** | channel death in C | mesh under 3 on an ordinary client → rewarm → C. **None** for a bridge as client (seen: NW2) or at exactly 3 peers |

State E has one exit, and it is a recovery path. When a node's mesh stays under
`MESH_REWARM_MIN` (3) for 3 maintenance ticks, the repair plane asks the bridge
for introductions on the open socket, at most once a minute and backing off to
ten. The bridge's answer names its reserved id first, the client dials it, and
the route record admits the new channel because the admitted route is empty.
(`src/pubsub/repairPlane.js` 462–486, `src/dht/AxonaPeer.js` 5338–5341, bridge
`src/server.js` 1562–1578. Traced by Orion; I read the first two after.)

Two kinds of node never take that exit:

- **A bridge acting as a client.** The bridge's engine gives the repair plane no
  `reintegrate` hook, so the rewarm never runs. And an armed bridge points
  `requestPeerIntroductions` at its own local directory feed
  (`src/bridge_axona_node.js` 206), so its fill "asks" itself. This is NW2.
- **A client with exactly 3 mesh peers.** Three is not under the rewarm minimum
  of 3, and it is under the release floor of 4. Neither rule fires.

State D' is Orion's. A released node whose channel to the bridge dies while 3 or
more other peers remain has no link to the bridge and no reason to re-dial until
its mesh thins. Orion also found that the bridge forgets a door channel only
when the SOCKET closes (`src/bridge_axona_node.js` 669), so for a node in state
E the bridge still believes the door channel is bound and will release the
socket on that stale belief if the node later reports 4 peers.

By the way, the socket in state E is not dead. On 2026-11-12 between 20:43Z and
20:47Z the second testnet bridge, sitting in state E, received WebRTC offers
from new hosts over that socket and formed channels to them. The socket still
signals. It will not carry the relation it was opened for.

## What was observed

Both runs: one region, three hosts, the alert-bot at the 11-11 06:46Z load. The
client under observation is the second testnet bridge, whose only upstream is
the first. Its uplink transport rows were written with `LOG_LEVEL=debug`.

**Run NW1, first bridge left alone. The way back works.**
- 19:52:26.015Z socket close 4200, mesh 4. State D.
- 19:53:31.101Z re-dial, mesh 2, floor 3.
- 19:53:43.636Z socket open, 12.5 s after the re-dial. Then welcome and hello.

**Run NW2, first bridge frozen for 45 s (SIGSTOP 19:55:36Z, SIGCONT 19:56:21Z by
a timer on its own host). State E.**
- The socket opened at 19:53:43Z was not released in this run. State C.
- 19:55:46.002Z the door channel closed, 10 s into the freeze.
- 19:55:59Z to 19:56:00Z the three host channels closed.
- After that: no socket close, no re-dial, no reconnect scheduled.
- 20:15:52Z, 20 minutes on: no channel, socket open at both ends.
- 19:59:09Z the node's fill asked the bridge for introductions on that socket
  and recorded the request as sent. No channel followed.

One run of each. NW2 shows the state can be entered and held for 20 minutes. It
does not give a rate.

## What put the node in state E

The channel died because the bridge stopped answering. In NW2 I stopped it. In
the suites of 2026-11-12 06:35Z to 07:26Z nobody did: the first bridge's event
loop logged 77 stalls totalling 526 s in the 06Z hour, the longest 26.5 s.

A CPU profile and a scheduler read under a two-region load (20:43Z to 20:47Z)
say what those stalls are:

- No one function holds the loop. The profile is 33% idle. The largest inclusive
  shares of the rest: routing and sends 25%, garbage collection 10%, role
  replication 9%, root beacons 8%, building error objects for failed sends 6%,
  ICE 6%.
- The main thread is runnable about 4.5 s of every 5 s and gets about 2.5 s. The
  hypervisor takes 44–50% of the one vCPU.
- It takes 55 to 2806 major page faults per 5 s. 587 MB of the process was in
  swap on a 458 MB host.

So the stall is a queue growing on a saturated loop. The production bridges have
2 vCPUs and 3915 MB each and showed 0–5% steal and no swapping at 19:47Z. That
makes state E less likely there. It does not close it. In NW2 the door channel closed 10 s into the
pause. Any pause of the bridge that long enters it.

## What is not known

- Whether the 13 hours the second bridge spent with no channel
  (06:33Z to 19:51Z) was state E. No transport rows were written then.
- What became of the 19:59:09Z introduction request: ANSWERED by Orion. It never
  left the second bridge. Its `requestPeerIntroductions` is wired to its own
  directory feed, which returned true. The first bridge's 80 s stall had nothing
  to do with it.
- Whether a client in state E that receives the bridge's reserved id again would
  dial it: by Orion's source trace, yes. Not tried on a running node.
- How often an ordinary client sits at exactly 3 mesh peers. Not measured.

## Questions this leaves, for David and the council

These are questions. I have a reading on the first and say so.

1. **Should a retired socket ever stay open?** The route rule treats the switch
   as final. The bridge treats release as conditional. My reading: these two
   were written at different times for different purposes, and state E is the
   gap between them. The floor of 4 comes from graduation, where the socket was
   the client's only link.
2. **Who owns the liveness of the relation?** Today the socket's state machine
   decides reconnects and the channel's ping decides death. Neither knows what
   the other concluded.
3. **Should a bridge carry a newcomer's whole first burst?** With the switch on
   and the fill off, a newcomer holds one channel, to the bridge. The alert-bot
   sends about 3800 publications in 17 s through it.
4. **Should a bridge hold roles?** Both testnet bridges run
   `BRIDGE_NEVER_ROOT=0`, as production does. At idle the first one was 84% idle, and
   its busy time went to re-replicating the roots it held (615 at 07:48Z) to
   peers it could not reach.
