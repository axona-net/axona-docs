# Team Update — Axona kernel **v4.3.0**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** the **4.x line runs on testnet** — `testnet.axona.net` (bridge + peer
app), `demo-testnet.axona.net`, and the testnet relay fleet. **Production is
untouched and still on 3.x** (`WIRE_VERSION` 3.0): `demo.axona.net`, `axona.net`,
the two prod bridges. v4.x is a **deliberate hermetic partition** from prod
(`WIRE_VERSION` 3.0 → 4.0) — a 3.x and a 4.x node refuse each other — so the new
pub/sub engine can bake on testnet without touching the live network.

> Supersedes the **v3.6.0** update. v3.6.0's headline was the v3.0.0 identity /
> addressing flag-day; **identities, structured topics, write policy, and the
> Message-ID dedup from v3.x are all unchanged** — read that update for those.
> This update is about a **new pub/sub engine** under the same app API, plus a
> handful of API simplifications. Most app code written for 3.6.0 runs unchanged;
> the breaking bits are small and listed in §1 and the migration checklist.

---

## TL;DR

1. **Pub/sub was rebuilt: routing-only axonic tree (v4.0.0).** The old
   K-closest / synaptome "lazy-axon" replication is gone. A topic now has **one
   emergent root** (the live node XOR-closest to the Topic ID); the root **stamps
   a total order** and a bounded fan-out **tree** delivers each message **exactly
   once**. Simpler, totally-ordered, and far easier to reason about. Same
   `pub`/`sub` API.
2. **Metrics are a publish event again — for open AND owned topics (v4.3.0).**
   `peer.metrics(topic)` no longer scatter-gathers; it reads the latest **signed
   snapshot** a root publishes to `metricTopic(T)` every ~20 s. This reverses the
   v3.5.0 "owner-only" restriction: **anyone can read an owned topic's activity
   counts** (subscriber/message/byte). The topic's *messages* stay write-gated.
3. **`kill` is the only retraction now (v4.3.0).** `peer.unpub()` is **removed**;
   `peer.touch()` is **deprecated to a no-op**. Retract a message with
   `kill(topic, msgId)`; keep one alive by **re-publishing** (an upsert).
4. **`since:'latest'` actually returns the current value now (v4.3.0).** It used
   to be a ~1-second window that silently missed a value published earlier by
   another client. Fixed: you get the newest retained message regardless of age,
   then live-tail.
5. **Churn & convergence hardening:** **adaptive subscriber renewal** (v4.2.3)
   re-homes subscribers fast after a relay churns; **keyspace hosting** (v4.2.2)
   now actually anchors topics so a relay is a durable home. Plus **`std/message`**
   (v4.2.0), the canonical body convention every app should use.

---

## 1. API changes since v3.6.0

The application surface (`pub` / `sub` / `pull` / `kill` / `host` / identities /
structured topics) is otherwise the same. Four changes:

### 1a. `peer.metrics(topic)` — publish-based, open **and** owned (v4.3.0)

v3.4.0 introduced derived metric topics; v3.5.0 then narrowed the on-demand
`metrics()` reader to **owners only**. v4.3.0 finishes the move: there is **no
on-demand fan-out at all**, and the owner gate is **gone**.

- A topic's root **publishes a signed metric snapshot** to `metricTopic(T)` every
  **~20 s** — for **every** topic it roots, open and owned alike.
- `peer.metrics(topic)` does a **one-shot read** of that snapshot (a brief
  subscribe + replay-on-subscribe), for any topic. New return shape:

```js
const m = await peer.metrics({ region: 'useast', name: 'lobby' });
// { current_count, subscribers, bytes, publishes, ts, signer, stale }
if (!m.stale) render(m.subscribers, m.current_count);
```

- For a live dashboard, **subscribe directly**: `sub(metricTopic(T), …, {since:'all'})`
  → latest snapshot + a rolling ~48 h trend, one subscription, no polling.

**Behaviour/posture change to know:** an **owned (`write:'owner'`) topic's
activity counts are now public** — anyone who can derive the Topic ID can read
them. Only the *message contents* and the *write* capability remain owner-gated.
This is intentional (parity with open topics; lets anyone watch an owned topic's
reach without the owner key). The old field names from the scatter-gather
(`deliveries` / `pulls` / `reshares` / `relayCount`) are gone.

### 1b. `kill` is the only retraction; `unpub` removed, `touch` deprecated (v4.3.0)

```js
await peer.kill(topic, msgId, { signWith: me });   // retract a message you signed (unchanged)
// peer.unpub(...)  ← REMOVED
// peer.touch(...)  ← deprecated no-op (kept callable for source compat)
```

- **`unpub`** (owner-only bulk queue wipe) is gone — its wire record is no longer
  sent or handled. A queue empties naturally as messages age out at the 48 h hold
  ceiling.
- **`touch`** (hold-time keep-alive) is a no-op. To keep a still-relevant message
  current, **re-publish it** — that's an upsert that resets the hold *and* the
  48 h ceiling and re-delivers exactly once (the v3.3.x semantics).

### 1c. `since:'latest'` returns the current value regardless of age (v4.3.0, fix)

Previously `'latest'` seeded the replay floor to `now − 1 s`, so if the topic's
last message was published (by another client) more than ~1 s before you
subscribed, you got **no callback**. (`'all'` and any publish *after* subscribe
both worked, which masked it.) Now the root replays its **single newest retained
entry regardless of age**, folded into the subscribe's own delivery (no extra
round-trip, one-shot, then live-tail). `'all'` and `<number>` are unchanged.

### 1d. `std/message` — the canonical body convention (v4.2.0)

Publish/read message bodies through `std/message` so every app renders every
other app's messages (kills the cross-app `[object Object]`):

