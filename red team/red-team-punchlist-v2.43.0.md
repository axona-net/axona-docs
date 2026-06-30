# Axona Security Punch List — consolidated & ranked (v2.43.0)

**Date:** 2026-06-15 · **Line:** `axona/5` / kernel **v2.43.0** (live on
`axona.net` / `bridge.axona.net`; SF testnet staging).
**Supersedes:** [`red-team-punchlist-v2.6.0.md`](red-team-punchlist-v2.6.0.md)
(point-in-time audit) and the open-items section of
[`SECURITY-STATUS-v2.32.0.md`](SECURITY-STATUS-v2.32.0.md).
**Companion:** [`SECURITY-STATUS-v2.43.0.md`](SECURITY-STATUS-v2.43.0.md) (full
state + shipped baseline).

**Standing constraint:** no remediation may depend on a centralized authority, a
CA, or a reputation/identity service. Self-authenticating / end-to-end only.

This list merges three sources, ranked by **severity × exploitability ×
blast-radius**, then effort:

- **Carry-over** open items from the v2.6.0 register / v2.32.0 status (letter-IDs:
  A-/D-/E-/F-/SP-).
- **G-series** — the external [Bridge Security Assessment](https://github.com/axona-net/axona-bridge/issues/1) (June 2026).
- **GG-series** — the [*From Gates to Gradients*](../architecture/Gates-to-Gradients-1-Costly-Identity-v0.1.md) affordances (governance unbundled from control).

Effort: **S** ≤ ½-day · **M** 1–2 days · **L** multi-day / architectural.
Closed since v2.32.0: **C-3, SP-10, SP-11** (v2.33.0), PoW format scaffolding at
difficulty 0 (v2.34.0), publisher-location-privacy / region-not-in-envelope
(v2.41.1, partially closes F-3). **v4.9.1** (2026-06-30, testnet) partially closes
the **Omission / black-hole** item — see #23: the *accidental* black-hole vectors
are eliminated (bridge excluded from every root/relay selection path; a subscriber
no longer abdicates to an unreachable closer node) and silence is now **observable**
(dense per-topic root sequence ⇒ a subscriber detects a dropped message as a gap).
Also hardened message ordering: subscribers rank by the **root's** monotonic stamp,
not a publisher's self-declared (skewable) timestamp.

---

## Ranked summary (most critical first)

| # | ID | Sev | Item | Effort | Source |
|---|----|-----|------|--------|--------|
| 1 | **G-1** | 🔴 CRIT (strategic) | Directory enumeration / mass-shutdown — public fleet target list | L (+ S doc now) | Bridge assessment |
| 2 | **E-1 / GG-1** | 🔴 High strategic | Costly identity — memory-hard PoW dial-up (format shipped at difficulty 0) | L | v2.6.0 / gradient |
| 3 | **A-2** | 🟠 High | Directed-transcript binding absent on web/mesh transport (≈all real users) | M | v2 sweep |
| 4 | **G-3** | 🟠 High | Supply-chain: `curl\|bash` from `main`, no pin/checksum/sig | S–M | Bridge assessment |
| 5 | **D-2** | 🟠 High | Bridge WS: no Origin allow-list / `maxPayload` / pending-conn cap | S | v2.6.0 |
| 6 | **G-4** | 🟠 High | Bridge Sybil → bootstrap dominance (rides E-1 bridge-role PoW) | L | Bridge assessment |
| 7 | **G-2 / F-4** | 🟠 High | Malicious-but-functional bridge — passive metadata surveillance | L | Bridge assessment |
| 8 | **GG-2** | 🟡 High leverage | Cascade telemetry — "build the measurement" (grades all gradients) | M | gradient |
| 9 | **SP-6** | 🟡 Med | `mesh:signal` inbound lacks per-source rate + size cap | S–M | v2 sweep |
| 10 | **G-5** | 🟡 Med | TURN username embeds persistent node-id (`<expiry>:<peerId>`) | S | Bridge assessment |
| 11 | **G-8** | 🟡 Med | `/healthz` fingerprint + `uplink.connected` seed tell | S | Bridge assessment |
| 12 | **G-7** | 🟢 Low | Raw bridge port 8080 world-reachable | S | Bridge assessment |
| 13 | **E-2 / G-6** | 🟡 Med | Identity keypair plaintext at rest (bridge + relay file) | M | v2 sweep / bridge |
| 14 | **F-1 / G-9** | 🟢 Low | Coordinate precision at rest / bridge geo discloses jurisdiction | S | v2 sweep / bridge |
| 15 | **F-2** | 🟡 Med | No CSP; `window.axona` exposes identity/topology to in-page script | S–M | v2 sweep |
| 16 | **GG-3** | 🟡 Med | Soft retraction + annotations (soft layer over shipped `kill`) | M | gradient |
| 17 | **GG-4** | 🟢 leverage | Forkable filter sets — plural moderation surface (app-layer) | M | gradient |
| 18 | **GG-5** | 🟢 Low | Agent legibility — voluntary signed agent-class on publish identity | S–M | gradient |
| 19 | **GG-6** | 🟡 Med (hard) | Friction scaled to reach — per-relay damping + reach-graded PoW | L | gradient |
| 20 | **F-3 / F-5** | 🟢 Low | Cross-topic linkage (partly closed v2.41.1); enumerable connIds | S / M | v2 sweep |
| 21 | **D-3 / E-3** | 🟢 Low | Dedup-TTL nit; bridge-link CBV is server-nonce only | S | v2.6.0 |
| 22 | **G-10** | ⚪ Info | Operator legal / jurisdictional exposure (undocumented) | S (doc) | Bridge assessment |
| 23 | **Omission** | — research (partial) | Black-hole root drops a topic silently — *accidental* vectors closed + now detectable (v4.9.1); **adversarial** route-around still open | L | god's-eye |
| 24 | **Anonymity tiers** | — research | Location / IP / interest / linkability anonymity, opt-in | L | god's-eye |
| 25 | **Wave F hygiene** | — | Bounded-map sweeps, dead code, dht-sim binding-model | S each | v2 sweep |

> **Ship-next batch (the cheap, clearly-correct "(c)" fixes — bridge-only, mostly S):**
> **G-5** (ephemeral TURN username), **G-7** (bind Node to `127.0.0.1`), **G-8**
> (minimal unauth `/healthz`), **G-3** (pin installer to release tags + checksum +
> lead clone-review), plus the **G-1 claim-qualification** doc edit and **G-10**
> OpSec/legal section. None need a kernel change.

---

## Tier 1 — Critical / strategic

### G-1 · Directory enumeration / mass-shutdown 🔴
The public `axona:bridge-directory` is a self-updating map of the whole fleet
(every `wss://` endpoint, coords, version, key). A state adversary enumerates in
minutes and targets the fleet at once; "no one address to block" holds vs *ad-hoc*
blocking, not vs fleet-wide takedown. **Deeper:** bridges are `wss://`-to-known-
domain → SNI/DNS-blockable + scan-fingerprintable regardless, so access control is
*necessary, not sufficient* — the real gap is no obfuscated transport.
**Plan:** (now, S) qualify the Synopsis claim + ship minimal `/healthz` (G-8);
(design, L) BridgeDB-style **partitioned / costly-identity-gated directory read**
+ **public-bootstrap vs private-federation** address split; (research, L)
pluggable-transport obfuscation. Full analysis:
[`architecture/Bridge-Directory-Enumeration-and-Privacy-v0.1.md`](../architecture/Bridge-Directory-Enumeration-and-Privacy-v0.1.md).

### E-1 / GG-1 · Costly identity (memory-hard PoW) 🔴 strategic keystone
The placement/Sybil keystone and the anchor for G-1 (cost the read), G-4 (bridge
Sybil), and GG-6 (reach friction). **Decided: memory-hard PoW** on a separate
puzzle hash, address-decoupled; **format shipped inert at difficulty 0** (v2.34.0).
**Remaining:** Stage-4 — swap the SHA-256 scaffold for the memory-hard fn, run the
phone-WASM benchmark, dial transport (anti-eclipse) / publish (anti-flood)
difficulty as a coordinated cutover. Records:
[`E-1-Placement-Defense-v0.1.md`](../architecture/E-1-Placement-Defense-v0.1.md),
[`Stage4-MemoryHard-PoW-v0.1.md`](../architecture/Stage4-MemoryHard-PoW-v0.1.md),
[`Gates-to-Gradients-1-Costly-Identity-v0.1.md`](../architecture/Gates-to-Gradients-1-Costly-Identity-v0.1.md).

## Tier 2 — High

- **A-2 · Directed-transcript binding on web/mesh transport.** `expectNodeId`
  exists on the node-WS transport but is unthreaded on the web/mesh path (browser↔
  bridge, peer↔peer) — ≈ all real users — leaving the transcript unbound so a proof
  can be re-aimed. Wire the existing primitive into `transport/web/*`. (M)
- **G-3 · Installer supply-chain.** Pin docs/installer to **release tags not
  `main`**, publish a checksum, lead INSTALL.md with **clone → review → run**,
  document the container option. Removes the worst of the curl-pipe-bash root.
  (S–M, ship-next)
- **D-2 · Bridge WS hardening.** Origin allow-list, `maxPayload`, pending-connection
  cap on the `ws` server (`Access-Control-Allow-Origin: *` today). Closes unauth
  flood/OOM. (S)
- **G-4 · Bridge Sybil → bootstrap dominance.** A well-resourced operator runs many
  high-performing bridges and becomes dominant bootstrap infra. Mitigated by
  **E-1 applied to bridge identities** (bridge-role PoW — the deferred hardening
  named in v2.42.0) + client-side cross-bridge directory-consistency checks. (L,
  rides E-1)
- **G-2 / F-4 · Malicious-but-functional bridge (metadata surveillance).** A
  correctly-working bridge can passively log IP ↔ node-id ↔ pairing-graph ↔ TURN
  timing. **Scoped:** content is E2E-DTLS safe; channel binding (A-1) blocks
  impersonation/MITM; reputation is first-party (no global trust to steal), and
  federation blunts directory-view filtering — so the bridge is confined to
  *passive metadata* + *selective degradation*, not content tampering. Residue
  folds into the **anonymity track** + **rotating/decoupled publish identity** +
  **client TURN-trust separation**. (L)

## Tier 3 — Medium / leverage

- **GG-2 · Build the measurement (cascade telemetry).** Highest leverage / lowest
  risk: every gradient is graded blind without it. dht-sim instrumentation first
  (no privacy tension), then aggregate, privacy-preserving production telemetry on
  a `host()`-ed topic. [note 2](../architecture/Gates-to-Gradients-2-Cascade-Telemetry-v0.1.md). (M)
- **SP-6 · `mesh:signal` rate + size cap.** Reuse the `pendingNegotiations`
  self-healing cap + payload ceiling + one-in-flight per (from,to). (S–M)
- **G-5 · Ephemeral TURN username.** Replace `<expiry>:<peerId>` with a per-session
  random token — the node-id need not be in the credential (matters most if TURN
  is a separate operator). (S, ship-next)
- **G-8 · Minimal `/healthz`.** Version only to unauthenticated callers; drop/
  obscure `uplink.connected` (seed tell) and topology; full body behind a
  bridge-to-bridge token. (S, ship-next)
- **E-2 / G-6 · Encrypt identity key at rest.** Bridge identity + relay
  FilePersistence keys are plaintext → theft enables directory *impersonation* and
  persistence after the operator leaves. (Note: reputation is first-party, so a
  thief inherits the *entry*, not the network's trust.) Passphrase / platform
  keystore / systemd `LoadCredentialEncrypted`. (M)
- **F-2 · CSP + trim `window.axona`.** No CSP today; in-page script can read the
  live identity/topology. (S–M)
- **GG-3 · Soft retraction + annotations.** Signed *retracted-by-author* flag and
  third-party annotation envelope referencing a `msgId`, riding alongside (removes
  nothing) — a soft layer over the shipped `kill`/tombstone.
  [note 3](../architecture/Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.1.md). (M)

## Tier 4 — Low / app-layer / hardening

- **G-7 · Bind bridge to `127.0.0.1`.** Node listens `0.0.0.0:8080`; nginx is
  same-host. Bind to localhost (systemd path; Docker already isolates) so 8080 is
  unreachable except via nginx. (S, ship-next)
- **F-1 / G-9 · Coordinate precision.** Quantize to the 8-bit S2 cell at the
  `dumpIdentity` boundary; document coarse bridge coords (small ranking penalty,
  meaningful jurisdiction disclosure avoided). (S)
- **GG-4 · Forkable filter sets.** Subscription as a plural, forkable moderation
  surface (app-layer convention + reference app). Ecosystem leverage: set the norm
  before re-centralization. [note 4](../architecture/Gates-to-Gradients-4-Forkable-Filter-Sets-v0.1.md). (M)
- **GG-5 · Agent legibility.** Opt-in signed agent-class on the decoupled publish
  identity; never in the mandatory kernel envelope.
  [note 5](../architecture/Gates-to-Gradients-5-Agent-Legibility-v0.1.md). (S–M)
- **GG-6 · Friction scaled to reach.** Per-relay local damping (generalizes shipped
  bounded-queue/quota/hold-time) + reach-graded ingress PoW (rides E-1). Hardest;
  honest default-shaper, not a guarantee (fragmentation/under-declaration evade it).
  [note 6](../architecture/Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.1.md). (L)
- **F-3 / F-5 · Linkage + connIds.** F-3 (cross-topic linkage by stable region)
  **partly closed v2.41.1** (region no longer in the envelope; residual is the
  transport node-id prefix the bridge still sees → anonymity track). F-5: randomize
  enumerable sequential connIds. (S / M)
- **D-3 · Dedup-TTL nit** (largely addressed by content-addressed msgId). **E-3 ·
  bridge-link peer nonce** (CBV is server-nonce-only; add a peer nonce so a captured
  hello-ack can't replay). (S each)
- **G-10 · Operator legal/OpSec.** Add an OpSec/legal subsection to INSTALL.md
  (entity vs personal, registrar/DNS choice, what-you-log, coarse coords, response
  plan). (S, doc)

## Tier 5 — Research / assurance

- **Omission detection.** A malicious K-closest root can silently drop a targeted
  topic; signatures stop forgery, not silence. Behavioral forwarding-vitality
  probes feeding a route-around decision. [`black-hole-nodes-v0.1.md`](black-hole-nodes-v0.1.md). (L)
  **Partially addressed (v4.9.1, 2026-06-30):** the *accidental* black-hole — the
  dominant real failure to date — is closed. The bridge (signaling infra that
  cannot serve a topic) is now excluded from **all** root/relay-selection paths,
  and a stranded subscriber claims a reachable root rather than abdicating to a
  closer node the data path can't reach (was: topic never roots → silent 0%
  delivery). And silence is now **observable** at the subscriber: every message and
  kill carries a dense per-topic root sequence, so a missed message shows as a gap
  (`env.seq` jump) instead of vanishing — the kernel-level half of "make silence
  observable." Measured: live cold-convergence strands gone (Howard 23/24); 12 h
  soak churn delivery 25–36% → 82%. **Still open (the adversarial core):** a node
  that *is* the legitimate XOR-closest root and chooses to drop — detection exists
  now (the gap), but automatic **forwarding-vitality probes + route-around** are
  not built. That remains the (L) item.
- **Anonymity tiers.** Opt-in: (1) separate/ring-signature publish key + E2E
  group-encrypted topics + **TURN-only ICE candidates**; (2) onion-routed circuits
  on the mesh-relay primitive + a `geoBits` privacy dial. Default stays fast /
  pseudonymous. (L)
- **dht-sim binding-model + cascade instrumentation.** Validate B-3 convergence,
  GG-6 friction, and the G-1 partition designs at scale before the network grows;
  shared infra with GG-2. (M)

---

## Sequencing

1. **Ship-next batch (now):** G-5, G-7, G-8, G-3, G-1 claim-qualification, G-10 —
   bridge-only, cheap, clearly correct, no kernel change.
2. **Tier-2 kernel/bridge release:** A-2 (transcript binding), D-2 (WS hardening),
   SP-6 (mesh:signal caps), E-2 (key-at-rest).
3. **Decide & build E-1 Stage-4** (memory-hard dial-up) — unblocks G-1 cost-the-read,
   G-4 bridge Sybil, GG-6 friction.
4. **GG-2 cascade telemetry** in dht-sim alongside, so everything after is graded
   with instruments, not faith.
5. **G-1 directory access-control design** (BridgeDB-style) + the anonymity track
   (G-2 residue), each validated in dht-sim before deploy.

## Strategic note

The integrity/authenticity half remains shipped and ahead of the field. The whole
open frontier is **availability, censorship-resistance, anonymity, and anti-abuse**
— where cryptography helps least. The external bridge assessment's value is that it
named the sharpest item on that frontier (**G-1**) and confirmed our own deferred
hardening (bridge PoW, anonymity) is the right list. The honest posture: make
placement and enumeration **expensive** (E-1), make silence **observable**
(omission detection + telemetry), make abuse **unfair to the abuser** (friction,
quotas), make anonymity an **opt-in tier with its cost stated**, and **qualify the
censorship claims** where a capable adversary could falsify them — all without a
central chokepoint.

## Disclosure posture

Public, consistent with the rest of `red team/`. No open item is a confidentiality
or key-compromise Critical; the residuals are availability / censorship-resistance
/ metadata-privacy on a live, public network. The public
[`../SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) advertises **shipped
guarantees only**; this list and [`SECURITY-STATUS-v2.43.0.md`](SECURITY-STATUS-v2.43.0.md)
track **open** work.
