#!/usr/bin/env node --expose-gc
// REF-1.1 S2.0c — Tombstone-saturation simulation (AUTH-B, Gate A) — INTEGRATED model.
//
// Recut per Aster Gate A review (msgId e4b908b9, CHANGES REQUIRED). The prior version
// modelled only TombstoneStore and faked retry / body-eviction; it also sized limits with
// ~5% headroom off a single Node measurement. This version:
//   (1) integrates BodyCache + CandidateStore + PendingQueue + oldest-body-first scheduler
//       + an atomic SUPPRESS, and exercises competing limits, byte-cap + oversized-record
//       refusal, real body eviction + candidate demotion, and the refusal-side-effect
//       invariant (refusal removes no body, emits no fanout, purges no candidate, evicts no
//       live tombstone);
//   (2) measures per-entry heap over multiple trials at the PROPOSED FINAL counts, records
//       the environment, reports variance, and sizes from the worst-case with explicit
//       integration headroom.
//
// This is a measurement harness — no kernel code. A companion in-browser harness
// (REF-1.1-S2.0c-Tombstone-Heap-Browser.html) takes the real Chromium datapoint the Node
// process cannot; see -Results.md for that number and the environment table.
//
// Run:  node --expose-gc REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs

import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── Accounting bounds (768 accepted; counts are DERIVED from measurement below) ──
const RECORD_MAX = 768;                 // TOMBSTONE_RECORD_MAX (accepted by Aster)
const SUBLIMIT_FRACTION = 16;
const INTEGRATION_HEADROOM = 0.30;      // reserve 30% of budget for kernel repr + allocator
                                        // variance + surrounding metadata (was implicitly ~5%)
const RELAY_BUDGET_MiB = 64;
const BROWSER_BUDGET_MiB = 4;

const KILL_DOMAIN = 'axona:pubsub-kill:v1';
const CLOCK_SKEW = 5000;
const TTL_CEILING = 24 * 3600 * 1000;

const hex = (n) => randomBytes(n).toString('hex');
const newTopicId = () => hex(33);       // 66 hex
const newMsgId   = () => hex(32);       // 64 hex
const newSigner  = () => hex(32);       // 64 hex
const newSig     = () => 'ed25519:' + hex(64);

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const key = (t, m) => t + '|' + m;
function killBytesFor(topicId, msgId, signerPubkey, now) {
  return canonical({ d: KILL_DOMAIN, topicId, msgId, ts: now - 1000, seq: 1, signature: newSig(), signerPubkey });
}
// Retained tombstone record (accounting unit) — no message bytes.
function tombRecord(signerPubkey, effectiveDeath, killBytes) {
  return { signerPubkey, effectiveDeath, killBytes };
}
function recordBytes(k, rec) {
  return Buffer.byteLength(k, 'utf8') + Buffer.byteLength(canonical(rec), 'utf8');
}

// ── Bounded stores ────────────────────────────────────────────────────────────
class BodyCache {                        // bounded, evictable
  constructor(max) { this.max = max; this.map = new Map(); }
  has(k) { return this.map.has(k); }
  get(k) { return this.map.get(k); }
  put(k, body) {
    if (!this.map.has(k) && this.map.size >= this.max) { // evict oldest (insertion order)
      const oldest = this.map.keys().next().value; this.map.delete(oldest);
    }
    this.map.set(k, body);
  }
  evict(k) { return this.map.delete(k); }
}

class CandidateStore {                   // bounded global + per-signer; refusal (no eviction of live)
  constructor(max, perSignerMax) { this.max = max; this.perSignerMax = perSignerMax; this.map = new Map(); this.perSigner = new Map(); this.total = 0; }
  _count(sig) { return this.perSigner.get(sig) || 0; }
  admit(k, cand) {
    const list = this.map.get(k) || [];
    if (list.some((c) => c.signerPubkey === cand.signerPubkey)) return 'DUP';
    if (this.total >= this.max) return 'REFUSED_CAND_GLOBAL';
    if (this._count(cand.signerPubkey) >= this.perSignerMax) return 'REFUSED_CAND_SIGNER';
    list.push(cand); this.map.set(k, list);
    this.perSigner.set(cand.signerPubkey, this._count(cand.signerPubkey) + 1); this.total++;
    return 'ADMITTED';
  }
  get(k) { return this.map.get(k) || []; }
  purge(k) {
    const list = this.map.get(k); if (!list) return 0;
    for (const c of list) { const n = this._count(c.signerPubkey) - 1; if (n <= 0) this.perSigner.delete(c.signerPubkey); else this.perSigner.set(c.signerPubkey, n); }
    this.total -= list.length; this.map.delete(k); return list.length;
  }
  remove(k, signerPubkey) {
    const list = this.map.get(k); if (!list) return false;
    const i = list.findIndex((c) => c.signerPubkey === signerPubkey); if (i < 0) return false;
    list.splice(i, 1); const n = this._count(signerPubkey) - 1; if (n <= 0) this.perSigner.delete(signerPubkey); else this.perSigner.set(signerPubkey, n);
    this.total--; if (!list.length) this.map.delete(k); return true;
  }
}

