# Team Update — A departing peer goes silent: the leave() fix (kernel v4.19.4, testnet + production) — 2026-07-11

**Headline:** the alert-bot's "100% CPU for 40 seconds after disconnect" is
fixed, and the fix removes a whole family of workarounds: **the 45-second pauses
around `leave()` can be deleted.** A peer that publishes and immediately leaves
now drains its in-flight publishes on evidence, hands off its topics within a
real time bound, and then goes completely silent. Live in production as
**kernel 4.19.4 · bridge 2.69.0 · relay 0.48.2 · peer 3.48.1** — settled prod
pub/sub verified 36/36 after the deploy.

Full credit to Howard for the report: every observation in it checked out, the
line-number suspicion pointed at a real bug, and the two code-reading questions
both exposed genuine defects. This is what a great bug report looks like.

---

## The root cause

**Nothing in the codebase ever called `AxonaManager.stop()`.** The pub/sub
maintenance tick — the loop that renews subscriptions, retries unconfirmed
publishes, and re-verifies roots — simply survived `leave()` and kept firing
against a dead transport. A bot that had just published held *unconfirmed*
entries in the publish-retry map (the implicit-ack machinery), so every
post-leave tick re-sent them and re-ran iterative lookups whose probes failed
instantly — a promise chain spinning at microtask speed with no I/O to wait on.
That's 100% CPU until the 30-second retry TTLs burned off.

It explains every symptom in the report:
- **only after publishing** — subscribe-only peers have nothing pending;
- **avoidable by waiting** — the pendings confirm, so there's nothing to retry;
- **the 9-second delay** — leave() notified peers *serially*, one WAN
  round-trip at a time, before the transport died and the spin began;
- **the 45s workaround** — it simply outlived the TTL burn-off.

Reproduced exactly (pendingPub=5 at leave, tick still armed, ticks still firing
after leave), then fixed and re-measured: tick cleared, pendings zero, **zero**
post-leave sends.

## What leave() does now

1. **Drain on evidence, not time.** The old "drain window" was capped at 50ms
   by a stray `Math.min(timeoutMs, 50)` — Howard flagged the exact line — which
   silently defeated the caller's timeout. leave() now polls until the pending
   publish/kill maps are actually empty, bounded by `timeoutMs`: a confirmed
   publish departs instantly; an unconfirmed one gets the full window it asked
   for. The golden path is built in.
2. **Notify peers in parallel**, time-bounded (was serial per peer).
3. **Hand off rooted topics with a real bound.** Howard read this correctly
   too: the handoff awaits a network lookup per rooted topic and *nothing* raced
   it against the timeout, despite the comment claiming otherwise. It is now
   `Promise.race`d.
4. **Then go silent**: stop the tick, clear the retry state. `stop()` (the
   abrupt path) performs the same teardown.

One subtlety the new regression test caught in our own fix: leave()'s internal
waits must be *ref'd* timers — unref'd, Node's event loop can empty and the
process **exits mid-leave** when leave is the last thing an app does.

## Answers to the standing questions

- **"Two transports" (constructor vs bridge monkey-patch):** acknowledged tech
  debt. The constructor-supplied transport is the canonical path; the bridge
  wires its own onto `node.transport` and leave() carries a fallback for it.
  Host nodes using the normal construction are **not doing it wrong** — the
  "bridges are normal nodes" critique is fair and consolidation is on the
  cleanup list.
- **Node not exiting after disconnect:** the kernel's timers are now all
  cleared or unref'd; the likely remaining holder in an app is
  **node-datachannel's native loop**, which needs an explicit `cleanup()` after
  teardown (our collector does this). If it still hangs after that, we want the
  active-handles dump.

## Verification

- New regression suite `smoke_leave_teardown` (12/12): tick cleared, pendings
  cleared, zero routed sends post-leave, fast evidence-based drain, bounded
  stuck-pending drain, stop() parity.
- Full kernel suite green.
- Live 5-host validation, before → after: tick armed **true → false**,
  pendingPub **5 → 0**, post-leave ticks **3 → 0**.
- Prod deploy verified: staggered bridges, federation up, fleet meshed 16/16
  bound, settled pub/sub **36/36**.

## The recurring lesson

This is the same disease class as last week's reconnect-death, one layer over:
lifecycle paths (recover, depart) that misbehave around the very transition they
manage. The recovery rule was *"never wait unboundedly on the thing you're
recovering."* The departure rule is its mirror: **"a peer that has left must be
silent."** Both are now enforced by regression tests, and the planned
recovery-path audit (punch-list R-2) covers the remaining loops.

— shipped 2026-07-11: kernel v4.19.4, bridge v2.69.0, relay v0.48.2, peer
v3.48.1; testnet + production; collectors restarted. Howard: the alert-bot's
workaround pauses can come out — please re-verify against either network.
