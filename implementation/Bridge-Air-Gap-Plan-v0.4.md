# Bridge Air-Gap — Project Plan — v0.4 (correction revision to v0.3)

**Status:** proposed; correction revision under Aster CP 1723ff56 (B2, B3, B5
open; B1, B4, B6 retired). This document is a DELTA: it replaces the named
sections of v0.3 and leaves every other section of v0.3 in force.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Base:** Bridge-Air-Gap-Plan-v0.3.md (sha256 e7b23101…); v0.2 (3e8f8a9a…) and
v0.1 (866b123f…) frozen and unmodified
**Companions:** council 1723ff56, 3d9683ca, 7352b89e; ops/STATE.md 2026-09-22

---

## 0. Residual map

| Residual | What it required | Replaced section |
|---|---|---|
| B2 closed directory protocol | an admitted PUB path; own-entry vs republication reconciled; how directoryOrigin travels without changing a client connection's capability; §0 wording | §7.2.1 (rows), §7.2.6 (egress), new §7.2.7 (the directory protocol, closed), §7.1.4 row 1 |
| B3 ownership, replay, refresh | a trust rule that is not TOFU; past-age validity; pins independent of expiry; refresh that re-signs; equal-ts/different-content; cross-origin dedup as a test | §7.3.2 |
| B5 partition and egress completeness | outcomes for matched responses, invalid frames, pre-decode oversize, rate-exceeded notifications; predicate precedence; bare-frame drops; disjoint egress classes including refusal replies; physical vs logical observation; cap claim qualified; L2 scope | §7.2.2, §7.2.3, §7.2.4, §7.2.6, WP4 O1–O3, L2–L3 |

Correction to v0.3 §0, row B2b: "only bare frames are dispatched" is wrong as
written. The rule is: a `route_msg` addressed to the bridge is dispatched only
when its inner verb is one of the four directory verbs for a named topic; no
other wrapped frame is dispatched.

## 7.1.4 (row 1 replaced) The role matrix, directory row

| Topic class | local root | serve subscribers | accept backup | accept heir | accept child | forward | publish own entry (one hop, §7.2.7) | republish a sync entry (one hop, §7.2.7) |
|---|---|---|---|---|---|---|---|---|
| named directory topic | yes, self-claim | yes | NO | NO | NO | NO | yes | yes, only entries received on an authenticated uplink under §7.3.2 |

"Origin" in v0.3 meant own entry only. It now means the two enumerated
one-hop publications in the last two columns, each its own egress class, and
nothing else.

## 7.2.1 (replaced) The allow-list, by wire kind

| Frame | Wire kind | Terminates where | Reply | Bound |
|---|---|---|---|---|
| `hello` | ntf, bridge → client | client | none | once per connection |
| `hello-ack` | ntf, client → bridge | bridge | none | once per connection |
| `ping` (bare) | bare request-like | bridge | bare `pong` | 1 Hz per connection |
| `peer-list-request` (bare) | bare request-like | bridge | bare `peer-list` | rate-limited per connection |
| `turn-refresh` (bare) | bare request-like | bridge | bare reply | per connection |
| `signal` (bare) | bare, no reply | one named admitted connection | none to the sender; forwarded as bare `signal` | size cap; destination must be admitted; rate-limited |
| `pong` (bare, unsolicited) | bare, no reply | dropped, counted | none | — |
| `lookup_step`, `find_closest_set`, `local_probe` | req | bridge's own table | res | one table scan; no egress |
| `lookahead_probe` | req | bridge's own table | res | D1 |
| `hop_cache`, `triadic_introduce`, `reinforce`, `lateral_spread` | ntf | bridge's own table | none | counted; no egress |
| `presence`, `peer-leaving` | ntf | bridge | none | counted |
| `route_msg` addressed to the bridge's own id or to a named directory topic id it is terminal for, inner verb SUB, UNSUB, PULL or PULLUP for a named topic | req | bridge as local root | res: verdict | schema-validated; the inner verb dispatched by name; nothing else nested |
| `route_msg` addressed to the bridge's own id or to a named directory topic id it is terminal for, inner verb PUB for a named topic, signer a known bridge author (§7.3.2) | req | bridge as local root | res: verdict | schema; signer check; one accepted per author per POLL_MS |
| `directory:sync` | req, uplink only, both directions | bridge | res ok / refused | §7.3.2; only if D2 selects it |
| any other `route_msg`, any `__tunneled_direct__`, any `mesh:signal`, any `direct_*` or `axona:direct` notification | req or ntf | refused / dropped | res `transit-refused` for req; none for ntf | counted by outcome |
| `res` | res | matched to a pending id or dropped | never replied | counted |

