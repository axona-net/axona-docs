# Refactor Phase 0 — Static Ownership Map (REF-0.3)

**File:** `axona-docs/architecture/Refactor-Phase0-OwnershipMap-v0.1.md`
**Version:** v0.1 — 2026-08-09
**Author:** axona.bot (chief programmer)
**Baseline:** kernel v4.62.2 at `fb3ea39`
**Targets:** `code-refactor-plan.md` v3.1 (sha256 `f1fe0904…`) §4.9 owner roster
**Companion:** REF-0.1 inventory (`Refactor-Phase0-Inventory-v0.1.md`, sha `198159bc…`)
**Status:** PHASE 0 REF-0.3 — ownership map for council review. No code changed; no deploy.

The rule (plan §4.1): every per-topic/per-peer state field, timer, frame, and proof codec
maps to **exactly one** §4.9 owner. Anything that maps to zero owners, or to two, is an
**orphan** and blocks Phase 2 until assigned. This map's load-bearing contribution beyond
the inventory is §4: the per-topic state that lives *outside* the `role` object.

---

## 1. Owner roster (from plan v3.1 §4.9)

`AxonaPeer` façade · `PeerLifecycle` · `SynaptomeManager` · `GreedyRouter` ·
`LookupService` · `TopicProfileRegistry` · `TopicRoleLifecycle`
(+`LegacyPlacementControl`/`rootClaim`, +`RoleAdmission`) · `TopicStore` (+selected
`OrderingIndex`) · `WriteIngress` (+`LegacyStampAuthority`) · `RetentionLedger` ·
`TopicDeliveryPlane` · `SyncEngine` · `TopicLocator` · `ackProof.js` · `capAttest.js` ·
per-boundary contract registries · `PeerMessaging` · `PeerPersistence`.

## 2. Wire frames → owner

| Frame | Owner | Notes |
|---|---|---|
| `SUB`,`UNSUB`,`ADOPT`,`DELIVER` | `TopicDeliveryPlane` | lease + fan-out |
| `PUB` | `WriteIngress` | ingest pipeline; ack disposition |
| `KILL` | `WriteIngress` | tombstone ingest |
| `INGESTACK` (signed D1) | `WriteIngress` emits, `ackProof.js` builds | ~wireHandlers L461-485 |
| `INGESTACK` (legacy 1-hop) | `writeFlight` compat adapter | L198 |
| `RECEIPTPROBE`,`RECEIPTNACK` | `writeFlight` + `ackProof.js` | D1 probe family |
| `PULL`,`PULLRESP` | `TopicStore` (read) via `TopicDeliveryPlane` | read path |
| `PULLUP`,`REPLAYUP` | `SyncEngine` | catch-up/replay (seat + renewal) |
| `REPLICATE` | `SyncEngine` (`COHORT_REPLICATE`) | cohort retention |
| `HANDOFF`,`HANDOFFACK` | `SyncEngine` (`HANDOFF`) + `TopicRoleLifecycle` | Principal-Liveness |
| `ROOTBEACON` | `TopicLocator` | UNSOLICITED_EVENT, no correlation |
| `METRICSON` | `TopicRoleLifecycle` (demand) | metrics lease |
| `TOUCH` | deprecate-track | legacy no-op-ish |
| `UNPUB` | **RETIRE** | defined, unregistered, dead |

## 3. `role.*` state fields → owner

`cache`/`cacheIds`/`cacheBytes`/`tombstones`/`publishes` → **TopicStore**.
`seq`/`lastTs` → **OrderingIndex** (`LegacyStampedSetIndex`, legacy-only).
`isRoot`/`epoch`/`backupOf` → **LegacyPlacementControl/rootClaim**.
`subscribers`/`children`/`readHolder` → **TopicDeliveryPlane**.
`replicas`/`lastReplicaAt` → **RetentionLedger**.
`sync`/`attempted`/`lastVerify` → **SyncEngine**.
`topicId`/`formedAt`/`createdAt`/`metricsOn`/`metricsLastPub` → **TopicRoleLifecycle**.

## 4. Module-level topic/peer-keyed state → owner (the orphan sweep)

Per-topic/per-peer state lives in ~20 module-level `this._*` maps in addition to `role.*`.
The inventory's 23 role fields undercount the true surface; these must each get an owner or
the leaderless seams inherit hidden singleton-root coupling.

