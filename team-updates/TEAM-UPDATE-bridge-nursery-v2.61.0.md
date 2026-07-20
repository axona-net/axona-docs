# Team Update — Bridge bootstrap-nursery (bridge v2.61.0, testnet) — 2026-07-03

**Headline:** the signaling bridge no longer hands every joining peer the *entire*
peer-list. It now introduces each newcomer to a **bounded, curated, load-spread
anchor set**, and the peer self-expands into the rest of the mesh peer-to-peer.
This is a **decentralization / eclipse-resistance** improvement — no single set of
nodes is every newcomer's mandatory first contact. It's live on testnet as
**bridge v2.61.0** (kernel unchanged at 4.17.2; no wire or API change — peers are
unaffected).

This one had an honest arc worth reading, because the testnet deploy did exactly
what a staging deploy is supposed to do: it caught something the simulation
couldn't.

---

## Why

The bridge's job is *first contact* — it introduces a joining peer to the mesh,
then peers talk to each other directly over WebRTC. Previously it handed each
newcomer the full list of every connected peer, so (a) the same well-connected
nodes were everyone's initial neighbours — a concentration an adversary could sit
astride — and (b) the peer-to-peer signaling path was never exercised, because the
bridge did all the introducing.

The premise underneath the fix — **can two peers connect over the mesh with no
bridge at all?** — we proved cold first: an ironclad WebRTC harness forms a fresh
authenticated data channel between two peers that share no common neighbour with
the **bridge process killed**, signalling chained through ≥2 mesh relays. So
reaching the network never depends on any single introducer.

## What we built, and how we validated it

- **In simulation (dht-sim `results/w2`):** grew networks purely through bounded
  introductions under rejoin churn. Every newcomer reached **100% reachability**
  at ~85% of the god's-eye ceiling. A composite anchor-eligibility score (uptime +
  connectivity + an *outcome-based integration track record*) turned out to be a
  wash versus a random sponsor — **until** we added an **anti-concentration load
  penalty**, which cut anchor concentration hard (Gini **0.75 → 0.20**) *and*
  improved integration. The sim killed the naive "just use the top nodes" approach
  before it ever reached production.
- **On real WebRTC:** the multi-hop harness against the nursery bridge passed
  19/19 at the default anchor count — the mesh forms and stays healthily dense.

## The testnet catch (and the fix)

We shipped it (v2.60.0) and it **broke cross-region pub/sub** on testnet — one
direction went to 0% delivery. Root cause: testnet is tiny (**9 relays**), and
bounding to 8 anchors **dropped exactly one relay** — sometimes the specific relay
rooting a cross-region topic, which real cross-region connection setup couldn't
recover fast enough. We isolated it in minutes (the built-in off switch →
delivery back to 4/4), confirming the nursery was the cause.

The lesson: **bounding a network barely larger than the anchor count is all cost
and no benefit** — you drop critical nodes with no redundancy to absorb it. The
value of bounded introduction is at *scale*, which is exactly what the sim showed.

**The fix (v2.61.0):** a self-protecting **min-network-to-bound threshold**. The
bridge only bounds once the eligible pool is comfortably larger than the anchor
count (default ≥ 3×). Below that it hands the full list. So the nursery is now
**inert on small networks and auto-engages only at scale** — no manual flag to
remember, and cross-region convergence is safe.

## Current state

- **Live on testnet, bridge v2.61.0, nursery armed but inert** (9 relays is below
  the bounding threshold → the bridge hands the full list, i.e. behaves exactly as
  before for peer discovery). Cross-region pub/sub delivers 4/4 once the relay mesh
  is warm.
- One process note for whoever re-runs this: **live delivery on a just-restarted
  small backbone is noise-dominated** — across repeated samples, individual cells
  (even *intra*-region) flap between 0/4 and 4/4, with clean 4/4-across-the-board
  runs interleaved. This is the documented live-pub/sub flakiness at small scale
  with cold probe peers, unrelated to the nursery (which is inert here). Judge
  health from the *distribution* over multiple samples on a warm mesh, never a
  single cold sample — a lesson re-learned the hard way this session.
- Reversible (`BRIDGE_NURSERY=off`) and observable (`/healthz` nursery block:
  `on/k/minPool/intros/bounded/fellBack`).
- No wire or API change. Kernel stays 4.17.2. Production untouched.

## Honest caveat / what's next

Because testnet is well below the bounding threshold, it currently only confirms
the nursery does **no harm** — it can't exercise the *benefit*, which needs a
larger network. The benefit is validated in simulation; the live confirmation
(and the mesh-vs-bridge signaling-split measurement it enables) waits for the
network to grow past the threshold, or a deliberate scale test.
