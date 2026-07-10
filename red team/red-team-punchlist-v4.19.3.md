# Axona Punch List — consolidated & ranked (v4.19.3)

**Date:** 2026-07-09 · **Line:** `axona/5` / kernel **v4.19.3** (testnet);
**production holds at v4.19.2 / bridge 2.67.0** under a standing deploy freeze.
**Supersedes:** [`red-team-punchlist-v2.43.0.md`](red-team-punchlist-v2.43.0.md).
**Companion:** [`SECURITY-CHANGELOG.md`](../SECURITY-CHANGELOG.md) (shipped
guarantees, resolved-only).

**Standing constraints:**
- No remediation may depend on a centralized authority, CA, or reputation/
  identity service. Self-authenticating / end-to-end only.
- **No symptom patches that hide the mechanism.** A churn/stability fix must make
  the mechanism correct *under churn* — never route around churn by privileging
  stable nodes. (Reluctant-root was considered and rejected on these grounds.)

---

## What changed since v2.43.0 — the category shift

The v2.43.0 list was a security register (placement, enumeration, privacy). Since
then the network cut over to the **4.x pub/sub rewrite** and stood up a **public
federated bridge fleet + a 3-droplet relay backbone**. That deployment surfaced a
**second issue class that is now empirically our largest source of production
pain: correctness-and-recovery under churn, and blindness to silent failure.**
None of it is adversarial; all of it is real, and it bit production repeatedly
before being caught — usually by accident.

**Closed this cycle (testnet; prod partially):**
- **Root-election split-brain** (multi-root flap between same-region relays;
  orphaned subtrees beyond beacon reach) — kernel 4.19.0→4.19.2, prod-accepted.
- **Reconnect-death** (webTransport chain died on a 502 upgrade; wedged all 9
  prod relays) + the collector's unbounded-await sibling — kernel 4.19.3 /
  collector 0.48.1 (testnet).
- **Dead observability restored** — `inspectRoles`/`inspectHosting` (the `roles=`
  counter had silently read 0 since the v3.12 rebuild); bridge event-loop stall
  sampler + `/healthz` gauges (2.67.0, prod).

---

## Ranked summary (most critical first)

| # | ID | Sev | Item | Effort | Class |
|---|----|-----|------|--------|-------|
| 1 | **R-0** | 🔴 process | **No absence-alerting.** 4 silent failures this cycle (dead fleet, wedged collector, dead metrics plane, dead `roles=` counter). We find outages by accident. | S–M | reliability |
| 2 | **R-1** | 🔴 High | **Prod runs 4.19.2** — carries the reconnect-death bug; any prod bridge restart wedges the fleet (manual restart required). Cleared only by promoting 4.19.3. | S (gated) | reliability |
| 3 | **E-1 / GG-1** | 🔴 High strategic | Costly identity — memory-hard PoW dial-up (format shipped inert at difficulty 0). Gates manifesto release; anchors G-1/G-4. | L | security |
| 4 | **G-1** | 🔴 Crit (strategic) | Bridge-directory enumeration / fleet-wide mass-shutdown. | L (+ S doc) | security |
| 5 | **R-2** | 🟠 High | **Recovery-path audit** — the reconnect-death pattern (a recovery path that waits unboundedly on the thing it recovers, or dies on the failure it handles) is a *class*. Sweep every reconnect/renew/promote loop for the same shape. | M | reliability |
| 6 | **R-3** | 🟠 High | **Churn-storm from transient roots.** Every browser join/leave captures+releases ~10 standing topics by XOR luck → continuous re-homing under load. Mechanism-correct fix needed (NOT reluctant-root). | L | reliability |
| 7 | **A-2** | 🟠 High | Directed-transcript binding absent on web/mesh transport (≈all real users). | M | security |
| 8 | **D-2** | 🟠 High | Bridge WS: no Origin allow-list / `maxPayload` / pending-conn cap. | S | security |
| 9 | **G-3** | 🟠 High | Installer supply-chain: `curl\|bash` from `main`, no pin/checksum/sig. | S–M | security |
| 10 | **G-4** | 🟠 High | Bridge Sybil → bootstrap dominance (rides E-1). | L | security |
| 11 | **G-2 / F-4** | 🟠 High | Malicious-but-functional bridge — passive metadata surveillance. | L | security |
| 12 | **R-4** | 🟡 Med | **Load-test harness ceiling.** 18 peers + WebRTC + crypto in one Node process self-stalls → false admission failures. Split across processes/machines for a clean loaded soak. | M | assurance |
| 13 | **GG-2** | 🟡 High-leverage | Cascade telemetry — "build the measurement" (grades all gradients). | M | governance |
| 14 | **SP-6** | 🟡 Med | `mesh:signal` inbound lacks per-source rate + size cap. | S–M | security |
| 15 | **G-5 / G-8 / G-7** | 🟡–🟢 | TURN username embeds node-id; `/healthz` seed tell; raw port 8080 world-reachable. | S each | security |
| 16 | **E-2 / G-6** | 🟡 Med | Identity keypair plaintext at rest (bridge + relay file). | M | security |
| 17 | **F-1 / F-2 / F-5** | 🟡–🟢 | Coord precision at rest; no CSP + `window.axona` exposure; enumerable connIds. | S–M | privacy |
| 18 | **Omission (adversarial)** | research | Black-hole root drops a topic silently — *accidental* vectors closed + detectable (4.9.1); **adversarial** route-around still open. | L | security |
| 19 | **GG-3…6** | leverage | Gradient affordances (soft retraction, forkable filters, agent legibility, reach-graded friction). | M–L | governance |
| 20 | **SP-7/8/9, F-3, D-3, E-3** | 🟢 Low | Bounded-map sweeps, dedup-TTL nit, bridge-link peer nonce, cross-topic linkage nits. | S each | hygiene |

