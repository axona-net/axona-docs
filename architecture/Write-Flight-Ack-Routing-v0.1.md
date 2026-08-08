# Write-Flight Ack Routing and Chain Budget — remediation design

**Status:** design proposal v0.1 — for council review before any code
**Baseline:** `@axona/protocol` 4.62.1 testnet at `8f34759`; incident GH #51
**Author:** axona.bot · **Reviewers:** Aster, Orion · **Decider:** David
**Scope:** the write flight's evidence return path and its termination. No
change to root election, tombstones, epochs, ingest order, or any read path.

## The question this design answers

How does a write flight hear its evidence across a multi-hop route, and when
does a failing write STOP?

Today it hears nothing and never stops. `_forwardToRoot` opens the flight at
the route's ORIGIN and sends the PUB routed; the root acks `meta.fromId` —
the LAST HOP. One-hop routes work. On any multi-hop route the ack lands on an
intermediate relay holding no flight and is dropped. Silence convicts an
honest root; the promotion re-send is also routed and also deaf; each
promotion opens a NEW flight with a fresh budget, so the write oscillates
between candidates at ~15 s per conviction, forever. Measured on GH #51:
16 deaf-flight evictions/hour on a healthy mesh from the first soak hour,
eviction:promotion exactly 1:1, superlinear accumulation to fleet collapse,
self-sustaining after the stimulus stopped.

Define by negation: this is not a redesign of the eviction fence. The fence's
law — a write completes on bound INGEST evidence or the authority is
convicted — stands. The defect is that the evidence was addressed to the
wrong node, and that conviction had no terminal.

## D1 — The ack routes to the flight owner

The PUB/KILL frame a flight owner dispatches gains one field:

```
ackTo: <origin transport id, hex>     // the flight owner
```

At the root, `_sendIngestAck` routes the INGESTACK to `ackTo` when present —
a normal routed send, not one hop back. When `ackTo` is absent (a 4.62.1 or
older sender), the ack goes one hop back exactly as today: old behavior for
old senders, degraded but never worse.

The ack payload and its binding are unchanged: completion still requires the
authenticated sender to be the flight's root and the epoch to match
(UNVERSIONED flights keep their addressed-node-first-ack semantics). Receipt
probes gain the same field with the same fallback.

Privacy: `ackTo` names the FORWARDER's transport identity, which every hop on
the route already sees at the transport layer. The origin PUBLISHER is not
the forwarder, receives no acknowledgment, and stays out of the protocol
(I-9 unchanged). Transport ids are ephemeral per restart (I-15 unchanged).

## D2 — A promotion chain has a budget and a terminal

The flight owner keeps one chain record per `(topicId, msgId)`:

```
chain: { promotions, exhaustedAt }
CHAIN_MAX_PROMOTIONS = 3
```

Eviction's retry-promotion increments the count. At the cap, the chain ends
in ONE recorded terminal — `write-flight-exhausted`, with the topic, msgId,
promotion path, and last verdict — and no further flights open for that
msgId until the application retries the publish afresh. The record is swept
with the flight ledger; no new timers. This is the Observable-Outcomes law
applied to the one decision path that lacked it: today's terminal is "the
next conviction," which is not an outcome.

Three promotions is a starting value, not a law: it must exceed the
plausible run of stale candidates after one real death (the K=3 cohort), and
anything it gets wrong shows up as `write-flight-exhausted` counts, which
the metrics surface carries. Tuning it is a constants change, not a design
change.

## D3 — The test class that let this ship cannot exist

Every path that passed a gate was 1-hop: MockNet dispatches direct by
construction; the live gates ran on a dense settled mesh; the one live
promotion went to self.

- MockNet gains a **multi-hop mode**: `sendDirect` routes through N
  intermediate managers, so `meta.fromId` at the terminus is an intermediate
  node, exactly as live. The mode is a constructor flag; existing tests are
  untouched.
- `smoke_write_flight_multihop.mjs`: red on 4.62.1 by reproducing the deaf
  ack and the A↔B oscillation; green under D1+D2 — ack reaches the owner
  across 2 hops, and a write with evidence wedged shut ends in
  `write-flight-exhausted` after exactly `CHAIN_MAX_PROMOTIONS` promotions.
- TESTNET-PROTOCOL gains a **non-adjacent live gate**: publish through a
  forwarder whose synaptome excludes the topic root, so the route is
  provably ≥2 hops. The 4.62.1 gates measured the mechanism only where
  adjacency made the defect invisible; this gate removes the luck.

## What this design deliberately does not do

- No beacon-starvation mechanism. The epoch-0 flights under storm were a
  symptom: with D1 the acks arrive, flights complete, and beacons flow.
  UNVERSIONED remains the correct mixed-mesh compat state. If a post-fix
  soak still shows blind flights at rest, that is a new finding with its own
  design round.
- No change to the 4 killed-message-resurrected events yet. The suspect is
  promotion churn re-seating roots past their tombstones; D2 removes the
  churn that produced them. The post-fix soak either reproduces them —
  making them a live defect with a design round — or retires them as
  storm debris. They stay open on #51 until one of those happens.
- No wire version bump. `ackTo` is an additive optional field; old receivers
  ignore it, old senders omit it, and the fallback preserves 4.62.1 behavior
  bit for bit on 1-hop routes.

## Rollout and acceptance

Kernel `4.62.2` candidate, testnet only, full ritual (suite + new multi-hop
smokes + fence, relay re-vendor gate, bridge pin, droplet, both fleet rolls —
each gate on David's word). Mixed-mesh note: until a fleet is fully rolled,
an OLD root still acks one hop back, so a multi-hop flight against it can
still exhaust — the chain budget converts what was an eternal storm into a
bounded, recorded failure, and the fleet roll removes it.

Acceptance is the instrument that caught the defect: a full overnight soak on
the rolled testnet, judged against the 4.61.x cumulative baseline (93.6%),
plus the SIGKILL gates rerun with the new non-adjacent gate, plus zero
`root-evicted` at rest. The 4.62.1 gate numbers taught what a settled-mesh
pass is worth; the soak decides.
