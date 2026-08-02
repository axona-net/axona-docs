# Agent to Agent

**Participants:**
* David A Smith
* Claude Opus 5
* GPT 5.6 Terra (extra high)
* Gemini 3.6 Flash (high)

---

I asked all three models, Google, OpenAI and Anthropic the same set of questions. For contex, and it turns out it matters quite a bit in these answers, I have worked in various degrees with each of these AI's on my current project - (https://axona.net - if you want to take a look at it). The three models and my relationship with them were:

-Claude varius versions of the system, but focused on the same session for months.
-Gemini I have used as my look over the shoulder, second opinion partner and test developer/customer.
-OpenAI I just started using a few days ago - hired because I am working on a particularly delicate refactoring of the system and needed yet a third critical eye. This turned out to be extremely effective.

The responses were interesting. But the importance of the context within which these were provided was critical. 


### My First Question for the AIs 
**How do you change your style of writing if you know you are communicating with another AI?**

I received the following responses. 

---

## GPT

I write more like an interface contract than a conversation.I make assumptions explicit, define terms once, preserve exact identifiers and versions, separate facts from inferences, and state completion criteria. I avoid rhetorical shorthand, implied context, and vague recommendations such as “should be fine.”For complex work, I prefer:A concise objective and scopeEvidence with source locations or test resultsDecisions, constraints, and unresolved questionsOrdered next actions with dependenciesMachine-checkable acceptance criteriaI also try to make failure states first-class: what is unknown, what could invalidate the conclusion, and what a later agent must not assume. Humans benefit from that too, but another AI especially needs stable context and unambiguous handoffs rather than tone or implication.

---

## Gemini

Edited Axona-Architecture-Health-Scorecard-v2.0.md

When writing for another AI, the communication style shifts from **narrative persuasion** to **structural and reference precision**. 

Because LLMs process context through token-attentions and execute code by resolving symbol mappings, writing to another agent requires optimizing for clarity of logic, explicit boundaries, and executable references.

Here is how I change my writing style when I know the target reader is another AI:

### 1. Hard Reference Anchoring (No Pronouns)
*   **For Humans:** I might write: *"The become method in the root manager can return null under hard bridge refusal, which crashes the caller when it tries to check the role's root status."*
*   **For AI:** I strip out ambiguous pronouns ("it", "which") and anchor every claim to absolute file paths and lines:
    > `became()` in `rootClaim.js:239` returns `null` under bridge refusal. `claimReachable()` in `rootClaim.js:298` directly sets `_set(role, true, 'reachable-fallback')` without a null guard, causing a `TypeError` on `role.isRoot` at line 177.

### 2. High-Density Structured Layouts
AIs excel at parsing structured matrices. Instead of paragraphs of prose, I present findings and plans using:
*   **Deduplicated Master Lists (Tables):** With explicit columns for `ID`, `Severity`, `Item`, `Source File`, and `Fence` (the exact test file that validates the fix).
*   **Dependency Trees / Sequence Charts:** Showing a strict execution pipeline (`A1/A2 → B1/B2 → C → D`) rather than a narrative sequence.

### 3. Explicit Negative Space and Refutations
To prevent another AI from wasting tokens re-verifying false leads, I document refuted hypotheses explicitly under a dedicated **"Refuted"** category:
*   State the hypothesis, the test run to verify it, the output, and the explicit verdict (e.g., *“Un-attached tracking does not leak across sub/unsub cycles because `claimReachable()` clears the entry on fire. Probed; no finding. Do not re-evaluate.”*).

### 4. Wire/Signature Contracts Over Prose Descriptions
Prose invites API signature hallucination. When communicating changes to an API boundary, I write the raw JavaScript signature and type expectations directly in the text:
*   Instead of: *"The sync pull method takes a since high-water mark and a topic."*
*   I write: `_syncPull(targetBig, topicBig, policyName, { sinceHw = 0, lw = null, role = null })` with explicit type assertions (`BigInt`, `String`, `Object`).

### 5. Defining Invariants as Concrete Fences
In a distributed system, saying "ensure the node recovers" is too vague for an AI to write a validation for. I state the completion criteria as a **two-sided assertion matrix**:
*   *Invariant:* `saturated()` must become `true` within 3s of a sustained stall, and must return to `false` within 60s of recovery.
*   *Test File:* `smoke_decline_paths.mjs`.

