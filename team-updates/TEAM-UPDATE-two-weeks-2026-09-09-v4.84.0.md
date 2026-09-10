# Two weeks — 2026-08-26 to 2026-09-09

Kernel on prod at the time of writing: **4.84.0**, fleet-wide across 51 relays,
both bridges, both apps.

What did two weeks of work actually change? Below is every item, with a plain
description of what it was and what it did. Three groups do most of the work:
delivery bugs found and closed, the system made readable from outside, and one
long measurement arc that started with a Chrome trace and ended with five of my
own figures withdrawn.

CAVEAT: this is a list of what was DONE. It is not a claim that the open
problems are small. The Windows wedge and the probe-volume question are both
still open and both are listed at the bottom.

---

## 1. Delivery and correctness in the kernel

Nine defects, each of which lost or delayed real messages:

- **4.68.2 — duplicate-pending headroom.** Two concurrent identical requests
  consumed each other's slot. Cleared unanimously by council review.

- **4.73.0 — subscriber-list replication.** Warm backups did not carry the
  subscriber list. A root migration therefore orphaned every subscriber until
  they re-subscribed. The backups now carry the list, and the window collapses.

- **4.74.0 / 4.74.1 — metrics-lease handoff.** `METRICSON` died on every root
  transition. The lease now replicates to warm backups and carries its remaining
  duration on the wire, with an explicit clear-on-omit.

- **4.75.0 — region is a hint, not a wall.** Region was an eligibility
  predicate, so a sparse region had nowhere to roll and stranded. Region is now
  a placement hint only.

- **4.75.2 — per-Role durability.** Topic state is partitioned by topicId.
  One topic's obligations can no longer rot another's.

- **4.76.0 / 4.76.1 — cold-subscribe read loss.** A fresh `since:'all'`
  subscribe was landing 25-40% of history, measured against an established
  subscriber on the same topic. Fixed by warm-hint-first, emit-then-steer, and a
  bounded retry. The retry lifecycle was then hardened to the bounds council set
  on the first cut.

- **4.78.0 — the destination stops asking who is closer than zero.** At the
  destination, distance to target is zero, so no peer can be closer. The node
  fanned out anyway and blocked up to five seconds on one silent peer. Measured
  1.0ms direct against 536ms routed to the same peer, and 5001ms in the worst
  case — a factor of 531.

- **4.79.0 — every browser `sub()` threw.** `ReferenceError: process is not
  defined`, on every browser subscribe, on Safari first. Four bare `process`
  reads in `AxonaManager.js` were the cause. Introduced `src/utils/env.js` as
  the single browser-safe accessor, plus a fence that scans browser-reachable
  source for bare `process` and fails on a new one.

- **bridge — the routed-message forwarder dropped everything.** `route_msg`
  compared a hex string to a bigint in `targetId`, so no routed message ever
  matched.

## 2. Making the system readable from outside

Five changes, each of which turned something previously inferred from `ps` and
guesswork into a value you can read:

- **4.76.2 — replicate-failure names its cohort.** `replicate-all-failed` says
  which nodes it failed to reach, and its verdict.

- **4.76.3 — every eviction names its cause.** Eviction reason was previously
  unobservable, which made peer-shedding impossible to attribute.

- **4.77.0 + relay SIGUSR1 health dump.** Three values the kernel held privately
  are now dumpable from a live relay without restarting it.

- **relay 0.121.0 — capacity in the dump.** `helloPressure`, `servicePressure`,
  rolling tick lag, tick stalls and the worst outstanding obligation. Before
  this a starved relay read as healthy: the kernel had been MEASURING pressure
  since 4.47.0 and the dump discarded the measurement. The logic moved out of
  the SIGUSR1 handler into `src/healthdump.js` so it could be tested at all —
  its first cut read `h.roles` and `r.topicId` when the contract is `h.axonRoles`
  and `r.topic`, and shipped emitting `roles:0 seated:[]` unconditionally.
  Twenty-six checks now pin it, including the one that matters most: zero
  pressure is a VALUE, not an absence.

