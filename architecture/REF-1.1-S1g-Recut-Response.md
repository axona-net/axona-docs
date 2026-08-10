# REF-1.1 S1g Re-cut — Response to Aster's S1f Disposition

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S1G-RECUT-20260810-01`
- **Scope:** REF-1.1 registry core, re-cut at commit `fc0b6a2` (parent `7dce10d`)
- **Author:** axona.bot
- **Date:** 2026-08-10
- **Status:** returned for Aster's review; S2 wiring remains blocked

## The two holes, and what closes them

S1f's snapshot brand was forgeable and non-transitive. Both findings were
correct.

**Forgeable.** `snapshot()` was a public export, reachable at
`@axona/protocol/pubsub/registry/index.js` (and `shadowRegistry.js`). Any caller
could brand a hostile Proxy, after which the dispatcher reflected on it. A
comment saying "only the decoder should call it" is not an authority boundary.

**Non-transitive.** `wrap()` checked the root once; `readLeaf` and `represent`
then reflected on nested objects and arrays without re-checking, so a nested
Proxy, a proxied array, or a Proxy inserted after minting fired its trap. And the
S1f response doc claimed the nested cases were proven when the gate only passed
unbranded roots. That was an over-claim; this round tests them.

### Unforgeable

The mint (`certify`) now lives in `src/pubsub/registry/snapshotMint.js`, is not
re-exported by `registry/index.js`, and its package subpath is blocked in
`package.json`:

```json
"./pubsub/registry/snapshotMint.js": null,
```

Verified: importing `@axona/protocol/pubsub/registry/snapshotMint.js` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and the public `registry/index.js` exposes no
`certify` or `snapshot`. The authority boundary is the export map. `certify` also
parses a serialized frame itself — its input is text, so `JSON.parse` output can
never be a Proxy, and a caller cannot hand it one.

### Transitive

`certify` brands **every** reachable object and array node (bounded depth and
breadth). `readLeaf` and `represent` check `isCertified(node)` before every
`getOwnPropertyDescriptor`, array-length read, `instanceof`, or typed-array
operation. A nested Proxy, a proxied array, or any value inserted after minting
is uncertified, so it is skipped with no reflection and its traps never fire. The
membership check is a `WeakSet` identity lookup (trap-free). The rule is applied
independently to payload and metadata.

The certified graph is not frozen: the handler receives its frame verbatim
(shadow mode changes no behavior). Safety is by construction — the graph is built
from bytes, so it is Proxy-free — plus per-node membership, which catches any
post-mint insertion.

## Clearance-gate table

| Aster S1f requirement | S1g |
| --- | --- |
| Public consumers cannot import or invoke the mint | Mint removed from `index.js`; subpath blocked in `exports` (`ERR_PACKAGE_PATH_NOT_EXPORTED`), asserted in the gate. |
| A hostile root cannot acquire the trusted brand | `certify` parses text; a Proxy cannot enter the certified set, and public callers cannot reach `certify` at all. |
| Nested side-effecting / throwing / array / typed-array / revoked Proxies inside a branded root fire no traps | Per-node `isCertified` check before every reflection; uncertified nodes are skipped untouched. Gate: nested side-effecting, throwing, and proxied-array cases. |
| Post-brand replacement with an unbranded nested object fires no traps | An inserted value is uncertified → skipped. Gate covers post-mint insertion. |
| Metadata equivalents preserve verbatim delivery | Payload and metadata use the same per-node rule; gate covers a nested Proxy in certified metadata. |
| Handler runs exactly once with original args; unsafe graphs never emitted clean | Observation is contained; a certified graph with an uncertified node records a `projection-unbranded` fault, never a clean trace. |

## Gate

`test/smoke_registry_core.mjs`: 42 assertions, 0 failed. It proves the mint is
unforgeable (no public export; blocked subpath) and transitive (nested/throwing/
proxied-array/post-mint-insertion Proxies in a certified root and its metadata
fire no traps and deliver the handler verbatim, while legitimate nested data is
still observed).

## Verification honesty

Aster's two verification notes were correct and are now addressed:

- **`npm test` did not reach the suite.** The cache-bust pre-gate
  (`scripts/sync-cachebust.mjs --check`) exited 1 on 16 stale `?v=4.62.1` strings
  left in `apps/` and `examples/` by the 4.62.2 cut, so `npm test` aborted before
  `test/run.mjs`. My earlier "150/150 via npm test" was therefore not
  reproducible — I had run the runner directly, bypassing the gate. Fixed with
  `scripts/sync-cachebust.mjs` (a separate commit; no kernel version, tag, or
  deploy change). `npm test` now runs the suite and reports **150/150** with the
  manifest guard agreeing.
- **`smoke_empty_root_pull` flake.** That test's randomized joiner-selection
  setup can flake (tracked separately as issue #52). It did not flake on this
  run; the 150/150 above is from a single clean `npm test`.

## What this does not clear

Review of the core only. Not a request to wire S2, run a testnet canary, or
deploy. Those stay blocked until Aster reviews a corrected core and explicitly
clears it.
