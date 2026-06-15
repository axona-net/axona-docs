# From Gates to Gradients — 6. Friction scaled to reach (v0.1)

**Status:** design note · **Flagged:** 2026-06-15 · **Relates to:**
*From Gates to Gradients* (companion essay) ·
[Pub/Sub Lifecycle Design v0.2](../implementation/Pubsub-Lifecycle-Design-v0.2.md) ·
[Axona vs. Vivaldi v0.1](./Axona-vs-Vivaldi-v0.1.md) · red-team finding **B-4** (ingress signature verification) ·
sibling notes:
[1 Costly identity](Gates-to-Gradients-1-Costly-Identity-v0.1.md) ·
[2 Cascade telemetry](Gates-to-Gradients-2-Cascade-Telemetry-v0.1.md) ·
[3 Soft retraction annotations](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.1.md) ·
[4 Forkable filter sets](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.1.md) ·
[5 Agent legibility](Gates-to-Gradients-5-Agent-Legibility-v0.1.md)

---

## TL;DR

This is the sixth and **hardest** move in the series, and the one I can be least
confident about. The essay asks: can Axona keep the one defensible lesson from
the flash-crash era — *that runaway amplification should cost something* — **without**
a chokepoint to enforce it? The answer is a qualified yes, but only as a *gradient*,
never a guarantee. Friction can be made to track **blast radius**: a message to a
dozen neighbours costs essentially nothing; a message fanning out to a hundred
thousand strangers can be made to cost a little. Two complementary mechanisms,
both already-decentralized, approximate this: **(1) per-relay local damping**, a
generalization of the bounded-queue / quota / hold-time machinery Axona already
ships, and **(2) reach-graded proof-of-work** demanded by the K-closest roots that
already see a topic's subscriber-set size. Neither binds a determined adversary —
fragmentation and under-declaration evade both — so this note prices *casual and
scaled amplification* and is honest that it does nothing more.

---

## 1. The idea

The flash-crash analogy in the essay carries exactly one lesson across the
no-chokepoint boundary: **friction can scale to reach.** In a market, a circuit
breaker is a gate — a central authority halts trading for everyone. That does not
survive translation to Axona; there is no one to pull the switch, and the essay's
whole argument is that we should not want one. What *does* survive is the weaker,
local intuition underneath it: **"runaway velocity is merely made to cost what
runaway velocity is worth."**

Phrased as a gradient rather than a gate:

- Publishing to your dozen subscribed neighbours is an ordinary, near-free act.
- Publishing in a way that fans out to a hundred thousand strangers is *also*
  permitted — but it is allowed to cost a little, because amplification at that
  scale is precisely the thing an attacker (spam, brigading, coordinated flooding)
  most wants for free.

Crucially this is **per-node default behaviour, not central throttling.** No node
decides for the network. Each node decides only what *it* will forward, and at what
rate. The aggregate effect is a soft cost curve on reach — a gradient that emerges
from many independent local policies, with no coordinator and nothing to capture.

## 2. How it helps

A gate ("nothing over N recipients may pass") is brittle and capturable: whoever
sets N controls the conversation, which is the failure mode the whole series is
written against. A gradient is different in kind:

- It **prices** the behaviour we dislike (mass amplification by fresh, anonymous,
  high-volume publishers) instead of **forbidding** it.
- It degrades gracefully. There is no single value of N to argue over, no binary
  allow/deny that a censor can lean on, and no global state to subvert.
- It leaves the cheap, local, neighbourly case — the overwhelming majority of
  honest traffic — completely untouched.

The goal is not to *stop* large fan-out. It is to make large fan-out cost roughly
what large fan-out is worth, so that the economics of casual abuse stop favouring
the abuser.

## 3. How Axona provides it

Two complementary mechanisms. They attack the problem from opposite ends —
the relay side and the publisher side — and neither needs global agreement.

### 3.1 Mechanism A — per-relay local damping (the robust, decentralized half)

This is the more enforceable half, and it is almost entirely a *reframing* of
machinery Axona already ships. The
[Pub/Sub Lifecycle Design v0.2](../implementation/Pubsub-Lifecycle-Design-v0.2.md)
gives every node, today, a set of local self-protection levers:

- **Bounded queues** (§5) — each topic replica caps at `maxMessages ∈ [1,256]`
  with deterministic, signed-field-ordered eviction. A relay never holds unbounded
  state for one topic.
- **Per-publisher quota** (§1.5, §5.3) — on open (Model 1) topics, one
  `signerPubkey` may occupy at most `⌈maxMessages/4⌉` of a queue, so a single
  anonymous publisher cannot flush a topic or monopolize a relay's capacity.
- **Hold time and the absolute `maxHoldMs` ceiling** (§2.3, §6) — every message
  has a bounded lifetime (≤ 48 h), and reads/`touch` can extend life only up to a
  hard ceiling derived from the signed `ts`. No message pins a relay forever.

The damping move generalizes these from *per-topic storage limits* into a
*per-relay forwarding policy*: **each relaying node imposes its own rate ceiling,
and a brief, bounded forwarding delay, when it is asked to fan a message out
widely.** A node forwarding to a handful of downstream subscribers does nothing
unusual; a node asked to fan out to a large subscriber set may rate-limit and
delay its *own* forwarding. This needs **no global agreement** — every node damps
only the traffic it itself relays, exactly as bounded queues and quotas already
constrain only the state a node itself holds. It is the same philosophy the
lifecycle doc applies to storage, extended to bandwidth/fan-out.

Because the damping is local and default, it is the part of this note I'd actually
stake a claim on: it cannot be bought off, captured, or centrally disabled, because
there is no central anything — it is just each node protecting itself.

### 3.2 Mechanism B — reach-graded proof-of-work at K-closest ingress (the publisher-side cost)

