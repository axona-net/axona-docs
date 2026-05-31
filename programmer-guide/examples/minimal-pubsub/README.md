# minimal-pubsub — Axona hello-world in one Node script

The smallest end-to-end Axona pub/sub demo: two peers in the same Node
process, connected by an in-process `SimNetwork`. One peer publishes,
the other subscribes, and you see the envelope arrive.

This is the right starting point for understanding the API. Once you've
read this and the [programmer guide](../../Axona-Programmer-Guide-v2.8.2.md),
graduate to:

- **[axona-peer/](https://github.com/axona-net/axona-peer)** — the
  reference browser peer, ~1500 lines of JavaScript wiring `AxonaPeer`
  to a `CompositeTransport` (WebRTC mesh + WebSocket bridge fallback)
  with full identity persistence, region pickers, and a UI. The
  canonical "real wiring" example.
- **[axona-bridge/](https://github.com/axona-net/axona-bridge)** — a
  Node bridge service, ~700 lines wiring `AxonaPeer` to a
  `WebSocketTransport`.

## Run it

```bash
npm install
node index.js
```

Expected output:

```
[alice] nodeId: 510ee0fc7d4c4f3f…
[bob]   nodeId: 357b41e0f7831e92…
[alice] published msgId=8e9d…
[bob]   received: { message: 'hello from alice', signerPubkey: '4b…' }
```

## What's happening

```
              ┌────────────┐         ┌────────────┐
              │   alice    │         │    bob     │
              │ AxonaPeer  │         │ AxonaPeer  │
              └─────┬──────┘         └─────┬──────┘
                    │                      │
              ┌─────┴──────┐         ┌─────┴──────┐
              │SimTransport│←───────→│SimTransport│
              └─────┬──────┘         └─────┬──────┘
                    │                      │
                    └──────  SimNetwork ───┘
```

`SimNetwork` is an in-process router that delivers frames between
`SimTransport` instances. It satisfies the same `Transport` contract
that `WebRTCTransport` and `WebSocketTransport` do, so anything you
build against it will port to real transports unchanged.

## Files

| File | What it is |
|---|---|
| `package.json` | Pin to `@axona/protocol` v1.1.3. |
| `index.js` | Full demo — two peers, pub/sub roundtrip, ~150 lines (with comments). |
