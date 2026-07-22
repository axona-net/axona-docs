# Team Update — Bridge as a bridge: graduation, scaling, and a fair alert-bot test (2026-07-22, testnet)

**TL;DR: the signaling bridge now caps and *paces* how many peers it holds, so a
single small bridge host seeds a large mesh without being overwhelmed. Along the
way we scaled a real relay fleet on testnet, learned that a "thundering herd" of
simultaneous connects (and simultaneous subscribes) is its own failure mode, and
got the cross-region alert-bot to 98% delivered on a modest warm mesh once the
test stops firing everything at once. One kernel change is still needed to close
the last couple percent.**

---

## The idea: the bridge is a bootstrap node, not a supernode

A peer joins by connecting to the bridge, which introduces it to a few anchors;
after that it forms its own peer-to-peer mesh and doesn't need the bridge for
data. So the bridge's job is *bootstrap and signaling*, and it should cost a
bounded amount no matter how big the network gets.

**Kernel 4.35.0 + bridge 2.90.0** make that structural. The bridge holds at most
`BRIDGE_MAX_PEERS` (default 32) connections. When a newcomer would push it past
the cap, it **graduates** an established, already-meshed peer: it closes that
connection with a cooperative signal (close code 4200), and the peer keeps its
mesh and simply stops leaning on the bridge — freeing the slot for whoever
actually needs to bootstrap.

Safety is built in: a peer that wasn't truly meshed when released reconnects
immediately (it checks its own live peer count), and a graduated peer re-dials on
its own if its mesh later thins — so nothing gets stranded. Only clients new
enough to understand the signal are graduated (≥ 4.35.0); older clients count
toward the cap but are never force-dropped, so there is **no flag day**.

## What scaling taught us — thundering herds

We ran this for real: a 20-relay fleet on one machine plus a 20-relay fleet on a
second, all bootstrapping through one small (458 MB / 1 vCPU) testnet bridge.

- **Connect storm.** 20 relays launching *simultaneously* fire 20 authenticated
  handshakes at the bridge's single core at once. It can't keep up, drops
  connections, they reconnect — a self-sustaining storm (admit-then-drop, load
  pegged). The fix is simply to **stagger launches**: the relay fleet launcher
  now spaces them out (default 600 ms apart), and a staggered fleet holds cleanly
  where a simultaneous one thrashes. The bridge host never needed to be bigger —
  it just can't be knocked on by everyone at the same instant.
- **Graduation storm.** The first graduation cut released *many* peers at once,
  which thinned the mesh enough that they re-dialed and were re-graduated —
  another churn loop. 2.90.0 fixes it: graduation is now **paced** (one peer at a
  time, only above a hysteresis band, never re-releasing the same node within a
  cooldown), and the keep-set is chosen by real **keyspace region** so the bridge
  retains a diverse anchor set instead of clustered same-host relays.

The lesson generalizes: **bursts are the enemy, not scale.** Spread the joins and
the same small bridge carries far more.

## The alert-bot numbers (failures out of 102 total publications)

Cross-region publisher (region 0x89) → 0x80 topics, fresh subscriber, the
standard run. **Lower is better — these count topics that got zero delivery:**

| Substrate | Failed / 102 | Delivered |
|---|---|---|
| 3 grizzly relays | 16 | 84% |
| 10 relays | 7 | 93% |
| 20 relays | 3 | 97% |

Delivery scales with the number of stable 0x80 hosts — roughly halving the
failures each time the fleet doubles. Then, on a stable 20-relay warm mesh, we
made the **test itself fairer** by staggering the subscribes (a real deployment's
subscribers trickle in; they don't all hit the topic roots in one synchronized
53-subscribe burst):

| 20-relay warm mesh | Failed / 102 | Delivered |
|---|---|---|
| burst subscribe (all at once) | 3 | 97% |
| **staggered subscribe (300 ms)** | **2** | **98%** |

Staggering both improved delivery and is the more honest measurement.

## What's deployed (testnet)

| Component | Version | Notes |
|---|---|---|
| Kernel `@axona/protocol` | **4.35.0** | client honours the 4200 graduation signal |
| Bridge | **2.90.0** | cap 32 + paced, region-diverse graduation |
| Relay | **0.69.0** | `scripts/fleet.mjs` — staggered launch + live dashboard |
| Peer app / demo | 4.35.0 | |

Production stays on 4.29.0 pending the read-path fix below.

## The remaining residual, and the next kernel step

The last couple of failures are all "**write landed, read didn't**": the message
is sitting on the grizzly cohort, the subscriber self-roots nothing, but the
fresh cross-region subscriber's replay request lands on a root that stalls and
nothing else steps in. The write half (eager cohort distribution) already
shipped; the missing piece is the **read half — a backup replica serving the
replay when the primary root is slow or dead.** That's the kernel change that
closes the last ~2% that staggering and more relays can't, and it's the gate for
promoting this stack to production.

## For Howard

1. **Upgrade to 4.35.0** (`npm install github:axona-net/axona-protocol#v4.35.0`
   on your hosts + the bot; verify the handshake reports 4.35.0). This folds in
   the earlier leave-order fix *and* graduation handling.
2. **Running relays is now one command** — the cross-platform fleet launcher
   (`node scripts/fleet.mjs --region grizzly --count N --network testnet`, with a
   live status dashboard). See the Services Guide v4.35.0.
3. **A fairer alert-bot test** — `--subStaggerMs` spreads the subscriptions out
   instead of firing all 53 at once. Proposed as a small, backward-compatible PR:
   <https://github.com/YZ-social/alert-bot/pull/2> (default keeps current
   behaviour; use it if useful). With it, a 20-relay warm mesh delivered 98%.
