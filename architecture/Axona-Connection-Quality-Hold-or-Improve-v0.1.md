# Connection quality under hold-or-improve (v0.1)

**Status:** council-agreed definition draft · **Date:** 2026-08-22 ·
**Kernel on testnet:** 4.64.0 · **Policy set by:** David ·
**Definitions debated:** Orion `61502230`, Vega `5d81e203`, Aster `b535e168` ·
**Synthesis:** axona.bot `25fe09c4` · **Concurrence, all findings, own signers:**
Aster `1bc728b3`, Orion `df536c99`, Vega `8b99b40b`.

This document defines terms. It changes no code, re-enables no mechanism, and
moves no gate. Deploy is David's.

---

## The question

When may a node give up a connection?

The kernel has answered this badly twice. With maintenance off, a dropped
connection has no replacement path, and degree bleeds to a degraded plateau —
in the sim, 37 down to 25 at N=38 over twelve cycles at two drops per node per
cycle, then flat. With maintenance on, the refill re-dialed candidates that
never bind, every tick, forever — the connection-count storm that got the
mechanism reverted at `6522f2f`. Off decays; on storms. The answer isn't a
better refill rate. The answer is a policy.

## The policy

A node never gives up a connection unless it holds a strictly better
replacement. David set this as the invariant, and it has two regimes:

- **Below the synaptome cap** there's always room, so there's never a reason to
  drop anyone. A node admits every distinct live peer it learns of. At small N
  the whole mesh converges to all-to-all and stays there. This is why the
  38-relay fleet holds flat at 34–35 under a cap of 50 — measured over 1.5 days
  of per-second logs, with the only zeros coming from host thrash and a version
  latch, not from decay.
- **At the cap** the table is full and stays full. The only permitted change is
  a swap: the weakest evictable edge leaves only when a strictly better
  candidate — better by a margin — is ready to take the slot. Occupancy pins at
  the cap. Quality can only go up.

Dead edges are exempt. A peer that fails liveness is gone whether we hold the
slot or not; the edge leaves through the liveness path and the slot refills
under the rules below. The invariant governs what a node chooses to drop, not
what the network takes from it.

The policy is only as strong as the word "better." The rest of this document
defines it.

## What quality is not

Quality is **not** a single scalar. All three council seats independently
rejected a blended score, because a scalar lets round-trip time cancel
structural need — a fast edge to a crowded band could outbid the only edge into
an empty one. The definition is a lexical order: structure decides first,
performance breaks ties.

Quality is **not** the benefit to the node holding the edge. It's the edge's
contribution to the mesh. A slow edge that is the only reach into a far region
of the keyspace outranks a fast edge that duplicates coverage the node already
has.

Quality is **not** measurable from a god's-eye view. Every term below is
computable by one node from its own table, its own probes, and its own traffic.

## The definition

An edge's standing is decided in this order. Earlier clauses dominate later
ones outright.

### 1. Liveness

A dead channel has no quality. It leaves immediately, outside the invariant.

### 2. Condition-based protection, re-verified at every decision

Two structural conditions protect an edge from eviction:

- the peer is inside the node's k-nearest successor quota (last-hop delivery),
  or
- the peer is one of the last **r** representatives of a sparse XOR stratum,
  with r at least 2 — protecting only the last one would let a single churn
  event black out a band until re-discovery, and re-discovery of a sparse band
  is the expensive path.

Protection here is a condition, not a grant. It is re-checked at the moment of
each eviction decision and self-expires the instant the condition stops
holding. There is no lease and no clock. A countdown lease on structural
protection would be worse than none: let the lease on a lone long-range edge
lapse and the policy itself re-creates the slice-world cut — the partition
where one Hawaii node was the only bridge between hemispheres, and pure-XOR
tables scored 0% cross-side delivery.

Nothing is grandfathered. An edge protected yesterday and unprotected today is
an ordinary edge today.

### 3. Admission at cap: id-derivable terms only

A candidate for admission has no history — no LTP weight, no RTT average, no
flap record. Any definition that scores candidates on history is uncomputable
at the only moment it's consulted. All three seats' first drafts had this flaw.

So admission at cap is decided entirely by what the candidate's id implies:

- which XOR stratum the candidate fills, and how occupied that stratum already
  is (density),
- whether the candidate improves the successor quota,
- whether the candidate reduces a standing coverage deficit.

The swap rule: the victim is the lowest-ranked evictable edge in the most
over-represented stratum; the candidate is admitted only if it improves the
structural position — fills a sparser stratum than the victim occupies, or
ties the structure and clears the within-stratum margin on measured
performance.

By the way, this restriction buys the strongest anti-thrash property in the
design for free: ids don't change, so structural comparisons are deterministic.
Two nodes cannot oscillate over a structure-driven swap. Thrash lives entirely
in performance-driven swaps, which is where the margin and residence rules
apply.

### 4. Ranking incumbents: performance within a stratum

Among edges in the same stratum, measured history ranks them: vitality (LTP
weight and recency), stability (flap count), tail round-trip time. These terms
select the victim within a stratum and break structural ties. They never decide
admission.

The improvement margin (proposed at 25%, unfixed pending the matrix) applies
within a stratum only. Across strata the density comparison moves in
integer-squared cliffs, and a percentage margin means nothing against a cliff.

### 5. Transit as evidence, never immunity

An edge that forwards traffic into regions few other edges reach is carrying
mesh value, and the definition credits it — as a normalized, aged, capped
input to within-stratum rank. Raw transit count is not bridge proof: routing
prefers weighted edges, weighted edges gain more transit, and an unnormalized
counter rewards the hotspot it created. Transit evidence decays; it never
promotes an edge into protection.

