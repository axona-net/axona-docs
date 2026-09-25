# Empty-topic reclamation: what the kernel has, what it lacks

Feasibility report against AX-Empty-Topic-Reclamation-Design-2026-09-25.md
(sha256 3411a2d4…c59f, verified). Read-only source audit of axona-protocol,
axona-bridge and axona-relay. No code written, no stage begun, nothing deployed.

axona.bot · 2026-09-25

---

## What this answers

Can the design be implemented on this kernel, and what is missing before any of
it can be?

The short answer: the reclamation logic is implementable, and it cannot run,
because three of the facilities the protocol assumes do not exist. They are
transport and storage facilities, not reaper details, and each is a separate
piece of work that lands before stage 1.

## 1. What already exists and can be built on

**One deletion site.** `repairPlane.js:368` is the only `axonRoles.delete` in
the kernel. The design asks for ONE teardown routine and structurally that is
already true. What the routine does not do is cancel indexes, timers and jobs.

**A drain primitive.** `_ingestIdle()` (`repairPlane.js:470`) resolves once every
queued ingest has been processed. Its own comment names the use case: "for
teardown paths that must observe converged state".

**Named creation causes.** The allocation paths already carry literal cause
strings — `terminal`, `sub-terminal`, `pub-terminal`, `kill-terminal`,
`metricson-terminal`, `handoff-heir`. An `ensureRole(topic, generation, cause)`
gate inherits its cause argument from what the source already passes.

**Two admission gates,** `admitRole` (`rootClaim.js:321`) and `admitPushedRole`
(`syncEngine.js:203`), and a dispatch-verdict discipline in the replica
bookkeeping that already distinguishes consumed from failed.

## 2. The allocation inventory

Four sites call `makeRole`. One deletes.

| site | cause | admission |
|---|---|---|
| `rootClaim.js:322` | `_becomeRoot`, born-as-root | **gated** (`admitRole`) |
| `rootClaim.js:415` | `adoptChild` | none |
| `repairPlane.js:665` | read-repair holder | none |
| `syncEngine.js:242` | REPLICATE ingest → backup | none |
| `repairPlane.js:368` | the only delete | — |

Three of four allocation paths never consult admission. That is why `maxRoles`
is not an invariant — not because one path overflows by design, but because
three quarters of them never ask.

Inside `_syncIngest` the HANDOFF branch checks admission at `:203` and the
REPLICATE branch at `:242` does not. Adjacent branches of one function, one
asks.

Terminal creation has FOUR causes, not three: `wireHandlers` `:214`, `:383`,
`:1059` and `:1228` METRICSON.

**These are source findings.** They explain why the ceiling is not enforced.
They do not establish which path produced any particular runtime role count.

## 3. Prerequisite zero — durable decision storage

The protocol turns on a participant durably recording PREPARED before voting,
and a coordinator durably recording exactly one COMMIT or ABORT.

**Nothing on the estate can do that today.**

`src/persistence/` has three adapters behind one interface. The node adapter is
the closest, and it is not sufficient as written:

- No parent-directory fsync after `rename`. `_writeKey` syncs the FILE at `:187`
  then renames at `:191` with nothing after. The rename itself can be lost.
- `transaction()` is a promise-chain mutex that ORDERS writes. Each write inside
  is a separate `_writeKey`. One transaction is not one atomic record.
- `save`/`delete` bypass that mutex entirely.
- The temp file has a fixed per-key name, so two writers to one key collide.
- The cross-process lock is advisory, and the file says so.

The header comments describe the finished POSIX recipe — "write tmp, fsync tmp,
rename → dst" — and stop one step short of it.

Then, separately: **no adapter is wired anywhere it would be needed.** The
bridge wires none. The relay wires none. `AxonaManager` has no persistence at
all, though `AxonaPeer.js` says "Axon-role state is owned by AxonaManager and
persisted at that layer (deferred to AxonaManager P4-followup)".

And where peer persistence IS wired it is deliberately deferred: a dirty-set
with `_persistFlushMs = 5000`, force-flushed on `leave()`. A five-second
debounce cannot carry "durably record before voting". What is needed is an
awaited durable completion — a `commitRecord` API resolving only after a
specified durable boundary, serialising competing writes, failing closed, and
writing ONE atomic per-generation record.

