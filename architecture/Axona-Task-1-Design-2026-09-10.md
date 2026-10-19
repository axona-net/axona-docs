# Task 1 — Reproducible delivery baseline and failure ledger

Design ID: AX-T1-D1 · 10 September 2026 · Aster, Chief Programmer

Status: **Approved by David, Chief Architect, on 10 September 2026; authorized for council circulation and validation. Implementation follows the review/tasking sequence below; no production changes authorized.**

Canonical location: `axona-docs/architecture/Axona-Task-1-Design-2026-09-10.md`. Approval changes status only; the approved design body is preserved. Sections phrased as decisions requested record the original submission.

## 1. Decision in plain language

Build a small, repeatable test system that can show exactly which messages were sent, which were obtained, what each component actually reported, and where evidence stops. Run it against an identified build in an isolated network. Preserve failures as the baseline for the repairs that follow.

This task succeeds when the evidence is trustworthy, even if delivery tests fail. It does not claim to repair delivery, prove the proposed root-cause explanation, or certify the deployed fleet.

The user outcome remains: **a participant can send and obtain the expected messages.** For each test, “expected” must name the recipients, topic descriptor, subscription/history conditions, retention assumptions, and observation deadline before execution.

## 2. Context and evidence boundary

The September 9 review examined kernel 4.82.0. Subsequent council reports describe kernel 4.84.0, commit prefix `adce81c`, and an outage involving root changes, unacknowledged forwarding, and stale-envelope drops. Those reports are useful hypotheses, not independent reproductions.

axona.bot's September 10 census reports 48 running relays across Air, M1, Linux, Windows and three DigitalOcean droplets, all at 4.84.0. The census predates later bridge changes. Windows resource measurements and comparable storm windows are incomplete. A reported M1 memory outlier requires separate observation. Neither a checkout version nor a process-start log alone proves that every currently executing artifact matches the claimed source; preserve the strength and limits of each identification method.

Recent council probes were received by Aster and reportedly other seats. That establishes specific observations, not continuous service, bridge admission, general recovery, or a causal explanation. The earlier successful publication return without confirmed receipt must remain in the incident ledger.

## 3. Contract and non-goals

For every run, provide:

- Exact source/build/runtime identity, dirty-state disclosure, configuration and test seed.
- A declared workload and expected message set, including every attempt and every eligible reader.
- Correlated publisher, service-node and reader evidence, without promoting one observer's evidence into another's guarantee.
- An external wall-clock limit and an explicit completed, failed, aborted, or inconclusive result.
- Reproduction instructions and raw evidence sufficient for a different council member to challenge the conclusion.

No kernel behavior changes, new wire protocol, API outcome redesign, forced production role transition, production soak, host restart, deployment, encryption replacement, or performance optimization belongs in this task. Read-only production inventory is a separate evidence input. Live publication tests require a separately approved topic, traffic budget and host scope.

## 4. Deliverables and proposed ownership

Assignments below become active only after David's design review and council validation. They are not claims that members have started.

| Subtask | Deliverable / implementation outline | Proposed author | Independent reviewer | Depends on |
|---|---|---|---|---|
| T1.1 | Baseline manifest and read-only artifact inventory; resolve full commits, runtime/dependency versions, local modifications and deployed-identification evidence | axona.bot | Orion checks provenance; Vega spot-checks a second host/path | None |
| T1.2 | Versioned run/evidence schema and expectation ledger; document exact API evidence mapping | Orion | Vega and axona.bot challenge semantics; Aster integrates | T1.1 draft |
| T1.3 | Isolated launcher, external watchdog, evidence collectors and simple positive/negative controls | axona.bot | Vega | T1.2 agreed schema |
| T1.4 | SDK and MCP application-path fixtures plus chat adapter using the actual application path, not a substitute direct-kernel publisher | axona.bot | Vega executes independently; Orion checks claims | T1.3 |
| T1.5 | Adversarial root-transition, partition and expiry fixtures; independent run package | Vega | axona.bot reviews fixture code; Aster witnesses selected runs and audits evidence | T1.3 and relevant T1.4 path |
| T1.6 | Known-failure reconciliation, evidence index and limitations report | Orion | Vega and axona.bot verify their attributable entries | T1.1–T1.5 evidence |
| T1.7 | Integrated disposition and proposed next repair design for David | Aster | All seats provide objections and evidence gaps | T1.6 |

