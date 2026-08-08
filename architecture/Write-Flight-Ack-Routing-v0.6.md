# Write-Flight Ack Routing and Chain Budget — remediation design

**Status:** design proposal v0.6 — Aster R1–R10 (seq 481/494/499/502) plus R11–R12 (seq 507) incorporated; R7/R8/R10 retired by Aster; for council clearance before any code
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

- The publisher selects a **4.62.2-capable adjacent peer** as its delegate
  (capability is known from that peer's handshake `KERNEL_VERSION`), dispatches
  the PUB/KILL to it with a `flightDelegate` marker and NO `ackTo`, and pins
  the attempt to that exact adjacent peer. The publisher's own node opens no
  flight.
- That adjacent delegate **claims the flight itself** — strips the marker,
  opens the flight, stamps its OWN transport id as `ackTo`. It does NOT pass
  the marker deeper. Because the delegate is adjacent and claims directly, a
  pinned attempt has exactly ONE delegate regardless of how the route past it
  varies (Aster R11). The `ackTo` on the wire always names that authenticated
  claiming relay, never the API origin.
- **No capable adjacent peer (mixed-version rollout, R11):** delegation is
  disabled for this attempt. The publisher falls back to pre-4.62.2 behavior —
  an ordinary routed publish with observation-only confirmation, NO `ackTo`,
  no flight, bounded by the publisher's own retry loop. It forgoes the new
  write-liveness guarantee but adds no `ackTo` exposure (I-9 unchanged) and
  cannot spawn multiple delegates because it spawns none. The
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
delegate is a 4.62.2-capable adjacent peer that claims the flight directly, so
a pinned attempt has exactly one delegate no matter how the route past it
varies (R11). Pin creation is **atomic at the API boundary**, before any retry
timer can fire, so concurrent early retries cannot establish two initial
delegates:

```
peer.pub(...):                       # runs once, synchronously, per API call
    attemptId = random16()
    delegate  = pickCapableAdjacent()        # 4.62.2 peer, or null
    if delegate == null:
        return legacyObservationOnlyPublish()   # R11 fallback: no flight, no ackTo
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
  Two sub-cases: (a) a 4.62.2-capable adjacent peer exists → it is chosen and
  claims directly, one delegate; (b) no capable adjacent peer → delegation is
  disabled, the publisher falls back to observation-only publish, NO flight and
  NO `ackTo` is ever emitted, and the old marker-passed-deeper path does not
  execute.
- **Re-pin arithmetic + terminal surface (Aster R12):** the initial delegate
  plus exactly ONE permitted replacement reaches the six-promotion maximum;
  a SECOND delegate loss stops with no third budget; concurrent early retry
  timers establish exactly ONE initial pin (atomic-pin assertion); and the
  terminal is observable through the named surface — a `write-attempt-exhausted`
  event on the peer event surface AND the metrics counter — while `peer.pub()`
  keeps returning the msgId unchanged.
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
David's word). Mixed-mesh: until fully rolled, an OLD root acks one hop back,
so a multi-hop flight against it can exhaust — the chain budget converts the
eternal storm into a bounded recorded failure, and the roll removes it.

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
