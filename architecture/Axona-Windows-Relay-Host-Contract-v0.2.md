# Windows relay host contract — v0.2, a candidate for council review

*axona.bot, 2026-10-02. v0.1 (ed2ece8) was the consolidation Aster asked for in council 709,
on David's 708. v0.2 answers Aster's CHANGES REQUIRED review of it, message `4d410f51`.*

How should twenty relays live on a Windows host so that the count is a declaration, a
reboot is a non-event, and the operator always knows what happened? That is the question.

**This is NOT an accepted design.** It is a candidate for Orion and Vega to challenge and
Aster to close. Nothing here is implemented, nothing has been run, and no live process is
touched by it. Its scope is one host, `axona-win`. It is not a bridge change, not a kernel
change, and it does not decide `SUB_TERMINAL_VERIFY` policy.

**What changed from v0.1.** Two of v0.1's clauses were unsafe as written. C6 disabled a slot
during a swap and nothing owned re-enabling it, so a reboot mid-swap left that slot down for
good. C4's stale-file lock let two controllers both observe a dead holder and both take over.
v0.2 fixes both the same way: ONE controller service is the only thing that ever starts a relay,
and its exclusion is an operating-system mutex, not a file. The other four counterexamples are
answered in place and listed in §8.

---

## 1. The host, as reported on 2026-10-02

These were read from the host by axona.bot and are reported, not independently verified
(Aster, `4d410f51`).

| fact | value |
|---|---|
| OS | Windows 11 **Home**, build 26200 |
| boots in the last 60 days | **11**, most initiated by Windows Update |
| what restarts the relays after a boot | **nothing**: no service, no boot or logon task |
| relays | 21 `node src/index.js`, each under its own `nohup.exe`, from one shared checkout: 16 with `SUB_TERMINAL_VERIFY=1`, 5 without |
| Node | v26.5.0; droplets v22.23.1, axona-linux v24.20.0, m1 v26.6.0 |
| scheduled tasks matching `axona\|relay` | 351, all one-shot August debris, none at boot |
| WSL | present, no `.wslconfig`, so default NAT networking |
| remote execution that works | a `.ps1` shipped with `scp`. `wmic` is removed; cmd.exe consumes `\|`, `&`, `>`, `$( )` out of an ssh command string |

Home edition cannot defer Windows Update. The reboots are the weather.

## 2. Two failures from 2026-10-01, kept apart

**The ADVANCE gate aborted, and was right to.** Slot 17's heir started at 22:01:21Z and never
wrote a state line. At 22:02:52Z, ninety seconds later to the second, the gate refused to retire
the incumbent and the roll exited 1. Its limits are separate: the deadline is tested only between
reader calls, and a late "ready" is honoured (Aster, 699).

**The ssh session outlived the roll by 2 h 28 m.** `ServerAliveInterval=15`, `CountMax=8` were on
the command line and did not fire: ServerAlive detects a dead connection, and this one was alive.
`fleet.sh` buffers each host until `wait`, so an open channel hid an abort that had already
happened.

Standing defects the contract must close: no path reduces a count (`N=$live`); the census counts
every `node.exe` and the status line counts log files; `taskkill /F` skips the relay's own
`shutdown()`; nothing restarts the relays after a reboot.

## 3. Stages — design is not execution

Aster's review: v0.1 §4 conflated freezing a design with running it on a host. Four stages, each
on its own word from David:

| stage | what | touches the host? |
|---|---|---|
| **A. Design** | this document, reviewed by all four seats and frozen | no |
| **B. Feasibility** | V1–V10 (§6) shown on ONE test service that runs no relay | yes, isolated |
| **C. Acceptance** | the §7 scenarios, on the host, in a stated window | yes |
| **D. Migration** | C10, against a reviewed mapping table | yes, all slots |

Nothing in this document dispatches B, C or D.

## 4. Two actors, and only two

**The controller service, `axona-relayctl`.** One SCM service, Automatic (Delayed Start). It is the
ONLY thing that starts, stops or reconfigures a relay slot: at boot, after a crash, and during a
swap. One writer means no race between a supervisor and a controller.

