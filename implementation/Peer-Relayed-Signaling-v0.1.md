# Axona Bridgeless Connection — Peer-Relayed WebRTC Signaling — v0.1

**Status:** design (not yet implemented)
**Author:** David A. Smith — YZ.social
**Date:** 2026-06-03
**Kernel baseline:** `@axona/protocol` v2.15.0
**Companions:** Axona Architecture Note v0.7.6 (§The Bridge, §Future Directions),
Axona Wire Protocol v0.71

---

## 1. The problem

Axona traffic is already fully peer-to-peer and multi-hop: once a node is in
the mesh, `routeMessage` forwards any message to any nodeId through intermediary
peers (`route_msg`, AxonaPeer.js), and discovery is peer-driven
(`triadic_introduce` + `peer-list`). **But forming a *new direct* WebRTC link
still funnels through the bridge.** The mesh layer's signaling sink is
hard-wired to the bridge socket:

```js
// transport/web/index.js — MeshManager wiring (today)
sendSignal: (toPeerId, payload) => {
  if (!socketOpen) { log('signal-drop-no-bridge', { to: toPeerId }); return; }
  sendToBridge({ type: 'signal', to: toPeerId, payload });   // ← bridge-only
}
```

So even though *routing* needs no bridge, *bootstrapping a new edge* (SDP
offer/answer + ICE) does. The bridge is therefore a **signaling
single-point-of-dependency** for new connections: while it's down, existing
direct links keep working and messages keep routing, but two peers that aren't
already connected cannot become connected.

**Goal.** Let a node negotiate a new direct WebRTC channel to a target peer by
relaying the signaling *through an existing peer* (or a short routed path),
falling back to the bridge only when no peer path exists (notably at cold
bootstrap). This removes the signaling SPOF; combined with **federated bridges**
and **demote-the-bridge** (Architecture §Future Directions) it makes the bridge
genuinely optional in steady state.

## 2. What already exists (the seams we build on)

- **Routed delivery.** `peer.routeMessage(targetId, type, body)` rides the
  recursive `route_msg` forwarder: each hop picks its AP-best next hop among its
  synapses and forwards, until a terminal node dispatches the inner message to
  its registered handler. This reaches a nodeId we have **no direct channel to**.
- **Discovery.** `triadic_introduce` hands a node a *candidate* nodeId for a
  peer it isn't connected to; `peer-list` does the same at join. The missing
  piece is the signaling *conduit*, not the introduction.
- **End-to-end channel auth.** Every WebRTC channel runs the `axona/4`
  handshake (pubkey → nodeId-suffix proof + signature over the link CBV) and is
  bound to the peer's **DTLS-certificate fingerprint** (finding A-1). This holds
  **regardless of who relayed the SDP** — which is exactly what makes relaying
  safe (see §5).

## 3. Design

### 3.1 Carry signaling over the routed mesh

Introduce a routed signaling message that wraps exactly what `sendSignal`
already emits today:

```
type:   'mesh:signal'            (routed via route_msg to `to`)
body: {
  to:      <hex nodeId>          # target of the connection
  from:    <hex nodeId>          # originator (authenticated at the channel layer later)
  relayId: <hex nodeId>          # first relay chosen (diagnostic)
  payload: { kind: 'sdp-offer' | 'sdp-answer' | 'ice', sdp?, candidate? }   # opaque to relays
}
```

The terminal node (`to`) dispatches `payload` into the **same**
`mesh.onSignal(from, payload)` entry point the bridge path uses today — so the
MeshManager state machine (offerer/responder, ICE trickle, DataChannel open) is
**unchanged**. Only the *transport of the signaling bytes* changes.

Intermediary peers treat `payload` as **opaque** — they forward the
`mesh:signal` envelope by nodeId and never inspect or alter the SDP.

### 3.2 Sink selection (the new `sendSignal`)

```
sendSignal(to, payload):
  if canRouteToPeer(to):        # we have a synapse path toward `to`
      routeMessage(to, 'mesh:signal', { to, from: self, payload })
  else if bridge.isOpen():      # cold bootstrap / no peer path yet
      sendToBridge({ type: 'signal', to, payload })
  else:
      queue/drop with diagnostic
```

Ordering is a **policy decision** (§7): "peer-first, bridge-fallback" maximizes
bridge independence; "bridge-if-directly-connected-else-peer" may cut a hop of
latency for the common case where both peers are on the bridge anyway. v0.1
proposes **peer-first when a routed path is known, else bridge**, because the
whole point is to not need the bridge.

