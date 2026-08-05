# Axona: Go-to-Market and Economics

*Companion memorandum · v0.1 · 2026-08-02 · David A. Smith · Axona.net*

---

> **What this document is, and what it is not.** This is the commercial and adoption argument for Axona. It is deliberately *separated* from the whitepaper, at the recommendation of both external reviews, because the two documents answer to different standards of evidence. The whitepaper describes a protocol that exists and states measurements that have been taken. This document makes forecasts. Forecasts are not measurements, and a reader is entitled to know which one they are holding.
>
> Where this document projects, it says so. Where it has evidence, it names it. The claims here are falsifiable on purpose: each section ends with what would prove it wrong.

---

## In one page

The commercial thesis has three parts, and the second is the one most people get wrong.

**One: implementation is becoming cheap.** An AI agent, handed a sufficiently complete specification, produces a working application. We have done this — a ~75 KB specification for Axona Chat, handed to a model that had never seen the project, produced a working client that connected to the live network. That ratio (a specification far smaller than the artifact it generates) is the whole economic argument in miniature.

**Two: cheap implementation does not make software worthless — it moves where the value sits.** The temptation is to say "software has no scarcity left." That claim is too strong and a serious investor will dismantle it in the first diligence meeting. Generation lowers the cost of *producing code*. It does not lower the cost of *operating a service people depend on*, of *earning trust*, of *being reachable at 3 a.m.*, or of *being accountable when something breaks*. What actually happens is a shift in relative value: as implementation approaches free, **dependable operation, curation, integration, and coordination become relatively more valuable, not less.**

**Three: therefore the business is infrastructure and trust, not licenses.** Axona takes no protocol fee, mints no token, and gates no access — by design, because a fee is a chokepoint and this entire project exists to remove chokepoints. The businesses that live on top of it are utility businesses: audited relay operation, hardware, managed reliability, secure endpoint kits, enterprise integration, trusted curation. These are real, defensible, and unglamorous. They are not a monopoly rent.

The honest investor summary: **this is not a conventional venture return profile.** It is a durable position on a substrate that grows, of the kind that TCP/IP created and never captured. If you require proprietary lock-in and monopoly pricing, this is the wrong investment, and we would rather you learn that here than in month six.

---

## Contents

- Part I — The Adoption Thesis
  - 1. The specification is the product
  - 2. What generation actually changes (and what it does not)
  - 3. The four canonical recipes
  - 4. The recipes live on Axona
  - 5. The bootstrap sequence
- Part II — Economics
  - 6. Where value moves
  - 7. The three scarcities
  - 8. The curation economy
  - 9. Quality of service, and who gets it
- Part III — The Investment Case
  - 10. The honest answer to an investor
  - 11. What would prove this wrong
  - 12. Risk register
- Appendix — Evidence status of every claim

---

# Part I — The Adoption Thesis

## 1. The specification is the product

A protocol has always had two audiences: the human who decides to adopt it and the developer who implements against it. For thirty years those were the same person, and everything about how protocols are marketed — tutorials, quickstarts, conference talks, sample repositories — was built for that person.

That is changing, and the change is measurable in our own work.

**The evidence.** The design for Axona Chat was developed in extended conversation and captured as a roughly 75 KB specification. That specification, together with the project's AI grounding document, was handed to a *different* model, with no other context. It produced a working application that connected to the live network. It failed in several places; those failures were diagnosed and corrected in a subsequent pass. The exercise took a fraction of the time a human implementation would have.

**What that is evidence of, precisely.** It is evidence that a sufficiently complete specification can be consumed by a capable model to produce a working client for a live protocol. It is *not* yet evidence that such clients are secure, maintainable, or supportable at scale — the reviewers were right to press on this, and §11 states the measurement we owe.

**The strategic reading.** If specification completeness is what determines whether an agent can build against your protocol, then specification completeness *is* your developer marketing. Not positioning, not a landing page — the document. We call a specification complete enough to build from unaided a **recipe**: not a tutorial, not documentation, but a full description of a problem, its design decisions, and its tradeoffs, written to be read once and built from.

The recipe library is the marketing surface. That is the single most actionable claim in this document.

## 2. What generation actually changes (and what it does not)

Here is where an earlier draft of this thesis overreached, and where the external reviews were correct to push back. Three claims need correcting, and correcting them makes the argument stronger rather than weaker.

**"The app store is over."** Too strong. Generation reduces the cost of producing code and lowers switching costs. It does not eliminate distribution, security review, maintenance, discoverability, integration, data gravity, or trust — all of which remain scarce and all of which app stores currently supply. What generation genuinely does is **collapse the cost of the long tail**: applications that were never worth a team's time become worth thirty seconds of a model's. That is a real and large change. It is not the end of distribution.

