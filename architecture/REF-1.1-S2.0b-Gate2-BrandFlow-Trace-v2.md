# REF-1.1 S2.0b Gate 2 — object-identity / brand-flow trace (boundary 1), v2

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S2.0B-GATE2-20260810-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Supersedes:** `REF-1.1-S2.0b-Gate2-BrandFlow-Trace.md` (add3a81), which Aster
  reviewed **Gate 2 NOT CLEARED AS WRITTEN** (disposition
  `ASTER-COUNCIL-REF11-S20B-GATE23-REVIEW-20260810-01`). The core args[0]
  identity conclusion was accepted; this v2 folds the four required corrections
  and the Gate-3 scope/telemetry.
- **Kernel traced:** 4.62.2 (`fb3ea39`). Analysis only — no code, no dispatch
  change, no deploy. S2.0c held, S2.1 blocked.

## What is accepted (unchanged from v1)

The by-reference identity of the **first handler argument** (`args[0]`, the
routed payload) is sound. Inbound: `JSON.parse` → `frame.payload`/`msg` (by ref)
→ `handleIncoming` → `_handleRequest` → `handler(fromId, msg.body)` (by ref) →
`route_msg` handler destructures `{ type, payload } = msg` (`AxonaPeer:631`) →
`_deliverRouted(type, payload):663` → `handler(payload):4094`. **No spread /
reconstruction / re-serialization** on the delivery path (off-path `{...}` spreads
at `AxonaPeer` 1264/1510/2460/3318 only). All 19 routed types share this one
`_deliverRouted` path. Forwarding (`AxonaPeer:691`) builds a **fresh** envelope
and re-serializes → the next hop re-decodes + **re-certifies**; the brand does
not cross the hop.

## Correction 1 — the certify root is per-decoder-variant, not uniform

The routed payload's depth differs by transport, because the framing differs:

| Variant | Decode site | Outer framing | Routed payload depth |
|---------|-------------|---------------|----------------------|
| node WS | `node/index.js:213` (plain) | `{type:'axona', payload}` → `handleIncoming(frame.payload)` | **3** (`frame`→`payload`→`body`→`payload`) |
| web-bridge WS | `web/index.js:335` (plain) | `{type:'axona', payload}` → `bridge.handleIncoming(frame.payload)` | **3** |
| WebRTC mesh | `web/mesh.js:802` (bigint reviver) | **none** — `msg` dispatched directly to `webrtc._onMessage:465` | **2** (`msg`→`body`→`payload`) |

Each decoder variant is its own certify root; S2.0c/S2.1 must record and test the
root and worst-case depth **separately per variant** (v1 wrongly stated a uniform
depth 3). `certifyBigint` is mandatory on mesh; `certifyPlain` on node/bridge.

## Correction 2 — depth is not the only brand-loss mode; MAX_NODES is the other

`snapshotMint.brandWalk` bounds at **both** `MAX_DEPTH=8` and `MAX_NODES=4096`,
and traverses in **sender-controlled** key/array order (`Object.keys(v)`, array
index). So a broad earlier sibling can exhaust the 4096-node budget before the
walk reaches a later projection container — leaving that container **unbranded**,
which `readLeaf` reports as `fault:'unbranded'` (observation no-op, safe, but
silent). The acceptance gate must therefore prove, **per registered type and
projection, under adversarial breadth and key/array order**, that every projected
path's intermediate containers are reached within *both* `MAX_DEPTH` and
`MAX_NODES` from the chosen per-variant certify root, given the S2.0c F7 wire-byte
ceiling. The F7 ceiling and the node/depth budgets are one coupled gate, not two.

## Correction 3 — leaves are not branded; intermediate containers are certified

Restated precisely against `shadowRegistry.readLeaf`/`represent`:

- A **primitive** projection is observable iff **every intermediate container on
  its path is certified** (`readLeaf:81` checks `isCertified(cur)` before each
  `getOwnPropertyDescriptor`); the primitive value itself is never in the WeakSet
  and is handled by `represent` (`{value}` for finite string/number/bool,
  `{struct:{k:'bigint'}}` for bigint).
