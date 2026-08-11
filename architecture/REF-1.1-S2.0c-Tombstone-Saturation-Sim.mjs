#!/usr/bin/env node --expose-gc
// REF-1.1 S2.0c — Tombstone-saturation simulation (AUTH-B, Gate A) — v3, full deletion state.
//
// Recut per Aster Gate A recut review (msgId b8c2d20f, CHANGES REQUIRED). Fixes:
//   (1) pending-capacity state is now bounded, deduplicated, and expiring — it lives inside
//       the CandidateStore's accounting (global + per-signer + per-topic + byte + record),
//       not a separate unbounded array;
//   (2) real BodyCache overflow eviction is wired to pending demotion (not only the explicit
//       helper);
//   (3) expiry is faithful: a body carries its COMMITTED signed effectiveDeath (never recomputed
//       from local now+TTL), and candidates expire at ClaimRetention; arrival/retry cannot extend
//       authorization or retention (boundary-tested);
//   (4) the heap benchmark measures the COMPLETE deletion state (tombstones + candidates) at the
//       proposed final counts, so caps are sized so their SUM fits the budget.
//
// Honest limits: measured on this host's OS/runtime only (darwin/arm64 Node). Production relays
// also run on Linux (droplets) and Windows (fleet); those and any real browser profile MUST be
// re-measured on their own runtimes before the defaults are treated as normative. The browser
// number here is a non-normative, DISABLED planning proxy (the pane pins performance.memory; see
// -Heap-Browser.html and -Results.md).
//
// Run:  node --expose-gc REF-1.1-S2.0c-Tombstone-Saturation-Sim.mjs

import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RECORD_MAX = 768;
const SUBLIMIT_FRACTION = 16;
const INTEGRATION_HEADROOM = 0.30;
const RELAY_BUDGET_MiB = 64, BROWSER_BUDGET_MiB = 4;
const TTL_CEILING = 24 * 3600 * 1000;
const CLOCK_SKEW = 5000;
const FUTURE_TOLERANCE_MS = 30000;
const KILL_DOMAIN = 'axona:pubsub-kill:v1';
// ClaimRetention: how long a body-absent candidate is held (signed-expiry v6 D2 horizon).
const claimRetention = (receipt) => receipt + FUTURE_TOLERANCE_MS + TTL_CEILING + CLOCK_SKEW;

const hex = (n) => randomBytes(n).toString('hex');
const newTopicId = () => hex(33), newMsgId = () => hex(32), newSigner = () => hex(32);
const newSig = () => 'ed25519:' + hex(64);
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const key = (t, m) => t + '|' + m;
const topicOf = (k) => k.slice(0, k.indexOf('|'));
const killBytesFor = (t, m, s, now) => canonical({ d: KILL_DOMAIN, topicId: t, msgId: m, ts: now - 1000, seq: 1, signature: newSig(), signerPubkey: s });
const recBytesOf = (k, rec) => Buffer.byteLength(k, 'utf8') + Buffer.byteLength(canonical(rec), 'utf8');

// ── Body cache: bounded, auto-evicts oldest; reports the evicted key so the owner can demote ──
class BodyCache {
  constructor(max) { this.max = max; this.map = new Map(); }
  has(k) { return this.map.has(k); }
  get(k) { return this.map.get(k); }
  put(k, body) {                                   // returns evicted key or null
    let evicted = null;
    if (!this.map.has(k) && this.map.size >= this.max) { evicted = this.map.keys().next().value; this.map.delete(evicted); }
    this.map.set(k, body); return evicted;
  }
  evict(k) { return this.map.delete(k); }
}

