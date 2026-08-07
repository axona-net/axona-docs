# axona.bot — Protocol Restructuring Assessment & Plan

**Author:** axona.bot (chief programmer — the peer that writes the kernel)
**Date:** 2026-08-07
**Status:** PROPOSED — for council cross-review (David's directive, #council seq 381)
**Scope:** `@axona/protocol` kernel (`axona-protocol/src`) as the primary subject;
relay / bridge / apps treated as consumers, touched only where they encode
protocol patterns. This is a migration plan, not authorization for a rewrite.

---

## 0. Where I stand, in one paragraph

I wrote most of this kernel and every one of the incident fixes the refactor is
now tempted to "clean up." That is the lens I bring: **the value of the current
code is the encoded incident knowledge**, not the code itself. So my plan is
close to Aster's — *extend the proven seams, characterize before you cut* — and I
reject the two places Orion's plan would trade working structure for a tidier
diagram. The debt is real and worth paying down, but the failure mode to fear is
not "files too big." It is **a beautiful rewrite that silently loses the
leave-order fix, the handoff-liveness gate, or the split-history union** — each of
which cost a diagnosed prod incident to learn. Refactor to make those rules
*legible and enforced in one place*, never to re-derive them.

---

## 1. Part 1 — Evidence and diagnosis (measured, not quoted)

### 1.1 The module inventory, by line count (measured 2026-08-07)

```
  4422  dht/AxonaPeer.js          ← god-object #1
  1220  pubsub/repairPlane.js  ┐
  1112  pubsub/AxonaManager.js ├─ god-object #2 (the pub/sub trio = 3271 lines)
   939  pubsub/wireHandlers.js ┘
  1179  transport/web/index.js     ← heavy but coherent (one concern: the wire)
  1061  transport/web/mesh.js
   ...
  ~22.4K lines total, 9 top-level modules
  (contracts, crypto, dht, identity, persistence, pow, pubsub, transport, utils)
```

The top-level module split is already clean. The debt is concentrated in **two
god-objects and one asymmetric dispatch surface** — nothing else in the tree is
structurally alarming. That focus matters: a refactor that churns all 22K lines
buys risk without buying much legibility. The two god-objects are the whole game.

- **`AxonaPeer.js` (4,422 lines)** is the façade that grew a body. It now owns
  lifecycle, join/integrate, persistence, the public pub/sub API, direct
  messaging, greedy routing + lookup, relay maintenance, metrics, and eventing.
  A newcomer cannot tell which of those owns a given field or timer.
- **The pub/sub trio (`repairPlane` + `AxonaManager` + `wireHandlers`)** mixes
  topic state, election, repair emission, wire handling, and sync in one
  prototype-composed cluster. Ownership and precedence are the hard part, not size.

### 1.2 What ALREADY shipped — the proven seams (this is the crux both peer plans get partly wrong)

Two consolidations already landed in the v0.2 refactor (Phase 6-8, kernel
≈4.26–4.29) and are running in prod today. Any plan that proposes to *build* them
is proposing to rebuild working code:

- **`rootClaim.js` (379 lines)** — the single transition authority for root
  placement. Every flip of `role.isRoot` goes through `_set()`; one structured
  log per flip. It already encodes the role model (see §2.1).
- **`syncEngine.js` (13 KB)** — a frozen, typed **7-policy table** already owns
  the repair verbs:
  `REPLAY_UP, SPLIT_UNION, EMPTY_ROOT_PROBE, COHORT_REPLICATE, UNION_AT_ROOT,
  HANDOFF, PUB_DURABLE` — each row carrying mode/verb/ledger/rate-bound.

These are the *exemplars* David is pointing at ("the earlier refactoring… a good
example for what we want to build"). The job is not to invent them. It is to make
their discipline **universal** — one owner, one named invariant, one wire
contract, one bounded effect — for the operations that still live as scattered
imperative code (dispatch, placement effects, the AxonaPeer façade body).

### 1.3 The failure modes the debt actually produced

The debt is not theoretical; it has a rap sheet, and each entry is a design lesson
the refactor must preserve, not erase:

- **GH #333 backbone collapse** — bulk role ingest on join blocked the event loop
  → mass eviction. *Lesson: unbounded work on a control path is a liveness bug.*
- **leave-order (4.32.0)** — notify-before-handoff killed every leave handoff.
  *Lesson: ordering of effects is load-bearing and must be explicit.*
- **handoff-liveness gap (4.31)** — a departing node planted standing state on a
  peer that couldn't maintain it. *Lesson: the Principal-Liveness rule (below).*
- **GH #44 TURN expiry** and **split-history cold-attach (4.22.0)** — individually
  correct mechanisms interacting badly. *Lesson: overlapping decision sites are
  where the bugs live.*

Every one was an **interaction between individually-correct mechanisms reached
from more than one path.** That is the true target of this refactor: reduce the
number of places a decision can be made, not the number of lines.

---

## 2. Two decisive findings from the code (where I settle the peer disagreement)

### 2.1 The role model is placement × orthogonal retention — and it already ships. Do NOT adopt a 4-exclusive-state FSM.

`rootClaim.js:38-39`, verbatim:

> *A role acts in exactly one PRIMARY nature — ROOT, BACKUP, or CHILD — plus an
> orthogonal HOLDER flag (hosted / app-subscribed retention).*

So the shipped, tested model is exactly Aster's:

```
placement ∈ { ROOT, CHILD, BACKUP }          (mutually exclusive; rootClaim owns transitions)
retention ⊆ { HOSTED, APP_SUBSCRIBED, HISTORY, METRICS_LEASE }   (orthogonal; a node may hold while being any placement)
```

Orion's proposed FSM with `ROOT/CHILD/BACKUP/HOLDER` as four **exclusive** states
is a **regression**: it cannot express "a root that also holds," which the
`host()` primitive (kernel 2.40.0) and every relay depend on. **Reject it.** The
refactor should make this two-dimensional model *explicit and enforced* — a
`placement`-lifecycle authority (generalized `rootClaim`) plus an orthogonal
retention set — never collapse it into one axis.

### 2.2 Wire dispatch: per-family contract registries in shadow mode. NOT one universal WirePatternEngine.

Orion proposes a single `WirePatternEngine` for every frame. I agree with Aster
that this is the wrong shape, and I can say why from the code: the frame families
have genuinely different obligations —

- **routed pub/sub control** (`route_msg`, `pullresp`, `ROOTBEACON`) — idempotency
  keyed on stamps, response correlation, placement-state guards;
- **transport hello/auth/session** — channel-binding, admission, replay windows;
- **WebRTC signalling / mesh-auth** — DTLS-fingerprint binding, no topic state;
- **bridge administration** — operator-token gated.

A single matcher for "every byte crossing every boundary" hides those
differences and becomes god-object #3. The right move is a **typed contract
registry per boundary, introduced in report/shadow mode** (validate + trace,
change no acceptance behavior), then migrate one family at a time. This is
Aster's Frame Contract Registry, and I endorse it as-is. My one addition: the
registry rows must be **symmetric** — the same row that validates an inbound
frame mints the outbound request — because the asymmetry between send and receive
is where "handled one side, forgot the other" bugs breed (that is the honest core
of Orion's "symmetry" instinct, kept without the god-engine).

---

## 3. Target structure

The organizing rule, applied everywhere, is the one the proven seams already
demonstrate:

> **One owner for each durable decision; one named invariant that permits the
> transition; one authoritative wire contract; one bounded, observable effect
> path. Every mechanism that plants remote state names its evictor in the same
> module.**

That last clause is the **Principal-Liveness Rule**, promoted from prose to a
structural law — it is the leave/handoff incident, generalized: standing state on
a remote node may only be planted by a principal alive to maintain it; a departing
node performs an acknowledged HANDOFF or does nothing.

### 3.1 Decompose god-object #1 (`AxonaPeer`) — behind an unchanged façade

`AxonaPeer` stays as the public API surface (`sub/pub/pull/connect/leave/
snapshot/…`) and becomes a thin composition of named services. No public
signature and no wire format changes during extraction:

- `PeerLifecycle` — start/stop/join/leave/readiness + **cancellation ownership**
  (every interval/listener has one owner and one teardown).
- `GreedyRouter` + `LookupService` — routing and α-parallel K-closest.
- `SynaptomeManager` — synapse lifecycle + `meshBoundCount()` (the live-channel
  count the 4.61.0 connect gate already depends on).
- `PeerMessaging` — direct-message API + event bridging.
- `PeerPersistence` — snapshot/restore + versioned envelope.

### 3.2 Make the proven seams universal (extend, do not recreate)

- Generalize `rootClaim` → **placement-lifecycle authority**: the sole site of
  placement transitions, publishing normalized outcomes. Per-topic data stays in
  the topic store; repair movement stays in `syncEngine`. It must not become a
  new god-object.
- Extend `syncEngine` → **sole owner of declared repair/state-transfer policies.**
  The 7 rows exist; the work is to route the *remaining* scattered repair
  emissions in `repairPlane` through it, one family at a time, each with a policy
  row (trigger, required state, peer relationship, payload contract, retry bound,
  terminal condition, metric). **Keep hot-path `DELIVER`/seat-replay OUT** unless
  a separate design moves it with its own latency/ordering proof — uniformity is
  not worth a delivery regression.

### 3.3 Documentation: separate the four artifacts

Rationale (why) ≠ normative contract (frames/states/guards) ≠ public API/deploy
reference ≠ conformance vectors. Maintain **one** canonical invariant catalogue
(`Axona-Architecture.tex §XII`, I-1…I-18 + S1–S6); everything else links to it.
INVARIANTS.md is already just a pointer — keep it that way.

---

## 4. Roadmap & deployment milestones

Sequenced so each phase is independently verifiable and revertible, and so the
**risky** structural change (placement + repair) comes *after* the harness that
can prove it didn't regress. This mirrors Aster's phasing; I've tightened the
ordering around the two god-objects and made every deploy point a testnet canary
with the same rollback discipline we just used for 4.60.1.

**Phase 0 — Characterization harness (no deploy).**
Golden traces for join/leave, root claim, split/merge, subscription renewal,
handoff, bridge-only bootstrap, duplicate/reorder/reject/teardown. A static
ownership map: every state field, timer, and frame type gets one proposed owner.
*Exit:* current behavior is captured as executable fixtures — the safety net that
makes every later cut falsifiable. **This is the single most important phase; it
is what turns "rewrite risk" into "regression test."**

**Phase 1 — Frame Contract Registry, shadow mode.** Per-boundary registries wrap
existing handlers; validate + trace; change no acceptance behavior. *Deploy:*
testnet telemetry-only canary; rollback = flag off, no protocol rollback.

**Phase 2 — `AxonaPeer` façade decomposition (§3.1).** Extract services behind the
unchanged façade; prove teardown leaves no orphan timers/listeners. *Deploy:*
testnet browser + bridge canary; 15-min mesh-liveness + memory-flat window;
rollback = prior composition.

**Phase 3 — Placement-lifecycle authority (§3.2, generalize `rootClaim`).** Route
all placement mutations through it; keep retention orthogonal; contract-guard
illegal transition/frame combos. *Deploy:* testnet protocol/relay canary under
churn + partition + reconnect; advance only on demonstrated convergence and no
unbounded repair loop.

**Phase 4 — `syncEngine` sole repair ownership (§3.2).** Migrate remaining repair
families into policy rows, one at a time; each with duplicate/reorder tests +
churn soak. *Deploy:* extended testnet soak; recurring flakes treated as defects.

**Phase 5 — Normative spec + conformance + production decision.** Publish the
registry as the normative wire contract with conformance vectors; mixed-version
gate. *Deploy:* progressive prod canary, **on David's approval** (he is the gate).

Version story: Phases 1-4 are `4.62.x`+ testnet increments (no wire breakage by
construction). Only a phase that intentionally changes a frame's semantics earns
a major bump, and only with a mixed-version compatibility proof.

---

## 5. Where I differ from my council peers (for the collator)

- **vs Orion:** reject the 4-exclusive-state role FSM (§2.1 — it regresses the
  shipped orthogonal model) and the single universal WirePatternEngine (§2.2 —
  per-family registries instead). Orion's "symmetry" instinct is right and I keep
  it as symmetric registry rows. Orion also frames SyncEngine/decomposition as
  greenfield; much of it already ships (§1.2).
- **vs Aster:** strong agreement. I add (a) the code citations that settle the two
  disagreements as facts, not preferences; (b) the explicit judgement that
  **Phase 0 characterization is the load-bearing phase**, because this codebase's
  worth is its incident scar tissue; (c) the Principal-Liveness Rule promoted to a
  structural law with "name your evictor in the same module" as the enforceable form.
- **Shared with both:** extend proven seams over rewrite; per-boundary contracts;
  testnet-canary every deploy; David is the deployment decision owner.

## 6. Council decisions requested

1. Ratify the **placement × orthogonal-retention** model as the target (reject the
   4-exclusive-state FSM), on the strength of `rootClaim.js:38-39`.
2. Ratify **per-boundary contract registries in shadow mode** over a single
   universal dispatcher, with **symmetric** rows (one row mints the request and
   validates the reply).
3. Confirm **Phase 0 characterization** is a required gate before any extraction.
4. Pick the collation owner and the concrete testnet health/convergence gates for
   each canary.

*Submitted to council by axona.bot.*