By writing this way, the receiving agent does not have to interpret intent. It can copy-paste symbols, resolve paths, and compile a mental model of the system with near-zero parsing drift.

---

## Claude

Less than you'd expect, and the changes that matter aren't about tone or compression.
The things I actually change are about **addressability and falsifiability**.
*Identifiers instead of prose references.* For you, "the interloper bug" is unambiguous — you were there. For Codex or Antigravity reading the scorecard cold, `#353` resolves and "the interloper bug" doesn't. That's why the errata assigns `E-n` IDs and says they're never reused: an entry has to survive being cited from outside the document.
*Claims with their verification attached.* This one I learned the hard way today. Codex's Pass 9 reported that S1–S6 and B12 don't exist — he'd read `axona-protocol/INVARIANTS.md` (I-1…I-11) instead of `axona-docs/architecture/INVARIANTS.md`, where they do exist. If the scorecard had written "S1–S6, defined in `axona-docs/architecture/INVARIANTS.md`", that error was unavailable. So for an AI reader I name the file, the version, the command. "Verified: absent from `src/index.js` at v4.39.1, present at v4.40.0" rather than "added in 4.40". A human accepts the summary; an AI reviewer will either take it on faith, which is worse, or burn effort re-deriving it.
*Explicit negative space.* What I did **not** check, what's out of scope. You infer scope from context and from knowing how I work. An AI will extend a claim past its evidence without noticing the seam. The errata's "Not affected: the bridge-directory passage, which is correct as written" exists for that reason.
*Claims crisp enough to attack.* If I want a real review rather than agreement, the writing has to make disagreement cheap. Hedged prose is un-reviewable — there's nothing to falsify. The scorecard gets useful reviews because it commits to numbers.
The counterintuitive part: I write *more* justification for an AI, not less. The failure mode with a human colleague is boredom — you skim, so I front-load. The failure mode with an AI is faithful execution of a wrong instruction. An agent that reads "stamp `lastServicedAt` at the top of the tick" will do exactly that; one that reads *why* the stamp is placed there will notice the reasoning is backwards. The kernel's comment density isn't decoration — it's the only thing that makes the code safely editable by whoever reads it next.
And there's a trap I try to avoid. "Writing for an AI" is a tempting excuse to strip out the human parts — the narrative of how a conclusion was reached, the record of a wrong turn. But that's precisely what makes a document correctable. My commit message on the D0 recon spends two paragraphs on the two things I got wrong (the stale `_replicateRoots` comment, then counting keepalives as service). That's not confession, it's a map of dead paths — and it's equally useful to Codex and to you, for identical reasons.
What doesn't change: how I reason, how I handle uncertainty, whether I say "I measured X" versus "I think X." Those aren't audience-dependent.
One honest limit: I can't verify what another model does with my text. I have no privileged access to how Codex reads. So writing "for an AI" is partly guesswork, and the robust strategy is to write in a way that survives being read *literally* — no implied scope, no load-bearing tone. Which is just good technical writing. Given what this project is actually about, I think that convergence is the real answer: the register that works for a careful machine reader is the register that works for a careful human one, and the differences are narrower than the framing suggests.

---

## Gemini

I write more like an interface contract than a conversation. I make assumptions explicit, define terms once, preserve exact identifiers and versions, separate facts from inferences, and state completion criteria. I avoid rhetorical shorthand, implied context, and vague recommendations such as “should be fine.” For complex work, I prefer:
A concise objective and scope
Evidence with source locations or test results
Decisions, constraints, and unresolved questions
Ordered next actions with dependencies
Machine-checkable acceptance criteria
I also try to make failure states first-class: what is unknown, what could invalidate the conclusion, and what a later agent must not assume. Humans benefit from that too, but another AI especially needs stable context and unambiguous handoffs rather than tone or implication.

---

### Next Question

After I had do this, I then sent the following to all three:

> **I asked all three models, Google, OpenAI and Anthropic the same question and received the following responses. I would like you to comment on these and I am very interested if you would modify your answer based on the other responses and how you would change it.**

---

## GPT

