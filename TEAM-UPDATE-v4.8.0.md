# Team Update — Axona kernel **v4.8.0**

> ⚠️ **CORRECTION (see the v4.8.2 update).** Two claims in this document were
> wrong: (1) §2's "the 10–30 s connect is a benign red herring" — that was an
> artifact of one 3-node test config, not a general truth; the real cause is
> subscribing before the mesh forms, fixed by `peer.ready()` in v4.8.2. (2) Any
> "verified live" delivery claim here was based on a useast topic + a single
> sample; live cross-peer delivery was still flaky and was fixed across v4.8.1
> (bridge-root exclusion + STRICT_VERSION) and v4.8.2. Read the **v4.8.2** update
> for the corrected picture.

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** the **4.x line runs on testnet** — `testnet.axona.net` (bridge + peer
app), `demo-testnet.axona.net` (incl. Axona Minimal), and the testnet relay fleet.
**Production is untouched and still on 3.x** (`WIRE_VERSION` 3.0): `demo.axona.net`,
`axona.net`, the two prod bridges. The wire-4 partition from v4.0.0 still holds — a
3.x and a 4.x node refuse each other — so this work bakes on testnet without
touching the live network.

> Supersedes the **v4.3.0** update. The pub/sub engine, identities, structured
> topics, write policy, metrics-via-publish, and `kill`-only retraction are all
> **unchanged** — read that update for those. **There are no app-API changes in
> this release.** Everything here is convergence/reliability under churn, plus one
> reframing of `host()`. Existing 4.3.0 app code runs unchanged.

---

## TL;DR

1. **New nodes now integrate themselves the moment they join (v4.7.0).** A
   freshly-joined node used to be *invisible* until slow background annealing wove
   it in. It now actively weaves itself in — `join()`/`peer.integrate()` looks up
   its own neighbourhood and opens channels to it, so its neighbours adopt it and
   it becomes routable in ~one pass. Reachability of a fresh node jumps from a
   single-digit floor to **~90 %+** immediately. See §1 — this is the headline.
2. **Flaky cross-peer delivery fixed (v4.7.1).** A subtree could be silently
   skipped during fan-out when a relay re-homed toward a closer root it learned
   from a beacon but never sent the confirming subscribe. Reproduced ~50 % of runs
   in isolation; **0 % after the fix.** §3.
3. **`host()` durability actually works now (v4.8.0).** A hosting node's cached
   history now **migrates to whichever node is the current root**, following the
   root as it moves under churn — instead of being stranded below a fresh empty
   root. §4.
4. **`host()` is an infra primitive, not an app durability knob — use it that way.**
   Reframing + guidance in §5. App developers should not need to call it.
5. **Howard's civildefense test suite found #2 and #3.** The methodological story
   — why a real-WebRTC test caught what every simulation hid — is in §2. Worth
   reading even if you skip the rest.

---

## 1. Fast node integration — "route traffic *at* the newcomer" (v4.7.0)

This is the most important change. It comes from a simple but counter-intuitive
observation about how a DHT heals after churn.

**The problem.** When a node joins (or rejoins after churn), *it* knows the mesh —
it learns peers from the bridge welcome and its own lookups. But the rest of the
mesh does **not** know *it* yet. Reachability **to** a node lives in **other
nodes' routing tables**, not in its own. So a fresh node could hold a perfectly
good neighbour list and still be unreachable, because nobody had a synapse
pointing *back* at it. The old path waited for background annealing/gossip to
slowly propagate the newcomer — which under sustained churn never fully caught up,
and was the dominant term in our churn-recovery losses.

**The insight.** A node's reachability is healed only by **inbound** traffic to it
— a self-lookup does nothing for it. So the fix is to **route traffic at the new
node on purpose.** A joining node should not wait to be discovered; it should make
the few targeted connections that cause its closest neighbours to adopt it.

**What we shipped.** `peer.integrate()` (called best-effort inside `join()`, and
explicitly right after `peer.start()` in the peer app and the relay):

- `findKClosest(ownId)` — discover the node's *own* keyspace neighbourhood.
- Open authenticated channels to those K-closest peers. The bind handshake fires
  on **both ends**, so each neighbour runs its normal admit flow and installs a
  synapse pointing back at the newcomer.
