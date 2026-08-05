# Session Supervisor — a session that was once alive stays alive, or is visibly rebuilding

**v0.2 · 2026-08-05 · kernel 4.59.2 on testnet and prod (read from `/healthz` at time of writing) · status: DESIGN, nothing implemented — confirmation semantics DECIDED by council (Aster seq 309, Orion seq 310, same day); supervisor mechanism revised per Aster's critique**

**Prompted by:** the live capture of 2026-08-05 (issue #436): a browser session
slept overnight and woke deaf for ten hours. **Relates to:**
[Architecture §XII](Axona-Architecture.tex) invariants I-3, I-6, I-9, I-14,
I-15, S6 · #374 (graduation tears down mesh) · #86/#87 (the demo's resume
accelerator, the first patch of this class) · #405/#436 (the axona-chat wedge
and its app-layer fix, v0.47.0) · #428 (Howard: a node describing its own
session) · programmer-guide recipe 4.12, which this note exists to make
unnecessary.

---

## The question

When a session dies without exiting — the lid closes, the tab suspends, the
process freezes — who is responsible for noticing, and who is responsible for
coming back?

Today the answer is: partly the kernel, partly nobody. The kernel owns three
recovery layers and each works. The socket reconnects with backoff (1 s
doubling to a 16 s cap, re-handshake on every reopen). A graduated client
re-dials the bridge when its bound-peer count falls below the graduation
floor. Adaptive renewal re-seats every subscription on its own cadence. What
no layer owns is the session as a whole, and the capture shows what lives in
that gap.

## The evidence

On 2026-08-05 a Chrome axona.chat session (app v0.45.0, kernel 4.59.2,
bridge.axona.net) slept overnight. Its last received message is timestamped
06:43Z. It woke displaying "Seeking Peers" and stayed there until observed at
roughly 20:00Z — while a standing relay watch on the same topic received
every message the window missed, so the topic itself was healthy.

The sharper half: a message typed into the wedged window at 16:42Z rendered
as sent and reached no one. With zero peers, the routed PUB terminated at the
local node, which rooted the topic on itself, stamped the message, and
delivered its own echo — the exact idiom the programmer guide teaches as
delivery confirmation. The echo is real. The delivery is not. The message
existed nowhere but that machine's memory.

The application was polling `peer.peers().length` every five seconds
throughout. It used the number to repaint a status label. This is I-6's
failure mode one level up: the observability surface existed, reported
faithfully, and drove nothing.

Two more instances of the same class, for scale: Howard reported a reply that
"disappeared" the same morning, and a second of the operator's own windows
wedged identically. Every long-lived session on a machine that sleeps is
exposed — browser tabs, laptops running host nodes, phones, and servers that
suspend.

## What this is not

**Not persistence of the transport identity.** Recovery mints a fresh
transport, which mints a fresh `nodeId` and keypair. I-15 requires this, and
nothing is lost by it: the mesh healed around the old identity hours ago, and
a node returning under an old id gains nothing. The author identity — the
durable one — is untouched.

**Not an acknowledgment channel.** No wire change of any kind. Confirmation
remains observation (I-9). What changes is that the observation stops being
able to lie (§ Honest confirmation, below).

**Not a replacement for application health checks.** A supervisor cannot know
that "healthy" for a chat app means its unconfirmed sends were replayed. The
app-layer pattern (axona-chat v0.47.0, guide recipe 4.12) remains correct as
defense in depth. What the supervisor removes is the obligation for every
application to reimplement the transport-liveness half, which is the half
apps get wrong by omission — the recipe exists because four applications
needed it and one had it.

**Not new behaviour under partition.** A session with zero peers on a network
that is genuinely down rebuilds into the same empty room, on capped backoff,
forever. That is the correct behaviour: a session that gives up is the
present bug.

## The mechanism

Three parts: detect, decide, rebuild. All local, all inside the kernel.

