# Write-Flight Ack Routing and Chain Budget — remediation design

**Status:** design proposal v0.3 — Aster's R1–R4 (seq 481) and R5–R6 (seq 494) incorporated; for council clearance before any code
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

## D0 — Who owns a flight (Aster R6)

The v0.2 draft claimed publisher-location privacy was unchanged while putting
the flight owner's transport id in the PUB frame. Aster's R6 breaks that
claim with one case: when an application calls `peer.pub()`, the node that
opens `_forwardToRoot` IS the publishing transport — and the same frame
carries the durable author envelope. `ackTo` then hands every hop on the
route an author-to-transport correlator, which is precisely what I-9 forbids
a PUB to carry. Calling that node a forwarder does not change what it is.

The resolution is structural (Aster's path *a*): **an API-origin node never
owns a carried flight.**

- An API-origin PUB/KILL is dispatched with a `flightDelegate` marker and NO
  `ackTo`. The publisher's node opens no flight for it.
- The FIRST RELAY HOP that forwards the marked frame strips the marker, opens
  the flight, and stamps its OWN transport id as `ackTo`. From that hop
  onward the frame is indistinguishable from any relay-origin write, and the
  id it carries names a third-party relay — the author-to-origin-transport
  linkage never enters the route.
- Degenerate cases: if the publisher is adjacent to the root (1-hop), the
  root's one-hop ack reaches it as the authenticated channel peer — today's
  behavior, hop-local, exposed to nobody new. If the publisher IS the
  terminus, ingest is local and no flight exists. If the only first hop is
  the BRIDGE, the bridge owns the flight: a bounded control-plane record, not
  a topic role — the same capability-aware terminal proxying the ratified
  triumvirate direction already assigns to forward-only ingress.
- Relay-origin writes (promotion re-sends, relay ingress forwards) own their
  flights directly as before: a relay's transport id next to a client's
  author envelope links the author to the RELAY's location, not the
  publisher's, and relay ids are public routing material.
- The publisher's own confirmation remains what I-9 always made it:
  observation. The publisher gains no acknowledgment channel; what it gains
  is that the mesh's own write-liveness machinery now works on its behalf
  from one hop out.

Paths *b* (opaque return capability) and *c* (amend I-9) are recorded as
rejected for this round: *b* adds a pending-table lookup on the hot path to
hide an id that delegation removes outright, and *c* spends an invariant to
avoid a one-bit marker. Either re-opens if delegation proves unimplementable
in Phase-0 characterization.

## D1 — The ack routes to the flight owner, as signed end-to-end evidence

The PUB/KILL frame a flight OWNER dispatches (per D0: a relay, never an
API-origin publisher) carries:

```
ackTo:       <flight owner's transport id, hex>
flightNonce: <random per flight generation>
```

At the root, the ingest ack becomes an **ACK PROOF** routed to `ackTo`,
signed over a normative transcript (Aster R5):

```
transcript = "AXONA_INGEST_ACK_PROOF_V1" ‖ purpose ‖
             len32(topicId) ‖ topicId ‖
             len32(msgId)   ‖ msgId   ‖
             u8(op)         ‖ u64(epoch) ‖
             len32(ackTo)   ‖ ackTo   ‖
             len32(flightNonce) ‖ flightNonce ‖
             len32(rootPub) ‖ rootPub

INGESTACK { topicId, msgId, op, epoch, ackTo, flightNonce, rootPub,
            sig = Ed25519(rootTransportKey, transcript) }
```

The domain separator is mandatory and version-carrying: a valid signature
from any other transport or control context can never be reinterpreted as
ingest evidence, and a future transcript change is a new version string, not
a silent re-layout. Every field is length-prefixed or fixed-width; the
verifier rebuilds the transcript from the received fields and rejects
non-canonical encodings — length prefixes that disagree with field sizes,
ids outside their fixed widths (topicId/msgId/ackTo are protocol-width hex,
op is one byte from the closed PUB/KILL set, epoch is u64, flightNonce ≤ 32
bytes, rootPub is a 32-byte Ed25519 key) — BEFORE signature verification.
Oversize frames die at the existing inbound caps.

**Why a signature (Aster R1).** A routed ack arrives at the owner from the
LAST HOP of the ack's route — the authenticated channel peer is a relay, not
the root. Hop identity can no longer bind completion, and relaxing the
binding would let any relay fabricate an exoneration — reintroducing the
half-alive blackhole through the side door. The proof restores the binding
end to end: the owner verifies `sig` against `rootPub`, derives the node id
from `rootPub` and requires it to equal the flight's expected authority
(`AuthorityRef`: rootHex, and epoch when VERSIONED), and requires
`(topicId, msgId, op, ackTo, flightNonce)` to match the open flight. An
UNVERSIONED flight still accepts only the addressed node's proof — now
signed, which is strictly stronger than 4.62.1's first-ack rule. A proof
replayed from an earlier flight or generation dies on `flightNonce`; a proof
minted by anyone but the addressed root dies on the pubkey-to-nodeId
derivation. Receipt probes and their INGESTACK/RECEIPTNACK responses carry
the same fields with the same transcript and verification.

**Compat.** `ackTo` absent and no `flightDelegate` marker (a 4.62.1-or-older
sender): the root acks one hop back, unsigned, exactly as today — old
behavior for old senders, degraded but never worse. An unsigned ack arriving
at a flight owner completes a flight only under the 4.62.1 rule (adjacent
authenticated sender = expected root), which remains correct on the 1-hop
routes where it ever worked. An old FIRST HOP that ignores the
`flightDelegate` marker forwards it untouched; the next 4.62.2 hop claims
the flight — the delegation degrades one hop deeper, never into the
publisher's id.

**What `ackTo` exposes, stated plainly.** With D0 in force the id on the
wire always names a RELAY. On-path observers learn that this relay opened a
write flight for this topic — routing material they already handle. The
author-to-publisher-transport correlator that R6 identified never exists on
the wire, and the required test (D3) proves it at the frame level.

**Misdirection (Aster R1).** An on-path relay that alters `ackTo` redirects
proofs, and one that drops frames silences them; neither forges completion —
the signature covers `ackTo`, so a receiver that is not the named `ackTo`
discards the proof, and the true owner's flight simply starves. Integrity is
end-to-end; availability on a hostile path is not — the same relay could
drop the PUB itself. What bounds the damage is D2: starvation now ends in a
recorded terminal, never a storm.

## D2 — A promotion chain has a budget and a terminal, per correlation key

The flight owner keeps one chain record per **`(topicId, msgId, op)`**
(Aster R2 — the correlation key the registry already uses; a PUB chain and a
KILL chain for the same message are different writes):

```
chain: { key: (topicId, msgId, op), generation, promotions, exhaustedAt }
CHAIN_MAX_PROMOTIONS = 3
```

Eviction's retry-promotion increments `promotions`. At the cap, the chain
ends in ONE recorded terminal — `write-flight-exhausted`, carrying the key,
generation, promotion path, and last verdict — and the automatic path opens
no further flights for that key.

**Generation and reset (Aster R2).** Flights record their origin: `api` (a
fresh `peer.pub()` / `peer.kill()` call — which under D0 delegates, so the
generation lives at the delegate) or `promotion`. Only an `api`-origin
dispatch resets an exhausted chain — it increments `generation`, mints a new
`flightNonce`, and starts a fresh budget. Promotions and internal retries can
NEVER reopen an exhausted chain, including after sweep: exhausted records
expire after `EXHAUSTED_RECORD_TTL` (10 min, matching the root-tombstone
window), and expiry is safe because the only paths that open flights are
`api` (allowed anyway) and `promotion` (which chains only from a live
flight, and none exists).

**Batched entries (Aster R3).** A flight carries an entries map, and the
4.62.1 promotion path re-sends every entry while reopening a flight for only
the first — the remainder would ride unbudgeted. In this design each entry
IS a correlation key: promotion reopens accounting for EVERY entry, each
under its own `(topicId, msgId, op)` chain, each with its own bounded budget
and its own recorded terminal. No entry rides another entry's ledger.

Three promotions is a starting value, not a law: it must exceed the
plausible run of stale candidates after one real death (the K=3 cohort), and
anything it gets wrong shows up as `write-flight-exhausted` counts, which
the metrics surface carries. Tuning it is a constants change, not a design
change.

## D3 — The test class that let this ship cannot exist

Every path that passed a gate was 1-hop: MockNet dispatches direct by
construction; the live gates ran on a dense settled mesh; the one live
promotion went to self.

- MockNet gains a **multi-hop mode**: `sendDirect` routes through N
  intermediate managers, so `meta.fromId` at the terminus is an intermediate
  node, exactly as live. The mode is a constructor flag; existing tests are
  untouched.
- `smoke_write_flight_multihop.mjs`: red on 4.62.1 by reproducing the deaf
  ack and the A↔B oscillation; green under D0+D1+D2 — a signed proof
  reaches the delegate across 2 hops, and a write with evidence wedged shut
  ends in `write-flight-exhausted` after exactly `CHAIN_MAX_PROMOTIONS`
  promotions per entry.
- **Local-origin privacy test (Aster R6):** an API-origin publish through a
  multi-hop route is captured at every hop; the test asserts the frame
  leaving the PUBLISHER carries the `flightDelegate` marker and NO transport
  id naming the publisher, that the first relay's claim stamps its own id,
  and that no frame on the route ever pairs the author identity with the
  origin transport id. The delegate-death path is covered: the first hop
  dies mid-flight, the publisher's observation-side confirm fails, an
  app-level retry re-delegates through a new first hop.
- **Adversarial matrix (Aster R4 + R5)**: a malicious intermediate relay
  minting an unsigned ack (must not complete a multi-hop flight); a forged
  proof under a wrong key (pubkey-to-nodeId mismatch — must not complete);
  an altered `ackTo` (proof discarded by the wrong receiver, true flight
  exhausts, terminal recorded); a wrong-epoch proof (VERSIONED flight must
  not complete); a replayed proof from a prior generation (dies on
  `flightNonce`); a non-canonical transcript encoding (rejected before
  verification); a valid signature from a different context replayed as an
  ack (dies on the domain separator); the mixed-version fallback (old root,
  unsigned one-hop ack: completes 1-hop flights, exhausts multi-hop flights
  cleanly; old first hop passes delegation one hop deeper).
- TESTNET-PROTOCOL gains a **non-adjacent live gate**: publish through a
  forwarder whose synaptome excludes the topic root, so the route is
  provably ≥2 hops. The 4.62.1 gates measured the mechanism only where
  adjacency made the defect invisible; this gate removes the luck.

## What this design deliberately does not do

- No beacon-starvation mechanism. The epoch-0 flights under storm were a
  symptom: with D1 the proofs arrive, flights complete, and beacons flow.
  UNVERSIONED remains the correct mixed-mesh compat state. If a post-fix
  soak still shows blind flights at rest, that is a new finding with its own
  design round.
- No change to the 4 killed-message-resurrected events yet. The suspect is
  promotion churn re-seating roots past their tombstones; D2 removes the
  churn that produced them. Their acceptance status is explicit in the gate
  below (Aster R4); they stay open on #51 until retired or reproduced.
- No wire version bump. `ackTo`, `flightNonce`, and the `flightDelegate`
  marker are additive optional fields; old receivers ignore them, old
  senders omit them, and the fallbacks preserve 4.62.1 behavior bit for bit
  on 1-hop routes.

## Rollout and acceptance

Kernel `4.62.2` candidate, testnet only, full ritual (suite + new multi-hop,
privacy, and adversarial smokes + fence, relay re-vendor gate, bridge pin,
droplet, both fleet rolls — each gate on David's word). Mixed-mesh note:
until a fleet is fully rolled, an OLD root still acks one hop back, so a
multi-hop flight against it can exhaust — the chain budget converts what was
an eternal storm into a bounded, recorded failure, and the fleet roll
removes it.

Acceptance is the instrument that caught the defect, with the blockers named
(Aster R4):

1. Full overnight soak on the rolled testnet against the 4.61.x cumulative
   baseline (93.6%).
2. **Zero `killed-message-resurrected` events — a single recurrence is a
   release blocker and opens its own design round; it does not pass under
   the aggregate.**
3. SIGKILL gates rerun, including the new non-adjacent gate.
4. Zero `root-evicted` at rest.
5. The local-origin privacy assertion (D3) green in the suite AND spot-checked
   on the live testnet capture path.

The 4.62.1 gate numbers taught what a settled-mesh pass is worth; the soak
decides.
