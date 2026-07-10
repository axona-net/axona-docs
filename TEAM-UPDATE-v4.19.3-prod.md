# Team Update — Reconnect-survival + observability shipped to production (kernel v4.19.3) — 2026-07-10

**Headline:** the whole 4.19.3 line is now **live in production** — both bridges,
the 9-relay backbone, axona.net and the demo. This closes the reliability arc of
the last week: root election no longer splits, the bridge no longer disconnects
healthy clients under load, and — the one that had been quietly biting us —
**a node's reconnect loop can no longer die on the failure it exists to handle.**
Settled production pub/sub verified end-to-end at **36/36 (100%)**.

Versions now in prod: **kernel 4.19.3 · bridge 2.68.0 · relay 0.48.1 · peer 3.48.0**.

---

## What shipped in this promotion

The deploy freeze is lifted; production caught up to testnet. Three things land:

1. **Reconnect-survival (kernel 4.19.3).** The bug that wedged all nine relays
   after a bridge restart. When a relay's socket dropped and it retried while the
   bridge was still booting, the proxy answered **502** — and in Node's WebSocket
   library a failed upgrade is an *error event*, which, with no listener, **threw
   as an uncaught exception and killed the retry loop.** The process stayed alive
   (so `Restart=always` never noticed) but sat in "connecting" forever. It had
   three faces — the kernel listener, the collector's unbounded retry await, and,
   almost certainly, the silent death of our old laptop testnet backbone weeks
   ago. All one shape: *a recovery path that dies on, or blocks forever on, the
   failure it is recovering from.* Fixed, with a regression test that crashes the
   old code with the exact production error and passes on the new, plus a real
   end-to-end test that rides a genuine 6-second 502 storm and reconnects.

2. **Bridge stall-detection + admission grace (bridge 2.68.0, first shipped
   2.67.0).** A 1-second heartbeat that measures event-loop lag, logs any stall
   loudly with heap/RSS, and exposes live gauges in `/healthz` — plus grace logic
   so the bridge never disconnects a client for time the loop wasn't listening.

3. **Restored root introspection (in 4.19.x).** The relay `roles=` counter —
   which had silently read **zero for months** while relays were rooting hundreds
   of topics — tells the truth again. That dead counter cost us a full diagnosis
   cycle; its silence is exactly the failure mode we're now prioritizing against.

Root reconciliation (4.19.0–4.19.2) — the multi-root split that started this arc —
was already accepted on prod last week; this promotion brings the reconnect and
observability work up to match.

## Verification

- Staggered bridge deploy (east → west), federation `uplink-up` confirmed both ways.
- Relay fleet redeployed fresh on 4.19.3 — which **permanently clears** the
  reconnect wedge: a future bridge restart no longer strands the fleet.
- Settled production pub/sub: **36/36, 100%**, all relays fully bound.
- One operational note worth recording: a *simultaneous* full-fleet restart leaves
  relays healthy-but-`DEGRADED` for ~5–8 minutes while their peer-to-peer channels
  re-authenticate. A one-shot probe reads low (~33%) during that window and 100%
  once it clears. **Don't judge a fleet deploy on a fresh one-shot probe** — wait
  for the mesh to bind. (Now in the deploy runbook.)

## The theme, and what's next

This week's pain came almost entirely from **one class of problem, and it wasn't
an attacker**: correctness-and-recovery under churn, and *blindness to silent
failure*. Four things failed quietly this cycle before we stumbled on them — a
dead backbone, a wedged collector, a dead metrics plane, and that zeroed `roles=`
counter. Each cost a diagnosis cycle or lost data.

So the punch list has been rewritten
([`red-team-punchlist-v4.19.3`](red%20team/red-team-punchlist-v4.19.3.md)) with a
new top tier — **reliability & observability** — ranked above most of the standing
security work, because that is where production actually hurt. The number-one item
is not a code fix at all: **absence-alerting.** We have no watchdog that pages when
something goes quiet. A cheap canary (bridge `/healthz` + relay units + collector
liveness) retires the entire "found it by accident" failure mode, and it's the next
thing to build. After that: the memory-hard PoW activation (the manifesto-release
gate; bench + calibration are ready), and a deliberate audit of every reconnect/
renew/promote loop for the recovery-path shape above.

— shipped 2026-07-10: kernel v4.19.3, bridge v2.68.0, relay v0.48.1, peer v3.48.0;
testnet + production; collectors restarted on the fixed build; SECURITY-CHANGELOG
current.
