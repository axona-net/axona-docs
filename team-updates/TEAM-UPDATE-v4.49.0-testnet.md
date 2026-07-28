# Team Update — kernel v4.49.0 on testnet

**Date:** 2026-07-28
**Kernel:** 4.49.0 · **Bridge:** 2.103.0 · **Relay:** 0.92.0
**Environment:** testnet only. Production remains on 4.43.0 — this is **not** promoted.

---

## What this release is

The first shipping slice of the architecture-refactor work (Phase A + Phase B). It
is a small release by diff size and a large one by consequence: two of the three
fixes were *silent* failures on running production infrastructure, and the third
made them observable.

The through-line is the one the refactor exists to address: **failures that
succeed quietly**. Every item below was a code path that returned normally, logged
nothing, and left an operator with no way to tell a healthy node from a broken
one.

---

## A1 — `claimReachable()` no longer dereferences null

**What was wrong.** `claimReachable()` called `become()` and read `.isRoot` off the
result. On a node with `neverRoot` armed, `become()` returns `null` **by design** —
that is the refusal. So the read threw. The throw happened inside `refreshTick`,
whose `catch` swallowed it.

The consequence: on such a node, the **entire maintenance tick died on its first
pass over a topic the node was closest to**, and stayed dead for the life of the
process. No log line, no metric, no health change. refreshTick is what re-verifies
roots, drives repair, and services placement — so the node kept accepting traffic
while doing none of its upkeep.

**Where it was armed.** `BRIDGE_NEVER_ROOT` defaults to on, and both production
bridges run with it. Both were subscribed to directory topics. This was live.

**The fix.** A refusal is now returned as a refusal — `claimReachable()` returns
`null` and the caller continues to the read-repair path — rather than throwing.
The refusal semantics are unchanged; only the crash is gone.

**Fence:** `test/smoke_decline_paths.mjs`, 22 assertions.

## A2 — `helloPressure` now decays

**What was wrong.** `_tickLagMax` was an **all-time high-water mark** with no decay.
One stall — a GC pause, a join storm, a laptop lid closing for a minute — pinned
the node at `saturated` permanently. Reproduced: a single 60-second suspension
produced helloPressure 11, and the node was **still saturated after 2050 healthy
ticks**.

Every backgrounded mobile browser peer was therefore refusing HANDOFF for the rest
of its session, having recovered completely.

**The fix.** `_tickLagMax` is the max over a **12-tick rolling window**
(`TICK_LAG_WINDOW`, ≈60s at the 5s default cadence). Pressure that has passed now
reads as passed. The all-time value is retained as `tickLagPeakMs` for diagnosis
only — **it judges nothing.**

This is also what makes B2's `degraded` verdict meaningful: a latched high-water
mark would have reported degraded forever after one hiccup — a health surface that
cries wolf.

**Fence:** `test/smoke_tick_lag_window.mjs`, 22 assertions. Closes issue #403.

## B1 — an unwritable persistence namespace fails loudly

`_writeNamespace()` was a chain of `if (ns === …)` with no `else`. An unknown
namespace fell through, returned `undefined`, and was **indistinguishable from a
completed write** — the flush clears the dirty bit before writing and only
re-queues on a throw. `host()`/`unhost()` marked `'hosting'` dirty at four sites
with no writer, so hosting intent has been silently discarded on every flush since
the feature shipped.

Now throws `PERSIST_UNSUPPORTED_NAMESPACE`; the flush logs it at error level and
does **not** re-queue (retrying cannot conjure a writer). Genuine transient
failures still warn and still retry — the typed code separates the two rather than
suppressing either.

**Fence:** `test/smoke_persist_namespaces.mjs`, 13 assertions, including a static
used→declared scan that would have caught this the day it landed.

> The `'hosting'` gap itself is **still open** — M7 decides whether hosting is
> persisted or the four dirty marks come out. What changed is that the gap is no
> longer silent.

## B2 — `/healthz` can finally report ill health (bridge 2.102.0)

`GET /healthz` returned `"status": "ok"` as an unconditional literal, forever. So
A1 and A2 — armed on our own production bridges — were completely unobservable
from outside.

The exposure is deliberately split, because roles, capacity and refusal counts say
*where and when placement pressure would succeed*, which is what the E-1
placement-defence work asks us not to publish:

- **Public:** one derived verdict — `ok` | `degraded` | `unknown`. Nothing else.
- **Operator:** the full admission block, behind `HEALTHZ_TOKEN`.

