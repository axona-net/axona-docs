# Eligibility-Aware Root Placement — defer down the K-closest ladder (v0.2)

**Status:** design note / proposal · **v0.1 flagged:** 2026-07-01 · **v0.2 revised:**
2026-07-17 (kernel baseline v4.27.1). **What changed in v0.2:** the load-only trigger is
generalized to an **eligibility predicate** with two inputs — *overloaded* (v0.1's local
load budget) and *backgrounded* (Howard Stearns' proposal, 2026-07-17: a browser tab that
loses visibility must tell the network "don't count on me" while staying connected as a
leaf). v0.2 also re-grounds the design in machinery that did not exist at v0.1: explicit
role natures (v4.26.0), the acked leave-handoff (v4.24.0), and the join-storm pacing +
mesh re-warm (v4.27.x) — and in the first **live** evidence of the disease it treats
(the 2026-07-17 join-storm episode: three relays silently accepting a region's worth of
rootship, then dying of it).

**Relates to:** role natures (§VIII of the architecture doc), the routing-only axon tree,
region-lock (v4.13.0), reachable-root fallback + singleton-root replication, acked
leave-handoff (#331), join-storm pacing (#332), `findKClosest`/`ADOPT`. **Read alongside**
the two NO-GOs it deliberately does *not* repeat: Stability-Weighted Root Election (NO-GO —
dynamic root movement for *durability* bought ~0 and thrashed) and Root Beacon radius
(NO-GO past a small radius).

> **Not built. Not approved.** Critique on paper, then falsify in `dht-sim` (≥5 seeds,
> mean±sd) **before** any kernel change. The genuinely new primitives are an eligibility
> predicate and a `defer` decision; the genuine risk is root thrash. Nothing ships until
> the sim earns it. Target slot: **after Phase 8** — the sync engine's typed policy table
> is where "who may hold which nature" becomes a declared input instead of scattered
> conditionals.

---

## TL;DR

Root placement today is **capability-oblivious**: `_topicDecision` seats rootship on
whatever live in-region node is XOR-closest to the topic id — no load input, no
availability input. Two real populations break this assumption from opposite ends:

- **Hotspot infrastructure** — a relay closest to many hot topics absorbs rootship until
  it degrades or dies (live-reproduced 2026-07-17: ~1,000 roles per uswest relay; mesh
  dissolution; #332). Overload relief today is *death and failover*.
- **Background browser tabs** — the dominant real-world client state. A hidden tab is
  throttled (timers clamped to ~1/min) but not suspended, receives `visibilitychange`
  going in, and gets **no event at all** when the OS finally suspends it. It cannot be a
  dependable root or backup — but it must **stay connected as a leaf**, because inbound
  delivery still works in background and is exactly what drives an OS notification
  ("an alert came in"). Howard validated this stay-connected-as-a-leaf pattern on kdht
  in civildefense.

One mechanism serves both: a node has a local **eligibility** state; an ineligible node
**defers rootship down the topic's K-closest ladder** instead of seating it, sheds the
infrastructure natures it already holds (gracefully, via the acked handoff), and remains
a plain CHILD/leaf. The invariant softens from *"closest node roots"* to *"closest
**eligible** node in the K-set roots — and if none is eligible, the closest one serves
anyway, degraded."*

---

## 1. Eligibility — one predicate, two inputs

```
eligible(node) = !overBudget(node) && available(node)
```

- **`overBudget`** — self-assessed from the node's own `_nodeStats` counters (aggregate
  bytes/sec + active role count + summed direct subscribers) against a per-node ceiling.
  Never a peer's *claimed* load — untrusted, grindable. (Unchanged from v0.1 §4.1.)
- **`available`** — app-declared. New public API:

  ```js
  peer.setAvailability('foreground' | 'background')   // default 'foreground'
  ```

  Wired by the app to `document.visibilitychange` (browsers), or to power/battery state
  (mobile wrappers), or left alone (relays, Node services). The kernel never guesses
  visibility — the app owns the signal; the kernel owns the consequences.

Both inputs flow into the **same** deferral machinery. This unification is the point:
"backgrounded" is just a capability statement the node knows about itself, exactly like
"overloaded" — and the network's response (don't seat new infrastructure here; migrate
what it holds; keep it as a leaf) is identical.

