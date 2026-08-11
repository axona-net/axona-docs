# REF-1.1 S2.0c-AUTH-B — implementation test plan (Gate B)

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-GATEB-20260811-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Plan only. No code. S2.0c/chunking held.
- **Rev:** v4 — (Aster msgId dd81651c) makes G2 fully conditional on best-effort re-propagation so
  it can no longer be read as claiming re-propagation is guaranteed (matches J2), and corrects the
  pass-criteria span to **A–H and J–N** since the plan defines no class I. v3 reconciled the crash
  model (G2↔J), made classes J–N mandatory with surface mappings, separated in-process
  failure-atomicity (exception injection, no process death) from the J2 restart-loss residual
  (actual termination), and gave J2 an executable trigger + bounded oracle
  (recovery-if-re-propagated + no forged authority; no durability claim). (v2 added the five
  executable-case sections; msgId d9512e07.)
- **Purpose:** the test plan the eventual kernel implementation of B-prime tombstone authorization
  must satisfy before any code is accepted. Consumes the accepted design (signed-expiry v6,
  AUTH-B v8 security model + v12 invariants) and the Gate A capacity artifact. Aster permitted
  drafting this in parallel (msgId b8c2d20f); it is **not** authorization to write kernel code.

## The commit-boundary contract under test (Gate B, from Aster msgId bbdf622e)

`SUPPRESS` is a **local commit boundary**, not a distributed transaction:

1. **Local commit first.** Tombstone admission (subject to capacity), local body-cache removal,
   and candidate-state transition commit **consistently** before any network effect. A crash
   between the deadline check and the local commit leaves **no** partial state (no tombstone
   without the body removed, no body removed without the tombstone).
2. **Network effects are idempotent post-commit work.** Delete fanout and replication run **after**
   the local commit; **within a running process** a send failure, timeout, or duplicate delivery
   **never** rolls back or discards a live tombstone, and re-running fanout is a no-op at the
   receiver. (A **process crash** is out of scope of this guarantee — see class J: tombstones are
   in-memory, not restart-durable; a crash is the accepted re-propagation residual.)
3. **Every retry re-checks its preconditions** immediately before suppressing: body still present
   and valid, the matching kill still verified, `now ≤ effectiveDeath`, and all capacity limits
   (global + per-signer + per-topic + byte + record, tombstone **and** candidate stores) permit
   admission. Any failing precondition aborts with no side effect.

## Test classes

**A. Commit-order / atomicity.**
- A1 body-present author KILL: local tombstone + body-removal + candidate-purge all present, or all
  absent — never a subset.
- A2 **in-process failure-atomicity** — inject a **synchronous exception / abort after each local
  mutation** (deadline check, tombstone insert, body remove, candidate purge) **without process
  death** → the operation rolls back or completes; never a half-installed subset (tombstone without
  body removed, or body removed without tombstone), never an expired tombstone. A live process is
  required to observe atomicity; **actual process termination is NOT used here** — it clears all
  in-memory state and is reserved for the J2 restart-loss residual.
- A3 concurrent body-arrival and KILL for the same `(topicId, msgId)`: exactly one `SUPPRESS`
  commits; no double-remove, no lost tombstone.

**B. Idempotency + failure-atomicity of network effects.**
- B1 fanout send failure after local commit → tombstone stays live; fanout retried; no rollback.
- B2 duplicate delete fanout at the receiver → no-op (idempotent); no state churn, no re-emit
  storm.
- B3 replication to a body-absent replica delivers only the **signed kill** (never an authoritative
  marker); the replica re-earns authority locally (verifies the transferable-authority guard).

**C. Retry precondition re-checks.**
- C1 capacity frees, body still present + kill verified + `now ≤ effectiveDeath` → retry commits.
- C2 body evicted before retry → aborts, candidate demoted to plain, no commit.
- C3 `now > effectiveDeath` at retry → aborts fail-closed, no expired tombstone.
- C4 capacity still full at retry → aborts, entry retained as pending, no partial commit.

