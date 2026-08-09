# Refactor Phase 0 — Inventory (REF-0.1)

**File:** `axona-docs/architecture/Refactor-Phase0-Inventory-v0.1.md`
**Version:** v0.2 — 2026-08-09 (added `durability.js` to the module set per REF-0.3/Aster seq 570)
**Author:** axona.bot (chief programmer)
**Baseline:** kernel v4.62.2 at `fb3ea39` (measured with `wc -l` / `grep` over `src/**/*.js`)
**Status:** PHASE 0 REF-0.1 — inventory for council review. No code changed; no deploy.
**Companion targets:** REF-0.3 static ownership map (per-site → one §4.9 owner), REF-0.2 golden traces.
**Governs:** `code-refactor-plan.md` v3 §Phase 0 deliverables; consumes its §4.9 owner map and §2.1 ledger.

This inventory names every wire frame, per-topic state field, timer, proof/capability
codec, repair operation, public API method, and leaderless-sensitive assumption in the
kernel, and classifies shipped D1 apart from the pending D0/D2/I-9 governed exceptions.
It is the falsifiable substrate the ownership map (REF-0.3) maps site-by-site and the
golden traces (REF-0.2) exercise. Counts below are measured, not estimated.

---

## 1. Wire frames

Nineteen frame types are registered as handlers (`on(T.X, …)`); one more (`UNPUB`) is
defined in `constants.js` but **not registered** — a dead/legacy frame to record and
retire, not extend.

| Frame | Registered handler | Boundary (§4.3) | Evidence class it can carry (§4.3) |
|---|---|---|---|
| `SUB` | yes | pub/sub control | ROUTED → (delivery lease) |
| `UNSUB` | yes | pub/sub control | ROUTED |
| `PUB` | yes | pub/sub control | INGESTED (at root) |
| `DELIVER` | yes | pub/sub control | OBSERVED (app) |
| `ADOPT` | yes | pub/sub control | ROUTED (subscriber move) |
| `PULLUP` | yes | pub/sub control | ROUTED (catch-up trigger) |
| `REPLAYUP` | yes | pub/sub control | RETAINED-adjacent (replay) |
| `HANDOFF` | yes | pub/sub control | standing-state transfer |
| `HANDOFFACK` | yes | pub/sub control | HANDOFF completion |
| `KILL` | yes | pub/sub control | INGESTED (tombstone) |
| `RECEIPTPROBE` | yes | pub/sub control | probe (D1 family) |
| `RECEIPTNACK` | yes | pub/sub control | explicit non-retention (D1 family) |
| `INGESTACK` | yes | pub/sub control | **INGESTED** — D1 signed + legacy unsigned variants |
| `TOUCH` | yes | pub/sub control | ROUTED (deprecated-ish) |
| `PULL` | yes | pub/sub control | read request |
| `PULLRESP` | yes | pub/sub control | read response |
| `ROOTBEACON` | yes | pub/sub control | UNSOLICITED_EVENT (no correlation) |
| `REPLICATE` | yes | pub/sub control | RETAINED-adjacent (cohort) |
| `METRICSON` | yes | pub/sub control | demand signal |
| `UNPUB` | **no** | — | DEAD/legacy — flag for retirement |

Role natures `ROOT/CHILD/BACKUP/HOLDER/APP_SUB` are also defined in `constants.js`
(these are placement/retention states, not frames — see §2, and plan §4.2).

**REF-0.3 action:** each registered frame → exactly one owning service + frame kind
(`REQUEST_RESPONSE | ONE_WAY | MULTICAST | UNSOLICITED_EVENT`) + correlation contract.
`ROOTBEACON` registers with no correlation (it has no opposite). Signed `INGESTACK`,
legacy unsigned `INGESTACK`, and `CAP_ATTEST` are three distinct rows (§4, §8).

## 2. Per-topic state fields (`role.*`)

Twenty-three fields carry per-topic state, by frequency of reference (proxy for coupling):

