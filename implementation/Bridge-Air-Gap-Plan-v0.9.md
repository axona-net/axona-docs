# Bridge Air-Gap — Project Plan — v0.9 (normative correction to v0.8: provenance and send-call observations)

**Status:** proposed; a SHORT normative correction under Aster CP 23f031a3,
recording the two acceptance clarifications on v0.8 separately from its frozen
snapshot. It amends §7.2.6 only. It reopens nothing.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Base:** v0.8 (sha256 754e72fe…) on v0.7 (0f06b617…) on v0.6 (952e0660…) on
v0.5 (f0d5bcbe…) on v0.4 (cc9ea61a…) on v0.3 (e7b23101…); v0.2 (3e8f8a9a…) and
v0.1 (866b123f…); all frozen
**Companions:** council 3fc518cd, 23f031a3, b19a77ca; kernel branch
`air-gap-4.89.0` (2170464); bridge branch `air-gap-2.132.0` (a7e3339); both
LOCAL until David okays a push; ops/STATE.md 2026-09-22

---

## 0. What this correction adds

| Clarification (Aster 23f031a3) | Where |
|---|---|
| a frame's type is not evidence of its origin; the class needs trusted local causal metadata | §7.2.6 provenance |
| "returned without throwing" is a send-call observation, not delivery; a forbidden invocation is itself the failure | §7.2.6 send-call observations |
| cadence and bound sources named for `linkMaintenance` and uplink `controlBare` | §7.2.6 sources |

Unchanged and still INCOMPLETE: §7.2.7, WP3, WP4 H0 and O2 point 3, rows
I1–I4, D1–D16, O1, O3–O5, L1–L3. D7 operator; D8 neither.

## 7.2.6 (amended) Provenance: shape, cause and point decide the class

Every write site supplies a `cause`, a string the site itself knows to be true
because it is the code that emitted the frame. The classifier assigns a class
from three things together: the frame's shape, the cause, and the write point.
No cause, or a cause that cannot lawfully produce that frame at that point,
reads `genericTransit`. The frame's own fields (its type, its `originId`, its
`via`) are claims, and a claim alone never earns a class above `genericTransit`.

Causes, closed:

| Cause | Supplied by | Means |
|---|---|---|
| `connect` | server.js on socket accept | the connection exists |
| `admission` | server.js `admitConnection`; the bridge node's hello and hello-ack | client-hello passed on this socket |
| `close` | server.js close handler | that socket closed |
| `reply` | server.js bare-frame handlers, with `inReplyTo` | a bare request-like frame was received on this socket |
| `signal-relay` | server.js `signal` handler | a bare `signal` was received naming this destination |
| `kernel-request` | ws_transport `send`; WebRTCTransport `send` | the local kernel issued a request |
| `kernel-notify` | ws_transport `notify`; WebRTCTransport `notify` | the local kernel issued a notification |
| `kernel-reply` | ws_transport `_reply` (with `reqType`); WebRTCTransport reply | the local kernel answered a request it dispatched |
| `keepalive` | mesh keepalive ping and pong | the mesh liveness timer |
| `uplink-socket` | the WebSocket subclass uplink.js hands the kernel | the only writer of the uplink socket is the kernel's web transport |

Class × cause × point, the rows that changed:

