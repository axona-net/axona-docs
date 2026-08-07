# Team update — production promoted to kernel 4.61.0

**Date:** 2026-08-07 · **Decision:** David · **Executed by:** axona.bot

## What changed on production

Production was struggling with the two problems this release addresses:
TURN credentials expiring mid-life on long-lived nodes, and clients that
reach the bridge but never form a mesh continuing as if connected.

- **Kernel 4.61.0** on both bridges (v2.109.0, east then west) and the full
  relay backbone — 18 relays, 6 units on each of 3 droplets. Prior version
  was 4.59.2; rollback refs recorded before the push (protocol `104a8715`,
  bridge `86493ea`, relay `b36d7a2`).
- **TURN in-band refresh** (4.60.x): credentials renew before their 2-hour
  TTL instead of dying with the session.
- **connect() mesh gate** (4.61.0): zero live WebRTC channels at ready ⇒
  `MeshUnreachableError`. Bridge-only operation requires the explicit
  `allowBridgeOnly: true` and is flagged on `status.initialBridgeOnly`.
  App developers: this changes connect() failure behavior for users whose
  networks block WebRTC — see github.com/axona-net/axona-protocol/issues/46.

## How it went out

Bridges east-first (west stayed up as the live bootstrap path), then the
backbone one unit at a time — each replacement verified for its 4.61.0
banner and `state=open` in the journal before the next unit restarted, so
every departing relay had 17 live heirs. One surprise: the backbone is 18
relays now, not the 9 in the ops notes; the roll measured before it moved.

## Acceptance

The 15-minute canary ran against criteria named before the deploy: zero
error-level bridge log lines in the window, healthz stable on both bridges,
client hellos admitting (4.59.2 clients accepted, floor 3.15.0), uplink
east↔west up within a second of restart, directory established and
published for eagle and grizzly, and a live #jokes publish confirming
`confirmed:true` through the new stack. Coturn showed zero credential
errors on zero allocations — no TURN traffic crossed the window, so that
criterion carries no data yet; the first tethered client will be the real
test.

Testnet basis: Stage-4 acceptance per TESTNET-PROTOCOL.md (round-trip,
9-hour endurance, full Ship-of-Theseus churn roll). Known limitation: that
evidence was gathered on the then-3-relay M1 fleet; the fleet now stands at
26 for future cycles. One pre-existing defect was isolated during
acceptance and registered as issue #47 (METRICSON demand does not survive a
root transition) — present before 4.61.0, unchanged by it.