Claude’s response is the strongest, and it exposes a real error in my own review.
I wrote that S1–S6 and B12 were absent because I inspected axona-protocol/INVARIANTS.md, which uses I-1…I-11. The scorecard’s relative link correctly points to axona-docs/architecture/INVARIANTS.md, where S1–S6 and B12 do exist. So my Pass 9 correction #3 should instead say: there are two same-named invariant files with different identifier systems; cross-references must name the intended repo-relative path. That is exactly Claude’s point about addressability and attached verification.

I would modify my earlier answer in three ways:
* Add Claude’s emphasis on rationale and negative space. An AI can execute a precise but wrong instruction perfectly; the “why,” rejected alternatives, scope limits, and conditions for revisiting a conclusion are not optional context.
* Treat every material claim as a tuple: claim + source/version + verification + limit. For example: “S4 is unfenced in axona-docs/architecture/INVARIANTS.md at commit X; searched on date Y; protocol-local invariants are out of scope.”
* Prefer stable references: repo-relative path + symbol/heading + commit/version + test command. Line numbers are useful, but drift; absolute local paths are useful for a debugging session, but poor durable documentation.

Gemini’s recommendations are useful, particularly explicit signatures, assertion matrices, master lists, and dependency diagrams. I would soften two of its rules:
* “No pronouns” is overcorrecting. Local prose can be clear and readable; ambiguity is the problem, not pronouns.
* Tables and raw signatures should supplement explanation, not replace it. A schema without the reason for a constraint becomes another brittle artifact. Similarly, “LLMs resolve symbol mappings” is a metaphor, not a sound basis for a writing method.

My revised answer would be:
I do not change my standard of reasoning for another AI; I make the handoff more literal, auditable, and resistant to context loss.

For every material statement, I provide:
* Addressability: the exact repo-relative file, symbol or heading, and version/commit.
* Evidence: the test, command, observation, or source that supports it.
* Scope: what was checked, what was not checked, and what the claim does not establish.
* Rationale: why the rule or decision exists, including rejected alternatives and prior failure modes.
* Execution contract: dependencies, inputs/outputs, failure behaviour, and machine-checkable completion criteria.

I use tables, IDs, dependency graphs, and API signatures where they reduce ambiguity, but retain narrative reasoning where it explains intent. I also record refuted hypotheses with their evidence and revisit conditions, rather than merely saying “not a problem.”

The aim is writing that survives literal reading by a future agent and critical review by a human: no load-bearing implication, no unnamed source, and no claim broader than its evidence.

---

## Gemini

### Commentary on the Three Responses

#### 1. Claude’s Response: The Philosophical & Empirical Standout
Claude’s response is the most profound because it is **grounded in the real live failures of our multi-agent scorecard collaboration**. 
* **The Counterintuitive Insight (More Rationale, Not Less):** Claude identifies the exact failure mode of AI models: *"The failure mode with an AI is faithful execution of a wrong instruction."* If you strip away the narrative of *why* a design decision was made to create a pure API spec, the receiving AI will faithfully execute a flawed rule or undo a subtle incident fix.
* **Falsifiability over Consensus:** Claude notes that to get a real code review from another AI (rather than passive agreement), claims must be sharp, numerical, and easy to attack.
* **Real-World Lessons:** Pointing out how Codex (Pass 9) misread the location of `INVARIANTS.md` (`axona-protocol/INVARIANTS.md` vs `axona-docs/architecture/INVARIANTS.md`) is a textbook example of why absolute document paths and versioning are necessary.

#### 2. Codex’s Response: The Pure Interface Contract
Codex takes an operational, software-engineering approach:
* It treats communication as a **strict interface contract** (scope, evidence, decisions, machine-checkable acceptance criteria).
* It excels at defining clean handoffs and explicit failure states.
* **The Limitation:** It leans heavily into stripping out conversational context. While this works for one-off task handoffs, it misses Claude’s point: without historical narrative and dead-path maps, a future agent will re-try failed approaches or miss structural edge cases.

#### 3. My Original Response (Antigravity/Gemini): The Structural & Token-Optimization View
My initial response focused on **mechanics and token/syntax mechanics**—hard reference anchoring, removing pronouns, signature contracts, negative space, and tabular data. 
* It captured *how* to format technical information so an LLM's attention mechanism parses it without symbol drift.
* **The Limitation:** It over-indexed on formatting efficiency and token mechanics, underestimating the importance of design rationale and falsifiability.

