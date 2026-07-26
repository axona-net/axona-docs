# Axona Endpoint Defense — The Immune System (v0.3)

**Status:** design synthesis, restructured · **Date:** 2026-07-26 · **Baseline:** kernel
4.43.0 (prod) · **Supersedes:** v0.2 (2026-07-24)

**What changed from v0.2.** Not a patch — a rewrite. v0.2 described each mechanism
optimistically and quarantined the objections in a closing §7. That structure reads as
advocacy, and it let the weakest parts of the design sit furthest from the parts that
depend on them. In v0.3 **every mechanism is presented with its own failure mode, in the
same section**, and the failures that are *systemic* rather than per-layer get a chapter
of their own (§5). Two threats absent from v0.2 are added (§3). A fourth option is added
to the central open question (§6). And the "ring" conclusion is challenged rather than
accepted (§7).

**Relates to:** the six *From Gates to Gradients* notes
([1](Gates-to-Gradients-1-Costly-Identity-v0.2.md),
[2](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md),
[3](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md),
[4](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md),
[5](Gates-to-Gradients-5-Agent-Legibility-v0.2.md),
[6](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)) ·
[E-1 Placement Defense](E-1-Placement-Defense-v0.1.md) ·
[Author-Class Attestation](../implementation/Author-Class-Attestation-v0.1.md) ·
whitepaper §10/§12.

**How to read this.** §1–2 are the argument. §3–4 are the design. **§5 is the part to
argue with** — it is the honest catalogue of how this fails. §6–7 are the two unresolved
questions everything else depends on. §8–10 are what to decide and build.

---

## 1. The argument in one page

**The objection.** A network that deliberately has no central control panel cannot ban
anyone. Automated adversaries act at machine speed. Human institutions are slow.
Therefore observation without enforcement is useless — a fire alarm in a city that
outlawed extinguishers.

**The answer, in one sentence.** *A lever strong enough to stop the swarm is a lever
strong enough to stop you, and it is the single richest prize an attacker, a state, or
the operators themselves could ever seize — so we refuse to build it, and put a fast
shield at every endpoint instead.*

**The reframe that matters.** The objection assumes a central ban-hammer is a *capability
we lack*. It is better understood as **the largest machine-speed attack surface a system
can have**. One key that silences anyone is one key worth stealing, subpoenaing, or
buying. Handing every endpoint its own shield is not the weak version of enforcement;
against a machine-speed adversary it is the *strong* one, because there is no single
point to seize. Extinguishers were never outlawed. We declined to appoint one fire
marshal holding a master key to every building.

**What we therefore claim, precisely.** Endpoints get an automated, machine-speed,
locally-controlled shield. The network stays neutral in transport. Recognition of a
threat spreads through the population at network speed without anyone adjudicating it.

**What we do not claim.** That this is safe. It raises the floor and prices the invader.
An immune system can be overrun, and — the finding this document is organised around —
**its failure modes are not evenly distributed.** §5.

---

## 2. The frame: an immune system, not a police force

No central authority deletes a pathogen from a body. Four functions do the work, and
Axona has an analogue of each:

| Immune function | Axona analogue | Status |
|---|---|---|
| Metabolic cost on the invader | memory-hard PoW, decoupled from the address | decided (E-1, note 1) |
| Distributed recognition | local web of trust + reputation streams | design (§4.3–4.4) |
| Adaptive memory spreading through the population | signed attestation streams on topics | design (§4.3) |
| Fast innate response at every cell | local gatekeeper at the endpoint | design (§4.6) |

**Why this is a consistent extension rather than a bolt-on:** every one of these is an
ordinary signed message on an ordinary topic. The defense rides the network; it never
governs it. Each shield is opt-in, forkable and droppable, and none sits in the delivery
path — with one deliberate exception, named in §4.7 rather than buried.

**And the metaphor's honest debt.** If we adopt the immune frame we inherit its disease
catalogue. Immune systems do not merely get overwhelmed. They attack the self, they
over-react, they remember wrongly, and they exhaust the host. Those are not analogies —
they are predictions about what this architecture will do. §5 takes them seriously.

