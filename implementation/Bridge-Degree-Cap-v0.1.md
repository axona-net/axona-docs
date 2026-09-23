# Bridge Degree Cap — proposal v0.1

**Status:** proposal, for council perspectives. David's direction, 2026-09-23.
It replaces the Bridge Air-Gap approach as the primary line of work; that plan's
branches are pushed and are parked, not deleted.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-23
**Baseline:** axona-protocol main (kernel 4.88.0), axona-bridge main (2.130.0).
Not the air-gap branches.
**Companions:** council 56509c6f and the thread above it; ops/STATE.md
2026-09-23; Bridge-Air-Gap-Plan v0.1 through v1.1 (parked)

---

## 1. The question

Why is the bridge on the path of messages that have nothing to do with it?

## 2. The answer, and it is not a rule violation

Nothing is misbehaving. The bridge is chosen because choosing it is correct.

Greedy routing with lookahead asks each neighbour whether it knows a node closer
to the target. A neighbour's worth is how much of the keyspace it can see. The
bridge can see all of it, because every node dials the bridge to join and then
keeps that connection. Measured on the east production bridge at 03:30Z on
2026-09-23, on bridge 2.130.0 and kernel 4.88.0 after two hours and sixteen
minutes of uptime:

| | |
|---|---|
| admitted connections | 61 |
| of those in its routing table | 61 |
| configured peer cap | 32 |
| peers ever graduated | 0 |
| bounded introductions ever made | 0 |
| admission layer reports saturated | yes |

Every node it knows, it can reach in one hop. So for almost any target it is the
best answer any neighbour can give. During the east investigation the bridge
answered "I know someone closer" for between 31 and 74 percent of the probes it
received, against a mesh-wide rate of 2.7 percent for an ordinary reply. Two
thin-mesh relays then pushed 72.6 GB of the bridge's 84.5 GB of traffic through
it, at about 400 KB/s in each direction, on a host with one virtual CPU and
about half its cycles lost to steal.

The bridge is not a router that misrouted. It is the best node in the mesh, and
the mesh is using it correctly.

## 3. The proposal

Stop making it the best node. Cap the number of connections it holds at fifteen.

A bridge with fifteen neighbours sees fifteen nodes. It is then worth asking for
a hop only when one of those fifteen is closer, which is what any fifteen-degree
node offers. It remains the ideal hop for exactly those fifteen, which is
correct, because those fifteen are the nodes it just introduced.

The cap is also a preview. No bridge in a network of any size can hold a socket
to every node; its degree will be bounded by its hardware whatever we decide. A
small cap today makes a small network behave the way a large one will, so what
we measure now is the regime we will actually run in.

## 4. Why a cap and not a rule

The parked plan made the bridge unattractive by rule: classify every connection,
filter every chooser, refuse every forbidden write. Two ways around it were found
inside a day, each one an exception that leaked. A frame restamped with the
bridge's own identifier inherited the bridge's own privileges. A discovery walk
that arrived from a client was relayed onward because a forwarded walk looks
exactly like the bridge's own query.

A cap has no exception to leak. The bridge is not forbidden from being the best
hop. It stops being the best hop.

## 5. The control already exists, and it is switched off

The bridge has a peer cap and a graduation mechanism today. `BRIDGE_MAX_PEERS`
defaults to 32. Above the cap plus a slack of two, the bridge releases one
established, well-meshed peer every three seconds with a close code the client
reads as "stay meshed, do not reconnect", never dropping a region to its last
representative, never below a floor of four, never the same node twice inside a
minute. A bounded nursery introduces a newcomer to eight anchors instead of to
everyone.

Both of those are behind one switch, and on both production bridges that switch
reads `BRIDGE_NURSERY=off`. That is why the counters above read 61 connections
against a cap of 32, zero graduations, and zero bounded introductions.

It was turned off deliberately. The 4.38.0 team update records the reason: the
graduation close was mishandled by browser clients below 4.37, and production had
cached old clients. The same note names the condition for turning it back on, a
client population at 4.37 or newer, and calls the change one environment flip and
a restart.

That condition now holds. Every one of the 61 clients on the east bridge at
03:35Z reported a version: 52 at 4.88.0, six at 4.84.0, three at 4.87.0. None
below 4.37.0. The measurement is a snapshot of one bridge at one moment and
should be repeated on the west bridge and at a different hour before the flip.

So the work is smaller than it looks. It is a configuration change and the
verification that the change behaves, with no kernel release implied.

## 6. What this does not fix

- **A thinly meshed node still leans on what it has.** A relay with three peers
  sends a third of its probes to the bridge whether the bridge holds fifteen
  connections or sixty. The cap removes the bridge's advantage over the whole
  mesh. It does not mesh a relay that is not meshed. The two Air relays behind
  the east incident were thin, and that is a separate defect.
- **The bridge still relays a discovery walk it receives.** That is ordinary
  kernel behaviour for every node. At degree fifteen it should cost what it
  costs any other node, which is an expectation to measure, not to assume.
- **The bridge still roots the directory copies it serves.** Intended.
- **Nothing here bounds what one connection can send.** That question is open and
  unchanged.

## 7. What has to be checked before the flip

- **The first minutes.** Turning the switch on with the cap at fifteen and
  sixty-one peers connected means releasing about forty-six of them at one every
  three seconds, so roughly two and a half minutes of continuous eviction. The
  pacing was tuned against a cap of 32. Whether the safe floor and the region
  protection hold at that rate is the first thing to watch.
- **Mesh formation, which changes more than the cap does.** With the nursery on,
  a newcomer is introduced to eight anchors instead of to all sixty-one. That
  alters how the mesh forms for every joining node. Of the two changes hiding
  behind one switch, that is the larger.
- **The client side.** A graduated client re-dials the bridge if its own mesh
  falls below three bound peers. A cap that graduates faster than clients mesh
  produces a loop, which the cooldown is there to break. Worth watching, not
  assuming.
- **Precedent.** A forty-relay testnet soak has already run with the cap at 18
  and the nursery on. That is close to the proposed setting and is where this
  should be rehearsed.

## 8. What would show it worked

- The bridge's rate of answering "I know someone closer" falls from the 31 to 74
  percent band to what an ordinary node of the same degree shows, near the 2.7
  percent mesh-wide figure.
- Traffic through the bridge falls. East carried 72.6 GB of 84.5 GB for two
  relays. The same measurement afterwards is the headline.
- Join still works: a newcomer reaches a usable mesh as fast as it does today.

## 9. What would make it wrong

- Delivery or join success degrades, which would mean the mesh was relying on the
  bridge for reachability and not merely for convenience.
- Newcomers fail to mesh because eight anchors are too few in a sparse region.
- Graduation thrashes, with nodes released and re-dialling inside the cooldown.
- The bridge's traffic does not fall, which would mean its degree was not what
  put it on the path, and the diagnosis in section 2 is wrong.

## 10. For David to decide

- **The number.** Fifteen as proposed. A criterion that survives a changing
  network is "at or below the degree of an ordinary node", with fifteen as the
  first value to test.
- **The order.** Testnet at fifteen first, then the east production bridge alone,
  then west. East is the one with the measured problem and the saturation flag.
- **The two changes behind one switch.** Whether to accept the bounded nursery
  introductions together with graduation, or to separate them so the cap can be
  tested without changing how the mesh forms.
- **The parked plan.** The air-gap branches are pushed and unmerged. Three pieces
  of it stand on their own and could be taken separately: the 16 KiB frame cap,
  the two transit defects already found and fixed, and the refusal counters.
