# Moving a protocol version to production — every action, in order

**Written:** 2026-09-20, from the 4.86.0 promotion as it was actually done, plus the
steps it missed. Companion to `RELEASE-SURFACES.md` (which surfaces exist) and
`ops/release.sh` / `ops/fleet.sh` (the tools). This file is the order.

What has to be true, and in what order, before an app in a browser talks to a bridge
on a new kernel? That question is the whole procedure. Each step below is a
precondition for the next, and the tools refuse when a precondition is unmet. Do not
work around a refusal; it is the procedure telling you which step you skipped.

CAVEAT: nothing here is a substitute for David's word. Every step marked **GATE** is
his to say. The tools do not know that; the operator does.

---

## 0. Before anything moves

- [ ] The change is on `testnet` and has been exercised there with the instruments
      that found the defect. For 4.86.0 that was the placement cohorts, the
      ordering matrix and Howard's alert-bot suite (`ops/testnet-nonbridge-probe/`).
      A change that has only passed unit tests is not ready.
- [ ] The **testnet bridges** run the new kernel and any new env the change needs.
      Bridges are git checkouts on the SF droplet (systemd) and the M1 (launchd);
      `git pull` + `npm install` + restart, one at a time, B1 before B2.
- [ ] Testnet needs relays to test with. If the probe fleet was borrowed from a
      production host (the Air, 2026-09-19), it goes back to production at step 6
      and testnet has none afterwards. Decide where testnet's relays live *before*
      the promotion, or accept that testnet is bridges-only until they are restored.
- [ ] `ops/release.sh check <ver>` — read-only. It prints what is where.

## 1. Kernel — `axona-protocol`   **GATE: the version**

- [ ] Bump `package.json`, `src/transport/handshake.js KERNEL_VERSION` (that is the
      string relays print in their banner and clients send in `client-hello`; the
      vendored `package.json` is not), and the cache-bust tags:
      `node scripts/sync-cachebust.mjs`.
- [ ] Regenerate the registration manifests if `dht/AxonaPeer.js` changed:
      `node test/fence_e0_manifest.mjs --write`,
      `node test/gen_e2_coverage_manifest.mjs --write`. Read the diff: line shifts
      only, or you have changed a registration site and must say so.
- [ ] `npm test` 190/190. A suite that fails inside the full run and passes alone is
      recorded as **cause unconfirmed** with the revisions, commands and raw logs
      kept — not explained away.
- [ ] Commit with the version as the first word of the subject. `ops/release.sh tag
      <ver>` (it refuses if the cache-busts are behind). Push `testnet`.
- [ ] Push `testnet:main`. demo.axona.net serves `apps/` and `examples/` from
      `main`; until this push, demo runs the old kernel. Watch for a stray ref file
      (`.git/refs/remotes/origin/<branch> 2`, a Finder duplicate) — it blocks the
      push and is safe to delete.

## 2. Relay — `axona-relay`   **GATE: the roll**

- [ ] `npm run sync:protocol` from the sibling `../axona-protocol` (the relay tests
      are the gate). Commit the vendored files + a relay version bump. Check the
      version is not already in the wild: `0.128.0` was running on axona-linux while
      absent from every branch; `0.129.0` sat on an unpushed pilot branch.
- [ ] Push `testnet` **and** `testnet:main`. Laptops and boxes pull `testnet`
      (`fleet.sh`); the droplets pull `main` (`droplet-roll.sh`). Both, or half the
      fleet rolls to the old code and reports success.

## 3. Bridge — `axona-bridge`   **GATE: the pin**

- [ ] Re-pin: `npm install github:axona-net/axona-protocol#v<ver>` — the explicit
      spec. Editing `package.json` and running plain `npm install` did **not** refetch
      (2026-09-19). `node test/check_kernel_pin.mjs` must read
      *declared = locked = installed*.
- [ ] Bump the bridge version. `npm test` (the pin check is the last suite).
- [ ] New env the change needs goes into **every** bridge's `.env` before the
      rebuild: east `/opt/axona-bridge/.env`, west `/opt/axona-bridge-docker/.env`,
      testnet B1 `/etc/axona-bridge.env`, B2's launchd plist. For 4.86.0 that was
      `BRIDGE_NEVER_ROOT=0`; the fence stays on by default, and a bridge without the
      switch still drops every topic that lands on it. **The kernel alone does not fix
      it.**
- [ ] Commit, push `testnet` **and** `testnet:main`. `release.sh bridges` resets the
      production checkouts to `origin/main` and refuses if commits are missing there.
- [ ] Be aware of what else rides `main`: on 2026-09-19 production `main` was two
      versions behind `testnet`, so fail-closed federation and O1 logging shipped with
      the kernel pin. Read `git log origin/main..testnet` before pushing and say what
      is in it.

## 4. Production bridges   **GATE: production**

- [ ] `ops/release.sh bridges <ver>` — east first, verified on the public
      `/healthz` before west is touched; west is the surviving bootstrap. ~5 min.
- [ ] Afterwards, both bridges' full healthz through their public domain with the
      on-host token: `version`, `kernelVersion`, `admission.neverRoot`, `uplink`
      connected both ways. Never print the token.

## 5. Production relays   **GATE: the roll**

