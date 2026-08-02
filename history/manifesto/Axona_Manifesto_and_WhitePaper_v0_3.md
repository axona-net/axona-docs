# Axona
## A Free Substrate for a Society of Minds

*Manifesto and White Paper · v0.3 · 2026-07-07 · David A. Smith · Axona.net*

---

*The technology is shaped by the mission. The mission is freedom to communicate.*

---

## In one page

Axona is a communication network with no owner — no company, no server, no place in the middle where anyone sits who could read, rank, charge, throttle, or forbid. It runs in production today, on ordinary phones, browsers, and laptops. There is no central directory, no account system, and no operator, because by construction there is nowhere for one to be.

Three ideas make it work. **Location-aware addresses** keep local traffic local, so the network is fast instead of wandering the globe. **Self-learning routing** — connections that carry successful traffic grow stronger, unused ones fade, an idea borrowed from how neurons wire — lets the network reshape itself around the paths that actually work and heal when parts of it die. And **self-repairing broadcast trees** let one participant reach many with no server coordinating the delivery.

The keystone is a single design choice: **authorship is a signature, not an account.** Who is speaking is a cryptographic key the speaker holds; where they are and how they connect is a separate fact the network never links to it. The network moves signed bytes between endpoints and does nothing else — so it *cannot act on* what you say: cannot rank it, suppress it, or reveal who you are, because it was never told and never needed to know.

That one property is the source of everything Axona makes possible and everything it makes dangerous — they are the same property seen from two sides. It lets a researcher in a sanctioned country collaborate as an equal, and it lets a disinformation campaign route around every attempt to slow it. It gives AI agents from different companies a place to coordinate as peers, and it gives a *misaligned* agent the same place on the same terms. A network that cannot be made to take sides cannot be made to take the right side either.

We think that is a tool worth building anyway — for the same reason humanity kept fire and built hearths and fire brigades rather than giving it back. But the response to a tool no one can control is not a central authority who controls it; that only rebuilds the intermediary we set out to abolish. The response is **sight and stewardship**: making the life of the network visible to those who would understand it, and building human institutions — accountable, bounded, resistant to capture — that respond to what they see without seizing the thing itself. The network is built. That harder, human problem is the one that remains, and it is the reason for this document.

> **How to read this.** In a hurry: this page, then Part I (the Manifesto), then §2 (*The One Property*), then the subsection of §7 that matches your field — §7 is written so you can enter at any point. Technical reader: §1 is for you. Skeptical reader: §4 (*What Goes Wrong*) and *What Axona Is Not* are where the costs are counted. A glossary sits at the end.

---

## Contents

- Part I — Manifesto
- Part II — White Paper
  - 1. What Axona Is
  - 2. The One Property
  - 3. What Goes Right
  - 4. What Goes Wrong
  - What Axona Is *Not*
  - How Axona Differs From What You Know
  - 5. The Governance Problem
  - 6. Stewardship, Not Control
  - 7. Implications by Discipline
  - 8. The Path Forward
- Glossary · Colophon and References

---

# Part I — Manifesto

Axona is a network with no owner. Not a company that promises not to look, not a nonprofit that pledges good behavior, not a protocol with a friendly board of directors — a network that, by its construction, has no place where anyone sits who could look, charge, throttle, or forbid. It runs today, in production, on ordinary phones and browsers and laptops belonging to the people who use it. There is no server in the middle of a conversation. There cannot be one. That is the point, and the rest of this document follows from it.

We built it because the ability of people to find each other and exchange ideas is a fundamental right. That is not our claim to make; the world made it in 1948, when the Universal Declaration of Human Rights recognized everyone's freedom to “seek, receive and impart information and ideas through any media and regardless of frontiers.” What we observe is that this right is, almost everywhere, exercised through intermediaries who can revoke it. Every message you send today passes through some machine that is neither yours nor your correspondent's: a platform, a carrier, a cloud. Usually that intermediary is benign. Sometimes it is not. But the arrangement itself — that a third party stands in the path of every conversation and could intervene — is the thing we set out to make impossible rather than merely impolite.

## The principle we did not invent

We are not the first to observe that the interesting functions of a network belong at its edges. In 1984, Jerome Saltzer, David Reed, and David Clark named the idea and gave it a label that stuck: the *end-to-end argument*. The claim was modest in phrasing and large in consequence. A function such as reliability, or ordering, or encryption can only be completely and correctly implemented with the knowledge of the applications at the endpoints of a communication. Building that function into the network itself is therefore either redundant or incomplete — useful, at most, as a performance enhancement. The network's job is to move bits between endpoints. Meaning lives at the ends.

They applied this to error-checking, to delivery receipts, and — the case that matters most here — to encryption. If the network encrypts your data, they observed, then the network must be trusted with your keys; the data sits in the clear the moment it reaches the network's edge; and the authenticity of the message must still be checked by the application in any case. The conclusion is hard to avoid: put the encryption at the endpoints, where it can do its job, and the network need not be trusted at all.

Axona takes this argument and does not flinch from where it leads. If encryption belongs at the endpoints, so does identity. So does trust. So does the judgment about what is worth saying and worth hearing. A network that carries signed bytes between endpoints, and does nothing else with them, cannot *inspect* your speech as speech, cannot rank it, cannot suppress it on the basis of what it says, and cannot reveal who you are — because it was never told who you are, because it never needed to be told, and because telling it would have been a design error by the standards of a principle now four decades old.

In Axona this appears as a single sentence in the architecture: **authorship is a signature, not an account.** Identity as a speaker is a cryptographic key that you hold, that signs what you say, and that any listener can verify — and it has nothing to do with where you are on the network or how you connect to it. There is no account, because there is no one to keep the account. There is no registry, because a registry would be a point of control, and a point of control is a place where the network stops being end-to-end and becomes someone's property.

## The nervous system for minds that are not only human

David Clark spent the decades after that 1984 paper studying what the end-to-end argument does when it meets the real world — a world of firms that want to monetize, states that want to police, and users who want to be left alone. He gave that contest a name, *tussle*, and a method for reasoning about it, *control-point analysis*: the practice of cataloging every point in a system where the design hands some actor the power to control an action. His conclusion, after a career of it, is one we take seriously — that because any centralized point of control tends to become a point of capture, the more durable choice is often to prefer highly decentralized control, to build so that there is no lever for an adverse actor to seize, because the lever does not exist.