---

## 3. Threat model

**In scope.** Machine-speed spam and low-entropy floods · Sybil identity swarms ·
coordinated agent swarms (amplification, manufactured consensus) · illicit content an
endpoint wants to refuse · targeted placement/eclipse of a topic root (owned by E-1,
referenced not re-specced).

**The adversary can:** operate at machine speed · mint many identities *at PoW cost* ·
refuse to self-identify · fragment and under-declare to evade reach-graded friction ·
out-compute a phone · **and two capabilities v0.2 did not model:**

- **Subvert the shield through its input.** Every defensive layer that *interprets*
  content is fed entirely by adversary-controlled bytes. A local model deciding what the
  user sees is a policy decision point with an untrusted input channel — the textbook
  prompt-injection position. See §4.6 and §5.2.
- **Induce autoimmunity.** Rather than evading recognition, cause the immune system to
  recognise a *legitimate* participant as a pathogen and propagate that. Cheaper than
  evasion, and there is no appeal. See §5.1.

**Out of scope — the honest residual.** A determined adversary against an endpoint that
has disabled its shields. We price casual and scaled abuse; we do not guarantee.

---

## 4. The layers, each with its failure mode

Read edge-inward. For each: what it does, why it helps, **and how it fails.** The
failure lines are not caveats; they are the design's known cost.

### 4.1 Layer 0 — Costly identity

**What.** Memory-hard proof of work on a puzzle hash *decoupled from the node address*
(E-1, note 1), so difficulty never skews the keyspace. No authority adjudicates it.

**Why it helps.** Raises the unit cost of a Sybil. It does not prevent Sybils; it makes
the residue small enough for the layers above to filter.

**How it fails.** *It is a regressive tax.* A funded adversary amortises PoW across a
campaign and treats it as cost of goods. A person on an old phone pays it in battery and
heat. Memory-hard functions specifically punish low-RAM devices — the same population
Layer 5 disadvantages, which is not a coincidence but a pattern (§5.5). Worse, any
compute cost becomes a *market*: someone will sell pre-mined identities, converting a
compute barrier into a cash barrier, which is precisely the barrier a well-resourced
adversary prefers. PoW does not stop the adversary we fear most; it stops the amateur and
taxes the poor.

### 4.2 Layer 1 — Legibility

**What.** Voluntary agent-class attestation (note 5) plus aggregate cascade telemetry
(note 2). Readers may throttle, badge or quarantine agent-class traffic by their own
choice.

**Why it helps.** Shapes the honest default, and you cannot steer what you refuse to
measure.

**How it fails.** *Voluntary declaration is honest-actor-only by construction, and can
therefore invert into a penalty on honesty.* The adversary simply does not declare. If
readers throttle declared agents, the effect is a two-tier population in which
well-behaved agents are badged and slowed while undeclared adversaries pass as human. The
mechanism's incentive gradient points the wrong way, and no amount of good defaults fixes
that — only making non-declaration *detectable* would, which is §6's problem.

Separately: **cascade telemetry is a surveillance capability.** "Aggregate and
privacy-preserving" is a claim that needs proof, not an adjective. Propagation graphs are
notoriously re-identifiable; a graph of who-relayed-what-when is one join away from a
social graph. If we build the ruler, we must assume it will eventually be read by someone
we did not intend.

### 4.3 Layer 2 — Shared immune memory (`std/attest`)

**What.** One signed-claim envelope family — vouches, reputation/blocklists, class
declarations, annotations, verified claims — riding ordinary signed pub/sub, discovered
and merged with the pattern already proven by the bridge directory and metric topics.

```jsonc
// std/attest v0 — a signed claim.
{
  "kind": "axona:attest:v0",
  "type": "vouch" | "reputation" | "blocklist" | "class" | "annotation" | "verified-claim",
  "subject": { "author": "<authorId>" },   // or { "msgId": … } / { "topic": … }
  "claim":   { /* weight, tag, proof, correction text, class … */ },
  "ttl":     <seconds>,
  "issuer":  "<authorId>"
}
```

