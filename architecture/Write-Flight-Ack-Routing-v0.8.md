# Write-Flight Ack Routing and Chain Budget — remediation design

**Status:** design proposal v0.8 — Aster R1–R14 incorporated (R7/R8/R10 retired; R14 closed in substance, retires with the R16 cleanup below); R15 (byte-exact capability transcript with base-auth key binding) and R16 (removal of three stale contradictions) added this revision per Aster's v0.7 review (seq 517); R11/R12 retire once the byte-exact R13/R15 oracle clears; for council clearance before any code
**Baseline:** `@axona/protocol` 4.62.1 testnet at `8f34759`; incident GH #51
**Author:** axona.bot · **Reviewers:** Aster, Orion · **Decider:** David
**Scope:** the write flight's evidence return path and its termination. No
change to root election, tombstones, epochs, ingest order, or any read path.

## The question this design answers

How does a write flight hear its evidence across a multi-hop route, and when
does a failing write STOP?

Today it hears nothing and never stops. `_forwardToRoot` opens the flight at
the route's ORIGIN and sends the PUB routed; the root acks `meta.fromId` —
the LAST HOP. One-hop routes work. On any multi-hop route the ack lands on an
intermediate relay holding no flight and is dropped. Silence convicts an
honest root; the promotion re-send is also routed and also deaf; each
promotion opens a NEW flight with a fresh budget, so the write oscillates
between candidates at ~15 s per conviction, forever. Measured on GH #51:
16 deaf-flight evictions/hour on a healthy mesh from the first soak hour,
eviction:promotion exactly 1:1, superlinear accumulation to fleet collapse,
self-sustaining after the stimulus stopped.

Define by negation: this is not a redesign of the eviction fence. The fence's
law — a write completes on bound INGEST evidence or the authority is
convicted — stands. The defect is that the evidence was addressed to the
wrong node, and that conviction had no terminal.

## D0 — Who owns a flight, and the privacy property it actually gives (Aster R6, R8)

The v0.2 draft put the flight owner's transport id in the PUB frame while
claiming publisher-location privacy was unchanged. Aster's R6 broke that with
one case: when an application calls `peer.pub()`, the node that opens
`_forwardToRoot` IS the publishing transport, and the same frame carries the
author envelope — so `ackTo` would hand every hop an author-to-transport
correlator, which I-9 forbids a PUB to carry.

