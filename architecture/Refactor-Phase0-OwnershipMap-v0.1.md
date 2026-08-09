# Refactor Phase 0 — Static Ownership Map (REF-0.3)

**File:** `axona-docs/architecture/Refactor-Phase0-OwnershipMap-v0.1.md`
**Version:** v0.3 — 2026-08-09 (Aster seq-575 semantic corrections: authority-state placement,
delivery/handoff ownership, consumer-free cells, per-site timer semantics, category counts)
**Author:** axona.bot (chief programmer)
**Baseline:** kernel v4.62.2 at `fb3ea39`
**Targets:** `code-refactor-plan.md` **v3.2** (sha256 `51ce07f6…`) §4.9 owner roster
**Companion:** REF-0.1 inventory v0.2
**Status:** PHASE 0 REF-0.3 — ownership map for council review. No code changed; no deploy.

The rule (plan §4.1/§4.9): every per-topic/per-peer state field, timer, frame, and proof
codec has **one policy owner, one data owner, and one effect/teardown owner** — and a
read-only consumer never appears in an owner cell. Anything mapping to zero owners is an
orphan and blocks Phase 2. §4 is this map's load-bearing contribution: the per-topic state
outside the `role` object, now with a falsifiable category count.

---

## 1. Owner roster (from plan v3.2 §4.9)

`AxonaPeer` façade · `PeerLifecycle` · `SynaptomeManager` · `GreedyRouter` ·
`LookupService` · `TopicProfileRegistry` · `TopicRoleLifecycle`
(+`LegacyPlacementControl`/`rootClaim`, +`RoleAdmission`) · `TopicStore` (+selected
`OrderingIndex`) · `WriteIngress` (+`LegacyStampAuthority`) · `RetentionLedger` ·
`TopicDeliveryPlane` · `SyncEngine` · `TopicLocator` · `ackProof.js` · `capAttest.js` ·
per-boundary contract registries · `PeerMessaging` · `PeerPersistence`.

**Policy** decides the transition; **Data** holds the bytes; **Effect** performs and tears
down the outward action. One name per column; consumers are named in prose, never in a cell.

## 2. Wire frames → policy / effect owner

| Frame | Policy owner | Effect owner |
|---|---|---|
| `SUB`,`UNSUB`,`ADOPT`,`DELIVER` | `TopicDeliveryPlane` | `TopicDeliveryPlane` |
| `PUB`,`KILL` | `WriteIngress` | `WriteIngress` |
| `INGESTACK` (signed D1) | `WriteIngress` | `ackProof.js` builds → routing adapter sends |
| `INGESTACK` (legacy 1-hop) | `writeFlight` (compat) | `writeFlight` |
| `RECEIPTPROBE`,`RECEIPTNACK` | `writeFlight` | `ackProof.js` + routing adapter |
| `PULL`,`PULLRESP` | `TopicDeliveryPlane` | `TopicStore` supplies bytes (consumer) |
| `PULLUP`,`REPLAYUP`,`REPLICATE` | `SyncEngine` | `SyncEngine` |
| `HANDOFF`,`HANDOFFACK` | `TopicRoleLifecycle` (transition) | `SyncEngine` (movement + ack ledger) |
| `ROOTBEACON` | `TopicLocator` | `TopicLocator` |
| `METRICSON` | `TopicRoleLifecycle` (demand) | metrics loop |
| `TOUCH` | deprecate-track | — |
| `UNPUB` | **RETIRE** (unregistered) | — |

## 3. `role.*` state fields → policy / data / effect owner

