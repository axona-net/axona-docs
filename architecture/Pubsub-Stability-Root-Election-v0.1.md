# Stability-Weighted Root Election — design model (v0.1)

**Status: NO-GO (do not build), 2026-06-25.** Replicated measurement (5 reps,
relay-poor, 30% Lindy churn) shows a *perfectly* durable root barely moves average
delivery — **baseline 48±8% vs protect 52±7%, within the error bars** — even though
it does stabilise the root (root-changes 3.8→1.4) and lift the worst-case floor
(4→17%). The mechanism prototype (`stablehost`) was *worse* (44±1%, 6.0 root-changes).
**Conclusion: root-thrash is NOT the dominant delivery loss — subscriber churn-in
is** (see §9). Stability-weighted root election is an eclipse-sensitive change to a
load-bearing invariant for ~4 points of delivery inside the noise: **not worth it.**
This doc is retained as the analysis + the design (still correct *if* root-thrash
ever becomes the bottleneck, e.g. at lower churn) — but the work pivots to §9.
**Motivation:** make the routing-only pub/sub root survive a high-churn,
relay-poor (mobile-majority) network — the regime where most users can't host
relays and stable infrastructure is a small minority.

## 1. Problem

Routing-only pub/sub (kernel ≥3.14) elects a **single emergent root per topic =
the live node XOR-closest to the topicId**. Clean total order; but the root is
whatever node happens to be closest, and in a relay-poor mesh that's a random,
churning peer. Measured in `dht-sim/harness/relay-churn-experiment.mjs` (real
kernel over SimNetwork):

- Relay-poor, **zero churn → 100%** delivery, one stable root (a web peer). The
  design is fine when the closest node persists.
- Relay-poor, **30%/round churn → ~49–56%** mean, root thrashes across many nodes.
- **Adding 3 relays did not help** (≈54% vs 49%): 3 keyspace-hosting relays are
  XOR-closest to only a sliver of the topic space, so for an arbitrary topic the
  closest node is still a random web peer. Relays anchor a topic only when they
  are the closest node — which at mobile scale is rare. "Add relays" is not the fix.

The lever that worked in the data: when the root was a node that **did not churn**
(a stable node), delivery held high. So the fix is to choose the root by
**durability**, not pure proximity.

## 2. The stability signal

`stability(n)` = an estimate of node `n`'s **expected residual uptime**, derived
from **observed** session persistence — never self-claimed.

- Base estimator (Lindy): for heavy-tailed session-length distributions,
  `E[residual | age] ≈ age`. So `stability(n) ≈ continuous observed age` — how
  long `n` has been continuously connected/observed — decayed/reset on disconnect.
- Observed, not asserted: a node's age is what its **neighbors have witnessed**
  ("I have seen peer X connected for T"), cross-checkable; not a field X sets about
  itself. (Eclipse safety — §5.)
- Optional enrichment later: mean session length across reconnects for a durable
  identity. Base case needs none.

This is a sibling of **vitality** (is `n` alive *now*? → route-around the dead),
not a replacement: stability is "will `n` stay?" → anchor-on the durable. They
share the same observation/probe machinery. A relay is just the limiting case of a
maximally-stable node; this metric generalises "relay" into a continuous property
any node earns by persisting.

## 3. The model: sticky, stability-biased election

Two levers, both relative to the topic's **K-closest band** (the candidates a
lookup already returns — closeness stays the gate so the keyspace still localises
a topic):

- **L1 — Election preference.** When a root must (re)form, pick
  `root = argmax stability` over the in-band candidates, **not** strict
  `argmin XOR`. The most durable node *near* the topic roots it.
- **L2 — Incumbency stickiness (hysteresis).** A live, in-band incumbent root is
  **not** displaced by a merely-closer node. Displacement requires a challenger to
  beat the incumbent on the combined score by a margin. This directly kills the
  thrash: today root-ness flips to whoever is momentarily XOR-closest (and that
  node churns); stickiness holds the durable incumbent.

Combined score (illustrative): `score(n) = w_c·closenessRank(n) + w_s·stability(n)`,
with closeness as a *band gate* (must be in K-closest) and stability as the
*selector within the band*. Tunable; the prototype used pure
"oldest-in-K-closest-band."

## 4. Consistency — the hard constraint

Election MUST be globally consistent: every subscriber + publisher must converge
on the **same** root, or you get split-brain (worse than baseline). Pure XOR is
consistent because distance is objective; **stability is locally observed and
differs per observer**, so naive "most-stable near me" diverges.

Resolution — reuse the existing **root beacon** (Pubsub-Root-Beacon-v0.1) as the
single source of truth:

1. The incumbent root advertises its **stability** in its beacon (new optional
   field; wire-compatible).
2. A node only *challenges* if it is in-band AND more-stable-by-margin; challenge
   = a normal subscribe that, on reaching the in-band set, triggers a deterministic
   compare. The winner announces via beacon; everyone routes to the beaconed root.
3. (Re)formation after root death: the in-band neighbours exchange observed ages
   (bounded K-node gossip), deterministically pick the highest (tie-break XOR), and
   the winner beacons. Bounded and piggybacks on machinery that exists.

So consistency = small in-band agreement + beacon broadcast, not a global vote.

## 5. Security — eclipse (gating concern)

The root is a powerful position (sees all subscribers, assigns order, can censor by
dropping). If stability is forgeable, an attacker claims max stability → captures
roots → eclipse/censorship. Non-negotiables:

- **Observed, not claimed.** Age is attested by neighbours' observations, not
  self-report; the in-band gossip carries "how long *I* observed *you*."
- **Cost to fake = actually stay online, near the topic, and be observed** — raises
  the Sybil bar; composes with PoW-address + eclipse-admission work (see the
  red-team punch list E-1 / `smoke_eclipse_admission`). Stability-weighting must be
  designed *with* the eclipse remediation, not bolted on.
- **Bounded blast radius:** publishes are signature-verified (B-4) so a captured
  root can't forge; pair with a **replica set** (§6) so no single root is a
  censorship chokepoint.
- **Cold-start fairness:** new honest nodes look unstable; a closeness floor + band
  membership still give them a fair share. They earn stability by persisting.

## 6. Replica set (durability complement, later phase)

Even a stable root can churn. Pair election with a small **replica set**: the top-R
in-band by closeness×stability hold the topic + cache; primary stamps; on primary
loss a **warm deterministic successor** takes over with ~zero re-convergence. This
is the real cure for single-point fragility (un-regresses toward the pre-rewrite
K-closest replication); stability picks good replicas.

## 7. Phasing

- **Phase 0 — sim prototype (INADEQUATE; lever re-test in progress).**
  `relay-churn-experiment.mjs MODE=stable` injected a global-oracle hint pointing
  every peer at the most-stable in-band node. Result: **46%** vs baseline 56% /
  closest 59% (relay-poor, 30% Lindy churn) — *worse*. **Why it's an artifact, not
  a refutation:** the routing-only kernel binds `root ≡ XOR-closest terminus`
  (`AxonaManager._topicDecision`: a node receiving `via[0]=self` only `handle`s if
  it ALREADY holds the role, else `reroute` → the SUB falls through to the
  XOR-closest node). So a hint toward a non-closest stable node cannot relocate the
  root; it just adds a popped hop. **There is no oracle shortcut** — testing
  stability-election faithfully requires the real mechanism (a node accepting an
  *advertised* root over the closest, §3–4).
  - **Lever check (`MODE=protect`) — NOT YET CONCLUSIVE.** Exempt the
    *naturally-elected* root from churn (real routing) to isolate the value of a
    durable root. Two single-seed runs disagreed sharply: run A baseline 50 → protect
    **77**; run B baseline 59 → protect **53**. Delivery% has very high run-to-run
    variance (subscriber churn-in). The one signal that's consistent across runs is
    **root-changes**: protect reliably 0–1, baseline 3–5 — i.e. protect genuinely
    stabilises the root, but whether that *translates to a delivery gain* needs a
    replicated mean±sd (REPS≥5) to see past the noise. **In progress.**
  - **Mechanism check (`MODE=stablehost`) — NEGATIVE so far.** Make the stable node
    `host(topic)` (so it holds a role → a hint to it `handle`s as root, per the
    diagnosis) AND hint everyone to it. Result: it *thrashed* (7 root-changes) —
    re-electing/re-hosting a new node each round (the "oldest sub" moves as subs
    churn) churns the role worse than leaving it alone. Lesson: the election must be
    **sticky** (don't re-home for a marginally-older node) and the chosen node must
    be genuinely durable — naive per-round re-election is counterproductive.
- **Phase 1 — kernel, observed stability + sticky election.** Per-neighbour
  observed-age tracking; incumbent advertises stability in the beacon; challenger
  displaces only if in-band AND more-stable-by-margin (L1+L2). Re-measure in
  dht-sim with REAL observed stability (not oracle). Additive beacon field →
  wire-compatible, no flag day.
- **Phase 2 — consistent (re)election + eclipse hardening.** In-band age gossip,
  neighbour-attested age, deterministic winner.
- **Phase 3 — replica set + warm failover.**

## 9. Pivot — the real lever is subscriber churn-in (where the work goes)

The replicated data says the dominant loss in a high-churn relay-poor mesh is **not**
the root churning — it's that a **freshly (re)subscribed peer misses messages
published before its subscription converges/attaches** (and the mesh around a just-
joined node is still forming). A stable root can't fix that. Lower-risk, higher-
payoff directions, in order:

1. **Replay-on-join (reliable).** On every (re)subscribe, the subscriber should
   immediately pull the root's recent retained history (the `since:'all'` / stamped-
   replay path already exists — make it *fire reliably and fast* on attach, not only
   via the live tail). This directly recovers the churn-in misses. Lowest risk —
   reuses existing durability machinery, no election/invariant change.
2. **Faster, event-driven re-attach.** Cut convergence latency for a fresh node
   (renew/heal is `renewMs=60s` ≫ mobile churn); attach + replay should complete in
   seconds, not a renewal cycle.
3. **Replica set (durability, bigger lift).** k-closest replicas + warm successor —
   helps the worst-case floor and root-death recovery (the part protect *did* help),
   but secondary to replay-on-join for average delivery.

Recommended next experiment: instrument the harness to **classify each missed
message** as root-related (no reachable root at publish) vs join-related (subscriber
younger than its convergence time), to quantify the split and size the replay-on-join
win before building it.

## 8. Open questions

- Exact score weights / margin (hysteresis) — sweep in the harness.
- Age decay model on brief disconnect vs hard reset (mobile backgrounding).
- Interaction with the renewal cadence (`renewMs=60s` ≫ mobile churn — Phase 1
  should also make failover event-driven, not tick-bound).
- How stability composes with region/keyspace placement for owned topics.
