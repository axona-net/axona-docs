# REF-1.1 S2.0b v2 — Parse-site / certification ownership table (boundary 1), re-cut

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S2.0B-PARSETABLE-20260810-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Supersedes:** `REF-1.1-S2.0b-ParseSite-CertificationTable.md` (90934e6), which
  Aster reviewed NOT CLEARED (disposition `ASTER-COUNCIL-REF11-S20B-DISPOSITION-20260810-01`).
  v1's single-seam / one-codec / authed-channel model was materially wrong.
- **Status:** for Aster review. Analysis + doc only — no dispatch change, no code,
  no deploy. S2.0c held, S2.1 blocked.

## What v1 got wrong (owned)

Each corrected against a reconfirmed code fact.

1. **One codec / authed channel → two decoder variants, pre-auth provenance.**
   `transport/node/index.js:213` and `transport/web/index.js:335` are **plain**
   `JSON.parse(ev.data)`; only `transport/web/mesh.js:802` uses
   `JSON.parse(ev.data, bigintReviver)`. Two distinct decoder variants, not one.
   All three decode **untrusted bytes on an open channel with auth pending or
   carried separately** — not "from an authenticated channel."
2. **Certify-once → per-hop, per-variant.** `routeMessage → _deliverRouted`
   hands the payload on without re-serializing, and a routed message is
   re-decoded at **each network hop**. Certification is per-inbound-decoder,
   per-hop — never once for a route's lifetime. And `snapshotMint.certify(text)`
   is a plain parser: it would **drop bigint semantics** the mesh decoder
   preserves, so it cannot be the mesh variant.
3. **"All 19 handlers observed" → false (local-origin).** `routeMessage` locally
   delivers a **programmatically-created, unbranded** payload straight into
   `_deliverRouted(type, payload, meta)` with no transport decode and no
   `certify()`. Locally-originated routed frames are unbranded → observation is a
   no-op for them until that path is explicitly addressed.

## The corrected model

- **Certified-decoder contract.** The shared core exposes **fixed string-only
  certified decoder variants** — `certifyPlain(text)` and `certifyBigint(text)`
  (the latter using the existing fixed internal `bigintReviver`) — with **no
  caller-supplied callback and no general object-branding export**. Each fixed
  inbound decoder variant, on each hop, is a certifying decoder for its own codec
  class.
- **Certification is reflection-safety only (F8, strengthened).** These decoders
  also admit auth / control / signalling traffic. The brand must NEVER be treated
  as authentication, authorization, validation, or dispatch authority. Handlers
  keep running their own `verifyEnvelope` / region / authorship checks.
- **F7 (corrected).** Before each parse: normalize the runtime input type, then
  enforce a **UTF-8 byte ceiling** (not JS string length) on the serialized
  input, rejecting over-cap before `JSON.parse`.

## The table (boundary-1 outer frame + neighbours)

| # | Site | Decoder variant | Provenance | Frame/use | Class | Max bytes (today) | Brand at handler? | Certified-decoder entry |
|---|------|-----------------|-----------|-----------|-------|-------------------|-------------------|-------------------------|
| 1a | `transport/node/index.js:213` | **plain** `JSON.parse` | pre-auth untrusted bytes (node WS) | inbound wire frame → routing | A-plain | **unbounded → S2.0c (F7)** | if this variant certifies | `certifyPlain` at this decoder |
| 1b | `transport/web/index.js:335` | **plain** `JSON.parse` | pre-auth untrusted bytes (web bridge WS) | inbound wire frame → routing | A-plain | unbounded → S2.0c | if this variant certifies | `certifyPlain` at this decoder |
| 1c | `transport/web/mesh.js:802` | **bigint-aware** `JSON.parse+bigintReviver` | pre-auth untrusted bytes (WebRTC mesh) | inbound wire frame → routing | A-bigint | unbounded → S2.0c | if this variant certifies | `certifyBigint` at this decoder |
| 1L | `AxonaPeer.routeMessage → _deliverRouted:4089` | **none** (object handed directly) | LOCAL, programmatic | locally-originated routed frame | A-local | n/a (no text) | **NO — unbranded; observation no-op** | none (open: how/whether to brand local origin) |
| 2 | `wireHandlers._ingestPublish:305` (`payload.json`) | plain | class-A `payload` field | PUB nested envelope | B | unbounded → S2.0c | separate | dedicated class-B decoder |
| 3 | `wireHandlers._ingestStamped:593` (`m.json`) | plain | field / stored | REPLAYUP/HANDOFF entry | B | unbounded → S2.0c | separate | dedicated class-B decoder |
| 4 | `wireHandlers._onKill:888` (`cached.json`) | plain | LOCAL cache | KILL authorship | B-local | own cache | n/a | local read |
| 5 | `wireHandlers._onPullResp:984` (`payload.json`) | plain | class-A field | PULLRESP envelope | B | unbounded → S2.0c | separate | dedicated class-B decoder |
| 6 | `AxonaManager.js:937` | plain | class-A field | msgId correlation | B | unbounded → S2.0c | separate | dedicated class-B decoder |
| 7 | `AxonaManager.js:1109` | plain | LOCAL cache | descriptor recovery | B-local | own cache | n/a | local read |
| 8 | `writeFlight.js:59` | plain | class-A field | flight msgId | B | unbounded → S2.0c | separate | dedicated class-B decoder |
| 9 | `AxonaPeer._dispatchDelivery:3143` | plain | delivered body | class-C local delivery | C | unbounded → S2.0c | separate boundary | class-C decoder |
| — | `AxonaPeer.js:2400/2454` | plain | pull/sub result | CAP_ATTEST / metrics | D | unbounded → S2.0c | boundary 2 / app | out of boundary-1 scope |

## Object-identity / brand flow (partial; completion is a gate)

`_deliverRouted:4094` calls `handler(payload, meta)` with the payload object
**unchanged** — no reconstruction or spread at that seam, so a brand set on the
inbound-decoded object survives to the handler *there*. NOT yet proven, and a
blocking gate before S2.0c: the full path **transport-decode → DHT routing/forward
→ `_deliverRouted`** must be traced for any reconstruction/spread that would drop
the brand, for every one of the 19 types, on node / web-bridge / mesh, and across
a multi-hop forward where the frame is re-decoded at each hop.

## Blocking gates before S2.0c (from Aster's disposition)

1. Table splits Class-A into plain + bigint-aware variants with pre-auth
   provenance. **(done, rows 1a/1b/1c)**
2. Prove exact object-identity / brand flow from the certified outer root to the
   nested payload delivered to **every** claimed routed handler — including
   reconstruction/spread-loss checks and per-hop re-certification. **(open)**
3. Resolve the local-origin path (row 1L): the current seam cannot claim all 19
   handlers are observed; decide whether/how locally-originated payloads are
   branded, or scope the observation claim to inbound-decoded frames only. **(open)**
4. Tests: node bridge, web bridge, mesh, multi-hop re-certification, nested
   identity preservation, local-origin behavior, pre-parse UTF-8-byte rejection,
   and F8 non-authority. **(specified; land with S2.0c/S2.1)**

## Direction

Option (a) is retained **only** as "certify at every fixed inbound decoder
variant, per hop" — not certify-once. Option (b) (carry source text and reparse)
stays rejected. S2.0c places F7 (type-normalize + UTF-8-byte ceiling) at each
certifying decoder variant. S2.1 (wrapping the 19 handlers) begins only after
gates 2 and 3 close and this v2 is reviewed. No dispatch change, no deploy; M1
canary remains separately David-gated.