### 3.3 Bootstrap still needs *a* rendezvous — but not *the* bridge

A brand-new node with an empty synaptome has no peer to relay through, so its
*first* edge must come from a rendezvous: a bridge today, any federated bridge
later, or a QR/anchor introduction. **Peer-relay applies once a node holds ≥1
mesh peer** — from that point it can reach the rest of the graph without the
bridge. This is the same "first neighbour is special, the rest are peer-driven"
shape the join flow already has (Architecture §How a New Node Joins).

## 4. Wire protocol

One new routed message (Wire Protocol spec to be amended):

| Message | Path | Auth | Notes |
|---|---|---|---|
| `mesh:signal` | routed (`route_msg`) → `to` | channel-layer (`axona/4`) on the *resulting* link; payload opaque to relays | carries SDP offer/answer/ICE; terminal node feeds `mesh.onSignal` |

No new signed-object type is required: unlike `kill`/`touch`, the signaling
bytes don't need their own signature, because the **connection they bootstrap is
authenticated end-to-end** by `axona/4` + DTLS-fingerprint binding. A forged or
tampered `mesh:signal` can at worst fail to produce a valid channel (the
handshake rejects it) — it cannot produce an *unauthenticated* one. Payloads are
size- and rate-capped at ingress (reuse the D-1 inbound caps).

## 5. Threat model