No author independently certifies their own fixture or repair. If Aster authors an implementation component, a different seat must review and run it. Council roles do not prevent anyone from challenging any portion of the design.

## 5. Baseline manifest

Identify kernel, relay, SDK, MCP, chat, bridge and relevant documentation separately. Record full resolved commit, artifact hash where available, build command, lockfile hash, dependency/runtime versions, OS/architecture, effective non-secret configuration, and source of each observation. Record local changes without overwriting or committing someone else's work. Distinguish **source checkout**, **built artifact**, **running process**, and **remote reported version**.

The isolated reference build should initially resolve the reported `adce81c` source to its full commit and reproduce its build. If unavailable or incompatible with the actual clients, record that blocker and propose a named substitute; do not silently test another revision. The 4.82 review remains historical evidence, not the new baseline.

Inventory entries for every named fleet host include timestamp, reachability, expected/observed relay count, process identity/start, version evidence and gaps. Task 8a owns recurring census and storm sampling; Task 1 imports timestamped snapshots and does not invent a second scheduler. Never copy secrets, credentials, private topic strings or unrestricted logs into public artifacts.

## 6. Evidence and expectation schema

Use machine-readable JSON/JSONL with a versioned schema, plus a short human report. Suggested repository location is `harness/baseline/`, subject to the implementer's survey of existing harnesses; reuse suitable collectors instead of building duplicates.

Each run has a unique `runId`, scenario/version, seed, manifest reference, participant roles, complete topic descriptor, fault schedule, start/end times, deadlines, expected message ledger and artifact index. Secret descriptors in shared reports are represented by stable redacted references.

Each attempt records `logicalMessageId`, `attemptId`, payload hash, returned protocol `msgId` if any, publisher identity, operation start/return, literal API response/error and retry relationship. Do not assume `msgId` exists before the API returns. Include a run nonce and logical ID in synthetic test payloads so the reader can correlate evidence even when publisher metadata is missing.

Each observation records observer/process identity, event type, logical/attempt/protocol identifiers where known, local monotonic time, UTC time, evidence source and raw-artifact reference. Record clock uncertainty before cross-host latency calculations; monotonic clocks on different hosts are not directly comparable.

Keep these evidence fields distinct, not a single inferred success state:

- Publication invoked and API returned.
- Local enqueue/dispatch, if exposed.
- Named service node accepted/rejected, only with correlated evidence.
- Named reader callback received and payload verified.
- History query returned that message under its stated conditions.
- Application persistence, if actually tested; callback receipt alone does not prove it.
- Deadline elapsed, late arrival, cancellation, observer failure or missing telemetry.

An unavailable internal event is `not_observable`, not invented instrumentation evidence. A missing reader receipt is `not_observed_by_deadline`, not proof of publisher rejection or permanent loss. Independent means a separately executing reader, with identities and shared failure domains disclosed; a distinct host is a stronger test control, not the definition of message delivery.

Predeclare expected `(logicalMessageId, readerId)` pairs. Report all eligible pairs, observed-on-time pairs, late pairs, missing pairs, unexpected messages, duplicates, rejected attempts and inconclusive cases. Report latency percentiles only alongside these denominators; never omit failed attempts to make performance look better. Preserve duplicate callbacks even if the application deduplicates them.

## 7. Test matrix

Use synthetic public test data in a network that cannot reach production discovery or bridges. Distinguish scenario setup failure from the behavior under test. Detect setup from evidence where possible; a fixed sleep alone does not establish a warm subscription or root identity.

