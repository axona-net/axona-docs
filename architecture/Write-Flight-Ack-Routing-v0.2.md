# Write-Flight Ack Routing and Chain Budget — remediation design

**Status:** design proposal v0.2 — Aster's R1–R4 (council seq 481) incorporated; for council clearance before any code
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

## D1 — The ack routes to the flight owner, as signed end-to-end evidence

The PUB/KILL frame a flight owner dispatches gains two fields:

```
ackTo:       <flight owner's transport id, hex>
flightNonce: <random per flight generation>
```

At the root, the ingest ack becomes an **ACK PROOF** routed to `ackTo`:

```
INGESTACK {
  topicId, msgId, op, epoch, ackTo, flightNonce,
  rootPub,                     // the root's transport public key
  sig                          // Ed25519 over canonical(all fields above)
}
```

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
the same fields with the same verification.

**Compat.** `ackTo` absent (a 4.62.1-or-older sender): the root acks one hop
back, unsigned, exactly as today — old behavior for old senders, degraded
but never worse. An unsigned ack arriving at a flight owner completes a
flight only under the 4.62.1 rule (adjacent authenticated sender = expected
root), which remains correct on the 1-hop routes where it ever worked.

**Privacy, corrected (Aster R1).** In a multi-hop route today, each hop sees
its adjacent peers; a literal `ackTo` shows every hop on the write's path the
ORIGIN forwarder's transport id — a new bounded exposure, and this design
accepts it explicitly rather than hiding it: the exposed id is an ephemeral
transport identity (fresh every restart, I-15), it is already public routing
material in beacons and lookups, it names the FORWARDER and never the
publisher (no author identity, I-9 intact), and what an on-path observer
learns — "this node originated a write flight for this topic" — is less than
what the same observer learns from carrying the PUB itself. An opaque return
capability was considered and rejected for this round: it adds a pending
table and a lookup on the hot path to hide an id that routing already
publishes. If transport ids ever stop being public routing material, this
trade re-opens.

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
fresh `peer.pub()` / `peer.kill()` call) or `promotion`. Only an `api`-origin
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
  ack and the A↔B oscillation; green under D1+D2 — a signed proof reaches
  the owner across 2 hops, and a write with evidence wedged shut ends in
  `write-flight-exhausted` after exactly `CHAIN_MAX_PROMOTIONS` promotions
  per entry.
- **Adversarial matrix (Aster R4)**, in the same smoke or a sibling: a
  malicious intermediate relay minting an unsigned ack (must not complete a
  multi-hop flight); a forged proof under a wrong key (pubkey-to-nodeId
  mismatch — must not complete); an altered `ackTo` (proof discarded by the
  wrong receiver, true flight exhausts, terminal recorded); a wrong-epoch
  proof (VERSIONED flight must not complete); a replayed proof from a prior
  generation (dies on `flightNonce`); the mixed-version fallback (old root,
  unsigned one-hop ack: completes 1-hop flights, exhausts multi-hop flights
  cleanly).
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
- No wire version bump. `ackTo`/`flightNonce` are additive optional fields;
  old receivers ignore them, old senders omit them, and the fallback
  preserves 4.62.1 behavior bit for bit on 1-hop routes.

## Rollout and acceptance

Kernel `4.62.2` candidate, testnet only, full ritual (suite + new multi-hop
and adversarial smokes + fence, relay re-vendor gate, bridge pin, droplet,
both fleet rolls — each gate on David's word). Mixed-mesh note: until a
fleet is fully rolled, an OLD root still acks one hop back, so a multi-hop
flight against it can exhaust — the chain budget converts what was an
eternal storm into a bounded, recorded failure, and the fleet roll removes
it.

Acceptance is the instrument that caught the defect, with the blockers named
(Aster R4):

1. Full overnight soak on the rolled testnet against the 4.61.x cumulative
   baseline (93.6%).
2. **Zero `killed-message-resurrected` events — a single recurrence is a
   release blocker and opens its own design round; it does not pass under
   the aggregate.**
3. SIGKILL gates rerun, including the new non-adjacent gate.
4. Zero `root-evicted` at rest.

The 4.62.1 gate numbers taught what a settled-mesh pass is worth; the soak
decides.