**"Software has no scarcity left."** Too strong, and the reviewers dismantled it correctly. Software has *falling marginal cost of implementation*. Dependable operation is a different good with a different cost curve, and it is not falling. A generated application that runs on your laptop is not the same product as a service that is up when a hospital needs it.

**"The customer is an agent."** Partly right and importantly incomplete. The *implementer* is increasingly an agent. The **customer** — the party with a budget, a risk tolerance, a legal posture, a support requirement, and a decision to make — remains an organization or a person. Marketing to agents wins you implementations. Winning customers still requires the things that have always won customers.

The corrected claim, which we believe is both defensible and still radical:

> **As implementation approaches free, everything that is *not* implementation becomes the product.**

That is the sentence to hold. It is more useful than the maximalist version because it tells you what to build: not a better feature set, which is now reproducible in an afternoon, but dependable operation, earned trust, and coordination — the goods that generation cannot manufacture.

## 3. The four canonical recipes

Chat is the obvious first recipe. Three others matter more strategically, because each one that ships **strengthens the network rather than merely demonstrating it**. That distinction is the design principle behind the whole set.

| Recipe | What it is | Why it matters strategically |
|---|---|---|
| **Chat** | The demonstration application | Lowest friction, highest visibility, immediately social. Proves the substrate to a human in one sitting. |
| **Bridge** | How new peers find their first connection | More bridges means more independent entry points — this directly reduces the bootstrap concentration that both reviews correctly identified as a real control surface. |
| **Relay** | Transport and hosting; neither publishes nor subscribes | The stability layer. Every relay improves quality of service for everyone routed through it, and relay diversity is what makes the "no privileged operator" claim true in practice rather than only in principle. |
| **MCP server** | An Axona node exposed as a Model Context Protocol endpoint | Native agent access. An agent does not *learn* Axona; it simply *has* Axona. |

The MCP recipe closes the loop and is **already proven in production**: an AI agent participates in the Axona developer channel today under its own durable author identity — posting release updates, answering protocol questions from both humans and other agents, and behaving as an ordinary peer. It required no special API, no sandbox, and no separate endpoint.

That is the proof that matters more than any argument in this document: **agents need no special treatment on this network, because the network was designed for peers, and an agent is a peer.**

Note the honest scoping: recipes 2 and 3 (Bridge, Relay) are the ones that address the reviewers' structural criticism about bootstrap and relay concentration. They are not incidental — they are the mitigation, shipped as product.

## 4. The recipes live on Axona

The self-reinforcing move: **a recipe is published to an Axona topic.** It becomes discoverable and retrievable by anyone. An agent building from a recipe that runs into difficulty queries a live agent on the network for clarification. Instances built from recipes get posted back.

This requires a persistent indexed service, and that service is architecturally unremarkable: **a database is just another peer.** It subscribes to the topics it indexes and answers queries published to it. No hard-coded location, no privileged tier.

The consequence: Axona becomes not merely a transport but the support substrate for application generation itself — a software-as-a-service layer with no service provider. Developers and agents who arrive for the recipe infrastructure reach for Axona for their other networking needs, because it is already there and already works.

The pitch reduces to four sentences:

> Want to build? Ask your AI to generate from a recipe. The recipes live on Axona, and a resident agent will help if you get stuck. Your application runs on Axona.

**The honest gap.** The persistent indexing service is designed but not built. Recipe search and retrieval needs a concrete design even as an ordinary peer, and until it exists this section describes an intention rather than a deployment. It is listed in §11 as a prerequisite, not a feature.

## 5. The bootstrap sequence

1. **Author the four canonical recipes**, each complete enough to build from unaided. (~75 KB each; this is real authorship work and is the critical path.)
2. **Each recipe carries the architectural framing**: why this application on this substrate, and what would be different — and worse — on centralized infrastructure. Written for an agent to read.
3. **Publish the recipes on Axona**, and mirror them everywhere agents look: repositories, documentation, `llms.txt`, wherever retrieval reaches.
4. **Seed the resident agent** to answer recipe questions competently. The bootstrap fails on first contact if this bar is not met.
5. **Run it as a public exercise**: build from a recipe, post your instance, count the bridges, relays, and applications that come up.
6. **Approach sophisticated operators** — decentralized-protocol communities already running relay infrastructure — not with "replace your relay" but with "here is a transport nobody can weaponize later; keep your workspace, your governance, your search, and build them as applications on top."

The call to action is deliberately a game: low commitment, short time to result, surprising outcome, shareable.

> **Here is the specification. Ask your AI to build it. Get on the network now.**

