# Team Update — Axona kernel v2.45→v2.50: identity model, `std` library, reliable chunking, dual-key identity

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** shipped to the **testnet** fleet (kernel **2.50.0**). Prod is staged but gated.
**TL;DR:** Transport identities are now **ephemeral everywhere**, a publish is identified by an **app-owned Publish ID** (not the node id), large payloads must go through the new **`@axona/protocol/std`** chunking helper (single publishes are hard-capped at a *receivable* 15 KB), `std` also gives you a small **persistence** helper for publish streams, and (new in **v2.50.0**) a peer can sign publishes with a **separate publish identity** — even **several** — so you get durable, recognizable authorship without a linkable transport identity (§3.3).

---

## 1. Why this matters in one paragraph

We separated **who you are on the wire** (a throwaway, per-session transport identity) from **what your application publishes** (a stable, app-owned dedup token). That split lets every node — browser, relay, bridge — rotate its network identity freely (a privacy + resilience win) **without** breaking exactly-once delivery or a logical message stream. At the same time we made large-payload delivery honest: instead of silently dropping anything the weakest hop can't carry, the kernel now **fails loud** above the universally-receivable message size and ships a tested `std` helper to split, send, and reassemble big content correctly.

---

## 2. Keys & IDs — one keypair, several derived identifiers

The single biggest source of confusion is imagining several keys. **There is only ONE key per node** — one Ed25519 keypair from `deriveIdentity({lat,lng})` — and it does two jobs. Everything else below is a *derived* or *opaque* value, **not** a key.

> **One keypair = your identity.**
> Its public key **hashed** is *where you are* — your **Node ID**.
> Its public key **raw** is *who you are* — your **`signerPubkey`** on every message.
> Its **private key signs** (the connection handshake, and every publish).
> Then: `msgId` = *what* you said · **Topic ID** = *which channel* · **Publish ID** = *which event* (dedup).
> Only the keypair is secret; the rest are derived or opaque.

### The three things you pass in your code

| Concept | What it is | You pass it to | It controls |
|---|---|---|---|
| **`identity`** | Your node's **Ed25519 keypair** (from `deriveIdentity({lat,lng})`). It is BOTH your **transport / node id** (`id = [8-bit S2 region prefix ‖ SHA-256(pubkey)]`) AND your **signing key**. | `webTransport({ identity })` **and** `new AxonaPeer({ identity })` — the *same* object — plus `identity.id` to `NeuronNode` / `transport.start` | `envelope.signerPubkey` (WHO published); authority to `kill`/`unpub` your own messages; your address in the mesh |
| **`publisher`** | The **topic anchor** — the value every participant uses to derive the same **Topic ID**. Usually a region-synthetic value (`ANCHOR.publisher`) or `null` for a fully public topic. **Not** a key, **not** per-sender. | `peer.pub` / `peer.sub` / `peer.pull(topic, …, { publisher })` | which **Topic ID** (keyspace) the topic lives in |
| **`publishId`** | A per-event **dedup / exactly-once token**. Opaque string, no location. | `peer.pub(topic, msg, { publishId })` — optional | de-duplication of a publish across the mesh — **nothing else** |

### How each identifier is built and used

