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
   peer-first/bridge-fallback, behind a `mesh-relay` capability flag.
4. **Wire it into `transport/web`**: `MeshManager.sendSignal` routes when a path
   exists, else bridge.
5. **Tests**: sim + headless multi-peer (real WebRTC) — A connects to C through
   B with the bridge socket closed.
6. **Ship** capability-flagged; **then** make peer-relay the default and let the
   bridge be a pure bootstrap/rendezvous (Architecture §Future Directions:
   "demote the bridge to an ordinary peer").

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
