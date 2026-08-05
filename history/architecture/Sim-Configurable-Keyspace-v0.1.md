# Sim-Configurable Keyspace — shrink IDs for scale, full width in prod (v0.1)

**Status:** plan / design note · **Flagged:** 2026-06-26 ·
**Goal:** let the simulator run every protocol — including the real Axona kernel —
at a small ID width so pub/sub-under-churn tests scale to many nodes, while Axona
keeps the **full 264-bit keyspace in production**. This is the prerequisite to the
pub/sub-under-churn **framework upgrade** (a separate, following effort).

---

## 1. Why

The simulator drives the **real `@axona/protocol` kernel** (via `Transport.sim` /
`dht-sim/src/dht/neuromorphic/TransportAxonaEngine.js`, used by the churn harnesses
`relay-churn-experiment.mjs` / `pubsub-real-kernel.mjs`). The kernel's **264-bit**
IDs (66-char hex, 33-byte BigInts) are heavy per-node and cap the node count we can
simulate. The other sim protocols (Kademlia, Neuromorphic `NX*`/`NS*`) already run
~64-bit, so Axona is the outlier. Shrinking the kernel's IDs in-sim is the lever.

## 2. Decisions (locked)

- **ID shape (sim profile):** region prefix stays **8 bits**; the hash component (the
  "rest") shrinks **256 → 64 bits**. Therefore:
  - **transport / nodeId** (region-prefixed) = **72 bits**
  - **topicId** (region-prefixed) = **72 bits**
  - **authorId** (no region) = **64 bits**
  - Production is unchanged: hash 256 → nodeId/topicId **264-bit**, authorId 256-bit.
  The single knob is **`hashBits` (256 prod / 64 sim)**; `regionBits = 8` fixed.
- **Injection:** `configureKeyspace({ hashBits })`, **set-once** at sim startup before
  any identity/peer is minted. Prod never calls it → stays 264. (No env magic; a
  module-level *active profile* in `hexid.js`, guarded + logged so it can't silently
  shrink a prod build.)
- **Scope:** parameterize the **Axona kernel** AND **audit every other protocol** so
  all honor the same `idBits` (fair same-width comparison).

## 3. The `KeyspaceProfile`

Centralize today's hardcoded constants in `src/utils/hexid.js` into an active profile:

```
KeyspaceProfile = {
  regionBits,           // 8 (fixed)
  hashBits,             // 256 (prod) | 64 (sim)
  idBits,               // regionBits + hashBits  → 264 | 72
  authorIdBits,         // hashBits               → 256 | 64
  hexChars,             // ceil(idBits/4)         → 66 | 18
  authorHexChars,       // ceil(authorIdBits/4)   → 64 | 16
  maxId, maxHash, regionShift (= hashBits as BigInt),
}
```

`configureKeyspace({ hashBits })` recomputes the profile; default profile = 256.
All width-dependent helpers (`assembleId`, `regionOf`/`hashOf`, `toHex`/`fromHex`
width, `randomU256`→`randomU(hashBits)`, `clz264`→`clz(idBits)`, XOR/distance)
read the active profile instead of constants.

## 4. The authorId / signature wrinkle (the one real subtlety)

In prod, **`authorId === pubkeyHex === signerPubkey`** — the author id IS the raw
256-bit Ed25519 public key, which is what self-authenticating verification checks.
A 64-bit sim authorId can't simultaneously be a 64-bit routing/owner id **and** a
verifiable pubkey. Two ways to resolve (Phase 0 decision):

- **(A) Decouple addressing id from credential.** authorId becomes a derived
  `truncate(SHA-256(pubkey), hashBits)` used for owner-keyed topic derivation +
  key-derived region; the envelope still carries the real pubkey for verification.
  Cleaner model, but touches every place that assumes `authorId === signerPubkey`.
- **(B) Sim relaxes verification.** The sim cares about routing/delivery, not crypto;
  run the sim profile with signature verification stubbed and authorId = the 64-bit
  derived id. Smaller change, but the sim then exercises a slightly different ingress
  path than prod (no B-4 sig check). 

Recommendation: **(B) for the churn framework** (the test target is convergence/
delivery, not auth), with a note that auth-path tests keep the 256-bit profile.

## 5. Phases

- **Phase 0 — decide the §4 authorId/signature approach; spike `hexid.js` profile**
  to confirm the blast radius is centralizable (11 kernel files consume the width
  constants: `AxonaPeer`, `DHTNode`, `Subscription`, `identity`, `nodeid`, `geo`,
  the `transport/{sim,node,web}` + `wstransport`, `index`, `hexid`).
- **Phase 1 — kernel: `KeyspaceProfile` + `configureKeyspace`.** Thread the active
  profile through `hexid` → `identity` (nodeId/authorId) → `pubsub/post`
  (topicId derivation, owner/region) → routing/XOR/clz/hex. Default 264; guard prod.
- **Phase 2 — sim wiring.** `idBits` control → `configureKeyspace({ hashBits })` in
  the `TransportAxonaEngine` setup, before peers are minted. Re-vendor the kernel
  into `dht-sim/vendor/axona-protocol`.
- **Phase 3 — non-Axona audit.** Replace hardcoded `64` / `randomU64` /
  `64 - GEO_BITS` in `NX*`/`NS*`/Kademlia so they truly honor `bits` (and a region
  width) at the chosen sim widths.
- **Phase 4 — validation.** (a) Kernel full `npm test` at 264 stays green (prod
  unchanged); (b) new kernel smokes at the 72/64 sim profile (id round-trip, topic
  derivation, XOR ordering, nodeId/authorId widths); (c) sim scale test showing the
  node-count headroom jump; (d) cross-protocol parity at equal `idBits`.
