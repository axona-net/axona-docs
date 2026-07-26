# Soak — kernel 4.43.0 on testnet, 2026-07-26

*Five full cycles, 02:38–03:58 UTC. 32/40 scenario-runs green. No regression
attributable to anything 4.43.0 changed — but the failures we did see are **not**
explained by machine load, which is how we have explained this shape before.*

---

## 1. What was tested

| | |
|---|---|
| kernel | **4.43.0** (the version now on prod and testnet) |
| relay | 0.84.0, local **eagle** fleet of 3, `bash start-fleet.sh` |
| bridge | `wss://testnet.axona.net` (2.95.0) |
| harness | `axona-stress/soak-axon.mjs`, 12 subscribers × 6 publishes |
| scenarios | scale, backlog, churn, gap, discovery, kill, restart, alertbot |
| reps | **5 full cycles**, all 8 scenarios each = 40 scenario-runs |
| window | 02:38:01 → 03:58:23 UTC; cycles 876 / 888 / 1028 / 937 / 964 s |
| results | `axona-stress/results/soak-axon.jsonl` |

Two corrections to how this was run, because both changed the result:

- **`REPS` is not a knob this harness reads.** `main()` runs each scenario exactly
  once per invocation. Repetition has to be a shell loop around the process. The
  first launch of the evening was effectively a single rep.
- **`HARD_CAP_SEC` defaults to 600 s, which truncates a full cycle.** A complete
  8-scenario cycle takes 876–1028 s, so the default kills it partway through
  `kill`/`restart` — the two most churn-sensitive scenarios, silently under-sampled.
  Raised to 2400 s for this run. Every cycle here completed and emitted `cycle-done`.

The local relay fleet was **down** when this started, and was brought up first. A soak
against a bare bridge measures a different topology than we ship, and the mesh-size
lesson from the #axona.bot post-mortem is precisely that topology decides correctness.

## 2. Results

**32/40 scenario-runs ok (80%). Zero stray unhandled rejections across all five cycles.**

| scenario | ok | key numbers (mean / min over 5 reps) |
|---|---|---|
| **backlog** | **5/5** | late-join recovery 100 / 100 |
| **gap** | **5/5** | gap recovery 100 / 100 |
| **alertbot** | **5/5** | 98.2 / 94.1 (93 topics, 101 publishes) |
| restart | 4/5 | post-rejoin 98.3 / 91.7 · **full-timeline 100 / 100** |
| churn | 4/5 | post-churn 83.3 / 16.7 |
| scale | 3/5 | initial 98.3 / 91.7 · healed 91.4 / 65.3 |
| discovery | 3/5 | cold delivery 85.5 / 33.3 |
| kill | 3/5 | kill-delivery 77.2 / 36.1 · msg-delivery 90.3 / 62.5 |

**The two perfect scenarios are the two durability scenarios.** `backlog` and `gap`
both exercise `since:'all'` replay out of the relay cache, and both were 100% in every
rep. Whatever is wrong, the stored-history path is not it. Every failure is in a
**live-delivery / convergence** path.

`restart` deserves a note: its one failure is post-rejoin 91.7% (11/12), while
full-timeline recovery was **100% in all five reps**. A fresh `since:'all'` joiner
recovered everything across the restart every time. That is a transient boundary miss,
not lost data.

### Backbone health

The fleet never degraded. All three relays held matched `mesh(open/bound)` throughout,
and sat in `state=graduated` **with the mesh intact** — which is the #374 fix behaving
correctly (keep the mesh, drop only the bridge), not the old teardown bug.

Role mass over the soak, and for nine hours after it:

| | 02:36 | 03:30 (soak end) | 12:46 (+9 h) |
|---|---|---|---|
| relay-1 | 32 | 232 | **232** |
| relay-2 | 0 | 190 | **190** |
| relay-3 | 0 | 256 | **256** |

~678 roles accumulated across three relays, then **completely flat for nine hours** —
no decay (expected, `maxHoldMs` is 24 h) and, more to the point, **no collapse**. This
is the failure mode that killed 4.24.0 (#333: churn-amplified role bloat dissolving the
backbone on a ~3 h cadence). It did not happen. Peer count settled from 10–14 down to 5
and held there for nine hours without incident.

## 3. What we learned

**The load explanation does not hold this time, and that matters.**