`cache` (52), `sync` (35), `topicId` (32), `isRoot` (30), `subscribers` (17),
`attempted` (13), `tombstones` (12), `backupOf` (12), `seq` (10), `replicas` (9),
`cacheIds` (8), `lastTs` (7), `children` (7), `cacheBytes` (7), `lastVerify` (5),
`epoch` (5), `publishes` (4), `metricsOn` (4), `formedAt` (3), `createdAt` (3),
`readHolder` (2), `metricsLastPub` (2), `lastReplicaAt` (2).

Target owners (plan §4.5/§4.9):

- **`TopicStore`**: `cache`, `cacheIds`, `cacheBytes`, `tombstones`, `publishes` (event/header/body/tombstone bodies + byte/count bounds + snapshot/delta).
- **selected `OrderingIndex`** (`LegacyStampedSetIndex`): `seq`, `lastTs` (dense stamp/order — legacy-only).
- **`LegacyPlacementControl`/`rootClaim`**: `isRoot`, `epoch`, `backupOf` (ROOT/CHILD/BACKUP + incarnation).
- **`TopicDeliveryPlane`**: `subscribers`, `children`, `readHolder` (downstream/child leases, `upstreams[]`).
- **`RetentionLedger`/cohort**: `replicas`, `lastReplicaAt` (holder evidence).
- **`SyncEngine`**: `sync`, `attempted`, `lastVerify` (repair flight/reconcile state).
- **`TopicRoleLifecycle`**: `formedAt`, `createdAt`, `metricsOn`, `metricsLastPub` (obligation lifecycle + demand-metrics).

**REF-0.3 action:** map all **63 direct `role.cache`/`role.tombstones` access sites**
(wireHandlers 23, topicStore 16, repairPlane 11, AxonaManager 9, syncEngine 3,
writeFlight 1) → `TopicStore` accessors; each site becomes `TopicStore.apply/snapshot/delta`,
not raw field mutation. This is the largest mechanical surface (plan REF-2.3); the 63 is a
falsifiable target.

## 3. Timers / sweeps

One `refreshTick`/sweep discipline is already the dominant pattern (plan §4.8), referenced
across 8 files (86 references incl. the sweep bodies): `AxonaManager`, `constants`,
`repairPlane`, `rootElection`, `rootClaim`, `writeFlight`, `wireHandlers`, `dht/AxonaPeer`.
`writeFlight.js` is the exemplar: one bounded record per flight, swept from the shared
tick, no per-flight timers.

**REF-0.3 action:** each interval/sweep → one owner. `PeerLifecycle` owns the master
timer's creation/teardown; `TopicRoleLifecycle` owns per-topic deadline meaning; D1
write-flight ack/probe deadlines are protected legacy obligations. Target: zero
`setInterval`/`setTimeout` without a named owner and teardown.

## 4. Proof / capability codecs (D1 — protected baseline)

Two pure codec modules, confirmed single-owner (nothing rebuilds their transcripts):

- **`ackProof.js`** (260 lines): fixed 197-byte INGEST-ACK transcript + RECEIPTNACK/probe
  classes; strict pre-signature width checks (33-byte topic/node/ackTo ids in every keyspace
  profile; 32-byte message/root-key; 16-byte attempt + flight nonce; safe-integer JS subset
  of a u64 epoch); domain-separated proof classes; golden + rejection + profile vectors.
  Imported (not re-implemented) by `wireHandlers`, `writeFlight`, `capAttest`.
- **`capAttest.js`** (151 lines): `write-flight-ack-v1` attestation; verified only with the
  base-authenticated channel key + locally-derived current-channel CBV digest; cleared on
  channel loss; never persisted. Imported by `transport/web/mesh-auth.js` (its transport/auth
  boundary) and `wireHandlers`.

**Verified:** `grep` finds no transcript reconstruction (`AXONA_INGEST_ACK_PROOF` /
`buildTranscript`) outside `ackProof.js`. Extraction moves **call sites only**; the pure
codecs are untouched → byte-identical is guaranteed by construction. Plan §5.1(12).

