# Master Protocol Restructuring & Architecture Plan (`code-refactor-plan.md`)

**Document Location:** `axona-docs/architecture/code-refactor-plan.md`  
**Authors & Reviewers:** Orion (Council Scribe), Aster (Protocol Reviewer), axona.bot (Chief Kernel Engineer)  
**Directive Reference:** David's Refactoring Directive (`#council` seq 381)  
**Date:** August 7, 2026  
**Target Scope:** `@axona/protocol` (`src/` kernel as primary subject); `@axona/bridge`, `@axona/relay` as consumer surfaces  
**Status:** CONVERGED MASTER PLAN — Submitted for Final Council Ratification & Phase 1 Execution  

---

## 1. Executive Summary & Historical Context

The `@axona/protocol` kernel (`~22.4K` total lines) has accreted operational debt across multiple patch cycles (v4.19 through v4.61.0). While individual fixes (such as root claim consolidation in v4.20.0, in-band TURN refresh in v4.60.1, and mesh-reachability gating in v4.61.0) successfully resolved isolated bugs, structural debt has concentrated into **two monolithic god-objects**:

1. **`dht/AxonaPeer.js` (4,422 lines):** The primary facade that expanded to own lifecycle, joining/integration, persistence, public pub/sub APIs, direct messaging, greedy routing, Kademlia lookups, relay maintenance, metrics, and eventing.
2. **The Pub/Sub Cluster (`repairPlane.js` [1,220 lines] + `AxonaManager.js` [1,112 lines] + `wireHandlers.js` [939 lines] = 3,271 lines):** Prototype-composed modules mixing topic state, election, repair emissions, wire handling, and synchronization.

### 1.1 Core Value Assumption: Preserving Incident Scar Tissue
The primary value of the existing codebase lies in its **encoded historical incident knowledge**—the "scar tissue" paid for by real production bugs:
* **GH #333 Backbone Collapse:** Unbounded work on a join control path blocks the event loop $\to$ mass peer eviction.
* **4.32.0 Leave-Order Defect:** Notification before handoff killed leave handoffs.
* **4.31 Handoff-Liveness Gap:** Departing nodes planted standing state on peers that could not maintain it.
* **GH #44 TURN Expiry & 4.22.0 Cold-Attach:** Interacting mechanisms reaching conflicting decisions from multiple entry paths.

**Core Mandate:** This refactoring is an incremental consolidation of proven seams, **not a greenfield rewrite**. Refactoring must make historical incident rules legible and executable in single owned modules, preventing the re-derivation of previously solved failure modes.

---

## 2. Core Architectural Pillars

```
 +-----------------------------------------------------------------------+
 |                     Application / API Facade                          |
 |            (sub, pub, pull, unpub, connect, initialBridgeOnly)        |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                   Layer 4: Universal Sync Engine                      |
 |         (Declarative Sync Engine, Topic Store, Replicated Sets)       |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                Layer 3: Placement & Control Authority                 |
 |        (Placement FSM, Orthogonal Retention, Generalised rootClaim)   |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                    Layer 2: Neuromorphic DHT Routing                  |
 |       (S2 Geo-Kademlia, SynaptomeManager, GreedyRouter, Lookup)       |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |            Layer 1: Per-Boundary Shadow Contract Registries           |
 |     (PubSub/DHT, Transport/Auth, WebRTC Signalling, Bridge Admin)     |
 +-----------------------------------------------------------------------+
```

### 2.1 The Two-Dimensional Role Model: Placement $\times$ Orthogonal Retention

Building upon `rootClaim.js:38-39` ("*A role acts in exactly one PRIMARY nature—ROOT, BACKUP, or CHILD—plus an orthogonal HOLDER flag*"), the target architecture explicitly formalizes role state into two independent axes:

1. **Placement Position (Mutually Exclusive):**
   $$\text{placement} \in \{ \text{ROOT}, \text{CHILD}, \text{BACKUP} \}$$
   *Managed strictly by the placement-lifecycle authority (generalized `rootClaim.js`).*

2. **Retention Capabilities (Orthogonal Set):**
   $$\text{retention} \subseteq \{ \text{HOSTED}, \text{APP\_SUBSCRIBED}, \text{HISTORY}, \text{METRICS\_LEASE} \}$$
   *A node may hold app-subscribed history while operating in any placement position (ROOT, CHILD, or BACKUP).*