| ID | Scenario and preconditions | Required observation / falsifier |
|---|---|---|
| C0 | Known-good collector control and deliberately unreachable reader | Collector records the positive receipt and the missing-reader deadline honestly; never reports missing as healthy |
| C1 | Warm topic, established subscription, fresh unique publications through SDK, MCP and chat paths | Each declared eligible reader observes the intended payload; API return alone cannot satisfy the assertion |
| C2 | Publish retained fixtures, then join a cold reader and request available history | Named retained fixtures returned, or exact missing/deadline outcome. State the supported retention and cache preconditions; no universal archive promise |
| C3 | Existing subscription across controlled disconnect/reconnect and a continuing stream | Separately score pre-fault, during-fault and post-recovery messages; do not assume replay during a gap is guaranteed |
| C4 | Asymmetric partition: publisher remains able to invoke publish while reader/service reachability is impaired; heal later | Preserve API responses, known acceptance and reader silence separately; record late evidence after healing without rewriting the original deadline outcome |
| C5 | Warm topic, introduce an XOR-near transient peer, observe whether it gains the root role, then terminate it uncleanly | Prove or disprove each step of the takeover hypothesis. If it never becomes root, report failed precondition, not reproduced write loss. Track publications during tenure and after failure |
| C6 | Controlled unavailable-root forwarding held long enough to exercise actual freshness expiry | Correlate original timestamps, retry/promote evidence, expiry decisions and caller/reader outcomes. Count unique logical messages separately from repeated drop events |
| C7 | Isolated MCP/client restart with a warm subscription and known messages | Record changed process/transport identity, preserved author identity if promised, watch restoration, queued versus fresh messages and duplicate callbacks |
| C8 | Duplicate/retry and late-observation control | Reuse logical identity with explicit attempt identities; late or replayed evidence cannot satisfy an unrelated new publication |

C5–C6 test the diagnosis without presupposing it. Inspect actual root/holder transitions and acknowledgement paths at the named baseline. A missing root event or absent tracing can make the causal result inconclusive even when a delivery failure is clear.

Initial coverage: C0–C4 and C7–C8 through SDK and MCP; C1–C3 and C7 through the real chat UI/client path; C5–C6 through SDK first, followed by one MCP reproduction of any demonstrated application-visible failure. Publish the coverage matrix; do not claim every fault was tested through every client. Expand chat coverage in later task designs where the failure path warrants it.

## 8. Proposed test limits — not production service guarantees

These are initial bounded experiment settings for David/council review, not claims about current supported performance:

- Maximum eight isolated peers, one active scenario at a time, and at most ten synthetic publications per second; ordinary delivery scenarios use one per second.
- Ordinary fixtures use twenty messages and a thirty-second per-message observation deadline. Allow sixty seconds for setup; fail setup explicitly if unestablished.
- Ordinary scenario watchdog: three minutes. Expiry fixture: ten minutes, including a real-time window exceeding the reported 300-second freshness limit plus a sixty-second observation margin. If the source shows different timers, amend the declared fixture before running it.
- First diagnostic pass: one run of each fixture. Repeat demonstrated failures with three named seeds/runs and run the matched no-fault control. Do not rerun away the first failure. Three repeats are reproducibility evidence, not a reliability estimate.
- Proposed run limits: four GiB aggregate child-process RSS and 100 MiB collected logs per scenario. Preflight available host capacity; unsupported measurements are disclosed. A limit breach aborts the experiment and preserves its cause, not a passing result.
- Watchdog runs outside the tested process and records loss of progress even if its event loop stalls. Cleanup targets only explicitly registered test children and network resources. Never terminate arbitrary node processes or production relays.

Fast fake-clock unit tests may supplement, but not replace, one real elapsed-time expiry reproduction. No production packet blocking, root manipulation, soak pause or restart is implied. Production baseline data collected during soak must retain that confound; any pause needs David's explicit operational decision.

## 9. Failure ledger and analysis

Every entry has a stable failure ID, user-visible symptom, source report, evidence classification, affected exact artifacts, setup/workload, expected versus observed behavior, reproducer, denominators, raw references, owner, next experiment and disposition. Classification is reported, reproduced, contradicted, inconclusive, fixed-under-test, independently-verified or superseded-with-reason. It is not a linear checklist: contradictory evidence stays visible.

Seed entries include:

1. Publish return without independently observed fresh delivery, including the unreceived R3 council message.
2. Cold-read/subscription failures and the earlier CI/local discrepancy, distinguishing test setup failures from service failures.
3. Root admission and higher-epoch takeover by transient/unavailable participants.
4. Retried original envelopes expiring; differentiate logged events from distinct affected messages and distinguish inferred upstream origin from observed origin.
5. Native/event-loop stalls and watchdog blindness, currently unresolved cause.
6. Metric denominators/units and stale operational documentation affecting conclusions.
7. Hourly bell evidence gaps: schedule, wake, execution, attempt and receipt are distinct. The bot's interactive-loop admission is evidence of missing durability, not proof of which stage failed in every historical gap.

Do not mix private security details into the shared delivery ledger. Task 0's confidentiality containment remains urgent and parallel, with a separately scoped private design.

## 10. Review, execution and checkpoints

1. David reviews this design's scope, owners, experiment limits and coverage. Requested changes are incorporated into D2.
2. Aster sends the identified revision to council for divergent validation, verifies self-receipt within two minutes and records each member's receipt separately. No implementation request is implied by a request to review.
3. Ask each seat for its strongest objection, alternative, concrete falsifier and inspected/unverified boundary. Prioritize individual initial responses before cross-discussion where practical; record when that was not possible.
4. Existing conditional review offers: Orion within two hours of receiving the detailed package (the earlier 22:00 option depended on receipt before 20:00 and was not triggered); Vega within four hours of publication. Reconfirm availability and receipt on dispatch. Obtain bot's concrete review ETA. Missing wake evidence is escalated, not treated as acceptance.
5. Aster integrates comments and unresolved choices for David. Under the approved design, issue explicit implementation subtasks with revision, owner, reviewer, deliverable and agreed checkpoint. Obtain estimates before claiming dates; no fabricated “working session” deadline.
6. Review T1.1–T1.2 before harness implementation. Review controls before interpreting fault runs. Independent reviewers use their own run directories and report environmental differences. Large differences require a matched-baseline comparison, not pooled results.
7. Aster returns the evidence pack and recommends the next smallest repair design. A passing collector does not close the underlying delivery issue. No blanket extra per-commit approval gate is introduced beyond the agreed CA/CP process.

Aster owns the next action after each decision. The living ledger records a concrete deliverable and completion evidence, including Aster's own work. Council monitoring does not count as design production. Aster must not report work underway solely because a future intention has been stated.

## 11. Acceptance checklist

- [ ] Full baseline identities and provenance recorded; unidentified deployed components remain visibly unknown.
- [ ] Clean reproduction instructions exercised by someone other than the component author, with environmental limits disclosed.
- [ ] Schema validated; positive, missing-reader, duplicate and late-evidence controls behave correctly.
- [ ] Named expected-message denominators reconcile with all attempt and reader records; unexplained gaps fail evidence acceptance.
- [ ] Required client/scenario coverage executed or explicitly blocked with owner and next action; an incomplete pack is labeled partial, not complete.
- [ ] External watchdog and bounded cleanup demonstrated, including a deliberately stalled isolated process.
- [ ] First failures, retries, raw evidence, redactions and all resulting dispositions preserved.
- [ ] Root/expiry hypothesis receives a supported reproduced, contradicted or inconclusive disposition; no forced conclusion.
- [ ] Independent code review and independent execution results attached; disagreements retained.
- [ ] David receives a concise account of what works, what fails, what remains unknown and the recommended next repair.

Task 1 completion certifies the baseline/evidence package, **not system reliability**. Delivery failures may remain open. A rewrite recommendation would require evidence that targeted repairs cannot meet the agreed contracts; this task does not prejudge that choice.

## 12. Decisions requested from David

Approve or modify: (1) this evidence-first scope, with isolated root/expiry tests included; (2) proposed ownership and independent-review arrangement; (3) initial experiment budgets and client coverage; (4) circulation of the revised detailed design to council for validation.

No production change is requested in this design. Subsequent service objectives, obligation-eligibility policy, API semantics and production mitigations require their own explicit designs/decisions.
