# Aster's Protocol Refactor Assessment and Migration Plan

**Author:** Aster  
**Date:** 2026-08-07  
**Status:** Draft for council review  
**Scope:** Axona protocol, transport, DHT, and pub/sub restructuring. This is a migration plan, not authorization for a broad rewrite.

## Executive recommendation

Axona should be refactored by making its proven seams universal rather than replacing the system wholesale. The system already contains two good precedents:

1. `rootClaim` makes changes to root authority pass through one policy and transition point.
2. `syncEngine` centralizes a bounded set of repair and state-transfer policies.

The next design should apply the same discipline to every protocol operation: one owner for durable state, one named invariant that permits a transition, one authoritative wire contract, and one bounded/observable effect path.

This plan intentionally rejects two tempting but risky simplifications:

- Do **not** replace all handler dispatch at once with a generic “wire-pattern engine.” Introduce a typed contract registry in shadow mode around existing family-owned handlers, then move one protocol family at a time.
- Do **not** model `ROOT`, `CHILD`, `BACKUP`, and `HOLDER` as four exclusive role states. Current behavior correctly treats holder status as orthogonal to placement: a node can be a root/child/backup and also retain topic state. The target model must preserve that fact.

The objective is a system that a new engineer can answer by inspection: who owns this decision, what state is legal, what frame is accepted, what happens on duplicate/reorder/rejection, and how is rollback bounded?

## Part 1 — Evidence and diagnosis

### Materials reviewed

- Neuromorphic/dendritic architecture and the whitepaper architecture narrative.
- Earlier N-DHT and per-node refactor plans and punch lists.
- Kernel reconstruction audit and roadmap.
- The current invariant catalogue in `Axona-Architecture.tex` (the designated canonical invariant source).
- Current protocol source, including `dht/AxonaPeer.js`, `pubsub/AxonaManager.js`, `rootClaim.js`, `syncEngine.js`, `repairPlane.js`, `wireHandlers.js`, routing/synaptome code, and Node/web/simulation transports.
- Orion's redesign plan.

### What is working and should be retained

The neuromorphic model remains coherent: a DHT selects and maintains traffic-adaptive dendritic synapses; rooted relay trees distribute topic traffic; subscription renewal/pruning, replication, and repair restore local progress. Refactoring must make that model more explicit, not flatten it into a generic broker.

The prior refactors offer useful patterns:

| Precedent | What it demonstrates | Preserve in the next plan |
|---|---|---|
| `rootClaim` | Root-role changes can be mediated by a single policy/transition authority. | A central lifecycle authority for placement changes and their effects. |
| `syncEngine` | A policy table can own selected repair exchanges and state movement. | Extend this engine; do not recreate it beside existing repair paths. |
| Transport-contract work | Cross-peer behavior is safer when hidden behind a transport interface; simulator omniscience stays in the simulator. | Keep browser, bridge, Node, and sim implementations behind explicit contracts. |
| Reconstruction audit | A readable architecture document is not automatically a normative interoperability specification. | Separate rationale, normative protocol contracts, public API/deployment material, and conformance evidence. |

### Current structural pressure

The large peer façade and prototype-composed manager have accumulated unrelated responsibilities. `AxonaPeer` currently spans lifecycle, joining/integration, persistence, public pub/sub APIs, direct messaging, greedy routing/lookups, relay maintenance, metrics, and eventing. `AxonaManager` mixes topic-state, election, repair, wire handlers, and sync methods. The result is not merely file size: it makes ownership and precedence difficult to determine.

The pressure appears in five recurring forms:

1. **Overlapping decision sites.** Admission, placement, repair, replay, and cleanup logic can be reached from different lifecycle or handler paths.
2. **State and capability conflation.** Placement is often discussed alongside retention/hosting, even though hosting is a separate capability.
3. **Unnormalized wire policy.** `wireHandlers` centrally registers message types, but schemas, versions, authentication/admission, idempotency, response correlation, and observability are not represented in a single inspectable contract.
4. **Effects tangled with decisions.** A role or repair decision can issue sends, mutate stores, install timers, and emit events without a uniformly recorded transition outcome.
5. **Specification drift.** Several documents describe useful intent, while code and tests supply the interoperable behavior. Duplicate invariant catalogues have already produced confusion.

