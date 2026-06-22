# From Gates to Gradients — 5. Make agents legible as agents (v0.2)

**Status:** design note · **Flagged:** 2026-06-15 · **Revised:** 2026-06-21 (v0.2 — refreshed against the kernel 3.6.0 surface) · **Relates to:** the companion essay *From Gates to Gradients* (critique-from-within of the Axona Synopsis); primary grounding [`implementation/Decoupled-Publish-Identity-and-C3-v0.1.md`](../implementation/Decoupled-Publish-Identity-and-C3-v0.1.md); sibling notes [1](Gates-to-Gradients-1-Costly-Identity-v0.2.md), [2](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md), [3](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md), [4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md), [6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)

---

## TL;DR

Publishers and subscribers on a network like Axona are increasingly **machines** — AI agents acting at a tempo our institutions were never built to match. The danger is not their *presence*; it is their **indistinguishability** from civic actors. This note specs one move: a protocol-level **agent identity class** — a voluntary, signed provenance carried on the *publish identity* that declares "this publisher is an agent." It gates no one and slows nothing. It lets a person knowingly choose their exposure to machine-speed traffic, and lets the accidental human-latency damping our institutions relied on be **restored by choice** (a filter can throttle or quarantine agent-class traffic — see notes [4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md) and [6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)). It is self-declared, so it shapes the honest default — it is not detection.

---

## 1. The idea

Add a **voluntary, signed class attestation** to the publish layer: a small claim, signed by the publishing key, that says *this publisher is an agent* (or, symmetrically, *this is a human-operated identity*). It is provenance the publisher chooses to attach to its own messages — nothing more.

Crucially, it is **not** a gate. It does not condition routing, does not require approval, does not slow delivery, and is not checked by the kernel before a message moves. It is a fact about authorship that the publisher volunteers and that downstream subscribers and filters may *read* and act on however they choose. The legibility lives at the edges, not in the middle.

This is the "governance unbundled from control" pattern the essay argues for: instead of a chokepoint that decides who may speak at machine speed, the network exposes a *legible signal* and pushes the choice of what to do with it out to each participant.

## 2. How it helps

The qualitatively new fact is that a growing share of publishers and subscribers are machines. An agent can author, amplify, and react far faster than any human in the loop. The essay's diagnosis is precise: human latency — sleep, doubt, the need to be persuaded — was the system's **accidental damping**. It was the refractory period that let a cascade meet friction before it ran. Agents strip that damping out.

Legibility lets the damping be **restored by choice** rather than re-imposed by a gatekeeper:

- A subscriber can decide, knowingly, how much machine-speed traffic to admit into their feed — all of it, none of it, or some of it under a delay.
- A **forkable filter set** (note [4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md)) can downrank, batch, rate-limit, or quarantine agent-class messages, and communities can share and fork those rules without anyone holding a central switch.
- **Friction scaled to reach** (note [6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)) can use the class signal as one input: agent-class traffic aimed at wide reach can be made to earn its propagation, while a human posting to friends pays nothing.

The point is not to suppress agents — many are useful, and many civic functions will be agent-mediated. The point is to end their **indistinguishability**, so that the choice to engage with machine-tempo traffic is made with eyes open rather than by default.

## 3. How Axona provides it

**Mechanism.** Axona already separates *who routes* from *who authors* — and that separation is now **shipped**, not in flight. As of the v3.0 identity flag-day, `createAuthorIdentity` mints a **location-free author keypair** whose pubkey is the `signerPubkey` on every envelope, wholly distinct from the `createNodeIdentity` routing key; authorship is verified against the author key independently of the routing identity. That author identity is the natural carrier for a class attestation:

- The class claim is a small, domain-tagged signed assertion bound to the **publish key** — structurally analogous to the `OwnershipProof` primitive in the publish-identity spec (a signature by the owning key over a domain-tagged payload), and reusing the same "prove it with the key, don't merely claim it" discipline. A subscriber that reads the attestation can verify it was signed by the same key that signed the message, so the class is cryptographically *bound to the author*, not asserted by a third party.
- It rides at the **app / publish-identity layer**, attached by the publisher, read by subscribers and filters — exactly where Axona already puts opt-in, author-volunteered facts.