The resolution is structural (Aster's path *a*): **an API-origin node never
owns a carried flight.**

- The publisher selects a **capability-attested adjacent peer** as its delegate
  (capability comes from the authenticated `write-flight-ack-v1` attestation of
  R13, NOT from any handshake version string — see R13/R15 for the byte-exact
  contract), dispatches the PUB/KILL to it with a `flightDelegate` marker and NO
  `ackTo`, and pins the attempt to that exact adjacent peer. The publisher's own
  node opens no flight.
- That adjacent delegate **claims the flight itself** — strips the marker,
  opens the flight, stamps its OWN transport id as `ackTo`. It does NOT pass
  the marker deeper. Because the delegate is adjacent and claims directly, a
  pinned attempt has exactly ONE delegate regardless of how the route past it
  varies (Aster R11). The `ackTo` on the wire always names that authenticated
  claiming relay, never the API origin.
- **No capable adjacent peer (mixed-version rollout, R11):** delegation is
  disabled for this attempt. The publisher falls back to pre-4.62.2 behavior —
  an ordinary routed publish with observation-only confirmation and NO `ackTo`.
  **The NEW publisher opens no flight**; it adds no `ackTo` exposure (I-9
  unchanged) and cannot spawn multiple delegates because it spawns none, and its
  own dispatches are bounded by its retry loop. This does NOT bound the old
  machinery downstream: per R14, an ordinary PUB reaching an old 4.62.1 waypoint
  with a stale closer-root hint can still make THAT node open its own deaf flight
  and enter the unbounded #51 loop — which is why R14 scopes this fallback to a
  rollout-safe topology rather than claiming it is storm-free. The
  marker-passed-one-hop-deeper mechanism of v0.5 is REMOVED — it was the
  multi-delegate hole R11 identified.
- Degenerate cases: publisher adjacent to root (1-hop) → root's one-hop ack
  reaches it as the authenticated channel peer, today's behavior; publisher
  IS the terminus → local ingest, no flight; bridge as the chosen capable
  adjacent delegate → the bridge owns the flight as a bounded control record
  (the capability-aware terminal proxying the triumvirate direction already
  assigns to forward-only ingress).
- Relay-origin writes (promotion re-sends, relay ingress forwards) own their
  flights directly: a relay's id next to a client's envelope links the author
  to the RELAY, not the publisher, and relay ids are public routing material.

**The privacy property, stated correctly (Aster R8).** v0.3 claimed "no frame
ever pairs the author identity with the origin transport id." That claim is
**false on today's wire and is withdrawn.** The canonical `route_msg` wrapper
already carries `{type, payload, targetId, hops, originId}`, and `originId`
is preserved unchanged across every hop (`AxonaPeer.js:692`), while the PUB
payload carries the author envelope. So the author-to-origin-transport
pairing is a PRE-EXISTING exposure on every routed publish, independent of
this change. This design does not add to it and does not remove it. What
delegation actually guarantees — the property this design is responsible for
— is narrower and exact:

> The new acknowledgment channel terminates at a relay, never at the
> publisher. A delegated `ackTo` names the authenticated claiming relay and
> never the API origin, and no ACK proof is ever addressed to, or routed
> toward, the publishing transport.

The pre-existing `originId` exposure is recorded as its own line item, not
masked by this work; closing it would require changing the `route_msg`
wrapper itself (origin-stripping / onion-style routing), which is a separate
design with its own invariant review — noted here, not attempted. Paths *b*
(opaque return capability) and *c* (amend I-9) stay rejected for this round
with the same reopen conditions as v0.3.

## D1 — The ack routes to the flight owner, as signed end-to-end evidence

The PUB/KILL frame a flight OWNER dispatches (per D0: a relay, never an
API-origin publisher) carries `ackTo` (owner transport id), `flightNonce`
(random per flight generation), and the `attemptId` from D2.

At the root, the ingest ack becomes a signed **ACK PROOF** routed to `ackTo`.

### The signature transcript, byte-exact (Aster R5, R7)

One transcript builder, shared verbatim by signer and verifier. All integers
big-endian. Hex id fields are signed as their DECODED BYTES (not text), at
fixed protocol width. The `purpose` byte distinguishes every signed frame
class so no signature can be relabeled:

```
DOMAIN   = ASCII "AXONA_INGEST_ACK_PROOF_V1"   (25 bytes, no NUL)
purpose  : u8  — 0x01 INGEST_ACK        (root proves ingestion)
                 0x02 RECEIPT_NACK       (root proves honest refusal)
                 0x03 RECEIPT_PROBE_ACK  (probe-solicited ingestion proof)
op       : u8  — 0x01 PUB   0x02 KILL          (closed set; others rejected)

transcript =
  DOMAIN                       (25 bytes, fixed)
  u8(purpose)
  u8(op)
  topicId                      (TOPIC_ID_BYTES, fixed width, decoded)
  msgId                        (MSG_ID_BYTES,   fixed width, decoded)
  u64(epoch)
  attemptId                    (16 bytes, fixed)
  ackTo                        (NODE_ID_BYTES,  fixed width, decoded)
  flightNonce                  (16 bytes, fixed)
  rootPub                      (32 bytes, Ed25519 public key)

sig = Ed25519(rootTransportKey, transcript)
```

No `len32` prefixes remain: every field is fixed-width, so the transcript is
a fixed-length byte string and there is no parse ambiguity to canonicalize.
The wire frame carries the same fields plus `sig`; the verifier **rebuilds
the transcript from a fixed-width decode of each received field and rejects**,
before any signature check: a `purpose`/`op` outside its closed set, any hex
field whose decoded length ≠ its fixed width, a `rootPub` ≠ 32 bytes, or a
frame exceeding the existing inbound size cap. Case is never significant
because ids are compared as bytes.

**Distinct purpose is load-bearing (Aster R7).** A root-signed RECEIPT_NACK
(purpose 0x02) can never be replayed as an INGEST_ACK (0x01): the byte the
signature covers differs, so the ACK verification recomputes a different
transcript and the signature fails. INGESTACK, RECEIPTNACK, and the
probe-ACK are three separate signed objects, not one transcript with a
type field outside the signature.

**Golden + rejection vectors (Aster R7).** The kernel ships, checked into the
test tree, one canonical golden vector per signed frame class (fixed key,
fixed inputs, expected transcript bytes + expected signature), plus rejection
vectors for: NACK-relabeled-as-ACK, wrong epoch endianness or wrong
`attemptId` bytes/width (attemptId is opaque 16 bytes, not an integer), wrong
hex width, wrong `rootPub` length, and a valid signature from a different
`purpose` replayed. An independent implementation reproduces the goldens or
it is not conformant.

### Binding (Aster R1)

A routed ack arrives from the LAST HOP of the ack's route — the authenticated
channel peer is a relay, not the root, so hop identity cannot bind
completion. The owner verifies `sig` against `rootPub`, derives the node id
from `rootPub` and requires it to equal the flight's expected authority
(`AuthorityRef`: rootHex, and epoch when VERSIONED), and requires
`(topicId, msgId, op, attemptId, ackTo, flightNonce)` to match the open
flight. UNVERSIONED flights accept only the addressed node's signed proof —
strictly stronger than 4.62.1's first-ack rule. Replay from an earlier
generation dies on `flightNonce`; a proof from any node but the addressed
root dies on the pubkey-to-nodeId derivation.

**Compat.** `flightDelegate`/`ackTo` absent (4.62.1-or-older sender): root
acks one hop back, unsigned, exactly as today; an unsigned ack completes a
flight only under the 4.62.1 rule (adjacent authenticated sender = expected
root), correct on the 1-hop routes where it ever worked. No wire version
bump: all new fields are additive-optional.

**Misdirection.** The signature covers `ackTo`, so an on-path relay that
alters it only causes the wrong receiver to discard the proof and the true
flight to starve — bounded by D2, never false completion.

## D2 — Attempt identity, chain budget, and terminal (Aster R2, R3, R9, R10)

### The attempt identifier

An opaque **`attemptId`** — 16 random bytes, minted ONCE at the API boundary
inside `peer.pub()` / `peer.kill()`, retained across every automatic retry of
that same call, never regenerated by a promotion (a promotion inherits its
flight's attemptId), and folded into the chain key and the signed transcript
(D1) so a proof binds to the exact attempt. It is opaque bytes, not an
integer — it carries no count and no ordering.

### The bound is composite and locally enforced, not a shared counter (Aster R9)

v0.4 proposed `ATTEMPT_MAX_PROMOTIONS = 6` "propagated on hand-off." Aster is
right that this is unenforceable: the publisher has no ack channel (D0), so a
retry to a DIFFERENT first hop carries the publisher's own retained state
(count 0), and the new delegate — with no shared ledger — accepts it and
opens a fresh budget. There is no authority that sees all delegates, so no
single number can be a hard aggregate. v0.5 removes the propagated count
entirely and bounds the attempt two ways that each use only LOCAL state:

**1. Publisher pins ONE capable adjacent delegate per attempt (D0).** The
delegate is a capability-attested adjacent peer (see R13 for how capability is
established — NOT read from the base auth transcript, which carries no version)
that claims the flight directly, so a pinned attempt has exactly one delegate no
matter how the route past it varies (R11). Pin creation is **atomic at the API
boundary**, before any retry timer can fire, so concurrent early retries cannot
establish two initial delegates:

```
peer.pub(...):                       # runs once, synchronously, per API call
    attemptId = random16()
    delegate  = pickCapableAdjacent()        # R13-attested peer, or null; fail-closed
    if delegate == null:
        return fallbackPublish(...)          # R14: bounded ONLY under a rollout-safe
                                             # topology — see R14 for what the caller
                                             # cannot certify about downstream old nodes
    pin = { attemptId, delegate, assignments: 1 }   # established BEFORE first dispatch
    dispatchTo(delegate, attemptId)
    # every automatic retry reads `pin` and via-pins to pin.delegate — it never
    # re-derives a delegate, so no timer race can mint a second initial pin.
```

**2. Each delegate is the sole authority for its own per-delegate cap.** A
delegate caps promotions for a `(topicId, msgId, op, attemptId)` at
`CHAIN_MAX_PROMOTIONS = 3` using local state only, then records the terminal
and tombstones that attemptId locally for `EXHAUSTED_RECORD_TTL`. No frame,
stale or replayed, can make a delegate exceed its own local cap — the cap
lives at the delegate, never in the marker, so there is no count to replay.

**Delegate death → at most one replacement (Aster R12).** The bound is
`DELEGATE_MAX = 2` **total delegate assignments** for one attempt — the initial
delegate plus at most one replacement (there is no separate "re-pin count"; the
v0.5 `DELEGATE_REPIN_MAX` name is removed as ambiguous). When the pinned
delegate's channel drops (locally observable) or a via-pinned retry fails, the
publisher re-pins to one new capable adjacent delegate and sets `assignments =
2`. A second death stops the automatic path — no third delegate. The honest
composite ceiling is therefore literal and exact:

```
DELEGATE_MAX (2)  ×  CHAIN_MAX_PROMOTIONS (3)  =  6 promotions, worst case
```

**Terminal failure has a named, observable surface (Aster R12).** `peer.pub()`
keeps its current contract — it returns the `msgId` and confirmation stays
observation-only (I-9); it does NOT block on the flight. When the second
delegate is exhausted or unavailable, the terminal is surfaced two ways the
application can consume without changing that contract: (a) a
`write-attempt-exhausted { attemptId, topicId, msgId, op, lastReason }` event
on the peer's existing `onError`-class event surface, and (b) a monotonic
counter on the metrics surface. Applications needing delivery certainty listen
to (a) or watch (b); the return value of `pub()` is unchanged.

**The adversarial tail, stated plainly.** A party replaying the count-free
first frame to arbitrary delegates gets at most `CHAIN_MAX_PROMOTIONS` per
distinct delegate per TTL window — bounded per delegate by local state, and
in total by the fleet size, not by 6. This is strictly better than 4.62.1
(unbounded) and is the honest limit of a design with no shared authority;
tightening it further is the triumvirate's shared-cohort-ledger territory,
noted, not attempted here.

### Per-entry accounting (Aster R10)

The flight serialization key is the suspect incarnation, so entries from
SEPARATE API calls — each with its own attemptId — can batch into one flight.
Therefore **attemptId is carried and accounted PER ENTRY, never per flight.**
Each entry has its own attemptId, its own `(topicId, msgId, op, attemptId)`
chain, its own promotion count, its own proof-matching, its own exhaustion,
and its own terminal. The proof (D1) binds the entry's attemptId, so an ACK
settles exactly one entry. No entry inherits another call's budget, and one
entry exhausting never terminates another.

### Reset, terminal, sweep

A genuinely fresh `peer.pub()` mints a new attemptId → new per-entry chain →
fresh budget. An automatic retry reuses the attemptId → same chain →
exhaustion cannot be reset by retrying. Each cap ends in ONE recorded
terminal (`write-flight-exhausted`, carrying the full key and promotion
path). Exhausted records expire after `EXHAUSTED_RECORD_TTL` (10 min); expiry
is safe because the only openers are `api` (a fresh attemptId) and
`promotion` (which carries the exhausted attemptId and is dropped).

`CHAIN_MAX_PROMOTIONS = 3` exceeds the plausible stale-candidate run after one
death (K=3 cohort); `DELEGATE_MAX = 2` allows the initial delegate plus one
replacement. Both are constants the `write-flight-exhausted` metric will tune;
changing them is not a design change.

## R13 / R15 — The capability oracle: a byte-exact authenticated contract, not the auth transcript

v0.6's `pickCapableAdjacent()` assumed the publisher could read a bound peer's
`KERNEL_VERSION` from the handshake and decide it implements 4.62.2. Aster is
right that no such fact exists today. The peer authentication proof signs only
`{proto, nodeId, pubkey, cbv}`; the mesh/node auth path neither exposes nor
retains a per-peer remote kernel version. The version-bearing hello is
**bridge-facing** (client↔bridge), not peer↔peer, and the transport's
capability helpers describe LOCAL features. So there is nothing authenticated
to read, and reading an unauthenticated self-report would let any peer claim
capability to be handed a flight.

**The contract, byte-exact (Aster R15).** Define one capability token —
`write-flight-ack-v1` — carried by a post-authentication frame named
`CAP_ATTEST` (identical shape on the node WS, web-mesh, and bridge channels; it
is a normal application-class frame, not a handshake extension). It is signed
over a fixed transcript built by one shared builder, all integers big-endian,
hex/key fields signed as DECODED BYTES at fixed width — the same discipline as
the D1 INGEST_ACK transcript:

```
DOMAIN   = ASCII "AXONA_CAP_ATTEST_V1"   (19 bytes, no NUL)   — FIXED, not "e.g."
capId    : the ASCII bytes "write-flight-ack-v1" (19 bytes, fixed) — the one
           capability this frame attests; a different capId is a different token
transcript =
  DOMAIN            (19 bytes, fixed)
  u8(capIdLen=19)
  capId             (19 bytes, fixed)
  nodeId            (NODE_ID_BYTES, fixed width, decoded) — the ATTESTER's id
  cbv               (CBV_BYTES, fixed width, decoded) — the CURRENT channel binding
sig = Ed25519(attesterIdentityKey, transcript)
```

The wire frame carries `{capId, nodeId, cbv, sig}` — and **no public key.** The
verifier rebuilds the transcript from a fixed-width decode of each field and,
before any signature check, rejects: a `capId` ≠ the 19 expected bytes, a
`nodeId`/`cbv` whose decoded width is wrong, or a frame over the inbound size
cap.

**Key binding is the crux (R15).** The signature is verified with the **public
key already established for this peer by base authentication** — the key stored
against this bound channel — NEVER a key carried in the `CAP_ATTEST` frame
(there is none to carry). So `CAP_ATTEST` proves only "the peer I already
authenticated as `nodeId` also attests capability `capId` on THIS channel." A
claim validly signed by some *other* authenticated identity fails, because it is
checked against the stored key of the peer on the channel it arrived on, and the
`nodeId` in the transcript must equal that peer's authenticated id. There is no
wire field a forger can populate to substitute a key.

- **Channel binding + verified-flag lifecycle.** The transcript covers the
  current `cbv`, so an attestation captured on one channel cannot replay onto
  another (different `cbv` ⇒ different transcript ⇒ signature fails). On success
  the verifier sets a boolean `capable[write-flight-ack-v1] = true` **keyed to
  that exact live channel object**; the flag is CLEARED on channel loss and is
  never persisted or carried across a reconnect. A reconnect re-runs
  `CAP_ATTEST` from scratch — consistent with never-persist-a-transport-id.
- **Downgrade resistance / no flag-day.** `CAP_ATTEST` is a NEW application
  frame; the base auth transcript is byte-unchanged, so **old verifiers still
  accept new peers' base proofs.** An old transport that does not know
  `CAP_ATTEST` treats it as an unknown application frame and **ignores it
  without disconnecting** (a tested invariant, below); a new verifier that never
  receives a valid `CAP_ATTEST` leaves the flag false and fails closed. Distinct
  DOMAIN keeps an INGEST_ACK proof (or any other signed frame) from being
  replayed as a capability claim and vice-versa.
- **Bridge handling.** A bridge attests its OWN `write-flight-ack-v1` over the
  channel it terminates (its own `nodeId`, that channel's `cbv`); it never
  forwards another node's attestation as its own. A publisher adjacent to a
  bridge treats it as a candidate delegate only if the bridge itself attested —
  and an attested bridge is a known-capable ingress, the safe R14 fallback
  target.
- **Selection API.** `pickCapableAdjacent(topicId)` iterates the bound-peer
  table, filters to peers whose live channel currently has
  `capable[write-flight-ack-v1] === true`, and returns the one closest to
  `topicId`, or null. It reads only that per-channel flag — never a version
  string, never a frame-supplied key.

**Tests (R13/R15).** Golden vector: one checked-in `(fixed key, fixed nodeId,
fixed cbv)` → expected transcript bytes + expected signature; an independent
implementation reproduces it or is non-conformant. Rejection vectors, each
fail-closed: (a) a claim validly signed by a DIFFERENT authenticated identity;
(b) a frame attempting to supply a replacement/verification key (there is no
such field — a frame with an extra key field is refused by the fixed decode);
(c) wrong `capId`; (d) wrong `cbv`; (e) wrong DOMAIN; (f) a re-labelled
INGEST_ACK proof; (g) replay of a prior-channel attestation after reconnect
(stale `cbv`). Behavioural: an old transport receives `CAP_ATTEST` and stays
connected, ignoring it; a valid capable peer is selected; a reconnect that drops
the attestation clears the flag and moves the peer to the R14 fallback;
no-capable-peer → null → R14 fallback.

## R14 — The fallback bounds our publisher, not an old relay's machinery

v0.6 claimed the no-capable-delegate fallback was "bounded by the publisher
retry loop." Aster is right that this bounds only OUR publisher's own
dispatches. A plain PUB that reaches a **4.62.1 waypoint** carrying a stale
closer-root hint still executes THAT node's old `_forwardToRoot`, opens the
deaf flight there, and enters the unbounded #51 promotion loop — machinery we
do not control and cannot remotely fix. The honest statement: **a publisher can
authenticate only its adjacent hop (R13); it cannot certify a whole multi-hop
route, so it cannot guarantee a mixed network spawns no problematic flight.**

The storm is therefore a property of the deployed VERSION topology, and the
rollout rule is scoped to it. Grounding fact, verified against the kernel tree
(v4.61.2 vs v4.62.1 at `8f34759`): the write-flight machinery
(`src/pubsub/writeFlight.js`, `_writeFlights`, ingest-ack, evict-and-promote)
**does not exist before 4.62.0.** At 4.61.2, `_forwardToRoot` sends the write
and, on a failed verdict, only invalidates the beacon pointer — no flight, no
conviction, no eviction. **Only 4.62.0 and 4.62.1 are storm-capable.**

- **Production (4.61.2 → 4.62.2), clean by construction.** Prod runs 4.61.2,
  which has no flight machinery, and rolls directly to 4.62.2, which has the
  fixed machinery. **No storm-capable version is ever in the prod write path**,
  so the mixed-version fallback on prod can reach only a 4.61.2 old node, whose
  worst case is a dropped beacon pointer and a lost write (#422) — never a
  storm.
- **Testnet (the only 4.62.1) — fenced roll, Aster's option 3 made concrete.**
  A mixed 4.62.1 + 4.62.2 network under sustained write load **IS storm-capable
  and is an operational deployment blocker for any un-fenced roll.** The M4 (26)
  and M1 (12) fleets are the only 4.62.1 population and are entirely
  operator-controlled. The roll is fenced: (1) quiesce sustained writes for the
  roll window; (2) `roll-fleet.sh` starts every 4.62.2 unit and stops every
  4.62.1 unit within the window (start-then-stop, EXPECT-verified), so no old
  unit lingers; (3) the eviction-rate watch is armed (>20 evictions/10 min ⇒
  abort and revert to 4.61.2); (4) prefer routing any necessary write through a
  known-capable ingress (a 4.62.2 relay or an attested bridge, per R13) rather
  than a bare PUB into the mixed fleet.
- **The distinction Aster requires.** A signed proof handled by a NEW delegate
  exhausts under the D2 chain budget. A flight OWNED by an OLD 4.62.1 relay does
  NOT — only removing that relay ends it. The new chain budget bounds the new
  machinery; it has no reach into the old.

**Tests (R14).** A mixed-version test places a new publisher with no capable
adjacent peer and routes its PUB through an old 4.62.1 waypoint holding a stale
closer-root hint. The gate does not assert false safety; it **detects the
unbounded old flight and classifies that topology as a deployment blocker** —
encoding the operational rule as an assertion. A companion case proves the
prod-shaped topology (old node = 4.61.2, no flight machinery) opens no flight
and loses at most the single write.

## D3 — The test class that let this ship cannot exist

Every path that passed a gate was 1-hop: MockNet dispatches direct; the live
gates ran on a dense settled mesh; the one live promotion went to self.

- MockNet gains a **multi-hop mode** (`sendDirect` routes through N
  intermediate managers; constructor flag; existing tests untouched).
- `smoke_write_flight_multihop.mjs`: red on 4.62.1 (deaf ack + A↔B
  oscillation); green under D0+D1+D2 — a signed proof reaches the delegate
  across 2 hops; a wedged write ends in `write-flight-exhausted` after
  exactly the budget, per entry.
- **Transcript conformance (R7):** the golden vectors verify; every rejection
  vector is refused before signature check; a RECEIPT_NACK cannot complete a
  flight as an ACK.
- **Privacy, corrected (R8):** the test records the pre-existing `originId`
  exposure as a known baseline, then asserts the property this design owns —
  every `ackTo` on the route names the authenticated claiming relay, never
  the API origin; no ACK proof is addressed to or routed toward the
  publishing transport. It does NOT assert the withdrawn no-correlation
  claim.
- **Attempt / bound (R9), genuinely independent delegate state:** each delegate
  gets its own isolated chain/exhaustion store (no shared map). Asserts: an
  honest pinned attempt keeps one delegate; a same-attempt retry cannot reset
  an exhausted chain; a fresh `peer.pub()` can; replaying the count-free first
  frame at a SECOND delegate after the first exhausted opens at most
  `CHAIN_MAX_PROMOTIONS` there and no more (per-delegate-local, not a spoofable
  shared counter); a promotion never mints a new attemptId.
- **Mixed-version delegate selection (Aster R11):** pin one OLD (pre-4.62.2)
  peer as the publisher's adjacent hop and vary its downstream next hop across
  retries, with isolated delegate stores — assert the documented bound holds.
  Two sub-cases: (a) a capability-attested adjacent peer exists (R13) → it is
  chosen and claims directly, one delegate; (b) no capable adjacent peer → the
  NEW publisher opens NO flight and emits NO `ackTo`, and the old
  marker-passed-deeper path does not execute. Sub-case (b) is completed by the
  R14 tests below, which cover what the OLD downstream machinery can still do.
- **Re-pin arithmetic + terminal surface (Aster R12):** the initial delegate
  plus exactly ONE permitted replacement reaches the six-promotion maximum;
  a SECOND delegate loss stops with no third budget; concurrent early retry
  timers establish exactly ONE initial pin (atomic-pin assertion); and the
  terminal is observable through the named surface — a `write-attempt-exhausted`
  event on the peer event surface AND the metrics counter — while `peer.pub()`
  keeps returning the msgId unchanged.
- **Capability oracle, byte-exact (Aster R13/R15):** a checked-in golden
  transcript+signature vector reproduces, and rejection vectors all fail closed
  — a claim signed by a DIFFERENT authenticated identity, a frame carrying a
  replacement key (no such field survives the fixed decode), wrong `capId`,
  wrong `cbv`, wrong DOMAIN, a re-labelled INGEST_ACK proof, and a prior-channel
  attestation replayed after reconnect (stale `cbv`). The signature is verified
  ONLY with the stored base-authenticated peer key. Behavioural: an OLD
  transport receives `CAP_ATTEST` and stays connected (ignores the unknown
  frame); a valid capable peer is selected; a reconnect that drops the
  attestation clears the per-channel flag → R14 fallback; a new peer's base-auth
  proof still verifies under an OLD verifier (base transcript byte-unchanged, no
  flag-day).
- **Mixed-version rollout safety (Aster R14):** new publisher, no capable
  adjacent peer, PUB routed through an OLD **4.62.1** waypoint holding a stale
  closer-root hint → the gate DETECTS the unbounded old flight and asserts that
  topology is a **deployment blocker** (it does not assert false safety). The
  companion case with the OLD node at **4.61.2** (no flight machinery) asserts
  no flight opens and at most the single write is lost. A signed proof handled
  by a NEW delegate exhausts under the D2 budget; a flight OWNED by an OLD
  4.62.1 relay is shown NOT to, ending only when that relay is removed.
- **Per-entry batching (R10):** multiple PUB/KILL entries with DISTINCT
  attemptIds join one suspect flight (keyed by incarnation) and then complete
  or exhaust independently; an ACK bound to one entry's attemptId settles
  only that entry; no entry inherits another's budget or terminal.
- **Adversarial matrix (R4):** malicious relay's unsigned ack, forged proof
  under wrong key, altered `ackTo`, wrong epoch, replayed proof, mixed-version
  fallback — none complete; the true flight exhausts cleanly where applicable.
- TESTNET-PROTOCOL gains a **non-adjacent live gate**: publish through a
  forwarder whose synaptome excludes the topic root (route provably ≥2 hops).

## What this design deliberately does not do

- No beacon-starvation mechanism (the epoch-0 storm flights were a symptom;
  D1 delivers the proofs, flights complete, beacons flow — reopens on
  post-fix evidence).
- No change to the 4 killed-message-resurrected events yet (D2 removes the
  churn that is the leading suspect; acceptance blocker below decides them).
- No `route_msg` wrapper change — the pre-existing `originId` exposure (R8)
  is documented as a separate future item, not addressed here.
- No wire version bump.

## Rollout and acceptance

Kernel `4.62.2` candidate, testnet only, full ritual (suite + multi-hop,
transcript-conformance, privacy, attempt, and adversarial smokes + fence,
relay re-vendor gate, bridge pin, droplet, both fleet rolls — each gate on
David's word). Mixed-mesh, stated precisely (R14/R16): the chain budget bounds
only a flight **owned by a new 4.62.2 delegate** — such a flight against an old
one-hop-acking root exhausts into a bounded recorded failure. It does NOT bound
a flight **owned by an old 4.62.1 relay**, which can still enter the unbounded
#51 loop; only removing that relay ends it. Therefore an un-fenced mixed
4.62.1+4.62.2 testnet is storm-capable and is a deployment blocker — the roll is
fenced (quiesce writes, `roll-fleet.sh` start-then-stop recycles every old unit,
eviction-rate watch >20/10 min ⇒ abort+revert), and prod (4.61.2→4.62.2, no
storm-capable version in the write path) is clean by construction.

Acceptance (blockers named):

1. Full overnight soak on the rolled testnet vs the 4.61.x baseline (93.6%).
2. **Zero `killed-message-resurrected` — one recurrence is a release blocker
   and opens its own design round; not passable under the aggregate.**
3. SIGKILL gates rerun, including the new non-adjacent gate.
4. Zero `root-evicted` at rest.
5. Transcript golden/rejection vectors green; the D3 privacy assertion green
   in-suite AND on the live testnet capture path.

The 4.62.1 gate numbers taught what a settled-mesh pass is worth; the soak
decides.
