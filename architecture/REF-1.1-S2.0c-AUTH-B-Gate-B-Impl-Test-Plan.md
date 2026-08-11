# REF-1.1 S2.0c-AUTH-B — implementation test plan (Gate B)

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-GATEB-20260811-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Plan only. No code. S2.0c/chunking held.
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
   the local commit; a send failure, timeout, or duplicate delivery **never** rolls back or
   discards a live tombstone, and re-running fanout is a no-op at the receiver.
3. **Every retry re-checks its preconditions** immediately before suppressing: body still present
   and valid, the matching kill still verified, `now ≤ effectiveDeath`, and all capacity limits
   (global + per-signer + per-topic + byte + record, tombstone **and** candidate stores) permit
   admission. Any failing precondition aborts with no side effect.

## Test classes

**A. Commit-order / atomicity.**
- A1 body-present author KILL: local tombstone + body-removal + candidate-purge all present, or all
  absent — never a subset.
- A2 injected crash (fault clock + kill switch) at each point between deadline check, tombstone
  insert, body remove, candidate purge, and fanout emit → recovery leaves a consistent state; no
  expired or half-installed tombstone.
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
- G2 process restart mid-migration → rejoin adopts consistently (epoch-ordered), no phantom
  suppression, no lost live tombstone.

**H. Golden vectors.**
- H1 `MSGID_DOMAIN_V2` preimage + digest (publisher 64-hex, topicId 66-hex, exp); V1 legacy
  byte-exact; rejection vectors (wrong widths, tampered `exp`).
- H2 `KILL_DOMAIN` signed-kill verify vectors; a non-author signature never authorizes.

## Test surfaces

- **Unit / sim transport:** the tombstone/candidate/body state machine driven directly (extends the
  Gate A model into kernel `src/pubsub` tests), with the fault clock + kill switch for A2/G2.
- **Multi-node WebRTC harness:** the existing headless real-WebRTC harness for B1/B3/G1 (network
  effects, migration, replica re-earning authority).
- **Golden-vector files:** checked-in preimage/digest/signature vectors (H).
- **Saturation:** the Gate A harness re-pointed at the kernel structures for E, on the production
  relay OS/runtimes.

## Pass criteria / gate

Every class A–H green on sim + WebRTC surfaces; the Gate A saturation numbers confirmed on the
production relay OS/runtimes (Windows fleet + Linux droplet) and, before enabling the browser
profile, on a real browser. Only then does S2.0c code become eligible for canary — still David-gated
and Aster-reviewed. This plan gates **the tests**, not the code; no kernel implementation, canary,
deploy, S2.1 wiring, or chunking proceeds until the plan and the corrected Gate A artifact are
accepted.
