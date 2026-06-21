# Team Update — Axona kernel **v3.6.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** kernel **3.6.0** is **live in prod across the whole stack** —
`demo.axona.net`, `axona.net`, the demo apps (minimal, axona-share), the testnet
fleet, **and all three signaling bridges** (prod east + west + testnet) now run it.
The rollout was a wire-compatible point release (all of 3.x is `WIRE_VERSION` 3.0),
so there was no flag day and apps interoperated with the bridges throughout.

> This supersedes the **v2.51** update. The headline is the **v3.0.0 flag-day**,
> which *renamed and reshaped* the identity + topic APIs that v2.51 described — so
> read §1 as a migration, not an addition. Everything after is refinement.

---

## TL;DR

1. **Identity flag-day (v3.0.0, breaking).** `deriveIdentity()` is gone. A
   **connection** key is now `createNodeIdentity({lat,lng})`; an **author** key is
   `createAuthorIdentity({persistAs?})` — keypair-only, **no nodeId, no region**
   (authors are location-free). The peer takes `{ nodeIdentity }` only; authorship
   is **per-call** `signWith`. `WIRE_VERSION` 2.0 → 3.0: a 2.x and a 3.x peer
   reject each other (hermetic partition).
2. **Topics are structured descriptors**, not strings: `{ region, owner?, name,
   write? }`. **Write policy** is folded into the Topic ID — no owner ⇒ `open`;
   naming an owner ⇒ defaults to **`owner`-only** (safe default), pass
   `write:'open'` for an owner-namespaced open wall/inbox.
3. **`publishId` is gone.** Dedup is the content **Message ID** = `hash(signerPubkey
   + message)`. Re-publishing identical content **upserts** (one cache slot,
   delivered exactly once across all roots) — v3.3.x.
4. **Metrics moved off polling.** A topic's live counts are **published** to a
   derived topic — `sub(metricTopic(T))` for the latest + a rolling ~48 h trend
   instead of a scatter-gather per poll (v3.4.0). `peer.metrics()` is now
   **owner-only** (v3.5.0).
5. **Two correctness fixes you'll feel:** `kill()` now delivers `{deleted:true}`
   to **remote** subscribers (v3.5.1), and `std/chunk` **reliably** lands large
   transfers so a *reload* subscriber can reassemble (v3.6.0).

---

## 1. The v0.3 flag-day (v3.0.0) — what changed from the v2.51 model

v2.51 introduced "transport key vs. publish key." v3.0.0 keeps that split but
**renames the factories and makes authors truly location-free**, and replaces
string topics with structured, policy-bearing descriptors.

### 1a. Identities

| v2.51 (old) | v3.x (now) |
|---|---|
| `deriveIdentity({lat,lng})` for **both** roles | `createNodeIdentity({lat,lng})` — connection key + 264-bit **Node ID** |
| a *publish* `deriveIdentity` (had a nodeId/region it didn't use) | `createAuthorIdentity({persistAs?})` — **keypair only**: `{ authorId, pubkeyHex, privateKey, sign }`. **No nodeId, no region.** Its pubkey is the **Author ID** = `signerPubkey`. |
| peer `{ identity, publishIdentity }` | peer `{ nodeIdentity }` — **no** `publishIdentity` field |

```js
import { createNodeIdentity, createAuthorIdentity, AxonaPeer, ANONYMOUS } from '@axona/protocol';

const node   = await createNodeIdentity({ lat, lng });               // connection / Node ID (ephemeral)
const author = await createAuthorIdentity({ persistAs: 'me:author' }); // durable authorship (localStorage)
const peer   = new AxonaPeer({ domain, node: neuronNode, nodeIdentity: node, transport });

await peer.pub(topic, msg, { signWith: author });    // authorship is PER CALL
await peer.pub(topic, msg, { signWith: ANONYMOUS }); // deliberately unsigned
```

- **Authorship is per-call.** Run many personas through one peer by varying
  `signWith`. There is **no default author** and the node key **never** signs a
  publish — a signed `pub` with no signer throws `PUBLISH_NO_PUBLISH_IDENTITY`.
- `persistAs` load-or-creates the author keypair in `localStorage` (browser) or a
  `{get,set}` store (Node), so authorship survives reloads; omit it for an
  unlinkable per-session author.

### 1b. Topics are descriptors with a write policy

A topic is `{ region, owner?, name, write? }`, resolved to a 66-hex **Topic ID**
by `deriveTopicId(descriptor)`. The **write policy is part of the ID** so roots
enforce it statelessly:

| Descriptor | Who may publish | Use |
|---|---|---|
| `{ region, name }` | **anyone** (`open`) | lobbies, public channels |
| `{ region, owner, name }` | **owner only** (defaults to `write:'owner'`) | a profile / broadcast feed — un-spoofable |
| `{ region, owner, name, write:'open' }` | **anyone** | an owner-namespaced wall/inbox |

- **Region** is the keyspace anchor: pass it explicitly, else it defaults to the
  **publishing node's** region (it is **never** derived from the author key —
  v3.1.0). `region` accepts a name (`'useast'`), a code (`'0x89'` / `137`), or is
  omitted to use the node's.