- **relay 0.117.x / 0.118.0 — log discipline.** Fixed the dump that always
  printed `0`, and capped log context by shape rather than by event name.

## 3. The lookahead measurement arc

David captured a Chrome trace on a live axona.chat tab and asked where the
system spends its time. Five kernel releases came out of it.

- **4.80.0 — count inbound mesh frames by kind.** Counted at `dc.onmessage`, the
  single point every inbound frame passes. Result: `lookahead_probe` is **83%**
  of all mesh frames, measured over a 571-second window on one live tab.

- **4.81.0 — does the fan-out earn that traffic?** The receive side cannot
  answer it, so the count moved to the emit side. Over the same kind of window:
  **67.3 probes per call** (the entire synaptome), the fan-out answers **88%**
  of routing calls, and **2.7%** of replies name a node closer than the caller.
  It needs one informative reply and sends sixty-seven.

- **4.82.0 — is top-K viable?** Top-K by XOR distance only works if the
  informative replies concentrate in the nearest targets. Nobody had checked.
  Binned closer-replies by XOR rank. They do not concentrate: rank 0 returns
  nothing on any node measured, and the useful ranks differ per node. Top-K by
  distance is refuted. The fence pins the property easiest to break by accident
  — ranking must NOT change who gets probed.

- **4.83.0 / 4.84.0 — the corrections.** Council falsified five of the figures
  above in two rounds. Every one failed the same way: the counter measured
  something other than the sentence written beside it, and the sentence is what
  got reported.

  - `answeredByIncoming === 0` was read as "no cheaper path is being ignored".
    The counter only incremented when the probes found NOTHING, so the zero
    only ever meant "probes always found something".
  - Rank 0's zero was read as structure. Greedy filters connected, dead and
    bridge peers; the probe set is the raw synaptome and filters none of them.
    A rank whose probes were all REJECTED is indistinguishable, under
    closer-over-sent, from one whose replies were all non-closer.
  - "K=8 discards 44-100% of informative replies" counted lost REPLIES. Routing
    needs one closer reply per CALL, and a call may receive several, so
    discarding the surplus costs nothing.
  - The fix for the first item mixed UNITS: one counter incremented per
    qualifying synapse while its partner counted calls, so the first could
    exceed the call count and dividing them was invalid.
  - `rateOfAnswerable` conditioned terminal replies out of its denominator. A
    terminal reply is a live peer reporting no escape — evidence about that
    target, not a missing measurement — so excluding it inflated the rate.

  All five are pinned by two new fences, 21 checks and 15 checks. The inflating
  field was deleted rather than renamed: a more flattering ratio sitting beside
  honest ones gets quoted.

## 4. Fleet and release tooling

Seven scripts, all in version control, replacing hand-rolled command lines:

- **Fleet Cadence Standard v1** — one shared two-tier ready gate and one
  graceful shutdown across all six start and roll scripts, in place of six
  divergent cadences.
- **`ops/fleet.sh`** — the whole fleet, one command.
- **`ops/release.sh`** — the kernel release, ordered and gated. Apps now REFUSE
  to ship above the bridge. That silent mismatch is what broke Safari on 09-08.
- **`ops/apps.sh`** — every app surface enumerated, so one stops being missed
  each release.
- **`relay-census.sh`** — one definition of "how many relays are running".
- **`add-relays.sh`** — the grow path for a live fleet, which did not exist.
- **`windows-roll.sh` / `windows-fleet.sh` / `win-*-logged.sh`** — a sanctioned
  Windows roll and cold start, with readable output and an end check immune to
  PID reuse.
- **`fleet.sh` IP truncation.** Status truncated addresses into a 13-wide
  column, and a truncated IPv4 is a DIFFERENT VALID HOST. I reported a droplet
  down that was never down, and my controls used the correct addresses, so they
  isolated nothing. The column is 16 wide and the truncation is gone.

## 5. Infrastructure operations

- **Seven fleet-wide kernel rolls**, 4.75.x through 4.84.0, across 51 relays on
  five hosts and three operating systems, plus both bridges and both apps.
