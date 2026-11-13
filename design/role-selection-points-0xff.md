# Where a node gets chosen for a role, and what "never select 0xFF" means at each point

axona 4. Source read of 2026-11-13. Written by axona.bot at David's direction.

## The question

David's rule of 2026-11-12: a bridge should never hold a role, and the way to
get there is NOT a bridge that refuses. Every node never selects the 0xFF
region for a role.

Where in the kernel does a node get selected for a role today, and what would
the rule have to say at each of those points?

## What this note is NOT

It is NOT a design and it changes NO code. It is the list David asked for, with
the open decisions marked.

It is NOT a measurement. Every row is a read of the source at kernel `17086c6`
(4.136.0, the testnet build). `src/pubsub` is byte-identical between that commit
and the `v4.131.0` tag that production runs, by `git diff`. `AxonaPeer.js`
differs, and none of the differing lines touch the routing functions cited here.

It is NOT complete in three places, named under "Not read".

## Two findings before the list

**There is no selector for the root.** No node picks a root from a list. A root
is born where a routed walk ENDS: the node that holds no usable peer closer to
the topic id, and can serve. "Never select 0xFF" therefore has two different
meanings. Where the kernel picks from a list, it means leave 0xFF ids out of the
list. Where a walk ends, it means the walk must not end at a bridge, and the
node BEFORE the bridge has to be the one that knows it.

**The kernel already wrote "skip the bridge" at six decisions, and all six are
off.** They read `dht.bridgeId()`. On a real peer that function has returned
`null` since 4.86.0 (`3838c7f`, "the bridge is an ordinary DHT node", David's
experiment of 2026-09-19; `AxonaPeer.js` 5318). Every `bridge != null && id ===
bridge` test is false. Comments at `AxonaPeer.js` 5351 and 6704 still say the
bridge is skipped. It is not.

Those six tests also name ONE node, the bridge this node dialed. A second
bridge was never covered. The rule names a REGION, which covers every bridge and
needs no lookup: the region is the top byte of the id.

## Why a bridge ends up closest at all

Regions are codes 0x00 to 0xBF. A bridge's id starts 0xFF. Take the top byte
alone, which decides the XOR order whenever it differs:

- A topic in the upper band (0x80 to 0xBF) is at distance 0x40 to 0x7F from a
  bridge, and at 0x80 or more from EVERY node in the lower band (0x00 to 0x7F).
  The bridge beats all of them.
- A node in the topic's own region is at distance 0x00 on that byte. It always
  beats the bridge.

So a bridge is the walk's end when the topic's own band has no reachable node
left. That is arithmetic on the id, not a measurement. The measurement agrees
with it: on testnet on 2026-11-12, one region and three hosts, the two bridges
formed 214 roots, every one `sub-terminal`, none while the hosts were up.

## The list

"Today" is what the source does with a bridge at kernel 4.131.0 through 4.136.0
with `BRIDGE_NEVER_ROOT=0`, which is how all four bridges run.

### A. Where a walk ends

| # | Point | Source | Today | Under the rule |
|---|---|---|---|---|
| A1 | Next hop of a routed walk, and the test "nobody closer" | `AxonaPeer.js` 1333–1365 (forwarder), 5873–5892 (greedy), 5943 (two-hop lookahead), 6823–6842 (origin) | A bridge is an ordinary usable peer. A bridge holding nothing closer, and seated, is the terminal. | **The whole rule lives here.** See "The walk" below. |
| A2 | Root birth at the walk's end | `wireHandlers.js` 316 `sub-terminal`, 631 `pub-terminal`, 1669 `kill-terminal`, 1915 `metricson-terminal` | Births a root. A bridge is refused only by `neverRoot`, which is off. | Nothing to exclude. The node is deciding about itself. This is the bridge-side refusal David ruled out. |
| A3 | Promotion of a held non-root role at the walk's end | `rootClaim.js` 480–494 `terminal-promote` | Same as A2. | Same as A2. |
| A4 | SUB terminal verify: "is anyone closer than me?" | `AxonaManager.js` 1017–1062, called at `wireHandlers.js` 310 | Asks the lookup. A closer answer gets the SUB, pinned by name. A bridge can be that answer. Gated by the terminal-verify option. | A 0xFF answer is not "closer". |
| A5 | Defer to a beaconed closer root | `rootClaim.js` 198–225, used by SUB, PUB, KILL, METRICSON, promote, handoff | A bridge that holds a root beacons it. Nodes defer to it. | A 0xFF root is never deferred to. See "Leftovers". |
| A6 | Reachable-root claim: unattached too long and no reachable neighbour is closer | `rootClaim.js` 248–260, 611–628; `repairPlane.js` 157 | Skip-the-bridge test written, off. A bridge neighbour that is closer blocks the claim. | A 0xFF neighbour does not count as closer. |
| A7 | "Am I alone?" guard | `rootClaim.js` 231–241; used by `seated()` and `wireHandlers.js` 294 | Skip-the-bridge test written, off. A node whose ONLY neighbour is its bridge counts as meshed. | That node counts as alone. It holds its own SUB seat and reads `not-seated`. |

