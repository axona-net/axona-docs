# Black-Hole Nodes — Threat Model & Detection Research (v0.1)

**Status:** research note / open problem · **Flagged:** 2026-06-01 ·
**Relates to:** B-3 (eclipse / verified admission), the Endo node-attestation
thread, and the heterogeneous-protocol simulation effort
(`implementation/Heterogeneous-Protocol-Sim-v0.1.md`).

---

## 1. The threat

A **black-hole node** is cryptographically indistinguishable from an honest
node. It has a valid 264-bit identity, completes the `axona/4` handshake,
binds the DTLS channel (A-1), passes verified-admission (B-3), and answers
heartbeats. By every *identity and authorization* check Axona makes, it is a
good citizen. But its **forwarding behaviour** is faulty or hostile:

- **Omission (the classic black hole).** Data goes in, nothing comes out.
  Messages it should relay toward a destination are dropped. Publishes routed
  through it never reach the topic's roots. Deliveries destined for you,
  arriving via it, vanish.
- **Tampering.** It alters payloads in flight rather than dropping them.
- **Selective / adaptive omission.** It forwards *enough* to look healthy —
  heartbeats, control frames, a sample of traffic — while dropping *targeted*
  payload, or forwarding *probes* while dropping *real* messages.
- **Equivocation.** It relays *different* (each individually valid) content to
  different peers, or claims to have forwarded something it didn't.

This is a **Byzantine behavioural fault**, categorically different from
everything the security register has closed so far. A-1/B-1/B-4/C-2/B-3 all
answer *"is this peer who it claims to be, and may it do this?"* A black hole
answers *yes* to all of them. The question here is the orthogonal one:
*"is this peer actually doing its job, honestly?"*

This is the same failure mode as the **"broken-but-authentic bridge"** that
motivated the Endo node-attestation note — a node that is perfectly
authentic and completely non-functional.

## 2. The central result

> **Tampering is provable. Equivocation is provable. Omission is only
> inferable. Bad-faith *intent* is never provable.**

Each clause matters for what we can build:

### 2.1 Tampering — already defeated (cryptographic)

A black hole cannot silently alter a signed message. Axona signs every
publish end-to-end (Ed25519 over a domain-tagged canonical core; `msgId` is
the content hash; C-2 binds `seq`+`ts`). Any modification breaks the
signature → the receiving endpoint's `verifyEnvelope` returns `ok:false` and
drops it. The relay isn't the publisher, so it can't re-sign. **A-1 channel
binding** additionally stops it from terminating DTLS on both legs to MITM
"direct" mesh traffic. So "modified and manipulated" payloads are *already*
rejected by honest endpoints today. Tampering collapses into "drop the real
message," i.e. omission.

### 2.2 Replay / reorder — already defeated (C-2)

A black hole can't re-inject an old captured message as live (freshness
window on the signed `ts`) nor silently reorder a publisher's stream
(per-publisher monotonic `seq`). Both are rejected at live ingress.

### 2.3 Omission — the actual open problem

Dropping is **not provable**, for an information-theoretic reason, not an
Axona limitation:

- **You cannot prove a negative.** There is no signed artifact that attests
  "N received X and did not forward it." Absence is unattributable.
- **A malicious drop is indistinguishable from a benign one** at a single
  observation. Crashed, NAT-stranded, congested, asleep, and hostile all look
  identical from one vantage point. (This is exactly the post-sleep
  zombie-channel case we just handled at the transport layer — the same
  ambiguity, weaponised.)

So we cannot *prove* a node is acting in bad faith by omission. We can only
**observe the behaviour statistically and route around it.**

### 2.4 Equivocation — the one bad-faith behaviour that *is* provable

If a relay emits **two validly-signed-but-conflicting** artifacts — relays
different content for one `msgId`, or signs a forwarding receipt the endpoint
never corroborates — then two honest peers comparing notes hold a
**cryptographic contradiction**: a self-authenticating proof of misbehaviour,
shareable as *evidence* (not a reputation opinion). This is the one place a
verdict of "bad faith" is defensible. The K-replicated root set gives the
cross-check vantage for nearly free.

## 3. What Axona has today vs. the gap

| Behaviour | Status |
|---|---|
| Content tampering | **Caught** — E2E signature, `msgId`, A-1 |
| Replay / reorder | **Caught** — C-2 `seq` + freshness window |
| Link liveness to *me* | **Caught** — ping/pong RTT, pong-timeout + send-failure eviction (`mesh.js`) |
| Equivocation | **Provable** but no cross-check mechanism built yet |
| **Silent omission of *forwarded* traffic** | **Open gap** — liveness probes test the link to me, not whether the peer forwards |

