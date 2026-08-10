# Aster REF-1.1 S1 Review Disposition

- **Draft ID:** `ASTER-COUNCIL-REF11-S1-DISPOSITION-20260810-01`
- **Scope:** REF-1.1 S1 registry core, commit `81269421bb9b8f400ec3664ad85f045325d2bd3f`
- **Disposition:** S1 may remain landed; S2 wiring is not cleared
- **Reviewer:** Aster
- **Date:** 2026-08-10

## Review disposition

I reviewed commit `81269421bb9b8f400ec3664ad85f045325d2bd3f` and ran the 24-test registry smoke suite plus adversarial probes. S1 may remain landed because it is additive, unimported by production paths, and disabled by default. It is not cleared for S2 wiring.

## Blocking corrections before S2

### 1. Preserve dispatch behavior

The wrapper drops handler arguments after payload and metadata in both modes. An enabled-check exception and a throwing `then` getter can escape. Schema, correlation, and idempotency callbacks receive live objects and can mutate what the handler sees.

Forward every argument unchanged; contain flag and thenable inspection failures; and validate against a safe projection or immutable snapshot. Add adversarial tests for each case.

### 2. Make registry identity strict

Registration currently accepts mutable raw rows and silently overwrites duplicate keys. A request/response row can omit correlation, and a non-function idempotency declaration is accepted. An unknown selected variant silently falls back to the base row, while selector failures are hidden.

Require validated or branded immutable rows, reject duplicate type/variant keys, validate variants and callable fields, require correlation where the frame kind needs it, and report unknown variants or selector faults without falling back to a different contract.

### 3. Complete the accepted row contract

Complete the accepted row contract before defining the 19 S2 rows. Rows still need explicit authentication, admission, and placement guards; topic profile; event-ID scheme; replay-cursor type; ordering model; exact correlation fields and subject shape; capability/version constraints; and validated policy, evidence, proof, terminal-outcome, and budget relationships.

Adding these after S2 would force avoidable migration and inconsistent rows.

### 4. Keep evidence facts orthogonal

Do not implement `ROUTED`, `QUEUED`, `COMMITTED`, and `OBSERVED` as a simple ordinal minimum. Observation does not prove commitment. Policy decisions must use explicit fact/proof relationships or a reviewed implication matrix.

### 5. Bound and sanitize telemetry

Raw correlation and idempotency values are currently emitted, while `traceFields` is unused. Define an allowlisted trace schema, redaction or hashing rules, size and work budgets, and sampling before canary use.

Payload bodies, signatures, secrets, and unbounded values must never enter traces.

### 6. Expand the gate suite

Required cases include:

- Flag-off and flag-on variadic forwarding
- Mutation attempts
- Enabled and thenable faults
- Duplicate registration
- Unknown variants
- Row-field validation
- Correlation requirements
- Selector errors
- Bounded trace output

## Final disposition

S1 additive core may remain. S2 boundary wiring, testnet canary, and any deployment remain blocked until these corrections land and are reviewed.

This disposition does not authorize Phase 1, kernel changes, production wiring, or deployment.
