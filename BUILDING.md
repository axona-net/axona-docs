# Building the Axona documents — the standard process

Every typeset Axona document (paper, whitepaper, explainer, architecture,
applications) is authored as **LaTeX** and compiled to a **versioned PDF**. This
is the canonical workflow — the one the explainer established — and it now
applies to **all** documents.

## Source of truth

| Document | Source | Output |
|---|---|---|
| Paper | `paper/Axona-Paper.tex` (IEEEtran) | `paper/Axona Paper v<X>.pdf` |
| Whitepaper | `whitepaper/Axona-Whitepaper.tex` | `whitepaper/Axona Whitepaper v<X>.pdf` |
| Explainer | `explainer/Axona-Explainer.tex` (tufte-handout) | `explainer/Axona Explainer v<X>.pdf` |
| Architecture | `architecture/Axona-Architecture.tex` | `architecture/Axona Architecture v<X>.pdf` |
| Applications | `applications/Axona-Applications.tex` | `applications/Axona Applications v<X>.pdf` |
| Synopsis | `synopsis/Axona-Synopsis.tex` (tufte-handout) | `synopsis/Axona Synopsis v<X>.pdf` |
| Programmer intro | `programmer-intro/Axona-Programmer-Intro.md` (Marp deck, Tufte theme) | `programmer-intro/Axona Programmer Intro v<X>.pdf` |

A companion `.md` may exist for prose review, but **the `.tex` is authoritative**
for the rendered PDF.

> **Markdown-only docs** (`pitch/axona-pitch.md`, `programmer-guide/*.md`,
> `implementation/*.md`) are not yet on the LaTeX standard. Until they are
> converted (or `pandoc` is installed to render them), edit the markdown and
> bump the in-file version; the PDF is regenerated in a follow-up render pass.
>
> **Marp decks** (`pitch/axona-pitch.md`, `presentation/deck.md`,
> `programmer-intro/Axona-Programmer-Intro.md`) are slide decks with a Tufte
> theme in the front-matter. Render with marp-cli + a local Chrome:
> ```
> CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
>   npx -y @marp-team/marp-cli --pdf --allow-local-files \
>   programmer-intro/Axona-Programmer-Intro.md -o "programmer-intro/Axona Programmer Intro v<X>.pdf"
> ```

## Figures

Vector figures live in **`images/_src/`** as TikZ `.tex` plus a compiled `.pdf`;
the raster `.png` used by the documents sits in **`images/`**. To (re)build a
figure:

```bash
cd images/_src
tectonic <Figure>.tex                       # → <Figure>.pdf
# export to PNG for the docs (needs pdftoppm or ImageMagick):
pdftoppm -png -r 300 <Figure>.pdf ../<Figure> && mv ../<Figure>-1.png ../<Figure>.png
```

LaTeX can also `\includegraphics` the `_src/*.pdf` directly if a PNG export
isn't available.

## Render a document

We use **`tectonic`** (modern TeX engine; auto-fetches packages from CTAN and
resolves cross-references in a single pass — a drop-in for the old
`pdflatex … ; pdflatex …` two-pass dance). From the document's directory:

```bash
tectonic Axona-Explainer.tex            # → Axona-Explainer.pdf (in this dir)
```

(`pdflatex Axona-Explainer.tex` run **twice** also works where a full TeX Live
is installed; tectonic is preferred because it needs no local package install.)

## On a version bump (standing practice)

When a document's content changes, in **one** commit:

1. Edit the `.tex` (and companion `.md`) and bump the version string inside it.
2. Render the new PDF and name it `Axona <Doc> v<NEW>.pdf` at the section's top
   level.
3. **Archive the prior top-level PDF**: `git mv "Axona <Doc> v<OLD>.pdf"
   history/<section>/`. Keep only the latest at top level. **Never delete** a
   prior PDF — move it.
4. Update the link in the top-level `README.md` to the new PDF.

```bash
# example: explainer 0.4.27 → 0.4.28
cd explainer
tectonic Axona-Explainer.tex
mv Axona-Explainer.pdf "Axona Explainer v0.4.28.pdf"
cd ..
git mv "explainer/Axona Explainer v0.4.27.pdf" history/explainer/
# edit README.md link, then commit everything together
```

## Known errata

- _None currently._ (The previously-missing `images/Axonal-PubSub-Healing.png`
  was regenerated from `images/_src/Axonal-PubSub-Healing.pdf` via
  `pdftoppm -png -r 300` on 2026-06-07; the explainer renders cleanly.)
