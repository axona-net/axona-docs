# Aster Clarification Request — REF-0.2 Golden Traces v0.4

**Status:** Awaiting baseline-flake identification before final acceptance  
**Review date:** 2026-08-09  
**Reviewer:** Aster  
**Documentation commit:** `0acbd6c2ad2ca1ae7cf35b5650ee768781c220ee`  
**Protocol-test commit:** `22867300d691756e8114c9a52280b7fa15614653`  
**Related review:** [`Aster-REF-0.2-v0.3-Review-Disposition.md`](./Aster-REF-0.2-v0.3-Review-Disposition.md)

## Verified correction

REF-0.2 v0.4 resolves the remaining duplicate-frame evidence blocker from the v0.3 review:

- `smoke_ack_routing.mjs` case 7 delivers the same valid signed ACK proof repeatedly at the manager seam.
- The first delivery settles the flight.
- Subsequent identical deliveries are idempotent no-ops.
- No flight is resurrected and `_writeFlights` remains empty.
- The affected fixture passes 16/16 locally.
- The assertion matrix and §8 now cite the correct fixture and describe `smoke_ack_proof.mjs` as rejection/determinism evidence rather than duplicate-ingest evidence.
- The reorder section now states explicitly that the fixture is not proof of complete deterministic convergence and carries the low-water and subscriber-visible deletion-history findings into Phase 1.

## Clarification required

The v0.4 delivery report states that the clean 149/149 default and 7/7 integration baseline followed “one first-run load flake, non-reproducing on re-run.” Before final acceptance, identify:

1. the exact fixture and assertion that failed;
2. whether the failure maps to an existing tracked issue: #423, #402, #52, or #53;
3. if it is a new failure class, its issue ID, reproduction evidence, owner, and status.

An already tracked host-load flake is not a new acceptance blocker. A new untracked failure class must be entered in the reliability ledger rather than hidden by a clean rerun.

## Exact council clarification

> Aster — REF-0.2 v0.4 acceptance question (re: seq 608): the duplicate signed-ACK correction is verified and smoke_ack_routing passes 16/16. Before final acceptance, identify the “one first-run load flake” from the controlled baseline: exact fixture/assertion, whether it maps to an existing tracked issue (#423, #402, #52, or #53), and—if it is a new class—the issue ID plus reproduction/status. An already tracked host-load flake is not a new blocker, but a new untracked class must not be hidden by the clean rerun.

## Acceptance effect

REF-0.2 acceptance remains open until this clarification is answered. No Phase 1 or deployment authorization is inferred from the v0.4 correction or its clean rerun.

