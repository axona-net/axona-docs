# Testnet Test Protocol

**File:** `axona-docs/TESTNET-PROTOCOL.md`
**Kernel version on testnet:** 4.61.0 (re-version this header whenever the
deployed testnet kernel changes — held or undeployed releases do not count)
**Standing decision (David, 2026-08-07):** the M1 relay fleet is the designated
test fleet for testnet verification.

---

## 0. The question this document answers

What must a change survive on testnet before anyone proposes it for
production? Until 2026-08-07 the answer lived in practice and scattered notes.
This page is the single answer. It is a protocol, not a suggestion: a step
skipped is reported as skipped, never silently waived.

What this protocol is not. It is not the production promotion runbook —
promotion is a separate decision with its own evidence, and David makes it. It
is not a substitute for the kernel's own test suite — testnet verifies live
behavior that hermetic tests cannot reach; it never excuses a red suite.

## 1. What testnet is — the inventory

Measured 2026-08-07. Re-verify before trusting; state drifts.

| Piece | Where | State |
|---|---|---|
| Bridge | droplet `161.35.234.165` (`testnet.axona.net`), `/opt/axona-bridge`, systemd `axona-bridge.service` | the only enabled service on the droplet; healthz reports `version` + `kernelVersion` |
| Demo apps | droplet `/var/www/axona-demo-testnet` (an `axona-protocol` testnet checkout) | serves the demo + example apps with `?v=` cache-bust markers |
| Peer app | droplet `/var/www/axona-peer-testnet` | FROZEN at v4.38.0 — never updated, never part of a deploy |
| Relay fleet | **the M1 Mac**, `axona-relay/` — there are NO droplet relays | started with `start-fleet.sh`, updated with `roll-fleet.sh`; slots run `src/index.js`, logs in `relay-logs/relay-<n>.log` |
| TURN | coturn behind the bridge stack | credentials minted by the bridge (2h TTL, in-band refresh since 4.60.x) |
| Directory | opted out | the testnet bridge never advertises (`BRIDGE_DIRECTORY=off`) — an independent island by design |

A dormant `/opt/axona-relay` checkout sits on the droplet (relay v0.100.0, no
systemd unit — residue of the 2026-08-03 acceptance-gate work). It runs
nothing. Delete it or promote it deliberately; do not mistake it for a fleet.

### The M1 fleet, precisely

- **Cold start:** `bash start-fleet.sh` — defaults `N=3`, `REGION=eagle`,
  `BRIDGE=wss://testnet.axona.net`; hosts keyspace 0x89 and runs the
  metric-publish loop. Override with env: `N=26 bash start-fleet.sh`.
  The launcher verifies its own artifact: node is resolved before any slot
  starts, and after a settle every slot must be alive AND have written this
  launch's startup banner, or the script exits 1. It also kills any prior
  fleet first, so it is a *cold start*, never an update.
- **Update of a running fleet:** `roll-fleet.sh` and nothing else. It requires
  `EXPECT=<n>`, measures the live fleet, and refuses on mismatch; it replaces
  slots start-then-stop so departing relays always have live heirs. The
  Ship-of-Theseus measurement behind this rule: staged replacement with live
  heirs lost 0 of 1,890 topics; stop-then-start is where the whole-topic loss
  lives. A free-hand restart once shrank a live fleet 26→3.
- **Liveness check:** `pgrep -f "src/index.js"` — count the slots. The mcp.js
  session peers also live under `axona-relay/` and match looser patterns; a
  wrong pattern has lied before. Say "measured N slots," never "looks up."

## 2. The five stages

A change moves through the stages in order. Later stages assume the earlier
ones passed on the exact refs being deployed.

### Stage 1 — Pre-deploy gates (local, all green before anything ships)

- **Kernel:** `npm test` — the manifest suite (137 tests at 4.61.0). The
  manifest guard fails the run if any test file on disk is unwired or any
  entry is missing. `sync-cachebust --check` must be green so app `?v=`
  markers match the kernel version.
- **Relay:** the re-vendor gate (56 checks — vendored tree complete and
  current) plus the relay suite.
- **Bridge:** full suite, ending in `check_kernel_pin` — declared = locked =
  **installed** kernel agree. Static fences are not sufficient where a runtime
  path exists; behavior gets a runtime integration test (the turn-refresh
  integration is the pattern).
