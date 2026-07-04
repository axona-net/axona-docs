# EPUB build

Regenerates `../Axona-Manifesto.epub` from the v0.2 markdown + the four TikZ
figures in `../Axona-Manifesto.tex`.

```sh
node extract-figs.mjs          # pulls the 4 tikzpictures → fig1..4.tex (standalone)
for i in 1 2 3 4; do tectonic fig$i.tex && pdftoppm -png -r 300 fig$i.pdf figpng$i; \
  cp figpng$i-1.png ../images/fig$i.png; done
tectonic cover.tex && pdftoppm -png -r 150 cover.pdf coverpng && cp coverpng-1.png ../images/cover.png
node make-epub-md.mjs          # placeholders → image embeds → manifesto-epub.md
mkdir -p images && cp ../images/fig*.png images/
pandoc --metadata-file=meta.yaml manifesto-epub.md -o ../Axona-Manifesto.epub \
  --toc --toc-depth=2 --split-level=2 --epub-cover-image=../images/cover.png
```
Requires: tectonic, pdftoppm (poppler), pandoc ≥ 3.
