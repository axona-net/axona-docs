# Axona vs. Vivaldi — RTT-aware locality, two different mechanisms (v0.1)

**Status:** architecture note / design rationale · **Flagged:** 2026-06-01 ·
**Relates to:** open finding **E-1** (targeted address grinding) in the
[red-team punch list](../red%20team/red-team-punchlist-v2.6.0.md) — the
"proof-of-work *vs.* Vivaldi RTT-coordinate clustering" decision. This note
exists so the comparison is on record when that decision is revisited.

---

## TL;DR

Both Axona and Vivaldi use measured RTT to favour low-latency peers, and both
learn online — but they are **different categories of mechanism at different
layers**, not two designs of the same thing. Saying "Axona without the 8-bit
geo prefix is basically Vivaldi" overstates a surface resemblance.

- **Vivaldi** is a *predictive Euclidean embedding* of the latency space: it
  assigns each node a synthetic coordinate so that coordinate distance
  *estimates the RTT to peers you may never have contacted*. It is a latency
  **primitive**, not a router.
- **Axona** is a *structured DHT* whose next-hop score is biased by
  **empirically measured** RTT on the synapses it actually maintains
  (reinforced by LTP). It never builds a coordinate and never predicts an
  unmeasured link.

The geo prefix is an **address-level locality prior**, orthogonal to that
predict-vs-measure distinction. Removing it costs Axona its free cold-start
locality (the ablation performed well but worse) — it does **not** turn Axona
into a coordinate system.

## 1. Predict vs. measure — the core distinction

| | Vivaldi | Axona |
|---|---|---|
| What RTT *is* in the design | the **output** — a predicted distance from a coordinate embedding | one **input term** — a measured per-link weight in the next-hop score, plus an LTP reinforcement signal |
| RTT to an *unmeasured* peer | estimated from coordinates (predict-without-measuring is the whole point) | **not available** — Axona only knows links it holds |
| Underlying object | a low-dimensional Euclidean coordinate per node (+ height term) | a synaptome: weighted, latency-tagged links with use counts |
| Nature of the value | synthetic / modelled | empirical / first-party measured |

Axona is closer to a latency-aware **cache/bandit over real links**; Vivaldi is
a latency-space **geometry**.

## 2. Different layers — Vivaldi could *supply* what Axona instead measures

Vivaldi is **not a DHT or a router**. It is a coordinate *service* you layer
*under* something — a proximity-neighbour-selection (PNS) Kademlia, a replica
picker, a server-selection oracle. Vivaldi alone cannot route to a key; it has
no keyspace.

Axona *is* the DHT (264-bit keyspace, structured distance to a target, RTT as a
secondary tie-break among hops that all make keyspace progress).

So the clean framing: **Vivaldi could be the latency oracle that a PNS-DHT
consumes; Axona made the opposite choice and measures directly.** The honest
analogue for "Axona minus the prefix" is therefore **latency-aware /
reinforcement Kademlia (PNS/PRS)** — *not* Vivaldi. Vivaldi sits one layer down
as an alternative latency source Axona did not use.

## 3. Different assumptions, different failure modes

- **Vivaldi** assumes the latency space is approximately **Euclidean-embeddable**.
  The Internet violates the triangle inequality (TIVs); the height vector
  mitigates access-link asymmetry but TIVs are a hard accuracy ceiling, and
  churn/drift degrade the embedding. Its error is **model error**.
- **Axona** assumes **nothing** about metric structure — a measured RTT is a
  measured RTT, immune to embedding error and TIVs. It pays in **coverage**: it
  only knows the links it maintains.

## 4. Cold start — both learn; the prefix is the differentiator

Both systems have a cold start:

- **Vivaldi** coordinates begin random/at-origin and **relax globally** over
  many RTT samples; early predictions are poor everywhere.
- **Axona-without-prefix** also starts cold but learns **locally**, reinforcing
  the specific links it uses rather than converging a global model.

The 8-bit S2 prefix is a locality prior **encoded in the nodeId itself**: known
the instant you see a peer's ID, *before any measurement*, at zero RTT cost.
That is an advantage Vivaldi structurally cannot get for free — geography is in
no identifier, so Vivaldi must infer it. (You can GeoIP-seed Vivaldi
coordinates, but that is a bolt-on; Axona bakes the prior into the namespace.)
This is why the prefix "dramatically improves startup": it warm-starts locality
that a coordinate system has to learn.

But the prefix is **orthogonal** to §1: removing it removes the warm start, not
the measure-not-predict character. Axona-no-prefix is still a measured-RTT
keyspace router, just without the free geographic head start.

## 5. Adversarial footnote — both gameable, differently

- **Vivaldi:** a known **coordinate-manipulation** surface — a node lies about
  its coordinates to distort everyone's latency view (motivating defenses like
  Veracity).
- **Axona:** the geo prefix is **self-asserted and grindable** — this *is*
  finding **E-1**; raw coordinates at rest are also a privacy leak (**F-1**).
  But the *measured-RTT* half is harder to forge: it is first-party — you cannot
  fake the latency of a link you actually hold — which is also why it composes
  with Axona's no-centralized-reputation constraint.

## 6. Bearing on the E-1 decision

E-1 weighs **proof-of-work on identity generation** vs. **Vivaldi RTT-coordinate
cross-check** as a targeted-placement defense (both decentralized, so
constraint-OK).

The relevant question this note frames: a Vivaldi coordinate is a **predicted**
quantity carrying embedding error (§3) and its own **manipulation surface**
(§5). Axona today relies on **measured** RTT plus a **self-asserted** prefix.
Introducing Vivaldi would add a global model (significant complexity) whose
*predictions* an adversary can bias — partially re-importing the very class of
problem E-1 is trying to close — whereas PoW taxes honest-join UX but adds no
predictive-model attack surface. Neither is free; this note is the record of
*why they are not interchangeable* so the trade is evaluated on its real terms,
not on the assumption that "Axona already does Vivaldi-ish RTT, so adding
Vivaldi is cheap." It is not cheap, and it is not the same mechanism.

> **Not a recommendation.** This note deliberately stops at framing the trade;
> the PoW-vs-Vivaldi approach decision remains open (E-1).
