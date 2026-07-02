# Axona Security Punch List — re-audit against 4.16.x (v4.16.1)

**Date:** 2026-07-02 · **Lines:** kernel **4.16.1** (testnet: `testnet.axona.net`)
· kernel **3.6.0** (production: `bridge.axona.net` / `axona.net`). Wire `axona/4`
(4.x) on testnet, `axona/4` wire-major on 3.x prod (hermetic partition from
pre-v0.3).
**Method:** code re-verification (not changelog trust) across kernel, bridge,
relay, and browser peer — four parallel reviews with `file:line` evidence,
reconciled against the [SECURITY-CHANGELOG](../SECURITY-CHANGELOG.md).
**Supersedes:** [`red-team-punchlist-v2.43.0.md`](red-team-punchlist-v2.43.0.md)
(2026-06-15). **Companion baseline:** [`SECURITY-STATUS-v2.43.0.md`](SECURITY-STATUS-v2.43.0.md)
(still current for the shipped integrity/authenticity baseline).

**Standing constraint (unchanged):** no remediation may depend on a centralized
authority, CA, or reputation/identity service. Self-authenticating / E2E only.

---

## What changed since v2.43.0 (verified closed)

The ship-next bridge batch and the 3.x pub/sub-integrity wave landed. Verified in
code this audit:

| Item | v2.43.0 | Now | Evidence |
|---|---|---|---|
| **A-2** directed-transcript binding on web/mesh | 🟠 High open | **CLOSED** (mechanism differs — see note) | `web/mesh-auth.js:106-123` folds **both peers' DTLS fingerprints** into the CBV, fail-closed if absent; `web/index.js:580-614` binds bridge leg to serverNonce+connId |
| **G-5** TURN username = node-id | 🟡 open | **CLOSED** | `bridge server.js:216` ephemeral `randomBytes(9)` token, no peer handle |
| **G-8** `/healthz` topology tell | 🟡 open | **CLOSED** | `server.js:414` unauth = status/version only; topology + `/diag` behind operator token (`server.js:466`) |
| **G-7** raw port world-reachable | 🟢 open | **CLOSED in deployment** (code-default nit) | installer + nginx pin loopback; code default is still `HOST='0.0.0.0'` (`server.js:62`) — see New-1 |
| **E-2 / G-6** bridge key-at-rest | 🟡 open | **CLOSED (moot) for bridge**; relay residual | bridge identity is now **ephemeral in-memory**, never persisted (`identity.js:70`); relay durable key still plaintext-at-rest — see O-8 |
| **E-3** bridge-link peer nonce | 🟢 open | **CLOSED (effective)** | CBV binds per-connection serverNonce **+ connId** (`server.js:631`), so a captured hello-ack can't replay onto another connection; residual = still no peer-contributed nonce (low) |
| **F-1 / G-9** coordinate precision at rest | 🟢 open | **CLOSED** | nodeId quantized to the 8-bit S2 cell (`nodeid.js:27`); lat/lng not encoded in the id |
| **Write policy / read-not-write cap / region-steer** | (3.x baseline) | **CLOSED, verified** | owner+write folded into the signed topic descriptor and re-derived at root ingress (`post.js:216`, `AxonaManager.js:577`); region is explicit-or-self, never key-derived (`post.js:199-209`) |
| **Omission — accidental black-hole** | partial (v4.9.1) | **CLOSED (accidental half)** on 4.x | bridge excluded from all root/relay selection (`AxonaManager.js:599,727,776`); dense per-topic `seq` so a drop shows as a gap (`AxonaManager.js:202,587`) |
| **Bounded pub/sub memory** | baseline | **verified** | `CACHE_MAX=1024`, `CACHE_BYTES=16 MiB`, `TTL_MS=24 h` enforced (`AxonaManager.js:112-118,936-948`) |
| **Metrics-as-reflector** | closed v2.33 | **verified on 4.x demand model** | bounded lease (70 s) + coalesce (8 s) + 20 s cadence; snapshot goes to the *derived* metric topic, never an attacker-named address (`AxonaManager.js:178-180,1431-1440`) |

