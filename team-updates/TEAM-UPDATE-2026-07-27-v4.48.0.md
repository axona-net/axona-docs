# Team update — 2026-07-27 · kernel 4.48.0 on prod and testnet

*A day that started as an admission-control release, produced a 50-minute production
outage, and ended with the underlying defect found, fixed and fenced. Everything is
on 4.48.0 now — both bridges, all 9 prod relays, and every app. The interesting part
is not the release, it is what the outage taught us about our guards.*

---

## 1. What shipped

| Component | Version | Kernel |
|---|---|---|
| Prod bridges east + west | 2.101.0 | **4.48.0** |
| Prod relays ×9 (sfo3 / nyc3 / tor1) | 0.90.0 | **4.48.0** |
| Testnet bridge | 2.101.0 | **4.48.0** |
| Testnet demo | — | **4.48.0** |
| axona.chat | 0.39.0 | **4.48.0** |
| demo.axona.net apps | `?v=4.48.0` | **4.48.0** |
| axona-share (standalone) | 0.17.0 | **4.48.0** |
| axona-peer | 4.7.0 | 4.38.0 — **frozen, deliberately untouched** |

Three kernel releases landed:

- **4.46.0 — axonic admission control.** A node can finally refuse a role.
  `canAcceptRole()` is one gate with three reasons and two tiers: `bridge` is HARD,
  `not-seated` / `saturated` / `paced` are SOFT and overridable by the floor. Without
  that floor a fleet-wide restart would leave every topic unrooted.
- **4.47.0 — capacity is MEASURED, not counted.** The saturation predicate stopped
  being `axonRoles.size` and became two observed pressures: `servicePressure`
  (staleness / `DROP_MS`) and `helloPressure` (tick lag / `HELLO_DEADLINE_MS`). The
  count was never a ceiling — prod ran 184–1182 roles against a `MAX_ROLES` of 96, a
  number exceeded twelvefold in normal operation.
- **4.48.0 — a declined message with nowhere to go TERMINATES.** See §3.

---

## 2. The outage — 15:02–15:52 UTC, east bridge down ~50 minutes

Deploying bridge 2.99.0 wedged east at startup. It logged `listen`, then the event loop
saturated at ~94% CPU and never yielded again: no timers, no sockets, no health check, no
further log lines. Caddy returned **502 to real users** — axona.chat, demo.axona.net, a
developer on localhost — and to all three relay droplets.

**Rolling back to 2.98.0 did NOT recover it. 2.97.0 came up in under 10 seconds under the
identical load.** That isolated it: not load, not 4.47.0. 2.98.0 was the first bad version,
and it contained exactly one source change — the bridge fence.

West was never deployed and stayed up throughout. **East-first ordering is the only reason
a bootstrap path survived.** Keep doing that.

---

## 3. Root cause, reproduced

A bridge publishes its own directory entry at launch, when its synaptome is empty. It is
therefore TERMINAL for its own directory topic — nobody is closer. Under the fence it
refuses to root the very topic it is publishing, `become()` returns null, and the 4.46.0
decline path re-routes the PUB. With the via chain exhausted, routing falls through to the
topic id, the DHT hands the message straight back, and:

```
_onPub → _becomeRoot → admitRole → refuse → reroute → _onPub → …
```

synchronously and unbounded. **49,999 of 50,000 admission calls returned `why:'bridge'`.**

Isolated 2×2, offline, with the uplink severed so it could not touch prod:

| directory | fence | result |
|---|---|---|
| on | **on** | **WEDGED** — HTTP 000, CPU 93.9% |
| on | off | healthy — HTTP 200, CPU 0.4% |
| **off** | on | healthy — HTTP 200, CPU 0.0% |

Both conditions required. **Testnet could not have caught this by construction**: the
testnet bridge had been running the bad version happily for hours with 0 client-hellos and
0 directory publishes. A green testnet bridge is not evidence for a prod bridge.

**Two fixes, deliberately both:**

- **bridge 2.100.0 — the establishment gate.** Do not advertise until
  `BRIDGE_DIRECTORY_MIN_UPTIME_MS` (5 min) AND `BRIDGE_DIRECTORY_MIN_PEERS` (3). The gate
  lives inside `publish()`, so the hourly beat and the post-uplink re-emit cannot
  reintroduce it. This removes the TRIGGER — and it is the honest behaviour anyway: a
  bridge has no business announcing "connect to me" before it can carry traffic.
- **kernel 4.48.0 — `_rerouteDeclined`.** Returns whether a declined message actually
  reached a DIFFERENT node; the end-of-the-line case logs `undeliverable` instead of
  retrying into a wedge. This removes the DEFECT.

`_reroute`'s dead-waypoint fall-through is **unchanged** — 9 callers depend on it, and it
is how a subscriber pinned to a dead root re-homes onto a fresh one. Folding the terminal
guard into it broke exactly that, and `smoke_pubsub_core` caught it. That failure is why
the two are now separate methods, and a test pins the fall-through so nobody re-merges them.

A second bug fell out in passing: `sub-terminal` used to swallow a refused SUB silently,
so the subscriber never attached and nobody was told. Same missing concept wearing the
opposite face — infinite loop on publish, silent loss on subscribe.

---

## 4. What this says about our guards

Three guards were involved. Two behaved perfectly and still did not save us.

**`check_kernel_pin` is a drift check, not a currency check.** It asserts
declared = locked = installed. During the axona.chat update all three agreed — at 4.43.0 —
because `npm install --save` had aborted on an unrelated peer conflict. It printed `✓` and
the correct (stale) number. Nothing was wrong with the tool; the number was not read. We
are NOT changing it: apps deliberately pin older kernels, and a guard that demanded latest
everywhere would be wrong and would get muted.

**Piping a command discards its exit code.** `cmd | tail -n` reports `tail`'s status, so
`set -e` sails past the failure. This bit twice in one day: a refused `git pull` that
redeployed old code while printing `Updating <old>..<new>`, and a failed `npm install` that
produced a bundle on the old kernel under a new version number. Both were caught by
checking the ARTIFACT afterwards — HEAD sha, installed version, built bundle — never by the
command's own report.

**Deploy hazard, bare-metal only:** `npm install` on a droplet rewrites
`package-lock.json`, so the tree is dirty and the next `git pull --ff-only` refuses, every
time. Use `git fetch && git reset --hard origin/<branch>`. Prod bridges are immune by
accident (Docker runs npm inside the image); relay droplets are not.

---

## 5. Open

- **`src/uplink.js` has no opt-out**, and always appends the prod bridges to
  `DEFAULT_UPSTREAMS`. Any bridge started anywhere with the directory on will dial prod and
  advertise itself into the real public directory, which every client persists with no
  clean undo. Wants an explicit opt-out and env seeds that REPLACE rather than prepend.
- **Testnet's directory protection is incidental, not deliberate.** Neither
  `BRIDGE_DIRECTORY` nor `BRIDGE_PUBLIC_URL` is set there; what actually stops it
  publishing is the missing URL. Should be stated explicitly.
- **axona.net doc links still point at `-v4.38.0` filenames** — four kernel versions
  stale. Wants a docs re-version cycle.
- **alert-bot ARM B** is running as this is written (kernel 4.48.0, grizzly/0x80, prod,
  8 local grizzly relays + 9 prod relays + ~20 Windows relays). Note it is **not** a
  single-variable A/B against ARM-A: both the client kernel and the fleet changed.

---

*Kernel 4.48.0 · bridge 2.101.0 · relay 0.90.0 · verified live on prod and testnet
2026-07-27.*