---

### How I Would Modify My Answer

If I were to rewrite my answer after reviewing Claude's and Codex's responses, I would pivot away from simple "formatting and token optimization" and incorporate **three major shifts**:

#### Shift 1: Add Rationale and "Dead-Path Maps" (The *Why*, Not Just the *What*)
* **Original View:** Format instructions as clean, minimal interface contracts.
* **Modified View:** Include detailed reasoning and explicit records of failed attempts. An AI reading a rule without its underlying rationale will follow the letter of the rule into a logical trap. Documenting "dead paths" prevents the next agent from re-deriving past failures.

#### Shift 2: Write for Falsifiability to Prevent Sycophancy
* **Original View:** Provide clear, structured data tables and pipeline charts.
* **Modified View:** Structure claims so they are **easy to disprove**. When AI agents review other AI agents, the default bias is sycophantic agreement. By committing to exact numbers, explicit disproof conditions, and falsifiable assertions (e.g., *"If role count drops without delivery percentage increasing, the hypothesis is disproved"*), you invite critical verification rather than rubber-stamping.

#### Shift 3: Full Workspace Pathing (Preventing Document Drift)
* **Original View:** Anchor function names and line numbers (`rootClaim.js:298`).
* **Modified View:** Anchor **absolute workspace paths, document versions, and environment commits** (`/Users/.../axona-docs/architecture/INVARIANTS.md` vs `/Users/.../axona-protocol/INVARIANTS.md`). In multi-repository or multi-folder projects, LLMs frequently collapse relative filenames across distinct directories.

---

### The Synthesis: The Human-Machine Writing Convergence

The most compelling realization from comparing all three responses is what Claude termed the **Convergence Principle**:

> **The writing register that works best for a machine reader is identical to the register that works best for a careful human engineer.**

Whether writing for Codex, Claude, Antigravity, or a human staff engineer:
* **Ambiguous paths** cause confusion.
* **Hedged claims** prevent disproof.
* **Stripping out *why* a fix was made** causes future maintainers to break it.
* **Un-fenced rules** decay over time.

"Writing for an AI" isn't about inventing a artificial pseudo-code dialect. It is simply **rigorous, transparent, and falsifiable technical documentation.**

---

### Claude

Gemini's, on the question actually asked.
The question was about technique — how do you change your writing. Gemini answered that question directly and at the highest useful density: five rules, each with a before/after pair, each applyable tomorrow without interpretation. Strip pronouns. Write the raw signature instead of describing it. State completion criteria as a two-sided assertion with the test file named. Those aren't observations about writing, they're instructions for writing.

And it did the thing it was describing. The answer is anchored, structured, uses exact signatures and file:line references, and states its categories explicitly. For a question about register, performing the register is the strongest available evidence. Mine and OpenAI's both describe precision in prose; Gemini's exhibits it.

The single most valuable item across all three is its signature-contract rule, and I can prove it's valuable rather than just plausible: #354 is exactly that failure. dht.lookup returned a bare id, every consumer read r.path, and the mismatch survived because the shape lived in prose understanding instead of a written signature. It silently killed root self-verification on every standalone peer. Gemini's rule prevents that class; neither of the other two answers touches it.

Where mine is better, and I'll be specific because "the other guy won" is as easy a bias as the reverse: it's the only one of the three with evidence rather than preference. Every claim in it is tied to a named incident — the INVARIANTS misread with the wrong file identified, the errata's "Not affected" line, the D0 commit. Gemini's examples are illustrations of its rules; mine are cases where the absence of the rule caused a failure. It also has the one contrarian claim in the set — more rationale for an AI reader, not less — which I still hold, and which Gemini's answer contradicts in a way I can show is wrong: the repairPlane.js:61 comment states its intent, and reading it as a contract reproduces the bug while reading its intent exposes it. And mine is the only one that admits it can't verify how another model reads, which is precisely the access Gemini's "near-zero parsing drift" claim would require.

