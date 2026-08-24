# Arming hold-or-improve: constants and the two-relay canary (v0.2)

**Status:** proposal — nothing in this document arms, rolls, or deploys
anything · **Date:** 2026-08-24 · **Kernel:** 4.67.1 (testnet `7fc3e56`),
fleet deployed on 4.62.2 · **Evidence base:** definition v0.8 (`6291d12`,
unanimous), implementation slices 1–3 (unanimous), live 6522f2f correlation
(`85d6baa`, unanimous) · **Prerequisites this proposal answers:** the two the
seats attached at correlation closure — sustained evidence beyond a drained
leaf, and the presence valve exercised live ·
**v0.2 revision (Vega `b8a1164d`; Orion `bc40d459` approved v0.1):** the
"inert plumbing" claim was wrong for the one flag that mattered — an old
vendor already understands `synaptomeMaintain`, so that env alone against
4.62.2 is the June storm unguarded; the plumbing now VERSION-GATES all
arming envs and refuses to start below kernel 4.67. And the observation
plan is tightened so a quiet soak cannot pass by being idle: the guard
ledger is logged, a reopened deficit is a REQUIRED observation, and the
valve test asserts the canary-to-canary bond and the watermark advance
explicitly.

---

## The question

Every mechanism the connection-quality definition specifies is in the kernel,
reviewed, and proven against the live mesh — and every one of them is off.
What is the smallest step that turns the evidence into operating experience
without putting the fleet at risk?

Two armed canary relays, added beside the fleet, removable in one command.
This document proposes the constants they run and the runbook that governs
them. David's go is required at each step, and the standing fleet rules do
not cover this operation — that gap is stated below, not papered over.

## The constants

The matrix decides properties; the live runs decide scales. Every value
below is either a kernel default already exercised by the 46-check matrix
(green three times today), a council-set structural constant, or a scale
chosen from measured live behavior. Each carries its derivation and what
would make it wrong.

| Constant | Value | Derivation |
|---|---|---|
| `synaptomeMaintain.kNear` | 5 | The kernel's near-quota convention throughout; the matrix and both live canary phases ran it. |
| `synaptomeMaintain.intervalMs` | 15000 | The historical default — the configuration that stormed in June. Running it UNCHANGED is the point: the guard, not a slower tick, is the remedy under test. |
| `synaptomeMaintain.maxPerTick` | 3 | Historical default; the c16d12b storm rate (3/tick) was measured at it. |
| `attemptGuard.maxAttempts` | 4 | Live-validated: phase 2 capped never-binders at exactly 4 while unguarded reached 5+ under the same churn. Wrong if live bind latencies ever need a 5th try — the phase-1 data shows binds succeeding within 1–5 attempts on bootstrap paths, outside the guard. |
| `attemptGuard.baseMs` | 30000 | Twice the transport's 15 s handshake timeout, so a retry never races its own pending negotiation. Budget span 30+60+120 s ≈ 3.5 min of patience per candidate. |
| `attemptGuard.factor` | 2 | The matrix's exercised backoff shape. |
| `attemptGuard.refillWindowMs` | 60000 | Worst case toward a flapping armed origin: one budget per minute = 4 dials/min. Wrong if that rate is still too hot fleet-wide — the canary soak measures it. |
| deficit `baseMs` / `factor` | 30000 / 2 | Same shape as the guard; an empty deficit backs off to silence, any attempt or record resets. |
| `admissionGate.kNear` | 5 | Matches the quota. |
| `admissionGate.sparseFloor` | 2 | Council-set (r ≥ 2, the widened canPrune rule). |
| swap margin | +2 | Council-ratified structural integer (v0.7); not tunable. |
| `admissionGate.kJoin` | 2 | Orion's proposal, matrix-validated lane bound. Reserve-from-cap: operational table = cap − 2. |
| `laneCooldownMs` | 5000 | Testnet joins are minutes apart; one lane admission per node per 5 s is generous without being a door. |
| `laneWindowMs` | 300000 | One lane admission per identity per 5 min. |
| `presence.announceOnStart` | true | The valve's trigger; gen increments per restart, never persisted. |
| `presence.relayRateMs` | 30000 | One relayed copy per origin per 30 s per relay; the receiver's refill pacing bounds the rest. |

No kernel change is needed: these are constructor options, set at arm time.

## Wire compatibility, measured

A 4.67.1 peer announcing `presence` into the deployed 4.62.2 fleet is the
mixed-version case the canaries create on day one. Measured today: two
announcements to 20 fleet relays each; every channel stayed bound through
both, and the healthy relays' per-second logs show no error, no warning, no
state change through the announce window. An unknown notification on 4.62.2
is ignored. The canaries can speak before the fleet understands them.

