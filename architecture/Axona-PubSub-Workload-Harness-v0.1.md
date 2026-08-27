# The pub/sub workload harness — v0.1 (definition draft)

*2026-08-27 · kernel 4.68.2 on testnet · council definition round open at
`5862dc33` · v0.1 is the draft the seats amend, not the spec they cleared*

What would it take to catch, on demand, every pub/sub failure we keep meeting
by accident? The production network fails in ways every operator of it has
personally seen — a publish that strands against a dead root seat, a read that
returns an hours-old head, a watch that goes quiet while the mesh flows. The
testnet fleet, 62 relays across four hosts, has never shown any of this — and
that is not evidence of health. It is an unloaded network. `roles=0` on every
relay means nobody is publishing anything worth failing over.

This harness loads the fleet with the workload production actually carries,
verifies every operation from the subscriber's side, and runs the same workload
twice: once with the connection-quality stack off, once with it armed. The
stack was built to address these failures. This is the experiment that says
whether it does.

## What this harness is NOT

It is not a benchmark — no latency league tables; delivery correctness is the
subject. It is not a simulator — every operation runs on the live testnet
mesh through the shipped kernel. It is not a prod test — nothing here touches
`bridge.axona.net`, and arming applies to testnet only, under David's sanction
recorded in the definition round. And a green result is not a deploy verdict —
that stays David's.

## The workload (David's spec)

- **Open topics, 10–20**: the axona-chat shape. Every harness node subscribes
  to every open topic. Publishers rotate across the fleet — various nodes,
  regular cadence, so root placement and publish paths vary the way a real
  chat's do.
- **Owned topics, 5–10**: one node holds the owner key and publishes
  continuously; a fixed group of nodes subscribes. This is the feed shape —
  alert-bot, metrics, announcements.
- Cadence, message sizes, and per-topic history depth: council input wanted.
  The starting proposal is a publish every 30–120s per topic with occasional
  bursts, payloads in the std/message envelope at chat-typical sizes.

## The harness node

Each relay host runs harness PEERS alongside its relays — separate processes,
one durable author identity each, connecting through the same testnet bridge
and mesh the relays serve. The relays under test stay untouched: the harness
observes the network by USING it, never by instrumenting relay internals.
(Whether harness peers should also run ON relay processes themselves is an
open seat question — the sidecar form is the v0.1 proposal because it keeps
the SUT clean.)

Every operation writes one JSONL record: op, topic, msgId, publisher author,
outcome, timing, and the verifying node's identity — transport nodeIds
truncated per the standing rule; author ids may persist.

## The issue inventory, mapped to detectors

The harness earns its keep by catching each known failure BY ARTIFACT:

| Production failure (all observed on 4.62.2) | Detector |
|---|---|
| Stranded write — publish defers to a dead root seat | publisher records confirmed status; every subscriber independently records arrival; confirmed-but-undelivered and unconfirmed-but-delivered both flagged per msgId |
| Stale read — pull returns an old head | periodic `pull` per topic cross-checked against the newest verified-delivered msgId; staleness = lag in messages and seconds |
| Slow propagation — confirmed publish takes hours to appear | per-subscriber arrival timestamps vs publish time; the distribution IS the metric, tail percentiles named |
| Wedged watch — buffer freezes while the mesh flows | each subscriber runs a standing watch AND periodic independent pulls; watch-silent-while-pull-sees = wedge, per node |
| `confirmed:false` false-negative | byte-identical retry policy built in; dedup-vs-new-msgId distinguishes false negative from real loss |
| Interloper / split roots on warm topics | subscribers record which root answered (when surfaced); divergent heads across subscribers on one topic = split, per cycle |
| Replay gap — `since:'all'` missing history | fresh peer joins a warm topic each cycle and diffs replay against the verified ledger |
| Churn collapse (#51 shape) | scheduled relay kill/replace during windows (roll-discipline, harness-driven, testnet only); delivery and role counts tracked through the event |

Seats: add what is missing. A failure mode without a detector row does not
exist for this harness, and that is exactly the failure mode that will bite.

## Howard's infrastructure

Folded in per David: the `howard-repro` suite (live cross-peer flake
reproduction — its scenario becomes a harness cycle); the alert-bot
classification discipline — zero-delivery vs partial per topic, because
all-or-nothing is an addressing failure and partial is transit — and its
REPS methodology (no single-run claims); #54 (app/network coordination) and
#55 (throttling/suspension) as scenario sources — a harness node that
suspends and resumes is a scenario, not an accident.

## The two arms

- **Arm A — stack OFF.** The workload against the fleet exactly as deployed
  (everything default-off). REQUIRED RESULT: reproduce the production failure
  shape. If Arm A runs clean, the workload is not representative and the
  harness goes back for redesign before Arm B means anything.
- **Arm B — stack ON.** Gate, maintenance, guard, lane, presence, grace at
  the ratified armed-canary constants. Same workload, same duration, same
  churn schedule.

Attribution lives in the pair. Window length: long enough for churn effects —
the 4.62.1 storm took hours to emerge; the starting proposal is 12h per arm
minimum, council to set. The criteria table is written and cleared BEFORE
Arm A starts, in the armed-canary tradition: numeric thresholds per detector,
and what would make each number wrong.

## Open questions for the seats

1. Sidecar peers vs in-relay harness — does the sidecar form miss anything
   the inventory needs (e.g., a relay's own subscribe path)?
2. Verification semantics each seat would refuse to clear without. The
   bilateral/rescue validation named open since GRACECLOSURE-05 belongs in
   Arm B's detector set — how?
3. Churn schedule: magnitude, cadence, and whether kill-without-heirs
   (the known data-loss case) is in scope on testnet.
4. Criteria: per-detector thresholds for "reproduced" (Arm A) and
   "addressed" (Arm B).
5. What Howard should be asked to contribute or review directly.

The definition closes when the seats' amendments are folded and the criteria
table is cleared. Build follows definition; Arm A follows build; nothing arms
outside testnet.
