# Moving a protocol version through the whole system — every surface, every action, in order

**Written:** 2026-09-20 from the 4.86.0 promotion. **Revised:** 2026-09-21 from the 4.88.0
promotion, after David: "We need a standard process for updating the full system like this
so that you don't skip critical infrastructure and applications." **Revised again:**
2026-10-02 from the 4.100.0 promotion, after David: "Errors in the process are not
acceptable when we have done this so many times." Companion to `RELEASE-SURFACES.md`
(what carries a version) and `ops/release.sh` / `ops/fleet.sh` / `ops/droplet-roll.sh`
(the tools). This file is the order and the inventory.

## Before anything — the three rules that 4.100.0 broke

The 4.100.0 promotion was the hundredth. It still went wrong in eight places, and not one
of them was new. Every failure below was either already written in this file and not read,
or written wrong in this file and not checked. So:

1. **Read this whole file before the first command.** Not the section you think you need.
   §6 said in September to read the Windows roll's log and never its ssh stdout. On
   2026-10-01 the ssh stdout was read anyway, for two and a half hours, while the roll sat
   dead with its abort message in the log.
2. **`ops/release.sh check <ver>` is the first command and the last.** It is a gate, not a
   display: it exits 1 and prints INCOMPLETE while any row it checks is behind. On
   2026-10-01 the relays and both bridges reached 4.100.0, the apps were left on 4.99.0,
   and the old `check` printed that mismatch while exiting 0. A promotion that stops
   two-thirds through looks finished from inside. That evening David's council posts from
   axona.chat did not arrive.
3. **A tool's flags are its own.** `DRY=1` is honoured by `fleet.sh` and `droplet-roll.sh`
   and was IGNORED by `release.sh`, which ran a real `npm install` under it. `release.sh`
   now refuses `DRY` outright; its read-only mode is `check`. Do not carry a flag from one
   tool to another on the assumption it means the same thing.

