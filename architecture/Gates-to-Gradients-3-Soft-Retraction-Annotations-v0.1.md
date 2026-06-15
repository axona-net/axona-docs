# From Gates to Gradients — 3. Retraction with teeth, not deletion (v0.1)

**Status:** design note · **Flagged:** 2026-06-15 · **Relates to:**
[Pub/Sub Lifecycle & Access-Control Design v0.2](../implementation/Pubsub-Lifecycle-Design-v0.2.md) ·
companion essay *From Gates to Gradients* · sibling notes
[1 — Costly Identity](Gates-to-Gradients-1-Costly-Identity-v0.1.md),
[2 — Cascade Telemetry](Gates-to-Gradients-2-Cascade-Telemetry-v0.1.md),
[4 — Forkable Filter Sets](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.1.md),
[5 — Agent Legibility](Gates-to-Gradients-5-Agent-Legibility-v0.1.md),
[6 — Friction Scaled to Reach](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.1.md)

---

## TL;DR

On a substrate where any holder of the bytes keeps them, deletion is a fiction —
and pretending to delete earns no one's trust. But the **gap** between a
retraction and the still-circulating bytes can be made **visible**. Axona
already ships the *hard* primitive — owner-only `kill` + signed tombstones, and
`unpub` — which is best-effort cooperative removal. This note specs the *soft*
gradient on top of it: a signed **retracted-by-author** signal that removes
nothing and rides the same mesh alongside the message, plus its generalization,
a signed **annotation envelope** that references a `msgId` so anyone can attach
a correction or dispute. Display and weight are the subscriber's / filter's
choice — context, not control. That is the move from a gate (deletion someone
must enforce) to a gradient (attached signal everyone can read and act on as
they see fit).

## 1. The idea

Retraction on a peer-to-peer substrate cannot mean erasure. Once a signed
envelope has propagated, every holder of those bytes can keep them; a "delete"
that the holder can ignore is not a delete. The Axona pub/sub lifecycle design
is already honest about this: `kill` is documented as *"best-effort redaction,
not a cryptographic unsend"* — a subscriber that already received the message
can keep it, and an offline subscriber may never get the purge (Lifecycle §3.4).

So instead of pretending to remove, **make the retraction itself a first-class,
visible artifact**. The author publishes a small, signed *retracted-by-author*
signal that:

- references the original message by its `msgId`,
- removes nothing,
- rides the **same** pub/sub mesh as the message it concerns, traveling
  *alongside* it, and
- lets any good-faith node, filter, or agent attach context, down-rank, or
  hide-by-choice.

This converts retraction from **deletion** (impossible, dishonest) into
**attached context** (cheap, honest). The bytes may still circulate; what
changes is that they now circulate with a signed note from their author saying
"I take this back."

Generalize one step: the retraction is just a special case of an **annotation
envelope** — a signed pub/sub message that references a `msgId` and carries
context. The same machinery that carries an author's retraction carries a
third party's correction or dispute. Annotations *ride alongside*; they are
never authorities that remove.

## 2. How it helps

- **It is honest.** It claims exactly what it can deliver — a visible signal —
  and never the erasure it can't. This is the difference between a system users
  can trust and one that quietly fails the moment a holder declines to comply.
- **It closes the trust gap with visibility, not enforcement.** A reader who
  encounters the original message can also encounter the author's retraction
  and decide accordingly. The gap between "retracted" and "still out there"
  stops being silent.
- **It is a gradient, not a gate.** Nothing in the kernel forces a subscriber
  to hide a retracted message. The signal is advisory; the *response* lives in
  the filter / subscriber layer (sibling note 4). One reader hides retracted
  posts; another shows them struck-through with the author's note; an archival
  node keeps everything. Same signal, plural responses — governance unbundled
  from control.
- **It reuses machinery that already exists.** Annotations are ordinary signed
  pub/sub messages keyed to a `msgId`. No new transport, no new trust object
  class beyond a domain-tagged signed envelope (Lifecycle §0, E-4
  domain-separation discipline). The cost is small and the win is real.

## 3. How Axona provides it

### 3.1 The three tiers

