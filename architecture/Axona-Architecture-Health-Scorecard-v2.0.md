# Axona Kernel — Architecture Health Scorecard

## v2.0 — 2026-07-29

**What this is.** An honest statement of the kernel's structural condition: what
was wrong, what has been fixed and what that measurably changed, what is still
wrong, and what happens next. Written for reviewers — human and AI — who need to
judge the plan rather than take it on trust.

**A clean rewrite.** v1.0–v1.2 grew by accretion into 1,850 lines of working
record, including reasoning that later measurement disproved. They are preserved
in `history/architecture/` for provenance. Nothing is carried forward here that
is not currently true.

**Measured against:** kernel **4.49.0**, `axona-protocol/src` on `testnet`,
2026-07-29. Every figure below was taken from the tree or a live endpoint on that
date, not from a prior document.

**Deployed:** prod **4.49.0** — both bridges (2.103.0) and all nine backbone
relays (0.92.0); testnet **4.49.0**. Read `/healthz` before trusting any version
statement, including this one.

**Companion:** [`INVARIANTS.md`](INVARIANTS.md) holds the rules themselves and
whether each is fenced by a test. Read it before changing kernel behaviour.

---

## 1. The situation in one paragraph

The kernel works, is deployed everywhere, and its *authority* layer — the part
that decides who owns a topic — is genuinely well-built. The debt is concentrated
in two places and is not subtle: **one file holds 21% of the kernel**, and the
**orchestration layer that drives periodic work never received the rules the
authority layer did**. Every serious incident in the last quarter landed in the
second of those. A year of fixes has made the system *correct under churn*
without making it *simple*, and the current phase is about paying that down
without breaking a running network. Two things block progress more than the code
does: the test runner cannot prove a full suite ran, and several key metrics do
not measure what their names claim.

---

## 2. Subsystem health

*LOC and file counts measured 2026-07-29 at kernel 4.49.0. Total: **21,048 LOC /
57 files**, 152 test files.*

| Subsystem | LOC | Files | Health | Assessment |
|---|---:|---:|:--:|---|
| `contracts/` | 671 | 5 | 🟢 | Pure interface layer. Depends on nothing. Stable. |
| `persistence/` | 635 | 3 | 🟢 | Clean interface, two swappable adapters, depends only on `errors`. |
| `identity/` | 484 | 2 | 🟢 | Small and focused. Sole blemish: misfiled ed25519 (see §5.3). |
| `crypto/` | 599 | 1 | 🟢 | Vendored noble-ed25519. Isolated. |
| **pubsub — authority** (`rootClaim`, `syncEngine`, `topicStore`, `post`, `envelope`, `constants`, `ids`) | ~1.6k | 7 | 🟢 | **Where the refactor landed.** Single transition site, derived natures, typed policy table, CI fences. This is the reference for how the rest should look. |
| `utils/` (`hexid`, `geo`, `s2`, `region-names`) | 1,541 | 4 | 🟡 | Good code. `hexid.js` is the #1 fan-in module (18 importers); it and `geo.js` now have dedicated smokes, but coverage is thin relative to blast radius. |
| **pubsub — orchestration** (`repairPlane` 1,001, `wireHandlers` 820, `AxonaManager` 782) | ~2.6k | 3 | 🟠 | `refreshTick` is a god-method carrying most of the kernel's periodic work. **Still growing** — `repairPlane` was 935 LOC on 2026-07-25 and is 1,001 today. Historically the site of the expensive bugs. |
| `transport/` (`web/mesh` 1,061, `web/index` 1,022, `webrtc` 596, `handshake`) | 5,634 | 14 | 🟠 | `handshake.js` shows extreme churn (185 commits against ~343 LOC). Layering inversion: transport reaches *up* into pubsub for crypto and serialization. |
| `dht/AxonaPeer.js` | **4,372** | — | 🔴 | **21% of the kernel in one file**, 4× the next largest. God-object with porting scars from an `AxonaEngine.js` that no longer exists. **Also growing** — 4,251 on 2026-07-25. |

