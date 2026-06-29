# Team Update — Axona kernel **v4.8.8**

**Audience:** anyone building on `@axona/protocol` (apps, relays, bridges).
**Status:** the **4.x line runs on testnet** — `testnet.axona.net`,
`demo-testnet.axona.net`, the testnet relay fleet. **Production is untouched and
still on 3.x.** The wire-4 partition from v4.0.0 still holds; everything below is
wire-compatible within wire-4 (no flag day).

> Supersedes the **v4.8.2** update. That update fixed *cold-start* (subscribe too
> early) with `peer.ready()` and *contention* (bridge-as-root) by excluding the
> bridge from root candidacy. This one covers what came next: **convergence under
> churn** (v4.8.3–4.8.4) and a full rework of **message retraction (`kill`) into a
> verified, durable publish** (v4.8.5–4.8.8).

---

## TL;DR

1. **Kill is now a real publish with a delete side-effect.** A retraction routes,
   heals, retries, and replays exactly like a normal message — so a kill is now as
   reliable as the publish it retracts. (v4.8.5–4.8.8)
2. **Only the author can retract.** Kills are signed and verified at the root
   against the *original message's* author key. A kill from anyone else is dropped.
   No moderator, owner-registry, or trust server. (v4.8.7)
3. **Retractions are durable and can't be silently missed.** A kill rides the
   protected replay history, and as of v4.8.8 it backfills to *any* subscriber on
   renewal regardless of how far its read cursor has advanced — closing a leak
   where deleted content could outlive its retraction on a straggler. (v4.8.7–4.8.8)
4. **Convergence under churn improved.** An unattached subscriber now re-resolves
   the root fast (v4.8.3), and a gracefully-leaving root hands off its cache so the
   topic survives the handoff (v4.8.4).
5. **Privacy invariant, stated explicitly:** a publisher **never** receives a
   network ack for a publish or a kill — only the local "I sent it." There is no
   delivery receipt that could link an Author ID back to a transport/IP. (See §4.)
6. **No API change, no flag day.** Same wire-4. Apps that already call
   `await peer.ready()` (v4.8.2) need nothing new.

---

## 1. Kill, reworked: a verified publish with a side-effect (v4.8.5–4.8.8)

The mental model is now simple and worth internalizing: **a `kill` is a publish.**
It is a signed envelope that routes to the topic root, fans out down the tree, and
is delivered to subscribers — the only difference is its side-effect (remove the
target message + leave a tombstone) and that the app callback shape is
`{ msgId, topic, deleted: true }` instead of a message body. Everything that makes
a publish reliable now applies to a kill:

- **It routes like a publish (v4.8.5).** Previously a kill was sent on a thinner
  path and could strand before reaching the root. It now seeds the same root hint
  and rides the same strand-heal as `pub`.
- **It retries under loss (v4.8.6).** Publishes and kills are held in a
  confirmation-gated, `msgId`-keyed pending set and re-sent on each refresh tick
  until confirmed (bounded by TTL + max tries). A dropped packet no longer means a
  lost retraction. Keying by `msgId` (not topic) means two quick operations on one
  topic no longer clobber each other.
- **It's authenticated at the root (v4.8.7).** The root runs `verifyKill` and
  accepts the kill **only if its signer is the same author key that published the
  target**. A forged kill is dropped. If a kill arrives *before* the root holds the
  target (it raced ahead, or the root just took over), it's held **provisionally**
  and enforced when the target lands: the message stays retracted only if its
  author matches the kill's signer — otherwise the unauthorized kill is discarded
  and the message is delivered normally.
- **It's durable (v4.8.7), and converges regardless of read position (v4.8.8).**
  The tombstone rides the protected replay history like any cached message. v4.8.7
  made it replay on renewal; v4.8.8 fixed the gate so it replays **every active
  (non-expired) tombstone independent of the subscriber's `since` cursor**. The old
  gate (`killTs > since`) never re-sent a retraction to a subscriber whose cursor
  had already advanced past the kill — so a node that missed the delete but kept
  reading could hold the deleted content indefinitely and serve it to late
  subscribers. That leak is closed; delivery stays exactly-once (the receiver
  dedups idempotently) and the tombstone set is TTL-bounded.

