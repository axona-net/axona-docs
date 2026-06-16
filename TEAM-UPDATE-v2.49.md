# Team Update — Axona kernel v2.49.0: identity model, `std` library, reliable chunking

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** shipped to the **testnet** fleet (kernel 2.49.0). Prod is staged but gated.
**TL;DR:** Transport identities are now **ephemeral everywhere**, a publish is identified by an **app-owned Publish ID** (not the node id), large payloads must go through the new **`@axona/protocol/std`** chunking helper (single publishes are hard-capped at a *receivable* 15 KB), and `std` also gives you a small **persistence** helper for publish streams.

---

## 1. Why this matters in one paragraph

We separated **who you are on the wire** (a throwaway, per-session transport identity) from **what your application publishes** (a stable, app-owned dedup token). That split lets every node — browser, relay, bridge — rotate its network identity freely (a privacy + resilience win) **without** breaking exactly-once delivery or a logical message stream. At the same time we made large-payload delivery honest: instead of silently dropping anything the weakest hop can't carry, the kernel now **fails loud** above the universally-receivable message size and ships a tested `std` helper to split, send, and reassemble big content correctly.

---

## 2. The three IDs (this is the core mental model)

Axona now has **three distinct identifiers**. Keeping them straight is the whole update.

| ID | Width / shape | Lifetime | Who sets it | Encodes location? |
|----|---------------|----------|-------------|-------------------|
| **Transport ID** (node id) | 264-bit = `[8-bit S2 region prefix ‖ SHA-256(pubkey)]` | **Ephemeral** — re-minted every process start, never persisted | kernel, from a fresh keypair | **Yes** (S2 region prefix) — so it never goes in the envelope |
| **Topic ID** | 264-bit, S2-prefixed (derived from `publisher` + topic name) | Stable for the topic | derived deterministically by everyone | Yes (region of the topic anchor) |
| **Publish ID** | opaque string, **no** S2 prefix | App-controlled; may be persisted across restarts | **the app** (or the kernel mints a random one) | **No** |

### What the keys do

- Each node holds an **Ed25519 keypair**, minted per session via `deriveIdentity({lat,lng})`. The browser/relay derive it **non-extractable** (`extractable:false`) — the private key signs but can never be exported.
- A published message carries a **signed envelope**. The signature proves **WHO** signed it (`signerPubkey`) — a stable pseudonymous author — **never WHERE** they are. The node id's S2 region prefix is *not* in the envelope, and the region can't be recovered from the key. **Publisher location stays out of the protocol.** (Apps that *want* to share a sender's region do it explicitly in the payload — that's an app choice, not a protocol leak.)
- The **Topic ID** is region-anchored on purpose (geographic routing locality), derived from a `publisher` value + the topic string, so every participant computes the same id regardless of where they sit.

### The rule to remember

> **Never store the transport/node id. Compute a fresh one on every start.**
> If you need continuity across restarts, persist the **Publish ID** instead — that's what it's for.

---

## 3. What changes for application code

### 3.1 Publishing — Publish IDs are now yours to own

`peer.pub(topic, message, opts)` still works as before, but the dedup/exactly-once token (`publishId`) is now a first-class, **optional** option:

```js
// Before: the publish id was implicitly tied to the (then-stable) node id.
await peer.pub(topic, msg, { publisher });

// Now: the kernel mints a random, S2-free publishId if you don't pass one…
await peer.pub(topic, msg, { publisher });                 // fine for fire-and-forget

// …or you supply one to keep a logical stream continuous across restarts:
await peer.pub(topic, msg, { publisher, publishId: pub.next() });
```

Why we changed it: the old publish id was derived from the node id + a counter that **reset to 0 on restart**. With ephemeral transport ids (below), a restarted node could reuse an old `nodeId:counter` and have its *new* publishes silently deduped as already-seen. Decoupling the Publish ID (random token, or app-persisted) removes that collision class.

### 3.2 Ephemeral transport identity — don't persist the node id

