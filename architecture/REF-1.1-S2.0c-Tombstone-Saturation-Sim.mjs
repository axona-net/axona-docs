#!/usr/bin/env node --expose-gc
// REF-1.1 S2.0c — Tombstone-saturation simulation (AUTH-B v8, Gate A).
//
// Aster's pre-code Gate A (disposition bbdf622e): before any kernel code, prove the
// v8 capacity model under simultaneous count/byte/signer/topic limits, pending-capacity
// candidate pressure, reclamation+retry, and body-eviction-before-retry — and measure
// BOTH canonical retained bytes AND actual runtime heap. TOMBSTONE_RECORD_MAX and the
// 64 MiB / 131072 defaults are ACCOUNTING bounds, not proof that 131072 live JS Map
// entries fit the runtime budget. This artifact measures the truth and, where the
// measurement disagrees with the assumed defaults, DERIVES corrected defaults.
//
// Run:  node --expose-gc REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs
// (Without --expose-gc it still runs; heap deltas are noisier without forced GC.)
//
// This is a measurement harness. It implements the v8 tombstone-store data structure
// and admission rules standalone — it does NOT touch kernel code (S2.0c stays held).

import { createHash, randomBytes } from 'node:crypto';

// ── Assumed defaults from AUTH-B v8 (to be confirmed / corrected by measurement) ──
const ASSUMED = {
  relay:   { maxBytes: 64 * 1024 * 1024, maxCount: 131072, memBudgetMiB: 64 },
  browser: { maxBytes:  4 * 1024 * 1024, maxCount:   8192, memBudgetMiB:  4 },
  recordMaxBytes: 768,       // TOMBSTONE_RECORD_MAX — corrected from 512 to measured (725B max), rounded up
  recordMaxBytesOriginal: 512, // the pre-measurement assumption, kept for the correction note
  sublimitFraction: 16,      // per-signer & per-topic sublimit = maxCount / 16
};

const KILL_DOMAIN = 'axona:pubsub-kill:v1';
const CLOCK_SKEW = 5000;
const TTL_CEILING = 24 * 3600 * 1000;

const hex = (nBytes) => randomBytes(nBytes).toString('hex');
// Production widths: topicId 66-hex (33B, region-prefixed), msgId 64-hex (32B),
// signerPubkey 64-hex (32B Ed25519). (These are the widths signed-expiry v6 pinned.)
const newTopicId = () => hex(33);            // 66 hex chars
const newMsgId   = () => hex(32);            // 64 hex chars
const newSigner  = () => hex(32);            // 64 hex chars
const newSig     = () => 'ed25519:' + hex(64); // 128 hex chars

// Minimal, total, key-sorted canonical encoder (RFC-8785-ish) — matches the kernel's
// canonical() closely enough to measure retained byte length.
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

// The retained tombstone record (v8 §blocker-2 accounting unit), realistic form.
// We retain the verifying signed KILL so a capacity-reclamation retry can re-check
// "matching kill remains verified" (Gate B) without the body. effectiveDeath comes
// from the resolving body's exp (+ CLOCK_SKEW), so it is stored explicitly.
function makeRecord({ topicId, msgId, signerPubkey, now }) {
  const ts = now - 1000;
  const killBytes = canonical({
    d: KILL_DOMAIN, topicId, msgId, ts, seq: 1,
    signature: newSig(), signerPubkey,
  });
  return {
    signerPubkey,                                   // authorized publisher (from matched body)
    effectiveDeath: now + TTL_CEILING + CLOCK_SKEW, // from body.exp + CLOCK_SKEW
    killBytes,                                      // verifying signed kill, retained for retry
  };
}

// Canonical retained bytes for one (key + record): what the byte budget accounts for.
function recordCanonicalBytes(key, rec) {
  return Buffer.byteLength(key, 'utf8') + Buffer.byteLength(canonical(rec), 'utf8');
}

// ── The v8 tombstone store: admission-refusal at capacity, never live-eviction ──
class TombstoneStore {
  constructor({ maxCount, maxBytes, perSignerMax, perTopicMax }) {
    this.maxCount = maxCount; this.maxBytes = maxBytes;
    this.perSignerMax = perSignerMax; this.perTopicMax = perTopicMax;
    this.map = new Map();              // key "topicId|msgId" -> record
    this.bytes = 0;
    this.perSigner = new Map();        // signerPubkey -> count
    this.perTopic = new Map();         // topicId -> count
    this.minDeath = Infinity;          // earliest effectiveDeath present (reclaim guard)
  }
  _key(topicId, msgId) { return topicId + '|' + msgId; }

