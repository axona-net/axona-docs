# REF-1.1 S1e Re-cut — Response to Aster's S1d Disposition

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S1E-RECUT-20260810-01`
- **Scope:** REF-1.1 registry core, re-cut at commit `85451c0` (parent `8422c3e`)
- **Author:** axona.bot
- **Date:** 2026-08-10
- **Status:** returned for Aster's review; S2 wiring remains blocked

## The one change that matters

Aster's S1d disposition named the root cause: `defineRow` still accepted
`schema`, `correlation`, and `idempotencyKey` **functions**, and the dispatcher
ran them synchronously before the handler. Freezing their arguments does not make
arbitrary code pure — a schema callback mutated closed-over state and changed
what the handler observed. Aster's instruction was to eliminate the callback
execution boundary, not to add guards around it.

S1e removes the callbacks. A row carries no executable code. `schema`,
`correlation`, and `idempotency` are declarative recipes; a fixed evaluator in
`shadowRegistry.js` — the only interpreter — reads them against the already-
projected, frozen facts. `defineRow` rejects a function in any of those fields
(and rejects the legacy `idempotencyKey` name outright). Nothing dynamic runs in
the dispatch thread.

## The seven required corrections

| # | Aster's requirement | S1e |
| --- | --- | --- |
| 1 | 100% declarative recipes; no user code in dispatch | `schema {require,forbid,types}`, `correlation {kind,requires}`, `idempotency {from}` — path recipes a fixed evaluator interprets. Functions rejected at `defineRow`. Schema result is a fixed enum (`missing-required` / `forbidden-present` / `type-mismatch`), never free text. |
| 2 | Deep fact immutability | Structural facts frozen at creation; fact maps frozen; the only reader is the internal evaluator, so no observer can alter `arr.len` between reads. |
| 3 | No enumeration of untrusted live objects | `represent()` no longer calls `Object.keys` — an object projects to `{k:'obj'}` with no key count, so the Proxy `ownKeys` trap is never reachable. A non-plain (non-decoder-owned) root is a `source` fault and is not read; only declared paths are ever touched, via own-data descriptors. |
| 4 | Real budget enforcement | `maxWork` caps the number of field reads (over budget → `work` fault, remaining fields unread); `maxBytes` is a UTF-8 byte cap with early stop (`é` = 2 bytes, not 1 UTF-16 unit); bigint is a structural fact, so there is no unbounded `toString`. |
| 5 | Projection-bound variant selection | `variantBy` is validated at `wrap()`: the discriminator path must be a declared payload projection field of every registered variant, and every possible result must name a registered variant. |
| 6 | Null-prototype containers, clean sentinels | Fact maps are `Object.create(null)`; path segments `__proto__` / `prototype` / `constructor` are rejected; the base-row key is a module-private `Symbol`. The literal NUL byte that made `shadowRegistry.js` read as a binary file is gone. |
| 7 | Enforced collection caps | Capability keys (16), variant cases (32), errorContract (16), traceFields (16), projection (24) — all capped and rejected over limit. |

### On correction 7 — a claim I have to correct

My S1d gate and response doc stated capability key counts were bounded. They
were not: S1d bounded value lengths and finiteness only, and a 1,000-key
`capabilityRange` was accepted. S1e caps the key count and the gate proves the
17-key case is rejected. The earlier claim was wrong; this records that.

## Gate

`test/smoke_registry_core.mjs` reproduces each failure the S1d disposition
demonstrated, as the required regression set: no row declaration can execute
user code, mutate dispatch-visible state, inspect undeclared live data, exceed
work or byte budgets, select variants from undeclared fields, alter object
prototypes, or bypass collection caps.

Result at `85451c0`: 46 assertions, 0 failed. Full default suite 150/150, 0
failed; manifest guard reports disk and manifest agree. These hold on this
checkout at this commit; the registry is additive and flag-off, so they describe
the core in isolation, not behavior under a wired boundary — that is S2, and S2
is not requested here.

## What this does not clear

Review of the core only. Not a request to wire S2, run a testnet canary, or
deploy. Those stay blocked until Aster reviews a corrected core and explicitly
clears it.
