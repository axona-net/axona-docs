# Axona Pub/Sub Lifecycle & Access-Control Design — v0.2

**Status:** **Phase A SHIPPED in kernel v2.10.0 (2026-05-31)**; Phases B/C pending ·
**Builds on:** kernel v2.9.1 (envelope format v2 — signed per-publisher `seq` +
freshness window, findings C-2/E-4).

This document specifies a set of additions to the Axona pub/sub layer:

1. **`pull` semantics** — fetch latest, and a sliding hold time on read.
2. **`kill`** — creator-only message deletion with subscriber purge.
3. **Three access models** — open, owner-gated publish, and owner-gated publish +
   encrypted read.
4. **`unpub` / `unsub`** — owner drops a topic's queue; a subscriber removes itself.
5. **Bounded message queues** — per-topic max count (1…256), with size 1 acting as a
   retained "latest value" slot.
6. **Publisher-set max hold time** — per-message TTL, capped at 48 h.

Everything here is **self-authenticating** — no remediation or feature depends on a
certificate authority, a central trust server, or a reputation/identity service. All
authorization is a signature check against a key the network already verifies; all
read-confidentiality is end-to-end encryption. This is a hard project constraint.

---

## 0. What v2.9.0 (C-2) already gives us

Three primitives this design leans on are already shipped and deployed-pending:

- **Signed `seq`** — every signed envelope carries a per-publisher monotonic sequence
  number under the signature (`AxonaPeer._nextPubSeq`, wall-clock-seeded so it climbs
  across restarts). This is a **total order on a single publisher's stream** — the
  foundation for "latest" (`pull` with no msgId) and for deterministic bounded-queue
  eviction.
- **Signed `ts` + freshness window** — `MAX_PUBLISH_SKEW_MS` (300 s) bounds how far a
  live publish's signed timestamp may drift from real time. Checked at live ingress
  only; the replay-to-late-subscribers path is exempt.
- **Domain-separated signatures** (E-4) — `ENVELOPE_DOMAIN = 'axona:pubsub-envelope:v2'`
  is folded under the signature, so a pub/sub signature can't be lifted into another
  context. New signed object types below (ACL, config, kill, unpub) each get their own
  domain tag.

The recurring hard problem this design must solve repeatedly is **replica
consistency**: a topic is hosted by its K-closest root axons, which churn. Every
mutable thing we add — TTLs, message counts, ACLs, tombstones — must converge across
that replica set. The pattern used throughout is: **owner-signed, versioned,
self-authenticating objects + deterministic ordering keys (seq) + tombstones with
bounded GC.**

---

## 1. Topic ownership & the three access models

### 1.1 What exists today

`deriveTopicId(publisherNodeId, topicName)` (in `pubsub/post.js`) has two modes:

| Mode | topicId | Owner? |
|---|---|---|
| **Public** (`publisherNodeId = null`) | `00 ‖ sha256(name)` | none |
| **Publisher-keyed** | `s2prefix(owner) ‖ sha256(owner ‖ ':' ‖ name)` | the keying nodeId |

In publisher-keyed mode the topicId is **cryptographically bound to one creator**:
`verifyTopicOwnership()` + the B-4 ingress signature check already enforce "only the key
whose nodeId hashes into this topicId may publish here." That is a provable, single-
owner model — exactly the anchor we need. What's missing is the **allow-list** (more
than one publisher) and the **read-confidentiality** story.

### 1.2 The owner

> **Decision.** The *owner* of an owner-keyed topic is the identity whose nodeId seeds
> `deriveTopicId`. Ownership is proven by signing an owner-operation (ACL update, config
> update, `unpub`) with that key — no registry, no central record. **Public-mode (Model
> 1) topics have no owner**; owner-only operations are unavailable on them (see §1.4).

### 1.3 The three models

| Model | Publish | Read | Mechanism |
|---|---|---|---|
| **1 — Open** | anyone | anyone | public-mode topic (`00‖sha256(name)`), as today |
| **2 — Broadcast** | owner + allowed publishers | anyone | owner-keyed topic + owner-signed **publisher ACL**, enforced at root-axon ingress |
| **3 — Private group** | owner + allowed publishers | allowed members only | **Model 2's publish rules** + **payload encrypted to the member group key**; the DHT still carries ciphertext to anyone, but only key-holders can read it |

