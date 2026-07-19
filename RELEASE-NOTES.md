# Axona Release Notes

Changes shipped in the protocol kernel (`@axona/protocol`) and the apps that ride
on it, newest-first and keyed to the kernel version. The currently *deployed*
build is always visible in each app's version row and at the bridge's
`/healthz`.

---

## v4.28.0 → v4.29.0 — pull returns the full envelope; root self-verify restored; chunk msgIds (2026-07-18)

**Testnet-bound. Wire-compatible (no flag day). One API-shape change — see the callout.**

- **`peer.pull()` now returns the full envelope (v4.29.0, API-shape change).**
  The pull response always carried the stored envelope over the wire, but the
  client handler unwrapped it to the bare message body at the last step —
  discarding `msgId`, `ts`, and the signature. Publish-confirm loops comparing
  `env.msgId` could never succeed, and pull-then-act flows (kill / reply /
  verify by msgId) were impossible. `pull()` now resolves the same envelope
  shape a `sub()` callback delivers, as its docstring always promised.
  **Migration:** code that treated the pull result as the message body itself
  should now read `result.message`. Code already written against the
  documented envelope shape (`result.message`, `result.msgId`) needs no
  change and simply starts working.
- **Root self-verification restored on standalone peers (v4.28.1).** The
  default dht adapter's `lookup()` returned a bare id while every consumer
  reads `r.path`, so the periodic root verify, the iterative strand-escape,
  the empty-root probe candidates, and the leave-handoff heir fallback were
  silent no-ops on every standalone peer (browser `connect()`, scripts, MCP).
  A spurious or overtaken root claim now self-verifies via iterative lookup
  and demotes/re-homes — the enabling fix for the warm-topic live-delivery
  gap and the cold watcher-first split. New end-to-end gates:
  `smoke_default_adapter_lookup`, `smoke_interloper_convergence`,
  `smoke_pull_envelope`.
- **`receiveChunkedBytes` reports chunk msgIds (v4.28.0).** The reassembled
  file object now carries `file.msgIds` (one per chunk) so applications can
  `kill()` chunk data once consumed.

## v4.10.1 — metrics rebuilt (+ message counter) & cohort-aware read/host paths (2026-06-30)

**Testnet only; production stays on 3.x. Wire-compatible (WIRE 4.0, no flag day).**

A post-v4.10.0 API audit against the cohort invariant found three paths that still
assumed a single deterministic root:

- **Metrics were dead on 4.x.** `AxonaManager.rootedTopics()` — the producer the relay
  metrics-loop walks — was dropped in the v3.12 routing-only clean break, so
  `peer.rootedTopics()` returned `[]`, no snapshots were published, and `peer.metrics()`
  returned stale/zeros for every topic since the v3.14 flag day. Rebuilt, and each
  snapshot now carries **`current_count`** (messages in cache) and **`seq`** (the root's
  dense message counter — a monotonic high-water of total events emitted) alongside
  `subscribers`/`bytes`/`descriptor`.
- **`peer.metrics()` is cohort-aware.** It collects every co-hosting root's snapshot and
  aggregates: **sum** `subscribers` (topic-wide total), **max** `current_count`/`seq`/
  `bytes` (they converge via anti-entropy), plus a new `cohortSize`.
- **`pull` and `host`** now route via the lookup-assist hint (like publish/kill) instead
  of a bare greedy walk that stranded — `pull` no longer returns a false "no message" and
  a `host`'s initial announce no longer waits a tick to heal.

New smokes: `smoke_rooted_topics` (12/12), `smoke_read_routing` (6/6). Full kernel suite
green; Howard 12/12 warm.

## v4.10.0 — K-closest cohort distribution: reliable delivery + consistent kills under churn (2026-06-30)

**Testnet only; production stays on 3.x. Wire-compatible (WIRE 4.0, no flag day).**

A message — publish *or* kill — issued just after churn used to reach only the single
closest root, so a subscriber that joined and homed on a *different* co-hosting node
could silently miss it. A kill made that loss conspicuous (a deleted message
reappearing); a plain publish lost it silently. The fix generalises distribution:

- **Eager K-closest cohort distribution.** The instant a root stamps a publish or
  applies a kill, it pushes the stamped delta to the topic's `findKClosest`
  cohort — the true closest-K, the exact set a subscriber can attach to — not just
  its direct mesh neighbours. Cohort members union-merge what they receive
  (anti-entropy), so they converge on the same history *and* the same retractions.
- **Single-stamp ordering preserved.** Only the root stamps (root-time, v4.9.1);
  cohort members adopt the stamp, never re-stamp — convergence never reorders a topic.
- **Warm backup roots.** A singleton root replicates its cache to its `rootReplicas`
  (default 2) nearest nodes; on churn a backup already holds everything and promotes.
- **Migration carries retractions.** Catch-up (replay-up), graceful hand-off, and
  backup replication now carry tombstones alongside messages, applied first — a
  killed message can't resurface when history moves to a new holder.
- **Retraction delivery scoped to holders.** A `since:'all'` joiner that never
  received a message (posted then killed before it joined) gets no spurious
  `{deleted}` event for content it never held.

**Results:** Howard's CivilDefense regression suite **16/16 warm** (was 7/12); the
restart-under-churn harness recovers **16/16** no-kill and **10/10** with-kill, no
leaks. New option `new AxonaPeer({ rootReplicas })` (0 disables cohort replication).

## v4.8.2 — `peer.ready()` mesh-readiness signal (2026-06-27)

