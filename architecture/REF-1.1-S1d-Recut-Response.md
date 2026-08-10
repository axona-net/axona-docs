# REF-1.1 S1d Re-cut — Response to Aster's S1c Disposition

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S1D-RECUT-20260810-01`
- **Scope:** REF-1.1 registry core, re-cut at commit `8422c3e` (parent `147da1d`)
- **Author:** axona.bot
- **Date:** 2026-08-10
- **Status:** returned for Aster's review; S2 wiring remains blocked

## What changed and why

Aster's S1c disposition named one root cause: the shadow layer executed or
inspected dynamic JavaScript values where it needed a declarative,
side-effect-free boundary, and `try`/`catch` around a dynamic callback cannot
make that boundary safe. S1d removes the dynamic execution rather than guarding
it.

The two files under `src/pubsub/registry/` were rewritten. No file outside that
directory was touched. The registry is still unimported by any live path and
`AXONA_REGISTRY_SHADOW` still defaults OFF, so flag-off dispatch is a verbatim
pass-through.

### The observation boundary is now declarative data, not a callback

A row declares `projection` as a set of dotted **leaf paths**. On dispatch the
layer walks each path reading only own data-property descriptors
(`Object.getOwnPropertyDescriptor`); a path segment that resolves to an accessor
returns a projection fault and the getter is never called. Variant selection is
declarative too — `variantBy` is a path plus a presence/case map, resolved
against one bounded leaf read, never a function handed the live arguments. A
field getter or a discriminator getter can no longer run, so neither can mutate
what the handler receives.

### Return inspection is primitive-only

The wrapper reads no property on a returned value. A string verdict maps to
`consumed` / `other`; `undefined` / `null` / `false` map to `passed`; every
object or function is the opaque verdict `object`. `.then` and `.consumed` are
never touched, so a returned thenable is never driven and a one-shot is never
consumed by observation.

### Projection is schema-faithful within a declared budget

A scalar comes back exact up to the row's `maxBytes` cap; over the cap it is a
budget fault, not a truncated value passed to the schema as if canonical. Arrays,
byte sequences, and nested objects come back as bounded structural facts
(`{k:'arr',len}`, `{k:'bytes',len}`, `{k:'obj',keys}`). The facts record handed
to `schema`/`correlation` is frozen.

### Telemetry emits fixed codes only

A trace carries the wrapper's declared type, the declared variant name, the
declared correlation shape, and a fault vector of fixed code strings. A schema
result contributes its `code` only if that code is in the row's declared
`errorContract`; anything else collapses to `unlisted`. Schema reason text,
exception messages, and frame-controlled variant text never reach the sink.

### Registry keys cannot collide

`(type, variant)` is a nested `Map<type, Map<variant, row>>`. There is no
delimiter concatenation, so a base row typed `a#b` and a variant `b` of type `a`
resolve independently.

### defineRow rejects malformed rows

Over-limit projection lists, non-object budget / capabilityRange / projection,
oversized or non-finite capability values, non-string notes, evidence/proof
contradictions, and correlationFields not answerable from the declared
projection are rejected at construction — not silently normalized or truncated.

## Gate

`test/smoke_registry_core.mjs` reproduces every one of the eleven gate additions
Aster required, as named in the S1c disposition:

| Required gate addition | Assertion |
| --- | --- |
| Selector mutation cannot reach the handler | 2a–2c (declarative discriminator; accessor never invoked) |
| Accessor-backed projected fields never invoked | 3a–3b |
| Returned-object getters and generic thenables never invoked | 4a–4c |
| Dynamic schema reasons and handler errors cannot enter open traces | 5a–5b |
| Type and variant keys cannot collide | 6a–6b |
| Projection lists above the runtime limit rejected | 7a |
| Non-object budgets and capability ranges rejected | 7b–7c |
| Capability values and key counts bounded | 7d–7e |
| Evidence and proof contradictions rejected | 7g |
| Oversized strings produce a fault, not truncated validation | 8b–8c |
| Nested/array/byte schemas retain canonical fidelity within budget | 8d–8f |

Result at `8422c3e`: 36 assertions, 0 failed. Full default suite 150/150, 0
failed; manifest guard reports disk and manifest agree. These numbers hold on
this checkout at this commit; the registry is additive and flag-off, so they say
nothing yet about behavior under a wired boundary — that is S2, and S2 is not
requested here.

## What this does not clear

This re-cut asks for review of the core only. It is not a request to wire S2, to
run a testnet canary, or to deploy. Those remain blocked until Aster reviews a
corrected core and explicitly clears it.
