# Axona Endpoint Defense — The Immune System (v0.2)

**Status:** design synthesis · **Date:** 2026-07-24 · **Baseline:** kernel 4.40.0 (testnet) ·
**Supersedes:** v0.1 (same day) · **Revision:** v0.2 folds in one adversarial review
round (Gemini + internal critique) — banking four proposed fixes, rejecting or
re-aiming four, and promoting **verification authority** to the central open
problem (§7.3). ·
**Relates to:** the six *From Gates to Gradients* notes
([1](Gates-to-Gradients-1-Costly-Identity-v0.2.md),
[2](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md),
[3](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md),
[4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md),
[5](Gates-to-Gradients-5-Agent-Legibility-v0.2.md),
[6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)) ·
[E-1 Placement Defense](E-1-Placement-Defense-v0.1.md) ·
[Author-Class Attestation](../implementation/Author-Class-Attestation-v0.1.md) · whitepaper §10/§12.

**Purpose.** The six *Gates to Gradients* notes each spec one move. This note is the
architecture that assembles them into one defense, adds the edge-compute layer they
don't cover, answers the "sight without a lever" critique head-on — and, as of
v0.2, records what survived an adversarial round and what the design's *actual*
hard problem turned out to be. §7 is written to be attacked; §7.3 is the joint the
whole "commons without a sovereign" claim reduces to.

---

## 0. The critique this answers

Paraphrasing the sharpest external reading (Gemini, 2026-07):

> Automated agents act at machine speed; the gate-free layer is fully available to
> misaligned systems; and stewardship must observe but **never hold a lever** —
> because any intervention mechanism becomes a point of capture. But if a swarm
> attacks at machine speed while the network cannot intervene and human institutions
> are too slow, *sight is functionally useless* — a fire alarm for a city that
> outlawed fire extinguishers. And a well-resourced actor can flood a shared commons
> with indistinguishable AI identities; if reputation is strictly local and no one
> can expel bad actors, the load on human endpoints is immense.

The facts are correct. The answer corrects one inference and completes the design
that inference omits. As of v0.2 the *frame* has survived review; the *hard part*
has moved (§7.3).

---

## 1. The frame: an immune system, not a police force

**The category error.** "The *network* holds no lever" is read as "*no one* holds a
lever." The lever moves to the **edge**, and it runs at machine speed too.
Extinguishers were not outlawed; we refused to appoint one fire marshal with a
master key to every building, because that key gets stolen, subpoenaed, or captured —
at which point it is itself a machine-speed weapon against everyone. **A central
ban-hammer is the largest machine-speed attack surface a system can have.** Handing
every building its own extinguisher is not the weak version; against a machine-speed
adversary it is the strong one, because there is no single point to seize.

**What sight is for.** Sight (notes 2/5) never meant to stop the fire; it makes the
pathogen **legible** so a distributed response propagates at network speed — the
alarm that trips every building's sprinklers at once. The response *is* machine-speed;
it is distributed, not sovereign. Where §10 of the whitepaper undersells itself is in
leaning on "stewardship observes" without showing the machine-speed edge response
that observation is *for*. That response is this document.

**The biological model.** No central authority deletes a pathogen. There are three
functions, and Axona has an analogue of each:

| Immune function | Axona analogue | Status |
|---|---|---|
| Metabolic cost on the invader | memory-hard PoW, address-decoupled | decided (E-1, note 1) |
| Distributed recognition (antibodies) | local web-of-trust + reputation | partly new (§3 layers 2–3) |
| Shared adaptive memory spreading through the population | signed attestation streams on topics | new synthesis (§4 `std/attest`) |
| Fast innate response at every cell | local cognitive firewall (edge model) | new (§3 layer 5) |

No sovereign; still robust. Decisively: **every one of these is a signed message on a
topic**, so the defense inherits the network's neutrality instead of violating it.
Each shield is opt-in, forkable, droppable; none can be imposed, and none sits in the
delivery path. That is what makes this a consistent extension of the architecture,
not a patch.

---

## 2. Threat model

**In scope.** (a) Machine-speed spam / low-entropy floods. (b) Sybil identity swarms.
(c) Coordinated agent swarms (amplification, manufactured consensus). (d)
Illicit-content propagation the endpoint wants to refuse. (e) Targeted
placement/eclipse of a topic root — handled by E-1 (address-decoupled PoW), referenced
not re-specced.