> **Model 3 per the product decision:** read-control is achieved by *shared encryption
> to the allowed set*, **not** by a subscriber ACL. Root axons do **not** authorize
> subscribers. This is the right call for a DHT: the K-closest root axons that host a
> topic are chosen by ID proximity, **not** by any ACL, so a subscriber allow-list could
> only gate *delivery*, never *exposure* — a root axon that isn't an authorized reader
> still sees every message. Encryption is the only thing that actually makes a private
> group private here. (Consequence: the protocol layer treats `message` as opaque
> ciphertext, exactly as the post.js end-to-end argument already states; key
> distribution and rotation are an **application-layer** concern — see §1.6.)

### 1.4 The publisher ACL (Models 2 & 3)

An owner-signed, versioned object stored on the topic's root axons:

```jsonc
{
  "kind":    "axona:pubsub-acl:v1",     // domain-separation tag (signed)
  "topicId": "<66-hex>",
  "epoch":   7,                          // monotonic; bumps on every change
  "publishers": [ "<pubkey-hex>", ... ], // allowed publisher pubkeys (owner implicit)
  "ts":      1716210000000,
  "ownerSig":"ed25519:<…>"               // owner key (the one keying topicId)
}
```

- **Ingress enforcement (root axon):** on `_onPublish`/`_onPublishDirect`, after the
  existing B-4 signature check, require `env.signerPubkey === owner` **or**
  `env.signerPubkey ∈ acl.publishers`. Drop otherwise (`publish-not-authorized`).
- **Distribution:** the ACL rides the same K-closest replication as the topic. A
  publisher can attach the current ACL epoch to its publish so a lagging root axon can
  detect it's behind and pull the newer ACL.
- **Revocation = bump `epoch`, drop a publisher.** Self-authenticating: a root axon
  accepts a higher-epoch ACL only if `ownerSig` verifies against the topic's owner key.
- **Eventual-consistency window (must document):** a revoked publisher may still be
  accepted by a root axon that hasn't yet seen the new epoch. Bounded by replication
  latency; the freshness window (C-2) caps how long any single message stays live.
  This is inherent to a leaderless replicated store and is acceptable; it is *not* a
  silent gap — log epoch skew.

### 1.5 Ownerless (Model 1) topics

Public-mode topics have no owner key, so: no ACL, no `unpub`, no owner-set config.
They use the **protocol defaults** — **`maxMessages = 100`, `maxHoldMs = 24 h`**
(decided) — for queue size and hold time (§5, §6). Per-message `kill` by the *message
creator* still works (creator = message signer), because that authority comes from the
message's own signature, not from topic ownership.

**Per-publisher quota (open topics only — decided).** Because anyone may publish to a
Model 1 topic, a single publisher can flood the bounded queue and evict everyone else's
messages (§5.3). Open topics therefore enforce a **per-publisher cap on how much of the
queue one `signerPubkey` may occupy** (proposal: ⌈maxMessages / 4⌉, min 1), so no single
anonymous publisher can flush the topic. **Owned topics (Models 2 & 3) do NOT get this
quota** — their publishers are already gated by the owner-signed allow-list, so the owner
is trusted to manage contention and an internal quota would only get in the way.

### 1.6 Key distribution for Model 3 (out of kernel scope, sketched)

The group key is distributed by the owner **encrypting it to each member's Ed25519/X25519
public key** (the same identities the network already uses). Practical options, app-layer:
a companion "key-envelope" topic the owner publishes member-wrapped keys to, or
out-of-band. **Revocation requires re-keying** (issue a new group key to the remaining
members) — heavier than bumping an ACL epoch, and the reason Model 3 membership churn is
costlier than Model 2's. The kernel only ever sees ciphertext in `message`.

> **Decision.** Group-key distribution is **fully application-layer** — the kernel ships
> no blessed convention. The planned **open-source reference application** built on Axona
> will implement Model 3 (member-wrapped group keys + re-keying on revocation) and serves
> as the worked example others can follow; if a genuinely common pattern emerges there, we
> can revisit promoting it to a kernel-level helper later.