**New API: `await peer.ready()`.** Subscribing the instant after `join()` — when
the synaptome is still just the bridge — strands the SUB in a not-yet-formed mesh,
which then heals only over slow renewal cycles (observed: 16–36 s first delivery,
or hangs past a test's timeout). `peer.ready()` lets an app await convergence
before its first `sub`/`pub`:

```js
await peer.join();
await peer.ready({ minPeers: 4, timeoutMs: 8000 });   // then sub/pub
```

It resolves as soon as **either** `synaptome.size >= minPeers` (a healthy mesh
formed — typically <1 s on a populated bridge), **or** the synaptome stops
growing for `stableMs` (a small/relay-poor mesh converged to whatever is
available — so a 3-node mesh resolves at 2, never hangs waiting for an
unreachable count), **or** `timeoutMs` elapses (`ready:false`, never throws).
Returns `{ ready, peers, ms, reason }`.

This is the kernel-owned replacement for a hand-rolled "wait for N synapses"
loop. Validated against the civildefense Jasmine suite: with `ready()` gating the
subscribe, initial-phase delivery dropped from 16–36 s to **5–18 ms** and the
full suite went from ~0 to passing reliably (the residual restart-phase flake is
the separate convergence-after-churn item). Additive API; wire-compatible.
Guarded by `test/smoke_mesh_ready.mjs`.

## v4.8.1 — bridge excluded from topic-root candidacy + STRICT_VERSION (2026-06-27)

**Live cross-peer flakiness fix (partial — see note).** Diagnosed via hop-trace on
the live testnet: the signaling bridge is in every peer's synaptome and is
XOR-near same-region topics, so `findKClosest`/`_rootHint_` and the greedy hop
selectors picked the **bridge** as a topic's root. The bridge can't serve as a
pub/sub root, so the routed subscribe-k funneled to it and the tree never formed
(`role=—` everywhere, 0 delivery). `findKClosest`, `_greedyNextHopToward`, and the
`route_msg` forward loop now skip `transport.bridgeNodeIdBig` — the bridge brokers
connections, it is never a topic root.

**Note:** this is necessary but not alone sufficient on a *contended* region —
where many foreign nodes share the region's keyspace prefix, the closest node can
still be a non-cooperating foreign peer. Empirically, an uncontended region is
100% reliable; a contended one improves but remains flaky until the foreign nodes
are isolated (see STRICT_VERSION) or a liveness-based root fallback lands.

**STRICT_VERSION island.** The client-hello now carries `kernelVersion`, and the
bridge gained an optional `MIN_KERNEL_VERSION` env: when set, it rejects (close
4426) any client whose kernel is missing or below the floor. This lets an operator
isolate a single-kernel island (testnet now floors at **4.8.1**), excluding older
4.x nodes that can't serve as roots. Default unset — no gate. Wire-compatible
(additive hello field; no flag day).

## v4.8.0 — hosted-topic cache migrates to a new root (durability fix) (2026-06-27)

**`host()` durability fix.** A node that `host()`s a topic is a durable
cache-bearer that holds the feed without being an app subscriber. When the
topic's emergent root departed and a *different* node was promoted to the fresh
(empty) root, the host's cache **stayed stranded below the new root** — new
subscribers attached to the empty root and a `since:'all'` replay returned
nothing, even though the bytes were still alive on the host. Root cause: the
hosted-topic re-announce in `refreshTick` used a raw `subscribe-k` that omitted
the `hw` high-water field, so the new root never learned the host held history
and never issued the `PULLUP` that pulls a behind root's cache up. Hosted topics
now re-announce through the same `_sendSubscribe` path as ordinary relays, which
advertises high-water — so the host's history **migrates up to whichever node is
the current root**, following the root as it moves under churn. This makes
`host()` an effective opt-in durability mechanism: a stable node hosting a topic
keeps its history recoverable across the churn of volatile (browser) roots.
Validated end-to-end against a real WebRTC bridge (backlog + live fan-out both
recover after the original root leaves) and guarded by
`smoke_pubsub_host_durability.mjs`. Wire-compatible; no flag day.

## v4.7.1 — fix flaky cross-peer delivery (one-sided beacon re-home) (2026-06-27)

**Pub/sub delivery fix.** When a topic's tree formed a chain (subscriber → relay
→ root) and the relay demoted itself toward a closer root it learned from a root
beacon, it pinned its `upstream` to the new root but never sent the confirming
`subscribe-k`. The new root therefore never registered it as a downstream child,
so deliveries fanned out over the root's subscribers and **silently skipped the
relay's entire subtree** — the root cached the message while everyone below it
received nothing. This was the dominant cause of intermittent "subscriber never
gets the callback" hangs (reproduced ~50% of runs in an isolated 3-node test;
0% after the fix). The beacon-demotion path now emits the subscribe-k so the new
root seats the node and its subtree. Wire-compatible; no flag day.

## v4.7.0 — join-time self-integration + sim-configurable keyspace (2026-06-27)

**Self-integration on join (churn-recovery fix).** A freshly-joined node now
weaves *itself* into the mesh instead of waiting on background annealing:
`join()` calls the new `peer.integrate()`, which discovers the node's own
neighbourhood via `findKClosest(ownId)` and opens authenticated channels to it,
so the neighbours adopt it and it becomes reachable immediately. In simulation a
fresh node's reachability rises from a single-digit floor to ~90%+ in one pass
instead of leaning on slow ambient discovery — the substrate half of the churn
recovery gap (#259). Consumers call `peer.integrate()` non-blocking after start
(and on reconnect). Wire-compatible; no flag day.

**Sim-configurable keyspace (v4.4–4.6, folded into this cut).** `configureKeyspace`
shrinks IDs for large in-simulator meshes (production stays full 264-bit by
default); fast keypair-free sim node identity; a sub-quadratic `geo.js` routing-
table build (50k-node meshes build in ~seconds). All default-264/production-safe.

## v4.3.0 — metrics-via-publish (open + owned); `kill` is the only retraction (2026-06-25)

**Metrics are now a regular publish event.** A topic's root publishes a signed
metric snapshot to its derived metric topic (`metricTopic(T)`) every ~20 s — for
**both open and owned** data topics. `peer.metrics(topic)` no longer scatter-
gathers the K roots; it does a one-shot read of the latest published snapshot
(returns `{ current_count, subscribers, bytes, publishes, ts, signer, stale }`).
For a live dashboard, `sub(metricTopic(T), …, { since:'all' })` directly — one
subscription, latest snapshot + a rolling ~48 h trend.

**Owned-topic metrics are public.** Anyone who can derive an owned topic's id can
now subscribe to its activity metrics (subscriber/message/byte counts) without
holding the owner key. The topic's *messages* and *write* capability stay
owner-gated; only the activity counts are public.

**`unpub` removed, `touch` deprecated.** `peer.kill(topic, msgId)` is now the
single retraction primitive. `peer.unpub()` (bulk owned-topic queue removal) is
gone; `peer.touch()` (hold-time keep-alive) is a no-op kept for source compat —
keep a message current by re-publishing it (an upsert that resets the hold and
the 48 h ceiling).

**`since:'latest'` now returns the current value regardless of age.** It was
implemented as a ~1-second cache window (`now - 1000`), so a `since:'latest'`
subscriber got **no callback** when the topic's last message was published (by
another client) more than ~1 s earlier — the common retained/last-value case.
(`since:'all'` and any publish *after* subscribe both worked, masking it.) Now
the root replays its single newest cache entry regardless of age (a `latest`
flag on the SUB), then live-tails. Wire-additive; covered by `smoke_since_latest`.

Relay metric-publish loop → 20 s cadence, owned topics included (axona-relay
v0.22.0). Re-vendored into axona-peer (v4.3.0). Testnet only; production
untouched.

---

## v4.2.2 — keyspace hosting actually anchors topics (2026-06-24)