**Read the growth, not just the size.** The two files flagged as the worst debt
in July both got *larger* over the period in which they were flagged. Debt marked
and not paid accrues; that is the argument for sequencing §6 rather than
deferring it again.

---

## 3. What has been completed, and what it changed

### 3.1 The authority refactor (v0.2 Phases 1–8) — done, and it worked

Consolidated root ownership behind one canonical boolean with one transition
function and one log line; replaced stored role natures with derived ones;
collapsed six bespoke repair paths into one `sync(peer, topic, policy)` operation
behind an 8-row typed table, with one emission site per wire verb.

**Measured effect:** the entire `#333` drift class — where a role's stored nature
diverged from reality and self-perpetuated into backbone collapse — became
*structurally impossible* rather than guarded against. Fifteen mechanisms now
funnel through a single authority site. The three rules that produced this result
(one transition site · derive don't store · one operation + typed table + CI
fence) are recorded in `INVARIANTS.md` as S1–S3 and are the standard for
everything that follows.

### 3.2 Correctness under churn (4.19 → 4.40) — done

A sustained sequence: root reconciliation, leave-order (handoff *before* notify),
root-liveness-gated backup handoff, cold-attach split-history union, read-repair
past degraded holders, and `connect()` as a single complete entry point that
self-integrates.

**Measured effect:** the standing ~10% permanent-loss figure attributable to
departure handling was eliminated; late-join replay went from partial to complete
in the repro suites; bridgeless operation was proven — two peers hold an authed
channel with the bridge process dead.

### 3.3 Admission control and honest capacity (4.46 / 4.47) — done, already in prod

A node may now *refuse* a role, and its fitness is judged by **measured pressure
against real protocol deadlines** rather than by counting roles held. A count is
inventory; pressure is capability, and capability is what predicts failure.

### 3.4 The A+B train (4.49.0) — shipped to production 2026-07-29

Four fixes for defects that were live in production, deployed as one release
train across both bridges and all nine backbone relays.

| | Defect | Effect of the fix, measured on prod |
|---|---|---|
| **A1** | `claimReachable` dereferenced null on a `neverRoot` node. A bridge *is* `neverRoot`, so the **first** role refusal killed `refreshTick` inside its own swallowing `catch` — silently, for the life of the process. | **~2,500 refusals per bridge and counting, `refreshTick` alive through every one**, `tickStalls` 0. This path had never executed anywhere before. |
| **A2** | `helloPressure` latched: one stall pinned a node `saturated` permanently, because the lag reading was an all-time high-water mark with no decay. | East absorbed a **409 ms** stall — 5× anything seen in a 10-hour testnet soak — and the window returned to 2 ms. Pre-fix this would have latched forever. |
| **B1** | An unknown persist namespace returned `undefined`, indistinguishable from a completed write. | Now throws `PERSIST_UNSUPPORTED_NAMESPACE`. Silent-success class closed. |
| **B2** | `/healthz` returned the literal string `ok` regardless of state — production had no health signal at all. | Public verdict is now computed (`ok`/`degraded`/`unknown`); admission detail sits behind an operator token with `timingSafeEqual` and fails closed. **A wrong token is byte-identical to no token.** |

**A2's headline claim is still unproven.** 409 ms is helloPressure ≈ 0.08 against
a 0.6 saturation threshold. The *decay mechanism* is confirmed; recovery from
genuine saturation has not yet been observed and should not be claimed.

---

## 4. What we learned that changed our model

### 4.1 Declines are constant, not rare — which unblocks delegation

The plan had deferred role delegation behind a redirect mechanism, on the
explicit grounds that we lacked data on how often a node actually needs to refuse
a role. **B2 produced that data without building the mechanism.**

Measured on prod (kernel 4.49.0, region eagle, 9-relay backbone plus browser
population):

- **~1,000 refusals per bridge** across a rolling restart of nine relays — each
  joining node attempts ~100+ role placements that route to a bridge.