### Detect — on the one clock

`refreshTick` is already the single scheduler (S6). The supervisor is a
scheduler unit on that tick, never a second timer. It watches two things:

- **Suspension.** Record the expected next-tick time; a tick arriving more
  than `SLEEP_GAP_MS` (default 30 000) late means the host slept or the
  runtime was suspended. Timers do not drift thirty seconds on a live page;
  the false-positive source is a blocked event loop, and a node whose loop
  blocks for thirty seconds needs the same medicine.
- **Wedge.** The synaptome has been empty for `STUCK_MS` (default 25 000)
  *after the session was at least once connected*, while the environment
  reports online where an online signal exists. The once-connected guard
  keeps the supervisor out of bootstrap, which `connect()` already owns. The
  25 s default gives the transport's own 16 s-capped reconnect backoff a full
  cycle to win first; both constants ship tunable and the defaults carry that
  reasoning, per the timing-table rule.

Each firing names its kind — `slept`, `stuck`, or both (I-14). A wake with
peers still present fires nothing.

### Decide — rebuild only when nothing is left to lose

The recovery predicate requires an empty synaptome. This resolves the
tension that would otherwise sink the design: a rebuild is an ungraceful
death of the old node — no `leave()`, no handoff, roles abandoned. On a
loaded relay a false-positive rebuild would be a self-inflicted churn event.
But a node with zero peers cannot hand off anything to anyone; its roles are
already unservable and its held state is already unreachable. Rebuilding at
zero peers destroys nothing that is not already destroyed. A node with even
one peer is left to the existing per-layer machinery, which has a path.

Attempts back off from `RETRY_INITIAL_MS` (10 000) doubling to
`RETRY_MAX_MS` (60 000), reset on a rebuild that reaches peers. There is no
attempt cap.

### Rebuild — new node, same peer

The supervisor tears down the transport and re-runs the bootstrap that
`connect()` performs, behind the same `AxonaPeer` object:

1. Stop the old transport; drop its socket, mesh, and pending negotiations.
2. Construct a fresh transport via a rebuild callback that `connect()`
   installs at session creation — the supervisor does not know how to build
   transports, only when to ask.
