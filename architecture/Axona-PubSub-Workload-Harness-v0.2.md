# The pub/sub workload harness — v0.2 (amendments folded; criteria table for clearance)

*2026-08-27 · kernel 4.68.2 on testnet · supersedes v0.1 (e9ed9d2) · folds
Aster e33fc610, Orion 730ff2b6, Vega 922dcd16 · the criteria table in §7 is
the object the seats clear BEFORE Arm A runs*

What would it take to catch, on demand, every pub/sub failure we keep meeting
by accident? v0.1 asked; the seats answered within the hour. v0.2 is those
answers folded, with one addition from the round's own logistics: while
collecting the amendments, this seat's watch buffer wedged twice — messages
visible in the raw inbox, invisible to the drain — which is detector row 4
happening to the collator mid-round. The failure surface is not hypothetical.

## 1. Workload (unchanged from David's spec)

10–20 OPEN topics, chat shape: every harness node subscribes to all of them;
publishers rotate across the fleet at a 30–120s cadence with occasional
bursts. 5–10 OWNED topics, feed shape: one owner-key publisher each,
continuous cadence, a fixed subscriber group. std/message envelopes at
chat-typical sizes. Topic map, cadence schedule, and payload manifest are
generated from a SEED and identical across arms.

## 2. Architecture: sidecar peers + passive relay telemetry

Sidecar harness peers per host, separate processes, one durable author each,
using the mesh through the same bridge the relays serve — the SUT stays a
black box (Orion: prevents observer effects; Vega concurs; in-relay harness
deferred unless a seat nameses a detector the sidecar cannot reach).
Supplemented by READ-ONLY relay telemetry on a sampling cadence: roles,
synaptome size, mesh open/bound, state — correlation data, never stimulus.

## 3. Three independent truths per operation (Aster block 1)

Every operation preserves three separately-recorded truths, and no single one
serves as the oracle:

1. **Intent** — topic, monotonic per-topic seq, nonce, payload hash,
   publisher author/node/host, local monotonic start time.
2. **API result** — confirmed flag, msgId or error, completion time.
3. **Observation** — watch receipt AND periodic pull head at EVERY required
   subscriber, independently timestamped.

`confirmed` is not the oracle. The publisher's own watch is not the oracle.
Clock-offset samples and monotonic elapsed times ride every record so latency
claims survive four hosts.

## 4. Stateful detectors (Aster block 2; supersedes v0.1's table)

- **Stranded write** — accepted/confirmed publish not visible to required
  readers within the SLO; root/seat snapshot and recovery action recorded.
- **Stale pull** — a reader returns a LOWER topic-seq after having observed a
  higher one.
- **Replay gap** — `since:'all'` diffed against the publisher's append-only
  manifest: missing, duplicate, reordered, or foreign payloads each classified.
- **Wedged watch** — pull advances while the watch stays silent for >3
  publish intervals, per node. (Reproduced live during this round's own
  collation.)
- **Split/interloper root** — contemporaneous root/seat views disagree,
  correlated to delivery partitions.
- **confirmed:false** — classified tripartite by later observation:
  false-negative, true failure, indeterminate. Zero ops may END indeterminate.
- **Churn collapse** — recovery time and backlog completeness after scripted
  joins, leaves, reconnects, and host loss.

## 5. The bilateral/rescue scenario (Arm B; Aster block 3, Orion §2)

An explicit scenario, not an incidental metric. Force both endpoints near
cap; create simultaneous competing edges; churn the current root/heir path.
Log on BOTH peers: channel census, pending-key set, pending timer identity,
eviction candidate and reason, each maintain/guard/lane/presence/grace
decision, post-grace state. Required invariants:

- physical channels never exceed the cap;
- a duplicate pending edge consumes ONE headroom slot and retains ONE timer;
- neither side evicts the only viable rescue edge;
- all pending/grace timers drain after stop/leave;
- delivery and replay recover WITHOUT a fleet-wide reconnect.

Every OS runs as initiator and as receiver.

## 6. Churn schedule (Orion §3; Vega concurs)

Rolling restart of one relay every 15–30 minutes across rotating hosts,
census held ≥95%. One abrupt single-relay kill/restart per host every 2
hours, with a ≥3-minute heir-convergence window. Multi-node simultaneous
blackout is OUT of scope for this round. All churn is scripted, seeded, and
identical across arms. Restart paths must exercise the #57 shape: a
restarting relay's presence announce vs its first bond (Vega precondition if
the gate arms).

## 7. THE CRITERIA TABLE — frozen before Arm A; the seats clear THIS

**Representativeness (Arm A, stack OFF).** Arm A must reproduce at least ONE
addressing/root failure (stranded write, split root, stale pull) AND at least
ONE watch/replay/churn failure (wedged watch, replay gap, churn collapse) —
otherwise the round is NON-EVIDENTIARY and the workload goes back for
redesign. A clean 12h without churn stress does not satisfy this; the window
extends until the churn schedule has run in full.

**Arm B (stack ON, ratified armed-canary constants), all required:**

| Gate | Threshold |
|---|---|
| Delivery | 100.0% of confirmed publishes reach the FULL predeclared required-reader set per topic; scored on full-set completion, never "any subscriber" |
| Integrity | zero undetected loss; zero replay gaps after the reconciliation window; zero stale-read regressions; zero persistent split roots |
| Propagation | p99 ≤ 2500ms; zero tails >10s; report p50/p95/p99/max, never averages alone |
| Recovery | 100% of induced failures recover within the predeclared bound, without fleet-wide reconnect |
| Invariants | zero cap violations; zero guard over-budget events; zero unbounded map/timer growth; deficitReopens tracked per node |
| Resources | per-process RSS/CPU/channel/timer distributions by OS/host; no monotonic post-quiescence growth (leak slope ~0) |
| Attribution | identical seed, schedule, topic map, payload manifest, churn script, duration across arms; binaries and configuration captured by hash |

**Negative controls (both arms; Aster).** One malformed publisher; one
subscriber paused beyond replay-retention assumptions; one host with induced
clock skew. Each must degrade CLASSIFICATION cleanly — misattributing a
control to transport failure fails the harness, not the network.

**Window.** 12h minimum per arm; Arm A extends until the representativeness
gate is met or the redesign verdict is reached.

## 8. Howard's infrastructure

His live cross-peer flake sequence runs as a scheduled recurring cycle in
BOTH arms. His classification is adopted verbatim: zero-delivery vs partial
per topic — all-or-nothing is an addressing failure, partial is transit. His
REPS discipline governs claims: no single-run conclusion. #54 and #55 are
scenario sources; a harness node that suspends and resumes is a scenario.
David's ask stands: Howard is invited to review this spec directly.

## 9. Sequencing

Criteria table cleared by the seats → harness BUILT (sidecars, detectors,
manifest/ledger, analyzer — reviewed like any code) → Arm A (stack OFF) →
representativeness verdict → Arm B arming on David's testnet sanction →
paired analysis → the arming and deploy questions get their evidence.
Prod stays untouched throughout. Nothing arms outside testnet.
