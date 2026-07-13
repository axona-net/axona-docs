# Response to the External Root-Management Review — 2026-07-13

**Subject:** the four-finding critique of
[Root-Management](Root-Management-v4.20.1.md) / `rootClaim.js` /
`AxonaManager.js` (kernel 4.20.0) · **Outcome:** one finding accepted and
shipped as **kernel 4.20.1** (testnet, same day); two findings invalidated by
trace; one confirmed as the documented design tradeoff · **New regression
test:** `smoke_upstream_rehome.mjs`

First: this was a good review. It read the actual code, cited real line
numbers, reasoned about state it could see, and one of its recommendations is
now shipped kernel behavior. Where it went wrong, it went wrong for an
instructive reason — a single missing piece of the routing model — and that
gap is worth documenting as much as the findings themselves.

---

## The one piece the review missed: dead waypoints heal by reroute

Three of the four findings (V1, V2, V3) share one assumption: *a message
pinned toward a dead node goes nowhere*. In the routed model the opposite is
true, and it is load-bearing:

> A renewal sent `via` a dead upstream is routed toward the dead node's
> **id**, terminates at the closest **live** node to that id, and that
> terminal returns `'reroute'` — the dead waypoint is popped and the SUB
> continues toward the bare topic id ([AxonaManager.js:354]). It reaches the
> true terminus, which seats the subscriber and answers with a via-repin
> DELIVER (`ping=true`); `_onDeliver` re-pins `_upstream` to the live parent
> and snaps the renewal interval back to fast.

This is the design's oldest self-healing rule ("a dead waypoint always falls
through to the topic id and re-seats"). Once it is in the model, "permanent
blackhole" and "self-reinforcing deadlock" both reduce to **bounded staleness
windows** — which is exactly what our validation found, and what we then
fixed.

## Finding-by-finding

### V1 — "Permanent blackhole on upstream death" → partially valid; fixed in 4.20.1

**Correct:** `pubsubPeerDied` swept only beacons; a pin on the dead upstream
survived, `attached` stayed true, and the reachable-root fallback stayed
gated off.

**Incorrect:** the blackhole. The next renewal re-homes via the reroute path
above. The *real* defect was latency: with `attached` true, an app
subscriber's adaptive renewal can be backed off to the 60s ceiling, so the
healing renewal — and therefore re-homing — could lag a full minute. (Pure
relays and warm backups renew every 5s tick regardless, so infrastructure
was never exposed.)

**Shipped (4.20.1):** `pubsubPeerDied` now also drops every upstream pin on
the dead peer and resets the pinned subscription's renewal clock — re-homing
happens on the very next tick, and the fallback re-arms. The graceful
peer-leave notify calls the same sweep, so a departing upstream is treated
identically (its subsequent HANDOFF re-purges idempotently). The review's
proposed diff was adopted nearly verbatim, plus the clock reset that makes
"fast" mean *now*.

### V2 — "Eager pinning on demotion creates deadlock" → same class, bounded; largely covered by the V1 fix

A demotion toward a node that dies immediately after is healed by the same
reroute at the next renewal. The worst corner is a **`verified` pointer**
(90s TTL) naming a non-neighbour that dies: promotion back is suppressed
until the pointer expires *unless* another node claims meanwhile. Bounded,
not absorbing — and note the demotion trio exists precisely because the
opposite bug (pin without the confirming subscribe) starved subtrees in
production. For neighbours, the 4.20.1 sweep purges the pointer and the pin
at channel-close. The residual (non-neighbour verified pointer at a corpse)
is accepted as a ≤90s tail and noted for Phase 2's unified liveness model.

### V3 — "via-gate blocks backup takeover for 50s" → invalid; the mechanism cannot occur

Two independent errors:

1. **The via-gate never sees `via=[deadRoot]`.** A via-pinned SUB that
   terminates anywhere other than `via[0]` is rerouted with the via popped
   *before* any promotion logic runs. `promote` is only ever consulted with
   an empty via at a bare-topic terminal.
