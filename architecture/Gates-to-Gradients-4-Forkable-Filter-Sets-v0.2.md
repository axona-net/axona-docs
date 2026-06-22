# From Gates to Gradients — 4. Subscription as a plural moderation surface (forkable filter sets) (v0.2)

**Status:** design note · **Flagged:** 2026-06-15 · **Revised:** 2026-06-21 (v0.2 — refreshed against the kernel 3.6.0 surface) ·
**Relates to:** the companion essay *From Gates to Gradients* (governance
unbundled from control); the bridge directory (kernel
[`bridgeDirectory.js`](https://github.com/axona-net/axona-protocol/blob/main/src/bridgeDirectory.js))
as the existence proof of the discover/rank/compose pattern; sibling notes
[1 Costly Identity](Gates-to-Gradients-1-Costly-Identity-v0.2.md),
[2 Cascade Telemetry](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md),
[3 Soft Retraction / Annotations](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md),
[5 Agent Legibility](Gates-to-Gradients-5-Agent-Legibility-v0.2.md),
[6 Friction Scaled to Reach](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md);
the open-source reference app + civildefense.io as the planned worked home for
this convention.

---

## TL;DR

A platform moderates by holding four levers. Axona dissolves three of them and
inverts the fourth, leaving exactly one surface where a community still has
agency: **subscription** — what each node relays and what each community chooses
to follow. The reflex is to dismiss subscription as a human-scale defence
against a machine-scale flood. The repair is to let the defence *also* run at
machine scale: make **filter sets** first-class — signed, versioned, published
objects that anyone can subscribe to, compose locally, and **fork** by
republishing under their own key. No new kernel primitive is required; this is
app-layer convention plus a reference implementation, and the existing bridge
directory already proves the discover/rank/compose pattern works.

## 1. The four surfaces, and the one that survives

Classical platform moderation operates four levers. On Axona —
self-authenticating, geo-aware P2P pub/sub running in browsers over
WebRTC/WebSocket with no platform in the middle — their fate is:

| Surface | Platform lever | Fate on Axona |
|---|---|---|
| Access | who may join | dissolved — a keypair and a tab |
| Distribution | what is amplified | dissolved — no ranker, no throttle |
| Retention | what stays up | dissolved — retraction is best-effort |
| Attribution | who said it | inverted — keys certain, identities unknown |

Access dissolves because participation needs only a self-generated keypair and a
browser tab. Distribution dissolves because there is no central ranker or
throttle to lean on. Retention dissolves because retraction is best-effort once
content has propagated. Attribution does not dissolve — it **inverts**: a signed
envelope makes the *key* (`signerPubkey`) certain while the *human* behind it
stays unknown.

What remains is **subscription**: what each node relays, and what each community
chooses to subscribe to. This is the surface Axona keeps. The argument of this
note is that the leverage lies in making that surface powerful and plural
instead of leaving it an afterthought.

## 2. The idea

Treat a **filter set** as published content, not as a private setting.

A filter set is a signed, versioned object — a curated list of rules over the
flow a subscriber sees (e.g. allow/deny by `signerPubkey`, by topic, by
content predicate) — published by its curator to that curator's own topic. A
subscriber can follow **one or many** curators' filter topics at once and
compose them **locally**: intersection, union, precedence between curators is
the subscriber's choice, evaluated on the receiving side. To **fork** a set is
to republish a modified copy under your own key. Switching cost is approximately
zero, because switching is just changing which topic(s) you follow.

The result is plural curation with fork-on-disagreement built in: many curators
compete, anyone who dislikes a set forks it, and no single curator is load-
bearing for the whole network.

## 3. How it helps

- **It scales the surviving defence to the threat.** Subscription stops being a
  human hand-sorting an inbox and becomes composable machinery — shareable rule
  sets, and your own agents on the *defending* side filtering inbound flow at
  machine speed (see note 5 on agent legibility).
- **It avoids re-centralisation at the edge — the email lesson, this time
  learned in full.** SMTP's openness correctly pushed spam-fighting to the edge,
  but the edge then re-centralised into a handful of filtering operators:
  lock-in migrated *to* the edge instead of being eliminated. Making filter sets
  first-class, forkable, and composable from day one is precisely the design
  that stops any single indispensable filterer from emerging — there is nothing
  to capture, because every set has a fork one topic-change away.
- **It keeps governance unbundled from control.** A curator shapes what willing
  subscribers see; a curator never controls what the wire carries. Curation
  becomes advisory speech, not an enforcement chokepoint.

## 4. How Axona provides it

**No new kernel primitive.** This is app-layer convention plus a reference
implementation, built directly on the existing kernel surface
(`peer.pub/sub/pull/host/unsub/kill/unpub/health`; `metrics()` is owner-only as
of v3.5.0, so curators read open counts via `metricTopic` instead).

**Schema (sketch).** A filter set is an ordinary signed envelope whose payload
is a versioned object, e.g.:

```jsonc
{
  "kind": "axona.filterset",
  "v": 3,                         // monotonic version; latest-wins per curator
  "name": "civicspace-baseline",
  "curator": "<signerPubkey>",    // implied by the envelope signature
  "updated": "2026-06-15T00:00:00Z",
  "rules": [
    { "op": "deny",  "match": { "signer": "<pubkeyA>" } },
    { "op": "deny",  "match": { "topic":  "axona:spam-demo" } },
    { "op": "allow", "match": { "signer": "<pubkeyB>" } }
  ],
  "extends": [ "<otherCuratorPubkey>" ]   // optional: compose-by-reference
}
```

**Mechanism.**
- A curator publishes the set to *their own* topic. Two natural topic shapes,
  both already supported by the v3.0 write-policy model: an **owner-namespaced
  topic** `{ region, owner, name }` (one curator, one stream, owner-only writes,
  versions `v`-ordered), or — for a registry of available sets — an **open
  `{ region, name }` directory topic** that every client derives identically and
  on which curators advertise their sets as signed entries.
- Clients **subscribe** to one or many filter topics, **pull** the latest
  version per curator, dedupe by `signerPubkey`, and **compose** the rules
  locally. Intersection/union/precedence ordering is the subscriber's policy,
  not the curator's.
- **Fork** = take a set, modify it, publish under your own key. The original is
  untouched; subscribers move by re-pointing their subscription.

**Existence proof.** This is exactly the shape of the
bridge directory: bridges advertise themselves as
signed entries on the public topic `axona:bridge-directory`; clients collect
them, dedupe by `signerPubkey`, and **rank locally** (configured roots first,
then first-party reputation, then fresh-by-proximity), and never auto-replace
their configured primary. A filter set is the same pattern aimed at content
instead of infrastructure: published entries that others discover, rank, and
compose on their own side — and, as with the bridge directory's "never auto-
replace the primary," a subscriber's *own* choices always override any followed
set.

**Roadmap status.** Not yet specced. Cheap to prototype — it rides existing
primitives and needs only an agreed payload schema plus reference compose logic.
High *ecosystem* leverage: its value is in setting the norm early, before any
de-facto default filterer can entrench. The planned home for the worked
reference is the open-source reference app and civildefense.io, which are
already slated to consume Axona's pub/sub lifecycle and access models as the
app-layer reference.

## 5. Honest limits

- **Filtering is opt-in and advisory.** It shapes what a *willing* subscriber
  sees; it never changes what the wire carries. A determined publisher still
  reaches anyone who has not filtered them — consistent with the series'
  "cannot be bought" boundary. This is a feature (no chokepoint) and a limit
  (no hard removal); pair it with soft retraction / annotations (note 3) for the
  cases where you want a visible counter-signal rather than silence.
- **Filter sets are themselves content, so they can be spammed or be low
  quality.** The discovery layer inherits the same flood it is meant to tame.
  Costly identity (note 1) is the upstream brake here: it raises the price of
  the throwaway keys that would otherwise mass-produce junk sets.
- **A "default filter set" could harden into a de-facto gate.** If one set ships
  as the default in popular clients, its curator quietly reacquires the
  distribution lever subscription was supposed to disperse. The anti-re-
  centralisation design — first-class forking, zero switching cost, plural
  curators by construction — exists precisely to keep a default *defaultable
  away from*. Naming it is not the same as defeating it; client UX that makes
  forking and multi-following obvious is part of the unspecced work.

## 6. Open questions

- **Compose semantics as a standard vs. a free-for-all.** Should
  intersection/union/precedence be a small standardised algebra (interoperable,
  but a soft form of centralisation in the *spec*) or fully client-defined
  (maximally plural, but sets behave differently in different clients)?
- **`extends` / transitive composition.** If sets can reference other curators'
  sets, how deep does resolution go, and how are cycles and version skew across
  referenced curators handled? Latest-wins per curator is assumed but unproven
  at depth.
- **Predicate expressiveness vs. cost.** Signer/topic matching is cheap;
  content predicates are more powerful but invite an arms race and per-message
  evaluation cost in the browser. Where is the right ceiling?
- **Discovery ranking without a reputation oracle.** The bridge directory ranks
  by first-party reputation; what is the content-filter analogue that does not
  reintroduce a global score (against the no-centralised-reputation
  constraint)?
- **Revocation / staleness of a followed set.** A curator can `unpub`/`kill`
  their latest version, but cached copies persist on followers; what is the
  intended freshness contract?

---

*This is a design sketch, not a committed roadmap item.*