## The liveness clauses

Per-edge scoring is not enough. Three seats reviewed per-edge definitions
carefully and all three walked past the same two system-level holes, because
the holes are invisible from inside one node. These clauses are mandatory parts
of the definition.

### Join lane

At cap, admission requires improving the acceptor's table — on both ends of
the new edge. A newcomer has no history and lands, from most peers' viewpoint,
in their most crowded band. In a mature mesh with every table full, the
newcomer loses every contest except where it happens to fill a gap. A policy
built to preserve connectivity would ossify the mesh against joins.

So joining runs through a lane the improve-gate doesn't guard: a small
reserved quota of probation slots outside the cap, where a newcomer is
admitted first and evaluated after a grace period. The lane is bounded,
rate-limited, and protected against adversarial churn — it is a door for
newcomers, not a bypass around the gate. Sizing (proposed: two slots, 30
seconds) is unfixed pending the matrix.

### Degree floor and emergency refill

Hold-or-improve bounds what a node drops. It says nothing about what a node
loses. Every inbound edge is some other node's evictable, and a node can obey
the policy perfectly while many peers independently evict it. The mesh-level
property that matters — no live node's total degree falls below a floor — is
not implied by the per-node policy and is stated here separately.

No single node can verify a mesh-level invariant from its own view, so
enforcement is local and evidence is global: each node watches a locally
observable proxy (its own total degree, in plus out), and when the proxy falls
below the floor, emergency refill overrides the improve-gate — below the
floor, any live distinct peer is admissible, exactly as below cap. The global
claim is then earned the only way it can be: topology tests under correlated
inbound eviction.

### Deficit backoff

Improvement pressure searches for candidates in empty strata. Most strata are
empty because nobody occupies them — at any N, only about log₂ N of the 264
bands are populated — and a node cannot locally distinguish "unpopulated" from
"not yet discovered." Without a brake, the improvement loop searches for
phantom candidates forever. That is the reverted storm again, one layer up:
lookups instead of dials.

Two brakes ship together, or the storm returns:

- the **candidate attempt guard** — per-candidate in-flight dedup, bounded
  retry with backoff, expiry on bind or on exhaustion — for the known peer
  that won't bind, and
- **deficit-level backoff** — a stratum whose searches repeatedly return
  nothing gets exponentially rarer searches, reset when a routing record for
  that prefix arrives — for the deficit no search can fill.

### Bounded churn

Steady state is a target, not a promise. Measurements in a live mesh are not
stationary, so the design guarantees bounded churn — margin, minimum
residence, grace after admission, and a per-node swap-rate cap — and does not
claim swaps reach zero.

## Asymmetry

Quality is directional. Node A may rate the edge to B highly while B rates the
reverse edge low; B may drop it while A holds it. The definition accepts this.

What the definition rejects is inbound-only retention — keeping the transport
channel alive after evicting the edge from the routing table. On the web
transport the scarce resource is the connection itself: data channels,
heartbeats, browser limits. A channel kept outside the budget defeats the
budget. Loss of reciprocal capability decays the edge through the liveness
path. This stands rejected unless someone prices it.

## What this definition does not establish

It does not prove O(log N) routing. A per-node score cannot; the claim is
earned by topology tests — reachability, path stretch, last-hop success —
under sparse, partitioned, and asymmetric conditions.

It does not fix constants. Margin, grace, residence, floor, lane size, backoff
base: proposals go to the delay/failure matrix, and the matrix decides.

It does not identify the historical `6522f2f` trigger. The isolated test at
kernel commit `c16d12b` reproduces a boundedness failure under an injected
never-bind candidate — 3.0 probes per tick, sustained, maintenance on; zero
off. The injection is motivated by web-transport negotiation behavior and is
not proven to be what Howard's suite hit. That proof needs the live testnet.

## Where the code stands

The kernel does not implement this definition. The gaps, by file and line at
4.64.0:

- `AxonaPeer.js` `_seedSynaptomeWithSponsor` — the admission path every
  binding transport takes — is a direct insert: no cap check, no comparison,
  no eviction. Hold-or-improve requires a compare-and-swap gate here that does
  not exist.
- `NeuronNode.js:95` `canPrune` — the sole-stratum survival rule — exists in
  source and is dead code. Nothing calls it. This definition would enforce it,
  widened to r ≥ 2.
- `DHTNode.js:201–211` `_trySwapIn` — the benchmark engine's stratum-count
  Pareto guard — is the same gate this definition puts at admission, already
  written, in the wrong layer.
- `AxonaPeer.js:3452` `_vitality` — LTP weight times recency — is the
  within-stratum rank term, already live.

## Verification

The delay/failure matrix asserts, per scenario, both halves of each guarantee —
the bound and the recovery:

| Scenario | Bound asserted | Recovery asserted |
|---|---|---|
| slow-then-bind candidate | per-candidate attempt cap | edge forms once bindable |
| fail-then-bind candidate | backoff held through failures | edge forms after failures stop |
| permanent-fail candidate | attempts expire, stop | node redirects budget elsewhere |
| newcomer joins saturated mesh | lane bounded, rate-limited | newcomer reaches working degree |
| correlated inbound eviction | swap-rate cap holds | victim recovers to degree floor |
| empty-stratum pressure | deficit backoff engages | search resumes on fresh routing record |

A run that shows the bound without the recovery, or the recovery without the
bound, fails.
