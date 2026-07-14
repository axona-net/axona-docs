# The Soak-Test Framework — Overview & Gap Analysis

**Kernel:** 4.21.0 (testnet) · **Harnesses:** `axona-stress/soak-axon.mjs`,
`axona-stress/soak-v3.mjs` (+ analyzers, loop scripts) · **Date:** 2026-07-13

This document describes what the live soak framework tests, how it tests it,
where it sits in the wider verification stack — and then analyzes the
scenario inventory against the invariants and the last month's incident
record to identify what testing we should add. The gap analysis is the point;
the overview exists so the gaps are legible.

---

## 1. Philosophy

The soaks are **observe-only characterization of the real system**: real
kernel, real WebRTC, real bridge, live fleet — no SUT code is touched, no
simulation shortcuts. Where the unit suite asks *"does this mechanism do X,"*
a soak asks *"what fraction of the time does the live network deliver, and
what does the distribution look like."* Three hard-won methodology rules
govern interpretation:

1. **Verify via the soak, never via one-shot fresh clients.** A seconds-old
   client can't yet receive routed DELIVERs (newcomer reachability), so a
   fresh-client probe reads as a false 0.
2. **Single runs are noise.** Delivery under churn is bimodal
   (0-or-100 per topic); verdicts require REPS≥5 mean±sd, and A/B runs
   against a baseline arm.
3. **Know what the harness is actually measuring.** The live soak is bounded
   by its infrastructure (the undersized droplet's RAM once manufactured
   "kernel" failures); kernel verdicts under load come from the *quiesced*
   axonSpec gate, while the soak measures the system under its own load.

One deliberate property doubles as a canary: **the soak imports the LOCAL
kernel working tree** (via the relay vendor), so every soak run also
exercises the exact code about to ship, not just the deployed fleet.

## 2. Where soaks sit in the verification stack

| Layer | What | When |
|---|---|---|
| Unit/mechanics smokes | 87-suite kernel gate (`npm test`), incident-derived; INVARIANTS.md maps each invariant to its test | every release |
| Simulation | dht-sim vendored kernel, shrunk 64-bit keyspace, 25K-node scale + churn (REPS≥5) | mechanism validation before deploy |
| **Live soaks (this doc)** | scenario cycles against `wss://testnet.axona.net` (or prod) | acceptance after deploys; overnight campaigns; A/B |
| External gates | Howard's `axonSpec.js` (11 specs, jasmine, quiesced network); the civildefense alert-bot in the field | root-election-sensitive releases |
| Organic | PoW collectors (prod + testnet): long-lived peers collecting continuously for weeks | always-on, but observability-weak (can wedge silently) |

## 3. `soak-axon` — the architecture soak

Characterizes the axonic-tree pub/sub itself: delivery *rate* across many
subscribers, tree response to churn, gap/backlog recovery, total order.
One JSONL line per scenario cycle; `soak-axon-analyze.mjs` renders the
report (cold-topic min-0 cycles discounted per the variance methodology).

**Mechanics:** each cycle spins real peers via the relay's `connectPeer`
(WebRTC through the bridge), settles (`SETTLE` 12s), publishes (`PUBS` 6 ×
`PUB_GAP` 700ms), measures initial delivery, then re-measures after a
renewal window (`RENEW_WAIT` 70s) — the healed number is the headline,
because renewal-driven self-heal is the design. `HARD_CAP_SEC` bounds every
cycle; a failed scenario re-runs once for reproducibility. Knobs: `SUBS`
(12), `CHURN_FRAC` (0.4), `ONLY` (scenario csv), `SOAK_BRIDGE`, `REGION`.

**The eight scenarios:**

| Scenario | Exercises | Invariant/mechanism |
|---|---|---|
| `scale` | SUBS subscribers × PUBS publishes; initial + healed delivery %, min/max per message | fan-out, renewal self-heal; **the standard deploy-acceptance check** |
| `order` | every delivered stream monotonic in root timestamp | the single serialization point |
| `backlog` | late `since:'all'` joiner recovers full pre-join history | replay/cache durability |
| `churn` | drop 40% of subscribers mid-stream, add fresh ones; post-churn publish reaches survivors + newcomers | tree self-heal, I-7 |
| `gap` | subscriber disconnects mid-stream; fresh `since:'all'` peer recovers the gap messages | no permanent loss |
| `discovery` | brand-new COLD publisher reaches settled subscribers | cold-publish burst + root beacons |
| `kill` | authored retraction reaches live subs; late joiner sees survivors only | tombstones, I-8 |
| `restart` | the ORIGIN departs mid-stream and rejoins; full timeline recoverable | singleton-root replication + backup promotion |

## 4. `soak-v3` — the identity/authorship/security soak

Binary correctness of the v0.3 identity model against the live fleet,
rotated by `soak-v3.sh` (nohup + caffeinate; launchd is TCC-blocked).
Eleven scenarios: `open`, `owner`, `multi` (multi-author), `anon`,
`ownerdefault`, `writepol` (non-owner publish to owner-only **must be
rejected**), `republish` (exactly-once across re-publish), `kill`, `pull`,
`flood` (bounded-queue quota), `writedefault`. The analyzer's
**SECURITY-CRITICAL** section keys on anomalies that must stay at zero:
`LEAK-transport-signed` (the node key must never sign content),
`unexpected-signer`, `republish-double-delivered`.

