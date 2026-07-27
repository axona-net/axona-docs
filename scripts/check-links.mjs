#!/usr/bin/env node
// =====================================================================
// check-links.mjs — fail CI when a link points at a file that isn't there.
//
// THE DEFECT THIS GUARDS. Renaming a doc in axona-docs silently breaks
// links in repos that have no idea it moved. On 2026-07-27 three public
// surfaces were simultaneously pointing at files that did not exist:
// axona.net's developer-doc links, and axona-protocol's README both in its
// six doc links AND its install command. Nothing failed; nobody was told.
//
// WHAT IT CHECKS
//   1. Links into axona-docs — github.com/axona-net/axona-docs/blob/<ref>/<path>
//      and the raw.githubusercontent equivalent — resolved against a real
//      axona-docs checkout on disk (--docs-root).
//   2. Relative links inside this repo's own markdown.
//
// It resolves against the FILESYSTEM, not the network: deterministic, fast,
// no rate limits, and it checks the branch you actually have checked out.
//
// USAGE
//   node check-links.mjs [paths...] [--docs-root <dir>] [--quiet]
//
//   # inside axona-docs (self-check — docs-root defaults to the repo root)
//   node scripts/check-links.mjs .
//
//   # inside a consumer repo, against a sibling axona-docs checkout
//   node check-links.mjs . --docs-root ../axona-docs
//
// Exit 0 = every link resolves. Exit 1 = at least one is broken.
// No dependencies; Node 18+.
// =====================================================================

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

// `vendor/` holds COPIES of other repos (a vendored axona-protocol carries its
// own README). Fixing a link there is pointless — the next re-vendor overwrites
// it. Stale vendored links are a re-vendor problem, not a link problem.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'venv', '.venv', 'vendor']);
const SCAN_EXT = /\.(md|html?)$/i;

// Historical records are SNAPSHOTS IN TIME. A team update from v2.51 correctly
// references what existed at v2.51; "fixing" its links would falsify the record.
// These warn so the breakage stays visible, but they never fail the build —
// a CI that is red for reasons nobody may fix is a CI that gets muted.
const WARN_ONLY = [/(^|\/)history\//, /(^|\/)team-updates\//, /(^|\/)red team\//];
const isHistorical = (f) => WARN_ONLY.some((re) => re.test(f.replace(/\\/g, '/')));

// A link into axona-docs, via either the browse or the raw host. Capture the
// path AFTER the branch ref.
const DOCS_LINK = [
  /https?:\/\/github\.com\/axona-net\/axona-docs\/(?:blob|tree|raw)\/[^/\s]+\/([^)\s"'<>\]]+)/g,
  /https?:\/\/raw\.githubusercontent\.com\/axona-net\/axona-docs\/[^/\s]+\/([^)\s"'<>\]]+)/g,
];
// Markdown [text](target) — relative targets only; absolute/anchor/mailto skipped.
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const args = process.argv.slice(2);
let docsRoot = null, quiet = false;
const paths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--docs-root') docsRoot = resolve(args[++i]);
  else if (args[i] === '--quiet') quiet = true;
  else paths.push(args[i]);
}
if (!paths.length) paths.push('.');

// Default: we're inside axona-docs itself if it looks like axona-docs.
if (!docsRoot) {
  const here = resolve('.');
  docsRoot = existsSync(join(here, 'SECURITY-CHANGELOG.md')) && existsSync(join(here, 'programmer-guide'))
    ? here : null;
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Byte offset -> 1-indexed line, so a report is clickable. */
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;

/** Decode %20 etc. Filenames here contain spaces ("Axona Whitepaper v0.11.pdf"). */
function decode(p) { try { return decodeURIComponent(p); } catch { return p; } }

const broken = [];
let checked = 0;

const files = paths.flatMap((p) => {
  const r = resolve(p);
  if (!existsSync(r)) return [];
  return statSync(r).isDirectory() ? walk(r) : (SCAN_EXT.test(r) ? [r] : []);
});

for (const file of files) {
  const text = readFileSync(file, 'utf8');

  // --- 1. links into axona-docs ---
  for (const re of DOCS_LINK) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const target = decode(m[1]).replace(/[.,;:]+$/, '');   // trailing prose punctuation
      checked++;
      if (!docsRoot) continue;                                // can't resolve; not a failure
      if (!existsSync(join(docsRoot, target)))
        broken.push({ file, line: lineAt(text, m.index), target, kind: 'axona-docs' });
    }
  }

  // --- 2. relative links inside this repo (markdown only) ---
  if (/\.md$/i.test(file)) {
    MD_LINK.lastIndex = 0;
    let m;
    while ((m = MD_LINK.exec(text))) {
      const raw = m[1];
      if (/^(https?:|mailto:|#|<)/i.test(raw)) continue;
      const target = decode(raw.split('#')[0]);
      if (!target) continue;
      checked++;
      if (!existsSync(resolve(dirname(file), target)))
        broken.push({ file, line: lineAt(text, m.index), target, kind: 'relative' });
    }
  }
}

const rel = (f) => relative(resolve('.'), f) || f;

const fatal = broken.filter((b) => !isHistorical(b.file));
const warn  = broken.filter((b) =>  isHistorical(b.file));

function report(list, label, stream) {
  stream(`\n${label}\n`);
  let last = null;
  for (const b of list) {
    if (b.file !== last) { stream(`  ${rel(b.file)}`); last = b.file; }
    stream(`    :${b.line}  ${b.target}   [${b.kind}]`);
  }
}

if (warn.length) {
  report(warn, `⚠ ${warn.length} broken link${warn.length === 1 ? '' : 's'} in historical documents (not failing — these are snapshots in time)`, console.warn);
}

if (fatal.length) {
  report(fatal, `✗ ${fatal.length} broken link${fatal.length === 1 ? '' : 's'} (of ${checked} checked in ${files.length} files)`, console.error);
  console.error(`\nA link points at a file that does not exist. If a doc was renamed in`);
  console.error(`axona-docs, every repo that links to it must be updated in the same pass —`);
  console.error(`see axona-docs/RELEASE-SURFACES.md §4.\n`);
  process.exit(1);
}

if (!quiet) {
  console.log(`\n✓ ${checked} links resolve (${files.length} files scanned)` +
    (warn.length ? `, ${warn.length} historical warning${warn.length === 1 ? '' : 's'}` : '') +
    (docsRoot ? `` : `\n  note: no axona-docs checkout given (--docs-root), so cross-repo links were NOT verified`));
}
process.exit(0);
