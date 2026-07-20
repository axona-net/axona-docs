# Team Update — kernel v4.16.0 on testnet (2026-07-02)

The 4.12–4.16 line is live on testnet (bridge v2.55.0, relay fleet v0.40.0,
peer v3.43.0 — all report kernel 4.16.0). Wire stays 4.0: no flag day, apps
keep working unchanged.

## What's new for app developers

- **`connect()` — one call to a live peer.**
  ```js
  import { connect } from '@axona/protocol/connect.js';
  const { peer, author } = await connect({
    bridge: 'wss://testnet.axona.net', location: { lat: 38, lng: -77 } });
  ```
  Identities, transport, peer, start, and mesh warm-up in one await; the
  primitives remain public for custom wiring. `disconnect()` tears down.
- **Metrics are demand-driven.** Snapshots publish to `metricTopic(T)` only
  while someone is subscribed (a renewable lease at whatever node is root —
  relay or browser alike). `peer.metrics()` is unchanged; the relay's old
  timer loop is retired.
- **`NeuronNode` accepts hex ids** (v4.14.0): the `BigInt('0x'+id)` cast in
  manual assembly is no longer required.

## Under the hood

- **Region-occupancy rule, staged** (v4.13.0/v4.15.0): topic service can be
  restricted to the topic's own region — implemented, shipped OFF until the
  network has regional coverage; one `configureRegionLock` call flips it.
- **BigInt id invariant** (v4.14.0): every wire-ingress id passes one
  validated gate; malformed ids reject at the boundary.

## Docs

The developer doc set is re-versioned to 4.16.0 (docs now always carry the
testnet kernel version) and rebuilt around app programmers: a recipe-first
Programmer Guide, a fenced API Reference, and a new **AI Grounding** file
(`Axona-AI-Grounding-v4.16.0.md`) to paste into AI assistants building on
Axona. Quick Start now starts with `connect()`.

## Verification

Live soak on 4.16.0: scale scenario 100% delivery (initial + healed),
churn/gap passing at baseline; no regressions vs the 4.11.2 window. The
soak's kill scenario remains red as it was before the deploy — pre-existing,
under separate investigation.
