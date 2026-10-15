# Axona Two-Pool (50 M + 50 I) — caller inventory and implementation packet v0.1

**Status:** BUILT, UNRELEASED. David's word (council 1ae52b23, seq 140,
2026-10-15 18:03Z): "I authorize the caller inventory and implementation
packet", then "build it" (direct, 18:2xZ). The build is kernel 4.114.0 on
branch `two-pool` (35af93e; review fixes 9851505) and dht-sim 0.131.0 on branch `two-pool`
(007c1c8): nothing tagged, nothing on `main` or `testnet`, nothing deployed,
no profile adopted, enforcement still off. Part 2 below is the packet as
written before the build; the RELEASE-NOTES entry for 4.114.0 records what
the build did where it departs from it: the retry takes a FRESH reservation
(two incarnations charged while the old PeerConnection closes, v1.1 §2) in
place of "reuses the attempt's reservation"; the graduation floor keeps its
own option and the profile's `serveFloor` is reported in `health().degree`
rather than driving it; the SUSPECT filter applies to managed peers only when
the pools are armed, so an unarmed node routes as 4.113.0 did. The line
numbers in Part 1 are those of 4e1a510 and have moved.

**Design lineage:** Aster's amendment v1 (be501a60, seq 120), amendment v1.1
(bc4fe433, seq 134, the semantic baseline the council accepted), the v1.2
gate-to-fence map (b395fe8f, seq 136, gates G1–G7), Orion's ratification
(211c675d), Vega's acceptance with the build order (675c730b, 6224a47f), and
the bot's anchor verification (a1bc5e0b). Every line number below is read
from axona-protocol at `4e1a510` (tag v4.113.0), the bytes the relay vendors
at 1f1fccb and the fleet runs.

## What question this packet answers

Where, in the code as it runs today, does a channel or a table slot come
into being, where does it go away, and where is a peer chosen as a next hop
or counted as degree? And for each of those places: which of the seven
gates must own it, and is there a place no gate covers?

The inventory is the first half. The second half says, gate by gate, what
changes, in which function, what state it adds, and the fence that pins it.

## What the two pools are NOT

- **A pool is not a transport direction.** The ledger's `dir: 'in' | 'out'`
  (channel_ledger.js:197) records who sent the first packet. M and I are
  intent classes assigned at reservation (v1.1 §1). A channel this node
  dialed can be I at the far end; a channel it accepted can be M here once
  promoted. The direction stays as accounting metadata and nothing more.
- **I is not `incomingSynapses`.** `NeuronNode.addIncomingSynapse`
  (NeuronNode.js:86) has NO caller in the kernel; its callers are all in
  dht-sim (AxonaEngine.js:702, 795, 828 and the NX engines). In production
  that map is empty for the life of the process, as the comment at
  NeuronNode.js:83 says. The free pass over it in `_findCloserInTwoHops`
  (AxonaPeer.js:5137) and in `_lookupStep` (6345) never finds anything on a
  relay. I must not be built on it.
