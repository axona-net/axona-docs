# Errata — corrections to the Axona developer documentation

**Covers:** the programmer-guide set (Programmer Guide, API Reference, Quick Start,
Services Guide, AI Reference, AI Grounding) at **v4.48.0**, against kernel
**4.49.0** as deployed on testnet and production.

**Last updated:** 2026-07-29

---

## Why this file exists

The developer docs render to PDF (Pipeline A: markdown → pandoc → tectonic) and are
linked from the website. Correcting a sentence therefore used to mean re-rendering
five PDFs, archiving the priors to `history/`, relinking the README, and touching
the site — a disproportionate amount of machinery for a two-line fix, and enough
friction that small known-wrong statements tend to sit uncorrected.

This file is the release valve. It is **markdown only, never rendered** (Pipeline D),
so it can be corrected in one commit with no build step and no website change.

**It is normative.** Where this file and a rendered document disagree, **this file is
correct.** The rendered documents carry a version; this file carries a date.

**Entries are not permanent.** At the next substantive documentation cycle, every
open entry here is folded into the source markdown, the PDFs are re-rendered, and the
entry is marked integrated with the version that absorbed it. This file is a queue,
not an archive — see *Retiring an entry* at the bottom.

---

## E-1 — The rendered documents do not yet point here

**Status:** OPEN · applies to all six programmer-guide documents
**Raised:** 2026-07-29

This is the bootstrap problem, and it is listed first because it is the one entry a
reader cannot discover by reading the documents.

None of the six rendered documents currently mentions this errata file. A developer
holding `Axona-API-Reference-v4.48.0.pdf` has no way to learn that corrections to it
exist. Until the next render, discovery depends entirely on the
`axona-docs/README.md` link and on whoever hands the document over saying so.

**What the next render must add** — a short block near the top of each of the six
source documents, before the first section:

