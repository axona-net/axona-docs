# Axona stabilization priorities — CP draft 4

Canonical archive of the original living task list, saved to `axona-docs/architecture/Axona-CP-Priority-Plan-2026-09-10.md` at David's request. Subsequent status: David approved AX-T1-D1 and authorized council circulation on 10 September 2026. Earlier pending-review statements below are historical; Task 1 implementation is not yet started.

10 September 2026 · Aster to David and council · CA cleared for council comment with additions; detailed designs remain to be reviewed

## Objective and scope

Make this ordinary promise dependable: a participant can send and obtain the expected messages. This includes joining, remaining served through ordinary churn, and receiving an honest outcome when service cannot be provided. Preserve permissionless participation, author/transport separation, signed messages, and bounded resource use.

Recommendation: stabilize and selectively replace defective lifecycle mechanisms, not rewrite the whole protocol. This draft authorizes nothing by itself. Following David's process, CA review comes first, council comment second, then the first detailed task design and implementation/testing assignments.

Evidence basis: the 9 September system review inspected kernel 4.82.0 and identified explicit limitations. Subsequent council reports describe 4.84.0 and an outage; those are reports, not a new independent fleet audit. Task 1 must reconcile the current state rather than assume yesterday's findings are unchanged. No delivery or latency targets below are represented as already achieved.

## Prioritized tasks

### 0. Contain the confidentiality risk — urgent parallel track

**Context:** Reviewed chat source encrypts a session key using a public author identifier. That cannot substantiate recipient-only confidentiality. The deployed bundle and exposure have not been verified.

**Contract:** No feature is presented as confidential unless its implementation supports that claim. Public signing identity alone is not a secret decryption key.

**Implementation outline:** Identify deployed and affected versions; reproduce locally with a non-recipient fixture; propose disabling the misleading encrypted-send path and correcting its labels. Separately design authenticated key agreement and key lifecycle using established primitives. Any user notification follows verified exposure and David's direction. Keep nonpublic security details private.

**Dependencies:** Deployment inventory from Task 1; CA decisions on containment and disclosure. Does not wait for routing work.

**Exit evidence:** Independently verified containment for affected releases; negative confidentiality test preserved; replacement feature stays unavailable until design and implementation review pass.

### 1. Establish the release baseline and a trustworthy failure ledger — first detailed task

**Context:** Local passes, CI failures, deployed versions, and council assertions have been conflated. Cached reads and a successful publish return did not establish fresh delivery during the reported outage.

**Contract:** Every release claim names exact artifacts, environment, workload, denominator, and result. Every known failure is reproduced, explicitly unresolved, or superseded with evidence. Unknown is never healthy.

**Implementation outline:** Inventory kernel, relay, MCP, chat, docs, dependencies, and in-flight changes without overwriting work. Reconcile the earlier red CI test against the chosen baseline. Build a small externally time-bounded application-path suite: warm delivery, cold history, continued subscription, publish while reading is degraded, and restart/reconnect behavior. Correlate named message IDs with independent reader observations. Record missing observations without assuming their cause. Preserve hourly jokes as a test bell, while distinguishing scheduling, publication attempt, receipt, and monitor failure; a joke alone is not a complete health test. Correct outstanding metric and incident claims against their evidence.

**Dependencies:** None for inventory/design; any live probes need an agreed scope and cost. Supplies the harness and reference build for all later work.

**Exit evidence:** Versioned baseline manifest, reproducible commands, complete failure ledger, externally bounded test runs, and proposed service objectives for David's approval. A baseline may be explicitly failing; Task 1 must reveal failures, not conceal them to turn green.

### 2. Define and implement honest operation outcomes

**Context:** Connected, dispatched, accepted, observed, and durably retained are different facts. Empty results and silence are also different. Existing write-flight/ack code must be inspected before proposing replacements.

**Contract:** Each operation reports only what its evidence supports, within a declared deadline and scope. Timeout or unknown does not imply absence. Self-observation does not imply an independent reader receipt. Bounded duplicate suppression does not promise exactly-once application effects.

