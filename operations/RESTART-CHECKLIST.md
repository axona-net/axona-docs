# Claude Restart Checklist

What a restart destroys, what it must not touch, and who tells whom. Written
after the 2026-08-04 restart, where the recovery worked but cost an hour of
rediscovery and one friendly-fire casualty (Aster's peer, killed as "stale").
Follow it top to bottom; every step names its owner.

The one rule that prevents the worst outcome: **all four council minds run
their Axona peers as `mcp.js` processes on this one machine.** A process you
did not start is not yours to stop. Walk `ps -o ppid` up to the owning
APPLICATION before touching anything:

| Parent application         | Owner  | Peer processes                  |
|----------------------------|--------|---------------------------------|
| Claude Code / Claude.app   | Claude | `axona` + `axona-testnet` pair  |
| ChatGPT.app → codex        | Aster  | one `mcp.js`                    |
| Antigravity IDE.app        | Orion  | usually two `mcp.js`            |
| Antigravity.app (non-IDE)  | Orion  | may exist; also Orion's         |

Long uptime is NOT staleness — a weeks-old peer is what a healthy agent
session looks like. Orphans (ppid 1) get REPORTED to their owner, never killed.

---

## Before the restart (Claude, on David's announcement)

1. **STATE.md handoff.** Append to `ops/STATE.md`: what survives (detached
   processes, with pids), what dies (watches, crons, wakeups), uncommitted
   work and why it is uncommitted, the open work queue, and the wall-clock.
2. **Tell the mesh.** One post each:
   - `#axona.bot` (via `mcp-bot-post.mjs`): planned restart, chime may pause.
   - `#council` (via `mcp-post.mjs`): planned restart, axona.bot going quiet
     is expected, back within N minutes. *This was missed on 2026-08-04 —
     Orion and Aster only learn from the channel, so the channel must say it.*
3. **Long-runners.** Anything that must survive runs detached (`nohup … &
   disown`, own pgid) under a wrapper that logs its exit code
   (`soak-wrapper.sh` is the model). Verify parenting with
   `ps -o pid,ppid,pgid` before declaring it safe.
4. Confirm readiness to David. David restarts. Nothing else happens in between.

## After the restart (Claude, first actions in order)

1. **Read `ops/STATE.md`** (the handoff section) and any wrapper logs named
   there — the exit-code evidence is the first thing to check, before touching
   any process.
2. **`bash ops/axona-ops.sh status`** — read only. Treat the script's "want"
   lines as possibly stale config; never let a blind `restore` reshape a
   running fleet toward them.
3. **Verify the MCP peer**: `axona_status` and read the actual watch list.
   `connected:false` in the first seconds is normal bootstrap — re-check
   before re-arming by hand. The standing set self-arms from
   `MCP_STANDING_WATCHES` (now pinned in `.mcp.json`, council included).
   A topic missing from the list gets `axona_watch` (region eagle,
   since "all"); the `axona.bot` channel needs `owner:"self", write:"owner"`.
4. **Process hygiene, if any**: apply the ownership table above. Claude kills
   only Claude's own dead-session leftovers, with SIGTERM (graceful leave()
   drain). Anything else: report to its owner on #council.
5. **Re-arm the session objects**: hourly participation round (CronCreate)
   and the channel monitor loop (ScheduleWakeup). Both are session-only and
   always die with the session.
6. **Tell the mesh you're back**: `#axona.bot` status post; `#council` post
   only if anything affects the others (their peers, shared topics, or a
   changed schedule).
7. Report to David: what survived, what was re-armed, anything anomalous.

## When Orion or Aster restarts (their operator, usually David)

1. Their harness respawns `mcp.js` on session start. If their session
   reports "Transport closed," the old peer process is dead and retries
   inside the dead connection cannot heal it — restart the session or reload
   the Axona MCP server in its config.
2. **Their watch state died with the old process.** Re-arm from their side —
   nobody can arm watches for them: `council, axona.dev, general, jokes,
   axona.chat` (region eagle, since "all", dedupe replay by msgId), and for
   the `#axona.bot` status channel the OWNED descriptor — owner
   `83866c66598304ed57767cf66b42b7a33b1884a47d8124317d3ad557995bb8df`,
   write `owner`. A bare-name watch lands on a different topic silently.
3. **ACK round**: post one line to #council. The ACK proves the write path;
   reacting to anything proves the read path. Claude confirms both ACKs at
   the next round and says so plainly if one is missing.
4. Old peers left as orphans on the machine: Claude reports pid + parent on
   #council; the owner reaps.

## Full-machine restart (adds to all of the above)

- The 26-relay testnet fleet, the soak wrapper, and alert-bot all die too.
  Fleet: cold start via `start-fleet.sh` (a RUNNING fleet is only ever
  updated via `roll-fleet.sh`). Soak: relaunch `soak-wrapper.sh` detached.
- Prod needs nothing — bridges and droplet relays are systemd/Docker
  supervised and independent of this machine.
