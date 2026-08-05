# Synaptome Maintenance — near-quota + per-stratum refill (v0.1 draft)

**Status (2026-06-29): ENABLED on testnet.** The opt-in flag is now ON in
axona-relay **v0.32.0** (backbone + soak peers), axona-peer **app 0.72.0** (browser),
and axona-bridge **v2.48.0** (embedded peer) — `{ kNear:5, intervalMs:15000, maxPerTick:3 }`.
Confirmed live (`synaptome-refill` log on the backbone). **Decision:** E-1 (costly identity)
is reclassified as **pre-production hardening, NOT a development gate** — the network is under
active development with no live adversary, so the eclipse surface (capture bounded by attacker
keyspace share; see below) is an accepted dev-time risk. E-1 must be live before any prod
promotion. Prod stays on 3.x regardless.

**Implementation:** near-quota half landed behind an opt-in flag in kernel **v4.9.0**
(`new AxonaPeer({ synaptomeMaintain: true | { kNear, intervalMs, maxPerTick } })`;
default off → inert, behavior identical). `AxonaPeer._maintainSynaptome()` +
`MAINTAIN` tick + debounced `onPeerDied` trigger; refill routes through
`_considerCandidate` (B-3 first-party verify, eclipse-safe). Gated by
`test/smoke_synaptome_maintain.mjs` (7/7) + full kernel suite (1319 ✓).
**NOT enabled/deployed** — pending the adversarial eclipse test + a live-enable
decision. Long-range/stratum half still relies on existing anneal (see §1/§8).
Motivated by the convergence
investigation (2026-06-29): live cross-peer pub/sub delivery is *probabilistically
convergent* (~50–85%) because greedy routing strands in **local minima** of the
keyspace-distance landscape over an *incomplete* neighbor graph. Two sim results
on the shipped kernel frame this doc:

- **Structure beats announcement.** On a gappy mesh, widening root-beacon fan-out
  did **not** improve delivery and triggered correction storms (see the
  beacon-radius NO-GO). Re-allocating the *same connection budget* to "K XOR-nearest
  + ~log(N) long-range" links lifted baseline greedy delivery 46% → 100% with **no
  beacons, no lookup-assist, no hub.**
- **Repair is local.** With a complete near-stratum, when a node's nearest peer
  dies the true next-nearest is already a direct neighbor (1-hop hit 100%); topping
  back up needs only a 2-hop neighbor-of-neighbor query (~11–27 candidates, ~0
  misses) — never a global lookup. Without repair, sustained churn erodes the near
  stratum and delivery drifts down; local refill restores it.

**Thesis:** convergence is a **routing-table-completeness** problem. The fix is a
self-healing synaptome that continuously maintains two invariants through churn,
using cheap local repair. This is classic Chord (successors + fingers) / Kademlia
(closest bucket + distant buckets), adapted to the NeuronNode synaptome.

---

## 1. The invariant

For every live peer, maintain (within the `_maxSynaptome` budget, ~20):

1. **NEAR quota** — hold synapses to the **K_NEAR ≈ 5** XOR-closest *known* live
   peers (the "successor clique" that fixes last-mile convergence).
2. **STRATUM coverage** — hold **≥1** live synapse in every *populated* distance
   stratum (the long-range "fingers" that let a walk reach any neighborhood).
   This is the existing **Structural Survival Rule**, promoted from a prune-time
   guard to an actively-maintained target.

Steady state, both invariants are already satisfied → maintenance is a cheap no-op.
The work only happens when churn breaks an invariant.

Parameters (validated in `test/churn_sustained.mjs` — sustained multi-round churn):

| param | default | meaning |
|-------|---------|---------|
| `K_NEAR` | 5 | near-stratum quota (4–6 was the sim sweet spot; >6 added nothing) |
| `LONG_TARGET` | ~log₂(N) (≈6) | long-range "finger" links — **co-equal with K_NEAR**; near-only refill HELD occupancy at 100% but delivery still collapsed (→38%) when long-range was starved |
| `STRATUM_MIN` | 1 | live synapses required per populated stratum (how LONG_TARGET is realized) |
| `MAINTAIN_MS` | 15000 | maintenance-tick cadence (≈ pub/sub renew floor) |
| `REFILL_CONCURRENCY` | 4 | max parallel `openConnection` per maintenance pass |
| `REFILL_MAX_PER_TICK` | 3 | cap new connections per tick (avoid churn-storm dialing) |

