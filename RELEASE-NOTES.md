# Axona Release Notes

Changes shipped in the protocol kernel (`@axona/protocol`) and the apps that ride
on it, newest-first and keyed to the kernel version. The currently *deployed*
build is always visible in each app's version row and at the bridge's
`/healthz`.

---

## v2.40.1 — a malformed frame can't crash a node (2026-06-12)

Patch over 2.40.0; no wire change. Reported by a host-node operator quitting many
nodes at once: a peer tearing down mid-shutdown delivered a **truncated `fromId`**
(3 chars), and the anti-entropy handler (`_onMsgSync`) parsed it with a throwing
`fromHex` — `RangeError: hex id must be 66 chars, got 3`. Because the handler is
`async`, that synchronous throw became a *rejected promise* the direct-dispatch
`try/catch` couldn't see, escalating to a Node `unhandledRejection` (process
death).

- **Handler hardening.** `_onMsgSync` / `_onMsgSyncResp` / `_onKillSync` now parse
  ids from received frames with a tolerant helper that **drops a malformed frame**
  instead of throwing.
- **Dispatch boundary.** The `AxonaPeer` direct-handler dispatch now catches an
  async handler's *rejection* (not just a synchronous throw), mirroring the routed
  path — so **no** direct handler can leak an `unhandledRejection`, defending the
  whole class, not just this one field.
- **Regression test.** `smoke_msgsync_robustness.js`: malformed `topicId`/`fromId`
  frames are dropped (well-formed ones still answered), and a throwing async
  handler produces no `unhandledRejection`.

## v2.40.0 — decoupled `host()` primitive: serve topics without subscribing (2026-06-12)

Wire-additive over 2.39.0, and uses **no new wire message**: a host announces with
the same `pubsub:subscribe-k` a subscriber already sends, so every existing kernel
recruits a host with no flag day (`WIRE_VERSION` unchanged at `2.0`).

- **`peer.host(topic)` / `peer.host()` / `peer.unhost(...)`.** Infrastructure
  nodes (relays) can now **store + serve** a topic for other peers *without*
  subscribing as a consumer. `host(topic)` serves one named topic; `host()` (no
  argument) volunteers the node for its **own keyspace neighborhood** — recruited
  as a root for whatever topics land near its id ("host whatever lands near me").
  A host registers no delivery handler and is never added to `mySubscriptions`;
  `health().hosting` surfaces the state.
- **Why it was needed.** A node only enters a topic's serving fabric once it's
  *discoverable* there, and the only action that announced a node used to be
  `sub()` — so a relay that meshed but never subscribed showed zero pub/sub roles
  forever. `host()` supplies the announcement without the consumer semantics. It
  respects the B-2 proximity gate: a host only ever roots topics it is genuinely
  K-closest to.
- **Relay v0.10.0.** Defaults to keyspace hosting (`RELAY_HOST_KEYSPACE=1`), so a
  relay participates with **zero topic config**; `RELAY_TOPICS` now *hosts* named
  topics instead of issuing no-op subscribes. Verified live: a fresh relay climbs
  to `roles=174, subs=0` within seconds.
- **Versions.** kernel `2.39.0 → 2.40.0`; bridge `2.20.0 → 2.21.0`; peer
  `3.31.0 → 3.32.0` (app `v0.40.0`); relay `0.9.3 → 0.10.0`; PoW benchmark
  `v0.16.0 → 0.17.0`; Axona-share `v0.7.0 → 0.8.0`.

## v2.39.0 — root-to-root pub/sub anti-entropy (2026-06-12)

Wire-additive (new `pubsub:msgsync` / `msgsync-resp` direct messages; no envelope
or identity change). A publish only reaches the *publisher's* K-closest root set,
which need not be a *subscriber's* — so a subscriber attached to a different root
could miss it. Roots now exchange digests of held content-ids with their K-closest
siblings and pull what they're missing. **Pulled messages are re-verified** — the
publisher signature (B-4) and the content-address are re-checked exactly as on
live ingress, so a sibling root cannot inject a forged or content-poisoned
message, and tombstoned (killed) messages are never resurrected. Closes the
residual divergence left after 2.37.0's subscriber-side fix.

## v2.38.0 — Ed25519 software fallback: old browsers can join (2026-06-12)

Older browsers without native WebCrypto Ed25519 (older Chrome, Samsung Internet,
many WebViews) previously couldn't derive an identity at all — `generateKey` threw
and the peer never connected. A vendored pure-JS Ed25519 fallback (`@noble/ed25519`
v2.3.0, over the universal `crypto.subtle.digest('SHA-512')`) lets them mint an
identity and join. Native devices are unchanged and keep the **non-extractable**
signing key (finding H4); the software key lives in JS memory and is therefore
extractable, so the H4 hardening is a native-only property — used only where the
alternative is "cannot connect." Signatures interoperate both ways (same RFC 8032
curve).

## v2.37.0 — gap-safe replay: no more silently-lost messages (2026-06-12)

Replay-on-(re)subscribe was filtered by a single high-water timestamp, which can't
represent a *hole*: once you'd received anything newer than a gap, that gap was
masked forever. Subscribers now report the content-ids they actually hold (a
bounded `have` digest in the subscribe payload) and a root replays exactly the
complement — a missed message is backfilled rather than lost. Wire-additive.

## v2.36.0 — kill convergence: a retraction survives reloads (2026-06-11)

Wire-additive (adds the `pubsub:kill-sync` direct message). A killed message
stayed killed only on the roots that saw the kill; a replica that missed it could
re-serve the message to a reloading subscriber — the reported "I killed it and it
came back" bug. Recently-applied kills are now re-gossiped to the current root
set, so a replica that missed the original kill removes and tombstones the
message.

## v2.32.0 — one name per region + production flag-day cutover (2026-06-08)

**Production cutover.** `axona.net` / `bridge.axona.net` migrated from the
`axona/4` / kernel-2.16 network to this `axona/5` line (bridge `2.15.0`, peer
`3.28.0`). It's a hard partition: pre-2.28 `axona/4` peers are refused at the
gate (WS close `4426`) and reload into the new line. The earlier `axona/4`
network is retired; the SF testnet (`testnet.axona.net`) now runs as the
**staging line ahead of `main`** rather than a separate epoch.

**One name per region.** Each of the 192 S2 region cells now carries exactly
**one** canonical name (previously two, one per sub-cell), so a region always
presents the same label — no location-dependent flip-flop. The collapse rule:
an ocean-half beside a land-half takes the land name; a multi-country cell takes
its dominant city; homogeneous cells keep their name. `regionName(code)` now
returns a string (no lat/lng half-arg); `regionNames(code)` is a deprecated
one-element back-compat shim. A name is usually unique to one code, but an area
larger than one cell may span adjacent codes — `regionCode` returns the
canonical (lowest) code. (Supersedes the 2.31.0 two-name scheme.)

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