- The newcomer is now routable from its neighbourhood — which is exactly where
  routes for it must terminate.

**The numbers.** In simulation a fresh node's reachability rises from a
single-digit floor to **~90 %+ in one pass**; directed integration costs roughly
**~4 packets per newcomer** and beats blind warmup traffic by ~2.5×. It is the
difference between "joined the mesh" and "the mesh can find me."

> Sim-fidelity note: we also made `SimTransport` fire `onPeerBound` on both ends
> (it previously only modelled `onPeerDied`), so the kernel's auto-admit flow runs
> in simulation the way it does over real WebRTC. This matters for §2.

**As an app:** nothing to do. `join()` integrates for you; the peer app and relay
call `integrate()` after start. New nodes simply become reachable faster.

---

## 2. How Howard's tests found the key problems

The reliability fixes in §3 and §4 exist because of an outside regression suite,
and the story is worth telling because it changed how we test.

**Background.** Howard (civildefense) sent a single-file Jasmine suite exercising
a realistic lifecycle: subscribers join with `since:'all'`, a peer joins between
subscribe and publish, some peers **restart**, and late peers join after the
publishes. It **passed on `main`/3.8.0** but on testnet/4.x "usually fails to
receive some of the expected subscription callbacks, and thus hangs."

**Why our own tests missed it.** Every harness we had used `SimTransport` —
instant, reliable connections with omniscient routing-table wiring. Under that
model the new engine showed **100 % delivery and fast convergence**. The bugs were
in the **gap between instant-sim and real WebRTC**: the latency and ordering of
real connection establishment, beacons, and re-homing. Howard's suite ran real
peers against a real bridge, so it surfaced exactly what sim could not. We adopted
it as the faithful regression harness and reproduced it **in full isolation** (our
own bridge, no foreign peers) to rule out shared-testnet noise.

**It caught two distinct, real bugs:**

- **The chained-attach / one-sided re-home bug (→ v4.7.1, §3).** Instrumenting the
  isolated repro showed a relay pinning its upstream to a closer root from a beacon
  *without* sending the confirming subscribe — so the new root never registered the
  relay's subtree and fan-out skipped everyone below it. A one-line locus, a ~50 %
  failure rate, and 0 % after the fix. Sim never produced the chain timing that
  triggered it.
- **The restart-phase durability residual (→ v4.8.0, §4).** After we fixed the
  initial-attach bug, the suite still failed ~1/3 of the time — but now only in the
  **restart phase**, when a subscriber rejoins an already-existing topic whose root
  had churned. That trail led to the hosted-cache stranding bug.

**It also debunked a red herring.** The "10–30 s to connect" people reported was
**not** a bug: Howard's `connect()` waited for `synapseCount === 4`, which is
unreachable in a 3-node mesh (you can form at most 3 synapses). On a populated mesh
connects are ~800 ms; synapses form in ~1.3 s. The gate, not the network, was the
delay. (A future kernel "mesh-ready" signal will make this unambiguous.)

**Takeaway for the team:** sim is great for scale and routing math, but
**convergence/reliability claims must be validated on real WebRTC.** Howard's suite
is now part of how we gate pub/sub changes.

---

## 3. Flaky cross-peer delivery fixed (v4.7.1)

When a topic's tree formed a chain (subscriber → relay → root) and the relay
demoted itself toward a closer root it learned from a **root beacon**, it pinned
its `_upstream` to the new root but **never sent the confirming subscribe-k**. The
new root therefore never registered it as a downstream child, so deliveries fanned
out over the root's direct subscribers and **silently skipped the relay's entire
subtree** — the root cached the message while everyone below received nothing. This
was the dominant cause of intermittent "subscriber never gets the callback" hangs.

The beacon-demotion path now emits the subscribe-k, so the new root seats the node
and its subtree. Reproduced ~50 % of runs in an isolated 3-node test; **0 % after
the fix.** Wire-compatible.

---

## 4. `host()` durability — cache follows the moving root (v4.8.0)

A node that `host()`s a topic is a durable cache-bearer: it holds the feed without
being an app subscriber, so a stable node can keep a topic's history alive across
the churn of volatile (browser) roots. That was the intent — but it didn't hold up
when the root *moved*.