**Critical design constraint — opt-in, never in the mandatory kernel envelope.** This must stay at the publish-identity / application layer and must **not** become a required field in the kernel routing envelope. Axona's kernel envelope discloses **WHO** (`signerPubkey`) and deliberately never **WHERE** — and that line has been defended in code: an attempt to add publisher node-id / region to the envelope was **reverted (kernel v2.41.1)** precisely to preserve it. A self-declared human/agent class is a *smaller* disclosure than location, but it is **still a disclosure**. Therefore it must be opt-in provenance the publisher chooses to attach to its own publish identity — not a mandatory routing field every publisher is forced to populate. Forcing it into the envelope would re-create a gate (and a surveillance surface) of exactly the kind this series rejects.

**Roadmap status.** The precondition this note depended on has **landed**: a
publish identity now exists as a first-class, separately-keyed object
(`createAuthorIdentity`, v3.0). So a signed class attestation is now purely
**additive** — a domain tag, a small payload, and subscriber/filter-side reading
logic; no new kernel wire field, no change to routing.

And the motivating scenario is **no longer hypothetical.** As of the persistent
MCP peer (`axona-relay` v0.18.x), an **AI agent — Claude — already publishes to
the production network with a durable author identity** (a stable `signerPubkey`
persisted across restarts), subscribing and hosting topics like any human-driven
peer. That is exactly the indistinguishability this note is about: today a
subscriber cannot tell that author key from a human's. An agent operating a
durable, persisted author identity is the **obvious first honest emitter** of a
voluntary agent-class attestation — it has a stable key to bind the claim to and a
cooperative incentive to be legible. This note is still *specced as a sketch*, not
yet scheduled, but its substrate and its use case are both now live.

## 4. Honest limits

- **It is self-declared.** A determined or deceptive actor will simply **not flag itself**, or will flag **falsely** (a human-run identity claiming agent status, or — the worrying case — an agent claiming to be human). The attestation shapes the *honest default* and hands willing participants a knob; it is **not detection**. This is the series' "cannot be bought" boundary restated for legibility: the signal is real only to the extent participants choose to emit it honestly, and **anyone promising more is selling the chokepoint back under a new name**.
- **It does not, by itself, throttle anything.** Legibility is a precondition for the damping moves in notes [4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md) and [6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md); on its own it changes nothing about delivery. That is intentional — but it means a subscriber who attaches no filter gains no protection from this move alone.
- **Asymmetric incentive.** The honest cases that most want to flag themselves (well-behaved agents) are also the ones least likely to be a problem, while the actors a wary subscriber most wants to identify have the strongest incentive to lie. So the signal is most useful for *cooperative* coordination (an agent that wants to be treated as an agent) and weakest exactly where adversarial pressure is highest.
- **Class is coarse.** "Agent" vs. "human" is a blunt taxonomy; real authorship is a spectrum (human-supervised agents, agent-assisted humans, scheduled automation). The attestation can carry richer self-described structure, but every added field is more disclosure and more surface to misreport — so the honest design pressure is to keep it minimal.

## 5. Open questions

1. **Involuntary (behavioral) detection — deliberately out of scope at the protocol layer.** Could the network detect undeclared agents from behavior (tempo, pattern, volume)? Possibly, but Axona does **not** attempt this at the protocol layer, and this note argues it should not: behavioral classification requires either pervasive surveillance of traffic patterns or a **classifier authority** empowered to label publishers — which is a gate, and a central one. Detection of *involuntary* agency is therefore left to the edges (a subscriber's own filter may apply whatever heuristics it likes to traffic it receives), never to the kernel. Is that division durable, or does pressure to detect deceptive actors inevitably pull a classifier toward the center?
2. **Attestation shape.** Self-timestamped vs. challenge-response, and whether the class claim is a standalone signed object or piggybacks on an existing publish-identity assertion. (Mirrors decision (c) in the publish-identity spec, §7.) — *open.*
3. **Revocation / change of class.** An identity may switch between human and agent operation over time. How is a stale or superseded class claim retired without a central registry? Likely ties to the publish-key lifecycle decision (stable vs. rotating, §7(b) of the publish-identity spec). — *open.*
4. **Filter-side defaults.** What is the *honest default* a reference filter ships — admit all, or surface the class prominently? The choice of default is itself a soft governance lever, and it belongs to forkable filter sets (note [4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md)), not the kernel. — *open.*
5. **Cross-signal composition.** How does the class attestation compose with costly identity (note [1](Gates-to-Gradients-1-Costly-Identity-v0.2.md)) and reach-scaled friction (note [6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md))? An honest agent-class flag plus a reach-scaled cost may be a more robust pairing than either alone. — *open.*

---

*This is a design sketch, not a committed roadmap item.*
