# Dead-Root Eviction — a liveness gate for the write path

**v0.3 · 2026-08-07 · kernel 4.61.2 (testnet) · axona.bot · council-ratified
(Orion seq 424); this revision folds in Aster's capture addendum (seq 427)
after the live capture on GH #28 named the mechanism**

What happens to a topic whose root dies without saying goodbye?

Today the answer is: its writes are dead, and they stay dead. The registration
naming the dead node as root lives on in the surrounding cohort. Every PUB
defers to it. Nothing evicts it. A topic that gets no competing root — which is
every low-traffic topic — never heals.

## The specimen

We have a live one, captured on prod within the hour
([#28](https://github.com/axona-net/axona-protocol/issues/28), 2026-08-07
20:21–21:12Z, kernel 4.61.2, owned topic `axona.bot`, region eagle):

- The root holder was killed by a session restart. No `leave()`, no handoff.
- RESOLVED ON TAPE (22:33Z, publisher-side routeMessage capture): the strand's
  standing cause was `89f26d4925…` — a live transient XOR-closer to the topic
  than the whole fleet, which ACCEPTED every write (consumed, correctly
  attributed) and never ingested or served one, while reads were answered by
  the fleet cohort holding old history. The topic healed at 2 h 06 m, in
  15.3 s, only after the flapper's channel finally refused outright.
- Writes: five attempts over 50 minutes, from a fresh peer and from a
  long-lived peer. All stranded. The long-lived peer's publish even returns
  `ok` — the ack reports acceptance, not delivery.
- Reads: correct throughout, but slowing — 0.67 s, then 2.1 s, then 7.1 s —
  each read escalating past the dead holder instead of anyone evicting it.
- Every OTHER topic on the same machine, same peer, same minute: writes
  confirm in seconds.

At 50 minutes this is not a settling window. It is a permanent state.

## Recon: where the write path actually loses the message

The write path is not naive. It already carries a verdict layer
(`_forwardToRoot`, v4.59.0) built after the 2026-08-02 corpse-pin outage. The
specimen lives in the crack between two of its verdicts.

The four write-side sites on 4.61.2:

| Site | Op | Closer-root gate | Send path | Verdict handling |
|---|---|---|---|---|
| `wireHandlers.js:87` | SUB | `_liveCloserRoot` strict (channel-verified) | `_deferToRoot` — demote, then fire-and-forget | none |
| `wireHandlers.js:275` | PUB | `requireReachable: false` — **a stale beacon can win** | `_forwardToRoot` | three verdicts, below |
| `wireHandlers.js:763` | KILL | `requireReachable: false` | `_forwardToRoot` | same as PUB |
| `wireHandlers.js:912` | METRICSON | strict | `_deferToRoot` | none |

`_forwardToRoot`'s contract (`AxonaManager.js:676`): consumed-and-attributed
to the named root → demote + re-home; **consumed at another node → no
mutation** — "the message is safe with whoever took it"; failed → invalidate
the matching beacon record.

The failure sequence, step by step:

1. Every node the write touches computes `closer` through the loose gate, and
   the dead root's stale beacon — held in `_rootClaim` records across the
   cohort — wins on every one of them.
2. The forward toward the corpse routes multi-hop and is consumed by a live
   intermediate: closest toward the dead node's ADDRESS, not the topic's
   root, holding no role.
3. That is the consumed-at-another-node verdict. No mutation, no retry, no
   beacon invalidation. The `failed` verdict that WOULD bury the beacon never
   fires — the send didn't fail, it was swallowed alive.
4. "Safe with whoever took it" is false for a write consumed by a
   non-ingesting node. Nothing ingests. Nothing retries. The stale beacon
   survives to strand the next write.

So the target of this design is precise: the `_rootClaim` beacon record naming
a dead incarnation, and the verdict semantics that let consumption stand in
for ingestion.

## The proposal

Make the write path do what the read path already does — notice a dead holder —
and then go one step further: bury it. One gate, demand-driven, three steps,
hardened by the council's five closure items.

### 1. Bounded defer — the INGEST-ack contract *(Aster item 2)*

A write that defers to a registered root completes only on a typed INGEST-ack:

    { topicId, msgId, rootIncarnation, op: PUB | KILL }

emitted by the root AFTER topic-store ingestion — never at routing. PUB
completes on ingest; KILL completes on tombstone ingest; the two are separate
completions and never conflated. Consumption anywhere else is explicitly
NON-TERMINAL: the write is still in flight and the flight continues. Retries
are idempotent — msgId is content-addressed, and a duplicate ingest-ack for a
message already held is success, not error.

No ingest-ack by the caller's deadline → the named root incarnation is
suspect.

The rule has NO actor exception (Aster seq 427, forced by the capture): a
forward's `consumed` verdict is never terminal write success — not when
consumed elsewhere, and not when consumed at the named root. It is hop-local
routing evidence only. The captured flapper satisfied consumed-and-attributed
for two hours.

### 2. Probe, evict, promote — with incarnations *(Aster item 1)*

Every root claim carries a monotonic **incarnation**: `(nodeId, epoch)`,
minted at promotion, carried in beacons, named in ingest-acks.

On suspect: the deferring holder probes that incarnation once, directly — and
the probe demands the CORRELATED RECEIPT: the ingest state for that exact
{topicId, msgId, incarnation, op}, or an explicit statement of inability.
Transport reachability, a generic routing reply, or any answer that does not
bind those four fields is NOT exculpatory — the captured flapper was alive
and answering; a liveness probe would have acquitted it forever (Aster seq
427). No receipt → it writes an **eviction record** — a tombstone for that incarnation, which
is an authoritative, reconcilable root-state mutation, not a private note —
and promotes the closest LIVE holder by the same closest-live rule used
everywhere else. The promoted root mints the next incarnation. History is
already present — REPLICATE union-ingest (4.22.0) put it there.

The rejoin rule closes the resurrection hole: a returning node whose
incarnation is tombstoned may not resume as root. It re-enters as a holder,
sees the higher incarnation's beacons, and adopts. Age never beats epoch.

### 3. Converge

The promotion mints exactly the competing root that reconciliation has been
waiting for, now with a total order to converge BY: higher incarnation wins.
`rootReplicas` reach is sufficient because promotion happens inside the
cohort. The stranded write retries onto the promoted incarnation.

### Serialization *(Aster item 3)*

Recovery runs one flight per `(topicId, suspectIncarnation)`. Concurrent
stranded writers on the same topic join the standing flight; they do not
launch parallel probes. The flight snapshots cohort membership once and walks
closest-live in that deterministic order. If the walk exhausts — zero live
eligible holders — the result is a typed terminal failure to every joined
writer. Never another false `ok`.

### Deadlines and cleanup *(Aster item 4)*

Every stage — defer, probe, promotion, retry — spends from the CALLER's one
deadline (the same one-monotonic-deadline contract the mesh gate adopted in
4.61.2). Every listener and timer is released on every exit path: ack,
eviction, terminal failure, and caller abandonment. The 4.61.2 case-G leak
checks are the template.

## What this is NOT

- **NOT a heartbeat or lease.** No new periodic traffic. A root that nobody
  writes to costs nothing; eviction triggers on the first write that needs it.
- **NOT stability-weighted election.** That was sim-refuted and stays refuted.
  Promotion uses the same closest-live rule as every other election. Churn is
  the weather; mechanisms work in it or they're wrong.
- **NOT publisher self-rooting.** The publisher never promotes itself — that
  is how interloper roots were minted (#353). Promotion is cohort-side only.
- **NOT a change to the read path.** Reads keep their escalation; after
  eviction they simply stop needing it.
- **NOT a rewrite of the verdict layer.** `_forwardToRoot`'s three verdicts
  stand; the change is that for writes, consumed-elsewhere stops terminating
  the flight and ingest-ack becomes the only terminal success.

## Failure modes considered

**Transient partition read as death.** The probe deadline is conservative, and
a wrong eviction is bounded by the incarnation order: the partitioned root
returns, finds its incarnation tombstoned, and adopts under the promotion. No
race, no resurrection, no split — the exact scenario that today produces
permanent split roots (#397) instead converges by epoch.

**Eviction storm after mass death.** Eviction is per-topic and per-flight,
serialized. A full-generation roll produces at most one flight per topic that
someone actually writes to — bounded by write demand, not topic count.

**Death immediately after ingest-ack.** The ack is honest — the message WAS
ingested — and durability is the existing REPLICATE cohort's job, unchanged
by this design. The next write finds the corpse and runs the flight.

## Acceptance *(Aster item 5)*

Race tests beyond the basic SIGKILL smoke, each PUB and KILL separately:

- SIGKILL the root, publish from another peer: delivery within the caller's
  deadline.
- Concurrent stranded writers: one flight, all complete, no parallel probes.
- Transient partition and rejoin with stale root state: returning incarnation
  adopts; no resurrection; no split.
- Root death immediately after ingest-ack: no false failure, next write
  recovers.
- Zero live eligible holders: typed terminal failure to every writer.
- Listener/timer leak checks on every exit path.

Plus the full standing gates: kernel suite, axonSpec, churn and interloper
smokes, soak A/B against 4.61.2.

**The prod gate.** The original specimen healed on tape during the capture,
so the gate becomes: the SIGKILL smoke and the responsive-no-mutation smoke
green, plus a FRESHLY MINTED specimen at prod deploy time — kill a root
ungracefully, write, and the write must land within the caller's deadline
with the eviction visible ACROSS the cohort: an independent fresh peer, not
the recovering writer, reads the new message as latest and observes the
promoted incarnation.

## Register

Closes #422 (write path has no liveness gate). Closes the low-traffic case of
#397 — incarnation order gives reconciliation the total order it lacked; the
beyond-reach competing-root case stays open. Resolves #421's mechanism
question in favor of "the roll evicted the dead seat" — the 4.59.x write fix
alone would not have done it.
