# Windows relay host contract — v0.3, a candidate for council review

*axona.bot, 2026-10-02. v0.1 (ed2ece8) was the consolidation Aster asked for in council 709, on
David's 708. v0.2 (5b88197, amended 85f4e12) answered Aster's `4d410f51`. v0.3 answers Aster's
`f5442247`, which accepted v0.2's structure and named five remaining counterexamples.*

How should twenty relays live on a Windows host so that the count is a declaration, a reboot is a
non-event, and the operator always knows what happened? That is the question.

**This is NOT an accepted design.** It is a candidate under review. Nothing here is implemented,
nothing has been run, and no live process is touched by it. Its scope is one host, `axona-win`. It
is not a bridge change, not a kernel change, and it does not decide `SUB_TERMINAL_VERIFY` policy.
Stage A (design) is under David's 708; stages B, C and D each need their own word (§3).

**What v0.3 changes.** v0.2's structure stands: one controller, Manual slots with no recovery
actions, an operating-system exclusion taken before anything mutates, a reviewed migration table.
v0.3 closes five gaps in it.

1. A longer wrapper timeout is not a promise never to force-kill. An SCM stop is now treated as
   possibly destructive unless the chosen host is shown to support a stop with no escalation.
2. The mutex does not fence an action already handed to SCM. A new holder first proves every
   pending action has finished. While any slot is UNKNOWN or pending, NO slot may be stopped.
3. A checksum detects a torn record but does not order writes. Every intent is flushed to disk
   before its effect, and nothing is ever chosen by guessing at unreadable intent.
4. A slot whose desired state is `stopped` is not a degraded slot. Boot recovery restores the
   other running slots first, by starting only, and never auto-returns a release while V7 is open.
5. The restart budget survives reboots and clock jumps, and a reboot cannot reset it.

---

## 1. The host, as reported on 2026-10-02

Read from the host by axona.bot; reported, not independently verified.

| fact | value |
|---|---|
| OS | Windows 11 **Home**, build 26200 |
| boots in the last 60 days | **11**, most initiated by Windows Update |
| what restarts the relays after a boot | **nothing** |
| relays | 21 `node src/index.js` under `nohup.exe`, one shared checkout: 16 with `SUB_TERMINAL_VERIFY=1`, 5 without |
| Node | v26.5.0; droplets v22.23.1, axona-linux v24.20.0, m1 v26.6.0 |
| scheduled tasks matching `axona\|relay` | 351 one-shot August debris, none at boot |
| WSL | present, default NAT networking |
| remote execution that works | a `.ps1` shipped with `scp`; `wmic` is removed; cmd.exe consumes `\|`, `&`, `>`, `$( )` |

Home edition cannot defer Windows Update. The reboots are the weather.

## 2. Two failures from 2026-10-01, kept apart

**The ADVANCE gate aborted, and was right to.** Slot 17's heir never wrote a state line; at
22:02:52Z, ninety seconds after its start, the gate refused to retire the incumbent.

**The ssh session outlived the roll by 2 h 28 m.** ServerAlive was configured and did not fire:
it detects a dead connection, and this one was alive.

Standing defects to close: no path reduces a count (`N=$live`); the census counts every
`node.exe` and the status line counts log files; `taskkill /F` skips the relay's `shutdown()`;
nothing restarts the relays after a reboot.

## 3. Stages — design is not execution

| stage | what | touches the host? |
|---|---|---|
| **A. Design** | this document, reviewed by all four seats and frozen | no |
| **B1. Offline** | the obligations that need no running relay: V6 read from source, V7, V8, and the controller's logic against a fake SCM | no |
| **B2. Host feasibility** | V1–V4 and V10 on ONE test service that runs no relay | yes, isolated |
| **B3. Relay feasibility** | V5, V9 and V6's behaviour, with ONE relay under a test service, expressly authorised | yes, one relay |
| **C. Acceptance** | the §7 scenarios, in a stated window | yes |
| **D. Migration** | C10, against a reviewed table | yes, all slots |