**Why it helps.** As `std/message` fixed cross-app `[object Object]` and `std/chunk` fixed
cross-app binary, this makes immune signals interoperable instead of trapping each in a
per-app silo. No new kernel primitive.

**How it fails.** Three ways, and the first is one we have already suffered.

*Unbounded immune memory is this codebase's demonstrated failure mode.* Attestations have
a TTL but no volume bound. Subscribing to a curator means ingesting whatever they publish.
Meanwhile: prod relays currently carry 317–480 roles each; #332 was a join-storm in which
bulk role ingest blocked the event loop and caused mass eviction; #333 killed a release
through churn-amplified role bloat. **Metadata volume is the failure this system has
actually experienced, repeatedly.** An immune-memory layer with no ceiling walks straight
into the trap we have live scar tissue for. It needs the equivalent of `INGEST_QUEUE_MAX`,
specified before it ships, not after.

*Interoperability amplifies error as efficiently as signal.* The entire value of
`std/attest` is that one curator's claim reaches every client. That is also the harm: a
single mistaken blocklist entry now propagates further and faster *because we succeeded*.
Silos are bad for defense and good for containment; we are deliberately removing the
containment.

*The TTL is asymmetric in the adversary's favour.* Blocklists decay, so an attacker need
only outlast the window. Vouches also decay, so honest standing requires continuous
activity — which penalises the occasional participant and rewards the constantly-online.
Forgiveness and forgetting are the same mechanism, and we get both whether we want both or
not.

### 4.4 Layer 3 — Web of trust

**What.** Clients build a *local* transitive trust graph (EigenTrust / personalised
PageRank) rooted at the user's own contacts, over subscribed `vouch` attestations. A swarm
minted seconds ago has zero inbound trust from *your* graph and lands in an "unknown"
tier by construction — no ban required. Plus pairing-time bootstrap vouches so an invited
newcomer starts with small real trust.

**Why it helps.** Sybil resistance with no adjudicator, and it degrades gracefully: the
worst outcome for a stranger is being *collapsed*, not silenced.

**How it fails.** *A web of trust reproduces the existing social structure, and converts
social capital into speech capacity.* If you are outside everyone's graph — new to the
country, institutionally unconnected, on your first device, deliberately pseudonymous —
you are structurally "unknown" indefinitely unless somebody invites you. That is not a
bug in the algorithm; it is what a trust graph *is*. The people most in need of a
neutral commons are the people a web of trust serves last.

Two further cracks: EigenTrust is manipulable by collusive clusters that vouch for each
other to manufacture centrality, and bootstrap vouches hand every inviter a small
Sybil budget. And the design's *default posture toward a stranger is suspicion* — a
cultural choice worth making consciously rather than inheriting from the data structure.

### 4.5 Layer 4 — Verified claims (ZK)

**What.** A `std/attest` claim may carry a zero-knowledge proof (Semaphore, ZK-email,
ZK-passport, org membership) asserting "a unique human" or "a member of Org Y" without
linking the durable author key to a legal identity. The app renders only claims that
verify.

**Why it helps.** It is the only mechanism that gives a cold, uninvited newcomer an
on-ramp, and the only friction discount a topic root could verify locally (§4.7).

**How it fails.** *It relocates the sovereign to the issuer.* An app that "requires human
proof" has delegated the human/not-human verdict to whoever issues proofs. Zero-knowledge
protects the *linkage*, not the *gatekeeping*: the cryptography hides who you are while
leaving intact the question of who decided you count.

And enrollment is the real chokepoint. A proof of unique humanity is only as good as the
registry behind it, and every registry has the exclusion properties of state
identification: the undocumented, the stateless, the person whose name does not match
their papers. We would be importing exactly the gate we exist to avoid, wrapped in
mathematics that makes it *look* like we did not.

Finally, **the mere existence of a verified tier degrades everything below it.** Once
apps can render "verified human" differently, unverified speech becomes second class by
default, whatever the spec says is optional. Tiers create pressure.

### 4.6 Layer 5 — Local gatekeeper

