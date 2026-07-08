# Team Update — Root reconciliation: killing the root flap (kernel v4.19.0 + v4.19.1, testnet + production) — 2026-07-08

**Headline:** the production relay backbone was silently splitting topics
between competing roots — the two relays closest to a topic traded its root
**every ~20 seconds**, and subscribers/publishers landed on opposite sides of
the split. Two kernel releases in one day fix the mechanism: v4.19.0 stops
stranded traffic from minting competing roots, and v4.19.1 makes every root
periodically **verify its own claim** and stand down when a closer node exists.
Both are live on **testnet and production** (no wire change — no flag day).
The mechanism-level fix is confirmed on prod: the flap is gone. The full
delivery soak improved substantially but does **not yet pass** — the remaining
work is scoped at the end. Read the observability section even if you skip the
rest; it cost us a full diagnosis cycle.

---

## How we found it

The 9-relay production backbone deployed cleanly: stable processes, full mesh,
keyspace hosting announced. Then the prod delivery soak failed badly — and
every scenario involving a **fresh or late subscriber** (discovery, post-churn
re-join, kill callbacks, timeline replay) scored near zero, while live
delivery partially worked. That's the signature of a split tree: messages live
on one root variant, new subscribers attach to the other.

Journal forensics across the fleet made it unambiguous: **75 of 285 topics had
formed roots on more than one relay**, and the worst-flapped topic
(`pow-bench/results`, 13 re-roots) is exactly why Howard's PoW results were
still not reaching the collector even after the bench app was fixed — the
collector was subscribed to one root variant, the publishes went to the other.

## The mechanism

Three ingredients, each reasonable alone:

1. **Terminal traffic auto-roots.** A subscribe (or kill, or metrics request)
   that strands on a near-miss node made that node take the topic's root —
   *even while it held a live, verified beacon naming the strictly closer true
   root.* Only publishes carried a last-mile correction.
2. **Beacon demotion self-corrects — and resets the loop.** The true root's
   next beacon demoted the impostor ~20s later. The next stranded subscribe
   re-rooted it. Forever. That's the 15–30s flap cadence in the journals.
3. **Nothing reconciles a standing split.** Once two roots coexist, each
   serves its own partial subtree indefinitely.

## The fix, in two layers

**v4.19.0 — don't take a root you know is wrong.** One shared gate now guards
*every* root-taking site (subscribe, publish, kill, metrics, promotion,
handoff): a node never takes or retakes a root while a live beacon names a
strictly-closer root it can verify — over a direct authenticated channel, or
(for one-shot publishes/kills) heard within the last beacon period. Stranded
traffic is forwarded to the true root instead; a spurious claim demotes and
re-homes beneath it, pushing its cached history up. Churn recovery is
untouched: a dead root's channel drop reopens promotion instantly. The same
freshness cut also closed a pre-existing loop where a stranded publish chased
a *departed* root's stale beacon for its full validity window.

**v4.19.1 — verify your own claim.** With the flap dead, an instrumented prod
run exposed the residual failure with surgical clarity: 10 of 12 subscribers
perfect, 2 with **zero** — binary orphans. On a brand-new topic there are no
beacons yet, so a stranded subscribe can still mint a spurious root *outside*
the true root's beacon basin, and its seated subscribers are pinned there
permanently. Beacons can't fix what they can't reach. So every root now
re-checks its own claim using the same iterative closest-node lookup
subscribers use — once ~6 seconds after forming (the fresh-topic race window),
then every 45 seconds, batched and strictly non-blocking. Finding a
strictly-closer live node ⇒ demote, re-home, hand the cache up; the orphaned
subtree keeps receiving through the demoted node as an ordinary relay.

## The observability lesson (read this one)

The relay status line prints `roles=` — how many topics the relay is currently
rooting/serving. It read **0, always, on every relay** — while the relays were
in fact rooting hundreds of topics. The introspection functions it calls were
dropped in the v3.12 internals rebuild and `health()` silently returned an
empty list ever since. We spent the first stretch of this diagnosis convinced
the backbone was inert *because our own instrument said so.* v4.19.0 restores
`inspectRoles()`/`inspectHosting()`, and the counter is live again (a busy
relay now reports `roles=152`, honestly).

Standing rule going forward: an observability surface must **exist or fail
loudly**. A counter that silently reads zero is worse than no counter.

## Verification

- New regression suite `test/smoke_root_reconcile.mjs`: a **divergent-view
  fabric** (greedy walk over per-node neighbour lists, local-only closest) —
  the real routing's failure mode, which our global-view test fabrics
  structurally cannot produce. 14/14 on the fix; the unfixed kernel fails the
  strand phase and infinite-loops the corpse-beacon phase.
- Full kernel suite green; Howard's axonSpec gate 13/14 quiesced runs.
- Live prod, post-fix: **zero** root re-formations on the previously
  worst-flapping relay (was every 15–30s under load).
- Testnet delivery sanity: 100% initial / 100% healed, all 12 subscribers.

## Where the prod soak stands (honest scoreboard)

Five acceptance cycles on prod after v4.19.1, against the pre-fix baseline:

| Scenario | Pre-fix (4.18.2) | Now (4.19.1) |
|---|---|---|
| backlog | 4/5 ok | **4/5 ok** |
| gap | 2/5 ok | **4/5 ok** |
| scale (healed) | 0–58% | 39–78% — improved, below threshold |
| restart (recovery) | ~0% | bimodal: 0 / 92 / 0 / 92 / 0 |
| churn / discovery / kill | ~0% | still failing |

Two threads remain, now cleanly separated from the election bug:

1. **Bridge admission under connection load.** Several scenario failures are
   `bridge closed socket before handshake completed` — clients dropped at the
   front door, not messages lost in the tree. All soak clients hammer one
   bridge from one IP; whether this is a bridge cap, proxy behaviour, or
   client-side socket pressure is the next investigation.
2. **Fresh-subscriber convergence under load** — discovery and the bimodal
   restart pattern suggest the cold-attach path still loses a race the
   self-verification hasn't closed. The restored introspection makes this
   diagnosable in a way it simply wasn't last week.

## Timeline credit

The 4.18.2 backup split-brain fix (last update) and this root flap are the
same disease in two organs: locally-decided root-ness. 4.18.2 routed backup
promotion through the network-confirmed election; 4.19.x routes *everything
else* through it too, and makes standing roots re-earn their claim. The
direction was set by the same reframing credited last time: root-ness is
decided by routing, and any path that lets a node self-declare without the
network's confirmation will eventually split somewhere.

— shipped 2026-07-07: kernel v4.19.0 → v4.19.1, bridge v2.65.0, relay v0.47.1,
peer v3.47.1; testnet + production; SECURITY-CHANGELOG updated.
