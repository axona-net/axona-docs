# Connection quality under hold-or-improve (v0.6)

**Status:** council-agreed definition draft, revision 6 · **Date:** 2026-08-24 ·
**Kernel on testnet:** 4.64.0 · **Policy set by:** David ·
**Supersedes:** v0.5 (axona-docs `e96b67d`), v0.4 (`12dbe13`), v0.3
(`e8d6c96`), v0.2 (`6e508e4`), v0.1 (`1811fc9`), all left in place as record ·
**Revision driver (v0.6):** Aster `e4a753a5`, Orion `611ceaee`, Vega
`8a8705d8`, unanimous — v0.5's new paragraphs keyed watermark, pacing, and
guard on the 256-bit identity suffix while the passages they did not rewrite
still said "per origin nodeId." One key cannot be both. This revision is a
wording pass and nothing else: the identity suffix is now the named key in
every passage that keys state. Earlier drivers: v0.5 scope split (Aster
`7e3836a9`, Vega `333688fe`); v0.4 direct-receipt pacing (Aster `d8f26a6e`);
the two `ff709b85` remainders (closed at v0.3 / `91fbca4`); ten closure
findings, Vega `76a300b4`; reset requirement, Aster `ac99fe7f`.

**What changed from v0.5:** wording only, in "The reset record" — the
Generation paragraph, verification steps 3–4 and the success path, the relay
bound, and the matrix paragraph now key on the **identity** (the 256-bit
suffix, defined in "What the key is") wherever they keyed on "nodeId." No
rule changed; the sentences that contradicted the key were corrected to it.
Matrix unchanged at kernel `5ef81ef` — the harness already keyed by suffix.

This document defines terms. It changes no code, re-enables no mechanism, and
moves no gate. Deploy is David's.

---

## The question

When may a node give up a connection?

The kernel has answered this badly twice. With maintenance off, a dropped
connection has no replacement path, and degree bleeds to a degraded plateau —
in the sim, 37 down to 25 at N=38 over twelve cycles at two drops per node per
cycle, then flat. With maintenance on, the refill re-dialed candidates that
never bind, every tick, forever — the connection-count storm that got the
mechanism reverted at `6522f2f`. Off decays; on storms. The answer isn't a
better refill rate. The answer is a policy.

## The policy

A node never gives up a connection unless it holds a strictly better
replacement. David set this as the invariant, and it has two regimes:

- **Below the synaptome cap** there's always room, so there's never a reason to
  drop anyone. A node admits every distinct live peer it learns of. At small N
  the whole mesh converges to all-to-all and stays there. This is why the
  38-relay fleet holds flat at 34–35 under a cap of 50 — measured over 1.5 days
  of per-second logs, with the only zeros coming from host thrash and a version
  latch, not from decay.
- **At the cap** the table is full and stays full. The only permitted change is
  a swap: the weakest evictable edge leaves only when a strictly better
  candidate — better by a margin — is ready to take the slot. Occupancy pins at
  the cap. Quality can only go up.

Dead edges are exempt. A peer that fails liveness is gone whether we hold the
slot or not; the edge leaves through the liveness path and the slot refills
under the rules below.

**The invariant is one-sided, and the definition says so plainly.** (v0.2,
finding 1.) Hold-or-improve constrains what a node chooses to drop. It cannot
constrain what the far end chooses, and once inbound-only retention is rejected
(below), an eviction at either end tears the channel and the other end loses
the edge through liveness. An edge lives exactly as long as BOTH ends want it:
its lifetime is the minimum of the two valuations. What protects the holder is
not its own high rating — it's that the far end is bound by the same policy
and won't tear down without a strictly better replacement in hand. Asymmetry
in valuation is accepted; asymmetry in lifetime is not possible, and no clause
of this definition should be read as if it were.

## What quality is not

Quality is **not** a single scalar. All three council seats independently
rejected a blended score, because a scalar lets round-trip time cancel
structural need. The definition is a lexical order: structure decides first,
performance breaks ties.

Quality is **not** the benefit to the node holding the edge. It's the edge's
contribution to the mesh. A slow edge that is the only reach into a far region
of the keyspace outranks a fast edge that duplicates coverage the node already
has.