> **Ship-next (cheap, clearly-correct, no gate):** **R-0** absence canary
> (cron on bridge `/healthz` + relay unit + collector liveness → alert) — one
> item retires the entire "found it by accident" failure mode. Then the bridge-only
> security batch (**G-5, G-7, G-8, G-3**).

---

## Tier 0 — Reliability & observability (the current #1 class)

This tier did not exist in prior registers. It is where production actually hurt.

### R-0 · No absence-alerting 🔴 (process)
Four failures this cycle were silent until stumbled upon: the laptop testnet
backbone died (weeks unnoticed), the PoW collector wedged, the 4.x metrics plane
was dead, and the relay `roles=` counter read 0 while rooting hundreds of topics.
Each cost a diagnosis cycle or lost data. **The meta-issue: we have no watchdog
that pages when something goes quiet.** A counter that silently reads zero is
worse than no counter. **Plan (S–M):** a cron canary checking bridge `/healthz`
(both prod + testnet), relay systemd units, collector file-mtime, and the loop-
stall gauge; alert on absence. Highest leverage on the list — it converts every
future silent failure into a notification.

### R-1 · Prod carries the reconnect-death bug 🔴 (gated)
Prod relays run kernel 4.19.2. A 502 window during any prod bridge restart wedges
the whole fleet in `state=connecting` (process alive, so `Restart=always` does not
catch it) → manual fleet restart required. Fixed in 4.19.3 (testnet). **Plan:**
promote 4.19.3 when the freeze lifts; until then the bridge-restart runbook step
stands.

### R-2 · Recovery-path audit 🟠
The reconnect-death bug had three faces (kernel error-listener, collector unbounded
await, and — historically — the silent laptop backbone) that are all one shape: *a
recovery path that dies on, or blocks forever on, the failure it exists to handle.*
**Plan (M):** sweep every reconnect / renewal / promotion / anti-entropy loop in
kernel + relay + collector for (a) unlistened error events, (b) unbounded awaits on
the recovering resource, (c) state that no watchdog re-checks. Add a timeout+teardown
discipline as a reviewed invariant.

### R-3 · Transient-root churn storm 🟠
With ~280 standing topics and ~25 nodes, every transient browser that joins becomes
XOR-closest to ~10 topics, captures them, and releases them on leave — a continuous
re-homing storm that starves scenario convergence under load. The 4.19.2
alone-in-the-dark guard removed *self-minted* transient roots; the *capture-by-luck*
churn remains. **Constraint:** the fix must hold for a 100%-transient network — no
host-preference / reluctant-root (that hides the mechanism). **Plan (L, research):**
model in dht-sim first; candidates include hand-off damping and capture hysteresis.

### R-4 · Load-test harness ceiling 🟡 (assurance)
The soak harness crams 18 peers + WebRTC + crypto into one Node event loop; under
full churn it self-stalls and its clients drop simultaneously, producing false
"bridge admission" failures that cost a diagnosis cycle to attribute. **Plan (M):**
split soak clients across processes (or machines) so a clean fully-loaded run is
possible; until then, treat residual loaded-soak admission errors as harness noise.

---

## Tier 1–3 — Security (carried from v2.43.0, still open)

Unchanged in substance; see [`red-team-punchlist-v2.43.0.md`](red-team-punchlist-v2.43.0.md)
and [`SECURITY-STATUS-v2.43.0.md`](SECURITY-STATUS-v2.43.0.md) for full analysis.
Nothing open touches confidentiality or key compromise; the frontier remains
availability, placement/enumeration, privacy, and governance.

- **E-1 / GG-1** (Tier 1) — memory-hard PoW Stage-4: swap the SHA scaffold, run the
  phone-WASM benchmark, dial transport/publish difficulty as a coordinated cutover.
  *Note: the bench app + calibration corpus are ready (cuckoo d20–22); this is the
  manifesto-release gate.*
- **G-1** (Tier 1) — partitioned/costly-gated directory read + public-bootstrap vs
  private-federation split + pluggable-transport obfuscation.
- **A-2, D-2, G-3, G-4, G-2/F-4** (Tier 2) — transcript binding, bridge WS
  hardening, installer supply-chain, bridge Sybil, passive surveillance.
- **SP-6, G-5, G-7, G-8, E-2/G-6, F-1/F-2/F-5** (Tier 3) — signal caps, TURN id,
  port exposure, healthz tell, key-at-rest, privacy nits.
- **Omission (adversarial), Anonymity tiers, GG-2…6** — research / governance.

---

## Sequencing (TL;DR)

1. **Now, cheap, un-gated:** **R-0** absence canary (retires the silent-failure
   class) + the bridge-only security batch (**G-5, G-7, G-8, G-3**).
2. **On freeze-lift:** promote **4.19.3** to prod (**R-1**), then run the **R-2**
   recovery-path audit as a reviewed sweep.
3. **Manifesto-gating:** **E-1 Stage-4** memory-hard PoW activation (bench ready).
4. **Research track:** **R-3** transient-root churn (dht-sim first), **GG-2**
   cascade telemetry, adversarial omission.

---

## Disclosure posture

`axona-docs` is public; this register enumerates open availability/privacy/abuse
items with vectors — a deliberate open-research trade (see v2.6.0 §5). No open item
is a confidentiality or key-compromise issue. The `SECURITY-CHANGELOG.md` stays
resolved-only; this list is where open work lives.
