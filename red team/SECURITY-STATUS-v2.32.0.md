# Axona Security Status & Remediation Plan

**Date:** 2026-06-09
**Line:** `axona/5` / kernel **v2.32.0** — live in production (`axona.net` / `bridge.axona.net`) since the 2026-06-08 flag-day cutover; the SF testnet (`testnet.axona.net`) is the staging line ahead of `main`.
**Sources:** consolidated register [`red-team-punchlist-v2.6.0.md`](red-team-punchlist-v2.6.0.md) (+ its 2026-06-05 stability addendum), reconciled against [`../SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) (shipped guarantees) and [`../RELEASE-NOTES.md`](../RELEASE-NOTES.md).
**Standing constraint:** no remediation may depend on a centralized authority, a CA, or a reputation/identity service. Self-authenticating / end-to-end only.

---

## 1. Executive summary

The **integrity and authenticity** half of the security model is built, shipped, and now live for everyone: mutually-authenticated handshake, content-verified pub/sub, replay/freshness, gossip-poisoning (eclipse-via-routing-table) prevention, and a cryptographic network partition. **Both Criticals from the v2.6.0 audit closed in Wave 1 (v2.7.0), and no open item touches confidentiality or key-compromise.** One open item — **C-3** (metrics reflection) — is **re-rated Critical-adjacent on review (2026-06-09)**: it is a B-1-class reflection/amplification primitive that the go-live turned from theoretical into live-exploitable (see §3, Wave A).

The open work clusters on the **availability / anonymity / anti-abuse** frontier — exactly where cryptography does *not* help, and where (per our standing posture) we can measure latency but not the behavior the gaps would enable. Two facts changed the priority calculus versus when the register was written:

1. The network is **live and public** (since the 2026-06-08 cutover), so the punch-list's "pre-adoption, low-value-target" discount **has expired** — availability/abuse items are now exploitable against real users.
2. The register is **public**, so open items (including the C-3 recipe) are readable until fixed.

**Two items lead, on different axes:**
- **Most urgent (tactical, live-exploitable now): C-3** — metrics reflection/amplification to an arbitrary victim on unowned (i.e. all region-keyed) topics. Re-rated Critical-adjacent; pulled to the front of Wave A.
- **Most important (strategic): E-1** — targeted address-grinding / placement, the keystone of the eclipse-and-surveillance class and the gap behind both the pub/sub root-vantage risk and the anonymity weaknesses. Needs the PoW-vs-Vivaldi decision before scheduling.

> **Live-network posture (2026-06-09).** `axona.net` / `bridge.axona.net` are serving real peers on the `axona/5` line. Two facts are now operationally true rather than theoretical: the production **bridge is a live metadata vantage point** (it sees IP↔pubkey↔region↔subscription — F-4, inherent), and every meshed peer **exposes its IP to its mesh neighbors** via WebRTC ICE. The cheapest mitigation for the latter — a **TURN-relayed-candidates-only** privacy switch — is hereby promoted from the research tier (Wave E) to a **near-term optional control**.

## 2. What's resolved (the baseline now in production)

| Area | Guarantee | Shipped |
|---|---|---|
| **Mesh MITM** (A-1) | Per-peer DTLS-fingerprint channel binding | v2.6.0 |
| **Pub/sub trust boundary** (B-1, B-2, B-4, D-1) | Origin-bound subscribe; self-proximity gate on promotion; publisher-sig verified at K-closest ingress; inbound size/count caps | v2.7.0 |
| **Signature soundness** (C-1) | Total / JSON-valid canonicalization (RFC-8785-ish) | v2.7.0 |
| **Routing integrity / eclipse-via-gossip** (B-3, D-4) | Synaptome mutates only on first-party measured observation; gossip is hints, not authority; trimmed `local_probe` | v2.8.0 |
| **Freshness / replay** (C-2, E-4) | Per-publisher seq + TTL window + domain-separated signature | v2.9.0 |
| **Message lifecycle** | `kill`/tombstones, owner-only `unpub`, bounded queue + per-publisher quota, hold-time TTL | v2.10–2.16 |
| **Bridgeless mesh** (SP-1/2/5) | Peer-relayed signaling stays authenticated; reconnect + negotiation self-heal | v2.17–2.22 |
| **Content-addressed msgId** (SP-3/4) | msgId = verified `hash(publisher‖message)`; `postHash` reconciled at ingress; relay setup rate-bounded | v2.23.0 |
| **Network partition** | `axona/5` epoch folded into the signed transcript; replay protection holds under cache pressure; drop-paths observable via `onLog` | v2.28.0 |
| **Region naming** | One canonical name per region (no location-dependent flip-flop) | v2.32.0 |

This is a strong integrity/authenticity story and ahead of most of the field.

## 3. Open issues & the plan

Ordered by **severity × exploitability × blast-radius**, then effort. Effort: **S** ≤ half-day · **M** 1–2 days · **L** multi-day / architectural.

### Wave A — Bridge & metrics hardening *(next; mostly bridge-only deploys)*
| ID | Sev | Issue | Plan | Effort |
|---|---|---|---|---|
| **C-3** | **Crit-adjacent** | **Metrics reflection/amplification.** For *unowned* topics (every region-keyed topic) the ownership gate is skipped and the metrics response is sent to the **attacker-named `requesterId`** (`AxonaManager.js:2155`) → a small request reflects a larger payload to any victim nodeId; same primitive class as B-1 (Critical). Compounded by a **fail-open**: an empty `replayCache` makes an owned topic read as unowned (`:2128` → `anchor=null → owned=false`), opening the gate exactly when state is thin. Live-exploitable since go-live. | Send only to the **proven `meta.fromId`** (never `payload.requesterId`); make the ownership gate **fail closed** when the cache is empty; drop the tree-wide broadcast. | M |
| **D-2** | High | Bridge WS has no Origin allow-list / `maxPayload` / pending-connection cap (`server.js`: `Access-Control-Allow-Origin: *`) | Standard `ws` server hardening; closes unauth flood/OOM | S |
| **D-3** | Med | Dedup TTL (`_seenPublishTtlMs`) declared but unused | *Largely addressed* by content-addressed msgId (v2.23.0); finish the TTL-eviction nit | S |
| **E-3** | Low | Bridge-link CBV is server-nonce only | Add a peer nonce so a captured hello-ack can't replay | S |

### Wave B — Anti-abuse fairness *(matters more now the network is open)*
| ID | Sev | Issue | Plan | Effort |
|---|---|---|---|---|
| **SP-10** | Should-fix | Anonymous publishes bypass the per-publisher quota → open-topic flood evicts signed victims | Key the quota on `signerPubkey ?? 'anon'` | S |
| **SP-6** | Should-fix | `mesh:signal` inbound lacks per-source rate + size cap | Reuse the `pendingNegotiations` self-healing cap + payload ceiling + one-in-flight per (from,to) | S–M |
| **SP-11** | Should-fix | `kill` removes only the first duplicate-content cache copy | Filter-remove all entries matching `postHash`, not `findIndex` the first | S |

### Wave C — Privacy at rest & in the app
| ID | Sev | Issue | Plan | Effort |
|---|---|---|---|---|
| **F-1** | High → Med | Coordinate precision at rest. *Verified:* the browser peer persists one of 15 curated `REGIONS` points (not the user's true GPS), so the browser-at-rest leak is largely already closed. The residual is the **kernel `dumpIdentity` envelope + relay identity file**, which persist whatever precision the caller passed (relay auto-detect / `RELAY_LAT` is city-level) | Quantize to the 8-bit S2 cell **at the `dumpIdentity` boundary** (covers relay + any file persistence) | S |
| **F-2** | Med | No CSP; `window.axona` exposes the live identity/topology to in-page script | Add CSP; trim the exposed surface | S–M |
| **F-3 / F-5** | Med / Low | Cross-topic linkage (`signerPubkey` + stable region); enumerable sequential connIds | Randomize connIds (S); F-3 is the design question feeding the anonymity track | M / S |

### Wave D — Identity placement & handshake
| ID | Sev | Issue | Plan | Effort |
|---|---|---|---|---|
| **A-2** | High | Directed-transcript binding (`expectNodeId`) **exists on the node WS transport** (`wstransport.js:187–285`, bridge↔relay) but is **absent on the web/mesh transport** — the browser-peer↔bridge and peer↔peer paths (≈all real users), where the transcript is unbound and a proof can be re-aimed | Wire the existing `expectNodeId` binding into the web/mesh transport (`transport/web/*`) — primitive already exists, just unthreaded | M |
| **E-2** | Med | Persisted private key unencrypted at rest (FilePersistence / bridge path; browser already uses non-extractable keys) | Passphrase or platform keystore | M |

### Wave E — The strategic keystone *(highest design importance; "cryptography can't fix this")*
| ID | Sev | Issue | Plan | Effort |
|---|---|---|---|---|
| **E-1** | Med sev / **High strategic** | Targeted address-grinding: an adversary grinds an identity into a chosen topic's K-closest set → eclipse / censorship-by-omission / interest-surveillance | **Decision required: PoW vs Vivaldi.** Recommend **PoW** — it raises Sybil-placement cost *without* forcing true location, so it stays compatible with location privacy (Vivaldi pins peers to true RTT geometry and adds model-error + manipulation surface; see [Axona vs. Vivaldi](../architecture/Axona-vs-Vivaldi-v0.1.md)) | L |
| **Omission detection** | — | A malicious K-closest root can silently drop a targeted topic; signatures stop forgery, not silence ([`black-hole-nodes-v0.1.md`](black-hole-nodes-v0.1.md)) | Behavioral forwarding-vitality probes feeding the route-around decision; research-stage | L |
| **Anonymity tiers** | — | Weak across location (geo-prefix by design), IP (WebRTC ICE), interest (root vantage), linkability | Opt-in tiers: **(1)** separate/ring-signature publish key + E2E group-encrypted topics + TURN-only ICE candidates; **(2)** onion-routed circuits on the existing mesh-relay primitive + a `geoBits` privacy dial. Default stays fast / pseudonymous | L |

### Wave F — Hygiene & assurance *(non-exploitable, but do before scale)*
- **Bounded-map leaks:** `_relayReach` (SP-7), `_deadPeers` (SP-8) grow unbounded → TTL/LRU sweep (S each); `leave()` timeout clamp (SP-9, cosmetic); `RTE-8` / `addIncomingSynapse` dead code (delete); `SP-12` glare-dedup null-key (latent / unreachable, defensive).
- **F-4 (inherent):** the bridge sees IP↔pubkey↔region↔subscription. Architectural — document the trust boundary; only partial mitigation (folds into the anonymity track).
- **Simulator realism (assurance, not vulnerabilities):** build the **dht-sim binding-model** to validate B-3 convergence/churn at scale; add a **churn-with-timeout** mode (production hangs 3–5 s on silently-dropped peers); model **congestion** (high-weight axons may oscillate under congestive latency as LTP reacts, even without an attacker).

## 4. Sequencing

1. **Wave A** (bridge/metrics) + **Wave B** (anti-abuse fairness) — cheap, high-leverage, most relevant to a *public, live* network. Ship as one kernel + bridge release.
2. **Wave C** (privacy quick wins) + **Wave D** (A-2, E-2).
3. **Decide E-1 (PoW vs Vivaldi)** — gates the keystone wave; recommend PoW for privacy-compatibility.
4. **Wave E** — E-1, then omission detection, then the anonymity tiers, each validated against the **dht-sim binding-model** before the network grows.

## 5. Strategic note

The model's strength is **integrity/authenticity** — verifiable, shipped, ahead of the field. Its frontier is **availability, censorship-resistance, and anonymity** — the properties cryptography secures least and that we cannot instrument from inside the network. As the network opens to everyone, the priority shifts from "more cryptography" to:

- making placement **expensive** (E-1),
- making silence **observable** (omission detection),
- making abuse **unfair to the abuser** (quota fairness),
- making anonymity an **honest opt-in tier** with its latency cost stated,

— all without a central chokepoint, which is the entire point of the system.

## 6. Disclosure posture

This register is **public** (open-research posture, consistent with the rest of `red team/`). No open item is a confidentiality or key-compromise Critical; the residual risk is availability/abuse on a network that is still early in adoption. The public [`SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) advertises **shipped guarantees only**; this document and the punch list are where **open** work is tracked.