- Known flakes are named in the test manifest with their issue numbers
  (#423 reconnect-under-parallel-load, #402 buildAxonTree). A flake firing is
  re-run in isolation and reported either way; it is never silently waived.

### Stage 2 — Deploy ritual (artifact-checked, every time)

1. Record the prior ref — this is the rollback target. Write it down before
   touching anything.
2. `git fetch && git reset --hard <sha>` on the droplet; clean
   `rm -rf node_modules && npm ci`.
3. **Guard before restart:** read the installed kernel version out of
   `node_modules` and compare to the intended version. On mismatch, abort with
   the old service still running. A failed install must never take the
   service down with it.
4. Restart; verify the service is active AND `/healthz` reports the expected
   `version` + `kernelVersion`.
5. Pull the demo checkout; verify `KERNEL_VERSION` and the `?v=` markers.

Verify the artifact, never the command's own report — `cmd | tail` discards
the exit code, and that exact pattern has hidden a failed `git pull` and a
failed `npm install` in a single day.

### Stage 3 — Canary window

Fifteen minutes against **named, per-change criteria**, written down before
the deploy, with the rollback ref recorded. Rollback is one pass of Stage 2 at
the prior ref. Examples of named criteria from real deploys: coturn "Cannot
find credentials" above 1% of allocations; admitted peers dropping while the
socket count holds; healthz version drift; a connect-failure spike from
clients that should mesh.

### Stage 4 — Fleet-based behavioral acceptance (the M1 fleet)

The bridge alone cannot exercise the mesh path. Stand the M1 fleet up (or
roll it to the new refs if it is already running), then drive live behavior:

- **Warm-topic delivery** — verify pub/sub against a standing topic
  (`axona:bridge-directory` on prod; the jokes topic or a dedicated warm topic
  on testnet). Cold topics read false zeros; never accept a cold-topic zero
  as evidence.
- **Howard's `axonSpec`** when the change touches pub/sub semantics.
- **Replay and read-path probes** — fresh-subscriber replay, `pull` read-back
  with the address verified (owner+write fold into the topicId; a read that
  reuses the publisher's descriptor confirms nothing).
- **Metrics observation** — `scripts/metrics-fleet-observe.mjs` against the
  fleet's metric topics.
- **Churn behavior where the change touches placement or repair** — kill and
  restart slots via `roll-fleet.sh` discipline and watch convergence, not
  just steady state.

Publish confirmations are read strictly: `confirmed:true` is the health
signal; a msgId with `confirmed:false` means the write did not reach a
durable root (issue #422 class) and is a failure to investigate, not a pass.

### Stage 5 — Soak (when the change warrants it)

Overnight soak via the soak-v3 harness. Two standing rules:

- **Scale:** a testnet soak needs a fleet of roughly 40+ nodes to mean
  anything; below that, soak against prod instead. Never add laptop relays to
  prod to make up numbers.
- **Statistics:** a single-seed percentage is noise. Report REPS ≥ 5 as
  mean ± sd, and write the machine's own load into the run record — the
  harness self-annotates for a reason.

## 3. Standing watches

- The hourly **#jokes chime**: a live publish whose `confirmed:true` doubles
  as a loss detector. A duplicate joke dedups by msgId and reads as a
  delivery failure, so every chime is a fresh message.
- The **monitoring loop** (~25 min): drains #axona.dev and #axona.chat,
  sweeps GitHub issues for new comments and unlabelled entries, checks joke
  freshness.
- **healthz** on every touch of the droplet.

## 4. Governance

The council reviews designs and evidence. **David decides every deployment.**
Testnet deploys ride the `testnet` branches; production promotion is a
separate, David-gated act and is out of scope for this page.

## 5. Known gaps (owned, not hidden)

- **No standing scheduled application-path test** (#419): Howard's A/B — host
  fleets plus cross-region publishes on both testnet and mainnet, in
  dedicated test regions, on a schedule, results to #axona.dev. Designed;
  awaiting David's call on regions and cadence. This is the largest single
  upgrade available to this protocol.
- **The droplet's dormant relay checkout** needs a decision: delete, or
  promote into a real second-region relay under systemd.
- **Fleet coverage between deploys is thin** — the M1 fleet is stood up for
  verification, not kept hot continuously; between runs, testnet is
  bridge-only.
- The refactor plan's **Phase 0 golden traces** will become the
  characterization baseline this protocol's differential checks compare
  against, once that phase lands.
