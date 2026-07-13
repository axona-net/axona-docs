# Kernel Refactor Analysis & Proposal — v0.1

**Date:** 2026-07-11 · **Subject:** `@axona/protocol` kernel, primarily
`src/pubsub/AxonaManager.js` and `src/dht/AxonaPeer.js` · **Line:** 4.19.5
**Thesis:** the kernel is functionally strong and empirically validated, but a
month of incident-driven patching has left the same few concepts implemented
five-to-seven overlapping times. The complexity is now the primary source of
new bugs (three of the last four incidents were patches interacting with
earlier patches). This proposes a phased, behavior-preserving consolidation —
not a rewrite.

---

## 1. Evidence of accretion

| Metric | AxonaManager.js | AxonaPeer.js |
|---|---|---|
| Lines | 2,208 | 4,228 |
| Commits since May 1 | **90** | **86** |
| Kernel releases touching it since June 15 | 30 | — |
| Instance-level Maps/Sets (mutable state surface) | **19** | — |
| Tunable module constants | **37** | — |
| Sites that read/write root-ness (`isRoot`, become/promote/defer/verify) | **41** | — |

The June-15→July-11 commit log reads as one continuous incident loop on a
single subsystem: replication → promotion timing (three experiments in two
days) → split-brain election → cross-region self-root → reconciliation →
self-verification → alone-in-the-dark → departure handoff. Each patch was
individually justified and tested; collectively they encode **one design
question answered eight different ways**.

The decisive signal: **recent bugs are patch-interaction bugs.** The 4.19.5
incident's worst defect was the 4.19.1 defer logic undoing the 4.8.4 handoff.
The 4.19.3 no-exit hazard was introduced by the 4.19.3 fix itself (unref'd
drain). When new defects are primarily caused by old fixes, the structure —
not the ideas — is the bottleneck.

## 2. The redundancy catalog

Grouped by the single concept each cluster is circling.

### A. "Who is the root, and how does a wrong claim converge?" — ~8 mechanisms
1. Auto-root at routed terminal (`_becomeRoot` fallback in SUB/PUB/KILL/METRICSON)
2. `_maybePromoteRoot` (terminal promotion of an existing role)
3. Beacon demotion (`_onRootBeacon` strictly-closer rule)
4. Defer gates (`_liveCloserRoot` at every terminal site — 4.19.0)
5. Root self-verification (periodic iterative lookup — 4.19.1)
6. Alone-in-the-dark guard (unmeshed self-SUB hold — 4.19.2)
7. Handoff adopt-then-maybe-defer + leaver exception + ghost-beacon purge (4.8.4 → 4.19.5)
8. Backup-as-subscribing-child election (4.18.2, replacing the timer experiments 4.17.0–4.17.4)

`role.isRoot` is flipped in ~8 distinct places. There is **no single transition
function** — so every incident adds a guard at *another* flip site, and no one
can enumerate the legal transitions by reading one screen of code.

### B. "Move/repair topic data" — ~7 mechanisms
Fan-out to subscribers · eager cohort replication · anti-entropy union-ingest ·
replay-up (PULLUP on hw) · graceful-leave handoff · pull early-answer from
nearest replica · replay-on-subscribe (`since` floors + self-replay). Several
carry their own dedup, their own tombstone threading, and their own trigger
cadence. The kill-leak class existed precisely because one path (of seven)
didn't thread tombstones.

### C. "Where do I think the root is / who is alive?" — ~6 signals
Root-hint cache (two freshness regimes) · background local findKClosest with
iterative-lookup escape · beacons (cadence, TTL, fan-out, forward depth, seen-
dedup, `verified` flag) · `_isReachableId` (neighbor membership) · `_deadPeers`
set · `_unattachedSince` fast re-resolve. Plus, one layer down, the bridge's
idle/stall model. There is no unified liveness/where-is model; each mechanism
consults a different subset, which is exactly how ghost-beacon bugs happen.

