# Team Update — Split-history reconciliation lands in production (kernel v4.22.1) — 2026-07-15

**Headline:** the last cold-attach residual from Howard's field cluster is
fixed, soaked, and promoted to production. Live across the whole fleet as
**kernel 4.22.1 · bridge 2.75.0 · relay 0.51.1 · peer 3.51.1 (site v0.93.0)**.
A subscriber that arrives *after* a topic changes root now recovers the topic's
**complete** history, not half of it. Testnet and production are identical
again.

---

## What shipped

### 4.22.0 — split-history union (the cold-attach fix)

When the node responsible for a topic (its *root*) changes — a root leaves, or
a better-placed node takes over — the cached timeline used to split in two: the
new root held the messages published *after* the handover, the demoted heir
held those from *before* it. A fresh subscriber arriving afterward and asking
for the full backlog (`since:'all'`) could be answered by only one side and
recover **half** the timeline. This was the residual isolated after Howard's
round-2 departure fixes (4.19.5) — the repro smoke recovered 6 of 12 messages
across a transition.

Two mechanisms reconcile the halves:

1. **Roots union-ingest replicated history.** A root receiving a `REPLICATE`
   from a peer now merges that history into its own cache (`_ingestStamped`)
   instead of treating replication as one-directional. The two halves converge.
2. **Subscribers pull the older half forward.** A subscriber advertises the
   oldest stamp it holds (`lw`, low-water) alongside its high-water mark. When
   a root sees a child holding history older than its own, it `PULLUP`s the
   child's full range. Nothing is left stranded on the losing side of a
   transition.

The reconciliation is **self-quenching**: once a node has unioned a peer's
range it does not re-request it.

### 4.22.1 — one-shot pull guard (availability hardening)

The `lw`-pull in 4.22.0 could re-fire every renewal when a child persistently
held history the root would not accept (a missed tombstone), producing a
repeated-pull storm and a beacon-closer↔terminal root-flap on testnet. The fix
records the lowest `lw` already pulled per subscriber (`role.pulledLw`) and
re-fires **only if that low-water mark decreases** — one pull per genuinely
older range, never a loop. This is what made it to production; 4.22.0 never
did.

## The gate

- **Repro suite** (`smoke_split_history_union.mjs`, 15 checks): split forms,
  kill-before-union non-resurrection, fresh `since:'all'` full-timeline replay,
  attached-subscriber heal, and the quench check — six renewal rounds re-fire
  **at most one** pull (30 PULLUPs on 4.22.0 → 0 with the guard). Previously
  6/12 recovered across a transition; now **12/12**.
- **Full kernel suite** green; the one stochastic 30%-loss kill-convergence
  check passes 5/5 in isolation (full-suite straggler, not a regression).
- **Howard axonSpec** (the field-workload gate): **11/11**.
- **Overnight soak** against testnet: a **flap-free backbone** (0
  root-transitions/30s), restart scenario **12/12 whenever it connected**, and
  **zero** recurrence of the 6/12 cold-attach signature. The soak's lower
  aggregate ok-rate traced entirely to the 1-vCPU testnet bridge dropping
  connection handshakes under the harness's synchronized bursts — the staggered
  connect fix recovered ~85% of those, and the residual failures were
  connection drops, not delivery failures. The kernel evidence (flap=0,
  restart 12/12, no cold-attach recurrence, no kernel errors) cleared the
  promotion independently.

## Verified in production

Both bridges report `kernelVersion: 4.22.1` at `/healthz` (bridge 2.75.0); the
9-relay backbone (3 droplets × 3 regions) runs relay 0.51.1 on kernel 4.22.1
with all units active; axona.net serves the vendored kernel 4.22.1; a live
publish → `since:'all'` replay round-trips 1/1 through the freshly-deployed
fleet. The relay tier matters especially for this release: relays are the
primary topic roots, which is exactly where the union-ingest and lw-pull
mechanisms run.

**Deploy hygiene fix found during promotion:** the prod relay droplets were
tracking the `testnet` branch rather than `main` (stale at 0.50.0/4.21.0 —
they had missed the point where testnet moved ahead). They now track `main`,
so future testnet-only work can never reach production relays through a stray
pull; promotion to the relay tier is explicitly `push testnet:main` + pull.

## Still open (non-gating)

- **alertbot `leave()` drain** is pinned near its 5s timeout (`leaveMs ~5040`)
  since 4.22.0 — a graceful-departure latency, not a correctness issue.
- Deferred: Phase 3 (AxonaPeer diet + transport unification), the ack-per-
  renewal lease design, and the W1c/W2 bootstrap-nursery threads.

---

*Live: kernel 4.22.1 · bridge 2.75.0 · relay 0.51.1 · peer 3.51.1 · site v0.93.0.*