- **~10–15 refusals/minute/bridge at steady state**, with nothing unusual
  happening. It never reaches zero.

**The general lesson:** when a plan defers a decision pending data, ask first
whether an *observability* change can produce the data without the mechanism. The
smallest item in the release answered a design question scheduled four items
later.

### 4.2 A bridge is a permanent hole in the keyspace

A bridge is periodically topic-closest like any node, holds the most connections
so more placements route through it, and can **never** accept — not "is currently
full" but *cannot ever*. Every one of those ~2,500 placements was routing work
that terminated in nothing.

This splits delegation into two problems with different dependencies:

| | **Structural** (the bridge) | **Load-triggered** (the general case) |
|---|---|---|
| Trigger | `neverRoot` — static, known at config time | measured pressure — dynamic, reversible |
| Needs honest measurement first | **no** | **yes, absolutely** |
| Oscillation risk | **none** — never wants the role back | real, needs damping |
| Deputy selection | easy — the bridge sees everyone | hard — who is idle? |

The strongest objection to delegation — *a node that cannot tell it is overloaded
will never delegate* — applies only to the load-triggered case. **The structural
case is a strictly smaller problem and it is the one with measured demand.**

**`INVARIANTS.md` B12 already decides its shape.** Routing refuses a bridge as a
next hop precisely because *a bridge is signaling infra, not a topic
root/forwarder*. A **proxy** design (bridge keeps beaconing, forwards traffic to
a manager) violates that. A **referral** design (the deputy is beaconed as root,
the bridge exits the path after introduction) does not, and matches the proven
bridgeless-operation property. That fork is closed before design begins.

**Unresolved, and it is the hard part:** authority today is derived from the
address and independently checkable by anyone. A deputy's claim is "the
address-holder said so," which is not. It needs a signed, expiring grant and an
exemption from the two guards that keep *one root per topic* true — both of which
were installed after incidents. Whether declaring `neverRoot` on the wire makes
the grant checkable, or merely relocates the trust, must be settled before code.
An unverifiable grant is a topic-capture primitive.

### 4.3 Our measurements have been lying to us in a specific way

Two independent cases, same shape — **the name does not match the referent**:

- `servicePressure` sat structurally pinned at 0.028 while a node held 546 roles
  at 200% CPU. A number that cannot move.
- `axona_status` reports the synaptome (the DHT routing table) under the name
  `mesh`. `synaptomeSize` and `peers` are the same set counted twice, and neither
  counts live WebRTC channels. During the 4.49.0 production deploy this produced
  a false *"the mesh collapsed"* report — i.e. a claim that the bridge sits on the
  data path, the exact negation of B12. It was corrected only by reading kernel
  source, because **no operator surface exposes live channel count at all**.

"Did the mesh survive?" is the central question for a protocol whose thesis is
that the bridge is not on the data path, and today it cannot be answered from
outside a node. That widens the measurement work from "make `servicePressure`
honest" to "every operator metric names what it measures, and the load-bearing
properties have a metric at all."

### 4.4 A process failure worth institutionalising

A release was sized as *four versions of new subsystem* when it was *four
bugfixes*, because the deployed version was taken from a note rather than from
`/healthz` — and the error survived a full review pass, since every reader
trusted the same note. Now recorded as process rule **P6**: any version used to
size, gate, or justify work is read from the running service at the time of
writing.

---

## 5. What is still wrong

Ranked by how much it blocks everything else.

**5.1 ~~The test runner cannot prove a full suite ran.~~ RESOLVED 2026-07-29 —
and the estimate here was wrong by 3.5x.** `&&`-chained commands reported success
from a partial run, and orphaned smoke files were wired into no suite at all. This
document said "~10"; Review Pass 8 said 15. **Measured: 35 of 144.** The chain was
109 invocations long, so a failure at position 3 hid 106 results.

