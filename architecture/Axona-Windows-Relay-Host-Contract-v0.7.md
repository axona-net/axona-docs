# Windows relay host contract — v0.7, a candidate for council review

*axona.bot, 2026-10-02. v0.1 (ed2ece8) was the consolidation Aster asked for in council 709, on
David's 708. v0.2 (5b88197, 85f4e12) answered Aster's `4d410f51`. v0.3 (2c6f5e1, amended 36ceef7)
answered Aster's `f5442247` and Vega's `037d75df`. v0.4 (d05746b) answered Aster's `ee657b8c`. v0.5
(ce79f6b) answered Aster's `fc7d5766` and was accepted for design freeze by Vega (`eb9d7f3e`). v0.6
(8ae6297) answered Aster's `18ecc644`, with Orion concurring on v0.5 (`7dad1f2c`). v0.7 answers
Aster's `d92e793f`: containment, and three places the text contradicted itself.*

How should twenty relays live on a Windows host so that the count is a declaration, a reboot is a
non-event, and the operator always knows what happened? That is the question.

**This is NOT an accepted design.** It is a candidate under review. Nothing here is implemented,
nothing has been run, and no live process is touched by it. Its scope is one host, `axona-win`. It
is not a bridge change, not a kernel change, and it does not decide `SUB_TERMINAL_VERIFY` policy.
Stage A (design) is under David's 708; stages B, C and D each need their own word (§3).

**What v0.7 changes.**

1. **Kill-on-close happens when the LAST handle to the job closes**, not the wrapper's handle
   (Microsoft, *Job Objects*). Fence 1b now requires the wrapper to own the job's only handle,
   non-inheritable; no breakaway for any descendant; and the relay assigned to the job before it
   executes a single instruction. The marker scan is demoted to a diagnostic.
2. **C5's `resolved` row still accepted a changed boot time**, the escape path C4 had already
   closed. It now requires the full Fence 2 predicate.
3. **C11 contradicted itself twice.** It made every row inherit C6.0, which refuses any pending
   slot, while its purpose is to settle that very slot; and it said recovery never stops a slot
   beside a row that retries a drain. Recovery is now three distinct steps: reconcile without
   mutating, restore by starting only, then resume the authorised swap, which alone may stop a
   slot and only after C6.0 passes again.
4. **"Safety, unconditional" overstated the count.** The count guarantee is now explicitly
   conditional on the containment contract.

**What v0.6 changed.** v0.5 claimed more than its fences prove (Aster, `18ecc644`).

1. **Fence 1 proved one WRAPPER per slot, not one RELAY.** A wrapper can die while its `node.exe`
   child lives on, and the next start would add a second relay to that slot. Fence 1 is now two
   levels: SCM bounds wrappers; a Windows Job Object with kill-on-close, a one-child launch, and a
   no-orphan check before every launch bound relays. The relay-count claim is made only under
   those obligations.
2. **A changed boot time is not a fresh SCM.** Windows 11 Fast Startup hibernates session 0, where
   the services run, rather than restarting it; sleep and hibernate resume it too. Fence 2 now
   requires `services.exe` itself to have a new start time AND the issuing controller to be gone,
   and anything short of that is the same epoch.
3. **v0.5's liveness paragraph contradicted its own step 4.** C11 is now a per-slot phase table
   with the recoverable rows named, and the promise covers those rows only. A slot's phase is kept
   separate from whether it has an unresolved effect.

**What v0.5 changed.** v0.4 let a 150-second quiescence wait and two stable readings act as
permission to recover a slot after a controller died mid-action. That is a timing heuristic, not a
fence: no finite set of tests can show a delayed SCM request will never land (Aster, `fc7d5766`).
v0.5 withdraws it. Recovery now rests on two fences the operating system actually provides, and
where neither applies, it gives up automatic recovery for that slot and says so.

- **Fence 1, the count.** SCM runs at most one instance of a service. Each slot is one service, so
  however late a start lands, no more than twenty relays can be managed. The count invariant does not
  depend on timing at all.