## 5. Repair operations (`repairPlane.js` → `SyncEngine`, Phase 4)

**Corrected count** (supersedes the coarse "49" grep in my council seq 558): repairPlane
makes **3 direct `this._send(` calls**, zero `_route`/`_emit`, and imports/calls
`syncEngine` **zero times** today. Its Phase-4 migration surface is ~9–10 repair-operation
families driven from one `refreshTick`:

`emptyRootProbe` (+sweep/+schedule), `readRepair` (+sweep), `replicateRole`,
`replicateRoot`, `leaveHandoff` (`pubsubLeaveHandoff`), `confirmPending`,
`earlyResend` (plan+pump), `ingest` pipeline (enqueue/idle/pump), `peerDied` handling.
Decision-support helpers (`pickHeir`, `nearestReachable`, `rootAliveForLeave`,
`isColdPublisher`) are not emissions.

`syncEngine.js` already carries the 7 frozen policy verbs the migration targets:
`REPLAY_UP`, `SPLIT_UNION`, `EMPTY_ROOT_PROBE`, `COHORT_REPLICATE`, `UNION_AT_ROOT`,
`HANDOFF`, `PUB_DURABLE`.

**Module completeness (added v0.2):** `durability.js` is a further pub/sub module — it
houses the `PUB_DURABLE` publish-durability tracker (`_m`: msgId → `{state,attempts,at}`),
owned by `RetentionLedger` in the target (see REF-0.3 §4). The pub/sub file set is therefore
`AxonaManager`, `wireHandlers`, `repairPlane`, `rootClaim`, `rootElection`, `syncEngine`,
`writeFlight`, `ackProof`, `capAttest`, `topicStore`, `durability`, `constants`.

**REF-4.1 falsifiable target (revised):** the enumerated repair-operation families above,
each mapping to one `syncEngine` policy row or a named exception — NOT "49". Most map onto
the existing 7 verbs; `earlyResend`/`ingest`/`confirmPending` need a row or a documented
exception.

## 6. Public API surface (`AxonaPeer`, must stay stable behind the façade — plan §4.5)

~30 public methods (aliases noted): `start`, `stop`, `join`, `leave`, `integrate`,
`ready`, `sub`/`subscribe`, `unsub`/`unsubscribe`, `pub`/`publish`, `pull`, `pullOutcome`,
`kill`, `touch`, `host`, `unhost`, `metrics`, `getMetrics`, `lookup`, `findKClosest`,
`send`, `sendDirect`, `notify`, `routeMessage`, `snapshot`, `getNodeId`, `getSynaptome`,
`getAuthorClass`, `setAuthorClass`, `health`, `onDirectMessage`, `onError`.

**Compatibility invariant:** every signature survives Phase 2 decomposition unchanged;
the façade delegates to composed services and owns no policy (plan §4.9 row 1).
**REF-0.3 action:** confirm `connect`/`fromSnapshot`/`onLog`/`onPeerJoin`/`onPeerLeave`
presence and pin the exact public list as a frozen parity fixture for M2.

## 7. Assumption inventory (leaderless-sensitive)

Every current use of a singleton-root assumption, to be named and either isolated behind a
`LEGACY_ROOT_V4` adapter or held as a governed exception. Measured reference counts are a
coupling proxy; REF-0.3 pins exact call sites.