- **Owner-only is the safe default.** Naming an owner without `write` means
  owner-only — you can't accidentally ship a world-writable feed (v3.2.0).
- **Topic ID is a read handle.** `sub` / `pull` / `metrics` accept either a
  descriptor **or** the bare 66-hex id; `pub` needs the descriptor (it carries the
  write policy + signer rules).

### 1c. `publishId` is gone

Dedup is now the **content** Message ID = `hash(signerPubkey + message)`. The old
opaque `publishId` and `std/publisher` stream-token are removed — identical
content has one identity, network-wide.

### Migration from v2.51

- `deriveIdentity` → `createNodeIdentity` (connection) + `createAuthorIdentity`
  (authorship).
- Peer constructor `{ identity, publishIdentity }` → `{ nodeIdentity }`; pass the
  author via `signWith` on each `pub`.
- String topics → `{ region, name }` (open) or `{ region, owner, name }` (owned).
- Drop any `publishId` / `std/publisher` usage.
- It's a **wire flag-day** (3.0): the whole fleet an app talks to must be on 3.x.

---

## 2. Pub/sub correctness + lifecycle

- **Exactly-once re-publish (v3.3.1–3.3.3).** Re-publishing identical content
  (same author + message ⇒ same msgId) now **replaces** the prior cache entry
  (one slot per msgId) and is **delivered once**, even across the K replicated
  roots and every ingress path. Re-publishing is idempotent — handy for the
  chunk-repair below.
- **`kill()` reaches remote subscribers (v3.5.1).** Retracting a message now
  delivers `{ deleted: true, msgId }` to a subscriber on a **different node** (not
  just a local one). Previously the remote delete was deduped against the original
  message's delivery and silently dropped — the message vanished from replays but
  the handler never fired. Your `sub` handler's `if (env.deleted) …` branch now
  fires for everyone.

---

## 3. Metrics — subscribe, don't poll (v3.4.0), and owner-only `metrics()` (v3.5.0)

`peer.metrics(topic)` is a K-root **scatter-gather** — fine for an occasional
probe, ruinous as a per-user poll. The new model:

```js
import { deriveTopicId, metricTopic } from '@axona/protocol';

const id = await deriveTopicId({ region: 'useast', name: 'lobby' });
await peer.sub(metricTopic(id), (env) => {
  const m = JSON.parse(env.message);   // { topic, ts, by, current_count, subscribers, bytes }
  showRoomCount(m.subscribers, m.current_count);
}, { since: 'all' });                  // latest snapshot + a rolling ~48 h trend
```