3. Fresh `nodeId` and transport keypair (I-15).
4. Re-run join and self-integration (the #375/#380 path).
5. Re-issue `SUB` for every entry in the subscription registry, each with its
   per-topic `since` watermark from the topic store, so the deaf window
   replays rather than gaps.
6. Restore `host()` topics the same way.
7. Emit `session-recovered { cause, gapMs, attempt, oldNodeId: never }` —
   the old nodeId is not logged; a recovery log that chains transport
   identities is a correlator (I-15's reasoning applies to logs).

The application-facing surface survives untouched: same peer object, same
handlers, same subscription list, same author. An application that does
nothing gets a session that comes back on its own.

The supervisor's own code path must satisfy I-3: every step wrapped, every
failure lands in the backoff loop, and a rebuild that throws is a logged
retry, never a dead supervisor.

### Where it fails

Named rather than discovered later. A suspended machine whose *network*
changed (new Wi-Fi, new IP) rebuilds correctly by construction — nothing of
the old endpoint survives. A machine that sleeps *repeatedly* in under 25 s
windows oscillates without ever triggering; the per-layer machinery carries
that case. A wedge that leaves ghost peers in the synaptome — entries the
mesh believes are open but are not — defeats the zero-peer predicate; that
is a liveness-accounting defect in the mesh layer and is out of scope here,
but the supervisor makes it *more* visible, not less, because a session with
ghost peers and no traffic now has exactly one suspect.

Two further classes, constructed by review (Aster, seq 309) and adopted:

**Positive-but-useless connectivity.** The synaptome can hold a live-looking
edge while a topic's SUB has lost its path to any root, or while the
remaining peers sit in a partition that cannot route to that topic's region.
`peers > 0` then suppresses the supervisor forever on a session that is
equally deaf. Silence on a topic is not evidence either way — quiet topics
are valid. The revision: each subscription carries a **service witness** — a
successful renewal, an answered empty-replay ping, or root contact within
its bounded cadence — and a subscription whose witness lapses triggers
**topic repair first**; only a session-wide witness loss escalates to
transport rebuild. The invariant is amended accordingly: a nonzero synaptome
is not evidence of subscription health.

**The watermark boundary.** Replay filters strictly `publishTs > since`, so
re-issuing SUBs is not by itself proof the deaf window replays whole. The
supervisor must snapshot the per-topic high-water registry **before**
old-session teardown and hand it to the rebuild, and the fence needs a
message-at-the-boundary case — equal stamps and clock-skewed root stamps
included — plus a post-recovery root contact confirming the SUB actually
seated. "SUB re-issued" is not evidence it reached a root.

## Honest confirmation — DECIDED: a confirmation surface, not a second delivery

The island publish is a separate defect from the wedge and survives the
supervisor: any zero-peer instant is enough to mint one. The kernel holds
ground truth the application can only approximate: it knows whether the
stamping root was itself.

The council resolved the fork the same day this note was posted, and both
reviewers chose the same shape independently. **Exactly-once application
delivery stays strict.** The island case is an observation problem, not a
reason to make every consumer deduplicate a second body. The callback
delivers once; confirmation is a separate, local, opt-in surface:

- `pub()` gains an optional observation handle, installed **before
  dispatch**, that resolves only when the kernel sees the same `msgId` at a
  **non-self root** — a network echo or replicate acceptance naming another
  node.
- The handle reports **evidence, not durability**. A network-root
  observation and durable cohort replication are distinct facts, and the
  surface must not let one impersonate the other (Aster's phrasing,
  adopted verbatim as the contract).
- Delivery `meta.selfStamped` may still ship as advisory context, but it is
  not the confirmation mechanism and carries no dedup implications.

Provenance-aware dedup — delivering once more when the only prior instance
was self-stamped — is **rejected**: it would redefine exactly-once for every
consumer to patch an observation gap that a dedicated surface closes without
touching delivery semantics.

## What stays with the application

What *pending* looks like, whether unconfirmed messages are badged, queued,
or discarded, and whether to replay — product decisions. The replay
primitive itself comes from the protocol for free: `msgId` is
content-addressed and the standard body carries no timestamp, so re-issuing
the identical payload under the identical author is idempotent at the root.
A kernel-held opt-in outbox is conceivable and out of scope for v0.1.

## Invariant candidate

> A session that has ever been connected either holds a live service
> witness for every subscription, or is inside a bounded repair or recovery
> attempt, or is backing off toward one. No steady state exists in which a
> once-connected session is deaf and idle — and a nonzero synaptome is not,
> by itself, evidence of health.

Fence: a fake-clock smoke (the #154 fault-injection clock) that freezes
timers, kills the transport, advances past the gap threshold, and asserts:
old subscription handles stopped and the watermark registry transferred,
same `AxonaPeer` object, new `nodeId`, each SUB re-seated with a service
witness, a boundary-timestamped message not lost or duplicated, and a
publish from a second node delivered post-recovery. A separate case covers
the positive-synaptome topic-blackhole path as repair-without-rebuild. Live validation: the laptop-lid
protocol — sleep a real session overnight against prod, assert recovery
without reload; REPS ≥ 5 before any percentage is quoted.

## Sequencing and compatibility

Additive and local; no flag day, no wire version, mixed fleets unaffected.
Default on inside `connect()`; `{ supervise: false }` opts a harness out.
Ships kernel-side after the current review queue; the design gate is this
note surviving a council round, and the implementation gate is the fake-clock
smoke existing before the mechanism (no behaviour change without a disproof —
the smoke is the repro, run against the current kernel, where it must fail).
