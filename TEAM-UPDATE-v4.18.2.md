# Team Update — Single-root election on churn (kernel v4.18.2, testnet) — 2026-07-04

**Headline:** when the node serving a topic leaves the mesh, the topic now keeps
**exactly one** root — so publications and kills survive churn. This closes the
bug behind Howard's intermittent "missing pubs and kills" on the CivilDefense /
axonSpec restart suite. It's live on testnet as **kernel v4.18.2**. Testnet only;
**production is untouched** (still on the 3.x line — this rides a wire-4 major).

This one had an honest arc, and most of the value is in the arc — including two
wrong turns and a deploy slip we caught and reverted. Worth reading.

---

## The symptom

Howard's regression suite has a `restart` phase: a subscriber politely
disconnects and rejoins, then everyone should still receive every publish — and
every *kill* (tombstone). On testnet it failed **bimodally**: most runs clean,
but ~1-in-2-to-5 runs dropped the entire restart + restart-after-kill block. A
publish or a kill would reach some subscribers and not others.

We'd spent several rounds tuning a **promotion timer** (`REPLICA_GONE_MS`, tried
8s → 15s → 65s) on the theory that a backup was promoting *too eagerly* over a
still-alive root. None of the values fixed it. That was the tell: **it isn't a
timing race.**

## The actual cause

When a topic's root departs, it has warm **backup** replicas standing by (they
prefetch the full history so takeover is gap-free). Each backup decided *on its
own* whether to promote, using a **purely local** check: "am I the closest node
to this topic among the neighbours I can see?"

Two backups that can't see each other in their local neighbour tables **both**
answer yes — and both promote. The topic now has **two disjoint roots**. A
subsequent publish or kill lands on one; subscribers renewing against the other
never see it. Split brain.

The credit here is the user's: the diagnosis crystallised on the question *"if the
root leaves, are the two remaining nodes even aware of each other? They both think
they should be promoted, correct?"* — which is exactly right, and exactly what the
code did.

## The fix

We deleted the bespoke, locally-decided promotion path entirely. A backup is now
just an **ordinary subscribing relay**: it renews toward the topic every cycle,
so when the root leaves, the replacement is chosen by the **same election every
subscriber already uses** — an *iterative closest-node lookup* that hops the mesh
and resolves to a single globally-closest terminus.

The closest survivor becomes the sole root and serves the history it had
prefetched (gap-free); the others re-home underneath it. Two replicas can no
longer both "win," because the decision is confirmed **against the mesh**, not
against each node's partial local view. The whole `REPLICA_GONE_MS` /
`REPLICA_STALE_MS` timing machinery is gone — promotion timing was never the lever.

## How we validated it

- **Deterministic:** a rewritten `smoke_replica_fast_promote` builds a real
  9-node routing fabric, kills the root, and asserts **exactly one** surviving
  root, that it's the closest survivor, that it took over with the full cache, and
  that a late `since:'all'` subscriber recovers everything. 7/7. Full kernel
  `npm test` green.
- **Live:** the axonSpec restart + kill suite, **8/8** clean on the testnet
  backbone — versus the bimodal 1-2/5 on every 4.17.x build.

## Two wrong turns worth sharing

**1. Don't `await` a network lookup inside a hot loop.** The first shipped
attempt (4.18.1) also tried to harden a *second*, rarer self-root path by awaiting
an iterative lookup inline in the per-tick refresh loop. On the deterministic
smoke the lookup is instant; on the live network it's a real round-trip, and
awaiting it **blocked every other topic's renewal** — which *manufactured* the
very strands it was meant to prevent. Live went **3/8**. Reverted immediately;
back to a clean 4/8-ish under load, then 8/8 quiesced (below).

**2. The soak was confounding our own gate.** Every live measurement until the
end ran with the overnight stress soak hammering the same 9-relay backbone on an
undersized droplet. Same 4.18 kernel: **3/8 with the soak running, 8/8 with it
paused.** The concurrent load was manufacturing ICE-flap / mesh-thinning failures
that look just like a split. Lesson going forward: **the live axonSpec gate is
only trustworthy on a quiesced mesh** — don't judge a churn fix against a
saturated network.

And one deploy slip, in the interest of a clean record: during the ship we
reflexively pushed the kernel + peer to `main` as well as `testnet`. `main` is the
**production** line (kernel 3.8.0, wire-3), and 4.x is a wire-major that would
break prod front-ends against the wire-3 prod bridges. Caught within a minute and
force-reverted `main` to its prior prod commits; **prod bridges were never
touched.** The 4.x line stays testnet-only until the gated flag day.

## What's live (testnet)

- **kernel 4.18.2** — bridge `testnet.axona.net` (app v2.63.0, `/healthz`
  confirms), 9-relay backbone (relay v0.46.0), peer app v3.46.3 / index v0.81.0,
  demo `demo-testnet.axona.net` (v4.18.2, demo v1.21.0).
- Tag `v4.18.2` pushed; SECURITY-CHANGELOG updated; overnight soak restarted on
  4.18.2.
- **Production unchanged** (3.x). No wire or API change *within* the 4.x line —
  4.17.x testnet peers keep working.

## Still open

There's a third, rarer self-root path (the subscriber-side reachable-root
fallback) that still uses the local-only closeness check. It's a narrow tail —
the common relay-hosted case is fixed — and we've deferred it deliberately rather
than repeat wrong-turn #1. If the overnight soak surfaces it, we'll do it *right*:
a **non-blocking** async probe (kick the lookup, act on the cached result next
tick), never an inline await.

---

*Kernel v4.18.2 · testnet · 2026-07-04. Prod remains on 3.x pending the gated
wire-major promotion.*
