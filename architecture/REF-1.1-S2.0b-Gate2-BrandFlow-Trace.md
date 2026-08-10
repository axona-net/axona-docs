# REF-1.1 S2.0b Gate 2 — object-identity / brand-flow trace (boundary 1)

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S2.0B-GATE2-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Closes:** Gate 2 of `REF-1.1-S2.0b-ParseSite-CertificationTable-v2.md`
  (058d83a), authorized as analysis only by Aster's disposition
  `ASTER-COUNCIL-REF11-S20B-DISPOSITION-20260810-01` (seq 688).
- **Kernel traced:** 4.62.2 (`fb3ea39`). Every claim below cites an exact site.
- **Status:** for Aster review. Analysis + doc only — no code, no dispatch change,
  no deploy. S2.0c held, S2.1 blocked.

## The question

If a certifying decoder brands the frame at the inbound transport seam, does the
**same branded object** reach every boundary-1 routed handler — or is it spread,
reconstructed, or re-serialized anywhere between decode and `handler(payload)`,
dropping the WeakSet brand? Answered per transport (node WS, web-bridge WS,
WebRTC mesh) and for multi-hop forwarding, for all 19 routed types.

## The 19 routed types share ONE brand-flow path

The boundary-1 types are registered in `wireHandlers._registerHandlers`:
`SUB, UNSUB, PUB, DELIVER, ADOPT, PULLUP, HANDOFFACK, REPLAYUP, HANDOFF,
REPLICATE, KILL, INGESTACK, RECEIPTPROBE, RECEIPTNACK, TOUCH, PULL, PULLRESP,
ROOTBEACON, METRICSON`. They are **not 19 wire paths** — every one is dispatched
by `_deliverRouted` on the `payload.type` field
(`AxonaPeer._deliverRouted:4089` → `handler(payload, meta):4094`), and each
receives its `payload` by the identical mechanism. So the identity trace is one
path; the only per-type variation is how deep each type projects its fields
(the depth budget, below).

## The inbound delivery chain (verified by reference, all three transports)

A boundary-1 frame is carried inside a `route_msg` RPC request. The wire nesting
from the transport's `JSON.parse` root to the routed payload:

```
frame                                   depth 0   { type:'axona', payload }        ← JSON.parse(ev.data)
  .payload                              depth 1   { k:'req', id, type:'route_msg', body }
    .body                = msg          depth 2   { type, payload, targetId, hops, originId }
      .payload           = routed load  depth 3   { topicId, json, via, … }        ← observed as args[0]
        scalar leaf                     depth 4   e.g. topicId
        nested meta leaf                depth 5   e.g. meta.x
```

Every hand-off is a property read or a by-reference destructure — no spread, no
reconstruction, no re-serialization:

| Step | node WS | web-bridge WS | WebRTC mesh |
|------|---------|---------------|-------------|
| decode | `node/index.js:213` `JSON.parse(ev.data)` (plain) | `web/index.js:335` `JSON.parse(ev.data)` (plain) | `web/mesh.js:802` `JSON.parse(ev.data, bigintReviver)` |
| handoff (by ref) | `:219` `handleIncoming(connId, frame.payload)` | `:342` `bridge.handleIncoming(frame.payload)` | `webrtc.js:465` `_onMessage(fromMeshId, msg)` |
| RPC dispatch (by ref) | `wstransport.js:412`→`_handleRequest:425` | `bridge.js:315`→`_handleRequest` | `webrtc.js:478`→`_handleRequest:487` |
| body → handler (by ref) | `handler(fromNodeId, msg.body)` | `handler(fromNodeId, msg.body)` | `handler(fromNodeId ?? fromMeshId, msg.body)` |
| route_msg handler | `AxonaPeer:630` `const { type, payload } = msg` (`:631`, by ref) | same | same |
| deliver | `_deliverRouted(type, payload):663` → `handler(payload):4094` | same | same |

`msg.body` = the route_msg body (`msg` at `AxonaPeer:630`); `msg.payload` = the
routed payload = `args[0]` the shadow layer observes. Because `certify` brands
**every reachable node** of the decoded graph (`snapshotMint.brandWalk`), the
routed payload at depth 3 and its scalar leaves at depth 4–5 are branded when the
transport decode is the certifying decoder — the same object then travels to the
handler unchanged.