- **Malicious / curious relay.** A relaying peer can **drop or delay**
  signaling (denial of service / slow path) and can **observe metadata** ("A is
  trying to reach C", and the ICE candidates, which expose IPs). It **cannot
  MITM** the resulting channel: `axona/4` proves each endpoint's pubkey→nodeId,
  and the DTLS-fingerprint CBV binds the media path, so a relay that swaps in
  its own offer fails the mutual check. This is strictly **no worse than the
  bridge today**, which already sees the same metadata — and it removes the
  single observer by spreading relays across the mesh.
- **Metadata/IP exposure.** Same as the bridge case; TURN-relayed candidates
  already mask host IPs for cross-NAT pairs. A future option: prefer relays that
  are themselves K-close to neither endpoint to reduce correlation. (Out of
  scope for v0.1.)
- **Amplification / spam.** `mesh:signal` is bounded in size and rate per
  source (D-1); a relay forwards at most one in-flight negotiation per (from,to)
  pair within a window.
- **Relay refusal / eclipse.** If the chosen relay won't forward, the
  originator retries via an alternate routed path or falls back to the bridge —
  exactly the route-around the vitality model already does for dead next hops.

## 6. Failure modes & edge cases

- **No route to target.** Fall back to the bridge; if no bridge either, surface
  a clear "unreachable — no rendezvous" error.
- **Relay churn mid-handshake.** Signaling is idempotent and retried; a dropped
  relay mid-negotiation triggers a re-route on timeout (mirror the existing
  reconnect/backoff discipline).
- **Glare** (both sides initiate simultaneously). Existing MeshManager
  tie-break by nodeId ordering still applies — unaffected by the relay path.
- **ICE trickle ordering.** Candidates may arrive before the remote
  description; the MeshManager already queues `pendingCandidates`, so relay
  reordering is tolerated.

## 7. Open decisions

1. **Sink ordering** — peer-first vs bridge-if-connected (§3.2). Lean peer-first.
2. **Relay selection** — first AP-best hop vs an explicit "introducer who knows
   both" (a true triadic relay, lowest latency) vs privacy-minimizing choice.
3. **Capability negotiation** — advertise `mesh-relay` support in the version
   handshake so a node only routes `mesh:signal` to peers that understand it
   (older peers would drop it). Likely a `capabilities` flag, not a flag day.
4. **Backpressure** — per-relay in-flight cap and fairness.

## 8. Validation plan (dht-sim first — standing practice)

Before any kernel change, model peer-relayed signaling in `dht-sim`:

- **Success rate** of new-edge formation with the bridge **disabled**, across
  network sizes and partitions.
- **Convergence / hop-count** of the relay path vs the bridge baseline.
- **Churn**: relays leaving mid-handshake; measure retry/re-route latency.
- **Bootstrap boundary**: confirm the "≥1 peer ⇒ bridge-independent" claim and
  measure how quickly a fresh node crosses it.

Only after the sim shows acceptable convergence + failure behaviour do we touch
the kernel.

## 9. Phasing

1. **(this) Design note.**
2. **dht-sim model** of relayed signaling + the validation above.
3. **Kernel**: `mesh:signal` routed handler + the new `sendSignal` sink with
   peer-first/bridge-fallback, behind a `mesh-relay` capability flag. Per §8b
   finding 6, base the sink on the **iterative `lookup()` routing path**
   (alpha-parallel, dead-peer-aware), not a single-path `routeMessage` pass —
   the single path is churn-fragile at scale; the iterative search is not.
   ✅ **Done (kernel v2.17.0)** — `AxonaPeer` registers a `mesh:signal` routed
   handler (terminal → `transport.deliverMeshSignal` → `MeshManager.onSignal`)
   and an outbound relay sink whose reachability is gated on the cached
   iterative `lookup()` (finding 6) before a `route_msg` carry + retry.
   Unit-covered by `test/smoke_mesh_signal.js`.
4. **Wire it into `transport/web`**: `MeshManager.sendSignal` routes when a path
   exists, else bridge. ✅ **Done (kernel v2.17.0)** — `webTransport({ meshRelay })`
   (default **off**): the `sendSignal` sink prefers the registered relay when the
   destination is a nodeId (hex meshId) and falls back to the bridge otherwise;
   `setSignalRelay` / `deliverMeshSignal` / `connectViaRelay` expose the seam;
   `mesh-relay` is advertised in `client-hello`. Unit-covered by
   `test/smoke_mesh_relay_glue.js`; behaviour is byte-for-byte the bridge-only
   path when the flag is off.
5. **Tests**: sim + headless multi-peer (real WebRTC) — A connects to C through
   B with the bridge socket closed. ✅ **Done** — `sim-peer-relay.mjs` (§8a),
   `sim-peer-relay-kernel.mjs` (§8b), and `mesh_relay_webrtc.mjs`
   (`npm run test:mesh-relay`, §8c) all green; the WebRTC harness is the
   standing regression test for the kernel work.
6. **Ship** capability-flagged; **then** make peer-relay the default and let the
   bridge be a pure bootstrap/rendezvous (Architecture §Future Directions:
   "demote the bridge to an ordinary peer"). ✅ **Done (kernel v2.20.0, §8e)** —
   `meshRelay` defaults on, peer discovery autonomously forms bridgeless edges,
   verified end-to-end with the bridge process killed. The bridge is now only
   the cold-start rendezvous for a node's first edge.

## 8a. Validation results — first dht-sim run (2026-06-03)

Ran `dht-sim/scripts/sim-peer-relay.mjs` — a topology model: a stratified
channel graph (synaptome) bootstrapped via the bridge, then greedy-XOR
relay-routing of signaling over established channels, with the bridge
toggleable. K = 20; seeds 1–3; **reachability/topology only, not WebRTC**.

| N | edge success, bridge ON | edge success, bridge OFF (peer-relay) | OFF hops mean / p95 | connectivity OFF | edge success @ 50 % relays dead |
|---|---|---|---|---|---|
| 1 000  | 97.6 % | **97.6 %** | 3.9 / 6 | **100 %** | 94.8 % |
| 3 000  | 99.2 % | **99.2 %** | 4.6 / 7 | **100 %** | 93.3 % |
| 10 000 | 99.8 % | **99.8 %** | 5.4 / 8 | **100 %** | ~95 % |

Bootstrap boundary (bridge OFF, reachability vs. # peer channels a fresh node
holds): **0 → 0 %**, 1 → ~50 %, 2 → ~74 %, 3 → ~80 %, 5 → ~90 %. Stable across
seeds. (50 k skipped — the script's bootstrap is O(N²); the 1 k–10 k trend is
stable and the hop premium is clean O(log N).)

**Findings**

1. **Peer-relay matches the bridge baseline.** With a realistic synaptome,
   bridge-OFF new-edge formation equals bridge-ON (≈ 98–99.8 %), at a small,
   *logarithmic* hop premium (p95 6 → 7 → 8 as N grows 1 k → 3 k → 10 k) versus
   the bridge's 1-hop relay. The bridge is **not** required to form new edges
   once a node is meshed.
2. **Connected and churn-robust.** The channel graph is 100 % connected with the
   bridge off, and stays 100 % connected with ~95 % edge-success even when
   **50 % of relays are killed** — graceful degradation, no fragmentation.
3. **Bootstrap boundary confirmed.** A node with **0** peer channels can't
   relay (it needs the bridge/a rendezvous for its *first* edge); by ~3–5 mesh
   peers it reaches 80–90 % of the network — it crosses to bridge-independent
   almost immediately. This is exactly the "≥ 1 peer ⇒ bridge-independent"
   claim, now with a curve.
4. **Critical precondition (the surprise the sim caught).** Peer-relay only
   works if the synaptome is **stratified** (multi-scale — a contact at every
   XOR-distance bucket, the Axona `stratum` / Kademlia k-bucket structure). An
   earlier model with a *K-closest-only* overlay fragmented to **< 5 %**
   connectivity and **~1 %** reachability with the bridge off: nearest-neighbour
   links alone give greedy routing no long-range jumps, so it dies at local
   minima. Axona's stratum-based synaptome provides the multi-scale links — but
   the implementation must (a) route relays over the **full** stratified
   synaptome (AP/stratum routing already does), and (b) ensure far strata are
   **populated** (lookups / triadic introductions); a node whose far buckets are
   empty regresses toward the fragmented case. This is the acceptance criterion
   to enforce, plus the bridge-fallback guard for when relay routing can't
   progress.

**Verdict: GREEN** to proceed to the kernel `mesh:signal` implementation, with
finding 4 as an explicit requirement (stratified synaptome + bridge fallback).
Next sim refinement: re-run over the **real kernel** routing (AP-best, vitality)
rather than the greedy-XOR proxy, and add the WebRTC-negotiation layer in the
headless real-WebRTC harness.

## 8b. Validation results — real-kernel pass (2026-06-04)

Ran `dht-sim/scripts/sim-peer-relay-kernel.mjs` — the refinement §8a called
for. This **drops the greedy-XOR proxy** and builds N real `@axona/protocol`
`AxonaPeer`s over the kernel's own `SimNetwork` + `simTransport`
(`TransportAxonaEngine`), bootstraps their synaptomes with the **production XOR
k-bucket fill** (`buildXorRoutingTable`, capped at the real `MAX_SYNAPTOME`
ceiling — avg synaptome ≈ 28–34), and forms the new edge by routing a
`mesh:signal` over the kernel's **actual `route_msg` forwarder** — greedy
next-hop + 2-hop terminal lookahead (`_findCloserInTwoHops`), the exact code a
deployed peer runs. A node *consumes* the signal iff it is the routed target;
every intermediary forwards. K = 20; seeds 1–3; geo-correlated nodeIds. (Still
topology/reachability — real WebRTC stays in the headless harness.)

**Steady state — `mesh:signal` delivered over real `route_msg`:**

| N | delivered | mean / p95 hops | `lookup()` found (cross-check) | connectivity |
|---|---|---|---|---|
| 200    | 100.0 % | 3.1 / 5  | 100 % | 100 % |
| 500    | 99.8 %  | 3.9 / 7  | 100 % | 100 % |
| 1 000  | 99.8 %  | 4.6 / 8  | 100 % | 100 % |
| 3 000  | 99.7 %  | 5.7 / 9  | 100 % | 100 % |
| 10 000 | 99.7 %  | 6.7 / 11 | 100 % | 100 % |

**Churn — kill R % at once + `postChurnHeal`, then re-measure (seed 1; the
route_msg-vs-lookup gap is stable across seeds 1–3):**

| N | 10 % dead (route_msg / lookup) | 25 % dead | 50 % dead |
|---|---|---|---|
| 200    | 99.1 % / 100 % | 99.7 % / 100 % | 97.8 % / 100 % |
| 1 000  | 97.1 % / 100 % | 94.2 % / 100 % | **80.4 %** / 100 % |
| 3 000  | 93.0 % / 100 % | 84.6 % / 100 % | **65.1 %** / 100 % |
| 10 000 | 90.7 % / 100 % | 79.4 % / 100 % | **56.2 %** / 100 % |

**Findings**

5. **The proxy's steady-state GREEN holds on the real router.** Bridgeless
   `mesh:signal` delivery over the shipping `route_msg` is 99.7–100 % across
   200–10 000 peers, 100 % connectivity, at a clean **O(log N)** hop premium
   (mean 3.1 → 6.7, p95 5 → 11 as N grows 200 → 10 k). The proxy was, if
   anything, slightly conservative. The mechanism in §3.1 works as designed in
   steady state.

6. **New constraint the proxy could not surface: don't ride single-path
   `route_msg` under heavy churn.** The kernel's `route_msg` is a *single*
   greedy path + 2-hop lookahead. Under churn it dead-ends at local minima, and
   the failure **worsens with scale** — at 50 % of relays dead it falls to
   80 % (1 k), 65 % (3 k), 56 % (10 k). The proxy's idealized greedy missed this
   because its static graph never made the forwarder commit to a doomed single
   path. Meanwhile `peer.lookup()` — the **alpha-parallel, dead-peer-aware
   iterative search** the kernel already ships — holds **100 % at every size
   and every churn level**. So the fix is free: **`sendSignal` should deliver
   the `mesh:signal` over the iterative lookup machinery (alpha branches +
   re-route on dead next hop), not a single `routeMessage` pass** — with the
   §6 retry/re-route discipline and the bridge fallback as the final backstop.
   This refines design decision §7.2 (relay selection) and §3.2 (the sink): the
   sink's "can I route to peer?" test should be an iterative lookup, and a
   failed lookup (not just an absent greedy hop) is what triggers bridge
   fallback.

**Verdict: still GREEN**, now on the *real* router rather than a proxy — with
finding 6 promoted to a hard implementation requirement alongside finding 4.
Recommended kernel shape: base `sendSignal` on the `lookup()` routing path
(iterative, alpha-parallel) carrying the signaling payload to the terminal
node, not on the single-path `routeMessage` forwarder; keep peer-first /
bridge-fallback. Remaining sim gap before ship: the headless real-WebRTC
harness (offer/answer/ICE/DTLS over a relayed path with the bridge socket
closed) — the one layer neither the proxy nor this pass models.

## 8c. Validation results — real-WebRTC harness (2026-06-04)

Ran `axona-protocol/test/integration/mesh_relay_webrtc.mjs`
(`npm run test:mesh-relay`) — the layer §8a/§8b explicitly deferred: the
**actual WebRTC offer/answer/ICE/DTLS negotiation**, carried over a peer relay
instead of the bridge. Three real `RTCPeerConnection` peers (the
`node-datachannel` polyfill), each a real `MeshManager` + `MeshAuth` (the
shipping mesh + axona/4 code), keyed by stable nodeId.

Scenario: **A↔B** and **B↔C** bootstrap as real, authenticated channels
(models "met through the bridge at join"); then the **bridge is closed** (the
direct signaling fabric is disabled, with a guard that fails the test if any
direct delivery is attempted afterward); then **A forms a new direct channel
to C** with every offer / answer / ICE candidate relayed **A→B→C and C→B→A over
the real A↔B and B↔C data channels** — B forwarding opaque payloads exactly as
the kernel `mesh:signal` step will.

**Result: 17/17 checks pass, stable across repeated runs.** In particular:

- the **A↔C real `RTCDataChannel` opens in both directions** with the bridge
  closed, formed entirely via the peer relay;
- the relay was actually exercised (B forwarded signaling frames) and **no
  direct-signaling delivery occurred after the bridge closed** (guard = 0);
- **DTLS fingerprints are present for A↔C on both ends and cross-match**
  (A.local == C.remote, C.local == A.remote);
- **axona/4 binds A↔C end-to-end** — confirming the §5 safety claim on a real
  relay-formed channel: *the connection is authenticated regardless of who
  relayed the SDP* (A-1's fingerprint binding holds; a relay that rewrote the
  SDP would produce divergent fingerprints and fail the mutual signature);
- the resulting A↔C channel is **direct**: an app message A→C arrives at C
  **without B forwarding it** (B is out of the data path once the channel exists).

**What this closes.** The three validation layers now agree: topology (§8a,
greedy-XOR proxy), real routing (§8b, kernel `route_msg`/`lookup`), and real
WebRTC (this, §8c). NOTE: §8c hand-wires the relay; the *productized* kernel
path is verified separately in §8d.

## 8d. END-TO-END verification of the productized path — bridge killed (2026-06-05, kernel v2.19.0)

§8a–§8c validated the *mechanism* in pieces. This validates the **shipping code
path composed end-to-end**, and it is the gate for the project-killer question
("can two nodes connect directly without the bridge?").

Harness `axona-protocol/test/integration/mesh_relay_e2e.mjs`
(`npm run test:mesh-relay-e2e`): a **real `axona-bridge`** + three real
`webTransport({ meshRelay:true })` peers over real WebRTC. (1) bootstrap an
authenticated mesh via the bridge; (2) **`SIGKILL` the bridge** and wait until
every peer's bridge socket is closed; (3) sever the A↔C channel and drop the
stale synapse so A holds C's nodeId but has no channel/synapse to it (the
discovered-but-unconnected production state, §3.3); (4) `A.connectViaRelay(C)`.
With the bridge **process dead**, A formed a NEW authenticated direct
`RTCDataChannel` to C — offer/answer/ICE relayed A→B→C over the live mesh —
axona/4 bound end-to-end, live RTT flowing over the direct channel. **14/14,
stable across repeated runs.** Because the bridge was dead and A↔C had no prior
channel, the SDP/ICE could only have crossed via the peer relay.