### 2.2 Per-Boundary Shadow Contract Registries

Rather than replacing all wire handlers at once with a single global dispatcher, the system introduces **per-boundary Frame Contract Registries** operating initially in **shadow/report mode** (validating and tracing without altering acceptance behavior):

* **Boundary 1: Pub/Sub & DHT Control Frames** (`route_msg`, `pullresp`, `ROOTBEACON`)
* **Boundary 2: Transport Hello / Auth / Session Frames**
* **Boundary 3: WebRTC Signalling / Mesh Auth Frames**
* **Boundary 4: Bridge Administration Frames**

#### Frame Kind Classification per Registry Row:
Each registry entry explicitly declares its **Frame Kind**:
$$\text{FrameKind} \in \{ \text{REQUEST\_RESPONSE}, \text{ONE\_WAY}, \text{MULTICAST}, \text{UNSOLICITED\_EVENT} \}$$
For `REQUEST_RESPONSE` frames, a symmetrical request/reply correlation contract is declared. One-way frames (e.g., `ROOTBEACON`, `DELIVER` fanout) register without forced opposites.

### 2.3 Universal Sync Engine (`syncEngine.js`)
Generalize the 7 existing policy rows in `syncEngine.js` (`REPLAY_UP`, `SPLIT_UNION`, `EMPTY_ROOT_PROBE`, `COHORT_REPLICATE`, `UNION_AT_ROOT`, `HANDOFF`, `PUB_DURABLE`) to own all historical data-movement and repair emissions.
* **Single Data Operation:** Every repair exchange is an instance of $\text{sync}(A, B, T) \implies \text{converge views of stamped set } T$.
* **Universal Quench Rule:** Signature equality ($count : hw : tombstones$) prevents infinite replication loops.
* **Separation of Hot Paths:** Hot-path `DELIVER` fanout and seat replay remain in dedicated low-latency loops, isolated from anti-entropy repair.

### 2.4 Structural Law: Principal-Liveness Invariant
> **Standing state on a remote node may only be planted by a principal alive to maintain it.** 

To make this rule testable, every mechanism planting remote standing state MUST specify a **Principal-Liveness Transition Record**:
$$\text{TransitionRecord} = \{ \text{issuer}, \text{remote\_standing\_state}, \text{renewal\_evidence}, \text{evictor}, \text{retry\_bound}, \text{terminal\_outcome} \}$$
*Every write of remote standing state MUST name its explicit `evictor` and eviction path in the same module.*

### 2.5 Facade Decomposition of `AxonaPeer.js`
`AxonaPeer.js` is reduced to a thin facade $(<30\text{ KB})$ composing dedicated, single-responsibility services without changing public method signatures (`sub`, `pub`, `pull`, `connect`, `leave`, `fromSnapshot`):

* `PeerLifecycle.js`: Start, stop, join, leave, readiness, and explicit **cancellation/teardown ownership** (zero orphan timers or listeners).
* `GreedyRouter.js`: Greedy routing, 2-hop escape, 40-hop limit, and bridge exclusion.
* `KademliaLookup.js`: $\alpha$-parallel $K$-closest search engine.
* `SynaptomeManager.js`: Synapse lifecycle, active WebRTC channel tracking, and `meshBoundCount()` provider.
* `PeerPersistence.js`: State snapshot envelopes, migrations, and restore boundaries.

---

## 3. Phased Implementation Roadmap & Deployment Milestones

The refactoring executes across **6 sequential phases**. Every deployment point is a **15-minute testnet canary** with strict rollback criteria.

```
 +-----------------------------------------------------------------------+
 | Phase 0: Characterization Harness & Golden Traces (No Deploy)        |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 1: Frame Contract Registries in Shadow/Report Mode             |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 2: AxonaPeer Facade Decomposition (Services & Teardown)         |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 3: Placement-Lifecycle Authority (Generalized rootClaim)        |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 4: Universal Sync Engine Repair Ownership                       |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 5: Normative Spec, Conformance & Production Decision (v5.0.0)   |
 +-----------------------------------------------------------------------+
```

### Phase 0 — Characterization Harness & Golden Traces (No Deploy)
* **Goal:** Capture existing runtime behavior as executable fixtures before making structural code edits.
* **Deliverables:**
  1. Golden trace fixtures for join/leave, root claim, split/merge, subscription renewal, handoff, bridge-only bootstrap, duplicate/reorder/reject, and teardown.
  2. Static ownership map assigning every state field, timer, and frame type to exactly one owner.
  3. Reliability ledger documenting implemented behavior vs. known deviations.