- **The ledger's three bounds are not the pools.** `cPhys 66 / cInbound 4 /
  pPending 8` (channel_ledger.js:59–67) bound physical channels, unbound
  inbound negotiations and outbound attempts. None of them says M or I.
  Today `enforce` is `false` on every node: no launcher in axona-relay or
  axona-bridge sets `meshLedger`, so the predicate counts and refuses nothing.
- **`MAX_SYNAPTOME: 50` (AxonaDomain.js:88) is one admitted ceiling, not a
  profile.** `_maxSynaptome` is set by dht-sim engines and by the bridge's
  arming (bridge_axona_node.js:220, `BRIDGE_MESH_MAX_PEERS`). A relay or a
  browser reads the domain constant.

## Part 1 — the caller inventory

Three classes of site: ALLOCATE (something physical or a table slot begins),
CLOSE (something ends or is scheduled to end), SELECT (a peer is chosen or
counted). Each row names the gate that must own it. "None today" means the
site exists and no gate covers it yet; "—" means the site needs no gate.

### 1a. ALLOCATE

| # | Site | What it does today | Gate |
|---|---|---|---|
| A1 | `mesh._attachPc` mesh.js:1155–1163 | The ONLY `new RTCPeerConnection`. Mints the incarnation, calls `ledger.allocate(inc, meshId, dir)` with `dir` from the role. | G1: the reservation (class, direction, attempt, generation, incarnation) must already exist here and be consumed, never created. |
| A2 | `mesh._initiateTo` mesh.js:1285–1304 | Outbound: `mayAllocate('out')` (1289), refusal recorded for `allocRefusedFor` (1295), then `_attachPc`. Callers: `onPeerList` 762, `_scheduleRetry` 1794, `index.connectViaRelay` 1397. | G1 + G2: class M (kernel dial) or the bridge's door class; the retry at 1794 must reuse the attempt's reservation, not take a second. |
| A3 | `mesh.onSignal` sdp-offer mesh.js:944–973 | Inbound: attempt policy (955–956), replace an unbound negotiation (957–963), `mayAllocate('in')` only when no PC exists (967), `_initResponderState` (971), `_handleOffer` → `_attachPc` (1346). | G1 + G2: an I reservation precedes PC creation. Ordering defect: 961 retires the old attempt BEFORE 967 asks; with enforce on at cap the key ends with neither (a1bc5e0b). |
| A4 | `mesh.onPeerJoined` → `_acceptFrom` mesh.js:767–771, 1327–1334 | A row with no PC; allocation waits for the offer. | — (no physical cost; the deadline at `_armReaper` bounds the row). |
| A5 | `index.connectViaRelay` index.js:1369–1407 | The kernel's dial: no-op on owned/open/in-flight (1380); throttle at `MAX_PENDING_RELAY_NEGOTIATIONS = 64` (146, 1385) returns `null`; `mesh._initiateTo` (1397); returns the incarnation or `null` on ledger refusal (1403). | G1: the M reservation must be made HERE or above, and the throttle is a second pending bound beside `pPending`. Two bounds for one quantity is the kind of split v1.1 §2 forbids. |
| A6 | `AxonaPeer._considerCandidate` 5486–5610 | The dial's bookkeeping: eligibility (5499), guard token `begin` (5522), availability `cap − admitted − inflight` read before (5543) and after (5579) the awaited open, `connectViaRelay` (5600), `deferred` on `null` (5602). | G1 + G6: today the "reservation" is two separate things — the guard's pending token and the ledger's predicate. v1.1 §1 needs one reservation carrying the class. |
| A7 | `_fillTick` 1854–1891, `_nearImproveStep` 1937, `_fillAvailability` 1731, `_transportMayDial` 1740 | Preflight: `pending >= pPending || !mayDial()` defers in place (1866). Availability is `cap − synaptome.size − inflight`. | G1 + G4: availability becomes M-availability (`50 − C_M − R_M`); the preflight reads the profile, not `MAX_SYNAPTOME`. |
| A8 | `_seedSynaptomeWithSponsor` 2555–2666 → `_admitOrImprove` 2724 → `_gateDecision` 2888 / `_gateCommit` 2748 | Table admission for a BOUND identity. Callers: the `onPeerBound` handler 674–706, `join(sponsor)` 1435, `_reconcileBound` 2020, `_considerCandidate` 5510. Inserts at 2753, 2763, 2766. | G2: this is where M is CLASSIFIED today, and it cannot tell who dialed. Under the packet the class rides on the binding (the ledger record), and this path admits to M only a channel reserved as M or lawfully promoted. |
| A9 | Legacy inserts: `engine.addSynapse` 2661, `_seedInsert` 2665 (gate off); `_addByVitality` 5647–5666 (`openConnection` then `node.addSynapse`); `_evictAndReplace` 5762–5789 (from `_lookupStep` 6354: delete the dead, open a replacement, `addSynapse`) | Table slots that bypass the gate. `_addByVitality` skips at cap (5651). `_evictAndReplace` runs on any lookup that meets a dead synapse. | G1 + G4: each either goes through the same M reservation or is fenced off while the pools are armed. Today a lookup can open a channel outside every budget but the ledger's. |
| A10 | Persisted restore 2285, 2532 (`synaptome.set` from the snapshot) | Table entries with NO channel. | — but G4's feasibility check must not count them as charged, and G3's "usable" filter already drops them (not connected). |
| A11 | `webrtc.openConnection` 342 | Bound-only: true when a channel exists, no allocation. | — |
| A12 | sim: `DHTNode.tryConnect` 140–179 (`maxConnections`, `maxOutgoing`, `maxIncoming`, `_trySwapIn` 193), `NeuronNode.addIncomingSynapse` 86–94 (shared `_maxSynaptome`), dht-sim `main.js:574–586, 1789–1796` (caps), `AxonaEngine.js:657, 782, 812` (`_maxSynaptome`) | One total plus directional dial caps; the reverse index shares the synaptome budget. | G7: no matrix from this engine is dual-pool evidence until it carries disjoint M/I, reservations and H. |

### 1b. CLOSE

Every teardown funnels through `mesh._retire` (mesh.js:1819–1896): clears
timers, `ledger.closing(inc, reason)` (1845), defers the native close one
macrotask (1865), deletes the row (1866), fires `onPeerLost` for a channel
that had opened (1871) or `onNegotiationFailed` for one that never did
(1885). Capacity is released at ONE place: `ledger.gone` from `_onConnState`
'closed' (1769). That is already v1.1 §1's "CLOSING retains physical charge
until transport closure confirms the matching incarnation"; the packet keeps
it and adds the class to the record.

| # | Site and reason | Class (Perimeter v0.2 §E) | Gate |
|---|---|---|---|
| C1 | `_enforceDegree` → `'degree-cap'` 850; `retireForNewcomer` → `'make-room'` 1137 | Elective, through `selectMeshRetire` and `isProtected` (`protectedPeers` 2861 installed as the obliged-peers reader). | G6: an I peer has no retention reason today (`_retentionMap` 2822 reads the table only), so it is the first victim of every degree pass. PROMOTION_PENDING immunity attaches here. |
| C2 | `_gateCommit` swap victim 2759–2761; refused-grace `doClose` 2592–2599; grace overflow 2631–2637 | Elective, through `mayRetire` (3014) and the protection set in `_gateDecision` 2964–2965. | G6: the swap victim must be chosen from M with the surviving-coverage check; a refused I candidate must not be closed if it is lawfully I-admitted. |
| C3 | `webrtc.closeConnection` 383 → `mesh.disconnect` 742 → `'closeConnection'` | The kernel's voluntary close (callers: C2, `peer-leaving` 1035, `_evictAndReplace` 5768). | G1: release follows the incarnation; already true. G6 for the elective callers. |
| C4 | `webrtc.bindPeer` dedup 236–258 → `mesh.disconnect(loser, 'duplicate-nodeId')` | Deterministic by symmetric channel key; the ledger's pointer moves to the winner first (254). | G2: the loser's reservation is the one released, in this transaction. Already deterministic; the packet adds the class carry-over to the winner. |
| C5 | `'attempt-replaced'` 961 | Resource release. | G2: order it after the replacement's reservation (see A3). |
| C6 | `'provisional-cap'` 1406, `'bind-timeout'` 1416 and 1434 | Resource release (a bound deadline on an open, unbound channel). | G1: an unbound I channel that times out releases its I reservation; the bind deadline IS the bounded refused-grace of v1.1 §1 for the never-binds case. |
| C7 | `'negotiation-timeout'` 1700, `'send-failed'` 1710, `'pong-timeout'` 1726, `'pc-closed'` 1763, `'peer-left'` 934 | Involuntary. | G1: release on confirmation only; no gate consults. Unchanged. |
| C8 | `'retry'` 1793 (`notifyLost:false`, keeps the deadline) → `_initiateTo` 1794 | Same attempt, new PC. | G2: the retry must carry the SAME reservation (attempt id is already minted per attempt at 1301; the reservation is not). |
| C9 | `'dispose'` 705, `'reset'` 726 | Process-level. | — |
| C10 | `onPeerDied` 790–808: `synaptome.delete`, `incomingSynapses.delete`, `connections.delete`, the mark, `pubsubPeerDied` | Table-side loss, after `onPeerLost`. | G6: coverage credit leaves, custody stays (v1.1 §3). Unchanged. |

### 1c. SELECT

| # | Site | Reads | Gate |
|---|---|---|---|
| S1 | `route_msg` handler, inline greedy AxonaPeer.js:1158–1167 | `node.synaptome`, filtered dead / connected / on-path. | G3: iterate the deduplicated M ∪ I set with the same three filters plus not-SUSPECT. |
| S2 | `route_msg` path memory `via` 1153–1157 | `connOk(viaId)` or `synaptome.has`. | G3: `via` may be an I peer; the usable filter applies. |
| S3 | `_greedyNextHopToward` 5047–5069 | `node.synaptome`, dead + connected. | G3: same union, same filters. One iterator shared with S1. |
| S4 | `_findCloserInTwoHops` 5120: free pass 5137–5145, probe set 5149–5155 | `incomingSynapses` (empty in production), then `synaptome`. | G3: the free pass becomes the I half of the union (adjacent, no network cost) — built on the ledger's bound set, not on `incomingSynapses`. |
| S5 | `_capableFallbackHop` 5028–5045; the hop open at 1219 (`openConnection` on an unconnected hop) | bridge first, then `synaptome`. | G3: union; and the open at 1219 is an ALLOCATE on the routing path that today asks nobody (A9's class). |
| S6 | `_lookupStep` 6338–6350 | `synaptome` then `incomingSynapses`. | G3: union. |
| S7 | `health()` 4170: `synaptomeSize` 4280, `peers()` 5371 (table keys), `transport.boundCount / meshOpen / meshBound` 4242–4266, `meshDegraded` 4273 | Table and bound set, separately. | G3: degree derives from the same usable union once; the SUSPECT-I green badge (Vega 675c730b) is impossible only if `health()` and the selector read one set. |
| S8 | `index.meshBoundCount` 900 (graduation floor 378, 909, 983; the heartbeat's `meshBound` 1294) | Every bound peer. | G4: the floor is a profile input; today it would count I peers as mesh. |
| S9 | `_retentionMap` 2822–2850, `protectedPeers` 2861, `perimeterStats` 2877 | The table only. | G6: I entries carry no NEAR/BAND/SERVICE/DUTY reason by design (v1.1 §7); DUTY must still be readable for an I peer that holds a role. |
| S10 | `_nominateCandidate` 1712–1723 (`_isBoundPeer` excluded at 1716), `_bandDiscoveryStep` 1960 (counts from the table), `_fillAvailability` 1731 | Candidates for M. | G6: a bound I peer is never nominated for M today — promotion has no path. The fill must be able to nominate an I-bound identity for promotion. |
| S11 | `selectMeshRetire` mesh_degree.js:60–96 | Region balance, age, cooldown, protection. | G6: the candidate descriptor gains `cls`; M victims and I victims are chosen under different rules (coverage vs. ingress fairness). |

### 1d. Sites no gate covers today

1. **The bridge's door dials.** `mesh.onPeerList` (757–765) initiates to
   every id the bridge lists and `onPeerJoined` accepts every arrival, with
   no kernel reservation. The only bound is the ledger's direction count. On
   a browser or relay these are the first channels of its life, so their
   class is M by intent, and today nothing says so. (The c39ecd38 gap.)
2. **Two pending bounds.** `pPending` (guard, 8) and
   `MAX_PENDING_RELAY_NEGOTIATIONS` (64) both bound in-flight dials, from
   different counters. G1's reservation replaces both with `R_M`.
3. **Routing-path opens.** The `route_msg` hop open at 1219 and
   `_evictAndReplace`'s open at 5774 allocate outside the fill's budget.
4. **The retire-before-ask ordering** at mesh.js:957–970.
5. **No I classification at all.** The kernel has one table and one class.
   An unsolicited inbound channel that binds is offered to the M gate
   (`_reconcileBound`); refused, it sits bound and charged until its grace
   closes it. That is the whole of today's "incoming" behaviour.
6. **The sim is single-budget.** Every dht-sim matrix cited so far measured
   `maxConnections` with optional directional dial caps.

## Part 2 — the implementation packet

Build order (Vega 6224a47f, accepted): **G4 → G1+G2 → G5 → G6 → G3**, with
**G7 before any simulator number is cited**. Each gate below names the
change, where it lives, what it adds, and the fence. Defaults stay what they
are: `enforce: false`, cap 50, no I pool populated. Arming the pools is a
launcher profile, and the flip is David's.

### G4 — profile feasibility (first, because everything reads it)

**Change.** One profile object, validated at construction, read by every
cap consumer. `{ M: 50, I: 50, H: 100, pPending: 8, cInbound: 4,
graceMs, bindDeadlineMs, serveFloor }`. Validation rejects `M + I > H`,
`pPending > M`, `cInbound > I`, a `serveFloor` above `M`, and a host budget
the launcher declares smaller than `H + door sockets`. Rejection throws;
nothing trims or borrows.

**Where.** New `src/transport/web/pool_profile.js` (`makePoolProfile(opts)`,
pure); consumed by `WebRTCTransport` options (index.js:179–190 gain
`meshPools`), by `AxonaPeer` where it reads `node._maxSynaptome ??
domain.MAX_SYNAPTOME` (1734, 1803, 2893, 5650) through one accessor
`this._poolProfile.M`, and by `meshBoundCount`'s floor (900). `AxonaDomain.
MAX_SYNAPTOME` stays as the default `M` when no profile is given, so a bare
kernel node is byte-identical.

**Review rows, not adopted numbers:** relay M50/I50/H100; desktop the same
only with a declared host budget; leaf M4–6/I4–6/H12; bridge mesh pools plus
a door budget outside H. The packet carries them as examples in the fence,
with nothing chosen.

**Fence `fence_pool_profile.mjs`.** Precondition asserted: every infeasible
combination above throws with the field named; a feasible one yields the
object frozen. Mutant: delete the `M + I > H` check and watch check 1 fail.
Oracle (v1.2 G4): no profile that would overcommit the host reaches the mesh.

### G1 — the physical bound and the refusal-close path

**Change.** The ledger grows a RESERVATION step before allocation. `reserve({
cls: 'M'|'I', dir, attempt, generation })` returns a token or a refusal
`{ ok:false, why }` under the bounds `C_M + R_M ≤ M`, `C_I + R_I ≤ I`,
`C + R ≤ H`; `allocate(inc, meshId, reservation)` consumes the token and
charges the channel in that class; a channel record carries `cls`. `mayAllocate`
and `canAllocate` become thin wrappers that reserve-and-release (observation
mode keeps counting would-be refusals). A reservation not consumed within
`NEGOTIATION_DEADLINE_MS` is released by the sweep. Refusal at the kernel's
gate (`_seedSynaptomeWithSponsor` refused path, 2575) takes exactly one
terminal path: bounded refused-grace (already the grace timer) or
release-and-close; the grace timer's end is the bound.

**Where.** channel_ledger.js: `reserve`, `release(token)`, `cls` on the
record, `stats().byClass`. mesh.js: `_initiateTo` (1288) reserves M (or the
door's class) and passes the token to `_attachPc`; the sdp-offer branch
reserves I BEFORE `_initResponderState` (971) and before the retire at 961
(see G2); `_attachPc` (1163) consumes. index.js `connectViaRelay` (1385)
drops the separate throttle once `R_M` bounds pending dials. AxonaPeer
`_considerCandidate` (5522) begins the guard token and the M reservation in
one step; `_fillAvailability` reads `M − C_M − R_M`.

**Fence `fence_pool_reservation.mjs`.** Precondition: with `enforce: true`,
M50/I0 and 40 unsolicited offers build zero PCs beyond I's bound (v1.2 G1
oracle: "never creates 90 unclassified PCs"); a reservation refused releases
nothing it did not take; a CLOSING channel stays charged in its class until
`gone` for the same incarnation; a `gone` for an older incarnation of the
same meshId releases nothing. Mutant: make `allocate` charge without a token
and watch check 1 fail; release on `closing` instead of `gone` and watch
check 3 fail.

### G2 — classification and the attempt fence

**Change.** The class is bound to the attempt tuple before allocation and is
immutable for that incarnation. The crossed-offer decision runs BEFORE any
retire: on a new attempt for a key holding an unbound negotiation, the mesh
first reserves the replacement, and only if the reservation holds does it
retire the old attempt and release that attempt's reservation; if the
reservation is refused, the old attempt stays and the new offer is refused
on the wire (G5). An OPEN authenticated channel stays protected (958,
unchanged). Repeated replacement on one key is bounded: after
`ATTEMPT_REPLACE_MAX` replacements within the negotiation deadline the key
sheds (refuses) further attempts until the deadline passes. The bind dedup
(webrtc.js:236–258) moves the class with the pointer; the loser's class
reservation is released with the loser.

**Where.** mesh.js:957–970 reordered to reserve → retire → attach; a
per-key `replaceCount` on the state; `_scheduleRetry` (1793–1794) passes the
live reservation through `_retire({ keepReservation: true })` so the retry
does not pay twice. AxonaPeer's `onPeerBound` handler (674) and
`_seedSynaptomeWithSponsor` (2555) read `cls` from the transport
(`t.classOf(nodeId)`, new, from the ledger's peer record) and infer nothing
from direction.

**Fence `fence_pool_attempt_fence.mjs`.** Precondition: crossed offers at
cap cannot double-charge, and a replacement refused leaves the original
attempt in place (the a1bc5e0b ordering: the key never ends with neither);
a delayed callback from a retired attempt neither charges nor reclassifies;
the dedup loser's reservation is the one released; the retry consumes one
reservation across both PCs. Mutant: restore the retire-then-ask order and
watch check 2 fail.

### G5 — the explicit refusal frame

**Change.** A refused offer is answered, not dropped. New signal kind
`sdp-reject` `{ attempt, generation, reason: 'phys'|'pool-I'|'shed'|
'policy', v: 1 }` sent from the offer-refusal branch; the sender releases
only the reservation whose `attempt` and `generation` match, and marks the
candidate deferred (the fill's `'deferred'` outcome). A reject for a stale
attempt is dropped and counted. Legacy peers (no attempt id) keep the bounded
timeout and gain no credit. Generic ACK, socket send and timeout are not
confirmation.

**Where.** mesh.js: the branch at 967–970 sends the frame (today it logs
`offer-refused` and returns); `onSignal` gains a `sdp-reject` case next to
`sdp-answer` (974) that validates attempt and generation, calls
`ledger.release`, retires the state with `'rejected'` (a new
NEGOTIATION_FAILED reason so the guard token ends through 1885). The frame
registry: `transport/web/mesh.js` signal kinds are string-matched, so the
case is the registry. The bridge relays `msg.payload` untouched
(axona-bridge `server.js:1573–1577`, the door-signal path aside), so a new
kind crosses it today; the peer-relayed signalling path (`signalRelay`,
index.js:538) is to be read the same way at build before the kind is relied
on bridgeless.

**Fence `fence_pool_reject_frame.mjs`.** Precondition: eight saturated
responders cannot hold a dialer's pending reservations past
`NEGOTIATION_DEADLINE_MS`; a reject carrying an older attempt releases
nothing; a reject for a newer generation releases nothing; a legacy peer's
silence still ends at the deadline. Mutant: release on any reject regardless
of attempt and watch check 2 fail.

### G6 — promotion, churn and retention

**Change.** Promotion I → M is a transaction: reserve M (or name one victim
that passes `mayRetire` AND the surviving-coverage check of `_gateDecision`),
then move the class on the ledger record and the table entry, then release
I. While the transaction is open the peer is `PROMOTION_PENDING` and exempt
from elective I eviction for at most `PROMOTE_MS`; at the bound the result is
one of promoted, deficit (reported, ordinary I treatment resumes) or lawful
close. The fill nominates bound I identities for promotion (S10's exclusion
at 1716 becomes "exclude bound M"). Elective eviction of an I peer is by
ingress fairness (age and region balance, `selectMeshRetire` with `cls`),
never by M's coverage rules; an I peer holding a DUTY is still refused by
`mayRetire`. Demotion M → I needs I capacity and the service obligation,
else stays M or retires lawfully.

**Where.** AxonaPeer: `_promote(id)` (new) beside `_admitOrImprove` 2724,
using `_gateDecision` for the victim and `ledger.reclass(t, 'M')` (new);
`_retentionMap` 2822 gains `cls` per entry and exposes I entries with DUTY
only; `protectedPeers` 2861 includes `PROMOTION_PENDING` ids; mesh_degree.js
candidates gain `cls` and the selector runs per class. The refused-grace
path (2592) asks `cls` before closing: an I-admitted channel is not a
refusal.

**Fence `fence_pool_promotion.mjs`.** Precondition: at M50 duty-saturated,
an I peer's promotion ends in deficit within `PROMOTE_MS` with M unchanged
and the I channel kept; the immunity lifts at the bound; no unauthenticated
offer closes an OPEN channel; the degree pass never retires a
`PROMOTION_PENDING` peer and never counts a future candidate as coverage;
I churn at I50 preserves every DUTY. Mutant: let the immunity outlive the
bound and watch check 2 fail.

### G3 — the routing union and one degree

**Change.** One iterator `usablePeers()` over the deduplicated M ∪ I set:
admitted (M) or I-admitted, not dead, transport-connected, not SUSPECT for
routing. Greedy (S1, S3), the two-hop first-hop set (S4, replacing the
`incomingSynapses` pass), the fallback (S5) and `_lookupStep` (S6) read it.
Strict XOR and the existing round and path bounds stay. `health()` reports
`degree: { M, I, usable }` from the same iterator, and `synaptomeSize` keeps
its meaning (M only). `meshBoundCount` reads `usable` against a profile
floor.

**Where.** AxonaPeer: `usablePeers()` (new, near `_greedyNextHopToward`
5047); 1158–1167, 5062, 5137–5155, 5039, 6338–6350 switch to it; `health()`
4278 gains `degree`; index.js:900 reads the profile floor.

**Fence `fence_pool_union_selector.mjs`.** Precondition: a SUSPECT I peer is
neither selected by greedy nor counted in `health().degree.usable` (the
green-badge counterexample); an I peer strictly closer than every M peer is
selected; a dead I peer is skipped; the two-hop first-hop set equals the
probe set greedy would have used plus the usable I set, deduplicated; a
peer present in both classes is counted once. Mutant: count I in degree
without the SUSPECT filter and watch check 1 fail.

### G7 — the simulator carries the same model

**Change.** dht-sim's engine gains disjoint `M` and `I` ceilings,
reservations, a physical `H`, and the same class, promotion and selector
rules, driven by the kernel's `pool_profile.js`. `NeuronNode.incomingSynapses`
stays a reverse index for the engines that use it and is labelled so; no
matrix labelled "50+50" may come from `maxConnections` plus directional caps.

**Where.** dht-sim `DHTNode.tryConnect` (140) and `_trySwapIn` (193) gain
the class; `AxonaEngine` / `TransportAxonaEngine` set the profile instead of
`_maxSynaptome`; the harness exposes `M`, `I`, `H` beside `maxConnections`.

**Fence `fence_sim_two_pools.mjs` (dht-sim).** Oracle suite from v1.2 G7:
last-slot inbound and outbound races; refusal close; crossed offers;
promotion deadlock; union routing; suspension and reconnect; legacy refusal;
profile shortfall. Precondition: a run configured 50+50 refuses the 101st
allocation at every node and reports deficits where M is duty-saturated.

## What this packet does not do

- It writes no code and runs no fence. The line numbers are the anchors a
  build will move; the build re-reads them.
- It adopts no profile row. Relay M50/I50/H100 is the review example, and
  a leaf at 100 peers is not presumed.
- It leaves `enforce: false`. Reservations in observation mode count
  would-be refusals by class, which is the measurement that precedes any
  flip.
- It does not touch the regional hybrid (band discovery `lo := 0`,
  negotiated cross-region intent), the Howard envelope, or the architecture
  tex. Each is its own word.

## What a reviewer can check without trusting this note

Open axona-protocol at `4e1a510` and read each anchor in Part 1; every
row names a line. For Part 2, the test of the packet is the mutant list:
each fence names the one deletion that must fail its first check. A build
that cannot show that failure has not built the gate.