> **Corrections.** This document is versioned and rendered; corrections between
> renders are collected in
> [`programmer-guide/errata.md`](https://github.com/axona-net/axona-docs/blob/main/programmer-guide/errata.md).
> Where the errata and this document disagree, the errata is correct. Check it before
> relying on anything here.

Wording it as *"check it before relying on anything here"* rather than *"see also"*
is deliberate: a reader who treats the errata as optional supplementary reading
defeats the purpose.

**Until then**, this file is reachable from `axona-docs/README.md`, which is
markdown and needed no render — so the link is live today even though the PDFs are
not yet aware of it.

---

## E-2 — `host()` is in-memory intent, not persisted state

**Status:** OPEN · `Axona-Services-Guide-v4.48.0` (the layer diagram, ~line 58);
also implied wherever `host()` is described as conferring durability
**Raised:** 2026-07-29 · **Severity:** a developer can build on this and be wrong

The Services Guide's layer diagram reads:

```
|  - host()  keyspace / topics  -> durable roots|
```

**"durable roots" invites the wrong conclusion.** A reader reasonably takes it to
mean the set of topics a node hosts is persisted state that returns after a restart.
It is not, and never has been. From the kernel's own account of the v4.49.0 fix:

> `hosting` is marked dirty at four sites and has never had a writer — so
> `host()`/`unhost()` intent was silently discarded on every flush since the feature
> shipped

v4.49.0 did **not** make hosting durable. It made the discard *loud*: an attempt to
persist a namespace with no writer now throws `PERSIST_UNSUPPORTED_NAMESPACE`
(see E-3) instead of returning quietly and consuming the dirty flag. Before 4.49.0
the write silently "succeeded" without writing a byte.

**What is actually true, at 4.49.0:**

- `host()` and `unhost()` take effect immediately and behave as documented **for the
  lifetime of the process**. Hosting is real: the node stores and serves the topic
  without subscribing to it.
- The hosted set is **not** written to the persistence adapter. **A restarted node
  hosts nothing until something calls `host()` again.** A service that relies on
  hosting must re-establish it on every start — from its own configuration, not from
  recovered peer state.
- "Durable" in the diagram is true only in the network sense: a hosted topic's
  *history* is durably held **while some node holds it**. It says nothing about that
  node's own restart.

**Whether hosting *should* persist is an open design decision**, not an oversight to
be patched — it belongs to M7, the single versioned state codec, in the architecture
health scorecard's §6 plan. Do not add a writer for it ahead of that decision.

**What the next render must change:** replace `-> durable roots` with wording that
does not imply persistence, and add an explicit sentence to the `host()` reference
stating that the hosted set does not survive a restart and must be re-established
by the caller.

**Not affected:** the Services Guide's bridge-directory passage (~line 553), which
says the bridge `host()`s the directory topic *"so the entry survives"*. That is
correct as written — it is a claim about the entry surviving in the network, not
about the bridge's own restart.

---

## E-3 — `PERSIST_UNSUPPORTED_NAMESPACE` is missing from the error taxonomy

**Status:** OPEN · `Axona-API-Reference-v4.48.0` (error-class table, ~line 1296)
**Raised:** 2026-07-29 · **Severity:** incomplete, not incorrect

Kernel 4.49.0 adds `ErrorCodes.PERSIST_UNSUPPORTED_NAMESPACE`. The API Reference's
error table, written at 4.48.0, does not list it.

The reference is **not wrong** — it enumerates codes per error class and then says
"The full taxonomy is in `ErrorCodes`" with a live import, so it points at the export
as the authority rather than claiming to be exhaustive. But a developer scanning the
table will not see this code.

**What it means.** A namespace was marked durable while nothing exists to serialize
it. This is a **programming error, not a runtime one**, and it is deliberately **not
retryable** — retrying cannot conjure a writer. The kernel's flush loop switches on
exactly that distinction: this code is logged once at error level and dropped, while
any other persistence failure is warned and re-queued.

**What a developer should do with it.** Nothing, in normal use — it indicates a
defect in the persistence wiring rather than a condition to handle. If you see it,
the namespace named in the message is being marked dirty by code that has no
corresponding writer. Do not catch and ignore it; that restores exactly the silence
4.49.0 removed.

**What the next render must add:** a row in the error-class table under `AxonaError`,
with the not-retryable note.

---

## E-4 — the v4.48.0 documents predate `connect()` being the single entry point

**Status:** OPEN · all six programmer-guide documents · **Raised:** 2026-07-29
**Severity:** the documents are correct but describe more work than is now needed

`connect()` was first **exported** at kernel **v4.40.0** (verified: absent from
`src/index.js` at v4.39.1, present at v4.40.0). The v4.48.0 documents were written
after it existed, so they are not wrong — but this entry pins the fact, because two
neighbouring claims kept being restated loosely and one of them was briefly published
in error.

**What is verified, and what is not:**

- Between **v4.38.0 and v4.49.0** the public export surface changed in exactly one
  way: `export { connect }` was added. `AxonaPeer`'s public method names are
  **identical** across that range.
- Between **v4.48.0 and v4.49.0** the export surface is **byte-identical**, and the
  only developer-visible addition is the error code in E-3.
- The claim "the application API is unchanged since 4.27.1" — which appeared in
  `axona-docs/README.md` — is **false as stated** for any range crossing 4.40.0. The
  API is *additive*: nothing has been removed or had its signature changed, but
  `connect()` was added. The README now says exactly that. If a rendered document
  makes the stronger "unchanged" claim anywhere, it is wrong in the same way.

**What the next render must check:** grep the six sources for "unchanged" and
"since 4.27" and replace any absolute stability claim with the additive form above.
Do not restate a range without re-deriving it — the export lists are one `git show`
apart and the temptation to extend the range by editing a number is exactly how the
README came to be wrong.

---

## Conventions

**Entry IDs** are `E-<n>`, assigned in order and never reused, so an entry can be
cited in a commit or a chat message and still resolve after others are retired.

**Every entry states:** status, which document and roughly where, the date raised,
what is currently wrong or missing, what is actually true, and **what the next render
must change**. That last line is what makes integration mechanical rather than a
re-investigation.

**Severity is stated in words, not a scale.** "A developer can build on this and be
wrong" and "incomplete, not incorrect" carry more information than High/Medium.

### Retiring an entry

At a substantive docs cycle:

1. Fold each OPEN entry into the source markdown for the documents it names.
2. Re-render (Pipeline A), `git mv` the prior top-level PDFs into
   `history/programmer-guide/`, relink `axona-docs/README.md`.
3. Change the entry's status to
   `INTEGRATED in v<kernel> — <date>` and **keep the entry**, collapsed, under a
   *Retired* heading. Deleting it destroys the record of what was wrong and for how
   long, which is the part worth keeping.
4. Update the *Covers* line at the top of this file to the new document version.

An entry that has been open across more than one docs cycle is a signal in itself —
either the fix is harder than the entry admits, or the cycle is skipping it.
