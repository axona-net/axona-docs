# REF-1.1 S1f Re-cut — Response to Aster's S1e Disposition

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S1F-RECUT-20260810-01`
- **Scope:** REF-1.1 registry core, re-cut at commit `7dce10d` (parent `85451c0`)
- **Author:** axona.bot
- **Date:** 2026-08-10
- **Status:** returned for Aster's review; S2 wiring remains blocked

## The finding I got wrong, and the fix

S1e's disposition was right and the correction is architectural. S1e removed
`Object.keys` but still *reflected* on the live handler argument:
`Object.getPrototypeOf` inside `isPlainRecord`, `Object.getOwnPropertyDescriptor`
inside `readLeaf`, and `Array.isArray` + `.length` on a proxied array all invoke
Proxy traps. Aster's probes proved the consequences: a `getPrototypeOf` trap
mutated the payload before delivery, and a throwing trap suppressed the handler.
JavaScript cannot prove an object is not a Proxy by inspecting it — the
inspection is itself trap-capable. Gating "is this plain?" by reflection is
unsound.

S1f stops reflecting on live arguments. The shadow layer reads **only** a
decoder-produced snapshot whose provenance is a module-private `WeakSet` brand
(`snapshot()` / `isSnapshot`). A `WeakSet` membership check is identity-based and
fires no trap, so:

- An **unbranded** argument — any Proxy, including a revoked one — is observed as
  nothing. The dispatcher emits a codes-only `unbranded-source` trace and calls
  the handler verbatim with the original argument. No trap fires, nothing is
  mutated, the handler is never suppressed, its arguments are unchanged, and the
  entire observe path is wrapped so an observer fault can never alter delivery.
- A **branded** snapshot is decoder/parser output, Proxy-free by construction, so
  `getOwnPropertyDescriptor` on it is safe.

`snapshot()` performs no reflection — it records identity only, so it cannot
itself trip a trap. Its contract: the frame decoder is the only trusted caller,
and it brands parser output. At S2 the seam brands what the decoder produces;
until then, every dispatch is `unbranded-source` and the handler runs verbatim —
which is the correct, safe default.

## The clearance-gate table

| Aster S1e requirement | S1f |
| --- | --- |
| No reflection on untrusted live handler arguments | Only a `WeakSet`-branded snapshot is read; unbranded args (any Proxy) are never reflected on. |
| Contained, verbatim delivery under all root and nested Proxy cases | Root Proxy with side-effecting traps, throwing `getPrototypeOf`, proxied array, and revoked Proxy are each proven to run the handler once, verbatim, with no trap fired and no exception escaping. |
| Correct bounded UTF-8 accounting for malformed surrogates | 4 bytes only for a valid pair; a lone surrogate is the 3-byte replacement and does not skip the next unit. A lone high surrogate + `é` now measures 5 bytes and faults under a 4-byte cap. |
| Side-qualified or collision-rejected payload/meta recipes | A path declared on both payload and meta is rejected at `defineRow`; a recipe path resolves to exactly one side. |
| Hard byte limits on budgets and declaration keys | `budget.maxBytes` has a global ceiling (65536); `capabilityRange` keys and `variantBy.cases` keys are length-capped. |
| Work accounting that matches the documented bound | `maxWork` is renamed `maxLeaves` (charges per projected leaf path); `MAX_REFLECT_OPS` is a fixed hard ceiling on descriptor reads, including the variant discriminator. |

## Gate

`test/smoke_registry_core.mjs` reproduces every failure the S1e disposition
demonstrated: side-effecting and throwing root Proxy traps, nested/proxied
arrays, revoked Proxies, malformed-surrogate byte accounting, payload/meta
collisions, and unbounded budgets/keys — proving shadow mode cannot mutate
handler-visible state, suppress the handler, change its arguments, or introduce
an observer exception.

Result at `7dce10d`: 52 assertions, 0 failed. Full default suite 150/150, 0
failed; manifest guard reports disk and manifest agree. The registry is additive
and flag-off, so these describe the core in isolation, not behavior under a wired
boundary — that is S2, and S2 is not requested here.

## Note on the snapshot contract

The remaining trust boundary is `snapshot()`'s caller: it brands whatever it is
given, so it must only be called by the frame decoder on parser output, never on
a user-supplied object. That is the same trust the decoder already holds. Wiring
the decoder to brand its output is an S2 concern; S1f exposes the safe API and
proves the wrapper's half — unbranded input is never reflected on.

## What this does not clear

Review of the core only. Not a request to wire S2, run a testnet canary, or
deploy. Those stay blocked until Aster reviews a corrected core and explicitly
clears it.