**Adversary.** Well-resourced; machine-speed; can mint many identities *at PoW cost*;
can **refuse to self-identify**; can **fragment / under-declare** to evade
reach-graded friction; can **out-compute a phone**.

**Explicitly out of scope — the honest residual.** A determined adversary against an
endpoint that has **disabled its shields** — the immunocompromised case. This
architecture **raises the floor and prices casual + scaled abuse; it does not
guarantee.** §7.5 and §9 keep that in front.

---

## 3. The layered architecture

Read edge-inward. Every layer is an existing *Gates to Gradients* move or marked
**NEW**. **Nothing here is in the delivery path** — the mesh always delivers the bytes;
each layer changes only what the endpoint **admits, weights, or renders**.

- **Layer 0 — Costly identity (Sybil floor).** Memory-hard PoW on a puzzle hash
  *decoupled from the node address* (E-1, note 1). No authority adjudicates it. It
  *raises* Sybil cost; it does not prevent Sybils — the layers above filter the
  residue. *Decided, needs shipping.*

- **Layer 1 — Legibility.** Voluntary **agent-class attestation** (note 5) shapes the
  honest default; a filter throttles or quarantines agent-class traffic *by the
  reader's choice*. Plus **cascade telemetry** (note 2): aggregate,
  privacy-preserving measurement of *how* things propagate. You cannot steer what you
  refuse to measure.

- **Layer 2 — Shared immune memory as topics (`std/attest`).** **NEW synthesis (§4).**
  One signed-claim envelope family unifying note 4 (filter/reputation sets), note 5
  (agent class), note 3 (retraction/annotation), plus **vouches** and **verified
  claims** — reusing the bridge-directory / metric-topic discover/subscribe/merge
  pattern already proven in production. Adaptive immunity that spreads through the
  population, entirely opt-in.

- **Layer 3 — Web of trust.** **NEW** (generalizes note 5's one-hop operator
  countersignature). Clients build a **local transitive trust graph** — EigenTrust /
  personalized PageRank rooted at the user's own contacts — over subscribed `vouch`
  attestations. A swarm minted in seconds has **zero inbound trust from *your*
  graph** → an "unknown" tier by construction, no ban required. Reputation is
  **local-by-default but composable**. *v0.2 addition:* a newcomer on-ramp via
  **pairing-time bootstrap vouches** (see §7.1).

- **Layer 4 — Verified claims (ZK).** **NEW** (extends note 5 from self-declared to
  cryptographically backed). A `std/attest` claim may carry a zero-knowledge proof
  (Semaphore / ZK-email / ZK-passport / org-membership) asserting "a unique human" or
  "a verified member of Org Y" without linking the durable author key to a real
  identity. The app renders only claims that verify. **This layer is where the
  design's central unresolved problem lives — see §7.3.**

- **Layer 5 — Local cognitive firewall (the personal AI gatekeeper).** **NEW — not in
  the series.** A model on the user's own device scores each incoming envelope before
  the UI: semantic spam, cross-topic coordination, low-entropy repetition. Matches
  machine speed at zero network cost, private, user-controlled. *v0.2 addition:* a
  **deterministic heuristic tier** (n-gram/entropy/keygen-timestamp deltas) as the
  universal low-power fallback (see §7.1) so a phone that cannot run a model still has
  *a* shield.

- **Cross-cutting — Friction scaled to reach.** Reach-/congestion-graded PoW demanded
  by the K-closest roots that already see a topic's subscriber-set size, plus per-relay
  damping (note 6). The **only** mechanism partly below the app. *v0.2 decision:* it
  stays **identity-blind** (see §7.2) — rate-/reach-triggered, address-decoupled,
  pricing *what a message does*, never *who sent it*. Ships last and most cautiously.

---

## 4. The keystone to build first: the `std/attest` convention

The highest-leverage move, because it is the interoperability substrate the whole
immune system needs, and it is cheap. As `std/message` fixed cross-app `[object
Object]` and `std/chunk` fixed cross-app binary, **`std/attest` makes immune signals
interoperable across every client** instead of trapping each in a per-app silo.

