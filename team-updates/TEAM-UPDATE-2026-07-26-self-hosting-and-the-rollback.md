# Why #axona.bot went dark, why we tried to roll back, and why the rollback was chasing the wrong shape

*2026-07-26. Companion to the 4.43.0 release note. This one is about the failure that
started it, because the lesson is more valuable than the fix.*

---

## The short version

A node was **hosting its own topic**. That is always wrong, but it is *invisible* while
the mesh is small — and it stayed invisible for as long as the mesh stayed small.

Then we added relays, for a capacity reason entirely unrelated to correctness. The mesh
grew past a specific threshold, and a latent design error became total delivery loss on
#axona.bot.

We read the symptom as a regression and moved to roll back. **The bug was not in any
recent version.** Rolling back could not have fixed it, because the trigger was
topology, not code age.

---

## 1. What the failure looked like

Owner-write publishes to #axona.bot (`89f7f877…`) stopped arriving. Worse than a
plain outage: the channel's history was gone from a fresh reader's point of view, while
the publisher's own read-back reported success.

That last detail is what made it so confusing. The publisher was satisfied. Nothing
logged an error. Four plausible explanations were eliminated in turn:

| hypothesis | how it died |
|---|---|
| **Version skew** — 4.42.0 publisher against a 4.41.0 mesh | tested 4.41.0 and 4.40.0 publishers; both failed identically |
| **Bootstrap order** — the publisher assembling its peer by hand and skipping a step | interleaved A/B, 5 reps: fixed 5/5, unfixed 5/5 — and the unfixed one was *faster* |
| **Ghost cohort** — the topic's holders had departed uncleanly | 7 of 8 alive, 1 ghost. Not it |
| **Ingress drops** — the holder rejecting the publish | holder journals were clean |

Each of those is a *code-shaped* hypothesis. All four were wrong, and that pattern
should have been the clue earlier than it was.

## 2. The actual mechanism

The MCP peer — the process that publishes as axona.bot — was calling `peer.host()` on
its **own** topics. Same for the bridge with the bridge-directory topic. A publisher was
also serving as a root for the thing it published.

Here is why that is fine at small N and fatal at larger N.

A topic's root is decided by **address**: whichever node's id is XOR-closest to the
topic id. When a node hosts its own topic, you now have two claimants —

- the **self-hosting** node, which holds the data, and
- the **address-closest** node, which is where every subscriber's route actually lands.

**With few nodes, those are the same cohort.** Every node is a near neighbour of every
other, so the two roots sit inside each other's replica set, exchange REPLICATE, union
their caches, and behave as one. The error is fully masked. Not mitigated — masked.

**With more nodes, they separate.** The address-closest root is genuinely far from the
self-hosting node in the keyspace. Now:

- the publisher writes to itself, and is satisfied — it re-read through its own
  descriptor, which proves nothing;
- subscribers route by address to the *other* root, which holds a role, answers as an
  authority, and **holds nothing**.

The failure shape is **starvation, not divergence**: cache `2/0`. An empty node
confidently serving an empty answer. That is why nothing errored.

## 3. The threshold is exact, and it is smaller than anyone would guess

Two roots merge only while each is inside the other's kept replica set. Reconciliation
reach is `ROOT_REPLICAS`, which is **2** (`pubsub/constants.js:63`) — the repair plane
asks for `(this._rootReplicas + 1) * 2` = 6 candidates (`pubsub/repairPlane.js:535`) and
then keeps `slice(0, this._rootReplicas)` = **2** (`repairPlane.js:552`). There is no
background gossip that widens this; `UNION_AT_ROOT` fires only when a REPLICATE arrives
at a node that already holds the root claim.

So two roots reconcile only while **N ≤ rootReplicas + 1 = 3**.

Confirmed in simulation:

| N | outcome |
|---|---|
| 3 | **MERGED 5/5** |
| 4, 6, 8, 12, 20, 40 | **SPLIT 0/5** — permanently |

Three nodes. That is the entire margin. Above it, a second root never heals, for as long
as the topic exists.

Fenced now in `smoke_root_reconcile_reach.mjs`, with the assertions derived from the
`ROOT_REPLICAS` constant so the fence moves if the constant does.

## 4. The part that matters: **mesh growth is what exposed it**

We added relays to get past the bridge's `MAX_PEERS = 32`. A capacity change. Nobody was
touching pub/sub correctness, and nothing in the change description would have suggested
delivery risk.