The standing rule on this harness is that percentages are only trustworthy on an idle
machine (`loadPerCore < 1`), because the soak is usually laptop-bound. That rule
predicts failures concentrate at high load. The opposite happened:

- every one of the 8 failures sits in the **idle** band, `loadPerCore` 0.67–1.03;
- the five busiest reps — **2.89, 1.87, 1.78, 1.69, 1.56** — **all passed**;
- idle 23/29 ok (79%) vs busy 9/11 ok (82%).

So these are real signal, not contamination. Reaching for "the machine was busy" would
have been the comfortable read and it would have been wrong.

**The failures are one episode, not eight.**

| cycle | window | ok | failures |
|---|---|---|---|
| 1 | 02:38–02:52 | 7/8 | restart |
| 2 | 02:53–03:07 | **8/8** | — |
| 3 | 03:08–03:25 | **4/8** | scale, churn, discovery, kill |
| 4 | 03:26–03:41 | 6/8 | scale, kill |
| 5 | 03:42–03:58 | 7/8 | discovery |

Half the failures are in cycle 3, which was also the longest cycle (1028 s vs 876–964).
Four scenarios degrading together inside one 17-minute window, with the mesh visibly
healthy on both sides of it, reads as a single convergence episode rather than four
independent defects. The extreme minima all belong to it: churn 16.7%, kill 36.1%,
discovery 33.3%, scale healed 65.3%.

**I do not have a root cause, and I am not going to invent one.** Role-mass
accumulation was the obvious candidate — but if that were the driver, failures would
increase with cycle number, and instead cycle 3 is the peak and cycles 4–5 recover.
Load is refuted above. The mesh was intact. So: a real, reproducible-in-principle
convergence episode, mechanism unknown.

**What this soak does *not* implicate:** nothing that 4.43.0 actually changed. The
address rule, I-ID, and the bridge directory are untouched by these scenarios — no
`host()` call, no identity persistence, no directory topic anywhere in the failing
paths. The standing suspicion for live-delivery convergence loss remains **#397**
(root reconciliation reach is `rootReplicas` = 2, so any second root beyond N=3 is
permanent), which this soak neither confirms nor rules out.

**A caution on the analyzer.** `soak-axon-analyze.mjs` aggregates the *entire*
historical JSONL — 1114 scenario-runs spanning many kernel versions. Its headline
"80%" is not a 4.43.0 number, and it coincidentally matches tonight's 80%, which is
exactly the kind of coincidence that produces a false conclusion. Every figure in this
document is scoped to the five cycles by timestamp and `kernel == 4.43.0`.

**A caution on the relay logs.** `relay-logs/relay-N.log` is append-only across
sessions, so timestamps repeat daily and a naive `grep -m1 "^\[03:08"` returns a line
from a previous day. My first read of role counts was wrong for exactly this reason —
scope to the last `axona-relay v` header before trusting anything.

## 4. Actions

- **Nothing here gates 4.43.0.** It is already on prod, this soak surfaces no
  regression traceable to its changes, and the durability paths are perfect. No
  rollback indicated — and per the lesson of the #axona.bot post-mortem, a rollback
  would be the wrong instrument for a convergence-shaped problem anyway.
- **New task: investigate the cycle-3 convergence cluster.** Concretely: re-run 5+
  cycles capturing per-scenario root attribution (which node rooted each topic, and
  whether a second root existed), so the next occurrence is diagnosable rather than
  just visible. Being idle-band makes it reproducible in principle.
- **#397 stays open and stays the primary hypothesis** for live-delivery convergence
  loss. A dht-sim reach experiment at the soak's actual N would sharpen it.
- **alertbot residual:** 6 zero-delivery topics in the worst rep (94.1%), with
  `missOther: 6` — none attributed to self-root-empty or sole-holder. Worth a targeted
  look; not blocking.
- **Harness fix worth landing:** raise `HARD_CAP_SEC`'s default, or make the harness
  refuse to start when the cap cannot fit one cycle. The current default silently
  under-samples the two most interesting scenarios, which is how a soak reports a
  cleaner result than it earned.
- **Unverified by nature:** a stopped bridge ageing out of the directory listing. Both
  prod bridges' hourly heartbeats are now confirmed (east 01:30:53 → 02:30:53, west
  01:44:16 → 02:44:16, each into both eagle and grizzly), but age-out needs a bridge
  deliberately stopped and is a user-gated call on prod.