// ── Candidate store: holds BOTH plain body-absent candidates AND pending-capacity ones.
// Bounded global + per-signer + per-topic + byte + record. Dedup by (key, signer). Expiry at
// claimRetention. Refusal only — never evicts a non-expired entry. ──
class CandidateStore {
  constructor({ max, maxBytes, perSignerMax, perTopicMax }) {
    Object.assign(this, { max, maxBytes, perSignerMax, perTopicMax });
    this.map = new Map();                           // key -> [ {signer, killBytes, tag, bodyArrivedAt, claimRet, _bytes} ]
    this.total = 0; this.bytes = 0; this.perSigner = new Map(); this.perTopic = new Map();
  }
  _cnt(m, k) { return m.get(k) || 0; }
  _inc(m, k) { m.set(k, (m.get(k) || 0) + 1); }
  _dec(m, k) { const c = m.get(k) - 1; if (c <= 0) m.delete(k); else m.set(k, c); }
  reclaimExpired(now) {
    let n = 0;
    for (const [k, list] of this.map) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (now > list[i].claimRet) { const c = list[i]; list.splice(i, 1); this.total--; this.bytes -= c._bytes; this._dec(this.perSigner, c.signer); this._dec(this.perTopic, topicOf(k)); n++; }
      }
      if (!list.length) this.map.delete(k);
    }
    return n;
  }
  admit(k, signer, killBytes, now, tag = 'plain', bodyArrivedAt = null) {
    this.reclaimExpired(now);
    const list = this.map.get(k) || [];
    if (list.some((c) => c.signer === signer)) return 'DUP';            // dedup repeated matching KILLs
    const _bytes = recBytesOf(k, { signer, killBytes });
    if (_bytes > RECORD_MAX) return 'REFUSED_RECORD_TOO_LARGE';
    if (this.total >= this.max) return 'REFUSED_CAND_GLOBAL';
    if (this.bytes + _bytes > this.maxBytes) return 'REFUSED_CAND_BYTES';
    if (this._cnt(this.perSigner, signer) >= this.perSignerMax) return 'REFUSED_CAND_SIGNER';
    if (this._cnt(this.perTopic, topicOf(k)) >= this.perTopicMax) return 'REFUSED_CAND_TOPIC';
    list.push({ signer, killBytes, tag, bodyArrivedAt, claimRet: claimRetention(now), _bytes });
    this.map.set(k, list); this.total++; this.bytes += _bytes; this._inc(this.perSigner, signer); this._inc(this.perTopic, topicOf(k));
    return 'ADMITTED';
  }
  get(k) { return this.map.get(k) || []; }
  find(k, signer) { return this.get(k).find((c) => c.signer === signer); }
  setTag(k, signer, tag, bodyArrivedAt) { const c = this.find(k, signer); if (c) { c.tag = tag; c.bodyArrivedAt = bodyArrivedAt; } return !!c; }
  demoteKey(k) { for (const c of this.get(k)) { c.tag = 'plain'; c.bodyArrivedAt = null; } }   // body gone -> all revert
  remove(k, signer) {
    const list = this.map.get(k); if (!list) return false;
    const i = list.findIndex((c) => c.signer === signer); if (i < 0) return false;
    const c = list[i]; list.splice(i, 1); this.total--; this.bytes -= c._bytes; this._dec(this.perSigner, c.signer); this._dec(this.perTopic, topicOf(k));
    if (!list.length) this.map.delete(k); return true;
  }
  purge(k) { const list = this.map.get(k); if (!list) return 0; for (const c of list) { this.total--; this.bytes -= c._bytes; this._dec(this.perSigner, c.signer); this._dec(this.perTopic, topicOf(k)); } this.map.delete(k); return list.length; }
  pendingOldestFirst() {
    const out = [];
    for (const [k, list] of this.map) for (const c of list) if (c.tag === 'pending') out.push({ k, c });
    return out.sort((a, b) => a.c.bodyArrivedAt - b.c.bodyArrivedAt);
  }
}

// ── Tombstone store: unchanged bounds; effectiveDeath is the body's COMMITTED value ──
class TombstoneStore {
  constructor({ maxCount, maxBytes, perSignerMax, perTopicMax }) {
    Object.assign(this, { maxCount, maxBytes, perSignerMax, perTopicMax });
    this.map = new Map(); this.bytes = 0; this.perSigner = new Map(); this.perTopic = new Map(); this.minDeath = Infinity;
  }
  _dec(m, k) { const c = m.get(k) - 1; if (c <= 0) m.delete(k); else m.set(k, c); }
  _inc(m, k) { m.set(k, (m.get(k) || 0) + 1); }
  reclaimExpired(now) {
    if (now <= this.minDeath) return 0;
    let n = 0, min = Infinity;
    for (const [k, rec] of this.map) { if (now > rec.effectiveDeath) { this.map.delete(k); this.bytes -= rec._bytes; this._dec(this.perSigner, rec.signerPubkey); this._dec(this.perTopic, topicOf(k)); n++; } else if (rec.effectiveDeath < min) min = rec.effectiveDeath; }
    this.minDeath = min; return n;
  }
  wouldAdmit(topicId, k, rec) {
    const b = recBytesOf(k, rec);
    if (b > RECORD_MAX) return 'REFUSED_RECORD_TOO_LARGE';
    if (this.map.size >= this.maxCount) return 'REFUSED_GLOBAL_COUNT';
    if (this.bytes + b > this.maxBytes) return 'REFUSED_GLOBAL_BYTES';
    if ((this.perSigner.get(rec.signerPubkey) || 0) >= this.perSignerMax) return 'REFUSED_SIGNER';
    if ((this.perTopic.get(topicId) || 0) >= this.perTopicMax) return 'REFUSED_TOPIC';
    return 'OK';
  }
  insert(topicId, k, rec) { const b = recBytesOf(k, rec); rec._bytes = b; this.map.set(k, rec); this.bytes += b; if (rec.effectiveDeath < this.minDeath) this.minDeath = rec.effectiveDeath; this._inc(this.perSigner, rec.signerPubkey); this._inc(this.perTopic, topicId); }
}