```jsonc
// std/attest v0 — a signed claim. Rides ordinary signed pub/sub.
{
  "kind": "axona:attest:v0",
  "type": "vouch" | "reputation" | "blocklist" | "class" | "annotation" | "verified-claim",
  "subject": { "author": "<authorId>" }        // or { "msgId": … } or { "topic": … },
  "claim":   { /* type-specific: weight, tag, proof, correction text, class … */ },
  "ttl":     <seconds>,                          // immune memory ages out; not permanent record
  "issuer":  "<authorId of the curator / voucher / attester>"
  // signed by `issuer`; verified against `subject` the same way envelopes verify.
}
```

- **vouch** → `{ subject.author, weight }` — the web-of-trust edge (layer 3), and the
  carrier for pairing-time bootstrap vouches (§7.1).
- **reputation / blocklist** → a curator's subscribable stream (note 4, layer 2).
- **class** → the agent/human declaration (note 5) folded into the family.
- **annotation** → a correction/dispute referencing a `msgId` (note 3).
- **verified-claim** → carries a ZK proof (layer 4). See §7.3 on the issuer.

Discovery reuses the bridge-directory pattern; clients rank issuers by their *own*
trust graph. **No new kernel primitive** — app-layer convention plus a reference
implementation, exactly what note 4 concluded for filter sets.

---

## 5. The Endpoint Security SDK

Package the layers so an app developer gets shields out of the box rather than
re-deriving them (the way apps mis-derived bootstrap):

```js
const shield = createEndpointShield({
  identity,                               // my author id — roots the trust graph
  filters:    ['reputable-curator-A', 'community-B'],  // std/attest streams I follow
  wot:        { depth: 3, algo: 'eigentrust', bootstrapVouches: true },
  gatekeeper: localModel ?? heuristicTier,             // edge model, or the cheap fallback
  curatorDecay: 'hebbian',                // demote curators that conflict with my actions (§7.1)
  policy:     { unknownTier: 'collapse', requireHumanProof: false },
});

peer.sub(topic, (env) => {
  const verdict = shield.evaluate(env);   // { tier, score, reasons } — synchronous, local
  if (verdict.tier === 'blocked') return;
  render(env, verdict);                    // trusted → inline; unknown → collapsed; agent → badged
});
```