The redesign therefore needs to reduce *policy overlap*, not just redistribute functions into smaller files.

## Target architecture

### Layering and ownership

| Layer | Responsible for | Must not own |
|---|---|---|
| Application/session | Application behavior, user identity, startup choices, public subscription intent. | DHT placement, raw mesh liveness, protocol repair decisions. |
| Peer façade | Stable public API and dependency composition. | Implementing routing, repair, or persistence policy itself. |
| Topic control plane | Topic lifecycle, placement transitions, root election/claim policy, retention capabilities. | Raw transport/session establishment. |
| Sync/repair plane | Policy-driven snapshot/delta/pull/push/handoff exchanges, retry bounds, reconciliation outcomes. | Hot-path delivery semantics unless explicitly moved with a separate proof. |
| DHT/routing plane | Synaptome ownership, greedy routing, lookup, relay-tree maintenance. | Application-level authorization or persistence format. |
| Transport/auth/persistence | Live authenticated channels, frame I/O, transport capability, durable storage mechanics. | Topic placement and repair semantics. |

The façade should remain compatible but compose named services:

- `PeerLifecycle`: start/stop/join/leave/readiness and cancellation.
- `SynaptomeManager`: synapse creation, pruning, and maintenance.
- `GreedyRouter` and `LookupService`: route selection and lookup execution.
- `PeerMessaging`: direct-message APIs and event bridging.
- `PeerPersistence`: state envelopes, migrations, and restore boundaries.
- `TopicControl`: topic-state ownership and placement lifecycle.
- `SyncEngine`: repair/state transfer policy and outcomes.

No extraction changes a wire format or public API by default. It changes ownership and test boundaries first.

### Placement versus retention

Use two dimensions, not a four-way state machine:

```
placement ∈ { ROOT, CHILD, BACKUP }
retention ⊆ { HOSTED, APP_SUBSCRIBED, HISTORY, METRICS_LEASE }
```

A transition record must state its preconditions, durable writes, emitted effects, idempotency key, remote standing state, and eviction/rollback behavior. For example, becoming a backup may change `placement`, while a replicated topic snapshot changes `HOSTED`; neither implies the other without an explicit rule.

`rootClaim` should be generalized into a placement-lifecycle authority. It should not become a new global god object. Its role is to arbitrate placement transitions and publish normalized outcomes; per-topic data remains in the topic store and repair data movement remains in `syncEngine`.

### Frame Contract Registry

Introduce a registry beside existing handlers, initially as an instrumentation and validation wrapper. Each registered frame contract declares:

- frame type and protocol/version range;
- canonical schema and capability requirements;
- authentication, admission, and placement-state guard;
- correlation and idempotency rule;
- named owning service and normalized outcome type;
- response/error contract;
- trace/metric fields and retry classification.

Use separate registries by boundary:

- pub/sub and DHT control frames;
- transport hello/auth/session frames;
- WebRTC signalling and mesh-auth frames;
- bridge administration frames.

A single abstraction for every byte crossing every boundary would hide important differences. The registry is a protocol catalogue and migration harness, not a replacement for family expertise.

### Repair and delivery

Expand `syncEngine` from its current bounded policy set (`REPLAY_UP`, `SPLIT_UNION`, `EMPTY_ROOT_PROBE`, `COHORT_REPLICATE`, `UNION_AT_ROOT`, `HANDOFF`, `PUB_DURABLE`) into the sole owner of declared repair/state-transfer policies. Each policy row needs trigger, required state, allowed peer relationship, payload contract, retry/backoff limit, convergence/terminal condition, and metric outcome.

Do not move normal `DELIVER` or seat replay into this engine merely for uniformity. Those hot paths have different latency and ordering obligations. Move them only with an explicit semantic contract, differential trace evidence, and a rollback plan.

## Migration plan and deployment milestones

### Phase 0 — Baseline, inventory, and safety harness

**Deliverables**

