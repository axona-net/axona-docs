# Axona Security Sweep v2 — post-`axona/4` (kernel v2.4.0)

**Date:** 2026-05-30
**Scope:** Full-stack fresh-eyes review after the `axona/4` authenticated-identity
handshake and Security Batch 1 (M4/C4/H4/M5) + the pub/sub replay-idempotency fix.
**Method:** Five independent auditors, each a distinct threat-model lens, each
reading the current v2.4.0 source with **no** knowledge of the prior finding list
(C1–C5/H1–H5/M1–M6) — to surface requirements from multiple perspectives and
avoid anchoring. Findings below are deduplicated across auditors and mapped to the
prior register.
**Constraint (unchanged):** no remediation may depend on a centralized authority,
a CA, or a reputation/identity-management service. End-to-end / self-authenticating
only.

> Cross-auditor convergence is the signal worth acting on: the single Critical
> that two independent auditors (crypto + bridge/transport) flagged with no
> coordination is the **mesh channel-binding gap** — which we had *deferred* as
> "C3 follow-up." That deferral was the mistake; it is promoted to #1.

---

## 1. The headline

> **✅ RESOLVED in kernel v2.6.0 (2026-05-30).** The mesh CBV now folds each side's
> DTLS certificate fingerprint (parsed from local/remote SDP via
> `MeshManager.fingerprintsFor`) alongside the nonce pair, through the existing
> `cbvFromFingerprints`. A fingerprint-rewriting bridge presents a different cert
> on each leg, so the two endpoints derive divergent CBVs and the mutual signature
> fails — the untrusted-bridge premise is restored. The binding fails **closed**
> (no fingerprints ⇒ no bind on the real mesh path; nonce-only is reserved for the
> sim/loopback paths that have no DTLS to bind to, and callback presence is a
> local, non-negotiated decision so a peer can't be downgraded remotely).
> Verified by `smoke_mesh_auth_loopback` (honest fingerprints bind; a simulated
> MITM rewrite leaves both sides unbound) and end-to-end by the real-WebRTC
> `test/integration/mesh_multipeer.mjs` harness. Note this is a flag-day change:
> v2.6.0 and pre-2.6.0 peers compute different mesh CBVs and won't bind to each
> other directly during the rollout window (bridge link + relayed pub/sub
> unaffected); a dual-mode verify was rejected as a downgrade vector.

**A‑1 — The WebRTC mesh channel binding is not bound to the channel → a malicious
bridge is a transparent MITM on all "direct" peer traffic.** (Critical)

The `axona/4` CBV (channel-binding value) on the mesh path is
`cbvFromNonces(myNonce, peerNonce, meshId)` — application-layer nonces that travel
as cleartext through the very signaling channel the bridge relays. The bridge can
terminate DTLS on both legs of a WebRTC link (rewriting `a=fingerprint` in the
relayed SDP), forward the nonce + Ed25519-proof frames verbatim, and both endpoints
derive the **same** CBV and both signatures verify — neither side can tell the
channel was split. The module header *claims* MITM resistance; it is **not realized**
because the CBV is not derived from the channel secret. The fix is already written
but **never called**: `cbvFromFingerprints()`.

- Independently reported as **CRY‑1** (crypto lens) and **BRG‑1/BRG‑2/MESH‑1**
  (bridge/transport lens).
- Maps to prior **C3** (deferred). Two fresh auditors rate it Critical → un-defer.
- Note: the *bridge link itself* (wss to the bridge host) is legitimately
  bridge-terminated — authenticating **to** the bridge is fine. The exposure is
  specifically peer↔peer **mesh** traffic that is supposed to be end-to-end.

**Remediation:** fold each side's DTLS certificate fingerprint (from
`localDescription`/`remoteDescription`/`getStats`) into the CBV via the existing
`cbvFromFingerprints`. A fingerprint-rewriting bridge then produces divergent
CBVs and the signature fails. Pair with **A‑2** (directed transcript).

