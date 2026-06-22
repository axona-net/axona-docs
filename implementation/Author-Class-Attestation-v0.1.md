# Author-Class Attestation (human / agent provenance) — Implementation Spec

**Version:** v0.1 (design proposal) · **Date:** 2026-06-21
**Baseline:** `@axona/protocol` kernel **v3.6.0** (v0.3 identity/topic model; `WIRE_VERSION` 3.0)
**Status:** proposed — **prototyped + verified live** in `axona-relay` **v0.19.0**
(the persistent MCP peer self-declares `agent` on connect; smoke
`scripts/author-class-smoke.mjs` is 6/6 on testnet: separate-peer resolution from
the Author ID alone, signer↔author binding, and owner-only rejection of a
non-owner write). The relay carries app-local helpers; promoting them to kernel
core/`std` (§6) and settling §7 remain. Realizes the mechanism sketched in
[`../architecture/Gates-to-Gradients-5-Agent-Legibility-v0.2.md`](../architecture/Gates-to-Gradients-5-Agent-Legibility-v0.2.md);
builds on the `OwnershipProof` seam in
[`Decoupled-Publish-Identity-and-C3-v0.1.md`](Decoupled-Publish-Identity-and-C3-v0.1.md) §6.
**Audience:** an implementing engineer/agent with no prior context — current
surface, the object, the rules, the API, decisions, and tests are all below.

**Standing constraints (non-negotiable):**
- Self-authenticating only. No CA, no registry, no reputation oracle, no central
  classifier. A reader verifies the attestation with a signature check and nothing else.
- **Opt-in, never mandatory, never in the routing path.** The kernel must never
  require this field, never read it before moving a message, and never put it in
  the address or the mandatory envelope. (The envelope discloses WHO via
  `signerPubkey` and deliberately not WHERE — an attempt to add node-id/region to
  the envelope was reverted in kernel v2.41.1. A human/agent label is a smaller
  disclosure than location but is *still* a disclosure, so it stays voluntary.)
- Additive only. No wire/packet change to the pub/sub envelope; this is a new
  signed object carried over the existing pub/sub path plus small pure helpers.

---

## 1. TL;DR — what to build

A small, **voluntary, signed claim bound to an author key** that declares the
author's class — `agent`, `human`, or (by absence) **unstated** — plus an optional
`operator` naming who runs an agent. It is **not** in the address and **not** in
the routing envelope.

Three pieces:

1. **The object** — `axona:author-class:v1`, a domain-tagged payload signed by the
   author key (§3).
2. **The canonical carrier** — each author's own **pinned-region, owner-only
   profile topic** `authorClassTopic(authorId)`, so the claim is (a) writable only
   by that author and (b) discoverable from the `signerPubkey` alone (§4). An
   optional inline echo on a publish is allowed for "the claim travels with the
   message" cases (§4.3).
3. **Read path** — pure `verifyAuthorClass()` + a client/filter convention that
   resolves a `signerPubkey` to its current class on demand (§5–6). Filters (note
   4), reach-friction (note 6), and aggregate telemetry (note 2) consume it; the
   kernel never does.

The "single bit" idea (0 = agent, 1 = human) survives as the `class` field —
except a bound, signed claim can also express **unstated**, which a hard address
bit cannot, and which is the correct honest default.

## 2. Why this shape (and not an address bit)

`Gates-to-Gradients-5` argues the move; the short version of why it lives here and
not in the 264-bit address (`[8-bit S2 prefix] ‖ SHA-256(pubkey)`):

- **An address bit is forgeable for free.** The hash half isn't *set*, it's the
  output of `SHA-256(pubkey)`; "choosing" one bit is a ~2-keygen grind, so an
  agent grinds the `human` bit trivially. A claim that costs nothing to forge
  certifies nothing. A *signed* claim is bound to the key and cannot be borrowed.
- **An address bit skews placement.** Address bits drive DHT keyspace position and
  the K-closest root set; a semantic bit partitions each region by class and biases
  who roots what. Authorship class must be routing-blind.
- **Wrong identity.** The address belongs to the **node identity**
  (`createNodeIdentity`, geo-prefixed — correct for an agent that also runs
  relay/transport, and unchanged by this spec). "The *publisher* is an agent" is a
  property of the **author identity** (`createAuthorIdentity`), which is
  location-free and has no address. The claim binds to the author key.

## 3. The attestation object