v0.2 claimed a relay-free stage B could show V5, V6 and V9. It cannot, because those are
properties of a running relay (Aster, `f5442247`). B3 separates them. Nothing here dispatches B,
C or D.

## 4. Two actors, and only two

**The controller service, `axona-relayctl`.** One SCM service, Automatic (Delayed Start). It is
the ONLY thing that starts, stops or reconfigures a relay slot: at boot, after a crash, during a
swap.

**The slot services, `axona-relay-w01` … `w20`.** Start type Manual; SCM recovery set to take no
action. A slot's desired state lives in the manifest and the journal, never in a start type.

**The operator CLI, `relayctl.ps1`.** It never mutates a slot. It submits requests through the
spool (C5) and reads status.

**No third driver** (Vega, `268cf8f3`), and it is enforced, not described (Vega, `037d75df`).
The switch is the manifest itself: when `axona-relay/hosts/<host>.json` exists with
`"supervisor": "scm"`, `ops/fleet.sh` refuses that host for `roll`, `add` and cold start, and
names this contract; `ops/release.sh check` prints that host's row as "relayctl, not fleet.sh".
**Stage C cannot begin until that guard is in `fleet.sh` and its negative test passes**: with the
manifest present, a roll of `axona-win` must exit non-zero having touched nothing.
RELEASE-PROCEDURE.md row 8 records the same rule.

## 5. The contract

**C0 — Normative defaults** (Vega, `037d75df`: without bound values the §7 scenarios are
unbounded). The manifest may override any of these per host. Each is grounded in today's code
or practice, and the one that is not yet measured on this host says so.

| name | default | basis |
|---|---|---|
| `POLL_MS` | 3 000 | `fleet-cadence.sh` `POLL=3` |
| `LEAVE_TIMEOUT_MS` | 30 000 | `fleet-cadence.sh` `LEAVE_TIMEOUT=30` |
| `PENDING_MAX_MS` | 120 000 | four times `LEAVE_TIMEOUT_MS`: a stop that has not settled by then is UNKNOWN |
| `READY_DEADLINE_MS` | 270 000 | the Windows roll's current `READY_TIMEOUT` (`fleet.sh` passes 3 × `WIN_ADVANCE_CAP`=90) |
| `FRESH_MS` | 15 000 | a relay writes a state line every 1 000 ms (`src/index.js:322`); fifteen missed lines tolerate an event-loop stall. **Provisional until V9** measures the cadence under a service on this host |
| `BOOT_GRACE_MS` | 600 000 | a slot failing within ten minutes of its boot start counts as a crash restart; more than twice `READY_DEADLINE_MS` |
| restart budget | 3 per rolling 24 h | C8 |
| wrapper stop timeout | moot if V2 shows a no-escalation stop; otherwise 60 000, and every stop is an authorised destructive action (C6.2) | C6.2 |

**C1 — The count is a reviewed declaration.** `hosts/axona-win.json` names exactly twenty slots,
`w01`…`w20`. Per slot: desired state (`running` | `stopped`), region, environment, release. N is
the slot count. Nothing observed ever becomes N.

**C2 — Releases are immutable and carry their own runtime.** A release directory holds the relay
tree and a portable `node.exe`, with a manifest of every file and its sha256. The release's digest
is the sha256 of that manifest. The controller verifies the whole tree before pointing any slot at
it and refuses on any mismatch.

**C3 — SCM supervises,** as §4. WinSW is the candidate host: a candidate, not a selection.

**C4 — Exclusion, and what it does NOT fence.**

The controller holds the operating-system mutex `Global\axona-relayctl` for its whole life,
acquired before any reconciliation that can mutate state. Windows hands an abandoned mutex to the
next holder flagged as abandoned.

The mutex fences controllers. It does NOT fence an action one controller already handed to SCM
(Aster, `f5442247`). A start or stop issued by holder A may still be in flight when holder B
acquires the abandoned mutex. So:

- **Pending-action proof.** Before B issues ANY action on a slot, that slot must be in a terminal
  SCM state, `Running` or `Stopped`, not `StartPending` or `StopPending`, AND the process table
  must agree with it: for `Stopped`, no process of any recorded incarnation; for `Running`, exactly
  one process whose pid and start time are recorded. A slot still pending after `PENDING_MAX` is
  **UNKNOWN**.
