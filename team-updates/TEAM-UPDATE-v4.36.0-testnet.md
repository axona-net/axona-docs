# Team Update — The read half is done: reads survive a degraded neighbor (2026-07-22, testnet)

**TL;DR: the last couple percent of the cross-region alert-bot loss — the
"write landed, read didn't" residual — is now fixed in the kernel. A subscriber
whose topic-closest node is *alive but not serving* (overloaded / stalled) now
pulls the history straight from the cohort's healthy replicas instead of waiting
forever on the one degraded node. This is the read-side mirror of the eager
cohort write, and it's the gate we've been holding prod promotion on.**

---

## The gap this closes

We'd already shipped two of the three read-recovery cases:

- **v4.32.0** — a graceful leaver hands off its history *before* announcing it's gone.
- **v4.33.0** — a reader recovers past a neighbor that *died* (left the mesh): routing
  re-terminates at a surviving cohort member, which serves the replay.

The residual the loss curve kept showing was neither. It's a node that is **still
alive, still a mesh member, and still XOR-closest to the topic** — but not
serving (overloaded, ingest-stalled, event-loop-wedged). Because it's still the
closest node, every read that routes toward the topic terminates *at* it and
dies in the black hole; because it's still a mesh neighbor, nothing purges it as
a ghost; and because it isn't the reader itself, the reachable-root self-claim
can't fire. A subscriber farther from the topic than that node had no path to the
history the cohort backups were holding one hop away.

We reproduced it deterministically (`test/smoke_read_repair.mjs`): a degraded-but-
alive topic-closest node + a reader farther than it → **0 of 5 messages recovered**.

## The fix

Once a subscriber has waited past the confirmation window without being seated,
and it is not itself the closest reachable node, it pulls the history **directly
from the K nearest reachable cohort replicas** — skipping the unresponsive
closest node it's pinned to — into a non-root holder, and delivers to the app.

- **Read-side mirror of the write half.** Every publish already fans to the
  K-closest cohort; now a read draws from that same cohort instead of depending
  on the single closest node being healthy.
- **No root split.** The recovery copy is explicitly *non-root* — it never claims
  the topic, so it can't fork it (the reluctant-root failure mode we rejected
  earlier is avoided by construction).
- **Bounded + self-quieting.** Rate-limited, capped attempts; if the primary
  recovers, the normal renewal re-homes the reader onto it and the recovery goes
  quiet. Reuses the existing verified REPLAYUP → union-ingest → delivery path, so
  no new wire message and the same signature/dedup/tombstone guarantees apply.

Result on the repro: **0/5 → 5/5**, across five different keyspace placements.
`smoke_ghost_read` (the v4.33.0 case) stays green; full kernel suite green.

## What's deployed (testnet)

| Component | Version |
|---|---|
| Kernel `@axona/protocol` | **4.36.0** |
| Relay / Peer / demo | re-vendored to 4.36.0 |
| Bridge | re-pinned to 4.36.0 |

Production stays on 4.29.0. **4.36.0 is the read-half that closes the promotion
gate** — once it soaks clean on testnet, the 4.31→4.36 line (leave-order +
departing-replica handoff + both read-recovery cases) is ready to promote to
prod together.

## For Howard

The alert-bot's residual failures (the last ~2% that more relays and staggered
subscribes couldn't remove) were this exact class: the publish reached the
cohort, but a fresh cross-region read landed on a slow/degraded holder and got
nothing. On 4.36.0 that read should now recover from a healthy cohort replica.
A rerun of your 0x80 cross-region run against the testnet fleet (now on 4.36.0)
is the live confirmation — expect the zero-delivery topics to drop toward zero.