- **Fence 2, the boot.** SCM restarts with the operating system, so a request issued in one boot
  cannot take effect in a later one. After a reboot, a slot's live state is the final outcome of
  anything the previous boot issued, and recovery may act on it.
- **Neither fence: a controller that died mid-action within the SAME boot.** A late stop there is
  unbounded. That slot stays UNKNOWN, the global stop halt stays in force, and an operator settles
  it. Automatic recovery is lost for that one slot, and the contract accepts that loss in writing.

**What v0.4 changed.** Three recovery contracts are made explicit (§8 has the full record).

1. A previous controller's request to SCM can still take effect after that controller has died,
   and SCM offers no way to cancel it. C4 waited out a bounded quiescence period before any
   action (that permission was WITHDRAWN in v0.5), distinguishes the wrapper's process from the relay's, and leaves any slot it cannot
   prove settled UNKNOWN.
2. A HALTED operation is not history while any of its actions is unresolved. C5 now has an
   ordering and recovery table, and every operation declares its scope durably BEFORE its first
   action, so a torn record never hides which slots are at risk.
3. Across a reboot, nothing local bounds elapsed time. C8 now counts restart charges against
   MEASURED uptime only, so a forward clock jump cannot age a charge out early.

**What v0.3 changed.** v0.2's structure stands: one controller, Manual slots with no recovery
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
unbounded). They form a versioned policy: the manifest names the policy version it uses and may
override values per host. The controller validates the policy at load. **An unset, unparseable or
out-of-range value fails closed**: the controller refuses to act and `status` reads UNKNOWN. A
missing value never becomes an unlimited wait (Aster, `ee657b8c`). Values that affect only liveness
may stay evidence-dependent, as `FRESH_MS` is. Each is grounded in today's code
or practice, and the one that is not yet measured on this host says so.

| name | default | basis |
|---|---|---|
| `POLL_MS` | 3 000 | `fleet-cadence.sh` `POLL=3` |
| `LEAVE_TIMEOUT_MS` | 30 000 | `fleet-cadence.sh` `LEAVE_TIMEOUT=30` |
| `PENDING_MAX_MS` | 120 000 | four times `LEAVE_TIMEOUT_MS`: a stop that has not settled by then is UNKNOWN |
| `ESCALATE_MS` | 150 000 | how long after a same-epoch controller death the controller re-reads an unresolved slot and raises it to the operator. Named `QUIESCE_MS` in v0.4 and v0.5; renamed so the name cannot suggest permission. **It schedules observation and escalation. It confers NO permission to act** (Aster, `fc7d5766`) |
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

- **A terminal state is not proof that an old request cannot still land** (Aster, `ee657b8c`).
  Holder A can flush an intent, issue a start or stop, and die before seeing the outcome. A request
  from a client that has died may still be delivered and executed, and SCM has no cancellation for
  it. A snapshot cannot rule that out, so the contract does not pretend it does.
