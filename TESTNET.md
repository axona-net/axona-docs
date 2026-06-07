# Axona SF Testnet

A self-contained, isolated Axona network hosted on a single Digital Ocean
droplet in San Francisco. It runs the **2.28.0/2.29.0 release build** so the
full flag-day stack can be exercised end-to-end **without touching production**
(`axona.net` / `bridge.axona.net`, still on the older 2.16.0 network).

The testnet rides a different protocol epoch (`AUTH_PROTO axona/5`,
`WIRE_VERSION 2.0`). A production (`axona/4`) node and a testnet (`axona/5`) node
can never complete a handshake — at the mesh layer or the bridge — so the two
networks are **cryptographically isolated by construction**.

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

| | Production (live) | SF Testnet |
|---|---|---|
| Bridge host | `bridge.axona.net` | `testnet.axona.net` |
| Bridge build | bridge `2.12.0` / kernel `2.16.0` | bridge `2.13.0` / kernel `2.28.0` |
| Peer app | `axona.net` · peer `v3.24.0` | `testnet.axona.net` · peer `v3.26.0` / kernel `v2.29.0` |
| Demo | — | `demo-testnet.axona.net` · demo `v1.16.0` / kernel `v2.29.0` |
| Auth epoch / wire | `axona/4` · wire `1.0` | `axona/5` · wire `2.0` |
| TURN | production relay | self-hosted coturn on the SF droplet |

Bridge admission floors (testnet): `REQUIRED_WIRE_MAJOR 2`,
`MIN_KERNEL_VERSION 2.28.0`, `MIN_PEER_APP_VERSION 3.25.0`. A client below any
floor is declined at `client-hello` (WS close `4426`) with an "upgrade" reason.

> Kernel `2.29.0` is a **compatible minor** of `2.28.0` (`WIRE_VERSION` /
> `AUTH_PROTO` unchanged): 2.29.0 clients interoperate with the 2.28.0 bridge and
> clear its `MIN_KERNEL 2.28.0` floor.

---

## How to run it

1. Open **either** app URL above.
2. The version row / footer should show the testnet build (e.g. demo footer
   `demo v1.16.0 · kernel v2.29.0`) and status **connected**.
3. To see cross-app pub/sub, point both the Peer and the Demo at the **same
   region + topic**. The demo is hardwired to region **US East (Virginia)**,
   topic **`hello-world`** — so in the Peer app, add a subscription with region
   *US East (Virginia)* and topic `hello-world`. Publishes then flow both ways.

Notes on delivery semantics:

- **Live delivery** after you subscribe is reliable.
- **Backlog replay** (`since:'all'`, the default in the Peer app) returns what the
  topic's current K-closest holders have cached. As of kernel **v2.29.0** a late
  subscriber receives the full backlog **even if it was itself a relay
  (root axon) for that topic** — the earlier bug where such a subscriber received
  *no* backlog is fixed.
- The topic ID is derived identically in both apps from a synthetic
  region-anchored publisher, so `us-east/hello-world` resolves to the same topic
  in the Peer and the Demo (anchor `0x89` = Virginia).

---

## Security & bug fixes on the testnet (vs. production 2.16.0)

Short list; full detail in [`RELEASE-NOTES.md`](RELEASE-NOTES.md) and
[`SECURITY-CHANGELOG.md`](SECURITY-CHANGELOG.md).

- **v2.28.0 (security)** — Network isolation by construction; the protocol epoch
  is folded into the signed connect-time transcript (a forged epoch tag still
  fails the signature).
- **v2.28.0 (security)** — Per-publisher replay-freshness watermarks survive cache
  pressure for active publishers.
- **v2.27.0 (robustness)** — Three unbounded maps bounded (`_counters`,
  relay-reachability, triadic-transit caches).
- **v2.26.0 (security)** — 24 security drop-paths (bad signature, stale/oversized
  publish, unauthorized retraction…) now observable via `peer.onLog`.
- **v2.23.0 (security)** — `postHash` reconciled against the verified content hash
  at ingress; relay-negotiation rate cap (DoS backpressure); mesh-auth no longer
  wedges on a failed bind.
- **v2.17.1 (robustness)** — Incoming-synapse index capped to the synaptome budget.
- **v2.29.0 (bug)** — Pub/sub replay backlog delivered to late subscribers that
  had relayed the topic as a root axon (app delivery gated on `_appDelivered`, not
  the router-level `_seenPublishes`).

Headline capability now exercisable on the testnet: **bridgeless connection**
(v2.17–v2.22) — peers relay WebRTC signaling for each other through the mesh, so
two peers can connect with no bridge in the signaling path.

---

## Operating the droplet

Setup, TURN, certbot, and the live-bring-up corrections are documented in the
`axona-bridge` repo: `deploy/testnet-setup.md`, with the nginx vhosts
`deploy/nginx-testnet-app.conf` (peer app) and `deploy/nginx-testnet-demo.conf`
(demo).

Updating a deployed app (static; no service restart — just hard-reload the
browser afterward):

```bash
# peer app
ssh root@<sf-droplet> 'cd /var/www/axona-peer-testnet  && git pull --ff-only'
# demo (serves the kernel repo at the domain root)
ssh root@<sf-droplet> 'cd /var/www/axona-demo-testnet && git pull --ff-only'
```

The bridge service itself updates via
`cd /opt/axona-bridge && git pull && npm ci --omit=dev && systemctl restart axona-bridge`.