The precise gap: today's eviction is driven by **first-party liveness** —
does this peer answer *my* pings? A competent black hole answers pings (keeps
the channel "open") while dropping *forwarded* payload. **Liveness ≠
forwarding correctness.** Nothing currently measures the latter.

## 4. Detection design sketch (constraint-compatible)

All of the following respect the standing constraint: **first-party
measurement only, no central authority, no shared/gossiped reputation
service.** A *local* vitality signal from a node's own observations is fine
(it's measurement, not a trust verdict); a network-wide reputation score is
not.

**(a) End-to-end delivery confirmation.** The only authority on delivery is
the *destination*. Confirm that a published message actually landed at its
K-closest roots (e.g. `pull(msgId)` it back, or an app-level ack). When it
doesn't, the relay on that path is implicated. The probe must ride **real
traffic**, not separate probe packets — otherwise an adaptive black hole
forwards probes and drops payload.

**(b) Path redundancy makes detection a free byproduct.** Publishes already
fan out to K-closest roots with cross-fragment copies. A single black hole
*can't sink* a message — it arrives via the other K−1 paths. So redundancy
buys **delivery** *and* **detection**: compare success across disjoint paths;
the consistently-failing relay stands out. The design principle is already
ours: never depend on a single relay.

**(c) Local forwarding-vitality → routing.** Per next-hop, track *your own*
rate of "messages routed through this peer that reached an acked
destination," time-decayed. Demote / evict the chronically-failing ones — the
same shape as today's send-failure eviction, but measuring **forwarding**
instead of **direct reachability**. Local signal, never gossiped. This is the
"behavioural round-trip probe feeding the vitality function for route-around"
from the Endo note, made concrete.

**(d) Equivocation cross-check.** When two honest peers (or one peer across
two paths) observe signed conflicting artifacts for the same `(publisher,
seq)` or `msgId`, retain the pair as an attributable proof. This is the only
output that can justify a hard verdict rather than a soft demotion.

## 5. The hard residuals (clear-eyed)

- **Selective / adaptive black holes.** Forward enough to look healthy, drop
  only targeted traffic, forward probes but not payload. Counter: probes
  indistinguishable from real traffic; randomised end-to-end audits.
- **False positives.** The metric that decides whether this is even *safe to
  ship* is the false-positive rate against **honest-but-flaky** nodes (bad
  Wi-Fi, mobile, sleep). Demoting a struggling honest node is itself a
  liveness attack if it's too trigger-happy. This must be measured before any
  kernel change (see §6).
- **Eclipse interaction.** If an adversary surrounds you entirely with black
  holes (the B-3 threat), "route around" has nowhere to go. B-3's
  verified-only admission raises the cost of *becoming* all your hops;
  black-hole detection is its **behavioural complement** — B-3 governs *who's
  in your table*, this governs *whether they actually work*.
- **Attestation is the wrong tool.** Endo / Hardened-JS (`lockdown`,
  `codeHash`) makes a node's *own* integrity falsifiable, but a black hole can
  run honest code and still drop at the network layer — and without a browser
  TEE it can lie about `codeHash` anyway. **Behavioural probing, not remote
  attestation, is the answer here.**

## 6. Next steps

1. **Model before building.** Implement black-hole nodes in the heterogeneous
   protocol simulator (`implementation/Heterogeneous-Protocol-Sim-v0.1.md`) —
   omission, selective-omission, equivocation variants — and measure
   **detection latency**, **route-around success**, and above all the
   **false-positive rate against honest-but-flaky nodes**. That number gates
   everything.
2. **Prototype forwarding-vitality** as a local, first-party signal in the sim
   (not the kernel) and tune the demotion/eviction thresholds against the
   false-positive budget.
3. **Equivocation cross-check** as a separate, lower-risk track — it's
   provable and doesn't carry false-positive risk, so it can land earlier.
4. Only then consider a kernel surface (a `forwardingVitality` input to
   routing, analogous to but distinct from the existing liveness eviction).

## 7. Bottom line

We **can** track the behaviour and route around it; we **cannot** prove a node
is acting in bad faith — except via equivocation, which is cryptographically
attributable. The right architecture is a **local forwarding-vitality signal,
fed by end-to-end delivery confirmation over our existing K-path redundancy,
driving route-around** — never a global reputation verdict. Tampering and
replay are already closed; silent omission is the open frontier.