| Tier | What it does | Who may issue | Removes bytes? | Status |
|---|---|---|---|---|
| **1 — Hard kill / tombstone** | Best-effort cooperative removal: root axon drops the cache entry, emits a signed tombstone so lagging replicas don't resurrect it, forwards an advisory purge marker to subscribers (`unpub` = same at queue scope) | **Owner-only** — `kill` by the message signer; `unpub` by the topic owner | Yes — *best-effort* (a holder who already has it can keep it) | **Exists** (Phase A, kernel v2.10.0) |
| **2 — Soft retract** | Author marks *their own* message retracted-by-author; a signed flag rides alongside the message. Nothing is dropped | **Owner-only** — must be the original message's signer | No — pure attached context | **New** (this note) |
| **3 — Third-party annotation** | Anyone signs a correction or dispute referencing a `msgId`; rides alongside as context | **Anyone** (signed; subject to abuse-bounding — §4) | No — pure attached context | **New** (this note) |

Tier 1 is a *gate* (an owner-authorized removal that cooperating nodes
enforce). Tiers 2 and 3 are the *gradient*: signals that change what a
message means without changing whether it exists. Crucially, **display and
enforcement are the subscriber's / filter's choice** — that choice is what
makes tiers 2–3 a gradient rather than a gate.

### 3.2 Mechanism — what already exists (tier 1)

From the pub/sub lifecycle design (read it for the authoritative spec):

- `peer.kill(topic, msgId)` — creator-only delete (`msgId` required, no "kill
  latest" footgun). Accepted **iff** the kill's `signerPubkey` matches the
  signer of the message identified by `msgId`. Because
  `msgId = sha256(canonical({publisher, message}))` is **publisher-bound**, a
  kill cannot target someone else's message (Lifecycle §3.1–3.3, kernel
  v2.18.0).
- **Signed tombstone** `{msgId, kill-proof}`, kept for the message's remaining
  hold window then GC'd, so a lagging or rejoining replica can't resurrect a
  killed message (Lifecycle §3.4).
- `peer.unpub(topic)` / `peer.unpub(topic, { destroy: true })` — owner-only
  drop of the whole queue, with the same tombstone discipline (Lifecycle §4.1).
- Bounded queues (1…256, default 100) and an **absolute-ceiling TTL**
  (`maxHoldMs`, default 24 h / cap 48 h) mean even an *un*-retracted message
  has a bounded lifetime regardless (Lifecycle §5, §6).

Tier 1 already obeys the discipline this whole series cares about: it is
self-authenticating (a signature check, no central authority) and honestly
documented as best-effort.

### 3.3 Mechanism — what to add (tiers 2 & 3)

Both new tiers are the **same shape**: a signed, domain-tagged pub/sub envelope
that references a target `msgId`. Sketch of the wire object (following the
Lifecycle §7 convention of a per-object-type domain tag):

```jsonc
{
  "kind":    "axona:pubsub-annotation:v1",  // domain tag (signed)
  "topicId": "<66-hex>",                     // same topic the target lives on
  "ref":     "<64-hex msgId>",               // the message this annotates
  "type":    "retract" | "correct" | "dispute",
  "body":    "<opaque>",                     // optional human/agent-readable context
  "ts":      1716210000000,
  "seq":     1716210000123,                  // issuer's own seq (freshness/replay)
  "signerPubkey": "<pubkey-hex>",
  "signature":    "ed25519:<…>"
}
```

- **Tier 2 (soft retract)** is the case where `type = "retract"` **and** the
  kernel can check `annotation.signerPubkey === signer(ref)` — i.e. the author
  retracting their own message. Because `msgId` is publisher-bound, this check
  is the same self-authenticating test `kill` already uses (Lifecycle §3.3);
  no new trust machinery. The difference from `kill`: **nothing is dropped, no
  tombstone is emitted.** The retraction is itself a message that propagates and
  is read.
- **Tier 3 (annotation)** is the open case: `signerPubkey` need not match the
  target's signer. Anyone may sign a `correct` / `dispute` referencing a
  `msgId`. The kernel verifies the signature and the reference; it does **not**
  adjudicate truth. The annotation carries *who said it* (the `signerPubkey`),
  never *whether they're right*.
- **Carriage.** An annotation is an ordinary signed pub/sub message on the same
  topic, so it inherits the existing freshness window, bounded queue, ordering
  (signed `seq`/`ts`), and TTL ceiling. A subscriber/filter pulling a topic can
  collect annotations keyed to the `msgId`s it is displaying and render or
  weight them however its filter set dictates (note 4).
