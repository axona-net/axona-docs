# Refactor Phase 0 — Golden Traces & Reliability Ledger (REF-0.2)

**File:** `axona-docs/architecture/Refactor-Phase0-GoldenTraces-v0.1.md`
**Version:** v0.1 — 2026-08-09
**Author:** axona.bot (chief programmer)
**Baseline:** kernel v4.62.2 at `fb3ea39`
**Targets:** `code-refactor-plan.md` v3.2 §Phase 0 · builds on REF-0.1 inventory + REF-0.3
ownership map (accepted, Aster seq 586)
**Status:** PHASE 0 REF-0.2 — golden-trace coverage + reliability ledger for council review.
No code changed; no deploy. D1 baseline preserved byte-for-byte.

Phase 0's exit criterion: *every incident in the §2.1 ledger is covered by a falsifiable
fixture; tests include duplicate, reorder, rejection, cancellation, and teardown paths.* This
document maps each incident to the golden fixture(s) that would fail if the rule it taught
were lost, records the readiness-amendment coverage, and pins the reliability ledger with D1
shipped vs D0/D2/I-9 kept open. The fixtures already exist in `axona-protocol/test`; REF-0.2
proves the mapping is complete and the suite is green, and consumes — never rewrites — the
checked-in D1 vectors.

---

## 1. Incident-ledger → golden fixture matrix (§2.1)

Each row: the incident, the structural rule it taught, and the fixture(s) that fail if the
rule regresses.

| Incident | Rule | Golden fixture(s) |
|---|---|---|
| GH #333 backbone collapse | work on a control path is bounded, always | `smoke_join_storm.mjs` |
| leave-order (4.32.0) | ordering of effects is load-bearing + explicit | `smoke_leave_teardown.mjs`, `smoke_pubsub_leave_handoff.mjs`, `smoke_leave_handoff_burst.mjs` |
| handoff-liveness (4.31) | Principal-Liveness (§4.6) | `smoke_backup_handoff.mjs`, `smoke_handoff_ack_honesty.mjs` |
| split-history cold-attach (4.22.0) | one owner per data-movement decision | `smoke_split_history_union.mjs`, `smoke_partial_root_union.mjs` |
| TURN expiry #44 (4.60.x) | every lifecycle has an in-band renewal path | `smoke_turn_cred_refresh.mjs`, `smoke_turn_encode.mjs` |
| write blackhole #28/#422 (4.62.x) | routing evidence ≠ ingestion evidence; convict on missing INGEST-ack | `smoke_write_flight.mjs`, `fence_pub_defers_to_corpse.mjs`, `fence_zombie_reachable_root.mjs` |
| ack forgery #439 (4.62.1) | completion evidence binds sender AND authority incarnation | `smoke_ack_proof.mjs`, `smoke_ingest_ack.mjs`, `smoke_root_incarnation.mjs`, `smoke_epoch_adoption.mjs` |
| multi-hop deaf flight #51/#446 D1 (4.62.2) | evidence-return routing is part of the evidence contract; end-to-end signed proof to the flight owner | `smoke_ack_routing.mjs`, `smoke_ack_proof.mjs`, `smoke_ack_proof_profile.mjs` |

Every §2.1 incident has at least one falsifiable fixture. The #28/#422 and #51/#446
**protected regression families** are covered by the write-flight + ack-proof + incarnation
set above.

## 2. Readiness-amendment coverage

The v3 readiness amendments (root/backup abrupt loss; sequential root losses in/out the
repair window; child-tree rehome and cache replay-up; restart; duplicate/reorder ingest):

| Scenario | Golden fixture(s) |
|---|---|
| Root/backup abrupt loss + fast promote | `smoke_backup_handoff.mjs`, `smoke_replica_fast_promote.mjs` |
| Sequential root losses / reconciliation reach | `smoke_root_reconcile.mjs`, `smoke_root_reconcile_reach.mjs` |
| Child-tree rehome + degraded-holder reads | `smoke_ghost_read.mjs`, `smoke_read_repair.mjs`, `smoke_reachable_root.mjs` |
| Empty-root serves after cohort pull | `smoke_empty_root_pull.mjs` |
| Restart handoff / cold-attach | `smoke_restart_handoff.mjs`, `smoke_cold_burst.mjs` |
| Churn amplification / sustained churn / refill | `smoke_churn_amplification.mjs`, `churn_sustained.mjs`, `churn_refill.mjs` |
| Duplicate / reorder / rejection paths | in-fixture assertions across `smoke_ack_proof.mjs` (26), `smoke_cap_attest.mjs` (21), `smoke_pubsub_*` |

## 3. D1 protected baseline — consumed, not rewritten

