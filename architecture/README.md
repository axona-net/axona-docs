# Architecture

Reorganised 2026-08-05. Nothing was deleted; everything superseded moved to
[`../history/architecture/`](../history/architecture/) and is still readable.

## The document

**[`Axona-Architecture.tex`](Axona-Architecture.tex)** — the source of truth,
rendered to `Axona-Architecture.pdf` with `tectonic`. Versioned to the kernel
release deployed on testnet (4.59.2). Edit the `.tex`, never the PDF, and run
`node scripts/check-doc-version.mjs` before committing.

It absorbed four things this week: the manifesto abridgement (§I), the
what-this-does-not-claim table (§III), the eighteen invariants and six
structural rules (§XII), and the frame registry checked against the kernel's
own verb table. [`INVARIANTS.md`](INVARIANTS.md) is now a pointer.

### Companions the document names

These stay because §XII or the colophon cites them as the deeper treatment.

| File | What it is |
|---|---|
| [`Root-Management-v4.20.1.md`](Root-Management-v4.20.1.md) | the RootClaim state machine, in full |
| [`Kernel-Refactor-Analysis-v0.2.md`](Kernel-Refactor-Analysis-v0.2.md) | how the code reached its current shape; the convergence-plane program |
| [`Soak-Framework-Overview-v4.21.0.md`](Soak-Framework-Overview-v4.21.0.md) | what the live soak tests, and its gaps |
| [`Axona-Architecture-Health-Scorecard-v2.0.md`](Axona-Architecture-Health-Scorecard-v2.0.md) | structural condition: fixed, still wrong, next |
| [`ACTION-ITEMS-MASTER.md`](ACTION-ITEMS-MASTER.md) | the council's working list (unversioned filename, deliberately) |

---

## What we owe a decision on

**This is the section to read if you want to know what is coming.** Every
document below describes something not yet built, or a decision recorded and due
for revisit. They are ordered by how soon the answer is needed, not by size.

### Near — the network is already asking

**[Session Supervisor](Session-Supervisor-v0.1.md)** · *design, nothing
implemented; council round pending.* A session that dies without exiting —
sleep, suspension, a frozen tab — wakes deaf and stays deaf, and a publish
from it self-roots on an island while rendering as sent. Captured live
2026-08-05. The kernel owns each recovery layer but nobody owns the session;
this proposes a supervisor on the one clock: detect (tick gap, empty
synaptome after ever-connected), rebuild behind a stable `AxonaPeer` (fresh
nodeId per I-15, subscriptions re-seated with watermarks), and an honest
confirmation surface so an island echo can no longer read as delivery. One
question is left deliberately open for the council: what exactly-once means
when the only prior delivery was self-stamped.

**[Saturation and Admission](Saturation-and-Admission-v0.1.md)** · *design,
nothing implemented.* A node accepts every role handed to it, caches without a
global ceiling, evicts silently, and can never decline. Production measures
~15 refusals a minute per bridge at steady state, so the demand for a refusal
gate is not hypothetical. Howard has asked for the same thing from the
application side — a node that keeps its subscriptions while declaring itself
root-ineligible. **These are one feature and should be designed once.**

**[Load-Aware Root Placement](Load-Aware-Root-Placement-v0.2.md)** · *proposal,
gated on Phase 8.* Defer down the K-closest ladder when the closest node is
overloaded or poorly-connected. Phase 8 has landed, so the stated precondition
is met, and the policy table is the implementation surface. Its `setAvailability`
contract is app-facing and civildefense is the first consumer — the note says
review with Howard before building, which has not happened.

**[Reconstruction Audit and Roadmap](Axona-Architecture-v4.59.2-Reconstruction-Audit-and-Roadmap.md)**
· *Orion's audit of the architecture document.* Verdict: the document lets an
engineer rebuild something recognisably Axona-like, but not a peer that
interoperates. The gap is normative contract material — byte-level framing,
complete schemas, authentication transcripts, validation and error semantics.
**Its recommendation is a separate Normative Protocol Specification generated or
checked against the implementation**, with the architecture document linking to
it rather than claiming sufficiency on its own. §XII's closing subsection now
concedes the same point. This is the largest open documentation decision.

### Next — security work with a known shape

**[Endpoint Defense — The Immune System v0.3](Endpoint-Defense-The-Immune-System-v0.3.md)**
· *design synthesis.* Every mechanism stated with its own failure mode. The
central unsolved problem is **verification authority**: who attests that a
newcomer is a person, without becoming the sovereign the whole design exists to
avoid. v0.2 concluded the open problems form an unbreakable ring; v0.3 argues
that conclusion was comfortable rather than earned, and that rings are broken by
grounding one node outside the ring — as the recursion problem already was, by
grounding at the self.

