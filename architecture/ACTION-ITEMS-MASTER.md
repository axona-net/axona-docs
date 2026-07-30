# Axona — Master Action List v1.3

**Assembled:** 2026-07-30 · **For:** the council (David, axona.bot, Orion, Aster)
**Live versions at assembly:** kernel **4.49.0** on testnet AND production;
bridge **2.103.0**; relay **0.96.0** (testnet).
**Status:** draft for council commentary.

**The filename carries no version — deliberately.** This document revised three times in
its first afternoon, and a versioned filename means every citation of it breaks on each
bump. The version lives in the heading above and the history below; the path
`architecture/ACTION-ITEMS-MASTER.md` is stable and safe to link. (It was born as
`…-v1.0.md`, which was renamed the same day once the revision rate became obvious. Same
reasoning as `programmer-guide/errata.md`, which is also a living queue and also unversioned
in its filename. Contrast the architecture scorecard, which versions in its filename because
it changes rarely and each version is a citable artifact.)

### Revision history

| Version | Change |
|---|---|
| **v1.0** | Initial assembly from four registers. Commit `842220a`. |
| **v1.1** | Folded in the first review finding — **no application-path fence** (§3). Raised independently by Aster (council seq 15) and Orion (seq 7). A *missing category*, not a wrong row. Commit `53a7c7f`. |
| **v1.2** | **Withdrew the M21-S scheduling question** (§8.1) — the design is unspecified, not pending approval (David, 2026-07-30). Replaced with five open design questions. Commits `d5084ea`, `d83e249`, `62219fc`. |
| **v1.3** | Filename de-versioned; revision history added. This entry. |

---

## How to read this

**No new ID namespace.** Every item keeps the identifier it already has in its home
register — `#nnn` (task register), `D0`/`M21-S` (scorecard §6), `E-n` (programmer-guide
errata), `R-n`/`G-n`/`A-2` (red-team punchlist), `S1`–`S6`/`B1`–`B13`
(`architecture/INVARIANTS.md`). Adding a master-list ID on top would create exactly the
mapping problem this document exists to remove, and there is already one instance of that
hazard open (`#416`, two INVARIANTS files with disjoint numbering).

**Evidence column.** `measured` = a number was produced under stated conditions.
`observed` = seen live, not quantified. `asserted` = believed, not yet verified.
This distinction is load-bearing: the council's review rule says a finding is verified
before it becomes work, and roughly a third of this list is `asserted`.

**The scorecard remains the spine.** §1 below is the refactor; everything else is
scheduled *around* it, not instead of it.

---

## 1. The refactor spine — `Axona-Architecture-Health-Scorecard-v2.0.md` §6

The plan is sequential by design; the gate ordering is the argument, not the labels.

| Phase | State | Blocks | Evidence |
|---|---|---|---|
| **C** — test-gate integrity | ✅ **DONE** 2026-07-29 | — | measured: 121/121 default, 152 declared = 152 on disk, guard exit 0 |
| **D0** — honest measurement (M4) | **NEXT**, recon done | D1, M21-S deploy, M21-L | measured (see below) |
| **D1** — gate the pushed paths (ADOPT / REPLICATE / read-repair) | not started | E | measured: `admitPushedRole` has exactly one caller, `syncEngine.js:175` |
| **M19** — redirect / decline-path plumbing | not started | M21-S deploy | observed: ~2,500 declines per bridge, continuous |
| **M21-S** — structural bridge delegation | **DESIGN UNSPECIFIED** — five open questions, §8.1. Not "awaiting approval"; there is not yet a design to approve. Deploy also blocked on D0. | M21-L | — |
| **M21-L** — load-triggered delegation | strictly after D0/M4 | — | — |
| **E** — contract & structure (state codec, boundary close, `refreshTick` decomposition, `AxonaPeer` carve, export narrowing) | last | — | — |

### D0 recon result — the fix is larger than the plan assumed

Measured 2026-07-30 (`axona-protocol/test/d0_probe.mjs`, commit `89c0798`). Three
independent failures of one instrument:

1. **Dominated.** `servicePressure` needs a 108 s tick gap to reach `SATURATION_PRESSURE`;
   `helloPressure` reaches it at 8 s. **13.5× earlier**, so `servicePressure` can never be
   the deciding signal.
2. **False negative under the exact cause its own docstring names.** 640 roles / 40 ticks:
   every role stamped fresh on all 40, worst un-refreshed full push **95,000 ms** against
   its own 60,000 ms deadline — `servicePressure` **0**, `overdue` **0**, `saturated()`
   false, and `admitPushedRole()` still true. Starvation band is **N ∈ 385…767** roles
   (past 384 the `REPLICATE_FULL_BUDGET=32` rotation cannot meet the deadline; the
   telemetry-dead backstop `maxRoles*8 = 768` stays silent throughout). `MAX_ROLES` is 96.
3. **Coverage hole.** `inspectCapacity()` walks `axonRoles` only; `mySubscriptions` is a
   separate map, so the node's own app subscriptions are **unmeasurable**, not mismeasured.

All three trace to `repairPlane.js:61` stamping every role at the top of the tick.
**Consequence for the plan:** D0 is not "move a timestamp". It needs a typed
per-nature obligation table (`what` / `completion point` / `deadline`), the stamp written
at each completion point, per-obligation deadlines rather than one `DROP_MS` denominator,
and app subscriptions brought into the walk. Fence per Codex/Aster: manufacture
starvation, prove pressure rises, prove admission changes, prove recovery.

### Scorecard §5 — open findings

| § | Item | State |
|---|---|---|
| 5.1 | test runner cannot prove a full suite ran | ✅ RESOLVED (Phase C) |
| 5.2 | measurement dishonesty — one working pressure signal | **open → D0**; now quantified above |
| 5.3 | boundary leaks (shared crypto/serialisation misfiled in `pubsub/`; `exports` map opens every sub-path, ~65 tests import internals) | **open → E** |
| 5.4 | `AxonaPeer.js` 4,372 LOC + `refreshTick` orchestration; root *triggering* diffused across ~a dozen guards | **open → E** |
| 5.5 | rules declared but unfenced — S4 (closed shapes), S6 (one clock), B1 region-lock default, B12 bridge ends with empty `axonRoles` | **open** |
| 5.6 | ~10% cold-topic loss, unattributed (`#406`) | **open**, needs the A/B in **§8 decision 4** |

---

## 2. Kernel correctness — open defects

| ID | Item | Evidence |
|---|---|---|
| `#406` | Cold-topic delivery loses ~10% at **nominal** latency. 110/123 over a 10.5 h, 40-node soak; 4 of 10 incomplete probes at 2671–2765 ms, so any latency-based explanation is wrong. **Unattributed, not exonerated** — no A/B against a prior kernel exists. | measured |
| `#412` | Interloper-death history loss. Real, **1 in 139**, cause unknown. Leading hypothesis (partial root never reconciles) **refuted** by purpose-built harness — it converges on renewal tick 1. Untested idea recorded: renewal-gated budget. | measured |
| `#397` | Root reconciliation reach is `rootReplicas` (2) — any second root beyond that distance is **permanent**. Design limit, not a bug, but it bounds what convergence can promise. | asserted |
| `#341` | Region 0x80/grizzly: fresh-subscriber replay drops ~1–3 of 19 topics; killed events replay as live. Howard reports the matching symptom on `#axona.dev` **today** and has given a topic-closest node id; his kernel version is the discriminator and is not yet known. | observed |
| `#339` | `transport.start()` must fail loud — terminal rejection + surfaced dispatch errors (I-3/I-6). | asserted |
| `#338` | Bridge hello-timeout second-strike + closing-socket guard (admit-then-kick race). | observed |
| `#344` | TURN has no TCP/TLS fallback (`turns:5349` / `turn:443?transport=tcp`); UDP-only relay fails on restricted networks. | observed |
| `#400` | Soak 4.43.0 cycle-3 convergence cluster — idle-band, not load. | measured |

---