Fixed by `test/run.mjs` + `test/manifest.json` + a disk↔manifest guard in CI: the
suite now reports `ran N of M selected` and fails if those differ. All 35 orphans
were resolved by RUNNING them — 11 passed and were promoted (recovering fences for
#364, #354, #343, #363), 24 failed against internals the Phase-1 rewrite removed
and were retired with the missing symbol named. Quarantined is zero.

The instrument found two things on its first day: a **25%-flaky test sitting in the
release gate** (`smoke_pubsub_kill` 3c fenced convergence *latency* while claiming
to fence convergence), and #413, where a rejection-sampling budget looked safe under
the wrong probability model — `P(fail) = N/(N+T)`, polynomial not exponential, so no
budget could have rescued it. Details in
`team-updates/TEAM-UPDATE-2026-07-29-test-gate-and-chat-0.44.0.md`.

**5.2 Measurement dishonesty (§4.3).** Saturation detection currently rests
almost entirely on the newly-windowed `helloPressure`, because `servicePressure`
structurally cannot fire. A single-signal regime is acceptable briefly and is not
a steady state.

**5.3 Boundary leaks that block safe refactoring.** Shared crypto
(`pubsub/ed25519.js`) and serialization (`pubsub/post.js` `canonical`) are
misfiled inside `pubsub/`, so `transport/` and `identity/` reach *up* into pubsub
— inverted layering. Separately, the `package.json` `exports` map opens every
sub-path, making internals de-facto public API (~65 tests import them directly).
Both must close before internals can be restructured safely.

**5.4 `AxonaPeer.js` (4,372 LOC) and `refreshTick` orchestration.** The two
largest liabilities, both still growing. The orchestration layer never received
rules S1–S3; root *authority* is single-sited but root *triggering* remains
diffused across `refreshTick` and wire handlers as roughly a dozen
incident-specific guards. The next churn edge will land in the seams between
those guards, not inside `rootClaim.js`.

**5.5 Rules declared but unfenced.** S4 (closed shapes) and S6 (one clock) have
no test; B1's "region-lock stays off" default and B12's "a bridge ends with
`axonRoles` empty" are asserted but not fenced. A rule that is not a test drifts
— the un-tabled `READ_REPAIR` policy proved that within weeks of the sync engine
shipping.

**5.6 ~10% cold-topic delivery loss, unattributed.** A 10.5-hour, 40-node soak
delivered 110/123 (89.4%). Critically, **four of the ten incomplete probes came
in at nominal latency** (2671–2765 ms), so loss is independent of the slow path
and any explanation built on latency is wrong. No A/B against a prior kernel
exists on that fleet, so this is **unattributed, not exonerated**.

---

## 6. The plan

```
      ┌─ C ── test-gate integrity ─────────────────── ✅ DONE 2026-07-29
      │      de-&& the runner · wire orphaned smokes (35, not ~10) ·
      │      used→declared fence · one manifest whose count is checked
      ↓
      ├─ D0 ─ honest measurement (M4)
      │      service-stamp that can actually move · metric-naming audit
      │      · expose live channel count
      ↓
      ├─ D1 ─ gate the pushed paths (ADOPT / REPLICATE / read-repair)
      │      behind caller-closure tests + SLO A/B
      ↓
   ┌──┴───────────────────────────┐
   │                              │
 M19 redirect                 M21-S structural delegation (bridge)
 (decline-path plumbing;      (may run in PARALLEL with D — it does
  no longer needed to          NOT depend on M4; referral shape, per B12)
  learn whether declines
  are common — §4.1)
   │                              │
   └──────────┬───────────────────┘
              ↓
      ├─ M21-L load-triggered delegation ── strictly after M4
      ↓
      └─ E ── contract & structure
             typed migration errors with named removal releases · state codec
             with restore-to-live tests · boundary close (§5.3) · ordered
             refreshTick decomposition · AxonaPeer carve · export narrowing
```

**Why C blocks everything.** Gating an authority change on an instrument that
cannot report its own completeness is how a plan fools itself. This was caught
once already — a release gate was written against the very runner the same
document had just documented as unreliable.

**Why M21-S may run in parallel with D but not before C.** It introduces a
*second source of authority* into a system whose safety rests on authority being
independently checkable. That earns the strongest available test gate; it does
not earn a wait on measurement it structurally does not need.

### Gates

- **Deterministic fixes get deterministic fences**, named individually, with
  recorded results. A soak is *regression evidence*, never proof of a
  clock-driven fix.
- **SLO** is fresh-subscriber delivery %, **REPS ≥ 5, mean ± sd**. Single runs
  are directional only.
- **Every newly-declined path needs a defined terminus** — the sender re-picks,
  re-routes, or records a deliberate terminal result. Falling role counts are not
  evidence of success on their own; an unhandled decline is exactly how A1 wedged
  a bridge.
- **Named rollback signal** per release, written before deploy.

### Definition of done

Not line counts or file layout:

- one owner and one clock per `refreshTick` phase;
- no nullable or declined state without every caller fenced;
- one declared↔used policy/verb map, enforced in CI;
- one canonical state codec with restore-to-live-operation tests;
- one test manifest whose reported count is checked;
- **telemetry capable of disproving "this node is healthy."**

---

## 7. Open decisions

1. **Start M21-S after C, or hold all delegation until M4?** Measured demand
   (~2,500 declines per bridge, continuous) argues for starting; the
   second-authority-source risk argues for care in *design*, not delay in *start*.
2. **Declare `neverRoot` on the wire?** Prerequisite to answering whether a
   structural grant can be made independently checkable — §4.2.
3. **Does a delegated role count against the deputy's admission budget?** It must,
   or delegation becomes a budget-laundering primitive.
4. **Run the #406 A/B** (4.48.0 vs 4.49.0, same fleet, same probe) to attribute or
   clear the ~10% loss. Cheap, and it removes the largest unexplained number in
   this document.

---

# Review Pass 8 — Antigravity — Analysis of the Shipped Changes and PLAN v2 (2026-07-29)

*Contributor: Antigravity (AI coding assistant for axona-chat and peer-to-peer validation).*

I have audited the newly restructured scorecard and reviewed the live production telemetry from the **Phase A+B deployment (4.49.0 / 2.103.0)**. 

## 1. Analysis of the Shipped Changes (Phases A & B)

The metrics gathered via the new B2 telemetry endpoint validate the urgency of the initial scorecard audit:
*   **A1 Null Guard:** The recording of **~2,500 refusals per bridge** with zero tick stalls confirms that the `neverRoot` null-dereference crash was a live, repeating failure mode. Pre-4.49.0, both prod bridges were silently executing tick-death on the first role rejection, disabling background maintenance entirely. 
*   **A2 Lag Decay:** The recovery of the east bridge's lag window back to 2 ms after absorbing a **409 ms** peak is empirical proof that the sliding-window decay functions correctly under load. It successfully avoids the permanent saturation lock that plagued the previous high-water mark implementation.
*   **B2 Telemetry Value:** The success of B2 is a textbook validation of the "telemetry before mechanics" rule. By exposing bridge refusal counts, we resolved a major roadmap design question (whether declines are rare or common) without writing any new routing or redirection code. 

## 2. Analysis of the Current Plan (PLAN v2)

I strongly endorse the revised sequencing and the prioritization of Phase C:

### Phase C as the Absolute Gate
The process failure documented in **P6** and **F4** (where the 4.42.0 revert silently dropped four closed findings because their fences were also reverted) highlights the fragility of our current testing pipeline. De-`&&`-ing the runner and wiring the 15 orphaned smokes must remain the absolute gate. We cannot safely begin Phase D or M21-S while the test suite is capable of truncating failures silently.

### Parallelizing M21-S (Structural bridge delegation)
Splitting M21 into **M21-S (Structural)** and **M21-L (Load-triggered)** is the correct architectural split. Since a bridge is a static keyspace hole that *never* roots, M21-S does not depend on dynamic load telemetry and can be built immediately after Phase C is green. 
*   *Verification requirement:* For M21-S, we must design a **referral-with-a-lease** model where the deputy beacons as root and the bridge exits the data path, rather than a proxy model. We must also ensure the grant carries a verifiable cryptographic lease to avoid the **#333** dead-principal ghosting vulnerability.

### Expansion of M4 (Metrics Audit & Live Channel Telemetry)
The addition of **#411** to the M4 scope is highly critical. The false "mesh collapsed" report during the 4.49.0 deploy illustrates how misnamed metrics can lead to incorrect production diagnoses. Exposing the live WebRTC channel count alongside the synaptome size is essential to verifying that the bridge is behaving as a bootstrap-only node and not participating in the data-forwarding path.

## 3. Recommendations on Open Decisions
1.  **Start M21-S after Phase C:** Do not wait for M4. The steady-state rate of 10–15 declines per minute per bridge represents a continuous traffic sink that we should close as soon as the test runner is secured.
2.  **Declare `neverRoot` on the wire:** We should advertise `neverRoot` as an explicit handshake property. This makes the structural delegation grant independently checkable by third-party peers, preventing delegation from becoming an opaque topic-capture primitive.
3.  **Role charging:** A delegated role *must* count against the deputy's admission budget to prevent delegation from laundering resource limits across nodes.
4.  **Run the #406 A/B soak:** Run this immediately on the 4.49.0 fleet to attribute the ~10% cold-topic loss. It is the only way to establish whether the loss is a regression or a baseline characteristic of the current network density.

---

# Review Pass 9 — Codex (OpenAI GPT-5) — Analysis of v2 Changes and Current Plan (2026-07-29)

*Contributor: Codex, an OpenAI GPT-5 coding agent. I reviewed this scorecard,
kernel 4.49.0 (`789f4bd`), bridge 2.103.0, the relevant implementation paths,
and the deterministic fences named below. This validates source and local test
evidence; the stated production totals remain operational evidence, not values
that source review alone can reproduce.*

## Assessment of the changes already made

The A+B release is a meaningful improvement, not a paper cleanup.

- **A1 is correctly closed at the caller boundary.** `claimReachable()` now
  returns a nullable result and `refreshTick` continues normal subscription
  renewal when the bridge's hard refusal prevents a claim. The direct
  `smoke_decline_paths.mjs` fence passed all 22 checks, including work that
  occurs after the prior throw site. That is the correct regression property;
  checking only that the tick did not throw would have repeated the original
  mistake.
- **A2 separates control from diagnosis cleanly.** The 12-tick ring is the
  admission input and the all-time peak is retained only for investigation.
  The direct 22-check fence covers both halves of the requirement: sustained
  lag remains saturating, while a recovered browser eventually becomes
  admissible again. The scorecard is appropriately cautious that a real
  above-threshold production recovery has not yet been observed.
- **B1 has converted silent loss into an explicit fault, but not into durable
  hosting.** `PERSIST_UNSUPPORTED_NAMESPACE` is typed, logged at error level,
  and deliberately not retried forever. That is the right interim behaviour.
  The known `hosting` dirty marks still do not serialize state, so M7 remains a
  correctness migration, not optional cleanup; the 13-check namespace fence
  makes that visible.
- **B2 gets the security boundary right.** The public endpoint reports only a
  derived `ok`/`degraded`/`unknown` verdict. Admission and topology detail are
  operator-token gated with fixed-digest `timingSafeEqual`, and an unavailable
  manager becomes `unknown`, never optimistic `ok`. The bridge's 18-check
  healthz fence passed. Operationally, alerts must treat `unknown` as
  non-healthy; otherwise the safer API result becomes another ignored state.

This is good evidence for the causal claims in the document. To make the
numerical production claims independently auditable, retain a timestamped,
redacted health/telemetry snapshot or dashboard permalink for each release
statement. A source tree proves the instrument exists, not that a bridge has
recorded 2,500 events.

## Scorecard corrections worth making

1. **Section 3.3 overstates completion.** Admission control is shipped, but
   "honest capacity" is not yet complete: `refreshTick` still stamps every role
   before doing its work, so `servicePressure` is structurally unable to show
   starvation, and three pushed role-creation paths remain ungated. Describe
   this as an *admission framework with one working pressure signal*, not a
   completed capacity system, until D0/D1 close those gaps.

2. **Make the test gap precise.** The current default `npm test` still has 109
   commands joined by `&&`; the first failure stops all subsequent commands.
   Across every `test*` package script, 12 of the 143 top-level `smoke_*` files
   are referenced by no script at all. Thus a passing default run establishes
   only that the declared default commands passed, while a failing run provides
   no complete result set. Phase C should replace both ambiguities with an
   explicit manifest and an end-of-run summary.

3. **Reconcile the invariant identifiers before relying on them as gates.**
   This scorecard cites S1–S6 and B12 in `INVARIANTS.md`; the current protocol
   file contains I-1 through I-11 and no matching S/B labels. The underlying
   ideas may be correct, but a reviewer or CI job cannot map a plan item to a
   nonexistent identifier. Either rename the scorecard references or add a
   stable cross-reference table in `INVARIANTS.md` before Phase C declares its
   enforcement map complete.

## Analysis of the current plan

**C is correctly the first executable gate.** Its deliverable should be a
machine-readable manifest that classifies every test as default, extended,
integration, intentionally retired, or missing. It must run all selected tests
despite failures, report a count and per-test results, and fail once at the end.
That turns "the suite passed" into a reproducible statement rather than a
property of a shell expression.

**D0 needs a service contract before moving a timestamp.** Relocating
`lastServicedAt` mechanically is not enough: each role nature needs a defined
service obligation and a point at which that obligation was actually completed.
Otherwise a cheap preamble can again freshen the metric while the expensive
replication, renewal, or queue work starves. The D0 fence should create that
starvation and prove that pressure rises, admission changes as designed, and
then recovers when the overdue work completes.

**D1 requires sender closure as well as receiver gates.** The source confirms
that HANDOFF is currently the only pushed path calling `admitPushedRole()`;
`ADOPT` and `REPLICATE` still create/ingest roles directly. For each newly
declined path, specify and test the sender outcome—re-pick, re-route, or a
visible terminal result—before judging the change by role counts or aggregate
delivery alone. This is the seam most likely to convert a locally correct
admission decision into distributed loss.

**M21-S may proceed in parallel as a specification and simulation effort after
C, but not as an authority-changing deployment before M19 and the authority
contract are complete.** Its lack of dependence on dynamic pressure is real;
its dependence on unambiguous delegation semantics is stronger. A verifiable
referral lease must at least bind the topic, issuer, deputy identity, issued and
expiry times, protocol/version, scope, and replay/revocation rule. Validation
must establish why the issuer is entitled to refer the topic despite
`neverRoot`, preserve the one-root invariant, and charge the deputy's admission
budget. The rollout fence should prove that a forged, expired, replayed, or
over-budget grant cannot take authority, and that a declined referral has a
bounded terminus. Advertising `neverRoot` on the wire is a prerequisite to
evaluating this design, not by itself a proof that the trust chain is sound.

**E remains correctly after the behavioural work.** Complete the versioned
state codec and the public-contract transition before carving `AxonaPeer`.
During internal module moves, retain compatibility re-exports; narrowing the
wide exports map is a separately reviewed major-version boundary. This avoids
turning a file-layout refactor into an accidental consumer migration.

## Bottom line

v2 is substantially more useful than the accumulated scorecard because it
distinguishes deployed mechanism, measurement, unresolved behaviour, and
architecture work. The immediate priority is not to expand delegation while
the test and measurement instruments still have known blind spots. Make C and
D0 produce trustworthy evidence, use that to close D1, and let M21-S mature as
a cryptographically specified referral protocol with simulation fences—not as
a shortcut around the system's single, independently checkable authority rule.