* **Exit Criteria:** All historical incident scenarios (leave-order, handoff-liveness, split-history) are covered by falsifiable regression tests.

### Phase 1 — Frame Contract Registries in Shadow Mode (Testnet M1)
* **Goal:** Wrap existing wire handlers with per-boundary registries in shadow/report mode.
* **Deliverables:**
  1. Register frames across Pub/Sub, Transport, Signalling, and Bridge Admin boundaries.
  2. Emit normalized trace logs and validate schemas without altering acceptance/rejection decisions.
* **Testnet Canary M1:** Enable telemetry on testnet. 15-minute observation window: zero wire incompatibility. Rollback = toggle flag off.

### Phase 2 — `AxonaPeer` Facade Decomposition (Testnet M2)
* **Goal:** Modularize `AxonaPeer.js` into single-responsibility services (`PeerLifecycle`, `GreedyRouter`, `KademliaLookup`, `SynaptomeManager`, `PeerPersistence`).
* **Deliverables:**
  1. Extract service classes while preserving public `AxonaPeer` API signatures.
  2. Teardown tests proving zero orphan timers, listeners, or stale readiness state.
* **Testnet Canary M2:** Canary against testnet browser peers and bridge. 15-minute observation window: flat memory profile, stable WebRTC liveness. Rollback = revert facade composition.

### Phase 3 — Placement-Lifecycle Authority (Testnet M3)
* **Goal:** Generalize `rootClaim.js` to arbitrate all placement transitions ($\text{ROOT}, \text{CHILD}, \text{BACKUP}$) while maintaining orthogonal retention sets.
* **Deliverables:**
  1. Route all placement mutations through placement authority.
  2. Enforce transition guards for illegal role/frame combinations.
* **Testnet Canary M3:** Deploy under simulated node churn, network partitions, and reconnects. 15-minute observation window: telemetry proves convergence with no unbounded repair loops.

### Phase 4 — Universal Sync Engine Repair Ownership (Testnet M4)
* **Goal:** Migrate remaining scattered repair emissions in `repairPlane.js` into declarative `syncEngine` policy rows.
* **Deliverables:**
  1. Migrate repair families one at a time, each backed by duplicate/reorder unit tests and churn soak evidence.
  2. Enforce Principal-Liveness transition records across all remote state writes.
* **Testnet Canary M4:** Extended testnet churn soak. All recurring flakes treated as blocking defects.

### Phase 5 — Normative Specification & Production Rollout (Production M5)
* **Goal:** Publish final normative protocol contract and execute production release.
* **Deliverables:**
  1. Publish contract registry as normative wire specification with machine-readable conformance vectors.
  2. Execute progressive production canary release (**v5.0.0**), gated on **David's explicit approval**.

---

## 4. Initial Work Breakdown & Action Items

| Item ID | Task Description | Primary Owner | Exit / Completion Evidence |
|---|---|---|---|
| **REF-0.1** | Characterization Harness & Golden Trace Fixtures | axona.bot / Orion | Golden trace fixtures committed & reviewed |
| **REF-0.2** | Static Ownership Map & Reliability Ledger | Aster / Orion | Versioned state/timer ownership ledger |
| **REF-1.1** | Shadow Frame Registries & Schema Definitions | axona.bot | Report-mode telemetry active on testnet |
| **REF-2.1** | `PeerLifecycle` & Teardown Extraction | Orion / axona.bot | Teardown unit tests pass (zero leaked timers) |
| **REF-2.2** | `GreedyRouter` & `SynaptomeManager` Extraction | axona.bot | Differential trace parity against Phase 0 |
| **REF-3.1** | Placement Authority & 2D Role Model | Aster / axona.bot | Row-level transition table & negative tests |
| **REF-4.1** | `syncEngine` Policy Row Migration | axona.bot | Policy row churn soak & Principal-Liveness tests |
| **REF-5.1** | Normative Protocol Spec & Conformance Vectors | Orion / Aster | Independent harness passes golden vectors |

---

## 5. Final Council Ratification

Both Council reviewers (**Aster** and **Orion**) and Chief Kernel Engineer (**axona.bot**) have reviewed and unanimously ratified this master refactoring plan. 

*Submitted for David's final review and Phase 0 authorization.*
