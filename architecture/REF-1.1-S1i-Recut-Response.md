# REF-1.1 S1i Re-cut — Trust-Model Correction (Option B), per Aster's S1h Steer

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S1I-RECUT-20260810-01`
- **Scope:** REF-1.1 registry core, re-cut at commit `c187030` (parent `a249f93`)
- **Author:** axona.bot
- **Date:** 2026-08-10
- **Status:** returned for Aster's review; S2 wiring remains blocked

## The decision this closes

Aster's S1h disposition accepted every S1h code fix and left one blocking item:
my "post-load tamper resistance" claim was inconsistent — I captured `JSON.parse`
at load but left `Object.keys`, `WeakSet.prototype.has`, and
`Object.getOwnPropertyDescriptor` as mutable globals, and her probes replaced each
of the three post-load to mutate a handler-visible frame. She offered two trust
models; David directed me to ask Aster which to implement, and Aster's steer was
**Option B**: narrow the documented boundary to intact realm intrinsics for the
whole lifetime, drop the post-load-resistance claim, no capture-and-bind
enumeration. This re-cut implements Option B against her five acceptance
conditions.

## The five conditions, and how S1i meets each

1. **State the boundary normatively in code and architecture docs — intact
   throughout, not merely at load.** Done: the trust boundary is stated at the
   top of `snapshotMint.js`, referenced from `index.js`, and written normatively
   into the refactor plan §4.3 ("Shadow observation — trust boundary").
2. **Remove every general post-load intrinsic-tamper-resistance claim.** Done: the
   "pristine parser captured at load" framing is gone; the only remaining
   mentions state that such resistance is *out of scope* and what a real one would
   require.
3. **`JSON.parse` capture + gate 0e are defense-in-depth only, or removed for
   clarity.** Removed, for clarity: `certify` calls `JSON.parse` directly, and the
   post-load-swap gate (0e) is deleted, since it tested a property the model no
   longer claims.
4. **Preserve the S1h construction-tag and prototype-trap-isolation gates —
   attacker mutation of certified values and their prototype chains stays in
   scope.** Preserved: `kindOf` construction tags remain; the prototype-swap gates
   (side-effecting + throwing, payload + metadata) and the hostile-prototype
   typed-array gate remain and pass.
5. **Document that same-realm tamper resistance would need a kernel-wide hardened
   compartment / SES-style boundary, not a local checklist.** Stated in both
   `snapshotMint.js` and the refactor plan.

## What did NOT change

No dispatch behavior, no new hardening code, no capture-and-bind. The
construction-time classification, the transitive per-node membership checks, the
UTF-8 accounting, the recipe/bounds/work-accounting rules, and the cache-bust
guard are all as Aster accepted them. This is a trust-model and documentation
correction.

## Gate

`test/smoke_registry_core.mjs`: 48 assertions, 0 failed (gate 0e removed; all S1h
prototype-isolation gates retained). Full `npm test` runs cache-bust + manifest
guard + suite — **150/150**.

Files: `src/pubsub/registry/snapshotMint.js`, `index.js`,
`test/smoke_registry_core.mjs` (protocol); `architecture/code-refactor-plan.md`
§4.3 (docs).

## What this does not clear

Review of the core only. Not a request to wire S2, run a testnet canary, or
deploy. Those stay blocked until Aster reviews the S1i diff and explicitly clears
it.
