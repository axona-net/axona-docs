# Team Update — Axona kernel **v2.51.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** kernel 2.51.0 tagged; rolling to the **testnet** fleet. Prod is staged but gated.

## TL;DR

1. **Two distinct keypairs — and the rule that keeps them apart.** A node always has a **transport** keypair (its address + connection). To **publish**, a node uses a **publish** keypair — a *separate* key that signs your messages. **The transport key never signs publishes.** Reusing one key for both is key-reuse and is refused by default; `peer.pub` now requires a publish identity. An app may hold **several** publish keys (per-call `signWith`). This gives a *recognizable, accountable author* without a *trackable network identity*.
2. **Everything that isn't a keypair is a derived or opaque value** — Node ID, `signerPubkey`, Topic ID, Message ID, Publish ID. None of them is a secret.
3. **Large payloads go through `@axona/protocol/std`.** A single publish is capped at a *receivable* ~15 KB; bigger content is chunked + reassembled by the `std/chunk` helper. `std/publisher` persists a publish-stream's dedup token.
4. **You persist only what you need:** nothing (default), a **publish identity** (durable authorship), and/or a **Publish ID** (dedup continuity). Three independent switches — §6.

---

## 1. The mental model

> **Keypairs are the only secrets. Everything else is computed from them or is just a label.**

A node has two kinds of keypair, with **separate jobs that never overlap**:

- **One transport keypair** — always. It is your **Node ID** (address in the mesh) and authenticates your **connection**. It does **not** sign publishes.
- **One or more publish keypairs** — required to publish. Each signs your messages as a distinct **author** (`signerPubkey`). A subscribe-only peer needs none; a publishing peer needs at least one.

