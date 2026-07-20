# Team Update — Axona kernel **v4.9.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** the **4.x line runs on testnet** — `testnet.axona.net`,
`demo-testnet.axona.net`, the testnet relay fleet. **Production is untouched and
still on 3.x.** Wire-compatible point release (WIRE 4.0, no flag day).

> Supersedes the **v4.8.8** update (verified + durable kills). This one is about
> **why pub/sub convergence is flaky and what actually fixes it** — a sustained
> investigation that ruled out the intuitive fix and landed on the real one:
> **routing-table completeness.** The fix shipped in v4.9.0; it was enabled on
> testnet, **then reverted the same day** — see the update directly below.

---

## ⚠️ Update (2026-06-29, later) — maintenance enabled, then reverted

We turned on the new near-quota synaptome maintenance on the testnet backbone and
bridge to start measuring the convergence fix live. Running Howard's regression
suite afterward showed it made pub/sub convergence **worse, not better**: the
clean-pass rate fell from ~100% (warm) to ~33%, because the always-on relays
aggressively dialing their nearest peers churned the small testnet mesh (per-node
connection counts jumped ~30→46) and wedged subscriber convergence. We reverted the
enablement across relay/peer/bridge, restarted the fleet maintenance-off, and
confirmed Howard's suite recovered (6/6 clean). The kernel capability stays in
v4.9.0 but is now **default-off**, and remains disabled until we root-cause why
near-quota dialing helps in simulation yet hurts on the live WebRTC mesh. Two
takeaways: run Howard's suite **before** enabling a feature, not after — and treat
simulation wins as hypotheses until confirmed live. (The two user-facing apps —
Axona Minimal and the browser peer — never ran maintenance-on; only the backbone
and bridge were exposed.)

---

## TL;DR

1. **The reliability problem is convergence, not connectivity.** The mesh forms
   fine; what's flaky is publisher and subscribers *finding the same root*. It's
   all-or-nothing per topic (≈100% or 0%), worst under churn.
2. **It's a routing-table-completeness problem.** A peer that holds its **~5
   XOR-nearest "successor" peers + ~log(N) long-range "fingers"** routes to the
   true root every time. The live gap is that the near-stratum was under-filled.
3. **The "louder root beacon" idea was a NO-GO** — sim-disproved. Widening beacon
   fan-out didn't help and caused correction storms. (Honest negative result; the
   beacon stays as a minor last-mile aid, not the convergence mechanism.)
4. **The fix: synaptome near-quota maintenance (v4.9.0).** Each peer continuously
   refills its 5 nearest successors via a cheap **local** repair; long-range
   fingers stay with the existing anneal. **Enabled on testnet, then reverted
   the same day — see the update at the top.**
5. **No API change, no wire change.** Apps need nothing.
6. **Eclipse note:** near-quota maintenance is eclipse-safe *by construction*
   (first-party verify, no amplification, budget-bounded), but its ultimate
   resistance rests on **E-1 costly identity (PoW)** — a **pre-production**
   requirement, not a dev-time gate.

---

## 1. The reliability story (plain version)

Every topic has one **root** — the live node whose id is XOR-closest to the topic
id. To use a topic, a publisher and all subscribers must independently *route to
that same root*. Routing is a **greedy walk**: each hop forwards to the neighbour
closest to the target, stopping at a local minimum.

On a real, *incomplete* mesh (each peer knows ~20 of N), that walk can dead-end at
a **near-miss** node — a local minimum that isn't the true closest. When the
publisher and subscribers dead-end at **different** near-miss nodes, they home on
different roots and never meet → **0% delivery**. When they meet → 100%. Hence the
all-or-nothing behaviour, and why **churn** (which keeps moving the root) is worst.

So it was never a connectivity bug — it's a *rendezvous* bug.

## 2. What we ruled out: louder beacons (NO-GO)

The intuitive fix was to make a root **announce itself louder** (wider beacon
fan-out) so stranded walks get redirected. We built a sweep harness over the
shipped kernel and measured. Result, consistent across mesh densities:

- **No delivery lift at any radius**; beyond a small fan-out, delivery *dropped*
  and 30–55% of trials hit a correction **storm**.
- **Why:** a beacon announces a root that the stranded walk *still can't reach*;
  louder just plants more pointers to an unreachable node. The correction bounces.