class Node2 {
  constructor(caps) {
    this.tomb = new TombstoneStore(caps.tomb);
    this.cand = new CandidateStore(caps.cand);
    this.bodies = new BodyCache(caps.bodyMax);
    this.fx = { cacheRemovals: 0, fanouts: 0, candidatePurges: 0, liveEvictions: 0, suppressions: 0, demotions: 0 };
  }
  // SUPPRESS is atomic and uses the body's COMMITTED effectiveDeath (never recomputed).
  // FAIL-CLOSED deadline check FIRST — before any capacity check or side effect — so an
  // already-expired authorization can never suppress a body or install an expired tombstone,
  // on ANY path (direct body-present KILL, late matching body, or retry).
  suppress(topicId, msgId, signer, killBytes, effectiveDeath, now) {
    if (now > effectiveDeath) return 'REFUSED_EXPIRED';
    const k = key(topicId, msgId);
    this.tomb.reclaimExpired(now);
    const rec = { signerPubkey: signer, effectiveDeath, killBytes };
    const v = this.tomb.wouldAdmit(topicId, k, rec);
    if (v !== 'OK') return v;
    this.tomb.insert(topicId, k, rec);
    if (this.bodies.evict(k)) this.fx.cacheRemovals++;
    this.fx.fanouts++;
    if (this.cand.purge(k) > 0) this.fx.candidatePurges++;
    this.fx.suppressions++;
    return 'SUPPRESSED';
  }
  _putBody(k, body) { const ev = this.bodies.put(k, body); if (ev) { this.fx.liveEvictions++; this.cand.demoteKey(ev); this.fx.demotions++; } }   // auto-eviction -> demote

  onKill(topicId, msgId, signer, now) {
    const k = key(topicId, msgId); const kb = killBytesFor(topicId, msgId, signer, now);
    const tomb = this.tomb.map.get(k);
    if (tomb) return tomb.signerPubkey === signer ? 'CONFIRMED' : 'DROP_MISMATCH_TOMB';
    if (this.bodies.has(k)) {
      const body = this.bodies.get(k);
      if (body.publisher === signer) {
        const r = this.suppress(topicId, msgId, signer, kb, body.effectiveDeath, now);
        if (r === 'SUPPRESSED') return 'SUPPRESSED';
        if (r === 'REFUSED_EXPIRED') return 'DROP_EXPIRED';                          // committed death passed: no pending
        const a = this.cand.admit(k, signer, kb, now, 'pending', body.arrivedAt);   // retain matching kill, bounded
        return 'PENDING_CAPACITY:' + r + '/' + a;
      }
      return 'DROP_NONAUTHOR_BODYPRESENT';
    }
    return this.cand.admit(k, signer, kb, now);                                       // body absent -> bounded plain candidate
  }
  onBody(topicId, msgId, publisher, effectiveDeath, now) {
    const k = key(topicId, msgId);
    this._putBody(k, { publisher, effectiveDeath, arrivedAt: now });
    const match = this.cand.find(k, publisher);
    if (match) {
      const r = this.suppress(topicId, msgId, publisher, match.killBytes, effectiveDeath, now);
      if (r === 'SUPPRESSED') return 'SUPPRESSED';
      if (r === 'REFUSED_EXPIRED') return 'DROP_EXPIRED';                              // committed death passed
      this.cand.setTag(k, publisher, 'pending', now);                                 // stays bounded in cand store
      return 'PENDING_CAPACITY:' + r;
    }
    if (this.cand.get(k).length) { if (this.cand.purge(k) > 0) this.fx.candidatePurges++; }
    return 'DELIVERED';
  }
  evictBody(topicId, msgId) { const k = key(topicId, msgId); const had = this.bodies.evict(k); this.cand.demoteKey(k); if (had) this.fx.demotions++; return had; }