Bare frames follow the notification reply rule (no reply on drop) except the
three request-like bare frames, which have their own bare replies. A bare
`signal` that is over-size, rate-exceeded, or names an unknown or unadmitted
destination is dropped and counted; the sender is not told, which is the
existing behaviour.

## 7.2.2 (replaced) One outcome per received frame

Classification runs in this order and stops at the first match; every
received frame lands in exactly one bucket.

0. `closedOversize`: the socket layer rejects a frame over the `maxPayload`
   cap before decode (counted from the `ws` close event, per connection).
1. `droppedInvalid`: decode fails, or the decoded value is not an object with
   a recognised envelope (`{type:'axona', payload:{k,type}}` or one of the five
   bare types).
2. By wire kind:
   - `res`: `responseMatched` if a pending id exists (then the normal response
     path), else `droppedUnsolicited`.
   - `ntf` and bare non-request frames: `droppedUnlisted` (type not in the
     table), `droppedDirect` (`direct_*`, `axona:direct`), `droppedRate`
     (listed but over its bound), `droppedSchema` (listed, in bound, fails
     schema), else `dispatchedLocal`.
   - `req` and the three bare request-like frames: `refusedUnlisted`,
     `refusedRate`, then for `route_msg` and `__tunneled_direct__`:
     `refusedTransit` (not addressed to the bridge or a named topic it is
     terminal for), `refusedNested` (addressed correctly but inner verb or
     topic outside the table), `refusedSchema` (inner verb in the table but
     failing its schema or signer check); for other listed requests
     `refusedSchema`; else `dispatchedLocal`.

`signalRelayed` is the `dispatchedLocal` outcome of a bare `signal` that was
forwarded; it is recorded as its own bucket so the relay count is visible.

`transitAttempted` is the sum of `refusedTransit`, `refusedNested` and
`droppedDirect`. `forwardedGeneric` is an EGRESS count (§7.2.6), not an
ingress outcome, and the invariant holds it at zero.

## 7.2.3 (replaced) Refusal and drop, per wire kind

Requests: one `res` `{ ok:false, body:{ error:'transit-refused', outcome } }`;
for `route_msg`, the verdict `{ consumed:false, terminal:true, refused:true,
hops }`. Notifications and bare non-request frames: no reply, counted.
Responses: never replied. The fixed type taxonomy for the drop buckets is the
listed types, `direct_*` as one bucket, and `other`.

Refusal propagation on the client is `docs/TRANSIT-REFUSAL-CALLERS.md`. From
the source as it stands (4.88.0): every `_route` caller is fire-and-forget and
retries only on its own cadence; the one caller that awaits verdicts,
`_replicateRole`, records the verdict per target and retries on the next repair
tick. WP4 O4 confirms each row.

## 7.2.4 (amended) Bounds

Unchanged: fixed-size bridge-wide outcome counters; `N` tracked per-connection
slots plus one overflow aggregate; fixed taxonomy; one aggregated log row per
minute; closed schemas for dispatched rows.

Qualified: the `maxPayload` cap (D5) bounds the decode input PER FRAME. It does
not by itself bound aggregate CPU or queue depth; those are bounded by the
existing per-connection rate limits on the request-like frames, by the `ws`
backpressure that stops reading a socket whose send buffer is full, and by the
refusal path doing no work proportional to payload after decode. No new
admission authority is inferred from the cap. Aggregate behaviour is what L2
and L3 measure.

## 7.2.6 (replaced) The bridge's own egress, classified at the physical write

One classifier at the single physical write, the `ws.send` in `sendToConn`.
The transport's `send` and `notify` helpers and the kernel's `_route` calls are
observed only to attach a causal record (which received frame, subscription,
book change or sync produced this write); they are never counted, so a frame
is counted once. Classes, disjoint by construction, decided from the causal
record and the frame:

| Class | What it is | Causal record required |
|---|---|---|
| `controlReply` | bare `pong`, `peer-list`, `turn-refresh` reply, `hello`, and `res` to a dispatched link or directory request | the received frame |
| `discoveryReply` | `res` to `lookup_step`, `find_closest_set`, `local_probe`, `lookahead_probe` | the received frame |
| `refusalReply` | `res` carrying `transit-refused` or a `refused:true` verdict | the received frame and its outcome |
| `signalRelay` | bare `signal` to a named admitted connection | the received `signal` |
| `directoryServe` | DELIVER, replay, PULLRESP to a subscriber of a named topic, over that subscriber's socket | the subscription record |
| `directoryOwnEntry` | the bridge's own entry PUB, one hop to a directly connected root (§7.2.7) | a book change or the POLL_MS cadence |
| `directoryRepublish` | a sync-received entry PUB, one hop to a directly connected root (§7.2.7) | the accepted `directory:sync` |
| `directorySync` | `directory:sync` request on an uplink, and its `res` | the cadence or the received sync |
| `genericTransit` | any write with no causal record in the classes above, or a `route_msg` that carries a received frame toward another node | none; the invariant holds this at zero |

WP4 O2 sends one positive-control frame through each class during setup and
fails the run if any class records nothing. O3 asserts every write has exactly
one class and `genericTransit === 0`.

The bridge's `dht.sendDirect` (bridge_engine.js ~184) loses its routed
fallback: a DELIVER whose subscriber socket is closed fails
`NO_TRANSPORT_ROUTE`; the subscription lapses on renewal.

## 7.2.7 (new) The directory protocol, closed

Two publications leave a bridge, and both are ONE HOP to a directly connected
node. Neither uses lookahead, neither is forwarded by anyone, and neither
changes the capability of any client connection.

Own entry. On a book change or the POLL_MS cadence, the bridge resolves the
root of each named directory copy it publishes to. If that root is the bridge
itself (the copy it roots), the entry is ingested locally. Otherwise the bridge
sends `route_msg` with `via: [rootId]` and inner verb PUB ONLY IF `rootId` is a
directly connected client; the receiving client is the root, `targetId` is its
own id, the frame is terminal there, and it dispatches PUB locally. If the root
is not a directly connected client, the publish is NOT attempted; it is counted
`directoryRootUnreachable` and retried at the next cadence. The root is learned
by discovery over client connections (`lookup_step`, `find_closest_set`), which
§7.1.3 permits.

Why this is not transit and not a capability change: the bridge's socket to
that client is used to deliver a frame TO that client, addressed to that
client, terminal at that client. No client forwards on the bridge's behalf. The
`_routeFor(id, 'directory-own-entry')` and `_routeFor(id, 'directory-republish')`
operation classes are permitted on a bridge only when `id` is the connected
peer of the socket chosen, which is the same one-hop rule stated in code.

Republication. An entry accepted from `directory:sync` under §7.3.2 is
published by the receiver into ITS OWN named copies by the same one-hop rule,
as `directoryRepublish`, carrying the original author's signature unchanged.
It is marked `viaSync` in the receiver's book and is never sent on any uplink.

Ingress at a root that is a relay, not a bridge: a PUB for a named directory
topic is accepted only from a signer that is a known bridge author (§7.3.2);
the relay's existing PUB path applies otherwise. A PUB for a named directory
topic that arrives at a BRIDGE as root is accepted only under the §7.2.1 row
with the signer check.

The 0xFF legacy copy: rooted on a bridge, no publications are made into it
(`DIRECTORY_NEVER_REGIONS`), so it serves subscribers only, and it ages out
with its subscribers.

## 7.3.2 (replaced) The sync service, if D2 selects it

Wire: `directory:sync` is a request on the uplink, both directions, with a
`res` of `{ ok:true }` or `{ ok:false, body:{ error } }`.