class TombstoneStore {                   // count + byte + record + per-signer + per-topic; refusal, no live-eviction
  constructor({ maxCount, maxBytes, perSignerMax, perTopicMax }) {
    Object.assign(this, { maxCount, maxBytes, perSignerMax, perTopicMax });
    this.map = new Map(); this.bytes = 0; this.perSigner = new Map(); this.perTopic = new Map(); this.minDeath = Infinity;
  }
  _dec(m, k) { const c = m.get(k) - 1; if (c <= 0) m.delete(k); else m.set(k, c); }
  _inc(m, k) { m.set(k, (m.get(k) || 0) + 1); }
  reclaimExpired(now) {
    if (now <= this.minDeath) return 0;
    let n = 0, min = Infinity;
    for (const [k, rec] of this.map) {
      if (now > rec.effectiveDeath) { this.map.delete(k); this.bytes -= rec._bytes; this._dec(this.perSigner, rec.signerPubkey); this._dec(this.perTopic, k.slice(0, k.indexOf('|'))); n++; }
      else if (rec.effectiveDeath < min) min = rec.effectiveDeath;
    }
    this.minDeath = min; return n;
  }
  // Pure admission check (no mutation) — lets SUPPRESS test capacity before any side effect.
  wouldAdmit(topicId, k, rec) {
    const recBytes = recordBytes(k, rec);
    if (recBytes > RECORD_MAX) return 'REFUSED_RECORD_TOO_LARGE';
    if (this.map.size >= this.maxCount) return 'REFUSED_GLOBAL_COUNT';
    if (this.bytes + recBytes > this.maxBytes) return 'REFUSED_GLOBAL_BYTES';
    if ((this.perSigner.get(rec.signerPubkey) || 0) >= this.perSignerMax) return 'REFUSED_SIGNER';
    if ((this.perTopic.get(topicId) || 0) >= this.perTopicMax) return 'REFUSED_TOPIC';
    return 'OK';
  }
  insert(topicId, k, rec) {
    const recBytes = recordBytes(k, rec); rec._bytes = recBytes;
    this.map.set(k, rec); this.bytes += recBytes;
    if (rec.effectiveDeath < this.minDeath) this.minDeath = rec.effectiveDeath;
    this._inc(this.perSigner, rec.signerPubkey); this._inc(this.perTopic, topicId);
  }
  admit(topicId, k, rec, now) { this.reclaimExpired(now); const v = this.wouldAdmit(topicId, k, rec); if (v === 'OK') { this.insert(topicId, k, rec); return 'ADMITTED'; } return v; }
}

// ── Integrated node: SUPPRESS + pending queue + oldest-body-first retry ─────────
class Node2 {
  constructor(caps) {
    this.tomb = new TombstoneStore(caps.tomb);
    this.cand = new CandidateStore(caps.cand.max, caps.cand.perSignerMax);
    this.bodies = new BodyCache(caps.bodyMax);
    this.pending = [];                    // [{topicId,msgId,signerPubkey,killBytes,effectiveDeath,bodyArrivedAt}] oldest-body-first
    this.fx = { cacheRemovals: 0, fanouts: 0, candidatePurges: 0, liveEvictions: 0, suppressions: 0 };
  }
  _effDeath(now) { return now + TTL_CEILING + CLOCK_SKEW; }

