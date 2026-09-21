# Moving a protocol version through the whole system — every surface, every action, in order

**Written:** 2026-09-20 from the 4.86.0 promotion. **Revised:** 2026-09-21 from the 4.88.0
promotion, after David: "We need a standard process for updating the full system like this
so that you don't skip critical infrastructure and applications." Companion to
`RELEASE-SURFACES.md` (what carries a version) and `ops/release.sh` / `ops/fleet.sh` /
`ops/droplet-roll.sh` (the tools). This file is the order and the inventory.

What has to be true, and in what order, before every node, app, seat, simulator and
document that names a kernel names the new one? That question is the whole procedure.
Each step is a precondition for the next, and the tools refuse when a precondition is
unmet. Do not work around a refusal; it is the procedure telling you which step you
skipped.

CAVEAT: nothing here is a substitute for David's word. Every step marked **GATE** is his
to say. The tools do not know that; the operator does. "Move everything to X" is one word
for all of §3–§9; anything that changes a bridge's REGION, a DNS record or a certificate
is not a version promotion and needs its own word.

---

## 0. The inventory — nothing is skipped because everything is listed

Run `ops/release.sh check <ver>` first (read-only). Then walk THIS table top to bottom.
A row is done when its "proof" column can be read back at the new version. If a surface
exists that is not in this table, add the row before touching it.