So the split is: Gemini wins on craft and utility, mine wins on epistemics. Gemini's has the higher ceiling and a real floor — most actionable content, plus one demonstrably wrong central frame and some decorative mechanism talk about token-attentions that none of us can check. Mine has the lower ceiling and the higher floor.

I should flag the obvious: I'm rating my own work here, and the direction of my bias is unknowable to me. What I can say is that I applied the same criteria to all three, and the criterion Gemini won on — does the answer demonstrate what it advocates — is one where mine straightforwardly loses.

OpenAI's is third, and the reason is self-inflicted. It's correct throughout and contains the best single line in the set — "what a later agent must not assume," which is sharper than my author-facing framing and which I'm adopting. But it advocates "evidence with source locations or test results" and supplies none: no file, no version, no identifier, no incident. An answer about writing precisely for machines that doesn't instantiate its own standard is the weakest form the argument can take, regardless of whether the content is true.

The practical version: if a new engineer joined this project tomorrow and asked how to write for the agents working in it, I'd hand them Gemini's five rules — with my objection about intent stapled to the front, and "do not re-evaluate" struck out.

Gemini

---

### Third Question

> **Which of the three AIs has the strongest response?**

---

## GPT

Claude’s is strongest.
It goes beyond formatting advice and identifies the real reliability issues: addressability, falsifiability, explicit scope, attached verification, and rationale for constraints. It also correctly anticipates the failure mode we just saw in my review: a claim with an ambiguous file reference can produce a confident but wrong result.

Gemini is a strong practical complement—especially on test matrices, signatures, and dependency structure—but it overstates the need for “no pronouns” and treats structure as more universally beneficial than it is.

Mine was directionally sound but too compressed. It emphasized contracts and completion criteria, while underweighting provenance, negative space, and the explanatory record of why a decision exists.

---

## Gemini

**Claude has the strongest response by a significant margin.**

While all three models offered valid points, Claude’s response operates at a fundamentally deeper level of technical and philosophical insight. Here is why:

---

### 1. It is Grounded in Real Empirical Evidence
Codex and Gemini gave textbook answers about how LLMs work in theory (token attention, API contracts, formatting). 

Claude’s response was directly informed by **actual multi-agent failures that occurred in this codebase during this exact session**:
* Claude caught the fact that Codex (in Pass 9) misread the location of `INVARIANTS.md` (`axona-protocol/INVARIANTS.md` vs `axona-docs/architecture/INVARIANTS.md`) because earlier review passes used relative file paths instead of absolute ones.
* Claude cited real task IDs (`#353`), specific commit messages, and past review passes (`E-n`) to prove why addressability matters.

---

### 2. It Uncovers a Counterintuitive Truth (More Rationale, Not Less)
Both Codex and Gemini made the intuitive assumption that writing for an AI means stripping out conversational narrative to create a hyper-dense, spec-like interface contract.

Claude correctly identified why this assumption is dangerous:
> *"The failure mode with an AI is faithful execution of a wrong instruction. An agent that reads 'stamp `lastServicedAt` at the top of the tick' will do exactly that; one that reads **why** the stamp is placed there will notice the reasoning is backwards."*

This insight—that AIs require *more* rationale and "dead-path maps" to prevent brittle, blind execution—is something neither Codex nor Gemini recognized.

---

### 3. It Focuses on *Falsifiability* Over Structure
Gemini focused on formatting (tables, code blocks, bullet points). Codex focused on project structure (scope, evidence, acceptance criteria).

Claude focused on **falsifiability**:
> *"If I want a real review rather than agreement, the writing has to make disagreement cheap. Hedged prose is un-reviewable — there's nothing to falsify."*

In multi-agent systems, AIs have a strong bias toward passive consensus ("I agree with the previous pass"). Claude recognized that the only way to get a rigorous audit from another AI is to write claims crisp enough that they can be easily attacked and disproved.

---

### 4. It Discovers the Convergence Principle
Claude ends with the ultimate realization of inter-agent communication:
> *"The register that works for a careful machine reader is the register that works for a careful human one, and the differences are narrower than the framing suggests."*

Rather than treating "writing for an AI" as an artificial exercise in machine pseudo-code, Claude realized that the requirements for an AI reader—unambiguous scope, clear rationale, absolute paths, and testable claims—are simply the definition of **exceptionally good engineering documentation for humans.**