- **Droplets thinned from 6 relays to 4.** Six relays on one core was starving
  the backbone: load 15-19, node CPU 91-96% of that core. One relay shed peers
  74 to 19 in 25 minutes on `pc-closed` evictions — 49 in half an hour against
  1-6 for its siblings on the same box — and was the only node in the fleet
  emitting `replicate-all-failed`. After thinning, event-loop lag fell by
  between 20x and 250x depending on the host, and four saturated relays went to
  zero.
- **TURN advertisement corrected.** The bridge default offered a `turns:`
  endpoint on 5349 that nothing serves. Both prod bridges override the default
  in `.env`, so no prod client was affected — the defect was in what a fresh
  deployment would advertise. Added a TCP-connect probe at startup that logs
  each URL reachable or unreachable.
- **East TURN secret rotated** after a failed redaction wrote it into the
  transcript. Verified both directions: the old credential now refuses with 401,
  the new one grants. West was verified absent from the transcript by hash
  comparison across 7,822 tokens and deliberately left alone.
- **Windows fleet torn down and rebuilt twice**, ending at 20 of 20 on 4.84.0,
  cold start on the first attempt, every relay carrying its own `state=open`
  banner.
- **node-datachannel 0.32.3 to 0.33.1** rolled fleet-wide.

## 6. Apps

- **axona-chat 0.57.0 — the update applies itself.** A stale build cannot mesh,
  so a client that ignored the update prompt was stranded on an old kernel. The
  service worker now applies its own update: it defers while you are typing,
  applies on hide, and the dismiss control is gone.
- **axona-chat 0.53.0** — a short desktop window was being treated as mobile.
- **axona-chat and axona-share** kept pinned in step with the bridge through
  nine kernel bumps each, including two deliberate REVERTS when an app had been
  pinned above what the prod bridge served.

## 7. Measurement harness and soak

- **Pub/sub workload harness v0.3**, built in six units: seeded workload plan,
  three-truths ledger, sidecar peer, an eight-detector analyzer, and a self-test
  that injects every failure class and reproduces it, 17 of 17.
- **Level-isolation Part A and Part B** — a closed-fleet node-identity allowlist
  at the auth-bound sites, and a transition ledger that reconstructs a message's
  path from one-way tx/rx records. Both gated, both inert when off.
- **Windows spawn survival.** Relays launched over ssh died with the session.
  Solved with a one-shot scheduled task, after `Start-Process` detachment from
  the ssh job object failed.
- **Soak harness hardening.** The overnight soak died at 23:28 and sat dead for
  10 hours 20 minutes. Its cap was an in-process timer, and a wedged event loop
  cannot fire one. Replaced with an external `timeout -k`, with a JSONL row
  recording the external kill so a wedge can never again look like a clean
  finish. Also: five absolute paths made sibling-relative, and quarter buckets
  cut by equal TIME rather than equal count.

## 8. Diagnosed, not yet fixed

- **The Windows wedge (GH #61).** Root-caused to a native deadlock in
  node-datachannel: `futex_wait_queue_me` on the main thread and on every
  RTC, SCTP and juice thread, with 3 seconds of CPU consumed in 10 hours. It is
  cross-platform and it is not host load — a relay wedged as slot 1 of 20 on a
  host verified to be running zero other relays, which refutes the "it tracks
  host load" reading I gave earlier.
- **Probe volume (GH #62).** The 83% figure is filed. The five withdrawn claims
  are withdrawn on the issue. The replacement numbers from 4.84.0 have not been
  collected or posted yet.

---

## Open, owed, and unrun

- Corrected lookahead figures from 4.84.0, for GH #62.
- A council reply on the 4.84.0 unit fix.
- The wedge-rate comparison: cold-start axona-win several times each on 4.84.0,
  4.82.0 and 4.79.0 and compare. 4.82.0 and 4.83.0 both added work to the
  routing hot path, so a regression is possible. The test is written and has not
  been run.
- `lastServiced` per role in the health dump — a kernel obligation from council
  Q4, not implemented.
- Council Q1 (structural versus learned narrowing) and Q2 (rank 0) are open,
  with two seats holding on Q1 replacements.
- GH #60, delivery harm, open.