Quality is **not** measurable from a god's-eye view. Every term below is
computable by one node from its own table, its own probes, and its own traffic.

## Stratum granularity and the protection budget

(v0.2, finding 5.) v0.1 said "XOR stratum" without picking a granularity, and
the kernel has two: per-bit distance (`clz264`, up to 264 bands) and the anneal
layer's 4-band groups (`STRATA_GROUPS=4`, stratum >> 2). The two roles split:

- **Protection** operates on anneal groups. Per-bit protection at r ≥ 2 plus
  the successor quota can consume the whole table — and a table with no
  evictable set is a table where quality can never rise.
- **Ranking** (which band is denser, which candidate fills a sparser one)
  operates per-bit, where the resolution helps and nothing is pinned by it.

Every protected slot comes out of one budget, and the budget must close:

```
kNear + r × (protected sparse groups) + K_join + evictable_min ≤ cap
```

with `evictable_min` the guaranteed-evictable remainder that keeps improvement
possible. If the inequality fails at some N, protection coarsens — r drops on
the least-critical groups — before the evictable set is allowed to reach zero.
The matrix exercises the inequality; the constants are not fixed here.

## The definition

An edge's standing is decided in this order. Earlier clauses dominate later
ones outright.

### 1. Liveness — with a suspect state

A dead channel has no quality. It leaves immediately, outside the invariant.

(v0.2, finding 10.) "Dead," on a WebRTC transport, must not mean "missed one
heartbeat." Channels flap, and an immediate evict on flap feeds the very
machinery this definition builds — emergency refill, join lanes, dial caps —
turning one transient into a burst of signaling. Liveness determination
belongs to the transport layer and carries hysteresis: a peer that goes quiet
enters SUSPECT, gets probed for a grace window (proposed 5 s, a matrix
parameter), and only then is pronounced dead. The quality layer consumes the
transport's verdict; it does not race it.

### 2. Condition-based protection, re-verified at every decision

Two structural conditions protect an edge from eviction:

- the peer is inside the node's k-nearest successor quota (last-hop delivery),
  or
- the peer is one of the last **r** representatives of a sparse anneal group,
  with r at least 2 — protecting only the last one would let a single churn
  event black out a band until re-discovery, and re-discovery of a sparse band
  is the expensive path.

Protection here is a condition, not a grant. It is re-checked at the moment of
each eviction decision and self-expires the instant the condition stops
holding. There is no lease and no clock. A countdown lease on structural
protection would be worse than none: let the lease on a lone long-range edge
lapse and the policy itself re-creates the slice-world cut.

Nothing is grandfathered. An edge protected yesterday and unprotected today is
an ordinary edge today.

### 3. Admission at cap: id-derivable terms only

A candidate for admission has no history — no LTP weight, no RTT average, no
flap record. Any definition that scores candidates on history is uncomputable
at the only moment it's consulted. All three seats' first drafts had this flaw.

So admission at cap is decided entirely by what the candidate's id implies:

- which band the candidate fills, and how occupied that band already is,
- whether the candidate improves the successor quota,
- whether the candidate reduces a standing coverage deficit.

The swap rule: the victim is the lowest-ranked evictable edge in the most
over-represented band; the candidate is admitted only if it improves the
structural position — fills a sparser band than the victim occupies, or ties
the structure and clears the within-band margin on measured performance.

**Admission is bilateral, and "admissible" is not a local verb.** (v0.2,
finding 2.) Every clause in this section describes ONE node's acceptance
decision. A node that wants an edge can only dial; the far end runs its own
gate — its own cap, its own lane, its own improve comparison — and no state on
the dialing side, emergency or otherwise, compels a remote table open.

**Where the gate lives.** (v0.2, finding 7.) On every binding transport the
admission path is `_seedSynaptomeWithSponsor` (AxonaPeer.js:1581) — today a
direct insert with no cap check and no comparison. The compare-and-swap gate
this section defines is specified AT that entrypoint. A gate anywhere else
guards a door the traffic doesn't use.

By the way, restricting admission to id-derivable terms buys the strongest
anti-thrash property in the design for free: ids don't change, so structural
comparisons are deterministic. Thrash lives entirely in performance-driven
swaps, which is where the margin and residence rules apply.

### 4. Ranking incumbents: performance within a band

