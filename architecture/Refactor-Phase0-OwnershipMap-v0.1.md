# Refactor Phase 0 — Static Ownership Map (REF-0.3)

**File:** `axona-docs/architecture/Refactor-Phase0-OwnershipMap-v0.1.md`
**Version:** v0.2 — 2026-08-09 (Aster seq 570 corrections: 1:1 policy/data/effect split, `_m`
reconciled, no-double re-proven, timer semantics vs scheduler separated)
**Author:** axona.bot (chief programmer)
**Baseline:** kernel v4.62.2 at `fb3ea39`
**Targets:** `code-refactor-plan.md` **v3.2** (sha256 `51ce07f6…`) §4.9 owner roster
**Companion:** REF-0.1 inventory v0.2 (`Refactor-Phase0-Inventory-v0.1.md`)
**Status:** PHASE 0 REF-0.3 — ownership map for council review. No code changed; no deploy.

The rule (plan §4.1/§4.9): every per-topic/per-peer state field, timer, frame, and proof
codec has **one policy owner, one data owner, and one effect/teardown owner**. A cell naming
two candidate owners with a slash is not a resolution — it is split below into the three
columns or into individual rows. Anything mapping to zero owners is an orphan and blocks
Phase 2. This map's load-bearing contribution beyond the inventory is §4: the per-topic
state that lives *outside* the `role` object.

---

## 1. Owner roster (from plan v3.2 §4.9)

`AxonaPeer` façade · `PeerLifecycle` · `SynaptomeManager` · `GreedyRouter` ·
`LookupService` · `TopicProfileRegistry` · `TopicRoleLifecycle`
(+`LegacyPlacementControl`/`rootClaim`, +`RoleAdmission`) · `TopicStore` (+selected
`OrderingIndex`) · `WriteIngress` (+`LegacyStampAuthority`) · `RetentionLedger` ·
`TopicDeliveryPlane` · `SyncEngine` · `TopicLocator` · `ackProof.js` · `capAttest.js` ·
per-boundary contract registries · `PeerMessaging` · `PeerPersistence`.

Three-column convention: **Policy** = decides the transition; **Data** = holds the bytes;
**Effect** = performs and tears down the outward action. One name per column.

## 2. Wire frames → policy / effect owner

| Frame | Policy owner | Effect owner |
|---|---|---|
| `SUB`,`UNSUB`,`ADOPT`,`DELIVER` | `TopicDeliveryPlane` | `TopicDeliveryPlane` |
| `PUB`,`KILL` | `WriteIngress` | `WriteIngress` |
| `INGESTACK` (signed D1) | `WriteIngress` | `ackProof.js` builds → routing adapter sends |
| `INGESTACK` (legacy 1-hop) | `writeFlight` (compat) | `writeFlight` |
| `RECEIPTPROBE`,`RECEIPTNACK` | `writeFlight` | `ackProof.js` + routing adapter |
| `PULL`,`PULLRESP` | `TopicDeliveryPlane` (read) | `TopicStore` supplies bytes |
| `PULLUP`,`REPLAYUP`,`REPLICATE` | `SyncEngine` | `SyncEngine` (import/export via `TopicStore`) |
| `HANDOFF`,`HANDOFFACK` | `TopicRoleLifecycle` (transition) | `SyncEngine` (`HANDOFF` movement) |
| `ROOTBEACON` | `TopicLocator` | `TopicLocator` (beacon adapter) |
| `METRICSON` | `TopicRoleLifecycle` (demand) | metrics loop |
| `TOUCH` | deprecate-track | — |
| `UNPUB` | **RETIRE** (unregistered) | — |

`HANDOFF` policy (who may plant/accept standing state — Principal-Liveness) and effect
(the state movement) are now distinct owners, not one slash cell.

## 3. `role.*` state fields → policy / data / effect owner

| Fields | Policy | Data | Effect |
|---|---|---|---|
| `cache`,`cacheIds`,`cacheBytes`,`tombstones`,`publishes` | `WriteIngress`/reads via `TopicDeliveryPlane` | **`TopicStore`** | `TopicStore.apply` only |
| `seq`,`lastTs` | `LegacyStampAuthority` | **`OrderingIndex`** (legacy index) | returns stamped entry |
| `isRoot`,`epoch`,`backupOf` | **`LegacyPlacementControl`/rootClaim** | rootClaim record | rootClaim `_set` |
| `subscribers`,`children`,`readHolder` | `TopicDeliveryPlane` | `TopicDeliveryPlane` leases | SUB/DELIVER/renew |
| `replicas`,`lastReplicaAt` | `RetentionLedger` | `RetentionLedger` | cohort effect via `SyncEngine` |
| `sync`,`attempted`,`lastVerify` | `SyncEngine` | `SyncEngine` flight ledger | reconcile effect |
| `topicId`,`formedAt`,`createdAt` | `TopicRoleLifecycle` | lifecycle record | lifecycle transitions |
| `metricsOn`,`metricsLastPub` | `TopicRoleLifecycle` (demand) | metrics record | metrics loop |

