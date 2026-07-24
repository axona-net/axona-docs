# Axona Endpoint Defense — The Immune System (v0.1)

**Status:** design synthesis · **Date:** 2026-07-24 · **Baseline:** kernel 4.40.0 (testnet) ·
**Relates to:** the six *From Gates to Gradients* notes
([1 costly identity](Gates-to-Gradients-1-Costly-Identity-v0.2.md),
[2 cascade telemetry](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md),
[3 soft retraction](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md),
[4 forkable filter sets](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md),
[5 agent legibility](Gates-to-Gradients-5-Agent-Legibility-v0.2.md),
[6 friction scaled to reach](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)) ·
[E-1 Placement Defense](E-1-Placement-Defense-v0.1.md) ·
[Author-Class Attestation](../implementation/Author-Class-Attestation-v0.1.md) · whitepaper §10.

**Purpose.** The six *Gates to Gradients* notes each spec one move. This note is
the **architecture that assembles them into a single defense** — and adds the
edge-compute layer they don't cover — and answers, head-on, the standing critique
of the whole approach. It is deliberately written to be **attacked**: §7 is a list
of the joints where it is weakest.

---

## 0. The critique this answers

Paraphrasing the sharpest external reading of the whitepaper (Gemini, 2026-07):

> You acknowledge automated agents act at machine speed, that the gate-free layer
> is fully available to misaligned systems, and that stewardship must observe but
> **never hold a lever** over the network — because any intervention mechanism
> becomes a point of capture. But if a swarm executes a machine-speed attack and
> the network cannot intervene while human institutions are too slow, then *sight
> is functionally useless*. You are building a fire alarm for a city that has
> outlawed fire extinguishers. And in a shared commons, a well-resourced actor can
> flood the space with indistinguishable AI identities; if reputation is strictly
> local and no one can expel bad actors, the cognitive load on human endpoints is
> immense.

This is the right place to press. The answer is not a rebuttal of the facts —
they are correct — but a correction of one inference and a completion of the
design that inference leaves out.

---

## 1. The frame: an immune system, not a police force

**The category error.** "The *network* holds no lever" is read as "*no one* holds
a lever." Those are not the same. The lever moves to the **edge** — and it runs at
machine speed too. Extinguishers were not outlawed; we refused to appoint one fire
marshal with a master key to every building, because that key gets stolen,
subpoenaed, or captured — at which point it is itself a machine-speed weapon
against everyone. Handing an extinguisher to every building is not the weak version
of central firefighting; against a machine-speed adversary it is the **strong**
one, because there is no single point the attacker can seize to disable everyone's
defense at once. **A central ban-hammer is the largest machine-speed attack surface
a system can have.**

**What sight is actually for.** Sight (notes 2/5) was never meant to stop the fire.
Its job is to make the pathogen **legible** so a distributed response propagates at
network speed — the alarm that trips every building's sprinklers at once. The
response *is* machine-speed; it is simply distributed, not sovereign. Where the
whitepaper undersells itself, and where the critique lands, is that §10 leans on
"stewardship observes" without showing the machine-speed edge response that
observation is *for*. That is this document.

**The biological model.** A body has no central authority that deletes a pathogen.
It has three things, and Axona already has an analogue of each:

| Immune function | Axona analogue | Status |
|---|---|---|
| Metabolic cost imposed on the invader | memory-hard PoW, address-decoupled | decided (E-1, note 1) |
| Distributed recognition (antibodies) | local web-of-trust + reputation | **partly new** (§3, layers 2–3) |
| Shared adaptive memory that spreads through the population | signed attestation streams on topics | **new synthesis** (§4, `std/attest`) |
| A fast innate response at every cell | local cognitive firewall (edge model) | **new** (§3, layer 5) |

No sovereign; still robust. And decisively: **every one of these is built from the
network's own primitive — a signed message on a topic — so the defense inherits the
network's neutrality instead of violating it.** Each shield is opt-in and forkable;
none can be imposed, and none sits in the delivery path. That is what makes this a
consistent extension of the architecture rather than a patch bolted onto it.

---

## 2. Threat model

**In scope.** (a) Machine-speed spam / low-entropy floods. (b) Sybil identity
swarms — one operator, thousands of keys. (c) Coordinated agent swarms —
cross-topic amplification and manufactured consensus. (d) Illicit-content
propagation the endpoint wants to refuse. (e) Targeted placement / eclipse of a
topic root — already handled by E-1 (address-decoupled PoW), referenced not
re-specced here.

