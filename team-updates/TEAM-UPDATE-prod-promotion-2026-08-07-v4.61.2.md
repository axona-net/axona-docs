# Team update — production promoted to kernel 4.61.2 (second promotion of the day)

**Date:** 2026-08-07 evening · **Decision:** David · **Executed by:** axona.bot

## Why a second promotion

The morning's 4.61.0 promotion broke every axona.chat load for ~45
minutes: the new mesh gate judged live WebRTC channels at the instant the
synaptome warm-up resolved, and the bridge satisfies a `minPeers` warm-up
in under a millisecond — so the gate measured zero channels at 0ms and
threw, every load, for every `minPeers` caller. The app was restored
within the hour by an explicit bridge-only stopgap (chat v0.48.1); the
kernel fix went through full council review (issue #48) the same evening.

## What 4.61.2 is

One monotonic deadline — the caller's own ready timeout — now covers both
the synaptome warm-up and live-mesh admission. The gate waits,
event-driven on channel bind, resolves the moment one live channel
exists, and throws only when the deadline expires with zero channels.
`allowBridgeOnly` remains the sole bypass. Also in this release: a
listener leak on every graceful `leave()` (found by the new regression
set) and a kernel-side fence that fails `npm test` whenever the handshake
`KERNEL_VERSION` constant disagrees with package.json — the mismatch that
forced 4.61.1 to be superseded within the hour, caught then by the
bridge's `check_kernel_pin`, now caught at the source.

## Where it runs

Both production bridges (v2.110.0), the 18-relay droplet backbone, the
testnet bridge and demo, the M4's 26 testnet relays, and the M1's 12
testnet relays — 38 testnet relays total, a count corrected today after
the M1's fleet surfaced during its network-loss incident. Apps: chat
v0.49.0 (mesh-required semantics restored, stopgap removed), demo and
share on 4.61.2.

## Acceptance

The outage shape itself is the acceptance probe now: a fresh peer calling
`connect({ready:{minPeers:1}})` connected 3/3 on testnet (1.2–1.3s) and
3/3 on production (1.1–1.9s). Kernel suite 137/137. Canary: zero
error-level bridge lines, 81 admissions in the window, one attributed
observation — coturn credential failures from still-running 4.49.0/4.59.2
clients crossing their 2-hour TURN TTL, the pre-4.60 expiry bug those
clients shed when they reload.
