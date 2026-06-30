# Team Update — Axona kernel **v4.10.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** live on **testnet** — `testnet.axona.net` (bridge v2.51.0),
`demo-testnet.axona.net`, the testnet relay backbone (relay v0.35.0), and the
browser peer (v0.69.0). **Production is untouched and still on 3.x.**
Wire-compatible point release (WIRE 4.0, no flag day).

> Supersedes **v4.9.1** (bridge-never-root + root-time ordering). It started as a
> targeted durability feature — **give a singleton root warm backup roots so its
> history survives churn** — and then a reframing widened it into a general
> distribution fix: **"a kill is just a publish with a side effect — if kills get
> lost, so do publishes."** The backup roots turned out to be exactly the set every
> message (and retraction) must reach, so the two ideas became one mechanism.

---

## TL;DR

1. **The bug was never about kills.** A message issued just after churn reached only
   the single closest root. A late subscriber that homed on a *different* co-hosting
   node missed it. With a kill you *see* the failure (a deleted message reappears);
   with a plain publish it's lost **silently**. We proved it: a post-churn publish
   was lost at the same rate as a post-churn kill.
2. **Foundation: a root now recruits warm backup roots.** A singleton root no longer
   has "no backup" — it replicates its full cache (and retractions) to its
   `rootReplicas` (default **2**) nearest reachable nodes. Those backups hold
   everything, so when the root churns away a backup **instantly takes over with no
   gap** instead of the history being lost. The backups track the closest-K: when a
   newcomer lands closer to the topic than a current backup, it's recruited and the
   farther one retires. *This is the mechanism that lifted no-kill restart-recovery
   from 7/8 to 16/16.*
3. **Generalisation: eager K-closest cohort distribution.** Those backup roots are
   the same nodes a subscriber can attach to — the topic's *true* closest-K
   (`findKClosest`), not just the root's direct neighbours. So we push **every**
   stamped delta (publish or kill) to the whole cohort the instant it's stamped, and
   cohort members union-merge what they receive (anti-entropy). Result: they converge
   on the same history **and** the same retractions, so it no longer matters which
   cohort member a subscriber homes on.
4. **Ordering is unchanged.** Only the root stamps (root-time, v4.9.1); the cohort
   *adopts* the stamp and never re-stamps, so convergence can't reorder a topic.
5. **Kills stay consistent across the cohort + migration.** Catch-up, hand-off, and
   backup replication now carry retractions next to the messages (applied first), so
   a killed message can't resurface when history moves to a new holder.
6. **No more spurious deletes.** A full-history joiner that never received a message
   (posted *and* killed before it joined) gets no `{deleted}` event for content it
   never held — nothing to retract.

## Results

- **Howard CivilDefense suite: 16/16 warm** (was 7/12 before this work).
- **Restart-under-churn harness:** 16/16 no-kill recovery, **10/10 with-kill, zero
  leaks** (was ~67% with intermittent leaks).
- Full kernel smoke suite green; new smokes `smoke_root_replication`,
  `smoke_kill_migration`; `smoke_pubsub_kill` reframed to the
  retraction-vs-never-saw semantics.

## What changed for builders

- **New constructor option:** `new AxonaPeer({ rootReplicas })` — how many warm
  backup roots a root recruits (the cohort fan-out beyond itself), default **2** per
  your spec. Higher = more redundancy + traffic; `0` disables backup roots / cohort
  replication entirely. Most apps need nothing; the default is on.
- **Kill delivery is now scoped.** If your app relied on receiving a `{deleted}`
  callback for a message it never received, that no longer fires (it never should
  have). Apps retract what they're displaying; there's nothing to retract for an
  unseen message.
- **No API or wire breakage.** Same `pub`/`sub`/`kill` surface, same WIRE 4.0.

## Still open (tracked, not in this release)

- **Cold-start convergence latency.** On a freshly-spun mesh a subscriber can strand
  on a greedy-routing local minimum and only re-home on the next ~5 s heal tick — the
  residual in Howard's cold runs (they pass once warm). This is a *routing-convergence*
  problem, separate from distribution, and is the next thread.

---

*Deployed 2026-06-30. Verify the live build at `testnet.axona.net/healthz`
(`kernelVersion: 4.10.0`) and each app's version row.*