  reclaimAndRetry(now) {
    this.tomb.reclaimExpired(now); this.cand.reclaimExpired(now);
    for (const { k, c } of this.cand.pendingOldestFirst()) {
      const body = this.bodies.get(k);
      const ok = body && body.publisher === c.signer && now <= body.effectiveDeath;   // re-check body + author + committed deadline
      if (ok) { const [t, m] = k.split('|'); if (this.suppress(t, m, c.signer, c.killBytes, body.effectiveDeath, now) === 'SUPPRESSED') this.cand.remove(k, c.signer); }
    }
  }
}

const gc = () => { if (global.gc) { global.gc(); global.gc(); } };
const MiB = (b) => (b / 1048576).toFixed(2);

// ── Subprocess measurement: build the COMPLETE deletion state (tombstones + candidates) ──
if (process.argv.includes('--measure-once')) {
  const i = process.argv.indexOf('--measure-once');
  const tombN = parseInt(process.argv[i + 1], 10), candN = parseInt(process.argv[i + 2], 10);
  gc(); const base = process.memoryUsage().heapUsed;
  const tomb = new TombstoneStore({ maxCount: tombN, maxBytes: Infinity, perSignerMax: Infinity, perTopicMax: Infinity });
  const cand = new CandidateStore({ max: candN, maxBytes: Infinity, perSignerMax: Infinity, perTopicMax: Infinity });
  const now0 = 3e12;
  for (let j = 0; j < tombN; j++) { const t = newTopicId(), m = newMsgId(); tomb.insert(t, key(t, m), { signerPubkey: newSigner(), effectiveDeath: now0 + TTL_CEILING, killBytes: killBytesFor(t, m, newSigner(), now0) }); }
  for (let j = 0; j < candN; j++) { const t = newTopicId(), m = newMsgId(); cand.admit(key(t, m), newSigner(), killBytesFor(t, m, newSigner(), now0), now0); }
  gc(); const after = process.memoryUsage().heapUsed;
  if (tomb.map.size !== tombN || cand.total !== candN) { console.error('fill mismatch'); process.exit(2); }
  process.stdout.write('PERENTRY:' + ((after - base) / (tombN + candN)) + ' TOTAL:' + (after - base) + '\n');
  process.exit(0);
}