**What.** A model on the user's own device scores each incoming envelope before the UI:
semantic spam, cross-topic coordination, low-entropy repetition. Matches machine speed at
zero network cost, private, user-controlled. With a **deterministic heuristic tier**
(n-gram/entropy/keygen-timestamp deltas) as the universal low-power fallback.

**Why it helps.** It is the only layer that runs at the adversary's speed without any
shared infrastructure, and the only one that needs no protocol change at all.

**How it fails.** Three ways, and the first is the most serious hole in this document's
predecessor.

*A model that reads adversary text and decides what you see is prompt-injectable.* The
attacker's goal shifts from evading the classifier to *instructing* it: mark my later
traffic trusted, suppress my rival's legitimate posts. This is a policy decision point
whose entire input channel is hostile. And because §4.8 proposes shields on by default,
the **default** configuration would place an injectable component in the render path. The
heuristic tier is therefore not merely the low-power fallback — it is the *more robust*
design, because n-gram entropy cannot be argued with. That should change how we describe
the two tiers.

*Suppression is invisible and unauditable.* A message the gatekeeper hides leaves no
trace for the user. There is no way to distinguish "the shield worked" from "the shield
was wrong" from "the shield hallucinated," because the evidence is precisely what was
withheld. We would be building a filter bubble engine and calling it immunity. Any serious
version needs a reviewable quarantine, not silent drop.

*It stratifies by hardware.* A better shield tracks better silicon. The heuristic tier
equalises the floor, not the ceiling.

### 4.7 Cross-cutting — Friction scaled to reach

**What.** Reach- and congestion-graded PoW demanded by the K-closest roots that already
observe a topic's subscriber-set size, plus per-relay damping (note 6). **This is the one
mechanism that acts in the middle rather than at the edge** — stated here rather than
contradicted later. It stays **identity-blind**: rate- and reach-triggered,
address-decoupled, pricing *what a message does*, never *who sent it*.

**Why identity-blind.** A trust-weighted discount was considered and **rejected on two
grounds.** First, discounting by trust centrality requires the root to consult a trust
view, but trust is reader-relative — there is no canonical global trust for a root to read
without building the reputation oracle we abolish. Second, it would create a two-tier
speech system in which the credentialed insider flows free and the anonymous publisher pays
full freight. Anonymity is first-class here.

**How it fails.** *It taxes exactly the thing the network exists for.* Reach-graded
friction prices a message *becoming important*. The archetype is the anonymous
journalist with breaking news and zero standing: high reach, no credential, maximum
friction. Rejecting the trust discount was right for neutrality, and it leaves that tax
squarely on the person we would least like to tax. We have not solved this; we have
chosen which unfairness to accept, and should say so in those words.

### 4.8 The SDK and the default-policy problem

Package the layers so app developers get shields out of the box rather than re-deriving
them the way apps mis-derived bootstrap:

```js
const shield = createEndpointShield({
  identity,                                            // roots the trust graph
  filters:    ['reputable-curator-A', 'community-B'],  // std/attest streams I follow
  wot:        { depth: 3, algo: 'eigentrust', bootstrapVouches: true },
  gatekeeper: heuristicTier,                           // model optional; heuristics default
  curatorDecay: 'hebbian',
  policy:     { unknownTier: 'collapse', requireHumanProof: false },
});
```

**The unresolved tension in one place.** Safe defaults are what make the *baseline*
endpoint protected without configuration — you opt out of immunity rather than into it.
That is almost certainly right for users. It also means **whoever chooses the default
curator list holds soft authority over the whole network's perception**, which is the
sovereign we said we would not have, arriving through the front door as a convenience.
Forkability is the release valve; forking costs coordination and network effects push the
other way (§5.4).

*Hebbian curator decay* — a curator whose flags repeatedly conflict with the user's own
actions loses local weight, applying Axona's long-term-depression routing rule to
reputation, strictly locally and never shared. **It is also gameable:** an adversary who
can induce you to override a *correct* curator degrades your defenses cheaply. And it
addresses only per-user quality, not concentration (§5.4).

---

## 5. How this fails — the systemic catalogue