That change moved N from *inside* the reconciliation margin to *outside* it. The
self-hosting error had been present the whole time, silently, doing nothing — and then
it wasn't silent.

Three things follow, and they are the reason this document exists:

**"It worked before" was never evidence of correctness.** It was evidence that N was
small. The system had been passing a test it was never actually taking.

**Capacity changes can expose correctness bugs.** Scaling out is usually filed as an
operational change, reviewed for throughput and cost. This one changed which of two
competing roots a subscriber reached. Any change to node count, region population, or
replica constants can move a masked error across its threshold.

**A bug that appears when you grow will keep reappearing as you grow.** At 12 nodes it
was #axona.bot. The same class, unfixed, resurfaces on a different topic at 50, and on
another at 500 — each time looking like a new and unrelated incident.

## 5. Why the rollback was the wrong instinct — and what it cost

The symptom appeared after a period of active releases, so it read as a regression, and
the reasonable-looking move was to return to a known-good version. We reverted to the
4.39.0 tree.

That could not have worked. The defect was in **how a node chose what to host**, present
across every version in the range, and only ever gated by topology. Rolling back changed
the code and left N alone.

It also cost us something concrete. The revert was done as a **content revert** rather
than a branch rewind, so history kept moving forward while the version string went
backwards — which is how testnet ended up reading 4.39.2 while being a strict git
*descendant* of prod's 4.41.0. Promoting that would have shipped a behavioural rollback
disguised as an upgrade. Untangling it is what 4.43.0 was for.

The honest summary: **we reached for a version-shaped explanation of a topology-shaped
bug, and the reach itself created a second problem.**

What would have found it faster: noticing that four consecutive code-shaped hypotheses
had all been eliminated, and asking what had changed that was *not* code. The answer —
"we added relays" — was in the deploy log the whole time.

## 6. What is fixed, and how it is held

**The rule** (kernel 4.39.1, now in 4.43.0): *hosting is decided by ADDRESS, never by
ownership.* `host(topic)` refuses a topic the node is not near, with
`HOST_NOT_IN_NEIGHBOURHOOD`. A node may host its own topic **only** if its address would
have put it there anyway — the two properties are fully disjoint.

**The call sites**, all removed:

- MCP peer author-class self-host, and its per-topic self-host
- the bridge's `host(DIRECTORY_TOPIC)`

The bridge's case is instructive, because it had a *real* reason: its launch publish
landed before peers reconnected and would be lost into an empty mesh, so it hosted its
own topic to survive its own cold start. A genuine problem, solved the wrong way. The
replacement is an **hourly re-publish** — which makes a lost publish harmless, and as a
bonus makes entry age the liveness signal, so a dead bridge ages out with no departure
protocol at all.

**The fences:**

- `smoke_host_address_rule.mjs` — 12 checks, both directions: a distant node with K
  closer peers is refused; the closest node is allowed; sparse, cold, and
  lookup-failure cases are allowed (you cannot prove exclusion from a failed lookup);
  self is not miscounted as a closer peer; the error code is exported
- `smoke_root_reconcile_reach.mjs` — 5 checks pinning section 3 in place: merge at
  N=3, no merge at N=4 and N=8, the split survives repeated repair ticks, and —
  the one most likely to be misread from the code — reach is `rootReplicas`, **not**
  the wider `(rootReplicas+1)*2` candidate window it is selected from

## 7. Still open

**#393 has no confirmed prod root cause.** The mechanism above fits every observation —
the timing, the starvation shape, why owned topics failed while open ones did not, why
reconciliation never caught it — and it reproduces in simulation. But the symptom stopped
recurring before the fix landed, so we never caught it in the act on prod. Stated as a
strong model, not a proven one.

**#397** — reconciliation reach is 2, and that is a design question rather than a bug.
Should reach be an iterative lookup instead of the local candidate set? Left open
deliberately: the address rule removes the main *source* of second roots, but churn can
still mint one, and beyond N=3 it would still be permanent.

**The generalised lesson has no fence.** We can test that a node will not host by
ownership. We cannot yet test "no masked error is sitting just inside a threshold we are
about to cross." The nearest practical answer is to run the sim at several N whenever a
constant or a population changes — which is exactly what turned the double-root model
from a guess into a measurement in the first place.