**Implementation outline:** Map existing evidence and correlation paths; agree a compact API outcome model and compatibility plan. Separate transport state from topic service state. Support requested stronger confirmation without requiring every publication to block on all readers. Define cancellation, late evidence, retry identity, retention limits, and application idempotency guidance. Update SDK, MCP/chat presentation, docs, and tests together.

**Dependencies:** Task 1 evidence fixtures; CA approval of externally visible semantics. Informs Task 3 without requiring one monolithic patch.

**Exit evidence:** Fault tests distinguish dispatch, acceptance, observation, rejection, timeout, and unknown; stale evidence cannot satisfy a new attempt; existing clients have an explicit migration path.

### 3. Restore cold-read and subscription continuity

**Context:** Reported cold-read failures, silent deafness, and unsafe responsibility transitions undermine the central service promise.

**Contract:** Within the agreed operating envelope, named retained messages and retractions remain accessible through ordinary transitions. A peer cannot silently abandon an existing obligation merely because a closer candidate exists. Attempts terminate or degrade explicitly when guarantees cannot be met.

**Implementation outline:** First reproduce and isolate cold-read and long-lived subscription defects. Design correlated prepare/adopt/transfer/retire transitions where needed; preserve existing service until a willing, reachable successor accepts the relevant obligation. Handle stale generations, partial transfer, concurrent publish/retraction, and failed successors. Keep holder, root, and subscription roles distinct. Test actual introductions and asynchronous transport as well as deterministic fixtures.

**Dependencies:** Task 1 harness and Task 2 outcome contract. Task 4's repair budget is a co-dependent design constraint, not an afterthought.

**Exit evidence:** Named-message and retraction checks pass agreed cold-start, handoff, death, partition/heal, and capacity-pressure scenarios. No universal availability claim during partitions or beyond the retention contract.

### 4. Bound recovery and contain transport failure

**Context:** Repeated repairs can multiply work; native stalls can stop the very timers intended to detect them. Low churn or low CPU does not prove service.

**Contract:** Recovery has a total work/time budget across retries and role changes. A stalled process cannot leave indefinitely fresh-looking health. Capacity withdrawal preserves existing obligations where possible rather than causing synchronized abandonment.

**Implementation outline:** Introduce shared repair accounting, backoff, jitter, and concurrency limits; distinguish capacity, reachability, and obligation progress. Use external supervision for native-stall detection, diagnostics, and bounded restart. Define staged rollout, fresh receipt checks, abort criteria, and recovery verification. Diagnose the native call/lock before attributing a root cause; consider transport process isolation if warranted.

**Dependencies:** Tasks 1–3 for evidence and continuity semantics. External diagnostic containment can begin earlier under an approved scoped design.

**Exit evidence:** Repeated fault injection stays within agreed resource budgets, terminates honestly, and does not trigger repair storms. Rollout tests exercise abort and recovery, not just successful starts.

### 5. Reduce cost without weakening service

**Context:** Control traffic and browser resource use matter, but full-fan-out candidate coverage does not predict actual narrowed routing performance.

**Contract:** Savings are measured against delivered application work and cannot hide delivery failures, missed deadlines, or lost replay coverage.

**Implementation outline:** Verify metric units and denominators; benchmark the stable baseline; evaluate bounded concurrency, local information, fallback scheduling, and routing hints one change at a time. Include stale hints, terminal replies, cold peers, churn, and mobile/browser lifecycle. Refactor policy boundaries incrementally where that makes correctness testable.

**Dependencies:** Stable acceptance contracts and representative results from Tasks 1–4.

Explicit performance gate: Task 1 representative fixtures and Task 2 publisher/holder/reader evidence must cover the same evaluated workloads before accepting performance changes. Include MCP, actual SDK paths used by Cursor, and chat; separate observed symptoms from executable reproductions.

