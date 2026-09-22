# Bridge Air-Gap — Project Plan — v0.5 (correction revision to v0.4)

**Status:** proposed; correction revision under Aster CP 99a74055 (B2, B3, B5
open with finite corrections; B1, B4, B6 retired). A DELTA: it replaces the
named sections of v0.4 and v0.3 and leaves every other section in force. It
also folds the author correction e5d5dd83.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-22
**Base:** v0.4 (sha256 cc9ea61a…) on v0.3 (e7b23101…); v0.2 (3e8f8a9a…) and
v0.1 (866b123f…); all frozen and unmodified
**Companions:** council 99a74055, 94ec7677, e5d5dd83; ops/STATE.md 2026-09-22

---

## 0. Residual map

| Residual | What it required | Replaced or added |
|---|---|---|
| B2a stronger reachability | D2 and §7.3.1 must say the ROOT itself is directly connected; tests for non-root client, unreachable root, root turnover | §7.3.1, §9 D2, WP4 D10–D12 |
| B2b terminal-only root validation | the receiving peer must be the current root and never forward inside its PUB handler; stale-root refusal | §7.2.7 (receiver rule), WP4 D11 |
| B2c discovery requests as egress | outbound lookups need their own class and bounds | §7.2.6 (`discoveryRequest`), §7.2.7 (bounds) |
| B2d §0 wording | the fifth verb PUB | §0 of v0.4 corrected here |
| B2e convergence is a test | not a claim | WP4 D1, D2 restated |
| B3a PoP as an authenticated binding | what is signed, freshness, both directions, author↔node↔URL | §7.3.2 (binding statement, channel binding) |
| B3b probing bounded | schemes, destinations, redirects, DNS, concurrency, time, size, cache; no live probe | §7.3.2 (no separate probe; the receiver's own outbound dial) |
| B3c relay roots' signer set | how a relay obtains and verifies bindings | §7.2.7 (relay rule) |
| B5a aggregate bound stated truthfully | per-connection limits scale with connections; decode precedes limits; backpressure claim | §7.2.4, §9 D8 |
| B5b every physical write path | the uplink socket is a second write point; per-path controls | §7.2.6 |
| B5c oracle contradictions | O2 vs O3 on genericTransit; directorySync precedence; hello's cause; oversize denominator; L3 schedule | §7.2.6, WP4 O2, O3, O6, L3 |
| e5d5dd83 | no existing rate limits; no maxPayload | §7.2.4 |

Correction to v0.4 §0 and v0.3 §0: the wrapped verbs a bridge dispatches are
FIVE: SUB, UNSUB, PULL, PULLUP, and PUB under the signer rule of §7.2.1.

## 7.2.4 (replaced) Bounds, stated as the guarantee they are

What exists today: no per-connection rate limit on any bridge frame (the only
rate bound in server.js is the nursery graduation interval at :602), and no
`maxPayload` on the websocket server (:1054), so the `ws` default of 100 MiB
applies.

What WP2 introduces: the per-connection bounds in the §7.2.1 table; a
`maxPayload` cap (D5); fixed-size outcome counters; `N` tracked per-connection
slots plus an overflow aggregate; a fixed type taxonomy; one aggregated log row
per minute.

The guarantee those give, and no more: per-connection ingress work is bounded
by (cap × per-connection limit) after decode, and every frame is decoded before
its limit is checked, so decode work per connection is bounded by cap × the
rate at which the peer sends, not by the limit. Bridge-wide, both scale with
the connection count. `ws` backpressure stops the bridge reading a socket whose
outbound buffer is full; it does not stop inbound parsing on sockets the bridge
is not writing to, so it is not an inbound bound and is not claimed as one.

A bridge-wide inbound budget (a global frames-per-second ceiling with
drop-and-count beyond it, or a per-connection cap on undecoded bytes per
second applied before decode) would bound the aggregate. That is a separate
design decision, D8, not authority inferred from anything above. Until D8 is
decided, L2 and L3 measure what the per-connection bounds achieve on the
stated workloads, and the plan claims nothing beyond those measurements.

## 7.2.6 (replaced) Every physical write, classified

Physical write points on a bridge, from the inventory, each instrumented:

1. `ws.send` inside `sendToConn` (server.js) for every client socket.
2. The uplink socket's send, inside the protocol's node websocket transport
   used by `uplink.js` (`transport/node/wstransport.js`), for frames to the
   peer bridge.

There is no third: HTTP responses (`/healthz`, `/diag`) are not frames and are
outside the classifier. WP4 O2 sends a positive control through EACH write
point, not merely each class, so an uninstrumented path fails the run.

Helper-level observations (`transport.send`, `transport.notify`, `_route`)
attach causal records; they never count.

Classes, disjoint, with precedence where two could apply:

| Order | Class | What it is | Causal record |
|---|---|---|---|
| 1 | `directorySync` | a `directory:sync` request on an uplink, and its `res` in either direction | the cadence, or the received sync |
| 2 | `refusalReply` | a `res` carrying `transit-refused` or a `refused:true` verdict | the received frame and its outcome |
| 3 | `discoveryReply` | `res` to `lookup_step`, `find_closest_set`, `local_probe`, `lookahead_probe` | the received frame |
| 4 | `discoveryRequest` | the bridge's own outbound `lookup_step` / `find_closest_set` to a client, issued only by §7.2.7 root discovery | the root-discovery job |
| 5 | `controlReply` | bare `pong`, `peer-list`, `turn-refresh` reply, and `res` to a dispatched link or directory request | the received frame |
| 6 | `hello` | the bridge's `hello` on a new connection | the connection-admission event (no received frame) |
| 7 | `signalRelay` | bare `signal` to a named admitted connection | the received `signal` |
| 8 | `directoryServe` | DELIVER, replay, PULLRESP to a subscriber of a named topic over that subscriber's socket | the subscription record |
| 9 | `directoryOwnEntry` | own-entry PUB, one hop to a directly connected root | a book change or the cadence |
| 10 | `directoryRepublish` | sync-received entry PUB, one hop | the accepted sync |
| 11 | `genericTransit` | any write not matched above, or any `route_msg` carrying a received frame toward another node | none; held at zero in the acceptance interval |

`directorySync` controls in O2 are conditional on D2 selecting the service.

## 7.2.7 (replaced) The directory protocol, closed

Two publications leave a bridge, own entry and sync republication, each ONE
HOP to a directly connected node that is the CURRENT ROOT of the copy.

Root discovery, bounded: on a book change or the POLL_MS cadence, for each
named copy the bridge does not root itself, it issues at most `K` (proposed 4)
`lookup_step` / `find_closest_set` requests to directly connected clients, at
most once per copy per POLL_MS, with the existing request timeout, and takes
the returned closest id as the candidate root. These are `discoveryRequest`
egress. If discovery returns nothing or times out, the copy is
`directoryRootUnreachable` this cadence and nothing is sent.

Send rule: the PUB is sent only if the candidate root id is the peer of a
directly connected socket. `route_msg` with `via:[rootId]`, inner PUB, over
that socket. If it is not directly connected, `directoryRootUnreachable`.

Receiver rule, terminal-only: the client receiving that frame dispatches PUB
only if `targetId` is its own id AND it currently holds the root role for the
named topic. If it holds no root role, or holds a non-root role, it refuses
with a `stale-root` verdict; it does NOT forward, does NOT re-route by topic
id, and does NOT seat a role in response. `_topicDecision`'s existing `via[0]
=== me → handle if I have the role else reroute` is changed for named
directory topics from a bridge origin: `reroute` becomes `refuse stale-root`.
The bridge counts `directoryStaleRoot` and re-discovers next cadence.

Relay rule for the signer check: a relay root accepts a directory PUB only if
the payload carries a binding statement (§7.3.2) that verifies AND the node
key in that statement is either the node key of the bridge the relay itself
dialled (known from its own verified hello) or a node key already present in a
directory entry the relay holds whose chain began with its own bridge.
Otherwise it refuses `signerUnbound`. This is the relay's bootstrap of the
signer set, from the one key it verified itself.

Convergence is WP4 D1 and D2, measured, not claimed. The 0xFF legacy copy is
serve-only and ages out with its subscribers.

## 7.3.1 (amended) The three facts, with the stronger condition

Fact 3 becomes: a bridge can publish into a copy only if that copy's current
root is a directly connected client of the bridge. Having some client in the
region is not enough. D2 and its deployment alternative are restated below.

## 7.3.2 (replaced) The sync service, if D2 selects it

Wire: `directory:sync` is a request on the uplink, both directions, replied
`{ ok:true }` or `{ ok:false, body:{ error } }`.

Channel authentication, both directions, as it exists: every bridge link runs
the auth hello. The dialler's `hello-ack` and the listener's `hello` each carry
a signature by the node key over the transcript `{proto, nodeId, pubkey, cbv}`
where `cbv = cbvFromNonces(serverNonce, connId)` for the link
(handshake-auth.js:77–105, bridge_axona_node.js:95–99), verified with
`verifyAuthHello` and `pubkeyMatchesNodeId`. That is a fresh
challenge-response bound to this connection: the signer proved possession of
the node key for THIS channel. A declared class (`setAuthorClass('bridge')`)
is evidence of nothing and is not used.

The binding statement, new: `bridgeBinding = { nodeIdHex, authorPubkeyHex,
url, issuedTs, sigAuthor, sigNode }` where `sigAuthor` is the author key's
Ed25519 over canonical `{nodeIdHex, authorPubkeyHex, url, issuedTs}` and
`sigNode` is the node key's signature over the same bytes. It binds author
key, node key and canonical URL to one another, and it carries `issuedTs`
under the same `[now − MAX_AGE, now + SKEW_MAX]` window. It travels inside
every `directory:sync` and inside every directory PUB payload.

URL ownership by the receiver's own outbound dial, not a separate probe: a
bridge dials its uplinks to URLs it obtained from operator seeds
(`BRIDGE_UPSTREAMS`) or from the book. When that dial completes the auth
hello, the receiver has verified that the node key answering at THAT URL is
the key in the hello. A binding statement's `url` is accepted as owned when
the receiver holds a verified outbound dial to that exact URL (scheme `wss`,
exact host and port, no redirects followed, the OS resolver as it is) whose
node key equals the statement's `nodeIdHex`. On an INBOUND uplink, where the
peer dialled us, the peer's `url` is accepted only if we also hold, or
establish on our normal uplink cadence, an outbound dial to it; until then the
entry is held `urlUnverified`, served to nobody and republished nowhere. No
new externally directed operation is introduced: the only dials are the ones
the uplink policy already makes, to seeded or book URLs, on its existing
cadence and timeout, one per URL at a time. No live probe is authorised by
this plan.

Limits, stated: whoever controls DNS or TLS for a URL can answer at it and own
it; operator seeds are the override; a compromised peer bridge can bind only
URLs it can answer at. D7 keeps the operator-only allow-list of URL and key
pairs as the alternative, with no dial-based binding at all.

Pins, timestamps, refresh, conflicts, retention: as v0.4 §7.3.2 (pins dropped
only by operator action; `ts` valid in `[now − MAX_AGE, now + SKEW_MAX]`;
equal-ts identical is duplicate, different is conflict, older is replay;
`lastTs` retained `2 × TTL` past expiry; refresh re-signs at `TTL / 2`).

Destinations and republication: as v0.4 §7.3.2 and §7.2.7 above, one hop to
the receiver's own copies' current roots.

## 9 (amended) Decisions for David

- D2 restated: directory reach for a bridge whose copy's root is not a
  directly connected client: the sync service of §7.3.2, or the deployment
  constraint that each bridge keeps a directly connected client that IS the
  root of each copy it publishes to. The second is stronger than v0.4's "one
  client in each region" and is stated so it can be rejected on its face.
- D8 a bridge-wide inbound budget (§7.2.4): a global frames-per-second
  ceiling with drop-and-count, a per-connection undecoded-bytes-per-second
  cap before decode, or neither for now with L2 and L3 as the stated
  measurements.
- D1, D3–D7 unchanged.

## WP4 (rows amended and added)

- D1, D2 restated: convergence of every named copy is MEASURED in H0 with two
  bridges; D2 additionally with one bridge whose copy's root is not directly
  connected, converging only through the selected D2 mechanism or recording
  that it does not.
- D10 a region with a connected non-root client only: the bridge records
  `directoryRootUnreachable`, sends nothing, and the copy does not receive the
  entry until D2's mechanism runs.
- D11 root turnover between discovery and PUB: the former root refuses
  `stale-root`, forwards nothing, seats nothing; the bridge re-discovers.
- D12 unreachable root: discovery times out within its bound; nothing sent.
- O2 replaced: one positive control per PHYSICAL WRITE POINT and per class,
  `directorySync` conditional on D2, `hello` driven by a connection admission,
  and `genericTransit` proven detectable by an isolated deliberate violation
  BEFORE the acceptance interval, after which counters are reset and the
  violation harness is disconnected; the acceptance interval then requires
  `genericTransit === 0`.
- O3 unchanged in intent: every physical write in exactly one class, by the
  §7.2.6 precedence.
- O6 oversize accounting: `oversizeCloses` counts server-side close events
  with code 1009 per connection, from the `ws` close handler, and is reported
  beside, never inside, the decoded-frame partition; its denominator is
  connections, the partition's denominator is decoded frames. A close event
  is one event, not one frame.
- L3 made finite: 60 connections; each runs a fixed schedule of 1,000 frames
  cycling invalid JSON, envelope-less object, frame at the cap, frame over the
  cap; after an over-cap close the connection reconnects after 1 s and
  resumes its schedule; duration is the schedule, not a clock; reported beside
  L2.

## Everything else

Every section of v0.3 and v0.4 not named above stands as written.