### D. Retry/scheduling — 5 loops
refreshTick renewal (fast/slow) · pendingPub/pendingKill confirmation retries ·
burst timers (cold-publish) · root-verify cadence · beacon cadence. One tick
function interleaves most of them; teardown must remember them all (the 4.19.4
incident: it didn't).

### E. Structural debts
- **AxonaPeer is a god object** (4,228 lines): inline dht adapter, lifecycle,
  mesh-signal relay, persistence, maintenance timer, delivery dispatch, join
  variants.
- **Two transports** (Howard's standing critique): constructor-supplied vs the
  bridge's `node.transport` monkey-patch, papered over with `??` fallbacks.
- **37 constants**, several from concluded experiments; incident notes live as
  long inline comments (great archaeology, poor navigability).

## 3. What must not be lost

- **The regression suite** — 120 test files, most derived from real incidents,
  including the divergent-view fabric, the leave-teardown suite, the handoff
  mechanics suite, and Howard's axonSpec gate. This is the refactor's safety
  net and it is genuinely good.
- **The invariants we paid for** (each has a matching test):
  1. A topic has exactly one root; wrong claims converge without flapping.
  2. Never defer a claim to a farther node, a ghost, or the node handing off.
  3. A recovery path never waits unboundedly on the thing it recovers.
  4. A peer that has left is silent; its rooted history is handed off first.
  5. A client is never judged by time the server wasn't listening.
  6. Observability surfaces exist or fail loudly — never silently zero.
  7. Fixes must hold for 100%-transient peers (no stable-node privilege).
- **Wire compatibility discipline.** Everything below is behavior-preserving;
  no flag day at any phase.

## 4. Proposal — five phases, each independently shippable

**Method for every phase:** extract/consolidate with the public API unchanged;
the full suite + axonSpec gate + one testnet soak must pass **identically**
before the next phase starts. One phase per release. The v3.12 lesson
(a clean-break rewrite silently dropped `inspectRoles` and the metrics plane
for months) rules out any big-bang: *refactor under test, never rewrite.*

### Phase 0 — Characterize & document (S)
Write `INVARIANTS.md` (the list above, each linked to its enforcing test).
Audit the 37 constants: mark live / experiment-residue / dead; delete dead
code paths from the concluded promotion-timer experiments. Add missing direct
tests for any mechanism only covered incidentally. *Output: a frozen,
documented behavioral contract.*

### Phase 1 — The RootClaim state machine (M) — highest payoff
Extract one module owning **every** `isRoot` transition:
`claim(reason) / defer(to, reason) / demote(to, reason) / handoff(from)` —
a single transition function with all eight mechanisms' rules as **guards in
one decision table**, and a single structured log line per transition. All 41
current touchpoints call it. Redundant guards become visibly redundant and are
deleted with the suite as arbiter. *This is where the patch-interaction bug
class dies.*

### Phase 2 — Split AxonaManager along its real seams (M–L)
Four internal modules behind the existing façade (no consumer changes):
- **TopicStore** — cache, tombstones, seq/hw, dedup (one implementation).
- **RootElection** — Phase 1's machine + beacons + hints + liveness, i.e. all
  of catalog C feeding one "where is the root" answer.
- **RepairPlane** — catalog B unified into one `reconcile(topic)` engine with
  one scheduler owning every retry loop (catalog D) and one teardown.
- **WireHandlers** — thin, validating dispatch onto the three above.

### Phase 3 — AxonaPeer diet + transport unification (M)
Extract the inline dht adapter, the lifecycle (start/stop/leave/join) module,
and the mesh-signal relay into files. Make the bridge construct its transport
the same way every peer does (retiring Howard's two-transports debt and the
`??` fallbacks).

### Phase 4 — Config & docs rationalization (S)
37 constants → a small number of named policy groups (election, repair,
liveness, limits) with documented units and interactions; incident-comment
archaeology moved to a `DECISIONS.md` log with links from short code comments.

**Sequencing & effort:** P0 ~1 day · P1 ~2–3 days · P2 ~3–4 days · P3 ~2 days
· P4 ~1 day, each followed by a testnet soak. Independently valuable — the
program can pause after any phase. Recommended external acceptance at P1 and
P2: Howard's alert-bot run, which currently exercises exactly the seams being
consolidated.

## 5. What this is not

Not a rewrite, not a redesign of the protocol, and not a license to change
behavior "while we're in there." Open behavioral work (the fresh-subscriber
cold-attach class, transient-root capture churn) stays on the punch list and
gets *easier* after Phase 1–2, because it will land in one decision table
instead of an eighth patch site.

---

## Status ledger (updated 2026-07-13)

- **Phase 0 — DONE** (kernel 4.19.6): INVARIANTS.md (9 invariants → tests),
  constants audit, dead-code removal (4 clusters + 2 tests).
- **Phase 1 — DONE** (kernel 4.20.0): rootClaim.js state machine — every
  isRoot flip through one transition function with why-codes; decision-table
  smoke (27 checks). 4.20.1 added the dead-upstream pin sweep (external
  review). Docs: Root-Management-v4.20.1.md.
- **Phase 2 — DONE** (kernel 4.21.0): the manager split along its seams —
  constants.js / ids.js / topicStore.js / rootElection.js / repairPlane.js /
  wireHandlers.js behind the unchanged AxonaManager façade (methods relocated
  verbatim as prototype mixins; state stays on the façade; every external
  touchpoint preserved). Largest file now 700 lines (was 2,208).
  Note: the deeper RepairPlane ambition (unify burst timers into the one
  scheduler) is gated BEHAVIOR work, deliberately not done in this phase.
- **Next:** Phase 3 (AxonaPeer diet + two-transports unification), Phase 4
  (constants → policy objects — constants.js already stages this). Flake
  stabilization (kernel handoff smoke + dht-sim bimodal delivery) remains on
  the list; Phase 2's gates passed first-try this cycle.