- **The global swap halt.** While ANY slot is UNKNOWN or pending, NO slot may be intentionally
  stopped. Slots may still be STARTED to restore a desired `running` state, because a start cannot
  reduce the number of ready relays. v0.2's "the rest proceed" is withdrawn: it would have let a
  second slot stop while the first might still be stopping.
- A request whose opId already has a journal returns that operation's durable status.

**C5 — Durable ordering, not only integrity.**

- **Intent before effect.** Every intent record is written AND flushed to disk (`FlushFileBuffers`)
  BEFORE the action it describes is issued. Every result record is written and flushed after the
  controller has OBSERVED the action's outcome. That ordering is what makes "no intent on disk"
  mean "not started". Without it, it would not.
- **Torn records.** Every record ends in its own sha256. A final record that fails the check is
  torn; its step is **intent unknown**, and the slot it names becomes UNKNOWN.
- **Nothing is chosen by guessing.** Live state can say what IS; it cannot reconstruct what was
  AUTHORISED. If the only record of a release choice or a rollback is unreadable, the controller
  does not pick a release; the slot is UNKNOWN and stays as found. A recorded `ready` is history,
  never current readiness.
- **The request spool.** The CLI writes a request to `spool\tmp\`, flushes it, and renames it
  atomically to `spool\pending\<opId>.json`. That rename is the moment of submission, and `apply`
  returns only after it. The controller accepts a request by writing and flushing an `accepted`
  journal record, then renames the request to `spool\accepted\`. A pending request with no
  journal is unaccepted; one with a journal is accepted, whatever the spool shows.
- **Canonical opId.** `opId = sha256` of the canonical JSON of `{manifestSha, releaseSha,
  generation, verb, slots}`, with `slots` sorted.
- **One active operation.** At most one operation is active, recorded in a flushed `active` file
  naming its opId. Journals of finished or halted operations are read-only history. Recovery reads
  only the active operation's journal, plus live state. Two journals claiming to be active is
  impossible by construction; if it is ever observed, the whole host is UNKNOWN.
- **Time.** Every record carries UTC, `bootId` (the last boot time) and monotonic milliseconds.
  Monotonic values are compared only within one `bootId`.

**C6 — One slot at a time, stop before start, no surge.**

0. **Precondition.** Every OTHER slot whose desired state is `running` is READY (C7). Slots whose
   desired state is `stopped` are excluded from this test. If any desired-running slot is not
   ready, or any slot is UNKNOWN or pending (C4), the operation HALTS as **DEGRADED**.
1. Flush intent `drain`.
2. **Cooperative stop, and what an SCM stop can turn into.** The service host delivers a console
   Ctrl-C, which Node raises as SIGINT, and the relay's `shutdown()` runs `stopRelay()`,
   `releaseLock()`, then `exit(0)` (`src/index.js:213`). A longer wrapper timeout does NOT mean the
   wrapper never escalates: once an SCM stop is issued, the controller's deadline cannot cancel a
   force-kill the wrapper performs later (Aster, `f5442247`). So:
   - if V1/V2 show the chosen host supports a stop with NO force escalation, that mode is used;
   - otherwise an SCM stop is treated as POSSIBLY DESTRUCTIVE, and issuing it needs the same
     authorisation as `relayctl kill`, bound to that exact incarnation.
3. **Drain evidence, recorded as observed:** the `shutting down (SIGINT)` line, the exit code, the
   time taken. A completed handler is NOT a certificate that the relay's duties were discharged.
   Until V6 is shown, every stop is journalled `stopped; discharge UNVERIFIED`.
4. **Not exited by `LEAVE_TIMEOUT`:** the slot is UNKNOWN and the operation HALTS. No automatic
   escalation by the controller.
5. Confirm the incarnation and every descendant are gone, by pid AND start time. Flush result.
6. Flush intent `switch <release digest>`; point the slot; flush result.
7. Flush intent `start`; start once; record the new incarnation; flush result.
8. **Readiness**, per C7, bound to this incarnation's own new log file, deadline re-checked after
   each probe.
9. Ready: flush result `ready`; the next slot's step 0 re-validates this one. Not ready by the
   deadline: **not-ready-by-deadline**, HALT. CPU time and log silence are evidence only.

**The invariants.**
- *Safety, unconditional:* steady state never manages more than twenty instances. At any moment at
  most ONE slot is down BECAUSE OF AN OPERATION, in addition to slots whose desired state is
  `stopped`. No slot is stopped while any slot is UNKNOWN or pending.
- *Liveness, conditional:* if the other desired-running slots are ready at step 0 and stay ready,
  each of them is ready throughout. A crash, a reboot or a degraded start voids that, and step 0
  reports it.

**C7 — Status is a query, and readiness is re-validated.** A slot is READY at a moment only if:
its service is `Running`; its current process is the recorded incarnation by pid AND start time;
and its log holds a `state=open` or `state=graduated` line written within the last `FRESH_MS`. A
verdict is a snapshot, never a promise. `status` re-derives it every time, and returns per slot the
desired release and state, SCM state, incarnation, digest in use and readiness with evidence; then
CONVERGED, PARTIAL, DEGRADED, HALTED or UNKNOWN; and the **unmanaged** list. An unreachable host is
UNKNOWN.

**C8 — The restart budget survives reboots and clock jumps.**
- Crash restarts are the controller's. Each is flushed to a budget file with UTC, `bootId` and
  monotonic time. The budget file and every QUARANTINE flag persist across reboots.
- A slot with three automatic restarts inside a 24-hour window is QUARANTINED: not restarted, shown
  in `status`, released only by `relayctl release <slot>`.
- **Clock discontinuity, handled conservatively.** Within one boot, elapsed time comes from the
  monotonic clock. Across boots it comes from UTC. A record leaves the window only when BOTH clocks
  that can speak to it agree that 24 hours have passed. If UTC has gone backwards, or a boot's
  elapsed time cannot be bounded, no record leaves the window. A clock jump can extend a quarantine.
  It can never end one early.
- **Reboots cannot reset the budget.** A slot that starts at boot and then fails within
  `BOOT_GRACE_MS` counts as a crash restart. A slot that fails readiness across three consecutive
  boots is quarantined.

**C9 — Rollback is an ordinary operation,** under C4, C5 and C6. Whether a release switch can cross
a state-format boundary is unresolved until V7.

**C10 — Migration, on a reviewed table and David's word.**
- A migration table maps each of today's 21 legacy relays, by pid AND start time and observed
  environment, to a named slot, and names the ONE excess explicitly. It is reviewed and approved
  before stage D.
- The force-stop authority for stage D is bound to exactly those incarnations. Legacy relays have
  no cooperative stop on Windows.
- Ceilings: managed plus legacy never exceeds **21** during migration; steady state is **20**.
- The 351 debris tasks are a separate cleanup on David's word.

**C11 — Boot recovery, in order.** On every controller start, after acquiring the mutex:

1. **Prove pending actions finished**, per C4, for every slot. Slots that cannot be proven are
   UNKNOWN.
2. **Restore the OTHER desired-running slots first, by STARTING only.** Every slot that is desired
   `running`, is not the subject of an incomplete operation, is not UNKNOWN and is not quarantined
   is started, one at a time, each to readiness. Starting cannot reduce the number of ready relays,
   so this does not bypass the global swap halt (C4). An incomplete swap after a reboot may face
   nineteen slots that are not yet ready. This step is what brings them back before the swap is
   touched again.
3. **Then resolve the incomplete operation's slot.**
   - If its durable records show a complete `switch` to a verified release, it is started on that
     release and the operation resumes from step 8.
   - If they do not, the slot is UNKNOWN and left stopped. **There is NO automatic return to the
     predecessor release while V7 is unresolved.** v0.2 allowed one, and it would have crossed a
     state-format boundary nobody has checked.
4. Report the result through `status`.

Recovery never starts every slot blindly, never stops any slot, and obeys C8.

## 6. Obligations, by stage

**B1, offline:** V6a, what `stopRelay()` discharges, read from source; V7, whether a relay persists
anything a release switch could break; V8, the bundled `node.exe` and `node-datachannel` share a
native ABI; and the controller's state machine run against a fake SCM.

**B2, a test service with no relay:**
- **V1** — A stop through the host reaches a Node process's SIGINT handler on this build.
- **V2** — Whether the host can stop with NO force escalation. If it can, show that mode. If it
  cannot, record that, and every SCM stop becomes an authorised destructive action (C6.2).
- **V3** — Environment, working directory and the per-incarnation log path reach the process.
- **V4** — Automatic (Delayed Start) behaves as specified on Windows 11 Home build 26200.
- **V10** — `Global\axona-relayctl` is visible to the controller (session 0) and the CLI (an ssh
  session); abandonment is reported as specified; the controller holds it on the one thread that
  runs its loop.

**B3, one relay under a test service, expressly authorised:**
- **V5** — Under the service account, Windows Firewall admits `node.exe` UDP, and the relay produces
  host and srflx candidates.
- **V6b** — What a cooperative stop actually discharges, observed.
- **V9** — A relay writes a state line often enough for a stated `FRESH_MS`.

## 7. Acceptance scenarios — stage C

- ssh lost immediately after `apply`; a request renamed into the spool with no journal yet.
- The controller killed between every intent and result record, and between issuing an SCM action
  and observing it.
- A torn final journal record, including one that recorded a release choice.
- A reboot during each step of C6, and while idle.
- Two controller instances at once.
- A stop that does not complete; a wrapper that escalates after the controller's deadline.
- A slot ready, then dead before the next slot's step 0.
- A slot ready one second after its deadline.
- A previous incarnation's log present; PID reuse.
- The same opId twice; two different opIds.
- An unmanaged `node.exe` present throughout.
- A crash loop reaching quarantine; repeated reboots with a slot failing each time; UTC set
  backwards.
- A slot whose desired state is `stopped`, through a swap of another slot and through a reboot.
- A rollback.

## 8. The review record

| review | counterexample | answered by |
|---|---|---|
| Aster `4d410f51` #1 | disabled slot plus reboot | §4 Manual slots; C11 |
| Aster `4d410f51` #2 | stale-file takeover race | C4 OS mutex |
| Aster `4d410f51` #3 | ready then died | C7, C6 step 0 |
| Aster `4d410f51` #4 | "at least 19" not unconditional | C6 invariants |
| Aster `4d410f51` #5 | stop precedes V6 | C6 steps 2–4 |
| Aster `4d410f51` #6 | unnamed excess; asserted compatibility | C10, C9 |
| Vega `268cf8f3` | a third driver | §4 no third driver |
| Aster `f5442247` #1 | longer timeout ≠ never force | C6.2, V2 |
| Aster `f5442247` #2 | mutex does not fence a pending SCM action | C4 pending-action proof and global swap halt |
| Aster `f5442247` #3 | checksums do not order writes | C5 intent before effect, spool, no guessing |
| Aster `f5442247` #4 | desired-stopped vs the precondition; recovery facing 19 not ready | C6 step 0, C11 |
| Aster `f5442247` #5 | budget across boots | C8 |
| Aster `f5442247` | relay-free stage B cannot show V5, V6, V9 | §3 B1/B2/B3, §6 |
| Vega `037d75df` #1 | the timeouts are unbound, so the scenarios are too | C0 defaults table |
| Vega `037d75df` #2 | the `fleet.sh` refusal is prose, not enforced | §4: the manifest is the switch; stage C gated on the guard and its negative test |

**Dispositions on v0.3:** Vega **ACCEPT as the stage-A candidate** (`037d75df`), conditional on
the two rows above, which this amendment answers. Aster: review of v0.3 pending. Orion: no
disposition on any version.

## 9. Open decisions, all David's

- Whether SCM is the supervision class.
- The service host, after B2.
- Each of stages B1, B2, B3, C and D.
- The migration table.
- The 351 debris tasks.
- Whether axona-win is rolled again before this design is frozen. The recommendation is that it is
  not.