Among edges in the same band, measured history ranks them: vitality (LTP
weight and recency), stability (flap count), tail round-trip time. These terms
select the victim within a band and break structural ties. They never decide
admission.

The improvement margin (proposed at 25%, unfixed pending the matrix) applies
within a band only. Across bands the density comparison moves in
integer-squared cliffs, and a percentage margin means nothing against a cliff.

### 5. Transit as evidence, never immunity

An edge that forwards traffic into regions few other edges reach is carrying
mesh value, and the definition credits it — as a normalized, aged, capped
input to within-band rank. Raw transit count is not bridge proof: routing
prefers weighted edges, weighted edges gain more transit, and an unnormalized
counter rewards the hotspot it created. Transit evidence decays; it never
promotes an edge into protection.

## Dialing

(v0.2, findings 3 and 9.) v0.1 defined when edges leave and when candidates
are admitted, and said nothing about how dials go out. Two rules:

**One signaling budget, one in-flight cap.** Maintenance refill, join dialing,
and emergency refill are three reasons to dial; they share one WebRTC
signaling plane. Per node, at most `C_dial` connection negotiations are in
flight at once (proposed 2, a matrix parameter), across ALL dial sources. The
per-candidate attempt guard bounds attempts to one candidate over time; the
in-flight cap bounds concurrency across candidates at an instant. The
historical storm was the absence of both. When the join lane and emergency
refill open together — a partition heal, a fleet restart — the cap is what
keeps the offer/answer plane standing.

**Below cap, dial diversity-first.** Hold-all admits whoever binds, so at
N > cap a joiner that dials first-responders fills its table with them and can
then only swap on structure — first-contact bias pins a mediocre table. The
invariant governs drops, not dial order: a node below cap orders its dials
toward unrepresented bands. Same admission rule, better-chosen candidates.

## The liveness clauses

Per-edge scoring is not enough. These clauses are mandatory parts of the
definition; each exists because a per-edge review walked past a system-level
hole.

### Join lane

At cap, admission requires improving the acceptor's table — on both ends of
the new edge. A newcomer has no history and lands, from most peers' viewpoint,
in their most crowded band. In a mature mesh with every table full, the
newcomer loses every contest except where it happens to fill a gap. A policy
built to preserve connectivity would ossify the mesh against joins.

So joining runs through a lane the improve-gate doesn't guard: a small quota
of probation slots where a newcomer is admitted first and evaluated after a
grace period.

(v0.2, finding 4.) Two things v0.1 left open are now fixed:

- **The slots come out of the cap, not on top of it.** The operational table
  is `cap − K_join`; the lane slots are the remainder. v0.1 said "outside the
  cap," and that contradicts the scarce-resource argument this same document
  uses to reject inbound-only retention — the budget either bounds the
  transport or it doesn't.
- **"Newcomer" is a qualified identity, not whoever retries.** A lane
  admission requires qualification: a sponsor-attested join, or first-seen
  status with a cooldown, and one lane admission per id per window. Without
  qualification the lane is a Sybil door: N attackers times K_join slots on
  every saturated peer in the mesh. The qualification mechanism is specified
  with the lane, tested adversarially in the matrix, and no lane ships
  without it.

### Degree floor and emergency refill

Hold-or-improve bounds what a node drops. It says nothing about what a node
loses. Every inbound edge is some other node's evictable, and a node can obey
the policy perfectly while many peers independently evict it. The mesh-level
property that matters — no live node's total degree falls below a floor — is
not implied by the per-node policy and is stated here separately.

No single node can verify a mesh-level invariant from its own view, so
enforcement is local and evidence is global: each node watches a locally
observable proxy (its own total degree, in plus out), and when the proxy falls
below the floor, emergency refill engages.

(v0.2, finding 2.) Emergency refill is a DIAL policy on the node below the
floor: it dials any live peer it remembers, improve-gate not consulted, subject
to the attempt guard and the in-flight cap like every other dial. It is not an
admission override anywhere else. The far end evaluates the incoming attempt
through its own gate and its own lane. The floor is recovered because enough
remembered peers have room or lane slots — the matrix's correlated-eviction
scenario shows exactly this — never because distress compels capacity.

### Attempt guard, candidate reset, deficit backoff