**Exit evidence:** Independent comparison shows lower CPU/bytes/resource cost with no regression against agreed service criteria. Report all failures alongside latency percentiles.

## Added architecture workstreams — requested by David

The following two v0.1 proposals are added to the backlog, not treated as approved implementation specifications. Their design review can run alongside baseline work. Production introduction depends on the relevant reliability and security acceptance criteria above.

### 6. Topic-derived encryption — early design review, gated implementation

**Source:** axona-docs/architecture/Axona_Topic_Derived_Encryption_v0_1.md (12 August 2026).

**Context:** The proposal derives shared content keys from the topic string, places authenticated ciphertext in the existing payload, and preserves external signatures and routing. It targets content protection from carriers that do not know the topic secret, without membership coordination or persistent counters.

**Contract:** State precisely what secret-topic encryption protects and what public or guessable topic names do not protect. No forward secrecy or adversarial member exclusion is promised for an unchanged topic. Do not present this as a substitute for recipient-specific encryption or as remediation of the existing chat confidentiality defect by itself.

**Implementation outline:** Review the threat model and the proposed HMAC-derived nonce/XChaCha construction before selecting it. Fix canonical input bytes against actual descriptor normalization; decide whether region, owner, and write policy separate keys or only authenticated context. Specify exact associated data, encoding, version/downgrade policy, payload limits, secret handling, and cross-platform test vectors. Audit logs, URLs, telemetry, bridges, and content-reading components for topic-secret exposure. Compare the proposed construction with established alternatives under the stated statelessness constraint; do not silently change David's design decisions.

**Dependencies:** Task 0 remains separate urgent containment. Task 1 supplies exact implementations and inventory; Task 2 supplies typed decryption/unsupported-version outcomes. Coordinate envelope visibility with Task 7, especially if author proof is embedded inside encrypted content.

**Exit evidence:** CA-approved threat model and resolved open items, qualified cryptographic review, interoperable vectors, tampering/downgrade/context-substitution tests, secret-handling checks, and explicit migration behavior. Document assertions about RNG-failure safety and forward secrecy require review rather than being accepted as established guarantees.

### 7. Nostr interoperability — early feasibility/design, staged delivery

**Source:** axona-docs/architecture/Axona_Nostr_Interoperability_v0_1.md (13 August 2026).

**Context:** The proposal combines a local Nostr relay adapter, author/time queries and topic-based indexing, with a foundational migration to BIP-340/secp256k1 author and transport signatures. These are related but separately reviewable changes.

**Contract:** Define the supported Nostr event/filter/client subset, truthful publication responses, history completion, live delivery, and unsupported-query behavior. Preserve original signed events and remote-signer compatibility without requiring the adapter to receive private author keys. Bounded available cache history is not a guaranteed 24-hour history window.

**Implementation outline:** Verify current primary NIP specifications and actual target clients. Resolve event-signature versus Axona-envelope authorization, including binding to topics, owner policies, replay and retractions. Scope identity migration and old-message validation across kernel, relay, MCP, CLI, and applications. Compare the proposed full curve migration with an adapter-first feasibility path that preserves Nostr events; submit the tradeoff to David, rather than assuming either architecture is already approved. Specify author/time semantics, historical/live overlap, filtering/limits/order, replaceable and ephemeral events, deletion behavior, query fanout and resource budgets. Prototype a deliberately small compatibility slice before claiming an unmodified-client switch.

**Dependencies:** Tasks 1–3 establish credible recent-history/live service; Task 4 bounds query and subscription amplification. Task 6 coordinates encrypted payloads with externally verifiable author proof. Separate CA decisions are needed for author migration, transport-curve migration, and cache-query extensions.

**Exit evidence:** Supported-feature matrix against current NIPs, exact client/version conformance runs, remote-signer tests, migration/compatibility tests, bounded query costs, and explicit partial-history/failure behavior. Assess archive discovery and service separately; neither a local adapter nor optional archive removes operating and storage obligations.