**D. Security invariants (from the accepted design; kernel integration).**
- D1 forged non-author KILL, body absent → bounded candidate, never suppresses; body-present →
  dropped (author mismatch). Never "dropped as non-author" on a body-absent node.
- D2 fabricated "authoritative" tombstone from a malicious replica → ignored; the receiver never
  suppresses without its own body co-location (non-transferable authority).
- D3 Option-1 identity: a KILL whose `msgId` commits a different `topicId`/`exp`/publisher cannot
  match; cross-topic replay impossible by construction; golden vectors from signed-expiry v6.
- D4 committed-expiry fail-closed inside `SUPPRESS` on the direct-KILL, late-body, and retry paths
  (v12 invariant); boundary at `effectiveDeath` and `+1`.

**E. Capacity / saturation integration (mirrors the Gate A sim, on the real kernel).**
- E1 N live tombstones + N+1 genuine KILL → admission refused, no live eviction, message not
  suppressed; N+1 forged → dropped/bounded per above.
- E2 pending-capacity is bounded (candidate caps), deduplicated, and expires at ClaimRetention;
  duplicate-KILL flood collapses to one; a full node refuses adoption of a migrated kill.
- E3 complete deletion state (tombstones + candidates) stays within the per-node memory budget at
  the enabled profile's caps under sustained saturation.

**F. Expiry / lifetime.**
- F1 `effectiveDeath = exp + CLOCK_SKEW` used everywhere (body cache, tombstone, candidate,
  replay); no bare-`exp` vs `exp+skew` mixing.
- F2 a rewritten unsigned `publishTs` cannot change lifetime (bound by committed `exp`); the
  tracked ordering-follow-on gate is exercised.

**G. Fault injection.**
- G1 mock RTCPeerConnection/DataChannel failures during fanout (reuse the existing WebRTC
  fault-injection harness) → local tombstone unaffected.
- G2 **process restart** mid-migration → consistent with class J: the in-memory tombstone is
  **lost** (no persistence). Suppression is re-established **only if** a later valid KILL and its
  body re-propagate (best-effort, per J2 — under continued source omission this **may never
  occur**, leaving the bounded omission residual); when they do, adoption is epoch-ordered and
  there is no phantom suppression in the interim. (Reconciled with J2 — G2 does **not** claim "no
  lost tombstone," nor that re-propagation is guaranteed; both would contradict the non-durable
  decision.)

**H. Golden vectors.**
- H1 `MSGID_DOMAIN_V2` preimage + digest (publisher 64-hex, topicId 66-hex, exp); V1 legacy
  byte-exact; rejection vectors (wrong widths, tampered `exp`).
- H2 `KILL_DOMAIN` signed-kill verify vectors; a non-author signature never authorizes.

## Executable cases + explicit oracles (Aster review additions, msgId d9512e07)

**J. Crash after local commit, before post-commit handoff/send — durability DECISION.**
Restart durability of a tombstone is **NOT required**. B-prime is best-effort with in-memory
deletion state (the shipped kernel holds tombstones in a plain per-role Map with no persistence),
and every failure mode is already an accepted bounded-resurrection residual capped by the committed
`exp`. Precise semantics: the no-rollback guarantee is **within-process only** — a fanout *send*
failure leaves the live tombstone in place and retries; a **process crash** between local commit
and fanout loses that node's in-memory tombstone and its not-yet-sent fanout, and the deletion is
re-established by **re-propagation** (eventual under an honest path). No durable outbox / restart
recovery is claimed or built.
- J1 (within-process) send failure after commit → tombstone stays live, fanout retried, no
  rollback. Oracle: tombstone present; fanout attempts ≥ 2; no accounting change.