## 2. What the nature model buys (new since v0.1)

v4.26.0 made a role's nature — ROOT / BACKUP / CHILD (+ HOLDER) — explicit, derived from
ground facts, with **single audited transition sites**. Eligibility becomes a guard at
those sites, not a new state machine:

| Nature      | Eligible node                  | Ineligible node                              |
|-------------|--------------------------------|----------------------------------------------|
| ROOT        | seats + serves (today's path)  | **defers** at election; **sheds** held roots via acked handoff (#331) down the ladder |
| BACKUP      | accepts REPLICATE recruitment  | `becomeBackup` declines; held backups retire via `retireBackup('ineligible')` |
| CHILD/leaf  | subscribes, receives, notifies | **unchanged — this is the whole point.** The subscription stays live; inbound DELIVER still fires; the app can raise its OS notification |
| HOLDER      | host() retention as today      | retained (passive storage is cheap) but the node stops *advertising* keyspace hosting |

Every transition is one guard at one site, logged with the existing `role-nature`
structured log (`why: 'ineligible'` / `why: 'eligible-again'`) — the observability comes
free.

Shedding reuses the **acked leave-handoff** exactly as `leave()` does — cache + rootship
move to the heir, confirmed by HANDOFFACK, with the cohort-spray fallback — except the
node *does not disconnect*: it re-attaches to the new root as an ordinary child, keeping
its own subscriptions. "Background" is `leave()` for the spine, not for the ear.

## 3. Anchor vs. root, and the ladder constraint (unchanged from v0.1)

The keyspace still points at the **anchor** (XOR-closest, deterministic, discoverable).
The **root** may differ, but is constrained to the topic's **K-closest set** — the ladder
`findKClosest` computes and singleton-replication already warms. A deferring anchor
`ADOPT`s the next *eligible* candidate down the ladder and keeps a recomputable
`{redirect}` pointer; SUB/PULL answer with a one-time redirect (cached by the joiner —
+1 hop for a cold joiner, amortized), PUB simply forwards. No trust hole (any peer can
verify the root is a legitimate K-set member), no region crossing (the in-region K-set
*is* the ladder), no redirect chains (hand only to an eligible candidate). See v0.1
§§3–6 for the full mechanics; they are unchanged.

## 4. The three design rules v0.2 adds

### 4.1 Preference, not veto
If **every** ladder candidate is ineligible (a mobile-heavy region at night: all tabs
backgrounded), the topic must still have a root — willing subscribers with no root is a
new failure mode we refuse to build. Rule: walk the ladder for an eligible candidate;
if none exists, the **least-loaded ineligible** candidate serves anyway, degraded, and
the region emits the under-provisioned metric signal (v0.1 §7). Deferral orders
candidates; it never empties the candidate set.

### 4.2 Hysteresis — visibility flaps harder than load
v0.1's thrash rules (sticky shed, band-gap + dwell to reclaim, never dump subscribers
you already serve) carry over and get a sharper edge: tab visibility toggles constantly,
and shedding hundreds of roles on a 5-second tab switch would *manufacture* the churn
storms #332/#333 taught us to fear. Rules:

- **Debounced shed.** `setAvailability('background')` marks the node ineligible for
  *new* seating immediately (cheap, reversible), but shedding of *held* natures starts
  only after a sustained window (~30–60s — sim-tunable). A quick tab flick costs nothing.
- **Paced shed.** When shedding does start, it drains through the same per-tick budget
  discipline as #332's replication pacing — a browser tab with 50 roles hands them off
  over a few ticks, not in one burst.
- **Lazy reclaim.** Returning to foreground restores *eligibility* only. The node does
  not reclaim rootship it shed; it simply becomes seatable again for future elections.
  (Asymmetry kills oscillation.)

