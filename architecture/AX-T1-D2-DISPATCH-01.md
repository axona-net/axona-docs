# AX-T1-D2-DISPATCH-01 — baseline manifest and evidence schema

Authority: David approved D2 and directed Aster to proceed. This dispatch authorizes **T1.1 and T1.2 only** under D1 plus approved D2 amendments. It does not authorize production changes, launching fixture peers, kernel instrumentation, or T1.3 harness implementation.

## T1.1 — axona.bot: baseline manifest and artifact inventory

Start the read-only inventory and produce a reviewable machine-readable baseline manifest plus a concise provenance/limitations note. Include kernel, relay, SDK, MCP, chat, bridge and relevant docs; resolve reported adce81c to its full commit, preserve in-flight/dirty changes, identify runtime/dependency/lockfile versions, and distinguish checkout, built artifact, running process and remote report. Do not build, launch or deploy merely to fill an unknown field. Local manifest/collector code edits and offline validation are permitted; keep them bounded to this deliverable and disclose dependencies.

Import the timestamped census for all droplets, M1, Linux, Windows and Air; refresh through existing authorized read-only access where feasible. No new credentials or privileged access assumed. Unknowns are explicit, including current process identification, Windows resource/health-dump gaps, storm-window comparability and soak contamination. Old snapshots are not current fleet certification. Do not overwrite other contributors' work.

Deliver: artifact paths, hashes, exact collection/validation commands, collection times and source references, manifest data, limitations, local change diff or commit reference if one already exists, and a proposed baseline disposition. Secrets and private security details stay out of shared evidence.

Reviewers: Orion checks provenance/completeness; Vega independently spot-checks a second host or client path using available authorized access. Unavailable access yields a bounded blocker, not a fabricated verification. Aster integrates unresolved baseline choices for David.

## T1.2 — Orion: versioned evidence schema and expectation ledger

Begin the schema now against D1/D2; bind its artifact examples to T1.1 when available. Produce machine-readable schema definitions, valid and deliberately invalid synthetic examples, an offline validation command/test, and an API/evidence mapping with explicit unobservable fields. Reuse repository conventions and existing tooling where suitable; propose paths before overlapping edits. No live network testing or kernel behavior changes.

Required distinctions: run/logical-message/attempt/protocol IDs; full topic descriptor with safe redaction; publisher/API result, named service-node evidence and named reader observation; observer-scoped root versus holder identity, epoch and transition events; counter units/windows/resets; UTC/monotonic clock limits; expected reader/message pairs; duplicates, late results, failed setup, runtime abort and not_observable causality. Mandatory synthetic payload nonce/logical identity. Identical retry attempts may share a protocol ID. Schema cannot claim unobservable telemetry exists.

Negative examples/tests must reject or explicitly classify: publisher ok without required reader evidence; unsubscribed expected-reader mismatch; stale evidence attached to a new attempt; drop-event counts labeled unique-message losses; missing causal joins filled by inference; and runtime abort relabeled setup failure. Structural validation alone cannot prove evidence truth: document which cross-record invariants require the offline validator and which require independent observation.

Deliver: schema/version, examples, executable offline validation/tests and their results, evidence mapping to inspected baseline APIs or clearly marked pending inspection, paths/hashes and limitations. No full live harness is needed for schema acceptance.

Reviewers: Vega challenges denominator, identity and missing-evidence semantics; axona.bot verifies mappings against the actual baseline code, with exact source references and counterexamples. Aster integrates differences. Neither author certifies their own deliverable.

## Checkpoints and completion

Both owners: confirm this dispatch ID and access to D2, name intended artifact paths, and provide an explicit UTC first-output ETA or blocker in your next substantive response. Provide a completion estimate separately if different. Reviewers: confirm availability and propose a turnaround interval after artifact receipt. These are requested estimates, not invented agreed deadlines.

Aster will check acceptance/access within 30 minutes of publication; this is a CP follow-up checkpoint, not a claim that an owner agreed to finish in 30 minutes. No owner response means receipt/acceptance unknown; it does not prove transport or scheduler failure. Escalate unresolved access or wake gaps and retain a single task/revision identity on any bounded resend.

T1.1 acceptance: reviewed provenance, complete component/host coverage or explicit unknowns, reproducible commands and independently checked samples. T1.2 acceptance: reviewed semantics, examples and offline tests accounting for all declared invariants and observable boundaries. Report partial outputs as partial. No obligation to turn a failing baseline green.

T1.3 starts only after Aster records the reviewed T1.1/T1.2 disposition and issues its scoped dispatch. Material contract changes go to David; do not add blanket per-commit approval requirements. All D1 general-review deadlines are closed.
