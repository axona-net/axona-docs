# Stability-Weighted Root Election — design model (v0.1)

**Status: root election is NO-GO; the real fix is SUBSCRIPTION CONTINUITY (§9),
validated 2026-06-25.** Stability-weighted root election does not help (a perfectly
durable root moves delivery only 48→52%, within noise; the mechanism prototype was
worse). The actual loss is **subscription orphaning** — 93% of missed messages go to
subscribers no longer seated at the current root after it changed. Re-seating
subscribers each round lifts delivery **41% → 91%** at the same churn. So: do NOT
build stability-weighted root election (eclipse-sensitive invariant change for ~0
gain); DO build fast/​event-driven subscription re-homing + root-side subscriber
handoff (§9 — low-risk, no eclipse surface). This doc is retained as the full
analysis trail; the design in §3–6 stays valid only if root-thrash ever becomes the
bottleneck (it isn't here).
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

Resolution — reuse the existing **root beacon** (history/architecture/Pubsub-Root-Beacon-v0.1.md) as the
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

## 9. ROOT CAUSE + VALIDATED FIX — subscription continuity across root change

Direct instrumentation (relay-poor, 30% Lindy churn, real kernel; routing-table
maintenance on, to remove a frozen-table confound that fixing did NOT help):

- **93% of missed messages are ORPHANED** — the subscriber is not in the current
  root's subscriber set at publish time. Only 7% are seated-but-undelivered (true
  routing). Missers are the *tenured* subscribers (28s vs 8s received).
- **Mechanism:** on a root change (or a renewal lapse) existing subscribers remain
  seated at the OLD root; the NEW root doesn't know them until they re-home. Fresh
  (re)subscribers always seat at the current root, so they receive — hence tenured
  peers miss, fresh peers don't (the opposite of "churn-in").
- **FIX VALIDATED:** re-seat every live subscriber at the current root each round
  (`REHOME`) → **delivery 41% → 91%±7**, misses 726→107, with root-thrash *unchanged
  or higher*. The gain is entirely subscription continuity, not root stabilization.

So neither earlier hypothesis (root election / churn-in) was right; the lever is
**keeping subscribers seated across a root change.** Kernel directions — all
LOW-RISK (no eclipse surface, no routing-invariant change):

1. **Event-driven re-home (primary).** A subscriber re-subscribes to the current
   root the instant it learns the root changed — the v4.1 root beacon already names
   the current root, so a subscriber whose `_upstream` differs from a fresh beacon
   re-issues subscribe-k immediately, instead of waiting for the `renewMs=60s` tick
   (≫ mobile churn → a 60s orphaning window today).
2. **Root-side subscriber handoff on promotion.** When a root hands off / a new root
   forms, transfer the subscriber set to the successor (mirrors stamped-replay-up,
   which already transfers history) so subscribers are never dropped.
3. **Shorter renewMs** — crude but immediate; trades traffic for a smaller orphan window.

Earlier framing (kept for context): the replicated data first looked like subscriber
*churn-in* (fresh peers missing); the seated/orphan probe disproved that too — fresh
peers receive, tenured peers orphan. Other lower-priority durability ideas: lower-
priority directions below.

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