### 4.3 Dormant leaves — the background node's other half
A throttled tab's renewal timers clamp to ~1/min; `DROP_MS` is 180s — survivable, but
racing the clock. Two adjustments make background leaves first-class:

- **Self-declare cadence.** A background node's SUB renewals carry a `dormant` hint;
  parents stretch that subscriber's eviction window instead of racing `DROP_MS`.
  (Inbound delivery is unaffected — DataChannel messages fire in background tabs; it is
  precisely *timers* that throttle. This asymmetry is why Howard's kdht pattern worked.)
- **Suspension needs no event.** When the OS suspends the tab (no signal), the node is
  ordinary churn — and *harmless* churn, because it held no infrastructure nature.
  That is the payoff of the whole design: the unannounceable death stops mattering.

## 5. Live evidence (new since v0.1)

- **2026-07-17 join-storm episode (#332/#342):** three uswest relays silently accepted
  ~1,000 roles each — rootship concentration with no protocol response — and the region
  collapsed under the resulting obligations on two different kernel versions. First live
  demonstration that "the closest node roots, unconditionally" is a real failure regime,
  not a hypothetical. (#332's pacing makes the *transfer* survivable; this note is about
  not concentrating the *placement* in the first place.)
- **Alert-bot / #341:** civildefense's publish-durably-then-leave pattern shows client
  nodes out-competing relays for rootship (address-closest wins), then departing —
  exactly the population that should have been deferring to infrastructure all along.
  An ineligible-but-present node is strictly better than a departed root.
- **Howard's kdht background pattern:** stay connected in background, receive pushes,
  raise OS notifications — field-validated in civildefense. v0.2 makes that pattern a
  protocol citizen instead of an app-level workaround.

## 6. Code touch-points (delta from v0.1 §8, at the v4.27.1 baseline)

- `AxonaPeer.setAvailability(state)` — public API; feeds `eligible()` alongside the
  load budget; emits a `role-nature`-adjacent log on change.
- `AxonaManager._topicDecision` — fourth outcome `defer` (terminus ∧ in-region ∧
  ineligible); `handle` requires eligibility.
- Shed path — per-topic invocation of the existing `pubsubLeaveHandoff` (acked, #331)
  without transport teardown, budget-paced (#332's `REPLICATE_FULL_BUDGET` discipline),
  debounced per §4.2.
- `becomeBackup` / seating delegation — eligibility guard at the (single) transition
  sites; `retireBackup(t, role, 'ineligible')`.
- SUB renewal — `dormant` hint + parent-side eviction stretch (§4.3).
- Redirect reply on SUB/PULL at a deferred anchor — unchanged from v0.1; confirm
  wire-compatibility (piggyback on existing acks if possible — no flag day).

## 7. Validation bar (unchanged, plus two scenarios)

The v0.1 bar stands: ≥5 seeds, mean±sd; success = hotspot peak load materially reduced,
delivery/convergence not worse than baseline, no root oscillation under steady load.
v0.2 adds two required sim scenarios:

1. **Background wave** — 60–90% of a region's client nodes go ineligible over minutes
   (the nightly mobile pattern): topics must migrate to the remaining eligible nodes
   without delivery loss, and §4.1's degraded mode must engage cleanly when eligibility
   hits zero.
2. **Flap storm** — nodes toggling visibility at tab-switch frequency: total handoff
   traffic must stay near zero (the debounce is doing its job), and delivery must be
   indistinguishable from baseline.

And one **live** check we could not do at v0.1: replay the alert-bot flood repro with
the bot's nodes declaring `background` before disconnecting — the #341 fresh-subscriber
miss rate should drop, because the durable copy lands on infrastructure at publish time
instead of racing the departure handoff.

## Next step

Prototype in `dht-sim` after Phase 8 lands (the policy table is the natural
implementation surface), against the bar above. Review with Howard first — the
`setAvailability` contract and the `dormant` renewal hint are app-facing and
civildefense is the first consumer.