  // Atomic SUPPRESS: capacity checked BEFORE any side effect; all-or-nothing.
  suppress(topicId, msgId, signerPubkey, killBytes, effectiveDeath, now) {
    const k = key(topicId, msgId);
    this.tomb.reclaimExpired(now);
    const rec = tombRecord(signerPubkey, effectiveDeath, killBytes);
    const verdict = this.tomb.wouldAdmit(topicId, k, rec);
    if (verdict !== 'OK') return verdict;              // REFUSAL: no side effects below run
    this.tomb.insert(topicId, k, rec);
    if (this.bodies.evict(k)) this.fx.cacheRemovals++; // remove body
    this.fx.fanouts++;                                  // idempotent delete fanout (modelled)
    this.fx.candidatePurges += this.cand.purge(k) > 0 ? 1 : 0;
    this.pending = this.pending.filter((p) => key(p.topicId, p.msgId) !== k);
    this.fx.suppressions++;
    return 'SUPPRESSED';
  }

  onKill(topicId, msgId, signerPubkey, now) {
    const k = key(topicId, msgId); const kb = killBytesFor(topicId, msgId, signerPubkey, now);
    const tomb = this.tomb.map.get(k);
    if (tomb) return tomb.signerPubkey === signerPubkey ? 'CONFIRMED' : 'DROP_MISMATCH_TOMB';
    if (this.bodies.has(k)) {                            // body present -> we CAN judge authorship
      const body = this.bodies.get(k);
      if (body.publisher === signerPubkey) {
        const r = this.suppress(topicId, msgId, signerPubkey, kb, this._effDeath(now), now);
        if (r === 'SUPPRESSED') return 'SUPPRESSED';
        // refused at capacity -> retain matching kill as pending-capacity
        this.pending.push({ topicId, msgId, signerPubkey, killBytes: kb, effectiveDeath: this._effDeath(now), bodyArrivedAt: body.arrivedAt });
        return 'PENDING_CAPACITY:' + r;
      }
      return 'DROP_NONAUTHOR_BODYPRESENT';               // body proves non-author
    }
    // body absent -> cannot know authorship -> bounded candidate (or drop under cand cap)
    return this.cand.admit(k, { signerPubkey, killBytes: kb });
  }

  onBody(topicId, msgId, publisher, now) {
    const k = key(topicId, msgId);
    this.bodies.put(k, { publisher, arrivedAt: now });
    const match = this.cand.get(k).find((c) => c.signerPubkey === publisher);
    if (match) {
      const r = this.suppress(topicId, msgId, publisher, match.killBytes, this._effDeath(now), now);
      if (r === 'SUPPRESSED') return 'SUPPRESSED';
      this.cand.remove(k, publisher);                    // move matching cand into pending queue
      this.pending.push({ topicId, msgId, signerPubkey: publisher, killBytes: match.killBytes, effectiveDeath: this._effDeath(now), bodyArrivedAt: now });
      return 'PENDING_CAPACITY:' + r;
    }
    if (this.cand.get(k).length) this.fx.candidatePurges += this.cand.purge(k) > 0 ? 1 : 0; // deliver + purge non-matching
    return 'DELIVERED';
  }

  evictBody(topicId, msgId) {                            // real eviction -> demote any pending candidate
    const k = key(topicId, msgId); const had = this.bodies.evict(k);
    this.pending = this.pending.filter((p) => {
      if (key(p.topicId, p.msgId) === k) { this.cand.admit(k, { signerPubkey: p.signerPubkey, killBytes: p.killBytes }); return false; }
      return true;
    });
    return had;
  }

  // Reclamation + oldest-body-first retry, re-checking every precondition (Gate B contract).
  reclaimAndRetry(now) {
    this.tomb.reclaimExpired(now);
    this.pending.sort((a, b) => a.bodyArrivedAt - b.bodyArrivedAt);   // oldest body first
    const still = [];
    for (const p of this.pending) {
      const k = key(p.topicId, p.msgId);
      const body = this.bodies.get(k);
      const ok = body && body.publisher === p.signerPubkey && now <= p.effectiveDeath;   // re-check body+author+deadline
      if (ok && this.suppress(p.topicId, p.msgId, p.signerPubkey, p.killBytes, p.effectiveDeath, now) === 'SUPPRESSED') continue;
      still.push(p);
    }
    this.pending = still;
  }
}

