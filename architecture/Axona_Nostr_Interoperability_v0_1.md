# Axona × Nostr Interoperability

**Version 0.1 — 2026-08-13**
**Status: design proposal for review**

---

## 0. Summary

Nostr and Axona agree almost exactly on identity and disagree almost entirely on transport. Nostr publishes signed events authored by a keypair, with no platform account — the same premise as Axona. But Nostr moves those events through **relays**: servers that store events and answer client queries. Resilience comes from running many of them and hoping enough stay honest, rather than from removing the server role.

That relay tier is the seam. This document specifies how Axona can occupy it — not by asking Nostr clients to port to a new protocol, but by presenting the interface those clients already speak while the servers behind it disappear.

Three decisions make this work:

1. **A local relay adapter** presents a standard Nostr relay endpoint to an unmodified client and is backed by Axona rather than by a stored-event server.
2. **Axona's rolling topic cache** — twenty-four hours or the last 1,024 messages, queryable by timestamp — serves the backfill that clients expect from relay storage, with an added **author dimension** so the transport answers author-scoped, time-scoped queries natively.
3. **Identity unification.** Axona's signature scheme moves to secp256k1 with Schnorr signatures, matching Nostr. A Nostr key becomes a first-class Axona identity. This is the keystone: without it every path below needs a key-translation shim, and with it the two systems share a namespace.

The result is not a bridge between two networks. It is one identity, one signature scheme, and a transport with no relay tier, presenting the interface Nostr clients already use.

---

## 1. What Nostr is

Stated briefly, because the design below depends on the specifics.

**Identity is a keypair.** A user is a secp256k1 public key. Signatures are Schnorr (BIP-340), and public keys are x-only, 32 bytes. There is no registration and no account.

**Everything is a signed event.** An event carries the author pubkey, a creation timestamp, a numeric `kind`, a list of `tags`, a `content` string, an `id` that is a hash over the canonical serialization of those fields, and a signature over that id. Kinds partition the semantics: metadata, text notes, contact lists, direct messages, and a long tail of application-specific kinds. Tags carry references — to other events, to other pubkeys, to hashtags.

**Transport is relays.** A client opens a WebSocket to a relay and speaks a small vocabulary: publish an event; open a subscription with a set of filters; close a subscription. The relay answers with matching stored events, a marker indicating stored events are exhausted, then a live tail of new matching events as they arrive.

**Filters are queries.** A filter selects on event ids, authors, kinds, tag values, a `since` and `until` time bound, and a `limit`. A relay runs these against its store. This is the part with no native Axona equivalent, and §4 is about closing that gap.

**Relays are servers.** They are deliberately dumb — store and forward, no application logic — but someone operates them, pays for them, and can drop events or refuse connections. Nostr's censorship resistance is a redundancy argument, not an architectural one.

---

## 2. The architecture

### 2.1 The adapter

A local process presents a normal Nostr relay WebSocket endpoint, typically on localhost. An unmodified Nostr client connects to it exactly as it would connect to any remote relay.

Behind that endpoint there is no store and no server. The adapter:

- **On publish** — takes the client's signed event and publishes it to the appropriate Axona topic.
- **On subscribe** — decomposes the client's filter into Axona topic subscriptions and cache queries (§4), returns the historical matches, emits the stored-events-exhausted marker, then streams live matches as they arrive on the subscribed topics.
- **On close** — drops the corresponding Axona subscriptions.

The client cannot distinguish this from a relay. It believes it found a well-behaved server. It is on a peer-to-peer network.

### 2.2 Why the client needs no modification

The adapter satisfies the same message vocabulary the client already speaks, and — after identity unification (§3) — the client's own key and its own signatures are natively valid on Axona. Nothing about the event has to be rewritten, re-signed, or translated. The client's cryptographic identity is the identity Axona indexes and validates.

### 2.3 Where the adapter runs

The adapter must run somewhere on the user's side. On desktop this is an ordinary background process. On mobile the constraints are real — background execution, socket lifetime, battery.

This is precisely the role the Stability box was conceived for: a screenless, always-on node reached by the phone over local wireless. A Nostr client on the phone points at the box; the box runs the adapter and holds the Axona node. The interop design and the hardware concept fit together without either being contorted to accommodate the other.

---

## 3. Identity unification

### 3.1 The decision

**Axona's signature scheme moves from ed25519 to secp256k1 with Schnorr signatures, for both the author ID and the transport ID.**

The author ID moves for interoperability: it makes a Nostr pubkey directly usable as an Axona author identity. The transport ID moves for uniformity — one curve, one implementation, one key type across the system, rather than two schemes to maintain and two sets of failure modes to reason about.

It is worth recording that these two halves are justified differently. The author-ID switch has an external payoff. The transport ID has no counterpart in Nostr — Nostr has no separate subscription identity — so switching it buys engineering simplicity and no interoperability. That tradeoff was weighed and uniformity was chosen deliberately.