Every node (now including **relays and bridges**, not just browsers) mints a fresh keypair + node id on each start and writes nothing to disk. Practically:

- Remove any code that saves/loads a node identity file.
- Don't key application state on the node id — it changes every run.
- Discovery & reputation key on the node's **URL** (for infra) or the **Publish ID / signer** (for app streams), not on the transport id.

### 3.3 Large messages — single publishes are capped at a *receivable* size

`peer.pub` now **throws** `PublishError(PUBLISH_PAYLOAD_TOO_LARGE)` when a single message serializes larger than the reliable-publish floor:

- `MAX_RELIABLE_PUBLISH_BYTES = 15 KiB` — the default ceiling for one publish.
- `MAX_PUBLISH_BYTES = 256 KiB` — an absolute hard cap.

**Why 15 KB and not "as big as it'll go"?** A pub/sub message is only reliably deliverable if **every hop and every receiving browser** can carry it. WebRTC's SCTP `maxMessageSize` has an interoperable floor of **16 KiB**; some Node WebRTC stacks drop messages ≥ 64 KB, and a message larger than the *weakest* hop on the path is **silently dropped** — it looks like it sent, but some subscribers never get it. So the limit isn't about the sender, it's about **universal receivability**. 15 KB leaves headroom for the signed envelope so the enveloped frame stays under 16 KiB. Anything bigger must be chunked (next section).

This is a *fail-loud* change: code that used to "work" by luck (small images) but silently truncate on bigger ones now gets a clear error pointing at `std/chunk`.

---

## 4. The new standard library — `@axona/protocol/std`

`std` is Axona's standard library of **app-layer helpers**, built only on the public `AxonaPeer` API (no kernel internals) and shipped in the package so everyone shares one tested implementation. Think C's `stdio`/`stdlib`: common, optional, sits beside the core.

```js
import { chunkBytes, createReassembler,
         publishChunkedBytes, receiveChunkedBytes,
         createPublisher, persistentPublisher } from '@axona/protocol/std';
// or per-module:  '@axona/protocol/std/chunk'  /  '@axona/protocol/std/publisher'
```

### 4.1 `std/chunk` — reliable large-payload transfer

Turns a byte array too big for one publish into a set of self-describing messages and reassembles them byte-exactly, tolerating reordering, duplicates, and late/replay joiners. Each chunk is sized so the **enveloped** message stays under the 15 KB reliable floor.

**Low-level (you drive pub/sub):**

```js
// sender
const { messages, fileId, n } = chunkBytes(bytes, { name: 'photo.jpg', mime: 'image/jpeg', meta });
for (const m of messages) await peer.pub(topic, m, { publisher });   // manifest first, then chunks

// receiver — ONE reassembler can handle a whole STREAM of files on a topic
const r = createReassembler(
  (file) => show(file.bytes, file.mime, file.meta),     // fires once per completed file
  { onProgress: (p) => console.log(`${p.have}/${p.total}`) },
);
await peer.sub(topic, (env) => r.accept(env.message), { publisher, since: 'all' });
```

**High-level (helper drives pub/sub for you):**

```js
const { topic } = await publishChunkedBytes(peer, bytes, { name, mime, meta });
const file      = await receiveChunkedBytes(peer, topic, { timeoutMs: 30000 });  // resolves or REJECTS
```

Properties worth knowing (each is a fix for a real failure we hit):