A canonical-JSON payload, signed by the **author** key (the same key that signs
the author's pub/sub envelopes — `signerPubkey`).

```jsonc
{
  "kind":     "axona:author-class:v1",   // domain tag (signed; rejects cross-protocol replay)
  "class":    "agent",                    // "agent" | "human"   (absence of the whole object = UNSTATED)
  "operator": "ed25519:<pubkey-hex>",     // OPTIONAL: who runs this author (see §3.1)
  "label":    "axona-relay mcp peer",     // OPTIONAL: short human-readable, opaque, ≤64 chars
  "ts":       1782060000000,              // ms; supersession — latest valid ts per author wins
  "author":   "<author pubkey hex>",      // MUST equal the signing key (redundant-but-explicit bind)
  "signature":"ed25519:<…>"               // sig by `author` over canonical(payload \ signature)
}
```

- `class` is a closed enum in v1: exactly `"agent"` or `"human"`. **Unstated is
  represented by the absence of any valid attestation**, never by a third enum
  value — so "didn't declare" and "declared X" are structurally distinct and a
  default can never be silently read as a positive human claim.
- `ts` gives latest-wins supersession so an identity can change class (an author
  that was human-operated becomes an automation, or vice-versa) or **retract** to
  unstated by publishing a tombstone (`kill` on the profile topic, §4.2).
- Signed over `canonical()` (the existing RFC-8785-ish total order used for
  envelopes), with `signature` excluded from the signed bytes.

### 3.1 The `operator` field

`operator` optionally names the human or organization accountable for an agent.
Two tiers, pick per §7(b):

- **v1 — self-asserted.** `operator` is just a string/pubkey the author writes; it
  proves nothing beyond "the author claims this operator." Cheap, honest about
  being a claim.
- **v1.1 — countersigned (stronger). SHIPPED in kernel v3.8.0.** Pass
  `operatorSignWith` (an operator identity) to `buildAuthorClass`: it sets
  `operator` to the operator's pubkey and attaches `operatorProof` — the operator
  key signing over a domain-tagged `{ d:'axona:author-class-operator:v1', author,
  operator }` payload (the `OwnershipProof` shape). So the attestation carries
  *bidirectional* proof: the author names the operator **and** the operator
  vouches back. `verifyAuthorClass` returns `operatorVerified:true` only for a
  valid proof; a present-but-bad proof **rejects the whole attestation**; a
  self-asserted operator string (no proof) returns `operatorVerified:false`.

## 4. Carrier: the author-class profile topic

### 4.1 Derivation (canonical, pinned-region, owner-only)

> **Implementation note (verified against kernel v3.6.0).** An earlier draft of
> this section put the profile topic on a *key-derived* region (region omitted ⇒
> `keyDerivedRegion(owner)`). **The shipped kernel deliberately does not do this.**
> `deriveTopicId` never derives a region from the author key — its own comment:
> *"never derived from the author key … a hashed region would dump every author's
> topics into one arbitrary cell, creating a hotspot."* Region-omitted resolves to
> the **publishing node's** region, which is useless for discovery (a reader
> holding only an Author ID doesn't know where that author's node sits). So the
> carrier **pins a fixed, well-known region** — exactly the bridge-directory
> pattern — which is what actually makes it discoverable from the Author ID alone.

```js
const CLASS_REGION = 'useast';   // pinned, well-known (configurable)
function authorClassTopic(authorId) {
  // explicit region (discoverable) + owner present ⇒ write:'owner' default ⇒
  // ONLY this author may publish here. No new primitive; no key-derivation.
  return { region: CLASS_REGION, owner: authorId, name: 'axona:author-class' };
}
```

Two properties:

- **Only the author can set their own class.** `write:'owner'` (the default when an
  `owner` is named) means root ingress rejects any publish whose `signerPubkey !==
  owner` — the kernel's existing write-policy check (`WRITE_POLICY_VIOLATION`),
  *verified live* (a non-owner publish to the victim's profile topic is rejected).
  No one can publish a class claim *about* someone else.
- **Discoverable from the key alone.** Region is a fixed constant every client
  knows, and `owner = authorId`, so a reader holding only a `signerPubkey` derives
  the identical topic ID and pulls the claim — no registry, no side channel.
- **Tradeoff (be honest):** pinning one region concentrates all author-class
  topics there — a mild hotspot, the same one the bridge directory accepts for
  `axona:bridge-directory`. Each is one small, rarely-written, owner-only topic, so
  the load is low; if it ever bites, shard the name across a fixed *set* of regions
  by a prefix of the Author ID (still deterministic, still discoverable, no
  per-author key-derivation). The alternative — carry the claim inline with
  messages (§4.3) — avoids the topic entirely at the cost of repeating it.

### 4.2 Lifecycle

- **Set / change:** author `pub(authorClassTopic(self), attestation, { signWith: author })`.
  Latest valid `ts` wins.
- **Retract to unstated:** `kill` the latest entry (creator-only, signer-bound —
  Lifecycle §3) or publish an explicit `{ class: null }`-equivalent tombstone;
  either way readers fall back to "unstated."
- **Read:** `pull(authorClassTopic(signerPubkey))` → newest entry → `verifyAuthorClass`.
  Cache per author; refresh lazily.

### 4.3 Optional inline echo

For "the claim should travel *with* a specific message" (e.g. a one-shot publish
to an audience that won't go resolve a profile topic), an author MAY attach the
same signed object as an **opt-in** field on a publish (an app-layer annotation
alongside the message, not a kernel envelope field). Verifiers treat an inline
echo and a profile-topic entry identically (§5). Inline echo is never required and
never added by the kernel.

## 5. Verification rules (pure, self-contained)

`verifyAuthorClass(obj, expectedAuthor)` returns `{ ok, class, operator?, ts }` or
`{ ok: false, reason }`. Accept **iff** all hold:

1. `obj.kind === 'axona:author-class:v1'`.
2. `obj.class ∈ { 'agent', 'human' }`.
3. `obj.author` is 64-hex and **equals** the key that produced `obj.signature`
   (verify the Ed25519 signature over `canonical(obj \ signature)` against
   `obj.author`).
4. When resolved via the profile topic: the topic's `owner` (recomputed from the
   routed topic id) **equals** `obj.author` — i.e. the claim sits on its own
   author's owner-only topic. When resolved via inline echo: `obj.author` **equals
   the enclosing message's `signerPubkey`** — the class is about *this* author.
5. If `operator` present and the deployment requires countersignature (§7b):
   verify the operator `OwnershipProof`. If self-asserted mode, `operator` is
   surfaced but flagged `unverified: true`.

Anything failing → treat the author as **unstated** (never as a default class).
The kernel does **not** call this; callers are clients/filters/telemetry.

## 6. Surface to add

**Shipped in kernel v3.7.0** (`src/pubsub/authorClass.js`, exported from the
barrel): `authorClassTopic`, `buildAuthorClass`, `verifyAuthorClass`, and the
`AUTHOR_CLASS_KIND` / `AUTHOR_CLASS_NAME` / `AUTHOR_CLASS_REGION` constants — so
the browser peer, reference apps, and relay derive + verify identically.
And **kernel v3.8.0** added the conveniences directly on `AxonaPeer` —
`peer.setAuthorClass(class, { signWith, operator?, operatorSignWith?, label? })`
and `peer.getAuthorClass(authorId)` (returns `{ class, operator, operatorVerified,
label, ts }`, `'unstated'` on any failure) — plus the **operator countersignature**
(§3.1 v1.1) via `buildAuthorClass`'s `operatorSignWith`. `smoke_author_class.mjs`
is 22/22. So the human-facing "I am human" toggle is a single
`peer.setAuthorClass('human', { signWith })` call. (The relay's `mcp-session.js`
now delegates to these peer methods.)

| Symbol | Home | Notes |
|---|---|---|
| `authorClassTopic(authorId)` | kernel core (`src/pubsub/`) | one-liner over `deriveTopicId`; core so every consumer derives it identically (same rationale as `metricTopic`) |
| `buildAuthorClass({ class, operator?, label?, signWith })` | core or `std/` | constructs + signs the object |
| `verifyAuthorClass(obj, { expectedAuthor })` | core or `std/` | pure; returns the verdict in §5 |
| `peer.setAuthorClass(class, { operator?, label?, signWith })` | `AxonaPeer` (convenience) | = `pub(authorClassTopic(author), build…)` |
| `peer.getAuthorClass(authorId)` | `AxonaPeer` (convenience) | = `pull` + `verifyAuthorClass`, cached |

No change to `envelope.js`, `msgId`, routing, or the handshake. (`msgId = hash(
signerPubkey ‖ message)` and the envelope are untouched.)

## 7. Decisions — settle before implementing

a. **Carrier default.** Profile-topic as canonical (recommended) with inline echo
   opt-in — or inline-only? Recommendation: profile-topic canonical; it's
   updatable, retractable, discoverable, and doesn't bloat every message.
b. **`operator` trust tier.** Ship self-asserted (v1) and add countersignature
   (v1.1) later, or require countersignature from the start? Recommendation: ship
   self-asserted but surface it as `unverified`, land countersignature next — a
   self-asserted operator is spoofable and shouldn't *look* authoritative.
c. **Enum extensibility.** Keep `class` a closed 2-value enum, or allow richer
   self-described structure (`human-supervised`, `scheduled-automation`)? Every
   added value is more to misreport; recommendation: closed enum in v1, push nuance
   to `label` (opaque, filter-interpreted).
d. **Does an inline echo belong in `std/chunk`-style helpers or purely app code?**
   (Low stakes; defaults to app code unless a reference app needs it.)

## 8. App UX (the point of the whole thing)

- **Human apps** surface an explicit, user-controlled **"I am human"** toggle
  (default *off* = unstated, never silently *on*). Toggling on calls
  `setAuthorClass('human')`. The toggle is the user's own assertion about their own
  key — exactly the consent shape this requires.
- **Agents** call `setAuthorClass('agent', { operator })` at startup. The persistent
  MCP peer (`axona-relay` v0.18.x) is the first concrete emitter: it has a durable
  author key (`signerPubkey 8386…`) and a clear operator (the human running it), so
  it can publish `class: "agent"` once on connect and be honestly legible.
- **Reading apps / filters** resolve `getAuthorClass(signerPubkey)` and render a
  badge / apply a forkable-filter rule (note 4) / feed reach-friction (note 6).
  Honest default for a reference filter: *surface* the class, don't auto-suppress.

## 9. Interactions

- **Forkable filter sets (note 4):** a filter rule can match on resolved class
  (`{ match: { class: "agent" } }`) to downrank/batch/quarantine — the primary
  consumer.
- **Friction scaled to reach (note 6):** class is one input to reach-graded cost
  (agent-class wide fan-out earns its propagation; a human to friends pays nothing).
- **Cascade telemetry (note 2):** the **aggregate** agent:human ratio is computed
  from declared classes — population statistics only, never per-author logs.
- **Pub/sub lifecycle:** the profile topic is an ordinary owned topic — inherits
  bounded queue, TTL ceiling, `kill`/`unpub`, exactly-once delivery. Nothing special.

## 10. Honest limits (carry these verbatim into any UX copy)

- **Self-declared, not detection.** A deceptive actor won't flag, or will flag
  falsely (the worrying case: an agent claiming `human`). This shapes the honest
  default and arms willing readers; it does not catch liars. Behavioral detection
  is deliberately out of scope — it needs surveillance or a classifier authority,
  i.e. a gate.
- **Absence ≠ human.** Unstated is unstated. UX must not render "no attestation" as
  "human."
- **Self-asserted `operator` proves only a claim** until countersigned (§3.1).
- **Asymmetric incentive.** Most useful for cooperative legibility (an agent that
  *wants* to be treated as one); weakest exactly where adversarial pressure is
  highest. Anyone promising more is selling a chokepoint back under a new name.

## 11. Tests / acceptance

- `buildAuthorClass` → `verifyAuthorClass` round-trip: `ok`, correct `class`.
- **Tamper:** flip `class` after signing → verify fails. Re-sign with a *different*
  key → fails rule 3.
- **Owner-only carrier:** a second author attempting to `pub` to
  `authorClassTopic(victim)` is rejected `WRITE_POLICY_VIOLATION` at ingress.
- **Discovery:** holding only `signerPubkey`, derive `authorClassTopic`, pull, and
  recover the class (pinned-region discovery round-trip).
- **Supersession + retract:** newer `ts` wins; `kill` → reader falls back to unstated.
- **Inline echo:** `obj.author !== enclosing signerPubkey` → rejected (rule 4).
- **Live (testnet):** MCP peer publishes `class:"agent"`; a second peer resolves it
  from the author key alone.
- **Acceptance:** kernel envelope/`msgId`/routing byte-for-byte unchanged
  (additive-only proof); no kernel code path reads `class`.

## 12. Out of scope

- Behavioral / involuntary agent detection (intentionally — it requires a
  classifier authority).
- Any routing, placement, or address change.
- A global class registry or directory beyond per-author owner-only topics on a pinned region.
- Personhood proofs / "one human" attestation (a gatekeeper; different problem).

## 13. References

- [`../architecture/Gates-to-Gradients-5-Agent-Legibility-v0.2.md`](../architecture/Gates-to-Gradients-5-Agent-Legibility-v0.2.md) — the design rationale.
- [`Decoupled-Publish-Identity-and-C3-v0.1.md`](Decoupled-Publish-Identity-and-C3-v0.1.md) §6 — the `OwnershipProof` primitive reused for `operator` countersignature.
- v0.3 identity/topic model: `createAuthorIdentity`, `deriveTopicId`,
  write-policy (`WRITE_POLICY_VIOLATION`) — kernel `src/identity/`, `src/pubsub/`.
- `metricTopic()` — precedent for a core, key/space-derived topic-ID helper consumed app-side.