Three judgement calls, stated so they can be argued with:

1. **`unknown` is not `ok`.** An absent admission surface reads `unknown`, never a
   cheerful `ok`.
2. **Still HTTP 200 when degraded.** A saturated bridge is still a perfectly good
   *transport* — a bridge never roots — and 5xx would invite a load balancer to
   pull a working bridge from rotation. The body carries the verdict; the status
   line carries reachability.
3. **The public bit is not free.** It tells an observer this bridge is under
   pressure. Accepted deliberately: a monitor has no other way to know, and one
   coarse boolean is far less actionable than role and refusal counts.

The operator token check was also hardened to `timingSafeEqual` over SHA-256
digests, failing closed when unconfigured — the comparison was already
`===`-based, but the value of what it guards went up.

**Fence:** `test/smoke_healthz_exposure.mjs`, 18 assertions.

---

## Deployment state

| Component | Version | Where | Status |
|---|---|---|---|
| kernel | 4.49.0 | tag `v4.49.0` → `789f4bd` | pushed |
| bridge | 2.103.0 | testnet.axona.net | **live** |
| relay | 0.92.0 | — | pushed, no fleet running |
| axona-peer | 4.38.0 | — | FROZEN, deliberately untouched |
| **production** | **4.43.0** | bridge.axona.net east/west | **unchanged** |

`BRIDGE_DIRECTORY=off` verified in the live testnet process environment, with zero
advertise events since restart. The testnet bridge does not advertise.

No testnet relay fleet is running, so this deploy is bridge-only. A meaningful
testnet soak needs ≥40 nodes; below that the number would not mean anything.

---

## What was measured, and what was not

**Live acceptance probe** — kernel 4.49.0, `wss://testnet.axona.net`, region eagle,
two Node peers, a **fresh cold topic per rep**, 2.5s settle between sub and pub:

> **15 / 15 delivered** across two batches (5 and 10).

Latency was sharply **bimodal**, with nothing in between: ≈200 ms real on 9 reps,
≈10.1 s real on 6 reps — roughly 40% slow. 10.1 s is almost exactly two
`refreshIntervalMs` ticks, so the slow path looks like the subscribe not having
reached the root by publish time, with delivery healed by maintenance two ticks
later rather than served on the publish path. **Whether this is new in 4.49.0 is
not established** — no A/B against 4.48.0 was run. Tracked as issue #406; do the
A/B before theorising.

**What this probe does NOT prove.** Worth being blunt, because the two are easy to
conflate:

- **A1's live signature is a non-event** — a refreshTick that no longer dies. The
  swallowing `catch` is precisely what makes it invisible from outside. The probe
  establishes no regression through a bridge running `neverRoot` (the exact
  configuration F1 was armed on); the deterministic fence is the proof.
- **A2 needs a stall to occur and then pass** — a soak observation over hours, not
  a probe result. On the freshly restarted bridge `tickLagMaxMs` and
  `tickLagPeakMs` both read 1 ms; they have not yet had cause to diverge.

Named fences, all green: 22 / 22 / 13 (kernel) + 18 (bridge). Full bridge
`npm test` exit 0 across 8 suites, with `check_kernel_pin` confirming
declared = locked = installed = 4.49.0.

---

## One process note worth keeping

The first `npm install` after editing the bridge's kernel pin reported success and
"0 vulnerabilities" — and **re-resolved nothing**. The lockfile still pointed at
the 4.48.0 commit and `node_modules` still held 4.48.0. Only removing
`node_modules/@axona/protocol` and installing the ref explicitly moved it.

The command's own report was not evidence. The installed `KERNEL_VERSION` was.
Likewise the release tag was verified by asking the **remote** what `v4.49.0`
peels to (`789f4bd`), not by trusting the push output.

---

## Before promoting to production

1. An A/B on issue #406 — is the bimodal cold-topic path new, or long-standing?
2. A soak long enough for `tickLagMaxMs` and `tickLagPeakMs` to diverge, which is
   the only live evidence A2 works.
3. Named rollback signal: **browser-peer role counts rising without a matching
   improvement in delivery.** That would mean A2 opened admission on nodes that
   cannot actually serve, and is the failure mode this release could plausibly
   introduce.
4. Open call: whether to throttle the bridge's `role-refused` logging (~0.5
   lines/s) before it ships to production.
