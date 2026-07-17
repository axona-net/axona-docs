# Soak Update — 2026-07-17 — v4.25.0 / v4.26.0 (testnet)

**TL;DR: Phase 6 (v4.25.0) looks solid. Phase 7 (v4.26.0) shipped last night with all
gates green, but the overnight soak shows progressive network degradation — 100% in
hour one decaying to ~30–50% by morning. An A/B against v4.25.0 is running now to
determine whether Phase 7 caused it. Prod promotion is ON HOLD; prod remains on
4.22.1 and is unaffected.**

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
  topics in region 0x80 — a region with **no relay coverage** — disconnects the
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
- **A/B running now** (started 11:52Z): identical soak against the same backbone
  rolled back to the v4.25.0 vendor, same accumulated-topic load. If 4.25.0 decays
  too → the cause is environmental (role accumulation / #332 dynamics), and Phase 7
  is exonerated. If 4.25.0 holds ≥90% → Phase 7 is the regression; we bisect its two
  behavioral changes and fix or revert before it goes anywhere near prod. Verdict
  expected ~15:00Z; testnet stays fully usable meanwhile.
- **If Phase 7 is exonerated**, the promotion candidate becomes "4.25.x now or 4.26.x
  after a clean overnight" — user's call with the A/B data in hand.
- Queued kernel/bridge work, unchanged priority: #338 (bridge admit-then-kick),
  #339 (transport fail-loud, from Howard's report), #340 (dead-heir handoff delay),
  #341 (unhosted-region durability + kill replay — feeds the Phase 8 sync-engine
  design), #332 (join-storm / mass-departure hardening, Phase 9).
- Howard: axonSpec is green on 4.26.0; alert-bot app-side items above; testnet may
  see one more backbone restart today when the A/B concludes.

*Written 2026-07-17 ~12:00Z. Evidence: `axona-stress/results/soak-axon-4250.jsonl`,
`soak-axon-4260.jsonl`, `axona-relay/captures/phase7-degradation-20260717/`.*