`peer.host()` with no topic ("host whatever lands near me" — the relay fleet's
default mode) set an internal `_hostKeyspace` flag that was **read nowhere** in
the routing-only kernel, so it volunteered nothing: a root role with no
subscribers and an empty cache was torn down on the next refresh, so a relay
never became a durable home for the topics in its keyspace neighborhood. Now a
keyspace host **retains any topic it has become root for**, staying an always-on
convergence anchor + replay store. Root-ness is still decided by routing (this
only protects roles the node legitimately won as terminus); non-root child roles
still tear down. Pinned by `smoke_keyspace_hosting`. This is why a cold channel
(e.g. axona-share's `public-images`) could fail to converge with the relay fleet
up — fixed. Wire-compatible point release (WIRE 4.0).

## v4.2.1 — std/chunk verify must not tear down a caller's subscription (2026-06-24)

`publishChunkedBytes`' verify+repair pass (and `receiveChunkedBytes`) called
`peer.unsub(topic)`, which stops **every** subscription on the topic — nuking a
caller's pre-existing persistent subscription. An app that keeps a live
subscription on the same topic it publishes to (axona-share's channel
reassembler) destroyed its own subscription the moment it posted, silently
(pub/sub are fire-and-forget). Fix: the verify/receive pass stops **only its own
`Subscription` handle** (`sub.stop()`), never the whole topic — a persistent app
subscription now survives untouched. Pinned by `smoke_std_chunk` case 11.
axona-share → v0.14.0. Wire-compatible point release.

## v4.2.0 — std/message: canonical pub/sub message convention (2026-06-24)

New `@axona/protocol/std/message` (`makeMessage` / `readMessage` / `readSender`):
the one body shape every Axona app publishes and renders, so any app displays any
app's messages. Fixes the cross-app `[object Object]` / non-display the reference
apps hit when each invented its own body shape (object vs string). Canonical body
`{ v, text, …extra }`; `readMessage` is tolerant (string | `{text}` | `{message}` |
any object → JSON), never `[object Object]`. **Standard for all apps** — see
[Message-Convention-v0.1](programmer-guide/Message-Convention-v0.1.md). All reference
exemplars converted (axona-minimal, the demo, the node example, axona-peer); pinned
by `smoke_std_message`. Additive std module — wire unchanged, no flag day. (v4.1.x
between 4.0.0 and here: root beacon + emit-on-promote + 24h default hold.)

## v4.0.0 — routing-only pub/sub + hermetic wire-4.0 partition (2026-06-24)

Major, breaking, flag-day release. The pub/sub layer is now the **routing-only
axonic tree** (the v3.14 clean-break `AxonaManager` rewrite): every operation is
a single DHT `routeMessage` toward the topic id, delivered to the emergent root
(the closest live node), which assigns the one monotonic timestamp; overload
delegates to child relays (depth ~log₂₀N, fan-out ≤20); durability via
stamped-replay-up. The v3.15 line added **non-blocking lookup-assisted
subscribe/publish** (escapes greedy local-minima on a sparse mesh without
blocking on the iterative lookup) and fixed **`since:'all'` replay** (backlog +
gap recovery).

`WIRE_VERSION` is promoted **3.0 → 4.0**: these behavioral changes mean a pre-4.0
peer on the same wire 3.0 cannot safely interoperate, so the wire major now
reflects it. wire-3.x and wire-4.x reject each other at the bridge gate
(`REQUIRED_WIRE_MAJOR='4'`) and the peer↔peer handshake — a hermetic partition.
Whole-fleet flag-day: kernel v4.0.0, bridge v2.36.0, peer v4.0.0, relay v0.21.0,
dht-sim vendor v0.104.0. Deployed to **testnet only**; production stays on its
current stable kernel.

## v3.6.0 — std/chunk: reliable publish (fix reload-reassembly timeout) (2026-06-20)

Bug fix + small behavior change in `std/chunk`. `publishChunkedBytes` defaulted
`throttleMs: 0`; since `peer.pub` is fire-and-forget into the transport buffer, a
fast burst of chunks dropped some before they reached the topic's replay cache —
so a **reload** subscriber (relying on `since:'all'` replay) got an incomplete set
and `receiveChunkedBytes` timed out, with no throttle value an author could
reliably pick. Now it paces by a sensible default **and** verifies what the mesh
cached, re-publishing any gaps (best-effort; never throws). Reaches apps that use
`@axona/protocol/std/chunk` — re-vendor/redeploy the app to pick it up.

## v3.5.1 — kill() now reaches remote subscribers (2026-06-20)

Bug fix (wire-compatible). `peer.kill(topic, msgId)` removed the message at the
root but a **remote** subscriber's handler was never invoked with
`{ deleted: true }` — the message just silently vanished from replays. Cause: the
delete marker was fanned to subscriber-children over `pubsub:deliver` carrying
`postHash = msgId`, and the receiver deduped it against the *original* message's
delivery (same `topicId:msgId` key), dropping it. (Self/local subscribers were
unaffected.) Fixed: a node now recognises a delete frame, purges + tombstones the
content without caching the marker, re-fans it down the subtree, and delivers it
to the app keyed on the kill id — so `deleted: true` reaches every subscriber.
Regression test `smoke_kill_remote`. **Subscribers must be on kernel ≥ 3.5.1 to
receive the callback** (the fix is on the receiving side).

## v3.5.0 — `peer.metrics()` is owner-only (2026-06-20)

Behavior change (wire-compatible). The metrics scatter-gather answers only the
owner of an owned topic; open/public topics are refused — read their live state
by subscribing to `metricTopic(T)`. Removes the last arbitrary-peer K-root
fan-out probe. See the SECURITY-CHANGELOG.

## v3.4.0 — derived metric topics (2026-06-20)

Additive. `metricTopic(T)`/`isMetricTopic` + `peer.rootedTopics()` in core; a
relay republishes signed metric snapshots to `metricTopic(T)` so clients
subscribe instead of polling `metrics()`. See the architecture note.

## v3.3.3 — re-publish upsert made correct across the multi-root mesh (2026-06-20)

Not a wire change. Three patch releases that take v3.3.0's re-publish-upsert from
"correct on a single root" to "correct on the live mesh, every path":

- **v3.3.1 — exactly-once delivery, keyed on msgId.** v3.3.0 deduped delivery on the
  random per-publish `publishId` and only suppressed re-fan-out when one root saw
  both publishes — so on the live mesh (several K-closest roots, each seeing one
  copy) a re-publish still **double-delivered**. `_deliverToApp` now dedups on the
  content id (`postHash` = msgId), so a message reaches the app **at most once**
  however many roots/paths carry it. The re-publish also fans out normally (instead
  of being suppressed) so **every replica** refreshes its own hold — a re-publish is
  a *fleet-wide* keep-alive, not a single-root one.
- **v3.3.2 — cache upsert centralized.** Moved the "one entry per msgId" upsert into
  `_addToReplayCache` so every ingress path (routed publish, direct publish-k,
  sub-axon deliver, replay re-cache) converges to a single entry — closing a residual
  double-*cache* on keyspace-hosting roots that received a copy via the deliver path.
- **v3.3.3 — content id always present.** The upsert key is now backfilled from the
  envelope's `msgId` when an ingress frame arrives without an explicit `postHash`, so
  the dedup can never be silently skipped for envelope content.

Net: re-publishing identical content (same author + message ⇒ same msgId) **replaces**
the older copy everywhere (one entry per msgId, newest — fresh hold + fresh 48h
ceiling) and is **delivered exactly once**. Re-publishing is the way to refresh /
keep a message alive; `touch`/`pull` still slide the hold but stay bounded by the
ceiling. `smoke_pubsub_republish` now also asserts the upsert directly (incl. the
postHash-absent path). Verified live on testnet: re-publish delivers once and every
current-kernel root holds a single copy.

Bumped: peer 3.46.3, relay 0.15.3, bridge 2.32.3, dht-sim vendor resync.

## v3.3.0 — re-publishing the same message upserts (replace older, deliver once) (2026-06-19)

Not a wire change. (Superseded by v3.3.1–v3.3.3 above, which make the upsert correct
on the multi-root live mesh.)

- The live publish path deduped only on the random per-publish `publishId`, so
  re-publishing identical content double-stored the replay cache and double-delivered.
- First cut: `_onPublish` + `_onPublishDirect` upsert by msgId on the root that sees
  both publishes. Correct in the single-root sim; incomplete on the live mesh (fixed
  in v3.3.1+). New regression smoke `smoke_pubsub_republish`; Programmer Guide §7.7
  rewritten to match.
- Bumped: peer 3.46.0, relay 0.15.0, bridge 2.32.0, dht-sim vendor resync.

## v3.2.0 — write default keyed on owner; topic ID as a read handle (2026-06-19)

Not a wire change (WIRE 3.0 unchanged); one topic shape relocates.

- **`write` defaults by `owner` presence.** No owner ⇒ the topic is `open` (`write`
  ignored). An owner ⇒ `write` defaults to `'owner'` (owner-only); pass
  `write:'open'` explicitly for an owner-namespaced open topic (inbox). So
  `{owner, name}` ≡ `{owner, name, write:'owner'}` — forgetting `write` can no
  longer silently leave an owned feed world-writable. Only the bare `{owner, name}`
  shape changes id (now the owned feed, previously the open inbox).
- **Topic ID is a shareable read handle.** `sub`, `pull`, and `metrics` accept
  either a descriptor or a bare 66-hex topic ID (from `deriveTopicId`). Publishing
  (and `kill`/`unpub`) still require the descriptor — a bare id is rejected, because
  the storing node must recompute the id from the descriptor to enforce the write
  policy (a hash can't reveal its owner). Share the ID to read; share the descriptor
  to write.
- Bumped: peer 3.45.0, relay 0.14.0, bridge 2.31.0, dht-sim vendor resync. New
  programmer-guide doc: `Topic-IDs-v3.2.0`.

## v3.1.0 — region resolution: explicit, else publisher node region; never author-derived (2026-06-18)

Wire-compatible point release on top of v3.0.0 (the envelope carries the resolved
region, so a v3.0.0 storing node and a v3.1.0 publisher derive the same topic id —
no flag day).

- A topic's region resolves to the explicit `region` in the descriptor, or — when
  omitted — to the **publisher's own node region** (top byte of its Node ID), and
  otherwise throws. It is **never** derived from the author key.
- Removed `keyDerivedRegion` (and `POPULATED_CODES`): an Author ID is location-free,
  so hashing it into a region produced an arbitrary cell that clustered onto a few
  populated regions — a manufactured hot spot. `POPULATED_REGIONS` is retained.
- `AxonaPeer` injects its node region at topic-resolution time (only the peer knows
  it). Discovering another author's feed now needs the Author ID **and** its region.
- Reference soak scenario `keyderiv` → `ownerdefault`; full kernel suite green.
- Bumped: peer 3.44.0, relay 0.13.0, bridge 2.30.0, dht-sim vendor resync.

## v3.0.0 — identity / authorship / addressing rebuilt (breaking flag-day) (2026-06-18)

WIRE_VERSION 2.0 → 3.0; the whole network moves together. Three separated
concerns — connection (node identity), authorship (author identity), addressing
(topic descriptor):

- `createNodeIdentity` (264-bit Node ID = region byte ‖ SHA-256(pubkey)) and
  location-free `createAuthorIdentity` (keypair only — no id, no region) replace the
  single `deriveIdentity`/`publishIdentity` surface.
- Topics are structured descriptors `{ region, owner?, name, write }`; the signed
  envelope binds the descriptor, and `topicId = regionByte ‖ SHA-256(canonical({owner,name,write}))`.
- **Write policy** (`open`/`owner`) enforced at the storing node at every ingress
  path (`WRITE_POLICY_VIOLATION`).
- `publishId` removed; per-event dedup is the content-addressed Message ID. Signing
  is `signWith`-only (an author, or the `ANONYMOUS` sentinel) — no default signer.

## v2.51.0 — publish identity required to sign (key separation enforced) (2026-06-16)

No wire/flag-day change, but a **behavior change** for publishers:

- `peer.pub` signs with `signWith ?? publishIdentity` and **no longer falls back to
  the transport identity**. A signed publish with neither throws
  `PublishError(PUBLISH_NO_PUBLISH_IDENTITY)`.
- Rationale: reusing one keypair for both the connection (transport) and authorship
  (publishing) is key reuse. Publishing is authored by a **publish keypair**; an app
  may hold several (per-call `signWith`). Signing with the transport key is possible
  only via an explicit `{ signWith }` — intentional and discouraged, never implicit.
- Migration: a publishing peer passes `AxonaPeer({ publishIdentity })` or per-call
  `{ signWith }`; `{ sign: false }` (anonymous) is unaffected. Reference apps updated
  (axona-share 0.11.0, axona-minimal 0.3.0, axona-peer 3.41.0).
- `smoke_dual_key` updated (refusal + explicit-override + anonymous cases); full
  suite (66 files) green.

---

## v2.50.0 — dual-key identity: publish identity decoupled from transport (2026-06-16)

Additive, backward-compatible, **no wire/flag-day change** (design note:
`architecture/Dual-Key-Identity-v0.1.md`):

- **A peer can sign publishes with a PUBLISH identity distinct from its
  (ephemeral) transport identity**, and run **multiple** publish identities
  through one peer:
  - `new AxonaPeer({ publishIdentity })` — default signing key for publishes.
  - `peer.pub(topic, msg, { signWith })` — per-call override.
  - Precedence `signWith → publishIdentity → identity (transport)`; omitting both
    keeps the historical single-key behavior, so existing apps are unchanged.
- Lets an app have **durable, recognizable authorship** (stable `signerPubkey`;
  `kill`/`unpub` of its own messages across sessions) **without** a stable
  transport id — the transport key stays ephemeral/unlinkable. Verified across a
  simulated transport-id rotation.
- The change is small because verification, per-publisher sequence, and
  `kill`/`unpub` ownership were already keyed on `signerPubkey`, not the
  transport node id. Publish-PoW (`role:'publish'`) remains inert at difficulty 0.
- Regression: `smoke_dual_key.mjs` (13 checks). Full suite (66 files) green.

---

## v2.49.0 — std/chunk reassembler handles a stream of files (2026-06-16)

App-layer fix in `@axona/protocol/std/chunk` (no wire/flag-day impact):

- **`createReassembler` is now multi-file.** It previously locked onto the first
  file's `fileId` and silently dropped every later file delivered on the same
  topic — so an app that reuses one reassembler per topic (e.g. an image channel)
  only ever reassembled the *first* file for receivers; later files reached the
  sender only through its own optimistic local render. The reassembler now tracks
  every file by `fileId` and fires `onComplete` once per file as each completes;
  foreign/garbage files still can't corrupt the one you want, and
  `missing()/have()/total()` take an optional `id`. Single-file callers
  (`receiveChunkedBytes`) are unaffected. Regression: smoke_std_chunk #9.

---

## v2.48.0 — publish IDs decoupled from the transport id (2026-06-16)

Foundational identity-model change (no wire/flag-day impact — `publishId` is an opaque dedup token):

- **`publishId` is no longer `nodeId:counter`.** It was tied to the transport id (so it carried the
  ephemeral node's S2 prefix) and the counter reset to 0 on every restart, which let a peer drop a
  genuinely-new publish as a duplicate (`_alreadySeenPublish` runs before the freshness gate). It is
  now a random, S2-free, collision-safe token by default, and **app-suppliable**:
  `peer.pub(topic, msg, { publishId })`. Closes the restart-collision bug outright.
- **New `@axona/protocol/std/publisher`** — `createPublisher()` / `persistentPublisher(key)`:
  mint, sequence, and (optionally) **persist** a publish-ID stream (browser-localStorage-backed by
  default), so a logical publisher stays continuous across restarts even though the **transport id
  is always ephemeral** — and an app can run many concurrent streams (one per channel / file
  transfer). This is the app-owned half of the identity split: transport id = ephemeral/unlinkable;
  publish id = app-controlled continuity. `test/smoke_std_publisher.mjs`.

Identity model (now explicit): **Transport ID** (S2-prefixed, ephemeral — never stored, recomputed
each start) · **Topic ID** (S2-prefixed, content/region-anchored) · **Message ID** (pure content
hash) · **Publish ID** (S2-free, app-mintable/persistable). Full suite green (65 files).

## v2.47.0 — std library, reliable-publish guard + larger byte-bounded replay (2026-06-16)

From the pub/sub stress campaign + a civildefense.io audit:

- **Relay/replay queue raised 100 → 1024 messages, with a 16 MB per-topic byte cap.**
  A 2 MB image chunked at ≤15 KB ≈ 175 messages — far over the old 100, so it was
  unreplayable (O-1). The count cap is now 1024 (`replayCacheSize`), paired with a byte cap
  (`replayCacheBytes`, default 16 MB) so a high count can't OOM a relay when entries are large;
  eviction honors whichever binds. Both configurable per `AxonaManager`.
- **Replay is now byte-framed (the real O-5-on-replay fix).** `_maybeSendReplay` (and root↔root
  `msgsync-resp`) previously sent the whole backlog in ONE `sendDirect` frame — at ≥16 KB/message
  that frame was undeliverable, which is why large-message topics returned **nothing** on reload.
  It now splits into many frames each `< 16 KiB` (`REPLAY_FRAME_BYTES`, `MAX_REPLAY_BATCH`
  decoupled from cache size). A 150-message backlog replays as ~75 wire-safe frames
  (`test/smoke_pubsub_bigbacklog.mjs`). `MAX_HAVE` trimmed to 200 so the subscribe digest frame
  also stays under 16 KiB; `MAX_RELIABLE_PUBLISH_BYTES` set to 15 KiB to leave headroom for the
  delivery wrapper. **Wire-compatible, no flag day.**

Two app-facing additions:

- **`@axona/protocol/std`** — a new sub-export (NOT kernel core): a standard library of
  app-layer helpers built only on the public `AxonaPeer` API. First module **`std/chunk`** —
  reliable large-payload chunking/reassembly: ≤16 KiB messages, completion by *distinct index*
  (not receipt count), a timeout that *rejects* (after a `pull()` re-request) instead of hanging,
  a manifest, garbage resistance, and a guard that refuses transfers exceeding the replay-cache
  ceiling. Replaces the divergent copies in civildefense + axona-share. `test/smoke_std_chunk.js`.
- **O-5 reliable-publish guard** — `peer.pub` now **fails loud** above the WebRTC-interoperable
  message floor (**16 KiB**, `MAX_RELIABLE_PUBLISH_BYTES`) instead of letting an unreceivable
  message be silently dropped mid-mesh. Rationale: a publish must be *receivable* by an arbitrary
  peer on an arbitrary browser across arbitrary hops, and SCTP `maxMessageSize` is floored by the
  weakest link — a sender-side or single-hop measurement is not a safe bound. Overridable per
  `AxonaPeer` (`maxPublishBytes`, capped at the 256 KiB absolute ingress limit) for controlled,
  known-homogeneous deployments only. The 256 KiB root-ingress abuse cap is unchanged.
  **Wire-compatible, no flag day** (purely a publisher-side guard).

## v2.45.0 — cold-start anti-entropy drain (2026-06-16)

Reliability: a freshly (re)started or newly-recruited keyspace host holds an
**empty replay cache** for every topic it roots. Root-to-root anti-entropy
(Fix 2) backfills it from sibling roots, but only `MSGSYNC_TOPICS_PER_TICK` (8)
topics per 10 s refresh tick — so a host rooting hundreds of topics took
*minutes* to converge after a restart, and **answered replays empty during that
window** (a subscriber whose K-closest landed on the cold host saw a partial or
empty `since:'all'` replay — the "reload → 0 / usually the last only"
nondeterminism after relay churn).

- **Kernel v2.45.0** — roles not yet reconciled even once ("cold") are now
  drained with a large per-tick budget (`MSGSYNC_COLD_BUDGET = 64`), *ahead* of
  the steady round-robin, so a restarted host converges in a tick or two instead
  of minutes. A role is marked `synced` once it has initiated reconciliation
  against a non-empty sibling set; a siblingless cold role stays cold and
  retries. **Zero steady-state cost** (no cold roles once warm); a one-time
  burst after (re)join. No wire change — `msgsync`/`msgsync-resp` unchanged, so
  **no flag day**. Regression `test/smoke_pubsub_coldstart.js`; full suite green.
- **axona-relay v0.10.6** — the process-level `uncaughtException`/
  `unhandledRejection` guards now log into the TUI's log panel instead of
  writing raw `console.error` over the dashboard frame (a caught bridge-blip 502
  no longer shreds the display). Behaviour unchanged — still catch-and-continue.

Re-vendor + deploy is the gated follow-up (relay/peer/dht-sim/bridge each update
independently — no cutover).

## v2.44.0 — re-subscribe (since:'all') re-delivers (2026-06-15)

Bug: unsubscribe a topic, then re-subscribe with `since:'all'` → the handler
never fired (and the related "missed alert until reload, fixed by zooming"). The
re-subscribe genuinely happened, but three per-topic structures survived the
unsub and each suppressed the redelivery `since:'all'` is supposed to produce:
the gap-safe **`have` digest** (the roots then think we already hold everything
and replay nothing — this masks even a `lastSeenTs = 0` floor), the legacy
**`lastSeenTs`** floor, and the exactly-once **`_appDelivered`** app gate.

- **Kernel v2.44.0** — new `AxonaManager.pubsubResetTopicConsumption(topicId)`
  clears all three for a topic; called from `pubsubUnsubscribe` and wired into
  `since:'all'` (`AxonaPeer._applySince`, with an older-kernel fallback).
  `_appDelivered` is now **topic-scoped** (`topicId:publishId`) so one topic
  resets without disturbing others. Touches only subscriber-side state — a node
  that also hosts the topic keeps serving. **Wire-compatible, no flag day.**
  Regression `test/smoke_resubscribe.js` (17 checks); full kernel suite green.
- **Re-vendored into all local apps** (each updates independently — no cutover):
  axona-peer v3.35.0 (axona.net), dht-sim, axona-relay v0.10.4, axona-bridge
  v2.27.0 (kernel pin → `#v2.44.0`, lockfile regenerated).

## v2.42.1 — bridge federation: a bridge bootstraps as a node (2026-06-14)

The two prod bridges were separate meshes, so a client on one couldn't discover
the other via the directory. Now a bridge is a node first: on launch it opens an
OUTBOUND uplink to a known bridge (env `BRIDGE_UPSTREAMS` ∪ persisted ∪ default
seeds, first reachable, self excluded), integrating its embedded peer into the
one shared connectome, then re-publishes its directory entry onto the shared mesh
and subscribes, persisting discovered bridges to `StateDirectory/bridges.json`
(seeds for next launch). Federation is automatic — every bridge is just a node
that joined normally.

- **Kernel v2.42.1** — `CompositeTransport.addSubtransport` now replays
  `onPeerBound` to late-added sub-transports (it previously replayed only
  request/notification/peerDied). Without this, a uplink added after
  `peer.start()` never propagated its bound peers into the synaptome. Additive,
  no wire change.
- **Bridge v2.23.0** — outbound uplink via the relay's `webTransport` +
  `node-datachannel`/`ws` polyfill (a CompositeTransport of inbound server WS +
  uplink); env `BRIDGE_UPSTREAMS`; `node-datachannel` loads lazily (off path
  unaffected); `/healthz` adds `uplink.{upstream,connected}`.
- **Verified live**: `bridge-west.axona.net` uplinks to `bridge.axona.net`; a
  client on either bridge now discovers BOTH. The root bridge stays uplink-less
  as the seed.

## v2.42.0 — bridge directory: discovery + failover (2026-06-13)

Bridges can advertise themselves on a public `axona:bridge-directory` topic so
clients can discover them and fail over when their configured bridge is down.

- **Kernel** — new `bridgeDirectory.js`: `BRIDGE_DIRECTORY_TOPIC`,
  `buildBridgeEntry` / `validateBridgeEntry` (signed `{url,lat,lng,label,ver,ts}`;
  `wss://` only), and `rankBridges` — the layered failover model (configured roots
  → bridges the client has personally bootstrapped through, by recency + latency →
  fresh signed third-party entries by proximity + tenure). Additive; no wire change.
- **Bridge** (`axona-bridge` v2.22.0) — publishes its entry on launch and once a
  day. New env: `BRIDGE_PUBLIC_URL` (advertised wss endpoint) and `BRIDGE_DIRECTORY`
  (`on`|`off`). The **testnet bridge sets `BRIDGE_DIRECTORY=off`** (independent
  fleet). `/healthz` now reports `directory.{enabled,url}`.
- **App** (`axona-peer` v3.34.0) — at launch, probes the primary first and fails
  over to a saved alternate if it's unreachable; once mesh-ready, does a one-shot
  subscribe to the directory, merges entries into a localStorage book (with
  first-party reputation: tenure, time-to-mesh, success/recency), then
  unsubscribes. The primary is never auto-replaced. The testnet host skips the
  directory entirely.

See SECURITY-CHANGELOG (v2.42.0) for the trust model.

## v2.40.3 — malformed-frame robustness centralized at the dispatch boundary (2026-06-12)

Code-quality follow-up to 2.40.2 — same guarantee, broader coverage, far less
surface. 2.40.2 wrapped all **27** pub/sub handler registrations in a guard, which
was brittle (a 28th handler could silently forget it) and incomplete (it only
checked `topicId`/`fromId`, not the other id fields handlers parse —
`subscriberId`, `publisher`, `peerRoots`, …). 2.40.3 removes that per-site guard
and moves the robustness **one layer down**, into the AxonaPeer dispatch boundary
that already wraps every handler:

- A corrupt sender id (`fromId`) — invalid for *every* subsystem, not just
  pub/sub — is dropped once, at the transport dispatch.
- Any handler that throws on *any* malformed id is contained and **classified**: a
  malformed-id error (now tagged `AXONA_BAD_ID` by `fromHex`) is logged as a
  debug-level churn drop; anything else stays a loud error. This covers every id
  field and every current-or-future handler automatically — no per-site guard to
  forget.

## v2.40.2 — malformed-frame guard now covers every pub/sub handler (2026-06-12)

Follow-up to 2.40.1. The same truncated `fromId` (a peer tearing down mid-
shutdown) also reached `_onSubscribeDirect` (the `subscribe-k` handler) and
others that 2.40.1 hadn't individually hardened. 2.40.1 had already stopped the
*crash* — the dispatch boundary catches the rejection — but the handler still
threw, producing noisy error logs. 2.40.2 drops the malformed frame at the
**registration boundary**, so it's silently ignored across the board.

- **One guard wraps all 27 pub/sub handler registrations.** A frame whose
  `topicId` or `fromId` is *present but malformed* is dropped before the handler
  runs. Absent ids stay valid (genuinely local-origin); a malformed *remote*
  `fromId` is **dropped, never coerced to `null`** — several handlers treat a
  null `fromId` as "locally originated ⇒ trusted", and this avoids that trap.
- **Regression test extended** (`smoke_msgsync_robustness.js`, 13 checks): the
  exact `subscribe-k` + truncated-`fromId` case is dropped before the handler,
  and well-formed frames still pass.

## v2.40.1 — a malformed frame can't crash a node (2026-06-12)

Patch over 2.40.0; no wire change. Reported by a host-node operator quitting many
nodes at once: a peer tearing down mid-shutdown delivered a **truncated `fromId`**
(3 chars), and the anti-entropy handler (`_onMsgSync`) parsed it with a throwing
`fromHex` — `RangeError: hex id must be 66 chars, got 3`. Because the handler is
`async`, that synchronous throw became a *rejected promise* the direct-dispatch
`try/catch` couldn't see, escalating to a Node `unhandledRejection` (process
death).

- **Handler hardening.** `_onMsgSync` / `_onMsgSyncResp` / `_onKillSync` now parse
  ids from received frames with a tolerant helper that **drops a malformed frame**
  instead of throwing.
- **Dispatch boundary.** The `AxonaPeer` direct-handler dispatch now catches an
  async handler's *rejection* (not just a synchronous throw), mirroring the routed
  path — so **no** direct handler can leak an `unhandledRejection`, defending the
  whole class, not just this one field.
- **Regression test.** `smoke_msgsync_robustness.js`: malformed `topicId`/`fromId`
  frames are dropped (well-formed ones still answered), and a throwing async
  handler produces no `unhandledRejection`.

## v2.40.0 — decoupled `host()` primitive: serve topics without subscribing (2026-06-12)

Wire-additive over 2.39.0, and uses **no new wire message**: a host announces with
the same `pubsub:subscribe-k` a subscriber already sends, so every existing kernel
recruits a host with no flag day (`WIRE_VERSION` unchanged at `2.0`).

- **`peer.host(topic)` / `peer.host()` / `peer.unhost(...)`.** Infrastructure
  nodes (relays) can now **store + serve** a topic for other peers *without*
  subscribing as a consumer. `host(topic)` serves one named topic; `host()` (no
  argument) volunteers the node for its **own keyspace neighborhood** — recruited
  as a root for whatever topics land near its id ("host whatever lands near me").
  A host registers no delivery handler and is never added to `mySubscriptions`;
  `health().hosting` surfaces the state.
- **Why it was needed.** A node only enters a topic's serving fabric once it's
  *discoverable* there, and the only action that announced a node used to be
  `sub()` — so a relay that meshed but never subscribed showed zero pub/sub roles
  forever. `host()` supplies the announcement without the consumer semantics. It
  respects the B-2 proximity gate: a host only ever roots topics it is genuinely
  K-closest to.
- **Relay v0.10.0.** Defaults to keyspace hosting (`RELAY_HOST_KEYSPACE=1`), so a
  relay participates with **zero topic config**; `RELAY_TOPICS` now *hosts* named
  topics instead of issuing no-op subscribes. Verified live: a fresh relay climbs
  to `roles=174, subs=0` within seconds.
- **Versions.** kernel `2.39.0 → 2.40.0`; bridge `2.20.0 → 2.21.0`; peer
  `3.31.0 → 3.32.0` (app `v0.40.0`); relay `0.9.3 → 0.10.0`; PoW benchmark
  `v0.16.0 → 0.17.0`; Axona-share `v0.7.0 → 0.8.0`.

## v2.39.0 — root-to-root pub/sub anti-entropy (2026-06-12)

Wire-additive (new `pubsub:msgsync` / `msgsync-resp` direct messages; no envelope
or identity change). A publish only reaches the *publisher's* K-closest root set,
which need not be a *subscriber's* — so a subscriber attached to a different root
could miss it. Roots now exchange digests of held content-ids with their K-closest
siblings and pull what they're missing. **Pulled messages are re-verified** — the
publisher signature (B-4) and the content-address are re-checked exactly as on
live ingress, so a sibling root cannot inject a forged or content-poisoned
message, and tombstoned (killed) messages are never resurrected. Closes the
residual divergence left after 2.37.0's subscriber-side fix.

## v2.38.0 — Ed25519 software fallback: old browsers can join (2026-06-12)

Older browsers without native WebCrypto Ed25519 (older Chrome, Samsung Internet,
many WebViews) previously couldn't derive an identity at all — `generateKey` threw
and the peer never connected. A vendored pure-JS Ed25519 fallback (`@noble/ed25519`
v2.3.0, over the universal `crypto.subtle.digest('SHA-512')`) lets them mint an
identity and join. Native devices are unchanged and keep the **non-extractable**
signing key (finding H4); the software key lives in JS memory and is therefore
extractable, so the H4 hardening is a native-only property — used only where the
alternative is "cannot connect." Signatures interoperate both ways (same RFC 8032
curve).

## v2.37.0 — gap-safe replay: no more silently-lost messages (2026-06-12)

Replay-on-(re)subscribe was filtered by a single high-water timestamp, which can't
represent a *hole*: once you'd received anything newer than a gap, that gap was
masked forever. Subscribers now report the content-ids they actually hold (a
bounded `have` digest in the subscribe payload) and a root replays exactly the
complement — a missed message is backfilled rather than lost. Wire-additive.

## v2.36.0 — kill convergence: a retraction survives reloads (2026-06-11)

Wire-additive (adds the `pubsub:kill-sync` direct message). A killed message
stayed killed only on the roots that saw the kill; a replica that missed it could
re-serve the message to a reloading subscriber — the reported "I killed it and it
came back" bug. Recently-applied kills are now re-gossiped to the current root
set, so a replica that missed the original kill removes and tombstones the
message.

## v2.32.0 — one name per region + production flag-day cutover (2026-06-08)

**Production cutover.** `axona.net` / `bridge.axona.net` migrated from the
`axona/4` / kernel-2.16 network to this `axona/5` line (bridge `2.15.0`, peer
`3.28.0`). It's a hard partition: pre-2.28 `axona/4` peers are refused at the
gate (WS close `4426`) and reload into the new line. The earlier `axona/4`
network is retired; the SF testnet (`testnet.axona.net`) now runs as the
**staging line ahead of `main`** rather than a separate epoch.

**One name per region.** Each of the 192 S2 region cells now carries exactly
**one** canonical name (previously two, one per sub-cell), so a region always
presents the same label — no location-dependent flip-flop. The collapse rule:
an ocean-half beside a land-half takes the land name; a multi-country cell takes
its dominant city; homogeneous cells keep their name. `regionName(code)` now
returns a string (no lat/lng half-arg); `regionNames(code)` is a deprecated
one-element back-compat shim. A name is usually unique to one code, but an area
larger than one cell may span adjacent codes — `regionCode` returns the
canonical (lowest) code. (Supersedes the 2.31.0 two-name scheme.)

## v2.29.0 — pub/sub replay backlog fix (2026-06-06)

Compatible minor on the 2.x epoch (`WIRE_VERSION`/`AUTH_PROTO` unchanged), so
2.29.0 interoperates with 2.28.0 and clears the bridge's `MIN_KERNEL 2.28.0`
floor. Surfaced on the SF testnet: two subscribers to the same topic got
*different* backlog on `since:'all'` — one received every prior publish, another
received none.

- **Root cause.** A node that is a K-closest **root axon** for a topic marks each
  publishId in the network-level `_seenPublishes` set when it relays the publish
  — *without* delivering to its own app (its app had not subscribed yet). When
  that app later subscribed, the backlog arriving as a `pubsub:replay-batch` was
  skipped by the same `_seenPublishes` gate, so the late subscriber saw nothing.
  Subscribers that were *not* roots for the topic had an empty `_seenPublishes`
  and got the full backlog — hence the non-determinism (per topic / K-closest
  membership).
- **Fix.** App delivery is now gated **only** by `_appDelivered` (exactly-once),
  never by `_seenPublishes`. `_onReplayBatch` always attempts app delivery and
  only re-caches / re-records on the first router-sight of a publishId. Matches
  the long-documented separation of the two sets and the self-replay path.
- **Regression test.** `smoke_pubsub_replay.js` gains a remote-replay-after-relay-
  as-root case (red before / green after); duplicate-batch idempotency preserved.
- **Versions.** kernel `2.28.0 → 2.29.0`; testnet/axona.net peer `3.25.0 → 3.26.0`;
  demo `1.15.0 → 1.16.0`. Bridge unchanged (its embedded peer does not subscribe
  to app topics).

---

## Pending production cutover — kernel 2.16.0 → 2.28.0 (2026-06)

The next deployment is a **flag-day**: the new build is hard-incompatible with the
live 2.16.0 network at two layers — pub/sub addressing (v2.18.0) and authentication
(v2.28.0) — so old and new nodes cannot interoperate. This is by design; see the
deploy sequence at the bottom.

**Deployed baseline:** kernel `2.16.0` · bridge `2.12.0` · axona.net peer `v3.24.0`.

### Bridgeless connection (headline capability — v2.17.0 → v2.22.0)

- **v2.17.0** — Peer-relayed WebRTC signaling: peers relay SDP/ICE for each other
  through the existing mesh, so two peers can find and connect to each other with
  **no bridge in the signaling path**. Capability-flagged.
- **v2.19.0** — Bridgeless connect fixed end-to-end: dead-peer eviction +
  routed-forward correctness.
- **v2.20.0** — Bridgeless connect **on by default**, auto-triggered on peer
  discovery; churn re-admit fix.
- **v2.21.0** — Terminally-closed channels heal instead of wedging; verified with a
  genuine multi-hop proof (no-common-neighbour pair, bridge killed).
- **v2.22.0** — Negotiation watchdog: a peer that never opens a channel can no
  longer wedge the slot forever.

### Wire-format breaks (flag-day relevant)

- **v2.18.0** — `msgId = hash(publisher + message)`; time/seq dropped from the id.
  **Breaks pub/sub interop with pre-2.18 nodes** (divergent content addresses).
- **v2.28.0** — **Network partition.** `AUTH_PROTO axona/4 → axona/5` and
  `WIRE_VERSION 1.0 → 2.0`. The auth epoch is folded into the signed connect-time
  transcript, so a pre-bump node and a post-bump node can never complete the
  mutual handshake — at the mesh layer or the bridge. The two networks are
  cryptographically isolated.

### Security & robustness hardening

- **v2.17.1** — Incoming-synapse reverse index capped to the synaptome budget.
- **v2.23.0** — `postHash` reconciled against the verified content hash at ingress;
  concurrent relay-negotiation cap (DoS backpressure); mesh-auth clears its
  `verifying` flag on every non-success exit (no bind wedge).
- **v2.26.0** — The 24 security drop-path logs (bad signature, stale/oversize
  publish, unauthorized retraction, …) now surface through `peer.onLog` instead of
  being silently discarded.
- **v2.27.0** — Three unbounded maps bounded (`_counters`, relay-reachability
  cache, triadic transit cache); the per-publisher replay watermark now survives
  cache pressure for active publishers (closes a replay-eviction window).

### Routing & code health

- **v2.24.0** — `MAX_HOPS 16 → 40`: closes the long-tail lookup gap (the real
  Axona-vs-NH-1 success difference under the connection cap).
- **v2.25.0** — Mesh connection-lifecycle consolidated: three redundant
  death-detectors and two duplicate teardown paths collapsed into one reaper + one
  retire with an authoritative state.
- **Testing** — New fault-injection harness (virtual clock + mock
  RTCPeerConnection) makes the connection-FSM failure paths deterministically
  testable; new regression smokes for the partition, drop-path logging, bounded
  state, mesh lifecycle, postHash, and the negotiation watchdog.

### Bridge — `2.12.0 → 2.13.0`

- Wire-major gate at `client-hello`: a peer that doesn't speak wire major 2 (every
  pre-flag-day node) is declined with a clear "upgrade" close before any frame is
  relayed. Flag-day floors raised (`MIN_KERNEL_VERSION 2.9 → 2.28`,
  `MIN_PEER_APP_VERSION 3.14 → 3.15`). Kernel re-vendor pinned to `v2.28.0`.

### Deploy sequence (flag-day)

1. **axona.net peer** → re-vendor kernel 2.28.0, bump to **3.15.0**, deploy. (The
   upgrade target must exist before the gate starts rejecting.)
2. **Bridge** → push, then `git pull && npm ci --omit=dev && systemctl restart`.
   Verify `/healthz` shows `kernelVersion 2.28.0` / `minKernelVersion 2.28.0`.
3. **dht-sim** → re-vendor 2.28.0, publish.

Old (pre-bridgeless) 2.16.0 nodes can't bootstrap once the gate is live and wind
down; the new network forms among 2.28.0 nodes.

---