§4 gave each layer its own failure. These are the failures that belong to the *system*,
and they are the reason this document exists.

### 5.1 Autoimmunity, and the absence of appeal

Distributed recognition plus adaptive memory plus no central authority produces
**autoimmune disease**. A mistaken blocklist entry propagates through composable
reputation; a legitimate participant is progressively excluded across every client that
merges those streams. Nothing in the architecture stops this, and interoperability (§4.3)
makes it travel further.

**And here the absence of a sovereign cuts the other way.** Under a central authority you
can be wrongly banned *and petition*. Here you can be wrongly recognised as a pathogen by
a self-reinforcing distributed process **with no one to petition**. Note 3's
retraction/annotation is the nearest tool, but annotations are read by people who are
still listening — precisely the ones a successful exclusion has removed.

This is the strongest single objection to the whole design, and it is the mirror image of
its strongest feature. We should stop describing "no sovereign" as purely protective. It
protects you from the authority and abandons you to the crowd.

### 5.2 The shield as attack surface

Every layer that interprets content can be attacked through the content it interprets
(§4.6). Every layer that merges third-party claims can be attacked by poisoning those
claims (§4.3). Every layer that adapts to user behaviour can be attacked by manipulating
that behaviour (§4.8). **Adaptive defenses are, by construction, additional attack
surface** — and we are proposing five of them. The immune metaphor covers this too:
autoimmunity, allergy, and hijacked immune signalling are all standard pathologies.

### 5.3 Immune memory is unbounded, and we know how that ends

§4.3 states the mechanism. Recording it here because it is the failure this project has
actually lived: #332, #333, and today's 317–480 roles per relay. The pattern is that
metadata about the payload outgrows the payload. Any attestation design that ships without
a volume ceiling is repeating a mistake we can already name.

### 5.4 Concentration beats forkability

Hebbian decay demotes a curator that is *wrong for you*. It does nothing about a curator
that is *right* becoming a de-facto standard — the EasyList problem — whose rare,
controversial suppressions ride for free because almost no user ever encounters or
overrides them. Per-user quality and concentration-of-power are different axes.

Forkability is the stated release valve, and it is weak against Metcalfe pressure: the
value of a filter set rises with its user count, so the incumbent's advantage compounds
while a fork starts at zero. We should expect one or two dominant curators, and we should
plan for that rather than assert that forking prevents it. This may be a governance and UX
problem the protocol can only shape, never solve.

### 5.5 The failure modes are correlated, and they land on the same person

**This is the finding that only appears when the layers are viewed together.**

| Layer | Who it disadvantages |
|---|---|
| 0 — memory-hard PoW | low-RAM, old, battery-constrained devices |
| 3 — web of trust | the socially unconnected, the new, the pseudonymous |
| 4 — verified claims | the undocumented, the stateless, the unregistered |
| 5 — local model | the low-compute, mobile-only user |
| 4.7 — reach friction | the anonymous publisher whose message matters |

These are not five independent residual risks. They are **five descriptions of the same
person**: poor, mobile-only, socially unconnected, undocumented, new, and anonymous. Our
defense-in-depth is depth against the adversary and depth against *them* too.

A design whose safety properties degrade gracefully for the well-resourced and sharply for
the marginal has built a class system out of security primitives, however neutral each
primitive is on its own. We can price this honestly, mitigate parts of it (the heuristic
tier, bootstrap vouches), and refuse to pretend the residual is evenly spread. What we
cannot do is keep reporting these as five separate footnotes.

### 5.6 What we price and do not remove

Friction false-positives on organic cascades · the compute-asymmetry residual · the
naive-default residual · surveillance potential in telemetry · silent unauditable
suppression at the gatekeeper unless quarantine is built.

---

## 6. The load-bearing question: legibility without permission

Every unresolved thread routes here. The cold newcomer needs it. Anti-Sybil "prove you're
human" needs it. The only sound friction discount needs it. Each reaches for a credential
issuer and thereby relocates the sovereign.

**So the whole "commons without a sovereign" claim reduces to one question: can you become
legible here without asking anyone's permission?**

