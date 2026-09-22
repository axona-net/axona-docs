# Bridge Air-Gap — Project Plan — v0.1

**Status:** proposed, for council review before implementation
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Kernel baseline:** `@axona/protocol` v4.88.0; `axona-bridge` 2.130.0; `axona-relay` 0.132.0
**Companions:** council thread e8282dcd (finding and remedies), 8ddaaf85 (David's
three approaches), 29551bee and e611a179 (Aster CP qualifications); ops/STATE.md
entries 2026-09-22 16:54Z through 18:11Z

---

## 1. The question

How does a node join the mesh through the bridge without the bridge ever
carrying that node's traffic?

The bridge exists to introduce. A new node dials it, says hello, gets a list of
peers, exchanges the signalling that opens direct channels to those peers, and
reads the directory. After that the node is in the mesh and the bridge's job is
done. Today the bridge also forwards. That is the defect this plan removes.

## 2. What the bridge is NOT

The bridge is NOT a router. It is NOT a fallback route. It is NOT a replica, an
heir, a child relay, or a "capable adjacent" for anything. It is NOT the place a
relay goes when its own mesh is thin. A relay with four peers and no route to a
target gets a refusal, not a detour.

The bridge IS the introduction service, and it keeps its connections for that
reason alone.

## 3. What was measured

On 2026-09-22, between the 05:46Z recreate and 16:54Z, the east bridge (a
1-vCPU, 458 MB droplet, 50% CPU steal, 0% idle) moved 84.5 GB over 58 client
sockets. Two sockets carried 72.6 GB. Both were grizzly relays on the Air host,
rolled that morning: slot 2 with 466 roles and a mesh that fell from 17 peers
at 05:50Z to 5 by 12:51Z, and slot 6 with 400 roles and 13 peers. Every other
client, the council seats included, sat at 0 to 3 KB/s. West's uplink carried
1.5 GB in 12.8 h. Before the recreate the heaviest client was the grizzly1
droplet relay, so the pattern predates the Air move.

Slot 2's read-only health dump over 11.6 h: 27.2 M lookahead calls (654/s),
3,246 probes/s across 5 to 8 synapses, 15.6 M sends answered by a probe. Its
XOR-nearest peers answered "closer" 2.7% of the time each. Its farthest peer,
the bridge, answered "closer" 31% of the time with 5 peers and 74% with 8.

East held 2 roles the whole time, both directory roots. Role load was not the
problem. Forwarding was.

These figures are operator-reported from one incarnation and two relays. They
would be wrong as a general rate if the Air meshes recover or the roles are
re-seated elsewhere. They are the reason for the plan, not its acceptance test.

## 4. Why it happens

Greedy routing never picks the bridge. `_greedyNextHopToward` (AxonaPeer.js)
keeps only a synapse strictly closer to the target than self, and a 0xFF id is
never closer to a 0x80 or 0x89 target than the sender is.

The fallback does. When greedy finds nobody, `_findCloserInTwoHops`
(AxonaPeer.js ~4066–4160) probes every synapse in the table, the bridge included,
with `lookahead_probe`, and returns as the next hop the ADJACENT peer whose reply
named a closer node. The bridge holds 58 synapses. A five-peer relay holds five.
The bridge almost always knows someone closer, so the bridge becomes the first
hop. Its `route_msg` handler then greedy-forwards from its own table, awaits the
downstream verdict, and replies. East's 22:43Z CPU profile is that loop:
`_handleRequest` 25%, `_reply` 18%, `routeMessage` 11.8%, `sendTo` and `writev`
26%.

Three things make the bridge the attractive detour:

- A regular node's synaptome is capped at 50 (`AxonaDomain.js:68`) and filled
  by vitality, with the least-vital synapse evicted at the cap. The bridge caps
  at 256 (`bridge_engine.js:27`, the comment says "highway") and binds every
  completed hello as a synapse.