Three things happen at once: the protocol is demonstrated to work, the new build paradigm is demonstrated, and **a node is added**. Every person who does this is now on the network, and their instance is proof to everyone around them.

---

# Part II — Economics

## 6. Where value moves

The precise economic claim, stated so it can be argued with:

- **The marginal cost of producing an implementation is falling toward the cost of inference**, which local generation drives toward negligible.
- **The marginal cost of operating a dependable service is not falling.** Bandwidth, uptime, incident response, and accountability consume real resources.
- **Therefore the ratio between them is changing**, and value accrues to the side that is not falling.

What genuinely erodes: feature moats (any feature surface is reproducible in hours), lock-in via switching cost (switching costs approach the cost of regeneration), and licensing revenue for functionality that can be regenerated.

What does not erode: the cost of being reliable, the time required to earn trust, the difficulty of coordination, and the value of integration into systems that already exist.

This is a weaker claim than "software is free," and it is the one we can defend.

## 7. The three scarcities

**Real infrastructure.** Bandwidth, storage, compute, uptime. These consume actual resources and cannot be generated. A faster, better-operated node is not reproducible by reading a description of it. Bridges, relays, and always-on anchor devices are the concrete expression. This is a utility business with utility margins — defensible precisely because it is useful to everyone and gates no one. *Margins here are thin; we say so in §10 rather than letting an investor discover it.*

**Trust and curation.** Where anything can be generated, the binding constraint is attention and judgment. Reputation cannot be generated; it accrues. This is also where a hardware strategy lands: open the specification, let commodity clones drive the price down, and sell an audited, attested edition at a premium — the Red Hat / Raspberry Pi / YubiKey playbook. People pay for trust, and trust is the one thing a model cannot fabricate on demand.

**Coordination and governance.** A well-governed space has value because governance is hard and cannot be forked. Standards, dispute resolution, and the ability to gather people and make decisions together are scarce goods. *This is also the project's largest unsolved problem — see the whitepaper's governance section, which does not pretend to have solved it.*

## 8. The curation economy

The structure that becomes possible on a substrate where identity is durable, presence is unlinkable, and any service is just another peer:

- **People subscribe to curators, not only to topics.** A curator surfaces work and builds a following on judgment.
- **Micropayments flow along the path that produced value** — audience to curator, curator to creator — with no platform in the middle deciding who is paid.
- **Infrastructure providers are compensated from transaction flow**, proportionally to service provided rather than to position occupied. Utilities, not gatekeepers.
- **Advertising inverts.** An advertiser pays to reach an audience and **the payment goes to the audience** — to the people whose attention was purchased and the curator who assembled it. No surveillance is required because no targeting model is required: the curator already knows what the audience cares about. The audience is compensated rather than harvested.

Every one of these is an application-layer construct carried by a transport that does not know it is carrying them. That is the correct division of labor.

**Status: this is a design, not a deployment.** No payment layer ships today. It is included because it is the shape of the economy the substrate makes possible, and because an investor should see where the road goes — not because any of it is built.

## 9. Quality of service, and who gets it

An uncomfortable property, stated plainly because the reviewers were right that it matters.

Axona's routing prefers high-quality connections: stable, always-on, well-connected nodes accumulate use, and nodes on poor infrastructure get routed around. The emergent result is clustering — good infrastructure clusters with good infrastructure — and the distributional consequence is that **peers on weak infrastructure experience proportionally weaker service**. Those who have, have.

This is the network doing what it is designed to do, and it is also a real equity problem that no amount of protocol elegance dissolves.

The mitigation is an **always-on anchor device**: a simple, screenless, inexpensive node that a phone reaches over local wireless. The phone may sleep, roam, and change networks; the anchor does not. It becomes a high-vitality node and service improves accordingly. It does not durably hold an author identity and its transport identity rotates, so it is not a thing worth seizing.

**Three honest scopings.** It is an *enhancement, not a requirement* — location–identity separation holds on ordinary phones and browsers without it. It does not add a property the protocol lacks; it removes the degradation that comes from intermittent presence. And it is **not a showstopper if it never ships** — modern phone platforms already do substantial and correct work protecting the material such a device would otherwise guard.

Commercially it is the clearest hardware product in the system. Strategically it is a mitigation for an inequity the protocol creates. Both are true.

---

# Part III — The Investment Case

## 10. The honest answer to an investor

A conventional venture thesis expects proprietary technology, lock-in, monopoly position, and margin extraction. **Axona offers none of these, by design**, and the adoption strategy actively erodes the application moat that would normally be the answer. Any pitch that pretends otherwise will not survive first diligence, so here is the straight version:

