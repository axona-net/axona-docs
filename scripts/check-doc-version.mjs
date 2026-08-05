#!/usr/bin/env node
// check-doc-version.mjs — the architecture document's version must be one
// version, and it must be the one running on testnet.
//
// WHY THIS EXISTS. The standing rule is that a developer document carries the
// kernel version DEPLOYED ON TESTNET — a held release does not count, and a
// number copied from a release note is not evidence. That rule has been broken
// twice in the ways a rule without a check always is:
//
//   1. The version drifted WITHIN the document. The title block said one thing,
//      the colophon said another, and prose in the middle named a third. Every
//      reader trusted whichever they happened to read.
//   2. The version came from a NOTE rather than the running service. On
//      2026-07-29 "prod runs 4.43.0" was taken from a deployment note; prod was
//      on 4.48.0. A release was sized as four versions of new subsystem when it
//      was four bugfixes, and the error survived a full review pass because
//      every reader trusted the same note.
//
// So: --check compares the document against ITSELF and exits non-zero on drift.
// --live additionally reads the deployed version from /healthz and compares.
// The live check is opt-in because a fence that needs the network is a fence
// that gets deleted the first time it fails on a train.
//
//   node scripts/check-doc-version.mjs           # internal consistency
//   node scripts/check-doc-version.mjs --live    # …and against testnet /healthz
//   node scripts/check-doc-version.mjs --set 4.60.0   # rewrite every occurrence

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = join(HERE, '..', 'architecture', 'Axona-Architecture.tex');
const HEALTHZ = 'https://testnet.axona.net/healthz';

const args = process.argv.slice(2);
const live = args.includes('--live');
const setIdx = args.indexOf('--set');
const setTo = setIdx >= 0 ? args[setIdx + 1] : null;

const src = readFileSync(DOC, 'utf8');

// The three places the version is NORMATIVE — a claim about which kernel this
// document describes. Prose that merely mentions a version in passing ("the
// v4.59.2 source", "one slow failure on 4.59.2") is not checked: those are
// statements about a measurement or a code read, and freezing them to the
// current release would falsify the record they came from.
const SITES = [
  { name: 'title block',    re: /An Axona Architecture Note \\quad v(\d+\.\d+\.\d+)/ },
  { name: 'provenance',     re: /Written against \\texttt\{@axona\/protocol\} \\textbf\{v(\d+\.\d+\.\d+)\}/ },
  { name: 'colophon',       re: /Axona Architecture v(\d+\.\d+\.\d+) --- \d{4}-\d{2}-\d{2}/ },
];

let fail = 0;
const found = [];
for (const s of SITES) {
  const m = src.match(s.re);
  if (!m) { console.error(`✗ ${s.name}: version string not found — the pattern this fence matches has moved`); fail++; continue; }
  found.push({ ...s, version: m[1] });
}
if (fail) process.exit(1);

if (setTo) {
  if (!/^\d+\.\d+\.\d+$/.test(setTo)) { console.error(`✗ --set expects x.y.z, got "${setTo}"`); process.exit(2); }
  let out = src;
  for (const f of found) out = out.replace(f.re, (whole) => whole.replace(f.version, setTo));
  // The colophon also carries a date; a version bump without one is a lie about
  // when the claim was checked.
  const today = new Date().toISOString().slice(0, 10);
  out = out.replace(/(An Axona Architecture Note \\quad v\d+\.\d+\.\d+ \\quad )\d{4}-\d{2}-\d{2}/, `$1${today}`);
  out = out.replace(/(Axona Architecture v\d+\.\d+\.\d+ --- )\d{4}-\d{2}-\d{2}/, `$1${today}`);
  writeFileSync(DOC, out);
  console.log(`✓ set to v${setTo}, dated ${today} — re-render the PDF`);
  process.exit(0);
}

const versions = [...new Set(found.map(f => f.version))];
if (versions.length > 1) {
  console.error('✗ the document disagrees with itself:');
  for (const f of found) console.error(`    ${f.name.padEnd(14)} v${f.version}`);
  console.error('  Fix with: node scripts/check-doc-version.mjs --set <x.y.z>');
  process.exit(1);
}
const declared = versions[0];
console.log(`✓ internally consistent at v${declared} (${found.length} sites)`);

if (!live) {
  console.log('  (run with --live to check it against the kernel deployed on testnet)');
  process.exit(0);
}

// READ THE RUNNING SERVICE, NOT A NOTE.
let deployed;
try {
  const res = await fetch(HEALTHZ, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  deployed = body.kernel ?? body.kernelVersion ?? body.KERNEL_VERSION;
  if (!deployed) throw new Error(`no kernel version field in ${JSON.stringify(body).slice(0, 160)}`);
} catch (err) {
  // A negative result names its kind (I-14). Unreachable is not the same fact
  // as mismatched, and this must not be reported as if the versions differ.
  console.error(`✗ could not read ${HEALTHZ}: ${err.message}`);
  console.error('  UNKNOWN, not mismatched — the document may still be correct.');
  process.exit(3);
}

if (deployed !== declared) {
  console.error(`✗ document says v${declared}; testnet is running v${deployed}`);
  console.error(`  Fix with: node scripts/check-doc-version.mjs --set ${deployed}`);
  process.exit(1);
}
console.log(`✓ matches testnet /healthz (v${deployed})`);