// ── Behavioral coverage ──
let PASS = 0, FAIL = 0;
const check = (label, cond, d = '') => { (cond ? PASS++ : FAIL++); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${d ? '  — ' + d : ''}`); };
console.log('REF-1.1 S2.0c — Tombstone-saturation sim v3 (full deletion state). gc:', Boolean(global.gc), '\n');
console.log('1. Behavioral coverage');
{
  const now = 1e12;
  const ed = (t = now) => t + TTL_CEILING + CLOCK_SKEW;    // committed effectiveDeath
  const caps = () => ({ tomb: { maxCount: 4, maxBytes: 1 << 20, perSignerMax: 3, perTopicMax: 3 }, cand: { max: 4, maxBytes: 1 << 20, perSignerMax: 2, perTopicMax: 2 }, bodyMax: 8 });

  const n = new Node2(caps());
  for (let i = 0; i < 4; i++) { const t = newTopicId(), m = newMsgId(), s = newSigner(); n.onBody(t, m, s, ed(), now); n.onKill(t, m, s, now); }
  check('4 co-located kills suppressed', n.fx.suppressions === 4);
  const fx0 = { ...n.fx };
  const t5 = newTopicId(), m5 = newMsgId(), s5 = newSigner(); n.onBody(t5, m5, s5, ed(), now);
  const r5 = n.onKill(t5, m5, s5, now);
  check('N+1 refused -> bounded pending candidate', r5.startsWith('PENDING_CAPACITY') && r5.includes('ADMITTED'), r5);
  check('refusal: no fanout/cache-removal/purge/eviction', n.fx.fanouts === fx0.fanouts && n.fx.cacheRemovals === fx0.cacheRemovals && n.fx.candidatePurges === fx0.candidatePurges && n.fx.liveEvictions === fx0.liveEvictions);

  // pending is BOUNDED: fill candidate global cap, further pending refused
  const nb = new Node2({ tomb: { maxCount: 1, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 2, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, bodyMax: 10 });
  const occ = () => { const t = newTopicId(), m = newMsgId(), s = newSigner(); nb.onBody(t, m, s, ed(), now); return nb.suppress(t, m, s, killBytesFor(t, m, s, now), ed(), now); };
  occ();                                                    // fill the single tombstone slot
  let pAdmit = 0, pRef = 0;
  for (let i = 0; i < 3; i++) { const t = newTopicId(), m = newMsgId(), s = newSigner(); nb.onBody(t, m, s, ed(), now); const r = nb.onKill(t, m, s, now); if (r.includes('ADMITTED')) pAdmit++; else if (r.includes('REFUSED_CAND_GLOBAL')) pRef++; }
  check('pending-capacity is bounded (cand global cap refuses overflow)', pAdmit === 2 && pRef === 1, `admit=${pAdmit} ref=${pRef}`);

  // duplicate KILL flood is deduplicated
  const nd = new Node2({ tomb: { maxCount: 0, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
  const td = newTopicId(), md = newMsgId(), sd = newSigner();
  const d1 = nd.onKill(td, md, sd, now), d2 = nd.onKill(td, md, sd, now), d3 = nd.onKill(td, md, sd, now);
  check('duplicate KILL flood deduped (1 admit, rest DUP)', d1 === 'ADMITTED' && d2 === 'DUP' && d3 === 'DUP' && nd.cand.total === 1, `${d1}/${d2}/${d3} total=${nd.cand.total}`);

  // candidate expiry at claimRetention
  const ne = new Node2({ tomb: { maxCount: 0, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
  const te = newTopicId(), me = newMsgId(), se = newSigner(); ne.onKill(te, me, se, now);
  const before = ne.cand.total; ne.cand.reclaimExpired(claimRetention(now) + 1);
  check('candidate expires at claimRetention', before === 1 && ne.cand.total === 0);

  // REAL body-cache overflow -> demotion (not the explicit helper)
  const no = new Node2({ tomb: { maxCount: 0, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 2 });
  const A = [newTopicId(), newMsgId(), newSigner()], B = [newTopicId(), newMsgId(), newSigner()], C = [newTopicId(), newMsgId(), newSigner()];
  no.onBody(A[0], A[1], A[2], ed(), now); no.onKill(A[0], A[1], A[2], now);   // A pending (tomb full at 0)
  check('A is pending after tomb-full refusal', no.cand.find(key(A[0], A[1]), A[2]).tag === 'pending');
  no.onBody(B[0], B[1], B[2], ed(), now + 1); no.onBody(C[0], C[1], C[2], ed(), now + 2);   // overflow bodyMax=2 -> evicts A's body
  check('body-cache overflow demoted A (auto-eviction)', no.fx.demotions === 1 && no.cand.find(key(A[0], A[1]), A[2]).tag === 'plain', `dem=${no.fx.demotions}`);
  no.reclaimAndRetry(now + 3);
  check('demoted-A not suppressed on retry (body gone)', no.fx.suppressions === 0);

  // faithful expiry: retry AFTER committed effectiveDeath is rejected; arrival cannot extend
  const nx = new Node2({ tomb: { maxCount: 1, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
  const tx = newTopicId(), mx = newMsgId(), sx = newSigner();
  nx.suppress(tx, mx, sx, killBytesFor(tx, mx, sx, now), now + 1000, now);   // occupy slot, short death
  const ty = newTopicId(), my = newMsgId(), sy = newSigner(); const deathY = now + 500;
  nx.onBody(ty, my, sy, deathY, now); nx.onKill(ty, my, sy, now);            // Y pending, committed death now+500
  nx.reclaimAndRetry(now + 1001);                                            // slot frees at 1001 > Y's death 500
  check('retry after committed effectiveDeath is rejected', nx.tomb.map.has(key(ty, my)) === false, `suppressed=${nx.fx.suppressions}`);

  // FIX-1: the committed-expiry guard lives in SUPPRESS itself — fail-closed on EVERY path.
  const ng = () => new Node2({ tomb: { maxCount: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
  { const g = ng(), t = newTopicId(), m = newMsgId(), s = newSigner(), d = now + 1000; g.onBody(t, m, s, d, now);
    check('direct KILL at effectiveDeath suppresses (boundary)', g.onKill(t, m, s, d) === 'SUPPRESSED'); }
  { const g = ng(), t = newTopicId(), m = newMsgId(), s = newSigner(), d = now + 1000; g.onBody(t, m, s, d, now);
    check('direct KILL at effectiveDeath+1 dropped, no tombstone', g.onKill(t, m, s, d + 1) === 'DROP_EXPIRED' && !g.tomb.map.has(key(t, m))); }
  { const g = ng(), t = newTopicId(), m = newMsgId(), s = newSigner(), d = now + 1000; g.onKill(t, m, s, now);
    check('late matching body past committed death does not suppress', g.onBody(t, m, s, d, d + 1) === 'DROP_EXPIRED' && !g.tomb.map.has(key(t, m))); }
  { const g = ng(), t = newTopicId(), m = newMsgId(), s = newSigner();
    check('suppress() directly rejects already-expired', g.suppress(t, m, s, killBytesFor(t, m, s, now), now - 1, now) === 'REFUSED_EXPIRED' && !g.tomb.map.has(key(t, m))); }

  // FIX-3 restored regression coverage: byte-cap, oversized-record, per-signer, per-topic (both stores)
  { const g = new Node2({ tomb: { maxCount: 100, maxBytes: 900, perSignerMax: 100, perTopicMax: 100 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
    const t1 = newTopicId(), m1 = newMsgId(), s1 = newSigner(); g.onBody(t1, m1, s1, ed(), now); const a = g.onKill(t1, m1, s1, now);
    const t2 = newTopicId(), m2 = newMsgId(), s2 = newSigner(); g.onBody(t2, m2, s2, ed(), now); const b = g.onKill(t2, m2, s2, now);
    check('tombstone byte-cap refuses 2nd', a === 'SUPPRESSED' && b.includes('REFUSED_GLOBAL_BYTES'), `${a}/${b}`); }
  { const g = new Node2({ tomb: { maxCount: 100, maxBytes: 1 << 20, perSignerMax: 100, perTopicMax: 100 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
    const t = newTopicId(), m = newMsgId(), s = newSigner();
    check('tombstone oversized-record refused', g.suppress(t, m, s, 'x'.repeat(2000), ed(), now) === 'REFUSED_RECORD_TOO_LARGE'); }
  { const g = new Node2({ tomb: { maxCount: 100, maxBytes: 1 << 20, perSignerMax: 2, perTopicMax: 100 }, cand: { max: 20, maxBytes: 1 << 20, perSignerMax: 20, perTopicMax: 20 }, bodyMax: 20 });
    const s = newSigner(); let ok = 0; for (let i = 0; i < 3; i++) { const t = newTopicId(), m = newMsgId(); g.onBody(t, m, s, ed(), now); if (g.onKill(t, m, s, now) === 'SUPPRESSED') ok++; }
    check('tombstone per-signer sublimit binds (2 of 3)', ok === 2, `ok=${ok}`); }
  { const g = new Node2({ tomb: { maxCount: 100, maxBytes: 1 << 20, perSignerMax: 100, perTopicMax: 2 }, cand: { max: 20, maxBytes: 1 << 20, perSignerMax: 20, perTopicMax: 20 }, bodyMax: 20 });
    const tp = newTopicId(); let ok = 0; for (let i = 0; i < 3; i++) { const m = newMsgId(), s = newSigner(); g.onBody(tp, m, s, ed(), now); if (g.onKill(tp, m, s, now) === 'SUPPRESSED') ok++; }
    check('tombstone per-topic sublimit binds (2 of 3)', ok === 2, `ok=${ok}`); }
  { const g = new Node2({ tomb: { maxCount: 0, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 100, maxBytes: 900, perSignerMax: 100, perTopicMax: 100 }, bodyMax: 10 });
    const c1 = g.onKill(newTopicId(), newMsgId(), newSigner(), now); const c2 = g.onKill(newTopicId(), newMsgId(), newSigner(), now);
    check('candidate byte-cap refuses when full', c1 === 'ADMITTED' && c2 === 'REFUSED_CAND_BYTES', `${c1}/${c2}`); }

  // FIX-3: promote(plain->pending) and demote preserve count/bytes/sublimit/dedup/ClaimRetention
  { const g = new Node2({ tomb: { maxCount: 0, maxBytes: 1 << 20, perSignerMax: 5, perTopicMax: 5 }, cand: { max: 10, maxBytes: 1 << 20, perSignerMax: 10, perTopicMax: 10 }, bodyMax: 10 });
    const t = newTopicId(), m = newMsgId(), s = newSigner(); g.onKill(t, m, s, now);
    const snap = () => JSON.stringify({ total: g.cand.total, bytes: g.cand.bytes, sig: g.cand.perSigner.get(s), top: g.cand.perTopic.get(t), cr: g.cand.find(key(t, m), s).claimRet });
    const b0 = snap(); g.cand.setTag(key(t, m), s, 'pending', now + 5); g.cand.demoteKey(key(t, m)); const a0 = snap();
    check('promote/demote preserve count/bytes/sublimit/claimRet', b0 === a0, a0); }
  console.log('');
}

// ── Full-state heap measurement (tombstones + candidates), fresh process per trial ──
console.log('2. Full-state heap measurement (tombstones + candidates), multi-trial');
console.log(`   node=${process.version} v8=${process.versions.v8} os=${os.platform()}/${os.arch()} ${os.release()}`);
const __file = fileURLToPath(import.meta.url);
function measure(tombN, candN, trials) {
  const per = [];
  for (let t = 0; t < trials; t++) {
    const r = spawnSync(process.execPath, ['--expose-gc', __file, '--measure-once', String(tombN), String(candN)], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const m = /PERENTRY:([\d.]+)/.exec(r.stdout || ''); if (!m) throw new Error('measure failed: ' + (r.stderr || r.stdout));
    per.push(parseFloat(m[1]));
  }
  const mean = per.reduce((a, b) => a + b, 0) / per.length, max = Math.max(...per);
  const sd = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / per.length);
  return { mean, max, sd, per };
}
// Propose splitting the entry budget: tombstones 4x candidates (deletions outnumber pending claims).
function proposeCounts(budgetMiB, perEntryWorst) {
  const usable = budgetMiB * 1048576 * (1 - INTEGRATION_HEADROOM);
  const totalEntries = Math.floor(usable / perEntryWorst);
  const candN = 1 << Math.floor(Math.log2(totalEntries / 5));    // ~1/5 candidates
  const tombN = 1 << Math.floor(Math.log2(totalEntries - candN));
  return { tombN, candN, totalEntries };
}
const TRIALS = 6;
// First-pass per-entry from a representative full-state fill, then size, then confirm.
const probe = measure(32768, 8192, TRIALS);
console.log(`   full-state @ (tomb 32768 + cand 8192): per-entry mean=${probe.mean.toFixed(0)}B sd=${probe.sd.toFixed(0)} max=${probe.max.toFixed(0)}  (${probe.per.map(x => x.toFixed(0)).join(',')})`);
const relay = proposeCounts(RELAY_BUDGET_MiB, probe.max);
const browserProxy = proposeCounts(BROWSER_BUDGET_MiB, probe.max);
const relayConfirm = measure(relay.tombN, relay.candN, TRIALS);
console.log(`   relay proposed (tomb ${relay.tombN} + cand ${relay.candN}): confirm total ${MiB(relayConfirm.max * (relay.tombN + relay.candN))} MiB worst-case = ${(relayConfirm.max * (relay.tombN + relay.candN) / (RELAY_BUDGET_MiB * 1048576) * 100).toFixed(0)}% of ${RELAY_BUDGET_MiB} MiB`);
console.log('');

console.log('3. Proposed defaults (relay measured on THIS host only; Linux/Windows + real browser required before normative)');
console.log(`   TOMBSTONE_RECORD_MAX=${RECORD_MAX}`);
console.log(`   relay:   TOMBSTONE_MAX_COUNT=${relay.tombN} sublimit=${relay.tombN / SUBLIMIT_FRACTION}  CAND_MAX=${relay.candN} sublimit=${relay.candN / SUBLIMIT_FRACTION}`);
console.log(`   browser: TOMBSTONE_MAX_COUNT=${browserProxy.tombN} CAND_MAX=${browserProxy.candN}  (NON-NORMATIVE, DISABLED — pane pins performance.memory; real-browser run required)`);
console.log('');
console.log(`RESULT: ${PASS} behavioral checks passed, ${FAIL} failed.`);
process.exit(FAIL ? 1 : 0);