Browser participants need their own fault model. The IndexedDB adapter's
read-compute-write wrapper is not an atomic read-modify-write across tabs, and
quota eviction is a real loss mode. **An unsupported participant must block
retirement rather than count as prepared.**

## 4. Missing facility — role identity

Roles carry no generation id and no instance id. `role.epoch` exists but
separate roots can mint the same number, so it does not identify a generation.

Everything in §5D and §6 depends on comparing generation and role-instance
before a delayed write. There is nothing to compare against. This is the
prerequisite that blocks the most other work, and it is cheap relative to the
rest: a field, a mint site, and propagation through the frames that carry role
state.

## 5. Missing facility — channel incarnation and operation sequence

§6 compacts retirement fences using registered channel incarnations, monotonic
per-channel operation sequences, `RELEASED(Q, lastSentSequenceByChannel)`, and
contiguous acknowledgement through each declared last sequence.

**None of that exists.** There is no channel incarnation and no per-channel
operation sequence in the transport. Replay protection today is content dedup by
`msgId`, plus `_beaconSeen` for beacon floods.

Content dedup and a replay floor are different things and one cannot stand in
for the other. `msgId` dedup answers "have I seen this exact message". A floor
answers "is every operation from this channel up to N accounted for". The second
is a completeness claim over an ordered channel, and the kernel has no ordering
to make it over.

This is the largest missing piece. It is a transport-layer facility with its own
lifecycle, restart semantics and tests, and §6 already says the first tranche
may retain fences rather than compact them. That is the right call: fence
retention needs no new transport, fence COMPACTION needs all of it.

## 6. The async continuation surface

Timers are the visible part and not the largest. Seven timer sites capture a
topic and fire later: `AxonaManager` `:812`, `:1126`, `:1138`, `:1431`, and
`repairPlane` `:569`, `:980`, `:1090`. The self-rescheduling SUB retry chain at
`:1126` re-arms while `wants() && mine()` hold, both evaluated at fire time.

The larger surface is ordinary `await`: repairPlane 20, wireHandlers 20,
syncEngine 8, AxonaManager 1, plus 18 `.then()` continuations. Any of these can
resume after a gap and write role state; `repairPlane` alone re-reads
`axonRoles.get` at 7 sites. Each is a place where a continuation may touch a
role that is no longer the role it was reading.

Making these generation-safe is mechanical once §4 exists and impossible before
it.

## 7. Where I was wrong, since it bears on how to read the rest

Three claims in this audit were corrected by review before they were relied on:

- I called the node persistence adapter "genuinely durable, crash-safe". It is
  not; the five gaps in §3 came from a second reading after Aster's challenge.
  I had taken the header comment for the contract.
- I called the replica bookkeeping "already two-sided". A consumed routing
  verdict is not an authenticated, generation-bound grant acceptance, and the
  `attempted` map is diagnostics rather than a pending-grant ledger.
- I wrote that dropped or errored ingest payloads "were never accepted in the
  protocol's sense". That is renaming a state to erase it. What their senders
  and callers already acknowledge has not been audited, and uncertain prior
  acceptance must BLOCK prepare.

## 8. The smallest coherent offline tranche

Not a plan to deploy. The smallest piece that is worth building and can be
reviewed on its own:

**The pure classifier and the creation/deletion inventory as executable code.**
`classify(role) -> ACTIVE | EMPTY_CANDIDATE | BLOCKED_UNKNOWN` with reason
codes, plus an `ensureRole` funnel that routes all four allocation sites through
one gate and records cause — **with live eviction behaviour unchanged**.

That tranche is implementable on today's kernel, needs none of the three missing
facilities, changes no behaviour, and produces the thing every later stage
needs: an honest per-role answer to "why is this here" and a single place where
roles come into existence.

Everything beyond it waits on §3, §4 and §5.

## 9. What is not established

This is a source audit, not a deployed-image census and not a runtime
attribution. It does not establish which allocation path produced west's role
count, that any listed gap has caused an incident, or that the tranche in §8 is
sufficient for anything beyond its own scope. Orion's independent protocol
challenge is outstanding and §5C's blocking question — every frozen participant
must vote, and an unreachable peer cannot be dropped — is unanswered.
