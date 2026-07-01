# Team Update — Axona kernel **v4.11.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** live on **testnet** — bridge v2.52.0, relay v0.37.0, peer v0.71.0.
**Production is untouched and still on 3.x.** Wire-compatible (WIRE 4.0, no flag day).

> A focused fix for the last open item from v4.10.1: **cold-start publish loss.**
> A message published in the first seconds after a node joins could strand and be
> lost. The fix turns a liability into leverage — instead of *waiting* for the node
> to warm up, we let its early publishes *do* the warming.

---

## TL;DR

1. **The problem.** A publish is routed toward a topic's address and held by the
   node closest to it. A freshly-joined node's routing table is too sparse to reach
   that node reliably, so its first publish strands at a wrong node — and a publish
   is **one-shot** (subscribers renew every few seconds; a publish never re-routes
   itself), so a cold-start strand = a silently lost message.
2. **The insight (why not just wait?).** We tried the obvious thing — hold `ready()`
   until the node is well-integrated before allowing a publish. It made things
   *worse*: it delayed and starved the node, because **outbound traffic is exactly
   what integrates a newcomer** (a node becomes reachable when its sends populate its
   neighbours' routing tables — the same lesson as directed churn-in warmup). Waiting
   removes the very thing that fixes the problem.
3. **The fix — cold-publish burst.** While a node is still cold (fewer than 8
   peers), `pub` re-sends the **same** signed envelope up to 5× over ~1 second.
   It's idempotent end-to-end (the root dedups by message id, so subscribers still
   see exactly one), each send both integrates the node *and* gets a fresh shot at
   the true root as the routing table converges, and it **self-disables** the instant
   the node is warm (a warm publish is a single send). The existing slow retry still
   backstops afterward.
4. **Result.** The live cross-peer suite went from ~85% cold-start delivery to
   **42/44 (95.5%)**, with node setup staying fast — the opposite of the
   wait-longer approach, which timed setup out entirely.

## What changed for builders

- **Nothing in your code.** No API, signature, or wire change — `pub` is the same
  call. Cold nodes just get their first messages through where they used to drop.
- The burst is internal and automatic; there are no knobs to set.
- **The publisher still gets no delivery ack** and learns nothing about where any
  subscriber is — the burst is fire-and-forget toward the topic address, exactly
  like a normal publish. Transport identity stays unlinked from author identity.

## Still open

- **Cold *kill* symmetry.** A retraction (`kill`) is a publish-with-a-side-effect,
  so in principle a cold kill could strand the same way; today it relies on the
  slower background retry. Extending the burst to `kill` is a candidate follow-up.

---

*Deployed 2026-07-01. Verify at `testnet.axona.net/healthz` (`kernelVersion: 4.11.0`).*
