import { readFileSync, writeFileSync } from 'node:fs';
const tex = readFileSync('/Users/croqueteer/Documents/claude/axona-docs/manifesto/Axona-Manifesto.tex', 'utf8');
// pull every \begin{tikzpicture}...\end{tikzpicture} block
const blocks = [...tex.matchAll(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g)].map(m => m[0]);
console.log('found tikzpictures:', blocks.length);
const preamble = String.raw`\documentclass[border=10pt]{standalone}
\usepackage[utf8]{inputenc}
\usepackage{tikz}
\usetikzlibrary{positioning, calc, arrows.meta, shapes.geometric, shapes.symbols}
\usepackage{xcolor}
\definecolor{rust}{RGB}{185,78,54}
\definecolor{rustsoft}{RGB}{212,168,150}
\definecolor{inkmuted}{RGB}{102,102,102}
\definecolor{panel}{RGB}{244,240,236}
\begin{document}
`;
blocks.forEach((b, i) => {
  writeFileSync(`/tmp/epub-build/fig${i+1}.tex`, preamble + b + '\n\\end{document}\n');
});
console.log('wrote', blocks.length, 'standalone figure files');