- [ ] `DRY=1 KERNEL=<ver> ops/fleet.sh roll` — prep and verify on every host,
      nothing started. It performs the pull.
- [ ] `KERNEL=<ver> ops/fleet.sh roll` for the laptop/box hosts. Droplets whose
      running count is below the host table's target make the tool refuse; roll them
      with `ops/droplet-roll.sh` one at a time with the **measured** count
      (`ONLY=<ip> EXPECT_PER_DROPLET=<measured>`), two passes (DRY on the current
      kernel performs the pull; then the roll). Do not grow a fleet in the middle of
      a kernel roll.
- [ ] The Windows leg can abort on its advance gate while the heir is in fact
      bonded (slot 19/20, 2026-09-19). The tool retires nothing further; the fleet
      is left one over and two behind. `windows-roll.sh` has no resume — a rerun
      replaces every slot. Decide, don't drift.
- [ ] `ops/fleet.sh status` afterwards. Report live / target / on-version **by
      host**, and the totals as a sum of those rows. Stale targets in memory produced
      "57 of 59" for a fleet of 47 live and 48 target.
- [ ] If a production host was lent to testnet, this roll is what returns it: the
      host table's region and bridge replace the borrowed relays slot by slot.

## 6. Apps   **GATE: the pin, again**

- [ ] `ops/release.sh apps <ver>` — refuses unless the east bridge already serves
      the version. It re-pins `axona-chat` and `axona-share` and stops.
- [ ] Per app, by the app's own last bump: bump the version; for `axona-share` also
      the five `?v=` cache-busts in `index.html` and the `?v=` / `APP_VERSION` strings
      in `app.js`, then `npm run link-kernel`; run its `check_kernel_pin.mjs`; for
      `axona-chat` build (`vite build`, the prebuild is the pin check) and grep the
      built bundle for the new version and for the old one — the old must be absent.
- [ ] Commit, push `main` (each deploys through its own Pages workflow). Verify the
      live page, not the workflow: the served bundle hash equals the local build
      (`axona.chat`), the served `app.js?v=` equals the new kernel
      (`axona-net.github.io/axona-share`, `demo.axona.net/apps/axona-share/`).
- [ ] An app pinned **above** its bridge connects and silently never completes
      (Safari, 2026-09-08). An app pinned below is admitted. That is why bridges
      precede apps and the tool enforces it.

## 7. The MCP servers — every council seat, and axona.bot

- [ ] Every Axona MCP server on the M4 is `axona-relay/src/mcp.js` and loads the
      kernel from that checkout's `vendor/` **at process start**. The `axona-mcp`
      repo is not what runs. Nothing in a running server changes until it restarts.
- [ ] After step 2, restart each server: the seats' host apps reload theirs
      (Cursor = Vega, codex = Aster, Antigravity = Orion), the Claude app restarts
      axona.bot's. Never kill another seat's `mcp.js`; name the parent app and ask.
- [ ] Verify from the outside: the east bridge's `/diag` lists every connection's
      `peerVersion`. On 2026-09-20 all four seats read 4.84.0 while 48 other clients
      read 4.86.0 — the seats had started before the checkout moved.
- [ ] `axona_status` does not report the kernel version. Until it does, `/diag` is
      the check.

## 8. Other clients that pin the kernel

- [ ] `alert-bot` resolves `@axona/protocol` through Howard's `civildefense.io`
      pin. For a run on the new kernel, `npm install --no-save
      github:axona-net/axona-protocol#v<ver>` in `alert-bot/` — Howard's
      `package.json` untouched — and say so in the run's conditions.
- [ ] `axona-peer` is frozen at 4.38.0. Never update it.
- [ ] `dht-sim` re-vendors when the simulator is next used; it does not gate the
      promotion.

## 9. Prove it on production

- [ ] Howard's suite as written: `npm run basic-mainnet-check`, then
      `basic-mainnet-diagnostics`, `killCache.txt` set aside, a conditions header and
      a 5 s load sidecar on the log. Numbers with their conditions go to the thread
      that asked for them (GH #26) — on David's word, it is a public write.
- [ ] Both bridges' `/healthz` again, and `fleet.sh status` again, an hour later.
      Restarts and gates fire late.

## 10. Record

- [ ] `ops/STATE.md` — every step with the clock read at the time (`date -u`), the
      command, the tool's own verdict. Two timestamps on 2026-09-20 were guesses and
      had to be corrected.
- [ ] Council: what was done, by whose word, counts by unit and by stage, with the
      limits. What the council corrected, corrected in the record the same hour.
- [ ] The docs surfaces in `RELEASE-SURFACES.md`: `axona-bridge/README.md`
      (headline, `/healthz` sample, env table — new env variables go here),
      `axona-protocol/README.md` install pin, `RELEASE-NOTES.md`. Team update in
      `axona-docs/team-updates/` for anything a person will ask about later.
- [ ] Memory: the deploy-state note carries the versions now on production and the
      one thing about the promotion that was not obvious.

## What this procedure does not cover

The hung `fleet.sh` parent after a Windows abort (the remote shell held by an heir's
pipe; harmless, kill only the named pids). Growing a fleet (`fleet.sh add`). The
kernel's own release notes. And the decision itself: which version goes to
production, and when, is David's, every time.
