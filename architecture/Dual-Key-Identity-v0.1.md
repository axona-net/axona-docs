# Dual-Key Identity — separating the transport identity from the publish identity

**Status:** design proposal (v0.1). Additive, backward-compatible, **no wire/flag-day change**.
**Targets:** `@axona/protocol` kernel (gated: new tag + re-vendor + app adoption).

## 1. Problem

Today a node has **one** Ed25519 keypair (`deriveIdentity`). It does two unrelated jobs:

1. **Transport identity** — derives the node id, authenticates the connection (handshake + channel binding), routes in the DHT.
2. **Publish identity** — signs every pub/sub envelope (`signerPubkey`), and is the basis for `kill`/`unpub` authority and owned-topic ownership.

Because they're the *same* key, an app is forced into a bad trade-off:

- **Ephemeral identity (default):** transport is unlinkable across sessions — but you lose durable authorship (your `signerPubkey` changes every run; you can't recognize a sender across sessions or `kill` your own past messages).
- **Persistent identity:** you get durable authorship — but now your transport identity is stable too, so your *connections* are linkable across sessions.

You can't currently have both "recognizable, accountable author" **and** "unlinkable, throwaway network presence." Splitting the key gives you both.

## 2. Proposal

Give a node **two** keypairs:

| | Transport identity | Publish identity (new) |
|---|---|---|
| Lifetime | **ephemeral** — fresh per session | **persistent** — app-owned |
| Derives | node id, DHT address | (its own `signerPubkey`; a publisher nodeId for owned topics) |
| Signs | the connection handshake (channel-bound) | every pub/sub **envelope** |
| Authority | connect, subscribe, route, direct-message | `kill`/`unpub`, own a topic |
| Linkable to a connection? | yes (by design, but disposable) | **no** — never appears in the channel handshake |

The publish identity becomes a **stable pseudonym** for authorship that has **no cryptographic link** to the rotating transport key or to any specific connection.

## 3. Why the kernel is already 90% there

Every authorship-relevant mechanism is **already keyed on `signerPubkey`, not on the transport node id** (verified in kernel v2.49.0):

- **Ingress verification** (`verifyEnvelope`) only requires `signature` valid for `signerPubkey` + `msgId` recompute. There is **no check that `signerPubkey` equals the connected peer's transport id** — a different signing key already passes.
- **Per-publisher sequence / freshness** (`_publisherSeq`, finding C-2) is keyed by `signerPubkey`.
- **`kill` / `unpub` ownership** hashes the *signer's* pubkey to a nodeId and matches the topic owner — the signing key, never the connection.
- The envelope on the wire and at rest carries `signerPubkey`, `signature`, `msgId` — **no transport id**.

The **only** coupling is one line: `peer.pub` signs with `this._identity` (the same object handed to `webTransport`). Decouple that and the design exists. Because verifiers already check against whatever `signerPubkey` is present, **no wire change and no flag day** — a dual-key publisher and a single-key publisher interoperate.

## 4. API shape (proposed)

```js
const transport      = await deriveIdentity({ lat, lng });          // ephemeral — webTransport + node id
const publishIdentity = await loadOrCreatePublishIdentity();         // persistent — dumpIdentity/loadIdentity

const peer = new AxonaPeer({
  domain, node, transport,
  identity:        transport,        // transport/network identity (handshake, routing)
  publishIdentity,                   // NEW — signs pub/sub envelopes; omitted ⇒ falls back to `identity`
});
```

- **Default / backward-compatible:** if `publishIdentity` is omitted, `peer.pub` signs with `identity` exactly as today (single-key behavior). Existing apps are unaffected.
- Envelopes sign with `publishIdentity` ⇒ `signerPubkey` = publish pubkey; the transport key never enters the envelope.
- (Optional later: a per-call `{ signWith }` override so one peer can publish under several publish identities — analogous to running several `std/publisher` streams.)

## 5. Implications to design in

1. **Owned-topic anchor must follow the publish key.** `peer.pub` currently defaults the topic anchor (`publisher`) to the transport node id. For an *owned* topic that must default to the **publish key's** nodeId — otherwise ownership binds to the ephemeral transport id and breaks across sessions. Apps that pass an explicit `publisher` (e.g. a region-synthetic anchor — axona-share, axona-minimal) are unaffected.
2. **PoW domain separation.** The transport key mints a `role:'transport'` PoW. The publish key needs its own `role:'publish'` PoW so the two anti-Sybil puzzles are not interchangeable. Inert today (difficulty 0) — no blocker, but bake the role in now.
3. **No channel binding on the publish key — and that's the point.** A publish signature proves authorship, not "present on this connection." Don't expect it to attest channel presence (that's the transport key's job, via the CBV).
4. **Scope: pub/sub only.** Transport-level operations — connect, **subscribe** (origin check is `subscriberId === fromId`), route, direct `send`/`notify` — stay on the transport identity. The publish identity governs **publishes, `kill`/`unpub`, and owned-topic ownership**.
5. **`publishId` is unchanged** — still an opaque dedup token. "Associated with the actual publisher" is answered by the **signature** (`signerPubkey` = the publish identity). To bind a specific event id, embed it in `message` (now signed by the publish key).
6. **Two persistence stories, cleanly separated.** Persist the **publish identity** for authorship; leave the **transport identity** ephemeral. `std/publisher` (publish-id dedup continuity) is still orthogonal and optional.

## 6. Unlinkability — honest scope

- **At rest / across sessions: unlinkable.** Stored and replayed envelopes contain only the stable publish pubkey; the rotating transport id never appears. An observer correlating connections cannot tie them to the publish identity, and vice-versa.
- **First hop is the exception.** The peer/relay you hand a publish to *over your transport connection* sees, at that instant, both your transport identity and the publish-signed envelope, so it can locally correlate the two. Onward hops and storage cannot. Standard "entry node sees you" limitation; mitigate by publishing through a relay/`host()` node when that correlation matters.
- **Timing/volume side-channels** (a publish always immediately following a particular connection) are out of scope for the crypto and remain an app/operational concern.

## 7. Open questions for the team

- **Where does the publish identity live by default?** App-managed (recommended: `dumpIdentity`/`loadIdentity` in app storage), or an opt-in kernel `PersistenceAdapter` slot distinct from any transport persistence?
- **One publish identity per peer, or many?** A per-call `signWith` override enables multiple author personas from one connection (e.g. per-channel pseudonyms). Worth it, or YAGNI for v1?
- **Owned-topic default anchor:** auto-derive from the publish key when `publishIdentity` is set, or require apps to pass it explicitly (less magic, fewer surprises)?
- **PoW role string + verifier:** confirm `role:'publish'` and that ingress checks the publish-role puzzle (currently inert).

## 8. Phased plan

1. **This note** — team review of the model + the open questions above.
2. **Prototype (gated):** thread `publishIdentity` through `AxonaPeer`/`buildEnvelope` behind a smoke test (single-key default preserved; dual-key signs + verifies + `kill`s across a simulated transport-id rotation). No deploy.
3. **Cut a kernel tag**, re-vendor consumers, update the [team update](../TEAM-UPDATE-v2.51.md) §2/§3.2.
4. **App adoption:** apps that want durable authorship + unlinkable transport opt in by supplying a persisted `publishIdentity`.

— v0.1, drafted 2026-06-16.
