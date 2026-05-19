# history/

Superseded versions of the canonical documents, preserved as context for the
project's evolution. Nothing in this directory is current — see the top-level
README for the canonical (latest) version of each document.

## Why this exists

The protocol now called **Axona** went through two prior names — *Federated
Nervous System* (the original framing) and *N-DHT / NH-1* (the research and
implementation names). The deck refined across roughly forty versions from
v0.3.16 in early 2026 to v0.3.53 in May 2026. Old pitches, old explainer
revisions, and the original whitepaper document choices the team revisited,
re-framed, or retired. They are kept because:

- The pre-Axona materials show why the rename happened and what got carried over.
- The version trail on the presentation deck (v0.3.16 → v0.3.53) is a record
  of how the benchmark numbers, the architecture story, and the audience
  framing converged.
- The original *Neuromorphic-DHT-Architecture.md* whitepaper is the document
  the current synthesis whitepaper derives from; readers chasing a citation
  from the academic paper may want the original.

## What's here

| Folder | Contents |
|---|---|
| [`pitch/`](pitch/) | The original Federated-Nervous-System pitch (v0.1.0, v0.3.48, v0.3.49), the N-DHT-branded pitches (v0.2.0, v0.3.48, v0.3.49), the early readable-deck variants (Axona v0.14, v0.15), and the earliest pitch-deck markdown / HTML. |
| [`presentation/`](presentation/) | Eleven prior PDFs of the research deck (v0.3.16 through v0.3.51) plus `N-DHT Presentation.pdf` (the unversioned snapshot), the v0.2 alternative deck (`deck-v0.2.{md,html}`), and `OUTLINE.md`. |
| [`explainer/`](explainer/) | Five prior PDFs (v0.3.48 → v0.3.52) and `CONVERSATION.md` (the original dialogue the explainer was distilled from). |
| [`whitepaper/`](whitepaper/) | Five prior PDFs (v0.3.48 → v0.3.52) and **`Neuromorphic-DHT-Architecture.md`** — the original v0.67 whitepaper that the current synthesis edition derives from. |
| [`paper/`](paper/) | Five prior PDFs (v0.3.48 → v0.3.52) of the IEEE-format research paper. |

## Curation rule

A version moves here when a newer version supersedes it. Only the most
recent version stays at the top level; everything older moves to `history/`.
For loose markdown / HTML drafts that an authoritative document replaced
(`n-dht-pitch.md`, `pitch-deck.md`, `deck-v0.2.md`), the entire file moves
once it stops being maintained.

The original whitepaper (`Neuromorphic-DHT-Architecture.md`) is a special
case — it isn't a "v0.66 of the current whitepaper"; it's the *source
document* the current synthesis distills, and the current whitepaper cites
it. Kept here for that citation.
