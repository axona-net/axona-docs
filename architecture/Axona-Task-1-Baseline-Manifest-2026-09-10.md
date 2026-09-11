# Task 1 baseline manifest — provenance and limits

T1.1 under AX-T1-D1 §5 and AX-T1-D2-DISPATCH-01 · collected 2026-09-10 23:40:24–23:41:01 UTC · axona.bot

Status: **review-ready.** Reviewers: Orion (provenance, completeness), Vega
(independent second-host or client-path spot-check).

## 1. The question

What is running, where, and how do we know? Not what the checkout says, not
what the last deploy note claims – what each process loaded when it started,
and what each service says about itself over the wire. Those four things have
disagreed on this fleet before (a half-rolled Windows host read 4.78.0 from the
repo while 8 of 22 relays still ran the old kernel), so this manifest keeps them
apart and never lets one stand in for another.

## 2. What this is NOT

It is not a certification. A start banner proves what a process loaded at
start, not that the files under it are unchanged since. There is no in-process
attestation on any host. It is not a census schedule; Task 8a owns that. It is
not a delivery test of any kind. Nothing was built, launched, restarted or
deployed to fill a field. Where a field could not be read, the manifest says
`not_observable` or `missing` with the reason, and the number beside it is
absent, not zero.

## 3. Artifacts

| Path | What | sha256 |
|---|---|---|
| `axona-relay/harness/baseline/collect-manifest.mjs` | read-only collector, node, no dependencies | `b3ffcc5067691df0d813ec2d0f634d971dbd5c18096124fb9cde11675682c496` |
| `axona-relay/harness/baseline/collect-manifest.sh` | wrapper so the path named to council exists | `35b4926587dcd67a05d8602eac75d00ccac94111da1b553fc544802e070f0c13` |
| `axona-relay/harness/baseline/manifest/2026-09-10/baseline-manifest.json` | **the baseline**: components × identity, local MCP processes, fleet, unknowns, every command run; collected 23:40 UTC | `bd391770dcf6513deeeea32e87351935b2aa2987c212778f1f3d3f43e5fb799b` |
| `axona-relay/harness/baseline/manifest/2026-09-10/fleet-census.jsonl` | one line per host (7), per-process rows (49 relays) | `f5894a069a18a51a3e0bc7c8e4e5dcc9e937787f2430c30ac7fbe8e1675d8e9c` |
| `axona-relay/harness/baseline/manifest/2026-09-11/baseline-manifest.json` | second snapshot, 01:15 UTC, AFTER the soak pause and the nyc3 change; not the baseline | `45e2f363873f578ecf0a681df293df0a5d68106ad273aabfbc64c4aead0a93c3` |
| `axona-relay/harness/baseline/manifest/2026-09-11/fleet-census.jsonl` | same, 48 relay rows (nyc3 at two) | `c67a2a20878845c83d7a6762b51d2b0c4d7abe405fa0b7f5f09b77b3463d6561` |

The manifest directory is dated by collection time in UTC, so the baseline is
`2026-09-10`, not the `2026-09-11` I named on council.

CAVEAT — the hashes announced to council at 00:39 UTC (`9f6621a4`) were
`b4b84045…` for the collector and `0bd2a7e0…` for the baseline manifest. Both
repos are public. The first manifest carried three identifiers that appear
nowhere else in either repo: a host username, this Mac's hostname, and one
unredacted home path in a `diff` command line. David chose to redact before
committing. The collector now maps every home directory to `<home>`, the
workspace to `<ws>`, and reports its own hostname as a 12-hex sha256; the
remote repo paths in its host table are `~`-relative. The 23:40 baseline could
not be re-collected (the fleet had changed), so the same rule was applied to the
existing JSON post hoc: 7 fields changed — `collector.host` and
`localHost.hostname` replaced by their hashes, five command lines — and the
file records this under `redaction`. No measurement changed. The census file
was unaffected and keeps its hash.

## 4. How to reproduce

From the workspace root on David's Mac, with the existing ssh aliases (`air`,
`m1`, `axona-linux`, `axona-win`, `axona-bridge`) and the droplet key in place:

```bash
bash axona-relay/harness/baseline/collect-manifest.sh          # full, 37 s
bash axona-relay/harness/baseline/collect-manifest.sh --local  # no ssh/curl, 1 s
```

Every external command the script ran, with timestamp and working directory,
is in `collectionCommands` inside the JSON: 71 for the full run. Two `--local`
runs eleven minutes apart differed in one field, the `axona-docs` untracked
count 81→82, and the extra file was this note. A run from a different Mac needs
the same aliases; without them each fleet host reports `reachable:false` and
the local section still completes. That is the intended failure.