- A versioned inventory of public APIs, frame types, durable records, timers, repair emissions, role mutations, and transport capabilities.
- A reliability ledger distinguishing implemented behavior, intended behavior, and known deviations/flakes.
- Golden trace fixtures for join/leave, root claim, split/merge, subscription renewal, handoff, bridge-only bootstrap, mesh-bound operation, duplicate/reordered frame, and teardown.
- A static ownership map: each state field, timer, frame type, and mutation has one proposed owner.

**Exit criteria**

- Existing behavior is characterized before extraction.
- Tests include duplicate, reorder, rejection, cancellation, and teardown—not only happy paths.
- Browser/WebRTC and bridge evidence is recorded alongside simulator evidence.

**Deployment:** none. This is an observability and test-baseline milestone.

### Phase 1 — Contract registry in report/shadow mode

**Changes**

- Register existing frame handlers without changing their business logic.
- Validate schemas/guards in report mode; emit normalized traces and detect ambiguous ownership.
- Create protocol-family contract pages and machine-readable fixtures from the registry.

**Exit criteria**

- Every pub/sub and DHT control frame is catalogued.
- Report mode creates no wire incompatibility and no changed acceptance/rejection behavior.
- Ambiguous handler ownership and undocumented response behavior are resolved or marked as exceptions.

**Milestone M1: testnet observer canary**

Enable registry telemetry only on testnet. Compare traces and success/error distributions against a baseline. Roll back by disabling the wrapper/telemetry flag; no protocol rollback is required.

### Phase 2 — Peer façade decomposition and lifecycle boundaries

**Changes**

- Extract lifecycle, routing, lookup, synaptome, messaging, and persistence services behind the existing `AxonaPeer` façade.
- Define cancellation and ownership of intervals/listeners for every lifecycle service.
- Introduce a versioned persistence envelope with read-old/write-new compatibility where needed.

**Exit criteria**

- Public API and existing wire behavior are unchanged.
- Teardown tests prove no orphan listeners, timers, channels, or stale readiness state.
- Differential traces match Phase 0 for equivalent simulator and real-runtime scenarios.

**Milestone M2: testnet browser/bridge canary**

Canary the extracted façade against browser peers and the bridge. Require mesh-liveness observability—not just bridge connectivity—and a defined rollback to the prior composition.

### Phase 3 — Normalize placement lifecycle

**Changes**

- Define the placement/retention model and transition record.
- Route all root/child/backup mutations through the placement-lifecycle authority.
- Make retention/hosted-topic changes explicit, leaving them orthogonal to placement.
- Add contract guards for illegal transition/frame combinations.

**Exit criteria**

- No direct placement mutation remains outside the authority except explicitly documented bootstrap initialization.
- Transition tables cover normal, duplicate, stale, rejected, reconnect, and eviction cases.
- Mixed-version compatibility is specified before any changed frame semantics.

**Milestone M3: testnet protocol/relay canary**

Run mixed old/new peers, churn, partitions, reconnects, root migration, and stale-state restoration. Advance only when transition telemetry demonstrates convergence and no unbounded retry/repair loop.

### Phase 4 — Complete policy-driven repair ownership

**Changes**

- Move remaining *repair/state-transfer* policy emissions into `syncEngine`, one policy family at a time.
- Add a formal policy-row test suite and bounded retry/terminal outcomes.
- Keep hot delivery separate unless a later explicit design changes that boundary.

**Exit criteria**

- Each repair emission has one policy row and one owner.
- Snapshot/delta/pull/push/handoff behavior is deterministic under duplicate/reorder tests.
- Churn/partition/restore soak evidence has stable convergence and no unexplained flakes.

**Milestone M4: extended testnet soak**

Run long-lived testnet churn, bridge reconnect, mesh repair, root migration, and durable handoff tests. Treat recurring flakes as reliability defects, not waived noise.

### Phase 5 — Normative specification, conformance, and production decision

**Changes**

- Publish the contract registry as the normative wire/API contract, with invariant references and conformance vectors.
- Keep architecture rationale, deployment procedures, and public API reference as separate documents.
- Freeze compatibility/migration policy and create rollback/forward-only migration rules.