- A topic's **primary root republishes** signed metric snapshots to
  `metricTopic(T)` every ~5 min; you **subscribe** instead of polling — one
  subscription, updates pushed, and a free ~48 h history (snapshots age out at the
  hold ceiling). Helpers `metricTopic` / `isMetricTopic` live in core; the relay
  runs the publish loop.
- **Advisory:** the metric topic is open (anyone can publish), so treat a snapshot
  as a hint — pin trust to a known relay's `env.signerPubkey` if you need to.
- **`peer.metrics()` is now owner-only (v3.5.0):** it answers only the **owner of
  an owned topic**; open/public topics are refused (read them via `metricTopic`).
  This also removes the last way an arbitrary peer could trigger a K-root fan-out.

---

## 4. `std/chunk` — reliable large transfers (v3.6.0)

`peer.pub` is fire-and-forget into the transport buffer, so a fast burst of chunks
could drop some before they durably cached — a **reload** subscriber (replaying
from cache) then never reassembled and `receiveChunkedBytes` timed out, with no
throttle value you could reliably pick.

`publishChunkedBytes` now **paces by default and then verifies what the mesh
cached, re-publishing any gaps** (best-effort; never throws). So the durable set
is complete and a reload reassembles — **you no longer tune a throttle**.
`receiveChunkedBytes` resolves with `{ bytes, name, mime, size, meta }`, or
**rejects** naming the missing indices on timeout — it never hangs.

```js
import { publishChunkedBytes, receiveChunkedBytes } from '@axona/protocol/std/chunk';
await publishChunkedBytes(peer, bytes, { topic, signWith: author, name, mime });
const file = await receiveChunkedBytes(peer, topic);   // reload-safe
```

> Files are still capped to the per-topic replay-cache ceiling, so you never
> create a transfer a reload joiner can't complete. Apps that import `std/chunk`
> from a static host should `?v=`-version the import so a deploy isn't masked by a
> stale cached module.

---

## 5. Versions & where to try it

| Piece | Version | Notes |
|---|---|---|
| Kernel `@axona/protocol` | **3.6.0** | tag `v3.6.0`; `WIRE_VERSION` 3.0 |
| `demo.axona.net` + demo apps | **3.6.0** | **live in prod** — axona-minimal v0.5.0, axona-share **v0.12.0** (now on the reliable `publishChunkedBytes` send path) |
| `axona.net` reference peer | **3.6.0** | **live in prod** (peer v0.57.0) |
| Testnet fleet + `demo-testnet.axona.net` | **3.6.0** | live |
| Relay `axona-relay` | **0.16.2** | keyspace hosting + metric-publish loop (`RELAY_METRICS`) |
| Signaling bridges (prod east + west + testnet) | **3.6.0** | **live** (bridge v2.33.0) — owner-only-metrics + kill-re-fan now enforced at the bridge-roots |

- **Try it:** `demo.axona.net/apps/axona-share` (image sharing over chunked
  pub/sub), `demo.axona.net/apps/axona-minimal` (the ~60-line build-along), and
  the standalone `axona-net.github.io/axona-share`.
- **Docs:** the programmer trio (Quick Start · Programmer Guide · API Reference)
  is at **v3.6.0**; the architecture note is at **v0.8.4** (incl. the derived
  metric-topic mechanism). Per-release detail is in `RELEASE-NOTES.md`; the
  security-relevant items (owner-only metrics, etc.) are in `SECURITY-CHANGELOG.md`.

---

*The 3.6.0 rollout is **complete end-to-end** — `demo.axona.net`, `axona.net`, the
demo apps, the testnet fleet, and all three signaling bridges (east + west +
testnet, bridge v2.33.0) are on kernel 3.6.0, so owner-only-metrics and kill-re-fan
are now **enforced at the bridge-roots**. `apps/axona-share` (v0.12.0) also moved
to the reliable `publishChunkedBytes` send path, verified end-to-end on the live
testnet (600 KB → 56 chunks → a fresh reload-joiner reassembled byte-exact).*
