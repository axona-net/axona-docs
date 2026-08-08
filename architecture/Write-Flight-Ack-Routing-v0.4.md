# Write-Flight Ack Routing and Chain Budget — remediation design

**Status:** design proposal v0.4 — Aster R1–R4 (seq 481), R5–R6 (seq 494), R7–R9 (seq 499) incorporated; for council clearance before any code
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

- An API-origin PUB/KILL is dispatched with a `flightDelegate` marker and NO
  `ackTo`. The publisher's node opens no flight for it.
- The FIRST RELAY HOP that forwards the marked frame strips the marker, opens
  the flight, and stamps its OWN transport id as `ackTo`. The `ackTo` on the
  wire always names the authenticated claiming relay, never the API origin.
- Degenerate cases: publisher adjacent to root (1-hop) → root's one-hop ack
  reaches it as the authenticated channel peer, today's behavior; publisher
  IS the terminus → local ingest, no flight; bridge as sole first hop → the
  bridge owns the flight as a bounded control record (the capability-aware
  terminal proxying the triumvirate direction already assigns to
  forward-only ingress); old first hop → marker passes one hop deeper, never
  into the publisher's id.
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
vectors for: NACK-relabeled-as-ACK, wrong endianness on epoch/attempt, wrong
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

## D2 — Attempt identity, chain budget, and terminal (Aster R2, R3, R9)

### The attempt identifier (Aster R9)

Delegation splits "who called `pub()`" from "who owns the flight," so the
delegate cannot, on its own, tell a fresh API call from an automatic retry of
an existing one — and two first hops could open two independent budgets for
one user action. The fix is an opaque **`attemptId`**:

- Minted ONCE, 16 random bytes, at the API boundary inside `peer.pub()` /
  `peer.kill()`, when the application makes the call.
- Retained across every automatic retry and re-dispatch of that same call —
  the publisher's retry loop reuses the identical `attemptId`, including when
  a retry selects a DIFFERENT first hop.
- NEVER regenerated by a promotion. A promotion inherits the attemptId of the
  flight it descends from.
- Carried in the `flightDelegate` marker, adopted by the claiming relay into
  the flight, and folded into both the chain key and the signed transcript
  (D1), so a proof is bound to the exact attempt.

### Chain key, generation, reset

One chain record per **`(topicId, msgId, op, attemptId)`**:

```
chain: { key: (topicId, msgId, op, attemptId), promotions, exhaustedAt }
CHAIN_MAX_PROMOTIONS      = 3      // promotions within one attempt at one delegate
ATTEMPT_MAX_PROMOTIONS    = 6      // hard aggregate across ALL delegates of one attempt
```

Reset is defined by the attemptId, which makes it unambiguous: a genuinely
fresh `peer.pub()` mints a NEW attemptId → a new chain → a fresh budget. An
automatic retry of the same call reuses the attemptId → the SAME chain →
exhaustion cannot be reset by retrying. Promotions inherit the attemptId, so
they can never mint a fresh budget.

**The multi-delegate bound (Aster R9).** Because an attempt with alternating
first hops can open a chain at more than one delegate, per-delegate budgets
alone do not bound the total. The attempt carries an aggregate promotion
count in its marker/flight state, incremented on every promotion at any
delegate and propagated on hand-off; any delegate that would exceed
`ATTEMPT_MAX_PROMOTIONS` records the terminal instead. A late frame carrying
an already-exhausted attemptId is dropped, not opened. This caps the total
promotions per user action regardless of how many first hops it touched.

### Terminal and sweep

At either cap the chain ends in ONE recorded terminal —
`write-flight-exhausted`, carrying the full key, the promotion path, and the
last verdict — and the automatic path opens no further flights for that
attemptId. Exhausted records expire after `EXHAUSTED_RECORD_TTL` (10 min,
matching the root-tombstone window); expiry is safe because the only openers
are `api` (a fresh attemptId, allowed) and `promotion` (which chains only
from a live flight, and carries the exhausted attemptId, which is dropped).

**Batched entries (Aster R3).** Each entry in a batched flight IS its own
`(topicId, msgId, op)` under the shared attemptId: promotion reopens
accounting for EVERY entry, each with its own budget and its own terminal.
No entry rides another's ledger.

`CHAIN_MAX_PROMOTIONS = 3` exceeds the plausible stale-candidate run after
one death (K=3 cohort); `ATTEMPT_MAX_PROMOTIONS = 6` allows one full retry
across a second delegate and no more. Both are constants the metrics surface
(`write-flight-exhausted` counts) will tune; changing them is not a design
change.

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
- **Attempt/reset (R9):** same-attempt retries (including via a different
  first hop) cannot reset an exhausted chain; a fresh `peer.pub()` can; an
  attempt alternating first hops terminates within `ATTEMPT_MAX_PROMOTIONS`;
  a promotion never mints a new attemptId.
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