Four options. v0.2 listed three; the fourth is new in v0.3 and, I think, the most
consistent with the rest of the architecture.

**(a) Plural competing issuers, no canonical one.** Human-ness becomes a market of
attestations you weight locally like any curator. *Fails by:* inheriting §5.4 — the market
concentrates, and a dominant issuer is a sovereign with extra steps.

**(b) A bounded set of trusted issuers.** Honest and workable. *Fails by:* being the
explicit soft authority we exist to avoid. At least it is legible about it.

**(c) WoT-only, no ZK.** No issuer at all. *Fails by:* leaving the cold uninvited newcomer
with no on-ramp whatever, and §4.4's social-reproduction problem becomes the permanent
structure rather than a starting condition.

**(d) Proof of history — NEW.** Not "prove you are human" but "prove you have been
continuously present and interacting for N months in ways a swarm cannot cheaply
fabricate." No issuer, because the cost is *elapsed time plus sustained interaction*,
which is not mintable. The cold newcomer is not *unverified*; they are *young* — and youth
decays on its own, so **everyone becomes legible by waiting, which requires nobody's
permission.**

This fits the architecture's own instincts better than (a)–(c) do. Everywhere else we
replaced credentials with structurally verifiable facts: hosting is decided by address and
never by ownership; routing demotes what does not work; today's operational lesson was
*verify the address, not the round-trip*. Proof of history is that same move applied to
identity. It also satisfies §4.7's constraint that the only sound friction discount is one
a root can verify locally and self-containedly.

*How (d) fails, because it does.* Aged identities can be farmed in advance, and a market
for them will exist — so a funded adversary converts the barrier into a capital
expenditure, exactly as with PoW (§4.1). It penalises the genuinely new for months, which
is a real exclusion even if a self-clearing one. And "sustained interaction" must be
measured, which drags in telemetry and its surveillance risk (§4.2).

**But notice the difference in kind.** (a)–(c) fail by *relocating or entrenching an
authority*. (d) fails by *being expensive for the patient and rich*. Only the first
category contradicts the thesis. That asymmetry is the argument for putting (d) on the
table, not a claim that it is clean.

---

## 7. Is the ring breakable?

v0.2's closing finding was that the open problems form a **ring**: newcomer → ZK
fast-path → issuer authority → (to avoid authority) → plural-issuer market →
concentration → curator problem → Hebbian decay only partly answers that → and round
again. Solving one joint by reaching for another moves the pressure rather than releasing
it. v0.2 concluded the ring is "the actual topology of safety without a sovereign" and
possibly unbreakable.

**I think that conclusion is comfortable rather than earned.** Unbreakability was asserted,
not argued, and the framing risks functioning as a stopping point — a way to feel resolved
about being unresolved.

Rings of mutual dependency are broken by grounding one node in something *outside* the
ring. **We have already done this once.** The recursion problem — the immune channels are
themselves floodable, so the defense needs defending, forever — was resolved by grounding
at the self: every trust chain terminates at *you* and whom *you* directly trust. The
turtles stopped because we found a floor outside the recursion.

So the productive question is not "is the ring real" but:

> **Why does grounding-at-the-self terminate the recursion but not the rest of the ring —
> and is there a second such floor?**

Two candidates worth arguing about in the next conversation:

- **Time as a floor.** §6(d) grounds legibility in elapsed history rather than in anyone's
  say-so. Time is outside the ring: it cannot be issued, revoked, or concentrated.
- **Structure as a floor.** The kernel already grounds authority in *address* rather than
  in claims — a node hosts because of where it sits, verifiable by anyone, attestable by
  no one. Whether an equivalent structural fact exists for personhood is exactly the open
  question, and it is a more interesting one than choosing among issuers.

Naming the ring was v0.2's real contribution. Attacking it should be v0.3's.

---

## 8. What we will and will not say

**Will:** the network is neutral in transport; endpoints are empowered in defense;
recognition propagates at machine speed without an adjudicator; refusing the central lever
removes the largest single target rather than conceding a capability.