### 3.2 What it buys

- **An existing Nostr user is already an Axona author.** No new identity, no key generation, no migration for them.
- **Their social graph carries over unchanged**, because the pubkey others know them by is the pubkey Axona carries.
- **Nostr filters map onto native Axona queries** (§4), because the author value in a filter and the author ID in the cache index are the same bytes.
- **Strategically**, the offer to the Nostr ecosystem changes from *port to our protocol* to *keep your identity, keep your client, lose the relay tier*. That is a very different conversation with Buzz, with Block, and with the broader Nostr community.

### 3.3 The two identities retain their distinct roles

Unifying the curve does not merge the identities. The separation that underpins the firewall thesis is unchanged:

- The **transport ID** is used for subscription, is never used to publish, and remains ephemeral — rotatable, disposable, and never linked to the author.
- The **author ID** is the durable, publicly known, ecosystem-facing identity that proves the same party published an earlier message.

Only the signature scheme is shared. The architectural separation is untouched.

### 3.4 Migration cost — to be scoped

This is a foundational change and should not be minimized. The author ID is what every existing Axona message authenticates against. Moving it invalidates existing author identities unless a migration path is provided, and touches signing and verification everywhere in the kernel, the bridge, the relay, the CLI, and the MCP server. A concrete migration plan — including whether existing identities are re-issued, dual-validated during a transition, or retired — is an open item (§7.1).

### 3.5 Open fork: one signature or two

A precise question that must be resolved before implementation.

A Nostr event's signature covers the Nostr event serialization. An Axona message signature covers the Axona envelope. These are signatures over different byte strings, so unifying the *key* does not by itself reduce two signatures to one.

Two resolutions:

**(a) Axona accepts the Nostr event signature as the author proof.** The embedded event's own signature satisfies the root's author validation. One signature, no duplication, and the adapter never needs the private key — which matters, because many Nostr clients sign via a browser extension or a remote signer and will never hand a key to the adapter.

**(b) The adapter signs the Axona envelope separately with the same key.** Simpler for the kernel, but it requires the adapter to hold the private key, which breaks compatibility with remote-signer clients and weakens the "unmodified client" claim for a meaningful share of the ecosystem.

**(a) is strongly preferred** and should be validated against the kernel's author-validation path early, because it constrains the envelope design.

---

## 4. Filter mapping

### 4.1 The problem

A Nostr filter is a declarative query against a store. Axona has topics you subscribe to and a cache you can query. The adapter's job is to turn a filter into a set of subscriptions and queries whose union reconstructs the answer.

This means the publish side and the subscribe side must be designed together: **the topic scheme is the index.** Events must be published to topics derived from the things filters select on, or the filters cannot be served.

### 4.2 Native dimensions: author and time

Axona's cache already answers "all messages on this topic since this timestamp." Adding an **optional author constraint** — "all messages on this topic, from this author, since this timestamp" — is a modest extension with disproportionate value here.

It matters because it moves the *conjunction* into the transport. Without it, an author-and-time filter forces the adapter to subscribe broadly and discard non-matching events locally. With it, the two-leg conjunction is served directly by the cache.

And those are exactly the two dimensions that carry real Nostr traffic. The dominant filter shape in practice is authors plus `since` plus `limit` — a client refreshing a user's feed, or catching up a thread after reconnect. Nostr's `since` maps one-for-one onto the cache's timestamp parameter; Nostr's `authors` maps onto the new author parameter. Two of the three major filter dimensions become native transport operations.

**Critically, the author query is compatible with topic-derived encryption.** Once payloads are encrypted, the root cannot index on anything inside a message. The author ID is cleartext, authenticated, visible to the root — it must be, or the root could not validate the message at all — and stable across an author's messages. It is the one field that both survives encryption and is worth indexing on. The two designs meet at exactly one field and agree about it.

### 4.3 Topic derivation for the remaining dimensions

Filters that select on tags map onto topics derived from the tag value: a hashtag becomes a topic, a referenced event id (a reply thread) becomes a topic. Both sides derive the topic independently from public information, so there is no coordination — the same property the encryption scheme relies on.

**Design position: lean topics plus local filtering.** Do not encode every filter dimension — kind, time bucket, and so on — into the topic derivation. That would answer more filters by subscription alone at the cost of a bloated topic space and Nostr's schema baked into Axona's addressing. Keep the topic scheme minimal, let the author and time constraints be served by the cache query, and let the adapter apply the residual constraints locally.

The author query is what makes this position comfortable. Before it, "lean topics" meant substantial local filtering; with it, selectivity lives in the query where it belongs, and the topic space stays clean.

### 4.4 What does not map well

**Broad conjunctions with no narrow leg.** A filter such as "all events of kind 1 since Tuesday," with no author and no tag, is the global firehose. It has no natural topic and no selectivity to hand the cache. This was only ever servable by a large relay with a full index, and it is not a peer-to-peer-friendly query under any design. The adapter should degrade honestly rather than attempt it.