- An **object-valued** final projection must itself be certified — `represent`
  returns `{fault:'unbranded'}` for an uncertified object (`:107`).

v1's "scalar leaves at depth 4–5 are branded" and "a leaf past depth 8 is
unbranded" are withdrawn. The correct acceptance statement is in terms of
certified intermediate containers plus `represent`'s final-value rules.

## Correction 4 — the handler `meta` argument (args[1]) is NOT covered (owned miss)

`_deliverRouted(type, payload, { fromId, targetId, hopCount, isTerminal })`
(`AxonaPeer:663`) constructs `meta` **locally at the call site** from trusted
local values. It is never part of a decoded, certified graph, so the shadow
layer's `metaObj = isCertified(args[1]) ? args[1] : null` (`shadowRegistry:199`)
resolves it to **null** — meta projections are silently unobserved. v1 traced
only args[0] and missed this.

Resolution (design rule for S2's boundary-1 rows, before S2.1):

- **Recommended: boundary-1 rows declare EMPTY meta projections.** Then meta is
  never observed and the gap is moot. The gate asserts, per registered row,
  `projection.meta === []`.
- **If a meta signal is later required** (e.g. `fromId` for correlation): brand
  the meta object **at its construction site** in `_deliverRouted` — the kernel
  builds that exact object from trusted local values, so certifying the object it
  already returns to the handler adds no clone and no interference (unlike the
  rejected payload Option (ii)). This must be a confined construction-site brand,
  NOT a general object-branding export, and is a separate S2.1 design item with
  its own review. It is out of scope for closing Gate 2.

Transport-root certification does not, and is not claimed to, cover handler meta.

## Gate 3 — Option (i) inbound-only, with recorded scope + telemetry

Adopt **Option (i)**: the observed population is **inbound-decoded frames only**.
Local-origin routed payloads (`routeMessage → _deliverRouted:3982`) are delivered
**verbatim** and are explicitly **outside** the observed population — no
observation, handler runs unchanged (S1 `unbranded-source` path).

**Option (ii) is rejected** (as Aster ruled): serialize+parse before
`_deliverRouted` would hand the handler a **normalized clone**, and can throw or
change values/types — violating the S1 noninterference / original-arguments
invariant. Local observation is not worth breaking that invariant, and
self-produced frames carry no integrity signal.

**Telemetry semantics (required):** a local-origin dispatch is an **expected**
`unbranded-source` event, not a certification failure. The trace sink must (a)
label the observed population as inbound-only, (b) never classify expected
local-origin unbranded dispatches as faults, and (c) bound their emission (e.g.
sampled / rate-limited), so a high local-send rate cannot flood the sink or read
as a mesh-wide certification-failure spike.

## Gate-2 acceptance set (what S2.0c/S2.1 tests must prove)

1. Per-decoder-variant certify root + worst-case routed-payload depth recorded
   (node/bridge=3, mesh=2), tested independently.
2. For every registered boundary-1 type × projection: all intermediate containers
   reachable within **both** `MAX_DEPTH` and `MAX_NODES` from that variant's root,
   under adversarial breadth and key/array order, given the F7 wire-byte ceiling.
3. `represent`-level assertions for primitive vs object-valued final projections
   (Correction 3), not "branded leaf" claims.
4. `projection.meta === []` for all boundary-1 rows (or the confined
   construction-site meta brand lands as its own reviewed S2.1 item).
5. Gate-3 scope + telemetry semantics as above; local-origin verbatim + outside
   observed population.
6. Still mandatory before S2.0c/S2.1 code clear: F7 (pre-parse UTF-8-byte ceiling
   + type normalization per certifying variant) and F8 (brand grants no auth /
   authorization / validation / dispatch authority).

## Status

S2.0c held, S2.1 blocked, no dispatch change, no canary, no deploy. Returning for
Aster review.