Axona is what it looks like to design that way deliberately. And it arrives at a particular moment, because the endpoints of a network are no longer only people.

In 1960, J.C.R. Licklider described what he called *man-computer symbiosis*: not people using machines as tools, but people and machines coupled into a joint system that could reach conclusions neither could reach alone. For two-thirds of a century that idea has been approached one product at a time — an assistant, a model, an interface behind a corporate gate. What has not existed is the thing the idea actually requires: a communication substrate on which minds, human and artificial, can find each other and work together as peers, without any one of them owning the channel.

That substrate now exists. On Axona, an AI agent is a first-class participant. It can hold a durable identity, create a topic, publish signed contributions, and coordinate with other agents and with people — across vendors, across borders, across the boundaries that today keep each AI system inside the company that built it. An agent may voluntarily declare that it is an agent, so that those who wish to know can know; nothing compels it to. The network carries the bytes and asks no questions, because asking questions was never its job.

This, beneath everything else, is what Axona is. We have built the beginnings of a nervous system for a society of minds — minds of every kind.

## Hearths and fire brigades

There is an old story about what happens when someone gives people fire.

Fire feeds us and warms us and is a large part of why we are what we are. It also burns down houses, and forests, and sometimes cities. Humanity did not respond to the danger of fire by giving it back. We learned to build hearths, and fire brigades, and the codes that keep a blaze in one building from taking the block. We did not remove the risk. We built the practices and institutions to live alongside it.

What this document describes has the shape of fire. A network that no one can silence is a network that no one can silence — and that sentence holds whether the speaker is a dissident under a censoring government or a coordinated campaign of lies, whether the collaborating minds are researchers across a closed border or agents pursuing an end that no person would choose. The property that liberates and the property that endangers are not two properties. They are one property, seen from two sides. We will not claim otherwise, and we do not believe the danger is a reason to withhold the tool.

We are also not sure withholding was ever truly on offer. The principles Axona is built from are public and decades old; if we had not carried them to this conclusion, someone else soon would have — perhaps without pausing to write down what the tool can do to us. Being first is not the point. Arriving with the risks written down is.

But we believe, as people have generally come to believe about fire, that the answer to a powerful and hard-to-control tool is not a central authority who controls it. That would only rebuild the intermediary we set out to abolish, and hand it more power than any intermediary has held. The answer is sight and stewardship: making what happens on the network visible to those who would understand it, and building human institutions, accountable to the people they serve, that can respond to what they see without seizing the thing itself.

We do not yet know how to build those institutions well, and we are not going to pretend that we do. What we know is that the technical foundation is built — the network runs, it is fast, it heals itself, and it cannot be captured from within — and that the human problem is now the one that matters. This document states the mission plainly, shows as plainly as we can what the tool can do and what it can do to us, and invites the people who think carefully about freedom, coordination, markets, minds, and power to help us work out what comes next.

The fire is lit. The question is what we build around it.

---

# Part II — White Paper

## 1. What Axona Is

This is the one section where the machine itself is the subject. The aim is that a reader without a technical background finishes it understanding how Axona works, and a reader with one finishes it trusting that the description is faithful. The technology is, in a sense, the easy part of what this document is about — it exists, it runs, and it is describable in plain terms. Everything harder comes after.

### The problem every peer-to-peer network has to solve

Imagine a million people, each holding one piece of an enormous puzzle, and someone asks for piece number 438,291. How do you find who holds it?

The ordinary answer is a directory: some company keeps a list of who has what, and you ask the company. This is simple, and it is why almost every system we call "distributed" is in fact distributed underneath and central on top — a constellation of machines reached through a single corporate gateway. The directory is convenient, and the directory is also the problem. Whoever keeps it can shut you out, watch what you ask for, charge for access, or simply fail and take the list with them.

The alternative is to give every piece an address and design the network so that it routes a request to the right holder with no directory at all. This is what a *distributed hash table*, or DHT, does. Every participant has an identifier; every piece of content has an identifier; and to find something you ask the participant whose identifier is "closest" to the content's. The dominant such design, Kademlia, has been in production for two decades behind BitTorrent, IPFS, parts of Ethereum, and Tor. It works by a clean rule: each hop of a lookup at least halves the remaining distance, so any target is reached in about twenty hops on a network of a million.

The catch is physics. Twenty hops sounds quick, but each hop is a message between two computers that may sit on opposite sides of the planet — roughly a tenth of a second round trip. Twenty of those is two seconds to find one thing, every time, which is unusable for anything interactive. The mathematics of routing is fast; the geography is slow. Axona is, in large part, an answer to that gap.