We kept the beacon as a minor last-mile aid and moved on. (Negative results are
results — this saved us building the wrong thing bigger.)

## 3. What actually fixes it: routing-table completeness

Re-allocating the *same* connection budget to **K XOR-nearest + ~log(N) long-range
links** lifted baseline greedy delivery from ~46% to **100%** in sim — no beacons,
no lookup-assist, no hub. The two parts are **co-equal**:

- **~5 nearest "successors"** complete the *last mile* (the clique around the
  topic), so the final descent always lands on the true root. 5–6 is the sweet
  spot; more adds nothing.
- **~log(N) long-range "fingers"** let a walk *reach* the topic neighbourhood at
  all. These are already maintained by the existing **anneal**.

And critically, **repair is cheap**: when a near-neighbour churns out, the
replacement is almost always a neighbour-of-neighbour (Chord's "successor's
successor"), found in a 1–2 hop *local* query — never a global lookup. In
sustained-churn sims, no-repair delivery drifts down while local refill holds it,
at a cost of a handful of local candidates.

## 4. The change — synaptome near-quota maintenance (v4.9.0)

`AxonaPeer` now (opt-in) keeps its near-stratum full:

- **Invariant:** hold the **K_NEAR = 5** XOR-nearest verified peers.
- **Mechanism:** a deterministic maintenance tick + an immediate pass when a peer
  is lost (`onPeerDied`). Below quota → refill from the nearest verified peer,
  routed through the **same first-party verification** as any other synapse.
- **Long-range** stays with the existing anneal (that's what it was designed for).
- **Bounded:** ≤ maxPerTick dials per pass, within the synaptome budget.

**Enabled on testnet** in axona-relay **v0.32.0** (backbone + harness peers),
axona-peer **app 0.72.0**, axona-bridge **v2.48.0**
(`{ kNear:5, intervalMs:15000, maxPerTick:3 }`). Confirmed active live
(`synaptome-refill` log on the backbone). **As an app author: nothing to do** —
it's internal mesh upkeep, off by default in the kernel, on in the testnet builds.

## 5. Eclipse safety & the E-1 decision

Near-quota maintenance *dials the victim's nearest peers*, so it's an
eclipse-sensitive surface. An adversarial test (`smoke_synaptome_eclipse`, 5/5)
confirms the loop adds **no leverage beyond raw keyspace proximity**:
unbindable/forged "near" ids are never admitted (first-party verify); it never
displaces a nearer honest peer for a farther attacker; dialing is budget-bounded.

The remaining lever — making it *costly to acquire ids near a victim* — is **E-1
(pubkey-derived id + memory-hard PoW)**. **Decision:** while the network is in
active development with no live adversary, E-1 is treated as **pre-production
hardening, not a development gate** — we don't hold back capability for it. E-1
must be live before any production promotion. (Long-range fingers come from the
honest anneal, so even a captured near-clique only affects routing toward a
victim's *own* id-neighbourhood — eclipse would be partial, not total.)

## 6. Honest status

- **Sim-validated**, **kernel-suite green** (1324 ✓ incl. the two new smokes),
  enabled live. **Not yet proven live** — a soak is now running maintenance-ON to
  measure whether churn/scale delivery actually climbs vs the maintenance-off
  baseline (≈88% scale / ≈25–36% churn). Early cycles look promising on churn but
  are too few to call. We'll report the head-to-head once enough accumulate.
- **Open / next:** confirm the live lift; E-1 costly-identity (now the explicit
  pre-prod gate); the mobile-lifecycle + root-singleton-durability notes from the
  reliability review remain queued.

## 7. Versions in this release

| Component         | Version  | Note |
|-------------------|----------|------|
| `@axona/protocol` | **4.9.0**| kernel (tagged); near-quota maintenance behind an opt-in flag |
| axona-peer        | 4.9.0 (app 0.72.0) | maintenance enabled |
| axona-relay       | 0.32.0   | maintenance enabled (backbone + harness peers) |
| axona-bridge      | 2.48.0   | re-pin @v4.9.0; maintenance enabled on embedded peer |

All wire-compatible within wire-4 — no flag day. Live healthz:
`{ version: 2.48.0, kernelVersion: 4.9.0 }` on `testnet.axona.net`. Design:
`architecture/Synaptome-Maintenance-v0.1.md`.

---

*Kernel `@axona/protocol` v4.9.0 · testnet only · production remains on 3.x.*