- On the client the bridge is auto-admitted at start (`AxonaPeer.start`,
  `transport.boundPeers()`) and never "dead" while the socket is up. It is the
  one synapse a collapsed-mesh relay always has.
- Since 2026-09-19 `dht.bridgeId()` returns null (AxonaPeer.js:3560, "the
  bridge is an ordinary DHT node"), so the cohort, heir and reachable-closest
  pickers no longer exclude it either.

The traffic itself is not data. Every 5 s tick, each root with cache or
tombstones pushes a REPLICATE keepalive to two cohort members; renewals and
beacons add to that. 466 roles is about 200 routed sends a second, each one
amplified by the probe fan-out and the detour. It is symmetric because every
piece is a request with a same-sized reply.

## 5. The invariant

A connection to a bridge is an introduction edge. An introduction edge is never
a forwarding edge, for any path that chooses a next hop or a role holder:
greedy, lookahead probe set, lookahead first hop, cohort, heir, child promotion,
reachable-closest, capable-adjacent, tunneled direct.

Enforced twice. On the client, so the bridge is never selected. On the bridge,
so a client that does not cooperate, whatever its version, gets one bounded
refusal and nothing is forwarded.

The measure of success is zero generic transit FORWARDS at the bridge. Not zero
attempts: old clients will keep sending. Attempted, refused and forwarded are
counted separately, and forwarded must read zero.

## 6. Scope and non-goals

In scope: the kernel capability tag and picker filters (WP1), the bridge ingress
allow-list and refusal (WP2), the join and directory dependency proof (WP0,
WP3), the offline verification matrix (WP4), and the docs and version work
(WP5).

Not in scope, by David's decision after the council's second round: the
50-connection cap with reserved bootstrap slots, triadic closure on high-volume
peers, and the disconnect-after-closure off-ramp. All three were judged
complements to this boundary, to be designed after it. The Air mesh collapse is
its own defect and is not touched here. The droplet resize is a separate
decision. Live rollout is a separate decision with its own verification and
rollback plan (WP6 says only what it needs from this work).

## 7. Work packages

### WP0 — Join dependency audit (document first)

Enumerate every frame a cold client sends over the bridge socket from dial to
its first direct peer and its first directory read. Method: an offline harness
with one bridge (node-WS transport, no WebRTC) and one cold client, capturing
every `{k, type}` on the socket. Result: the allow-list for WP2, derived, not
guessed.

Acceptance: the trace contains no `route_msg` and no `__tunneled_direct__`, or
each one that appears is named with the caller that produced it and a decision
attached.

Today's inventory of what the bridge serves, for the audit to confirm or prune:
link (`hello`, `hello-ack`, `ping`, `pong`), join (`peer-list-request`,
`signal`, `turn-refresh`), discovery replies from the bridge's own table
(`lookup_step`, `find_closest_set`, `lookahead_probe`, `local_probe`,
`hop_cache`), synaptome maintenance notifications (`triadic_introduce`,
`reinforce`, `lateral_spread`, `presence`, `peer-leaving`), and the routed
frames (`route_msg`, `__tunneled_direct__`, `mesh:signal`).

A discovery reply that names a closer peer is permission to route TO that peer
over a transport edge. It is not permission to use the bridge as the first hop.
WP1 makes that distinction in code.

### WP1 — Kernel: the connection capability and the picker filters

`Synapse` (dht/Synapse.js) gains one field, `transit`, default `true`.

At `_seedSynaptomeWithSponsor` for peers reported by the bridge transport's
`boundPeers()`, the synapse is created with `transit: false`. A peer discovered
THROUGH the bridge and admitted over WebRTC gets its own synapse with
`transit: true` after its own admission. The tag is per connection. It is never
inherited from where the peer was learned.

One eligibility function, `isTransit(synapse)`, and every picker calls it:

- `_greedyNextHopToward`: skip non-transit synapses.
- `_findCloserInTwoHops`: build `probeTargets` from transit synapses only, and
  never assign a non-transit synapse as `bestPeerId` even if a legacy reply
  arrives.
- The `route_msg` receive handler's greedy scan: same filter.
- `repairPlane` cohort (`findKClosest` results and `_nearestReachable`),
  `_pickHeirs`, `selfClosestReachable`, `pickCapableAdjacent`, `meshBare`:
  exclude any id whose synapse is non-transit, and reinstate `dht.bridgeId()`
  returning the bound bridge id as a transitional guard for ids that are not in
  the synaptome at all.
- `_promoteChild` (wireHandlers.js): skip a subscriber whose synapse is
  non-transit.
- `sendDirect` fallback to `routeMessage`: covered by the pickers above; no
  separate path.

Counters, added to `lookaheadStats()` and the peer health dump: probes
suppressed by the filter, first hops rejected by the filter.

Version: kernel 4.89.0. The role-fence follow-up already slated for 4.89.0
folds into this, since the same eligibility function answers both.

### WP2 — Bridge: the ingress allow-list and the refusal

In `ws_transport.js` `_handleRequest` / `_handleNotification`
(axona-bridge), a request or notification whose type is not on the WP0
allow-list gets one reply `{ ok: false, body: { error: 'transit-refused' } }`
and is not dispatched.

For `route_msg` specifically, the bridge's own `route_msg` handler is replaced
by a bridge-side one:

- if `targetId` is the bridge's own node id, or the frame carries a pub/sub verb
  for a topic the bridge itself roots (the directory copies), dispatch the local
  handler with `isTerminal: true` and return its verdict;
- otherwise return `{ consumed: false, terminal: true, refused: true, hops }`
  with no lookahead, no downstream send, no recursive await.

`__tunneled_direct__` arrives inside `route_msg` and is covered by the same
rule. A locally addressed operation never forwards an embedded destination.

Counters per connection and in total: `transitAttempted`, `transitRefused`,
`transitForwarded`. Exposed on the authenticated `/healthz` and `/diag`.
`transitForwarded` is asserted zero by WP4 and read as zero in any later live
baseline. Refusals are logged at most once per connection per minute, with a
count, so a legacy client cannot turn refusal into a log storm.

Client behaviour on a refused verdict: `routeMessage` returns the downstream
verdict as it does today, `_tallyRoute` counts it as a failure, and the next
attempt is the next repair tick, 5 s later. WP4 checks that no path retries on
the same edge inside the tick.

Version: bridge 2.132.0. (2.131.0 is the frame-mix counter branch, unmerged;
the two are independent and rebase cleanly in either order.)

### WP3 — Directory convergence without transit

Three facts to prove, not assume:

1. A client's SUB and renewal for the 0xFF directory copy reaches the bridge as
   the terminal node for that topic id, which WP2 allows as a pub/sub verb for a
   topic the bridge roots. DELIVER from the bridge to that subscriber is the
   bridge's own origin-side send over a direct socket to a client, which is not
   transit.
2. The eagle and grizzly directory copies are rooted on relays. The bridge
   publishes its entry into them as an origin. Under WP1 the bridge's own
   `routeMessage` uses its clients as transport synapses; those are transport
   edges from the bridge's side. This is bounded by the publish cadence
   (two rows an hour on east today) and is allowed.
3. A bridge with no clients in a region cannot reach that region's copy without
   transit through another bridge. West today has one client. West's publish
   into the eagle copy would reach east as a first hop and be REFUSED under WP2.

Fact 3 needs a decision. The candidate is a bounded `directory:sync`
notification on the bridge-to-bridge uplink: each bridge sends its own entry to
the other, which republishes it into its own regions as an origin. Locally
terminated, one entry per bridge per cadence, no embedded destination. This is
the "separate bounded directory service" the seats asked for. The alternative,
letting a bridge forward another bridge's publish, is the highway again.

WP3 is a design note plus the harness case that shows both copies converge
with two bridges, one of which has no in-region clients.

### WP4 — Offline verification matrix

All of it runs before any live touch, on the sim and node-WS transports, with
old and new clients side by side.

- Zero transit. Four sparse nodes and one bridge; publish, subscribe, get.
  Assert `transitForwarded === 0` at the bridge, exactly, not approximately.
- Hostile and legacy client. A synthetic client injects `route_msg`,
  `__tunneled_direct__`, and a pub/sub verb for a foreign topic. Assert one
  bounded refusal each, zero downstream frames, no retry inside the tick.
- Bootstrap continuity. A cold client with only the bridge edge completes
  hello, peer-list, signalling and direct admission, then routes data over its
  new transport edges only.
- Directory. Two bridges, one without in-region clients; both copies converge
  through WP3's mechanism; the 0xFF copy converges through local subscription.
- Pickers. For each picker in WP1, a table with the bridge as the only closer
  candidate; assert it is not chosen and the operation reports
  `NO_TRANSPORT_ROUTE` or its existing failure verdict.
- Provenance. A peer discovered through the bridge and admitted over WebRTC is
  transit; the bridge itself never is; reconnect and identity change keep the
  tag correct; unknown capability fails closed.
- Multiple bridges and the uplink. The uplink edge is non-transit in both
  directions; a frame from one bridge to the other that is not `directory:sync`
  or a locally addressed operation is refused.
- Load shape. With refusal in place, a relay with a four-peer mesh and 400
  roles produces a bounded refusal rate and no probe storm at the bridge.

Author tests alone are not acceptance. Vega owes the independent code
challenge; Aster CP reviews the design against this plan.

### WP5 — Docs and versions

Architecture note: a new section, "The bridge is an introduction, not a road",
with the invariant in §5 verbatim. Wire protocol: the `refused` verdict field
and the `transit-refused` error. SECURITY-CHANGELOG: this is a boundary, and it
gets an entry. RELEASE-NOTES for 4.89.0 and 2.132.0. RELEASE-PROCEDURE: the
counters to read after any later promotion. Relay pins follow the kernel.

### WP6 — What rollout will need, decided separately

Not authorised by this plan. When David decides it, it needs: a fresh baseline
on the incarnation being replaced, the three transit counters read before and
after, join success measured for a cold client against the new bridge, the
0xFF directory converging, and a rollback that is the previous image with the
same `.env`. Zero forwards alone does not prove the host has headroom: parsing,
probes, refusal replies, signalling and CPU steal still cost. That is measured
separately.

## 8. Order and review gates

1. WP0 audit and the WP3 design note, posted to council as documents with
   hashes. Council reads them against this plan.
2. WP1 and WP2 on local branches (`air-gap-4.89.0` in axona-protocol,
   `air-gap-2.132.0` in axona-bridge), with WP4 growing alongside. Nothing is
   pushed until David okays a push for review.
3. Independent review: Vega's code challenge, Aster CP's design review. A
   review BLOCK is retired only by the reviewer who placed it.
4. Merge to testnet on David's word. Testnet is a rollout and belongs to WP6.

## 9. Open decisions for David

- Whether the bridge keeps answering `lookahead_probe` at all. Answering is
  cheap and is discovery; refusing it removes one more frame class from a
  saturated host. The plan answers it; say if you want it refused.
- The `directory:sync` design in WP3, or an alternative.
- Whether the role-fence follow-up folds into 4.89.0 as written here.
- The version numbers.

## 10. What would make this plan wrong

If the join graph in WP0 turns out to need a routed frame to the bridge that is
not locally terminated, the allow-list grows and the invariant has an exception
that must be named. If WP3 cannot show directory convergence without transit,
the directory needs its own service before this ships. If a refused relay
retries inside the tick, WP2's refusal becomes a different storm and the client
side needs a backoff. Each of these is a WP4 case, not a surprise for rollout.
