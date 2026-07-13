# Root Management — the RootClaim state machine

**Kernel:** `@axona/protocol` **4.20.1** (deployed on testnet 2026-07-13) ·
**Code:** `src/pubsub/rootClaim.js` (the machine), `src/pubsub/AxonaManager.js`
(the caller) · **Contract:** `INVARIANTS.md` I-1/I-2 ·
**Tests:** `test/smoke_root_claim.mjs` (decision table),
`test/smoke_root_reconcile.mjs` (convergence fabric)

This document is the authoritative description of how a topic gets — and
keeps — exactly one root in the Axona pub/sub kernel. It is written for both
human readers and AI assistants working on the kernel: every rule is stated
with its code anchor and the incident that motivated it. As of kernel 4.20.0
(refactor Phase 1), **all root-state changes flow through one module with one
transition function**, so this document describes one decision table, not
eight scattered mechanisms.

---

## 1. The model in one paragraph

Axona pub/sub is routing-only: every interaction is a message routed, hop by
hop, toward a 264-bit id. A topic's **root** is *emergent* — it is simply the
live node XOR-closest to the topic id, discovered by routing, never elected by
ballot. Any node can find itself acting as a root (a subscribe or publish
terminated at it), and any root can be wrong (a closer node exists that the
sender couldn't see). Root management is therefore not an election protocol;
it is a **convergence protocol**: wrong claims must yield to right ones,
quickly, without flapping, and without ever yielding to a node that is
farther away, dead, or departing.

## 2. States and transitions

A node's relationship to a topic is held in a per-topic `role` object
(created by `makeRole` in `rootClaim.js`) with a single authoritative bit:
`role.isRoot`. Three states:

```
                 (no role)
                  │      ▲
     become(why)  │      │  role torn down (refreshTick sweep:
                  ▼      │  no subscribers, no cache, no pins)
   ┌──────────────────────────────┐
   │            ROOT              │  serves the topic: stamps publishes,
   │  (isRoot = true)             │  caches, fans out, beacons, replicates
   └──────────────────────────────┘
        │                  ▲
demote  │                  │  promote            adoptChild(parent)
(to,why)│                  │  claimReachable      (no role) ──────────┐
        ▼                  │                                          ▼
   ┌──────────────────────────────┐
   │         CHILD RELAY          │  pinned upstream, renews toward the
   │  (isRoot = false)            │  root, re-fans deliveries downward
   └──────────────────────────────┘
```

Every arrow is a method on `RootClaim` (`src/pubsub/rootClaim.js`), and every
flip of `isRoot` passes through the single private transition function
`_set(role, isRoot, why, ctx)`, which emits one structured log:

```
pubsub:root-transition { topic, isRoot, why, to? }
```

The why-codes are the complete vocabulary of root-state changes:

| Transition | why-code | Trigger |
|---|---|---|
| `become` | `sub-terminal` | a routed SUBSCRIBE terminated here (no role yet) |
| `become` | `pub-terminal` | a routed PUBLISH terminated here |
| `become` | `kill-terminal` | a routed KILL terminated here |
| `become` | `metricson-terminal` | a routed METRICSON terminated here |
| `become` | `handoff-heir` | a departing root handed us its history |
| `become` | `reachable-fallback` | via `claimReachable` with no existing role |
| `promote` | `terminal-promote` | a non-root relay became the routing terminus |
| `demote` | `defer-terminal` | stranded terminal traffic deferred to a beaconed root |
| `demote` | `beacon-closer` | a beacon proved a strictly-closer live root |
| `demote` | `verify-closer` | root self-verification found a strictly-closer node |
| `demote` | `handoff-better-heir` | after a handoff, a closer live root (≠ leaver) exists |
| `claimReachable` | `reachable-fallback` | unconfirmed-deferral window expired; self closest reachable |
| `adoptChild` | `adopted-child` | an ADOPT delegated us a subscriber batch |

## 3. The decision table (guards)

Three guards decide every claim/yield question. They live on the machine, not
at the call sites, so a new rule is added **here** — never as a new check at
another flip site (the pre-4.20 pattern that produced the patch-interaction
bug class; see `Kernel-Refactor-Analysis-v0.1.md` §2A).

### 3.1 `liveCloserRoot(topic, {requireReachable})` — the defer gate

"Is there a live root, strictly closer to the topic than me, that I must not
contest?" Consulted before every claim (SUB/PUB/KILL/METRICSON terminals,
promotion, post-handoff). Returns the root's hex or `null`. The rules, in
order:

1. **No beacon, or expired** → `null`. Claims are only ever deferred to
   *advertised* roots; silence means the field is open.
2. **Beacon names self** → `null`.
3. **Not strictly closer (XOR) → `null`.** The cardinal rule (invariant I-2):
   *never defer to a farther node*, no matter how alive it looks. This is
   also a security property — a liar cannot divert traffic to a node farther
   than honest routing would pick (`_onRootBeacon` applies the same
   verify-don't-trust test before even caching a pointer).
4. Strictly closer — now liveness evidence is required, strongest first:
   - **`verified` pointer** → defer. Set only by root self-verification
     (§5.2), meaning an iterative network lookup confirmed this node is the
     terminus. Network-confirmed evidence; honored even where no beacon
     could reach.
   - **Channel-verified neighbour** (`_isReachableId`: the node is a direct,
     authenticated synaptome entry) → defer. When a root dies its channel
     drops, so this gate opens *instantly* on churn — backup promotion is
     never stalled by a stale beacon.
   - **Loose branch, only when `requireReachable:false`:** the beacon was
     heard within **1.5×BEACON_MS (30s)** → defer. A live root re-beacons
     every 20s, so a very recent beacon is strong liveness evidence even for
     a non-neighbour; a dead root's beacons go silent. Without this
     freshness cut a stranded publish ping-pongs toward a corpse until the
     full 50s beacon TTL (the pre-4.19 latent loop, reproduced in
     `smoke_root_reconcile` phase 4).

**Who uses which mode:** SUB, METRICSON, promotion, and post-handoff use the
strict default (`requireReachable:true`) — these *seat infrastructure*, so
they demand channel- or network-verified evidence. PUB and KILL use the loose
mode — a publish is one self-healing message and the looser gate is what
fixed cold-publish discovery (a cold publisher rarely has the true root as a
direct neighbour yet).

### 3.2 `meshBare()` — the alone-in-the-dark guard

True iff the node has **no non-bridge neighbours**. A freshly-joined node
subscribes before its mesh forms; its SUB never leaves the node, terminates
at self, and — with no beacons heard yet — it would mint itself "root."
Observed live (4.19.2): *every* joining subscriber created a transient root,
splitting the tree under churn. When the mesh is bare, a self-SUB terminal is
an artifact of isolation, not closeness: the seat is held
(`mySubscriptions` is already set) and the fast renewal re-runs the decision
once meshed. Publish-side is deliberately **not** gated — a genuinely solo
node still roots on its own publish and serves its local subscriber.

### 3.3 `selfClosestReachable(topic)` — the fallback qualifier

True iff self is XOR-closest to the topic among self plus **reachable**
neighbours (bridge excluded — signaling infra is never a root). Pure local
read. Used only by the reachable-root fallback (§4.4): the iterative lookup
may name a node closer in XOR, but if that node never adopts us it is
effectively unreachable, and a reachable root beats a closer-but-unconfirmed
one.

## 4. The transitions in detail

### 4.1 `become(topic, why)` — creation as root

The routing-terminal fallback. When a bare-topic message terminates at a node
holding no role for it (and the guards above allow), the node creates the
role **as root**: it is, by construction, the closest live node routing could
find. `become` also arms the early self-verification clock
(`formedAt`/`lastVerify` → first verify at 6s, §5.2) and immediately emits a
root beacon (`_announceRoot`), closing the cold-publish window where a
brand-new topic's location was unadvertised for up to 20s.

### 4.2 `promote(role, payload, meta)` — terminal promotion

A node that already relays the topic (non-root role) and is now the routing
terminus for its bare id becomes root — without this it would reroute
bare-topic publishes to itself forever. Guards: via-list empty, terminal,
not already root, **and no strictly-closer live root beaconing** (the defer
gate). That last guard is what broke the prod root-flap of 4.19.0: a
near-miss relay was beacon-demoted every ~20s but re-promoted on the next
stranded SUB, so two same-region relays traded the root forever. Promotion
inherits an active metrics lease (a METRICSON that passed through this node
resumes publishing) and re-arms early self-verification.

### 4.3 `demote(topic, toHex, why)` — yielding a claim

The only way a root stops being root while alive. Refuses to demote toward
self, no-ops if there is no live root claim. On a real demotion it does three
things **atomically as a policy** (the trio is the lesson of two incidents):

1. `isRoot = false` — stop stamping, stop beaconing "root=me".
2. Pin upstream to the winner — deliveries re-pin our subtree through it.
3. **Send a confirming SUBSCRIBE toward the winner.** Pinning alone leaves a
   one-sided link: we renew toward the new root, but until it *adopts* us as
   a downstream child its fan-out skips our entire subtree (observed as
   root `subs=0, cache>0` with a starving relay branch). Every demotion is
   therefore paired with the subscribe that makes the new root seat us.

Callers: the terminal defer (`defer-terminal`, which then forwards the
stranded message via-pinned to the winner), beacon demotion
(`beacon-closer`), self-verification (`verify-closer`), and the post-handoff
yield (`handoff-better-heir`).

### 4.4 `claimReachable(topic)` — the reachable-root fallback

A subscriber that stays **subscribed-but-unpinned** past the confirmation
window (`ROOT_CLAIM_MS` = 6s of renewals with no upstream adopting it) is
deferring to a node that never answers — typically an iterative-lookup hint
naming a closer-in-XOR but unreachable ("broken-but-authentic") node. If
`selfClosestReachable` also holds, the node claims the root locally rather
than deferring forever: **a reachable root beats a closer unreachable one.**
The claim clears the poisoned hint and the unattached clock. A
wrongly-claimed farther root self-corrects via beacon demotion — which is
exactly the asymmetry the system wants: claiming wrongly is cheap and
self-healing; deferring wrongly strands the topic.

### 4.5 `adoptChild(topic, parentHex)` — delegation

A relay over capacity (`MAX_DIRECT` = 20 direct subscribers) promotes one
subscriber to a child relay and hands it a batch (ADOPT). The receiver
becomes (or remains) a **non-root** child pinned to the parent, then
subscribes up toward it for the live feed. Widen-before-deepen: the tree
grows bushy (depth ≈ log₂₀ of subscriber count), not into a chain.

### 4.6 `handoffArrived(topic, leaverHex)` — departure rules

A gracefully-departing root pushes its cache+tombstones to an heir (HANDOFF,
resolved in parallel with an iterative-lookup fallback for thin tables — see
`pubsubLeaveHandoff`). When the handoff arrives, the heir has already
adopted the history as root (`become('handoff-heir')` if it had no role).
Then the machine applies the two departure rules, both bought by the 4.19.5
alert-bot incident:

1. **The leaver's beacon is a ghost the moment the handoff arrives** — purge
   it. Otherwise every defer gate keeps steering the topic at a corpse for
   up to the 50s TTL; heirs were observed adopting the history and
   *immediately demoting back toward the leaver*, undoing the handoff.
2. **Never defer back to the leaver.** If a strictly-closer live root exists
   that is *not* the leaver, yield to it (the inherited history rides up via
   the SUB's high-water → PULLUP). If the only closer candidate is the
   leaver, keep the claim.

The general form of rule 1 is `pubsubPeerDied(deadHex)`: when any peer's
channel closes — or it announces a graceful leave — every cached beacon
naming it is swept **and every upstream pin on it is dropped**, with the
pinned subscription's renewal clock reset so the very next tick re-homes
unpinned (4.20.1, from a validated external review: a corpse pin was never a
blackhole — the routed renewal is popped at the live terminal and re-seats —
but it kept `attached` true, letting an app subscriber's backed-off renewal
sit stale for up to 60s and gating off the reachable-root fallback).
Stranded traffic is never steered at a node that has left (invariant I-4:
*a peer that has left is silent* — and the network stops listening to its
echoes). Test: `smoke_upstream_rehome.mjs`.

## 5. The mechanisms that feed the machine

The machine decides; three surrounding mechanisms supply the evidence.

### 5.1 Root beacons — soft-state advertisement

Every root announces `{root: me, topics: […]}` to its `BEACON_FANOUT` (6)
XOR-closest neighbours, forwarded recursively `BEACON_LAYERS` (2) deep —
the topic's convergence basin, reach ≈ 6+36. Cadence `BEACON_MS` = 20s,
pointer TTL `BEACON_TTL_MS` = 50s, flood-deduped. Receivers apply
**verify-don't-trust**: a pointer is cached only if the named root is at
least as close to the topic as the receiver's best locally-known node — a
liar cannot divert traffic to a farther node. On receiving a beacon proving
a strictly-closer root, a wrong claimant demotes immediately
(`beacon-closer`), which also stops its own poisoning "root=me" beacons.
Beacons are also emitted immediately on becoming root (rate-limited to
BEACON_MS/2 per topic) so a fresh topic is advertised at once.

### 5.2 Root self-verification — reach-limited beacons' backstop

Beacon reconciliation only reaches the basin (fanout^layers). A spurious
root minted by a stranded SUB on a *fresh* topic can sit outside the true
root's basin and never hear the demotion — its via-pinned subscribers are
then permanently orphaned (observed on prod as binary 0-of-N delivery inside
an otherwise-perfect tree). So every root verifies its own claim with the
same iterative closest-node lookup subscribers use: once at
`ROOT_VERIFY_FIRST_MS` (6s) after forming — the fresh-topic race window —
then every `ROOT_VERIFY_MS` (45s), batched `ROOT_VERIFY_BATCH` (3) lookups
per tick and **never awaited inside the tick** (the 4.18.1 lesson: an
awaited lookup in the hot loop blocks all renewals). Finding a strictly
closer live node seeds a **`verified` root pointer** (TTL 2×45s) — the
strongest evidence tier in the defer gate — and demotes (`verify-closer`).

### 5.3 Backups and election-by-subscription

A singleton root (no child relays) replicates its full cache+tombstones to
its `ROOT_REPLICAS` (2) topic-closest cohort members every tick and eagerly
on every stamp/kill. Backups are **subscribing child relays**, not special
nodes: they renew toward the topic like any subscriber. On root churn there
is no bespoke promotion — the *same* probe-protected subscribe machinery
every subscriber uses (root-hint → iterative lookup → single
globally-closest terminus) elects exactly one new root: the closest backup
self-roots at the SUB terminal and the rest re-home under it, gap-free from
the warm cache. (The bespoke local-only promotion this replaced split roots
whenever two backups couldn't see each other — kernel 4.18.2.)

## 6. Timing model

| Constant | Value | Role in root management |
|---|---|---|
| `BEACON_MS` | 20s | root advertisement cadence; ×1.5 = corpse-freshness cut |
| `BEACON_TTL_MS` | 50s | inbound pointer validity |
| `BEACON_FANOUT` / `LAYERS` | 6 / 2 | basin reach ≈ 42 nodes |
| `ROOT_VERIFY_FIRST_MS` | 6s | first self-verify (fresh-topic race window) |
| `ROOT_VERIFY_MS` | 45s | steady-state self-verify cadence |
| `ROOT_CLAIM_MS` | 6s | unconfirmed-deferral window before `claimReachable` |
| `RENEW_FAST_MS` → `RENEW_MS` | 5s → 60s | adaptive renewal: fast while unpinned/re-homed, ×1.5 backoff while stable |
| `DROP_MS` | 180s | subscriber eviction after missed renewals |

Convergence intuition: a wrong claim inside the basin is corrected within
one beacon period (≤20s); outside the basin, within one verify period (≤6s
fresh, ≤45s steady); a claim deferring to an unreachable node self-resolves
in ~6s; a dead root's ghost influence ends at channel-close (instant for
neighbours, ≤30s for the loose gate, ≤50s worst case); a subscriber whose
NEIGHBOUR upstream dies re-homes on the next tick (≤5s; non-neighbour
upstream death heals at the next renewal via the reroute-and-re-pin path).

## 7. Invariants and their tests

- **I-1 — one root per topic; wrong claims converge without flapping.**
  Promotion is defer-gated; demotion always pairs with a confirming
  subscribe. `smoke_root_reconcile.mjs` (divergent-view fabric, 18 checks),
  `smoke_replica_fast_promote.mjs` (single-root election),
  `smoke_root_claim.mjs` (no re-take while a closer root beacons).
- **I-2 — never defer to a farther node, a ghost, or the leaver.** The
  strictly-closer test precedes all liveness evidence; ghost beacons are
  purged on death and handoff; the heir never yields to the departing node.
  `smoke_root_claim.mjs` (guard tiers, leaver rules),
  `smoke_leave_handoff_burst.mjs` (departure mechanics).
- **Observability:** every flip logs `root-transition` with a why-code —
  a root-election incident can now be reconstructed from one grep.

## 8. Guide for changes (humans and AIs)

- **All root-ness rules live in `src/pubsub/rootClaim.js`.** To change when
  a node claims, defers, or yields: edit a guard or transition there. Do
  **not** add an `isRoot` write or a new gate at a call site — that is the
  accretion pattern the 4.20.0 refactor removed. `grep 'isRoot ='` outside
  `rootClaim.js` should stay at zero.
- The machine holds no state: roles live in `manager.axonRoles`,
  beacons/upstream/hints on the manager (moving into a RootElection module
  in refactor Phase 2). The machine is the *authority*, not the store.
- New transitions must go through `_set` (one log per flip) and carry a
  why-code; add the code to the table in §2 and a case to
  `smoke_root_claim.mjs`.
- Standing policy (I-7): fixes must hold for 100%-transient peers. A rule
  that privileges stable/infrastructure nodes to mask churn will be
  rejected regardless of its benchmark numbers.

## 9. Worked examples

**Cold publish to a fresh topic.** Publisher routes PUB toward the bare
topic id → terminates at the closest node → `become('pub-terminal')` →
immediate beacon → the publisher's retry/burst machinery re-sends toward the
now-advertised root if the first walk stranded. The new root self-verifies
at 6s; if a closer node existed all along (divergent views), it demotes
(`verify-closer`) and pushes its cache up.

**Root churns abruptly.** Its channel drops → neighbours sweep its beacons
(`pubsubPeerDied`) → the defer gate opens instantly → the warm backup
closest to the topic hits the SUB terminal on its next fast renewal and
self-roots (`sub-terminal`/`terminal-promote`), serving history from the
replicated cache; other backups re-home under it.

**Root leaves gracefully.** `leave()` drains pendings on evidence, resolves
heirs for every rooted topic in parallel (iterative-lookup fallback for thin
tables), HANDOFFs cache+tombstones naming itself as leaver → each heir
adopts as root, purges the leaver's ghost beacon, never defers back to it.

**Isolated newcomer subscribes.** Mesh bare → the self-terminal SUB is
consumed without claiming; the seat is held; the 5s renewal re-runs the
election once the mesh forms and routes the SUB to the true root.

---
*History: consolidated in kernel 4.20.0 (refactor Phase 1,
`Kernel-Refactor-Analysis-v0.1.md`) from mechanisms introduced across
4.11.0 (replication), 4.17–4.18.2 (fallback + election-by-subscription),
4.19.0–4.19.2 (defer gates, self-verification, alone-in-the-dark), and
4.19.4–4.19.5 (departure rules). 4.20.1 added the dead-upstream pin sweep
(external-review finding). Re-version this document on the kernel release
that next changes root behavior.*