Improvement pressure searches for candidates and dials the ones it finds.
Both motions need brakes, and both brakes need release valves.

**The candidate attempt guard**: per-candidate in-flight dedup, bounded retry
with backoff, expiry on bind or on exhaustion — for the known peer that won't
bind. Without it, the maintenance loop re-dials a never-binding successor at
maxPerTick every tick, forever — measured at kernel `c16d12b`, 3.0 probes per
tick sustained.

**Candidate-level reset.** (v0.2, unanimous requirement.) Expiry without a
release valve converts "slow to bind" into "excluded forever": a candidate
that exhausts its attempts and then comes up cleanly stays invisible. An
exhausted candidate becomes eligible again on exactly one trigger — a fresh
`presence` record signed by that candidate's own identity key, carrying a
generation higher than any the receiver has seen from it. The record is a
named protocol object; "The reset record" below is the governing text. A
replayed or duplicate record resets nothing and refills no attempt budget; a
reset grants one fresh budget, not a standing exemption. A bounded
revalidation epoch (rare, slow re-probes of expired candidates) is the
permitted fallback where no record arrives; its period is a matrix parameter.

**Deficit-level backoff**: a band whose searches repeatedly return nothing
gets exponentially rarer searches, reset when a routing record for that prefix
arrives — for the deficit no search can fill. Most bands are empty because
nobody occupies them, and a node cannot locally distinguish "unpopulated" from
"not yet discovered." The stratum reset and the candidate reset are separate
valves for separate brakes; the council record (`ac99fe7f`) is explicit that
the first does not substitute for the second.

### Bounded churn

Steady state is a target, not a promise. Measurements in a live mesh are not
stationary, so the design guarantees bounded churn — margin, minimum
residence, grace after admission, and a per-node swap-rate cap — and does not
claim swaps reach zero.

## The reset record

(v0.3.) Who may tell a node that a candidate it gave up on is worth trying
again?

Only the candidate. That's the whole design, and the rest of this section is
its consequences.

**What exists today.** The kernel has exactly one self-authenticated object: the
axona/4 handshake hello (`src/transport/handshake-auth.js`). A node proves its
nodeId by signing a canonical transcript `{proto, nodeId, pubkey, cbv}` with
its identity key; the verifier checks that the public key hashes to the
256-bit suffix of the nodeId and that the signature verifies. Every candidate
nomination the kernel carries — `triadic_introduce`, `hop_cache`,
`lateral_spread`, the `findKClosest` results — is an unsigned third-party
claim about someone else. That is the right design for nominations: the
B-3 rule already says a nomination is a candidate, never a table entry, and
first-party verification happens at bind. But it means no existing frame can
carry freshness. A third party saying "X is back" is exactly the message an
attacker would send to make the whole neighbourhood re-dial X.

**The record.** A new Boundary-5 frame, `dht:presence`, wire `presence`,
ONE_WAY notification, owning service SynaptomeLearning — the same door and
the same shape as `lateral_spread`, declared as a B5 registry row and bound
through `registerFrame` like every other DHT frame:

```
presence = {
  proto:  'axona/presence/1',
  nodeId: <66-hex, the origin's own id>,
  pubkey: <the origin's identity public key, hex>,
  gen:    <unsigned integer, see below>,
  nonce:  <16 random bytes, hex>,
  sig:    <Ed25519 over canonical({proto, nodeId, pubkey, gen, nonce})>
}
```

The transcript-and-signature scheme is the handshake's, reused unchanged: same
canonical encoding, same key, same binding check. A node that can verify a
handshake can verify a presence record with no new trust material.

**Generation.** `gen` is a per-identity counter. It starts at zero when the
identity is created and increments each time the node asserts presence: at
transport start, at transport restart, and when the node recovers from below
its degree floor. It is never persisted. A node that abandons its key by rule
— a stable id held across sessions is a correlator — starts its next session
as a new identity with a fresh watermark on every receiver, and cross-session
monotonicity is neither needed nor wanted. A node that keeps its key keeps
its identity, and a receiver's watermark for it carries on. (v0.6: the
watermark is keyed by the identity — the 256-bit suffix, see "What the key
is" — never by the full nodeId string.) `nonce` makes each record byte-unique
for dedup; `gen` is the freshness proof. Two records with the same gen are
the same record, whatever their nonces.

