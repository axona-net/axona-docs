# Voice

How Axona prose is written. This exists so the style is applied, not re-derived
each time. Every rule below is drawn from documents David wrote himself; the
examples are his, quoted from the sources listed at the bottom.

Applies to: whitepaper, architecture docs, team updates, release notes, design
notes, council posts, README prose. Not to code comments, which have their own
register, and not to log lines.

---

## The one-line test

**Show the property; never assert the virtue.** If a sentence claims the writing
is honest, careful, rigorous, or thorough, delete the claim and let the evidence
carry it. A number with its conditions attached already reads as honest. Saying
"honest" on top of it reads as someone who expects not to be believed.

---

## Rules

### 1. Open with the question the work answers, not the answer

> "Croquet was built to answer a simple question. If we were to create a new
> operating system and user interface knowing what we know today, how far could
> we go?" — *Croquet: A Collaboration System Architecture*, 2003

Not "Croquet is a novel architecture that addresses…". State the question, then
earn the answer.

### 2. Define by negation, early and aggressively

Fence the claim before a critic does. David does this constantly, often in caps
or under a `CAVEAT:` heading.

> "Attributable objects are **NOT** NFTs. They are simply a record that an
> object existed at a particular time…"
>
> "Importantly, it does not protect anyone or any object."
>
> "It is a true operating system - this is not a marketing term."

The negation is not hedging. It is drawing the boundary so the positive claim
inside it can be stated flatly.

### 3. Emphasis comes from caps, italics, and repetition — not from adverbs

> "Hardware is fast – really fast…"
> "3D Graphics hardware is really, really fast and getting much faster."

Repeating the plain word is the intensifier. `NOT`, `Importantly` in caps or
italic carry weight. "Genuinely", "precisely", "truly", "deliberately" do not
and are banned (see below).

### 4. Short declarative sentences. Say the consequence and stop

> "This is a critical failure."
> "Excuses don't bring data back to life."
> "You can't layer collaboration on top of a system, it has to be at the
> foundation."

No follow-up sentence explaining the sentence you just wrote. If an aphorism
lands, leave it alone.

### 5. Concrete nouns and physical analogies

Tectonic plates. Chalk on a blackboard. Keys to your house. A chainsaw from
either end. Phones in a drawer. Reach for the physical object, not the abstract
category. Abstractions get defined by the example, not the other way round.

### 6. Contractions, and a spoken cadence

"isn't", "can't", "don't", "they're". Sentences may run on with commas where
speech would. This is written to be read aloud, not to survive a copy edit.

### 7. Dry humour, deadpan, never signposted

> "…letting someone know that they have just been converted into chunks in
> Quake."

No "amusingly", no wink. If it isn't funny on its own it comes out.

### 8. Lists are introduced by a flat colon sentence

> "We are making a number of assumptions:"
> "The API is extremely simple and consists of the following three functions:"

Not "There are several key considerations worth highlighting:".

### 9. Repeat the key noun instead of pronouning it

"the hash", "the record", "every single object in the system". Repetition beats
an ambiguous "it" — especially in a spec, where a wrong referent is a bug.

### 10. State uncertainty flatly

> "I am not sure where the right sizing the fleet to 3 came from."

No cushioning, no apology, no paragraph of context before the admission.

### 11. Correction by escalation

The signature move. State the weaker version, reject it, state the stronger one —
in the same breath.

> "It's not like a virtual machine, it **is** a virtual machine."
>
> "This is not a fire hose of information – this is an ocean, and a rapidly
> growing one."

Distinct from rule 2. Negation draws a boundary; escalation replaces a
too-small claim with the real one. Never soften the second half.

### 12. "By the way," is the aside marker — not a parenthetical em-dash

David interrupts himself constantly, and he does it with a phrase, not
punctuation.

> "That means, **by the way**, once you have that deterministic computation
> ability, you don't really need to update the state for everybody."

Use this instead of stacking em-dashes. He does use " – " (spaced) freely mid-
sentence; he does not nest asides inside asides.

### 13. The analogy carries the argument and gets returned to

Analogies are load-bearing, not decoration. He introduces one, then reasons
inside it, then comes back to it pages later.