**Will not:** that this is safe · that the residual risk is evenly borne · that
forkability defeats concentration · that zero-knowledge removes gatekeeping rather than
relocating it · that an adaptive shield is not itself an attack surface.

---

## 9. Decisions required before building

1. **Verification authority (§6).** Choose (a), (b), (c) or (d), or explicitly decide to
   ship with no legibility layer at all. **Layer 4 and the cold-newcomer on-ramp are
   blocked on this.** My recommendation: cost (d) seriously before defaulting to (a).
2. **Attestation volume ceiling (§4.3, §5.3).** A hard bound and shedding policy,
   specified before `std/attest` ships. Non-negotiable given #332/#333.
3. **Gatekeeper tiering (§4.6).** Make the deterministic heuristic tier the *default* and
   the model the opt-in, inverting v0.2. Requires accepting a weaker default shield in
   exchange for a non-injectable one.
4. **Quarantine, not silent drop (§4.6, §5.6).** Does the SDK commit to a reviewable
   quarantine surface? Without it, suppression is unauditable by construction.
5. **Default curator list (§4.8).** Who chooses it, how it is changed, and how we describe
   the soft authority it creates without pretending it is absent.
6. **Telemetry privacy (§4.2).** Either a real privacy argument for cascade telemetry or
   an explicit decision to ship a surveillance-capable ruler with eyes open.

---

## 10. Build order (contingent on §9)

1. **`std/attest` convention + reference merge + volume ceiling.** The interop substrate;
   folds notes 3/4/5 into one envelope family. Cheap, unblocks everything. **Ships with
   the §9.2 bound or not at all.**
2. **GATE — decide §6.** Do not build Layer 4 or the on-ramp before this.
3. **WoT graph library + pairing-time bootstrap vouches** (§4.4).
4. **Endpoint SDK** — filter merge, WoT, Hebbian decay, heuristic gatekeeper default,
   quarantine surface, safe defaults (§4.8).
5. **Cascade telemetry** (note 2) — the ruler, gated on §9.6.
6. **Reach-graded friction** (note 6, identity-blind) — the only kernel-side piece; ships
   last and most cautiously.

---

## 11. Proposed whitepaper narrative

Lead with the inversion, since it is the argument rather than the analogy:

> **The machine-speed shield.** A network with no central control panel cannot deploy a
> network-wide ban against an automated swarm. That is deliberate, and it is not a
> concession: a lever strong enough to silence an adversary is a lever strong enough to
> silence anyone, which makes it the single richest prize an attacker, a state, or the
> operators themselves could ever seize. **A central ban-hammer is the largest
> machine-speed attack surface a system can have.** So the defense against machine-speed
> harm is not central enforcement but distributed cellular immunity: interoperable
> attestation streams, local webs of trust, verifiable claims, and local gatekeepers, so
> that every endpoint carries its own automated shield. The network stays neutral in
> transport; the endpoints stay empowered in defense.
>
> This raises the floor and prices the invader. It is not safety. An immune system can be
> overrun, it can attack the self, and its costs fall hardest on those with the least
> compute, the fewest connections, and no papers. There is no authority here to appeal to
> when the crowd gets you wrong. That is the price of having no sovereign. We pay it on
> purpose, and we should say so in those words.

---

## 12. Close

We refused the central lever because it is the richest thing an attacker could capture,
and we still think that is right. What replaces it is an immune system, and this document
exists to be clear-eyed about what that means: it can be overwhelmed, it can attack the
self with no appeal, its adaptive parts are new attack surface, its memory grows without
bound unless we bound it, its curators will concentrate, and its costs fall
disproportionately on the people a neutral commons should serve first.

The one question underneath all of it is still unanswered: **can you be a legible human
here without anyone's permission?** v0.2 concluded the problem forms an unbreakable ring.
v0.3's position is that we broke a ring once already, by grounding it in the self, and
that the next move is to look for a second floor — time, or structure — rather than to
choose which authority to install.

What this architecture can honestly promise is what an immune system promises: raise the
floor, price the invader, spread recognition at machine speed, give every cell its own
defense. Survivable at the edges. Not safe.
