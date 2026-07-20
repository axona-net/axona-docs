# Team Update — Join-storm fixed; kernel v4.27.1 promoted to PRODUCTION — 2026-07-17

**Headline:** the **join-storm collapse (#332)** — the failure that had blocked
promotion and was silently degrading production — is **fixed, live-validated,
and now deployed to prod.** After a full day that ran the arc from *regression
scare* → *root cause* → *fix* → *live validation* → *promotion*, production and
testnet are both on **kernel 4.27.1** for the first time since early July.
Prod: **bridges 2.81.0 (east + west) · 9-relay backbone 0.55.1 · kernel 4.27.1.**

---

## What happened today, in order

This was one continuous investigation. The short version of the arc:

1. **Morning: a promotion scare.** The overnight soak of v4.26.0 (Phase 7) decayed
   from 100% to ~40%. An A/B against v4.25.0 **exonerated Phase 7** — a fresh
   all-4.25.0 fleet decayed *faster* — proving the cause was environmental, not a
   regression. The cause was the **join-storm (#332)**: ~1,000 standing roles
   concentrated on one region's relays (from durable test topics) cause a
   (re)joining relay to bulk-ingest the whole role mass at once, starving its
   event loop until its mesh dissolves and never self-heals. We now had a reliable
   live reproduction of a bug that had been theoretical for weeks.

2. **We also found prod was already in the failure regime.** Checking the prod
   relay backbone (which had been running unattended) showed 8 of 9 relays
   mesh-dissolved — the same failure, run to completion where nobody was watching.
   A rolling restart healed it, but that bought days, not a fix: 4.22.1 predates
   every join-storm mitigation.

3. **Afternoon: the fix (v4.27.0), three legs** (architecture doc §XI, all
   normative, enforced by the constants coherence guard):
   - **Sender pacing** — a root does at most 32 full-state replications per repair
     tick with a round-robin cursor, so a joining relay is *seeded over a couple of
     minutes* instead of firehosed in one tick.
   - **Receiver protection** — REPLICATE/REPLAYUP ingest drains through a bounded,
     time-sliced queue (hybrid inline fast-path for light traffic), so signature
     verification CPU can never monopolise the event loop; overflow drops-and-logs
     and anti-entropy re-heals. Invariant I-11: *bulk work never starves liveness.*
   - **Mesh re-warm** — a relay whose mesh dissolves re-runs self-integration.

4. **The live gate caught a fourth issue → v4.27.1.** On the first validation soak,
   the re-warm leg fired **59 times uselessly** — a dissolved mesh has an *empty*
   routing table, so self-lookup finds nobody to dial. v4.27.1 adds a bridge
   peer-list re-request (`requestPeerIntroductions`; bridge 2.81.0 answers), so a
   starved node re-bootstraps from the bridge exactly as it did at join. One
   live-soak iteration found and fixed a bug no unit test would have caught.

5. **Evening: validation, then promotion.** 3.5-hour soak on 4.27.1 against the
   *exact* reproduction conditions; verdict below; then the full prod ritual.

## Validation results

**Idle-machine verdict (the trustworthy kernel signal): 96%** (27/28) over 3.5
hours, and **the backbone never dissolved once** — every relay stayed fully bound,
zero ingest-overflow, zero mesh-rewarm firings (the pacing kept the mesh healthy
enough the safety net was never needed).

| Kernel | idle-machine verdict at ~2–3.5h | backbone |
|---|---|---|
| 4.25.0 (A/B) | 33% (hour 1) | dissolved |
| 4.26.0 (overnight) | 55% | dissolved (peers → 1–2) |
| 4.27.0 (rewarm broken) | ~67% | dissolved despite 59 rewarm attempts |
| **4.27.1** | **96%** | **never dissolved** |

Overall (non-idle) delivery was 80%, but 15 of 16 failures happened while the
shared soak laptop was saturated under its own load — the documented "the soak
measures the machine, not the kernel" artifact. 96% idle is the number that means
something. Gates: kernel suite 1662/0, Howard's axonSpec 11/11,
`smoke_join_storm` (16 checks, measured event-loop liveness under a 450-verify
storm).

## Production promotion

Promoted 4.22.1 → 4.27.1 across the whole prod stack, verified at each step:

| Component | Now | Verified |
|---|---|---|
| East bridge (`bridge.axona.net`) | 2.81.0 / kernel 4.27.1 | public healthz |
| West bridge (`bridge-west.axona.net`) | 2.81.0 / kernel 4.27.1 | public healthz |
| 9-relay backbone (sfo3 / nyc3 / tor1) | 0.55.1 / kernel 4.27.1 | all 9 mesh-healthy, peers 7–11 |
| East↔west federation | — | both bridges' 2.81.0 adverts arrive on the warm `bridge-directory` topic |

The rollout was zero-downtime: bridges deployed sequentially (east verified before
west, so the pair was never both down), relays rolled one droplet at a time (each
region kept 2/3 up throughout). Existing **4.22.1 clients were admitted normally
the entire time** — the wire is compatible, so no user was locked out. The
`axona.net` peer app and demo rebuild from `main` via GitHub Pages and are
propagating the new client bundle to end users now (cache-busted).

## What this closes, and what's next

- **#332 (join-storm) — CLOSED** on every tier. Production no longer re-decays.
- **The whole 4.23 → 4.27 line is now on prod** in one move: Phase 6 (retry
  consolidation + sync ledger + coherence guards), Phase 7 (explicit role
  natures), and the join-storm hardening.
- **Queued, non-blocking follow-ups** (testnet-first, next cycle): #338 (bridge
  admit-then-kick race), #339 (fail-loud transport errors), #340 (dead-heir
  handoff delay), #341 (unhosted-region durability), and the two TURN items
  surfaced today — #343 (node-datachannel mangles the TURN REST username, so the
  relay fleet can't use TURN relay) and #344 (add a TCP TURN fallback for
  UDP-restricted networks).
- **On deck:** Phase 8 (the sync engine — six repair policies collapse into one
  typed policy table), then the eligibility-aware root-placement design (Howard's
  background-tab "don't count on me" idea unified with load-based deferral).

*2026-07-17. Kernel tags v4.27.0 / v4.27.1. Full soak analysis:
`TEAM-UPDATE-soak-2026-07-17-v4.26.0.md` (Part 2). Fix: `test/smoke_join_storm.mjs`;
architecture doc §XI join-storm constants.*
