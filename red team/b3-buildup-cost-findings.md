# B-3 buildup-cost measurement — verified-only admission vs. gossip-immediate

**Date:** 2026-05-31
**Question:** B-3 (eclipse prevention) makes a node admit a routing-table entry
(synapse) only after **first-party verification** — it has itself connected to,
`axona/4`-authenticated, and RTT-measured the peer — instead of inserting peers
named in unauthenticated gossip (`triadic_introduce` / `hop_cache` /
`lateral_spread`). How much does that slow network buildup, and what does a new
node experience?

**Method:** a seeded, reproducible discrete-event model
([`axona-protocol/experiments/eclipse_buildup_model.mjs`](https://github.com/axona-net/axona-protocol/blob/main/experiments/eclipse_buildup_model.mjs)).
Real-WebRTC at the scale needed to see gossip-driven table growth isn't tractable
in one process, and the dht-sim treats connections as instant (the "sim hides
connection cost" gap), so this models the one cost that actually differs —
**connection establishment** — calibrated to measured reality:

- WebRTC bring-up (ICE/STUN/DTLS): ~1.5–3 s (mean 2 s)
- `axona/4` handshake crypto: ~0.13 ms → negligible, folded into connect time
- P2P connect-failure (NAT traversal w/o TURN): swept parameter (2% / 15% / 30%)

Both policies run against an **identical** seeded network (500 nodes) and
discovery stream, so it's a true head-to-head. Routing realism is kept
minimal-but-fair: once the new node hands a lookup to the converged network both
policies finish identically, so the only measured differentiator is the new
node's first hop. Absolute latencies are model artifacts (a fixed ~350 ms
network-completion floor); the **relative shapes** are the result.

## Result (baseline: 500 nodes, T_conn≈2 s, 15% connect-fail)

| | **A — gossip-immediate (today)** | **B — verified-only (B-3)** |
|---|---|---|
| Join → first usable | immediate but **slow** (~800 ms, connecting inline) | **~2 s unavailable**, then 400 ms |
| 10–15 s window | **latency spike 1500–1730 ms, 5–8 % lookup failures** | flat 400 ms, **0 % failures** |
| 30–60 s | settles ~460 ms, **persistent ~3 % ghost-failure tail** | flat 400 ms, 0 % |
| Connections opened / 60 s | **~500** | **~108** |
| Table at 60 s | 435 "known" (mostly cold/ghost) | 88 *connected* (real) + pool |

Sensitivity: at **30 %** connect-failure (hostile NAT, no TURN) A's transient
failure rate hits **10 %** while B stays **0 %**; at **2 %** (TURN-backed) A's
tail nearly vanishes but its ~500-connection storm remains. Doubling B's probe
budget (4→8) **did not change** the ~2 s cold-start (it's bound by the bootstrap
connection landing, not by probing) — it only raised growth rate and connection
count (108→207).

## Conclusions

1. **B-3's only real cost is a brief join-time unavailability (~2 s)** — the time
   for the first connection batch to land. After that it is strictly better.
2. **Steady state favors B-3:** flat latency and **zero** ghost failures, vs. A's
   warming-storm latency spike and a persistent failure tail. The gap widens as
   the network gets more hostile (no TURN / bad NAT) — i.e. B-3 helps most when
   you need it most.
3. **B-3 imposes ~5× less connection load per joiner** (108 vs ~500); A's "instant
   big table" is an illusion paid for by a network-wide connection storm.
4. **Cold-start is bootstrap-bound, not probe-bound.** The fix is **staggered
   bootstrap readiness** — admit each bootstrap/bound peer the instant *its own*
   connection binds, rather than waiting for the batch — which shrinks the 2 s
   gap without weakening the security property. (The probe budget is a separate
   knob for growth-rate vs. connection-cost.)

**Decision:** proceed with B-3, paired with staggered bootstrap readiness.

## Limits of the model (stated for honesty)

Single joiner into a converged network; no churn, no simultaneous joins. A's
connection-storm assumes lookups warm cold hops; a real A that routed *blindly*
on fabricated metadata would show even more failures instead — so A pays either
way. B's ~2 s cold-start is the **pessimistic** (whole-batch) bound; staggered
readiness narrows it. This model informs the *direction*; convergence, hop-count,
and churn-recovery under the real routing kernel must still be validated in the
dht-sim before B-3 ships (tracked separately).