**This verification caught two real bugs that the piecewise tests did not** —
both would have shipped a relay that silently fails in the field:

1. **`routeMessage` 2-hop fallback forwarded to a non-adjacent peer.**
   `_findCloserInTwoHops` returned the *2-hops-away* node; the forwarder then
   did `transport.send(thatNode, …)` to a peer it had no channel to → the send
   threw and routing died one hop short. Fixed to return the **first-hop
   synapse** (the adjacent peer that just answered the probe — proven live).

2. **No dead-synapse eviction (the decisive one).** AxonaPeer subscribed to
   `onPeerBound` (admission) but never to peer-death, so a dead synapse —
   crucially the **bridge** after it drops — lingered in every peer's table.
   Greedy `lookup`/`route_msg` then picked that dead, XOR-near synapse toward
   many targets, the hop failed, and the relay's *return path* (answer/ICE)
   never made it back. This is acute precisely when peer-relay matters most:
   right after the central bridge dies. Fixed by subscribing to
   `transport.onPeerDied` and **evicting the synapse immediately** (kernel
   v2.19.0) — plus a defense-in-depth skip of unconnected synapses in the
   greedy next-hop selection. Eager eviction also improves churn routing for
   all deployments, not just the relay.

**Regression:** full kernel suite (44 files), both prior WebRTC harnesses
(`test:mesh`, `test:mesh-relay`), dht-sim engine smokes, and the real-kernel
routing sim all green after the fixes; route_msg delivery in the sim ticked to
100%.

