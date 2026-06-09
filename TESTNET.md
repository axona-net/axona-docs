# Axona SF Testnet

A self-contained Axona deployment on a single Digital Ocean droplet in San
Francisco. Since the **2026-06-08 flag-day cutover** it runs the *same*
`axona/5` line as production — it is now the **staging environment**: the place
the next release is exercised end-to-end (real WebRTC, real TURN, real bridge)
before it is promoted to `main` and rolled to `axona.net` / `bridge.axona.net`.

It tracks the **`testnet` branch** of every repo, so it can run **ahead** of
production (`main`). Right now both lines sit at the same tip
(kernel `2.32.0` / bridge `2.15.0` / peer `3.28.0`); the testnet moves first
when new work lands.

**Isolation.** The testnet is a separate deployment — its own bridge, its own
persistent identity, its own TURN secret — bootstrapped from its own endpoint,
so its mesh is distinct from production's even though both speak `axona/5`. When
a future **epoch-breaking** change is staged here (a new `AUTH_PROTO` /
`WIRE_VERSION`), the testnet again becomes *cryptographically* isolated from
production for the duration of that flag-day rehearsal — exactly as it was
during the `axona/4 → axona/5` cutover.

---

## Live URLs

| What | URL | Notes |
|---|---|---|
| **Axona Peer** (app) | <https://testnet.axona.net> | Full peer UI; auto-uses the testnet bridge + TURN |
| **Axona Demo** (pub/sub) | <https://demo-testnet.axona.net/examples/minimal-pubsub-browser/> | Minimal publish/subscribe demo; auto-uses the testnet bridge + TURN |
| **Bridge health** | <https://testnet.axona.net/healthz> | JSON: kernel/bridge versions + admission floors |

Both apps **host-detect** the bridge: served from a `*testnet*` hostname, they
default to `wss://testnet.axona.net` (and receive testnet TURN credentials in the
`welcome`). No query string is required. To force a specific bridge from any
origin, append `?bridge=wss://testnet.axona.net`.

---

## Version matrix

| | Production (`main`) | SF Testnet (`testnet` branch) |
|---|---|---|
| Bridge host | `bridge.axona.net` | `testnet.axona.net` |
| Bridge build | bridge `2.15.0` / kernel `2.32.0` | bridge `2.15.0` / kernel `2.32.0` |
| Peer app | `axona.net` · peer `v3.28.0` | `testnet.axona.net` · peer `v3.28.0` |
| Demo | `demo.axona.net` · kernel `v2.32.0` | `demo-testnet.axona.net` · kernel `v2.32.0` |
| Auth epoch / wire | `axona/5` · wire `2.0` | `axona/5` · wire `2.0` |
| TURN | production relay (`turn.axona.net`) | self-hosted coturn on the SF droplet |
| Node geo | us-east (38.00, −77.00) | us-west `testnet-sf` (37.77, −122.42) |

Both lines are at the same tip today; the testnet is where the **next** version
appears first. Bridge admission floors (both deployments): `REQUIRED_WIRE_MAJOR
2`, `MIN_KERNEL_VERSION 2.28.0`, `MIN_PEER_APP_VERSION 3.25.0`. A client below any
floor is declined at `client-hello` (WS close `4426`) with an "upgrade" reason.

> The `MIN_KERNEL 2.28.0` floor is the partition floor — every `axona/5` build
> from 2.28.0 onward (including the current 2.32.0) clears it, so kernel minors
> interoperate; only pre-partition `axona/4` peers are refused.

---

## How to run it

1. Open **either** app URL above.
2. The version row / footer should show the build (e.g. `kernel v2.32.0`) and
   status **connected**.
3. To see cross-app pub/sub, point both the Peer and the Demo at the **same
   region + topic**. The demo is hardwired to region **US East (Virginia)**,
   topic **`hello-world`** — so in the Peer app, add a subscription with region
   *US East (Virginia)* and topic `hello-world`. Publishes then flow both ways.

Notes on delivery semantics:

- **Live delivery** after you subscribe is reliable.
- **Backlog replay** (`since:'all'`, the default in the Peer app) returns what the
  topic's current K-closest holders have cached. A late subscriber receives the
  full backlog **even if it was itself a relay (root axon)** for that topic.
- The topic ID is derived identically in both apps from a synthetic
  region-anchored publisher, so `us-east/hello-world` resolves to the same topic
  in the Peer and the Demo (region code `0x89` = `useast`).

---

## Security & robustness on this line

The `axona/5` / kernel-2.32.0 line — now live in **production and testnet** —
carries the full hardening set accumulated since the 2.16.0 network. Short list;
full detail in [`RELEASE-NOTES.md`](RELEASE-NOTES.md) and
[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md).

- **v2.28.0** — Network partition by construction; the protocol epoch is folded
  into the signed connect-time transcript (a forged epoch tag still fails the
  signature). Per-publisher replay-freshness watermarks survive cache pressure.
- **v2.27.0** — Unbounded internal maps bounded (`_counters`, relay-reachability,
  triadic-transit caches).
- **v2.26.0** — 24 security drop-paths (bad signature, stale/oversized publish,
  unauthorized retraction…) observable via `peer.onLog`.
- **v2.23.0** — `postHash` reconciled against the verified content hash at ingress;
  relay-negotiation rate cap; mesh-auth no longer wedges on a failed bind.
- **v2.29.0** — Pub/sub replay backlog delivered to late subscribers that had
  relayed the topic as a root axon (delivery gated on `_appDelivered`).
- **v2.32.0** — One canonical name per region (no location-dependent flip-flop).

Headline capability on this line: **bridgeless connection** (v2.17–v2.22) — peers
relay WebRTC signaling for each other through the mesh, so two peers can connect
with no bridge in the signaling path.

---

## Operating the droplet

Setup, TURN, certbot, and the live-bring-up corrections are documented in the
`axona-bridge` repo: `deploy/testnet-setup.md`, with the nginx vhosts
`deploy/nginx-testnet-app.conf` (peer app) and `deploy/nginx-testnet-demo.conf`
(demo). The droplet's three checkouts all track the **`testnet` branch**.

Updating the static apps (no service restart — just hard-reload the browser):

```bash
# peer app (axona-peer)
ssh root@<sf-droplet> 'cd /var/www/axona-peer-testnet  && git pull --ff-only'
# demo (axona-protocol — served at the demo domain root)
ssh root@<sf-droplet> 'cd /var/www/axona-demo-testnet && git pull --ff-only'
```

Updating the bridge service (`/opt/axona-bridge`, owned by the `axona` user):

```bash
ssh root@<sf-droplet> '
  cd /opt/axona-bridge
  sudo -H -u axona git pull --ff-only
  sudo -H -u axona npm ci --omit=dev
  systemctl restart axona-bridge'
```

A bridge restart is a rolling restart, not a partition: peers already on the
`axona/5` epoch reconnect immediately and clear the unchanged `MIN_KERNEL 2.28.0`
floor.