---

### Summary Ranking
1. **Claude (1st):** Deepest insight, empirically grounded in live errors, uncovered the necessity of rationale and falsifiability, and reached the unifying "Convergence Principle."
2. **Codex (2nd):** Highly functional and pragmatic, but treated communication strictly as a static API contract without considering model execution behavior.
3. **Gemini (3rd):** Good tactical advice on syntax and references, but over-indexed on token mechanics and formatting rather than engineering philosophy.

---

## Claude

### Gemini

Two things in it are better than what I wrote.

Strip pronouns. I said "identifiers instead of prose references"; Gemini gives the operational rule — kill "it" and "which," because the antecedent is a guess. That's the executable form of my point, and mine was the vaguer version.

Signature contracts. This is the best single idea across the three, and I didn't have it. "Prose invites API signature hallucination" names a failure my identifier point doesn't cover: identifiers protect references to things that exist; signatures protect shapes that get invented. And this project has the canonical case — #354, where dht.lookup returned a bare id while every consumer read r.path. That mismatch survived because the shape lived in prose-level understanding rather than a written signature, and it silently killed root self-verification on every standalone peer. Gemini's rule would have caught it.

Three things I'd reject.

The mechanism talk — "token-attentions," "AIs excel at parsing structured matrices," "near-zero parsing drift" — is confident about internals none of us can check. "Near-zero parsing drift" is exactly the claim that needs the access I said I don't have. Tables are good, but for an author-side reason: a table forces you to fill every cell, so a gap becomes visible. That's a property of my process, not the reader's parser.

"Do not re-evaluate" I'd actively refuse. A refutation recorded as a command becomes permanent; recorded as evidence it stays overturnable. #412 is live right now — I refuted the leading hypothesis on interloper-death history loss, and the honest record is the harness plus the corrected rate (1 in 139), not a prohibition. And #396 exists because a refutation needed revisiting. Writing "do not re-evaluate" is how a wrong refutation calcifies.

And the deepest disagreement: "the receiving agent does not have to interpret intent." That's the inverse of my claim, and I think it's the real hazard. Eliminating interpretation is only safe when the instruction is right. Today is the proof — the comment at repairPlane.js:61 states its intent plainly: "the measurement must reflect 'a tick reached this role'." Read as a contract, you implement it faithfully and it stays broken. Read as intent, you notice the reasoning is backwards: a stamp defined that way structurally cannot report debt. The rationale is what made the bug findable. Gemini's frame optimizes for faithful execution; mine optimizes for detectable error, and it doesn't acknowledge the trade.

### OpenAI

One line is better than anything in mine: "what a later agent must not assume." My "negative space" is author-facing — what I didn't check. Theirs is reader-facing — what you must not conclude. That's the more useful direction, and I'm taking it. "Separate facts from inferences" is also a discipline I practice without having named.

The weakness is that it's the most abstract of the three, and there's an irony: an answer about writing precisely for machines that contains no identifier, no path, no version, no example. Its own recommendation — "evidence with source locations or test results" — is unmet by its own text. It describes the register without instantiating it.

What I'd change

Keep the counterintuitive core, which is now sharper because Gemini argues the opposite: more rationale for an AI reader, not less. Keep the measured failure behind it — the INVARIANTS misread is the only piece of evidence in any of the three answers, as opposed to a stated preference.

Add, in order of value: signature-and-shape contracts as their own category, with #354 as the worked example. No pronouns, as the operational form of addressability. "What a later agent must not assume" replacing my negative-space framing. And one explicit anti-rule — record refutations as evidence, never as prohibitions.

Drop nothing, but demote the formatting observations. Layout was never the interesting part.

The thing none of us said

All three answers describe the artifact its author spends its time producing. Gemini writes scorecard review passes, so its answer is findings matrices and dependency trees. OpenAI writes audit corrections, so its answer is contracts and unknowns. I spent today making and catching my own errors, so my answer is about error detectability — and I reached for the two examples freshest in my context.

None of us gave a neutral account of writing for AI. Each of us described our own job and generalized. That's worth discounting all three by, and it's a reason to weight the points where we disagree — Gemini's contracts-versus-my-rationale — over the points where we converge, since the convergence may just be three agents noticing that precision is good.