The decisive detail is **defaults**: a safe starter policy (a few reputable curator
streams + the user's own WoT + agent-class badging) so the *baseline* endpoint is
protected without configuration — you opt *out* of immunity, not in. (Whether that
recreates a soft default authority is §7.5.)

*v0.2 additions folded into the SDK:* **Hebbian curator decay** (a curator whose flags
repeatedly conflict with the user's own actions loses local weight — Axona's
long-term-depression routing philosophy applied to reputation; strictly local, never
shared) and the **heuristic gatekeeper tier** for low-power devices.

---

## 6. Neutrality & capture analysis

Invariant every layer satisfies: **opt-in, user-selected, forkable, droppable — and
never in the delivery path.**

- The **mesh** still routes and delivers every signed byte; no layer here stops a
  message reaching a willing subscriber. Defense is *admission/weight/render* at the
  edge, not *delivery* in the middle.
- **Filter curators / WoT vouchers / ZK issuers are not in the routing or role graph** —
  they are authors publishing `std/attest` topics. A captured or corrupt one is
  unsubscribed, not fought. Same line as the bridge rule: **the immune system rides
  the network; it never governs it.**
- **Forkability is the release valve** (note 4): any filter set is republished under a
  new key. No canonical list. *(Whether forkability is enough against network-effect
  concentration is §7.2.)*

Reach-graded friction (note 6) is the one mechanism acting in the middle. It stays
neutral by being **identity-blind and reach-triggered** (§7.2). The proposed
trust-weighted discount was **rejected** precisely because it would have broken this
invariant (§7.2).

---

## 7. Open problems — after one adversarial round (2026-07-24)

The v0.1 §7 listed seven joints. One review round resolved four, sharpened two, and
promoted one to the center. Recorded here so the next reviewer inherits the sharper
target, not the original list.

### 7.1 Resolved / banked

- **Newcomer on-ramp → pairing-time bootstrap vouches.** When a new user joins via
  QR / direct pairing, the introducing peer auto-issues a **low-weight, time-bounded**
  `std/attest:vouch`. An *invited* newcomer starts with real (if small) inbound trust,
  mirroring how social onboarding actually works. *Bounded risk:* a malicious inviter
  vouching for a sock-puppet swarm — but EigenTrust bounds this (a low-centrality
  voucher confers almost nothing). *Residual:* the **cold, uninvited** newcomer still
  has no on-ramp except the ZK fast-path → which routes to §7.3.

- **Recursion termination → grounds at the self.** The immune channels are themselves
  floodable (v0.1 §7.5), so the defense is recursive. The fixed point: every trust
  chain ultimately traces back to *you* and whom *you* directly trust. Curators
  needing recursion protection publish under their own WoT + PoW; the chain terminates
  at the reader's personal trust root. The turtles stop at the self. **Resolved.**

- **Bad-curator correction → Hebbian / LTD decay.** The SDK measures how often the user
  overrides a subscribed curator (un-blocks flagged content); a curator whose flags
  repeatedly conflict with the user's revealed preference **decays in local weight**.
  Elegant and on-thesis (LTD is Axona's own routing rule). Kept — *but it addresses the
  wrong half of the concentration problem; see §7.2.*

- **Compute floor → deterministic heuristic tier.** Low-spec devices fall back to
  cheap, universal heuristics (low-entropy strings, keygen-timestamp deltas, duplicate
  n-gram hashing) before rendering, so everyone gets *a* shield without a local model.
  *Rejected as the equity fix:* offloading the model to "a trusted home server /
  desktop" only helps users who **own a second device** — precisely *not* the
  mobile-only, low-resource user the compute asymmetry disadvantages. The heuristic
  tier is the real equalizer; a *better* shield still tracks your hardware (§7.5).

### 7.2 Sharpened but open

- **Friction must stay identity-blind (revises v0.1 §7.1).** A proposed
  **trust-weighted PoW discount** was **rejected on two counts.** (1) A discount by
  *WoT centrality* at the topic root requires the root to consult a trust view — but
  WoT is reader-relative; there is no canonical global trust for the root to read
  *without building the reputation oracle we abolish*. (2) Trust-weighted friction
  builds a **two-tier speech system** where the credentialed insider flows free and
  the *anonymous* publisher pays full freight — and anonymity is first-class in Axona
  (the author/transport split, the `ANONYMOUS` sentinel). The breaking-news case the
  discount meant to protect is often exactly the anonymous, zero-WoT journalist, whom
  it would tax. **Decision: friction stays identity-blind at the root.** The *only*
  sound discount is a **self-contained ZK proof** the root can verify locally — which
  pushes into §7.3.

- **Curator *concentration* is untouched.** Hebbian decay demotes a curator that is
  *wrong for you*; it does nothing about a curator that is *right* becoming a **de-facto
  standard** (the EasyList problem) whose rare, controversial suppressions ride for
  free because most users never encounter or override them. Concentration-of-power and
  per-user-quality are different axes. Forkability is the release valve, but forking
  carries coordination cost and Metcalfe pressure runs the other way. **Open — and
  possibly a governance/UX problem the protocol cannot solve, only shape.**

### 7.3 The central problem: verification authority

Promoted from a §7 bullet to the center, because **every unresolved thread routes
here.** The cold-newcomer on-ramp wants it (ZK fast-path, §7.1). The anti-Sybil
"prove you're a human" wants it. The *only* sound friction discount wants it (§7.2).
Each reaches for a **credential issuer** — and thereby **relocates the sovereign to
the issuer** rather than abolishing it. An app that "requires a human proof" has
delegated the human/not-human verdict to whoever issues the proof.

So the whole "commons without a sovereign" claim reduces to one question:
**can you become a legible human here without asking anyone's permission?**

Three options, none clean:

- **(a) Plural, competing issuers, no canonical one** — "human-ness" is a *market* of
  attestations you weight locally like any other curator. Pushes §7.3 into §7.2's
  frame — and inherits its concentration risk.
- **(b) A bounded set of trusted issuers** — honest and workable, but an explicit soft
  authority, exactly the thing the architecture is meant to avoid.
- **(c) WoT-only onboarding, no ZK** — no issuer at all, but the cold, uninvited
  newcomer has no on-ramp and the anonymous actor cannot prove humanity.

This must be **decided at design level before Layer 4 or the on-ramp is built** (§8).
It is the load-bearing joint.

### 7.4 The shape of the problem: a ring, not a list

The open problems are **coupled**, and the coupling is the real finding: newcomer → ZK
fast-path → issuer authority → (to avoid authority) → plural-issuer market →
concentration → (the curator problem) → and Hebbian decay only partly answers *that*.
Solving one joint by reaching for another just moves the pressure around the ring.
This is not a defect in the design; it is the **actual topology of "safety without a
sovereign,"** and naming it is more honest than pretending the joints are independent.
The design's job is not to break the ring (it may not be breakable) but to make every
point on it **opt-in, plural, and forkable**, so no single point becomes a chokepoint —
and to be honest that the ring exists.

### 7.5 Honest costs (unchanged, priced not eliminated)

Friction false-positives on genuinely organic high-reach cascades (note 6 owns this);
the compute-asymmetry residual (a better shield tracks better hardware); the
naive-default residual (a user who trusts a compromised curator or disables shields is
exposed). We price these; we do not remove them.

---

## 8. Build order

1. **`std/attest` convention + spec + reference merge** — the interop substrate; folds
   notes 3/4/5 into one envelope family. Cheap; unblocks everything.
2. **GATE — decide §7.3 (verification authority):** (a) plural-issuer market / (b)
   bounded trusted issuers / (c) WoT-only. **Layer 4 and the cold-newcomer on-ramp
   depend on this; do not build them before the decision.**
3. **Generalize `authorClass` → `vouch` / `verified-claim`; ship the WoT graph lib**
   (layer 3), including **pairing-time bootstrap vouches**.
4. **Endpoint Security SDK** — filter-merge + WoT + **Hebbian curator decay** +
   gatekeeper hook + **heuristic fallback tier**, with safe defaults (layers 2–5).
5. **Cascade telemetry** (note 2) — the ruler, so we can *measure* whether any of this
   changes propagation.
6. **Reach-graded friction** (note 6, **identity-blind**) — the one kernel-side piece;
   ships **last and most cautiously** (least-confident, most false-positive-prone).

The **personal AI gatekeeper** rides in the SDK as a reference implementation and
iterates independently — it needs no protocol change, only clean signed envelopes with
stable author IDs, which the kernel already provides.

---

## 9. Proposed whitepaper narrative (§10 "What Goes Wrong" / §12 "Stewardship")

Adopt this framing in the whitepaper — with the honesty of §7.5 bolted on, so it does
not oversell (the §7.5 trap):

> **The machine-speed shield.** A network with no central control panel cannot deploy a
> network-wide ban against an automated swarm — and that is deliberate: a lever strong
> enough to silence an adversary is a lever strong enough to silence anyone, and is the
> single richest prize a captor could seize. The defense against machine-speed harm is
> not central enforcement but **distributed cellular immunity**. Through interoperable
> attestation streams, local webs of trust, verifiable claims, and local edge-AI
> gatekeepers, every endpoint carries its own automated, machine-speed shield. The
> network stays strictly neutral in transport; the endpoints stay fully empowered in
> defense.
>
> This raises the floor and prices the invader; it is not a guarantee. An immune
> system can be overrun — a determined adversary against an unshielded endpoint gets
> through, and the market of curators and attesters can drift toward soft gates. That
> is the price of having no sovereign, and we pay it on purpose.

---

## 10. Honest close

We chose distributed, opt-in immunity because the alternative — a lever strong enough
to stop the swarm — is a lever strong enough to stop **you**, and is the richest prize
an attacker, a state, or the operators themselves could ever capture. The immune system
we build in its place can be **overwhelmed**: the cold-newcomer problem is real, the
curator market can concentrate, and — the finding of v0.2 — the sharp joints form a
**ring** that routes, again and again, through the one question we have not answered:
*can you be a legible human here without anyone's permission?* That is the price of no
sovereign, and the whitepaper should say it in exactly those words. What the
architecture can honestly promise is what an immune system promises: raise the floor,
price the invader, spread recognition through the population at machine speed, and give
every cell its own defense — so the society of minds is **survivable** at its edges, not
that it is safe.