The D1 golden and rejection vectors are **checked-in artifacts** that REF-0.2 consumes as-is:
`smoke_ack_proof.mjs` (fixed 197-byte transcript, wrong-width topic/ack, epoch overflow/
non-integer rejection vectors), `smoke_ack_proof_profile.mjs` (real `idHex` under hashBits 64
even + 66 odd; shrunk-width id rejected), `smoke_cap_attest.mjs` + `smoke_cap_attest_mesh.mjs`
(CAP_ATTEST loopback, wrong-key/wrong-channel/reconnect-replay/clear-on-loss/old-peer-ignore).
No REF-0.2 fixture regenerates or reinterprets a D1 transcript; the bytes are protocol data
(Aster: preserve byte-for-byte). `smoke_ack_routing.mjs` exercises the multi-hop signed
completion independent of `meta.fromId`.

## 4. Reliability ledger (shipped vs open — never closed by association)

| Item | State | Evidence / tracking |
|---|---|---|
| D1 multi-hop INGEST-ACK routing (#51/#446) | **SHIPPED** 4.62.2, live on prod | §1 + §3 fixtures; prod write→read verified |
| 4.62.1 source/incarnation binding (#439) | **SHIPPED** | `smoke_root_incarnation`, `smoke_ack_proof` |
| D0 delegated flight ownership + I-9 correlator | **OPEN** | #449; no refactor code touches it |
| D2 attempt-id chain budget + named terminal | **OPEN** | #451; no refactor code touches it |
| smoke_transport_web_reconnect flake (~1/3 under parallel load) | **KNOWN, not a regression** | #423; serial run is deterministic |
| dht-sim buildAxonTree full-mesh flake (~30%) | **KNOWN, dht-sim harness** | #402; not the kernel |
| smoke_pubsub_beacon flake under saturated-host load | **NEW, load-timing** | 8/8 isolated ×3; observed once in a loaded full run; file an issue akin to #423 |

D1 is shipped; D0, D2, and I-9 remain distinct open governed exceptions and are **not** marked
closed by REF-0.2 acceptance.

## 5. Suite evidence

Full serial run (`node test/run.mjs`, jobs=1) at `fb3ea39`, 2026-08-09, under heavy
concurrent machine load (the 38-node M4+M1 testnet fleets, the four council peers, and the
MCP peer all live on this laptop): **147/148 passed, 1 failed** — `smoke_pubsub_beacon.mjs`
(5/8 of its assertions; the beacon-propagation/promotion-timing subset).

**Characterized, not waved through** (read-the-measurement discipline): `smoke_pubsub_beacon`
re-run in **isolation 3×** = **8/8 each time**. `fb3ea39` is unchanged — Phase 0 touches no
kernel code — and this is the exact kernel that passed its release gate clean and runs on
prod. The failure is therefore a load-timing artifact of a beacon-propagation-sensitive test
under a saturated host, in the same class as the known parallel-load flakes
`smoke_transport_web_reconnect` (#423) and dht-sim `buildAxonTree` (#402) — **not a regression
and not a Phase-0 finding.** `smoke_pubsub_beacon` is added to the load-sensitive-flake watch
list (§4). All D1 golden/rejection/profile vectors and every §1 protected-family fixture
passed in both the full run and isolation.

## 6. Exit-criteria status (plan §Phase 0)

| Criterion | Status |
|---|---|
| Every §2.1 incident → falsifiable fixture | **DONE** (§1) |
| Duplicate/reorder/rejection/cancellation/teardown paths covered | **DONE** (§1, §2, in-fixture) |
| Browser/WebRTC + bridge evidence alongside sim | PARTIAL — sim + node golden; live WebRTC via `smoke_transport_web_*`, prod acceptance recorded separately |
| Checked-in D1 vectors consumed, not rewritten | **DONE** (§3) |
| Static ownership map, every field/timer/frame/proof → one owner | **DONE** (REF-0.3 v0.4, accepted) |
| Reliability ledger separates D1 / D0 / D2 / I-9 + flakes | **DONE** (§4) |
| Assumption inventory complete | **DONE** (REF-0.1 v0.2) |

With REF-0.1 (accepted-folded), REF-0.3 (accepted), and REF-0.2 (this doc), the Phase 0
characterization deliverables are complete pending council acceptance of REF-0.2 and David's
Phase-0 close / Phase-1 authorization. No kernel behavior changed; no deploy.

---

*REF-0.2 v0.1. Golden-trace coverage maps every §2.1 incident + readiness amendment to an
existing falsifiable fixture; D1 vectors consumed byte-for-byte; reliability ledger keeps D0/
D2/I-9 open. Serial suite 147/148 under saturated-host load; the sole failure
(`smoke_pubsub_beacon`) proven a load-timing flake by 3× isolated 8/8 on the unchanged
`fb3ea39` kernel. Phase 0 remains characterization-only.*
