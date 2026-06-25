# Axona Message Convention — `std/message` (v0.1)

**Status:** standard. Every application built on the Axona protocol API publishes
and renders pub/sub message bodies through `@axona/protocol/std/message`. Shipped
in kernel **v4.2.0**.

## Why a convention

`peer.pub(topic, body, { signWith })` accepts **any** JSON-serialisable `body`, and
`peer.sub(topic, env => …)` hands it back verbatim as `env.message`. That is the
right amount of freedom for the kernel — and the wrong amount for **interop**. If
each app invents its own body shape, one app renders another's message as
`[object Object]`, or crashes string-parsing an object it didn't expect.

This is not hypothetical: on testnet, `axona-minimal` published an object
`{ text, node }`, the demo published a string `"Name: Body"`, and `axona-peer`
rendered the raw object — so messages crossed the mesh fine but displayed as
`[object Object]` (peer) or not at all (demo). One shared convention fixes it.

## The convention

**Publish** with `makeMessage`; **render** with `readMessage`; label the sender
with `readSender`.

```js
import { makeMessage, readMessage, readSender } from '@axona/protocol/std/message';

// publish
await peer.pub(topic, makeMessage('hello, world', { /* optional app extras */ }),
               { signWith: author });

// render
peer.sub(topic, (env) => {
  const text   = readMessage(env.message);   // always a string, never "[object Object]"
  const sender = readSender(env);            // authenticated short id (or a body hint)
  show(sender, text);
});
```

### Canonical body shape

```
{ v: 1, text: <string>, ...appExtras }
```

- **`text`** — the human-readable body; the one field every app displays.
- **`v`** — format marker for forward-compatibility.
- **app extras** — any app-specific fields (e.g. `node` for a region hint, `name`
  for a chosen display name). Other apps ignore fields they don't know.
- The **sender is not in the body** — it is the envelope's authenticated
  `signerPubkey` (`readSender(env)`). Don't encode identity into `text`.

### `readMessage` is tolerant (Postel's law)

It accepts the canonical object, a bare string, a `{ message }` object, or any
other object (shown as JSON) — so legacy publishers and third-party apps still
display, never as `[object Object]`. New code should still **publish**
`makeMessage(...)`; tolerance is for reading what others sent.

## API

| Function | Purpose |
|---|---|
| `makeMessage(text, extra = {})` | Build the canonical body `{ v, text, ...extra }`. |
| `readMessage(body)` | Extract display text from any received `env.message`. Always returns a string. |
| `readSender(env, len = 8)` | Short sender label: authenticated `signerPubkey`, else a body `node`/`from` hint, else `(unknown)`. |
| `MESSAGE_FORMAT` | Current body format version (`1`). |

## Scope — two complementary `std` conventions

An app picks the `std` convention that matches its **payload**, and uses it the same
way every other app does:

| Payload | Convention | Helpers |
|---|---|---|
| Human-readable **text** messages | **`std/message`** | `makeMessage` / `readMessage` / `readSender` |
| **Binary / large** data (files, images, streams) | **`std/chunk`** | `publishChunkedBytes` / `createReassembler` |

`std/chunk` is the binary sibling of `std/message`: it frames a payload as a stream of
self-describing **object** chunk-messages on a `{ region, name }` topic, signed by the
publishing author — the same envelope model, just a different body. `axona-share` is
the reference exemplar — it transfers images via `std/chunk` directly off the raw
`peer` + `author` + topic descriptor (no per-app JSON-string wrapper). A text app and
a chunk app therefore never need to parse each other's bodies; they live on different
topics by construction.

What is **not** allowed in either case: a per-app hand-rolled body shape
(`name + ': ' + msg`, ad-hoc `JSON.stringify`, `textContent = env.message`). That is
exactly what produced the `[object Object]` interop break above.

## Reference exemplars (all use this convention)

- `axona-protocol/apps/axona-minimal`
- `axona-protocol/examples/minimal-pubsub-browser` (the demo)
- `axona-protocol/examples/minimal-pubsub` (node roundtrip)
- `axona-peer/src/client.js`

Pinned by `axona-protocol/test/smoke_std_message.mjs` in the kernel test suite.