// Subprocess measurement mode: ONE clean fill in a fresh process + heap delta. Each
// trial is its own process so the heap high-water mark from a prior fill can't make a
// later fill read ~0 B/entry (the flaw in the single-process loop). Prints PERENTRY:<B>.
if (process.argv.includes('--measure-once')) {
  const count = parseInt(process.argv[process.argv.indexOf('--measure-once') + 1], 10);
  const gc0 = () => { if (global.gc) { global.gc(); global.gc(); } };
  gc0(); const base = process.memoryUsage().heapUsed;
  const store = new TombstoneStore({ maxCount: count, maxBytes: Infinity, perSignerMax: Infinity, perTopicMax: Infinity });
  const now0 = 3e12;
  for (let i = 0; i < count; i++) { const tt = newTopicId(), mm = newMsgId(); store.insert(tt, key(tt, mm), tombRecord(newSigner(), now0 + TTL_CEILING, killBytesFor(tt, mm, newSigner(), now0))); }
  gc0(); const after = process.memoryUsage().heapUsed;
  if (store.map.size !== count) { console.error('fill mismatch'); process.exit(2); }
  process.stdout.write('PERENTRY:' + ((after - base) / count) + '\n');
  process.exit(0);
}

// ── Test harness ───────────────────────────────────────────────────────────────
let PASS = 0, FAIL = 0;
const check = (label, cond, d = '') => { (cond ? PASS++ : FAIL++); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${d ? '  — ' + d : ''}`); };
const gc = () => { if (global.gc) { global.gc(); global.gc(); } };
const MiB = (b) => (b / 1048576).toFixed(2);

console.log('REF-1.1 S2.0c — Tombstone-saturation sim v2 (integrated). gc:', Boolean(global.gc), '\n');

// ── 1. Integrated behavioral coverage ──
console.log('1. Integrated behavioral coverage');
{
  const now = 1e12;
  const caps = () => ({ tomb: { maxCount: 4, maxBytes: 1 << 20, perSignerMax: 3, perTopicMax: 3 }, cand: { max: 4, perSignerMax: 2 }, bodyMax: 8 });

  // competing limits: fill tomb to 4 via bodies+kills, N+1 refused on COUNT
  const n = new Node2(caps());
  const made = [];
  for (let i = 0; i < 4; i++) { const t = newTopicId(), m = newMsgId(), s = newSigner(); n.onBody(t, m, s, now); n.onKill(t, m, s, now); made.push({ t, m, s }); }
  check('4 co-located kills suppressed', n.fx.suppressions === 4, `sup=${n.fx.suppressions}`);
  const fxBefore = { ...n.fx };
  const t5 = newTopicId(), m5 = newMsgId(), s5 = newSigner(); n.onBody(t5, m5, s5, now);
  const r5 = n.onKill(t5, m5, s5, now);
  check('N+1 co-located kill refused (count) -> pending', r5.startsWith('PENDING_CAPACITY:REFUSED_GLOBAL_COUNT'), r5);
  check('refusal did NOT remove body', n.bodies.has(key(t5, m5)));
  check('refusal caused NO new fanout/cache-removal/purge/eviction',
    n.fx.fanouts === fxBefore.fanouts && n.fx.cacheRemovals === fxBefore.cacheRemovals && n.fx.candidatePurges === fxBefore.candidatePurges && n.fx.liveEvictions === 0);

  // reclamation + oldest-body-first retry with a REAL pending candidate
  const nr = new Node2({ tomb: { maxCount: 1, maxBytes: 1 << 20, perSignerMax: 3, perTopicMax: 3 }, cand: { max: 8, perSignerMax: 8 }, bodyMax: 8 });
  const ta = newTopicId(), ma = newMsgId(), sa = newSigner();
  nr.onBody(ta, ma, sa, now); const rr = nr.suppress(ta, ma, sa, killBytesFor(ta, ma, sa, now), now + 2000, now);
  check('short-lived tombstone occupies the single slot', rr === 'SUPPRESSED');
  const tb = newTopicId(), mb = newMsgId(), sb = newSigner();
  nr.onBody(tb, mb, sb, now + 1); const rb = nr.onKill(tb, mb, sb, now + 1);
  check('2nd co-located kill refused, retained pending', rb.startsWith('PENDING_CAPACITY') && nr.pending.length === 1, rb);
  nr.reclaimAndRetry(2001 + now);          // clock past the short tombstone's death
  check('reclamation retry suppresses the pending candidate', nr.fx.suppressions === 2 && nr.pending.length === 0, `sup=${nr.fx.suppressions}`);

  // real body eviction demotes a pending candidate (no self-admit on reclaim)
  const ne = new Node2({ tomb: { maxCount: 1, maxBytes: 1 << 20, perSignerMax: 3, perTopicMax: 3 }, cand: { max: 8, perSignerMax: 8 }, bodyMax: 8 });
  const tc = newTopicId(), mc = newMsgId(), sc = newSigner();
  ne.onBody(tc, mc, sc, now); ne.suppress(tc, mc, sc, killBytesFor(tc, mc, sc, now), now + 2000, now);
  const td = newTopicId(), md = newMsgId(), sd = newSigner();
  ne.onBody(td, md, sd, now + 1); ne.onKill(td, md, sd, now + 1);
  ne.evictBody(td, md);                     // body gone before a slot frees
  ne.reclaimAndRetry(2001 + now);
  check('body-evicted pending candidate NOT suppressed on reclaim', ne.fx.suppressions === 1 && ne.pending.length === 0, `sup=${ne.fx.suppressions}`);
  check('demoted candidate reverts to body-absent candidate', ne.cand.get(key(td, md)).length === 1);

  // byte-cap refusal (tight byte budget, generous count)
  const nb = new Node2({ tomb: { maxCount: 100, maxBytes: 900, perSignerMax: 100, perTopicMax: 100 }, cand: { max: 8, perSignerMax: 8 }, bodyMax: 8 });
  const tby = newTopicId(), mby = newMsgId(), sby = newSigner(); nb.onBody(tby, mby, sby, now);
  const rby = nb.onKill(tby, mby, sby, now);    // one record ~800B fits; second won't (900B cap)
  const tby2 = newTopicId(), mby2 = newMsgId(), sby2 = newSigner(); nb.onBody(tby2, mby2, sby2, now);
  const rby2 = nb.onKill(tby2, mby2, sby2, now);
  check('byte-cap: first fits, second refused on bytes', rby === 'SUPPRESSED' && rby2.includes('REFUSED_GLOBAL_BYTES'), `${rby} / ${rby2}`);

  // oversized-record refusal (record cap 768; force a huge synthetic record)
  const no = new Node2({ tomb: { maxCount: 100, maxBytes: 1 << 20, perSignerMax: 100, perTopicMax: 100 }, cand: { max: 8, perSignerMax: 8 }, bodyMax: 8 });
  const to = newTopicId(), mo = newMsgId(), so = newSigner();
  const bigKill = 'x'.repeat(2000);
  const rov = no.suppress(to, mo, so, bigKill, now + 1000, now);
  check('oversized record refused (REFUSED_RECORD_TOO_LARGE)', rov === 'REFUSED_RECORD_TOO_LARGE', rov);

  // candidate-cap saturation + per-signer
  const nc = new Node2({ tomb: { maxCount: 100, maxBytes: 1 << 20, perSignerMax: 100, perTopicMax: 100 }, cand: { max: 3, perSignerMax: 2 }, bodyMax: 8 });
  const sig = newSigner();
  const r1 = nc.onKill(newTopicId(), newMsgId(), sig, now);   // body absent -> candidate
  const r2 = nc.onKill(newTopicId(), newMsgId(), sig, now);
  const r3 = nc.onKill(newTopicId(), newMsgId(), sig, now);   // 3rd from same signer -> per-signer cap 2
  check('candidate per-signer cap refuses 3rd from one signer', r1 === 'ADMITTED' && r2 === 'ADMITTED' && r3 === 'REFUSED_CAND_SIGNER', `${r1}/${r2}/${r3}`);
  nc.onKill(newTopicId(), newMsgId(), newSigner(), now);      // fills global (total now 3)
  const rg = nc.onKill(newTopicId(), newMsgId(), newSigner(), now);
  check('candidate global cap refuses when full', rg === 'REFUSED_CAND_GLOBAL', rg);

  // per-signer + per-topic tombstone sublimits under competition
  const nt = new Node2({ tomb: { maxCount: 100, maxBytes: 1 << 20, perSignerMax: 2, perTopicMax: 2 }, cand: { max: 20, perSignerMax: 20 }, bodyMax: 20 });
  const sigX = newSigner();
  let okc = 0; for (let i = 0; i < 3; i++) { const t = newTopicId(), m = newMsgId(); nt.onBody(t, m, sigX, now); if (nt.onKill(t, m, sigX, now) === 'SUPPRESSED') okc++; }
  check('tombstone per-signer sublimit binds (2 of 3)', okc === 2, `ok=${okc}`);
  const topicY = newTopicId();
  let okt = 0; for (let i = 0; i < 3; i++) { const m = newMsgId(), s = newSigner(); nt.onBody(topicY, m, s, now); if (nt.onKill(topicY, m, s, now) === 'SUPPRESSED') okt++; }
  check('tombstone per-topic sublimit binds (2 of 3, distinct signers)', okt === 2, `ok=${okt}`);
  console.log('');
}

// ── 2. Repeated heap measurement at proposed final counts, with environment + variance ──
console.log('2. Repeated heap measurement (environment-recorded, multi-trial)');
console.log(`   node=${process.version} v8=${process.versions.v8} os=${os.platform()}/${os.arch()} ${os.release()}`);
const __file = fileURLToPath(import.meta.url);
function measureAt(count, trials) {
  const per = [];
  for (let t = 0; t < trials; t++) {
    const r = spawnSync(process.execPath, ['--expose-gc', __file, '--measure-once', String(count)], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const m = /PERENTRY:([\d.]+)/.exec(r.stdout || '');
    if (!m) throw new Error('measure subprocess failed: ' + (r.stderr || r.stdout || 'no output'));
    per.push(parseFloat(m[1]));
  }
  const mean = per.reduce((a, b) => a + b, 0) / per.length;
  const max = Math.max(...per);
  const sd = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / per.length);
  return { mean, max, sd, per };
}
const TRIALS = 6;
const relayM = measureAt(65536, TRIALS);
const browserProxyM = measureAt(4096, TRIALS);
console.log(`   relay@65536  : per-entry mean=${relayM.mean.toFixed(0)}B sd=${relayM.sd.toFixed(0)} max=${relayM.max.toFixed(0)}  (trials ${relayM.per.map((x) => x.toFixed(0)).join(',')})`);
console.log(`   browser-proxy@4096 (NODE, not a real browser): mean=${browserProxyM.mean.toFixed(0)}B sd=${browserProxyM.sd.toFixed(0)} max=${browserProxyM.max.toFixed(0)}`);
console.log('');

// ── 3. Conservative sizing from worst-case + integration headroom ──
console.log(`3. Conservative sizing (worst-case per-entry, ${INTEGRATION_HEADROOM * 100}% integration headroom)`);
function sizeFor(name, budgetMiB, worstPerEntry) {
  const usable = budgetMiB * 1048576 * (1 - INTEGRATION_HEADROOM);
  const raw = Math.floor(usable / worstPerEntry);
  const pow2 = 1 << Math.floor(Math.log2(raw));                 // round down to power of two
  console.log(`   ${name}: budget ${budgetMiB} MiB, usable ${MiB(usable)} MiB @ ${worstPerEntry.toFixed(0)} B/entry`);
  console.log(`     raw fit ${raw} -> conservative MAX_COUNT ${pow2} (${MiB(pow2 * worstPerEntry)} MiB worst-case, ${(pow2 * worstPerEntry / (budgetMiB * 1048576) * 100).toFixed(0)}% of budget); sublimit ${pow2 / SUBLIMIT_FRACTION}`);
  return pow2;
}
const relayCount = sizeFor('relay', RELAY_BUDGET_MiB, relayM.max);
const browserCount = sizeFor('browser (Node proxy — confirm in real browser)', BROWSER_BUDGET_MiB, browserProxyM.max);
console.log('');
console.log(`Proposed normative defaults (pending real-browser confirmation for the browser profile):`);
console.log(`  TOMBSTONE_RECORD_MAX=${RECORD_MAX}  relay MAX_COUNT=${relayCount} sublimit=${relayCount / SUBLIMIT_FRACTION}  browser MAX_COUNT=${browserCount} sublimit=${browserCount / SUBLIMIT_FRACTION}`);
console.log('');
console.log(`RESULT: ${PASS} behavioral checks passed, ${FAIL} failed.`);
process.exit(FAIL ? 1 : 0);