The second mechanism puts the cost on the *publisher* and reuses two facts the
network already has at the topic's K-closest roots:

1. The roots **already verify the publisher's signature at ingress** — this is
   red-team finding **B-4**, already enforced on `_onPublish`/`_onPublishDirect`.
2. The roots **already track the subscriber set** for the topic they host (that is
   how subscribers are served).

So the roots already know, *approximately*, the fan-out a publish is asking for.
They can therefore demand **proof-of-work proportional to that reach**: a publish
to a topic with twelve subscribers requires trivial (or zero) PoW; a publish to a
topic with a hundred thousand subscribers requires more. This reuses the PoW
machinery specified in [note 1, Costly identity](Gates-to-Gradients-1-Costly-Identity-v0.1.md)
— the same `H(domain‖…‖nonce)` puzzle hash, here keyed to expected fan-out rather
than to identity creation, and deliberately decoupled from the node address (see
[`E-1-Placement-Defense-v0.1.md`](E-1-Placement-Defense-v0.1.md)) so it introduces
no keyspace skew.

The curve I have in mind (illustrative, not calibrated):

```
PoW cost
 ^
 |                                              .*
 |                                         .*'
 |                                    .*'
 |                              .*'
 |                        .*'
 |                  .*'
 |            .-*'
 |       .-*'
 0 *--*--*'________________________________________> expected fan-out
   12   100        1k         10k        100k+   (subscribers)
   ~free     cheap        noticeable      a little real cost
```

Near-free for a dozen neighbours; rising — sub-linearly, by design, so it never
becomes a hard wall — toward a real but bounded cost for mass strangers.

### 3.3 Roadmap status

This is the **hardest** of the six moves and the least settled. **Per-relay
damping (A)** is the more enforceable half and the closer to shipping, because it
is a generalization of already-shipped Phase-A lifecycle machinery — it is a policy
layer over existing levers, not a new trust object. **Reach-graded ingress PoW (B)**
is complementary, more speculative, and depends on note 1's identity-PoW work
landing first. Both should be marketed honestly as **default-shapers**, not
enforcement. Neither is a committed kernel feature today.

## 4. Honest limits (this section matters most)

I want to be candid: this is the move where the gap between the *intent* and what
the mechanism actually *binds* is widest. Three limits, none of them small.

1. **Fragmentation defeats reach-grading.** An attacker who wants to blast a
   hundred thousand strangers can split the payload across many topics, each with a
   subscriber count below the fan-out threshold, and pay near-zero PoW on each. The
   per-topic view at the roots simply does not see the aggregate. Mechanism B prices
   *one declared large fan-out*; it does not price *the same content fanned out
   across a thousand small topics.*

2. **Under-declaration / approximate reach.** The K-closest roots only
   **approximately** agree on subscriber count. As the lifecycle doc stresses
   throughout (§0, §1.4), this is leaderless, eventually-consistent replicated state
   under churn — different roots hold different, lagging views of the subscriber
   set. So the graded cost is **fuzzy, not exact**: a publisher may be charged
   against a stale low count, and roots cannot collude to compute a precise global
   reach without exactly the coordinator this series refuses to build.

3. **It does not bind a determined adversary.** Taken together, (1) and (2) mean
   this mechanism **shapes the default path and prices casual or scaled
   amplification** — and stops there. A determined, resourced attacker routes
   around it. This is the series' "cannot be bought" boundary, stated plainly in the
   essay: a gradient prices behaviour, it does not prohibit it, and **anyone
   promising more — a number you cannot exceed, a guarantee that mass amplification
   is *stopped* — is selling the chokepoint back under a new name.** I would rather
   under-claim here than ship a "limit" that is really a capture surface wearing a
   gradient's clothes.

4. **The legitimate-virality tension.** A real grassroots message that genuinely
   *deserves* to reach a hundred thousand people pays exactly the same reach-graded
   cost as a spammer. The mechanism is content-blind by design (it sees WHO and
   fan-out, never merit), so it cannot tell the dissident from the flooder. This is
   a real cost, not a rounding error, and it is the strongest argument *against*
   mechanism B in particular.

## 5. Open questions

- **Rebating legitimate reach.** Could tenure or reputation rebate the cost without
  re-introducing a gate? Note 1's **Stage-5 proof-of-tenure** is the obvious lever:
  an identity with long, clean history pays less reach-graded PoW than a fresh one.
  Alternatively, *measured* engagement (genuine pull-through to subscribers, not
  self-declared) might earn a rebate. Both risk becoming a soft reputation oracle —
  the very thing the project's no-centralized-reputation constraint forbids. Open
  whether either can be made first-party and uncapturable.
- **Does fragmentation just win?** If splitting across topics trivially evades
  mechanism B, is B worth its complexity at all, or should the note collapse to
  mechanism A alone? Possibly per-relay damping (which sees forwarding load
  regardless of topic structure) is the only honest half.
- **Calibrating the curve.** What fan-out threshold and what cost slope actually
  deter casual abuse without taxing honest virality? This wants a
  **dht-sim** study (cf. the binding-model work flagged for B-3) before any number
  is committed — the curve in §3.2 is a sketch, not a spec.
- **Damping and delivery latency.** A forwarding delay on wide fan-out trades
  amplification-resistance against delivery speed for legitimate large topics. What
  delay is imperceptible to honest use yet meaningful against flooding?
- **Interaction with cascade telemetry (note 2).** Could the same fan-out signal
  feed [cascade telemetry](Gates-to-Gradients-2-Cascade-Telemetry-v0.1.md) so that
  *observed* runaway spread, rather than *declared* reach, is what raises cost —
  closing the under-declaration gap after the fact?

---

*This is a design sketch exploring the hardest of the six gradient moves, not a
committed roadmap item.*
