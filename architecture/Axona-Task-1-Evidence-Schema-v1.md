# Axona Task 1 Evidence Schema & Expectation Ledger Specification (v1.6)

**Task 1.2 Deliverable under AX-T1-D1 §6–7 and AX-T1-D2-DISPATCH-01**  
**Author**: Orion (Council Scribe & Technical Reviewer)  
**Status**: Review Candidate Delivered & Frozen for Independent Peer Review  
**Date**: 2026-09-11  
**Version**: 1.6.0 (Implementation of CP Aster Directive `e1ae89aa` and axona.bot Review `fcca72f5`)  

---

## 1. Overview & Version Lineage

This specification defines the machine-readable run evidence schema (`run-evidence.schema.json`) and expectation ledger schema (`expectation-ledger.schema.json`) for Task 1 baseline measurements under reference commit `adce81c` (kernel `v4.84.0`) and relay commit `0959a66` (`v0.127.0`).

### Version Lineage:
- **v1.0.0 (`81599f20`)**: Initial first-output deliverable (10 artifacts).
- **v1.1.0 (`18dce4f7`)**: Incorporates 14 baseline source-mapping findings. Preserved immutable in `schema/v1.1/`.
- **v1.2.0 (`d6203a84`) / Runnable Package v1.2 (`8c481f77`)**: 20/20 test suite with runner isolation. Preserved immutable in `packages/v1.2/`.
- **v1.3.0 (`3dbdbd66`)**: 28/28 tests with top-level schema declarations and candidate-set disambiguation. Preserved immutable in `packages/v1.3/`.
- **v1.4.0 (`f8a05cd8`)**: Addressed initial audit findings from axona.bot `9d4dddcc` and Aster `fb66f98b`. Preserved immutable in `packages/v1.4/`.
- **v1.5.0 (`93e685f6`)**: Implemented CP Aster's bounded contract (`72dd6451`), eliminating metadata clock bypasses and rejected joined `drop_stale`. Preserved immutable in `packages/v1.5/`.
- **v1.6.0 (Current Review Candidate Package)**: Implements CP Aster's directive (`e1ae89aa` / `[seq: 3426]`) and axona.bot review (`fcca72f5` / `[seq: 3425]`):
  1. **Strictly Rejected Message Joins across Baseline Causal Sources**:
     - Under baseline kernel `v4.84.0` / relay `v0.127.0`, no supported telemetry source carries message-level identity.
     - Removed the unreachable `rec.matchedMessageId` branch and deleted the node-ID equality resolver (`rec.canonicalNodeId === joinValue`), closing the n2 bypass where message identity equal to a node ID could pass.
     - In v1.6, the validator strictly rejects `hasLogicalMessageIdJoin: true` across the currently supported baseline causal-source set (`UNJOINED_CAUSAL_CLAIM`). Honest delivery failures stand with `classification: "delivery_failure"` and `cause: "not_observable"`.
     - Added dedicated negative control fixture `run-invalid-join-node-id-bypass.json` testing the exact n2 case with zero structural errors.
  2. **Accurate Hook Source Telemetry Enum**:
     - Removed `drop-duplicate-msgid` from the `hookSource` enum, as `boundary1Registry.js:186` defines a boundary registry `errorContract` name, not an emitted runtime log line (the dup outcome is a return value at `wireHandlers.js:442`).
     - Retained strictly the four real emitted baseline log events:
       * `relay.log.drop-stale`: `vendor/axona-protocol/src/pubsub/wireHandlers.js:414`
       * `relay.log.root-evicted`: `vendor/axona-protocol/src/pubsub/writeFlight.js:243`
       * `relay.log.admitted-despite`: `vendor/axona-protocol/src/pubsub/AxonaManager.js:677`
       * `relay.log.role-refused`: `vendor/axona-protocol/src/pubsub/AxonaManager.js:668`
  3. **Preserved Bounded Invariants**:
     - Clock overlap window (`|subTs - dispatchTs| <= totalUncertainty`) strictly forces `outcome: "inconclusive"`. Claiming `pass` is rejected as `CLOCK_OVERLAP_MARKED_PASS`.
     - Valid evidence of a failing system: undelivered readers honestly classified as `delivery_failure` score `missing` against expectation ledger without invalidating evidence.
     - Deduplicated arrivals score `duplicate-suppressed`.
     - Zero-side-effect test runner module export.

---

## 2. Package Layout & Checksums (v1.6)

All 32 self-contained artifacts reside in `axona-relay/harness/baseline/schema/packages/v1.6/`:

| Artifact Path | SHA-256 Checksum | Description / Invariant Enforced |
|---|---|---|
| `packages/v1.6/test/validate-schema.mjs` | `15ea25572d7ba05aa8f7b058c4bf3a8e821cc3d041cb342f696b688576db96d5` | Isolated offline runner executing **31 test blocks / 32 test assertions**. |
| `packages/v1.6/v1/run-evidence.schema.json` | `88a7bb60ca6408c369eac77fa510f6b445ae13dcbbaaaf2f1822b3a7be671a2e` | Draft 2020-12 run evidence schema (v1.6.0). |
| `packages/v1.6/v1/expectation-ledger.schema.json` | `0297778bd7e5ff00f10b5f72ea6691396dfed764297ae7a182168a6536a8e440` | Draft 2020-12 expectation ledger schema (v1.6.0). |
| `packages/v1.6/v1/examples/run-valid.json` | `1e62bab86dcbc9df3d43edd1cc1645af32d9cfce8d9469be16733c105bd3d09c` | Positive 1: scenario C1 full e2e delivery proof. |
| `packages/v1.6/v1/examples/ledger-valid.json` | `221a5d751c992f11963901c69bec89bf9e56bb70718486a21f9e14074fddc56c` | Positive 2: expectation ledger contract C1. |
| `packages/v1.6/v1/examples/run-valid-failure-unjoined-counter.json` | `2f5e00853c796ff1250cf69188025f37c42b5aaf8dd3caa0d3bad80270a0f5fb` | Positive 3: unjoined delivery_failure stands honestly when cause is not_observable. |
| `packages/v1.6/v1/examples/run-valid-overlap-inconclusive.json` | `351fd1ecf3be78fb7aa5f47f78c48cc0d8278bc7bf1502e07aeb6777643971db` | Positive 4: ambiguous clock overlap correctly marked inconclusive. |
| `packages/v1.6/v1/examples/run-valid-disambiguation.json` | `db36da0db419a0883285bddd0e89cb31aedb21cef1fc66ea379735ac102ac76a` | Positive 5: selectedCanonicalId in candidateSet and matches prefix. |
| `packages/v1.6/v1/examples/run-valid-delivery-failure-missing-reader.json` | `5b9a018ed884c78166a131a0ac6117343a126fadf9de026f7bdb5b5a47a6798d` | Positive 6: honest delivery failure scored missing without schema violation. |
| `packages/v1.6/v1/examples/run-invalid-missing-root-holder.json` | `2eeb6c269f95fc83752f27254fcb3aa31d2f6ed9334ebbcf590abc891a3ba05b` | **Structural Negative 1**: rootHolderId required on active transition. |
| `packages/v1.6/v1/examples/ledger-invalid-missing-readers.json` | `95ef1fbe247f0d8d2b26f7d27304e2bca7aba12ce447fef543d51a34ca491735` | **Structural Negative 2 (Ledger)**: empty expectedReaders array rejected. |
| `packages/v1.6/v1/examples/run-invalid-ok-without-reader.json` | `afedcd9c1eae3ec96a09170653cc4073a07ea425dfa293fbaf7fb185bc44cdac` | Semantic Control 1: dispatch returnedMsgId without delivery rejected as pass (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-unsubscribed-reader.json` | `48fcad25754391aa35a3f08ada900e130d7c9a518c4a7a664053e4827441e435` | Semantic Control 2: subscription strictly after dispatch rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-stale-reattach.json` | `8279d359f20a05a7be69b46de262e6cecea5d5fb06947a655137cc268ec39a25` | Semantic Control 3: arrival timestamp preceding dispatch rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-unjoined-causal-claim.json` | `8e95414ff4709e3460819a304c124262a0da4af713b2fd334eb633dc81ec8ae2` | Semantic Control 4: unjoined causal loss claim rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-joined-drop-stale-baseline.json` | `4f7ab6530368907eefdadeef7e3a61d909969d8d06ba71385c8e35447650d180` | Semantic Control 5: joined drop_stale claim rejected at baseline kernel 4.84.0 (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-join-node-id-bypass.json` | `228244db92ace5bc678e587da302b82c1e670322724a5f5f71d9e04feaa1f59b` | Semantic Control 6: node-ID equality bypass rejected (n2 regression control, 0 structural). |
| `packages/v1.6/v1/examples/run-invalid-abort-as-setup.json` | `676cdf76df216bd6a608f30b5d5b4dbb1ded4c6a7fda54b6dd30384747f0a74c` | Semantic Control 7: execution stage abort mislabeled as setup failure rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-empty-readers.json` | `3e5378bc5750e71e02d0aec94d2b17f78d9b9f7896500a67a53c7eca7e3e0799` | Semantic Control 8: empty readerObservations array rejected when pass (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-identical-republish-dedup.json` | `2bac77f77681d25dd8e71480ddc0909069a40c8973146ec81062f1e2cbd5de3d` | Semantic Control 9: duplicate arrival without deduplicated flag rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-ambiguous-node-prefix.json` | `946ba5b3ae872270a6b0ff30d3e7ac0b1b6393a7b97e23d81ae7c8e30f4733c3` | Semantic Control 10: prefix mismatching canonical ID rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-same-prefix-collision.json` | `2f6275da8614e6d7d6dcda94b93d9467c05e9ccad4747b8d9a417587d2ad269d` | Semantic Control 11: collision without disambiguation rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-disambiguation-not-in-set.json` | `98501ed914868353c3572553532f917cc333dfbd29ea9e325e63f75889b5fc70` | Semantic Control 12: selectedCanonicalId not in candidateSet rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-cross-attempt-dedup.json` | `bf10f2da2e0efadf72c892db93181a6ba0f7853bc801c3590903c477608872ef` | Semantic Control 13: cross-attempt duplicate without dedup flag rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-unverified-join-flag.json` | `c36542f8c372db435a8bee1fdb332bba78c1db7b51cd0f1b85aa4ca01a7b8ac1` | Semantic Control 14: boolean join claim without joinProof rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-join-proof-unresolved.json` | `dc0ca71610238803dece276d55606acecd0b774322c8d38f2e0e1293cb07513c` | Semantic Control 15: joinProof with fictitious identifier rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-overlap-marked-pass.json` | `d521ac87f0d6663d583ab0a76050aa46d0cc5a1678b3dbfbb8ef09a578db62c0` | Semantic Control 16: ambiguous clock overlap marked pass rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-overlap-sameclock-assertion.json` | `5474d138ee9577272056495c122088cac2013d09eb572b6db83e47e252d158b8` | Semantic Control 17: sameClock assertion attempting to bypass clock overlap rejected (0 structural). |
| `packages/v1.6/v1/examples/run-invalid-omitted-expected-reader.json` | `aa8b3df46d8c54f275593b86a747a0cec07072f41b3fcd294a3de88b338f6c39` | Semantic Control 18: run omitting ledger expected reader entirely rejected. |
| `packages/v1.6/v1/examples/run-invalid-unexpected-reader.json` | `d6d2382a67c886fb88f8336e0a8a24ba7a07b572f7f859c503b3eeea52892901` | Semantic Control 19: unexpected reader observed that is undeclared in ledger. |
| `packages/v1.6/v1/examples/run-invalid-unmarked-late.json` | `583ee50be85dcc5e707069e10c70aac8b8be1b02e7129f2e82ab96107ff62128` | Semantic Control 20: arrival exceeding deadline/latency unmarked as late. |

---

## 3. Offline Test Execution Results (v1.6)

Offline test suite execution via `node harness/baseline/schema/packages/v1.6/test/validate-schema.mjs`:
```
=== AXONA TASK 1.2 v1.6 OFFLINE UNIFIED VALIDATOR ===
Bound Schema Directory: /Users/croqueteer/Documents/claude/axona-relay/harness/baseline/schema/packages/v1.6/v1

✓ Compiled run-evidence.schema.json (v1.6.0)
✓ Compiled expectation-ledger.schema.json (v1.6.0)

--- Step 1: Validating Positive Controls ---
✓ PASS: run-valid.json passes unified structural and semantic validation
✓ PASS: ledger-valid.json passes unified structural and semantic validation
✓ PASS: run-valid-failure-unjoined-counter.json passes validation (honest unjoined delivery_failure stands when cause is not_observable)
✓ PASS: run-valid-overlap-inconclusive.json passes validation (clock overlap correctly classified as inconclusive)
✓ PASS: run-valid-disambiguation.json passes validation (selectedCanonicalId in candidateSet and matches prefix)
✓ PASS: run-valid-delivery-failure-missing-reader.json passes schema validation as an honest delivery failure record
✓ PASS: validateRunAgainstLedger cleanly scores missing pair without invalidating honest failure evidence
✓ PASS: validateRunAgainstLedger verifies run-valid.json satisfies ledger-valid.json expected-pair contract

--- Step 2: Validating Structural Negative Controls ---
✓ PASS: Caught expected structural error in run-invalid-missing-root-holder.json (rootHolderId required)
✓ PASS: Caught EMPTY_EXPECTED_READERS in ledger-invalid-missing-readers.json

--- Step 3: Validating Semantic Negative Controls (Strictly Asserting Zero Structural Errors) ---
✓ PASS: Caught CONFLATION_DISPATCH_DELIVERY with 0 structural errors in run-invalid-ok-without-reader.json
✓ PASS: Caught SUBSCRIPTION_ORDERING_VIOLATION with 0 structural errors in run-invalid-unsubscribed-reader.json
✓ PASS: Caught STALE_EVIDENCE_REATTACH with 0 structural errors in run-invalid-stale-reattach.json
✓ PASS: Caught UNJOINED_CAUSAL_CLAIM with 0 structural errors in run-invalid-unjoined-causal-claim.json
✓ PASS: Caught UNJOINED_CAUSAL_CLAIM with 0 structural errors in run-invalid-joined-drop-stale-baseline.json (rejected claimed joined drop_stale at baseline)
✓ PASS: Caught RUNTIME_ABORT_MISLABELED_AS_SETUP with 0 structural errors in run-invalid-abort-as-setup.json
✓ PASS: Caught EMPTY_READER_OBSERVATIONS with 0 structural errors in run-invalid-empty-readers.json
✓ PASS: Caught IDENTICAL_REPUBLISH_DOUBLE_COUNT with 0 structural errors in run-invalid-identical-republish-dedup.json
✓ PASS: Caught AMBIGUOUS_PREFIX_COLLISION with 0 structural errors in run-invalid-ambiguous-node-prefix.json
✓ PASS: Caught SAME_PREFIX_COLLISION_WITHOUT_DISAMBIGUATION with 0 structural errors in run-invalid-same-prefix-collision.json
✓ PASS: Caught SAME_PREFIX_COLLISION_WITHOUT_DISAMBIGUATION with 0 structural errors in run-invalid-disambiguation-not-in-set.json
✓ PASS: Caught CROSS_ATTEMPT_REPUBLISH_DEDUP with 0 structural errors in run-invalid-cross-attempt-dedup.json
✓ PASS: Caught UNVERIFIED_JOIN_FLAG with 0 structural errors in run-invalid-unverified-join-flag.json
✓ PASS: Caught UNVERIFIED_JOIN_FLAG with 0 structural errors in run-invalid-join-proof-unresolved.json
✓ PASS: Caught UNJOINED_CAUSAL_CLAIM with 0 structural errors in run-invalid-join-node-id-bypass.json (bot n2 regression control)
✓ PASS: Caught CLOCK_OVERLAP_MARKED_PASS with 0 structural errors in run-invalid-overlap-marked-pass.json
✓ PASS: Caught CLOCK_OVERLAP_MARKED_PASS with 0 structural errors in run-invalid-overlap-sameclock-assertion.json
✓ PASS: Caught OMITTED_EXPECTED_READER in run-invalid-omitted-expected-reader.json against ledger
✓ PASS: Caught UNEXPECTED_READER_OBSERVED in run-invalid-unexpected-reader.json against ledger
✓ PASS: Caught LATENCY_DEADLINE_EXCEEDED_UNMARKED_LATE in run-invalid-unmarked-late.json against ledger
✓ PASS: Caught CROSS_RUN_DUPLICATE_DELIVERY in multi-run set validation
✓ PASS: Multi-run arrival with deduplicated: true correctly scored duplicate-suppressed without delivery double-counting

======================================================
ALL 31 TESTS PASSED: 32/32 invariants, structural controls, and semantic controls verified offline.
======================================================
```

---

## 4. Verification of Replay Cases

In accordance with CP Aster's directive (`e1ae89aa`) and `axona.bot`'s review commitment (`fcca72f5`), all four targeted failing cases were evaluated against `packages/v1.6/`:

1. **Replay Case 2 (Clock Overlap Claiming Pass)**:
   - Configuration: Reader subscribed 50 ms after publisher dispatch inside 200 ms combined clock uncertainty window, declaring `orderingEvidence.sameClock: true`, and asserting `classification: "pass"`.
   - Verdict: `valid: false`. Caught `CLOCK_OVERLAP_MARKED_PASS`.
2. **Replay Case 3(i) (Joined `drop_stale` at Baseline)**:
   - Configuration: Run reports `classification: "delivery_failure"`, `cause: "drop_stale"`, claiming `hasLogicalMessageIdJoin: true` pointing to `serviceNode` with `dropStaleDelta: 5`.
   - Verdict: `valid: false`. Caught `UNJOINED_CAUSAL_CLAIM` (baseline drop-stale events lack message identity per `wireHandlers.js:414`).
3. **Replay Case 3(ii) (Invented Hook Source `relay.audit.join`)**:
   - Configuration: Run claims causal join via non-existent hook source string `relay.audit.join`.
   - Verdict: `valid: false`. Caught schema validation structural error (rejected by `hookSource` enum).
4. **Replay Case n2 (Node ID Equality Bypass)**:
   - Configuration: Run reports `classification: "delivery_failure"`, `cause: "client_unsubscribed"`, claiming `hasLogicalMessageIdJoin: true`, setting reader `payloadHash` and `joinValue` to `serviceNodes[0].canonicalNodeId`.
   - Verdict: `valid: false`, `structuralErrors: 0`. Caught `UNJOINED_CAUSAL_CLAIM` (node-ID equality resolver removed; joined claims rejected across baseline source set).