| Identifier | Shape | Built from | On the wire? | How it's verified | Purpose |
|---|---|---|---|---|---|
| **Transport / Node ID** | 264-bit, region-prefixed (66 hex) | `S2(lat,lng) ‖ SHA-256(pubkey)` | **Yes — sent together with the pubkey + a signed hello.** The ID alone proves nothing. | Verifier recomputes `SHA-256(pubkey)` and checks it equals the ID's **low 256 bits**, then checks the hello signature against the pubkey. | your address in the DHT keyspace; mesh auth |
| **`signerPubkey`** | 32-byte Ed25519 pubkey (64 hex) | the public half of your keypair | Yes — in **every** published envelope | it *is* the key the envelope signature is checked against | proves **WHO** authored a message; basis for `kill`/`unpub` authority |
| **Message ID (`msgId`)** | 256-bit, **no** prefix (64 hex) | `SHA-256(canonical({ publisher: signerPubkey, message }))` | Yes — but receivers **recompute** it, never trust the sent value | recompute & compare: tampering the body, or swapping the author, changes it | content address (`pull(msgId)`), content-level dedup, tamper-evidence |
| **Topic ID** | 264-bit, region-prefixed | anchored: `pub[0:2] ‖ SHA-256(pub + ':' + topic)`; public: `00 ‖ SHA-256(topic)` | derived identically by everyone (not "claimed") | deterministic — same inputs ⇒ same ID | which channel / which keyspace a topic lives in |
| **`publisher`** (topic anchor) | a node-id-shaped value, or `null` | app's choice — often a **synthetic region anchor** (`<region-byte>‖0…0`), *not* anyone's real key | as the input to Topic-ID derivation | n/a — not a secret, nothing to verify | makes every participant derive the **same** Topic ID |
| **Publish ID** | opaque token (e.g. `pub_ab12…:7`) | random, or app-owned via `std/publisher` | Yes | n/a | exactly-once / dedup of one event — nothing else |

> **On the region prefix:** only the **hash half** of the Node ID is cryptographically bound to your key. The top 8-bit S2 region prefix is **self-asserted** (a routing hint you choose from your lat/lng) — it is *not* provable from the key, and it is *not* in the message envelope. Anti-grinding defenses for the prefix live elsewhere; the envelope discloses **who** (`signerPubkey`), never **where**.

### What actually travels for one publish (the signed envelope)

```
{ message,                          // your payload
  signerPubkey: <64-hex>,           // your identity's PUBLIC key — "who"
  signature:    'ed25519:<128-hex>',// over a DOMAIN-TAGGED core: { domain, seq, ts, topic, message }
  seq, ts,                          // per-publisher monotonic sequence + timestamp
  msgId:        <64-hex>,           // content hash — receivers RECOMPUTE it, never trust the sent value
  topic,                            // Topic ID derived from it
  publishId:    <token> }           // dedup token
```
A receiver checks the **signature against `signerPubkey`** and **recomputes `msgId`**. Together these make every field tamper-evident: a changed body breaks both; a changed `seq`/`ts`/`topic` breaks the signature; a swapped author breaks the recomputed `msgId`.

### ⚠️ "publisher" is an overloaded word

The token `publisher` means **two unrelated things** depending on where you see it:
- in **`deriveTopicId` / `peer.pub({ publisher })`** → the **topic anchor** (an addressing input, usually a synthetic region value, no key behind it);
- inside the **`msgId`** formula → the **author's pubkey** (`signerPubkey`).

Whenever this doc says "the `publisher` option," it means the **topic anchor**.

### What the keys do — and what they don't

- `deriveIdentity({lat,lng})` mints a fresh **Ed25519 keypair**; your node id is derived from its public key. The same identity **signs every publish**, so `envelope.signerPubkey` = your identity's public key — a stable pseudonymous author, **never your location**. **Publisher location stays out of the protocol.**
- **Authorship is the `identity`, not the `publishId`.** Recognizing a sender across topics/sessions, and deleting (`kill`) or retracting (`unpub`) your own messages later, all key off `signerPubkey` — i.e. the **identity keypair**. The `publishId` has nothing to do with authorship.
- Infra nodes (relays/bridges) derive **non-extractable** keys (`extractable:false`) *because* they're deliberately throwaway. An app that wants to **keep** its identity derives it extractable (the default) and persists it — see §3.2.

### What to pass where (you still build and thread an `identity` — this did not change)