2. **A non-neighbour corpse beacon does not gate promotion.** The strict
   defer gate (`requireReachable: true`) refuses to honor a beacon that is
   neither network-verified nor a channel-verified neighbour — that is the
   gate's entire purpose (4.19.0: "when a root dies its channel drops and
   the gate opens instantly"). The review read the strict mode as *blocking*
   takeover; it exists to *unblock* it. The loose mode (PUB/KILL) is the one
   with a freshness window, and it is capped at 1.5×BEACON_MS = 30s, not
   50s.

Traced end-to-end: a warm backup two hops from a dead root promotes within
about one tick. The proposed fix (treat any unreachable `via[0]` as empty)
was declined — beyond being unnecessary, it would let via-pinned messages
promote intermediate nodes, weakening the security-waypoint semantics.

### V4 — "Split-brain under lookup failure" → valid, known, and deliberate

Transient competing roots at near-miss terminals are the documented
asymmetry (Root-Management §4.4): claiming wrongly is cheap and
self-corrects; deferring wrongly strands the topic. Convergence has three
independent lanes — beacon demotion in the basin (≤20s), self-verification
outside it (6s fresh / 45s steady), cohort anti-entropy keeping the data
unified while claims converge. "Permanent split if lookups never succeed" is
true and describes a degraded network; the practical residue of this class
is the fresh-subscriber cold-attach item already on the punch list (R-3
family). No change.

## The declined recommendation worth explaining: `attached = recent DELIVER`

The idea — distinguish *target path* from *confirmed attachment* — is right.
The proposed implementation is not: renewals of an already-seated subscriber
deliberately do **not** ping (only a fresh seat does), so on any quiet topic
`lastReceivedFromUpstream` goes stale within seconds and the proposed
`attached` definition flaps false every cycle — fast renewals plus fallback
claims on every idle topic in the network: a self-inflicted root-churn storm.
Confirmed-attachment semantics need an ack-per-renewal (or lease) design and
belong in Phase 2's unified liveness model, where they are now on the list.

## The test critique — the half we kept

The review was right that no test drove a subscriber whose upstream dies and
measured time-to-re-home, and that the reconciliation fabric favors
neighbour topologies (it also noted `smoke_root_reconcile`'s manual
`axonRoles.delete` setup — accurate, though that phase tests beacon
freshness, not this path). The gap is closed: **`smoke_upstream_rehome.mjs`**
(11 checks, in the release gate) seeds a backed-off subscription pinned to a
dying upstream and asserts the sweep, the clock reset, the next-tick
unpinned renewal, the re-armed fallback, and that an unrelated topic's
backed-off state is untouched. Had this test existed, V1 would have been
priced correctly on arrival — a ≤60s staleness bug, not a blackhole.

## Scoreboard

| Review claim | Verdict | Action |
|---|---|---|
| V1 blackhole on upstream death | staleness window (≤60s), not blackhole | **fixed, 4.20.1** + regression test |
| V2 deadlock on demotion pin | bounded (≤50–90s TTL tails) | neighbour case fixed by 4.20.1; residual → Phase 2 |
| V3 via-gate blocks takeover | cannot occur (reroute pops via; strict gate ignores non-neighbour corpses) | declined, traced |
| V4 split-brain under lookup failure | documented tradeoff, converging | no change; overlaps open punch item |
| Fix 1 (sweep pins on death) | correct | **adopted** |
| Fix 2 (attached = recent DELIVER) | breaks quiet topics | declined; idea noted for Phase 2 |
| Fix 3 (relax via-gate) | unnecessary + weakens via semantics | declined |
| Test gap (re-home latency) | correct | **closed** (`smoke_upstream_rehome.mjs`) |

**Verification:** new smoke 11/11; full kernel suite green (63 smokes);
testnet acceptance on the 4.20.1 line 100% initial / 100% healed delivery
(12/12, ordering intact).

*The Root-Management document was re-versioned to
[4.20.1](Root-Management-v4.20.1.md) with the new sweep rule and the
tightened convergence bound (neighbour-upstream death → next-tick re-home).*
