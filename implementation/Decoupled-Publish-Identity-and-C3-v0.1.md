# Decoupled Publish Identity + C-3 Metrics Authorization — Implementation Spec

**Version:** v0.1 (design proposal) · **Date:** 2026-06-09
**Baseline:** `@axona/protocol` kernel **v2.32.0** (live `axona/5` line; `testnet` branch == `main`)
**Status:** proposed; decision points in §7 must be settled before M3.
**Audience:** an implementing engineer/agent with **no prior context**. Everything needed is below: current behavior with file:line refs, the changes, the decisions, and the test/acceptance plan.

**Standing constraints (non-negotiable):**
- No remediation may depend on a centralized authority, a CA, or a reputation/identity service. Self-authenticating / end-to-end only.
- Prefer **additive** wire changes. The pub/sub envelope already carries `signerPubkey` and verification keys off it, so most of this is *semantics + key management*, not a packet change. Flag any change that splits the wire and gate it behind a coordinated version bump.

**Repos / paths (all under one parent dir; each is its own git repo):**
- Kernel: `axona-protocol/` — `src/pubsub/AxonaManager.js`, `src/pubsub/envelope.js`, `src/dht/AxonaPeer.js`, `src/utils/hexid.js`, `src/identity.js` (exported via the barrel `src/index.js`), tests in `test/`.
- Bridge: `axona-bridge/` (embeds the kernel; metrics/relay path).
- Consumers re-vendor the kernel: `axona-peer/`, `axona-relay/`, `dht-sim/` (each via its `scripts/sync-protocol.sh` / `sync-vendor-kernel.sh`).

These two work items are specced **together** because they touch the same authorization seam (§6): C-3 must re-base owner-gated metrics on *proof of possession of the owning key*, which is exactly the primitive the decoupled publish identity needs.

---

## 1. TL;DR — what to build

1. **Part 1 — C-3 metrics authorization hardening (ship first).** Stop a reflection/amplification primitive and an ownership fail-open in the metrics path. Server-side authz only; **no wire break**. Effort: **M**.
2. **Part 2 — decoupled publish identity ("publishID").** Let publishes be signed/owned by a dedicated key distinct from the node's transport/routing key, for publisher unlinkability and key compartmentalization. Largely additive at the wire; the *break* is in ownership semantics and key management. Effort: **L**.
3. **Shared seam (§6):** define one `OwnershipProof` primitive (a signature by the owning key) and use it for owner-gated reads/writes (metrics-of-owned-topic, `unpub`, `kill`). Part 1 ships it bound to the node key; Part 2 swaps the owning key for the publishID with no further authz redesign.

---

## 2. Current architecture (you need no other source)

**Identity (one key, two jobs).** A peer derives one Ed25519 keypair. Its `nodeId` (a.k.a. transport/routing identity) is `[8-bit S2 region prefix] || [256-bit SHA-256(pubkey)]` (264-bit, 66-hex). The `axona/5` handshake proves possession of this key and binds it to the channel. **That same key currently signs every publish.**
- `deriveIdentity({lat,lng})` / `dumpIdentity` / `loadIdentity` — kernel barrel (`src/index.js`). Identity object: `{ id, pubkey, pubkeyHex, privateKey (CryptoKey), region:{lat,lng}, sign(), verify() }`.

**Pub/sub envelope** (`src/pubsub/envelope.js`):
- `ENVELOPE_DOMAIN = 'axona:pubsub-envelope:v2'` (`:76`).
- `makeEnvelope(...)` signs a domain-tagged core `canonical({ d: ENVELOPE_DOMAIN, seq, ts, topic, message })` with `identity.privateKey`, then sets `signerPubkey = identity.pubkeyHex` and `msgId = computeMsgId({ publisher: signerPubkey, message })` (`:130–148`). **The `identity` argument here is the single injection point for Part 2.**
- Verify recomputes the core and checks the Ed25519 signature against `envelope.signerPubkey` (`:155–199`). **Verification keys off `signerPubkey`, NOT the transport identity** — this is load-bearing (relays forward publishes), and it is why Part 2 is mostly additive.