- **Completion = every distinct index present**, not a count of messages received (a duplicate can't fire "done" over a hole).
- **No silent hang:** `receiveChunkedBytes` rejects on timeout (after a best-effort `pull()` of missing chunks) and names the missing indices — never awaits forever.
- **Multi-file (new in 2.49.0):** a single reassembler tracks every file it sees by `fileId` and fires `onComplete` **once per file**. *This is the bug that made a channel only ever show its first image* — one reassembler per topic now correctly handles a stream of files.
- **Garbage-isolated:** foreign/malformed messages can't corrupt the file you're collecting.
- **Reload-safe ceiling:** `publishChunkedBytes` refuses a transfer larger than the topic's replay cache can hold, so you never create a transfer a reload-joiner can't reassemble.

### 4.2 `std/publisher` — persist a logical publish stream

The Publish ID is the dedup token; `std/publisher` is how an app **owns and persists** it so a stream stays continuous across reloads / a rotated transport id / multiple devices.

```js
import { persistentPublisher } from '@axona/protocol/std';

const pub = persistentPublisher('sightings');     // restores {id, seq} from localStorage, or mints fresh
await peer.pub(topic, msg, { publishId: pub.next() });   // '<base>:<n>', advances + persists each call
```

- `createPublisher({ id?, seq?, store?, key? })` — ephemeral by default; pass a `{get,set}` store to persist (the sequence is written on every `next()`, so it never reuses a value after a restart).
- `persistentPublisher(key, { store? })` — browser-`localStorage`-backed by default; use a distinct `key` per logical stream (one per channel / file transfer / sender) to run several at once.
- `defaultStore()` — the localStorage `{get,set}` adapter (or `null` when unavailable, e.g. a sandboxed iframe).

A future `std/image` (downsampling/compression) will land here as a sibling module.

---

## 5. What changed under the hood (ops / infra)

You don't call these, but they explain behavior:

- **Byte-bounded replay & cache.** The per-topic replay cache is bounded by **count (1024) and bytes (16 MiB)**, and replay/anti-entropy responses are framed to a fixed byte ceiling — a history request or a big publisher can't blow up a serving node's memory or a single frame.
- **Cold-start drain.** A freshly-joined node runs an anti-entropy pass to re-warm its replay caches, so it can serve history shortly after joining.
- **Hosting (`peer.host(topic)`).** Infra nodes (relays) **host** the keyspace — they store + serve topics without being a subscriber — so messages persist for late joiners even when no end-user is online. A network with *no* hosting node (e.g. a bare bridge) can deliver live but won't reliably serve a lone publisher or a reload.
- **Ephemeral bridges/relays + URL-keyed discovery.** Since transport ids rotate, the bridge directory and first-party reputation key on the bridge/relay **URL**, not the signer.

---

## 6. Migration checklist for app authors

- [ ] **Bump your kernel dependency to ≥ 2.49.0** (npm github-pin `#semver:^2.49.0`, or re-vendor).
- [ ] **Remove node-identity persistence.** Don't save/load the transport id; don't key state on it.
- [ ] **Route large payloads through `std/chunk`.** Anything that might exceed ~15 KB. A single oversize `peer.pub` now throws.
- [ ] **One reassembler per topic is fine** — it's multi-file now. (If you forked the old single-file behavior, drop it.)
- [ ] **If you need stream continuity across restarts, adopt `std/publisher`** and pass `publishId: pub.next()` to `peer.pub`.
- [ ] **Expose the kernel version** in your app's UI/health surface (`KERNEL_VERSION`) so the deployed kernel is obvious at a glance.

---

## 7. Versions & where to try it

| component | version | network |
|-----------|---------|---------|
| kernel `@axona/protocol` | **2.49.0** (tagged) | — |
| axona-peer | 3.39.0 | testnet |
| axona-bridge | 2.28.1 (kernel 2.49.0) | testnet (`testnet.axona.net`) |
| axona-relay | 0.11.1 | testnet |
| axona-share | 0.10.1 | GitHub Pages |
| axona-minimal | 0.2.0 | demo-testnet |

Try the reference apps (same build runs against either network via a URL extension):

- **Image sharing:** <https://axona-net.github.io/axona-share/?net=testnet>
- **Minimal pub/sub:** <https://demo-testnet.axona.net/apps/axona-minimal/>
- Append `?net=prod` (or `?bridge=wss://…`) to point at a different network.

Full per-version detail in [RELEASE-NOTES.md](RELEASE-NOTES.md); security-relevant items in [SECURITY-CHANGELOG.md](SECURITY-CHANGELOG.md).
