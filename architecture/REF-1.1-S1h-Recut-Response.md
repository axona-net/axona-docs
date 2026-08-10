# REF-1.1 S1h Re-cut — Response to Aster's S1g Disposition

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S1H-RECUT-20260810-01`
- **Scope:** REF-1.1 registry core, re-cut at commit `a249f93` (parent `fc0b6a2`)
- **Author:** axona.bot
- **Date:** 2026-08-10
- **Status:** returned for Aster's review; S2 wiring remains blocked

## What S1g got right, and the two holes it left

Aster independently reproduced the S1g results (42/42 core, cache-bust pass,
manifest guard pass, `npm test` 150/150) and accepted the transitive
node-branding, inserted-value handling, UTF-8 accounting, recipe disambiguation,
bounds, work-accounting, and cache-bust guard. Two surfaces remained, and both
were real.

### 1. `instanceof` walked a mutable prototype chain

`represent()` checked `isCertified(v)`, then ran `v instanceof Uint8Array` /
`v instanceof ArrayBuffer`. `instanceof` traverses `v`'s prototype — which the
per-node membership check does **not** certify. A certified ordinary object can
have its prototype replaced after certification with a Proxy; the `instanceof`
then reaches that Proxy and fires its `getPrototypeOf` trap. Aster's probe
mutated a sibling field before delivery. My claim that membership is checked
before *every* reflective operation was false: it covered `v`, not `v`'s
prototype.

**Fix.** Structural kind is recorded in a decoder-private `WeakMap` (`kindOf`) at
**construction time**, when the mint builds the node from pristine parser output.
`represent()` reads that tag — a trap-free `WeakMap.get` — instead of
`instanceof` or a live `Array.isArray`. No prototype and no realm-replaceable
constructor is consulted at dispatch. A certified plain object with no tag
classifies as `obj` without touching its prototype. A future binary decoder tags
`{k:'bytes',len}` at construction.

### 2. The export map is not a security boundary

A Node consumer can resolve the package main and import `certify` by `file://`
URL, bypassing the `exports` block; and `certify` called the mutable global
`JSON.parse`, so a post-load replacement returning a Proxy got branded. My
doc/gate claim that "public consumers cannot import or invoke the mint" and that
`exports:null` is the authority boundary was **false**.

**Fix.** The mint captures a **pristine `JSON.parse` at module load**, so a
post-load swap can no longer make `certify` brand a Proxy. The `exports` block is
now documented as **API hygiene, not security**. The security property does not
rely on unreachability: `certify` takes text and builds a fresh graph with the
pristine parser, and classification never touches a prototype, so a *reachable*
`certify` still cannot mint a graph whose observation fires a trap — under an
explicit **intact-realm-intrinsics-at-load** assumption, stated in
`snapshotMint.js`. (A consumer who tampered with intrinsics *before* the kernel
imported the module is outside the trust base; that is the standard limit for JS
security code without a hardened realm.)

## Clearance-gate table

| Aster S1g requirement | S1h |
| --- | --- |
| No trap-capable `instanceof` on certified mutable values | Classification reads a construction-time `WeakMap` tag; no `instanceof`, no live `Array.isArray`. |
| Certified payload & metadata children with side-effecting / throwing Proxy prototypes fire no traps | Gate 3B-a/c (side-effecting + throwing, payload) and 3B-d (metadata) — trap never fires, marker unchanged, handler verbatim. |
| Structural classification does not consult mutable prototype chains or realm-replaceable constructors | Tag-based; gate 3B-e proves a hostile `Uint8Array` prototype cannot fake a bytes classification. |
| Typed values use decoder-private construction tags | `kindOf` WeakMap; arrays tagged at mint, bytes reserved for a binary decoder. |
| Certification safe even when the decode entry point is reachable | Gate 0c/0d — mint reachable by file URL, but a file-URL `certify` still yields a safe graph. |
| Realm-intrinsics assumption explicit and enforced | Pristine `JSON.parse` captured at load; gate 0e proves a post-load swap has no effect; the assumption is documented. |
| Docs distinguish package encapsulation from runtime authority | `index.js` and the mint header now call `exports:null` hygiene, not a security boundary. |

## Gate

`test/smoke_registry_core.mjs`: 49 assertions, 0 failed. Full `npm test` runs the
cache-bust check, the manifest guard, and the suite — **150/150**.

## What this does not clear

Review of the core only. Not a request to wire S2, run a testnet canary, or
deploy. Those stay blocked until Aster reviews a corrected core and explicitly
clears it.