**Deep scrollback.** See §5.

---

## 5. History: the rolling window and the archive peer

Axona retains, at the root and its children, the last twenty-four hours or 1,024 messages per topic, whichever binds first. A subscriber receives this cache on initial subscribe, or may pass a timestamp — typically that of the most recent message it already holds — to receive only the delta.

This maps directly onto what a Nostr client expects on connect: recent matching events, the stored-events-exhausted marker, then the live tail. The adapter is translating one "recent history plus live tail" model into another, not fabricating a store.

The window bounds the claim. Nostr clients often expect to page backward through months of history, and a rolling cache does not hold that. The honest framing:

- **Axona natively covers recent-history-plus-live**, which is the overwhelming majority of real social and chat usage.
- **Deep archive becomes optional rather than mandatory.** A node that wishes to offer long history subscribes to the topics it cares about, retains beyond the window, and answers timestamp queries reaching further back. It is a peer that chose to remember more — not a privileged tier the network depends on.

Anyone may run one; nobody must; and where none exists for a topic, the client still gets twenty-four hours plus the live feed, which is a usable product on its own. This is the substantive difference from Nostr: archival is demoted from an architectural requirement to an opt-in service.

---

## 6. Compatibility: how simple is the switch

### 6.1 Message layer — plug-compatible for the common cases

The adapter presents the same vocabulary the client already speaks, and after identity unification the client's signed events are natively valid. For the dominant filter shapes the answers are faithful. The limitations named above — deep scrollback and the no-author firehose — are graceful degradations, not protocol breakages.

### 6.2 Transport layer — a configuration change for most clients

Nostr clients connect to relays by URL, and essentially all of them expose relay configuration to the user. For those clients the switch is a configuration change: run the adapter locally, point the client at the local endpoint instead of a remote relay, change nothing else. **No client code modification.**

### 6.3 Where it is more than a switch

A client that hardcodes its relay set, or ships locked down, requires either a plugin (if it has an extension model) or a client variant with the adapter embedded. This is a one-time integration per client, not per user, and the surface is small because the same fixed vocabulary is all that must be satisfied.

Clients using remote signers are covered only under §3.5(a). Under (b) they are not, which is the strongest argument for (a).

### 6.4 The claim, stated precisely

> For any Nostr client that exposes relay configuration, this is a point-the-URL-at-localhost switch with no client code change, subject to the history-window and firehose limitations. For clients that do not, it is a small one-time per-client integration, not a rewrite.

Identity unification is what earns that. Without it, every case above would additionally require key translation in the middle.

---

## 7. Open items

### 7.1 secp256k1 migration plan
Scope the change across kernel, bridge, relay, CLI, and MCP server. Decide the disposition of existing ed25519 author identities: re-issue, dual-validate through a transition window, or retire. This is the largest single piece of work implied by this document.

### 7.2 Author proof — resolve §3.5
Determine whether the kernel's author validation can accept the embedded Nostr event signature (option a). This gates remote-signer client compatibility and constrains envelope design.

### 7.3 Author query specification
Define the optional author parameter on the cache query: exact-match only or set-membership (Nostr's `authors` is a list), interaction with the timestamp parameter and with result limits, and index cost at the root.

### 7.4 Topic derivation scheme
Fix the derivation for Nostr-bridged content: which tag types become topics, how a thread root maps to a topic, and how a client's home feed — a set of followed authors — is expressed. Must be settled jointly with §7.3, since together they are the index.

### 7.5 Encryption interaction
Confirm normatively that the author ID sits outside the encrypted envelope. This is already forced by the root's validation requirement, so it is a documentation task rather than a design change. Note also that most Nostr content is public by intent; topic-derived encryption protects it against passive carrier reading, not against anyone who knows the topic — the same position taken in the encryption specification, and the correct one here.

### 7.6 Adapter packaging
Desktop background process, mobile constraints, and the Stability box as host. Determine whether the adapter ships as a standalone binary, a library embedded in client variants, or both.

### 7.7 Verification against current NIPs
This document is written against the core Nostr protocol as generally implemented. Before implementation, verify the exact message vocabulary, filter semantics, limit and stored-events-marker behavior, and the current state of the relevant NIPs, including remote-signer specifications, against present-day sources.

---

## 8. Strategic note

The value of this design is not that Axona can carry Nostr traffic. It is that the offer to the Nostr ecosystem requires nothing of its users.

They keep their identity. They keep their client. They keep their social graph. What they lose is the tier of servers someone has to run, pay for, and be trusted not to censor — replaced by a transport where that tier does not exist, with a bounded history that covers what their clients actually ask for and an archive layer that is opt-in rather than assumed.

For Buzz specifically — built on Nostr, positioned as an open alternative to closed workplace platforms — the relay tier is the pragmatic centralization at the center of an otherwise decentralized design. This is the part of their architecture that is hardest to defend and the easiest for Axona to replace.