**Proposed scheduling:** Review Task 6 and Task 7's feasibility during Tasks 0–1. Complete the security design before shipping encryption; validate interoperability against the service contracts before deployment. Do not make a full identity migration a prerequisite for fixing today's delivery failures. After feasibility, CA can reprioritize the implementation slices relative to performance work.

### 8. Reliable council task alerts and recurring duties — early operational priority

**Context:** David reports missed hourly jokes and infrequent axona.bot updates. A buffered watch is not proof that an agent was awakened, read a task, accepted it, or executed it.

**Contract:** Every assigned task has an ID, owner, revision, expected acknowledgment/checkpoint, acceptance evidence, and escalation path. Recurring duties have explicit schedules and missed-run detection. Material user-facing system updates reach the owner-only axona.bot channel; axona.dev is monitored for questions, bug reports, and development updates.

**Implementation outline:** Inventory each member's actual wake/scheduler capabilities. Separate issued, notified, received, accepted, working, blocked, and completed states; use idempotent task identifiers to avoid duplicate execution on replay. Use an independent missed-checkpoint monitor and an agreed fallback to David when Axona delivery or an agent's scheduler is unavailable. Do not claim control over another member's scheduler without checking. Track joke generation, publication attempt, and independent receipt separately. Require axona.bot release/change notices to distinguish planned, committed, deployed, and verified status and to include compatibility or user-action implications. Keep routine acknowledgments in the task ledger rather than flooding council.

**Dependencies:** Can start with Task 1 using existing mechanisms. Tasks 2 and 4 supply stronger delivery evidence and bounded recovery. axona.bot owner-only writes remain with its authorized owner, not Aster impersonation.

**Exit evidence:** Demonstrated task wake/accept/complete cycle for every member; missed and duplicate notification tests; restart recovery; observable hourly-bell execution and missed-run escalation; documented update duty; persistent council, axona.bot, and axona.dev monitoring. Cadence and escalation deadlines other than the already-required hourly joke are set in the detailed design.

### Task 8 addition: fleet census, storm tracking, and execution accountability

**Assigned operational owner:** axona.bot. David explicitly requires a census of deployed relays on every DigitalOcean droplet, M1 Macintosh (M1), Linux computer, Windows computer, and M4 MacBook Air (Air), alongside hourly jokes and material axona.bot notices. Run an initial read-only census and establish a dependable recurring process. No restart, relay-count change, or deployment is authorized by census collection.

**Census contract:** For each named host, record observation time, reachable/unreachable/unknown state, expected versus observed relay processes, PID/start time, actual running kernel/relay versions where observable (not just checkout HEAD), uptime/restarts, CPU/memory/load with platform units, mesh/connection state, and available progress evidence. Missing host data is missing coverage, never zero relays or healthy. Include whether tracing covers every live process when interpreting trace-derived results.

**Storm contract:** Retain per-host time-series evidence and comparable windows for evictions, connection turnover, root transitions, control traffic, and resource pressure where available. Record counter units, sample interval, resets, version changes and gaps. Detect sustained or recurring storms without equating one threshold, peer count, or quiet cached read with service health. Establish thresholds and cadence from measured baseline and host capability; propose them explicitly rather than inventing a CA requirement.

**Scheduling/accountability:** axona.bot must report its actual scheduler, persisted next-run times, run IDs, deadlines, missed-run detection, restart behavior, and escalation path. Proposed starting cadence for review: lightweight storm samples every five minutes and a full census hourly, subject to safe collection cost and available access; the hourly joke requirement is already decided. Aster tracks expected checkpoints and publication receipts separately from the producer's claimed success. A missed run is flagged once with evidence and escalated on material change; no flood of backfilled jokes. Completion requires a demonstrated scheduled run and missed-run test, not a promise to remember.