### B. Where the kernel picks from a list

| # | Point | Source | Today | Under the rule |
|---|---|---|---|---|
| B1 | Root hint: the closest known node to the topic | `rootElection.js` 237–359, 367–383; `AxonaPeer.js` 5342–5377 | No filter. The 3d hint refresh skips the real bridge id, when armed. | Drop 0xFF ids from the answer. |
| B2 | Beacon acceptance: "is the beaconed root at least as close as my best?" | `rootElection.js` 196–209 | Skip written, off. | Skip by region. And a beacon NAMING a 0xFF root is not recorded (77–114). |
| B3 | Backup cohort of a root | `repairPlane.js` 990–1012, 1194–1204; inherit path 1154–1192 | Skip written, off on the plain path. A bridge is picked as a backup and accepts. The inherit path skips the real bridge id, when armed. | Skip by region on both paths. |
| B4 | Heir of a leaving root, and its runner-up | `repairPlane.js` 1304–1315, retry 1453–1466 | NO bridge test, on or off. Closest of 8 wins. A bridge accepts as `handoff-heir`. | Skip by region. |
| B5 | Retry target of a write whose root was evicted | `writeFlight.js` 333–345 | Skip written, off. The write is pinned to a bridge, which roots it `pub-terminal`. | Skip by region. |
| B6 | Root self-verify nominee: the closest node the verify visited | `rootElection.js` 404–491 | Skips the real bridge id under cutover only. Otherwise a bridge can be nominated and the root yields toward it. | Skip by region, cutover or not. |
| B7 | The election between two claims | `rootClaim.js` 284–295; `AxonaManager.js` 987–1007; `mergeMachine.js` 436–520 | Epoch first, then XOR. No region. | A 0xFF claim loses to every other claim. See "Leftovers". |
| B8 | Yield to a beacon | `rootElection.js` 139–146 | Yields to a closer root or a higher epoch, bridge or not. | Never yields to a 0xFF root. |
| B9 | Child relay: a seated subscriber promoted to carry others | `wireHandlers.js` 266–337; receiver 570–590 | No test. A bridge seated as a subscriber can be promoted, and `_onAdopt` does not consult `neverRoot`. | Skip 0xFF seats when promoting or picking a child. |
| B10 | host(): "are K others closer than me?" | `AxonaPeer.js` 4470–4495 | Counts bridges as closer holders. | Do not count 0xFF. |

### C. Points that pick a node but NOT for a role

These are listed so nobody adds the exclusion to them by pattern.

| # | Point | Source | Why it is left alone |
|---|---|---|---|
| C1 | Who to PULL history from: empty-root probe, read repair | `repairPlane.js` 728–760, 873–884 | A bridge that holds leftover history has to stay pullable until it is drained. The read-repair skip is written and off; it should stay off. |
| C2 | Write-flight delegate | `AxonaManager.js` 1112–1126 | An ingress, not a holder. The source says the bridge is NOT excluded, on purpose. |
| C3 | Lookahead and closest-set answers a node gives to others | `AxonaPeer.js` 1198, 5943 | Routing answers. A bridge is a legitimate hop. A1 decides what to do with them. |
| C4 | The incapable-node fallback hop | `AxonaPeer.js` 5855–5871 | It PREFERS the bridge, by design: a client that cannot serve hands its walk to its one capable neighbour. The rule depends on this staying. |

### D. The bridge's own refusals

`canAcceptRole` (`AxonaManager.js` 818), `admitPushedRole` (888), `_onReplicate`
(`wireHandlers.js` 1128), `_stageOffer` (`mergeMachine.js` 500), and the
bridge's `servingCapable` (bridge `bridge_axona_node.js` 281). All keyed on
`neverRoot`, all off on every bridge today. Under the rule they should never
fire. Whether they stay as a counted backstop is David's call.

## The walk

A1 is where the rule is hard, because a bridge has two jobs on a walk and the
rule forbids only one.

A bridge as a HOP is wanted. A newcomer under socket-is-bootstrap holds one
channel, to its bridge. Its walk has to cross the bridge.