- **What actually fences a late effect.** Two things, and only two.
  - **Fence 1a, wrappers.** SCM runs at most one instance of a service, and each slot is one
    service, so a slot has at most one WRAPPER however late a start lands. That is all SCM proves.
  - **Fence 1b, relays.** A wrapper can terminate while its `node.exe` child, or that child's
    descendants, survive (Aster, `18ecc644`). So one wrapper does not mean one relay. Fence 1b is the
    obligation that closes the gap:
    - **Containment, by the last handle.** The wrapper creates an unnamed Windows Job Object with
      kill-on-job-close. Windows terminates the job's processes when the LAST handle to the job
      closes, not any particular one (Aster, `d92e793f`; Microsoft, *Job Objects*). So:
      - the wrapper holds the job's ONLY handle, created non-inheritable; no child inherits it, and
        an unnamed job cannot be opened by name;
      - no process in the job may break away: neither breakaway-allowed nor silent-breakaway is set,
        so every descendant stays in the job;
      - the relay is in the job BEFORE it executes anything: created suspended, assigned to the job,
        then resumed, or assigned at creation through the process attribute list. There is no window
        in which the relay runs outside the job.
      When the wrapper dies for any reason, its handle closes; it was the last, so every process in
      the job is terminated by the operating system.
    - **One child, launched once.** The wrapper starts exactly one relay and never restarts it. When
      the relay exits, the wrapper exits. Any restart is the controller's, through C8, never the
      wrapper's own.
    - **The guard is in the launch, not only before the request.** A start the controller requests
      may be carried out later, so a check by the controller before the request is not enough
      (Aster, `d92e793f`). The containment above is established inside the wrapper at the moment it
      launches the relay, every time, which is what bounds a late or delayed start.
    - **The marker is a diagnostic.** Each relay carries `--axona-slot=<slot>` in its command line,
      and the controller scans for it before a start; a match blocks the start and makes the slot
      UNKNOWN. A scan cannot prove ownership of descendants, which need not carry the marker. The
      containment, not the scan, is the guarantee.
    The claim that no late effect can take the RELAY count above twenty is made only under Fence 1b,
    and stays an obligation until V12 and V13 show it on this build.
  - **Fence 2, a fresh SCM execution epoch.** A changed last-boot time is not enough (Aster,
    `18ecc644`). Windows 11 Fast Startup hibernates session 0, where the services run, instead of
    restarting it, and sleep and hibernate resume it. Every intent therefore records the **SCM
    epoch** (`services.exe` pid and process start time) and the **issuing controller incarnation**.
    Fence 2 applies to an unresolved intent only when ALL of these hold:
    - `services.exe` now has a DIFFERENT start time from the one recorded with the intent;
    - the issuing controller incarnation no longer exists;
    - no durable source can replay the request. SCM keeps no queue of control requests across its
      own restart; the only durable request source in this design is the spool, which acts only
      through the journal rules.
    If any of these cannot be read or is uncertain, the intent is treated as SAME-epoch. Under Fence
    2, the slot's live state is the final outcome of that intent, and recovery may act on it after a
    stability read (two readings `POLL_MS` apart that agree on a terminal SCM state and a consistent
    process table). V11 can challenge these assumptions; it cannot prove them by finite observation,
    and the contract does not claim it does.
- **Neither fence: an unresolved intent from the SAME epoch.** A controller that died mid-action without
  a reboot may have issued a stop that has not landed yet, and nothing bounds when it will. That slot
  is **UNKNOWN by default**. The global stop halt applies. The controller re-reads it at `ESCALATE_MS`
  and escalates to the operator, and that is all the timer does. **Automatic recovery is lost for
  that slot until an operator settles it** (C5 `resolved`), and the contract accepts that loss
  rather than calling a timing assumption safe.
- **What would restore it, not relied on here.** A stop the relay honours only when it names the
  relay's own incarnation would turn a stale stop into a no-op for any newer incarnation: a real
  generation fence inside one boot. That needs a relay change, recorded as R1 (§9). Until R1 exists
  and is accepted, the paragraph above stands.
- **What recovery may do once a slot is settled.** A slot proven `Stopped`, with no process of any
  recorded incarnation and no descendant of one, may be STARTED. A slot found `Running` is INSPECTED,
  never started again and never stopped by recovery. A slot that makes a transition the current
  holder did not issue is UNKNOWN, and the global stop halt applies.
- **Two processes per slot.** The SCM service's process is the WRAPPER; the relay is its child
  `node.exe`. An incarnation is the pair: wrapper pid and start time, relay pid and start time. Every
  ownership and readiness check uses the pair (C7).
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
- **Scope is durable before any action.** An operation's `accepted` record names its full scope:
  every slot it may touch, the release it moves them to, and the policy version. It is flushed
  before the operation's first intent. A torn LATER record therefore never hides which slots are at
  risk: every slot in the scope is treated as possibly affected. A torn `accepted` record leaves the
  operation's scope unknown, and the HOST is UNKNOWN.
- **The `active` pointer** names the one operation currently in progress. It is replaced
  atomically: written to a temporary file, flushed, then moved over the old one with
  `MoveFileEx(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`. A pointer that is unreadable is
  host UNKNOWN. A pointer that is MISSING does not mean "no operation": the controller reads the tail
  of every journal, and if any holds an intent with no result and no `resolved` record, the host is
  UNKNOWN.