## 5. Current operational status (honest)

- **No continuous soak is running.** The nightly loop stopped with the local
  testnet fleet (~July 6). Since then the framework is used **on demand**:
  the `scale` scenario as the acceptance gate after every deploy (all green
  through 4.19.x→4.21.0), plus A/B campaigns when a verdict is needed.
- The organic layer (PoW collectors) runs continuously but has weak
  self-observability — the wedge class is known.
- axonSpec runs per root-election-sensitive release, on a quiet network.

## 6. Gap analysis

Method: map the scenario inventory against (a) the nine invariants, (b) the
July incident record, and (c) who actually *found* each recent bug. The
uncomfortable pattern: **of the five July incidents, four were found by
Howard's field bot or by prod, not by the soak** — leave()/CPU (4.19.4),
burst-departure loss (4.19.5), reconnect-death (4.19.3), prod root-flap
(4.19.0). The soak found none of them because each lived in a dimension the
scenarios don't span. Those dimensions, ranked:

### G1 — Departure is under-tested (found 4.19.4/4.19.5 the hard way) · HIGH
`restart` is the only departure scenario, and it's a single-topic
depart-and-rejoin. Nothing soaks **graceful leave of a burst publisher**
(many fresh topics, leave holding roots — the alert-bot shape) or measures
the cold-attach residual on host-rooted topics over time. The `burst-live.mjs`
repro from the 4.19.5 investigation is ~80% of a `leave` scenario already.
*Add: `leave` — N-topic burst → `leave()` → fresh `since:'all'` joiner;
report per-topic recovery % and track the cold-attach residual as a
first-class trend line.*

### G2 — No continuous canary + alerting (this IS punch-list R-0) · HIGH
Everything is batch: if delivery degrades on Tuesday night, we learn on
Wednesday — or when Howard reports. And nothing watches the watchers (the
collector wedged silently for days once). *Add: a standing low-rate
canary pair (publish/verify every few minutes against both networks),
absence-alerted — plus the split-brain observer from the review round-2
disposition: two distinct `by` publishers on a metric topic inside a
window = a live split signal, zero kernel change.*

### G3 — The tree's delegation path never runs live · HIGH, cheap
`SUBS=12` < `MAX_DIRECT=20`: **no live scenario has ever forced a relay to
delegate** (ADOPT, child relays, widen-before-deepen). The entire Phase-2
tree machinery is exercised only by unit/sim. One knob turn: *run `scale`
with `SUBS≥40` as a `scale-deep` scenario; assert delivery AND that
delegation actually occurred (children>0 via `inspectRoles` on a host).*

### G4 — Resource trajectory is invisible (found 4.19.4 the hard way) · MED
No cycle records CPU/RSS/FD/handle counts, so a 100%-CPU spin or a slow leak
is invisible until a human notices. *Add: per-cycle `process.cpuUsage()`/
`memoryUsage()` + active-handle count to every JSONL line (harness side),
and relay RSS via healthz scrape (fleet side); analyzer flags trends.*

### G5 — Cross-region runs nowhere (shipped 4.17.1 without coverage) · MED
Every soak runs `REGION=useast` single-region; the cross-region self-root
split-brain shipped and was found live. Prod now has a 3-region backbone.
*Add: `xregion` — publisher useast, subscribers uswest/tor; healed delivery
must match same-region.*

### G6 — Re-home latency has no live measurement (4.20.1 class) · MED
We now promise next-tick re-home on neighbour-upstream death and ≤renewal
on non-neighbour death — enforced by unit tests, never measured live.
*Add: `rehome` — kill a subscriber's serving relay mid-stream; record
time-to-next-delivery distribution.*

### G7 — Long-lived peer stability · MED
Cycles live minutes; Howard's bots live days. Multi-hour dynamics (renewal
at full backoff, timer accumulation, node-datachannel behavior, no-exit
regressions) have no coverage between "10-minute cycle" and "Howard
notices." *Add: a weekly `marathon` run — one peer pair up 12–24h with
hourly publish/verify + G4's resource sampling.*

### G8 — Version skew is de-facto, never deliberate · LOW
The bridge routinely lags kernel patches (2.72.0/4.20.0 vs clients on
4.21.0 right now); it works, but only accidentally tested. *Formalize: on
point releases, one acceptance run explicitly against the lagging bridge is
already what happens — record the skew pair in the JSONL so it's data.*

