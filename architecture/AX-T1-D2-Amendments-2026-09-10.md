# AX-T1-D2 — integrated council amendments for David

Status: **Approved by David on 10 September 2026.** Read together with approved AX-T1-D1; unchanged clauses continue to apply and D1/hash are preserved. David authorized proceeding with T1.1 and T1.2 first. See AX-T1-D2-DISPATCH-01 for scoped implementation assignments. No production change or kernel instrumentation is authorized.

All three reviews are complete within their commitments. Orion and Vega report blind initial reviews; axona.bot disclosed reading Orion/CP first. Each accepted its proposed roles. Review references: Orion `4e5779be`, bot `02275820`, Vega `83f2d012` (full IDs in review tracking).

## 1. Enforce isolation before any fixture starts

T1.3 must establish a deny-by-default network boundary for every test descendant, allow only explicitly declared fixture endpoints, and isolate identities/state/browser profiles. Loopback signaling and temporary directories alone are insufficient. Verify actual state-path options rather than assuming an environment variable exists. An active negative test must prove forbidden discovery/egress is blocked. If containment cannot be established, record blocked setup and do not launch peers. No production daemon, arbitrary process or host-wide firewall changes are authorized.

Bind executed artifacts and dependencies to the manifest, including captured dirty modifications. Use platform-appropriate process containment and verify descendant termination and fixture-port cleanup after abort. Preserve evidence of cleanup failures and stop subsequent runs until resolved.

## 2. Add explicit root-lineage evidence fields

T1.2 includes observer-scoped root identity, epoch, transition reason/event, timestamp, source reference, and stale-drop counter value/delta with reset/window semantics. Keep root and holder roles distinct. Each field is observed, not_observable, or missing due to collection failure; do not fill unknowns from narrative inference. A counter delta is not a unique-message loss count.

Before C5/C6 runs, assess whether their causal assertions are observable at the baseline. Mark untestable causal portions blocked on observability; do not disguise an impossible assertion as failed runtime setup. Separately executable end-to-end delivery assertions may still run and be scored. Kernel logging changes remain outside D1 scope; bring any needed instrumentation amendment, including measurement effects, to David separately. Never use adjacent log lines as a proven message join.

## 3. Split C5 and declare its predicates

C5a tests terminal admission on a non-near fresh peer using separate terminating SUB and PUB cases. Prove local termination, initial incumbent/root state and epoch conditions before evaluating admission and incumbent yield. C5b tests the proximity-driven case. Specify the actual baseline distance metric, topic/region coordinate and candidate ordering, with ties handled explicitly. Generate identities only inside the isolated fixture, without altering production identities.

In both cases, observe tenure, terminate the test peer uncleanly, and score publications during tenure and after failure with matched controls. Failed setup is inconclusive, not evidence against the general hypothesis. A single negative does not settle it. Do not assume that an arbitrary non-near publication terminates locally.

## 4. Strengthen message and observer controls

Run nonce and logical message identity in synthetic payloads are mandatory. Preserve separate attempt IDs for identical retries even when protocol IDs are identical. Independently check baseline canonicalization and dedup scope; add a two-topic control rather than infer cross-topic suppression from matching IDs.

Add a deliberate expectation/reader mismatch control: a listed but unsubscribed reader must never produce a delivery PASS from publisher success. Classify invalid setup separately from an intentional missing-reader negative test. Add a harness-controlled chat-path drop: optimistic UI indications are retained separately from independently verified payload receipt.

For C7, an actual fresh process start must produce fresh transport identity under the documented contract. Persistent-process reconnect is a separate case. Preserve durable author identity where required.

## 5. Resource outcomes remain honest

Preflight records measurable capacity/platform constraints; thermal state is recorded only where actually observable. Resource failure before a scenario is setup failure. OOM, throttling or budget abort during execution is an explicit runtime abort/resource result with timing and evidence—not retroactively relabeled setup failure to hide it. Neither counts as a completed causal experiment or passing service test. Existing limits remain proposed as in D1; no claim that eight peers fit every host.

## Decision record

David approved the amendment set and the recommendation to dispatch T1.1 and T1.2 first. It tightens isolation, evidence contracts and test coverage; it does not change production behavior, authorize kernel instrumentation, settle the root-cause hypothesis or close #60. T1.3 remains gated on reviewed T1.1/T1.2 outputs. No additional general design review is needed before these assignments.
