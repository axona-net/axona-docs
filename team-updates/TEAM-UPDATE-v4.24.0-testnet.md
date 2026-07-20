# Team Update — Alert-bot miss fixes + region-model overhaul on testnet (kernel v4.24.0) — 2026-07-15

**Headline:** the dominant cause of the alert-bot read misses — a fresh reader
becoming an **empty root** while a live holder has the history — is fixed and
deployed across the whole testnet stack, together with the acknowledged
leave-handoff, the `leave()` drain stall-exit, and the new canonical region
model (ocean fold + neutral animal names). Live on testnet as **kernel 4.24.0 ·
bridge 2.76.0 · relay 0.52.0 · peer 3.52.0 (site v0.94.0)**. Production stays
on 4.22.1 pending the overnight soak verdict.

---

## What shipped

### 4.24.0 — empty self-root pull (the alert-bot miss fix)

Field diagnosis of the 4.22.1 alert-bot runs attributed **82% of unrecoverable
read misses** to one shape: a cold reader's subscribe terminates at itself, it
becomes the topic's root with an **empty cache**, and it then *serves* that
emptiness — while a node holding the full history sits one hop away. The miss
was sticky for the whole 600s read window. An independent oracle repro
confirmed a live holder existed in **40/40** captured misses.

The fix makes an empty root go **get** the history instead of waiting for it to
arrive: on becoming root with nothing cached, it probes its K-closest peers and
the lookup path with `PULLUP(sinceHw:0)`; any holder replies with its stamped
history and the root union-ingests it (signature re-verified, deduped,
tombstone-aware — same ingest path as 4.22's split-history union). The probe is
deliberately bounded: it fires 800ms after root formation (so a publisher-root
whose own publish fills the cache never probes), retries at 5s intervals at
most 3 times, fans out to at most 4 candidates, and quenches the moment the
cache is non-empty.

### 4.24.0 — acknowledged leave-handoff (last-copy protection)

The graceful-departure handoff was fire-and-forget: a leaver `_route`d its
topic caches at heirs and hoped. A failed heir resolution silently dropped the
last copy of a topic's history. Handoff now runs batch-phased — parallel heir
resolution, send rounds with a shared `HANDOFFACK` window (700ms × 2 tries),
and a `REPLICATE` cohort spray for anything still unacknowledged — so a
departing node never takes the only copy with it. Departure latency stays
bounded (~1.4s worst case for the ack rounds), not per-topic serialized.

### 4.23.2 — `leave()` drain stall-exit

The alert-bot's `leave()` was pinned at its full 5s timeout: a non-root,
non-subscribed publisher never observes its own publish confirmations, so its
pending set could never drain. The drain now exits once the pending set stops
shrinking for 1.5s — while genuine progress (a shrinking set) still holds the
full window. Field `leaveMs` should drop from ~5040ms to well under 2s.

### 4.23.0/4.23.1 — canonical region model (fold + animal names)

Two human-facing problems in the S2 region model, fixed at the mint points so
**nothing changes on the wire** (names never enter hashes):

- **The fold:** 108 ocean/sparse cells no longer act as their own regions —
  every one folds to its nearest populated major (84 majors remain). No more
  topics homed on an empty mid-Pacific cell.
- **The names:** all regions are now named for characteristic local animals
  (full, easy-to-spell names — `chinkara`, `eagle`, `bison`, `wolverine`…),
  eliminating the politically loaded country-fragment names (the NW-India/
  E-Pakistan cell is no longer called "pakistn"). Every legacy name still
  resolves as a hidden alias, so existing code and topics keep working.
- The updated **S2 region visualizer** (fold basins + full labels) is deployed
  on the demo site.

## The gate — and what it turned up

- **Full kernel suite:** 1251 passed / 0 failed. New smokes:
  `smoke_empty_root_pull` (11/11 — convergence, quench, bounded no-holder
  probing, pub-terminal skip) and the reworked `smoke_leave_handoff_burst`
  (12/12 — including a never-acking heir triggering exactly 2 retries + spray).
- **Howard axonSpec (live testnet): 11/11 in 7.5s** on a clean network.
- **A day of gate failures was itself a finding.** The live gate failed 12/12
  for hours — identically on v4.22.1 — and the cause is worth every operator
  knowing: ~5k topics minted by the day's diagnostic sweeps were being held by
  **two long-lived browser peer-app tabs**, which re-homed the entire set onto
  every freshly started peer. The bulk role ingest blocks the receiver's event
  loop → heartbeats missed → every mesh peer evicted → the mesh never re-forms.
  Closing the tabs cleared the network instantly (probe relay: roles=0). Filed
  as the next kernel work item (#332): chunked/yielding ingest, heartbeat
  priority under load, mesh re-bootstrap after mass eviction. **Operational
  rule until then: long-lived peers (including browser tabs) retain and
  re-seed every topic they've rooted — close them between test campaigns, and
  quiesce them before trusting any live gate.**

## Deployed on testnet

Droplet bridge 2.76.0 reports `kernelVersion: 4.24.0` at `/healthz`; the local
9-relay backbone runs relay 0.52.0 with a full mesh; testnet.axona.net serves
peer 3.52.0 (site v0.94.0); the demo apps (axona-minimal 0.21.0, axona-share
0.18.0) and the browser example are on 4.24.0. The overnight soak now runs
4.24.0 clients against the 4.24.0 fleet — it is the promotion gate for this
line.

**Also recovered in passing:** the standalone `github.io/axona-share` app was
still pinned to kernel **3.6.0** and had been silently partitioned off since
the 3→4 production cutover on the 13th. It's re-pinned to 4.24.0 (app 0.13.0)
and redeployed — wire-compatible with production's 4.22.1.

## What this means for the alert-bot

On 4.24.0 testnet, expect: read misses from the empty-root shape gone (the
root pulls history within ~1–6s of forming), `leave()` returning in well under
2s, and no silent history loss on graceful departure. The excess-results
question (kill effectiveness vs dedupe across reused topic keys) is orthogonal
and unchanged by this release — versioned topic keys per run remain the right
diagnostic there.

## Still open (non-gating)

- **#332 join-storm hardening** (bulk role ingest + mesh recovery) — next up.
- Overnight soak verdict → prod promotion decision for the 4.23.x/4.24.0 line
  (wire-compatible within 4.x; no flag day required).
- Docs re-version to 4.24.0 (architecture/API quartet) rides the promotion.

---

*Testnet: kernel 4.24.0 · bridge 2.76.0 · relay 0.52.0 · peer 3.52.0 · site
v0.94.0. Production: kernel 4.22.1 (unchanged).*