**Verdict (at §8d, kernel v2.19.0).** The bridgeless-connection MECHANISM is
verified functional end-to-end over the real productized path with the bridge
dead — a genuine fix. Two activation gaps remained: (a) `meshRelay` shipped
**default-off**; (b) there was **no autonomous trigger** (`connectViaRelay` was
an explicit call). Both are **closed in v2.20.0** — see §8e.

## 8e. AUTONOMOUS verification — default flag, discovery-triggered (2026-06-05, kernel v2.20.0)

§8d proved the mechanism when `connectViaRelay` is called explicitly. v2.20.0
makes it the **default** and **self-driving**, and §8e proves a deployment forms
bridgeless connections with no application involvement:

- `meshRelay` now defaults ON (bridge bootstrap path unchanged — it signals by
  connId, never a hex nodeId, so the relay sink never intercepts it).
- `AxonaPeer._considerCandidate` (the peer-discovery → connect path) falls back
  to `connectViaRelay` when `openConnection` finds no bridge binding for a
  discovered nodeId. So a meshed node forms a new direct edge to a peer it
  learned about via `triadic_introduce` / gossip — bridge-free.

Harness `axona-protocol/test/integration/mesh_relay_auto_e2e.mjs`
(`npm run test:mesh-relay-auto-e2e`): peers built with the **default** flag
(no `meshRelay` passed); bootstrap a mesh via a real bridge; **kill the bridge**;
sever A↔C so A holds C's id but no channel; **B introduces C to A via a real
`triadic_introduce`** (no `connectViaRelay` call in the test). Result, **9/9
stable**: with the bridge **process dead**, A autonomously formed an
authenticated direct `RTCDataChannel` to C **and re-admitted C to its routing
table** (synaptome), purely from the discovery event.