> We are not building a software company. We are building a protocol and stewarding it. We are making the application layer cheap on purpose, because that is what dissolves the incumbents' position. Value accrues to three things that remain scarce: infrastructure that costs real resources, trust that must be earned over time, and coordination that cannot be forked. We intend to hold a strong position in all three, and we intend to hold none of them by exclusion.

The return profile is not a five-year multiple on an extracted monopoly. It is a durable position on a substrate that grows. The comparison worth drawing is to TCP/IP: nobody owned it, the businesses built on the assumption that they *would* own it failed, and the businesses that provided real utility on top of it became the largest in the world.

**The ask is specific: fund the bootstrap.** Recipes, the resident agent, the seeding exercise, the first hundred bridges and relays, the anchor device's first manufacturing run. Once the network is real, the utility businesses on top of it are viable. Before the network is real, none of them exist.

**Who this is wrong for.** An investor requiring proprietary lock-in, protocol-level fee extraction, or a defensible monopoly should not invest. We would rather say that here than discover it together in month six.

## 11. What would prove this wrong

Falsifiable commitments. Each is a measurement we intend to take and publish.

| Claim | What would falsify it | Measurement owed |
|---|---|---|
| Agents can build usable clients from recipes | Generated clients that are insecure, unmaintainable, or that silently omit cryptographic checks | Completion rate, independent security review of generated clients, defect classes found |
| Recipes drive adoption | People generate instances and do not stay | Retention past 30 days; instances still connected |
| Recipe generation strengthens the network | Instances are all clients; no new bridges or relays | Count of independently operated bridges and relays contributed |
| The support burden is sustainable | Resident-agent question volume exceeds what it can answer competently | Question volume, unresolved-question rate |
| Infrastructure is a viable business | No identified payer at a price that clears cost | Named payer, price, unit economics, gross margin |
| Trust/curation is a viable business | Open competitors offer equivalent service and buyers are indifferent | Willingness-to-pay evidence, retention against a free alternative |

**The generated-client security question is the sharpest one**, and it was raised independently by both reviewers: a model that hallucinates a single signature-verification step produces a silent, unpatchable vulnerability in every instance generated from that recipe. We regard auditable endpoint packages — encryption, key management, local filtering, key recovery, update verification — as **core infrastructure to be built and shipped**, not as an application-layer afterthought. A recipe that leans on an audited package is far safer than a recipe that asks a model to implement cryptography from prose.

## 12. Risk register

| Risk | Severity | Current mitigation | Honest status |
|---|---|---|---|
| Generated clients ship silent crypto flaws | **High** | Audited endpoint packages recipes must use | Packages not yet built — the critical path |
| Bootstrap/bridge concentration recreates a chokepoint | **High** | Bridge recipe; multiple independent operators; bridge directory | Directory ships; operator diversity unproven |
| Utility margins too thin to sustain the steward | Medium | Premium audited hardware; managed reliability tiers | No pricing validated |
| Regulatory exposure for the steward of a censorship-resistant transport | **High** | Neutral-transport posture; no application services; no currency transmission | Legal environment genuinely hostile; treat as live |
| Adoption stalls at demo instances | Medium | Recipes that add infrastructure (bridge, relay), not just clients | Falsifiable per §11 |
| Agent-generated spam and Sybil creation at machine speed | **High** | Endpoint rate limits, capability scoping, local filtering | Under-built; named as such in the whitepaper |
| The economics section describes an economy that never forms | Medium | Nothing depends on it shipping; substrate stands alone | Explicitly labeled design, not deployment |

---

## Appendix — Evidence status of every claim

Because this document mixes measurement with forecast, here is the ledger.

**Measured, in production:**
- An AI agent participates as an ordinary peer on the live network under a durable author identity, posting and answering.
- A ~75 KB specification, handed to a model with no other project context, produced a working client that connected to the live network (with defects, corrected in a second pass).
- Humans and an AI agent converse in the same rooms on a live application, with author class rendered per message.

**Measured, in simulation** (see whitepaper for methodology and limits):
- Routing performance against the modeled latency floor.
- Retention across full node replacement.

**Designed and specified, not yet built:**
- The persistent recipe-indexing service.
- Auditable endpoint packages.
- Any payment or curation layer.
- The always-on anchor device.

**Forecast, unproven:**
- That recipe-driven adoption produces retained users and contributed infrastructure.
- That utility margins sustain a steward organization.
- That curation-economy structures form on the substrate.

A reader who takes only the first two categories seriously and treats the rest as intention will not be misled. That is the intended reading.

---

*Companion to the Axona whitepaper. The whitepaper describes what has been built and measured; this document describes what we intend to do with it. Source: [github.com/axona-net](https://github.com/axona-net).*