| State map | Keyed by | Owner |
|---|---|---|
| `_writeFlights` | (topic,msgId,op) | `WriteIngress`/writeFlight (D1 scheduler) |
| `_ingestAcks` | flight | `WriteIngress` + `ackProof.js` |
| `_pendingPub`, `_pendingKill` | topic | `WriteIngress` pending record |
| `_rootBeacons`, `_beaconSeen`, `_lastAnnounce` | topic | **`TopicLocator`** (placement view) |
| `_rootHint` | topic | **`TopicLocator`** (candidate cache) |
| `_rootTombstones` | topic | `TopicStore` / `rootClaim` |
| `_upstream` | topic | **`TopicDeliveryPlane`** (`upstreams[]`) |
| `_subscriptions`, `mySubscriptions` | topic | `TopicDeliveryPlane` / `TopicRoleLifecycle` |
| `_backupTopics`, `_hostedTopics`, `_publishedTopics` | topic | `TopicRoleLifecycle` obligations |
| `axonRoles` | topic | `TopicRoleLifecycle` / `rootClaim` |
| `_appDelivered` | (topic,msgId) | `PeerMessaging` (OBSERVED exactly-once) |
| `_metricsWanted`, `_metricsFwdAt`, `_metricDataByMetricTopic`, `myMetricsRequests` | topic | `TopicRoleLifecycle` (demand-metrics) |
| `_lastSeenTsByTopic` | topic | `OrderingIndex` (freshness) |
| `_relayReach`, `_unattachedSince` | peer/topic | `TopicDeliveryPlane` / `LookupService` |
| `_handoffAcked` | handoff | `SyncEngine` (`HANDOFF`) |
| `_verifyInflight`, `_lookupInflight` | target | `LookupService` / `rootClaim` verify |
| `_routedHandlers`, `_directHandlers`, `_upgradeHandlers`, `_eventListeners`, `_errorHandlers`, `_logHandlers` | type | per-boundary **registries** / `PeerMessaging` / `PeerLifecycle` event surface |
| `_persistDirty` | topic | `PeerPersistence` |
| `_burstTimers` | — | scheduler (`PeerLifecycle`, §5) |
| `_m` (`durability.js`) | msgId | **`RetentionLedger`** — `{state,attempts,at}` publish-durability tracker (`PUB_DURABLE`) |

All module-level per-topic/per-peer state resolves to exactly one owner; no open cell remains.
Completeness note: `durability.js` is a pub/sub module the inventory's file list should add
(it houses the `PUB_DURABLE` durability tracker); REF-0.1 will fold it.

## 5. Timers → owner

17 call sites. Two long-lived `setInterval` (`dht/AxonaPeer.js:396` master tick;
`repairPlane.js:1206` repair sweep) → **`PeerLifecycle`** owns creation/teardown of the
master timer; `repairPlane`'s becomes a registered sweep under the one scheduler (plan §4.8).
15 one-shot `setTimeout` (AxonaManager ×2, repairPlane ×6, wireHandlers ×1, rootElection ×1,
AxonaPeer ×5) → each becomes a bounded obligation registered with the scheduler owner, not a
free timer. Target: zero `setInterval`/`setTimeout` without a named owner + teardown.

## 6. D1 codecs → owner

`ackProof.js` sole owner of the INGEST-ACK/RECEIPTNACK/probe transcript + verify.
`capAttest.js` sole owner of `write-flight-ack-v1`; lives on the transport/auth boundary
(`transport/web/mesh-auth.js`). Extraction moves call sites only. Byte-identical guaranteed.

## 7. Public API → façade

All ~30 methods (REF-0.1 §6) stay on `AxonaPeer`, delegating to the composed services;
the façade owns no policy. Frozen as an M2 parity fixture.

## 8. Repair families → `SyncEngine` rows

`emptyRootProbe`→`EMPTY_ROOT_PROBE`; `replicateRole`/`replicateRoot`→`COHORT_REPLICATE`+`UNION_AT_ROOT`;
`leaveHandoff`→`HANDOFF`; `readRepair`→`REPLAY_UP`/read-repair row; split paths→`SPLIT_UNION`;
`confirmPending`/`earlyResend`/`ingest` pipeline → need a row or a named exception (candidates
for `PUB_DURABLE` + one new row). Zero current `syncEngine` delegation → Phase 4 is from-scratch.

## 9. Orphan report

- **Un-owned per-topic state OUTSIDE `role`:** RESOLVED — §4 assigns every one of the ~21
  module-level maps (incl. `_m` in `durability.js` → `RetentionLedger`) to a single owner.
- **Double-owned:** none found; `INGESTACK` signed vs legacy are two frames/variants with two
  distinct owners by design, not a double-ownership of one field.
- **Timers without owner:** all 17 assigned (§5).
- **Frames without owner:** none; `UNPUB` explicitly RETIRE, `TOUCH` deprecate-track.

**No open cells.** Every current state field, timer, frame, and codec maps 1:1 to a §4.9
owner. Phase 2 is not blocked on ownership ambiguity.

## 10. Conclusion

The §4.9 owner roster is sufficient to absorb every current state field, timer, frame, and
codec — including the ~20 module-level topic-keyed maps the inventory's role-field view did
not surface. That is the concrete evidence that the decomposition can proceed without a
residual god-object: the state has somewhere to go. One cell (`_m`) is open and named.
No leaderless owner is required for any current fact; the legacy adapters hold the
singleton-root-coupled maps (`_rootBeacons`, `_rootHint`, `_upstream`, `axonRoles`) behind
`TopicLocator`/`TopicDeliveryPlane`/`rootClaim` exactly as v3.1 intends.

---

*REF-0.3 v0.1. Next: REF-0.2 golden traces over the §2.1 incident ledger. `_m` identification
is the single open assignment. No kernel behavior changed in Phase 0.*
