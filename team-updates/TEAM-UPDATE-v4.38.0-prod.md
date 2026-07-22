# Team Update — the bridge can no longer take the mesh down with it (2026-07-22, PROD)

**TL;DR: the existential one is fixed and live on production. A node leaving the
signaling bridge no longer tears down the peer-to-peer mesh — the property the
whole "the bridge is bootstrap-only" premise rests on. We proved the bug and the
fix end-to-end over real WebRTC, shipped it to prod as kernel 4.38.0 (both
bridges + the 9-relay backbone), and on the way built a graduation model that
now releases the *best-meshed* node on measured evidence instead of a uptime
guess. Graduation stays OFF on prod until the browser-client population updates;
it's validated ON, churn-free, on the testnet fleet.**

---

## What was wrong (the existential part)

The bridge caps its connections and *graduates* an established, meshed peer
(WS close 4200) to free a slot — the peer is supposed to keep its mesh and just
lose the bridge link. In practice a fully-meshed relay dropped to **peers=0 the
instant it graduated**, then re-dialed and rebuilt — an `open→graduate→peers=0→open`
churn loop, the exact opposite of the intent.

Root cause, traced to two code sites:

1. **Bridge** broadcasts `peer-left(X)` to the whole mesh whenever *any* client
   socket closes — including a graduation.
2. **Kernel mesh** (`mesh.onPeerLeft`) took that at face value and tore down the
   **live, authenticated DTLS channel** to X — even though the channel was open
   and moving bytes.

So the graduate kept *its* mesh, but every *other* node slammed its channel to
the graduate shut on the bridge's say-so. The bridgeless-connection proof from
months ago only tested the bridge *process dying* in a 2-peer harness — it never
tested a graceful per-client close with witnesses still on the bridge to receive
the broadcast. That's the gap that hid this.

The deeper framing (the one that shaped the fix): a third party (the bridge)
was force-evicting a peer from someone else's mesh. Axona already forbids exactly
this for a peer's own departure — the graceful `peer-leaving` path evicts *only
its authenticated origin*. The bridge roster was a side door around that rule.

## The fix (kernel 4.37.0 → shipped in 4.38.0)

A node retires a peer for exactly two first-party reasons: the peer
authentically announces its **own** departure, or the **direct channel's own
vitality** (keepalive + connection-state) reaches zero. A bridge `peer-left` is
neither. So: **if the channel to a peer named in a `peer-left` is currently
open, the notice is disregarded** — the channel's own liveness governs teardown.
A peer that truly vanished is still reaped within seconds; a peer that only left
the bridge keeps its place in the mesh.

## The graduation model, rebuilt (kernel 4.38.0 + bridge 2.92.0)

Once graduation is *survivable*, we made it *smart*. The client now reports its
live mesh size (`meshBound`) on the existing heartbeat, and the bridge graduates
on evidence:

> **Graduate the best-meshed peer (highest fresh `meshBound`, above a safe
> floor) in the most over-represented keyspace region — never a region's last
> node.**

Keyspace balance (the set the bridge keeps spans the whole address space) stays
the primary axis; measured vitality decides *which* node in the crowded region —
always the one the mesh can most afford to lose. Selection is a pure, unit-tested
module (`graduation_select.js`); old clients that don't report `meshBound` fall
back to the uptime proxy, so a mixed fleet degrades gracefully.

## Tested

- **Instrumented probe** (`test/integration/graduation_probe.mjs`, real bridge +
  real node-datachannel): a fully-meshed node severs its own bridge link →
  **before fix: mesh collapses to 0 in ~250 ms** with `peer-left` teardowns on
  `state=open` channels; **after fix: mesh stays fully bound for 9 s, zero
  teardowns.**
- **Unit regression** `smoke_mesh_peer_left_live.js` (13/13, in `npm test`);
  `smoke-graduation-select.js` (15/15, bridge suite); full kernel + bridge suites
  green.
- **Live testnet validation** — 30-relay fleet (uniformly 4.38), `MAX_PEERS`
  lowered to force graduation: **23 graduations, all `basis:vitality`; graduated
  relays kept their full mesh (`state=graduated peers=39–42`, not 0);
  graduation-redials = 0; `peers=0` events across the whole soak = 0.** The exact
  inversion of the original bug, in the wild.

## What's deployed

| Component | Version |
|---|---|
| Kernel `@axona/protocol` | **4.38.0** (main + tag) |
| Bridges (east + west, Docker) | **2.92.0 / 4.38.0** |
| Prod relay backbone (9 relays, 3 droplets) | **0.71.0 / 4.38.0** |
| Peer (axona.net) / demo apps / axona-share | re-vendored / re-pinned to 4.38.0 |
| README install pin | **v4.38.0** |

Rolled without a mesh outage: bridges one at a time (Caddy/coturn stayed up),
backbone one droplet at a time so 6 relays always covered the roots.

## Learnings

- **A "proof" is only as strong as the failure mode it exercised.** Bridgeless
  survival was proven for *abrupt bridge death*, not a *graceful per-client
  close with live witnesses* — and the bug lived precisely in that gap.
- **The mock-mesh smokes passed 30/30** and never caught this, because they never
  ran a real DTLS channel across a 4200 close. Real-WebRTC integration coverage
  earns its keep.
- **`peer-left` from the bridge was a third-party force-eviction** — the same
  thing the protocol already refuses for authenticated `peer-leaving`. The fix
  is "make the bridge roster defer to the mechanisms that already exist," not a
  new special case.

## Open / next

- **Graduation stays OFF on both prod bridges** (`BRIDGE_NURSERY=off`; note the
  unset default is *on*). The guard is client-side, and prod has cached older
  browser clients (< 4.37). Re-enable once the client population has cycled to
  ≥ 4.37 — one env flip + restart.
- **Keyspace-pinned empty roots are never reaped** (Howard's find): `host()`
  nodes pin every topic they win ROOT for, so `axonRoles` climbs monotonically.
  It's resource accrual, **not** a split-brain risk (a pinned root still yields
  to a strictly-closer live node via `_verifyRoots` — demotion overrides the
  pin). A bounded idle-TTL reaper (`repairPlane.js` TODO(Phase 4)) is the fix.
- **axona.chat "blank topics after update"** is a separate client bug, in its own
  task — message history isn't cached; a reload must re-subscribe to repopulate,
  and that path is failing after the SW update.