```js
import { makeMessage, readMessage } from '@axona/protocol/std';
await peer.pub(topic, makeMessage({ text: 'hi' }), { signWith: me });
peer.sub(topic, (env) => { const { text } = readMessage(env.message); });
```

`std/chunk` (large binary, verify-and-repair) is unchanged in shape; v4.2.1 fixed
a teardown bug where its internal verify could stop a *caller's* subscription.

---

## 2. New architecture: routing-only axonic-tree pub/sub (v4.0.0)

This is the substance of the release. The previous model replicated a topic
across its K-closest nodes and grew "lazy axons" through the synaptome; it was
hard to reason about ordering and prone to silent gaps under churn. The new model
is a clean break.

**The shape:**

- **One emergent root per topic** = the live node whose ID is XOR-closest to the
  Topic ID. Nobody is elected; it falls out of routing. If the root dies, the
  next-closest live node becomes root automatically.
- **The root stamps a total order.** A publish is routed *un-stamped* to the
  root, which assigns a strictly-monotonic stamp — so every subscriber sees the
  same order, and "latest" is well-defined.
- **A bounded fan-out tree delivers it.** The root fans to ≤ `MAX_DIRECT` (20)
  direct children; over-capacity subscribers are delegated to child relays
  (widen-before-deepen), so depth ≈ log₂₀(N) and no node fans to more than 20.
- **Exactly-once app delivery.** Each subscriber gets each `msgId` once
  (`_appDelivered` dedup), even across renewals, re-homes, and replay.
- **Durability without a database.** Roots cache recent messages (bounded by
  count, bytes, and a 48 h hold). A late or reconnecting subscriber gets a
  **replay-on-subscribe**; a displaced/fresh root recovers history from a behind
  child via **stamped-replay-up**.
- **Attachment & healing.** A subscriber **pins** to the relay it last heard a
  `DELIVER` from (`_upstream`); a **root beacon** advertises the current root
  within the topic's keyspace basin (verify-don't-trust). A dead waypoint is
  popped and routing falls through to the Topic ID — the tree self-heals onto a
  fresh root.

**What you do differently as an app:** nothing — `pub`/`sub`/`pull` are the same
calls. You get **total order** and **exactly-once** for free now, which you
couldn't rely on before.

---

## 3. Churn, convergence & hosting

### 3a. Adaptive subscriber renewal (v4.2.3)

Mobile/relay-poor churn used to orphan tenured subscribers: when a relay churned,
existing subscribers stayed pinned to the dead upstream and the new root didn't
know them until their (slow) renewal fired. Renewal is now **adaptive**: it
floors fast (~5 s) on subscribe and on every **re-pin** (a `DELIVER` from a new
relay → the relay changed → re-home), and backs off ×1.5 toward a 60 s ceiling
while stable. Self-tuning: sustained churn keeps it fast, calm lets it idle.
Measured lift under relay-poor 30 %/round Lindy churn: **43 % → 75 %** delivery.
Wire-compatible (local timing only).

### 3b. Keyspace hosting actually anchors (v4.2.2)

`peer.host()` with no topic ("host whatever lands near me" — the relay fleet's
default) previously set a flag that was read nowhere, so a relay volunteered
nothing and a cold topic had no durable home. Now a keyspace host **retains any
topic it becomes root for**, staying an always-on convergence anchor + replay
store. Root-ness is still decided purely by routing.

---

## 4. The wire-4.0 partition (v4.0.0) — why prod is untouched

The routing-only engine changes pub/sub semantics on the wire, so it is fenced
off by the wire major (`WIRE_VERSION` 3.0 → 4.0). The refusal is **hermetic** at
both layers: the signaling bridge rejects a mismatched `wireVersion` major at the
client-hello (close `4426`, before any frame relays), and two peers reject each
other in the `wireCompatible()` handshake. There is **no version-floor heuristic
to slip past**.

Practical consequence: **testnet (4.x) and production (3.x) are separate
networks.** v4 will be promoted to prod as its own coordinated flag-day once it
has soaked; until then prod keeps running 3.3.x with the v3.6.0 semantics.

---

## 5. Migration checklist (3.6.0 app → 4.3.0)

- **Replace `peer.unpub(...)`** → there is no bulk wipe; rely on hold-time expiry,
  or `kill` specific messages. **Remove `peer.touch(...)`** → re-publish to keep a
  message current. (`touch()` won't throw, but does nothing.)
- **`peer.metrics()` return shape changed** → read `current_count` / `subscribers`
  / `bytes` / `ts` / `signer` / `stale`; drop any use of `deliveries` / `pulls` /
  `reshares` / `relayCount`. For live counts, prefer `sub(metricTopic(T))`.
- **If you relied on owned-topic metrics being private** → they're public now;
  don't treat the activity counts as confidential. (Messages/write are still
  owner-gated.)
- **If you used `since:'latest'`** → it now reliably hands you the current value;
  remove any app-side "pull the latest after subscribe" workaround you added to
  dodge the old 1-second-window bug.
- **Adopt `std/message`** for bodies (`makeMessage`/`readMessage`) so your topics
  interop with the other apps.
- **No identity / topic / write-policy changes** since 3.6.0 — those carry over
  verbatim.

---

## 6. Docs

- **API Reference** + **Programmer Guide** updated: publish-based `metrics()`,
  `kill`-only retraction (touch/unpub removed), corrected `since:'latest'`.
- **`Pubsub-Axon-Tree-Reference`** is the deep dive on the new engine
  (architecture + analysis + the churn-rehoming work).
- **SECURITY-CHANGELOG** + **RELEASE-NOTES** carry the v4.0.0 → v4.3.0 entries,
  including the intentional owned-metrics disclosure.

*Kernel `@axona/protocol` v4.3.0 · testnet only · production remains on 3.x.*