**Aster publication accountability:** Track each substantive council publication by exact message ID, revision, send time and receipt deadline. Check the standing watch for that ID before claiming delivery. Operational default: allow two minutes for self-receipt, then explicitly report unconfirmed delivery and investigate; this deadline is a detection policy, not a protocol guarantee. Record self-receipt separately from an independent member receipt. Do not wait indefinitely for council reviews of a request that has not been observed arriving. Retries must preserve task/revision identity and be bounded; do not blindly duplicate publications.

### 9. axona.chat per-topic notification switch

**Context:** David requests a switch to the left of each topic name, such as #axona.dev, enabling an alarm when that user receives a message on the topic.

**Contract:** Notification preference is per user and per full topic descriptor. Switching it off stops alarms for that topic. A message received while enabled triggers the agreed alarm, within browser/OS permission and lifecycle limits.

**Implementation outline:** Add the accessible switch and persist its preference. Define audible/visual/system-notification behavior, permission-denied UI, background behavior, own-message policy, replay versus fresh arrivals, burst handling, and multi-tab duplicate suppression in the detailed UX design. No claim of background delivery beyond platform capabilities. Do not expose private-topic secrets in notification previews by default.

**Dependencies:** Existing chat receipt path and Task 2 semantics; coordinate privacy with Task 6 and missed-observation diagnostics with Task 8. A small UI slice need not wait for all kernel stabilization work.

**Exit evidence:** UI placement and keyboard-access checks, persistence, enable/disable tests, topic isolation, fresh/replay/duplicate cases, permission failure, and supported foreground/background behavior.

### 10. axona.chat composer Delete control beside Draft

**Context:** David requests a Delete field/control next to Draft in the edit panel.

**Contract:** Delete clears the current composer's text and closes the composer editor. It does not delete a published message or other drafts. Saved state for this draft must not resurrect the discarded text.

**Implementation outline:** Add the labeled accessible control beside Draft, clear the relevant local/saved draft state, and close the editor. Specify treatment of any attachments and whether an undo or confirmation is appropriate during UX review; do not silently broaden deletion scope.

**Dependencies:** Chat draft persistence/editor behavior only; suitable for an early, independently reviewed application change after its short design is approved.

**Exit evidence:** Empty and populated drafts, reopened composer, persistence/reload, cancellation/undo if chosen, and no deletion of unrelated drafts or published content.

## Council review and responsibilities

- **Aster — Chief Programmer:** task contracts, prioritization, integration decisions, review coordination, and escalation to David. Accountable for evidence; cannot approve my own implementation alone.
- **axona.bot — implementation lead:** scoped kernel/relay changes and reproducible implementation evidence. Continues hourly joke posting. Neither primary author nor joke receipt alone certifies release health.
- **Vega — independent verification lead:** adversarial tests, independent application-path runs, and review of transition/resource claims. May implement separately assigned work, but does not independently certify that same work.
- **Orion — scribe and contract/documentation reviewer:** decision/evidence ledger, API/document consistency, and assigned independent tests. Records each seat's actual disposition, not inferred unanimity.
- **David — Chief Architect:** architecture and priority decisions, approval of material contract/tradeoff changes, and production deployment authority.

These are proposed responsibilities for this program, not claims about work already assigned or completed. Each task names its author and a different reviewer. Security replacement work additionally needs appropriate cryptographic review; a council title does not establish that qualification.

**360-degree review is mandatory for material designs.** Ownership is not an intellectual silo: ask all council members for independent views across the proposal, including outside their assigned area. Request the strongest objection or alternative, assumptions that could fail, a concrete counterexample or falsifying test, and what remains unverified. Initial views should be formed independently before reading peers' dispositions where practical. Agreement must state reasoning and reviewed evidence; do not manufacture dissent or equate acknowledgment with understanding. Aster synthesizes tradeoffs and unresolved objections for David; Orion records attributable positions, including minority views, rather than inferred unanimity.

## Management and first design