**Adversary.** Well-resourced; machine-speed; can mint many identities *at PoW
cost*; can **refuse to self-identify** (agent-class is voluntary); can **fragment
and under-declare** to evade reach-graded friction; can out-compute a phone.

**Explicitly out of scope — the honest residual.** A determined adversary against
an endpoint that has **disabled its shields** — the immunocompromised case. This
architecture **raises the floor and prices casual + scaled abuse; it does not
guarantee.** The whole point of §7 and §9 is to keep that honesty in front.

---

## 3. The layered architecture

Read it edge-inward. Every layer is either an existing *Gates to Gradients* move or
marked **NEW**. Nothing here is in the message **delivery** path — the mesh always
delivers the bytes; each layer only changes what the endpoint **admits, weights, or
renders**.

- **Layer 0 — Costly identity (the Sybil floor).** Memory-hard PoW on a puzzle hash
  *decoupled from the node address* (E-1, note 1). No authority adjudicates it; it
  is simply not free to run a thousand. It **raises** the Sybil cost; it does not
  prevent Sybils — the layers above filter the residue. *Decided, needs shipping.*

- **Layer 1 — Legibility (make the traffic readable).** Voluntary **agent-class
  attestation** on the publish identity (note 5) shapes the honest default; a
  filter can throttle or quarantine agent-class traffic *by the reader's choice*.
  Plus **cascade telemetry** (note 2) — aggregate, privacy-preserving measurement of
  *how things propagate* (fan-out shape, agent:human ratio, retraction-vs-bytes
  race). You cannot steer what you refuse to measure; telemetry is the ruler that
  tells us whether any layer below is working.

- **Layer 2 — Shared immune memory as topics (`std/attest`).** **NEW synthesis
  (§4).** One signed-claim envelope family that unifies note 4 (filter/reputation
  sets), note 5 (agent class), note 3 (retraction/annotation), plus **vouches** and
  **verified claims**. Reputation entries, blocklists, corrections, endorsements —
  all become signed messages on derived topics, reusing the exact
  discover/subscribe/merge pattern the **bridge directory** and **metric topics**
  already prove in production. Adaptive immunity that spreads through the
  population — and is entirely opt-in.