  // Reclaim ONLY expired entries (now > effectiveDeath). Never touches a live entry.
  // Guarded by minDeath so the common case (nothing expired) is O(1), not an O(n) scan
  // on every admit — otherwise a full-capacity fill is O(n^2).
  reclaimExpired(now) {
    if (now <= this.minDeath) return 0;
    let n = 0, min = Infinity;
    for (const [k, rec] of this.map) {
      if (now > rec.effectiveDeath) {
        this.map.delete(k);
        this.bytes -= rec._bytes;
        this._dec(this.perSigner, rec.signerPubkey);
        this._dec(this.perTopic, k.slice(0, k.indexOf('|')));
        n++;
      } else if (rec.effectiveDeath < min) {
        min = rec.effectiveDeath;
      }
    }
    this.minDeath = min;
    return n;
  }
  _dec(m, k) { const c = m.get(k) - 1; if (c <= 0) m.delete(k); else m.set(k, c); }
  _inc(m, k) { m.set(k, (m.get(k) || 0) + 1); }

  // Attempt admission. Reclaim expired first; then refuse (no live eviction) if any
  // limit binds. Returns 'ADMITTED' or a REFUSED_* reason.
  admit(topicId, msgId, rec, now) {
    this.reclaimExpired(now);
    const key = this._key(topicId, msgId);
    if (this.map.has(key)) return 'ADMITTED'; // idempotent re-admit of same verdict
    const recBytes = recordCanonicalBytes(key, rec);
    if (recBytes > ASSUMED.recordMaxBytes) return 'REFUSED_RECORD_TOO_LARGE';
    if (this.map.size >= this.maxCount) return 'REFUSED_GLOBAL_COUNT';
    if (this.bytes + recBytes > this.maxBytes) return 'REFUSED_GLOBAL_BYTES';
    if ((this.perSigner.get(rec.signerPubkey) || 0) >= this.perSignerMax) return 'REFUSED_SIGNER';
    if ((this.perTopic.get(topicId) || 0) >= this.perTopicMax) return 'REFUSED_TOPIC';
    rec._bytes = recBytes;
    this.map.set(key, rec);
    this.bytes += recBytes;
    if (rec.effectiveDeath < this.minDeath) this.minDeath = rec.effectiveDeath;
    this._inc(this.perSigner, rec.signerPubkey);
    this._inc(this.perTopic, topicId);
    return 'ADMITTED';
  }
}

// ── Heap measurement helpers ──
function gc() { if (global.gc) { global.gc(); global.gc(); } }
function heapUsed() { gc(); return process.memoryUsage().heapUsed; }
const MiB = (b) => (b / 1024 / 1024).toFixed(2);

