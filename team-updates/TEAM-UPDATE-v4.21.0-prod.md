# Team Update — The kernel refactor lands in production (kernel v4.21.0) — 2026-07-14

**Headline:** the three-phase kernel consolidation program (Phases 0–2 of the
Kernel Refactor Analysis) is complete, soaked, and promoted to production.
Live as **kernel 4.21.0 · bridge 2.73.0 · relay 0.50.0 · peer 3.50.0**.
This release changes **no behavior** — it changes how findable and fixable the
behavior is. Testnet and production are identical again.

---

## What shipped

A month of incident-driven patching had left the pub/sub kernel's core ideas
implemented five-to-seven overlapping times; three of the last four incidents
were old fixes interacting badly. The refactor program consolidated it,
verbatim and under test, in three releases:

1. **Phase 0 (4.19.6) — the contract.** `INVARIANTS.md`: nine invariants we
   paid for in incidents, each linked to its enforcing test. Constants audit
   (live / residue / dead) and removal of four dead code clusters from
   concluded experiments.
2. **Phase 1 (4.20.0) — the RootClaim state machine.** Every root-ness
   transition — previously flipped at ~41 call sites through 8 mechanisms —
   now flows through **one transition function** in `rootClaim.js`, with the
   guard rules in one decision table and a structured why-code on every
   transition. This is where the patch-interaction bug class dies. A follow-up
   (4.20.1, from an external review of the new document) added the
   dead-upstream pin sweep: a peer's death now immediately drops delivery
   pins naming it and resets the renewal clock, cutting worst-case stale
   routing after a silent peer death from ~60s to one renewal.
3. **Phase 2 (4.21.0) — the manager split.** `AxonaManager.js` (2,208 lines)
   split along its real seams into six modules behind an unchanged façade —
   constants / ids / topicStore / rootElection / repairPlane / wireHandlers.
   Largest file is now 700 lines. Public API, wire format, and behavior
   untouched.

New companion docs in `architecture/`: **Root-Management-v4.20.1** (the full
root lifecycle, written to be reconstructable by human or AI) and the rewritten
**Axona Architecture v4.21.0**.

## The gate: a 15-hour production-shaped soak

64 full cycles against testnet on 4.21.0 — eight scenarios including the new
**alertbot** scenario, a direct port of Howard's field workload (93 topics,
101 publishes with 12KB avatar payloads, publisher departs, fresh reader
recovers everything via `since:'all'`).

- **460/477 scenario runs ok (96%)**; backlog and gap recovery 100% across
  all 64 cycles; zero killed-message body leaks in 62 kill runs.
- **alertbot: 42/42**, mean 99.9% recovery, median `leave()` 9ms — the
  departure-side loss class fixed in 4.19.5 stayed fixed under the refactor.
- Ten of the seventeen failures fell in one bounded window correlated with
  load on the harness machine itself (confirmed by droplet-side health) and
  self-resolved; they are measurement artifacts.
- The remaining five are all one signature: the known **fresh-subscriber
  cold-attach residual** — a brand-new `since:'all'` subscriber attaching
  right after a root transition recovers only the post-transition half
  (restart timeline exactly 6/12, every time). ~1 in 15 root-transition
  attaches. **No new failure class appeared all night.**

## Post-deploy acceptance (production)

Staggered bridge deploy (east → west), 9-relay backbone restarted on the new
kernel, collectors reconnected. Settled-mesh acceptance on prod:
**100% initial / 100% healed delivery (12/12 subscribers per message,
ordering intact)** — identical to the 4.19.5 promotion baseline.

## What's next

The cold-attach residual is now the *only* failure class the network exhibits,
and the refactor was partly for this moment: the fix (converge-then-replay —
a freshly-transitioned root reconciles with its K-closest cohort before
answering a full-history replay) lands in one module instead of an eighth
patch site. It's the next kernel work item, with the soak's 60-run restart
baseline as its regression gate. In parallel, the soak harness gains resource
sampling so machine-load windows annotate themselves instead of costing an
investigation.

**For Howard:** prod now runs the same kernel as testnet, including the
alertbot-shaped scenario in the nightly rotation. Expect identical behavior on
either network; replay misses should be confined to the cold-attach residual
(fresh reader on a topic whose root just moved), which is the next fix.

— shipped 2026-07-14: kernel v4.21.0, bridge v2.73.0, relay v0.50.0, peer
v3.50.0; production (east + west bridges, 9-relay backbone).