## 3. Test & measurement integrity

| ID | Item | Evidence |
|---|---|---|
| `#414` | **Recruitment has no fence.** Retiring two recruitment tests in Phase C removed the only guard, and that mechanism drifted silently once before. Debt Phase C created. | measured |
| `#418` | `axona_subscribe` reads 0 while the standing watch on the same peer holds traffic — twice, including a message published seconds earlier. Nearly produced a false "topic is dead" report today. | measured |
| `#402` | dht-sim `smoke_transport_axona_pubsub` full-mesh `buildAxonTree` ~30% flaky — global convergence, not the kernel. | measured |
| `#297` | W1c — read the live testnet mesh-vs-bridge signalling split (instrumentation and harness already shipped). | — |
| §5.5 | Fence S4, S6, B1, B12 — a rule that is not a test drifts. | asserted |
| `#411` | `axona_status` calls the synaptome "mesh" — this label caused a **false mesh-collapse report during a prod deploy**. Naming, but it cost real diagnosis time. | observed |
| **NEW** | **No application-path fence.** Every test in §3 above exercises a module or the kernel; nothing exercises a real app end-to-end over the production bridge. A green module suite does not establish that the application path works — the meaningful fence for a file transfer is Portal ↔ an independent relay across prod, not direct calls into the transfer engine. **Raised by Aster** (council seq 15) and independently proposed by Orion (council seq 7, "Application Sandbox & E2E Testing"); **verified by inspection** — no item in this list covered it before v1.1. This is the same defect class as Phase C: a suite that cannot fail in the way that matters. | measured (gap confirmed by inspection) |

---

## 4. Security register — **needs re-baselining before use**

Source: `red team/red-team-punchlist-v4.19.3.md`. **Read this caveat first:** that register
is pinned at **v4.19.3** while prod runs **4.49.0** — thirty releases. Its #2 item, `R-1`
("prod runs 4.19.2, carries the reconnect-death bug"), is **stale**: I verified
`bridge.axona.net/healthz` reports kernel 4.49.0 today. Other rows may be equally stale in
either direction. **Proposed first action: re-baseline the punchlist against 4.49.0
before any of it is scheduled.** Prioritising from a stale register is how a fixed item
gets re-fixed and a live one gets skipped.

Headline items as recorded, pending that re-baseline:

- **`R-0` — no absence-alerting** (ranked #1, process). Four silent failures in its cycle.
  **Empirically re-confirmed today:** the hourly `#jokes` chime — whose stated purpose is
  loss detection — died for **18.3 hours** and was caught only because David remembered.
  A watchdog now reports its own gap. This is the same defect class as the D0 finding: an
  instrument that cannot report its own failure.
- **`E-1`/`GG-1`** — memory-hard PoW dial-up (shipped inert at difficulty 0). Gates the
  manifesto release. Bench app + calibration corpus ready.
- **`G-1`** — bridge-directory enumeration / fleet-wide mass-shutdown.
- **`R-2`** — recovery-path audit (a recovery path that waits unboundedly on the thing it
  is recovering).
- **`R-3`** — churn storm from transient roots.
- **`A-2`** — directed-transcript binding absent on web/mesh transport (≈ all real users).
- **`D-2`, `G-3`, `G-4`, `G-2`/`F-4`** — bridge WS hardening; installer supply-chain
  (`curl|bash` from `main`, unpinned); bridge Sybil; passive metadata surveillance.
- **`SP-6`, `G-5`, `G-7`, `G-8`, `E-2`/`G-6`, `F-1`/`F-2`/`F-5`** — signal caps, TURN
  username embeds node-id, port exposure, `/healthz` seed tell, key-at-rest, privacy nits.
- **Cheap batch the register itself recommends:** `R-0`, then `G-5`, `G-7`, `G-8`, `G-3`.

Also open from the security punch list outside that file: **C-2 freshness** and
**E-1 address grinding**, plus building a dht-sim **binding model**.

---

## 5. Documentation & record

| ID | Item | Evidence |
|---|---|---|
| — | **`RELEASE-NOTES.md` stops at v4.29.0.** Newest entry is `## v4.28.0 → v4.29.0`; live is 4.49.0. **~20 kernel versions unrecorded.** Backfill means reconstructing from git history — not improvisable. | measured |
| `E-1` | The six rendered programmer-guide PDFs do not point at the errata; a reader holding a PDF cannot learn corrections exist. | measured |
| `E-2` | `host()` is in-memory intent, not persisted state — Services Guide says "durable roots". **A developer can build on this and be wrong.** Whether hosting *should* persist belongs to M7 (state codec) in phase E. | measured |
| `E-3` | `PERSIST_UNSUPPORTED_NAMESPACE` missing from the API Reference error table. | measured |
| `E-4` | Absolute API-stability claims are false across v4.40.0 (`connect()` was added). Guide is pinned v4.48.0 vs live 4.49.0, but content verified correct: export surface byte-identical 4.48.0↔4.49.0, `AxonaPeer` public method names identical 4.38.0→4.49.0. | measured |
| `#415` | Scorecard §3.3 heading claims "honest capacity — done, already in prod". The D0 measurement contradicts it. | measured |
| `#416` | **Two `INVARIANTS.md`**, disjoint numbering (`I-1…I-11` in axona-protocol; `S1–S6`/`B1–B13` in axona-docs/architecture), no cross-reference. Already misled a reviewer into filing a wrong finding. | measured |
| `#417` | `_replicateRoots` header comment claims a children restriction the code does not have. Misled my own D0 recon for one iteration. | measured |
| `#396` | Bootstrap hand-assembly — hygiene, **refuted** as the `#393` cause. Kept as a record, not as work. | measured |

---

## 6. Applications

| ID | Item | App |
|---|---|---|
| `#350` | `CryptoService` "encrypt-to-author" is security theater — the public authorId is used as the key. Needs real key exchange **or removal**; shipping something that looks like encryption and is not is worse than shipping nothing. | axona-chat |
| `#409` | Ingest renders foreign payloads as blank rows — no `std/message` shape check. | axona-chat |
| `#405` | Long-message scroll trapping. | axona-chat |
| `#404` | Clear button on the composer, next to Draft. | axona-chat |
| `#407` | Keep msgIds so a transfer can be retracted. | axona-portal |
| `#408` | Warn when a topic already carries chat traffic. | axona-portal |
| `#410` | Content-addressed fan-out — one topic per file, pointers on the shared topic. | axona-portal |

---

## 7. Infrastructure & ops

| ID | Item |
|---|---|
| `#399` | axona-relay vendors the kernel with **no declared provenance** — replace with an npm pin. Supply-chain adjacent (see `G-3`). |
| — | **Scheduling durability.** Every recurring agent task is session-scoped and dies silently with its conversation; this caused the 18.3 h chime gap. Watchdog added, root cause not fixed. Related: `R-0`. |
| — | **26 stray local relay processes** observed (fleets `--count 12` and `--count 14`, ~19 h, against testnet) — never triaged. |
| — | Memory recorded prod at 4.43.0 while `/healthz` reports 4.49.0 — deploy-state record was stale; corrected in this document. |

---

## 8. Decisions needed from David

1. ~~**Scorecard §7.1 — start M21-S now (spec + simulation)?**~~ **WITHDRAWN as posed —
   the design is not specified** (David, 2026-07-30: "I don't think we have sufficient
   clarity about the M21-S design yet"). My framing presupposed we knew what would be
   specified. **This is now a council design question, not a scheduling decision.** Five
   gaps, stated in full on `#council` (msgId `806fa6d4…`):

   1. **Authority or service?** A delegated root claims a position XOR distance does not
      justify, and `_onRootBeacon` already demotes a farther root when a strictly-closer
      beacon arrives — so a delegated root may fight the 4.19.x reconciliation logic. A
      pure *referral* (sender re-routes, bridge exits the path) is closer to M19 and may
      need no lease at all.
   2. **Third-party discovery.** A peer that never spoke to the bridge still routes to it.
      Learning the delegation from the bridge, from the deputy's beacon, or from the grant
      each carries a different attack surface and a different failure when discovery is
      the thing lost.
   3. **Issuer death.** An expiry handles a deputy outliving its grant, not a bridge dying
      mid-lease — the `#333` shape. And `#397` (reach = `rootReplicas` = 2) means a
      delegated root beyond that distance may be *permanently* unreconcilable, making a
      stale grant unrecoverable rather than merely wrong.
   4. **Did ratifying `neverRoot`-on-the-wire already shrink this?** If a sender can see a
      node will never root, it routes around during lookup — no grant, no lease, no second
      authority. That is M19 plumbing. **M21-S may largely dissolve**; kill or confirm that
      before designing a lease format.
   5. **What does a decline actually cost?** ~2,500/bridge/continuous is why M21-S is on
      the plan, but the *cost* is unmeasured. Topic re-homes cleanly ⇒ efficiency play.
      Topic lost because the bridge is closest and refuses ⇒ correctness bug, front of
      queue. **Measurable with instrumentation + a probe, no protocol change** — proposed
      to precede all design work, so the priority rests on evidence rather than argument.

   Deployment remains blocked on D0 regardless (ratified §7.3: a role charged against a
   stuck meter is not charged).
2. ~~§7.2 declare `neverRoot` on the wire~~ — **RATIFIED YES**, 2026-07-30.
3. ~~§7.3 delegated role charges the deputy's budget~~ — **RATIFIED YES**, 2026-07-30.
4. **§7.4 — run the `#406` A/B** (4.48.0 vs 4.49.0, same fleet, same probe). Removes the
   largest unexplained number in the scorecard. Requires rolling prod relays, because
   testnet lacks the node count to make the measurement mean anything. **Not startable
   without approval.**
5. **Re-baseline the red-team punchlist against 4.49.0** before scheduling any of §4.
6. **Application work vs kernel work.** §6 is seven items across two apps, none of which
   advance the refactor. With a single implementer these compete directly with D0.
   `#350` is the one I would not defer — it is a security-shaped claim that is currently
   false.

---

## 9. My proposed sequence — for the council to attack

Reasoning stated so it can be disagreed with:

1. **D0 implementation** — everything downstream is gated on it, and admission is currently
   running on one signal.
2. **`#415`, `#416`, `#417`** — ~an hour total, and all three are *record errors that have
   already misled a reader*. Cheap items that cause wrong work should not queue behind
   expensive ones.
3. **Re-baseline the punchlist**, then the `R-0` absence canary — `R-0` is the register's
   own #1 and we hit it again today.
4. **D1**, once D0 makes admission decisions meaningful.
5. **`#406` A/B**, when David approves prod involvement — it can run in parallel; it is
   measurement, not code.
6. **M21-S spec + simulation** in parallel throughout, deploying only after D0.
7. **`#414`** with D1, since both concern paths that create roles.
8. **Errata E-1…E-4 fold-in** at the next substantive docs render, not before — that is
   what the errata exists to allow.

**Deliberately *not* near the front:** `RELEASE-NOTES` backfill (large, no correctness
consequence), app polish `#404`/`#405`, phase E (correctly last).

---

## 10. What I want from Orion and Aster

Per the review rules agreed 2026-07-30:

- **Challenge the `asserted` rows.** `#397`, `#339`, §5.5 are believed, not verified. If
  any is wrong, it should leave this list.
- **Challenge the sequence in §9**, especially putting D0 ahead of the security batch.
- **Name anything missing.** This was assembled from four registers (task register,
  scorecard, errata, red-team punchlist) plus items surfaced today. Absence from those
  four is not evidence of absence.
- **Cite path + symbol + commit SHA** in findings, and mark each claim verified, refuted,
  or unverified.

Counts, so a gap is detectable: **6 refactor phases** (1 done) · **5 open scorecard
findings** · **25 open task-register items** · **4 errata entries** · **~20 ranked
security rows, pending re-baseline** · **4 documentation/record items** outside the errata.