**Two more real bugs caught and fixed here** (both churn-class, beyond the
relay):

1. **`connectViaRelay` was not idempotent.** Discovery fires repeatedly, and each
   call re-ran `_initiateTo`, overwriting the in-flight `RTCPeerConnection` and
   restarting ICE so it never completed. Now guarded by `mesh.hasPeer` (no-op
   while a negotiation to that peer is in progress).
2. **A reconnecting peer was never re-admitted to the routing table (decisive,
   affects all churn).** `composite.onPeerBound` deduped its fan-out with a
   *permanent* `seen` set, so the "peer bound" notification fired only **once per
   peer for the lifetime of the subscription**. A peer that dropped and rejoined
   stayed bound-but-unrouted. Fixed by **re-arming the dedup on peer-death** (+
   clearing the peer from `_deadPeers` on rebind), so a returning peer re-fires
   `onPeerBound` and is re-seeded into the synaptome.

**Final verdict: bridgeless connection is functional, autonomous, default-on,
and verified end-to-end with the bridge process dead.** The bridge is now only a
cold-start rendezvous for a node's first edge; once a node holds ≥1 mesh peer it
forms further connections without it. The one item §8e flagged as future work —
*genuine multi-hop relay over a sparse topology at scale* — is now closed in §8f.
The privacy-minimising relay-selection option (§7.2) remains open and non-blocking.