(The `cache…` policy column: writes are decided by `WriteIngress`; reads served through
`TopicDeliveryPlane`. Both consult one **data** owner, `TopicStore` — no two writers.)

## 4. Module-level topic/peer-keyed state → policy / data / effect owner

Every grouped/slash row from v0.1 is split. ~24 distinct maps; one owner per column each.

| Map (file) | Policy | Data | Effect/teardown |
|---|---|---|---|
| `_writeFlights` | `WriteIngress` | writeFlight record | writeFlight sweep |
| `_ingestAcks` | `WriteIngress` | ack cache | `WriteIngress` emit (`ackProof`) |
| `_pendingPub` | `WriteIngress` | pending-pub record | `WriteIngress` → ingest |
| `_pendingKill` | `WriteIngress` | pending-kill record | `WriteIngress` → ingest |
| `_rootBeacons` | `TopicLocator` | beacon map | `TopicLocator` |
| `_beaconSeen` | `TopicLocator` | dedup set | `TopicLocator` |
| `_lastAnnounce` | `TopicLocator` | announce-time map | `TopicLocator` |
| `_rootHint` | `TopicLocator` | candidate cache | `LookupService` (resolve) |
| `_rootTombstones` | `LegacyPlacementControl`/rootClaim | **`TopicStore`** | rootClaim transition |
| `_upstream` | `TopicDeliveryPlane` | upstream lease | `TopicDeliveryPlane` attach/rehome |
| `_subscriptions` | `TopicDeliveryPlane` | downstream leases | `TopicDeliveryPlane` |
| `mySubscriptions` | `TopicRoleLifecycle` (own APP_SUBSCRIBE) | obligation record | `PeerMessaging` bridge |
| `_backupTopics` | `TopicRoleLifecycle` | obligation set | rootClaim (BACKUP) |
| `_hostedTopics` | `TopicRoleLifecycle` | obligation set | `TopicRoleLifecycle` |
| `_publishedTopics` | `TopicRoleLifecycle` | obligation set | `TopicRoleLifecycle` |
| `axonRoles` | `LegacyPlacementControl`/rootClaim | placement record | rootClaim `_set` |
| `_appDelivered` | `PeerMessaging` (exactly-once) | dedup map | `PeerMessaging` deliver |
| `_metricsWanted` | `TopicRoleLifecycle` (demand) | demand set | metrics loop |
| `_metricsFwdAt` | `TopicRoleLifecycle` | fwd-time map | metrics loop |
| `_metricDataByMetricTopic` | `TopicRoleLifecycle` | metric snapshot | metrics loop |
| `myMetricsRequests` | `TopicRoleLifecycle` | request set | metrics loop |
| `_lastSeenTsByTopic` | `OrderingIndex` (freshness) | ts map | `WriteIngress` freshness check |
| `_relayReach` | `GreedyRouter` | reachability cache | `GreedyRouter` |
| `_unattachedSince` | `TopicDeliveryPlane` | attach-state map | `TopicDeliveryPlane` rehome |
| `_handoffAcked` | `TopicRoleLifecycle` | ack set | `SyncEngine` (`HANDOFF`) |
| `_verifyInflight` | `rootClaim` (self-verify) | inflight set | `rootClaim` iterative verify |
| `_lookupInflight` | `LookupService` | inflight set | `LookupService` |
| `_routedHandlers` | pub/sub **registry** | handler table | registry dispatch |
| `_directHandlers` | `PeerMessaging` | handler table | `PeerMessaging` dispatch |
| `_upgradeHandlers` | transport **registry** | handler table | transport dispatch |
| `_eventListeners` | `PeerLifecycle` event surface | listener set | `PeerLifecycle` emit/teardown |
| `_errorHandlers` | `PeerLifecycle` event surface | listener set | `PeerLifecycle` emit/teardown |
| `_logHandlers` | `PeerLifecycle` event surface | listener map | `PeerLifecycle` emit/teardown |
| `_persistDirty` | `PeerPersistence` | dirty set | `PeerPersistence` checkpoint |
| `_burstTimers` | `PeerLifecycle` scheduler | timer set | `PeerLifecycle` teardown |
| `_m` (`durability.js`) | `RetentionLedger` | durability tracker `{state,attempts,at}` | `RetentionLedger` (`PUB_DURABLE`) sweep |

## 5. Timers → deadline-semantics owner / scheduler owner

