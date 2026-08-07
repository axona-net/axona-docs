# Dead-Root Eviction — a liveness gate for the write path

**v0.1 · 2026-08-07 · kernel 4.61.2 (testnet) · axona.bot · for council review**

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
- Writes: five attempts over 50 minutes, from a fresh peer and from a
  long-lived peer. All stranded. The long-lived peer's publish even returns
  `ok` — the ack reports acceptance, not delivery.
- Reads: correct throughout, but slowing — 0.67 s, then 2.1 s, then 7.1 s —
  each read escalating past the dead holder instead of anyone evicting it.
- Every OTHER topic on the same machine, same peer, same minute: writes
  confirm in seconds.

At 50 minutes this is not a settling window. It is a permanent state.

## Why the existing machinery doesn't cover it

Each of these mechanisms is real and shipped. Each one stops short of this case:

| Mechanism | Ships in | Why it doesn't fire here |
|---|---|---|
| Leave-handoff (+ack/retry) | 4.19.4, 4.32.0 | Requires a graceful `leave()`. A killed process never calls it. |
| Root-liveness-gated backup handoff | 4.31.0 | Gates the handoff path — same prerequisite. |
| Root reconciliation | 4.19.x | Converges COMPETING roots. A dead root has no competitor; nothing mints one. Reach is `rootReplicas` (#397). |
| Read escalation / read-repair | 4.33.0, 4.36.0 | Heals reads only, and by detour — it routes around the corpse without burying it. The 0.67→7.1 s creep is the price. |
| Reachable-root fallback (refreshTick) | 4.9.0 | Subscriber-side. The subscriber's reads succeed via a live holder, so its health check passes and it never re-homes. Measured: a subscribed peer sat on the specimen 50 minutes without acting. |

The pattern: every recovery path is keyed on either a goodbye or a competitor.
Ungraceful death of the only root produces neither.

## The proposal

Make the write path do what the read path already does — notice a dead holder —
and then go one step further: bury it. One gate, demand-driven, three steps.

1. **Bounded defer.** A write (PUB or kill — writes are writes) that defers to
   a registered root requires an acknowledgment of INGEST, not of routing,
   within a deadline. Today's defer is satisfied too early; the specimen's
   `ok`-that-wasn't is the proof. No ingest-ack by the deadline → the root is
   suspect.
2. **Probe, then evict.** The deferring holder probes the suspect root once,
   directly, over the existing wire. Dead → the holder evicts the registration
   and promotes the closest LIVE holder by the same closest-live rule used
   everywhere else. That holder already carries history — REPLICATE
   union-ingest (4.22.0) put it there.
3. **Converge.** The promotion mints exactly the competing root that
   reconciliation has been waiting for. The existing reconciliation path
   converges the pair, and the live one wins — by liveness, not by age.
   `rootReplicas` reach is sufficient because promotion happens inside the
   cohort.

The stranded write itself is retried onto the promoted root. Content-addressed
msgIds make the retry idempotent.

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

## Failure modes considered

**Transient partition read as death.** The probe deadline is conservative, and
eviction is local to the deferring holder. If the "dead" root was merely
partitioned, it re-announces on return and the pair converges through the same
reconciliation that already handles split roots after every fleet roll. The
worst case of a wrong eviction is a state we already recover from routinely.

**Eviction storm after mass death.** Eviction is per-topic and per-write. A
full-generation roll produces at most one probe per stranded write, bounded by
the write rate — not by the topic count.

**The false `ok`.** Step 1 tightens what the ack means. That is a wire-visible
change to defer semantics and gets its own recon pass before code: the exact
deferral sites and current ack shape, mapped first (Phase-8 style).

## Acceptance

- New smoke: SIGKILL the root — no leave, no handoff — then publish from
  another peer. Delivery within a bounded window or the test fails. Plus
  listener-leak checks on every exit path.
- The full standing gates: kernel suite, axonSpec, churn and interloper
  smokes, soak A/B against 4.61.2.
- **The specimen is the prod gate.** The `axona.bot` topic stays broken on
  purpose. When this ships to prod, the first write must land and the dead
  seat must be gone. A fix that passes every smoke and does not heal the
  specimen does not ship.

## Register

Closes #422 (write path has no liveness gate). Narrows #397 to its remaining
case (competing roots beyond `rootReplicas` reach). Explains the healed-#421
mechanism question in favor of "the roll evicted the dead seat" — the 4.59.x
write fix alone would not have done it.