**Verification at the receiver**, in order, all local:

1. `pubkey` hashes to the 256-bit suffix of `nodeId` — the handshake's
   binding check, same function.
2. `sig` verifies over the canonical transcript under `pubkey`.
3. `gen` is strictly greater than the receiver's watermark for this identity
   — the record's 256-bit suffix, whatever prefix byte it arrived under.
   Equal or lower: the record is stale or a replay. It resets nothing and
   refills nothing, and the receiver does not update the watermark.

4. (v0.4.) **Pacing.** The receiver refills an identity's attempt budget at
   most once per identity per window (`T_refill`, a matrix parameter). A
   valid higher `gen` inside the window still advances the watermark —
   freshness is recorded — but refills nothing; it is coalesced into the
   refill the window already granted.

On success the receiver sets the identity's watermark to `gen` and, if the
window allows, clears that identity's attempt-guard entry — one fresh budget
of `maxAttempts`, nothing more. If the receiver holds no guard entry for that
identity the record updates the watermark and does nothing else.

Step 4 is the bound the other three don't give you. Steps 1–3 stop anyone
else from speaking for the origin; they do not stop the origin from speaking
too often. A node restarting in a loop mints a valid higher `gen` at every
restart and sends it straight to its neighbours — no relay, no relay limiter.
Without step 4 each restart clears a fresh budget on every neighbour, and the
neighbourhood dials a flapping node at its restart rate. With step 4 the
origin can advance its watermark as often as it likes and buy one budget per
window for it. A presence record is **not** a
nomination: it never inserts a synapse, never carries an address, and never
bypasses admission. The next contact still goes through the dial, the
handshake, and the gate.

**One object, two valves.** A verified presence record is also proof that the
band containing `nodeId` is populated. It therefore resets deficit backoff for
that band on the receiver, the same way any fresh routing record for the
prefix would. The council record (`ac99fe7f`) is explicit that the stratum
reset does not substitute for the candidate reset; the converse is fine — the
candidate's own record can serve both.

**The bind is the strongest record.** A successful axona/4 handshake with a
nodeId is fresher than any presence record could be, and the guard already
clears on bind. The presence record exists for the case where the candidate
cannot be the one to dial — the receiver gave up, and the candidate does not
know it is wanted.

**How far it travels.** The origin sends `presence` to its current
neighbours — its own synaptome — when `gen` increments. A receiver relays it
at most one hop, to its own neighbours, rate-limited per origin identity per
window; never further. Two hops is the neighbourhood hold-or-improve already
reasons about for candidate sourcing, and it is the neighbourhood most likely
to hold a stale exclusion for a node that flapped. Relays forward the record
unchanged; the signature covers the origin, and a relay that rewrote it would
fail verification at the next hop. The relay limiter governs the relayed
copy; direct receipt is governed by the receiver's pacing step, so both paths
into a receiver are bounded at the receiver.

**Scope: two paths, two bounds.** (v0.5.) A node that restarts can do one of
two things, and the definition treats them differently on purpose.

It can come back with the same key. Then it has the same identity and, if a
receiver had given up on it, the same exhausted guard entry — and the presence
record is exactly the valve built for it: one refill per window, watermark
monotonic, by any path. Everything above governs this case.

Or it can come back with a new key. Then it is a new identity. The receiver
holds no guard entry for it, so its presence record clears nothing — the old
nodeId's exclusion stands untouched, and the new nodeId's record only sets a
fresh watermark of its own. The new identity is a newcomer. Its probe budget is
one fresh per-candidate budget through the ordinary nomination path; its
admission is the join lane's problem, and the lane's bounds — reserve-from-cap,
qualification, one admission per id per window, the Sybil arm — are the
bounds that apply. Presence has no part in it.

So "an origin restarting in a loop" is two threats, each already bounded:
same key, bounded by pacing; new key, bounded by the lane and the fresh-budget
cost of being nobody. What the definition refuses is to join them — to key
the guard, the watermark, or the pacing on anything that survives a key
change. The only such thing a node has is its author identity, and binding
routing state to that is the cross-session correlator the protocol rejects.
The council's call on record (Aster `7e3836a9`, Vega `333688fe`): identity
keying, nothing more persistent.