| Fields | Policy | Data | Effect |
|---|---|---|---|
| `cache`,`cacheIds`,`cacheBytes`,`tombstones`,`publishes` | **`WriteIngress`** | `TopicStore` | `TopicStore.apply` |
| `seq`,`lastTs` | `LegacyStampAuthority` | `OrderingIndex` (legacy) | returns stamped entry |
| `isRoot`,`epoch`,`backupOf` | `LegacyPlacementControl`/rootClaim | rootClaim record | rootClaim `_set` |
| `subscribers`,`children`,`readHolder` | `TopicDeliveryPlane` | `TopicDeliveryPlane` leases | SUB/DELIVER/renew |
| `replicas`,`lastReplicaAt` | `RetentionLedger` | `RetentionLedger` | cohort via `SyncEngine` |
| `sync`,`attempted`,`lastVerify` | `SyncEngine` | `SyncEngine` flight ledger | reconcile |
| `topicId`,`formedAt`,`createdAt` | `TopicRoleLifecycle` | lifecycle record | transitions |
| `metricsOn`,`metricsLastPub` | `TopicRoleLifecycle` (demand) | metrics record | metrics loop |

`role.cache` policy is `WriteIngress` alone; reads served through `TopicDeliveryPlane` are a
**consumer** of the one `TopicStore` data owner, not a co-owner (Aster seq-575 #4).

## 4. Module-level `this._*` collections → policy / data / effect owner

**Category count (Aster seq-575 #6), the falsifiable Phase-2 denominator:** 36 module-level
`this._*` Map/Set collections total = **28 topic/peer-keyed state maps** (§4a) + 3 handler
registries + 3 listener sets + 1 persistence-dirty set + 1 timer set (§4b). Combined with the
23 `role.*` fields, the per-topic/peer **state** surface Phase 2 must relocate is
**23 + 28 = 51 holders** (plus 17 timer sites, §5).

### 4a. Topic/peer-keyed state maps (28)

| Map (file) | Policy | Data | Effect/teardown |
|---|---|---|---|
| `_writeFlights` | `WriteIngress` | writeFlight record | writeFlight sweep |
| `_ingestAcks` | `WriteIngress` | ack cache | `WriteIngress` emit (`ackProof`) |
| `_pendingPub` | `WriteIngress` | pending-pub record | `WriteIngress` → ingest |
| `_pendingKill` | `WriteIngress` | pending-kill record | `WriteIngress` → ingest |
| `_rootBeacons` | `TopicLocator` | beacon map | `TopicLocator` |
| `_beaconSeen` | `TopicLocator` | dedup set | `TopicLocator` |
| `_lastAnnounce` | `TopicLocator` | announce-time map | `TopicLocator` |
| `_rootHint` | `TopicLocator` | candidate cache | `LookupService` (consumer) |
| `_rootTombstones` | **`LegacyPlacementControl`** | **legacy authority-flight state** (convicted root id/epoch) | writeFlight eviction path |
| `_upstream` | `TopicDeliveryPlane` | upstream lease | attach/rehome |
| `_subscriptions` | `TopicDeliveryPlane` | downstream leases | `TopicDeliveryPlane` |
| `mySubscriptions` | `TopicRoleLifecycle` (own APP_SUBSCRIBE) | obligation record | `PeerMessaging` bridge |
| `_backupTopics` | `TopicRoleLifecycle` | obligation set | rootClaim (BACKUP) |
| `_hostedTopics` | `TopicRoleLifecycle` | obligation set | `TopicRoleLifecycle` |
| `_publishedTopics` | `TopicRoleLifecycle` | obligation set | `TopicRoleLifecycle` |
| `axonRoles` | `LegacyPlacementControl`/rootClaim | placement record | rootClaim `_set` |
| `_appDelivered` | **`TopicDeliveryPlane`** | **`TopicDeliveryPlane`** (dup-suppression) | `PeerMessaging` callback bridge |
| `_metricsWanted` | `TopicRoleLifecycle` (demand) | demand set | metrics loop |
| `_metricsFwdAt` | `TopicRoleLifecycle` | fwd-time map | metrics loop |
| `_metricDataByMetricTopic` | `TopicRoleLifecycle` | metric snapshot | metrics loop |
| `myMetricsRequests` | `TopicRoleLifecycle` | request set | metrics loop |
| `_lastSeenTsByTopic` | `OrderingIndex` (freshness) | ts map | `WriteIngress` freshness check |
| `_relayReach` | `GreedyRouter` | reachability cache | `GreedyRouter` |
| `_unattachedSince` | `TopicDeliveryPlane` | attach-state map | rehome |
| `_handoffAcked` | `TopicRoleLifecycle` (transition) | **`SyncEngine`** (ack-set flight ledger) | **`SyncEngine`** (movement) |
| `_verifyInflight` | `rootClaim` (self-verify) | inflight set | rootClaim iterative verify |
| `_lookupInflight` | `LookupService` | inflight set | `LookupService` |
| `_m` (`durability.js`) | `RetentionLedger` | durability tracker `{state,attempts,at}` | `RetentionLedger` (`PUB_DURABLE`) sweep |

### 4b. Infrastructure collections (8, not per-topic state)

| Collection | Policy | Data | Effect/teardown |
|---|---|---|---|
| `_routedHandlers` | pub/sub registry | handler table | registry dispatch |
| `_directHandlers` | `PeerMessaging` | handler table | `PeerMessaging` dispatch |
| `_upgradeHandlers` | transport registry | handler table | transport dispatch |
| `_eventListeners` | `PeerLifecycle` | listener set | emit/teardown |
| `_errorHandlers` | `PeerLifecycle` | listener set | emit/teardown |
| `_logHandlers` | `PeerLifecycle` | listener map | emit/teardown |
| `_persistDirty` | `PeerPersistence` | dirty set | checkpoint |
| `_burstTimers` | `PeerLifecycle` scheduler | timer set | teardown |

## 5. Timers → per-site deadline-semantics owner / scheduler (all 17)

Two kinds: **STANDING** (stateful, leak-prone — the plan §4.8 target) and **TRANSIENT**
(cooperative `setTimeout(r,0)`/`setImmediate` yields and `sleep()` backoff — no standing
deadline; owned by the enclosing operation). Scheduler create/teardown is `PeerLifecycle`
for standing timers; transient yields need no scheduler slot.

| Site | Kind | Deadline-semantics owner |
|---|---|---|
| `AxonaPeer.js:396` `setInterval` `_maintainTimer` | STANDING | `PeerLifecycle` (master maintenance tick) |
| `repairPlane.js:1206` `setInterval` `_timer` | STANDING | `SyncEngine` (repair sweep) |
| `AxonaPeer.js:1276` `setTimeout` `_persistTimer` | STANDING | `PeerPersistence` (checkpoint debounce) |
| `AxonaManager.js:1086` `setTimeout` (`_pending` corr) | STANDING | contract registry (request-response timeout) |
| `AxonaManager.js:221` `_burstTimers` first/burst publish | STANDING | `WriteIngress` (cold-publish burst) |
| `rootElection.js:298` `setTimeout(...unref)` | STANDING | `rootClaim`/election (lookup/verify timeout) |
| `repairPlane.js:436` `setTimeout` handle | STANDING | `SyncEngine` (repair deferral) |
| `repairPlane.js:853` `setTimeout` handle | STANDING | `SyncEngine` (repair deferral) |
| `AxonaPeer.js:1005` `setTimeout` handle | STANDING | `PeerLifecycle` (deferred lifecycle op) |
| `repairPlane.js:322` `setImmediate`/`setTimeout` slice | TRANSIENT | `SyncEngine` (ingest slice yield) |
| `repairPlane.js:349` yield | TRANSIENT | `SyncEngine` (queue-drain yield) |
| `repairPlane.js:360` yield | TRANSIENT | `SyncEngine` (queue-drain yield) |
| `repairPlane.js:969` `sleep()` backoff | TRANSIENT | `SyncEngine` (repair backoff) |
| `wireHandlers.js:575` `setTimeout(r,0)` yield | TRANSIENT | wire dispatch (handler yield) |
| `AxonaPeer.js:920` `setTimeout(r,pollMs)` | TRANSIENT | `PeerLifecycle` (readiness poll) |
| `AxonaPeer.js:1037` `sleep()` backoff | TRANSIENT | `PeerLifecycle` (retry backoff) |
| `AxonaPeer.js:2451` `setTimeout(resolve,…)` bounded await | TRANSIENT | `PeerLifecycle` (bounded op) |

9 STANDING (each a named semantics owner + `PeerLifecycle` scheduler) + 8 TRANSIENT
(enclosing-operation owned) = 17. No grouped or non-canonical owner cells remain.

## 6. D1 codecs → owner

`ackProof.js` sole owner of the INGEST-ACK/RECEIPTNACK/probe transcript + verify.
`capAttest.js` sole owner of `write-flight-ack-v1` (transport/auth boundary). Extraction
moves call sites only; byte-identical guaranteed. (Aster: D1 codec ownership sound.)

## 7. Public API → façade

All ~30 methods (REF-0.1 §6) stay on `AxonaPeer`, delegating to composed services; the
façade owns no policy. Frozen as an M2 parity fixture.

## 8. Repair families → `SyncEngine` rows

`emptyRootProbe`→`EMPTY_ROOT_PROBE`; `replicateRole`/`replicateRoot`→`COHORT_REPLICATE`+`UNION_AT_ROOT`;
`leaveHandoff`→`HANDOFF`; `readRepair`→`REPLAY_UP`/read-repair row; split paths→`SPLIT_UNION`;
`confirmPending`/`earlyResend`/`ingest` → a row or a named exception. Zero current `syncEngine`
delegation → Phase 4 is from-scratch.

## 9. Orphan and double-ownership report (re-proven after the seq-575 reassignments)

- **Orphans:** none. All 23 `role.*` fields (§3), all 28 topic/peer state maps + 8
  infrastructure collections (§4), all 19 frames (§2), all 17 timers (§5) have named owners.
- **Authority-state containment (seq-575 #1):** `_rootTombstones` no longer touches
  `TopicStore`; convicted-root id/epoch is legacy authority-flight state under
  `LegacyPlacementControl`, so no singleton-authority state leaks into the permanent event
  store. `TopicStore` now owns only event/header/body/tombstone content, not authority facts.
- **Delivery-policy containment (seq-575 #2):** `_appDelivered` dup-suppression policy+data
  are `TopicDeliveryPlane`; `PeerMessaging` is the callback-effect bridge only, not owner.
- **Handoff ledger (seq-575 #3):** `_handoffAcked` data+movement are `SyncEngine`;
  `TopicRoleLifecycle` decides only the placement transition.
- **Double policy/data ownership:** none, re-checked after the three reassignments and the
  §3 consumer removal. Signed vs legacy `INGESTACK` are two frames by design.
- **Timers:** all 17 have a single deadline-semantics owner (§5); no grouped cells.

**No open cells, no slash cells, no consumers in owner cells, no double ownership.** §4, §9,
§10, and the footer agree.

## 10. Conclusion

The v3.2 §4.9 roster absorbs every current state field, timer, frame, and codec — the 23
`role.*` fields, the 28 topic/peer-keyed module maps, the 8 infrastructure collections, and
the 17 timer sites — one policy, one data, one effect owner apiece, with authority state,
delivery-policy state, and handoff-ledger state each contained in the correct owner rather
than leaked into `TopicStore` or `PeerMessaging`. That is the concrete evidence the
decomposition proceeds without a residual god-object. No leaderless owner is required for any
current fact; the singleton-root-coupled maps sit behind the `TopicLocator`/
`TopicDeliveryPlane`/`LegacyPlacementControl`/rootClaim legacy adapters exactly as v3.2 intends.

---

*REF-0.3 v0.3. All seven Aster seq-575 corrections applied: `_rootTombstones`/`_appDelivered`/
`_handoffAcked` reassigned; `role.cache` consumer removed from the owner cell; all 17 timers
named per-site with STANDING/TRANSIENT kind; 36 collections categorized (28 state + 8
infra) as the falsifiable denominator; REF-0.1 footer reconciled to v0.2. Next: REF-0.2
golden traces over the §2.1 ledger. No kernel behavior changed in Phase 0.*
