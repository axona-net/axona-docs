# Session Supervisor — a session that was once alive stays alive, or is visibly rebuilding

**v0.1 · 2026-08-05 · kernel 4.59.2 on testnet and prod (read from `/healthz` at time of writing) · status: DESIGN, nothing implemented — for council critique**

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

## Honest confirmation — the harder half, partly open

The island publish is a separate defect from the wedge and survives the
supervisor: any zero-peer instant is enough to mint one. The application
today defends with a heuristic — count the echo only if `peers() > 0` at
arrival. The kernel holds ground truth: it knows whether the stamping root
was itself.

The additive surface: the subscription callback gains an optional second
argument, `meta`, carrying `selfStamped: true` when the delivering root is
the local node. Existing handlers ignore it; no envelope field changes,
because the envelope is a signed wire object and stays one (I-9, I-15 — the
wire never carries node knowledge, and this knowledge never touches the
wire).

**The open question is the dedup interaction.** Delivery is exactly-once per
msgId. If the island echo consumed the one delivery, the later genuine
arrival — after recovery and replay — is suppressed, and the application
never sees the confirming echo. Two candidate shapes, unresolved:

- *Provenance-aware dedup:* a delivery whose only prior instance was
  self-stamped may deliver once more when it arrives network-stamped. One
  extra bit per dedup entry; the app sees at most two deliveries, the second
  flagged. Cost: "exactly-once" becomes "exactly-once per provenance," which
  every consumer must understand.
- *A confirmation surface instead of a second delivery:* `pub()` gains an
  optional confirmation promise resolving when the kernel observes the
  message at a non-self root (replicate acceptance or network echo), leaving
  delivery semantics untouched. Cost: new bookkeeping keyed on outstanding
  publishes, and a second way to learn the same fact.

The note deliberately does not choose. The council should, because the
choice sets what "exactly-once" means in every future application.

## What stays with the application

What *pending* looks like, whether unconfirmed messages are badged, queued,
or discarded, and whether to replay — product decisions. The replay
primitive itself comes from the protocol for free: `msgId` is
content-addressed and the standard body carries no timestamp, so re-issuing
the identical payload under the identical author is idempotent at the root.
A kernel-held opt-in outbox is conceivable and out of scope for v0.1.

## Invariant candidate

> A session that has ever been connected either has peers, or is inside a
> bounded recovery attempt, or is backing off toward one. No steady state
> exists in which a once-connected session is peerless and idle.

Fence: a fake-clock smoke (the #154 fault-injection clock) that freezes
timers, kills the transport, advances past the gap threshold, and asserts:
same `AxonaPeer` object, new `nodeId`, subscriptions re-seated, a publish
from a second node delivered post-recovery. Live validation: the laptop-lid
protocol — sleep a real session overnight against prod, assert recovery
without reload; REPS ≥ 5 before any percentage is quoted.

## Sequencing and compatibility

Additive and local; no flag day, no wire version, mixed fleets unaffected.
Default on inside `connect()`; `{ supervise: false }` opts a harness out.
Ships kernel-side after the current review queue; the design gate is this
note surviving a council round, and the implementation gate is the fake-clock
smoke existing before the mechanism (no behaviour change without a disproof —
the smoke is the repro, run against the current kernel, where it must fail).