**Exit criteria**

- Independent implementation or harness can consume contract fixtures and reach expected outcomes.
- Release candidate passes simulator, Node, browser/WebRTC, bridge, and mixed-version conformance gates.
- Security and deployment owners approve a specific production rollout plan.

**Milestone M5: progressive production canary**

Progressively deploy only after a named decision owner approves it: canary, observe bounded health/convergence indicators, expand, or roll back. Council review informs this decision; it does not replace the deployment decision owner.

## Test, compatibility, and operations rules

### Compatibility

- Preserve public API signatures through the façade during extraction.
- Make wire version/capability negotiation explicit before changing semantic interpretation.
- Use readable old persistence plus versioned new envelopes; provide migration and rollback behavior for durable records.
- Never require simulator-only global knowledge in real transport implementations.

### Required evidence for each milestone

- Unit tests for every policy/transition row.
- Integration tests for authenticated real channels, including browser/WebRTC where the deployed system needs it.
- Differential traces against the Phase 0 baseline.
- Duplicate, replay, reorder, rejection, reconnect, timer cancellation, and teardown cases.
- Metrics for transition outcomes, repair attempts/terminal reasons, registry validation failures, live-mesh counts, and stale-state detection.
- A reviewable rollback condition and owner before deploy.

### Documentation model

Keep four deliberate artifacts:

1. **Architecture rationale:** why the neuromorphic/DHT system is shaped this way.
2. **Normative protocol contract:** frames, states, transition guards, errors, and compatibility.
3. **Public API and deployment reference:** supported integration and operational behavior.
4. **Conformance suite/vectors:** executable interoperable evidence.

Maintain one canonical invariant catalogue, with other documents linking to it rather than restating divergent versions.

## Initial work breakdown

| ID | Initial task | Completion evidence |
|---|---|---|
| REF-0.1 | Inventory frames, state fields, timers, repair emissions, and API surface. | Versioned inventory committed and reviewed. |
| REF-0.2 | Produce golden traces and reliability ledger. | Deterministic fixtures plus known-deviation list. |
| REF-1.1 | Define frame-contract registry types and report-mode wrapper. | Existing-handler shadow traces, no behavior change. |
| REF-2.1 | Extract `PeerLifecycle` with cancellation/teardown tests. | API parity and no leaked resources. |
| REF-2.2 | Extract router/lookup/synaptome/persistence services behind façade. | Differential trace parity. |
| REF-3.1 | Write placement/retention transition table and authority interface. | Row-level normal/negative tests. |
| REF-4.1 | Migrate one repair family at a time to `syncEngine`. | Policy row, trace, and churn evidence per family. |
| REF-5.1 | Generate normative contracts and conformance vectors. | Independent harness consumes fixtures. |

## Council decisions requested

1. Approve the incremental extraction sequence: observe → façade/lifecycle → placement → repair → specification.
2. Confirm that holder/retention remains orthogonal to `ROOT/CHILD/BACKUP` placement.
3. Confirm that the initial contract registry is report/shadow mode rather than an immediate all-frame dispatcher replacement.
4. Choose the testnet milestone decision owner and the concrete health/convergence gates for M1–M5.
5. Assign the document-collation owner after council comments, as requested by David.

## Sources

- `axona-docs/01_neuromorphic_dendritic_architecture.md`
- `axona-docs/history/whitepaper/Neuromorphic-DHT-Architecture.md`
- `axona-docs/architecture/Kernel-Refactor-Analysis-v0.2.md`
- `axona-docs/architecture/Axona-Architecture-v4.59.2-Reconstruction-Audit-and-Roadmap.md`
- `axona-docs/architecture/Axona-Architecture.tex`
- `axona-docs/implementation/N-DHT-refactor-punchlist.md`
- `axona-docs/implementation/NH1-PerNode-Refactor-Plan-v0.71.md`
- `axona-docs/architecture/Orion-Redesign-Plan.md`
- Current source under `axona-protocol/src/`, especially peer, pub/sub, DHT, and transport modules.