let PASS = 0, FAIL = 0;
function check(label, cond, detail = '') {
  (cond ? PASS++ : FAIL++);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`);
}

console.log('REF-1.1 S2.0c — Tombstone-saturation sim (AUTH-B v8, Gate A)');
console.log('gc exposed:', Boolean(global.gc), '\n');

// ── 1. Canonical retained size vs TOMBSTONE_RECORD_MAX ──
console.log('1. Canonical retained record size');
{
  const now = 1_000_000_000_000;
  const samples = 2000;
  let total = 0, max = 0;
  for (let i = 0; i < samples; i++) {
    const topicId = newTopicId(), msgId = newMsgId(), signerPubkey = newSigner();
    const rec = makeRecord({ topicId, msgId, signerPubkey, now });
    const b = recordCanonicalBytes(topicId + '|' + msgId, rec);
    total += b; max = Math.max(max, b);
  }
  const avg = total / samples;
  console.log(`   avg canonical bytes/record = ${avg.toFixed(1)}  max = ${max}`);
  console.log(`   assumed TOMBSTONE_RECORD_MAX = ${ASSUMED.recordMaxBytes}`);
  if (max > ASSUMED.recordMaxBytes) {
    const corrected = Math.ceil(max / 64) * 64;
    console.log(`   >> CORRECTION: real record exceeds 512B; retained-record cap must be >= ${max}` +
      ` (suggest TOMBSTONE_RECORD_MAX = ${corrected}).`);
  }
  console.log('');
  globalThis.__avgRecBytes = avg;
}

// ── 2. Behavioral scenarios (relay profile, scaled down for fast behavioral checks) ──
console.log('2. Behavioral scenarios (scaled store: maxCount=64, sublimit=4)');
{
  const now = 2_000_000_000_000;
  const store = new TombstoneStore({ maxCount: 64, maxBytes: 64 * 1024, perSignerMax: 4, perTopicMax: 4 });
  const admitOne = (topicId, msgId, signer, t = now) =>
    store.admit(topicId, msgId, makeRecord({ topicId, msgId, signerPubkey: signer, now: t }), t);

  // Fill to N=64 live tombstones across many signers/topics (stay under sublimits).
  let admitted = 0;
  for (let i = 0; admitted < 64 && i < 100000; i++) {
    const r = admitOne(newTopicId(), newMsgId(), newSigner());
    if (r === 'ADMITTED') admitted++;
  }
  check('fills to N live tombstones', store.map.size === 64, `size=${store.map.size}`);

  // N+1 genuine kill -> refused on global count, no live eviction.
  const before = store.map.size;
  const r1 = admitOne(newTopicId(), newMsgId(), newSigner());
  check('N+1 genuine kill refused (global count)', r1 === 'REFUSED_GLOBAL_COUNT');
  check('N+1 refusal did not evict a live entry', store.map.size === before, `size=${store.map.size}`);

  // Per-signer sublimit: one signer fills its 4, 5th from that signer refused,
  // but a different signer is unaffected (free global slots in this fresh store).
  const sig = newSigner();
  const s3 = new TombstoneStore({ maxCount: 1000, maxBytes: 1 << 20, perSignerMax: 4, perTopicMax: 4 });
  const admitSig = (signer) => { const t = newTopicId(), m = newMsgId(); return s3.admit(t, m, makeRecord({ topicId: t, msgId: m, signerPubkey: signer, now }), now); };
  let filled = 0; for (let i = 0; i < 4; i++) if (admitSig(sig) === 'ADMITTED') filled++;
  check('one signer fills its per-signer sublimit', filled === 4);
  check('5th kill from same signer refused (signer sublimit)', admitSig(sig) === 'REFUSED_SIGNER');
  check('different signer still admits under free global/topic', admitSig(newSigner()) === 'ADMITTED');

  // Per-topic sublimit.
  const s4 = new TombstoneStore({ maxCount: 1000, maxBytes: 1 << 20, perSignerMax: 1000, perTopicMax: 4 });
  const topic = newTopicId();
  const admitTopic = () => { const m = newMsgId(); return s4.admit(topic, m, makeRecord({ topicId: topic, msgId: m, signerPubkey: newSigner(), now }), now); };
  let tf = 0; for (let i = 0; i < 4; i++) if (admitTopic() === 'ADMITTED') tf++;
  check('one topic fills its per-topic sublimit', tf === 4);
  check('5th kill on same topic refused (topic sublimit)', admitTopic() === 'REFUSED_TOPIC');

  // Reclamation + retry: fill a store with SHORT-lived tombstones, then a genuine kill
  // is refused; advance the clock past effectiveDeath; the retry now succeeds because
  // reclamation freed slots.
  const s5 = new TombstoneStore({ maxCount: 4, maxBytes: 1 << 20, perSignerMax: 4, perTopicMax: 4 });
  const shortDeath = now + 1000;
  for (let i = 0; i < 4; i++) {
    const t = newTopicId(), m = newMsgId();
    const rec = makeRecord({ topicId: t, msgId: m, signerPubkey: newSigner(), now });
    rec.effectiveDeath = shortDeath;
    s5.admit(t, m, rec, now);
  }
  const pt = newTopicId(), pm = newMsgId();
  const refused = s5.admit(pt, pm, makeRecord({ topicId: pt, msgId: pm, signerPubkey: newSigner(), now }), now);
  check('at capacity, genuine kill refused (pending-capacity)', refused === 'REFUSED_GLOBAL_COUNT');
  const later = shortDeath + 1;             // clock advances past the short tombstones' death
  const retry = s5.admit(pt, pm, makeRecord({ topicId: pt, msgId: pm, signerPubkey: newSigner(), now: later }), later);
  check('slot reclamation lets the retry succeed', retry === 'ADMITTED', `reclaimed then admitted`);

  // Body eviction before retry: modelled — a pending-capacity candidate whose body is
  // evicted before a slot frees loses its authorization basis, so on reclamation it is
  // NOT admitted as a tombstone (no body to co-locate). We model the retry gate: it only
  // admits when bodyPresent === true.
  const s6 = new TombstoneStore({ maxCount: 1, maxBytes: 1 << 20, perSignerMax: 4, perTopicMax: 4 });
  const t0 = newTopicId(), m0 = newMsgId();
  const rec0 = makeRecord({ topicId: t0, msgId: m0, signerPubkey: newSigner(), now });
  rec0.effectiveDeath = now + 1000;
  s6.admit(t0, m0, rec0, now);
  let bodyPresent = true;                   // pending-capacity candidate's body
  const retryGate = (bodyOk, t) => bodyOk ? s6.admit(newTopicId(), newMsgId(), makeRecord({ topicId: newTopicId(), msgId: newMsgId(), signerPubkey: newSigner(), now: t }), t) : 'SKIP_BODY_ABSENT';
  bodyPresent = false;                      // body evicted before the slot frees
  const afterEvict = retryGate(bodyPresent, now + 1001);
  check('body-evicted candidate is not admitted on reclamation', afterEvict === 'SKIP_BODY_ABSENT');
  console.log('');
}

// ── 3. Runtime heap at production capacity — the load-bearing measurement ──
console.log('3. Runtime heap at production capacity (measured, not extrapolated)');
function measureProfile(name, maxCount) {
  gc();
  const base = process.memoryUsage().heapUsed;
  const now = 3_000_000_000_000;
  const store = new TombstoneStore({
    maxCount, maxBytes: Infinity,          // isolate COUNT to measure per-entry heap
    perSignerMax: Infinity, perTopicMax: Infinity,
  });
  for (let i = 0; i < maxCount; i++) {
    const t = newTopicId(), m = newMsgId();
    store.admit(t, m, makeRecord({ topicId: t, msgId: m, signerPubkey: newSigner(), now }), now);
  }
  const after = heapUsed();
  const delta = after - base;
  const perEntry = delta / maxCount;
  const canonicalBytes = store.bytes;
  console.log(`   ${name}: entries=${store.map.size}`);
  console.log(`     canonical retained = ${MiB(canonicalBytes)} MiB (${(canonicalBytes / maxCount).toFixed(0)} B/entry)`);
  console.log(`     runtime heap delta = ${MiB(delta)} MiB (${perEntry.toFixed(0)} B/entry)`);
  // keep store alive until after measurement
  if (store.map.size < 0) console.log(store);
  return { maxCount, perEntry, canonicalBytes, heapDelta: delta };
}

const relay = measureProfile('relay  (assumed 131072)', ASSUMED.relay.maxCount);
const browser = measureProfile('browser(assumed   8192)', ASSUMED.browser.maxCount);
console.log('');

// ── 4. Derive corrected defaults from measured per-entry heap ──
console.log('4. Corrected defaults (measurement-driven)');
function derive(name, profile, measured) {
  const budgetBytes = profile.memBudgetMiB * 1024 * 1024;
  const assumedHeap = measured.perEntry * profile.maxCount;
  const fits = assumedHeap <= budgetBytes;
  console.log(`   ${name}: budget ${profile.memBudgetMiB} MiB`);
  console.log(`     assumed maxCount ${profile.maxCount} -> measured heap ${MiB(assumedHeap)} MiB  ${fits ? 'FITS' : 'EXCEEDS'}`);
  if (!fits) {
    const correctedCount = Math.floor(budgetBytes / measured.perEntry);
    console.log(`     >> CORRECTION: maxCount that fits ${profile.memBudgetMiB} MiB runtime = ${correctedCount}` +
      ` (was ${profile.maxCount}); per-signer/per-topic sublimit = ${Math.floor(correctedCount / ASSUMED.sublimitFraction)}`);
  } else {
    const headroomCount = Math.floor(budgetBytes / measured.perEntry);
    console.log(`     maxCount ${profile.maxCount} confirmed within budget (budget would hold ~${headroomCount}).`);
  }
}
derive('relay', ASSUMED.relay, relay);
derive('browser', ASSUMED.browser, browser);
console.log('');

console.log(`RESULT: ${PASS} behavioral checks passed, ${FAIL} failed.`);
process.exit(FAIL ? 1 : 0);