## The runbook

**What this is not.** Not a fleet roll — `roll-fleet.sh` replaces the whole
measured fleet and has no subset mode, and nothing here modifies it. Not a
cold start. The standing rules name those two operations and no third; an
ADDITIVE canary — new relays joining a live fleet — is a new operation
class, and this runbook exists to be sanctioned as its procedure. Until
David sanctions it, it is text.

**Prepare** (code ready, default off, version-gated):
- `createRelay` gains env-driven arming options (`RELAY_SYNAPTOME_MAINTAIN`,
  `RELAY_ADMISSION_GATE`, `RELAY_ATTEMPT_GUARD`, `RELAY_PRESENCE`), default
  off. (v0.2) These are NOT inert against an old vendor: a pre-4.65 kernel
  already understands `synaptomeMaintain`, and that flag alone against
  4.62.2 is the 2026-06-29 storm with no guard. So the plumbing fails
  closed: ANY arming env with a vendored kernel below 4.67 refuses to start,
  loudly, at launch. A misconfigured canary never comes up.
- (v0.2) When armed, `createRelay` logs a once-per-minute `armed-ledger`
  line: guard refills/coalesced, active and expired candidate entries,
  presence watermark count, synaptome size, and `deficitReopens` — the count
  of maintenance passes that actually attempted a refill. The ledger is what
  makes a quiet soak tellable apart from an idle one.
- The canaries run from a DEDICATED checkout with kernel 4.67.1 vendored
  (`scripts/sync-protocol.sh` into a copy), never from the fleet's checkout.
  The standing 26 relays keep their 4.62.2 vendor untouched on disk.
- Census note: the fleet-roll predicate counts `src/index.js` processes.
  While canaries run, the measured count is 28, and any roll during the
  canary window must pass `EXPECT=28` — or wait. Stated here so the number
  is never a surprise.

**Run:** two armed canary relays join the live mesh, staggered by a minute,
region eagle, same bridge. Soak 24–48 h against real fleet churn.

**Observe** — the soak's questions, each with a measurable answer. (v0.2:
"bounded and quiet = pass" was phase 1's mistake wearing a new hat — a
stable node with an empty deficit does not re-probe, so silence proves
nothing. The pass criteria below require the machinery to have been
EXERCISED, not merely to have not misbehaved.)
- Storm indicators: connection-attempt rates from both canaries' logs plus
  the per-minute `armed-ledger` line. Bounded = pass ONLY alongside the
  next criterion.
- A reopened deficit, REQUIRED: `deficitReopens > 0` on at least one canary
  — natural fleet churn should provide it, and the mid-soak restart of
  canary 2 reopens canary 1's deficit toward it in any case. A 48-hour soak
  whose ledger never moved has not tested the guard and discharges nothing;
  it extends until the ledger moves or the plan is revised.
- The valve, live, asserted in three parts (4.62.2 relays do NOT relay
  presence, so delivery is direct-neighbour only): (1) at launch the
  canaries dial EACH OTHER and the bond is verified in both synaptomes;
  (2) mid-soak, canary 2 restarts; (3) canary 1's presence watermark for
  canary 2's identity suffix advances, and canary 2 re-enters canary 1's
  table. All three or the valve was not tested. This is the first live
  exercise of the presence valve — the second prerequisite.
- Sustained evidence: 24–48 h of maintenance-under-real-churn with the
  ledger moving and the table healthy — the sustained case a 20-minute leaf
  could not show — the first prerequisite. (The soak runs the production
  15 s maintenance tick; the phase-2 storm arms ran 5 s. The soak is the
  sustained test AT the production tick, and its ledger is how the slower
  tick's behavior becomes visible.)
- Fleet health: the 26 standing relays' per-second logs, unchanged against
  their week-long baseline. Any regression attributable to the canaries
  aborts.

**Abort:** stop both canaries. A graceful leave into a full-strength fleet
with live heirs is the measured-safe departure; the fleet returns to its
exact prior state. One command, no roll.

**Known conditions, stated:** relays #3 and #17 sit in the sticky
`upgrade-required` latch at zero peers (a standing ledger item) — the
26-process census includes them, so effective fleet strength is ~24 healthy
relays plus the M1 twelve, which are mesh-connected but not manageable from
this machine while it is off the LAN. Neither blocks the canary; both belong
in the observation baseline.

## What success buys

A pass discharges both arming prerequisites with operating data at
production constants, and the next proposal after it can be about the fleet.
A failure is caught by two removable relays, teaches at canary cost, and the
fleet never notices. Either way the guard's first live tour of duty happens
where a mistake is cheap.
