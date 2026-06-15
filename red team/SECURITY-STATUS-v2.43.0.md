# Axona Security Status & Remediation Plan (v2.43.0)

**Date:** 2026-06-15
**Line:** `axona/5` / kernel **v2.43.0** — live in production (`axona.net` /
`bridge.axona.net` + `bridge-west.axona.net`); the SF testnet
(`testnet.axona.net`) is the staging line ahead of `main`.
**Supersedes:** [`SECURITY-STATUS-v2.32.0.md`](SECURITY-STATUS-v2.32.0.md).
**Sources:** the ranked [`red-team-punchlist-v2.43.0.md`](red-team-punchlist-v2.43.0.md)
(consolidated open items), the external
[Bridge Security Assessment](https://github.com/axona-net/axona-bridge/issues/1)
(June 2026, G-series), the [*From Gates to Gradients*](../architecture/Gates-to-Gradients-1-Costly-Identity-v0.1.md)
affordances (GG-series), reconciled against
[`../SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) (shipped guarantees) and
[`../RELEASE-NOTES.md`](../RELEASE-NOTES.md).
**Standing constraint:** no remediation may depend on a centralized authority, a
CA, or a reputation/identity service. Self-authenticating / end-to-end only.

---

## 1. Executive summary

The **integrity and authenticity** half of the security model is built, shipped,
and live for everyone: mutually-authenticated handshake, content-verified pub/sub,
replay/freshness, gossip-poisoning (eclipse-via-routing-table) prevention, a
cryptographic network partition, and — since the v2.32.0 status — message-lifecycle
convergence, host-without-subscribe, a centralized malformed-frame guard, and the
publisher-location-privacy property (a signed publish discloses **WHO**, never
**WHERE**). Nothing open touches confidentiality or key compromise.

Since v2.32.0, the **Wave A/B tactical items closed**: **C-3** (metrics
reflection), **SP-10** (anon-publish quota), **SP-11** (kill-all-dups) shipped in
v2.33.0; the **E-1 PoW format** shipped inert at difficulty 0 (v2.34.0), locking
the wire so difficulty is a parameter dial, not a flag-day.

Two developments reshape the open frontier, which is — as ever — **availability,
censorship-resistance, anonymity, and anti-abuse**, exactly where cryptography
helps least:

1. **The network now runs a public, federated bridge fleet with an open
   directory** (v2.42.0). That delivered the resilience goal (no single bridge is a
   point of failure) but introduced the **enumeration** exposure below.
2. **Two external/structured reviews landed:** a [bridge security
   assessment](https://github.com/axona-net/axona-bridge/issues/1) (G-series) and
   the *Gates to Gradients* design response (GG-series). Both largely **confirm our
   own deferred-hardening list** (placement PoW, anonymity tiers, anti-abuse
   fairness) and add one sharp new strategic finding.

**Two items lead, on different axes:**

- **Most critical (strategic, new): G-1 — directory enumeration / mass-shutdown.**
  The public directory is a self-updating map of the whole fleet; a state adversary
  enumerates and targets it at once. Our *"no one address to block"* holds against
  ad-hoc blocking, not fleet-wide takedown. Deeper: bridges are
  `wss://`-to-known-domain → blockable/scannable regardless, so access control is
  necessary-not-sufficient. Full analysis:
  [`architecture/Bridge-Directory-Enumeration-and-Privacy-v0.1.md`](../architecture/Bridge-Directory-Enumeration-and-Privacy-v0.1.md).
- **Most important (enabler): E-1 / GG-1 — costly identity.** Memory-hard PoW,
  format shipped at difficulty 0; the Stage-4 memory-hard swap + difficulty dial is
  the keystone that also anchors G-1 (cost the directory read), G-4 (bridge Sybil),
  and GG-6 (reach friction).

> **Honesty action (do now):** the Synopsis's *"no one address to block"* should be
> **qualified** — "no single *fixed* point of failure," with an explicit note that
> simultaneous fleet-wide enumeration-and-takedown is a real threat the open
> directory does not by itself defeat. An overclaim a capable adversary can falsify
> is worse than a stated boundary.

## 2. What's resolved (the baseline now in production)

| Area | Guarantee | Shipped |
|---|---|---|
| **Mesh MITM** (A-1) | Per-peer DTLS-fingerprint channel binding | v2.6.0 |
| **Pub/sub trust boundary** (B-1, B-2, B-4, D-1) | Origin-bound subscribe; self-proximity gate; publisher-sig at K-closest ingress; inbound caps | v2.7.0 |
| **Signature soundness** (C-1) | Total / JSON-valid canonicalization | v2.7.0 |
| **Routing integrity / eclipse-via-gossip** (B-3, D-4) | First-party-only synaptome mutation; gossip is hints | v2.8.0 |
| **Freshness / replay** (C-2, E-4) | Per-publisher seq + TTL + domain-separated signature | v2.9.0 |
| **Message lifecycle** | `kill`/tombstones, owner-only `unpub`, bounded queue + per-publisher quota, hold-time TTL | v2.10–2.16 |
| **Bridgeless mesh** (SP-1/2/5) | Peer-relayed signaling stays authenticated; self-heals | v2.17–2.22 |
| **Content-addressed msgId** (SP-3/4) | msgId = verified `hash(publisher‖message)`; rate-bounded relay setup | v2.23.0 |
| **Network partition** | `axona/5` epoch in the signed transcript | v2.28.0 |
| **Pub/sub abuse hardening** (C-3, SP-10, SP-11) | Metrics can't reflect; anon quota; kill removes all dups | v2.33.0 |
| **PoW format** (E-1 scaffolding) | `pow`/`signerPow` nonce fields + per-role verifier, **inert at difficulty 0** | v2.34.0 |
| **Pub/sub convergence** | Messages converge across replicas (no silent loss); old browsers can still join | v2.36–2.39 |
| **Host without subscribe** | Infra nodes `host()` a topic as durable roots without consuming it | v2.40.0 |
| **Malformed-frame guard** | One dispatch-boundary guard contains any handler error on a corrupt id | v2.40.1–2.40.3 |
| **Publisher location privacy** | A signed publish discloses WHO (`signerPubkey`), never WHERE (region not in envelope) | v2.41.1 |
| **Bridge discovery/failover** | Open signed directory; primary never auto-replaced; first-party ranking; federated | v2.42.0 |

This remains a strong integrity/authenticity story, ahead of most of the field.

## 3. Open issues & the plan

The full ranked list — most critical first, with effort and references — is the
**[punch list (v2.43.0)](red-team-punchlist-v2.43.0.md)**. Summary of the waves:

- **Wave G — bridge directory enumeration & operator safety (NEW, from the bridge
  assessment).** **G-1** directory enumeration / mass-shutdown (🔴 strategic);
  **G-2/F-4** malicious-but-functional bridge metadata surveillance (scoped:
  passive only — content is E2E-DTLS, channel binding blocks impersonation,
  reputation is first-party); **G-3** installer supply-chain; **G-4** bridge Sybil →
  bootstrap dominance (rides E-1); **G-5** TURN username embeds node-id; **G-7**
  port 8080 world-reachable; **G-8** healthz fingerprint / seed tell; **G-9/F-1**
  geo disclosure; **G-10** operator legal/OpSec. The **ship-next batch** (G-3, G-5,
  G-7, G-8, G-10 + the G-1 claim-qualification) is cheap, bridge-only, no kernel
  change.
- **Wave D/E carry-over.** **A-2** directed-transcript binding missing on the
  web/mesh transport (≈all real users) — High; **D-2** bridge WS hardening; **E-2**
  key-at-rest encryption (= the bridge keypair theft → impersonation finding);
  **E-3** bridge-link peer nonce; **SP-6** mesh:signal rate/size cap.
- **Wave E keystone.** **E-1** memory-hard PoW Stage-4 (decided; format shipped) —
  unblocks G-1, G-4, GG-6.
- **Wave C privacy.** **F-1** coordinate quantization at `dumpIdentity`; **F-2**
  CSP + trim `window.axona`; **F-3** partly closed v2.41.1 (region out of envelope);
  **F-5** randomize connIds.
- **Gradient affordances (NEW, GG-series — governance unbundled from control).**
  **GG-1** = E-1; **GG-2** cascade telemetry ("build the measurement" — highest
  leverage, grades every other gradient; dht-sim first); **GG-3** soft retraction +
  annotations (soft layer over shipped `kill`); **GG-4** forkable filter sets
  (app-layer plural moderation); **GG-5** agent legibility (opt-in signed class on
  the decoupled publish identity); **GG-6** friction scaled to reach (per-relay
  damping + reach-graded PoW; hardest). Series:
  [`architecture/Gates-to-Gradients-1…6`](../architecture/Gates-to-Gradients-1-Costly-Identity-v0.1.md).
- **Research / assurance.** Omission detection (behavioral vitality probes);
  anonymity tiers (TURN-only ICE, group-encryption, onion circuits); the dht-sim
  binding-model + cascade instrumentation.

## 4. Sequencing

1. **Ship-next (now, bridge-only, cheap):** G-3, G-5, G-7, G-8, G-10 + qualify the
   Synopsis claim (G-1 doc). No kernel change.
2. **Tier-2 kernel/bridge release:** A-2 (transcript binding), D-2 (WS hardening),
   SP-6 (mesh:signal caps), E-2 (key-at-rest).
3. **E-1 Stage-4** (memory-hard swap + difficulty dial) — the keystone; unblocks
   G-1 cost-the-read, G-4 bridge Sybil, GG-6 friction.
4. **GG-2 cascade telemetry** in dht-sim alongside, so subsequent gradients are
   graded with instruments, not faith.
5. **G-1 directory access-control** (BridgeDB-style partitioned / costly-gated read +
   public-bootstrap/private-federation split) and the **anonymity track** (G-2
   residue), each validated in dht-sim before deploy.

## 5. Strategic note

The model's strength is **integrity/authenticity** — verifiable, shipped, ahead of
the field. Its frontier is **availability, censorship-resistance, and anonymity** —
what cryptography secures least and we cannot instrument from inside. As the
network opened to a public federated fleet, the priority shifted to: make placement
and enumeration **expensive** (E-1, G-1), make silence **observable** (omission
detection + GG-2 telemetry), make abuse **unfair to the abuser** (quotas, GG-6
friction), make anonymity an **honest opt-in tier**, and **qualify the censorship
claims** where a capable adversary could falsify them — all without a central
chokepoint, which is the entire point.

The most useful thing the external bridge assessment did was confirm, from outside
and against the deployment, that our own deferred list is the right one — and name
the single finding (**G-1**) that most directly tests the project's core promise.

## 6. Disclosure posture

Public, consistent with the rest of `red team/`. No open item is a confidentiality
or key-compromise Critical; residuals are availability / censorship-resistance /
metadata-privacy on a live, public network. The public
[`../SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) advertises **shipped
guarantees only**; this status and the [punch list](red-team-punchlist-v2.43.0.md)
track **open** work.
