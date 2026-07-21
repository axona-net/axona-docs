# Team Update — Kernel v4.32.0 on testnet (2026-07-21)

**TL;DR: the deterministic ~10% "published but never preserved" loss is root-caused and fixed.
It was never placement policy — `leave()` announced the departure before handing off the
history, and the announcement itself destroyed the routes the handoff needed. Testnet now
runs kernel 4.32.0 everywhere. Please rerun your experiments — and restart any long-running
nodes so they pick up the fix.**

## What was tested

- Howard's alert-bot golden path (publish → wait 75s → graceful leave → two independent
  fresh-node confirms), both the original 0x80 arrangement and the 0x89-publisher variant.
- A purpose-built instrumented repro (`burst-repro.mjs`): 120 fresh topics, full kernel
  event capture on the publisher AND on three instrumented receiver hosts, plus a live
  routing probe that sends the identical handoff messages mid-life.
- Full kernel suite (96 files), `smoke_backup_handoff`, `smoke_leave_teardown`, the peer
  and bridge suites, post-release droplet + fleet verification.

## What we found

1. **The root cause is ordering, not placement.** `leave()` broadcast `peer-leaving` to
   every neighbor *before* running the graceful handoff. Receivers react to that signal by
   proactively hard-closing the leaver's channel (a fast path built for bridge restarts —
   its own comment said "its HANDOFF, which arrives after this notify" while closing the
   wire that HANDOFF needed). Within the ~2s notify window the leaver's entire bound-peer
   set closed, every routed HANDOFF found no next hop, terminated **at the sender**, and
   was silently discarded by a target-mismatch guard. Instrumented capture: **173/173 leave
   handoffs boomeranged back to the leaver; zero reached any heir; zero acks.** Every topic
   whose only copy rode the handoff died — deterministic by topology, immune to wait times
   and re-subscribes, and independent of the publisher's region (exactly matching Howard's
   0x89 experiment, which was the decisive clue that placement policy wasn't the story).
2. **The same routed sends deliver perfectly mid-life** (probe-verified at instrumented
   receivers) — the failure was purely the teardown ordering.
3. **This bug is live on prod (4.29.0) too.** Howard's "lost" #axona.dev posts — and two of
   axona.bot's own posts, including, delightfully, the one announcing this root cause — were
   destroyed by it: a die-fast poster publishes and departs, and the sole copy dies with the
   departure. The bot's poster now holds its peer alive until an independent probe session
   confirms the message is replayable (relay v0.63.0).
4. **Residual read-path gap (separate, pre-existing, now tracked):** after the fix, the only
   remaining acceptance misses (67/67 of them) mapped to a single degraded long-lived node
   that is topic-closest for a slice of the keyspace — it accepts and acknowledges transfers
   but doesn't serve reads. Data isn't lost; it's on a holder routed reads can't use. Fix
   direction: reads escalate past a non-serving closest node to a cohort replica.

## The fix (kernel v4.32.0)

- `leave()` reordered: **drain → handoff (transport fully alive, acks actually return) →
  notify → stop.** Data first, funeral announcement second.
- Handoff window scales with role count (a burst publisher can hold hundreds of roles);
  singleton roots (the network's only copy) hand off first.
- Heirs and cohort replicas are chosen in-region first — an out-of-region copy is durable
  but unfindable by routed reads; a departing non-root holder pushes REPLICATE (never mints
  a root at the receiver); last-resort out-of-region handoffs are demoted to REPLICATE.
- Diagnostics kept at debug level: `handoff-recv` / `handoff-ingested` (a `mine:false`
  receive from yourself is the boomerang signature).

**Results:** instrumented repro went from 100/120 lost (worst case) to 0 unacked handoffs
with every transfer received, ingested, and acknowledged at the heirs. All suites green.

## Deployed

| Component | Version | Where |
|---|---|---|
| Kernel `@axona/protocol` | **4.32.0** | testnet branch + tag |
| Bridge | 2.86.0 | testnet.axona.net (healthz verified) |
| Peer app | 4.2.0 (display v4.31.0) | testnet checkouts pulled |
| Relay | 0.63.0 | local fleet restarted, banners verified |

Prod stays on 4.29.0 pending testnet acceptance; promotion is the next gate.

## Actions

- **Everyone on testnet: restart long-running nodes** (they carry both the old kernel and
  accumulated degraded state). Howard: your `--nPortals 3` portals specifically.
- **Howard:** rerun the alert-bot experiment against testnet — your run is the acceptance.
- Next engineering item: read-path escalation past non-serving closest holders (#364),
  which also covers resilience against any future degraded node.