**The bug.** When the emergent root departed and a **different** node was promoted
to the fresh (empty) root, the host's cache stayed **stranded below the new root**.
New subscribers attached to the empty root and a `since:'all'` replay returned
nothing — even though the bytes were still alive on the host, one hop away.

**Root cause.** Axona's root is emergent by XOR-distance, so it *moves* as nodes
join and leave; durability therefore requires the cache to **follow** the root. The
mechanism for that already exists (a behind root issues `PULLUP`, the cache-bearer
replies `REPLAYUP`) and is triggered when an incoming subscribe advertises a
higher cache **high-water** than the root holds. But the hosted-topic re-announce
in `refreshTick` used a **raw subscribe that omitted the high-water field** (and a
host with zero downstream subscribers was skipped by the normal renewal loop). So
the fresh root never learned the host had history, never issued `PULLUP`, and the
cache was orphaned.

**The fix (one line).** Hosted topics now re-announce through the same
`_sendSubscribe` path as ordinary relays, which advertises high-water and renews
toward the current root. The host's history now **migrates up to whichever node is
the current root**, following it under churn. Validated end-to-end against a real
WebRTC bridge (backlog *and* live fan-out both recover after the original root
leaves) and guarded by `smoke_pubsub_host_durability.mjs`. Wire-compatible.

This also hardens **infra** uses of specific-topic hosting — the bridge directory
and the per-topic metric snapshots — against root movement.

---

## 5. Use `host()` as infra, not as an app durability knob

A design clarification that came out of this work. `host()` is genuinely valuable
in two infra roles:

- **Keyspace hosting** (`host()`, no topic) — how relays/bridges become **stable,
  always-on roots** for topics in their neighbourhood. Without it, a topic's root
  is whatever browser tab is momentarily closest (the flaky-root problem above).
  This is invisible plumbing; the relay fleet does it by default.
- **Pinning a specific well-known topic** — the bridge directory and metric topics.

It is **not** a good app-developer durability feature, and we are not documenting
it as one:

- It only retains anything if the node actually becomes a root/relay for the topic
  (a far-from-topic leaf host caches **nothing**), so it's an unreliable lever.
- Large topics already get cache redundancy via delegation to child relays; small
  topics we treat as best-effort (a publisher can republish).
- **Hosting your own topic lowers your privacy** — it binds your author identity to
  your node/transport location in the tree (beacons, subscriber lists), which the
  protocol otherwise keeps separate (the envelope discloses *who*, never *where*).
- **A host sits on the delivery path**, which is the position from which a malicious
  relay could attempt to inject content (see the open security item below).

**Guidance.** If a topic's history must survive churn, **deploy or position a
keyspace-hosting relay near it** — i.e. make it an infra decision, with a separate
infra identity — rather than calling `host()` from an authoring client. For
civildefense specifically: host critical topics on civildefense infra, not on the
alerting client.

---

## 6. Versions in this release

| Component        | Version  | Note |
|------------------|----------|------|
| `@axona/protocol`| **4.8.0**| kernel (tagged) |
| axona-bridge     | 2.40.0   | re-pinned @v4.8.0 |
| axona-peer       | 3.39.0   | re-vendored (pkg 4.8.0) |
| axona-relay      | 0.24.0   | re-vendored |
| Axona Minimal    | 0.11.0   | demo app |

Self-integration (§1) landed in **v4.7.0**, the delivery fix (§3) in **v4.7.1**,
and the durability fix (§4) in **v4.8.0**; this update promotes the whole line to
the testnet fleet together. All changes are wire-compatible within wire-4 — no
flag day.

---

## 7. Open follow-up — verify-at-delivery (security)

One item this work surfaced and we have **not** yet shipped: a subscriber does not
re-verify a message's signature before handing it to the app — verification happens
at root ingress and on replay-up, but the normal fan-out and final delivery trust
the tree. A node on the delivery path (which a host explicitly becomes) could
therefore relay a forged envelope attributed to any author. The fix is to verify
the envelope (and confirm `msgId === H(signerPubkey‖message)`) at delivery; the
binding already exists, it just isn't checked on the read path. Tracked for the
next security pass; called out here so no one treats a delivered message's claimed
author as cryptographically guaranteed until it lands.

---

*Kernel `@axona/protocol` v4.8.0 · testnet only · production remains on 3.x.*
