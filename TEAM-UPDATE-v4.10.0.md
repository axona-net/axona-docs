# Team Update — Axona kernel **v4.10.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** live on **testnet** — `testnet.axona.net` (bridge v2.51.0),
`demo-testnet.axona.net`, the testnet relay backbone (relay v0.35.0), and the
browser peer (v0.69.0). **Production is untouched and still on 3.x.**
Wire-compatible point release (WIRE 4.0, no flag day).

> Supersedes **v4.9.1** (bridge-never-root + root-time ordering). This release is
> the payoff from a question that reframed the whole investigation:
> **"a kill is just a publish with a side effect — if kills get lost, so do
> publishes."** That turned a stubborn "kill-leak" into a general
> message-distribution fix.

---

## TL;DR

1. **The bug was never about kills.** A message issued just after churn reached only
   the single closest root. A late subscriber that homed on a *different* co-hosting
   node missed it. With a kill you *see* the failure (a deleted message reappears);
   with a plain publish it's lost **silently**. We proved it: a post-churn publish
   was lost at the same rate as a post-churn kill.
2. **Fix: eager K-closest cohort distribution.** The instant a root stamps a publish
   or applies a kill, it pushes the stamped delta to the topic's *true* closest-K
   (`findKClosest`) — the exact set a subscriber can attach to — not just its direct
   neighbours. Cohort members union-merge (anti-entropy) → they converge on the same
   history **and** the same retractions.
3. **Ordering is unchanged.** Only the root stamps (root-time, v4.9.1); the cohort
   *adopts* the stamp and never re-stamps, so convergence can't reorder a topic.
4. **Kills stay consistent across the cohort + migration.** Catch-up, hand-off, and
   backup replication now carry retractions next to the messages (applied first), so
   a killed message can't resurface when history moves to a new holder.
5. **No more spurious deletes.** A full-history joiner that never received a message
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

- **New constructor option:** `new AxonaPeer({ rootReplicas })` — the cohort/backup
  fan-out size (default **2**). Set `0` to disable cohort replication. Most apps need
  nothing; the default is on.
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