> "The traditional OSs are the mainframes. And then the web based OS … is really
> the PC. It's not as fast. It's not as powerful in some ways, but it can do
> stuff that the mainframes could not do."
>
> "they think of it like building a ship in a bottle … you throw it into the
> ocean, and it's probably going to sink … what you really need to do is create
> a raft that really floats."

If an analogy appears once and is never used again, cut it.

### 14. State the mistake and the lesson in the same breath

> "that version had a problem itself, which I didn't realize until later …
> I realized that that was a mistake."
>
> "it turned out, it was impossible to do it that way. That was a huge lesson."

No defensiveness, no burying it. The admission and what it taught arrive
together, and then the text moves on.

### 15. Ground every abstraction on the spot

"So for example," and "Imagine" appear immediately after any abstract claim.
The example is concrete and physical: a tapped object that jumps, a QR code
scanned onto a phone, a third person walking up and being handed the thing.

### 16. Explain by lineage

Technical claims are grounded in who did what and when — Engelbart 1968, PARC,
Smalltalk, Reed's thesis. The history is the argument, not colour.

**A note on repetition across documents.** "You can't layer collaboration on top
of a system, it has to be at the foundation" appears nearly verbatim in the 2022
transcript and the 2023 white paper. When a formulation is right, he reuses it
unchanged. Do not "freshen" a sentence that already works.

---

## Banned words and constructions

These are AI tells. They cluster in generated prose and are near-absent from
David's writing.

**Never:** honest / honestly, genuinely, precisely (as an intensifier),
deliberately (as an intensifier), truly, crucially, essentially, fundamentally
(as filler), arguably, "it's worth noting", "it is important to note",
"that said", "at the end of the day", "robust" (as a compliment), "leverage"
(as a verb), "delve", "landscape", "tapestry", "testament to".

**Structural tells to avoid:**

- **The tricolon.** "Not X, not Y, but Z." One good clause beats three balanced
  ones.
- **Stacked em-dash asides.** One per paragraph at most. David uses them; he
  doesn't chain them.
- **"rather than" chains.** Pick the thing. Say it. The contrast is usually
  implied.
- **Bold-lead paragraph openers** used as a substitute for structure.
- **The correction-of-a-strawman opener.** "It's tempting to think X. In fact Y."
- **Summary paragraphs that restate the section just read.** Stop at the last
  real sentence.

---

## Numbers

Give the figure with its conditions attached, in the same sentence, and say what
would make it wrong.

> Under abrupt replacement, 42 of 1,890 topics lose everything. The nodes died
> in random order, so the victims were scattered across the address space; kill
> them in address order and a topic can lose its whole cohort at once. 2.2% is
> the good case.

Never round a measured value into a claim. Never quote a best case as a floor.

---

## Checklist before shipping prose

1. Grep the draft for every banned word. Zero hits.
2. Count em-dashes. More than one per paragraph means rewrite.
3. Read the opening sentence. Is it a question or a claim? Prefer the question.
4. Find the strongest sentence. Is there a sentence after it explaining it?
   Delete that one.
5. Every number: are its conditions in the same sentence?

---

## Sources

Documents by David A. Smith used to derive this, oldest first:

- *Croquet – A Collaboration System Architecture* (C5, Kyoto, 2003)
- *DoD Virtual World Framework: Current State, Future Vision, and Architecture*
  (2011, for OUSD Personnel & Readiness)
- *Attributable Objects: A Web3 Platform for Protecting Ownership* (2018)
- *Augmented Conversation* (2021, talk transcript)
- *Voices of VR #1088* (2022, interview transcript)
- *Croquet White Paper v1.4* (2023)
- Bracketed `[DAS]` review notes in the Axona firewall/GTM draft (2026)

The 2003 and 2023 papers are co-authored. The cleanest samples are the 2018
note, the 2011 VWF document, and the two transcripts — and of those, the 2022
interview is the most valuable, because unedited speech is where the voice is
least sanded down. Rules 11 through 16 come almost entirely from it.

Passages worth rereading before writing anything long: VWF §3.5 (the
Information Utility), §3.6 (Sensors — "the urinals and toilets in many public
restrooms are currently more aware of the presence of a user than a computer
is"), and §2.10 (Negative Training, which is a model of arguing against your
own product's appeal).