```js
import { AxonaPeer, AxonaDomain, NeuronNode, deriveIdentity } from '@axona/protocol';
import { webTransport } from '@axona/web';

const identity  = await deriveIdentity({ lat, lng });        // keypair = transport id + signer
const transport = webTransport({ bridgeUrl, identity });     // REQUIRED — webTransport throws without it
const node      = new NeuronNode({ id: BigInt('0x' + identity.id), lat, lng });
node.transport  = transport;
const peer      = new AxonaPeer({ domain: new AxonaDomain({ k: 20 }), node, identity, transport });

await transport.start(identity.id);   // pass identity.id — the 66-char hex node id
await peer.start();
```

Nothing here is auto-defaulted: create **one** `identity`, pass **that same object** to both `webTransport` and `AxonaPeer`, and pass **`identity.id`** to `NeuronNode` and `transport.start`. "Ephemeral" only means the *default* is to not persist `identity` between runs — **not** that the kernel invents one for you.

### The rule to remember

> - **By default, don't persist `identity`.** A fresh one per run is the privacy-preserving default (browsers always worked this way).
> - **Need dedup continuity** across restarts (a logical stream that never repeats/reuses)? Persist a **Publish ID** with `std/publisher` — §4.2.
> - **Need durable authorship** — a stable `signerPubkey` across sessions, or the ability to `kill`/`unpub` your own posts later? Persist the **`identity` keypair** — §3.2.
>
> These two are **independent**: do either, both, or neither.

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