---

## 2. `pull` — fetch latest + sliding hold

### 2.1 API

```js
// Today: peer.pull(topic, msgId) → envelope | null
// New:
peer.pull(topic, msgId?, opts?) → Promise<envelope | null>
//   msgId omitted  → the most recent message in the topic (highest seq; see §2.3)
//   msgId given    → that specific message, as today
```

### 2.2 "Latest" semantics

"Most recent" = the message with the **highest `seq` from the most recent publisher**,
tie-broken deterministically by `(ts, msgId)`. Because `seq` is signed and monotonic
per publisher (C-2), a single publisher's latest is unambiguous; across publishers in a
multi-publisher topic, `ts` then `msgId` give a total, replica-independent order. Root
axons already hold the replay cache; "latest" is the max of that cache under this order.

### 2.3 Sliding hold time — **with an absolute ceiling**

> **Decision (the critical one).** A `pull` resets a message's release time to
> `now + holdTime`, **but never beyond an absolute ceiling** `created_at +
> maxHoldTime` (the topic's configured hold, ≤ 48 h — §6). Reads can keep a hot message
> alive within its lifetime; they can **never** extend it past the ceiling.

Rationale: a naive "every pull resets the TTL" turns the max-hold-time guarantee (§6)
into a fiction and is a storage-exhaustion DoS — in an open topic, one attacker pulling
in a loop pins a message forever. The absolute ceiling makes the sliding window safe:
worst case a message lives exactly `maxHoldTime`, the same bound a no-pull message has.

```
effectiveExpiry = min( lastPull + holdTime , created_at + maxHoldTime )
```

- **Who may extend:** any reader (open topics included) — safe because of the ceiling.
- **Replica consistency:** the reset is **local to the serving replica** (a pull does
  not fan a TTL-write to all K replicas — that would make reads into K writes).
  Different replicas may therefore expire a message at slightly different times; this is
  acceptable (a pull from another replica simply re-extends locally, still bounded by
  the shared ceiling derived from the signed `created_at`/`ts`). The ceiling is computed
  from the **signed `ts`**, so all replicas agree on the hard deadline even if they
  disagree on the soft one.

---

## 3. `kill` — creator-only delete + subscriber purge

### 3.1 API

```js
peer.kill(topic, msgId) → Promise<{ ok: boolean }>
//   msgId is REQUIRED (unlike pull — no "kill latest" footgun).
//   Only the original message's signer may kill it.
```

### 3.2 Wire object (signed)

```jsonc
{
  "kind":    "axona:pubsub-kill:v1",   // domain tag (signed)
  "topicId": "<66-hex>",
  "msgId":   "<64-hex>",               // the message to delete
  "ts":      1716210000000,
  "seq":     1716210000123,            // killer's own seq (freshness/replay on the kill)
  "signerPubkey": "<pubkey-hex>",
  "signature":    "ed25519:<…>"
}
```

### 3.3 Authorization — self-authenticating

The kill is accepted **iff** its `signerPubkey` equals the `signerPubkey` of the message
identified by `msgId`. This requires the **msgId to be bound to the publisher** so a kill
can't target someone else's message.

> **Resolved (kernel v2.18.0).** `msgId = sha256(canonical({publisher, message}))`, where
> `publisher` is the signer's pubkey (null when unsigned). The msgId is now **directly
> publisher-bound** — a kill/touch can't target someone else's message because a different
> publisher hashing the same content yields a different id. The id is also time- and
> sequence-independent (a stable content address of the author+payload); a publisher that
> needs two otherwise-identical messages to differ adds a nonce to `message`. Belt-and-
> suspenders, the root axon still holds the original envelope in its replay cache, so it
> also checks `kill.signerPubkey === cachedEnvelope.signerPubkey` directly within the hold
> window.

### 3.4 Propagation & the tombstone

- **Tombstone.** Deleting the cache entry isn't enough — a lagging or rejoining replica
  still holding the message would re-gossip it and resurrect it. The root axon records a
  **signed tombstone** `{msgId, kill-proof}` and **keeps it for the message's remaining
  hold window** (then GCs — bounded, because the message itself would have expired).
  Re-arrival of a tombstoned msgId is rejected.
- **Subscriber purge (advisory).** The kill is forwarded to current subscribers as a
  `pubsub:deliver` with a delete marker so apps can drop their local copy.

> **Honesty note for the API docs.** `kill` is **best-effort redaction, not a
> cryptographic unsend.** A subscriber that already received the plaintext (or, in Model
> 3, the ciphertext + had the key) can keep it; an offline subscriber may never get the
> purge. `kill` must **not** be documented as a privacy/GDPR/recall guarantee.

### 3.5 DoS

Kill fan-out is an amplification vector — **rate-limit kills per publisher**, dedupe
(killing an already-killed/expired msg is an idempotent no-op), and apply the same C-2
freshness window to the kill object itself (the `seq`/`ts` above).

---

## 4. `unpub` / `unsub`

### 4.1 `unpub(topic)` — owner drops the whole queue

```js
peer.unpub(topic) → Promise<{ ok: boolean }>
```

- **Owner-only**, proven by signing an `axona:pubsub-unpub:v1` object with the topic
  owner key (the key that seeds topicId). Mirrors `kill` but at queue scope.
- **Unavailable on Model 1 (ownerless) topics** — there is no key to prove ownership.
- **Scope (decided):**
  - **`peer.unpub(topic)`** — drops all cached messages + emits a queue-level tombstone
    (so lagging replicas don't resurrect), but **keeps** the topic's owner-signed config
    and ACL, so the owner can keep publishing into the same topic afterwards.
  - **`peer.unpub(topic, { destroy: true })`** — **total removal**: messages **and** the
    owner-signed config/ACL **and** any ownership/role state are dropped, leaving nothing
    behind. The topicId can always be re-derived later, so the owner can re-create the
    topic from scratch — but it comes back with default config and an empty ACL, not its
    prior settings. Subscriber list is soft state and ages out either way.
- Same distributed-delete + tombstone discipline as §3.4.

### 4.2 `unsub(topic)` — subscriber removes itself

```js
peer.unsub(topic) → Promise<{ ok: boolean }>
```

- **Lowest-risk item.** Already partially present (`_onUnsubscribe`/`_onUnsubscribeDirect`
  enforce the B-1 invariant: a peer may remove **only its own** subscription, proven by
  `subscriberId === meta.fromId`). This formalizes the public API over it.
- Must **never** allow removing another peer's subscription (that would be a censorship/
  griefing primitive — the B-1 check already prevents it). Idempotent.

---

## 5. Bounded message queue (1…256, retained slot at 1)

### 5.1 Config

Per-topic `maxMessages ∈ [1, 256]`, default (proposal) `100` (today's
`DEFAULT_REPLAY_CACHE_SIZE`). Set by the owner in the signed topic-config object (§6.1).
`maxMessages = 1` is the **retained / latest-value** mode (a new publish replaces the
prior one) and pairs with `pull(topic)` (no msgId) for "give me the current value."

### 5.2 Eviction — deterministic across replicas

When the queue is full, **evict the lowest-ordered message** under the §2.2 order
(`seq`, then `ts`, then `msgId`). Because the order is derived entirely from signed
fields, every replica evicts the **same** message — no divergence. (Today's
`_addToReplayCache` is insertion-order FIFO; this changes it to ordered eviction.)

### 5.3 Security

- Bounding the count is itself a **DoS mitigation** (caps per-topic storage; reinforces
  D-1). Consider also a **total-bytes** cap, since 256 × 256 KiB × K ≈ tens of MiB per
  topic per replica.
- **Open-topic hazard → per-publisher quota (decided, Phase A).** Small queues +
  `pub = anyone` (Model 1) invite **eviction flooding** (one publisher fills `maxMessages`
  and flushes all legitimate history) and, at size 1, **retained-slot defacement**. Open
  topics therefore cap how much of the queue one `signerPubkey` may hold (⌈maxMessages/4⌉,
  min 1; see §1.5). Owned topics (Models 2/3) are gated by the publish ACL and are **not**
  subject to this quota.

---

## 6. Publisher-set max hold time (cap 48 h)

### 6.1 Topic config object (owner-signed)

```jsonc
{
  "kind":    "axona:pubsub-config:v1",   // domain tag (signed)
  "topicId": "<66-hex>",
  "epoch":   3,
  "maxMessages": 100,                     // 1..256
  "maxHoldMs":   86400000,                // ≤ 48h (172800000)
  "accessModel": 2,                       // 1 | 2 | 3
  "ts":      1716210000000,
  "ownerSig":"ed25519:<…>"
}
```

Hierarchy: **per-message TTL ≤ topic `maxHoldMs` ≤ global 48 h ceiling.** A publisher may
request a shorter hold on an individual message (a field on the publish); it can never
exceed the topic max, which can never exceed 48 h.

### 6.2 Clock trust

TTL and ordering both rest on timestamps, and timestamps are **publisher-supplied
(signed)**. A malicious publisher could back/forward-date to game expiry or ordering.
Root axons must **clamp `ts` to their own receive time ± `MAX_PUBLISH_SKEW_MS`** (already
true for the freshness gate) and compute the absolute hold ceiling from the **clamped**
value. Clock skew across replicas yields a small divergence in *soft* expiry only; the
*hard* ceiling agrees because it's derived from the signed, skew-bounded `ts`.

### 6.3 Ownerless topics

Model 1 topics use the protocol defaults — **`maxMessages = 100`, `maxHoldMs = 24 h`**
(decided) — fixed by the kernel, not first-publisher-wins (which would be an abuse
vector). The 48 h cap still applies as the absolute ceiling for owner-set values on
owned topics.

### 6.4 `touch` — keep-alive, gated by topic ownership (implemented; ownership gate kernel v2.16.0)

The complement of the sliding-on-`pull` hold (§2.3): an explicit keep-alive
that resets a message's release time **without requiring a read**.

```
peer.touch(topic, msgId, opts?) → Promise<{ ok: true }>
```

- **Authority — by topic ownership, self-authenticating** (mirrors the
  metrics/`unpub` access model, *not* `kill`'s creator-only one). A `touch` is
  a signed object (`axona:pubsub-touch:v1`) routed to the topic's K-closest
  roots (`pubsub:touch` / `touch-k`). A root decides owned/unowned from the
  message's anchor and authorizes accordingly:
    - **open topic** (ownerless — public, or a synthetic regional anchor
      `prefix‖0^256`): **anyone** may touch (any valid, fresh, signed touch);
    - **owned topic** (anchored at a real identity): only the **owner** —
      `sha256(touch.signerPubkey) === anchor[8:]` (the same pubkey↔nodeId bind
      `unpub` uses; only the 256-bit suffix is checked).
- **Effect on a holding root.** Resets `expiresAt = min(now + holdTime,
  created_at + maxHoldTime)` — extending life but **bounded by the same
  absolute 48 h ceiling** a `pull` respects (§2.3), so a `touch` can no more pin
  a message forever than a pull can. It then moves the entry to the **head of
  the queue** and stamps a `touchedTs` recency that dominates the bounded-queue
  eviction order (§5), so a touched message is evicted **last**.
- **Replica consistency.** The signed `touch.ts` is identical at every root that
  applies the same touch, so the eviction-order bump is convergent across
  replicas (unlike a pull's local-only slide). A root that misses a touch simply
  re-converges on the next one.
- **Abuse bound.** Creator-only authority plus the per-publisher open-topic
  quota (§5) mean a flooder can't use `touch` to pin more than its share, and
  the 48 h ceiling bounds total lifetime regardless.

---

## 7. New wire messages (summary)

| Message | Path | Auth | Notes |
|---|---|---|---|
| `pubsub:pullReq` (extended) | routed | open (Model 1/2) / ciphertext (3) | msgId optional → latest |
| `pubsub:kill` | routed → root | message-signer sig | tombstone + subscriber purge |
| `pubsub:touch` / `touch-k` | routed / direct → roots | message-signer sig | reset hold (≤ ceiling) + head-of-queue keep-alive |
| `pubsub:unpub` | routed → root | owner sig | queue drop + tombstone |
| `pubsub:acl` | replicated | owner sig, epoch'd | publisher allow-list (Models 2/3) |
| `pubsub:config` | replicated | owner sig, epoch'd | maxMessages / maxHoldMs / accessModel |
| `pubsub:unsubscribe(-k)` (exists) | routed/direct | self (B-1) | formalize `peer.unsub` over it |

Each signed object carries its **own domain tag** (E-4 discipline): `axona:pubsub-kill:v1`,
`…-touch:v1`, `…-unpub:v1`, `…-acl:v1`, `…-config:v1` — so no signature is reusable across object types.

---

## 8. Security analysis (condensed)

| Feature | Primary risk | Mitigation in this design |
|---|---|---|
| pull → latest | wrong/forged "latest" in open topics | order by signed `seq`/`ts`; Model 2/3 gate publishers |
| pull sliding TTL | **TTL-pinning storage DoS** | **absolute ceiling** from signed `ts`; local-only reset |
| kill | forged delete / censorship | signer-match against stored envelope; signed kill; rate-limit |
| kill purge | false "unsend" expectation | documented as **advisory**, not a guarantee |
| resurrection after delete | lagging replica re-gossips | **signed tombstone**, bounded GC |
| ACL (M2/3) | revoked publisher still accepted | owner-signed epoch; bounded eventual-consistency window, logged |
| Model 3 privacy | root axon sees content | **E2E encryption**; no reliance on sub-ACL |
| bounded queue | eviction flooding / defacement (open) | deterministic eviction; ACL-gate small queues; per-publisher quota |
| max hold | publisher back/forward-dating | clamp `ts` to receive-time ± skew; hard ceiling off clamped ts |
| unsub | griefing (remove a victim) | B-1 self-only invariant (already enforced) |
| all mutable state | replica divergence under churn | owner-signed versioned objects + signed-field ordering + tombstones |

---

## 9. Phasing

1. **Phase A — ✅ SHIPPED (kernel v2.10.0)** — lifecycle on the existing single-owner model (no ACL yet):
   `peer.unsub` (formalize) → `peer.kill` + tombstones → `peer.unpub` (+ `{destroy:true}`
   total removal) → bounded queue (ordered eviction, default `maxMessages=100`) +
   **per-publisher quota on open topics** + absolute-ceiling TTL (default/ceiling
   `maxHoldMs=24 h`, cap 48 h) + `pull`-latest. All of this works on today's owner-keyed +
   public topics and needs no new trust object beyond the kill/unpub/config signatures.
2. **Phase B — Model 2** publisher ACL (owner-signed, epoch'd) + ingress membership check.
3. **Phase C — Model 3** = Model 2 + app-layer group-key encryption (kernel unchanged;
   document the key-distribution pattern + the re-keying-on-revocation cost).

Each phase is its own kernel release with smoke tests + the standard re-vendor →
SECURITY-CHANGELOG (for the authorization-relevant parts) → coordinated deploy.

---

## 10. Resolved decisions (2026-05-31)

All five review questions are settled; this section is the record.

1. **Default `maxMessages` / `maxHoldMs` for ownerless (Model 1) topics → `100` / `24 h`.**
   Kernel-fixed; the 48 h cap remains the absolute ceiling for owner-set values on owned
   topics. (§1.5, §6.3)
2. **Per-publisher quota → ship in Phase A, OPEN (Model 1) topics ONLY.** Caps how much of
   the bounded queue one `signerPubkey` may occupy (⌈maxMessages/4⌉, min 1) so an anonymous
   publisher can't flush the topic. Owned topics (Models 2/3) are exempt — the owner-signed
   publish ACL already governs who may publish, and an internal quota would only get in the
   owner's way. (§1.5, §5.3)
3. **`unpub { destroy: true }` → total removal.** Messages **and** owner-signed config/ACL
   **and** ownership/role state are dropped. Plain `unpub` (no flag) drops only the message
   queue and keeps config/ACL so the owner can keep publishing. (§4.1)
4. **Kill tombstone lifetime → the remaining hold window is sufficient** (≤ 48 h on a
   max-hold topic). Acceptable storage for now; revisit if it proves heavy in practice. (§3.4)
5. **Group-key transport for Model 3 → fully application-layer; no kernel convention.** The
   planned open-source reference application implements it (member-wrapped keys + re-keying
   on revocation) and stands as the worked example; promote to a kernel helper only if a
   common pattern clearly emerges. (§1.6)
