# Team update — kernel 4.43.0 on prod

*2026-07-26. One version everywhere: kernel **4.43.0**, relay **0.84.0**, bridge
**2.95.0**, axona.chat **0.36.0**. `/healthz` tells the truth again.*

---

## Why this release existed

Prod and testnet had diverged, and the version numbers were actively misleading
about how. Testnet read **4.39.2** while prod read **4.41.0** — but testnet was a
strict git *descendant* of prod. The earlier rollback had been done as a **revert of
file contents**, not a branch rewind, so history kept moving forward while the
version string went backwards.

The trap: merging testnet into main would have been a clean fast-forward that
silently rolled prod's behaviour *back*, shipped as if it were an upgrade. 4.43.0 is
the reconciliation, assembled deliberately rather than by merge.

## What is in it

**Kept from testnet** — both new, both fenced:

- **The address rule.** Hosting is decided by a node's *address*, never by who owns
  or cares about the data. `host(topic)` refuses a topic the node is not near.
- **INVARIANT I-ID — transport identity is never persisted.** A node's nodeId and
  keypair are minted fresh every start and written nowhere. Author identity still
  persists, by design.

**Restored from prod**, because prod was running them and dropping them would have
been a silent regression:

- `metrics().publishes` — the real throughput counter. Shipping without it would
  have returned throughput metrics to reading 0, the exact failure we chased when
  metrics were dead across all of 4.x.
- `connect` exported from the package root.

**New in this release:**

- **The bridge directory is now an ordinary topic.** No `host()` exception, an
  hourly heartbeat per bridge, published into *every* region that already has a
  bridge, freshness as the liveness signal, and a durable bridge author key.
- **Region names are the animal names.** `useast → eagle`, `uswest → grizzly`,
  `uscentlw → bison`, across defaults, CLI help, error messages, share links, and
  the fleet scripts.

**Deliberately left out: everything in 4.42.0.** It never passed its gate (scale
delivery 97.7% mean / 79.2% floor, 5/17 scale and 3/15 churn scenarios failing) and
was deployed nowhere, so leaving it out cost nothing. It re-gates on its own against
this clean baseline, where a regression will actually be attributable.

## What I-ID actually fixed

Five places were persisting a transport identity, found in one sweep:

| where | what |
|---|---|
| kernel persistence | an `identity` namespace, so **any** app that wired `persist` silently kept one nodeId across every restart |
| kernel `snapshot()` | embedded the full keypair — **private key included** — and `fromSnapshot` restored it; snapshots exist to be stored, so this was a second complete path |
| MCP peer store | a durable `node` entry beside the author key |
| relay README + systemd example | documented a persisted keypair the code had not used in months |
| two prod bridges | stale world-readable key files on disk (May 27, Jun 14) |

All closed. The fences are behavioural (*restart against the same store ⇒ a
different nodeId*, with a positive control that author keys still persist) plus a
per-repo static scan that also reads config and comments — because the behavioural
tests could not see four of those five.

**The rationale, in one line:** a nodeId that survives restarts is a durable
correlator — it links a node's sessions, which exposes its IP, which locates a
person — and it buys nothing back, because the mesh has already healed around that
node's absence.

## Verified live on prod

- Both bridges `/healthz` → 2.95.0 / kernel 4.43.0.
- 9/9 relays active, vendored kernel read off each droplet (not off a manifest).
- **The directory fan-out works, on its first execution anywhere:** east published
  to `eagle` *and* `grizzly`; west published to `grizzly` *and* `eagle`. The region
  set was **derived**, not configured — each bridge knows its own region and infers
  the others from the entries already in its book.
- The durable bridge author key minted and signed its class attestation.
- Two MCP peer starts against one store: **different nodeIds, identical authorId**.

**Not yet observed**, by nature rather than omission: the first hourly heartbeat, and
a stopped bridge ageing out of the listing. Both are now a matter of waiting.

## Rules added

- **INVARIANT I-ID** in `architecture/INVARIANTS.md`, fenced both directions.
- **`BRIDGE_DIRECTORY=off` on every non-production bridge**, in the deploy guide as
  a rule rather than a setting. Every node *persists* the entries it hears, so one
  stray advertisement from a test bridge lands permanently in the bootstrap book of
  every client that heard it. There is no clean undo.

## Three process notes, each of which nearly shipped a wrong thing

1. **A lockfile is not evidence.** `package.json` said kernel 4.43.0 while npm's
   cached git ref meant the *installed* tree was 4.42.0 — the one version we
   deliberately excluded. Verify `KERNEL_VERSION` out of `node_modules`, always.
2. **BSD `sed` has no `\b`.** Two rename sweeps matched nothing and exited 0. Only
   the residual grep caught it. Check the residual, not the exit code.
3. **When a measurement says nothing happened, suspect the measurement.** I read
   "no directory log lines" as a possible failure; the real cause was a
   `docker logs --since` window that did not cover the restart. The code had
   published correctly all along.

## Open / next

- Demo apps (`demo.axona.net`, standalone axona-share) still need a cache-bust to
  pull 4.43.0; browsers hold the old bundle until then.
- Watch the first heartbeat, then confirm ageing-out.
- Re-gate 4.42.0 against 4.43.0.
- `#397` — root reconciliation reach is `rootReplicas` (2); any second root beyond
  that is permanent. Still open, unchanged by this release.
- The kernel's ~67 test fixtures still use legacy region names. They resolve
  identically, so it is cosmetic; not worth stirring inside a release.
- **axona-peer remains frozen** — no re-vendor, no bump, no pin change.