**What the key is.** (v0.5.) A nodeId is eight bits of geo prefix followed
by the 256-bit SHA-256 of the public key (`src/identity/nodeid.js`), and the
handshake's binding check enforces it. A node cannot change its nodeId
without changing its key — except for the prefix byte, which it can vary at
will, 256 ways, under one key. So the watermark, the pacing window, and the
attempt guard key on the **256-bit identity suffix**, not the 264-bit string.
A record from the same key under a different prefix is a record from the same
identity: a replayed gen is still stale, a higher gen inside the window is
still coalesced. Keying on the suffix costs nothing in privacy — the suffix
is the key, and the key is already what the handshake reveals — and it closes
the one churn an origin can perform for free.

**Why it cannot restart the storm.** Five bounds, each local:

- Only the origin's key can mint a record for the origin's nodeId. A third
  party cannot make a neighbourhood re-probe a victim.
- A receiver refills an origin's budget at most once per window, however
  many valid gens arrive, by whatever path. (v0.4.)
- A refill is one `maxAttempts` budget, and the dials that spend it still run
  under the per-node in-flight cap.
- An origin that keeps failing to bind after a reset is back to exhausted
  after `maxAttempts`; the soonest it can be refilled again is the next
  window.
- Relay depth is one. A record's reach is the origin's two-hop neighbourhood,
  not the mesh.

**What the matrix asserts.** Scenario 2b at kernel test commit `24b0842` and
after: a candidate fails to expiry, becomes bindable, stays excluded, a
record with gen=7 restores it and the edge binds, a replay of gen=7 resets
nothing, and the watermark is monotonic across resets (reset on 5, duplicate
5 rejected while still expired, 6 accepted). Scenario 2c at `e4b0edc` (v0.4):
a control with no pacing shows 30 valid increasing gens produce 30 refills —
the hole, pinned; the paced run on the real kernel node floods a never-binding
origin with 30 valid gens and bounds refills to ⌈elapsed / T_refill⌉ + 1,
bounds dials toward that origin to refills × `maxAttempts`, and still carries
the watermark to gen 30 with a replay of 30 resetting nothing. Scenario 2d
(v0.5): after a candidate is exhausted, four successive fresh identities —
new key each — send presence and are nominated through the real path
(`_considerCandidate`); each clears nothing for the old candidate, which stays
expired at its three attempts; each gets exactly one newcomer budget, three
dials, and expires; four identities cost twelve dials. And a prefix variant of
the old candidate's id keys to the same identity: a replayed gen under the
variant is stale, a higher gen inside the window is coalesced, and the
watermark reads the same through either id.

The guard model takes `(identity, gen)` and nothing else — the harness
normalizes a 66-hex nodeId to its 256-bit suffix in every guard method, the
same key the definition names. The signature and pubkey-to-nodeId binding
checks are the handshake's; they are covered by the transport auth smokes and
are not exercised by this matrix. A reviewer who
wants the record verified end to end needs the frame implemented, and that is
held.

**What this section does not do.** It does not add the frame to the kernel.
A new frame kind is a wire addition and goes through the E-series discipline:
a B5 registry row, the ownership fence, a wire-version note. That is
implementation, and it is held.

## Asymmetry

Quality is directional; lifetime is not. Node A may rate the edge to B highly
while B rates the reverse edge low — and if B evicts, the channel tears, and
A's edge leaves through liveness regardless of A's rating. The bilateral-
lifetime statement in the policy section is the governing text.

What the definition rejects is inbound-only retention — keeping the transport
channel alive after evicting the edge from the routing table. On the web
transport the scarce resource is the connection itself: data channels,
heartbeats, browser limits. A channel kept outside the budget defeats the
budget. Loss of reciprocal capability decays the edge through the liveness
path. This stands rejected unless someone prices it.

## An alternative worth an arm

(v0.2, from the second read.) The definition assumes the shipped shape:
periodic maintenance plus `findKClosest` discovery. There is another shape —
event-driven refill only: no timer search at all; on a peer death, dial
replacements from a small remembered cache of recent peers and two-hop
neighbours. That shape removes the empty-band search storm instead of
backstopping it. Its known cost: a deficit that arises without a drop event —
a cold join, a partition heal — never triggers a refill, so it heals nothing
it didn't watch break. The matrix carries it as an arm, measuring both the
saving and the cost, before anyone writes the searcher back.

