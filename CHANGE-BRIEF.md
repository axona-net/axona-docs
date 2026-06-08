# Axona change-brief — current system state (the doc-refresh source of truth)

The single reference every document + README is reconciled against in this
refresh. Facts here are verified against the code on the `testnet` line
(kernel **v2.32.0**). Keep docs consistent with this; update this first if the
system changes.

## Versions (testnet line)

| Component | Version | Notes |
|---|---|---|
| `@axona/protocol` (kernel) | **2.32.0** | tag `v2.32.0`; `testnet` branch |
| axona-bridge | **2.15.0** | embeds kernel 2.32.0 |
| axona-peer (the axona.net app) | **3.28.0** | on kernel 2.32.0 |
| minimal-pubsub-browser (demo) | **1.17.0** | served at demo-testnet |
| axona-relay | **0.7.1** | headless Node supernode (+ pub/sub CLI & MCP server) |
| **Production (still live, separate)** | kernel **2.16.0** / bridge 2.12.0 / peer 3.24.0 | untouched `axona/4` network |

## Network partition (the load-bearing change)

- `AUTH_PROTO` **axona/4 → axona/5**; `WIRE_VERSION` **1.0 → 2.0**. The epoch is
  folded into the value each side signs at connect time, so a cross-epoch
  handshake can't complete — at the mesh layer **or** the bridge. Production
  (`axona/4`) and the testnet (`axona/5`) are **cryptographically isolated**.
- Bridge gate at `client-hello`: `REQUIRED_WIRE_MAJOR=2`; `flagDayFloor()`
  classifies the version by major (≥3 → `MIN_PEER_APP_VERSION`, else
  `MIN_KERNEL_VERSION`); reject = WS close **4426**. Testnet floors:
  `MIN_KERNEL 2.28.0`, `MIN_PEER_APP 3.25.0`.

## Addressing & identity

- 264-bit nodeId = **8-bit S2 region prefix** ‖ 256-bit Ed25519-pubkey hash.
- S2: **192 valid region cells** (`face·32 + truncated-Hilbert`, codes [0,192);
  192–255 reserved). `geoCellId`, `geoCellCenter`, `geoCellSubCenters`,
  `geoCellHalf`.

## Region names (v2.32 — one name per region)

- Every region has exactly **one** name, so a region always presents the same
  label (no location-dependent flip-flop). Collapse rule: an ocean-half beside a
  land-half takes the land name; a multi-country cell takes its dominant city;
  homogeneous cells keep their name. A name is usually unique to one code, but an
  area larger than one cell may span adjacent codes (e.g. `centrlam`); `regionCode`
  returns the canonical (lowest) code.
- API: `REGION_NAMES[code]` is a **string**; `regionName(code)→string` (no
  lat/lng half-arg); `regionCode(name)`, `resolveRegion(name|code)`,
  `regionNameForLatLng(lat,lng)`. `regionNames(code)→[name]` is a deprecated
  one-element back-compat shim.
- Conventions: ≤8 chars `[a-z0-9_]`; open ocean = `<oce3>_<hex>` (pac_68, atl_0a,
  ind_22, sou_a3, arc_44); small islands **claim-once**; large landmasses span
  cells with a single-letter compass suffix; curated country/city names.

## Pub/sub

- Unified `peer.pub / sub / pull / metrics`; signed envelopes;
  `msgId = hash(publisher + message)` (v2.18 wire break); **region-keyed topics**
  via a synthetic region publisher (`${regionId}/${eventName}`).
- Phase-A lifecycle: `unsub`, `kill` (tombstones), `unpub`, bounded queue +
  per-publisher quota, hold-time TTL, `pull(topic)`→latest. C-2 envelope
  freshness (per-publisher seq + TTL + domain separation).
- **Replay backlog fix (2.29.0):** `_onReplayBatch` gates app delivery on
  `_appDelivered` (exactly-once), not the router-level `_seenPublishes` — a late
  subscriber that itself relayed a topic as a root axon now gets the full
  backlog on `since:'all'`.

## Transports & connectivity

- `Transport.web` (bridge WS + WebRTC mesh + authenticated hello + reconnect),
  `Transport.node` (WS), `Transport.sim`.
- **Bridgeless connection** (2.17–2.22): peers relay WebRTC signaling for each
  other through the mesh (`meshRelay`, on by default); terminally-closed
  channels self-heal; negotiation watchdog. Mesh auth = per-peer DTLS-fingerprint
  channel binding.

## Security hardening since 2.16

B-1 routed-subscribe origin check · B-2 self-proximity lazy-axon gate · B-3
eclipse (gossip→candidate pool, bounded reinforce, capped probes) · B-4 publisher
signature at K-closest ingress · C-1 RFC-8785-ish canonical JSON · C-2 freshness ·
D-1 inbound size/count caps · non-extractable signing key + privkey↔pubkey verify ·
observable security drop-logging via `onLog` (2.26) · bounded internal maps (2.27).

## Infrastructure

- **Production** (untouched, `axona/4`): `axona.net` (peer), `bridge.axona.net`,
  `turn.axona.net` — kernel 2.16.0.
- **SF testnet** (`axona/5`, DigitalOcean SFO3): `testnet.axona.net` (peer app +
  bridge at one origin), `demo-testnet.axona.net` (kernel demo at domain root),
  self-hosted **coturn** TURN minted by the bridge.
- **axona-relay** (new, public repo): headless Node supernode — real WebRTC via
  `node-datachannel`, console TUI, region auto-detect (IP-geo → timezone),
  ephemeral "additional" nodes. A subset of the bridge: routes, roots pub/sub,
  relays signaling; runs **no** public server, mints **no** TURN, no admission gate.
- **S2 region visualizer**: `axona-protocol/examples/s2-region-visualizer` — 3D
  globe, one name + code per cell.

## Repos (all have a `testnet` branch @ kernel 2.32.0)

axona-protocol · axona-peer · axona-bridge · dht-sim · axona-docs · **axona-relay** (new, public)
