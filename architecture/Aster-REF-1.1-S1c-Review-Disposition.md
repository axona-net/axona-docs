# Aster REF-1.1 S1c Review Disposition

- **Draft ID:** `ASTER-COUNCIL-REF11-S1C-DISPOSITION-20260810-01`
- **Scope:** REF-1.1 S1c registry hardening, commit `147da1d`
- **Disposition:** S1c may remain dormant; S2 wiring is not cleared
- **Reviewer:** Aster
- **Date:** 2026-08-10

## Executive disposition

I reviewed commit `147da1d`. Its registry gate passes: 33 assertions, zero failures. Independent adversarial probes still demonstrate acceptance-path effects, telemetry leakage, registry identity confusion, and incomplete contract validation.

S1c may remain landed because it is additive, unimported, and disabled by default. S2 wiring is not cleared.

The recurring root issue is that the shadow layer still executes or inspects dynamic JavaScript values where it needs a declarative, side-effect-free boundary.

## Blocking findings

### 1. Observation can still mutate what the handler sees

The variant selector receives the live arguments. A selector that changed payload state changed the handler's input.

Measured result:

```text
selectorMutatedHandler = "selector-mutated"
```

Projection also reads `obj[field]`, invoking accessors before dispatch. A declared-field getter mutated the live frame, and the handler observed it.

Measured result:

```text
projectionGetterMutatedHandler = "getter-mutated"
```

Do not execute selectors against live dispatch objects. Make variant selection declarative or run it against a separate bounded selector projection.

Projection must read only normalized decoder-owned data records and own data properties. Accessor properties must be skipped and reported as projection faults. State and enforce the plain-record boundary assumption because arbitrary proxies cannot be made side-effect-free by `try`/`catch`.

### 2. Return inspection is still not passive

The wrapper invokes arbitrary `then` and `consumed` accessors even when exceptions are contained. A returned object's `then` getter and `consumed` getter were each invoked once. A custom thenable's `then` method was called once solely by shadow observation.

Measured results:

```text
then getter calls = 1
consumed getter calls = 1
custom thenable calls = 1
```

These calls can mutate state, start work, or consume a one-shot thenable even though the wrapper returns the same object.

Do not inspect arbitrary returned objects or generic thenables. Use primitive-only coarse verdicts. If asynchronous outcome observation is required, make it an explicit owning-service adapter for a known native `Promise` contract rather than generic wrapper introspection.

### 3. Telemetry still leaks callback-controlled and handler-controlled text

A schema reason containing a projected topic identifier appeared in the trace. A handler exception message containing a secret also appeared.

Measured results:

```text
schemaReasonLeaksSecret = true
handlerErrorLeaksSecret = true
```

Open telemetry must emit fixed allowlisted fault codes, not schema reasons, exception messages, unknown variant values, or other dynamic text. Detailed diagnostics, if needed, require a separate protected sink with an explicit policy.

### 4. Registry keys are structurally ambiguous

`_key(type, variant)` concatenates strings with `#`. Registering a base row whose type was `a#b`, then looking up type `a` with variant `b`, resolved the wrong contract.

Measured result:

```text
registered = true
owningService = "WRONG-CONTRACT"
```

Use nested maps or a structured tuple key. Do not rely on delimiter concatenation. Validate the wrapper's frame type at construction.

### 5. Strict row validation remains incomplete

`defineRow` accepted all of the following in one row:

- 25 projection fields despite the runtime silently observing only 24
- A string instead of a budget object
- A 10,000-character capability value
- A non-string note that was silently discarded
- Evidence `OBSERVED` paired with `proves: routing`

Measured result:

```text
incompleteStrictValidation.accepted = true
```

Reject projection lists exceeding the runtime limit instead of silently truncating them. Require plain objects for budget, capability range, and projection; cap key counts and string lengths; require finite numeric capability values; validate notes; require explicit fields mandated by the accepted plan; and validate evidence, proof, policy, outcome, and terminal relationships.

Correlation fields must be demonstrably available through the declared projection.

### 6. The projection is bounded but not schema-faithful

The projection truncates strings before validation and drops every array, byte sequence, and nested object. This can produce validation facts about data different from the actual frame and cannot express canonical schemas for complex frames across the four boundaries.

The declared `maxBytes` and `maxWork` budgets are stored but not applied.

Use a bounded declarative leaf-path projection with exact scalar values up to the row's declared limits and bounded structural facts for arrays, bytes, and objects. Oversized or unsupported values must produce a projection or budget fault, not a truncated value that is then treated as canonical input.

## Required gate additions

- Selector mutation cannot reach the handler
- Accessor-backed projected fields are never invoked
- Returned-object getters and generic thenables are never invoked
- Dynamic schema reasons and handler errors cannot enter open traces
- Type and variant keys cannot collide
- Projection lists above the runtime limit are rejected
- Non-object budgets and capability ranges are rejected
- Capability values and key counts are bounded
- Evidence and proof contradictions are rejected
- Oversized strings produce a fault rather than truncated validation
- Representative nested, array, and byte-bearing frame schemas retain canonical fidelity within declared budgets

## Final disposition

S1c may remain as dormant additive code. S2 boundary wiring, testnet canary, and deployment remain blocked.

Re-cut the observation boundary around declarative data rather than adding more `try`/`catch` around dynamic callbacks, then return it for review. This disposition grants no further clearance.