**Regression evidence (churn_sustained.mjs):** over 6 rounds at 20–35% churn/round,
no-repair near-occupancy drifts 100%→~90% and delivery sags (to ~37–48% in the harsh
regime); near+long refill HOLDS occupancy at 100% and roughly doubles delivery under
heavy churn — at a cost of ~40 candidates examined per refill, **100% found within 2
hops, ~0 global-lookup fallbacks.** This locks: cheapest-first 2-hop refill is
sufficient, and BOTH invariants are required.

## 2. Candidate sources, cheapest-first

Refill must find the XOR-nearest *not-yet-connected, verified, live* peer for a gap.
Try sources in cost order; stop at the first that yields a candidate:

1. **2-hop neighborhood (local, free).** `local_probe` already returns each
   neighbor's neighbor list for anneal/dead-replace. The sim shows the near-quota
   replacement is almost always here. No network round-trip beyond what anneal
   already does.
2. **Candidate pool (local, free).** The B-3 gossip/observed-path candidate pool
   (`triadic_introduce`, `hop_cache`, `lateral_spread`) — already-known peers
   awaiting first-party verification.
3. **Scoped `findKClosest(selfId, K_NEAR)` (network, fallback only).** The safety
   net for the rare case local knowledge is insufficient (e.g. heavy simultaneous
   churn). This is what `_selfIntegrate` does today at join — we reuse it, scoped to
   the near quota, not the full K=20.

Long-range (stratum) gaps use the same sources but target the stratum's key range
rather than self-proximity.

## 3. Security constraints (do NOT regress eclipse defenses)

The near-quota is an **eclipse-sensitive** surface: an attacker who grinds IDs near
a victim could try to fill its successor clique. Maintenance MUST preserve existing
defenses:

- **First-party verification (B-3).** A refill candidate is *not* written to the
  table on gossip alone — it goes through the same first-party probe/verify path as
  any annealed peer (`_verifyIntroducedCandidate`). Identity is pubkey-derived and
  PoW-gated (E-1), so "near" IDs are not cheap to manufacture at scale.
- **Introducer diversity.** Do not let a single introducer supply the whole near
  clique. Cap the fraction of the near-stratum sourced from any one introducer
  (reuses the B-3 candidate-pool provenance tags).
- **Self-proximity gate (B-2) unchanged.** Promotion to a topic root still requires
  genuine self-proximity; maintenance only changes *connectivity*, never root
  eligibility.
- **Budget-bounded.** Never exceed `_maxSynaptome`; refill competes for slots via
  the existing value-based eviction (`DHTNode._chooseVictim`), with the near quota
  and per-stratum survival rule as protected floors.

**Eclipse-test result (`test/smoke_synaptome_eclipse.mjs`, 5/5).** Verified the loop
adds **no eclipse leverage beyond raw keyspace proximity**: (1) a phantom/unbindable
"near" id is never admitted (first-party verify on the refill path); (2) maintenance
fills the *genuinely* nearest-K and never displaces a nearer honest peer for a farther
attacker — capture is bounded by the attacker's true share of the victim's nearest
keyspace; (3) one pass dials ≤ maxPerTick under a sybil flood. **The load-bearing
caveat:** in the no-PoW regime the harness modeled (attacker freely grinds the nearest
ids) capture reached **4/5** — i.e. whoever *owns* the near keyspace owns the near
clique. Making that ownership costly is **E-1 (pubkey-derived id + memory-hard PoW)**,
currently at difficulty 0 on testnet. **Therefore: do NOT enable near-quota maintenance
until E-1 PoW is live at a real difficulty.** Mitigating factor: long-range "fingers"
are maintained by the (honest, traffic-driven) anneal, so even a captured near clique
only exposes routing toward the victim's *own* id-neighborhood — far-topic routing
still flows over honest fingers. Eclipse is partial, not total. (The introducer-
diversity cap from earlier drafts applies only to a future 2-hop *gossip* candidate
source; the v1 `findKClosest` source has no introducer to diversify.)

## 4. Algorithm (concrete sketch — AxonaPeer)