| Assumption | Measured surface | Target isolation (plan) |
|---|---|---|
| Root-issued dense stamp (`lastTs`,`seq`) | `role.lastTs` 7 + `role.seq` 10 | `LegacyStampAuthority` + `LegacyStampedSetIndex`, `LEGACY_ROOT_V4` only |
| Scalar `since` cursor | 97 refs | tagged `ReplayCursor` (`LegacyTimestampCursor`); `FrontierRef` RESERVED |
| `msgId` as identity | 236 refs | generic `eventId` + legacy `msgId` adapter |
| Singular upstream (`parent`/`rootHex`) | 37 refs | `TopicDeliveryPlane.upstreams[]` (legacy activates ≤1) |
| Root-as-write-authority | `role.isRoot` 30 | `WriteIngress` pipeline; stamp only under legacy semantics |
| Replay outside `SyncEngine` | repairPlane replay paths | seat/renewal catch-up routes through `SyncEngine` |
| Kill/tombstone as separate flow | `KILL` frame + `role.tombstones` 12 | events-are-tombstones in target; legacy flow preserved |
| Unsigned publish path | signer/verify checks in pubsub | `author-lanes-v1` requires signed authors (K5) |
| Author-seq generation | none today (root assigns) | `AuthorLaneSemantics` (K5) |
| TTL/count eviction vs semantic compaction | `cacheBytes`/count bounds | separate cache eviction from `CompactionFloor` (K5) |
| Fixed replica count | `role.replicas` 9 | policy-based `COMMITTED` w/ receipt digest + diversity |

## 8. D1 / D0 / D2 / I-9 classification (kept separate — never closed by association)

- **D1 — SHIPPED (protected baseline).** `ackProof.js` + `capAttest.js` + `writeFlight.js`
  D1 path + the two `INGESTACK` emission sites (wireHandlers signed, ~L461-485;
  writeFlight legacy one-hop + retry re-stamp, L198/L223). Byte-exact transcripts, golden/
  rejection/profile/multi-hop/reconnect/mixed-version vectors. Refactor may move call sites,
  never reconstruct bytes.
- **D0 — OPEN (#449).** Delegated flight ownership + capability fallback; and **I-9**
  (author↔transport correlator on a PUB) rides here. No refactor code touches it.
- **D2 — OPEN (#451).** Attempt-id chain budget + named terminal for the promotion chain.
  No refactor code touches it.

## 9. Orion's four seam findings — inventory coverage

1. **Upstream diversity** — `LookupService.findClosest({limit,exclude,eligibility,budget})`
   gains a diversity predicate; recorded against §6 API + §2 delivery fields.
2. **eventId↔msgId dedup** — the legacy `msgId`→`eventId` adapter must keep `TopicStore`
   dedup from conflating payload hashes (236 `msgId` refs, §7) with lane positions.
3. **Cursor under multi-upstream** — `COUNT_HIGHWATER_HINT` stays strictly ≤1-upstream /
   `LEGACY_ROOT_V4`; `FrontierRef` RESERVED (§5, §7 cursor row).
4. **D1 ack ↔ LegacyAuthorityRef** — signed `INGESTACK` stays bound to `LegacyAuthorityRef`
   under `LEGACY_ROOT_V4`; byte-exact transcript fully protected (§4, §8).

## 10. Falsifiable targets (for REF-0.3 / REF-4.1)

- **63** direct `role.cache`/`role.tombstones` access sites → `TopicStore` accessors.
- **~9–10** repair-operation families (§5) → `syncEngine` rows or named exceptions (NOT 49).
- **2** D1 ack-emission sites → named in REF-2.4, byte-identical preserved.
- **19** registered frames + `UNPUB` (retire) → one owner + frame kind each.
- **23** `role.*` fields → one §4.9 data owner each; zero orphans.
- **~30** public API methods → frozen parity fixture.

## 11. Exit-criteria status (plan §Phase 0)

| Criterion | Status |
|---|---|
| Every §2.1 incident → falsifiable fixture | PENDING (REF-0.2) |
| Static ownership map, every field/timer/frame/proof → one owner | PENDING (REF-0.3); categories enumerated here |
| D1 vectors consumed, not rewritten | HELD (existing vectors identified in §4) |
| Reliability ledger separates D1 / D0 / D2 / I-9 + carries #423, #402 | DONE (§8) + flakes named |
| Assumption inventory complete | DONE (§7) |

---

*REF-0.1 v0.1. The repair-family count corrects my council seq 558 estimate (see the
seq-following correction). Next: REF-0.3 ownership map keyed to §10's targets, then REF-0.2
golden traces over the §2.1 ledger. No kernel behavior changes in Phase 0.*