- **Phase 5 (separate, follows this):** upgrade the pub/sub-under-churn framework on
  top of the now-small IDs.

## 6. Risks

- **Prod-shrink footgun** — `configureKeyspace` leaking into a prod build. Mitigate:
  default 256, sim-only caller, set-once guard + a loud log, and a kernel test that
  asserts the default profile is 264-bit.
- **Blast radius** — 11 kernel files + hex-width changes (66→18, authorId 64→16
  chars) ripple into canonical/envelope formatting, wire frames, and many tests.
- **Collisions** at 64-bit hash are higher than 256-bit but negligible at sim scale
  (thousands of nodes in a 2^64 space).
- **Re-vendor discipline** — every kernel change must sync into `dht-sim/vendor`.
- **authorId decoupling** (if §4-A) is the deepest change; §4-B contains the blast.

## 7. Open question for sign-off

Resolve §4 (authorId/signature handling in the sim profile) — **RESOLVED: (B)
relax verification in the sim profile** (signed off). Everything else is locked by §2.

---

## 8. Implementation status (kernel v4.4.0)

**Phase 1 — kernel `KeyspaceProfile` + `configureKeyspace` — DONE.**
- `src/utils/hexid.js`: width constants are `export let` live bindings recomputed by
  `_recompute()`; `configureKeyspace({hashBits, regionBits})` (validated, set-once,
  loud stderr log), `getKeyspace()`. Width-generic `clz264`, profile-aware
  `randomU256`. Added `AUTH_VERIFY_RELAXED` (= `hashBits < 256`).
- Threaded through `identity/nodeid.js` (HASH_MASK), `identity/index.js`
  (authorId = `pubkeyHex.slice(0, AUTHOR_HEX_CHARS)`), `pubsub/post.js`
  (topic id truncated to `HEX_CHARS`, owner regex `AUTHOR_HEX_CHARS`).
- Exported `configureKeyspace`/`getKeyspace`/`AUTHOR_ID_BITS`/`AUTHOR_HEX_CHARS`
  from `src/index.js`.

**Phase 1(B) — relaxed verification (decision B) — DONE.**
- `pubsub/envelope.js` `verifyEnvelope()` skips the Ed25519 `verify()` + 32-byte
  pubkey-length check when `AUTH_VERIFY_RELAXED`; KEEPS structure + msgId recompute
  (a tampered message still fails `bad_msgid`). `buildEnvelope` + `AxonaPeer.pub`
  carry the author **public id** as `signerPubkey` (= `identity.authorId ?? pubkeyHex`)
  so owner-write policy stays consistent at the shrunk width. **No-op in prod**
  (`authorId === pubkeyHex`).
- New `test/smoke_sim_keyspace.mjs` (18 checks: profile, identity/topic widths,
  relaxed-verify + tamper-still-rejected, 72-bit delivery ×15 @100%, owner policy).
  Added to `npm test`. Full kernel suite green at the **264-bit default** (prod
  unchanged); the sim smoke runs in its own process at 72/64.

**Phase 2 — sim wiring + re-vendor — DONE.**
- `dht-sim` `TransportAxonaEngine`: opt-in `opts.hashBits` (default 256 → browser
  benchmark UNCHANGED at 264-bit); when `< 256` calls `configureKeyspace` in the
  constructor before any peer is minted, records `this._keyspace`.
- Node scale harness `harness/pubsub-real-kernel.mjs`: `HASH_BITS` env →
  `configureKeyspace` before minting. **Validated: 72-bit, N=200/SUBS=120 →
  120/120 (100%) delivery through the REAL shipped kernel pub/sub**, clean root
  election (rootSet 5, 1 true-closest, 0 spurious), tree depth 2 / 13 sub-axons.
- Re-vendored kernel v4.4.0 into `dht-sim/vendor/axona-protocol`; the 12
  kernel-integration smokes pass at the 264 default.

**Phase 3 — non-Axona protocol audit — FINDING (decision needed).**
- Kademlia / G-DHT run on the **legacy `src/utils/geo.js` 64-bit path**
  (`randomU64`, `clz64`, `padStart(16)`); the legacy god's-eye `AxonaEngine`
  (NS/NX variants) likewise (`64 - GEO_BITS`). They were NEVER the scale
  bottleneck — only the kernel's 264-bit IDs were (the whole motivation, §1).
- They DO honor `bits`/`idBits` for **bucket count / stratum cap**, but **ID
  generation is fixed 64-bit** (`randomU64`) and ignores `idBits` for width
  (stratum uses a hardcoded `63 - clz64`).
- So at the canonical sim profile, Axona is **72-bit** (8 region ‖ 64 hash) and
  the baselines are **64-bit flat** — same *hash* width, different *total*. Exact
  total-width parity would need a width-generic `randomU`/`clz` in the geo path
  (replacing `randomU64`/`clz64`), a change to baseline protocols that already run
  small with **no scale benefit**. **RESOLVED: accept the 64-vs-72 asymmetry** —
  the comparison is at equal *hash* width (64); Axona's 8-bit region prefix is
  inherent to its design, and the baselines stay on their fast legacy 64-bit path
  untouched. No baseline refactor.

**Phase 4/5 — pending** (full validation matrix; then the churn-framework upgrade).

Deploy of kernel v4.4.0 is **gated** (not pushed) — additive + prod-safe (default
stays 264), but no testnet/prod deploy until the churn-framework work lands.