- J2 (**actual process termination**) between commit and fanout → on restart the tombstone is
  absent (no persistence). Re-propagation is **best-effort, not guaranteed** (under continued
  source omission it may never re-arrive — the accepted omission residual). **Executable trigger:**
  after restart, deliver a **later valid re-propagated KILL** plus its body; **bounded oracle:**
  co-located authorization re-establishes suppression, **and** a **fabricated "authoritative"
  marker** presented at the same time gains **no** authority (the receiver still requires its own
  body co-location). No durability is asserted; the test proves recovery-if-re-propagated and
  no-forged-authority, nothing stronger.
- J3 the class-B "no-lost-tombstone" claim is scoped to J1 only; J2 is the documented accepted
  residual. (Corrects the earlier over-strong recovery claim.)

**K. Concurrent contention for the final slot** (global, byte, per-signer, per-topic; including
reclamation racing admission). Oracle: **exactly one** contender commits; the relevant cap /
accounting value equals its limit exactly and never overshoots; every loser has **no** local state
change and **no** network effect (fx counters unchanged).

**L. Receive-path dominance + replay.** Oracle: while a tombstone is live, a later or replayed body
for its `msgId` is **not delivered**; duplicate bodies, KILLs, fanouts, and reconnect replays are
idempotent (no content resurrection, no re-emit storm); at `effectiveDeath + 1` the tombstone is
gone and **neither** a stale body **nor** a stale kill regains authority.

**M. Cryptographic prefiltering + local-receipt retention.** Oracle: a malformed or
invalid-signature KILL is **rejected before** consuming any candidate capacity (candidate count /
bytes unchanged); a valid-signature KILL by a signer whose authorship is not yet knowable **may**
enter bounded candidate state; `ClaimRetention` is derived from **local receipt time**
(`localReceipt + FUTURE_TOLERANCE_MS + TTL_CEILING + CLOCK_SKEW`) and is **independent** of the
attacker-controlled `kill.ts`.

**N. Retry scheduling + expiry interleavings.** Oracle: pending retries are served
**oldest-body-first** without starvation (a long-waiting candidate is eventually served or expires,
never indefinitely skipped); a candidate is removed exactly when `ClaimRetention` passes; a
concurrent body eviction **demotes** the pending candidate; a body arriving **after** its candidate
expired does **not** produce a later suppression.

## Test surfaces

- **Unit / sim transport:** the tombstone/candidate/body state machine driven directly (extends the
  Gate A model into kernel `src/pubsub` tests), with the fault clock + kill switch for A2/G2.
- **Multi-node WebRTC harness:** the existing headless real-WebRTC harness for B1/B3/G1 (network
  effects, migration, replica re-earning authority).
- **Golden-vector files:** checked-in preimage/digest/signature vectors (H).
- **Saturation:** the Gate A harness re-pointed at the kernel structures for E, on the production
  relay OS/runtimes.

## Pass criteria / gate

**Every applicable class A–H and J–N** green — J–N are mandatory, not optional. (There is no
class I; the sequence skips it.) Surface mapping for the
added classes: **J** (durability semantics) — J1/A2 exception-injection on the sim/unit surface,
J2 on the process surface (actual termination) — **process**; **K** (slot contention) — unit +
sim, with a concurrency harness racing admission against reclamation; **L** (receive-path
dominance + replay) — sim + **WebRTC** (reconnect replay, duplicate fanout); **M** (crypto
prefilter + local-receipt retention) — **unit** (signature verification, ClaimRetention
derivation) + golden vectors; **N** (retry scheduling/expiry) — unit + **saturation** (starvation
under load). Then: the Gate A saturation numbers confirmed on the
production relay OS/runtimes (Windows fleet + Linux droplet) and, before enabling the browser
profile, on a real browser. Only then does S2.0c code become eligible for canary — still David-gated
and Aster-reviewed. This plan gates **the tests**, not the code; no kernel implementation, canary,
deploy, S2.1 wiring, or chunking proceeds until the plan and the corrected Gate A artifact are
accepted.
