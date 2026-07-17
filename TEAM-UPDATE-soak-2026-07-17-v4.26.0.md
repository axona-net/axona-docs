# Soak Update — 2026-07-17 — v4.25.0 / v4.26.0 (testnet)

**TL;DR: Phase 6 (v4.25.0) looks solid. Phase 7 (v4.26.0) shipped last night with all
gates green, but the overnight soak showed progressive network degradation — 100% in
hour one decaying to ~30–50% by morning. UPDATE 12:55Z — the A/B verdict is in and
EXONERATES Phase 7: a fresh all-4.25.0 fleet decayed faster still (33% in its first
hour). The cause is environmental: ~1,000 standing roles concentrated on one region's
relays (from durable test topics planted last night) trigger the known join-storm
failure (#332) — bulk role ingest on relay join starves the event loop and the mesh
never self-heals. #332 is now the active promotion blocker, with a reliable live
reproduction. Prod promotion is ON HOLD; prod remains on 4.22.1 and is unaffected.**

---

## 1. What was tested

**Versions.** Testnet ran two kernels in this window:
- **v4.25.0** (Phase 6 of the v0.2 refactor: retry consolidation, sync ledger,
  doc↔code coherence guards) — daytime soak Jul 16, 12:38–17:04Z.
- **v4.26.0** (Phase 7: explicit role natures ROOT/BACKUP/CHILD + HOLDER, single-site
  backup transitions, promotion-residue leak fix, natures in `inspectRoles`) —
  released Jul 16 evening after full gates (kernel suite 1637/0, coherence smokes,
  Howard's axonSpec 11/11 pre- and post-deploy), deployed to the whole testnet fleet
  (bridge 2.79.0, 9-relay backbone 0.54.0, peer 3.54.0), then soaked overnight
  Jul 17, 02:23–11:30Z (~9h).

**Scenarios** (the standing soak suite, ~30-min cycles): scale, backlog (late-join
recovery), churn (drop 4 / keep 8 / add 4), gap (recovery via `since:'all'`),
discovery (cold publisher), kill (retraction), restart (origin departs + rejoins),
alertbot. Load conditions annotated per cycle; the "trustworthy verdict" counts only
idle-machine runs.

**External evidence in the same window:**
- Howard's **axonSpec**: 11/11 against both 4.25.1-local and live 4.26.0.
- Howard's new **alert-bot** (fresh checkout, kernels 4.25.1 and 4.26.0): publishes
  topics in region 0x80 (grizzly — hosted by the three uswest relays as their
  own keyspace; **correction to an earlier draft that called this region
  relay-less**) — disconnects the
  publisher, then verifies a fresh subscriber receives everything.

**Unusual about the window:** the Jul 16 incident response (nginx ws:// fix,
soak paused ~5h for Howard's debugging), a backbone restart at 21:03Z for the
4.26.0 deploy, and ~400 extra standing topics left by alert-bot runs (48h retention).

## 2. Results

**v4.25.0 daytime (12 cycles, 4h22m):**
overall **83/90 ok (92%)**, idle-only **93%**. Backlog / gap / kill-retraction at
100%, zero killed-body leaks, no role bloat, no mesh flap. The known single-run lows
(one churn 0%, one restart 41.7%) are topology-roll noise.

**v4.26.0 overnight (~19 cycles, 9h): overall 64/112 ok (57%), idle-only 55%.**
Per-scenario ok-rates: backlog 94%, restart 86%, gap 83%, scale 44%, kill 36%,
churn 29%, discovery 25%. Zero killed-body leaks (the tombstone guarantee held).
The decisive signal is the **hourly trend**:

| Hour (Z) | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|
| ok | 16/16 | 9/14 | 5/12 | 8/13 | 5/11 | 5/16 | 6/12 | 5/13 | 4/9 | 2/4 |

By morning the uswest relays had thinned to 2–5 mesh peers (healthy is 9–15) while
holding ~980 roles each. No >2000-role bloat, no beacon storm — this is the
slow-degradation shape at sub-collapse intensity. Phase 7's new observability also
showed the backbone doing enormous backup churn overnight (one relay: ~17,000
role-nature transitions, ~1,500 stale-backup evictions, spread evenly — present from
hour one, so not itself correlated with the decay).

**alert-bot (region without relay infrastructure):** flood test (fresh topic names)
dropped 5,3 of 19 topics on a 4.25.1 client and 1,0,3,1,3 of 19 on 4.26.0 — the
fresh subscriber simply never receives those topics after the publisher departs.
The repeatable test also showed **killed events from previous runs replaying as
live** (5–7 received where 1 was published). Two app-side notes for Howard:
`p2pWebNetwork.js:119` uses `Uint8Array.toBase64` (Node 25+/browser only; crashes
Node 24), and a `TimeoutNaNWarning` fires at startup.

## 3. What we learned

1. **Phase 6 (v4.25.0) is in good shape** — its 4h22m window is the cleanest soak
   segment on the 4.23+ line, and nothing overnight implicates its mechanisms.
2. **v4.26.0 is under suspicion of a progressive-degradation regression.** The decay
   started ~90 minutes in, far faster than anything seen on 4.25.0 under the same
   suite. Phase 7's behavioral surface is small (promotion-residue shedding; the
   stale-backup eviction rerouted through one audited transition), which is exactly
   why an A/B is the right discriminator rather than guessing. Confound to control:
   the backbone carried ~980 roles/relay last night (vs ~600 the day before) from
   accumulated alert-bot topics — the A/B inherits those, so it controls for load.
3. **The no-infrastructure-region durability gap is real and now well-characterized**
   (task #341): where no relay covers a region, topic history survival across the
   publisher's departure is probabilistic (~85–100% per topic), and kill propagation
   to later cold subscribers leaks. civildefense.io targets region 0x80, which
   testnet's relays don't host. This is an architecture question (what durability do
   we promise in unhosted regions?) as much as a bug.
4. **The observability investment is already paying for itself:** the backup-flapping
   volume and the eviction counts above were invisible before Phase 7's structured
   nature logs; today's diagnosis took minutes, not hours of log archaeology.
5. Known non-kernel noise, unchanged: bridge admit-then-kick race under connection
   bursts (30 kicks overnight, all soak clients, zero real users affected — #338),
   and the undersized SF droplet remains the soak's bottleneck under load.

## 4. Actions

- **Prod promotion: ON HOLD.** No part of the 4.23→4.26 line promotes on today's
  evidence. Prod remains on 4.22.1 (unaffected and stable).
- **A/B COMPLETE (12:55Z): Phase 7 exonerated.** A fresh all-4.25.0 fleet under the
  same role load decayed to 33% within its first hour — worse than 4.26.0's overnight
  onset. The degradation is load-triggered and kernel-version-independent. Testnet is
  restored to the 4.26.0 fleet.
- **#332 (join-storm) is now the active blocker** and has a reproduction recipe:
  plant a few hundred durable topics in one region, restart that region's relays,
  and watch the mesh dissolve as they bulk-ingest the role mass. Recommendation:
  pull the #332 hardening (Phase 9 per-nature obligations + invariant I-11, "bulk
  work never starves liveness") forward ahead of Phase 8 — it gates prod promotion
  of the entire 4.2x line.
- **Soak paused** until #332 mitigation lands or the planted test topics expire
  (~Jul 18 evening) — under the current regime the soak measures #332, not the
  kernel line, so further hours add no promotion evidence.
- Queued kernel/bridge work, unchanged priority: #338 (bridge admit-then-kick),
  #339 (transport fail-loud, from Howard's report), #340 (dead-heir handoff delay),
  #341 (unhosted-region durability + kill replay — feeds the Phase 8 sync-engine
  design), #332 (join-storm / mass-departure hardening, Phase 9).
- Howard: axonSpec is green on 4.26.0; alert-bot app-side items above; testnet may
  see one more backbone restart today when the A/B concludes.

---

## Appendix: Q&A — is this a capacity problem?

**Q (David): Would you say we are starving the region with too many topics and
messages across too few nodes?**

**A:** Half yes — but the half that's wrong matters for the fix.

**"Too many topics across too few nodes" — yes, that concentration is real.**
*(Corrected 2026-07-17 pm: an earlier draft said region 0x80 had no relay
coverage. Wrong — the three uswest relays ARE region 0x80/grizzly; hosting
that keyspace is their job.)* Every one of the ~400 alert-bot topics plus the
soak's topics landed on those same three in-region nodes (975–1,140 roles
each, versus ~50–500 elsewhere). The design assumes infrastructure roughly
proportional to demand per region; the alert-bot pattern — publish durably,
then leave — creates demand with no accompanying presence, so nothing beyond
the fixed trio shares the load. Three nodes carry a region's worth of state —
by design, but with no headroom mechanism when demand concentrates.

**"Too many messages / starving" — no, and this is the important correction.**
The data volume is trivial: most of these topics hold 2–10 small messages; a
thousand roles is a few megabytes against a 16MB cache budget. The relays are
not starving for memory, bandwidth, or CPU in steady state — the restored
backbone sat at 8–10 mesh peers *while holding 977 roles*, perfectly healthy.

What actually breaks is not capacity but **unpaced obligations**. A role isn't
just data — it carries standing work: beacon emission, verification, cohort
keepalives, and backup renewals every tick ("infrastructure never backs off,"
by design). That work scales linearly with role *count*, not message volume.
Two mechanisms then turn linear cost into collapse:

1. **The join cliff (the acute killer):** a joining relay receives the region's
   whole role mass at once, and the bulk ingest starves the event loop — so its
   mesh keepalives miss, peers drop it, and it never finishes joining. That's a
   straight I-11 violation ("bulk work never starves liveness"), and it's why a
   *fresh* fleet died faster than a warm one.
2. **Churn amplification:** every root transition among those thousand roles
   triggers handoffs, elections, and backup re-principaling across the same
   three nodes — the ~17,000 nature-transitions-per-night we logged. Under soak
   churn that obligation traffic compounds; without churn it idles fine.

So the accurate statement is: **we concentrated a region's worth of role
obligations onto three nodes, and the obligation machinery doesn't pace itself
when arriving or degrade gracefully under churn.** A node with 1,000 roles
should be slower to converge, not dead.

That framing points at two complementary fixes:

- **#332 (mechanism):** pace the join-time ingest and prioritize mesh liveness
  over role transfer — makes any role count survivable. The near-term blocker
  fix.
- **Load-proportional placement (architecture):** a node shouldn't silently
  accept unbounded rootship. This is exactly what the shelved *Load-Aware Root
  Placement* note proposed — an overloaded closest node defers rootship down
  the K-closest ladder — and today's data is the first live evidence that it
  addresses a real regime, not a hypothetical. Worth revisiting after #332,
  with the sim-first discipline the note already prescribes.

---

*Written 2026-07-17 ~12:00Z; A/B verdict and appendix added ~13:15Z. Evidence:
`axona-stress/results/soak-axon-4250.jsonl`, `soak-axon-4260.jsonl`,
`soak-axon-4250b.jsonl`, `axona-relay/captures/phase7-degradation-20260717/`.*