## What this definition does not establish

It does not prove O(log N) routing. A per-node score cannot; the claim is
earned by topology tests — reachability, path stretch, last-hop success —
under sparse, partitioned, and asymmetric conditions.

It does not fix constants. Margin, grace, residence, floor, lane size and
qualification window, dial cap, backoff base, suspect window, revalidation
epoch, refill window: proposals go to the delay/failure matrix, and the
matrix decides.

It does not identify the historical `6522f2f` trigger. The isolated test at
kernel `c16d12b` reproduces a boundedness failure under an injected never-bind
candidate; the injection is motivated by web-transport negotiation behavior
and is not proven to be what Howard's suite hit. That proof needs the live
testnet.

## Where the code stands

The kernel does not implement this definition. The gaps, by file and line at
4.64.0:

- `AxonaPeer.js:1581` `_seedSynaptomeWithSponsor` — the admission path every
  binding transport takes — is a direct insert: no cap check, no comparison,
  no eviction. The compare-and-swap gate is specified at this entrypoint.
- `NeuronNode.js:95` `canPrune` — the sole-band survival rule — exists in
  source and is dead code. Nothing calls it. This definition enforces it,
  widened to r ≥ 2 on anneal groups.
- `DHTNode.js:201–211` `_trySwapIn` — the benchmark engine's stratum-count
  Pareto guard — is the same gate this definition puts at admission, already
  written, in the wrong layer.
- `AxonaPeer.js:3452` `_vitality` — LTP weight times recency — is the
  within-band rank term, already live.
- `src/dht/boundary5Registry.js` — where `dht:presence` would be declared as
  a row beside `lateral_spread`; `src/transport/handshake-auth.js` — the
  transcript, signing, and pubkey-to-nodeId binding the record reuses. Neither
  is touched by this definition.

The matrix's lane model (kernel test commit `91fbca4`) exercises the
first-seen-plus-cooldown qualification path. The sponsor-attested path is
defined above and not yet exercised; it enters the matrix with the
implementation that defines the attestation.

## Verification

The delay/failure matrix asserts, per scenario, both halves of each guarantee —
the bound and the recovery:

| Scenario | Bound asserted | Recovery asserted |
|---|---|---|
| slow-then-bind candidate | per-candidate attempt cap | edge forms once bindable |
| fail-then-bind candidate | backoff held through failures | edge forms after failures stop |
| permanent-fail candidate | attempts expire, stop | node redirects budget elsewhere |
| expire-then-late-bind (2b) | exclusion holds; stale record resets nothing | fresh `presence` record restores eligibility; edge binds |
| presence flood from a flapping origin (2c) | refills ≤ ⌈elapsed / T_refill⌉ + 1 over 30 valid gens; dials toward the origin ≤ refills × maxAttempts | watermark still reaches the latest gen — pacing drops refills, never freshness |
| fresh identities after exhaustion (2d) | N new keys cost N × maxAttempts; the old candidate's exclusion never reopens; a prefix variant keys to the same identity | each fresh identity gets its one newcomer budget through the real nomination path |
| newcomer joins saturated mesh | lane slots inside the cap — no acceptor over cap or original budget; rate-limited; one admission per id | newcomer reaches working degree |
| Sybil burst at the lane | 12 fresh ids win at most K_join slots on an acceptor; acceptor stays within cap | — (a bound-only scenario; the point is what does not happen) |
| correlated inbound eviction | swap-rate cap holds; no remote compulsion | victim recovers to degree floor via lanes |
| both doors open at once | shared in-flight cap C_dial holds | join and refill both complete |
| seed-path gate | occupancy pinned at cap at `_seedSynaptomeWithSponsor` | structural improvers still admitted |
| empty-band pressure | deficit backoff engages | search resumes on fresh routing record |
| event-driven arm | zero searches | drop-driven deficits heal; cold deficits measured as the cost |

A run that shows the bound without the recovery, or the recovery without the
bound, fails. The seed-path scenario also pins today's gap: the current kernel
admits over cap through the seed path, and the matrix records that as the
before-state the gate must close.