Two things to keep straight here: you still pass **`publisher`** (the topic anchor) on every call — `publishId` is an *additional*, optional option, not a replacement. And `publishId` is **dedup only**; it does not make you a recognizable author and does not grant `kill`/`unpub` rights (that's the `identity` — §3.2).

Why we changed it: the old publish id was derived from the node id + a counter that **reset to 0 on restart**. With ephemeral transport ids (below), a restarted node could reuse an old `nodeId:counter` and have its *new* publishes silently deduped as already-seen. Decoupling the Publish ID (random token, or app-persisted) removes that collision class.

### 3.2 Identity: ephemeral by default, persistent if you need durable authorship

By default every node — now including **relays and bridges**, not just browsers — mints a **fresh** keypair + node id on each start and writes nothing to disk. For most apps that's what you want:

- Remove any code that saves/loads a node identity file "to keep the same nodeId."
- Don't key application state on the node id — it changes every run.
- Discovery & reputation key on the node's **URL** (for infra), not on the transport id.

**But if your app needs durable authorship** — a stable `signerPubkey` that subscribers recognize across topics and sessions, and the ability to `kill` (delete) or `unpub` (retract) *your own* past messages in a later session — then you must **persist the `identity` keypair** (not the publishId; `kill`/`unpub` are owner-only and must be signed by the original creator's key). Persist it yourself with `dumpIdentity`/`loadIdentity`:

```js
import { deriveIdentity, dumpIdentity, loadIdentity } from '@axona/protocol';

const saved = localStorage.getItem('axona:identity');        // your storage of choice
const identity = saved
  ? await loadIdentity(JSON.parse(saved))                    // same keypair, id, signerPubkey as last time
  : await deriveIdentity({ lat, lng });                      // extractable defaults to true, so it can be dumped
if (!saved) localStorage.setItem('axona:identity', JSON.stringify(await dumpIdentity(identity)));
// …then pass `identity` to webTransport + AxonaPeer exactly as in §2.
```

(Node has no `localStorage` — store the `dumpIdentity` envelope, which is plain JSON, in a file or DB. Or hand `AxonaPeer` a `PersistenceAdapter` as `{ persist }` and it will dump/load the identity for you.)

The trade-off with persisting the *transport* identity is that it becomes **linkable** across sessions and topics. If you want durable authorship *without* that linkage, use a **separate publish identity** instead — §3.3 (recommended for new apps that need authorship).

### 3.3 Dual-key identity (new in v2.50.0) — durable authorship without a linkable transport

A peer can sign publishes with a **publish identity** that is **separate from its transport identity**, and can run **several** publish identities through one peer. This is the clean way to get a recognizable, accountable author **without** a persistent (linkable) transport id.

```js
const transport       = await deriveIdentity({ lat, lng });        // ephemeral — node id, handshake, routing
const publishIdentity = await loadOrCreatePublishIdentity();        // persisted (dumpIdentity/loadIdentity)

const peer = new AxonaPeer({ domain, node, transport,
  identity:        transport,        // transport/network identity
  publishIdentity,                   // default signer for publishes  ← NEW
});

await peer.pub(topic, msg);                              // signed by publishIdentity
await peer.pub(topic, msg, { signWith: otherPublishId });// per-call override → many publish keys, one peer
```

- **Precedence:** `signWith` → `publishIdentity` → `identity` (transport). Omit both and publishes sign with the transport identity exactly as before — **backward-compatible, no wire change**, so dual-key and single-key peers interoperate on the same topic.
- **What you get:** `envelope.signerPubkey` is the *publish* key, so authorship — recognition across topics/sessions, and `kill`/`unpub` of your own messages — keys off it. The transport key stays **ephemeral and never appears in the envelope**, so an observer can't tie your publishes to your (rotating) network identity. Verified live across a transport-id rotation: same publish key ⇒ same `signerPubkey`.
- **Multiple publish keys** (your per-channel/per-persona personas): just vary `{ signWith }` per call. Each is an independent author; the receiver verifies each `signerPubkey` independently.
- **Honest caveat:** the peer you hand a publish to *over your connection* can locally correlate that connection with the publish key at send time; at-rest and onward-hop data carry no such link. Mitigate by publishing through a relay/`host()` node if that matters.
- **Owned topics:** anchor the topic on the **publish key's** id (`peer.pub(topic, msg, { publisher: publishIdentity.id, signWith: publishIdentity })`) so `kill`/`unpub` ownership survives transport rotation. Region-synthetic / public topics are unaffected.

Full rationale + the gated follow-ups (publish-PoW, prod rollout) in [`architecture/Dual-Key-Identity-v0.1.md`](architecture/Dual-Key-Identity-v0.1.md).

### 3.4 Large messages — single publishes are capped at a *receivable* size

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

**Use the high-level helpers by default** — they handle the throttling, ordering, retry-on-gap, and timeout for you:

```js
// sender — throttleMs spaces the publishes so a burst doesn't overrun the channel.
// It DEFAULTS TO 0, so pass it (≈150ms is what the reference apps use).
const { topic } = await publishChunkedBytes(peer, bytes, { name, mime, meta, publisher, throttleMs: 150 });

// receiver — resolves with the file, or REJECTS on timeout (never hangs)
const file = await receiveChunkedBytes(peer, topic, { publisher, timeoutMs: 30000 });
```

**What `file` is:** a plain object `{ bytes, name, mime, size, meta, id }` — **`file.bytes` is a `Uint8Array`** (not a DOM `File`, not a plain array). To render an image: `URL.createObjectURL(new Blob([file.bytes], { type: file.mime }))`.

**Strings, data URLs, walls of text** — `chunk` works in **bytes**, so convert at the edges with the bundled helpers:

```js
import { stringToBytes, bytesToString } from '@axona/protocol/std/chunk';

await publishChunkedBytes(peer, stringToBytes(dataUrlOrText), { publisher });  // mime/meta optional — omit them
const file = await receiveChunkedBytes(peer, topic, { publisher });
const text = bytesToString(file.bytes);                                        // your string back, verbatim
```
- A **data URL** already encodes its own mime, so you can omit `mime`/`meta`. Caveat: a data URL is *already* base64, and `chunk` base64-encodes again internally → ~1.8× the raw image on the wire. If you can, chunk the **raw** bytes instead (`new Uint8Array(await blob.arrayBuffer())`, put mime in `meta`) and rebuild the data URL on receive — no double-encoding. Plain text has no such penalty.
- **Short text doesn't need chunking at all.** If the message + metadata serialize under ~14 KB (a 2-page note is usually 4–8 KB), just `peer.pub(topic, obj, { publisher })` directly. Reach for `std/chunk` only when a payload might cross the 15 KB reliable cap.

**Low-level (only if you must drive pub/sub yourself):** mirror what the helper does — **throttle between publishes** (an un-spaced `for` loop will drop chunks), and feed every received message to one reassembler:

```js
// sender — manifest first, then chunks, spaced out
const { messages } = chunkBytes(bytes, { name: 'photo.jpg', mime: 'image/jpeg', meta });
for (const m of messages) { await peer.pub(topic, m, { publisher }); await sleep(150); }

// receiver — ONE reassembler handles a whole STREAM of files on the topic
const r = createReassembler(
  (file) => show(file.bytes, file.mime, file.meta),     // fires once per completed file
  { onProgress: (p) => console.log(`${p.have}/${p.total}`) },
);
await peer.sub(topic, (env) => r.accept(env.message), { publisher, since: 'all' });
```

Properties worth knowing (each is a fix for a real failure we hit):

- **Completion = every distinct index present**, not a count of messages received (a duplicate can't fire "done" over a hole).
- **No silent hang:** `receiveChunkedBytes` rejects on timeout (after a best-effort `pull()` of missing chunks) and names the missing indices — never awaits forever.
- **Multi-file (new in 2.49.0):** a single reassembler tracks every file it sees by `fileId` and fires `onComplete` **once per file**. *This is the bug that made a channel only ever show its first image* — one reassembler per topic now correctly handles a stream of files.
- **Garbage-isolated:** foreign/malformed messages can't corrupt the file you're collecting.
- **Reload-safe ceiling:** `publishChunkedBytes` refuses a transfer larger than the topic's replay cache can hold, so you never create a transfer a reload-joiner can't reassemble.

### 4.2 `std/publisher` — persist a logical publish stream

The Publish ID is the **dedup token** (not authorship — that's the publish identity, §3.3); `std/publisher` is how an app **owns and persists** it so a publish stream stays continuous across reloads / a rotated transport id, with no reset-to-zero collision.

```js
import { persistentPublisher } from '@axona/protocol/std';

const pub = persistentPublisher('sightings');            // restores {id, seq} from localStorage, or mints fresh
await peer.pub(topic, msg, { publisher, publishId: pub.next() });   // note: BOTH options — publisher (topic anchor) AND publishId
// pub.next() → '<base>:<n>', advancing + persisting the counter each call
```

- `createPublisher({ id?, seq?, store?, key? })` — ephemeral by default; pass a `{get,set}` store to persist (the sequence is written on every `next()`, so it never reuses a value after a restart).
- `persistentPublisher(key, { store? })` — browser-`localStorage`-backed by default; use a distinct `key` per logical stream (one per channel / file transfer / sender) to run several at once.
- `defaultStore()` — the localStorage `{get,set}` adapter (or `null` when unavailable, e.g. a sandboxed iframe).
- **Node / non-browser:** there's no `localStorage`, so pass your own store — any object with `get(key)`/`set(key,val)` (file-backed, Redis, etc.): `persistentPublisher('sightings', { store: myStore })`.

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

- [ ] **Bump your kernel dependency to ≥ 2.50.0** (npm github-pin `#semver:^2.50.0`, or re-vendor).
- [ ] **Keep building + threading an `identity`** — `deriveIdentity` → `webTransport({identity})` + `AxonaPeer({identity})` + `identity.id` to `NeuronNode`/`transport.start`. Nothing here is auto-defaulted.
- [ ] **Decide your persistence stance (independent choices):**
  - Default (most apps): persist **nothing** — fresh identity each run.
  - Want **durable authorship** (stable `signerPubkey`, `kill`/`unpub` your own posts later) *without* a linkable transport? Use a **separate `publishIdentity`** (persist it via `dumpIdentity`/`loadIdentity`) — §3.3. Need several author personas? Pass `{ signWith }` per call.
  - (Simpler, but links your connections) persist the **transport `identity`** itself — §3.2.
  - Want **dedup continuity** of a publish stream across restarts? Persist a **Publish ID** via `std/publisher` and pass `publishId: pub.next()` alongside `publisher` (§4.2).
- [ ] **Route large payloads through `std/chunk`** (`publishChunkedBytes`/`receiveChunkedBytes`, with `throttleMs`). Anything that might exceed ~15 KB — a single oversize `peer.pub` now throws. Convert strings/data-URLs with `stringToBytes`/`bytesToString`; remember `file.bytes` is a `Uint8Array`.
- [ ] **One reassembler per topic is fine** — it's multi-file now. (If you forked the old single-file behavior, drop it.)
- [ ] **Expose the kernel version** in your app's UI/health surface (`KERNEL_VERSION`) so the deployed kernel is obvious at a glance.

---

## 6.5 FAQ (quick reference)

- **What do I pass to `webTransport` / `AxonaPeer`?** The `identity` from `deriveIdentity` — the *same object* to both. It's your transport id **and** your signing key. Required; not auto-defaulted.
- **What do I pass to `transport.start(id)` / `new NeuronNode({ id })`?** `identity.id` (the 66-char hex node id); `NeuronNode` wants `BigInt('0x' + identity.id)`.
- **Should I just not pass an identity?** No — you always create and pass one. "Ephemeral" = you don't *persist* it by default, not that the kernel makes one for you.
- **I want to delete my own posts later / be a recognizable author across sessions.** Persist a **publish identity** and pass it as `AxonaPeer({ publishIdentity })` — §3.3 (keeps the transport id ephemeral/unlinkable). Persisting the transport `identity` itself also works but links your connections (§3.2). *Not* the publishId either way.
- **Can one peer publish under several identities?** Yes — `peer.pub(topic, msg, { signWith: otherPublishIdentity })` per call (§3.3).
- **I want a publish stream that never reuses/repeats its dedup token across restarts.** Persist a **Publish ID** with `std/publisher`; pass `publishId: pub.next()` *and* `publisher` — §4.2.
- **Is `publisher` the same as `publishId`?** No. `publisher` = the topic anchor (which keyspace the topic lives in), same for everyone on the topic. `publishId` = a per-event dedup token.
- **Does `receiveChunkedBytes` give me a `File`?** No — `{ bytes: Uint8Array, name, mime, size, meta, id }`. Wrap `file.bytes` in a `Blob` for the browser.
- **Big text / data URLs?** `stringToBytes` in, `bytesToString` out. Under ~14 KB? Skip chunking — just `peer.pub`.
- **Node, not browser?** No `localStorage`: pass your own `{get,set}` store to `persistentPublisher`, and store the `dumpIdentity` JSON in a file/DB.

---

## 7. Versions & where to try it

| component | version | network |
|-----------|---------|---------|
| kernel `@axona/protocol` | **2.50.0** (tagged) | — |
| axona-peer | 3.40.0 | testnet |
| axona-bridge | 2.28.2 (kernel 2.50.0) | testnet (`testnet.axona.net`) |
| axona-relay | 0.11.2 | testnet |
| axona-share | 0.10.1 | GitHub Pages |
| axona-minimal | 0.2.0 | demo-testnet |

> Dual-key identity (v2.50.0) is live on testnet and under an overnight verification soak (multikey / transport-rotation / single-key interop). Prod + app adoption are gated follow-ups.

Try the reference apps (same build runs against either network via a URL extension):

- **Image sharing:** <https://axona-net.github.io/axona-share/?net=testnet>
- **Minimal pub/sub:** <https://demo-testnet.axona.net/apps/axona-minimal/>
- Append `?net=prod` (or `?bridge=wss://…`) to point at a different network.

Full per-version detail in [RELEASE-NOTES.md](RELEASE-NOTES.md); security-relevant items in [SECURITY-CHANGELOG.md](SECURITY-CHANGELOG.md).