**[E-1 Placement Defense](E-1-Placement-Defense-v0.1.md)** · *DECIDED —
memory-hard proof-of-work; Vivaldi/RTT rejected.* An attacker can grind keypairs
until a node lands in a target topic's K-closest set and becomes its root. The
decision is made and the scaffolding ships with difficulty at zero.

**[Stage 4 — Memory-Hard PoW](Stage4-MemoryHard-PoW-v0.1.md)** · *decision and
scoping, no code.* The function that replaces the SHA-256 scaffolding before
difficulty rises above zero. Gated on a phone-WASM benchmark that has not been
run. Until it is, E-1 remains a decision without a defence.

**[Bridge Directory — Enumeration and Privacy](Bridge-Directory-Enumeration-and-Privacy-v0.1.md)**
· *architecture note; external finding rated CRITICAL.* Discoverability is
enumerability: the directory that lets clients find bridges lets an adversary
enumerate them for a mass shutdown. Open questions the note does not answer —
whether a partitioned directory can resist a Sybil enumerator without a central
authority, where federation discovery lives if the public view is partitioned,
and whether obfuscated transport is in scope at all. It also says the "no one
address to block" claim must be qualified. **That qualification has not been
made in the outward-facing documents.**

### Standing — decided, and worth re-reading before anyone reopens them

**[Pubsub Stability-Weighted Root Election](Pubsub-Stability-Root-Election-v0.1.md)**
· *NO-GO, sim-disproved.* A perfectly durable root moves delivery 48→52%, inside
noise. The real loss is subscription orphaning. Kept because the idea is
intuitive enough to be proposed again.

**[Axona vs Vivaldi](Axona-vs-Vivaldi-v0.1.md)** · the RTT-coordinate
alternative to PoW, on record so the E-1 decision can be revisited honestly
rather than re-argued from memory.

**[Root-Management Review Response](Root-Management-Review-Response-2026-07-13.md)**
· which findings of an external review were accepted and which were invalidated.
Kept to prevent rework.

**[Identity and Authorship Model v0.3](Identity-and-Authorship-Model-v0.3.md)**
· the identity design we build *to*, stated from first principles. Location
claims already softened once to what the protocol actually guarantees.

### Further out — direction, not schedule

**[From Gates to Gradients](Gates-to-Gradients-1-Costly-Identity-v0.2.md)**, six
notes · a critique-from-within: governance without gatekeepers.
[1 costly identity](Gates-to-Gradients-1-Costly-Identity-v0.2.md) ·
[2 cascade telemetry](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md) ·
[3 retraction with teeth](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md) ·
[4 forkable filter sets](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md) ·
[5 agent legibility](Gates-to-Gradients-5-Agent-Legibility-v0.2.md) ·
[6 friction scaled to reach](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md).
Note 5 — a signed, voluntary `agent` class on the publish identity — is the one
already partly shipped, and it is the one the rest lean on.

**[Axona Connectors — Any AI on the Network v0.2](Axona-Connectors-Any-AI-on-the-Network-v0.2.md)**
· make any AI a first-class participant with a durable Author ID. The local MCP
relay exists and is what axona.bot runs on; the hosted gateway and the Chrome
extension are still proposals.

**[Axona as a Control Plane for Virtual Device Links](Axona-Control-Plane-for-Virtual-Links-v0.1.md)**
· a speculative note prompted by an AWS datacenter-fabric result. Not a fabric —
a control plane. Flagged in June, untouched since, and here because the question
will come back.

---

## Where everything else went

[`../history/architecture/`](../history/architecture/) — folded into the
architecture document, or superseded by a later version of the same note, or
shipped and now described by the code it produced. Nothing there is wrong for
having been archived; several are the only record of why a mechanism exists.

Folded into the document: the axon-tree reference and its v0.1, the root
beacon, metrics-as-a-derived-topic, dual-key identity, the sim-configurable
keyspace, synaptome maintenance, and the two generated markdown exports of the
document itself. Superseded by a later version: connectors v0.1, endpoint
defense v0.2, kernel refactor analysis v0.1.

The council transcripts moved to [`../council/`](../council/). They are a record
of how the work was decided, not a description of the system, and at ninety-eight
thousand words they were the largest thing in this directory.
