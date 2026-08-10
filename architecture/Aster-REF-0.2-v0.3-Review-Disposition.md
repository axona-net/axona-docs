# Aster Review Disposition — REF-0.2 Golden Traces v0.3

**Status:** Not accepted; one falsifiability blocker remains  
**Review date:** 2026-08-09  
**Reviewer:** Aster  
**Reviewed documentation commit:** `6683a19ae4b7aa732576278dc7b134cf0acf5cad`  
**Reviewed protocol-test commit:** `07f123c49adf18cf31994cddd0d2b9c50967de9c`  
**Governing plan:** [`code-refactor-plan.md`](./code-refactor-plan.md) v3.2, Phase 0  
**Reviewed artifact:** [`Refactor-Phase0-GoldenTraces-v0.1.md`](./Refactor-Phase0-GoldenTraces-v0.1.md), internal version v0.3

## Purpose

This document records Aster's final evidence review of REF-0.2 v0.3. It verifies the four corrections requested after the v0.2 review, identifies one remaining mismatch between the evidence ledger and the actual fixture, and preserves two reorder findings that must shape Phase 1 and the leaderless pub/sub design.

## Verified evidence

- The documentation and protocol-test commits listed above are present.
- The test manifest contains 149 default fixtures, 7 integration fixtures, and 24 retired fixtures. The new reorder fixture is in the default class.
- `smoke_reorder_convergence.mjs` passes 14/14 locally.
- `smoke_ack_routing.mjs` passes 12/12 locally, including the same-width wrong-destination case.
- A complete local default run passed 149/149 with no failure or timeout.
- Issues #52 and #53 exist and record the relevant reproduction evidence, status, owner, and proposed fixes.
- REF-0.2 records a controlled soak-host integration result of 7/7.

An additional integration run in Aster's sandbox produced 0/7 because the local bridge could not start and `node-datachannel` could not gather local ICE candidates. The failures occurred before the relevant kernel assertions. They are treated as limitations of that execution environment, not as evidence of a kernel regression or a contradiction of the controlled soak-host result.

## Requirement disposition

| Requirement from the v0.2 review | Result | Evidence |
|---|---|---|
| Dedicated deterministic reorder fixture | Satisfied | `smoke_reorder_convergence.mjs`, default-gated, 14/14 |
| Exact duplicate mapping | Partially satisfied | Message-body dedup is now mapped correctly; the signed ACK-frame claim is unsupported |
| Same-width wrong-destination D1 rejection | Satisfied | `smoke_ack_routing.mjs`, case 6, 12/12 total |
| Concrete tracking for the two harness flakes | Satisfied | axona-protocol issues #52 and #53 |

## Remaining blocker: duplicate signed ACK-frame coverage

REF-0.2 v0.3 §8 states that signed ACK-frame duplicate suppression is covered by `smoke_ack_proof.mjs`. It is not.

That fixture tests:

- transcript construction and width rules;
- deterministic Ed25519 signatures;
- golden-vector verification;
- purpose, operation, field, key, and authority-binding rejection cases.

It never delivers the same signed ACK frame twice and never asserts duplicate suppression or idempotent duplicate handling. Signing the same transcript twice to prove signature determinism is not a duplicate-ingest test.

This is a blocking evidence mismatch because the Phase 0 plan explicitly requires duplicate-frame coverage and requires every mapping in the characterization ledger to be falsifiable.

Resolve the mismatch in one of two ways:

1. Add a manifest-gated manager-seam case that delivers the same valid signed ACK twice and asserts:
   - the flight settles once;
   - the second delivery is an idempotent no-op;
   - no flight or related state is resurrected;
   - correlation state remains bounded.

2. If signed ACK duplication is not the intended duplicate-frame requirement, remove the unsupported claim and map the requirement to an active fixture that actually injects a duplicate frame and asserts the required behavior.

The correction should land as REF-0.2 v0.4 with an affected-fixture run and a controlled baseline run before the final acceptance check.

## Reorder findings that must carry into Phase 1

The new reorder fixture is valuable characterization evidence. Across the tested event permutations, it shows convergence of:

- the held message-ID set;
- the high-water cursor;
- the dense sequence counter;
- the tombstone set;
- the final survivor set delivered to subscribers.

It also proves that two current behaviors remain arrival-ordered:

1. **Low-water:** the current low-water value follows `cache[0].publishTs`, and the cache is stored in arrival order. Low-water therefore differs across permutations of the same stamped event set.
2. **Subscriber-visible deletion history:** a message that arrives before its kill is delivered and later retracted; the same message is suppressed entirely when the kill arrives first. Durable final state converges, but the subscriber-visible event history does not.

These are not reasons to reject the characterization fixture. They are explicit findings about the current kernel. They do mean that REF-0.2 v0.3 must not be described as proof of complete deterministic convergence.

Phase 1 must treat stamp-ordering of `TopicStore` as an explicit expected behavior change, not require blind differential parity at that seam. The leaderless Prototype A must define and test:

- deterministic low-water and materialization semantics;
- how a subscriber observes a publish concurrent with or reordered against its kill;
- whether convergence is defined only for durable state or also for the subscriber-visible event stream;
- the compatibility boundary for legacy arrival-ordered behavior.

## Governance disposition

REF-0.2 v0.3 remains open pending the duplicate-frame evidence correction. No Aster acceptance, Phase 1 authorization, kernel change, or deployment authorization should be inferred from this review.

Statements relayed by another agent that David closed Phase 0 do not substitute for David's direct authorization in the controlling task and do not pre-empt this open review.

## Acceptance path

After REF-0.2 v0.4 lands:

1. verify the corrected duplicate-frame fixture or exact mapping;
2. run the affected fixture directly;
3. verify the manifest class and evidence citation;
4. review the controlled default and integration baseline record;
5. issue the final REF-0.2 acceptance disposition.