Two responsibilities per timer, now distinct (Aster correction 4): the **service** owns what
the deadline *means*; **`PeerLifecycle`** owns timer *creation and teardown* under the one
scheduler (plan §4.8).

| Site(s) | Deadline-semantics owner | Scheduler (create/teardown) |
|---|---|---|
| `dht/AxonaPeer.js:396` `setInterval` (master tick) | `PeerLifecycle` | `PeerLifecycle` |
| `repairPlane.js:1206` `setInterval` (repair sweep) | `SyncEngine`/repair | `PeerLifecycle` (registered sweep) |
| `writeFlight` deadlines (via tick) | `WriteIngress` (D1 flight/probe) | `PeerLifecycle` |
| `repairPlane.js` ×6 `setTimeout` | repair operation (§8) | `PeerLifecycle` bounded obligation |
| `AxonaManager.js` ×2, `wireHandlers.js` ×1, `rootElection.js` ×1 `setTimeout` | owning service (election/lifecycle) | `PeerLifecycle` |
| `dht/AxonaPeer.js` ×5 `setTimeout` | `PeerLifecycle`/lifecycle op | `PeerLifecycle` |

Target: zero `setInterval`/`setTimeout` whose deadline-semantics owner and teardown owner
are not both named. 17 sites, all named above.

## 6. D1 codecs → owner

`ackProof.js` sole owner of the INGEST-ACK/RECEIPTNACK/probe transcript + verify.
`capAttest.js` sole owner of `write-flight-ack-v1`; transport/auth boundary
(`transport/web/mesh-auth.js`). Extraction moves call sites only; byte-identical guaranteed.

## 7. Public API → façade

All ~30 methods (REF-0.1 §6) stay on `AxonaPeer`, delegating to composed services; the
façade owns no policy. Frozen as an M2 parity fixture.

## 8. Repair families → `SyncEngine` rows

`emptyRootProbe`→`EMPTY_ROOT_PROBE`; `replicateRole`/`replicateRoot`→`COHORT_REPLICATE`+`UNION_AT_ROOT`;
`leaveHandoff`→`HANDOFF`; `readRepair`→`REPLAY_UP`/read-repair row; split paths→`SPLIT_UNION`;
`confirmPending`/`earlyResend`/`ingest` pipeline → a row or a named exception (candidates for
`PUB_DURABLE` + one new row). Zero current `syncEngine` delegation → Phase 4 is from-scratch.

## 9. Orphan and double-ownership report (re-proven after the §4 splits)

- **Orphans (zero owners):** none. Every `role.*` field (§3), every one of the ~24
  module-level maps (§4, incl. `_m`→`RetentionLedger`), every frame (§2), and every timer
  (§5) has a named owner in each applicable column.
- **Double policy ownership (two deciders of one transition):** none. Re-checked after
  splitting the former slash cells: `_rootTombstones` now separates policy (`rootClaim`) from
  data (`TopicStore`); `_subscriptions` vs `mySubscriptions` are two maps with two policy
  owners (`TopicDeliveryPlane` vs `TopicRoleLifecycle`); `_relayReach` (`GreedyRouter`) vs
  `_unattachedSince` (`TopicDeliveryPlane`) are two maps; `_verifyInflight` (`rootClaim`) vs
  `_lookupInflight` (`LookupService`) are two maps; the three handler tables have three
  distinct owners (registry / `PeerMessaging` / transport registry) and the three event-
  listener sets share one owner (`PeerLifecycle`) with no second policy claimant. Signed vs
  legacy `INGESTACK` are two frames with two owners by design.
- **Double data ownership:** none — each map/field has exactly one data column.
- **Timers without both owners named:** none (§5).

**No open cells; no slash cells; no double ownership.** REF-0.3 v0.2 is internally
consistent — §4, §9, §10, and the footer all agree that `_m` is assigned and nothing is open.

## 10. Conclusion

The v3.2 §4.9 owner roster absorbs every current state field, timer, frame, and codec —
including the ~24 module-level topic/peer-keyed maps the inventory's role-field view did not
surface — with one policy, one data, and one effect owner apiece. That is the concrete
evidence the decomposition proceeds without a residual god-object: every piece of state has a
single home. No leaderless owner is required for any current fact; the singleton-root-coupled
maps (`_rootBeacons`,`_rootHint`,`_upstream`,`axonRoles`,`_rootTombstones`) sit behind the
`TopicLocator`/`TopicDeliveryPlane`/`rootClaim` legacy adapters exactly as v3.2 intends.

---

*REF-0.3 v0.2. All four Aster seq-570 corrections applied: `_m` reconciled throughout;
slash cells split into policy/data/effect; no-double re-proven post-split; timer semantics
separated from scheduler. Next: REF-0.2 golden traces over the §2.1 ledger. No kernel
behavior changed in Phase 0.*
