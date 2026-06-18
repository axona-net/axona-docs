# Axona Identity & Authorship — Design Model

**v0.3 · draft for stakeholder sign-off · 2026-06-17**

> Purpose: state, from first principles, **what the identity system is for** —
> clearly enough that a stakeholder, an engineer, and a customer can each read it
> and agree it is the correct thing. It is the design we build *to*.
>
> **Changed in v0.3** (from Howard's review):
> - §1 location claim **softened to what the protocol actually guarantees** —
>   messages never carry location; defeating a *network observer's* traffic
>   analysis is out of scope for v1.
> - §2/§3 addressing made **inputs→outputs explicit**, and stated plainly that the
>   topic **name ≠ Topic ID**.
> - §3 fixed the misplaced "who signed / never where" sentence under Node Identity.
> - **D7** — a topic's *write policy* (open vs owner-only) is now **separate from
>   namespacing**, enabling author **inboxes/walls** (post *to* someone).
> - **D6** — topic **region is explicit, or defaults to the publisher's own node
>   region** when omitted; it is **never derived from the author key** (an Author ID
>   has no region). Reverses the earlier "key-derived placement" idea, which would
>   have manufactured a hot spot on a handful of arbitrary regions.
> - Region **name ↔ code ↔ lat/lng** + the populated-region list become a
>   first-class protocol module (§8).

---

## Terms — read this first

**An *Identity* is a keypair you hold. An *ID* is the public identifier derived
from it.** A **Node Identity** (keypair) yields a **Node ID** (address); an
**Author Identity** (keypair) yields an **Author ID** (public author identifier).
Read "…Identity" as *private key you keep*; "…ID" as *public string others see*.

Glossary:
- **S2 region** — the Earth divided into cells (Google's S2 grid); a node's or
  topic's region is one byte naming a real cell, shown as a name like `us-east`.
- **DHT** — distributed hash table: address-based routing that locates the nodes
  responsible for a given ID.
- **key-space** — the 264-bit space all IDs share; "near" = XOR-close (how the DHT
  decides who holds what).
- **channel-bound** — the handshake proves a peer controls its key *and* the live
  connection, so a stolen key can't impersonate it on another wire.
- **`kill` / `unpub`** — an author retracting its own content: `kill` tombstones one
  message; `unpub` removes a whole topic the author owns.

---

## 1. The problem we are actually solving

Axona is a decentralized pub/sub network. Its identity system must resolve a real
tension between three things people want at once:

- **Trust** — a reader must be able to prove *who* authored a message, that it
  wasn't forged or tampered with, and (if the author chooses) recognize that author
  later and let them retract their own posts.
- **Privacy** — being online, or being somewhere, should not create a durable,
  trackable identity, and an author should be able to be *pseudonymous* or
  *anonymous*. The **hard guarantee here is narrow and exact: no message ever
  carries location** (§5·3). It does **not** defend against a *network observer*
  who can watch your connection — defeating traffic-analysis of *where* you are, or
  that two personas share one device, would need cover traffic / extra hops, which
  **v1 does not do**. We claim only what we deliver.
- **Addressing** — the network must route messages, locate topics, and detect
  duplicates **regardless of who** (or whether anyone) is identified.

Most systems fail this by using **one identity for everything** — the same key
proves your connection, names you as author, and tags your location, so privacy and
trust fight each other. Axona's premise is the opposite: **separate the concerns,
give each its own primitive, and never let one do another's job.**

## 2. The three concerns, and exactly one primitive each

| Concern | The question it answers | Primitive | Key property |
|---|---|---|---|
| **Connection** | "Which node is this, and is it really it on the wire?" | **Node Identity** (keypair) → **Node ID** | authenticated, but **ephemeral** |
| **Authorship** | "Who is accountable for this message, provably?" | **Author Identity** (keypair) → **Author ID** | provable, optionally **durable**, may be **several** |
| **Addressing** | "Where does this live / is it a duplicate?" | **Topic ID** and **Message ID** | deterministic, **identity-independent** |

Three concerns, three primitives. Two consequences are the heart of it:

1. **Connection ≠ Authorship** — different keys, opposite lifetimes. The connection
   key is thrown away and re-minted each run (being online isn't trackable); the
   author key is the thing you keep (your authorship is recognizable). Either can
   change without disturbing the other.
2. **Addressing ≠ Identity** — where a message lives and whether it's a duplicate
   come from content and topic, not from who you are. Concretely, these are
   *outputs* of plain *inputs*: the **Topic ID** ← `(region, owner?, name)`, and the
   **Message ID** ← `(Author ID, message)`. Routing and dedup work for anonymous
   senders too.

## 3. The primitives, precisely

### Node Identity — the connection
- An Ed25519 keypair, plus a derived **Node ID** = `regionByte ‖ SHA-256(pubkey)`.
- **Ephemeral by default** — minted fresh in memory each run, never stored; a
  restarted node re-joins as a new node. (You *may* persist it for a stable
  address, at the cost of linkable connections — rare.)
- Used for: the connection handshake (channel-bound), DHT routing, **subscribing**,
  and direct node-to-node messages.
- **Never signs a published message** (hard rule, §5). Also called the "node key";
  the code/wire also call it the *transport* key — same thing.
- Your region byte lives **only inside the Node ID, which itself never appears in a
  message** — so your region never leaves your node. (*Who* authored a message is
  disclosed, via the Author ID on the envelope — see Authorship — but *where* the
  author is, is not.)

### Author Identity — the authorship
- An Ed25519 keypair. Its public key is the **Author ID** (the code/wire call it
  `signerPubkey`). This is the identity that appears on a message.
- **Signs every accountable publish.** The signature covers the message, so a reader
  can verify authorship + integrity and recompute the Message ID.
- Carries **authority over what it authored**: only the author key can `kill` or
  `unpub` its own content, and can own a topic.
- **Has no location and no Node ID.** Authorship is not a place.
- **Durability is the author's choice** — and the *only* real choice in the system:
  **persist it** (recognizable across sessions, can retract later) or **mint per
  run** (one-shot, unlinkable).
- **An app may hold several** author identities (personas), choosing which signs each
  message. **Anonymous publishing** is also allowed (no author, unsigned) — always
  stated explicitly (§6), never the result of forgetting to name a signer.

### Topic ID and Message ID — the addressing

A topic is identified by **(region, owner?, name)** plus a **write policy**. From
these, everyone who knows them computes the same **Topic ID** and converges on the
same nodes.

- **name** — the human label (`"lobby"`). It is an **input**; the **Topic ID** is the
  derived 264-bit address `regionByte ‖ SHA-256(…)`. **name ≠ Topic ID.**
- **owner** (optional) — an **Author ID** (public key) that *namespaces* the topic.
  Present → the topic is anchored to that author; absent → an unowned, shared topic.
- **write policy** — who may publish, and it is **separate from namespacing** (D7):
  - **open** — anyone may publish; each message is signed by its own author.
  - **owner-only** — only the owner's author key may publish (requires an owner).
  The policy is folded into the Topic ID, so roots enforce it statelessly; for
  owner-only, roots require each publish be signed by the owner.

  The three shapes that result:
  | Shape | Address | Who writes / reads |
  |---|---|---|
  | **Open lobby** | `(region, name)`, open | anyone writes, anyone reads |
  | **Author feed** | `(region, owner, name)`, owner-only | only owner writes (profile/broadcast); anyone reads |
  | **Author inbox** | `(region, owner, name)`, open | anyone writes (signed as self); owner reads |

  *"Reach author X"* = the inbox shape: put **X's Author ID as `owner`**, sign with
  **your own** key. (Confirms Howard's pattern — it works precisely because write
  policy is decoupled from namespacing.)

- **Placement — the `regionByte`** — **always a real, populated region; never
  global** (a single prefix would funnel a topic's whole traffic onto the few nodes
  nearest it: an unscalable hot spot + single point of failure). Set one of two ways:
  - **explicit** — name any real region in the descriptor. For topics whose full
    `(region, owner, name)` reference you share out-of-band, or where the app wants a
    deliberate region (e.g. a city lobby).
  - **omitted → the publisher's own node region** — when `region` is absent, the
    `regionByte` defaults to the top byte of the *publisher's* Node ID (the real S2
    cell it already occupies). Two co-located peers converge on the same topic id
    with no region named; reading the feed from elsewhere means naming the region
    explicitly.

  **Region is never derived from the author key.** An Author ID is location-free — it
  has no region — so there is nothing real to recover from it. Hashing an Author ID
  into a region byte (`aRealRegion(SHA-256(ownerId))`) was considered and **rejected**:
  the hash lands on an *arbitrary* cell, those cells cluster in the few populated
  regions whose IDs happen to sit closest to the hash outputs (many hashes map to the
  ocean and snap to the nearest land region), and the result is a **manufactured hot
  spot** — every author's "discoverable" topic piled onto a handful of unlucky regions,
  the exact unscalable funnel the real-region rule exists to avoid. So discovery of an
  author's feed needs **both** the Author ID **and** the region it was published in;
  region is a shared coordinate that travels with the topic reference, and is **never**
  re-derived from the reader's region either. *(Future: restrict choosable regions to
  populated/land cells.)*

- **No global broadcast primitive.** A topic the whole world must see picks one real
  region (a deliberate, app-visible hot spot) or is sharded across regions at the app
  layer. The protocol offers no single global fan-out, by design.

- **Message ID** — a content address `SHA-256(Author ID + message)` (anonymous → no
  Author ID, so `SHA-256(message)`). Every receiver recomputes it, so it can't be
  forged and it dedups identical authored content. **Not routing, not identity.**
  This is the dedup mechanism — there is no separate `publishId` (§9·D1).

## 4. The mental model in one paragraph

You connect with a **throwaway node key** (nobody can track that you were online).
You sign what you publish with an **author key you keep** (so readers can trust and
recognize you, and you can delete your own posts) — or you publish **explicitly
anonymously**. Messages are filed by **content**, and topics by **region + name
(+ optional owner)**, so the network routes and de-duplicates without caring who you
are. To find a specific author's public profile or message them, you derive their
topic **from their Author ID**. That's it.

## 5. Invariants (the rules that must always hold)

Non-negotiable; a change that violates one is a security regression.

1. **No key does two jobs.** The node key signs the connection handshake and nothing
   else; the author key signs publishes and nothing else. Re-using one key for both
   is refused. (The node key may sign a publish *only* if passed explicitly as the
   signer — an escape hatch, never a default, discouraged.)
2. **Authorship is provable and self-contained.** Every accountable message carries
   its Author ID + a signature over the message; receivers verify it and recompute
   the Message ID. Authenticity never depends on transport, routing, or any unsigned
   field — and a forwarder can never make one author's content look like another's.
3. **Location is never disclosed by the protocol.** No message ever contains a
   region, coordinate, or Node ID. The region byte exists only inside the ephemeral
   Node ID and is self-asserted. (This is a message/reader guarantee, *not* a defense
   against a network observer's traffic analysis — §1.)
4. **Addressing is identity-independent.** Topic ID and Message ID are computable for
   anonymous and rotating publishers alike.
5. **Durability and plurality are the author's choice, the node's is not.** The
   author key may be persisted and may be one of many; the node key is ephemeral and
   singular per session.

## 6. How a developer uses it (the contract)

The entire identity surface a developer touches:

```js
// 1) Connection identity — needs your location; yields your Node ID (routing
//    address). Ephemeral: minted fresh each run.
const node = createNodeIdentity({ lat, lng });

// 2) The peer IS the node. (AxonaPeer also takes mesh wiring — `domain`, `transport`
//    — connection plumbing documented with the transport layer, not identity.)
const peer = new AxonaPeer({ nodeIdentity: node, domain, transport });

// 3) Author identity — NO location. Ephemeral, or durable via one option:
const me = createAuthorIdentity({ persistAs: 'me' });   // reload 'me' if saved, else create + save
//    me.authorId → your public Author ID. 'me' is a LOCAL storage label, not a network name.

// 4) Your region — the default placement for topics you create:
peer.region;   // → { code: 0x4b, name: 'us-east' }

// PUBLISH — every publish names its signer (an author, or ANONYMOUS); no default.
await peer.pub({ name: 'lobby' }, msg, { signWith: me });                       // open lobby, your region
await peer.pub({ name: 'lobby', region: 'us-east' }, msg, { signWith: me });    // …a chosen region
await peer.pub({ name: 'lobby' }, msg, { signWith: ANONYMOUS });                // explicitly anonymous

// AUTHOR FEED (profile/broadcast) — owner-only; name a region so others can find it:
await peer.pub({ region: 'us-east', owner: me.authorId, name: 'profile', write: 'owner' }, profile, { signWith: me });
//    readers need my Author ID AND this region (region is omitted ⇒ my node region).

// AUTHOR INBOX — post TO someone: their Author ID as owner, signed with YOUR key:
await peer.pub({ region: 'us-east', owner: aliceAuthorId, name: 'inbox', write: 'open' }, msg, { signWith: me });

// SUBSCRIBE — same address; uses the node identity, needs no author key:
await peer.sub({ name: 'lobby' }, onMsg, { since: 'all' });                                          // open lobby (my node region)
await peer.sub({ region: 'us-east', owner: aliceAuthorId, name: 'profile' }, onMsg, { since: 'all' }); // read Alice's profile (owner + region)
await peer.sub({ region: 'us-east', owner: me.authorId, name: 'inbox' }, onMsg, { since: 'all' });    // read my own inbox
// onMsg receives each message with its Author ID (or none, for anonymous).
```

The two identity factories — the whole creation surface:

| Need | Call |
|---|---|
| Connection identity | `createNodeIdentity({ lat, lng })` |
| Author, ephemeral | `createAuthorIdentity()` |
| Author, durable | `createAuthorIdentity({ persistAs: 'me' })` *(or `{ persistAs, store }`)* |

Rules a developer must internalize, and nothing more:
- **A peer is a node**, built from its node identity alone (plus mesh wiring). It can
  connect, route, subscribe, and `host()` with no author key.
- **Every signed publish names its signer** — `signWith: <author>` or
  `signWith: ANONYMOUS`. No default, no fallback to the node key; omitting a signer is
  an **error**.
- **A topic is `(region, owner?, name)` + a write policy** — addressing, not
  identity. `region` is any real region you name (never global), or defaults to the
  **publisher's own node region** when omitted — **never derived from the author key**;
  `owner` is an **Author ID** (public key) that namespaces it; `write` is `open` or
  `owner` (decoupled from whether there's an owner); `name` is the label.
- **Persist an author (`persistAs`) only** if you want to be recognized across
  sessions / retract later — the only persistence decision most apps make.

> **Why authorship is not a constructor argument.** The node identity is *intrinsic*
> to a peer; an author identity is not — it's used at exactly one moment, signing a
> publish, and a peer may have zero authors (subscribe-only) or many (personas). So a
> peer holds no author, and every publish names its signer explicitly. There is no
> peer-level default author — it would re-couple connection and authorship and hide
> the per-message model.

## 7. Naming — what we call things, and what we retire

| Concept | Canonical name | Retired |
|---|---|---|
| Connection keypair / address | **Node Identity** / **Node ID** | "transport identity/key" — same thing, code/wire term |
| Authorship keypair | **Author Identity** | ~~publish identity~~ |
| Author's public identifier | **Author ID** | ~~signerPubkey~~ (wire field keeps the name) |
| Create an identity | **`createNodeIdentity`**, **`createAuthorIdentity`** | ~~`deriveIdentity`~~, ~~`loadOrCreateAuthor`~~, ~~`dumpIdentity`/`loadIdentity`~~ |
| Choose the signer | **`signWith`** (an author, or `ANONYMOUS`) | ~~`sign: false`~~, ~~`useAuthor`~~ / any default author |
| Topic address | **`(region, owner?, name)` + write policy** | ~~`publisher`~~, ~~"anchor"~~ |
| Topic placement | **explicit region**, else the **publisher's node region** (real regions only) | ~~global / `0x00`~~, ~~key-derived from the author~~ |
| Per-event dedup | the **Message ID** | ~~`publishId`~~ / ~~`persistentPublisher`~~ |

## 8. Build checklist (make the code match this model)

1. **Two factories** — `createNodeIdentity({lat,lng})`, `createAuthorIdentity({persistAs?,store?})`;
   author keys are **location-free**; `dumpIdentity`/`loadIdentity` become internal.
2. **Topic addressing = `(region, owner?, name)` + write policy** — replace the
   `publisher` parameter (deprecated alias one release). Fold `owner` + `write` +
   region into the Topic ID derivation so roots can enforce **owner-only** writes
   statelessly (verify each publish's `signerPubkey` == owner).
3. **`AxonaPeer({ nodeIdentity, domain, transport })`** — no author key in the
   constructor; no default-author mechanism. `signWith` per `pub()`; missing signer →
   error; remove the `sign:` boolean.
4. **Region default (D6)** — when a publish omits `region`, resolve the `regionByte`
   to the **publisher's own node region** (the top byte of its Node ID); the region is
   **never** derived from the author key. The peer supplies its node region to the
   addressing layer (only the peer knows it).
5. **Region module in the protocol (not example code)** — `name ↔ code ↔ lat/lng`
   converters **and the canonical list of populated/valid regions** (what the
   node-region default and the land-only future note require). `peer.region` →
   `{ code, name }`.
6. **`publishId` removed** (§9·D1); dedup is the Message ID.
7. **Thread `signWith` through `publishChunkedBytes`** so chunked transfers choose
   their author.
8. **Rewrite the team update** strictly to this model once signed off.

## 9. Decisions — resolved

All settled; only D2 carries a remaining *process* approval (when to ship).

**D1 — `publishId` removed.** Dedup is the Message ID = `SHA-256(Author ID +
message)`; ordering is the signed `seq`. The separate *unauthenticated* token added
nothing those two don't. **Removed.**

**D2 — Renames as one flag-day (process approval pending).** `identity` →
`nodeIdentity`; author key out of the constructor; `publisher` → `(region, owner?,
name)` + write policy; `publishId` gone; identity creation → two factories;
`useAuthor` not added. *Open item: approve shipping as one documented flag-day with a
single release of deprecated aliases.*

**D3 — Author keys are location-free.** `createAuthorIdentity()` takes no location.
**Confirmed.**

**D4 — Topic placement and ownership.** Region is **always a real region, never
global**; publisher-chosen, default `peer.region`. Owned topics namespaced under the
owner's **Author ID**. Open topics retained. **Confirmed.**

**D5 — Identity surface consolidated; one signer path.** Two factories;
`useAuthor`/default-author dropped; every publish names its signer with `signWith`
(or `ANONYMOUS`). **Confirmed.**

**D6 — Region is explicit, else the publisher's node region; never author-derived.**
A topic's `regionByte` is the region named in the descriptor, or — when `region` is
omitted — the **publisher's own node region** (the top byte of its Node ID, a real
S2 cell it occupies). It is **never** derived from the author key. *(Revised — was
"key-derived placement," `regionByte = aRealRegion(SHA-256(ownerId))`.)* That idea was
**rejected**: an Author ID has no region, so hashing one yields an *arbitrary* cell;
those cells cluster onto the handful of populated regions whose IDs sit closest to the
hash outputs (most of the hash space maps to ocean and snaps to the nearest land),
manufacturing exactly the hot spot the real-region rule exists to prevent. Discovering
an author's feed therefore needs **both** the Author ID **and** its region (named
explicitly, or shared with the topic reference). **Confirmed** (revised after the
hot-spot analysis).

**D7 — Topic write policy is separate from namespacing.** A topic's *namespace*
(optional `owner`) and its *write policy* (`open` vs `owner-only`) are independent.
This yields three shapes — open lobby, author feed (owner-only), author inbox (open) —
and makes "post *to* an author" a first-class pattern: owner = their Author ID, sign
with your own key. **Confirmed** (resolves Howard's "how is a touch addressed").

---

### Sign-off

Correct and complete when the four parties agree:

- [ ] **Engineering** — the three-primitive model + invariants (§2, §5) are
  implementable and the build checklist (§8) is accurate.
- [ ] **Product / you** — the goals (§1) are right and the decisions (§9) are settled.
- [ ] **Customer-facing** — the one-paragraph model (§4) and the contract (§6) are
  followable by an app author without surprise.

Once signed off: settle D2's timing, build §8, then rewrite the team update strictly
to this model — built to the design, not patched toward it.