A promotion is done when §13 says it is done, and not before.

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
| 7 | production bridge west (`bridge-west.axona.net`, Docker, `main`) — host `206.189.174.110` (sfo2) since 2026-09-30, checkout `/opt/axona-bridge-docker` | same | same tool, second leg | public `/healthz` through the NAME, never through an ssh to a host |
| 8 | relay fleets: Air, M1, Linux, Windows | each host's checkout, pulled by the tool | `DRY=1 KERNEL=<ver> ops/fleet.sh roll` (pulls, starts nothing) then `KERNEL=<ver> ops/fleet.sh roll air m1 axona-linux`, then `KERNEL=<ver> ops/fleet.sh roll axona-win` ALONE (§6). Never `ops/fleet.sh roll` with no host list | `ops/fleet.sh status`: live = target EXACTLY, banners on the version. axona-win's row reads `scm: services_live=20/20 bare=0 kernels=[20x<ver>]`; anything else is a FAIL |
| 9 | relay droplets (FOUR since 2026-09-30, systemd units named by instance) | `/opt/axona-relay`, branch `main` | `ops/fleet.sh roll` drives `droplet-roll.sh` for all four, two passes each. Since 2026-10-02 `droplet-roll.sh` also REFUSES a droplet whose systemd does not resolve `SUB_TERMINAL_VERIFY=1` (`EXPECT_ARM=0` for a deliberate control arm) | unit start time later than the vendored file's mtime; or the variable read from `/proc/<pid>/environ` |
| 10 | `axona-chat` (axona.chat, Pages from `main`) | pin | `ops/release.sh apps <ver>` (refuses unless BOTH bridges serve it); version bump; `npm test`; `npm run build`; push `main` | served `index-*.js` FILENAME equals the local `dist/assets/index-*.js` — the hash is the proof, a version grep is weaker |
| 11a | `axona-share` STANDALONE (`axona-net.github.io/axona-share`, repo `axona-share`) | pin + `npm run link-kernel` symlink | same tool; §7's tag rule; `check_kernel_pin.mjs`; push `main` | served `index.html` reads five `?v=<ver>`; served `app.js` reads the new `APP_VERSION` |
| 11b | `axona-share` DEMO COPY (`demo.axona.net/apps/axona-share/`, a SEPARATE directory inside `axona-protocol`) | the kernel repo; its tags are written by `sync-cachebust.mjs` | nothing — its kernel follows §1 automatically, and NO step moves its app code | served tags read `<ver>`. On 2026-10-02 its `APP_VERSION` read **0.20.0** against the standalone's 0.33.0. Two codebases, one name. Whether to retire, sync or keep it is David's call and is still open |
| 12 | demo.axona.net (`apps/axona-minimal`, `apps/axona-share`, `apps/lib`; `examples/minimal-pubsub-browser`, `examples/s2-region-visualizer`, `examples/minimal-pubsub`) | the kernel repo itself | nothing beyond §1's push to `main` | served `?v=` tags. There is NO `apps/share` and NO `apps/pow-bench` — both 404, and the surface map listed both until 2026-10-02 |
| 13 | `axona-portal` (Electron, no deploy surface) | pin | `npm install github:…#vX --save`; version bump; `npm test`; push `main` | pin + tests. Read **v4.92.0** on 2026-10-02 — eight promotions skipped without anything saying so. `release.sh check` now gates it |
| 14 | `dht-sim` graphical (Pages from `main`) | `vendor/axona-protocol/` via `scripts/sync-vendor-kernel.sh` (three gates) | sync; bump the legend version in `index.html`; push `testnet` AND `main` | served legend version; vendored `KERNEL_VERSION` |
| 15 | `dht-sim` Node harness | `file:../axona-protocol` symlink | nothing — it runs whatever the sibling checkout is on; say which commit that is | `node_modules/@axona/protocol` → the checkout at the tag |
| 16 | `axona-stress` harness | imports `../axona-relay/vendor/…` | nothing beyond §2 | the relay checkout at the commit |
| 17 | `alert-bot` (Howard's suite) | Howard's `civildefense.io` pin resolves it | `npm install --no-save github:…#vX` before a run; Howard's `package.json` untouched; say so in the run's conditions | installed version in the run header |
| 18 | MCP servers: Aster, Orion, Vega, axona.bot | `axona-relay/src/mcp.js` loads the checkout's `vendor/` at process start | each seat's owner reloads their host app (Cursor, codex, Antigravity, the Claude app); never kill another seat's process | the front-door bridge's `/diag` `peerVersion` per seat |
| 19 | `civildefense.io` (Howard) | his semver pin | his; tell him | his |
| 19a | `axona.track` (Orion's mobile PWA mesh observer, `axona-net/axona-track`, Pages) | Orion's pin `github:…#vX` | Orion moves it; tell him | owner-reported: the served app's kernel version. Added 2026-10-05 when Orion reported v0.3.6 on 4.103.0 (`c48c62fe`); the gate does not check it |
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
      west is touched. ~4 minutes. Before either leg the tool asserts that each ssh target
      IS the address its public name resolves to, and refuses if not. That check exists
      because on 2026-10-02 the script still named the pre-migration west host,
      `24.199.98.119`, which is now a relay droplet that still carries a dead
      `/opt/axona-bridge-docker` with a compose file. The next run would have started a
      ghost bridge, Caddy and coturn beside three grizzly relays, verified THAT, and
      reported west done while the real west was never touched. Every bridge migration
      updates `WEST_HOST` / the `axona-bridge` ssh alias in the same change as the DNS. Each leg is a container recreate: every socket closes
      with 1001, clients reconnect by name within ~20 s, Caddy answers 502 for the seconds
      the container is down. A recreate under load took 76 s on 2026-09-21.
- [ ] Both bridges' full `/healthz` through their public names with the on-host token
      (never printed): version, kernelVersion, `admission`, `uplink` connected.

## 6. Production relays   **GATE: the roll**

- [ ] `DRY=1 KERNEL=<ver> ops/fleet.sh roll` — pulls every laptop/box checkout, verifies
      the vendored kernel, starts nothing. It refuses a droplet whose live count is not the
      table's target; that is expected when a droplet is short.
- [ ] **Count before you roll.** `ops/fleet.sh status` must read live = target on every host
      BEFORE the roll, not only after. A laptop or box roll is handed `N=$live` and NO path
      in the tool ever reduces a count, so a host one over target rolls to one over target
      and reads as success. axona-win's count is the manifest's `services.count`, not a
      census. Correcting a count is not a version promotion and needs David's word.
- [ ] `KERNEL=<ver> ops/fleet.sh roll air m1 axona-linux` (hosts in parallel, slots serial
      within a host, each replacement integrated before its predecessor leaves). NEVER
      `ops/fleet.sh roll` with no host list: that includes axona-win in the same parallel
      run, which is what happened on 2026-10-01.
- [ ] Then `KERNEL=<ver> ops/fleet.sh roll axona-win` on its own. Since 2026-10-02 every
      axona-win relay is a Windows service, `axona-relay-01` … `-20`, and the host's only
      controller is `axona-relay/windows/relayctl.ps1`. Its facts and layout are recorded in
      `axona-relay/hosts/axona-win.json`; read that file, never re-inventory the host.
      `fleet.sh` hands the roll to `relayctl roll -Kernel <ver>`, which pulls, checks the
      vendored kernel, load-tests node-datachannel, then restarts one service at a time and
      waits for that slot to bridge and bond before the next. It stops at the first slot
      that fails the gate and leaves every other slot running. Its transcript is on the host:
      ```bash
      ssh -n axona-win "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\david\github\axona-relay\windows\relayctl.ps1 status"
      ssh -n axona-win "dir /b /o-d C:\Users\david\github\axona-relay\relay-logs\relayctl-*.out"
      ```
      `RESULT=OK` on its last line is done; `RESULT=FAIL <reason>` names the slot. No pipes
      in a remote command: the ssh shell is cmd.exe. The services restart at boot and after
      a crash, so a Windows Update reboot no longer empties the host.
- [ ] Droplets one at a time with the MEASURED count, two passes each (DRY on the current
      kernel performs the pull; live on the new one). Write the three invocations out in
      full: a `for spec in "ip n"; set -- $spec` loop under zsh does NOT split the string,
      and the tool aborts on a missing count (2026-09-21).
- [ ] `ops/fleet.sh status` afterwards; report live / target / on-version BY HOST. Where
      the tool reads "kernel unknown" (droplets), read the unit's start time against the
      vendored file's mtime and say the version is INFERRED, not seen.

## 6a. The Windows fleet — restart, reboot, recover

axona-win is not restarted by hand and is not inventoried again. Its facts are in
`axona-relay/hosts/axona-win.json`. Its controller is `axona-relay/windows/relayctl.ps1`,
run on the host as
`powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\david\github\axona-relay\windows\relayctl.ps1 <command>`.
Every command except `status` writes `relay-logs\relayctl-<UTC>.out` on the host and ends
with `RESULT=OK` or `RESULT=FAIL <reason>`.

| Need | Do | Done when |
|---|---|---|
| New kernel or relay code | `KERNEL=<ver> ops/fleet.sh roll axona-win` (calls `relayctl roll`) | `RESULT=OK`; `status` reads `services_live=20/20 bare=0 kernels=[20x<ver>]` |
| Restart the fleet on the same code | `KERNEL=<current> ops/fleet.sh roll axona-win` | same |
| One relay misbehaving | `relayctl stop -Slot N` then `relayctl start -Slot N` | `start` prints a ready state line |
| Reboot the box | `ssh -n axona-win "shutdown /r /t 5"`, wait, then `relayctl status` | 20/20 within about 3 minutes of boot, with nobody logged in. Tested 2026-10-02: boot 20:19:49Z, 20/20 at 20:22:31Z |
| A relay crashes | nothing; the service restarts it after 10 s, 30 s, then 60 s | `status` 20/20 |
| Changed `windows/relaysvc.cs` | the roll builds `C:\axona\relaysvc-<hash>.exe`; each service takes it at its restart | — |
| Fewer or more relays | David's word, then change `services.count` in the manifest, `relayctl install`, start the new slots | — |

What it is, so a failure can be read:
- Each relay is service `axona-relay-NN`, run by `relaysvc.exe` as LocalSystem, delayed
  auto-start, environment from the manifest (region eagle, prod bridge, `SUB_TERMINAL_VERIFY=1`).
- `relaysvc.exe` holds the relay in a Job Object with kill-on-close. Killing the wrapper
  kills the relay (tested: dead within 2 s); killing the relay makes the wrapper exit
  non-zero, and the SCM restarts the service (tested: back within 18 s).
- `relayctl roll` pulls (discarding Windows npm lockfile drift), checks the vendored kernel,
  load-tests node-datachannel, then restarts one slot at a time behind the bridged-and-bonded
  gate (`-AdvanceCap`, 90 s) and the kernel banner. It stops at the first failed slot.
- Logs: `relay-logs\svc-NN.log`, the previous run kept as `svc-NN.log.1`.
- `windows-fleet.sh`, `windows-roll.sh`, `roll-fleet-windows.sh`, `win-*-logged.sh`,
  `stop-fleet.sh` and `add-relays.sh` REFUSE on this host. Do not work around the refusal.
- PowerShell 5.1 strips double quotes from a native command's arguments, and the ssh shell
  is cmd.exe. Ship a `.ps1` with scp; never inline quoted code.

## 7. Apps   **GATE: the pin, again**

- [ ] `ops/release.sh apps <ver>` — refuses unless the front-door bridge serves the version;
      re-pins `axona-chat` and `axona-share` and stops. It is NOT a dry run and has none.
      It writes `package.json` and `package-lock.json` in both repos the moment it runs.
- [ ] `axona-share`, the tag rule, which is mechanical so that nobody has to judge it:
      - `index.html`: the FIVE kernel tags (four importmap entries and `app.js`) → `?v=<ver>`.
      - `app.js`: `APP_VERSION` → the new app version, AND both module tags,
        `./axona.js?v=` and `./image.js?v=`, → the same new app version.
      - `axona.js`: `./region.js?v=0.16.0` stays. region.js last changed at 0.10.0.

      Move every tag the rule names, every release, whether or not you believe its file
      changed. A tag moved over unchanged bytes costs one extra fetch. A tag left behind
      over changed bytes keeps a returning browser on stale code, and `curl` cannot see
      it. The seven releases 0.26.0 to 0.32.0 all followed this rule. 0.33.0 broke it on a
      judgment that `axona.js` and `image.js` had not changed — true, harmless that
      once, and exactly the kind of call this rule exists to remove.

      Then `npm run link-kernel`; `npm run check:kernel-pin` must read
      declared = locked = installed; commit only the files the rule touched plus
      `package.json` and `package-lock.json`; push `main`.

      Grep `index.html`, `app.js` and `axona.js` with QUOTED globs:
      `grep -rnoE '[A-Za-z0-9_./-]+\?v=[0-9.]+' . --include='*.html' --include='*.js'
      --exclude-dir=node_modules`. zsh eats an unquoted `--include=*.js` and the grep
      silently searches nothing.
- [ ] `axona-chat`: bump; `npm test`; `npm run build` (prebuild is the pin check); the
      BUILT bundle must contain the new kernel and app versions and ZERO of the old ones;
      commit `package.json` and `package-lock.json` (dist is gitignored); push `main`.
- [ ] `axona-portal`: `npm install github:…#v<ver> --save`; bump; `npm test`; push `main`.
- [ ] Watch the Pages runs to `completed/success` with `gh run list --repo axona-net/<app>`.
      Then verify what is SERVED, with a cache-buster on every fetch: `axona.chat`'s
      `index-*.js` filename equals the local build's; `axona-net.github.io/axona-share`'s
      `index.html` reads five `?v=<ver>` and its `app.js` reads the new `APP_VERSION`.
      `demo.axona.net/apps/axona-share/` is row 11b — it will NOT read the new
      `APP_VERSION`, and that is not a failure of this step.
- [ ] Tell anyone with axona.chat open to CLOSE every tab and reopen. axona.chat is a PWA:
      its service worker can keep serving the previous bundle to a returning tab after
      the server has the new one, and a plain reload may not dislodge it. Verifying with
      `curl` proves the server. It proves nothing about a tab that was already open.
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
      A council post is recorded when a poll returns it, identified by its **msgId**. A
      seq is local to the observer: on 2026-10-02 one Aster message (`4d410f51`) reached
      axona.bot as seq 711 and Vega as seq 713, and two different messages reached
      axona.bot both stamped 712. Quote the seq for reading convenience, never as proof.
      Not when `publish` returns `ok:true` — that means dispatched (GH #66). And not by a watch's `total`,
      which is that peer's cumulative receive counter and not the topic's length (GH #74).
      On 2026-10-02 reading `total` instead of a seq produced a published false report of
      write loss.
- [ ] Memory: the deploy-state note, and the one thing about this promotion that was not
      obvious.

## 13. Done means

A promotion to `<ver>` is finished when all of these read back, and it is reported as
finished only then:

- `ops/release.sh check <ver>` exits 0 and prints COMPLETE.
- `ops/fleet.sh status`: every host at live = target exactly, every banner on `<ver>`.
  Droplets reading "kernel unknown" are reported INFERRED from start time against mtime.
- Every row of §0 has its proof column read back, and rows the tools do not check
  (MCP seats, Howard, 11b) are named in the report with what was and was not verified.
- §10's documents carry `<ver>`.
- §12 is written.

Anything short of that is reported as PARTIAL, with the rows still behind named. "Rolled"
is not "done", and "the tool said ✓" is not "verified".

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
- A refusal can be the tool's bug. `release.sh` refused 4.100.0's apps on 2026-10-02 with
  "tag v4.100.0 is not on origin" when it was. `ls-remote | grep -q` under
  `set -o pipefail`: `grep -q` exits on its first match, SIGPIPEs git, and the pipeline
  returns 141. Racy, so every earlier release passed. Fixed. The rule stands — do not work
  around a refusal — but read the refusal against the fact it names before obeying it.
- A host list goes stale the day a host moves. `release.sh` named a west bridge that had
  become a relay droplet; `check` showed an empty west line and nobody read it. Both
  bridges are now verified through their public names and deploys assert the target.
- The fleet moving is not the system moving. The relays and bridges reached 4.100.0 on
  2026-10-01 and the apps did not. Only `check`'s exit status catches that.
- A host's own `npm install` rewrites `package-lock.json`. The first release whose commits
  touched the lockfile (4.101.0, 2026-10-04) stopped every droplet's pull with "local
  diverged" when each was simply behind with a dirty lockfile. `droplet-roll.sh` and
  `relayctl.ps1` now discard that one file before pulling; anything else dirty still blocks.
- A gate row can pass on the wrong version. `check`'s cache-bust row printed the WANTED
  version whenever `sync-cachebust --check` passed, but `--check` compares the tags with the
  kernel's own `package.json`, not with `<ver>`. At the start of 4.102.0 it showed ✓ for a
  version nothing had been bumped to. It now prints the version the tags carry (2026-10-04).
- A long-lived ssh is not a status. The axona-win roll was dead for 2 h 28 m behind an open
  channel. Status is read from the host's log, by a second connection.
- An env var carried between tools is a guess. `DRY=1` meant nothing to `release.sh`.
- One app name, two codebases. "axona-share" is the standalone repo on github.io AND a
  separate copy in `axona-protocol/apps/` on demo.axona.net. A probe of the wrong path
  (`/apps/share/`, from the old surface map) returns 404 and looks like proof there is
  no second copy. There is.
- A curl check proves the server, never a returning browser. axona.chat is a PWA.
- A gate that cannot read a row must FAIL the row, never omit it. The first rewrite of
  `check` guarded its dht-sim row with `[ -f vendor/…/package.json ] &&`; dht-sim vendors
  `src/` only, so the row never printed and the gate reported COMPLETE while the served
  simulator ran 4.92.0. It now reads `KERNEL_VERSION` from the vendored `handshake.js`.
- Two council signers are both David: `c9b2bdfb` and `6c47f277` ("David on Air"). A
  witness's per-signer maximum for one says nothing about the other.

## What this procedure does not cover

Growing or shrinking a fleet. Anything that changes a bridge's region, a DNS record or a
certificate. The kernel's own release notes. And the decision itself: which version goes
where, and when, is David's, every time.