**Reconstruction / spread-loss points on the delivery path: NONE.** The only
`{...}` spreads in `AxonaPeer.js` are off-path (`:1264`, `:1510` subscription-state
copies; `:2460` synapse copy; `:3318` `msgsByType`) — none touches a routed
payload between decode and handler.

## Forward / multi-hop = per-hop re-certification

A forwarding node builds a **fresh** object and re-serializes it to the next hop:
`AxonaPeer:691` `node.transport.send(nextHopId, 'route_msg', { type, payload, … })`
→ `JSON.stringify` → next hop `JSON.parse` + re-certify. The brand does **not**
cross the hop; it is re-minted at each inbound decoder. This is exactly the
per-hop model. (A forwarder also observes locally at `:663` on its own certified
inbound copy, which is correct.)

## Depth-budget finding (the load-bearing constraint)

Brand-flow is preserved by object identity; the only failure mode is **depth**.
`brandWalk` bounds at `MAX_DEPTH = 8`, `MAX_NODES = 4096` (`snapshotMint.js`).
From the `JSON.parse` root a routed scalar leaf is at depth 4–5 — inside 8, with
margin. But this MUST become a **measured per-type acceptance gate**, not an
assumption: a frame whose payload nests projected fields deeper (e.g.
`payload.meta.sub.field`) adds levels, and a projected leaf past depth 8 from the
certify root reads back `fault:'unbranded'` (observation no-op), not a false
verdict — safe, but it silently drops observation for that field. The S2.0c/S2.1
test set must assert, per registered type, that every declared projection field
is reachable within the certify depth budget from the chosen certify root.

Corollary — certify-root choice: rooting `certify` at the transport `JSON.parse`
output (the full `{type:'axona',payload}` envelope) puts the routed payload at
depth 3. Rooting it one level in (`frame.payload`, the RPC message) would put it
at depth 2 and buy one level of headroom. Either is inside budget today;
S2.0c should pick the root explicitly and record the measured worst-case
per-type depth.

## Gate-2 verdict

**Brand-flow is sound.** For all 19 routed types, across node WS / web-bridge WS /
WebRTC mesh, and through multi-hop forwarding, the object a boundary-1 handler
receives is identity-preserved from the inbound decoder with zero
reconstruction/spread-loss points. Option (a) — certify at each fixed inbound
decoder variant, per hop — therefore actually delivers a branded payload to the
handler without threading source text or re-parsing. `certifyBigint` is mandatory
on the mesh variant (bigint reviver); `certifyPlain` on node/bridge. The residual
obligation is the per-type depth gate above.

## Gate-3 recommendation (local-origin) — for the same review

`routeMessage → _deliverRouted:3982` hands a **programmatically-created,
unbranded** payload to the handler with no decode. Two ways to satisfy Gate 3:

- **(i) inbound-only observation scope (recommended).** Shadow observation
  covers only frames that arrived through a certifying inbound decoder;
  locally-originated routed payloads are `unbranded-source` → handler verbatim,
  no observation, by the shipped S1 design. Document that the observed population
  is inbound frames, and never claim "all 19 handlers observed" for local origin.
  Zero new minting surface, zero new attack surface. A locally-originated frame
  is self-produced and already trusted; observing it adds no security signal.
- **(ii) safe non-general local mint.** At the specific `routeMessage` origin
  site, serialize the just-built payload and pass it through the SAME fixed
  string-only `certifyPlain` before `_deliverRouted`, so local frames are observed
  too. Costs a serialize+parse per local send and must be confined to that one
  call site — it must NOT introduce a general object-branding export (which S1
  forbids and Aster re-confirmed).

Recommend **(i)**: it closes the gap with no new minting path and no observation
value lost that matters (self-produced frames need no integrity observation).
If council wants local-origin observed for completeness, (ii) is the only safe
form and is scoped to one site.

## Out of scope / gates remaining

No code, no dispatch change, no deploy. Still mandatory before the S2.0c/S2.1
code tranches clear: the per-type depth gate (this doc), F7 pre-parse UTF-8-byte
ceiling + type normalization at each certifying decoder, and F8 tests proving the
brand grants no auth / authorization / validation / dispatch authority. S2.0c
held, S2.1 blocked, M1 canary + deploy separately David-gated.