---

## 2. Consolidated finding register (deduped; mapped to prior)

> **Status reconciliation (updated 2026-05-31).** This section is the *original
> v2-sweep analysis*; each finding below is written as it was first observed.
> Remediation status is tracked live in the consolidated
> [punch list](red-team-punchlist-v2.6.0.md) — **treat the punch list as the
> authoritative register.** Findings carrying a **✅vX.Y.Z** tag are RESOLVED in
> the kernel as of that version; their prose has been rewritten to past tense so
> it reads as the (now-fixed) original observation, not an open gap.
> **Resolved through kernel v2.10.0:** A‑1 (v2.6.0); B‑1, B‑2, B‑4, C‑1, D‑1
> (v2.7.0); B‑3, D‑4 (v2.8.0); C‑2, E‑4 (v2.9.0). **Still open:** A‑2, C‑3, D‑2,
> D‑3, E‑1, E‑2, E‑3, F‑1, F‑2, F‑3, F‑4, F‑5.

Severity: Crit / High / Med / Low. "Prior?" = relation to the first analysis.

| ID | Finding | Sev | Prior | Auditor IDs |
|----|---------|-----|-------|-------------|
| ~~**A‑1**~~ | Mesh CBV not bound to DTLS fingerprint → bridge MITM of mesh — **✅ RESOLVED v2.6.0** | Crit | C3 (deferred) | CRY‑1, BRG‑1/2, MESH‑1 |
| **A‑2** | Handshake transcript is undirected (no recipient/role id); `expectNodeId` usually null | High | new | CRY‑5 |
| ~~**B‑1**~~ ✅v2.7.0 | **RESOLVED:** routed `pubsub:subscribe` *had* allowed `subscriberId ≠ fromId` → reflection/amplification (full feed + ≤100-msg replay blast at a victim). Now the routed path enforces `subscriberId === fromId` (`AxonaManager._onSubscribe`: `if (fromId !== null && subscriberId !== fromId) return 'forward'`). | Crit | C4 *residual (direct path only was fixed)* | DOS‑1 |
| ~~**B‑2**~~ ✅v2.7.0 | **RESOLVED:** lazy-axon promotion *had* no self-proximity gate → unbounded role allocation for random topicIds (memory DoS). Now gated by `_mayHostTopic` (self must be within the topic's K-neighbourhood) before any role is allocated. | Crit | C5 | DOS‑2 |
| ~~**B‑3**~~ ✅v2.8.0 | **RESOLVED:** routing learning handlers (`triadic_introduce`, `hop_cache`, `lateral_spread`, `reinforce`) *had* trusted message *content* and discarded the proven `fromId` → table poisoning / eclipse / unevictable self-reinforce. Now gossip feeds a *candidate pool* (verified-admission only); `reinforce` is bound to an existing first-party synapse with capped weight; `local_probe` disclosure trimmed (D‑4). | High | H1 (broader) | RTE‑1/2/3/7 |
| ~~**B‑4**~~ ✅v2.7.0 | **RESOLVED:** `_onPublishDirect` *had* let any peer inject into any topic; publisher signature was only checked at app layer *after* network fan-out. Publisher signature now verified at K-closest ingress before fan-out. | High | C2 (partial) | DOS‑3 |
| ~~**C‑1**~~ ✅v2.7.0 | **RESOLVED:** `canonical()` *had* emitted literal `undefined`, mapped `NaN/Infinity/-0` lossily, and produced non-JSON output → signature collisions + cross-impl verify divergence. Now total / JSON-valid (RFC 8785-style). | High | **new** | CRY‑2/3 |
| ~~**C‑2**~~ ✅v2.9.0 | **RESOLVED:** signed envelopes *had* no freshness (no nonce/seq/expiry) → unlimited replay to fresh subscribers / restarted nodes. Now envelope **v2** signs a domain-tagged core with a per-publisher monotonic `seq` + `ts`; a 5-min freshness window (`MAX_PUBLISH_SKEW_MS`) is enforced at live ingress against the *signed* ts. | High | H2 | CRY‑4 |
| **C‑3** | Metrics reflection: `metricsResp` to attacker-named `requesterId`; ownership gate fails OPEN when replay cache empty; broadcast fans tree-wide | High | M1/M2 (sharper) | DOS‑4 |
| ~~**D‑1**~~ ✅v2.7.0 | **RESOLVED:** *had* no inbound payload/size caps (json, messages[], peerRoots[], subscriberIds[]); `_onAdoptSubscribers` bypassed `maxDirectSubs`. Inbound size/count caps added; the adopt-subscribers bypass closed. | High | M3 | DOS‑5 |
| **D‑2** | Bridge WS: no Origin check, no `maxPayload`, no pending-conn cap → unauth flood / OOM | High | **new** (bridge) | BRG‑3 |
| **D‑3** | Dedup caches FIFO-evictable by attacker-chosen `publishId` → forced eviction re-enables re-delivery/re-relay; `_seenPublishTtlMs` declared but unused | Med | **new** | DOS‑6 |
| ~~**D‑4**~~ ✅v2.8.0 | **RESOLVED:** `local_probe` *had* returned ~the entire synaptome to any caller → cheap graph mapping for targeting. Disclosure trimmed as part of the B‑3 routing-trust hardening. | Med | H3 | RTE‑4 |
| **E‑1** | Targeted placement cheap: 8-bit geo prefix self-asserted + partial suffix grinding (~seconds for ~20 bits) → enter a victim/topic K-set | Med | Sybil/S1 (sharper) | RTE‑6 |
| **E‑2** | Private key persisted as unencrypted PKCS#8 (bridge stable identity + any FilePersistence node) | Med | H4 (at-rest variant) | CRY‑8 |
| **E‑3** | Bridge-link CBV freshness is server-only (no peer nonce) → nonce+connId reuse = replayable hello-ack | Low | new | AUTH‑1 |
| ~~**E‑4**~~ ✅v2.9.0 | **RESOLVED:** `cbvFromNonces` `:`-delimiter ambiguity; envelope/post signing *had* no explicit domain-separation tag. Envelope v2 now signs a domain-tagged core (`axona:pubsub-envelope:v2`); kill/unpub carry their own domain tags (`axona:pubsub-kill:v1`, `axona:pubsub-unpub:v1`). | Low | new | CRY‑6/7 |
| **F‑1** | Raw geolocation lat/lng (full precision) persisted in `region`, far finer than the 8-bit cell the privacy story relies on | High | **new** | PRV‑1 |
| **F‑2** | No CSP; `window.axona` exposes the live identity object + pubkey + full topology to any in-page script | Med | new | PRV‑5/6 |
| **F‑3** | `signerPubkey` on every publish + stable region → cross-topic linkage; `since:'all'` lets late subscribers harvest historical publisher set | Med | new | PRV‑2/8 |
| **F‑4** | Bridge inherently sees IP↔pubkey↔region↔subscription graph; embedded bridge peer is a universal relay positioned to selectively eclipse | Med (inherent) | H5 | PRV‑4, EMBED‑1 |
| **F‑5** | Sequential base36 connIds → enumerable; leak join order; enable signal-spam targeting | Low | new | BRG‑5 |

**Cleanup note (RTE‑8):** `addIncomingSynapse` has **zero callers** — the reverse-routing
index is dead code in production peers (harmless now, but must carry the same
`fromId`-binding discipline as the other handlers if ever wired to network input).

---

## 3. Genuinely new vs. prior analysis

The prior pass missed: **C‑1** canonicalization (signature-collision + interop
hazard), **D‑3** dedup forced-eviction (adjacent to the replay bug just fixed —
the `_appDelivered` cap can be flushed), **F‑1** sub-cell lat/lng persistence
(undermines the geo-privacy premise at rest), **F‑2** CSP / `window.axona`
exposure, **D‑2** bridge WS limits, **E‑3** bridge-link mutual-nonce, **F‑5**
connId enumeration, and the **RTE‑8** dead-code observation.

---

## 4. Confirmed sound

The `axona/4` primitive itself (BIND + POSSESS, key-derived nodeId, verifier
reconstructs CBV from its own view, pinned Ed25519, CSPRNG); the M4 (`stub:`→false)
and M5 (privkey↔pubkey probe) fixes; the **direct** subscribe/unsubscribe
authorization (C4 on the K-path); the `_deliverToApp` exactly-once funnel for honest
inputs; per-role replay-cache bounding + GC; non-extractable browser keys + per-session
rotation; and **cross-protocol CBV domain separation** (`'bridge'` / `meshId` / `'ws'`
tags) so a hello captured on one link can't replay onto another. The machinery is
good — the gaps are in *what the signature binds to* (A‑1/A‑2/C‑1/C‑2) and in
*trusting authenticated peers as narrators of network state* (B‑1…B‑4).

---

## 5. Recommended re-prioritized roadmap

1. ~~**A‑1** channel-bind the mesh CBV to DTLS fingerprints (wire up `cbvFromFingerprints`) — restores the untrusted-bridge premise.~~ **✅ DONE — kernel v2.6.0.**
2. ~~**B‑1 + B‑2** — extend the C4 origin check to the routed subscribe path; add a self-proximity gate on role adoption.~~ **✅ DONE — kernel v2.7.0.**
3. ~~**C‑1 + C‑2** — make `canonical()` total/JSON-valid (target RFC 8785); add signed freshness (per-signer seq + expiry) to envelopes.~~ **✅ DONE — C‑1 kernel v2.7.0; C‑2 (+ E‑4 domain separation) kernel v2.9.0.**
4. ~~**B‑3** — bind routing mutations to first-party observation / proven `fromId`.~~ **✅ DONE — kernel v2.8.0 (gossip→candidate-pool, reinforce bound to first-party synapse, D‑4 disclosure trim).**
5. **D‑1** ✅ done (v2.7.0). Remaining: **D‑2/D‑3** (bridge Origin/payload caps + dedup-by-content-hash); **F‑1/F‑2** privacy quick wins (quantize stored coords, add CSP, trim `window.axona`). **Next open priority: F‑1.**

> **Phase A pub/sub lifecycle (kernel v2.10.0)** — additive, non-flag-day — also
> shipped after this sweep: `unsub`/`kill`/`unpub`, bounded queue + per-publisher
> quota on open topics, hold-time TTL (24h default / 48h ceiling), pull-latest.
> Not a finding from this register, but it touches the same ingress paths, so the
> envelope-v2 freshness gate (C‑2) and owner/creator authentication apply to the
> new verbs.

---

## 6. Companion question (open) — speed vs. security elasticity

Recorded for the revisit. Measured this machine (Node Web Crypto), per op:
`deriveIdentity` extractable 0.072 ms / non-extractable 0.120 ms; `buildAuthHello`
(1 sign) 0.029 ms; `verifyAuthHello` (BIND SHA-256 + Ed25519 verify) 0.096 ms;
raw sign 0.026 ms / verify 0.062 ms. **A full mesh handshake ≈ 0.13 ms of crypto
per side — negligible.** Therefore the perceived "longer startup" is *not* the
cryptography; it is dominated by (1) WebRTC ICE/STUN + DTLS bring-up per peer,
(2) un-bundled asset/module load (kernel = 39 ES modules / ~525 KB fetched
individually under the importmap, no bundler), and (3) serialized bridge+mesh
handshake round-trips (where `axona/4` adds ~1–2 RTT, one-time, at connect).
Steady-state routing/delivery latency is unaffected by auth (the gate is at
connection setup, off the routing hot path). Full elasticity analysis to follow.