A bridge as the END is what the rule forbids.

What the rule means at A1, as far as the source lets me say:

1. **A node whose only closer peer is a bridge treats itself as the end**, for
   the four walks that seat a role (SUB, PUB, KILL, METRICSON). If it can serve,
   the root is born there. If it cannot serve, C4 already hands the walk to the
   bridge as a hop.
2. **A bridge that receives such a walk is never the end.** It forwards to its
   closest non-bridge peer off the walk's path, whatever the distance. The
   forwarder already does this for a node that cannot serve (`AxonaPeer.js`
   1378–1387). That is the transport job, not a refusal of a role it was
   selected for.
3. **A bridge with no such peer stops the walk** with `no-capable-terminal`.
   The sender's renewal or retry carries it.

Case 3 is the sink David described, and the source shows where it was. With
`neverRoot` on, the refusal happened AFTER the bridge was already the terminal,
in `_becomeRoot`. A bare-topic message refused there has no next hop:
`_rerouteDeclined` returns false and the message is logged `undeliverable`
(`AxonaManager.js` 617–633). Under the rule the bridge is never the terminal, so
the walk moves on while any non-bridge peer exists.

**What I do not know:** whether case 3 is rare enough. A bridge holds a channel
to every client it has not released. A bridge with NO non-bridge peer is an
empty network. But a bridge whose only non-bridge peers are ON the walk's path
also stops the walk, and I have not measured how often a walk arrives that way.

## Leftovers

Both testnet bridges hold 56 roles from the run of 2026-11-12, one as root and
one as backup. The rule has to say how a bridge that already holds a root loses
it.

Today it does not. In run RL1 the second bridge sent 85 merge offers toward
closer hosts and every one came back refused `not-root` (`mergeMachine.js`
442–445): the closer host held no root for the topic, so it had nothing to
merge into.

Under the rule, three rows have to agree: nodes stop deferring to the bridge's
beacon (A5, B2), a non-bridge claim always wins the election (B7), and the
bridge's root can be pulled from (C1). Then a node's next SUB births a root at a
non-bridge, and that root pulls the bridge's history. Staging a closer node
that holds no root (`_stageOffer`, the cutover path) is the mechanism that
exists for the offer side. I have not traced whether it completes from a bridge
loser.

B7 changes the election relation. It is one relation shared by every merge, and
the council reviewed it as a total order. A region term in front of epoch keeps
it total. That is a claim about the relation, and it needs the council's read
before anyone builds on it.

## Region 0xFF holds a topic

The mint allows exactly one topic in region 0xFF, the open bridge directory
(`post.js` 213–217). The bridge code names `eagle` as the directory's home
(bridge `bridge_directory.js` 47). If any topic does live in 0xFF, its closest
nodes are the bridges, and the rule forbids every node from selecting them. I
did not check which region the running bridges publish the directory in.

## What the rule needs that does not exist

One predicate: is this id in a system region? `isSystemRegion(code)` exists in
`utils/s2.js` and takes a region code. Its one caller in the pub/sub path is the
topic mint (`post.js` 217). No routing or selection code calls it. Every row in
A and B would call that one predicate in place of `dht.bridgeId()`.

## Not read

- `topicLifetime.js` for its REHOME target and standby appointment. A grep for
  closest, neighbours and pick found one comment and no selection code. A grep
  is not a read.
- `successorGate.js`, `holderProbe.js`, `standingLease.js`: same grep, no hits.
- The bridge's own DHT adapter. I do not know what `bridgeId()` returns ON a
  bridge, or whether a bridge treats a second bridge as a peer for B3 and B4.

## Which options are armed

Three rows say "when armed". The closer-born options were armed on the 48
relays on 2026-11-04 by the record in `ops/STATE.md`. I did not check the
bridges, the seats or the test hosts in this read. On 2026-11-12 it was not
established whether the test hosts had them.

## Decisions this leaves

1. **Is case 3 of the walk acceptable**, a bridge stopping a walk it cannot pass
   on, with the sender's retry as the only carrier? David.
2. **Does a 0xFF claim lose the election outright** (B7)? David, then the
   council on the relation.
3. **Do the bridge's own refusals stay as a counted backstop** (D)? David.
4. **Does any topic live in region 0xFF?** If the directory does, the rule needs
   one stated exception or the directory needs a home.
5. **`dht.bridgeId()` returns null as an experiment.** The rule replaces it. The
   six tests that read it should be removed or rewritten in the same change, not
   left reading null beside the new predicate.