## 8f. GENUINE MULTI-HOP, AT-SCALE verification (2026-06-05, kernel v2.21.0)

§8d/§8e prove the mechanism with a **single** relay: a 3-peer mesh where the
intermediary B is directly adjacent to **both** endpoints. That is the easy case
and not what a deployment depends on — in a real (sparse, non-full-mesh) network
the node carrying your SDP/ICE is usually **not** adjacent to your target, so the
`mesh:signal` must traverse **several routed kernel hops**. §8f proves exactly
that, at scale, over real WebRTC, and proves the routing substrate that carries
the signalling scales to deployment size.

**(1) Real-WebRTC genuine multi-hop — `mesh_relay_multihop_e2e.mjs`**
(`npm run test:mesh-relay-multihop`). N real node-datachannel peers bootstrap a
mesh via a real bridge, then the mesh is **pruned to a sparse, connectivity-
checked topology**, the **bridge process is killed**, and direct authenticated
channels are formed over the relay. The ironclad condition is **"no common
neighbour"**: the headline origin/target pair is selected — from the **live**
post-prune graph — to share *zero* neighbours. With no shared neighbour a single
relay hop is **structurally impossible** (no one peer can carry the offer
straight to the target), so a formed channel proves the SDP/ICE **chained
through ≥2 distinct pure intermediaries**, which the harness instruments and
prints. Observed: the headline pair is consistently **3–4 routed relay hops**
apart and forms a real `RTCDataChannel` + axona/4 binding + live RTT with the
**bridge dead**; the relay chain shows 3–5 distinct pure intermediaries. A bulk
phase then drives **every** router-reachable non-adjacent pair: routing reaches
**100%** of them and ≈93–100% complete the full ICE channel (the occasional
straggler is node-datachannel finishing ICE under the load of N²/2 concurrent
negotiations in one process — proven reachable, mid-negotiation, not a relay
fault). Stable green across many runs.