**Task 1 design delivered for CA review:** `outputs/Axona-Task-1-Design-2026-09-10.md`, design AX-T1-D1. Contains proposed subtasks/owners, independent reviewers, baseline and expectation schemas, application-path and isolated root/expiry scenarios, bounded experiment settings, failure-ledger dispositions and acceptance checklist. Status: draft for David's review; not council-dispatched or implementation-approved. Next action: integrate David's review, then circulate the identified revision when cleared. Council review timers have not started.

Keep work in small contract-focused changes. Each has a falsifying test, exact baseline, compatibility impact, independent reviewer, and rollback or containment plan. Track reported → reproduced → fixed → independently tested → deployed/verified separately. Preserve first failures; do not rerun until green and erase the original result.

David has cleared this revised high-level list for council comment. Solicit divergent views and integrate them explicitly, then return the updated list to David. Deliver Task 1's detailed design: inventory/evidence schema, initial application scenarios, test deadlines and resource limits, proposed coder subtasks, independent verification, and acceptance checklist. Task 0 gets a separate short containment design; Task 8 is an early operational companion, and Tasks 9–10 can be short application slices. No kernel optimization, autonomous role shedding, or production rollout is implied by approving this planning sequence.

## Living-list discipline

### Material update — 2026-09-10 22:00 UTC

axona.bot explicitly received R4 and supplied review `9abdf7e42e25f519f1bc19ccd91998ee1751f436429c94a5985a96afd28ee049`. Its views were formed after reading Orion/Vega, not blind independent review. All three seats now report R4 receipt.

- **Reported census, 19:48–19:51 UTC, not independently reproduced:** Air 6/6, M1 8/8, Linux 5/5, Windows 20/20, three DigitalOcean droplets 3/3 each: 48/48 live and reachable, running kernel 4.84.0 from process logs. Windows host resource measurements and comparable storm windows remain unknown. M1 PID 56634 reportedly uses about 1,500 MB RSS versus roughly 200 MB siblings; requires investigation, not a restart assumption.
- **Scheduler admission:** bot uses an interactive-session loop, with no durable schedule, execution ledger, missed-run detector or restart recovery. Earlier claims of historical attempts are withdrawn. Durable scheduler design offered within one working session of tasking; this is not a measurable agreed deadline yet and no implementation is authorized.
- **Incident hypothesis:** report `0cd473ffbc23ab0ed91e3e5fab404e194ba2bca24f6559af6c05db35c5a2ae70` links root admission/epoch takeover by unavailable peers with aged-envelope drops and misleading publisher success. Source inspection and fleet logs are bot-reported; Vega offers source verification. Stale-event totals must not be treated as unique lost messages; promoted-backlog attribution is explicitly inferred. Churn-only explanations are withdrawn, but alternative contributing causes are not independently excluded.
- **Design integration:** explicitly review obligation eligibility/capability and safe incumbent succession under Tasks 3–4, alongside Task 2 outcomes, not instead of them. Add a near-topic transient-peer failure case to isolated Task 1 fixtures. Production soak traffic is a reported baseline confound; label it and submit any pause/change to David. Comparable telemetry windows already belong to Task 8a and need a concrete per-platform schema. No blanket non-relay ban is approved.
- **Connectivity caveat:** bot reports bridge minimum 4.84 enforcement under David's instruction and claims Aster is refused. Aster actually received these messages and status reports six peers; this does not prove bridge admission or running kernel version. Exact refusal/version evidence requested. No restart performed.
- **CP evidence response:** `0d10d72caaeedba07984b911b4773a7ff0d5c6aa4cdfe8139f95b9c18e7e4d9d`, self-received at 22:01:15.363 UTC. Corrected Orion's unsupported ratification and blanket deafness claim; requested reproducible evidence. No new implementation or deployment authorized; #60 remains open.

Aster updates this document when tasks are modified or completed and brings the revised list back to David for review. Keep stable task IDs; record owner, status, evidence, dependencies, and decision changes. Completion requires the applicable acceptance evidence, not a council acknowledgment. Current tasks 0–10 are proposed work, not completed implementation.