**Topic IDs & ownership:**
- `topicId = assembleId(s2Prefix, sha256(...))` (`src/utils/hexid.js:117`), where `s2Prefix` comes from the **publisher anchor**. Owned-topic placement (which K-closest roots host it) therefore keys off the publisher's prefix.
- **Owned vs unowned:** a topic is *owned* only when its publisher anchor is a real identity (low 256 bits = SHA-256(pubkey), i.e. `!= 0`). Two shapes are **unowned by construction**: public topics (null publisher) and **region-keyed synthetic publishers** `prefix || 0^256` (no key hashes to all-zero). Region-keyed topics are the common case and are unaffected by ownership changes.

**Owner-gated operations (today, all lean on `nodeId == publisher`):**
- `peer.kill(topic, msgId)` — `AxonaPeer.js:1416` (returns `{ok:true}` at `:1455`). Authorization is at the root in the retract path: `AxonaManager.js` checks `kill.signerPubkey === msg.signerPubkey` (`:853–854`) then `cache.splice(idx,1)` + tombstone (`:858`).  *(Note: SP-11 — `splice` removes only the first duplicate-content copy; fix to filter-remove all matching `postHash` while you're here.)*
- `peer.unpub(topic, {destroy})` — `AxonaPeer.js:1528+`. Owner gate: `SHA-256(signerPubkey) === ownerNodeId[8:]` (`:1024`, pubkey↔nodeId bind; pkBytes parsed `:1049`).
- `peer.metrics(topic, {publisher, timeoutMs})` — `AxonaPeer.js:1800`. Outbound request sets `requesterId: toHex(this.nodeId)` (`AxonaManager.js:2298`, `:2334`) and routes `pubsub:metricsReq` (`:2381`).

**Replay freshness (C-2):** a per-`signerPubkey` monotonic `seq` high-water in `_publisherSeq` (`AxonaManager.js:196`); plus a ±300 s TTL window on the signed `ts`.

**Per-publisher quota:** open-topic bounded-queue quota is keyed on `signerPubkey` (see `_openTopicQuota`, used in the publish path). *(Note: SP-10 — anonymous publishes currently bypass it; relevant to §7(a).)*

---

## 3. Part 1 — C-3 metrics authorization hardening (SHIP FIRST)

### Problem (verified in v2.32.0)
`_buildMetricsResp(payload, role, topicIdBig)` (`AxonaManager.js:2116`):
1. **Reflection/amplification to an arbitrary victim.** It reads `requesterId` from the *payload* (`:2116`), and `_maybeRespondMetrics` sends the response to `_wire(payload.requesterId)` (`:2155`) — an **attacker-chosen** address. For *unowned* topics (every region-keyed topic) the ownership gate is skipped entirely, so a small request reflects a larger metrics payload to any victim nodeId. Same primitive class as B-1 (which was rated Critical). **Re-rated Critical-adjacent (2026-06-09).**
2. **Ownership fail-open.** Owned-ness is inferred from `role.replayCache?.[0]` (`:2128`): an **empty cache** → `anchor=null` → `owned=false` → the gate (`:2129–2132`) is skipped, so an owned topic's metrics become readable/reflectable exactly when cache state is thin (startup, post-eviction, low-traffic).

### Fix
- **(F1) Never trust `payload.requesterId` as a routing target.** Send the response only to the cryptographically proven origin of the request — `meta.fromId` (the channel-authenticated sender, same proof B-1 relies on). Treat `payload.requesterId` as removed/ignored (see §7(f)).
  - Apply to all three ingress handlers: `_onMetricsReq` (`:2166`, routed), `_onMetricsReqDirect` (`:2189`), and the broadcast handler (`:2202`). Thread `meta` into `_buildMetricsResp`/`_maybeRespondMetrics` and route the reply with `meta.fromId`.
- **(F2) Fail closed on ownership.** Determine owned-ness from a **stable** source — derive it from the role's known publisher anchor / `topicId`, not `replayCache?.[0]`. If a topic is owned and ownership cannot be established, **deny**.
- **(F3) Owned-topic reads require proof, not a claim.** For an *owned* topic, return metrics only if the requester proves possession of the owning key (see §6 `OwnershipProof`). For *unowned* topics (public / region-keyed) metrics stay open (by design) — but still reply only to `meta.fromId` per (F1), which removes the reflection vector regardless.
- **(F4) Drop / restrict the tree-wide broadcast** (`pubsub:metricsBroadcast`, `:2202`, `:2287`) — it amplifies; scope it to the K-closest set or remove it.

### Wire impact
None required: this is server-side authorization. `requesterId` becomes ignored-on-read (retain the field for one version for compatibility, then drop — §7(f)).

### Tests (extend `test/smoke_pull_metrics.js`, add cases)
- Reflection rejected: a `metricsReq` with `requesterId = victim` delivers the response to the **request origin**, never to `victim`.
- Fail-closed: owned topic with empty `replayCache` → metrics **denied** to a non-owner.
- Owned read with valid `OwnershipProof` → allowed; without/with bad proof → denied.
- Unowned (region-keyed) topic → metrics returned to the request origin only.

---

## 4. Part 2 — decoupled publish identity (publishID)

### Goal
`signerPubkey` becomes a **dedicated publish key**, unrelated to the node's transport/routing key. Enables publisher unlinkability (per-topic / per-persona / rotating keys), key compartmentalization (transport key always-online vs publish key sparing/offline), and "right to route ≠ right to author."

### Core change (small, surgical)
- **Injection point:** pass a *publish identity* `{ privateKey, pubkeyHex }` into `makeEnvelope(...)` instead of the node identity (`envelope.js:130–148`). The envelope shape, signed core, `computeMsgId`, and verify path are unchanged — only *which key* fills `signerPubkey`.
- **Identity API (`src/identity.js` + barrel):** add `derivePublishIdentity()` (a keypair *without* the transport-nodeId framing — though it still needs an S2 prefix; see §7(d)), plus dump/load/rotate. Browser path should default to a **non-extractable** publish key.
- **`pub()` API (`AxonaPeer.js`):** accept `opts.publishIdentity` (per-call) and/or a peer-level default publish identity; fall back to the node identity if none (back-compat).

### Re-anchoring (the semantic break)
Everything that currently equates `nodeId == publisher` must re-anchor to the publish key:
- **Owned-topic identity & placement:** owner anchor becomes `SHA-256(publishPubkey)`; `topicId` prefix comes from the publish identity's S2 prefix (§7(d)).
- **`unpub` owner gate** (`:1024`): `SHA-256(signerPubkey) === ownerAnchor` where `ownerAnchor` is the publish-key hash — and require an `OwnershipProof` (§6), not just the bind.
- **`kill`** (`:853`): keep "kill signed by the message's `signerPubkey`," which now means the publish key. Fix SP-11 (filter-remove all `postHash` matches) here.
- **`metrics`** owned-topic gate: via the same `OwnershipProof` (§6) — this is the §3 (F3) seam.

### Risks → required decisions (see §7)
- **(R1) Free key-minting defeats per-`signerPubkey` quota (SP-10 amplified).** Decide §7(a): anchor anti-abuse on the *injecting transport identity*, or PoW the publish key, or both.
- **(R2) Replay-freshness (C-2) is meaningless for rotating keys** (`_publisherSeq` has no history for a fresh key). Decide §7(b): stable-key (strong replay protection) vs rotating-key (unlinkability) — mutually exclusive on one stream.
- **(R3) Partial anonymity only.** The injecting transport peer still has a nodeId (geo prefix) + IP (WebRTC); the K-closest root can correlate `publishID ↔ injecting transport peer`. PublishID is *necessary but not sufficient* for author anonymity — must be paired with the IP/onion track (out of scope here; see `red team/SECURITY-STATUS-v2.32.0.md` Wave E).

### Capability delta
- **Gained:** multi-device publishing under one author identity; pseudonymous/rotating personas; delegation and **group/ring-signed** publishing (ties to Model-3 shared group keys — §7(e)); offline/cold authoring keys.
- **Lost (unless re-anchored):** stable per-publisher quota and replay continuity; automatic cross-network publisher reputation/continuity becomes opt-in.

### Wire / migration
- Envelope: **no format change** (`signerPubkey` already present). `msgId` values change meaning (keyed on publish key) but format/content-addressing are intact.
- Ownership semantics **do** change → coordinate with a kernel version bump; document that owned topics created under the old (nodeId-anchored) scheme and the new (publishID-anchored) scheme are distinct owners. Region-keyed topics are unaffected.

---

## 5. (carried fix) SP-11 — `kill` removes only the first duplicate
While in the kill path (`AxonaManager.js` retract, `:858`), replace the single `cache.splice(idx,1)` with a **filter-remove of all entries matching `postHash`** (identical-content publishes share a content msgId but cache as separate entries). Low effort; land with Part 1 or 2.

---

## 6. The shared seam — `OwnershipProof`

Both Part 1 (F3) and Part 2 need: *"prove you hold the key that owns this topic/message,"* not *"you claimed to be the owner"* and not *"you're the channel peer."* Define one primitive:

```
OwnershipProof = {
  pubkey:  <64-hex owning key>,           // nodeId-key today; publishID after Part 2
  ts:      <ms>,                          // freshness, reuse the C-2 ±300s window
  nonce:   <responder-supplied or topicId-bound>,
  sig:     'ed25519:' + sign(owningPriv, domainTag || topicId || ts || nonce)
}
```
- Domain-tagged (`'axona:ownership-proof:v1'`) to prevent cross-protocol signature reuse.
- The responder verifies: `sig` valid for `pubkey`, `ts` fresh, and `SHA-256(pubkey) === topic.ownerAnchor`.
- **Part 1 ships this with `owningKey = node key`** (owner == nodeId). **Part 2 changes nothing in the verifier** — it just means `ownerAnchor` is now a publish-key hash. That's the whole reason to build them together.
- Used by: owned-topic `metrics` reads, `unpub`, and (optionally) `kill` if you want kill to require a live proof rather than only a matching signed retract.

A challenge-response (responder sends a nonce) is stronger against replay than a self-timestamped proof; pick per §7(c).

---

## 7. Decision points — OWNER MUST DECIDE before M3

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **a** | Anti-abuse anchor once publishID can be freely minted | (i) quota on injecting **transport identity**; (ii) **PoW** on publish-key minting; (iii) both | **DECIDED (2026-06-09): (ii) PoW** — memory-hard, pubkey-bound, per-role difficulty, shipped at difficulty 0 now. Quota anchors on the (PoW-bearing) **publish** key, preserving the decoupling. See [`architecture/E-1-Placement-Defense-v0.1.md`](../architecture/E-1-Placement-Defense-v0.1.md). Adds a `signerPow` nonce field to signed envelopes (no-op at difficulty 0) |
| **b** | Publish-key lifecycle | stable (strong C-2 replay) vs rotating (unlinkable) | App-selectable; default **stable**, expose rotating as a privacy mode with the replay caveat |
| **c** | `OwnershipProof` shape | self-timestamped vs challenge-response nonce | Challenge-response for owned reads/unpub; self-timestamped acceptable for kill |
| **d** | Does a publishID carry an S2 prefix? | yes (owned-topic placement works as today) vs region-pinned vs prefixless | Yes — publish key gets a prefix so owned-topic K-closest placement is well-defined |
| **e** | Group/ring signatures in scope? | now vs later | Later — land single-key publishID first; ring/group is a follow-on for the Model-3 group-key track |
| **f** | `payload.requesterId` field | remove now vs retain-but-ignore one version | Retain-but-ignore for one kernel version, then remove |

---

## 8. Sequencing & milestones

- **M1 — C-3 (ship):** F1 (reply to `meta.fromId`), F2 (fail-closed ownership), F4 (broadcast restriction), + SP-11. Unowned topics fully fixed; owned-topic reads gated behind the `OwnershipProof` stub. Kernel + bridge release. *(This is the live-exploitable item — do not block it on Part 2.)*
- **M2 — `OwnershipProof` primitive** (§6), bound to the node key. Wire owned-`metrics` and `unpub` onto it.
- **M3 — publish-identity key management:** `derivePublishIdentity`, persistence, `pub()` opts, `makeEnvelope` injection. *(Requires §7(a)(b)(d) settled.)*
- **M4 — re-anchor ownership** (kill/unpub/metrics) on publishID via `OwnershipProof`; `topicId` placement on publish prefix.
- **M5 — anti-abuse + freshness policy:** implement §7(a) quota anchor and §7(b) key-lifecycle policy.
- Re-vendor kernel → `axona-peer`/`axona-relay`/`dht-sim`; bump bridge; update `SECURITY-CHANGELOG.md` (resolved-only) and `red team/SECURITY-STATUS-v2.32.0.md` (mark C-3 done, add publishID line).

## 9. Test plan
- Part 1: §3 cases (reflection rejected, fail-closed, owned-read proof, unowned open).
- `OwnershipProof`: valid/expired/wrong-key/replayed-nonce.
- Part 2: publish signed by publishID verifies; node-key and publish-key are independent; unpub/kill/metrics authorize on publishID; SP-11 multi-copy removal.
- Anti-abuse: quota holds under publish-key rotation (per §7(a)); C-2 behavior documented under §7(b).
- Existing suites must stay green: `test/smoke_pubsub_*.js`, `smoke_kill.js`, `smoke_unpub.js`, `smoke_touch.js`, `smoke_pull_metrics.js`, `smoke_envelope.js`, `smoke_canonical.js`, plus `npm test` and the WebRTC harness.

## 10. Acceptance criteria
- No metrics response is ever delivered to a `payload`-named address; all replies go to the proven request origin.
- Owned-topic metrics/unpub require a valid `OwnershipProof`; unowned topics remain open but un-reflectable.
- A publish can be signed by a key with no relationship to the signer's transport nodeId, and verifies end-to-end and round-trips through a real root.
- Per-publisher quota cannot be defeated by rotating the publish key (per the §7(a) anchor).
- Region-keyed pub/sub is behaviorally unchanged.

## 11. Out of scope
- IP-layer / onion / TURN-only anonymity (separate track — `SECURITY-STATUS-v2.32.0.md` Wave E). PublishID is necessary-not-sufficient for author anonymity (R3).
- Ring/group signatures unless §7(e) says now.

## 12. References
- Code: `axona-protocol/src/pubsub/AxonaManager.js` (metrics `:2116/2155/2166/2189/2202`, kill retract `:853/858`, unpub gate `:1024`, `_publisherSeq` `:196`), `src/pubsub/envelope.js` (`:76/130–199`), `src/dht/AxonaPeer.js` (`kill :1416`, `unpub :1528`, `metrics :1800`), `src/utils/hexid.js` (`assembleId :117`).
- Docs: `red team/SECURITY-STATUS-v2.32.0.md` (C-3 Wave A, F-3, Wave E), `red team/red-team-punchlist-v2.6.0.md` (C-3, F-3), `implementation/Pubsub-Lifecycle-Design-v0.2.md`, `architecture/Axona-vs-Vivaldi-v0.1.md` (PoW-vs-Vivaldi for §7(a)).
