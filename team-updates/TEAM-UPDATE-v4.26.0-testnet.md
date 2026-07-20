# Team Update — Refactor Phases 6+7 live, connect() field fix, and the join-storm finding (kernel v4.26.0) — 2026-07-17

**Headline:** two phases of the v0.2 kernel-refactor program are now live on
testnet — **Phase 6** (one retry mechanism instead of three, a per-role sync
ledger, and guards that keep the code pinned to the architecture doc) and
**Phase 7** (explicit role natures: every node now *knows and logs* whether it
is a root, a backup, or a plain subscriber for each topic). A field incident on
Jul 16 was resolved same-day (`ws://` access + a Node `connect()` crash), and
the first heavy soak of the new stack surfaced our next real target: the
**join-storm** failure (#332), now reproducible on demand. Live on testnet as
**kernel 4.26.0 · bridge 2.79.0 · relay 0.54.0 · peer 3.54.0 (site v0.97.0)**.
Production stays on 4.22.1 — promotion is on hold pending the #332 hardening.

---

## What shipped

### 4.25.0 — Phase 6: retry consolidation + sync ledger + coherence guards

The kernel had three overlapping early-resend mechanisms for a fresh publish
(cold burst, warm first-publish timer, pending retry); they are now **one
retry pump** with one quench rule — a publish's early re-sends stop the moment
the pending entry clears, whatever path delivered it. Every root role now
carries a small **sync ledger** (`sig`, `lastFullAt`) so cohort replication is
**delta-gated**: full pushes happen only when the cache signature actually
changed (or on a 60s anti-entropy backstop), with empty keepalives in between —
the same durability at a fraction of the standing traffic.

Phase 6 also added two **doc↔code coherence guards** to the test suite: an
emission-site lint (REPLICATE/HANDOFF/HANDOFFACK may only be emitted from
their documented sites) and a normative-constants smoke that pins every timing
constant to the architecture doc's §XI table — tune a constant without
re-versioning the doc and the suite fails. This is the direct answer to the
4.24.0 post-mortem, where a stale doc actively recommended removed behavior.

### 4.25.1 — connect() auto-polyfills WebRTC in Node (field fix)

`connect()` in a plain Node process crashed with an unhandled
`ReferenceError: RTCPeerConnection is not defined` *inside the message
handler* — experienced as an infinite hang at `transport.start()`. It now
loads `node-datachannel`'s polyfill up front when the globals are absent
(`??=` — an application that sets its own globals, as civildefense.io does, is
untouched), or fails immediately with instructions. The deeper lesson —
transport errors were being swallowed instead of surfacing — is filed as #339
and scheduled: `transport.start()` will reject loudly on terminal failures.

### 4.26.0 — Phase 7: explicit role natures (ROOT / BACKUP / CHILD + HOLDER)

A role's *nature* used to be an implication smeared across five fields; the
#333 collapse lived in exactly that gap (a backup whose principal was dead —
a state no code modeled). Now `roleNature()` derives the nature from ground
facts at read time (never a stored copy that can drift), entering/leaving the
BACKUP nature passes through two audited transitions with structured
`role-nature` logs, and `inspectRoles()` reports nature + holder — so "why
does this relay hold 8,000 roles?" is a glance, not an evening of log
archaeology. Making the transitions explicit immediately surfaced and fixed a
real leak: a **promoted backup kept its backup obligations forever** (state
toward a departed principal that nothing could ever clear).

The observability paid for itself within 12 hours: the overnight soak
diagnosis (below) read the new nature logs directly — ~17,000 transitions and
~1,500 stale-backup evictions on one relay in one night, numbers that were
simply invisible before.

## Gates (all green before deploy)

Full kernel suite **1637/0** (includes the new 15-check role-natures smoke and
the churn-amplification smoke), coherence guards 36/0, Howard's **axonSpec
11/11** both against the local kernel pre-deploy and against the live 4.26.0
network post-deploy. Architecture doc re-versioned to v4.26.0 (new §XI row for
the backup-eviction window), SECURITY-CHANGELOG updated.

## The Jul 16 field incident (resolved same-day)

Howard hit four distinct pre-existing faults the day 4.25.0 deployed — none
caused by the release, all now addressed or filed:

1. **`ws://` clients couldn't connect at all** — nginx's port-80 blanket
   HTTPS redirect broke WebSocket clients (they can't follow redirects).
   Fixed: port 80 now proxies WS upgrades straight to the bridge.
2. **`connect()` hang in Node** — the 4.25.1 fix above.
3. **Admit-then-kick race** — the bridge could admit a slow-hello client and
   kill it 5ms later with a stale timeout. Filed #338, fix queued.
4. **Swallowed transport errors** — Howard's (correct) suspicion; filed #339.

## The soak finding: join-storm (#332) is the real blocker

The first heavy soak of the new stack decayed from 100% to ~40% overnight. An
A/B the next morning **exonerated Phase 7** — a fresh all-4.25.0 fleet decayed
*faster* under the same conditions. The cause is environmental and now fully
characterized: ~400 durable topics planted in one region (0x80/grizzly — served
by the three uswest relays as their own keyspace) (by
alert-bot testing) concentrate ~1,000 roles on the three nearest relays, and a
(re)joining relay bulk-ingests that role mass at once, starving its event loop
until its mesh dissolves. Not a capacity problem — a few megabytes of data —
but **unpaced obligations**: join-time ingest violates invariant I-11 ("bulk
work never starves liveness"). Full analysis, hourly decay tables, and the
capacity-vs-obligations Q&A: `TEAM-UPDATE-soak-2026-07-17-v4.26.0.md`.

We now have a one-line reproduction (plant a few hundred durable topics in
one region; restart that region's relays) — the best position we've ever been
in on this bug class.

## Current state & what's next

| Line | Version | Status |
|---|---|---|
| testnet | kernel 4.26.0 (bridge 2.79.0 / relay 0.54.0 / peer 3.54.0) | live, healthy, soak paused |
| prod | kernel 4.22.1 | stable, untouched, unaffected |

- **Prod promotion: ON HOLD** — gated on #332, not on any 4.26.0 defect.
- **#332 join-storm hardening** — recommended next work, pulled ahead of
  Phase 8: paced/yielded role ingest, mesh-liveness priority, relay re-initiation
  after mass departure. Validated against the live repro.
- Then **Phase 8** (sync engine: six repair policies → one operation + a typed
  policy table) and the queued fixes: #338 (bridge race), #339 (fail-loud
  transport), #340 (dead-heir handoff delay), #341 (unhosted-region durability
  + kill replay — also feeds the Phase 8 design).
- **For Howard:** axonSpec is green on 4.26.0; alert-bot notes — 
  `p2pWebNetwork.js:119` uses `Uint8Array.toBase64` (Node 25+/browser only;
  crashes Node 24), and a `TimeoutNaNWarning` fires at startup. The region-0x80
  delivery drops your flood test catches are real and tracked (#341).

*2026-07-17. Kernel tag `v4.26.0` (`d36bf99`) on the `testnet` branch;
companion soak report: `TEAM-UPDATE-soak-2026-07-17-v4.26.0.md`.*