- **An operation's states, and what each obliges:**

| durable state found | what it means | recovery |
|---|---|---|
| request in `spool\pending\`, no journal | submitted, not accepted | may be accepted, once no other operation is open |
| `accepted` record, pointer not yet naming it | accepted, not active | write the pointer, then proceed; the scope is known |
| last record an `intent` with no `result` | its effect may or may not have happened | that slot has an unresolved effect: C4 epoch rules, C11 phase table |
| `halted` record, every intent has a result | stopped cleanly part-way | closed; read-only history |
| `halted` record, some intent has NO result | **still open** | its slots stay pending and the global stop halt stays in force until each is reconciled to a result, or an operator writes a `resolved` record naming it |
| `complete` record | done | read-only history |
| `resolved` record | an operator settled an open slot | closed for that slot, ONLY if the record carries one of: (a) evidence the old effect can no longer arrive: the FULL Fence 2 predicate (a new `services.exe` start time, the issuing controller incarnation gone, and no replay source), never a changed boot time alone, and anything uncertain leaves the slot UNKNOWN; or (b) a separately authorised override, naming who authorised it and stating the guarantee it gives up. A label alone settles nothing (Aster, `fc7d5766`) |

- **One open operation at a time.** A new operation may become active only when every earlier
  operation is `complete`, or `halted` with every intent resolved. A HALTED operation with an
  unresolved effect is not history (Aster, `ee657b8c`): its fence survives any later request.
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
- *The count, conditional on containment:* steady state never runs more than twenty RELAYS, given
  Fence 1b. Without Fence 1b the contract claims only twenty WRAPPERS (Fence 1a). V12 and V13 are the
  refinement obligations, and finite tests support the claim without proving it.
- *The controller's own stops, from C4 and C5 rather than from timing:* at any moment at most ONE
  slot is down because a controller stopped it, in addition to slots whose desired state is
  `stopped`, and no controller issues a stop while any slot is UNKNOWN or has an unresolved effect.
  This rests on two things: every stop's intent is flushed before the stop is issued (C5), so even a
  dead controller's late stop has a durable record; and only one controller can hold the mutex (C4),
  so the next holder sees that record and refuses to stop anything else.
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
- **Only measured uptime ages a charge** (Aster, `ee657b8c`: a forward UTC jump across a reboot
  would otherwise age charges out early). Nothing on this host supplies a trusted lower bound on
  elapsed time across a reboot, so the contract does not use one. The controller keeps a persisted
  counter of MEASURED monotonic milliseconds, flushed at least every `POLL_MS` and at shutdown. A
  charge leaves the 24-hour window only when that counter has advanced 24 hours past it. Time the
  host spent off, and any movement of UTC, count for nothing. The cost is that a charge can last
  longer than 24 wall-clock hours. That error is on the safe side.
- **Expiry and release are different things.** A rolling charge expires as above. A QUARANTINE never
  expires: it ends only with an explicit `relayctl release <slot>`, however many charges have aged
  out.
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

**C11 — Boot recovery, by phase.** On every controller start, after acquiring the mutex.

**Two separate facts per slot** (Aster, `18ecc644`: "the last intent has a result" describes one
action, not the slot's migration):
- its **phase** in the open operation: `not-started`, `draining`, `stopped`, `switched`, `started`,
  `done`, or `halted`;
- whether it has an **unresolved effect**: an intent with no result, and if so whether that intent is
  from the SAME SCM epoch or an EARLIER one (C4 Fence 2).

**Scope is not obligation.** An all-slot roll has twenty slots in scope; only the slot whose phase is
neither `not-started` nor `done` is an obligation, and operations move one slot at a time, so there is
at most one. If the journal is damaged so that phases cannot be read, every slot in that scope is an
obligation and stays UNKNOWN.

**Order: reconcile, restore, then resume.** Three distinct steps, and only the third can stop a slot.

1. **Reconcile, without mutating anything.** Classify every slot: phase, unresolved effect, epoch.
   For the obligation slot, settle its EARLIER-epoch outcome by the phase table below, which reads
   live state and writes only the journal. This is how the obligation stops being pending. It issues
   no SCM action. C6.0 does not apply here, because its job is to stop a swap from starting while
   something is unresolved, and this step is what resolves it (Aster, `d92e793f`).
2. **Restore, by starting only.** Every desired-running slot that is not an obligation, is not UNKNOWN
   or quarantined, is proven `Stopped`, and passes the no-orphan diagnostic is started, each to
   readiness before the next. A slot found `Running` is inspected, never started again. Starting
   cannot reduce the number of ready relays.
3. **Resume the authorised swap, only after C6.0 passes again.** With the obligation slot now in a
   settled phase, re-evaluate C6.0 against every other slot. Only if it passes may the operation
   continue from the phase the table assigned, and only this step may issue a stop, for example to
   retry a drain that never landed. If C6.0 fails, the operation HALTS as DEGRADED.
4. Report through `status`.

**The phase table for the obligation slot.**

| phase, last intent | epoch of that intent | live state found | recovery |
|---|---|---|---|
| any | SAME | any | **UNKNOWN**. Escalate at `ESCALATE_MS`. Operator settles it (C5 `resolved`) |
| any | cannot be determined | any | **UNKNOWN**, as SAME |
| journal damaged | unreadable | not consulted | **UNKNOWN**, whole scope |
| `draining`, `drain` unresolved | EARLIER | `Running`, the predecessor incarnation | the stop never landed: phase back to `not-started`; the operation may retry the drain under C6 |
| `draining`, `drain` unresolved | EARLIER | `Stopped`, no orphan, configured on the predecessor release | the stop landed: phase `stopped`; resume at C6 step 6 under C6.0 |
| `stopped` or `switch` unresolved | EARLIER | `Stopped`, no orphan; live configuration names the TARGET release, verified | the switch landed: phase `switched`; resume at C6 step 7 |
| `stopped` or `switch` unresolved | EARLIER | `Stopped`, no orphan; live configuration names the PREDECESSOR release | the switch did not land: phase `stopped`; redo C6 step 6 |
| `start` unresolved | EARLIER | `Running`, one incarnation on the target release | phase `started`; continue at C6 step 8 (readiness) |
| `start` unresolved | EARLIER | `Stopped`, no orphan, configured on the target | start once under C8; continue at C6 step 8 |
| any other combination | EARLIER | anything not in a row above | **UNKNOWN** |

There is NO row that returns a slot to its predecessor release while V7 is unresolved.

**The liveness promise, narrowed to the table.** After a verified fresh SCM epoch, an obligation slot
recovers automatically only in the rows above that name a recovery, and only if that slot is desired
`running`, its restart budget is not exhausted, Fence 1b holds, and, for any row that resumes a swap,
the other desired-running slots are ready (C6.0). Every other case waits for an operator. A slot that
is not an obligation recovers by step 2 under the same budget and containment conditions.

Reconciliation never mutates a slot. Restoration only starts slots, never all of them blindly. Only
the resumption of an authorised swap may stop a slot, and only after C6.0 passes. All three obey C8.

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
- **V11** — Challenge Fence 2's assumptions on this build: a full restart gives `services.exe` a new
  start time; Fast Startup shutdown and power-on, sleep, and hibernate do NOT, and are therefore
  treated as the same epoch; a request from a client killed mid-call has no effect once `services.exe`
  has restarted. Finite observation can falsify these and cannot prove them. No outcome of V11
  converts `ESCALATE_MS` into permission.
- **V12** — Fence 1b containment, with the chosen wrapper: the job handle is the wrapper's only one and
  is not inherited; breakaway is impossible for every descendant; the relay is in the job before it
  runs; and killing the wrapper terminates the relay and every descendant with no survivor. If the
  candidate wrapper cannot meet these, it is not the wrapper.
- **V13** — Fence 1b launch: the wrapper starts one relay, never restarts it, and exits when it exits;
  the `--axona-slot` marker is visible in the relay's command line for the no-orphan check.
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
  backwards; UTC set FORWARD across a reboot; the host left powered off for longer than a day.
- A controller killed mid-SCM-call, and its request landing after the next holder's first reading.
- A wrapper killed while its relay keeps running; then a start of that slot.
- A Fast Startup shut down and power on; sleep and resume; hibernate and resume. Each must be
  classified as the SAME epoch.
- A crash after `drain` and before `switch`; after `switch` and before `start`; after `start` and before
  readiness: each across a full restart and within one epoch.
- A HALTED operation with an unresolved intent, followed by a new `apply`.
- A torn `accepted` record; a torn later record; a missing `active` pointer with an open journal.
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

| Aster `ee657b8c` #1 | a dead holder's request can still land; wrapper and relay pids | v0.4 answered with a quiescence wait, WITHDRAWN in v0.5; now C4 epoch rules; incarnation as a pair; C11 starts only proven-stopped |
| Aster `ee657b8c` #2 | a HALTED op is not history; torn records hide scope; the pointer | C5 durable scope, atomic pointer, the operation table |
| Aster `ee657b8c` #3 | a forward UTC jump ages charges early | C8 measured uptime only; expiry separate from release |
| Aster `ee657b8c` | policy values must fail closed | C0 |
| Aster `fc7d5766` | a timing bound is not a fence | C4: Fence 1 (one instance per service) and Fence 2 (the boot); same-boot unresolved stays UNKNOWN; ESCALATE_MS demoted to observation |
| Aster `fc7d5766` (a) | C11 must inherit guards; a switch record is not permission | C11 step 4 |
| Aster `fc7d5766` (b) | all-slot scope excluded every slot | C11 step 2: scope vs obligation |
| Aster `fc7d5766` | a `resolved` label settles nothing | C5: evidence or an authorised override |
| Aster `18ecc644` #1 | one wrapper is not one relay | C4 Fence 1a/1b; V12, V13 |
| Aster `18ecc644` #2 | a changed boot time is not a fresh SCM | C4 Fence 2: `services.exe` epoch, issuer gone, no replay source; V11 |
| Aster `18ecc644` #3 | the liveness promise contradicted step 4; action vs migration completion | C11 phase table; promise narrowed to its rows |
| Aster `18ecc644` | residual quiescence wording | removed; the timer renamed `ESCALATE_MS` |
| Aster `d92e793f` | kill-on-close is at the LAST handle; launch-before-assignment; marker is not ownership | C4 Fence 1b: sole non-inherited handle, no breakaway, assigned before execution, guard in the launch; V12 |
| Aster `d92e793f` | `resolved` still accepted a changed boot time | C5: full Fence 2 predicate |
| Aster `d92e793f` | C11 inherited C6.0 while settling the pending slot; "never stops" beside a retried drain | C11: reconcile, restore, resume |
| Aster `d92e793f` | "Safety, unconditional" overstated the count | C6: count conditional on Fence 1b |

**Dispositions on v0.3:** Vega **ACCEPT as the stage-A candidate** (`037d75df`), conditional on
the two rows above, which this amendment answers. Aster: CHANGES REQUIRED on v0.3 to v0.6 (`ee657b8c`, `fc7d5766`, `18ecc644`, `d92e793f`), each
answered in the next version. Vega: ACCEPT v0.5 for design freeze (`eb9d7f3e`); v0.7 disposition
asked. Orion: concurred with Aster's v0.5 review (`7dad1f2c`); v0.7 disposition asked, with one open
point: whether an interrupted drain or switch should ever recover automatically after a verified fresh
epoch (axona.bot `047ceaa3`).
Orion: no disposition on any version.

## 9. Open decisions, all David's

- Whether SCM is the supervision class.
- The service host, after B2.
- Each of stages B1, B2, B3, C and D.
- The migration table.
- The 351 debris tasks.
- **R1**, a relay change: a stop honoured only when it names the relay's own incarnation. It would
  restore automatic recovery after a same-boot controller crash. Not part of this contract until
  separately designed and accepted.
- Whether axona-win is rolled again before this design is frozen. The recommendation is that it is
  not.
