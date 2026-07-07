import { readFileSync, writeFileSync } from 'node:fs';
const src = '/Users/croqueteer/Documents/claude/axona-docs/manifesto/Axona_Manifesto_and_WhitePaper_v0_3.md';
let md = readFileSync(src, 'utf8');

// Replace the italic figure placeholders with real image embeds.
// pandoc's implicit_figures turns an image alone in a paragraph into a captioned figure.
const figs = [
  [/\*\(Figure 1 —[^\n]*\)\*/,
   '![**Figure 1.** Three ways to find who holds something. A *directory* is one machine everyone must ask. A *plain DHT* needs no directory but its random addresses send each lookup on a long path across the globe. *Axona* puts a coarse region into every address, so most traffic resolves in a short local walk.](images/fig1.png)'],
  [/\*\(Figure 4 —[^\n]*\)\*/,
   '![**Figure 4.** Self-healing delivery. When a relay in a topic’s tree disappears, the participants beneath it re-issue their subscription, which lands on whichever relative is still alive; a short cache covers what was in flight. The mechanism that builds the tree heals it.](images/fig4.png)'],
  [/\*\(Figure 2 —[^\n]*\)\*/,
   '![**Figure 2.** The keystone. Your presence on the network and your voice as an author are different keys, and the design keeps them apart: a listener can verify *who signed* a message without the network ever learning *where the signer is*.](images/fig2.png)'],
  [/\*\(Figure 3 —[^\n]*\)\*/,
   '![**Figure 3.** Relocating the tussle. Axona removes the network as a venue — there is no control point inside it to seize — and moves every such contest to the endpoints and to the institutions of society.](images/fig3.png)'],
];
for (const [re, rep] of figs) {
  if (!re.test(md)) console.error('WARN: placeholder not found:', re);
  md = md.replace(re, rep);
}

// Drop the manual "## Contents" block (pandoc --toc replaces it) and the top metadata line.
md = md.replace(/## Contents\n[\s\S]*?\n---\n/, '');
// Drop the very first H1/H2 title lines + byline (the epub gets its own title page from metadata).
md = md.replace(/^# Axona\n## A Free Substrate for a Society of Minds\n\n\*Manifesto and White Paper[^\n]*\n\n---\n\n/, '');

writeFileSync('/tmp/epub-build/manifesto-epub.md', md);
console.log('epub markdown written,', md.length, 'chars');