Net: **kill delivery now tracks publish delivery.** If a publish would have reached
a subscriber, its retraction will too.

## 2. Convergence under churn (v4.8.3–4.8.4)

The v4.8.2 update flagged "convergence after churn" as the open residual. Two
pieces of it landed:

- **Fast root re-resolve while unattached (v4.8.3).** A subscriber that isn't yet
  attached to a root re-resolves aggressively instead of waiting out a slow renewal
  cycle — so a topic whose root just changed re-forms quickly.
- **Graceful-leave cache handoff (v4.8.4).** When a root leaves *cleanly* it hands
  its cache to the next-closest node (wire `pubsub:handoff`), so the topic's history
  and root role survive the departure instead of resetting.

These narrow — but do not eliminate — the churn residual. See §3 for the honest
picture.

## 3. Honest status: live reliability

Live cross-peer pub/sub on the shared testnet is **probabilistically convergent**,
and that is the dominant reliability characteristic to design around:

- **What's solid:** the mesh itself (a fresh peer reaches a full synaptome with no
  connectivity errors), cold-start (`peer.ready()`), author-only + durable kills,
  and single-root durability across a *graceful* leave.
- **What's variable:** a publisher and a subscriber each run *independent* greedy
  walks toward the topic root, and on a real WebRTC mesh those walks sometimes
  strand before meeting — so spot delivery sits in a band (≈50–85% in probes),
  not a flat 100%. The K-closest root set can shift between probes. This is the
  long-standing greedy-walk convergence limit, not a regression in this release.
- **Methodology note (important for anyone testing):** stand up a **backbone of a
  few well-connected nodes before launching publishers/subscribers**, and **wait
  for the mesh to form (`peer.ready()` / ~20 s) before the first subscribe** — a
  SUB issued into a half-formed mesh strands and reads as a false zero. Our testnet
  backbone is now 9 relays (3 per region: uswest/useast/uscentlw). An overnight
  soak (scale/backlog/churn/gap/discovery/kill across an escalating subscriber
  ladder) is running to quantify the convergence band at scale.
- **Next lever:** push convergence higher — wider root-beacon basin and/or a
  lookup-confirmed publish so a cold publisher doesn't fire before its root hint
  resolves.

## 4. Privacy invariant — no publisher-facing ack

Worth stating because the retry/durability work above could tempt a "delivery
receipt." There is none, by design. A publisher (or killer) learns only that it
**locally sent** the message; it never receives a network acknowledgement that any
subscriber received it. A delivery receipt would be a channel linking an **Author
ID** to the transport path (and thus potentially to an IP) — exactly what Axona's
who-not-where envelope is built to prevent. The persistent retry in v4.8.6 is
gated on *root confirmation of receipt into the tree*, never on subscriber-side
delivery, and surfaces nothing back to the original publisher beyond local state.

## 5. Versions in this release

| Component         | Version  | Note |
|-------------------|----------|------|
| `@axona/protocol` | **4.8.8**| kernel (tagged); verified + durable kills, cursor-independent retraction replay |
| axona-bridge      | 2.46.0   | re-pin @v4.8.8; testnet floors at the wire-4 / STRICT_MIN_KERNEL island |
| axona-peer        | 4.8.8    | re-vendored (app cache-bust 0.70.0) |
| axona-relay       | 0.30.0   | re-vendored; 3-region backbone via `start-backbone.sh` |

All wire-compatible within wire-4 — no flag day. Live healthz:
`{ version: 2.46.0, kernelVersion: 4.8.8 }` on `testnet.axona.net`.

---

*Kernel `@axona/protocol` v4.8.8 · testnet only · production remains on 3.x.*