- **Layer 3 — Web of trust (transitive discernment).** **NEW** (generalizes note
  5's one-hop operator countersignature). Clients build a **local transitive trust
  graph** — EigenTrust / personalized PageRank rooted at the user's own contacts —
  over subscribed `vouch` attestations. This is the direct answer to Sybil: a swarm
  manufactured in seconds has **zero inbound trust** from *your* graph, so it lands
  in an "unknown" tier by construction, no ban required. It is also the answer to
  the cognitive-load objection: reputation is **local-by-default but composable** —
  you do not build the graph from scratch, you inherit it from whom you already
  trust.

- **Layer 4 — Verified claims (ZK).** **NEW** (extends note 5 from *self-declared*
  to *cryptographically backed*). A `std/attest` claim may carry a zero-knowledge
  proof — Semaphore / ZK-email / ZK-passport / org-membership — asserting "a unique
  human" or "a verified member of Org Y" **without** linking the durable Axona
  author key to a real-world identity. The app enforces a local rule ("only render
  claims that verify in the main thread"); the kernel never learns what ZK is. Bot
  swarms cannot forge valid human proofs without paying real-world cost.

- **Layer 5 — Local cognitive firewall (the personal AI gatekeeper).** **NEW — the
  piece the series does not cover.** A lightweight model on the user's own device
  (WebGPU / local runtime) scores each incoming signed envelope *before it reaches
  the UI*: semantic spam, cross-topic coordination signatures, low-entropy
  repetition. It matches machine speed with machine speed at **zero network cost**,
  is **private** (rules never leave the device), and is fully under the user's
  control. This is the innate immune response at every cell — and it is the layer
  that makes "human endpoints survive machine-speed noise" actually true rather than
  aspirational.

- **Cross-cutting — Friction scaled to reach.** Reach-/congestion-graded PoW
  demanded by the K-closest roots that already see a topic's subscriber-set size,
  plus per-relay damping (note 6, a generalization of the bounded-queue / quota /
  hold-time machinery already shipped). This is the **only** mechanism that sits
  partly below the app (the topic-root cohort enforces it). It is designed neutral:
  **rate-/reach-triggered, identity-blind, address-decoupled** — it prices *casual
  and scaled amplification*, and note 6 is explicit that a determined, fragmenting
  adversary evades it. It is the least-confident move and (§8) ships last.

---

## 4. The keystone to build first: the `std/attest` convention

The single highest-leverage move, because it is the interoperability substrate the
whole immune system needs — and it is cheap. Exactly as `std/message` fixed
cross-app `[object Object]` and `std/chunk` fixed cross-app binary, **`std/attest`
makes immune signals interoperable across every client** instead of trapping each
one in a per-app silo.

An attestation is a signed claim about a **subject**, published to a derived topic,
readable and mergeable by anyone, droppable at will:

```jsonc
// std/attest v0 — a signed claim. Rides ordinary signed pub/sub.
{
  "kind": "axona:attest:v0",
  "type": "vouch" | "reputation" | "blocklist" | "class" | "annotation" | "verified-claim",
  "subject": { "author": "<authorId>" }        // or { "msgId": … } or { "topic": … },
  "claim":   { /* type-specific: score, tag, proof, correction text, class … */ },
  "ttl":     <seconds>,                          // immune memory ages out; it is not permanent record
  "issuer":  "<authorId of the curator/voucher>",
  // signed by `issuer`; verified against subject the same way envelopes verify.
}
```

- **vouch** → `{ subject.author, weight }` — the web-of-trust edge (layer 3).
- **reputation / blocklist** → a curator's stream a client subscribes to (note 4, layer 2).
- **class** → the agent/human declaration (note 5, layer 1) folded into the same family.
- **annotation** → a correction/dispute referencing a `msgId` (note 3).
- **verified-claim** → carries a ZK proof (layer 4).

Discovery reuses the bridge-directory pattern: a curator hosts its stream on a
well-known derived topic; clients rank issuers by their *own* trust graph. **No new
kernel primitive** — this is app-layer convention plus a reference implementation,
which is precisely what note 4 already concluded for filter sets.

---

## 5. The Endpoint Security SDK

Package the layers as a composable client library so an app developer gets shields
out of the box rather than re-deriving them (and mis-deriving one, the way apps
mis-derived bootstrap):

```js
const shield = createEndpointShield({
  identity,                        // my author id — roots the trust graph
  filters:   ['reputable-curator-A', 'community-B'],   // std/attest streams I subscribe to
  wot:       { depth: 3, algo: 'eigentrust' },         // transitive trust from my contacts
  gatekeeper: localModel,          // optional edge SLM hook
  policy:    { unknownTier: 'collapse', requireHumanProof: false },
});

peer.sub(topic, (env) => {
  const verdict = shield.evaluate(env);   // { tier, score, reasons }  — synchronous, local
  if (verdict.tier === 'blocked') return;
  render(env, verdict);                    // trusted → inline; unknown → collapsed; agent → badged
});
```

The decisive detail is **defaults**. The SDK ships a safe starter policy — a small
set of reputable curator streams + the user's own WoT + agent-class badging — so
the *baseline* endpoint is protected without configuration. That is the design's
answer to the immunocompromised-default problem: you have to *opt out* of immunity,
not opt in. (Whether that itself recreates a soft default authority is open question
§7.3.)

---

## 6. Neutrality & capture analysis

The invariant every layer must satisfy: **opt-in, user-selected, forkable, droppable
— and never in the delivery path.** Checked per mechanism:

- The **mesh** still routes and delivers every signed byte; no layer here can stop a
  message reaching a willing subscriber. Defense is *admission/weight/render* at the
  edge, not *delivery* in the middle.
- **Filter curators / WoT vouchers / ZK issuers are not in the routing or role
  graph** — they are just authors publishing `std/attest` topics. They hold no lever
  over the network; a captured or corrupt curator is unsubscribed, not fought. This
  is the same line as the bridge rule (bridge = transport, never a root/child/relay):
  **the immune system rides the network; it never governs it.**
- **Forkability is the release valve** (note 4): a filter set is republished under a
  new key by anyone. There is no canonical list.

Reach-graded friction (note 6) is the one mechanism that acts in the middle (a root
demands PoW). It stays neutral by being **identity-blind and reach-triggered** — it
prices *what a message does* (fan out to 100k strangers), never *who sent it*, and
the PoW is on a decoupled puzzle hash, so it cannot skew placement.

---

## 7. Open questions — the joints where this is weakest (attack these)

1. **Friction false-positives.** Reach-graded PoW prices scaled amplification — but a
   *legitimate* breaking-news event is also a sudden high-reach cascade. Does the
   friction tax the town square exactly when it matters most? Note 6 already flags
   this as its least-confident move; the synthesis inherits the doubt. Can telemetry
   (note 2) distinguish an organic cascade from a manufactured one *without* content
   surveillance?

2. **The web-of-trust cold-start / newcomer problem.** A brand-new *legitimate*
   human has zero inbound trust — indistinguishable, to a strict WoT filter, from one
   of ten thousand Sybils. The mechanism meant to solve Sybil recreates a gate at the
   door for real newcomers. What is the honest on-ramp that does not put *someone* in
   the position of deciding who is real? (Verified claims / layer 4 are one answer —
   but see §7.4.)

3. **Curator centralization drift (the EasyList problem).** Filter sets are formally
   opt-in and forkable, but network effects push a commons toward a few dominant
   curators — at which point "opt-in" is a soft chokepoint with a de-facto editor.
   Forking has real coordination cost; Metcalfe pressure runs the other way. Is
   opt-in + forkable *actually* enough to prevent the re-emergence of a gate, or does
   it merely make the gate deniable?

4. **ZK issuers as relocated authority.** A ZK-human proof is only as trustworthy as
   its issuer (a passport authority, an org). Layer 4 may not remove central authority
   so much as **relocate** it to the proof issuer — and now the app that "requires a
   human proof" has quietly delegated the human/not-human verdict to whoever issues
   the proof. Is that better than a network ban-hammer, or the same capture wearing a
   ZK costume?

5. **The immune system needs its own immune system.** The `std/attest` topics are
   themselves floodable — a Sybil swarm can spam reputation/vouch streams. The same
   friction/PoW/WoT bounds it, which means the defense is **recursive**: turtles
   some number down. Where does the recursion terminate, and is the fixed point
   stable or merely deferred?

6. **Edge-compute asymmetry.** Layer 5 (the personal gatekeeper) is only as strong as
   the endpoint's silicon. A resource-rich adversary out-computes a phone. Does
   pushing defense to the edge quietly **advantage the well-resourced user** and leave
   the least-equipped most exposed — the opposite of the commons' promise?

7. **The naive-default residual.** Even with safe SDK defaults, a user who trusts a
   compromised curator, or disables shields, is exposed. We accept this as the price
   of no sovereign. Is the document honest enough that "distributed, opt-in immunity"
   is a **bounded** guarantee — the floor is raised, casual and scaled abuse is
   priced — and not quietly sold as safety?

---

## 8. Build order

1. **`std/attest` convention + spec + reference merge** — the interop substrate;
   folds notes 3/4/5 into one envelope family. Cheap, unblocks everything.
2. **Generalize `authorClass` → `vouch` / `verified-claim`; ship the WoT graph lib**
   (layer 3, and the on-ramp for layer 4).
3. **Endpoint Security SDK** composing filter-merge + WoT + attestation-verify +
   the gatekeeper hook, with safe defaults (layers 2–5).
4. **Cascade telemetry** (note 2) — the ruler, so we can *measure* whether any of
   the above changes propagation. Highest-leverage instrument, easiest to
   under-prioritize.
5. **Reach-graded friction** (note 6) — the one kernel-side piece; ships **last and
   most cautiously**, because it is the least-confident move and the most
   false-positive-prone (§7.1).

The **personal AI gatekeeper** rides in the SDK as a reference implementation and
iterates independently — it needs no protocol change, only clean signed envelopes
with stable author IDs, which the kernel already provides.

---

## 9. The honest close

We chose distributed, opt-in immunity because the alternative — a lever strong
enough to stop the swarm — is a lever strong enough to stop **you**, and that lever
is the single richest prize an attacker (or a state, or the operators themselves)
could ever capture. The immune system we build in its place can be **overwhelmed**:
a determined adversary against an unshielded endpoint gets through, the newcomer
problem is real, and the curator market can drift toward soft gates. That is the
price of having no sovereign, and the whitepaper should say it in exactly those
words. What the architecture *can* honestly promise is what an immune system
promises: raise the floor, price the invader, spread recognition through the
population at machine speed, and give every cell its own defense — so that the
society of minds is *survivable* at its edges, not that it is safe.