### G9 — Live adversarial probes · LOW (unit-covered)
soak-v3 covers authorization outcomes, but D-1 caps, malformed frames, and
lying beacons (verify-don't-trust) are unit-only. A small testnet-only
`abuse` scenario would close the loop; low priority while the punch list's
bigger items stand.

### G10 — Metrics plane not in rotation · LOW, cheap
METRICSON/derived metric topics are verified by one-off scripts
(`metrics-verify.mjs`), not soaked — and G2's split-brain observer needs
exactly this plumbing. *Fold a `metrics` scenario into the rotation:
subscribe `metricTopic(T)`, assert snapshots arrive with sane seq/count.*

## 7. Recommendation

Priority order, with the reasoning that G2 and G1 directly attack the two
standing punch-list reliability items (R-0, cold-attach/R-3):

1. **G2 canary + alerting** — the framework's biggest structural weakness is
   that it only answers questions we remember to ask.
2. **G1 `leave` scenario** — the incident class most likely to recur as
   Phase 3 touches AxonaPeer lifecycle, and it operationalizes the
   cold-attach trend line.
3. **G3 `scale-deep`** — one env knob; uncovers a whole untested subsystem.
4. **G4 resource sampling** — cheap columns in existing JSONL; makes G7
   meaningful.
5. Then G5/G6/G7 as scenario work, G8/G9/G10 opportunistically.

Items 3 and 4 are small enough to fold into the next harness touch; 1 and 2
are real (small) projects and should be scheduled against the punch list.

---

## Addendum — external review of this analysis (2026-07-13)

The external reviewer endorsed the gap list and the priority order (G2 canary
first, G1 `leave` second, then instrumentation) — the plan stands ratified.
Dispositions on its additions:

**Adopted:**
- **Bridge/fleet version fields in every JSONL line** (its concretization of
  G8): the harness will scrape `/healthz` (`version` + `kernelVersion` — note:
  there is no `/api/version`) at cycle start and record the skew pair, making
  de-facto skew testing data instead of accident.
- **Instrument last-DELIVER-per-subscription now** — the reviewer's best
  original idea: recording the inter-DELIVER distribution per subscription in
  the soak JSONL is observation-only and builds the baseline evidence the
  Phase 2 ack-per-renewal (lease) design will be judged against. This turns
  a future design debate into a data comparison.
- **A `run-soak.sh --suite=` wrapper** so campaign invocations stop being
  bespoke command lines.

**Right-sized (the reviewer assumed an org we don't have):**
- Its owner/ETA table (observability team, platform ops, security team;
  2–8 week ETAs) maps to a project that is one workbench plus one field
  tester. The real costs are: `scale-deep` — minutes (one knob); resource
  sampling + version fields — hours; the canary — about a day; the `leave`
  scenario — a day (the `burst-live.mjs` repro is most of it). The priority
  ORDER is unchanged; the calendar is compressed roughly 10×.
- **PagerDuty → what we actually operate:** alert = push notification +
  a loud line in the analyzer; there is no on-call rotation to page.
- **S3 + time-series dashboard → declined for now:** local JSONL plus
  trend-flagging in the analyzers is proportionate; centralized storage is
  worth revisiting when someone other than this workbench consumes results.
- `process._getActiveHandles()` is internal API; the sampler will use
  `process.getActiveResourcesInfo()`.

**Corrections for the record:**
- The multi-region-only incident was the **4.17.1 cross-region self-root**;
  the 4.19.0 root-flap was between SAME-region prod relays (G5's motivation
  is 4.17.1, not 4.19.0).
- "4 of 5 July incidents involve a burst publisher leaving" overstates:
  the accurate claim is 4 of 5 were found by the field/prod rather than by
  the soak; only two were departure-side (4.19.4, 4.19.5).
- `LEAK-transport-signed` is soak-v3's signing-leak sentinel; an `abuse`
  scenario (malformed frames, D-1 caps, forged beacons) would assert
  rejection/verify-don't-trust outcomes — different metrics.

---

## Addendum 2 — G1 closed: the `alertbot` scenario (2026-07-13)

Howard shared the alert-bot repository (the field bot whose runs produced the
4.19.4/4.19.5 reports). Reading it reframed G1: rather than inventing a
departure workload, we ported his — the shape with the proven bug-finding
record. `soak-axon`'s new **`alertbot`** scenario reproduces it against our
own stack (no portal dependency): one cold publisher posts user profiles
including ~12KB avatar payloads (closing the payload-size gap his avatars
exposed — call it G11), then ALERTS×CELLS s2-style cell-topic fan-out plus a
reply topic per alert (~93 fresh topics, ~101 publishes), then `leave()`s;
a fresh `since:'all'` reader subscribes to every topic and tallies
per-topic recovery. `recoveredPct` is the cold-attach residual trend line;
`ok` gates at ALERTBOT_OK_PCT (80) so the known ~10–20% band doesn't false-
alarm while a systematic regression flags. `leaveMs` rides along as the
departure-latency metric.

First measurement (kernel 4.21.0, testnet): 93 topics / 101 pubs,
leave handed off in **5.1s**, recovery **89 full / 0 partial / 4 zero**
(96% of messages) — the all-or-nothing per-topic pattern confirming the
cold-attach class signature, now measured per cycle in the overnight
rotation (HARD_CAP raised to 1800s for the longer cycle).

Tier 2 (running the bot verbatim through Howard's civildefense portal +
kdht stack as an occasional full-stack integration gate) remains open,
pending those two repos.
