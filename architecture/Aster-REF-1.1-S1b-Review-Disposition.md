# Aster REF-1.1 S1b Review Disposition

- **Draft ID:** `ASTER-COUNCIL-REF11-S1B-DISPOSITION-20260810-01`
- **Scope:** REF-1.1 S1b registry hardening, commit `dac55aa`
- **Disposition:** S1b may remain dormant; S2 wiring is not cleared
- **Reviewer:** Aster
- **Date:** 2026-08-10

## Executive disposition

I reviewed commit `dac55aa`. The advertised registry suite passes: 32 assertions, zero failures. Targeted adversarial probes nevertheless demonstrate that the six requested corrections are not yet fully resolved.

S1b may remain landed only because it is additive, unimported, and disabled by default. S2 wiring is not cleared.

## Blocking findings

### 1. Snapshot isolation still fails on the fallback path

`safeSnapshot` uses `structuredClone` when possible, but if cloning fails it returns a shallow frozen copy. Nested objects remain shared with the live frame. A schema callback mutating a nested property changed what the real handler observed when the payload also contained an uncloneable value.

Measured result:

```text
fallbackNestedMutationReachedHandler = "mutated"
```

The successful-clone path is also mutable and shared among schema, correlation, and idempotency callbacks, allowing one observer to alter another's evidence.

Never pass observers a graph sharing references with live dispatch input. If a safe bounded projection cannot be produced, skip observation and emit a snapshot fault. Use independent immutable projections where observer isolation is required.

### 2. Handler-return inspection can still change behavior

`isThenableSafe` contains a throwing `then` getter, but `verdictOf` subsequently reads `result.consumed` without containment. A throwing `consumed` getter escaped after the handler returned successfully.

Measured result:

```text
handler ran = true
escaped error = "consumed getter"
```

Coarse verdict extraction must be entirely defensive and must never invoke arbitrary accessors or proxy traps.

### 3. Selector output is not safely validated

A non-string selector result reaches the registry key template and can execute user-defined coercion outside containment. The probe's coercion fault escaped and the real handler never ran.

Measured result:

```text
handler ran = false
escaped error = "variant coercion"
```

Validate selector output inside the guarded block as `null` or a bounded string. Invalid output must resolve no contract, record a selector fault, and still dispatch unchanged.

### 4. Registry branding is forgeable

`ROW_BRAND` uses `Symbol.for`, and `isRow` checks only that property. A frozen raw object carrying the public symbol was accepted by `register`.

Measured result:

```text
forgedBrandAccepted = true
```

Use a module-private `WeakSet` of rows minted by `defineRow`, or an equivalently non-forgeable mechanism, and retain frozen-shape validation.

### 5. Telemetry is not fully bounded or allowlisted

The selected variant is emitted raw and unclamped; a probe produced a 10,000-character trace field. `correlation.kind` is callback-controlled rather than fixed to the row's declared `subjectShape`.

Measured results:

```text
traceVariantLength = 10000
traceCorrelationKind = "SECRET-IN-KIND"
```

Emit only bounded registry-declared labels. Also, 32-bit unkeyed FNV must not be described as non-reversible or privacy-preserving: it is collision-prone and brute-forceable for low-entropy inputs. Either omit these tags or use a reviewed cryptographic, deployment-scoped pseudonymization design.

### 6. The row contract is still insufficiently validated

`defineRow` accepted malformed version ranges, non-string guard and profile fields, string values where arrays were expected, and negative or nonnumeric budgets.

Measured result:

```text
malformedContractAccepted = true
```

Validate:

- Integer version bounds and their ordering
- Guard, profile, event, cursor, and ordering types
- Unique string correlation fields
- Error and trace arrays
- Positive bounded budgets
- Capability ranges
- Required policy, evidence, proof, and terminal-outcome relationships

Fields required by the accepted plan should be explicit rather than silently normalized from omission.

### 7. Observation work is not bounded

`structuredClone` can copy the entire payload, and `shortHash` can JSON-stringify and scan an unbounded observer result. `budget.maxBytes` and `budget.maxWork` are stored but not enforced.

Before canary use, observation must operate on a bounded declared projection and reject or truncate work before allocation or hashing.

## Required gate additions

The next gate must reproduce and close these cases:

- Nested mutation after clone failure
- Cross-observer mutation
- Throwing `consumed` getter
- Invalid selector coercion
- Forged row brand
- Unbounded variant telemetry
- Callback-controlled correlation kind
- Malformed contract fields
- Oversized hashing input

## Final disposition

S1b may remain as dormant additive code. S2 boundary wiring, testnet canary, and deployment remain blocked.

Re-cut the core and return it for review. This disposition grants no further clearance.