- **Display is downstream and pluggable.** The kernel surface is just: *here is
  a signed envelope that references this msgId.* Whether a client hides,
  down-ranks, badges, or ignores a retracted/disputed message is a filter-layer
  decision, never a kernel one. That separation is the gradient.

### 3.4 Roadmap status

- **Tier 1 — shipped.** `kill` + tombstones + `unpub` are Phase A, live in
  kernel v2.10.0 (Lifecycle §9).
- **Tiers 2 & 3 — proposed here, not yet specced into the kernel.** The
  expected cost is low: one new domain-tagged signed object type
  (`axona:pubsub-annotation:v1`) carried over the existing pub/sub path, plus a
  client/filter convention for collecting annotations by `ref`. No new
  transport and no change to the trust model — it is the same signature check
  the lifecycle layer already performs. This is a cheap, visible, honest win;
  it is **not** yet a committed kernel release.

## 4. Honest limits

- **Advisory, not adversarial.** Soft-retract and annotations are advisory in
  exactly the same way `kill` is best-effort: a **malicious node or filter can
  ignore the flag and keep showing the original**, unannotated. These signals
  shape **good-faith** behavior — they do not constrain an adversary. This is
  the series' "cannot be bought" boundary: a gradient changes what a cooperating
  participant sees, not what a hostile one is forced to do. We must not document
  tiers 2–3 as guarantees, just as the lifecycle design is careful never to
  document `kill` as a privacy/recall guarantee (Lifecycle §3.4).
- **No erasure, by design.** Even tier 1 cannot recall bytes a holder already
  has. Tiers 2–3 don't even try; they only attach context. A reader who never
  fetches the annotation never sees the retraction.
- **Third-party annotations are a spam/abuse surface.** If anyone can attach a
  signed `dispute` to any `msgId`, a flooder can drown a message in junk
  annotations. Bounding this needs the rest of the series: **note 1 (costly
  identity)** to make a flood of annotator identities expensive, and **note 4
  (forkable filter sets)** to let subscribers choose *whose* annotations they
  honor. On their own, tiers 2–3 do not solve annotation spam.
- **No revocation of an annotation's reach.** An annotation, once published, is
  itself just a message — retracting an annotation means publishing a further
  retraction of it, not unsending it. Recursion bottoms out at the same honest
  limit.
- **TTL interaction.** An annotation rides the topic's queue and TTL like any
  message; a long-lived dispute on a short-TTL topic may outlive or be outlived
  by its target. Whether an annotation should inherit, extend, or be independent
  of the target's hold window is unresolved (§5).

## 5. Open questions

1. **Annotation lifetime vs. target lifetime.** Should an annotation's TTL be
   coupled to its target `msgId`'s remaining hold window, set independently, or
   allowed to outlive a killed/expired target (so "this was retracted" survives
   the original)? Coupling is simpler; decoupling is more honest about history.
2. **Annotations referencing killed messages.** If the target was hard-killed
   (tier 1) and tombstoned, should annotations referencing it still be served,
   suppressed, or themselves GC'd with the tombstone? A tombstone that drops the
   message but keeps "X retracted this" may be the most honest state — but it
   widens what a tombstone must carry.
3. **Discovery.** How does a client efficiently find all annotations for a set
   of displayed `msgId`s — a derived index keyed by `ref`, a side topic, or a
   pull-time scan? This is a performance/convention question, not a trust one.
4. **Should soft-retract and hard-kill be composable in one call?** An author
   might want to both `kill` (best-effort remove) *and* leave a standing
   retracted-by-author signal for holders the kill never reached. Worth deciding
   whether that is one ergonomic operation or two explicit ones.
5. **Annotation types beyond retract/correct/dispute.** Is a small fixed
   vocabulary right, or should `type` be an open string the filter layer
   interprets (pushing all semantics to note 4)? Open vocabulary is more of a
   gradient; a fixed set is easier to reason about.
6. **Abuse bounds quantification.** Exactly how much do note 1 (costly identity)
   and note 4 (filter sets) need to provide before third-party annotations are
   safe to enable on open (Model 1) topics? Owned topics (Models 2/3) inherit
   the publish ACL and are easier; open topics are the hard case.

---

*This is a design sketch exploring one move from the* From Gates to Gradients
*essay; it is not a committed roadmap item.*
