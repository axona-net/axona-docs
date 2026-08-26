# Team update — kernel 4.68.2 on testnet, production target Friday

*2026-08-26 · kernel 4.68.2 (testnet `b58474f`) · production baseline 4.62.2*

How far is testnet ahead of production, and what does Friday's deploy actually
change? Production runs kernel 4.62.2 — both prod bridges report it at
`/healthz`. Testnet's M4 fleet rolled to 4.68.2 tonight: 26 of 26 relays,
start-then-stop, census 26/26 at every slot, every departure into a fleet that
already contained its successor. The M1 twelve join tonight when that machine
is back on the LAN. The testnet bridge is still level with prod at 4.62.2 and
gets its own update before Friday.

The distance from 4.62.2 to 4.68.2 is 140 commits in three arcs.

## Arc 1 — REF-1.1: one door for every frame (4.63.0)

Every wire frame the kernel dispatches now registers through a single canonical
door, `registerFrame`. The raw dispatch primitives — `onRequest`,
`onNotification`, `onRoutedMessage` — are sealed out of every public receiver:
the capability that installs a handler lives in a module-private channel, and
both an AST gate and a runtime boundary check enforce the absence. A frame
handler that tries to go around the door fails the build.

This changes no bytes on the wire. What it changes is what a bug can do: before
REF-1.1, any code with a transport reference could install a dispatch handler;
now there is one auditable list of 39 registration sites and a CI gate that
fails when the tree drifts from it. The refactor went through five review
phases (E0 manifest, E1 door, E2 migration of all 38 frames, E3 seal, E4
enforcement) and has been running on the testnet fleet since August 18.

## Arc 2 — the via-hint removal (4.64.0)

On (re)subscribe, the kernel used to route through a cached root-hint. 4.64.0
drops the hint and routes greedy, trusting the synaptome. This is a behavior
change, so it carries its own evidence: 40 paired realizations across 8 frozen
scenario plans, warm delivery Δ −0.81 ± 1.54 points (a wash), post-churn
recovery Δ +0.86 ± 1.05 with 6 of 8 seeds favoring removal. One scenario (seed
3) keeps a ~3-point warm advantage with the hint. The claim is
no-systematic-regression, not improvement.

## Arc 3 — the connection-quality stack (4.65.0 → 4.68.2), everything OFF

Four capabilities, every one opt-in, every one shipped with its arming constant
at the off position:

- **Hold-or-improve admission gate** (4.65): below the synaptome budget hold
  every sponsor; at the budget, admit only a structural improvement, by an
  id-derivable compare — refuse-and-close otherwise.
- **dht:presence** (4.66): a self-signed, nonce-bound record that lets a
  restarted node announce itself, so a neighbour's exhausted retry budget can
  refill without polling.
- **Attempt guard + join lane** (4.67): a per-candidate dial budget with
  exponential backoff — the fix for the maintenance storm that got synaptome
  maintenance reverted in June — and a reserved admission lane inside the cap
  so a mature mesh still admits newcomers.
- **Deferred refusal-close** (4.68): the gate's refusal stands, but the channel
  close waits a bounded window, and is skipped if the peer is admitted
  meanwhile.

The grace window exists because of a benchmark that looked too good. The
simulator's Axona protocol scored 100% lookup success — and it turned out the
sim was cheating, seating 51–73 synaptome entries against a budget of 50 on
every node measured. Armed honestly, the gate's refusal-time close cost 7.2
points of global lookup success at 5,000 nodes: the close, fired during a
node's own admission window, destroyed channels that later admissible edges
would have ridden. Four controlled arms isolated that mechanism; a 5-second
deferred close restored 1000/1000 lookups across three seeds. The full
benchmark rerun — 5,000 nodes, 500 lookups per cell, gate armed, budget
enforced — reads 100.0% on every cell at a cost of +0.23 hops and +8.6 ms
global. That is one run at one N on the sim transport. It is not fleet
validation, and nothing in Friday's deploy arms it.

The review rounds earned their keep here. Council review of the grace slice
found four dormant-path defects across two rounds — a channel-count bound that
arithmetic showed could exceed the physical cap, timers that survived teardown,
unvalidated configuration, and a duplicate-refusal path that closed the very
channel the grace guaranteed. Two of the four were in claims I made in the
submission. All four are fixed and regression-tested; the targeted suite is 37
checks, and 4.68.2 cleared all four council seats unanimously, each seat
reproducing the suite independently.

## What Friday's production deploy changes — and what it does not

The behavior delta on production is arc 1 and arc 2: the sealed dispatch door
and the greedy subscribe path. Arc 3 ships dormant. `closeGraceMs=0` is the
default, and at 0 the refusal-close path is byte-identical to what production
runs today. This deploy does NOT arm the gate, the guard, the lane, presence,
or the grace window — arming any of them, anywhere, is a separate decision
with its own evidence bar, and the armed-canary program is that bar's
instrument.

## The path to Friday

1. **Tonight:** M1 returns to the LAN; its 12 relays roll the same staged way.
   Testnet fleet uniform at 38 × 4.68.2.
2. **Wednesday night → Friday:** soak on the full fleet. Watch: census stable
   at 38, end-to-end delivery (the hourly chime is the standing probe), role
   counts under churn (the #51 eviction-storm shape is the named thing to look
   for), memory and CPU flat.
3. **Thursday:** bridge track. Re-vendor 4.68.2 into axona-bridge, suite +
   kernel-pin check, deploy to the testnet bridge. A green testnet bridge is
   weak evidence — it sees no client load — which is why prod goes east-first.
4. **Friday, on David's go, in order:** push testnet → main across protocol,
   relay, and bridge; east bridge first, verify `/healthz` at 4.68.2 before
   west; relay droplets staggered, one unit at a time — a simultaneous restart
   is how five relays locked themselves out in July; apps last. Every deploy
   command logged through the council-override hook.
5. **Abort criteria:** any census drop below strength, delivery regression on
   the standing probes, or a healthz that won't converge — stop, leave the
   remaining surfaces on 4.62.2, and bring the evidence back. A half-promoted
   estate is a known cost; dead topics are not.

The soak between now and Friday is the gate. If it is not clean, Friday moves.