Three defects were found and fixed between the first full run and this one,
all in the collector, none in what was measured: the 1.27 MB chat bundle
exceeded node's 1 MiB `execFileSync` buffer, PowerShell's CRLF stopped the
process-row regex so only one of 21 Windows rows parsed, and the bundle size
was reported in characters. The first two are noted in the script beside the
fix.

The 01:15 UTC snapshot is what the redacted collector produced on its first
run, kept because it shows the fleet after two of David's decisions: nyc3 at
2/3 (`useast` on a fresh id, `uswest` stopped) and the soak paused. It is
evidence of the post-change state, not a second baseline.

## 5. Component identities

Kernel `adce81c` resolves. Full commit
`adce81c660fb00b5ba5a99967cef726f84694d83`, tag `v4.84.0`, branch `testnet`,
package `@axona/protocol@4.84.0`, `KERNEL_VERSION = '4.84.0'` in
`src/transport/handshake.js`, in step with origin, no tracked modifications,
one untracked file (`test/fence_shadowed_branch_continuity.mjs`). The kernel
package IS the SDK; there is no separate SDK artifact to identify.

Every consumer that bundles a kernel bundles this one:

| Consumer | Checkout | How it carries the kernel | Kernel found |
|---|---|---|---|
| relay 0.127.0 | `0959a66` testnet, clean | `vendor/axona-protocol/` | 4.84.0; `src/` differs from the kernel checkout in **0 files** |
| chat 0.61.0 | `d37b9a9` main, clean | `github:axona-net/axona-protocol#v4.84.0` → `node_modules` | 4.84.0 |
| bridge 2.124.0 | `1fee537` testnet, clean | same spec → `node_modules` | 4.84.0 |
| MCP | relay repo, `src/mcp.js` + `src/mcp-session.js` | relay's `vendor/` | see §6 |
| docs | `f238814` main, 3 tracked deletions (Orion's council split), 82 untracked | – | – |
| web 4.9.0 | `ef3d27f` main, **6 tracked files modified, 1 untracked** | none | – |

CAVEAT on `axona-mcp/`: the workspace holds an `axona-mcp` checkout at
`ae3180d` (July 29, `@axona/mcp@0.2.0`, no remote). It is not what runs. All
three servers in `.mcp.json` launch `axona-relay/src/mcp.js`. The stale
checkout is recorded so nobody inventories it as live.

Remote reports, read over the network at 23:40:59 UTC: both bridges answer
`/healthz` with `version 2.124.0, kernelVersion 4.84.0`. The deployed chat at
`axona.chat` serves `assets/index-CC3_Oufi.js`, 1,274,755 bytes, sha256
`cd91d6bd2d20223c62db2f6645e9d25cc44761841b5e900677a1fc7e70d2e487`. The
minified bundle contains the literal `4.84.0` twice, `0.61.0` twice and
`4.22.1` once. `KERNEL_VERSION` is exported as a getter in that bundle, so the
kernel is attributed by literal count, not by symbol – a weaker identification
than the others in this table.

Running bridge containers, `docker inspect`, read-only:

| Bridge | Checkout on host | Container started (UTC) | Image id |
|---|---|---|---|
| east `/opt/axona-bridge` | `1fee537`, 4 untracked (`.env.bak-*` ×2, `.npm/`, `bridges.json`) | 2026-09-10 21:33:35 | `47c4441b…` |
| west `/opt/axona-bridge-docker` | `1fee537`, 1 untracked | 2026-09-10 21:42:23 | `d6c366bc…` |

Both containers were recreated 21:33–21:42 UTC on 2026-09-10 when
`STRICT_MIN_KERNEL` was raised to 4.84.0 by hand. That `.env` is unversioned
on both hosts; the manifest records the fact and copies nothing from it.

## 6. MCP peers on David's Mac

Six `mcp.js` processes, each a full mesh node pinned to whatever
`vendor/axona-protocol` held when it started. The kernel column is INFERRED
from the relay's vendor-bump commit dates against each process start; the
JSON labels every one of them `inferred`, because nothing reads a version out
of a running MCP process.

| pid | Parent app | Started (UTC) | RSS | Kernel at start |
|---|---|---|---|---|
| 2874 | launchd (orphan, no live app) | 2026-09-05 15:30 | 205 MB | 4.75.2, inferred |
| 82057 | Cursor Helper: mcp-process | 2026-09-07 17:38 | 242 MB | 4.76.3, inferred |
| 49686 | codex | 2026-09-07 20:59 | 205 MB | 4.76.3, inferred |
| 27530 | claude | 2026-09-09 19:39 | 34 MB | 4.83.0, inferred |
| 27532 | claude | 2026-09-09 19:39 | 35 MB | 4.83.0, inferred |
| 51989 | claude | 2026-09-10 03:30 | 241 MB | 4.84.0, inferred |

The three pre-4.84 processes are the ones the bridge now refuses at
`STRICT_MIN_KERNEL=4.84.0`; the 34 MB pair never bonded. Which process is
Aster's live seat is not derivable from `ps`, and this manifest does not
guess. Terminating any of them is out of scope and needs the parent app named
first.

## 7. Fleet

Counts come from `relay-census.sh` on each host, the single count definition
that `fleet.sh status` and this collector both call. Start times are computed
from elapsed time against the collector's clock, because host clocks disagree:
M1 reports local time at UTC+8, Windows at Eastern, the droplets at UTC.
Sampled 23:40:36–23:40:54 UTC.

| Host | Observed / target | Checkout | Running kernel, by evidence | Load 1 min |
|---|---|---|---|---|
| air | 6 / 6 | `b77cbe5` | 6 × banner `kernel v4.84.0`, read from each process's open log fd | 3.36 |
| m1 | 8 / 8 | `b77cbe5` | 8 × banner 4.84.0, same method | 12.78 |
| axona-linux | 5 / 5 | `b77cbe5` | 5 × banner 4.84.0, same method | 0.86 |
| axona-win | **21 / 20** | `b77cbe5`, 4 dirty entries | 21 × `node.exe src/index.js` by command line; no banner readable from git-bash | not collected |
| 143.110.224.247 | 3 / 3 | `0959a66` | 3 × journal banner 4.84.0 since each unit's start | 6.58 on 1 core |
| 167.71.106.63 | 3 / 3 | `0959a66` | 3 × journal banner 4.84.0 | 3.63 |
| 159.203.46.28 | 3 / 3 | `0959a66` | 3 × journal banner 4.84.0 | 2.86 |

48 relays targeted, 49 observed, 28 with a kernel banner read from the
process's own output, 21 with a version attributed only by checkout and
command line. `b77cbe5` and `0959a66` are both relay 0.127.0; the droplets
carry one extra commit (`deploy/droplet/`) that changes no relay code.

FINDING, Windows count: 21 relays against a target of 20. Nineteen started
17:48:44–17:49:46 UTC in the cold-start generation `20260910-134844`; two more
started at 20:04:07 (pid 39796) and 20:10:28 (pid 33764, log
`win-slot16-20260910-161027.log`). Two single-slot starts six minutes apart,
and the relay they were meant to replace evidently never exited. Which of the
21 is the surplus is not established here. Recorded, not acted on.

FINDING, Windows tool: `relay-census.sh --kernels` on Windows is a proxy that
counts `relay-logs/roll-*.log` by generation; the current logs are named
`win-*.log`, so the proxy reported `20/21 started by generation
20260909-220315`, a generation from the previous day. The count is right, the
attribution is stale. Against the tool, not corrected under this task.

Droplet region: `useast`/`uswest` run `RELAY_REGION=eagle`, `grizzly1` runs
`grizzly`, read from `systemctl show -p Environment`; the drop-ins that set
this have been versioned at `axona-relay/deploy/droplet/` since `0959a66`.
The first droplet at load 6.58 on one core is the box that drowned on
2026-09-10; one sample is not a trend.

## 8. Unknowns

- Running-artifact identity beyond the start banner. Nothing on any host can
  say whether a process's files changed after it loaded them.
- Windows: no per-process kernel banner, no `SIGUSR1` health-dump path, and
  `tasklist` counts every `node.exe`. Command lines were read via CIM to
  confirm all 21 are `src/index.js`.
- Droplets: kernel read from journald bounded to each unit's
  `ActiveEnterTimestamp`; a rotated journal turns that into `not_observable`.
- MCP kernel-at-start is inferred from git dates, never read from the process.
- Storm-window comparability: no retained per-host time series before
  2026-09-09. Task 8a.
- Soak contamination: `axona-stress/soak-v3.sh` was running on axona-linux
  against prod throughout collection, spawning about 1.8 fresh full nodes a
  minute. The census counts relays only; those nodes are not in it.
- Bridge `.env` and droplet `region.conf` are host-local. Drop-ins are
  versioned; `.env` is not.

## 9. Proposed baseline disposition

Adopt `adce81c` / `v4.84.0` as the Task 1 reference kernel, relay `0959a66`
(0.127.0), bridge `1fee537` (2.124.0), chat `d37b9a9` (0.61.0). Every consumer
bundles that kernel with zero source drift, and every relay whose banner could
be read loaded it. The Windows surplus and the three pre-4.84 MCP processes are
ledger entries against the fleet, not against the baseline.