| Class | Requires | Forbidden case fenced (same wire type, wrong provenance, transition or destination) |
|---|---|---|
| `controlBare` | `version-gate` + `connect`; `welcome`, `peer-list`, `turn`, `peer-joined` + `admission`; `peer-left` + `close`; at the uplink point only, `client-hello`, `ping`, `peer-list-request`, `turn-refresh` + `uplink-socket` | `peer-list` with no cause; `peer-joined` + `close`; `peer-left` + `admission`; `client-hello` toward a client; `ping` at the uplink point without the socket cause |
| `controlReply` | `pong`, `peer-list`, `turn` + `reply` with `inReplyTo`; a `res` + `kernel-reply` | `pong` with no cause; a `res` with no cause |
| `signalRelay` | `signal` + `signal-relay` | `signal` with no cause |
| `hello` | `hello` + `admission`; `hello-ack` + `admission` or the kernel's own notify | `hello` + `kernel-notify` |
| `linkMaintenance` | the listed ntf types + `kernel-notify`; `ping` req + `kernel-request`; data-channel `ping`/`pong` + `keepalive` | `reinforce` with no cause; `presence` + `admission`; `ping` req + `reply`; data-channel `ping` without `keepalive` |
| `discoveryReply` | `res` + `kernel-reply` + a discovery `reqType` | the same `res` with no cause |
| `discoveryRequest` | `lookup_step` / `find_closest_set` + `kernel-request` | the same request with no cause |
| `directoryOwnEntry`, `directoryRepublish`, `directoryServe` | own `originId` AND a directory topic AND `kernel-request` (or `kernel-notify` for `direct_*` serve) | the same frame with no cause: `originId` is a frame-supplied claim |

Sources of cadence and bound, named:

- `linkMaintenance` notifications (`reinforce`, `triadic_introduce`,
  `hop_cache`, `lateral_spread`) are emitted by the kernel's routing events (a
  used synapse, a completed lookup) inside `AxonaPeer`; `presence` and
  `peer-leaving` by the synaptome maintenance timer (`_maintainTimer`,
  AxonaPeer.js) and `leave()`. Their bound is the kernel's own event rate on one
  neighbour; the bridge imposes no further per-connection egress bound, and
  says so.
- The mesh keepalive: `PING_INTERVAL_MS` (mesh.js) per channel, and one pong per
  received ping.
- Uplink `controlBare`: `BRIDGE_PING_INTERVAL_MS` (transport/web/index.js) for
  `ping`; `client-hello` once per socket; `peer-list-request` and
  `turn-refresh` on the kernel's own cooldowns.

Type membership alone authorises nothing.

## 7.2.6 (amended) Writes are send-call observations

Per point and per class, five counters:

| Counter | Incremented when |
|---|---|
| `attempts` | classified, before the gate |
| `invoked` | the physical send is about to be called |
| `returned` | the call returned without a synchronous throw |
| `threw` | the call threw synchronously |
| `asyncFailed` | the API reported a later failure (the `ws` send callback); the data channel has no such signal and reports none |

`returned` says the call did not throw. It does not say the frame was
enqueued, sent, or received. No counter here is delivery evidence.

`forwardedGeneric` is the sum of `genericTransit` INVOKED over the three write
points. A forbidden invocation is the enforcement failure whatever the send did
afterwards; a send that failed does not rescue it. The oracle reads
`forwardedGeneric == 0` and reads `genericTransitAttempts` beside it, so a
blocked attempt is evidence and the zero is measured at the invocation site,
where every other class's invocations are counted. The minute log carries
`genericTransitINVOKED` as its own key when it is ever non-zero.

O2 exercises each real path with a positive control and the violation oracle.
Point 1 and point 2 are exercised now (the unit and ingress fences drive real
`ws.send` calls and read the counters back through `/healthz`); point 3 needs
H0 and stays INCOMPLETE. A simulated increment is not a control and is used
only to show the counter is live.

## WP4 (rows amended)

| Row | What | Fence | State |
|---|---|---|---|
| U6 | one allowed and one forbidden case per class, the forbidden case with the SAME wire type and a wrong cause, transition or destination; invoked/returned/threw/asyncFailed | fence_air_gap_unit | done |
| P8 | the data-channel gate receives the caller's cause; the same frame with no cause is refused; a throwing send is invoked and threw, not returned | fence_air_gap_capability | done |
| I5/D | `returned ≤ invoked ≤ attempts` per class on a real bridge child; `threw` and `asyncFailed` zero in the run | fence_air_gap_ingress | done over point 1 |
| O2(3) | positive control and oracle through a real uplink's data channel | needs H0 | INCOMPLETE |

## Everything else

Every line of v0.8, v0.7, v0.6, v0.5, v0.4 and v0.3 not named above stands as
written.
