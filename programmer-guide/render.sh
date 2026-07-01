#!/usr/bin/env bash
# render.sh — build the programmer-guide quartet PDFs from their .md via
# pandoc (tufte-handout .tex) + tectonic. Run from anywhere; operates on this dir.
#
#   ./render.sh            # render all four
#   ./render.sh Quick-Start-v4.11.2   # render one (basename, no extension)
#
# Requires: pandoc + tectonic on PATH (no system TeX Live needed — tectonic is
# self-contained and auto-fetches tufte-latex). Menlo font (macOS) for code.
set -euo pipefail
cd "$(dirname "$0")"

DOCS=(
  "Quick-Start-v4.11.2"
  "Axona-Programmer-Guide-v4.11.2"
  "Axona-API-Reference-v4.11.2"
  "Axona-Services-Guide-v0.3"
)
[ "$#" -gt 0 ] && DOCS=("$@")

for d in "${DOCS[@]}"; do
  echo "→ $d"
  pandoc "$d.md" -o "$d.tex" -s --top-level-division=section \
    -V documentclass=tufte-handout -V classoption=nobib \
    -H axona-doc-preamble.tex
  tectonic "$d.tex"
done
echo "done"