**(2) At-scale routing substrate — `dht-sim/scripts/sim-peer-relay-kernel.mjs`**
over the real kernel `route_msg`/`lookup`. At **N = 10,000** kernel peers
(production synaptome cap 50): **99.5%** `mesh:signal` delivery (mean 6.9 hops,
p95 11), **100%** `lookup` found-rate, **100%** connectivity. Under instantaneous
mass churn the single-path `route_msg` degrades while the alpha-parallel
iterative `lookup` (which the relay's own reachability gate uses) stays ≈100% —
so relay reachability is judged by the robust path, and the negotiation's
frame-level retry re-drives transient losses.

**A real robustness fix surfaced by the deep run.** A `RTCPeerConnection` that
reached connectionState `'closed'` out from under us (remote close / abrupt
drop) was left in the mesh's peer map with **no teardown** — so `hasPeer` stayed
true forever and `connectViaRelay`'s idempotency guard **no-op'd permanently**: a
peer whose relayed channel dropped to `'closed'` could **never** re-establish a
direct connection without the bridge. Now a live entry reaching `'closed'` is
torn down (slot freed → `hasPeer` false → discovery re-drives a fresh
negotiation; `onPeerLost` fires iff it had ever opened). The `'failed'` retry
path is unchanged. Locked by `smoke_mesh_closed_teardown.js` (13). Without this,
the at-scale bulk phase would have left dropped pairs permanently wedged — the
kind of latent failure that only bites once a deployed network sees real churn.

**Verdict:** WebRTC peers **find** each other (discovery + `lookup` over the
mesh, 100% at 10k) and **connect** to each other (authenticated `RTCDataChannel`
over genuinely multi-hop relayed signalling, bridge process dead) with **no
dependence on the bridge** — at deployment scale and over the multi-hop paths a
real sparse network actually uses.

## 8g. Pre-deployment stability review (2026-06-05, kernel v2.22.0)

Because every prior verification pass had surfaced at least one real bug, a
deliberately adversarial pre-deploy review was run: full regression-stability
loops (kernel suite + all four relay harnesses, ×3 — all green and
non-flaky) plus three independent code audits (mesh reconnect state machine;
relay routing path; cross-repo deploy readiness). It found one **blocker** and a
catalogue of lower-severity items. The point of recording the full triage here is
that the remaining items are now **known and assessed**, not undiscovered.

**BLOCKER (fixed, v2.22.0) — never-opened negotiation wedge.** The symmetric twin
of the v2.21.0 `closed` wedge, reached via `failed`. A PeerConnection that fails
ICE does not autonomously reach `closed`, and the ping/stale/send-fail eviction
timers run only on already-open channels — so a peer stuck in
`new`/`signaling`/`failed` that never opens (a **responder** especially, which
`_scheduleRetry` gives no retry) sits in `_peers` forever, keeping `hasPeer` true
and no-op'ing `connectViaRelay` permanently. The loopback harnesses can't catch
it (their ICE never fails). Fixed with a per-peer **negotiation watchdog**
(absolute 30s deadline, preserved across retries) that retires a never-opened
peer so discovery can re-drive, and that bounds the previously-unbounded 5s
offerer retry loop. Guarded by `smoke_mesh_negotiation_watchdog.js` (14).

**Assessed as NOT blockers (with reasons):**

- *Relay sink claims ownership before reachability is confirmed → on relay
  failure the frame is dropped with no bridge fallback.* Architecturally moot: the
  bridge signals only by **ephemeral connId**, never by hex nodeId, so it cannot
  deliver a relay-addressed (hex-nodeId) signal regardless — there is no better
  fallback. The negotiation's own retry plus the v2.22.0 watchdog bound and
  re-drive any stuck attempt.
- *Security of the relay path.* Confirmed safe: a malicious intermediary cannot
  MITM (the channel binds to the real DTLS fingerprints via the signed axona/4
  CBV — a substituted fingerprint fails mutual verify), cannot forge an
  authenticated channel, cannot blackhole an introduction (only the true target
  consumes; every other hop forwards), and routing is loop-bounded by `MAX_HOPS`.
  A relay can only drop (fail-closed), which retry/​watchdog handle.

**Hardening wave — shipped in v2.23.0 (one careful fix at a time, each tested):**

- *Pub/sub `postHash` ↔ verified msgId reconciliation* (content-address integrity;
  closes pull/kill poisoning + un-killable messages). SECURITY-CHANGELOG v2.23.0.
- *`connectViaRelay` backpressure* — concurrent relay negotiations capped on the
  mesh's never-opened count (self-healing via the v2.22.0 watchdog), bounding the
  gossip-introduction-flood amplification.
- *mesh-auth `verifying` cleared on every non-success exit* — a failed handshake
  can no longer wedge a channel authenticated-but-unbound (deterministic test).

A methodology note from this wave: the 3-peer `mesh_relay_e2e` harness is
intermittently flaky (~bootstrap convergence) ONLY when harnesses run
back-to-back under node-datachannel resource pressure — it is 10/10 clean in
isolation. A provably-inert change reproduced the same failure pattern, so
regressions in it must be judged by isolated high-N A/B (or, better,
deterministic unit tests), not single back-to-back runs.

**Known follow-ups still open (non-blocking, tracked in the red-team register
addendum, SP-6…SP-12):** a per-source rate + size cap on INBOUND `mesh:signal`
(SP-6); two slow monotonic leaks on a long-lived relay peer — `_relayReach` and
`_deadPeers` (SP-7/8); the anonymous-publish quota bypass (SP-10); kill removing
only the first duplicate-content copy (SP-11); and the latent (currently
unreachable) glare-dedup null-key tiebreak (SP-12).

**Deploy-execution blockers (separate from kernel correctness, user-gated):** the
msgId change (v2.18.0) is a hard wire split — old and new peers disagree on
message identity — so the rollout must be a coordinated flag-day; the bridge's
installed kernel currently lags even its own pin (a `git pull` alone won't update
it — the deploy must run `npm ci`); and the bridge version-gate floor admits the
incompatible kernel range and should be raised so stragglers are cleanly rejected
rather than silently joining a split pub/sub.

## 10. Relationship to the other Future Directions

- **Federated bridges** removes the single *rendezvous* (where a cold node makes
  its first edge).
- **Peer-relayed signaling** (this note) removes the single *signaling relay*
  for every edge *after* the first.
- **Demote the bridge to an ordinary peer** is the consequence once both land:
  the bridge keeps only the cold-bootstrap rendezvous role, drops out of routing
  candidacy once a peer is meshed, and is otherwise indistinguishable from any
  peer.

Together these turn "the bridge is a dependency" into "a bridge is one of many
interchangeable, optional bootstrap aids."
