# Heterogeneous-Protocol Simulation — Research Plan (v0.1)

**Status:** research plan / next-steps effort · **Flagged:** 2026-06-01 ·
**Targets:** `dht-sim` · **Relates to:** the black-hole node threat
(`../red team/black-hole-nodes-v0.1.md`), of which this is the testbed.

---

## 1. The idea

`dht-sim` today runs a **monoculture**: one protocol engine for the whole run
(K-DHT, G-DHT, NX-17, NH-1, or Axona), every node identical. That's the right
shape for the benchmark comparisons in the paper — *protocol A vs protocol B,
each in isolation*.

But the real network won't be a monoculture. At any moment it may carry **a
mix of protocol versions** (a v2.8 cohort that hasn't refreshed alongside a
v2.10 cohort), and — longer term — **genuinely different protocols** whose
*interfaces are equivalent but whose operation is not*. They all speak the
same contract (route / publish / subscribe over a shared 264-bit keyspace),
yet behave differently on the wire.

The proposal: make **protocol a per-node property**, so a single simulation
session runs a *population mix* and we can study what emerges. The
**black-hole node is simply the most extreme instance** of "equivalent
interface, divergent operation" — a participant whose operation is *drop
everything*. The same harness that lets us study a 60/40 version split lets us
study a population salted with adversaries.

Two distinct payoffs:

- **Defensive / correctness.** Does a mixed-version network degrade
  gracefully? Do two protocols interoperate on a shared keyspace without
  pathology? Can the honest majority detect and route around a misbehaving
  cohort (the black-hole question)?
- **Offensive / performance.** *Heterogeneity might help.* A handful of
  high-degree, long-memory nodes (G-DHT-style) salted into an Axona mesh could
  shorten worst-case paths; a few always-on relays could stabilise a churny
  browser population. Monoculture benchmarking can't see this — you only find
  emergent gains by running the mix.

## 2. What `dht-sim` has vs. what this needs

**Has:** the protocol engines (K-DHT / G-DHT / NX-17 / NH-1 / Axona via
`TransportAxonaEngine`), a shared event/step loop, churn injection, and the
metric harness (hop counts, delivery, convergence).

**Needs:**

1. **Per-node engine assignment.** A run is parameterised by a *population
   spec* — a weighted mix, e.g. `{ "axona@2.10": 0.6, "axona@2.8": 0.2,
   "g-dht": 0.1, "black-hole": 0.1 }` — and the node factory instantiates the
   right engine per node from that spec (seeded, reproducible).
2. **A shared substrate all engines speak.** One address space (264-bit), one
   message bus, one transport contract. Engines differ *above* the bus, not in
   how they're wired to it. (Axona's `Transport`/engine seam already gives us
   this boundary.)
3. **Cohort-attributed metrics.** Outcomes (delivery rate, hop count,
   detection latency) bucketed *per protocol cohort*, so we can say "the v2.8
   cohort's delivery fell to X% when the v2.10 cohort flipped a wire field,"
   or "black-hole nodes were routed around within N rounds with F false
   positives among honest-flaky nodes."
4. **Adversarial engines.** `black-hole` (drop), `selective-black-hole`
   (drop targeted / forward probes), `equivocator` (relay conflicting valid
   content), and `honest-flaky` (random drop — the control that sets the
   false-positive floor).

## 3. Research questions

1. **Graceful degradation under version skew.** As the v2.10 fraction rises
   from 0→100% mixed with v2.8, where does delivery / convergence break, and
   is the failure soft (degraded) or hard (cliff)? This directly informs how
   aggressive future flag-days need to be.
2. **Cross-protocol interop.** Can K-DHT and Axona nodes share a keyspace
   without routing pathology, or do their distance metrics / table-maintenance
   rules fight? Where's the boundary between "coexist" and "must not mix"?
3. **Emergent performance (the offensive question).** Is there a mix that
   beats every monoculture on some axis — worst-case hops, churn resilience,
   load distribution? Sweep mixes and look for non-monotone wins.
4. **Adversarial resilience + detection (ties to the black-hole note).**
   At what adversary fraction does delivery collapse? How fast does local
   forwarding-vitality route around black holes, and — the gating metric —
   what's the false-positive rate against `honest-flaky` at the same
   thresholds?

## 4. Phased plan

1. **Per-node protocol assignment + mixed-population runner.** Population
   spec → seeded node factory → cohort-tagged nodes. Re-run an existing
   benchmark as a 100%-single-cohort spec to prove parity with today's
   monoculture results (the regression anchor).
2. **Version-skew cohort.** Two Axona kernel versions in one run (start with a
   benign wire-compatible delta, then a flag-day-style incompatible one).
   Measure degradation curves; validate the "additive vs flag-day" reasoning
   we've been applying by hand.
3. **Adversarial cohort + detection metrics.** Add `black-hole` /
   `selective` / `equivocator` / `honest-flaky`; prototype local
   forwarding-vitality + route-around in the sim (not the kernel); produce the
   detection-latency vs false-positive curves the black-hole note needs.
4. **Emergent-performance sweeps.** Grid over mixes; hunt for heterogeneity
   wins; feed anything real back into the protocol design.

## 5. Why this is the right testbed

Everything risky about black-hole detection — especially the
false-positive-against-honest-flaky question that decides whether it's safe to
ship — must be answered *in simulation* before any kernel surface exists. A
heterogeneous-population sim is the general tool; the black-hole study is its
first serious customer, and version-skew / interop / emergent-performance are
the dividend. It also subsumes the previously-flagged "dht-sim binding-model"
need (inject connection-establishment delay + verification to exercise B-3's
verified-admission at scale): once protocol is per-node, "v with binding" and
"v without binding" are just two cohorts.

## 6. Open questions for the design

1. **Shared-substrate fidelity.** How much of the real transport (WebRTC mesh
   establishment delay, NAT, bridge relay) do we model, vs. an idealised bus?
   The black-hole false-positive number is only as trustworthy as the
   churn/latency model underneath it.
2. **Interop scope.** Do we require all cohorts to share the exact wire
   envelope (version skew), or also model protocols with *different* wire
   formats bridged by an adapter (true multi-protocol)? The former is
   tractable now; the latter is a bigger lift.
3. **Reproducibility.** Population assignment, churn, and adversary targeting
   all need seeded determinism so a surprising emergent result can be replayed
   and bisected.
