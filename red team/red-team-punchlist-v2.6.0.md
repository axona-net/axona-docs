# Axona Security Punch List — consolidated, prioritized (v2.6.0)

**Date:** 2026-05-31
**Inputs merged:**
- Internal *Security Sweep v2 — post-`axona/4`* (5-auditor fresh-eyes pass; `red-team-analysis-v2-post-axona4.md`)
- External *Red Team Vulnerability Assessment v2.6.0* (Antigravity; `red-team-vulnerability-assessment-v2.6.0.md`)

**Standing constraint (unchanged):** no remediation may depend on a centralized
authority, a CA, or a reputation/identity-management service. End-to-end /
self-authenticating only. Every fix below is checked against this.

---

## 1. Cross-auditor convergence — the signal

The external (Antigravity) assessment was conducted independently against the
shipped v2.6.0 kernel. **Every finding it raised maps 1:1 onto the internal v2
register, at the same severity** — and it independently confirms the A-1 mesh
MITM fix is in place. Convergence this clean is the strongest possible signal
about where to spend effort first.

| Antigravity ID | Internal ID | Severity (both) | Status |
|---|---|---|---|
| B-1 Routed-subscribe reflection/amplification | B-1 | **Critical** | open |
| B-2 Lazy-axon promotion memory DoS | B-2 | **Critical** | open |
| B-3 Unauthenticated routing-table mutation (LTP poisoning/eclipse) | B-3 | High | open |
| B-4 Deferred publisher-signature verification | B-4 | High | open |
| C-2 Envelope freshness / replay | C-2 | High | open |
| E-1 Targeted address grinding (Sybil placement) | E-1 | Medium | open |
| (exec summary: DTLS-fingerprint channel binding) | A-1 | Critical | **✅ resolved v2.6.0** |

**What the external pass added beyond confirmation:**
- A **simulator-vs-reality** section (§4 below) — assurance/realism gaps, not vulnerabilities.
- Sharper remediation detail: B-4 ingress verification at the K-closest root axons; E-1 proof-of-work *or* Vivaldi RTT-coordinate clustering.

**What the external pass did NOT cover** (in scope of the internal register, still open):
A-2, C-1, C-3, D-1, D-2, D-3, D-4, E-2, E-3, E-4, F-1…F-5, RTE-8. These remain
on the list below — absence from the external pass is narrower scope, not a
clean bill.

---

## 2. The prioritized punch list

Ordering blends **severity × exploitability × blast radius**, then **effort**
(smaller first within a tier) and **dependency** (foundational fixes before the
ones that rely on them). Grouped into waves that ship as coherent batches —
items in a wave usually touch the same module.

Effort key: **S** ≤ half-day · **M** ~1–2 days · **L** multi-day / architectural.

### Wave 1 — Pub/Sub trust boundary  *(both auditors converge; all in `pubsub/AxonManager.js`)*

| # | ID | Sev | Fix | Effort | Notes |
|---|----|-----|-----|--------|-------|
| 1 | **B-1** | Crit | Reject routed `pubsub:subscribe` where `subscriberId !== meta.fromId` (the axona/4-proven channel peer). | **S** | Extends the C4 check (already enforced on the *direct* path) to the *routed* path. Highest leverage, smallest change. |
| 2 | **B-2** | Crit | Self-proximity gate on lazy-axon promotion: refuse to adopt a topic role unless the topicId is within the node's verified K-closest neighborhood. | **M** | Needs a distance check vs. own id + current synaptome. Closes the browser-crash memory-DoS. |
| 3 | **B-4** | High | Verify the publish envelope's Ed25519 signature at the **K-closest ingress** (root axons) *before* fan-out/caching — not only at the app edge. | **M** | Depends on **C-1** (canonicalization must be total first, or the verify is bypassable). Stops spam being amplified through the tree. |
| 4 | **D-1** | High | Inbound size/count caps (json, `messages[]`, `peerRoots[]`, `subscriberIds[]`); close the `_onAdoptSubscribers` bypass of `maxDirectSubs`. | **S–M** | Natural to land with the pub/sub batch; blunts the amplification surface B-1/B-4 exploit. |

