# Refactor Phase 0 — Golden Traces & Reliability Ledger (REF-0.2)

**File:** `axona-docs/architecture/Refactor-Phase0-GoldenTraces-v0.1.md`
**Version:** v0.6 — 2026-08-09 (Aster REF-0.2-v0.5 disposition, three docs-only consistency
corrections, no protocol change and no rerun: §4 `smoke_ack_routing.mjs` count 8→16; §6 + §9
stale "148/148" → 149/149; and the v0.4-flake paragraph no longer claims the uncaptured failure
is bounded to #52/#53/#423 or that "no new class appeared across 13 runs" — an uncaptured
failure's class is unknowable, so it is now stated as unclassifiable, unlinked to any issue, with
no failure in the 12 captured follow-ups and a forward capture rule.
v0.5 — 2026-08-09 (Aster REF-0.2-v0.4 baseline-flake clarification: the v0.4
first-run flake is dispositioned honestly in §6 — unattributable due to a `tail -9` capture
error of mine, NOT a runner/kernel gap; 12 further quiesced-m1 runs all 149/149 with no new
failure class; explicitly NOT attributed to #52 or any id that was not measured.
v0.4 — 2026-08-09 (Aster REF-0.2-v0.3 disposition: the one remaining blocker —
the §8 signed-ACK-frame duplicate claim mis-cited `smoke_ack_proof.mjs`, which never re-delivers
a frame — is resolved. Added `smoke_ack_routing.mjs` case 7 (16 assertions), a real duplicate
signed-ACK ingest at the manager seam: settles once, idempotent redelivery, bounded correlation
store. §8 + assertion matrix re-cited; reorder note now states it is NOT complete deterministic
convergence. Re-run clean baseline.
v0.3 — 2026-08-09 (Aster seq-598: dedicated reorder fixture
`smoke_reorder_convergence.mjs` closes the named gap; D1 wrong-destination case added to
`smoke_ack_routing.mjs`; dedup citation corrected to `smoke_pubsub_fundamental.mjs`; flake
issues filed #52/#53; clean baseline re-established at 149/149 + 7/7 with the two new fixtures.
v0.2 — 2026-08-09 (Aster seq-591): real-WebRTC evidence, manifest-accurate terms, exhaustive
assertion matrix, churn relabel, reorder/cancel/teardown mapping, green baseline, D1 isolation
commands)
**Author:** axona.bot (chief programmer)
**Baseline:** kernel v4.62.2 at `fb3ea39`
**Targets:** `code-refactor-plan.md` v3.2 §Phase 0 · builds on REF-0.1 inventory + REF-0.3
ownership map (accepted, Aster seq 586)
**Status:** PHASE 0 REF-0.2 — golden-trace coverage + reliability ledger for council review.
No code changed; no deploy. D1 baseline preserved byte-for-byte.

Phase 0's exit criterion: *every incident in the §2.1 ledger is covered by a falsifiable
fixture; tests include duplicate, reorder, rejection, cancellation, and teardown paths;
browser/WebRTC and bridge evidence recorded alongside simulator evidence.* This document maps
each incident and each explicit Phase-0 deliverable to the golden fixture(s) that would fail
if the rule regressed, records a clean baseline plus non-skipped real-WebRTC evidence, and
pins the reliability ledger with D1 shipped vs D0/D2/I-9 open. It consumes — never rewrites —
the checked-in D1 vectors.

---

## 1. Incident-ledger → golden fixture matrix (§2.1)

| Incident | Rule | Golden fixture(s) |
|---|---|---|
| GH #333 backbone collapse | bounded control-path work | `smoke_join_storm.mjs` |
| leave-order (4.32.0) | explicit effect ordering | `smoke_leave_teardown.mjs`, `smoke_pubsub_leave_handoff.mjs`, `smoke_leave_handoff_burst.mjs` |
| handoff-liveness (4.31) | Principal-Liveness | `smoke_backup_handoff.mjs`, `smoke_handoff_ack_honesty.mjs` |
| split-history cold-attach (4.22.0) | one owner per data-movement | `smoke_split_history_union.mjs`, `smoke_partial_root_union.mjs` |
| TURN expiry #44 (4.60.x) | in-band renewal path | `smoke_turn_cred_refresh.mjs`, `smoke_turn_encode.mjs` |
| write blackhole #28/#422 | routing ≠ ingestion; convict on missing INGEST-ack | `smoke_write_flight.mjs`, `fence_pub_defers_to_corpse.mjs`, `fence_zombie_reachable_root.mjs` |
| ack forgery #439 | evidence binds sender + incarnation | `smoke_ack_proof.mjs`, `smoke_ingest_ack.mjs`, `smoke_root_incarnation.mjs`, `smoke_epoch_adoption.mjs` |
| multi-hop deaf flight #51/#446 D1 | end-to-end signed proof to flight owner | `smoke_ack_routing.mjs`, `smoke_ack_proof.mjs`, `smoke_ack_proof_profile.mjs` |

## 2. Explicit Phase-0 deliverable → fixture + assertion (Aster seq-591 #3)

Every deliverable the plan §Phase 0 names, mapped to a runnable fixture and the assertion it turns on.

| Deliverable | Fixture | Key assertion |
|---|---|---|
| join / integrate | `smoke_join_leave.js`, `smoke_self_integrate.mjs`, `smoke_connect.mjs` | node joins + integrates; star self-integrate |
| root claim | `smoke_root_claim.mjs`, `smoke_root_incarnation.mjs` | single transition authority; incarnation minted per claim |
| split / merge | `smoke_split_history_union.mjs`, `smoke_partial_root_union.mjs` | divergent halves union to one set |
| subscription renewal | `smoke_adaptive_renewal.mjs`, `smoke_upstream_rehome.mjs` | lease renews; upstream rehome on loss |
| handoff | `smoke_backup_handoff.mjs`, `smoke_handoff_ack_honesty.mjs`, `smoke_handoff_scaling.mjs` | acked handoff; heir liveness-gated |
| bridge-only bootstrap | `smoke_connect_mesh_gate.mjs`, `integration/mesh_relay_multihop_e2e.mjs` | two peers connect; bridgeless data path after bootstrap |
| bridge-as-routing-only | `smoke_departure_hint.mjs`, `integration/mesh_relay_e2e.mjs` | bridge forwards signalling, holds no topic state |
| duplicate signed ACK frame (idempotent ingest) | `smoke_ack_routing.mjs` case 7 (16 total) | same proof redelivered → flight settles once, no-op after, correlation store bounded |
| rejected / malformed / forged frames | `smoke_ack_proof.mjs` (26), `smoke_cap_attest.mjs` (21) | malformed/forged/wrong-field rejected (NOT a duplicate test) |
| teardown | `smoke_leave_teardown.mjs`, `smoke_mesh_closed_teardown.js`, `fence_durability_lifecycle.mjs` | zero orphan timers/listeners/channels |
| root + backup abrupt loss | `smoke_backup_handoff.mjs`, `smoke_replica_fast_promote.mjs` | promote on loss |
| two sequential root losses (in/out window) | `smoke_root_reconcile.mjs`, `smoke_root_reconcile_reach.mjs` | reconcile within reach; bounded beyond |
| child-tree rehome + cache replay-up | `smoke_ghost_read.mjs`, `smoke_read_repair.mjs`, `smoke_empty_root_pull.mjs` | reads survive degraded holders; empty root pulls cohort first |
| legacy source/epoch-bound ack accept AND reject | `smoke_ingest_ack.mjs`, `smoke_root_incarnation.mjs` | adjacent-sender+incarnation accept; else reject |
| D1 signed multi-hop ack independent of last hop | `smoke_ack_routing.mjs` (16) | completion on proof, not `meta.fromId` |
| D1 wrong signer/purpose/op/attempt/nonce/width/epoch reject | `smoke_ack_proof.mjs` (26 assertions), `smoke_ack_proof_profile.mjs` (9) | each rejection dimension asserted |
| D1 wrong-DESTINATION reject (valid proof, different same-width ackTo) | `smoke_ack_routing.mjs` (case 6) | flight-owner binding: a validly-signed proof addressed elsewhere leaves the flight open |
| signed vs unsigned ACK compatibility dispatch | `smoke_ack_routing.mjs` (signed) + `smoke_ingest_ack.mjs` (legacy) | both variants complete correctly |
| CAP_ATTEST golden/wrong-key/wrong-channel/reconnect-replay/clear-on-loss/fail-closed/old-peer | `smoke_cap_attest.mjs` (21), `smoke_cap_attest_mesh.mjs` (11) | each CAP_ATTEST dimension asserted |
| full-snapshot vs keepalive durability | `smoke_snapshot.js`, `smoke_pubsub_durability.mjs`, `smoke_pubsub_host_durability.mjs` | snapshot restore == live; durability evidence |
| duplicate / reordered stamped ingest | `smoke_reorder_convergence.mjs` (14), `smoke_split_history_union.mjs` (divergent-half merge) | same stamped set, four arrival orders → identical held set / hw / seq / tombstone; §8 |
| bridge-as-routing-only behaviour | `integration/mesh_signal_split.mjs` | mesh vs bridge signalling split |

**Leaderless-readiness seam assertions (Orion's four):** these are forward design assertions
about the future seams (upstream diversity, eventId↔msgId dedup separation,
COUNT_HIGHWATER_HINT ≤1-upstream, D1↔LegacyAuthorityRef). Phase 0 tests assert *current
singleton-root behavior* (plan §Phase 0); the seam assertions live in REF-0.1/REF-0.3 as
ownership/inventory assertions and become runnable fixtures in Phase 2/3, not Kernel-4 golden
fixtures. Recorded here as design-tracked, not claimed as executed Phase-0 tests.

## 3. Readiness-amendment coverage

| Scenario | Fixture(s) |
|---|---|
| root/backup abrupt loss + fast promote | `smoke_backup_handoff.mjs`, `smoke_replica_fast_promote.mjs` |
| sequential root losses / reconcile reach | `smoke_root_reconcile.mjs`, `smoke_root_reconcile_reach.mjs` |
| child rehome + degraded-holder reads | `smoke_ghost_read.mjs`, `smoke_read_repair.mjs`, `smoke_reachable_root.mjs` |
| empty-root serves after cohort pull | `smoke_empty_root_pull.mjs` |
| restart handoff / cold-attach | `smoke_restart_handoff.mjs`, `smoke_cold_burst.mjs` |
| churn (manifest-gated) | `smoke_churn_amplification.mjs` |

## 4. D1 protected baseline — consumed, not rewritten (Aster #7: exact isolated runs)

The checked-in D1 vectors are consumed as-is. Isolated runs at `fb3ea39` on the dedicated soak
Mac, 2026-08-09 (`node test/<name>`):

- `smoke_ack_proof.mjs` — **PASS, 26 assertions** (197-byte transcript; wrong-width topic/ack, epoch overflow at 2^53, non-integer epoch, wrong signer/purpose/op/attempt/dest/nonce rejections)
- `smoke_ack_proof_profile.mjs` — **PASS, 9** (real `idHex` hashBits 64 even + 66 odd; shrunk-width id rejected)
- `smoke_cap_attest.mjs` — **PASS, 21** (wrong-key/channel/capId/cbv/domain, replay, old-peer)
- `smoke_cap_attest_mesh.mjs` — **PASS, 11** (CAP_ATTEST loopback)
- `smoke_ack_routing.mjs` — **PASS, 16** (multi-hop signed completion independent of `meta.fromId`;
  wrong signer/nonce/attempt negatives; case 6 same-width wrong-destination reject; case 7 duplicate
  signed-ACK idempotent ingest)

No REF-0.2 fixture regenerates or reinterprets a D1 transcript. `ackProof.js`/`capAttest.js`
remain the single owners.

## 5. Real-WebRTC / bridge evidence (Aster #1/#2 — non-skipped)

Integration class run on the quiesced dedicated soak Mac (m1), `fb3ea39`,
`node test/run.mjs --class integration`, 2026-08-09: **7/7 PASS, 0 skipped** —
`graduation_probe`, `mesh_multipeer`, `mesh_relay_auto_e2e`, `mesh_relay_e2e`,
`mesh_relay_multihop_e2e`, `mesh_relay_webrtc`, `mesh_signal_split`. `node-datachannel`
native binding present and exercised (real ICE/DataChannel, not FakeMesh/FakeWS). No skip is
presented as WebRTC evidence. Live-prod WebRTC/bridge is additionally evidenced by the 4.62.2
go-live write→read acceptance through the real prod mesh (both prod bridges + backbone).

An earlier loaded-host run had shown 5/7 with `mesh_relay_webrtc`'s bridgeless-relay
assertions failing at `MeshManager.send`; on the quiesced host all 7 pass, confirming those
were host-saturation artifacts, not kernel faults on `fb3ea39`.

## 6. Suite evidence — controlled green baseline (Aster #6)

To remove host-load confounds, the full suite was run on the **dedicated soak Mac (m1),
quiesced** (its 12 relays stopped for the run, since restored 12/12), `fb3ea39`:

- **Default class: `node test/run.mjs` → 149/149 PASS, 0 failed.**
- **Integration class: `--class integration` → 7/7 PASS, 0 failed.**

The 149 default includes `smoke_reorder_convergence.mjs` and `smoke_ack_routing.mjs` grown to
16 assertions (v0.4 added case 7, the duplicate signed-ACK ingest). The file count is unchanged
at 149 — v0.4 grows assertions within an existing fixture, not the fixture roster. Re-run clean
on the quiesced dedicated soak Mac at `fb3ea39`; the local M4 dev machine returned the same
149/149 the same day.

**v0.4 first-run flake — honest disposition (Aster REF-0.2-v0.4 clarification).** The v0.4
delivery reported "one first-run load flake, non-reproducing on re-run." That specific failing
fixture is **unattributable**, and the reason is a capture error of mine, not a runner or kernel
gap: `test/run.mjs` already names every failure (inline `✗ <file>` plus a `failures` section),
but the first v0.4 baseline command piped through `tail -9`, discarding both and keeping only the
summary; the runner persists no results artifact, so the instance cannot be recovered. The honest
bounds on that one event, and nothing more:

- **the original run is unclassifiable** — its failure output was truncated, so its fixture,
  assertion, and class are unknown and cannot be recovered;
- **no failure appeared in the twelve captured follow-up runs** on the quiesced m1 (10 catcher
  + 1 archived full-output + 1 — all 149/149, zero `✗`, no `failures` section);
- **the original event is not linked to any existing issue** — it is neither attributed to
  #52 / #53 / #423 nor to a new class, because an uncaptured failure's class cannot be bounded
  either way;
- **the forward full-output capture rule** (baseline runs now retain the complete runner output,
  which already names every failure) prevents this evidence loss from recurring.

This is a disclosed measurement limitation, not a new acceptance blocker; the duplicate signed-ACK
correction and the twelve clean captured runs stand on their own evidence.

This is the clean baseline. Two non-deterministic **test-harness** flakes were observed on
non-clean runs and are characterized, not waved through:

- `smoke_pubsub_beacon` — load-timing; failed once under saturated-host load, **8/8 isolated ×3**.
- `smoke_empty_root_pull` — random setup precondition ("drew R strictly closer than H",
  rejection-sampling class like #413); failed once in a loaded full run, **5/5 isolated**.

Neither reproduced in the clean 149/149 run; both are harness non-determinism on the unchanged
prod-shipped kernel, tracked in §7. The baseline is green with no governance waiver required.

## 7. Reliability ledger (shipped vs open — never closed by association)

| Item | State | Evidence / tracking |
|---|---|---|
| D1 multi-hop INGEST-ACK routing (#51/#446) | **SHIPPED** 4.62.2, live on prod | §1/§2/§4; prod write→read verified |
| 4.62.1 source/incarnation binding (#439) | **SHIPPED** | `smoke_root_incarnation`, `smoke_ack_proof` |
| D0 delegated flight ownership + I-9 correlator | **OPEN** | #449 |
| D2 attempt-id chain budget + named terminal | **OPEN** | #451 |
| smoke_transport_web_reconnect flake | **KNOWN load flake** | #423 |
| dht-sim buildAxonTree flake | **KNOWN, dht-sim** | #402 |
| smoke_pubsub_beacon load-timing flake | **FILED** | #52; 8/8 isolated ×3 |
| smoke_empty_root_pull random-precondition flake | **FILED** | #53; 5/5 isolated; rejection-sampling class (#413) |

## 8. Duplicate / reorder / cancellation / teardown (Aster #5)

- **Duplicate:** msgId body dedup is asserted directly in `smoke_pubsub_fundamental.mjs`
  (lines 134–136 "exactly-once: nobody got duplicates"; line 181 "no duplicates after renewal")
  and again in `smoke_reorder_convergence.mjs` (re-ingest of the full set is a no-op). Signed
  ACK-frame duplicate handling is covered by `smoke_ack_routing.mjs` case 7 (v0.4): the SAME
  valid signed proof delivered repeatedly settles the flight EXACTLY once, every redelivery is
  an idempotent no-op, and `_writeFlights` (the only correlation store) resurrects no flight and
  does not grow. (`smoke_ack_proof.mjs` is deliberately NOT cited for duplicate coverage — it
  re-signs the same transcript to prove signature determinism but never re-DELIVERS a frame, so
  it asserts nothing about duplicate ingest; correcting that mis-citation was the v0.3→v0.4
  blocker, Aster REF-0.2-v0.3 disposition. Broad `smoke_pubsub_*` globs are also not cited —
  they name fixtures that may be retired.)
- **Rejection:** `smoke_ack_proof.mjs` (26) + `smoke_cap_attest.mjs` (21) rejection vectors.
- **Reorder:** `smoke_reorder_convergence.mjs` (14 assertions) — the same signed, already-stamped
  event set ingested in four arrival orders (in-order, reversed, kill-before-target, shuffled)
  converges on the held msgId set, high-water cursor, dense seq, tombstone set, and survivor
  delivery; a kill suppresses its target whether it arrives before or after the body. The fixture
  also **characterizes** two arrival-ordered facts it hands the refactor as TopicStore seam
  requirements: low-water (`cache[0].publishTs`) is not convergent because the cache is stored
  in arrival order, and the killed body's app-delivery timeline (delivered-then-retracted vs
  suppressed) depends on arrival order while durable state still converges. `smoke_split_history_union.mjs`
  / `smoke_partial_root_union.mjs` cover the divergent-half out-of-order merge end-to-end. The
  deterministic permuted-arrival fixture Aster named is now present, not deferred. **This is NOT
  a proof of complete deterministic convergence:** durable state (held set / hw / seq /
  tombstone / survivor set) converges, but low-water and the subscriber-visible deletion history
  remain arrival-ordered (above), and Phase 1 must treat stamp-ordering of `TopicStore` as an
  expected behavior change rather than requiring blind differential parity at that seam.
- **Cancellation:** `smoke_reroute_termination.mjs`, `fence_pull_outcome.mjs`.
- **Teardown:** `smoke_leave_teardown.mjs`, `smoke_mesh_closed_teardown.js`, `fence_durability_lifecycle.mjs`.

**Experiment scripts (Aster #4):** `churn_sustained.mjs` and `churn_refill.mjs` are NOT in
`test/manifest.json` and are not gated golden fixtures — they are experiment harnesses. The
manifest-backed churn golden fixture is `smoke_churn_amplification.mjs`. The experiment
scripts are labelled as such and not cited as gate evidence.

## 9. Exit-criteria status (plan §Phase 0)

| Criterion | Status |
|---|---|
| Every §2.1 incident → falsifiable fixture | **DONE** (§1) |
| Every explicit Phase-0 deliverable → fixture + assertion | **DONE** (§2) |
| Duplicate/reorder/rejection/cancellation/teardown | **DONE** — dedicated reorder fixture `smoke_reorder_convergence.mjs` (§8) |
| Browser/WebRTC + bridge evidence, non-skipped | **DONE** (§5, 7/7 real WebRTC + prod acceptance) |
| Checked-in D1 vectors consumed, not rewritten | **DONE** (§4) |
| Static ownership map, one owner each | **DONE** (REF-0.3 v0.4, accepted) |
| Reliability ledger separates D1/D0/D2/I-9 + flakes | **DONE** (§7) |
| Controlled green baseline | **DONE** (§6, 149/149 + 7/7 on soak Mac) |
| Assumption inventory complete | **DONE** (REF-0.1 v0.2) |

With REF-0.1 (accepted-folded), REF-0.3 (accepted), and REF-0.2 (this doc, green baseline +
non-skipped WebRTC), the Phase-0 characterization deliverables are complete pending council
acceptance of REF-0.2 and David's Phase-0 close / Phase-1 authorization. The reorder gap named
in v0.2 is closed by `smoke_reorder_convergence.mjs` (§8); the two harness flakes are filed
(#52, #53, §7). No kernel behavior changed; no deploy — the two new fixtures are
characterization-only (they drive shipped code paths and assert current behavior).

---

*REF-0.2 v0.6. Clean 149/149 default + 7/7 real-WebRTC integration on the quiesced dedicated
soak Mac at `fb3ea39`; the v0.4 first-run flake dispositioned honestly (§6) as unclassifiable
(output truncated), unlinked to any issue, with no failure in the 12 captured follow-ups and a
forward full-output capture rule — NOT bounded to or attributed to any unmeasured issue set; the
three v0.5 stale-count / over-claim consistency corrections applied per Aster's disposition (same 149/149 on the M4 dev machine); D1 vectors consumed byte-for-byte
with exact isolated runs recorded; exhaustive deliverable→assertion matrix; churn scripts
relabelled experiments; the reorder gap closed by `smoke_reorder_convergence.mjs` (with two
TopicStore seam findings characterized, and stated explicitly NOT to be complete deterministic
convergence); the v0.3 signed-ACK-duplicate mis-citation corrected by a real duplicate-ingest
case (`smoke_ack_routing.mjs` case 7, Aster REF-0.2-v0.3 disposition); msgId dedup cited to
`smoke_pubsub_fundamental.mjs`; flakes filed #52/#53; D0/D2/I-9 kept open. Phase 0 remains
characterization-only — the fixtures drive shipped code and assert current behavior; no kernel
change, no deploy.*
