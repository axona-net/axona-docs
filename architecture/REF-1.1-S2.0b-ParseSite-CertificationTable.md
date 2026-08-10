# REF-1.1 S2.0b — Parse-site / certification ownership table (boundary 1)

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S2.0B-PARSETABLE-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Scope:** boundary 1 (pub/sub + DHT control frames). Amends `Refactor-Phase0-OwnershipMap-v0.1.md`
  (REF-0.3) with the certification seam the mint introduced. Spec:
  `REF-1.1-Phase1-Postmortem-v0.2.md` (F5, Aster seq 673 #2).
- **Status:** for council review. Analysis + doc only — no dispatch change, no
  code, no deploy. S2.1 wiring does not begin until this is reviewed.

## The question this answers

Where does a certified snapshot for boundary-1 shadow observation come from, and
which of the module's `JSON.parse` sites is it? F5 requires **one named
certified-decoder per parse-site / codec class**, not one global decode-once. The
answer is not inside the pub/sub module.

## How a boundary-1 frame reaches a handler

`wireHandlers._registerHandlers` registers 19 routed handlers via
`this.dht.onRoutedMessage(type, (payload, meta) => fn.call(this, payload, meta))`
(SUB, UNSUB, PUB, DELIVER, ADOPT, PULLUP, HANDOFFACK, REPLAYUP, HANDOFF,
REPLICATE, KILL, INGESTACK, RECEIPTPROBE, RECEIPTNACK, TOUCH, PULL, PULLRESP,
ROOTBEACON, METRICSON). By the time a handler runs, `payload` is **already a
decoded object**: the transport parsed the wire bytes upstream
(`transport/wire.js` `bigintReviver`, invoked at `transport/node/index.js:213`,
`transport/web/index.js:335`, `transport/web/mesh.js:802`) and the DHT routed the
object here. **No boundary-1 handler decodes its own outer frame.**

Inside the handlers, the *nested* signed envelope is parsed separately: the
envelope is carried as a **string field** (`payload.json` / `m.json` /
`cached.json`) and re-parsed with plain `JSON.parse` (no reviver) to read
`{ msgId, signerPubkey, topic }` for signature verification. That is a different
codec class from the outer frame.

## Codec classes (boundary 1 and its neighbours)

- **Class A — outer wire frame.** Bytes → object, `bigintReviver`, at the
  transport decode seam. Provenance: an authenticated transport channel. This is
  the object boundary-1 shadow observation reads. Its certified-decoder entry is
  the **transport wire-decode**, shared with boundary 2 — NOT a pub/sub parse
  site.
- **Class B — nested signed envelope JSON.** A string field inside a class-A
  frame (`payload.json` etc.), plain `JSON.parse`, feeds `verifyEnvelope`.
  Semantically distinct; certified separately, and only if a registry row
  projects an envelope-internal field.
- **Class C — delivered-message envelope (local delivery side).** `_dispatchDelivery`
  (`AxonaPeer.js:3143`) parses the delivered `json` for local subscribers and
  kill-marker detection. App-facing, not a routed-ingress control frame.
- **Class D — pulled/subscribed message body (app layer).** `AxonaPeer.js:2400`
  (CAP_ATTEST author-class attestation from a `pull` result) and `2454` (metrics
  subscription callback body). These belong to the transport/auth (2400) and
  application (2454) surfaces, not boundary 1.

## The table

| # | Site | Frame / use | Class | Provenance | Codec | Max bytes (today) | Output lifetime | Consumers | Shadow needs it? | Certified-decoder entry |
|---|------|-------------|-------|-----------|-------|-------------------|-----------------|-----------|------------------|-------------------------|
| 1 | transport wire-decode (`wire.js` via `node/index.js:213`, `web/index.js:335`, `web/mesh.js:802`) | class-A outer frame for every routed type | A | authed channel | `JSON.parse`+`bigintReviver` | **unbounded → S2.0c** | per-dispatch | DHT routing → 19 handlers | **YES — this is boundary-1's outer-frame snapshot** | **this seam (shared with boundary 2)** |
| 2 | `wireHandlers._ingestPublish:305` (`payload.json`) | PUB — verify+stamp+cache publish envelope | B | class-A `payload` field | `JSON.parse` | unbounded → S2.0c | handler-local | `verifyEnvelope`, cache | only if a row projects an envelope field | dedicated class-B decoder (separate) |
| 3 | `wireHandlers._ingestStamped:593` (`m.json`) | REPLAYUP/HANDOFF stamped replay entry | B | class-A field / stored | `JSON.parse` | unbounded → S2.0c | handler-local | `verifyEnvelope`, cache | as row requires | dedicated class-B decoder (separate) |
| 4 | `wireHandlers._onKill:888` (`cached.json`) | KILL — read authorship of a **locally cached** envelope | B (local) | local `role.cache` | `JSON.parse` | bounded by our own cache | handler-local | signer check | no (local state, not the incoming frame) | n/a — local read, distinct provenance |
| 5 | `wireHandlers._onPullResp:984` (`payload.json`) | PULLRESP returned envelope | B | class-A field | `JSON.parse` | unbounded → S2.0c | handler-local | `verifyEnvelope` | as row requires | dedicated class-B decoder (separate) |
| 6 | `AxonaManager.js:937` (`json`) | msgId extraction for correlation | B | class-A field | `JSON.parse` | unbounded → S2.0c | transient | correlation | no | dedicated class-B decoder |
| 7 | `AxonaManager.js:1109` (`role.cache[i].json`) | descriptor recovery from local cache | B (local) | local cache | `JSON.parse` | own cache | transient | descriptor | no | n/a — local read |
| 8 | `writeFlight.js:59` (`payload.json`) | msgId extraction for a flight | B | class-A field | `JSON.parse` | unbounded → S2.0c | transient | flight correlation | no | dedicated class-B decoder |
| 9 | `AxonaPeer.js:3143` (`_dispatchDelivery`) | class-C delivered envelope for local subs | C | delivered body | `JSON.parse` | unbounded → S2.0c | delivery-scoped | app subscribers | separate boundary (delivery) | class-C decoder (not boundary 1) |
| — | `AxonaPeer.js:2400/2454` | CAP_ATTEST / metrics body | D | pull/sub result | `JSON.parse` | unbounded → S2.0c | app-scoped | attestation / app | boundary 2 / app | out of boundary-1 scope |

## Findings

1. **Boundary-1's authoritative outer-frame decoder seam is the transport
   wire-decode (row 1), not a pub/sub parse site.** Every `JSON.parse` inside the
   pub/sub module is class B/C — a nested or delivered envelope, never the outer
   frame. This confirms F5: the classes stay separate; there is no global
   decode-once.
2. **The certified snapshot boundary-1 observes is produced one layer below it
   (boundary 2's transport decode).** Two ways to wire this, for council to
   choose — I am NOT deciding it unilaterally:
   - **(a) Certify at the transport decode.** The shared core's `certify(text)`
     is invoked once where bytes become the frame; the certified frame flows
     through routing; boundary-1 shadow observes it. Cleanest for observation,
     but places the certify call in the transport layer (shared across
     boundaries 1 and 2) — a cross-boundary seam.
   - **(b) Carry source text to the dispatch seam.** The routed frame retains its
     original serialized text; boundary-1's shadow-wrap certifies at
     `onRoutedMessage`. Keeps certify inside boundary 1 but threads text through
     routing and re-parses.
   Until one is chosen, S2.1 can still wrap the 19 handlers safely: an
   uncertified `payload` makes observation a **no-op** (emit `unbranded-source`,
   run the handler verbatim), by the S1 design. Observation only becomes live
   once the chosen decoder certifies.
3. **F8 holds structurally here.** Whoever certifies the class-A frame grants
   reflection-safety only; the pub/sub handlers still run their own
   `verifyEnvelope` / region / authorship checks. Certification is not admission.
4. **F7 lands at rows 1–3, 5, 6, 8, 9.** Each unbounded `JSON.parse` on
   channel-sourced text needs a serialized-byte ceiling before parse (S2.0c).
   Rows 4 and 7 read local cache (already bounded) and are lower priority.

## Recommendation

Adopt seam **(a)** for boundary 1 — certify the class-A frame once at the
transport wire-decode — pending council agreement, because (b) re-parses the same
bytes twice and threads text through routing for no observation benefit. If (a)
is accepted, S2.0c places the F7 byte ceiling at that one seam for the outer
frame, and per-site ceilings at the class-B decoders that a row actually projects.
This keeps one certified-decoder per codec class (F5) and one shared
reflection-safety core (F1).

## Out of scope / gating

No dispatch change, no wire change, no deploy. S2.1 (wrapping the 19 handlers)
begins only after this table and the seam choice are reviewed. The M1 canary and
any production step remain separately David-gated.