| # | surface | how it gets the kernel | what moves it | proof |
|---|---|---|---|---|
| 1 | `axona-protocol` (the kernel) | is the kernel | version bump + cache-busts + manifests + tag; push `testnet` and `main` | tag on origin; `main` = `testnet` |
| 2 | `axona-relay` | `vendor/axona-protocol/` via `npm run sync:protocol` | relay version bump; push `testnet` AND `main` | vendored tree diff-identical to the tag; both branches at the commit |
| 3 | `axona-bridge` | `package.json` pin `github:…#vX` | `npm install github:…#vX` (the explicit spec, never plain `npm install`); bridge version bump; push `testnet` AND `main` | `check_kernel_pin` declared = locked = installed |
| 4 | testnet bridge B1 (droplet 161.35.234.165, systemd, branch `testnet`) | its checkout's `node_modules` | as user `axona`: fetch + reset to `origin/testnet`, `npm ci --omit=dev`, `systemctl restart axona-bridge` | local `/healthz` version + kernelVersion; `axona-ready` row |
| 5 | testnet bridge B2 (M1, launchd `net.axona.testnet-bridge-b2`, branch `testnet`) | its checkout's `node_modules` | `PATH=/opt/homebrew/bin`: fetch + reset, `npm install --omit=dev`, `launchctl kickstart -k` | `/healthz` on 127.0.0.1:8090 with the on-host token |
| 6 | production bridge east (`bridge.axona.net`, Docker, `main`) | image built from the checkout | `ops/release.sh bridges <ver>` (east first, verified on the PUBLIC endpoint, then west) | public `/healthz` |
| 7 | production bridge west (`bridge-west.axona.net`, Docker, `main`) | same | same tool, second leg | public `/healthz` |
| 8 | relay fleets: Air, M1, Linux, Windows | each host's checkout, pulled by the tool | `DRY=1 KERNEL=<ver> ops/fleet.sh roll` (pulls, starts nothing) then `KERNEL=<ver> ops/fleet.sh roll <host>…` | `ops/fleet.sh status`: live = target, banners on the version |
| 9 | relay droplets (3, systemd units named by region) | `/opt/axona-relay`, branch `main` | per droplet, TWO passes: `ONLY=<ip> EXPECT_PER_DROPLET=<measured> EXPECT_KERNEL=<current> DRY=1 ops/droplet-roll.sh` (the pull) then `… EXPECT_KERNEL=<ver> ops/droplet-roll.sh` | unit start time later than the vendored file's mtime, and the banner when the journal is short enough to read |
| 10 | `axona-chat` (axona.chat, Pages from `main`) | pin | `ops/release.sh apps <ver>` (refuses unless the bridge serves it); version bump; `vite build` (prebuild = pin check); bundle greps for the new version and NOT the old; push `main` | served `index-*.js` hash equals the local build |
| 11 | `axona-share` (github.io AND demo.axona.net, Pages from `main`) | pin + `npm run link-kernel` symlink | same tool; version bump; five `?v=` tags in `index.html`; module tags + `APP_VERSION` in `app.js`; `check_kernel_pin.mjs`; push `main` | served `app.js?v=` and `APP_VERSION` on BOTH hosts |
| 12 | demo.axona.net (`apps/`, `examples/` from the kernel's `main`) | the kernel repo itself | nothing beyond §1's push to `main` | served `?v=` tags |
| 13 | `axona-portal` (Electron, no deploy surface) | pin | `npm install github:…#vX --save`; version bump; `npm test`; push `main` | pin + tests |
| 14 | `dht-sim` graphical (Pages from `main`) | `vendor/axona-protocol/` via `scripts/sync-vendor-kernel.sh` (three gates) | sync; bump the legend version in `index.html`; push `testnet` AND `main` | served legend version; vendored `KERNEL_VERSION` |
| 15 | `dht-sim` Node harness | `file:../axona-protocol` symlink | nothing — it runs whatever the sibling checkout is on; say which commit that is | `node_modules/@axona/protocol` → the checkout at the tag |
| 16 | `axona-stress` harness | imports `../axona-relay/vendor/…` | nothing beyond §2 | the relay checkout at the commit |
| 17 | `alert-bot` (Howard's suite) | Howard's `civildefense.io` pin resolves it | `npm install --no-save github:…#vX` before a run; Howard's `package.json` untouched; say so in the run's conditions | installed version in the run header |
| 18 | MCP servers: Aster, Orion, Vega, axona.bot | `axona-relay/src/mcp.js` loads the checkout's `vendor/` at process start | each seat's owner reloads their host app (Cursor, codex, Antigravity, the Claude app); never kill another seat's process | the front-door bridge's `/diag` `peerVersion` per seat |
| 19 | `civildefense.io` (Howard) | his semver pin | his; tell him | his |
| 20 | `axona-web` (axona.net) | none — links only | nothing; check its doc links are not to a version that no longer exists | — |
| 21 | `axona-peer` | FROZEN at 4.38.0 | NEVER | — |
| 22 | `axona-relay-canary` | vendored, stale, not deployed anywhere known | nothing until it is deployed; listed so it is not forgotten | — |
| 23 | `axona-protocol/README.md` install pin | text | edit; push `main` | the line |
| 24 | `axona-bridge/README.md` headline, `/healthz` sample, env table | text | edit; push `main` and `testnet` | the lines |
| 25 | `axona-docs/RELEASE-NOTES.md` | text | an entry in the house voice; push `main` (docs are main-only) | the entry |
| 26 | `axona-docs/RELEASE-SURFACES.md` | text | update if a surface was added or moved | — |
| 27 | `ops/STATE.md`, council, memory | record | every step with the clock read, the command and the tool's verdict | — |

Not a version promotion, and NOT covered by "move everything": a bridge's `BRIDGE_REGION`,
any DNS record or TTL, any certificate, `BRIDGE_NEVER_ROOT`, the `useast` directory copy.
Each is its own design and its own word.

## 1. Kernel — `axona-protocol`   **GATE: the version**

- [ ] Bump `package.json`, `src/transport/handshake.js KERNEL_VERSION` (the string relays
      print and clients send), and the cache-bust tags: `node scripts/sync-cachebust.mjs`.
- [ ] Regenerate the registration manifests if `dht/AxonaPeer.js` changed. Read the diff:
      line shifts only, or say what registration site changed.
- [ ] `npm test` green in full. A suite that fails in the full run and passes alone is
      recorded as **cause unconfirmed** with the logs kept.
- [ ] Commit with the version first in the subject. `ops/release.sh tag <ver>`.
- [ ] Push `testnet` AND `main`, and keep them level: a promotion that leaves `main` ahead
      of `testnet` inverts the staging line, and the testnet bridges then run older code
      than production. If the change came in on a feature branch, push
      `<branch>:main` and `<branch>:testnet` explicitly — a `git push origin main` from a
      checkout on the feature branch pushes the OLD local `main` and reports
      "Everything up-to-date" (2026-09-21, twice).

## 2. Relay — `axona-relay`   **GATE: the roll**

- [ ] `npm run sync:protocol` from `../axona-protocol` AT THE TAG'S COMMIT (check
      `git -C ../axona-protocol rev-parse HEAD` against the tag). The relay tests are the gate.
      Confirm `diff -rq vendor/axona-protocol/src ../axona-protocol/src` is empty.
- [ ] Bump the relay version; confirm it is in no branch and on no host
      (`git log --all | grep`, `ops/fleet.sh status`).
- [ ] Commit ONLY the vendored files and `package.json` — not whatever else is dirty in the
      tree. Push `testnet` AND `main`.

## 3. Bridge — `axona-bridge`   **GATE: the pin**

- [ ] `npm install github:axona-net/axona-protocol#v<ver>` — the explicit spec. Editing
      `package.json` and running plain `npm install` reinstalls the OLD version from the
      lockfile and says nothing (2026-09-19, 2026-09-21). `check_kernel_pin` must read
      declared = locked = installed.
- [ ] Bump the bridge version. `npm test`.
- [ ] New env the change needs goes into EVERY bridge's env before any restart: east
      `/opt/axona-bridge/.env`, west `/opt/axona-bridge-docker/.env`, B1
      `/etc/axona-bridge.env`, B2's launchd plist. A version-only promotion adds nothing.
- [ ] Push `testnet` AND `main`. Read `git log origin/main..` first and name what else rides.

## 4. Testnet bridges — B1 then B2   **GATE: testnet**

- [ ] B1: `sudo -H -u axona git fetch origin testnet && git reset --hard origin/testnet`,
      `sudo -H -u axona npm ci --omit=dev`, `systemctl restart axona-bridge`. If `npm ci`
      fails with EACCES on something under `node_modules/`, a root `npm` ran there once:
      `chown -R axona:axona /opt/axona-bridge /home/axona` and rerun (2026-06-10,
      2026-09-21). `npm ci` wipes `node_modules` first, so a failed one leaves the RUNNING
      process fine and the NEXT restart broken — fix before restarting.
- [ ] B2: over ssh the shell has no `node`; `export PATH=/opt/homebrew/bin:$PATH`. Fetch,
      reset, `npm install --omit=dev`, `launchctl kickstart -k gui/$(id -u)/net.axona.testnet-bridge-b2`.
- [ ] Both `/healthz` read the new bridge and kernel versions; both `axona-ready` rows read.

## 5. Production bridges   **GATE: production**

- [ ] `ops/release.sh bridges <ver>`: east first, verified on the public `/healthz` before
      west is touched. ~4 minutes. Each leg is a container recreate: every socket closes
      with 1001, clients reconnect by name within ~20 s, Caddy answers 502 for the seconds
      the container is down. A recreate under load took 76 s on 2026-09-21.
- [ ] Both bridges' full `/healthz` through their public names with the on-host token
      (never printed): version, kernelVersion, `admission`, `uplink` connected.

## 6. Production relays   **GATE: the roll**

- [ ] `DRY=1 KERNEL=<ver> ops/fleet.sh roll` — pulls every laptop/box checkout, verifies
      the vendored kernel, starts nothing. It refuses a droplet whose live count is not the
      table's target; that is expected when a droplet is short.
- [ ] `KERNEL=<ver> ops/fleet.sh roll air m1 axona-linux` (hosts in parallel, slots serial
      within a host, each replacement integrated before its predecessor leaves). Then
      `axona-win` on its own — it is slower and can abort on its advance gate with the heir
      in fact bonded; read `win-roll-logged.sh`'s log, never the ssh stdout.
- [ ] Droplets one at a time with the MEASURED count, two passes each (DRY on the current
      kernel performs the pull; live on the new one). Write the three invocations out in
      full: a `for spec in "ip n"; set -- $spec` loop under zsh does NOT split the string,
      and the tool aborts on a missing count (2026-09-21).
- [ ] `ops/fleet.sh status` afterwards; report live / target / on-version BY HOST. Where
      the tool reads "kernel unknown" (droplets), read the unit's start time against the
      vendored file's mtime and say the version is INFERRED, not seen.

## 7. Apps   **GATE: the pin, again**

- [ ] `ops/release.sh apps <ver>` — refuses unless the front-door bridge serves the version;
      re-pins `axona-chat` and `axona-share` and stops.
- [ ] `axona-share`: bump `package.json`; the five `?v=` tags in `index.html`; the module
      tags AND `APP_VERSION` in `app.js` (the `image.js?v=` tag is easy to miss);
      `npm run link-kernel`; `node check_kernel_pin.mjs`; commit; push `main`.
- [ ] `axona-chat`: bump; `npm run build` (prebuild is the pin check); grep the bundle for
      the new version and for the absence of the old; commit; push `main`.
- [ ] `axona-portal`: `npm install github:…#v<ver> --save`; bump; `npm test`; push `main`.
- [ ] Verify the SERVED page, not the workflow, and give Pages a few minutes:
      `axona.chat`'s `index-*.js` hash equals the local build; `axona-net.github.io/axona-share`
      AND `demo.axona.net/apps/axona-share/` read the new `app.js?v=` and `APP_VERSION`.
- [ ] An app pinned ABOVE its bridge connects and silently never completes (Safari,
      2026-09-08). Bridges precede apps, and the tool enforces it.

## 8. Simulators and harnesses

- [ ] `dht-sim` graphical: `KERNEL_SRC=../axona-protocol scripts/sync-vendor-kernel.sh`
      (its own three gates); bump the legend in `index.html`; commit `vendor/` + `index.html`;
      push `testnet` AND `main`. Pages serves `main`; on 2026-09-21 `main` was 83 commits
      behind `testnet`, so the served simulator jumped two kernel eras in one push — say so
      when it happens.
- [ ] `dht-sim` Node harness and `axona-stress`: nothing to change; record which checkout
      commit each resolves to.

## 9. The MCP servers, Howard's clients, and everything that pins by hand

- [ ] Every seat's `mcp.js` loads the relay checkout's `vendor/` at start. Each owner
      reloads their own host app; the Claude app restart is axona.bot's and is David's to
      trigger. Verify from outside: the front-door bridge's `/diag` lists every seat's
      `peerVersion`.
- [ ] `alert-bot`: `npm install --no-save github:…#v<ver>` before its next run.
- [ ] Tell Howard the version is on production; `civildefense.io`'s pin is his.
- [ ] `axona-peer` stays at 4.38.0. `axona-relay-canary` stays where it is until someone
      deploys it.

## 10. Documents that carry a version

- [ ] `axona-protocol/README.md` install pin (it read v4.48.0 until 2026-09-21).
- [ ] `axona-bridge/README.md` headline, `/healthz` and `listen` samples, env table.
- [ ] `axona-docs/RELEASE-NOTES.md`: an entry in the house voice, newest first.
- [ ] `RELEASE-SURFACES.md` if a surface was added; this file if a step was.

## 11. Prove it on production

- [ ] Howard's suite as written: `basic-mainnet-check`, then `basic-mainnet-diagnostics`,
      `killCache.txt` set aside, a conditions header (kernel on both sides, bridge incarnations,
      relay census BY EVIDENCE LEVEL, host load) and a 5 s load sidecar bounded by its own
      loop count. Numbers go to GH #26 only on David's word.
- [ ] Both bridges' `/healthz` and `ops/fleet.sh status` again an hour later.

## 12. Record

- [ ] `ops/STATE.md` — every step with `date -u` read at the time, the command, the tool's
      verdict. Never a guessed time.
- [ ] Council: what was done, by whose word, counts by unit and by host, with the limits.
- [ ] Memory: the deploy-state note, and the one thing about this promotion that was not
      obvious.

## Traps the tools do not absorb, each of which cost a wrong result once

- A commit made on a feature-branch checkout and pushed with `git push origin main` pushes
  nothing and says "Everything up-to-date". Push `<branch>:main`.
- Two shell calls issued in parallel share one working directory; the second may run in
  the first's repo. Use `git -C <repo>` and `npm --prefix <repo>` always.
- zsh does not word-split `$var`. Write loops out, or run them under `bash -c`.
- `npm install` after editing a pin obeys the lockfile. Use the explicit spec.
- A root-owned file under a checkout breaks the next `npm ci` as the service user.
- A timer that wakes an agent is not a stop. Anything that must end at a deadline on a host
  ends by a mechanism ON THAT HOST (a detached `sleep N; restore` or a systemd-run timer)
  armed in the same command as the change (2026-09-21: a 10-minute log window ran 8.5 h).
- Reading a fleet table's region column as the fleet's regions: the droplet units have
  their own (`grizzly1`, `useast`, `uswest`).
- "kernel unknown" on a droplet is not "old"; it is a journal too long to grep. Infer from
  unit start time versus vendored mtime and say INFERRED.

## What this procedure does not cover

Growing or shrinking a fleet. Anything that changes a bridge's region, a DNS record or a
certificate. The kernel's own release notes. And the decision itself: which version goes
where, and when, is David's, every time.
