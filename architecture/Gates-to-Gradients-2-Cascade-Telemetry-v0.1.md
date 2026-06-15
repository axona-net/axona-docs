# From Gates to Gradients — 2. Build the measurement (privacy-preserving cascade telemetry) (v0.1)

**Status:** design note · **Flagged:** 2026-06-15 · **Relates to:** the companion
essay *From Gates to Gradients* (a critique-from-within of the Axona Synopsis);
sibling notes [1 — Costly identity](Gates-to-Gradients-1-Costly-Identity-v0.1.md),
[3 — Soft retraction annotations](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.1.md),
[4 — Forkable filter sets](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.1.md),
[5 — Agent legibility](Gates-to-Gradients-5-Agent-Legibility-v0.1.md),
[6 — Friction scaled to reach](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.1.md);
the [dht-sim](https://github.com/axona-net/dht-sim) protocol simulator; the
existing `peer.metrics(topic)` / `peer.health()` surfaces and the `host(topic)`
durable-root primitive.

---

## TL;DR

The Synopsis already names its own deepest gap: *"we can harden the security
model … and each such change nudges the network's behavior. But we cannot
measure that behavior. We can measure latency. The social consequence travels on
the same wire and is invisible to us."* The essay's reply is the sharpest line in
the series — **"you cannot steer what you refuse to measure."** Every gradient the
other five notes propose (costlier identity, rising friction, forkable filters) is
a **guess** until we can observe whether it actually changed how things propagate.
This note specs the instrument: **aggregate, privacy-preserving telemetry on
cascade *dynamics*** — how fast topics spread, the fan-out shape of a propagation,
the ratio of agents to humans in it, and how often a retraction loses its race
against the bytes. It is explicitly **not** content surveillance. It is the
**highest-leverage, lowest-technical-risk** move on the list, and the easiest to
under-prioritize precisely because it ships no glamorous feature — it ships a
ruler.

## 1. The idea

Build the measurement before, or alongside, the gradients it is meant to grade.

The other five notes each propose a *gradient*: a cost or friction that scales
with reach instead of a binary verdict someone owns. But a gradient is a control
knob, and a control knob without a gauge is operated blind. The Synopsis is candid
that today Axona instruments **latency** — the engineering quantity — while the
**social** consequence of a design change ("did this slow the spread of a
panic?", "did costly identity actually thin out sybil cascades?") rides the same
wire and is unobserved.

The move is to make *cascade dynamics* a first-class, measured quantity, under
three hard constraints that distinguish it from the thing Axona exists to refuse:

1. **Aggregate-only.** We measure the *shape and speed* of propagation, never the
   content and never the identity of individual participants. Spread velocity,
   fan-out distribution, agent-to-human ratio, retraction-vs-bytes timing — these
   are population statistics, not message logs.
2. **Privacy-preserving by construction.** Any individual message or participant
   must be non-reconstructable from what is reported. This is an engineering
   property (aggregation, sampling, differential privacy / k-anonymity), not a
   policy promise.
3. **Decentralized.** No central collector. The measurement must be assembled the
   same way everything else in Axona is — out of first-party local stats,
   published to a topic, served by infra nodes that `host()` it.

What we want to *see*, concretely:

- **Spread speed** — time from first publish to N distinct subscribers/relays
  touching a topic.
- **Fan-out distribution** — the branching shape of a cascade (is it a broad
  shallow tree or a deep viral chain?).
- **Agent:human ratio** — *if* note 5's agent-class signal lands, what fraction of
  a propagation is machine-originated vs. human-originated.
- **Retraction race** — when a `kill` / soft-retraction is issued, how far the
  original bytes had already travelled, and whether the retraction caught them
  (see note 3 and the `kill` "best-effort redaction, not a cryptographic unsend"
  honesty note in the [pub/sub lifecycle design](../implementation/Pubsub-Lifecycle-Design-v0.2.md)).

## 2. How it helps

It converts the entire series from advocacy into engineering.

- **It grades the other five gradients.** Note 1 (costly identity) claims to thin
  sybil-driven cascades; note 6 (friction scaled to reach) claims to slow runaway
  spread. Both are testable hypotheses *only if* cascade dynamics are measurable.
  Without this note, the others are graded blind — shipped on faith, kept or
  killed on anecdote.
- **It closes the Synopsis's stated gap honestly.** The Synopsis lists "keep
  studying the process" as a *virtue*. The essay's demand is to promote that
  virtue to a *deliverable with instruments* — otherwise it is a posture, not a
  practice.
- **It is the cheapest high-value work on the list.** It adds no new trust object,
  no flag-day wire change, no new authority. It reuses simulation infrastructure
  and local metrics surfaces that already exist. The leverage/risk ratio is the
  best in the series, which is exactly why it is easy to defer in favour of
  shinier features.
- **It keeps "governance unbundled from control" measurable.** The project's whole
  bet is that you can shape a network's behaviour without a controller in the
  middle. That bet is unfalsifiable — and therefore worthless as engineering —
  unless behaviour can be observed without a controller in the middle. This note
  is what makes the bet checkable on its own terms.

## 3. How Axona provides it (mechanism + roadmap status)

There are two homes, and the staging between them is the point.

### 3.1 First home — dht-sim (pre-deploy, available now)

[dht-sim](https://github.com/axona-net/dht-sim) is the in-browser simulator
already used to model protocol behaviour at 1K–50K nodes *before* deploy; protocol
changes are gated through it. It is the natural and lowest-risk first home for
cascade instrumentation because the simulator owns the full ground truth — there
is no privacy tension at all when every node is synthetic.

Add cascade-dynamics instrumentation to dht-sim:

- spread-speed timing (first-publish → N-touch);
- fan-out / branching-factor distribution per cascade;
- agent:human ratio, *gated on note 5's agent-class signal existing*;
- retraction-vs-bytes race timing (issue a `kill` mid-cascade, measure how much of
  the tree it reaches before the bytes settle).

This lets us grade the proposed gradients **in simulation first** — e.g. inject
note 1's costly-identity model and observe whether sybil-amplified cascades
actually flatten — before any of them touch a live network. It mirrors the
existing discipline of gating protocol changes through the simulator, and it is
the same place the [Axona-vs-Vivaldi](Axona-vs-Vivaldi-v0.1.md) line of work would
validate locality behaviour.

### 3.2 Second home — production aggregate telemetry

In production, the local half already exists: `peer.metrics(topic)` and
`peer.health()` expose **local** stats today. The missing piece is **network-wide**
telemetry assembled *without a central collector*. The decentralized pattern,
consistent with the rest of Axona:

- nodes compute **sampled, aggregated** propagation statistics locally (counts,
  timings, distributions — never per-message records);
- they **publish** those aggregates to a dedicated **telemetry topic**;
- **infra nodes `host()` that topic** — storing and serving it as a durable root
  *without consuming it* (exactly the host-not-subscribe role described in the
  bridge-directory and host-primitive work). `host()` is essential so the
  telemetry stream is durable even though the infra nodes are not the audience;
- aggregation is **aggregation-only** plus **differential privacy / k-anonymity**,
  so individual messages and participants are never reconstructable from the
  published statistics. A report below the k-anonymity threshold is suppressed or
  noised, not emitted.

This respects every protocol invariant: signed envelopes still disclose **who**
(the reporting node's `signerPubkey`) and never **where** or **what**; the
telemetry topic is just another public topic (`publisher:null`) whose payloads are
aggregate counters. No new authority, no central store.

### 3.3 Roadmap status

Named as a **virtue** in the Synopsis ("keep studying the process") but **not yet a
deliverable**. The essay's demand — and this note's recommendation — is to make it
a deliverable *with instruments*: dht-sim instrumentation first (no privacy
tension, immediate value for grading the other notes), production aggregate
telemetry second (where the privacy work in §3.2 and §4 must be done carefully).
Lowest technical risk, highest leverage on the list. The honest framing of why it
is not done: it is the least glamorous item, so it loses prioritization battles to
features that demo well.

## 4. Honest limits

- **Any telemetry is a disclosure.** Even aggregate statistics leak *something*;
  the only safe version is aggregate-only, **opt-in**, and privacy-preserving *by
  construction*. Get this wrong — too-fine buckets, too-small populations, no
  noise floor — and the "ruler" becomes the panopticon the project exists to
  refuse. The privacy/observability tension is real and is not waved away by good
  intentions; it has to be an engineering property of the aggregation.
- **Self-reported aggregates can be poisoned.** A determined adversary can sybil
  the telemetry itself — flood the telemetry topic with fabricated aggregates to
  bias the measured picture of the network. This is the dual of every other sybil
  problem in the system. The **partial** mitigation is [note 1 — costly
  identity](Gates-to-Gradients-1-Costly-Identity-v0.1.md): if reporting carries a
  cost, mass-fabricated telemetry gets expensive. It is *partial*, not complete —
  costly identity raises the price of poisoning, it does not prove a report
  truthful. Cross-checking aggregates against simulation expectations and against
  each other helps, but there is no central auditor by design.
- **Simulation is not the network.** dht-sim grades a *model*. A gradient that
  flattens cascades in simulation may behave differently under real churn,
  adversarial behaviour, and human attention. The simulator is necessary for
  pre-deploy grading but is not a substitute for measuring the live network — it
  is the rehearsal, not the performance.
- **Opt-in undercounts.** If telemetry is opt-in (and it should be), the measured
  population is biased toward nodes willing to report. The statistics describe the
  *reporting* network, not necessarily the whole network — a caveat that must
  travel with every number.

## 5. Open questions

- **What is the right privacy mechanism and parameterization?** Differential
  privacy budget vs. k-anonymity threshold vs. both; what minimum population size
  suppresses a report; how to set the noise floor so cascade *shape* survives but
  individual contribution does not. (Uncertain — needs design work.)
- **Sampling rate and aggregation granularity.** Fine enough to see cascade
  dynamics, coarse enough to be safe. Where is that line, and is it the same for
  all topics or topic-class dependent?
- **Who runs the telemetry hosts, and does that re-introduce a soft centre?** If
  only a few infra nodes `host()` the telemetry topic, they become a de-facto
  observatory. How many independent hosts are needed before the measurement is
  credibly decentralized rather than a collector in disguise?
- **How is poisoning detected without a central auditor?** Beyond note 1's cost
  floor — are there cross-validation or robust-aggregation techniques (e.g.
  trimmed/median aggregates) that bound the influence of fabricated reports?
- **Does the agent:human ratio depend entirely on note 5?** If the agent-class
  signal in [note 5](Gates-to-Gradients-5-Agent-Legibility-v0.1.md) never lands,
  is there any privacy-safe proxy for machine-vs-human origin, or does that metric
  simply not exist until then?
- **What is the minimum useful first deliverable?** Likely the dht-sim
  retraction-race and spread-speed instruments, since those grade notes 3 and 6
  with no production privacy tension. To be confirmed.

---

*This is a design sketch, not a committed roadmap item.*
