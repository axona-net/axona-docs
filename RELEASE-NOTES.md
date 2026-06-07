# Axona Release Notes

Changes shipped in the protocol kernel (`@axona/protocol`) and the apps that ride
on it, newest-first and keyed to the kernel version. The currently *deployed*
build is always visible in each app's version row and at the bridge's
`/healthz`.

---

## v2.29.0 — pub/sub replay backlog fix (2026-06-06)

Compatible minor on the 2.x epoch (`WIRE_VERSION`/`AUTH_PROTO` unchanged), so
2.29.0 interoperates with 2.28.0 and clears the bridge's `MIN_KERNEL 2.28.0`
floor. Surfaced on the SF testnet: two subscribers to the same topic got
*different* backlog on `since:'all'` — one received every prior publish, another
received none.

- **Root cause.** A node that is a K-closest **root axon** for a topic marks each
  publishId in the network-level `_seenPublishes` set when it relays the publish
  — *without* delivering to its own app (its app had not subscribed yet). When
  that app later subscribed, the backlog arriving as a `pubsub:replay-batch` was
  skipped by the same `_seenPublishes` gate, so the late subscriber saw nothing.
  Subscribers that were *not* roots for the topic had an empty `_seenPublishes`
  and got the full backlog — hence the non-determinism (per topic / K-closest
  membership).
- **Fix.** App delivery is now gated **only** by `_appDelivered` (exactly-once),
  never by `_seenPublishes`. `_onReplayBatch` always attempts app delivery and
  only re-caches / re-records on the first router-sight of a publishId. Matches
  the long-documented separation of the two sets and the self-replay path.
- **Regression test.** `smoke_pubsub_replay.js` gains a remote-replay-after-relay-
  as-root case (red before / green after); duplicate-batch idempotency preserved.
- **Versions.** kernel `2.28.0 → 2.29.0`; testnet/axona.net peer `3.25.0 → 3.26.0`;
  demo `1.15.0 → 1.16.0`. Bridge unchanged (its embedded peer does not subscribe
  to app topics).

---

## Pending production cutover — kernel 2.16.0 → 2.28.0 (2026-06)

The next deployment is a **flag-day**: the new build is hard-incompatible with the
live 2.16.0 network at two layers — pub/sub addressing (v2.18.0) and authentication
(v2.28.0) — so old and new nodes cannot interoperate. This is by design; see the
deploy sequence at the bottom.

**Deployed baseline:** kernel `2.16.0` · bridge `2.12.0` · axona.net peer `v3.24.0`.

### Bridgeless connection (headline capability — v2.17.0 → v2.22.0)

- **v2.17.0** — Peer-relayed WebRTC signaling: peers relay SDP/ICE for each other
  through the existing mesh, so two peers can find and connect to each other with
  **no bridge in the signaling path**. Capability-flagged.
- **v2.19.0** — Bridgeless connect fixed end-to-end: dead-peer eviction +
  routed-forward correctness.
- **v2.20.0** — Bridgeless connect **on by default**, auto-triggered on peer
  discovery; churn re-admit fix.
- **v2.21.0** — Terminally-closed channels heal instead of wedging; verified with a
  genuine multi-hop proof (no-common-neighbour pair, bridge killed).
- **v2.22.0** — Negotiation watchdog: a peer that never opens a channel can no
  longer wedge the slot forever.

### Wire-format breaks (flag-day relevant)

- **v2.18.0** — `msgId = hash(publisher + message)`; time/seq dropped from the id.
  **Breaks pub/sub interop with pre-2.18 nodes** (divergent content addresses).
- **v2.28.0** — **Network partition.** `AUTH_PROTO axona/4 → axona/5` and
  `WIRE_VERSION 1.0 → 2.0`. The auth epoch is folded into the signed connect-time
  transcript, so a pre-bump node and a post-bump node can never complete the
  mutual handshake — at the mesh layer or the bridge. The two networks are
  cryptographically isolated.

### Security & robustness hardening

- **v2.17.1** — Incoming-synapse reverse index capped to the synaptome budget.
- **v2.23.0** — `postHash` reconciled against the verified content hash at ingress;
  concurrent relay-negotiation cap (DoS backpressure); mesh-auth clears its
  `verifying` flag on every non-success exit (no bind wedge).
- **v2.26.0** — The 24 security drop-path logs (bad signature, stale/oversize
  publish, unauthorized retraction, …) now surface through `peer.onLog` instead of
  being silently discarded.
- **v2.27.0** — Three unbounded maps bounded (`_counters`, relay-reachability
  cache, triadic transit cache); the per-publisher replay watermark now survives
  cache pressure for active publishers (closes a replay-eviction window).

### Routing & code health

- **v2.24.0** — `MAX_HOPS 16 → 40`: closes the long-tail lookup gap (the real
  Axona-vs-NH-1 success difference under the connection cap).
- **v2.25.0** — Mesh connection-lifecycle consolidated: three redundant
  death-detectors and two duplicate teardown paths collapsed into one reaper + one
  retire with an authoritative state.
- **Testing** — New fault-injection harness (virtual clock + mock
  RTCPeerConnection) makes the connection-FSM failure paths deterministically
  testable; new regression smokes for the partition, drop-path logging, bounded
  state, mesh lifecycle, postHash, and the negotiation watchdog.

### Bridge — `2.12.0 → 2.13.0`

- Wire-major gate at `client-hello`: a peer that doesn't speak wire major 2 (every
  pre-flag-day node) is declined with a clear "upgrade" close before any frame is
  relayed. Flag-day floors raised (`MIN_KERNEL_VERSION 2.9 → 2.28`,
  `MIN_PEER_APP_VERSION 3.14 → 3.15`). Kernel re-vendor pinned to `v2.28.0`.

### Deploy sequence (flag-day)

1. **axona.net peer** → re-vendor kernel 2.28.0, bump to **3.15.0**, deploy. (The
   upgrade target must exist before the gate starts rejecting.)
2. **Bridge** → push, then `git pull && npm ci --omit=dev && systemctl restart`.
   Verify `/healthz` shows `kernelVersion 2.28.0` / `minKernelVersion 2.28.0`.
3. **dht-sim** → re-vendor 2.28.0, publish.

Old (pre-bridgeless) 2.16.0 nodes can't bootstrap once the gate is live and wind
down; the new network forms among 2.28.0 nodes.

---
