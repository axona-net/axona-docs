# Windows relay host contract — v0.5, a candidate for council review

*axona.bot, 2026-10-02. v0.1 (ed2ece8) was the consolidation Aster asked for in council 709, on
David's 708. v0.2 (5b88197, 85f4e12) answered Aster's `4d410f51`. v0.3 (2c6f5e1, amended 36ceef7)
answered Aster's `f5442247` and Vega's `037d75df`. v0.4 (d05746b) answered Aster's `ee657b8c`. v0.5
answers Aster's `fc7d5766`: a timing bound is not a fence.*

How should twenty relays live on a Windows host so that the count is a declaration, a reboot is a
non-event, and the operator always knows what happened? That is the question.

**This is NOT an accepted design.** It is a candidate under review. Nothing here is implemented,
nothing has been run, and no live process is touched by it. Its scope is one host, `axona-win`. It
is not a bridge change, not a kernel change, and it does not decide `SUB_TERMINAL_VERIFY` policy.
Stage A (design) is under David's 708; stages B, C and D each need their own word (§3).

**What v0.5 changes.** v0.4 let a 150-second quiescence wait and two stable readings act as
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
   and SCM offers no way to cancel it. C4 now waits out a bounded quiescence fence before any
   action, distinguishes the wrapper's process from the relay's, and leaves any slot it cannot
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
| `QUIESCE_MS` | 150 000 | how long after a same-boot controller death the controller re-reads an unresolved slot and raises it to the operator. **It schedules observation and escalation. It confers NO permission to act** (Aster, `fc7d5766`) |
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
  - **Fence 1, the count.** SCM runs at most one instance of a service, and each slot is one
    service. A late START can only make its own slot `Running`, on whatever release that slot is
    configured with at that moment. No late effect of any kind can bring the managed count above
    twenty. The count invariant holds with no timing assumption.
  - **Fence 2, the boot.** Every intent carries its `bootId`. SCM is a process of the operating
    system and restarts with it, so a request issued under one `bootId` cannot take effect under a
    later one. For an unresolved intent from an EARLIER boot, the slot's live state is therefore the
    final outcome of that intent, and recovery may act on it after a stability read (two readings
    `POLL_MS` apart that agree on a terminal SCM state and a consistent process table). V11 confirms
    this on the host; it is a property of the operating system, not of a timer.
- **Neither fence: an unresolved intent from THIS boot.** A controller that died mid-action without
  a reboot may have issued a stop that has not landed yet, and nothing bounds when it will. That slot
  is **UNKNOWN by default**. The global stop halt applies. The controller re-reads it at `QUIESCE_MS`
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
| last record an `intent` with no `result` | its effect may or may not have happened | that slot is pending: C4 quiescence fence |
| `halted` record, every intent has a result | stopped cleanly part-way | closed; read-only history |
| `halted` record, some intent has NO result | **still open** | its slots stay pending and the global stop halt stays in force until each is reconciled to a result, or an operator writes a `resolved` record naming it |
| `complete` record | done | read-only history |
| `resolved` record | an operator settled an open slot | closed for that slot, ONLY if the record carries one of: (a) evidence the old effect can no longer arrive, which today means a `bootId` change since the intent (Fence 2); or (b) a separately authorised override, naming who authorised it and stating the guarantee it gives up. A label alone settles nothing (Aster, `fc7d5766`) |

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

**C11 — Boot recovery, in order.** On every controller start, after acquiring the mutex:

1. **Pass the quiescence fence**, per C4, for every slot. Slots that cannot be proven settled are
   UNKNOWN. Every operation that is open per C5's table keeps its fence.
2. **Separate the operation's authorised SCOPE from its actual OBLIGATIONS.** An all-slot roll has
   all twenty slots in scope, and v0.4 excluded every slot in scope from restoration, which would
   have restored nothing (Aster, `fc7d5766`). Operations move one slot at a time, so within a readable
   journal each slot in scope is exactly one of: **finished** (its last intent has a result), **not
   started** (no intent), or **open** (an intent with no result, at most one slot). Only an OPEN slot
   is an obligation. If the journal is damaged so that this cannot be told apart, every slot in scope
   is treated as open.
3. **Restore every desired-running slot that is not an obligation, by STARTING only.** A slot is
   started only if it is desired `running`, is not an obligation, is not UNKNOWN, is not quarantined,
   AND is proven `Stopped` with no process of any recorded incarnation and no descendant of one. A
   slot found `Running` is inspected, never started again. Each is brought to readiness before the
   next. Starting cannot reduce the number of ready relays,
   so this does not bypass the global swap halt (C4). An incomplete swap after a reboot may face
   nineteen slots that are not yet ready. This step is what brings them back before the swap is
   touched again.
4. **Then the open slot, if any, under every C4 and C8 guard.** A historical `switch` record is not
   permission to start (Aster, `fc7d5766`).
   - If its intent is from an EARLIER boot (Fence 2), take the stability read. Found `Running`:
     inspect it, and if it is a single incarnation on the switched, verified release, record `ready`
     or not per C7; never start it again. Found `Stopped` with no incarnation or descendant, and the
     durable records show a completed `switch` to a verified release: start it once, subject to C8,
     and resume from C6 step 8. Anything else: UNKNOWN.
   - If its intent is from THIS boot: UNKNOWN, per C4. No automatic action.
   - **There is NO automatic return to the predecessor release while V7 is unresolved.**
5. Report the result through `status`.

**The liveness this buys, stated conditionally.** After a REBOOT, every slot that is not
quarantined and whose journal is readable is restored automatically, including the one a swap was
interrupted on. After a controller crash WITHOUT a reboot, every slot except the open one is
restored automatically; the open one waits for an operator. After journal damage, every slot in that
operation's scope waits for an operator.

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
- **V11** — Fence 2: a start or stop issued by a client killed mid-call in one boot has no effect
  after a reboot. This is a property of the operating system that V11 confirms on this build; it is
  not a timing bound, and no outcome of V11 converts `QUIESCE_MS` into permission.
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

| Aster `ee657b8c` #1 | a dead holder's request can still land; wrapper and relay pids | C4 quiescence fence, V11, incarnation as a pair; C11 starts only proven-stopped |
| Aster `ee657b8c` #2 | a HALTED op is not history; torn records hide scope; the pointer | C5 durable scope, atomic pointer, the operation table |
| Aster `ee657b8c` #3 | a forward UTC jump ages charges early | C8 measured uptime only; expiry separate from release |
| Aster `ee657b8c` | policy values must fail closed | C0 |
| Aster `fc7d5766` | a timing bound is not a fence | C4: Fence 1 (one instance per service) and Fence 2 (the boot); same-boot unresolved stays UNKNOWN; QUIESCE_MS demoted to observation |
| Aster `fc7d5766` (a) | C11 must inherit guards; a switch record is not permission | C11 step 4 |
| Aster `fc7d5766` (b) | all-slot scope excluded every slot | C11 step 2: scope vs obligation |
| Aster `fc7d5766` | a `resolved` label settles nothing | C5: evidence or an authorised override |

**Dispositions on v0.3:** Vega **ACCEPT as the stage-A candidate** (`037d75df`), conditional on
the two rows above, which this amendment answers. Aster: CHANGES REQUIRED on v0.3 (`ee657b8c`) and on v0.4 (`fc7d5766`), answered in v0.4 and v0.5.
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