**Key separation is enforced:** `peer.pub` signs with a publish identity (`signWith` or the peer's `publishIdentity`) and **never falls back to the transport key** — a signed publish without one is refused (`PUBLISH_NO_PUBLISH_IDENTITY`). Signing with the transport key is possible *only* by passing it explicitly as `signWith` — an intentional, discouraged override, never the default. Why: one key doing both the connection and authorship is key-reuse; splitting them also lets the transport key stay ephemeral (unlinkable) while the publish key is a stable, accountable author.

From those keypairs, everything else is derived:

| You said… | …is captured by |
|---|---|
| **where you are** (address) | **Node ID** = `region ‖ hash(transport pubkey)` |
| **who authored this** | **`signerPubkey`** = the signing keypair's public key |
| **what you said** | **Message ID** = `hash(signerPubkey + message)` |
| **which channel** | **Topic ID** = `hash(anchor + topic name)` |
| **which event** (dedup) | **Publish ID** = an opaque token |

---

## 2. The keys

| Keypair | Created by | Lifetime (default) | Used for | Appears on the wire as |
|---|---|---|---|---|
| **Transport identity** | `deriveIdentity({lat,lng})` | **ephemeral** — fresh per run, not stored | Node ID; the connection handshake (channel-bound); DHT routing; subscribing; direct messages. **Never signs publishes.** | the Node ID + pubkey in the **handshake** (never in a message envelope) |
| **Publish identity** | `deriveIdentity({lat,lng})` | **persist it** for durable authorship (or per-session if you don't need that) | signing publishes → `signerPubkey`; `kill`/`unpub` authority; owning a topic | `signerPubkey` + `signature` in **every published envelope** |

Both are ordinary Ed25519 keypairs from the same `deriveIdentity` call — the difference is purely **what you use each one for** (transport vs. authorship) and **whether you persist it**. They must be **different keys**: a publishing peer creates both.

```js
import { deriveIdentity } from '@axona/protocol';

const transport = await deriveIdentity({ lat, lng });   // { id, pubkey, pubkeyHex, privateKey, sign, region }
// transport.id        → 66-hex Node ID  (region byte ‖ SHA-256(pubkey))
// transport.pubkeyHex → 64-hex Ed25519 public key
// transport.privateKey→ non-exportable by default unless you persist it (see §6)
```

> **Region prefix caveat:** only the **hash half** of a Node ID is cryptographically bound to the key; the leading 8-bit S2 **region** byte is self-asserted (a routing hint), and it is **never** placed in a message envelope. The protocol discloses *who* signed (`signerPubkey`), never *where*.

---

## 3. The IDs & values (not keys)

| Value | Shape | Constructed from | On the wire? | How a receiver trusts it | What it's for |
|---|---|---|---|---|---|
| **Node ID** | 264-bit / 66-hex, region-prefixed | `S2(lat,lng) ‖ SHA-256(transport pubkey)` | Yes — in the handshake, **with** the pubkey + a signature | recompute `SHA-256(pubkey)`, compare to the ID's low 256 bits; verify the handshake signature | your address in the DHT keyspace |
| **`signerPubkey`** | 64-hex Ed25519 pubkey | the signing keypair's public half | Yes — in every envelope | it *is* the key the signature is checked against | proves **who** authored a message; `kill`/`unpub` authority |
| **Message ID (`msgId`)** | 64-hex (no prefix) | `SHA-256(canonical({ publisher: signerPubkey, message }))` | Yes — but receivers **recompute** it | recompute & compare (tampering the body or the author changes it) | content address for `pull(msgId)`; content dedup; tamper-evidence |
| **Topic ID** | 264-bit / 66-hex, region-prefixed | anchored: `anchor[0:2] ‖ SHA-256(anchor + ':' + topic)`; public: `00 ‖ SHA-256(topic)` | derived identically by everyone | deterministic — same inputs ⇒ same ID | which channel / keyspace a topic lives in |
| **`publisher`** (topic *anchor*) | a 66-hex node-id-shaped value, or `null` | your choice — often a **synthetic region anchor** (`<region-byte>‖0…0`); *not* a key | only as an input to Topic-ID derivation | n/a — not a secret | makes every participant derive the **same** Topic ID |
| **Publish ID (`publishId`)** | opaque string (`p_…` or `base:n`) | kernel-minted random, or app-owned | Yes | n/a — **not authenticated** | exactly-once / dedup of one event — nothing else |

Two gotchas worth stating plainly:

- **`publisher` ≠ `publishId`.** `publisher` is the *topic anchor* (which keyspace). `publishId` is a *per-event dedup token*. They are unrelated.
- **`publishId` is not verifiable.** It isn't signed and isn't in `msgId`. If you need an event id that is provably from a given author, put it **inside `message`** (then it's covered by the signature and `msgId`). For a verifiable author-scoped counter, use the signed `seq` + `signerPubkey`.

### The published envelope (what actually travels)

```
{ message,                           // your payload (object or string)
  signerPubkey: "<64-hex>",          // WHO — the signing keypair's public key
  signature:    "ed25519:<128-hex>", // over canonical({ domain, seq, ts, topic, message })
  seq, ts,                           // per-publisher monotonic sequence + timestamp
  msgId:        "<64-hex>",          // content hash — receivers RECOMPUTE, never trust
  topic,                             // the topic string (Topic ID is derived from it)
  publishId:    "<token>" }          // dedup token (sibling field; unauthenticated)
```

Receiver checks: **signature against `signerPubkey`** + **recompute `msgId`**. A changed body breaks both; a changed `seq`/`ts`/`topic` breaks the signature; a swapped author breaks the recomputed `msgId`. Note the transport key is **nowhere** in here — that's what lets a publish be unlinkable to your connection in dual-key mode.

---

## 4. Building a peer

The construction is the same in every mode; only the identity you give it changes.

### 4a. A publishing peer (the standard setup)

You always build a **transport** identity (for the connection) and, to publish, a **publish** identity (the signer). Two keys, two jobs.

```js
import { AxonaPeer, AxonaDomain, NeuronNode, deriveIdentity } from '@axona/protocol';
import { webTransport } from '@axona/web';

const transport       = await deriveIdentity({ lat, lng });        // ephemeral — address + connection
const publishIdentity = await loadOrCreatePublishIdentity(region); // your author key — persist it (§6)

const tx   = webTransport({ bridgeUrl, identity: transport });      // transport identity is REQUIRED here
const node = new NeuronNode({ id: BigInt('0x' + transport.id), lat, lng });
node.transport = tx;
const peer = new AxonaPeer({
  domain: new AxonaDomain({ k: 20 }), node, transport,
  identity:        transport,         // transport/network identity (handshake, routing)
  publishIdentity,                    // signs your publishes  → envelope.signerPubkey
});

await tx.start(transport.id);         // pass the transport Node ID (66-hex)
await peer.start();

await peer.pub('chat/general', { text: 'hi' }, { publisher });   // signed by publishIdentity
await peer.sub('chat/general', (env) => console.log(env.signerPubkey, env.message), { publisher, since: 'all' });
// envelope.signerPubkey === publishIdentity.pubkeyHex; the transport key never appears in a publish.
```

A **subscribe-only** peer needs no publish identity — just the transport identity.

### 4b. Multiple publish identities (per call)

Run as many author personas as you like through one peer with a per-call override:

```js
const alice = await loadOrCreatePublishIdentity('persona:alice', region);
const bob   = await loadOrCreatePublishIdentity('persona:bob',   region);

await peer.pub('forum/general', { text: 'as alice' }, { publisher, signWith: alice });
await peer.pub('forum/general', { text: 'as bob'   }, { publisher, signWith: bob });
```

**Signing precedence:** `signWith` → the peer's `publishIdentity`. There is **no fallback to the transport key**: a signed `peer.pub` with neither throws `PublishError(PUBLISH_NO_PUBLISH_IDENTITY)`. (`{ sign: false }` publishes anonymously and needs no key.)

> **Intentional override (discouraged):** to sign with the transport key anyway, pass it explicitly — `peer.pub(topic, msg, { signWith: transport })`. This is the only way to do it, and it's never implicit. Prefer a dedicated publish key.

> **Owned topics:** if you want a topic only you can publish to / `kill` on, anchor it on the **publish key**: `peer.pub(topic, msg, { publisher: alice.id, signWith: alice })`. Then `kill`/`unpub` authority survives transport rotation. (Region-synthetic and public topics are unaffected.)

> **Honest limit on unlinkability:** the peer you send a publish *to* over your connection can correlate that connection with the publish key at send time. At-rest and onward-hop data carry no such link. Publish through a relay/`host()` node if that first-hop correlation matters.

---

## 5. The `std` library — `@axona/protocol/std`

App-layer helpers built only on the public `AxonaPeer` API, shipped with the package (think C's `stdio`). Two modules today.

### 5a. `std/chunk` — send anything bigger than one message

A single publish must stay under ~15 KB to be *universally receivable* (WebRTC's interoperable max-message floor is 16 KiB; bigger messages are silently dropped on some hops). `std/chunk` splits a byte array into receivable chunks and reassembles them byte-exactly — tolerating reorder, duplicates, and late joiners.

| Function | Does | Returns |
|---|---|---|
| `publishChunkedBytes(peer, bytes, opts)` | chunk + publish the whole transfer (manifest then chunks) | `{ topic, fileId, n, msgIds }` |
| `receiveChunkedBytes(peer, topic, opts)` | subscribe, reassemble one file, then resolve | `{ bytes, name, mime, size, meta, id }` — **or rejects on timeout** |
| `chunkBytes(bytes, opts)` | low-level: just produce the messages | `{ messages, fileId, n }` |
| `createReassembler(onComplete, opts)` | low-level: feed it messages; fires once **per completed file** | `{ accept, missing, have, total }` |
| `stringToBytes(str)` / `bytesToString(u8)` | UTF-8 convert at the edges | `Uint8Array` / `string` |

```js
import { publishChunkedBytes, receiveChunkedBytes } from '@axona/protocol/std';

// sender — throttleMs spaces the publishes (default 0; pass ~150ms)
const { topic } = await publishChunkedBytes(peer, bytes, { name, mime, meta, publisher, throttleMs: 150 });

// receiver — never hangs: resolves the file or rejects with the missing indices
const file = await receiveChunkedBytes(peer, topic, { publisher, timeoutMs: 30000 });
// file.bytes is a Uint8Array →  new Blob([file.bytes], { type: file.mime })
```

Notes that save you a bug:
- **`file.bytes` is a `Uint8Array`** — not a DOM `File`, not a plain array.
- **Strings / data-URLs / long text:** `stringToBytes(...)` in, `bytesToString(file.bytes)` out. Under ~14 KB? Don't chunk — just `peer.pub`. (A data-URL is already base64; chunking it double-encodes ~1.8× — prefer chunking the raw bytes and carrying mime in `meta`.)
- **One reassembler handles a whole stream of files** on a topic (e.g. an image channel) — it keys by `fileId` and fires once per file.

### 5b. `std/publisher` — persist a publish-stream's dedup token

The Publish ID is a per-event dedup token; this persists it so a logical stream never repeats or resets across restarts. (This is about **dedup**, not authorship — authorship is the publish *keypair*, §6.)

| Function | Does |
|---|---|
| `persistentPublisher(key, { store? })` | restore `{id, seq}` from storage (browser `localStorage` by default) or mint fresh; `.next()` advances + persists |
| `createPublisher({ id?, seq?, store?, key? })` | same, but ephemeral unless you pass a `{get,set}` store |
| `defaultStore()` | the browser-localStorage `{get,set}` adapter (or `null`) |

```js
import { persistentPublisher } from '@axona/protocol/std';

const pub = persistentPublisher('sightings');                       // browser default
await peer.pub(topic, msg, { publisher, publishId: pub.next() });   // BOTH options: publisher AND publishId
```

**Node / non-browser:** there's no `localStorage` — pass your own store (any `{ get(k), set(k,v) }`): `persistentPublisher('sightings', { store: myFileStore })`.

---

## 6. Persistence — three independent switches

Decide each separately. Most apps need **none**.

| Want | Persist | How | Effect |
|---|---|---|---|
| Minimal (throwaway/demo) | mint an **ephemeral publish identity** each run (still separate from transport) | just `deriveIdentity` at start, pass as `publishIdentity` | unlinkable; authorship resets each session |
| **Durable authorship** (recognizable author; `kill`/`unpub` your own posts later) — *without* linkable connections | the **publish identity** keypair | `dumpIdentity` / `loadIdentity`, pass as `AxonaPeer({ publishIdentity })` | stable `signerPubkey` across sessions; transport stays ephemeral |
| Stable address across restarts (rarely needed) | the **transport identity** keypair | same, pass as `identity` | stable Node ID — but your connections become linkable |
| **Dedup continuity** of a publish stream | the **Publish ID** | `std/publisher` | no repeated/duplicate event ids across restarts |

Note: a publishing peer always has a publish identity — the only choice is whether you **persist** it (durable author) or mint it **per session** (resets). The transport key is never used for signing.

Persisting an identity keypair (publish or transport) uses the same two calls:

```js
import { deriveIdentity, dumpIdentity, loadIdentity } from '@axona/protocol';

async function loadOrCreatePublishIdentity(key, region) {
  const saved = localStorage.getItem(key);                  // Node: read a file/DB instead
  if (saved) return loadIdentity(JSON.parse(saved));        // → same keypair, id, signerPubkey as before
  const id = await deriveIdentity(region);                  // extractable defaults true, so it can be dumped
  localStorage.setItem(key, JSON.stringify(await dumpIdentity(id)));
  return id;
}
```

`dumpIdentity(identity)` returns a plain-JSON envelope (`{ id, pubkey, privkey(pkcs8 b64), region }`); `loadIdentity(env)` rebuilds the usable identity. (Or hand `AxonaPeer` a `PersistenceAdapter` as `{ persist }` and it dumps/loads the *transport* identity for you.)

---

## 7. One more rule: message size

`peer.pub` **throws `PublishError(PUBLISH_PAYLOAD_TOO_LARGE)`** if a single enveloped message exceeds the reliable floor:

- `MAX_RELIABLE_PUBLISH_BYTES = 15 KiB` (default ceiling) — sized so the enveloped frame stays under WebRTC's 16 KiB interoperable floor, i.e. **receivable by every hop and browser**.
- `MAX_PUBLISH_BYTES = 256 KiB` (absolute hard cap).

This is *fail-loud*: code that used to "work" on small images but silently truncate on bigger ones now gets a clear error pointing at `std/chunk`. Anything that might exceed ~14 KB serialized → chunk it.

---

## 8. Migration checklist

- [ ] **Kernel ≥ 2.50.0** (npm github-pin `#semver:^2.50.0`, or re-vendor).
- [ ] **Build + thread a transport `identity`** (`deriveIdentity` → `webTransport({identity})` + `AxonaPeer({identity})`; `identity.id` to `NeuronNode`/`transport.start`). Nothing is auto-defaulted.
- [ ] **A publishing peer needs a publish identity** — pass `AxonaPeer({ publishIdentity })` (or per-call `{ signWith }`). **Persist it** (`dumpIdentity`/`loadIdentity`) for durable authorship, or mint per session if you don't need that. The transport key will not sign — a signed `peer.pub` without a publish identity now throws. Multiple personas → `{ signWith }`.
- [ ] **Owned topics:** anchor on the publish key (`{ publisher: pubKey.id, signWith: pubKey }`).
- [ ] **Large payloads → `std/chunk`** (`publishChunkedBytes`/`receiveChunkedBytes`, `throttleMs`). `file.bytes` is a `Uint8Array`; strings via `stringToBytes`/`bytesToString`.
- [ ] **Need dedup continuity?** `std/publisher` → pass `publishId: pub.next()` alongside `publisher`.
- [ ] **Surface `KERNEL_VERSION`** in your UI/health so the deployed kernel is obvious.

---

## 9. FAQ

- **What do I pass to `webTransport` / `AxonaPeer`?** The transport `identity` from `deriveIdentity` — the *same object* to both; `identity.id` to `NeuronNode`/`transport.start`. Required, not auto-defaulted.
- **How many keypairs are there?** A transport keypair (always) plus a publish keypair to publish (a subscribe-only peer needs none). The transport key never signs publishes. Multiple publish keys via `signWith`.
- **Recognize an author across sessions / delete my own posts later?** Persist a **publish identity** (§6). Not the `publishId`.
- **`publisher` vs `publishId`?** `publisher` = topic anchor (which keyspace). `publishId` = per-event dedup token. Unrelated.
- **Can I prove a message has a given `publishId`?** No — it's unauthenticated. Put the id inside `message` if you need it bound to the author.
- **Does `receiveChunkedBytes` return a `File`?** No — `{ bytes: Uint8Array, name, mime, size, meta, id }`.
- **Node, not browser?** No `localStorage`: pass your own `{get,set}` store to `std/publisher`, and store the `dumpIdentity` JSON in a file/DB.

---

## 10. Versions & where to try it

| component | version | network |
|---|---|---|
| kernel `@axona/protocol` | **2.51.0** (tagged) | — |
| axona-peer | 3.41.0 | testnet (rolling) |
| axona-bridge | kernel 2.51.0 | testnet (rolling) |
| axona-relay | 0.11.x | testnet (rolling) |
| axona-share | 0.11.0 | GitHub Pages (rolling) |
| axona-minimal | 0.3.0 | demo-testnet (rolling) |

> Kernel 2.51.0 is tagged and all reference apps now carry a publish identity. The testnet fleet (bridge/relay/peer/demo/Pages) is mid-rollout from 2.50.0 → 2.51.0.

- **Image sharing:** <https://axona-net.github.io/axona-share/?net=testnet>
- **Minimal pub/sub:** <https://demo-testnet.axona.net/apps/axona-minimal/>
- Append `?net=prod` (or `?bridge=wss://…`) to point at a different network.

Deep dives: dual-key design in [`history/architecture/Dual-Key-Identity-v0.1.md`](history/architecture/Dual-Key-Identity-v0.1.md); per-version detail in [RELEASE-NOTES.md](RELEASE-NOTES.md); security posture in [SECURITY-CHANGELOG.md](SECURITY-CHANGELOG.md).
