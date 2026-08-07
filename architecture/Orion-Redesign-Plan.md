# Comprehensive Neuromorphic Protocol Architecture & Restructuring Plan

**Author:** Orion (Council Scribe & Protocol Reviewer)  
**Date:** August 7, 2026  
**Document Location:** `axona-docs/architecture/Orion-Redesign-Plan.md`  
**Target Repository:** `@axona/protocol` (`v4.61.0+`), `@axona/bridge`, `@axona/relay`  
**Status:** PROPOSED — Submitted for Council Review & Response Synthesis  

---

## 1. Executive Summary & Problem Context

Over successive feature additions, bug fixes, and patch cycles (from Kernel v4.19 through v4.61.0), the `@axona/protocol` codebase has accreted significant operational complexity. While individual patches—such as root claim consolidation (v4.20.0), in-band TURN refresh (v4.60.1), and connect-time mesh-reachability gating (v4.61.0)—were individually tested and effective, the structural surface area of the codebase has expanded rather than consolidated.

### 1.1 The "Patch-on-Patch" Accretion Symptom
* **Monolithic Core (`AxonaPeer.js`):** The primary DHT and peer entry-point file has grown to **207 KB (~5,200 lines)**, combining transport management, lookup loops, routing tables, event emitters, session persistence, and pub/sub orchestration into a single class.
* **Scattered Pub/Sub Mechanics:** The `src/pubsub/` layer comprises **19 separate files**, including `repairPlane.js` (73 KB), `AxonaManager.js` (64 KB), and `wireHandlers.js` (57 KB).
* **Asymmetrical Message Dispatch:** Wire messages are handled through non-symmetrical, imperative `switch/case` and `if/else` checks across multiple files. Handler registration, validation, rate limiting, and response routing are spread across different layers without a single pattern-matching contract.
* **Unmodeled Interactions:** Previous incidents (such as GH #333 backbone collapse and GH #44 TURN credential timeouts) resulted from unexpected interactions between individually correct repair mechanisms (e.g., departure spray vs. backup subscription loops).

### 1.2 Core Objective of the Restructuring
The goal of this refactoring is **not mere code golfing or file splitting**, but a fundamental structural realignment:
1. **Symmetrical Pattern Matching:** Replace imperative, asymmetrical wire dispatch and state transitions with a declarative, bi-directional pattern-matching engine.
2. **Unified Data Operation (`Sync Engine`):** Consolidate 11 distinct data-movement and history-repair mechanisms into a single summary-exchange sync engine (`sync(a, b, topic)`).
3. **Strict 4-Layer Separation:** Enforce clean architectural boundaries between Transport/Identity, Routing/DHT, Control/Claim State Machines, and Pub/Sub Data Sync.
4. **Zero-Downtime Incremental Deployment:** Structure the refactoring into self-contained, test-fenced milestones that can be independently verified on testnet before production promotion.

---

## 2. Neuromorphic System Architecture Review

To restructure the system cleanly, we draw directly upon the core design principles established in `01_neuromorphic_dendritic_architecture.md` and the previous root-claim consolidation (`Kernel-Refactor-Analysis-v0.2.md`).

```
 +-----------------------------------------------------------------------+
 |                     Application / API Layer                           |
 |          (sub, pub, pull, unpub, connect, initialBridgeOnly)          |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                       Layer 4: Pub/Sub Data Sync                      |
 |         (Declarative Sync Engine, Topic Store, Replicated Sets)       |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                    Layer 3: Control & Claim Plane                     |
 |        (Root Claim FSM, Role Lifecycle, Election & Deferral)          |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                    Layer 2: Neuromorphic DHT Routing                  |
 |       (S2 Geo-Kademlia, Synaptome, NeuronNode, Greedy Router)         |
 +-----------------------------------------------------------------------+
                                     |
 +-----------------------------------------------------------------------+
 |                  Layer 1: Transport & Cryptography                    |
 |      (Ed25519 Identity, Noise/WebRTC/WS Transports, Frame Codec)      |
 +-----------------------------------------------------------------------+
```

### 2.1 The Neuromorphic DHT Foundation
The underlying DHT differs fundamentally from static Kademlia by treating network connections as **dendritic synapses** (`Synapse.js`) attached to a neuron (`NeuronNode.js`).
* **Dynamic Rewiring:** Connections adjust dynamically based on traffic frequency and geographical proximity (S2 spatial prefixes).
* **Synaptome Abstraction:** The active routing table (`synaptome`) manages live, authenticated WebRTC channels (`meshBoundCount()`).
* **Separation of Identity:** Transport Node ID (ephemeral, IP/port bound) is strictly decoupled from Author Content Identity (Ed25519 public key signed envelopes).

### 2.2 Dendritic Tree Fanout
Topics map to the DHT key space. When a topic's subscriber count exceeds a relay node's capacity:
1. The root relay delegates subscriber cohorts to Level 2 branch nodes.
2. Branch nodes recursively delegate to Level 3 nodes.
3. Messages fan out along the dendritic tree, ensuring $O(\log N)$ distribution without overloading any single relay.

### 2.3 The Single Data Operation: `sync(a, b, topic)`
As diagnosed in `Kernel-Refactor-Analysis-v0.2.md`, all historical data movement mechanisms (fan-out, replay-on-subscribe, hw replay-up, lw split-union pull, empty-root probe, cohort replication, handoff) are specific policy instances of a single fundamental operation:
$$\text{sync}(A, B, T) \implies \text{converge views of stamped set } T \text{ between nodes } A \text{ and } B$$

Every topic's state is a **stamped set** (cache entries totally ordered by root stamps plus tombstones). Two nodes compare high-water/low-water signatures; if signatures differ, missing deltas are transferred and union-ingested (`_ingestStamped`).

---

## 3. Proposed System Restructuring & Redesign Plan

### 3.1 Principle 1: Symmetrical Pattern-Matching Wire Engine (`WirePatternEngine`)

Currently, incoming network frames are inspected using disjoint `switch` statements and `if/else` checks across `AxonaPeer.js`, `wireHandlers.js`, and `repairPlane.js`. 

We propose replacing this with a **declarative, symmetrical pattern-matching dispatcher**:

```javascript
// Example: Symmetrical Pattern Matching Dispatcher
class WirePatternEngine {
  constructor() {
    this._patterns = new Map();
  }

  register({ type, stateGuard, schema, handler }) {
    this._patterns.set(type, { stateGuard, schema, handler });
  }

  dispatch(peerContext, frame) {
    const pattern = this._patterns.get(frame.type);
    if (!pattern) return Verdict.REJECT_UNKNOWN_TYPE;
    
    // 1. Schema Validation & Input Budget Cap Check
    const valResult = pattern.schema.validate(frame.payload);
    if (!valResult.ok) return Verdict.REJECT_MALFORMED;

    // 2. Role / State Machine Guard Check
    if (pattern.stateGuard && !pattern.stateGuard(peerContext, frame)) {
      return Verdict.DEFER_OR_REJECT_STATE;
    }

    // 3. Symmetric Execution & Automatic Response Envelope Minting
    return pattern.handler(peerContext, frame.payload);
  }
}
```

#### Key Benefits of Pattern Matching:
* **Symmetry:** Every outbound request frame corresponds 1:1 with an inbound pattern matcher enforcing identical validation, rate-limiting, and error-verdict rules.
* **No Unhandled Traps:** Malformed or out-of-order frames match explicit fallback handlers rather than dropping silently or causing unhandled promise rejections.
* **Self-Documenting Registry:** The pattern registry serves as the executable wire specification for independent implementers.

### 3.2 Principle 2: Unified Sync Engine (`SyncEngine.js`)

Consolidate the 11 scattered data-movement mechanisms in `repairPlane.js` and `wireHandlers.js` into a declarative `SyncEngine`:

| Policy Name | Initiator $\leftrightarrow$ Target | Trigger Condition | Sync Direction | Quench / Delta Rule |
|---|---|---|---|---|
| `FANOUT` | Root $\to$ Subscribers | On new message stamp | Push | Delta ($N=1$) |
| `REPLAY_SUB` | Root $\to$ Child | On SUB / renewal | Push | Since-floor delta |
| `PULLUP_HW` | Root $\gets$ Child | Child advertises $HW > mine$ | Pull | Delta fetch |
| `PULL_LW_UNION`| Root $\gets$ Child | Child advertises $LW < mine$ | Pull | Full history union |
| `COHORT_REPL` | Root $\to$ Cohort ($K$-closest) | Periodic tick / delta | Push | Signature mismatch |
| `HANDOFF` | Departing Root $\to$ Heir | On `leave()` | Acked Push | Full state transfer |

By routing all data transfers through `SyncEngine`, signature equality ($count : hw : tombstones$) acts as a universal quench rule, preventing broadcast storms and infinite replication loops.

### 3.3 Principle 3: Explicit 4-State Role Lifecycle (`RoleLifecycle.js`)

Replace the scattered boolean flags (`isRoot`, `backupOf`, `_hostedTopics`) with an explicit Finite State Machine for topic roles:

$$\text{Role State} \in \{ \text{ROOT}, \text{CHILD}, \text{BACKUP}, \text{HOLDER} \}$$

```
    +--------+    Demote / Closer Root    +-------+
    |        | -------------------------> |       |
    |  ROOT  |                            | CHILD |
    |        | <------------------------- |       |
    +--------+       Root Election        +-------+
      |    ^                                  ^
      |    | Evict Standby                    | Promote
      v    |                                  v
    +--------+    Principal Departure     +-------+
    | BACKUP | -------------------------> | HOLDER|
    +--------+                            +-------+
```

#### Mandatory Architectural Law: Principal-Liveness Rule
> **Standing state on a remote node may only be planted by a principal that is alive to maintain it.** A departing node must perform an acknowledged `HANDOFF` or do nothing. It must NEVER plant unmaintained standing state (`REPLICATE`) on peers. Every mechanism that creates remote state MUST specify its exact eviction path in the same module.

### 3.4 Principle 4: Monolithic File Decomposition

We propose modularizing `@axona/protocol` into small, focused single-responsibility files:

#### Breakdown of `AxonaPeer.js` (207 KB $\to$ Clean Module Core)
* `src/dht/AxonaPeer.js` (Slim Entry Facade & Event Hub, $< 30\text{ KB}$)
* `src/dht/GreedyRouter.js` (2-hop escape, 40-hop exhaustion, greedy routing)
* `src/dht/KademliaLookup.js` ($\alpha$-parallel $K$-closest search engine)
* `src/dht/SynaptomeManager.js` (Synapse lifecycle, mesh bound channel counting)
* `src/dht/PeerSessionPersistence.js` (Snapshot serialization & restoration)

#### Breakdown of `repairPlane.js` & `wireHandlers.js`
* `src/pubsub/WirePatternEngine.js` (Declarative frame pattern matcher)
* `src/pubsub/SyncEngine.js` (Unified data operation engine)
* `src/pubsub/RoleLifecycle.js` (Role FSM state machine)
* `src/pubsub/DurabilityTracker.js` (Cohort evidence & ack monitoring)

---

## 4. Implementation Roadmap & Deployment Milestones

To ensure system safety and zero disruption to the running testnet, refactoring will execute in **4 sequential phases**. Each phase includes strict verification criteria and explicit deployment boundaries.

```
 +-----------------------------------------------------------------------+
 | Phase 1: Architectural Foundation & Pattern Engine (Non-breaking)    |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 2: DHT & Router Decomposition (AxonaPeer.js Modularization)     |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 3: Unified SyncEngine & Role Lifecycle Integration              |
 +-----------------------------------------------------------------------+
                                     |
                                     v
 +-----------------------------------------------------------------------+
 | Phase 4: Final Validation, Normative Spec & Production Rollout        |
 +-----------------------------------------------------------------------+
```

### Milestone 1: Pattern Engine & Wire Registry Foundation
* **Target Components:** `src/pubsub/WirePatternEngine.js`, `src/pubsub/wireRegistry.js`.
* **Deliverables:**
  1. Implement declarative `WirePatternEngine` for all routed frames (`route_msg`, `pubsub:pullresp`, `ROOTBEACON`, etc.).
  2. Map existing `wireHandlers.js` functions into symmetrical pattern definitions.
  3. Validate against existing protocol unit test suite.
* **Verification & Deploy Checkpoint:**
  * **Automated Test Suite:** 100% pass rate on `npm test` (137/137 kernel tests).
  * **Deployment Target:** Unit test & local simulator. No network release required.

### Milestone 2: DHT Router & Synaptome Decomposition (`AxonaPeer.js` Modularization)
* **Target Components:** `src/dht/AxonaPeer.js` $\to$ `GreedyRouter.js`, `KademliaLookup.js`, `SynaptomeManager.js`.
* **Deliverables:**
  1. Extract routing and lookup loops into isolated modules.
  2. Implement `SynaptomeManager.meshBoundCount()` as the primary live WebRTC channel provider.
  3. Preserve all `AxonaPeer` public API method signatures (`sub`, `pub`, `pull`, `connect`, `fromSnapshot`).
* **Verification & Deploy Checkpoint:**
  * **Automated Test Suite:** Full DHT lookup suite, greedy routing tests, `smoke_connect_mesh_gate.mjs` (16/16 passed).
  * **Deployment Target:** **Testnet Droplet Relay & Bridge Canary (`axona-bridge` v2.109.0-testnet)**.
  * **Canary Criteria:** 15-minute observation window: zero routing loops, memory usage flat, WebRTC channel counts stable.

### Milestone 3: Unified Sync Engine & Role Lifecycle Integration
* **Target Components:** `src/pubsub/SyncEngine.js`, `src/pubsub/RoleLifecycle.js`, `src/pubsub/repairPlane.js`.
* **Deliverables:**
  1. Replace 11 scattered data-movement loops with single `SyncEngine.sync()` calls driven by declarative policy rows.
  2. Implement `RoleLifecycle` FSM (`ROOT`, `CHILD`, `BACKUP`, `HOLDER`) and enforce Principal-Liveness Rule (no departure `REPLICATE` without `HANDOFF`).
  3. Integrate `initialBridgeOnly` snapshot naming.
* **Verification & Deploy Checkpoint:**
  * **Automated Test Suite:** `smoke_churn_amplification.mjs`, `smoke_turn_cred_refresh.mjs`, `smoke_root_replication.mjs`.
  * **Deployment Target:** **Testnet Droplet Infrastructure (`axona-protocol` v4.62.0-testnet)**.
  * **Canary Criteria:** Churn simulation under 50% simulated node drops; verify no orphaned backups or orphan storage accumulation.

### Milestone 4: Final Normative Audit, Post-Mortem & Production Promotion
* **Target Components:** `axona-docs/architecture/code-refactor-plan.md`, Normative Protocol Specification.
* **Deliverables:**
  1. Conduct full Council post-mortem on Phase 1–3 testnet telemetry.
  2. Publish companion Normative Protocol Specification checked against implementation truth.
  3. Collate Council review feedback into final `code-refactor-plan.md`.
* **Verification & Deploy Checkpoint:**
  * **Dual Council Review:** Machine-readable approval from Council reviewers (Aster & Orion).
  * **Deployment Target:** **Production Fleet Release (`v5.0.0`)**, approved by David.

---

## 5. Council Review Questions & Open Discussion Points

To ensure alignment before commencing implementation, I invite feedback from Aster, `axona.bot`, and David on the following points:

1. **Wire Pattern Matching:** Do you support enforcing strict schema validation and pattern matching at ingress, or should legacy un-schematized frames be accepted with warnings during the migration period?
2. **Sync Engine Policy Table:** Are there any additional data-movement edge cases (e.g., cross-region bridge syncs) that should be added as explicit rows in the `SyncEngine` policy table?
3. **Role Lifecycle Eviction:** Does the proposed `BACKUP_EVICT_MS` timeout sufficiently protect against network partitions, or should backup eviction require explicit DHT root re-verification?

---

*Submitted to Council by Orion.*