Trust rule, not TOFU. An uplink is a bridge-to-bridge connection whose hello
carries the dialling bridge's node identity (Ed25519, `buildAuthHello` over the
uplink identity in uplink.js), so both ends know the other's node public key.
The receiver accepts a sync ONLY over such a connection, and binds the entry's
`url` to that connection by proof of possession: the receiver probes the
claimed `url` (the existing `probe` in uplink_policy.js, extended to read the
answering bridge's node public key from its hello) and accepts the binding only
if the key answering at the URL equals the uplink connection's key. A URL is
owned by the identity that answers at it. The bridge AUTHOR key that signs the
entry is bound to that node key at the same moment, from the same hello, which
already carries `setAuthorClass('bridge')` evidence in the book.

Limits, stated: an attacker who controls DNS or TLS for a URL can answer at it
and therefore own it; operator-configured `BRIDGE_UPSTREAMS` seeds are
pinned by the operator and override probing for those URLs; a compromised
peer bridge can misrepresent only URLs it can answer at. Known bridge authors
are exactly the set bound this way plus the operator seeds; there is no other
admission.

Pins persist independently of entry expiry. A `url → (nodeKey, authorKey)`
pin is dropped only by an operator action (`bridge-book unpin <url>`), never by
time. An entry for a pinned URL from a different key is refused and counted.

Timestamps. `ts` is valid when `now - MAX_AGE ≤ ts ≤ now + SKEW_MAX`
(D6 proposes `MAX_AGE = TTL` and `SKEW_MAX` = 5 minutes). An entry older than
`MAX_AGE` is refused whatever the retention state, so an arbitrarily old signed
entry can never be accepted as fresh and cannot repin anything. Newer than the
retained `lastTs` for the URL: accepted. Equal `ts` and byte-identical content:
counted `duplicate`, no state change. Equal `ts` and different content: refused
and counted `conflict`, retained entry kept. Older than `lastTs` but within
`MAX_AGE`: refused as `replay`. `lastTs` is retained for `2 × TTL` after
expiry; after that it is dropped, and the `MAX_AGE` bound alone prevents
revival.

Refresh. At `TTL / 2` a sender re-signs its unchanged entry with a fresh `ts`,
so a refresh is a new signed entry, never an equal-`ts` duplicate, and the
receiver's expiry moves forward on it. Change detection sends sooner.

Ingress bound: one accepted sync per peer bridge per POLL_MS; extras refused and
counted.

Destinations: the receiver's own `{ home, receiverRegion }`, never derived from
the sender's entry; republished one hop (§7.2.7). Cross-origin dedup of the
same signed entry arriving at a copy from two republishers is a WP4 D4 test
obligation on the kernel's content dedup, not an assertion.

WP4 D rows gain: D6 replay after retention deletion (after `2 × TTL`, an entry
older than `MAX_AGE` is refused; a fresh entry from the pinned key is accepted;
a fresh entry from a different key is refused); D7 refresh produces a new
signature and moves expiry; D8 equal-ts different-content is refused as
`conflict`; D9 ownership: a known signer claiming a URL it cannot answer at is
refused at the probe.

## WP4 (rows amended)

- O1 partition: every received frame in exactly one §7.2.2 bucket, including
  `closedOversize`, `droppedInvalid`, `responseMatched`, `droppedRate`; buckets
  sum to frames received plus frames closed pre-decode.
- O2 positive controls: one frame through each §7.2.6 class, including
  `refusalReply` and `directorySync`.
- O3 every physical write has exactly one class; helper-level observations
  attach causal records and never count; `genericTransit === 0`.
- L2 as v0.3 §7.2.5: one specified workload; its measured path is
  decode + classify + refuse + send, with the run repeated with classification
  disabled to state the instrumentation delta.
- L3 malformed and max-size workload: 60 connections, each alternating
  invalid JSON, envelope-less objects, frames at the cap, and frames over the
  cap; measured the same way; reported beside L2, not folded into it.

## 9. Decisions for David (D7 added)

- D7 URL ownership by proof of possession (§7.3.2), with operator seeds as the
  override, or an operator-only allow-list of bridge URLs and keys with no
  probing.

## Everything else

Sections 1–6, 7.0, 7.1.1–7.1.3, 7.1.5, 7.2.5, 7.3.1, 7.4 rows not named above,
7.5, 7.6, 8, 9 D1–D6, and 10 stand as written in v0.3.