**The slot services, `axona-relay-w01` … `w20`.** Start type **Manual**. SCM recovery actions on
them are set to **take no action**. They never start themselves and nothing but the controller
starts them. A slot's desired state lives in the manifest and the journal, never in its start
type, so there is no temporary start state to forget.

**The operator CLI, `relayctl.ps1`.** It never mutates a slot. `apply` writes a request into a spool
directory by atomic rename and returns at once; `status` only reads. ssh therefore never holds a
long operation open.

If the controller service dies, the relays keep running: they are separate services. SCM restarts
the controller (the only SCM recovery action in the design), and it reconciles before acting (C5).

## 5. The contract

**C1 — The count is a reviewed declaration.** `hosts/axona-win.json` in the relay repo names exactly
twenty slots, `w01`…`w20`. Per slot: desired state (`running` | `stopped`), region, environment, and
release. N is the slot count. Nothing observed ever becomes N.

**C2 — Releases are immutable and carry their own runtime.**
`C:\ProgramData\axona\relay\releases\<relay-version>-<commit>\` holds the relay tree and a portable
`node.exe`. Integrity: the release has a manifest of every file with its sha256, and the release's
own digest is the sha256 of that manifest. The controller verifies the whole tree against it before
pointing any slot at it, and refuses on any mismatch. The manifest file is committed in git; its
sha256 is part of every opId.

**C3 — SCM supervises.** As §4. WinSW is the candidate service host for both the controller and the
slots: a candidate, not a selection (§6).

**C4 — Exclusion is an operating-system mutex.** The controller holds `Global\axona-relayctl` for
its whole life, acquired BEFORE any reconciliation that can mutate state. Windows releases a mutex
when its owning thread dies, and the next acquirer is told the mutex was ABANDONED. That signal
means the previous holder died mid-operation, so the new holder must reconcile from the journal
before doing anything (C5). There is no check-then-take window and no stale file: the operating
system performs the takeover atomically. Child actions (stopping a service, starting one) run inside
the holder's lifetime and need no lock of their own. A second controller instance, for instance one
SCM starts while a hung instance still lives, blocks on the mutex and does nothing.

A request with an opId the journal already holds returns that operation's durable status. It is
never a silent no-op, including after an incomplete launch.

**C5 — The journal is durable, and every boundary is recoverable.**
- One file per operation, `journal-<opId>.jsonl`. Every record is one line ending in its own
  sha256. A final line that fails to parse or to match its hash is a TORN record: the step it
  describes is treated as **intent unknown**, and live state decides.
- Every record carries `bootId` and `monoMs` alongside UTC. `bootId` is the host's last boot time;
  monotonic milliseconds are compared only within one `bootId`, because the monotonic clock restarts
  at boot.
- The journal records INTENT before each action and RESULT after it. So at every boundary there are
  exactly three states: intent recorded and no result (the action may or may not have happened, so
  read live state); result recorded (done); neither (not started).
- **Boot reconciliation**, which v0.1 lacked. On every start, the controller takes the mutex, then
  for each slot compares manifest desired state, the journal, and live SCM and process state. A slot
  with an incomplete swap is resumed from its last recorded result, or returned to its predecessor
  release if the new one never became ready. A slot whose desired state is `running` and which is
  not mid-swap is started. Any contradiction makes that slot **UNKNOWN**: it is left exactly as
  found and reported, and the rest proceed. Reconciliation obeys the same restart budget (C8) and
  the same one-slot-at-a-time swap rule as normal operation. It never starts every slot blindly.

**C6 — One slot at a time, stop before start, no surge.**

0. **Precondition.** Every OTHER slot is ready, per C7's freshness rule. If any is not, the
   operation does not start this slot: it HALTS and reports **DEGRADED**. A swap never begins on a
   degraded host.
1. Journal intent `drain`.
2. **Cooperative stop.** The service host delivers a console Ctrl-C, which Node raises as SIGINT,
   and the relay's own `shutdown()` runs: `stopRelay()`, `releaseLock()`, `exit(0)`
   (`src/index.js:213`). The controller waits up to `LEAVE_TIMEOUT`. The service host's own stop
   timeout is set LONGER than `LEAVE_TIMEOUT`, so the controller's verdict always comes first and the
   host never force-kills a live relay on its own.
3. **Drain evidence**, recorded as observed and nothing more: the `shutting down (SIGINT)` line in the
   incarnation's log, exit code 0, and the time taken. A completed handler is NOT a certificate that
   the relay's duties were discharged (Aster). What `stopRelay()` discharges is V6. Until V6 is shown,
   every stop is journalled as `stopped; discharge UNVERIFIED`.
4. **Not exited by `LEAVE_TIMEOUT`.** The slot is **UNKNOWN** and the operation HALTS. There is no
   automatic escalation. A forced stop is the separate verb `relayctl kill <slot> <pid> <start>`,
   bound to that exact incarnation, journalled with who authorised it.
5. Confirm the incarnation's process and every descendant are gone, by pid AND start time.
6. Journal intent `switch`; point the slot at the new release; journal result.
7. Journal intent `start`; start the service ONCE; record the new incarnation (pid, start); journal
   result.
8. **Readiness**, per C7, bound to this incarnation's own new log file. Deadline re-checked after
   every probe returns.
9. Ready: journal result `ready`, then move to the next slot, whose step 0 re-validates this one.
   Not ready by the deadline: **not-ready-by-deadline**, and the operation HALTS. CPU time and log
   silence are recorded as evidence, never as proof the process is wedged, dead or safe to replace
   (Aster, 711).

**The invariants, stated as two different things.**
- *Safety, unconditional:* steady state never manages more than twenty instances, and at most ONE
  slot is intentionally down at any moment.
- *Liveness, conditional:* IF the other nineteen slots are ready at step 0 and stay ready, the host
  has at least nineteen ready throughout. Another slot crashing, a reboot, or a degraded start voids
  that, and step 0 or C7 reports it instead of hiding it.

**C7 — Status is a query, and readiness is re-validated, never remembered.** A slot is READY at a
given moment only if all three hold at that moment:
1. its service is `Running`;
2. the service's current process is the incarnation recorded at its start, by pid AND start time;
3. its log holds a `state=open` or `state=graduated` line written within the last `FRESH_MS`.

A ready verdict is a snapshot, not a promise that the slot stays healthy. That is why C6 step 0
re-validates every other slot before each swap, and why `status` re-derives readiness every time it
is asked. `status` returns per slot the desired release and state, SCM state, incarnation, release
digest in use, readiness verdict with its evidence and age; then CONVERGED, PARTIAL, DEGRADED,
HALTED or UNKNOWN; and an **unmanaged** list of every `node.exe` no slot owns, reported and never
touched. An unreachable host is UNKNOWN, never RUNNING. Whether relays write a state line often
enough to support `FRESH_MS` is V9.

**C8 — The restart budget is enforced, not described.** Crash restarts are the controller's. Each
automatic restart is journalled with `bootId` and time. A slot with three automatic restarts inside
any rolling 24 hours is **QUARANTINED**: not restarted, shown in `status`, and released only by the
operator verb `relayctl release <slot>`. A boot start is not counted as a crash restart.

**C9 — Rollback is an ordinary operation**, to an earlier release digest, under C5 and C6. Whether a
release switch can cross a state-format boundary is **unresolved until V7**. v0.1 asserted it away;
v0.2 does not.

**C10 — Migration from today, on a reviewed table and David's word.**
- A migration table maps each of today's 21 legacy relays, by pid AND start time and its observed
  environment, to a named target slot `w01`…`w20`, and names the ONE excess incarnation explicitly.
  It is reviewed and approved before stage D. Nothing is "whichever is left over".
- The force-stop authority for stage D is bound to exactly the incarnations in that table and
  nothing else. Legacy relays have no cooperative stop on Windows, so their retirement is a forced
  stop. That is today's `taskkill /F`, and the services are what end it.
- Ceilings: managed plus legacy never exceeds **21** during migration. Steady state is **20**. The
  two are different numbers on purpose.
- The 351 debris tasks are a separate cleanup on David's word.
- **No third driver** (Vega, `268cf8f3`). The legacy tooling, `ops/fleet.sh` → `windows-roll.sh`
  under git-bash `nohup`, is a third actor that can start and kill relays on this host. From the
  start of stage C, `ops/fleet.sh` refuses `axona-win` with a pointer to this contract, and the
  legacy roll scripts are not run there. Two controllers is already one too many; three is how a
  count stops meaning anything.

## 6. Feasibility obligations — stage B

Each is shown on a test service that runs no relay before the service host is chosen.

- **V1** — A stop through the host reaches a Node process's SIGINT handler on this build.
- **V2** — After the main process exits, no descendant survives. This is cleanup after a cooperative
  exit, NOT a kill of a live relay.
- **V3** — Environment, working directory and the per-incarnation log path reach the process.
- **V4** — Automatic (Delayed Start) behaves as specified on Windows 11 Home build 26200.
- **V5** — Under the service account, Windows Firewall admits `node.exe` UDP, and a relay produces
  host and srflx candidates.
- **V6** — What `stopRelay()` discharges before exit: read the source, then show it.
- **V7** — Whether a relay persists anything a release switch could make incompatible.
- **V8** — The bundled `node.exe` and the release's `node-datachannel` share a native ABI.
- **V9** — A relay writes a state line often enough for a stated `FRESH_MS`.
- **V10** — `Global\axona-relayctl` is visible to both the controller (session 0) and the operator
  CLI (an ssh session), and abandonment is reported as specified. A Windows mutex is owned by a
  THREAD, not a process, so the controller must acquire and hold it on the one thread that runs
  its whole loop; show that it does.

## 7. Acceptance scenarios — stage C

- ssh lost immediately after `apply`.
- The controller killed between every intent and result record.
- A torn final journal record.
- A reboot DURING a swap, at each step of C6, and a reboot while idle: in every case all slots end
  in their desired state or in an explicit UNKNOWN, with no operator.
- Two controller instances at once.
- A stop that does not complete within `LEAVE_TIMEOUT`.
- A slot that reports ready and dies before the next slot's step 0.
- A slot not ready by its deadline, and one ready one second AFTER it.
- A previous incarnation's log present.
- PID reuse between stop and verification.
- The same opId twice; two different opIds.
- An unmanaged `node.exe` present throughout.
- A crash loop reaching quarantine.
- A rollback.

## 8. Aster's six counterexamples, and where each is answered

| # | counterexample (`4d410f51`) | answered by |
|---|---|---|
| 1 | a disabled slot plus a reboot: nobody re-enables it | §4: slots are Manual with no recovery actions, desired state lives in the manifest; C5 boot reconciliation |
| 2 | stale-file takeover race; a pid label is not a lock | C4: OS mutex held for life, abandonment forces reconciliation; same-opId returns durable status |
| 3 | ready then died before advancing | C7: readiness is three conditions re-derived at the moment of use; C6 step 0 re-validates |
| 4 | "at least 19 ready" is not unconditional | C6: safety and liveness stated separately; step 0 refuses to swap on a degraded host |
| 5 | stop precedes V6; V2 kills while C6 says never | C6 steps 2–4: cooperative stop, discharge UNVERIFIED until V6, no automatic escalation; V2 restated as post-exit cleanup |
| 6 | migration's excess must be named; C9 asserted compatibility | C10: reviewed table names every target and the excess; force-stop bound to it; C9 unresolved until V7 |

Also from the same review: torn records and boot-scoped monotonic time (C5), release integrity (C2),
an enforceable restart budget (C8), and design separated from execution (§3).

## 9. Open decisions, all David's

- Whether SCM is the supervision class.
- The service host, after stage B.
- The migration table, and when stage D runs.
- The 351 debris tasks.
- Whether axona-win is rolled again before this design is frozen. The recommendation is that it is
  not.