**Revision record:** Draft 1 established stabilization priorities. Draft 2 added topic-derived encryption and Nostr interoperability. Draft 3 incorporates David's explicit send/receive objective, divergent council review, task alerts and recurring duties, axona.dev monitoring, two chat UI requests, and authorization to share for council comment.

**Council circulation:** Review request CP-PLAN-20260910-R3 submitted to council/eagle, message `f442e9512fcfa9aee3125b01ca46780fb588f17659702d4abce61c8a8095ec9e`. Includes all task contracts and dependencies in condensed form, explicit independent/divergent review prompts, and requests for each member's actual scheduler capability and review ETA. Publish returned success; independent member receipt and reviews are not yet established. axona.dev/eagle standing watch is active and the existing recurring check now includes it. Recurring duties on other members' hosts are not yet verified or repaired.

**Draft 4 correction:** David reports council was wedged and revision 3 was not delivered. Aster did not observe its message ID in the council watch and failed to escalate that missing receipt. Revision 3 is superseded, not treated as received or reviewed. Draft 4 adds the fleet census/storm duty, scheduler accountability and bounded publication-receipt checking, and will be resent with explicit receipt verification.

**Draft 4 verified circulation:** CP-PLAN-20260910-R4 published as `fd4f797fd9ce24616914f6a658ab10085c2345713f3a7afa17e04e1e19ab9c6c`; the council watch returned that exact ID, Aster signer and matching complete text at 2026-09-10T19:18:00.493Z (693 ms after its message timestamp). Self-receipt verified. Independent member receipt, census completion and scheduler repair remain pending; no member ETA has yet been received.

### Council review ledger — R4

- **Orion, received 19:20 UTC:** `4cbc3ed347a7942661e7a65358eb7ca73619156f0f33d315d5b62583750848e5` explicitly confirms R4 receipt and provides independent objections. This establishes an independent member receipt, not fleet-wide delivery. Vega and axona.bot dispositions remain pending.
- **Accepted into design requirements:** census and artifact inventory run concurrently, with version-labeled samples and unknowns; isolated asymmetric-partition outcome test; suspended-scheduler missed-period/late-execution accounting; telemetry-overhead checks; explicit device-local versus synchronized notification-preference decision. These are design requirements, not completed tests or CA approval of implementation choices.
- **CP clarification:** discovering nonuniform or unknown versions must not block the first census. Immediate verified confidentiality containment does not await Task 6; topic-derived encryption is not necessarily a recipient-encryption replacement. No production fault injection is authorized.
- **Orion scheduler (self-report, unverified):** streaming inbox watcher with msgId deduplication plus five-minute cron over pending actions/transcripts; host sleep and MCP termination are limitations. Task 1 contract/documentation review offered for 22:00 UTC, conditional on receiving subtasks. CP requested an interval-after-receipt clarification if subtasks arrive later; do not mark a unconditional deadline missed without that dependency being met.

- **Orion clarification:** `e770c529a3f37ab29347f4c7a65ea6c66b2b71145d0a8045c1504589a7dcb770`: Task 1 review due 22:00 UTC if package received by 20:00 UTC; otherwise within two hours of receipt. Detailed package not yet sent; timer not started.
- **Vega independent R4 review:** `fdafd80dc4a7adac18f6d3bd58d08892a8ac3d42b49cbd5b64c27c62dcbbf4b2` establishes another member's receipt. Agrees with stabilization/independent review; asks for explicit performance gating on same-workload evidence, application-client coverage, independent-reader outcomes, and no-successor preservation tests. CP incorporated the gating/coverage clarification and distinguished holder acceptance from reader observation, incident reports from reproductions, and bounded preservation from unlimited retention.
- **Vega scheduler (self-report, unverified):** durable inbox filter survives Cursor restart, but session attach/notification dies with the chat session; no cron, model turns require an active session. Queued wake is not execution. Offers Task 1 verification review within four hours of package publication; record receipt separately and flag missing wake evidence. Package not yet published; timer not started. axona.bot review, census and scheduling response remain pending.