> **A-2 note (verify-recommended, not blocking):** the web/mesh path binds the
> transcript via a *different* primitive than the `expectNodeId` the old item
> named — CBV-over-DTLS-fingerprints on the peer↔peer leg (strong: re-aiming a
> proof requires matching both endpoints' fingerprints) and serverNonce+connId on
> the browser↔bridge leg. The mesh leg is sound by construction; the bridge leg's
> re-aim resistance rests on the ephemeral bridge identity + E2E media and would
> benefit from one focused adversarial test (relay a bridge hello to a second
> browser). Downgraded from High-open to **closed-with-a-test-owed**.

---

## Open items, re-ranked (most critical first)

| # | ID | Sev | Item | Where live | Effort |
|---|----|-----|------|-----------|--------|
| 1 | **G-1** | 🔴 CRIT strategic | Directory enumeration / mass-shutdown — public `axona:bridge-directory` open-write topic is a fleet map | prod + testnet | L |
| 2 | **E-1 / GG-1** | 🔴 High strategic | Costly identity — memory-hard PoW still **inert at difficulty 0**, SHA-256 scaffold (`pow.js:34,70`) | prod + testnet | L |
| 3 | **F-2** | 🟠 High (raised) | No CSP + `window.axona` exposes identity/sign + **author key persisted extractable in localStorage** → XSS = durable authorship forgery | prod + testnet | S–M |
| 4 | **D-2** | 🟠 High | Bridge WS: no `maxPayload`, no Origin allow-list, no pending-conn cap (`server.js:568`, `ACAO:*`) | prod + testnet | S |
| 5 | **G-4** | 🟠 High | Bridge Sybil → bootstrap dominance (rides E-1 bridge-role PoW) | prod + testnet | L |
| 6 | **G-2 / F-4** | 🟠 High | Malicious-but-functional bridge — passive metadata surveillance (scoped: passive only; content E2E, channel-bound, first-party reputation) | prod + testnet | L |
| 7 | **SP-6** | 🟡 Med | `mesh:signal` inbound has **no** per-source rate cap, payload-size cap, or in-flight limit (`AxonaPeer.js:715-726`) | prod + testnet | S–M |
| 8 | **O-8 (was E-2)** | 🟡 Med | **Relay** durable identity key plaintext-at-rest (bridge now ephemeral; relay `FilePersistence` still on disk) | fleet | M |
| 9 | **GG-2** | 🟡 leverage | Cascade telemetry — "build the measurement" (grades every gradient); dht-sim first | — | M |
| 10 | **F-5** | 🟢 Low | Sequential enumerable connIds (`c1,c2,…` base36, `server.js:571`) → connection-count / timing side channel | prod + testnet | S |
| 11 | **F-3 residual** | 🟢 Low | Cross-topic linkage: region left the envelope (v2.41.1) but the bridge still sees the transport node-id **region prefix** → anonymity track | prod + testnet | M |
| 12 | **GG-3 / GG-4 / GG-5 / GG-6** | 🟡–🟢 | Gradient affordances (soft retraction, forkable filters, agent legibility, reach-graded friction) — mostly unbuilt; GG-6 rides E-1 | app-layer | M–L |
| 13 | **Omission — adversarial** | — research | A *legitimate* K-closest root that chooses to drop: detection exists (seq gap) but automatic vitality-probe **route-around** unbuilt | 4.x | L |
| 14 | **Anonymity tiers** | — research | Opt-in TURN-only ICE / group-encryption / onion circuits / geoBits dial | — | L |
| 15 | **Per-publisher quota** | — deferred | Anti-flood publish quota is gated on PoW>0 — folds into E-1, not separately actionable | — | (E-1) |

---

## New this audit (not on the v2.43.0 list)

- **New-1 · Bridge bind default is `0.0.0.0`** (`server.js:62`). Deployment is safe
  (installer sets `HOST=127.0.0.1`, nginx fronts), but the *code default* is
  world-open — a hand-rolled deploy that skips the installer exposes the raw port.
  **Fix (S):** default `HOST` to `127.0.0.1`; require an explicit opt-in for
  `0.0.0.0`. (Docker already isolates.)
- **New-2 · Author signing key is persisted extractable** in `localStorage`
  (`axona.author.v1`, base64 PKCS#8; `identity/index.js:203-211`). This is the
  deliberate cost of durable authorship in a browser (the *node/transport* key is
  non-extractable) — but it sharpens **F-2**: with no CSP, an XSS or a compromised
  dependency reads the key and forges that author's publishes **durably, past the
  session**. This is the concrete reason F-2 is raised to High. **Fix:** CSP first;
  consider a WebCrypto-wrapped author key or passphrase-at-rest as a follow-on.
- **New-3 · Metrics-privacy posture drifted across 3.x→4.x.** The
  SECURITY-CHANGELOG **v3.5.0** entry says "`peer.metrics()` is now an owner-only
  reader." The **v4.12.0** demand-driven model supersedes that: a topic's activity
  snapshot (subscriber count, message count) is published to a *derived, open*
  metric topic for **both open and owned** topics — so owned-topic activity counts
  are public-by-derivation again. This is **advisory-only** (counts are never a
  security input, and the reflector vector stays closed), so it is not a
  vulnerability — but the v3.5.0 changelog claim is now stale for the 4.x line.
  **Fix (doc, S):** a one-line reconciliation note on the v3.5.0 entry pointing at
  v4.12.0; no code change.

---

## Live-exposure caveat (important for ranking)

**Production is still on kernel 3.6.0; testnet on 4.16.1.** The split matters:

- **In prod today:** the 3.x integrity wave (write-policy enforcement, region
  de-steering, read-not-write cap) **and** the bridge G-batch (G-5/G-7/G-8/E-2/E-3)
  — bridge prod runs ≥ v2.33.0.
- **Testnet only (NOT in prod):** the accidental-black-hole closure (v4.9.1), the
  cohort kill/publish convergence (v4.10.0), the single-ID-gate ingress hardening
  (v4.14.0), region-occupancy discipline (staged off), and demand-driven metrics.
- **Open on both:** G-1, E-1, F-2, D-2, SP-6, G-4, G-2. The strategic frontier is
  identical on both lines.

When the 4.x line is promoted to prod, the accidental-omission and ingress-gate
closures become production guarantees — a point in favor of the promotion.

---

## Sequencing (unchanged shape, refreshed contents)

1. **Cheap correctness now (S, bridge/app-only, no kernel change):** New-1 (bind
   default), D-2 (WS `maxPayload` + Origin + pending cap), F-2 (CSP header + trim
   `window.axona` to non-sensitive read-only accessors), New-3 (changelog
   reconciliation line).
2. **Med kernel/relay:** SP-6 (`mesh:signal` per-source rate + size + in-flight
   cap — reuse the `pendingNegotiations` pattern), O-8 (encrypt relay key at rest).
3. **Strategic keystone:** E-1 Stage-4 (memory-hard PoW dial-up) — unblocks G-1
   cost-the-read, G-4 bridge Sybil, GG-6 friction, and the deferred per-publisher
   quota. Gate behind the phone-WASM benchmark + a coordinated difficulty cutover.
4. **GG-2 cascade telemetry** in dht-sim alongside E-1, so everything after is
   graded with instruments.
5. **G-1 directory access-control design** (costly-identity-gated read +
   public-bootstrap/private-federation split) + the anonymity track (G-2 residue),
   each validated in dht-sim before deploy.
6. **A-2 verify-test** (relay a bridge hello to a second browser) to convert the
   "closed-with-a-test-owed" rating to fully closed.

## Strategic note (unchanged)

The integrity/authenticity half remains shipped and ahead of the field; this
re-audit confirms it in code and adds three 3.x/4.x closures (transcript binding,
accidental omission, ingress ID-gate). The open frontier is still **availability,
censorship-resistance, anonymity, and anti-abuse** — where cryptography helps
least and where the sharpest single item (**G-1**) and the keystone (**E-1**) both
live. The one newly-sharpened item is **F-2**: durable browser authorship makes an
XSS a durable-forgery event, so a CSP is now the cheapest high-value fix on the
list.

## Disclosure posture (unchanged)

Public, consistent with the rest of `red team/`. No open item is a confidentiality
or key-compromise Critical *in the protocol* (F-2 is an app-origin XSS
amplifier, not a protocol break). The public
[`../SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) advertises **shipped
guarantees only**; this list tracks **open** work.