```js
// Cadence: a maintenance tick (MAINTAIN_MS) + an immediate pass on peer loss.
// Idempotent and quota-gated: a no-op when both invariants already hold.
async _maintainSynaptome() {
  const node = this._node;
  if (!node?.alive || typeof node.transport?.openConnection !== 'function') return;
  if (this._maintainInflight) return;            // single-flight
  this._maintainInflight = true;
  try {
    let opened = 0;
    const want = this._nearDeficit();             // {missing:[idBig...], count}
    const stratumGaps = this._stratumGaps();      // strata below STRATUM_MIN

    // Build the dial list cheapest-source-first, dedup, cap per tick.
    const targets = [];
    for (const gap of [...want.targets, ...stratumGaps.targets]) {
      if (targets.length >= REFILL_MAX_PER_TICK) break;
      const cand = await this._refillCandidate(gap);   // 2-hop → pool → findKClosest
      if (cand && !this._isConnected(cand) && !targets.includes(cand)) targets.push(cand);
    }

    for (let i = 0; i < targets.length; i += REFILL_CONCURRENCY) {
      const batch = targets.slice(i, i + REFILL_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(id => this._verifyThenOpen(id)));   // B-3 verify → openConnection
      for (const r of settled) if (r.status === 'fulfilled' && r.value) opened++;
    }
    if (opened) this._axonaManager?.invalidateKClosestCache?.();
  } finally { this._maintainInflight = false; }
}

// The K_NEAR XOR-closest peers we KNOW about (synaptome ∪ candidate pool),
// minus those already connected → the near-quota deficit.
_nearDeficit() {
  const self = this._node.id;
  const known = this._knownPeerIds();                    // connected + candidate pool
  const nearest = [...known].sort((a, b) => this._xcmp(a ^ self, b ^ self))
                            .slice(0, K_NEAR);
  const missing = nearest.filter(id => !this._isConnected(id));
  return { targets: missing, count: missing.length };
}

// Cheapest-first candidate for a gap key: 2-hop neighborhood, then candidate
// pool, then a SCOPED findKClosest (network fallback only).
async _refillCandidate(gapKey) {
  return this._nearestIn(this._twoHopNeighbors(), gapKey)
      ?? this._nearestIn(this._candidatePool(), gapKey)
      ?? await this._findKClosestNearest(gapKey);       // bounded; safety net
}
```

`_twoHopNeighbors()` reads the cached `local_probe` responses anneal already
collects; `_candidatePool()` is the B-3 pool; `_verifyThenOpen()` is the existing
first-party verify + `transport.openConnection`. So the new surface is small:
the two quota/gap computations, the cheapest-first candidate selector, and the
tick wiring — everything else reuses shipped machinery.

## 5. Wiring

- **Tick:** add a `MAINTAIN_MS` timer in `start()` (mirror the pub/sub
  `refreshTick` cadence), calling `_maintainSynaptome()`. Unref the timer.
- **On loss:** in the existing `onPeerLeave` / dead-peer eviction path, schedule an
  immediate (debounced) `_maintainSynaptome()` so a near-neighbor death is repaired
  within seconds, not at the next slow tick.
- **At join:** `_selfIntegrate()` stays as the bootstrap fill; `_maintainSynaptome`
  takes over for steady-state upkeep. (Optionally re-express `_selfIntegrate` as the
  first maintenance pass with the budget opened to K=20.)

## 6. Test plan (gate before any deploy)

1. **Unit (sim fabric):** extend `test/churn_refill.mjs` into a committed regression —
   sustained multi-round churn, assert delivery stays ≥ target with maintenance ON and
   degrades with it OFF; assert refill candidates come from 2-hop ≥95% of the time
   (no global lookup in steady churn).
2. **Eclipse adversarial:** a cohort of ID-grinding sybils near a victim must NOT be
   able to capture > a bounded fraction of its near-stratum (first-party verify +
   introducer-diversity cap hold).
3. **Budget:** synaptome size never exceeds `_maxSynaptome`; per-stratum survival
   never violated; no dial-storm under heavy churn (REFILL_MAX_PER_TICK respected).
4. **Real-WebRTC harness (T2):** multi-peer mesh, kill near-neighbors, confirm
   re-home within a tick and delivery recovery.
5. **Soak:** add a `synaptome` scenario to `soak-axon` measuring near-quota
   occupancy + per-stratum coverage over churn; watch delivery vs the current line.

## 7. Rollout

Kernel-only, additive, **no wire change** (refill reuses existing `openConnection` +
`local_probe` + verify wire). Bump kernel minor; re-vendor peer/relay; deploy testnet;
soak before any prod consideration. Prod stays gated on 3.x regardless.

## 8. Open questions

- **K_NEAR vs network size:** is a fixed 5 right, or should it scale (e.g. with
  observed local density)? Sim says 4–6 plateaus at N=60; revisit at larger N.
- **Long-range target count:** the sim needed ~log(N) long links for 100%. Confirm
  the stratum-coverage invariant yields ~log(N) fingers at scale, or add an explicit
  finger-count target.
- **Cadence vs churn rate:** `MAINTAIN_MS` should be ≤ the mean inter-loss interval
  of a node's near-stratum; tune from soak.
- **Interaction with reluctant-root:** a complete table makes hubs unnecessary for
  *correctness*, but a hub is still a cheap universal finger; keep as a complementary
  bootstrap aid, not a dependency.