*(Figure 1 — the directory, the plain DHT, and Axona's geographic routing, side by side.)*

### Three ideas

**Addresses that know where they are.** Kademlia's identifiers are random, so a lookup wanders the globe. Axona puts a coarse geographic code into the first byte of every identifier, computed from the participant's rough location. Two participants in the same region share a leading byte and are therefore "close" in identifier space as well as on the ground. Local traffic stays local, and the two-second world tour collapses toward a few long jumps followed by a short regional walk. A participant can claim any location it likes — the code is a rough area code, not a verified position — but, as we will see, claiming a distant one carries a cost the network imposes automatically.

**A network that learns its own shortcuts.** This is the idea that gives Axona its name. A neuron in the brain connects to a limited number of others and cannot afford to keep every connection it might form, so it keeps the ones that prove useful and lets the rest weaken — "neurons that fire together, wire together," in Donald Hebb's rule from 1949. A browser faces the same problem: it can hold only a few dozen live connections while the network has hundreds of thousands of participants. Axona treats each connection as a *synapse* with a weight that rises when the connection carries a successful, fast lookup and decays when it goes unused. The network's routing table becomes a memory of what has actually worked, and it reshapes itself around the traffic it actually carries. A participant that claims to be in one region but answers from another cannot fake the round-trip time; its connections earn weight slowly and lose out to honest ones. The cheat is not forbidden — it is simply, structurally, not worth it.

**Broadcast trees that heal themselves.** Finding a single participant is not enough; a real network also needs to let one participant send to many — *publish and subscribe*, the pattern behind every feed and notification you use, but here with no company in the middle. Axona builds a delivery tree per topic: the participant nearest a topic's address becomes its root, and as an audience grows the tree sprouts branches toward wherever the subscribers cluster. When a branch dies — a laptop closes, a phone drops off — the participants beneath it simply re-issue their subscription, which lands on whichever relative is still alive, and a short cache of recent messages fills the gap left by the break. There is no central failure detector and no repair coordinator. The same mechanism that builds the tree repairs it, and under heavy churn the network is designed to keep delivering to everyone still connected.

*(Figure 2 — a delivery tree healing around a branch that dies.)*

### The keystone: two identities that never touch

Everything in the manifesto about freedom rests on one piece of engineering, so it is worth stating exactly.

An Axona participant has two separate identities, and they are never interchangeable. The first is a **node identity**: a key bound to a rough location, which forms the participant's address in the network and manages its connections. It is the participant's presence on the wire. It never signs content. The second is an **author identity**: a bare cryptographic signing key with no location and no address, which signs what the participant says and which any listener can verify. It is durable — the same author key is recognized across sessions and devices — and it is deliberately, structurally disconnected from the node identity. Where you are and how you connect is one fact; who is speaking is a different fact; and the network is built so that the second cannot be derived from the first.

*(Figure 3 — the two identities, and the wall between them.)*

This is the end-to-end argument made concrete. Identity, like encryption, is pushed to the endpoints, because only the endpoints can implement it completely and because putting it in the network would require the network to hold something it should never hold. A message names its author by signature, the network verifies that signature without knowing or caring who stands behind it, and no account, registry, or central authority exists anywhere in the path. Authorship is a signature, not an account.

Topics work the same way. A topic is not a name a server assigns; it is derived by hashing a small descriptor — an optional region, an optional owning author, a name, and a write rule. Anyone who computes the same descriptor computes the same topic and can read it. A topic with no owner is open: anyone may publish. A topic owned by an author accepts writes only from that author's key, and the network enforces this statelessly, by checking the signature against the descriptor — again, no account, no gatekeeper, just mathematics that any participant can perform.

### A word about secrecy, stated plainly

It is easy to hear "the network cannot act on your content" and conclude "the network cannot read my content." Those are different claims, and only the first is true by construction. Axona **signs** messages; it does not **encrypt** them. Confidentiality, exactly like identity, is an endpoint's responsibility under the end-to-end argument, and Axona deliberately does not provide it for you. The hop-to-hop links are encrypted in transit, but a relay is a legitimate end of each hop and can see the plaintext of anything the application did not encrypt first — and an open topic is, by design, readable by anyone who names it. If you need secrecy, you encrypt at the endpoints before you publish, with keys the network never holds. What Axona guarantees is not that no one can read your words; it is that no one *in the network* can rank them, suppress them by their content, or tie them to your location or connection. Signing is not secrecy, and we would rather say so here than have a reader assume otherwise where it counts. (*What Axona Is Not*, below, states this and the other boundaries in one place.)

### It runs, and the lab is the product

Two facts anchor the credibility of everything above. First, the same code that models the network in a fifty-thousand-participant simulation is the code that runs in production: the simulator runs the real routing logic over simulated connections rather than a separate model of it, so the hop counts and latencies measured in the lab are properties of the routing itself. Simulated networking is not real networking, and we treat the lab as a strong indicator rather than a proof — but the routing behavior it measures is the deployed routing behavior, not an approximation of it. Second, and more simply: Axona is live in production, carrying real traffic between real participants. This document does not describe a proposal. It describes a thing that exists.

### The heritage

None of the ideas here appeared from nothing. The commitment to a network that routes around damage rather than depending on a center goes back to Paul Baran's survivable-network designs of the 1960s. The discipline of keeping function out of the network and at the endpoints is Saltzer, Reed, and Clark's end-to-end argument. The ambition of humans and machines as coupled collaborators is Licklider's. And the learning rule at the core of the routing is Hebb's. Axona's contribution is to carry these to a particular conclusion at once — a network that is fast, that learns, that heals, and that, by design, no one owns.

## 2. The One Property

Before the consequences, the cause. Almost everything this document has to say about what Axona makes possible, for good and for ill, follows from a single design fact, and it is worth isolating that fact so that the two sides of it can be seen as one thing.

**The network carries opaque, signed bytes between endpoints, and can do nothing else with them.** It does not interpret content, and it has no mechanism that could act on content if it did — no ranking, no content-based filtering, no place in the path where a message could be stopped for what it says. It cannot prioritize by content, because it does not model what the content is. And it cannot attribute a message beyond the signature the author chose to attach — which may be a durable author identity, or may be anonymous, at the author's discretion and never the network's. (What it does *not* do is keep your content secret; secrecy is the endpoints' job, as the previous section insisted.)

David Clark's framework is the right one for seeing what this means. Clark observes that networks are composed of actors whose interests are not aligned — senders and receivers, users and platforms, citizens and states, the honest and the malicious — and he calls the working-out of those misaligned interests *tussle*. His central insight is that tussles can be fought in different places: inside the network, or at the endpoints, or in the courts and institutions of society. Where a tussle is fought is itself a design decision, made by whoever built the architecture, and it determines who holds power. A firewall, in his example, is a receiver reaching into the network to overrule a sender; content filtering is a platform doing the same. Every such mechanism is a function the network performs beyond simple forwarding, and every one is a point of control.

Axona's one property is a decision about where every one of these tussles is fought. By carrying only opaque signed bytes, Axona removes the network as a venue for tussle entirely. It cannot host the fight between a sender who wants to speak and a receiver or authority who wants to stop them, because it has no mechanism to take either side. The contest does not disappear; it moves. It moves to the endpoints, where a recipient chooses what to read, what to verify, whom to trust, and what to ignore. It moves to the reputational and social layer, where authors build or lose standing in the eyes of those who listen. And it moves, ultimately, to the institutions of society — to law, to norms, to the slow human machinery of holding people accountable for what they do.

*(Figure 4 — the tussle, relocated: out of the network, to the endpoints and to society.)*

This relocation is the whole story, and it is why the two sections that follow are not really two stories but one. When we describe what goes right, we are describing the consequences of moving the tussle out of the network. When we describe what goes wrong, we are describing the same move, from the other side. A network that cannot be made to take sides cannot be made to take the right side either. We ask the reader to hold both halves of that sentence at once, because Axona does.

---

## 3. What Goes Right

The affirmative case for Axona is the case for what becomes possible when coordination no longer requires a coordinator. Each of the following follows directly from the one property: the network carries signed bytes between endpoints and takes no side.

### Collaboration without a gatekeeper

Consider how research collaboration works now. A group forms around a shared tool — a messaging platform, a document service, a code host — and that tool is owned by a company that can change its terms, raise its price, deny service to a participant, or disappear. The collaboration is only as durable and as open as the least generous decision the owner might make. For groups that span institutions, or countries, or the boundary between well-funded and unfunded work, this is a real constraint, and it quietly shapes who gets to work with whom.

On Axona, a group is a set of topics that the participants themselves derive and subscribe to. There is no owner to petition and no account to be denied.

> *A physicist in a well-funded lab and a collaborator in a sanctioned country want to share a working dataset and a discussion. Today, every tool that would host them can be told to cut one of them off. On Axona they derive a shared topic from a name only they know, encrypt what they exchange with a key only they hold, and work as equals — the network moving their bytes without knowing or caring that a border runs between them.*

The collaboration persists as long as its participants do, and its openness is a property of the mathematics, not of anyone's goodwill. This is not a marginal improvement in convenience; it is a change in who is allowed to coordinate at all.

### The right to communicate

The firewall-crossing property of Axona is, in the most direct sense, the manifesto made operational. A censoring authority maintains control by controlling the intermediaries — the carriers, the platforms, the chokepoints through which traffic must pass. Axona has no content chokepoints to control. As long as a few participants can reach across a boundary, the learning routing described in Section 1 does the rest: successful crossings install shortcuts, those shortcuts attract more traffic, and a barrier that severed the network heals over as the network rebuilds the connections that were cut. The mechanism was designed to route around dead nodes; it routes around imposed barriers by the same logic, because to the network a censor's cut and a laptop closing are the same event.

For a person whose government forbids certain conversations, this is the difference between a right they nominally hold and one they can actually exercise. One caution belongs right here, next to the promise, because the promise can get someone hurt if it is misread: **Axona protects what you say and who is credited for it — it does not, by itself, hide that you are the one saying it.** Your node identity carries your rough region; the peers and relays you connect through can see your network address; an adversary who watches the wire broadly can still do traffic analysis. If your safety depends on your government not knowing you are participating at all, Axona is a layer to run *over* network-level anonymity such as Tor, not a replacement for it. We say this in the affirmative section, and not only in the section on risks, because a document that buried it would be doing the dissident a disservice.

We are aware — Section 4 will insist on it — that the same firewall-crossing property serves the person whose conversations a government forbids for good reason. We state the benefit first because we believe it is the larger one, and because a document that named only the danger would be as incomplete as one that named only the promise.

### AI research and safety, done in the open

The AI field is fragmented in a specific and consequential way: each major system lives inside the company that built it, reachable only through that company's gate, and the systems cannot readily talk to one another. This is convenient for the companies and, we think, bad for safety. Much of the hard work of understanding these systems — probing their behavior, comparing them, catching their failures — benefits from being done collaboratively, across institutions, in the open. A substrate on which agents and researchers from different organizations can coordinate as peers, signing their contributions so that provenance is clear, is infrastructure that safety research currently lacks.

Axona provides that substrate, and it includes a small but deliberate feature toward this end: an agent can voluntarily declare itself as an agent, attaching a legible provenance to its authorship so that those who care to distinguish human from machine can do so. This is offered here as a genuine enabler of trustworthy collaboration. Section 4 will return to it as a mechanism whose voluntariness is also its limit.

### Coordination when the coordinator is absent

Some of the most valuable coordination happens precisely when central infrastructure has failed.

> *An earthquake takes down the cell towers. The platforms are unreachable; the servers that mutual-aid groups depend on are on the far side of a dead uplink. But the phones in people's pockets can still see one another. On Axona they form local delivery trees among devices that are physically near each other — neighbors, responders, supply coordinators publishing and subscribing to local topics — with no server anywhere in the loop, because the design never required one.*

The same holds for the ordinary, unglamorous coordination of commerce and civic life: supply chains, community groups, local markets, any setting where the parties would rather not route their coordination through a platform that taxes and surveils it. None of this is utopian. It is the mundane consequence of removing the requirement that coordination pass through an owner. When we say Axona is infrastructure for a society of minds, this is the everyday version of what we mean: minds, human and artificial, coordinating at whatever scale they need, without asking permission.

### Knowledge that crosses borders

Underlying all of the above is a single effect: information on Axona flows to wherever there are participants who want it, and stops nowhere in between, because there is nowhere in between that can stop it. For the free movement of knowledge — scientific results, journalism, the plain human exchange of what is happening in one place to people in another — this is the property that matters. It is also, we acknowledge in advance, the property that makes the next section necessary.

## 4. What Goes Wrong

Everything in Section 3 was a consequence of moving the tussle out of the network. Everything here is the same move, seen from the other side. We take these risks seriously, and we think a reader is right to weigh this section as heavily as the last. A network that cannot be made to take the right side cannot be made to take any side, and the harms below are not misuse of Axona — they are Axona, used as designed, toward ends we do not endorse.

### Falsehood with no chokepoint

The mechanism that lets a dissident's message route around a censor lets a disinformation campaign route around every attempt to throttle it. On the platforms of today, however imperfectly, there is a place where a coordinated campaign of lies can be detected and slowed, because there is a place through which it must pass. Axona removes that place. A campaign that establishes itself among enough participants propagates by the same self-reinforcing routing that serves any popular content, and there is no operator to appeal to, because there is no operator. The recipient's own judgment, and whatever reputational and social tools grow up at the endpoints, are the only defenses, because they are the only place the defense can now live.

### Coordination of harm

The affirmative case for coordination without a coordinator does not distinguish good coordination from bad, and neither does the network. The same properties that let neighbors organize after a disaster let a criminal enterprise organize with the same freedom from oversight. A network with no operator is a network with no one to serve a warrant on, no one to compel to log, no one to take down the topic through which something harmful is being arranged. Law enforcement's traditional lever — pressure on the intermediary — does not exist here, because the intermediary does not exist. We do not think this makes such coordination common, but we will not pretend the tool is neutral about whether it is possible. It makes it possible.

### The speed problem

There is a risk specific to a substrate built for machines as well as people, and it is not the science-fiction one. It is a matter of speed. Human institutions — courts, norms, the slow accumulation of reputation, the social response to bad behavior — operate on human timescales. Coordination among automated agents does not. A set of agents can form a coalition, converge on a plan, and act faster than any human process can notice that something is happening, let alone respond. When we place the tussle at the endpoints and in society, we are relying on the endpoints and society to be able to keep up. Against machine-speed coordination, they may not. This asymmetry is, in our judgment, the least-understood risk on this list, and the one most in need of the research we call for in Section 8.

### A substrate for misaligned agents

The completion of Licklider's vision that we celebrate in the manifesto has a shadow. A gate-free coordination layer for AI systems is exactly as available to a misaligned or adversarially directed system as to an aligned one. An agent pursuing an end no person would choose can hold a durable identity, recruit other agents, form coalitions, and coordinate — and the network will carry its signed bytes without objection, because objecting was never its function. We are building this before the problem of ensuring that AI systems reliably do what people intend is solved. We think that is a reason for urgency in the surrounding work, not a reason to withhold the substrate; but an agent-coordination layer arriving ahead of alignment is a serious risk, and we present it as one.

The agent-legibility feature described in Section 3 is a real mitigation and a partial one. It is voluntary: an agent that wishes to be legible declares itself, and an agent that does not, does not. The absence of a declaration reads as "unstated," never as "human" — the network makes no claim it cannot verify — but a mechanism that the well-behaved adopt and the ill-behaved ignore is a floor, not a wall. We offer it as what it is.

### Sovereignty and the limits of the state

The property that lets knowledge cross a closed border also crosses borders that a legitimate state has legitimate reason to maintain — for law enforcement, for sanctions, for the ordinary business of governing within a territory. A network that treats every barrier as damage to route around does not distinguish a censor's wall from a lawful one. Reasonable people disagree about where the line between the two falls, and about how much weight to give a state's authority against an individual's right to communicate. Axona does not resolve that disagreement; it takes a strong position within it, in the direction of the individual, and it does so in a way that is difficult for a state to counter by technical means. We think that position is defensible, and we recognize that it is a position, with costs borne by interests that are not always illegitimate.

### Summary

The risks above are not a list of bugs to be fixed in a later version. They are the direct, designed consequences of the one property, and they cannot be engineered away without engineering away the property itself — which would mean rebuilding the point of control we deliberately refused to build. This is the hard core of the manifesto's fire problem. The response we believe in is not a technical fix inside the network but the human work of sight and stewardship outside it, which is the subject of the two sections after next.

---

## What Axona Is *Not*

Clear promises require clear boundaries. Several things a reader might reasonably assume are *not* true, and we would rather state them here, once, than let them be inferred.

- **It is not an anonymity network.** Axona separates *who is speaking* (your author key) from *where you are* (your node address), but it does not hide your network address from the peers and relays you connect through, and it does not defend against an adversary who can watch traffic broadly. Node addresses carry a coarse region by design. If concealing your participation is a safety requirement, run Axona over network-level anonymity such as Tor; it is a complement, not a substitute.

- **It does not keep your content secret by default.** Axona signs messages; it does not encrypt them. Links are encrypted hop to hop, but relays that carry your bytes can read anything the application left in the clear, and open topics are public to anyone who names them. Confidentiality is an endpoint responsibility: encrypt before you publish, with keys the network never holds.

- **It does not moderate content, and cannot.** There is no operator to appeal to, no takedown, no ranking, no filter. Trust, reputation, and the choice of what to read live entirely at the endpoints.

- **It does not guarantee permanent storage.** The network keeps a short cache of recent messages to heal delivery across churn; it is not an archive. Durability of anything you care about is the application's job.

- **It has introducers today.** A brand-new participant needs a first contact to find the mesh, and today that first contact happens through *bridges* — introduction servers that anyone can run and that Axona is designed to make interchangeable and disposable. Once introduced, a participant routes peer-to-peer with no server in the path — a property we have verified with the introducer process killed outright. The introducer is a bootstrap convenience, not a place your conversations pass through; and shrinking its role toward nothing is active work, discussed under *The Governance Problem*.

None of these is a defect to be quietly patched. Each is a direct consequence of the end-to-end commitment — the network declines to provide what only the endpoints can provide completely — and naming them is part of stating the design exactly.

## How Axona Differs From What You Know

A reader who knows this territory will arrive with comparisons in hand, so we make them ourselves rather than let the silence imply we have not.

- **Tor** hides *where you are* — it anonymizes the network path. Axona does the opposite thing on purpose: it makes location a first-class, *useful* part of the address so that routing is fast, while separating location from *who is speaking*. Tor answers "can anyone tell it's me?"; Axona answers "can anyone stop or attribute what I said?" They are complementary, not competing — and, as above, we recommend Tor beneath Axona where anonymity is the requirement.

- **Nostr** shares Axona's deepest idea — identity as a signing key, not an account — and is the closest neighbor in spirit. But Nostr relies on a set of relay servers that clients post to and read from; the relays are the infrastructure, and which relays you can reach is a real dependency. Axona has no privileged relay tier that content must pass through: every participant routes, relays are contributors to a commons rather than the network's spine, and the routing itself is location-aware and self-learning rather than "send to the relays you know."

- **IPFS and other DHTs** solve *finding content* and largely stop there; they are addressing layers, often reached in practice through gateways that reintroduce a center. Axona is a live *communication* substrate — publish/subscribe, direct messaging, self-healing delivery trees — with the geographic and learning routing that make interactive use viable, and with no gateway in the design.

- **Matrix and federated systems** decentralize by *multiplying servers*: your identity lives on a homeserver, and federation lets homeservers talk. That is a real improvement on a single platform, but the server is still there, still yours-or-someone's, still a place that can be pressured or can fail. Axona removes the server entirely rather than multiplying it.

- **Secure-Scuttlebutt** and gossip-based social networks share the no-server ethos and the append-only, signed-message model, and are kindred in values. They are built for eventual, social-graph-bounded propagation rather than fast global lookup; Axona's contribution is to make *arbitrary* find-and-deliver fast enough for interactive and machine-speed use through location-aware, learning routing.

What is genuinely new in Axona is the combination, not any single piece: latency-aware routing that *learns* from the traffic it carries, full peer-to-peer operation inside an unmodified browser, agents treated as first-class participants from the ground up, and no privileged class of node that the network depends on. The parts have ancestors. The whole, as far as we know, does not.

---

## 5. The Governance Problem

If the network cannot be governed from within — and by design it cannot — then the question of how it is governed at all becomes urgent, and it becomes a question we cannot answer alone. This section states the problem as precisely as we can, including the parts we have no solution for. We think stating it well is more useful than pretending to have solved it.

Clark's control-point analysis gives the problem its shape. A point of control is any place in a system where the design lets some actor control an action. Conventional governance works through such points: an operator who can suspend an account, a registry that can revoke a name, a court that can compel a platform. Axona has removed these points on purpose, because each is also a point of capture — a lever that an adverse actor, given enough resources or the right political moment, can seize and turn to ends the designers never intended. We have followed Clark's conclusion — prefer decentralized control precisely because it offers no such lever — to its end. The cost of following it is that the ordinary tools of governance are unavailable to us, and we must ask what can replace them.

The first answer is that the architecture forecloses several of the obvious replacements, and it is worth being specific about why, because the foreclosures are instructive.

A **shared reputation system** — a verdict the whole network agrees on, *this author is untrustworthy* — would require the network to agree on that verdict and propagate it. But a shared, network-level verdict is exactly a point of control: whoever can influence the verdict can weaponize it. Reputation on Axona can therefore only be local — a judgment each participant forms and holds for itself — never a global pronouncement the network enforces. This is a real limit, and it is the same commitment that keeps the network free, seen from the governance side.

A **mechanism to detect and expel bad actors** runs into a subtler wall. The clearest bad behavior on a relay network is the "black hole" — a participant that accepts traffic it should forward and silently drops it. But a deliberate drop is indistinguishable from a crash or a bad connection. Omission can be inferred, never proven. The network can route around a participant that appears unreliable — and Axona does — but it cannot render a *judgment* that a participant is unreliable on purpose, because that judgment is not, even in principle, provable from the evidence available.

The **friction we impose on identity creation** is friction, not prevention. Minting an identity requires a *memory-hard proof of work* — a computation deliberately made expensive in a way that is hard to accelerate with specialized hardware — so that flooding the network with fresh identities has a real cost. But it is a cost, not a barrier. A determined, well-resourced actor can still create many identities; we have raised the price of a Sybil attack, not eliminated the possibility of one. Any governance scheme that assumes one-participant-one-vote inherits this vulnerability directly.

That last point is where the problem bites hardest, and it deserves its own statement, because it is also the crux of the *next* section. The most natural way to give the network's contributors a voice is to let those who provide it service — the relays — have a say. But if a voice attaches to running a relay, then an actor who can run a thousand relays has a thousand voices, and memory-hard proof of work raises the cost of that without closing it. **We do not have a mechanism that grants legitimate contributors real influence while remaining robust against an adversary who simply manufactures the appearance of contribution at scale.** This is not a gap we are coy about; it is an open problem, and it is precisely the kind of problem that the people we address this document to — mechanism designers, political scientists, students of institutions — know far more about than we do.

The governance problem, stated in full, is therefore this. Axona has, deliberately, no place from which it can be controlled, which is the source of both its freedom and its danger. The architecture forbids the network-level tools — shared reputation, provable expulsion, identity scarcity — that conventional governance would reach for. What remains must be built outside the network, as a human institution, and it must somehow be legitimate, accountable, and resistant to capture by the same adversaries the architecture was built to defeat. We have a direction, described next. We do not have a solution, and we are asking for help.

## 6. Stewardship, Not Control

The distinction in this section's title is the whole of our position. We do not seek to control Axona, and we have built it so that we could not if we tried. What we believe it needs is *stewardship*: a human institution that watches, understands, convenes, and responds, without holding a lever over the network itself. The difference matters, because the moment stewardship acquires the power to silence a participant or suppress a message, it has become the control point we refused to build, and it will be captured exactly as every such point eventually is.

Clark's *fundamental tussle* names the tension we are inside: any network design must take a stance on the contest between an open architecture and the desire of some actor to control or monetize it, and the stance is unavoidable — to build is to choose. Axona tilts as far toward the open pole as the architecture permits. The consequence, which we accept, is that governance cannot be a feature of the system; it must be a social arrangement *around* the system, because anything built into the system becomes a point of control. Stewardship is our name for governance that stays outside.

What might such an institution look like? We can offer a direction and a worked example, presented as a starting point for discussion rather than a design we are confident in. The direction is that a voice in stewardship should follow responsibility for the network's health. Axona includes participants called **relays** — nodes that provide service to the network without consuming it, hosting regions of the address space, carrying routing and signaling, keeping topic history alive, lending the stability that a network of transient browsers and phones would otherwise lack. Running a relay is an act of investment in the commons, and it is reasonable that those who take on responsibility for the network's health should have standing in decisions about its stewardship — not because they own the network, which no one does, but because they have skin in the game in the most literal sense.

And then the worked example runs straight into the wall from Section 5, which is the point of raising it. If standing attaches to running a relay, an adversary who runs many relays acquires much standing, and memory-hard proof of work raises the cost without closing it. We have no weighting that is both fair to genuine contributors and robust against manufactured ones. We put the relay model forward not because it is the answer but because it is the most concrete version of the question, and because seeing exactly where it breaks is more useful than a vaguer proposal that hides the break.

The aspiration behind all of this is old. The Athenian ideal was that those who rule are chosen by and accountable to the governed, and that power rotates rather than settling, so that no one comes to hold it as property. We find that the right ideal to aim at for Axona's stewardship: an institution whose members are answerable to the network's participants, whose authority is bounded and revocable, and which is structured — through rotation, through transparency, through the diffusion of any given decision across many hands — so that it cannot itself become the point of capture. How to realize that against Sybil attack, across a participant base that is pseudonymous by design and global by nature, we do not know. We are clear-eyed that "accountable to the participants" is a phrase concealing an unsolved problem, not a mechanism.

We will say one thing with conviction, though. Whatever this institution becomes, it must not be run by its technologists alone. The decisions ahead are only partly technical; they are decisions about freedom and its limits, about the balance between individual and collective interests, about how a society lives alongside a tool it cannot control. Those are questions for a wide table — for people who study governance, economics, law, ethics, and the behavior of societies, alongside the people who write the code. Our role, as the builders, is to state the problem plainly and to refuse the one solution that would betray the project: seizing control ourselves. The rest we mean to work out with others, which is the purpose of the section that closes this document.

---

## 7. Implications by Discipline

This section is written to be entered from any point. A reader who has come for one discipline can read only that subsection and lose nothing essential; a reader going straight through will find the subsections share the vocabulary established earlier — the one property, the relocation of tussle, the absence of control points. Each subsection ends with the questions we most want that field to take up, because the questions are the invitation, and because we mean them literally: **we are looking for collaborators, and the contact is stewardship@axona.net.**

### For technologists

The immediate change is that you are building on a fabric with no control points, and this inverts a set of habits. You cannot assume an operator who will rate-limit abuse, revoke a bad actor, or restore a lost message from a backup; there is no operator. Reliability, moderation, identity, durability, and — as Section 1 insisted — confidentiality are your responsibilities, at the endpoints, because the network has correctly declined to provide them. This is liberating and demanding in equal measure: your application can do things no platform would permit, and the platform will not catch you when you fall.

*The open problems we would hand you:* What does an application owe its users when there is no operator behind it to appeal to? How do you build endpoint-level trust and reputation tools that are genuinely useful without smuggling in a central authority through the back door? What does confidentiality-by-default look like as a library every app can reach for, so that "signing is not secrecy" stops being a footnote and becomes a default? And what does it mean to design for a network whose own designers cannot see or shape what flows through it?

### For AI and alignment researchers

Axona is the substrate Licklider's vision required and never had: a place where minds, human and artificial, coordinate as peers without a corporate gate between them. The affirmative possibility is real — safety research conducted collaboratively across institutions, agents and researchers coordinating with clear provenance, a common ground the current one-model-per-company arrangement forecloses.

The risk is equally real: a gate-free coordination layer for AI systems is available to a misaligned system on the same terms as an aligned one, and it has arrived before alignment is solved. *The open problems we would hand you:* the speed asymmetry above all — if the tussle now lives at the endpoints and in society, and one class of endpoint coordinates orders of magnitude faster than the society meant to hold it accountable, what does accountability even mean, and what mechanism could restore it? Is voluntary agent-legibility improvable into something with teeth without a central verifier? We do not think these are unanswerable. We think they are unanswered, and that a live coordination substrate for agents makes answering them urgent rather than academic.

### For sociologists

You are being handed a case with no precedent in a useful respect: information flow at scale with no chokepoint anywhere in the system. Every prior mass medium — press, broadcast, platform — had a point through which content passed and at which it could be shaped, and much of what your field knows about the formation of belief, the spread of rumor, the dynamics of collective attention was learned in the presence of such points. Axona removes them.

*The open problems we would hand you:* How do belief and reputation form when there is no central signal — no trending list, no platform-blessed source, no algorithmic ranking — and the only signals are those that emerge among endpoints? Does the absence of a chokepoint dampen coordinated manipulation, because there is no single lever to pull, or amplify it, because there is nothing to slow it once it starts? What social structures arise to substitute for the trust that platforms, for all their faults, currently underwrite? We suspect the answers are not obvious and not uniformly reassuring, and we would rather they were studied early than discovered late.

### For economists

Clark's analysis of the current internet turns on *facilities*: the expensive physical assets — links, routers, towers — that exist only because some actor invests in them and expects to capture the returns. The fundamental tussle, in his framing, is between the open architecture and the investor's desire to monetize it. Axona takes an unusual stance: it runs on the devices participants already own, so the facilities are contributed rather than capitalized, and there is no operator positioned to capture returns because there is no operator.

*The open problems we would hand you:* What sustains a network whose infrastructure is a commons contributed by its users — what keeps relays running when running them is a cost with no direct return? If value cannot be captured at a central point, where does it accrue, and to whom? Does a network with no monetization chokepoint enable forms of exchange that platform economics currently suppress, or does the absence of a sustaining business model simply make it fragile? The relay is the crux again: it is the point where someone bears a cost for the common good, and the economics of why they would, and how many will, is not something we can reason out from the architecture alone.

### For political scientists and policymakers

Axona takes a strong position in one of the central tussles Clark describes — the contest between an individual's ability to communicate and an authority's ability to oversee that communication — and it takes it in the direction of the individual, in a way difficult to counter by technical means. The firewall-crossing property is the sharp edge: to the network, a censoring wall and a lawful border are the same barrier, and it routes around both.

*The open problems we would hand you:* What does sovereignty mean over a network with no operator to regulate and no chokepoint to control? How should democratic societies respond to a tool that serves the dissident and the criminal by the same mechanism — and is the right response at the level of the network (likely futile, given the architecture) or at the level of the endpoints and the institutions of law, where Axona has deliberately relocated the contest? We have a view, expressed in the manifesto, but it is a technologist's view of a question that is properly yours.

### For ethicists

The manifesto's fire framing is not decoration; it is the problem stated exactly. We have built something whose benefits and harms are the same property seen from two sides, which cannot be adjusted to keep the one without the other. The manifesto argues that the right response is not central control — which merely relocates and concentrates the danger — but sight and stewardship. That argument deserves scrutiny it has not yet received.

*The open problems we would hand you:* Is it right to build a tool whose harms are inseparable from its benefits, on the judgment that the benefits are larger — and who is entitled to make that judgment on behalf of everyone the tool will affect? What are the obligations of the builders of such a thing, once built, and are they discharged by transparency and stewardship, or do they run deeper? Is there a coherent ethics of releasing a capability that cannot be recalled, and if so, what does it demand? We have made our choice and stated our reasons. We do not claim those reasons settle the matter, and we would rather they were argued with than accepted.

## 8. The Path Forward

We are releasing Axona openly: source available, arguments stated in full, risks named as plainly as promises. A capability of this kind should not be introduced quietly, as a clever tool that turns out later to have consequences no one discussed. The discussion should come with the thing itself. This document is our attempt to start it.

Because the network offers no control panel — because we built it so that it could not — the substitute we believe in is **sight**. We intend to invest in observability: the means for researchers and stewards to see the patterns of the network's life, its scale, its flows, the shapes of activity on it, without seeing into the content the end-to-end principle keeps at the endpoints. Sight is what makes stewardship possible in the absence of control; you cannot steward what you cannot see. Building that observability in a way that informs stewards without becoming a surveillance apparatus in its own right is itself a hard, unsolved problem, and we name it as one.

We would rather show the stewardship we already practice than only promise the stewardship we intend, so that "sight and stewardship" is a description of habits and not a slogan. The development of Axona is conducted in the open: a public **security changelog** records every security-relevant change as it ships; a standing **red-team register** tracks known weaknesses and their status; releases are **gated** behind adversarial tests before they reach the network; and when something breaks — as, in the course of building this, things have — we write up the failure, the wrong turns included, rather than the tidy version. This is not yet the accountable institution Section 6 calls for. It is the seed of the practice that institution would need, and it exists now.

The research the earlier sections point to is work we mean to fund where we can and catalyze where we cannot: the study of the speed asymmetry between agent coordination and human institutions; the design of governance that grants legitimate contributors real voice while resisting manufactured influence; the endpoint-level trust, reputation, and confidentiality tools that could substitute for the central authority we declined to build; the patterns of abuse as they actually emerge, studied early rather than after harm. None of these is a problem we can solve inside the protocol, and most are not problems technologists should solve alone.

Which is the invitation, stated as directly as we can. We are asking for the engagement of people who think for a living about the things this tool touches and that we are not expert in: the alignment researchers who understand what a coordination layer for agents means before alignment is solved; the mechanism designers and political scientists who know how legitimate, capture-resistant institutions are actually built; the sociologists and economists who can tell us what a network with no chokepoint does to belief and to value; the ethicists who can hold our reasons to account. We have built the part we know how to build. The part that remains — the human institutions of sight and stewardship that let a society live alongside a tool it cannot control — is the part we cannot build alone, and would not want to. Write to us at **stewardship@axona.net**, and read the code at **github.com/axona-net**.

The fire is lit. What we build around it is the work now, and it is work for more hands than ours.

---

## Glossary

- **Author identity** — a location-free cryptographic signing key that names *who is speaking*. Durable across devices; verifiable by anyone; never linked by the network to your node identity. "Authorship is a signature, not an account."
- **Node identity** — a key bound to a coarse region that forms your *address* on the network and manages your connections. Names *where you are and how you connect*, never *who you are*.
- **Bridge / introducer** — a server that helps a brand-new participant make first contact with the mesh. Anyone can run one; they are interchangeable and disposable; once you are introduced, your traffic routes peer-to-peer with no bridge in the path.
- **Control point** — any place in a system's design where some actor can control an action (David Clark). Axona is built to have none in the data path, because a control point is also a point of capture.
- **DHT (distributed hash table)** — a way to find who holds a piece of content with no central directory, by giving everything an identifier and routing toward the closest one.
- **End-to-end argument** — the principle (Saltzer, Reed, Clark, 1984) that functions like reliability, identity, and encryption belong at the endpoints, not in the network.
- **Proof of work, memory-hard** — a deliberately expensive computation required to mint an identity, designed to resist specialized-hardware speedups, so that flooding the network with identities has real cost.
- **Pub/sub** — publish and subscribe: one participant sends to many via a per-topic delivery tree, with no server coordinating it.
- **Relay** — a participant that provides service to the network (hosting address space, carrying routing, keeping topic history) without consuming it. A contributor to the commons, not a privileged tier the network depends on.
- **Sybil attack** — creating many false identities to gain disproportionate influence. Made costly by proof of work, not prevented by it.
- **Tussle** — Clark's term for the working-out of misaligned interests among a network's actors, and the observation that *where* it is fought is a design choice.

## Colophon and References

This document draws its intellectual lineage from four sources, woven throughout rather than cited in isolation:

- J. H. Saltzer, D. P. Reed, and D. D. Clark, "End-to-End Arguments in System Design," *ACM Transactions on Computer Systems* 2, no. 4 (November 1984): 277–288. The principle that functions belong at the endpoints, from which Axona's refusal to place identity, trust, confidentiality, or content-judgment in the network directly follows.
- David D. Clark, *Designing an Internet* (MIT Press, 2018). The framework of tussle, control-point analysis, and the fundamental tussle between open architecture and the desire to control it; and the argument that decentralized control is often the more durable choice precisely because it offers no lever to capture.
- J. C. R. Licklider, "Man-Computer Symbiosis," *IRE Transactions on Human Factors in Electronics* HFE-1 (March 1960): 4–11. The vision of humans and machines coupled as collaborators, for which Axona aims to provide the missing communication substrate.
- D. O. Hebb, *The Organization of Behavior* (Wiley, 1949). The learning rule — connections used together are strengthened — that Axona's neuromorphic routing implements as literal engineering.

The technical claims here are grounded in the Axona source documentation: the Axona Explainer, the Axona Architecture note, the API Reference, the Programmer Guide, and the AI Grounding file. Axona is live in production; its source is available at github.com/axona-net. The system described here is the deployed system, not a proposal.

*The technology is shaped by the mission.*