### Wave 2 — Signature soundness & freshness  *(`pubsub/envelope.js`, canonical codec)*

| # | ID | Sev | Fix | Effort | Notes |
|---|----|-----|-----|--------|-------|
| 5 | **C-1** | High | Make `canonical()` total + JSON-valid (target RFC 8785): no literal `undefined`, deterministic `NaN/Infinity/-0` handling. | **M** | **Foundational** — signature collisions / cross-impl verify divergence undermine B-4 and C-2. Do before/with Wave 1 #3. |
| 6 | **C-2** | High | Add per-publisher monotonic sequence + strict TTL window (reject `|ts − now| > 300s`) to the signed envelope; enforce at the routing layer. | **M** | Envelope-format change ⇒ mild flag-day (verification side). Closes replay-to-fresh-subscribers. |
| 7 | **E-4** | Low | Explicit domain-separation tag on envelope/post signing; remove `:`-delimiter ambiguity in CBV construction. | **S** | Cheap hardening; pairs with the envelope work. |

### Wave 3 — Routing integrity  *(`dht/AxonaPeer.js`, NH-1 learning handlers)*

| # | ID | Sev | Fix | Effort | Notes |
|---|----|-----|-----|--------|-------|
| 8 | **B-3** | High | Decouple synaptome mutation from untrusted gossip: only add/reinforce a synapse from **first-party** observation (we initiated, measured RTT, verified the peer's transport-layer identity). Treat `triadic_introduce`/`hop_cache`/`lateral_spread`/`reinforce` as hints, not authority. | **L** | Architectural; the eclipse-prevention keystone. Both auditors flag. Aligns with the no-reputation constraint (first-party measurement, not trust scores). |
| 9 | **D-4** | Med | Trim `local_probe`: don't return the full synaptome to arbitrary callers. | **S** | Cheap graph-mapping mitigation; reduces targeting for B-3/E-1. |
| — | **RTE-8** | — | `addIncomingSynapse` is dead code (zero callers) — delete, or if ever wired, give it the same `fromId`-binding discipline as #8. | **S** | Hygiene. |

### Wave 4 — Bridge & metrics hardening  *(`axona-bridge`, metrics path)*

| # | ID | Sev | Fix | Effort | Notes |
|---|----|-----|-----|--------|-------|
| 10 | **D-2** | High | Bridge WS: Origin allow-list, `maxPayload`, pending-connection cap. | **S** | Standard `ws` server options; closes unauth flood/OOM. Bridge-only deploy. |
| 11 | **C-3** | High | Metrics: bind `metricsResp` to the proven `fromId` (no attacker-named `requesterId`); make the ownership gate **fail closed** when the replay cache is empty; stop tree-wide broadcast. | **M** | Reflection vector; pairs with B-1 mindset. |
| 12 | **D-3** | Med | Dedup by content-hash, not attacker-chosen `publishId`; actually use the declared-but-unused `_seenPublishTtlMs`. | **M** | Prevents forced-eviction re-delivery. |
| 13 | **E-3** | Low | Bridge-link CBV: add a peer nonce (currently server-only) so a captured hello-ack can't be replayed. | **S** | |

### Wave 5 — Privacy  *(`axona-peer`, identity persistence)*

| # | ID | Sev | Fix | Effort | Notes |
|---|----|-----|-----|--------|-------|
| 14 | **F-1** | High | Quantize stored `region` lat/lng to the 8-bit S2 cell the privacy story actually relies on — stop persisting full-precision coordinates. | **S** | Undermines the geo-privacy premise at rest; cheap to fix. |
| 15 | **F-2** | Med | Add a CSP; trim `window.axona` so in-page script can't read the live identity object / pubkey / full topology. | **S–M** | |
| 16 | **F-3 / F-5** | Med / Low | Reduce cross-topic linkage (`signerPubkey` on every publish + stable region; `since:'all'` harvest); randomize connIds (currently sequential base36 → enumerable). | **M** / **S** | F-3 is the harder design question. |

### Wave 6 — Identity placement, key-at-rest, handshake direction  *(design decisions)*

| # | ID | Sev | Fix | Effort | Notes |
|---|----|-----|-----|--------|-------|
| 17 | **A-2** | High | Directed transcript: bind the handshake to recipient/role id; set `expectNodeId` (currently usually null) so a proof can't be re-aimed. | **M** | Crypto-adjacent to the A-1 family; consider pulling earlier if doing more handshake work. |
| 18 | **E-2** | Med | Encrypt the persisted private key (currently unencrypted PKCS#8) at rest — passphrase or platform keystore. | **M** | UX trade-off; browser path already uses non-extractable keys, so this is mainly the FilePersistence / bridge stable-identity path. |
| 19 | **E-1** | Med | Targeted-placement defense: proof-of-work on identity generation **or** Vivaldi RTT-coordinate cross-check. | **L** | **Decision required** — both options are decentralized (constraint-OK), but PoW taxes honest join UX and Vivaldi adds significant complexity. Recommend deciding the *approach* before scheduling. |
| — | **F-4** | Med (inherent) | The bridge inherently sees IP↔pubkey↔region↔subscription; the embedded bridge peer is a positioned relay. | n/a | Largely architectural/inherent — document the trust boundary; partial mitigations only. |

---

## 3. Recommended sequencing (TL;DR)

1. **C-1** (canonicalization) + **B-1** (subscribe origin) — foundational + highest-leverage, cheapest of the criticals.
2. **B-2** + **B-4** + **D-1** — finish the Pub/Sub trust-boundary batch.
3. **C-2** + **E-4** — envelope freshness once canonicalization is total.
4. **B-3** — the routing-integrity keystone (largest single item; eclipse prevention).
5. **D-2** + **C-3** + **D-3** — bridge/metrics hardening.
6. **F-1** + **F-2** — privacy quick wins.
7. **A-2**, **E-2**, then **E-1** (after the PoW-vs-Vivaldi decision).

A defensible first shippable batch is **C-1 + B-1 + B-2 + B-4 + D-1** as one
"pub/sub trust boundary" kernel release — they're co-located, mutually
reinforcing, and clear the two open Criticals plus the amplification highs.

---

## 4. Simulator-vs-reality (assurance, not vulnerabilities)

From the external assessment §3. These are realism gaps in `dht-sim`, not
exploitable flaws — but they bear on how much confidence the simulator's
results justify, and they connect to existing work:

1. **Instant connection setup.** Sim skips ICE/STUN/TURN/DTLS (1.5–3 s real). — *Partly addressed:* the v2.5.0 real-WebRTC harness (`test/integration/mesh_multipeer.mjs`) now exercises genuine negotiation; connection-time optimization is already logged in the architecture doc's Future Directions.
2. **No-delay RPC timeouts.** Sim skips dead peers instantly; production hangs 3–5 s on silently-dropped peers, degrading lookups under churn. — *Not modeled; worth a churn-with-timeout sim mode.*
3. **Static latencies / no congestion.** Sim models latency as pure distance; ignores queue saturation. High-weight axons may oscillate under congestive latency as LTP reacts. — *Interacts with B-3: congestion-driven reinforcement could destabilize routing even without an attacker.*

---

## 5. Operational note — public exposure of this register

`axona-docs` is a **public** repository, and this register enumerates open,
unmitigated Critical/High findings with attack vectors. **Deliberate decision
(2026-05-31): keep it public** — full-transparency / open-research posture,
consistent with the other red-team analyses already in this folder. The trade
accepted: live exploit detail is publicly readable until each item is fixed,
which lowers the bar for an opportunistic attacker on the deployed network.

Two mitigations make this a reasonable trade rather than a reckless one:
- The two open **Criticals are availability/abuse** issues (reflection/
  amplification, memory-exhaustion DoS), **not** confidentiality or
  key-compromise — and the network is pre-adoption / low-value-target today.
- The fix for the cheapest Critical (**B-1**) is a few lines; closing the
  exposure window is mostly a function of shipping Wave 1 quickly.

The public `SECURITY-CHANGELOG.md` remains **resolved-items-only** regardless —
this register is where open work is tracked; the changelog is where shipped
guarantees are advertised.
