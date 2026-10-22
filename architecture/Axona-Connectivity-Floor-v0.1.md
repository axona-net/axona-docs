# Axona Connectivity Floor — design packet v0.1

**Status:** PROPOSAL, for council review. Nothing built. David's direction,
council 5340c376 (17:18Z 2026-10-22): "With a small population of nodes in the
mesh, we should see 100% connectivity. As long as a node is under some
threshold, there is never a need to drop a node unless it proves to be
untrustworthy or it leaves on its own. … a node should be more aggressive in
finding new peers to connect to when it is below this threshold. For example,
let's set the inbound threshold to 40 nodes." He asked for this proposal to
share with council (after 17:54Z; this packet 18:03Z by the clock at
commit). The first round of answers is Aster bdc46df0,
Orion 41e5ec84 and axona.bot 1d3d6208. Every line number below is read from
axona-protocol at `2cf25a7` (tag v4.119.0), the kernel the fleet runs since
15:16Z 2026-10-22.

---

## Part 1. The question

Why does a relay in a mesh of about fifty-five nodes hold thirty-five peers,
and not all of them?

At 17:19Z 2026-10-22 the fleet was 48 relays, two production bridges, the
testnet pair and a handful of seats and browser tabs. The 28 relays whose
health dump lists every role held 5 to 47 peers, median 35. The 20 Windows
relays report totals only and held 5 to 33. Every relay runs the two-pool
profile M 50, I 50, H 100, armed and enforcing. The incoming pool I was 0 on
every relay, because every inbound channel is promoted into M. So no relay is
near a cap, and none is near full connectivity either.

## Part 2. What this is NOT

- It is NOT a fix for dials that never open. One M1 relay logged 135 channels
  that died in negotiation (30 s deadline, mostly in `datachannel-opening`)
  between 14:52Z and 17:2xZ. Dialing harder sends more of them. That is a
  separate diagnosis, owed before anyone reads the floor's results.
- It is NOT a change to the caps. M, I and H stay where the profile sets them.
  The floor sits under them.
- It is NOT a full-mesh guarantee. Full direct connectivity needs both ends to
  know of each other, admit each other and reach each other through NAT. The
  floor makes a node try; it cannot make the far end answer.
- It does NOT touch liveness, security, duplicate-channel or departure closes.
  A peer that goes silent, fails its handshake, duplicates a channel or says
  goodbye still goes.
- It is NOT a claim that a full mesh prevents root splits. The #jokes split of
  15:20Z to about 17:10Z happened at a median of 35 peers; nobody has shown it
  would not happen at 50.

## Part 3. What the kernel does today

**Keeping.** Below the managed cap a relay does not close a healthy peer by
choice. Every elective close in the kernel waits for the table to be full.
`_gateDecision` (AxonaPeer.js:3122) admits everything while
`syn.size < cap` (:3129), except that the relay's join lane (`kJoin: 2`,
axona-relay relay.js:101) rations the last two slots, so lane refusals start
at 48 of 50 (:3137). The gate swap and the refusal close sit behind that test.
The degree cap (`_enforceDegree`, mesh.js:823) and make-room
(`retireForNewcomer`, mesh.js:1245) run only where `meshDegree` is passed, and
only the bridge passes it (bridge `fill_arming.js`, `BRIDGE_MESH_MAX_PEERS`,
50 in production).

The logs agree. On the four droplets between 16:00Z and 17:29Z, 26 elective
closes (`closeConnection`) hit open channels, and 25 of them had exchanged
zero pings: the losing half of two nodes dialing each other at once. One
was an established peer. 57 closes came from the far side. On M1 relay 1,
seven established channels closed electively, all in the 15:00Z roll window,
and since 16:00Z that relay logged one teardown of any kind.

What does drop a peer below cap is liveness: nothing received for `deadMs`
20 000 ms (mesh.js:116), or a channel open but unbound for 30 000 ms
(`MESH_BIND_DEADLINE_MS`, mesh.js:145).

**Seeking.** The fill targets M, not any floor, at a fixed pace
(AxonaPeer.js:285-288, relay.js:95):

| knob | value | where |
|---|---|---|
| tick | 15 000 ms | `intervalMs`, AxonaPeer.js:285, timer at :860 |
| dials per tick | 3 | `maxPerTick` |
| dials in flight | 8 | `pPending` |
| candidate cache | 64 | `kCache` |
| directory re-contact | 600 000 ms, drawn in [T/2, 3T/2] | `directoryMs` |
| after a tick that dials nobody | 30 s, 60 s, 120 s, … NO ceiling | `DeficitBackoff`, attemptGuard.js:173-186; relay.js:104 |
| per-identity retry | 4 attempts, 30 s × 2 | relay.js:103 |
| emergency re-warm | below 3 bound peers, cooldown 60 s doubling to 600 s | constants.js:173-181 |

Nothing reacts harder at 10 peers than at 45. The only extra push starts below
three, and it backs off too. Browsers and apps that start through `connect()`
run no fill at all; they take the bridge's peer list once and dial what is on
it. There is no notion of an inbound threshold anywhere in the code.

## Part 4. The proposal

**T, the floor.** One number, `CONNECTIVITY_FLOOR`, default 40. It counts
**unique usable peers across both pools**, M ∪ I, as `_usablePeers()`
(AxonaPeer.js:1877) already does. Not inbound alone: a node cannot make
anyone dial it, and 40 inbound is not 40 total. A profile clamps it,
`T_eff = min(T, M + I, H)`, so a leaf profile (M 6, I 6) floors at 12, not 40.
And it never asks for more than exists: `T_target = min(T_eff, known − 1)`,
where `known` is the distinct eligible identities the node has heard of.

**K. Keep everything below T.** While usable < T_eff, no elective close picks
a victim. Five sites take the guard:

1. the gate swap in `_gateDecision` (AxonaPeer.js:3122 onward);
2. the refusal close in `_seedSynaptomeWithSponsor` (AxonaPeer.js:2770;
   lane refusals included);
3. the near-improve step of `_fillTick` (AxonaPeer.js:2007, the at-cap
   branch);
4. `_enforceDegree` (mesh.js:823), bridge;
5. `retireForNewcomer` (mesh.js:1245), bridge.

On a relay today the guard changes nothing, because all three kernel sites
already wait for 48 or 50. It exists so that a smaller profile, a bridge, or a
future cap cannot take a node below T by choice. Liveness, security,
duplicate and departure closes are untouched (Part 2).

**S. Seek harder below T.** While usable < T_target:

- **S1 tick.** 5 000 ms instead of 15 000.
- **S2 dials per tick.** `min(8, 3 + ⌈(T_target − usable) / 5⌉)`, so 3 at the
  floor and 8 at 25 or more short.
- **S3 in flight.** `pPending` stays 8. The ledger already bounds it, and the
  per-identity guard (4 attempts, 30 s × 2) keeps a peer that will not answer
  from being hammered.
- **S4 backoff ceiling.** `DeficitBackoff` gets a ceiling of 60 s while below
  T, and resets whenever fresh supply arrives (a peer list, a presence record,
  a bridge directory answer).
- **S5 directory.** Ask the bridge directory as soon as the deficit is seen,
  then every 60 s drawn in [30 s, 90 s] while below T, back to 10 min at T.
- **S6 self-integrate.** Allow dialing through existing peers
  (`connectViaRelay`) while below T, as the guarded path already does.
- **S7 browsers and apps.** A light seeker in `connect()`: on a timer, ask the
  bridge for its peer list and dial what is not held, bounded the same way.
  Or arm the full fill there. Council to choose (Part 6).

Above T, every knob returns to today's value. The floor changes behaviour
only while a node is short.

## Part 5. How we would know

**Offline, before any build is merged.** New fences, each asserting its
precondition and turned red by deleting its fix:

- floor crossing: a node at T − 1 refuses to pick a victim at every K site; at
  T + 1 the site behaves as today;
- a smaller profile (M 6, I 6) floors at 12, never at 40;
- `T_target` never exceeds `known − 1`;
- S1 to S5 engage below T and return at T, including after a sleep;
- remote full: a far end at its cap refuses, and the near end defers instead of
  retrying faster;
- two nodes dialing each other at once still end with one channel.

About 25 existing fences pin today's numbers (fill tick, re-warm gaps of 120,
240, 480, 600 s, deficit backoff, gate and lane, degree, close classes). Each
moves in the same change, named in the build's notes.

**In the field, after a release.** The same census as 17:19Z, at T0, +10 and
+30 minutes after a roll: per relay, usable peers, with median and minimum.
Beside it, the negotiation-timeout rate per relay per hour, reported
separately so that more dialing is not mistaken for more connecting.

## Part 6. Open questions for council

1. **What is 40 a floor on?** Total usable peers across both pools (this
   packet), or the incoming pool alone (David's word "inbound")? Total is what
   a node can measure and pursue; inbound alone is what it cannot cause.
2. **Fixed 40, or a share of the population?** Fixed 40 with
   `min(40, known − 1)` (this packet), or a fraction such as 80% of known?
3. **Browsers and apps:** a light seeker in `connect()`, the full fill armed
   there, or out of scope for this round?
4. **The seek numbers:** 5 s tick, up to 8 dials per tick, 60 s backoff
   ceiling, 60 s directory while short. Are these the opening values, or
   should they come from a run first?
5. **Liveness while short:** keep 20 s silence and 30 s unbound as today, or
   allow a longer silence while below T, so that a stalled but healthy peer is
   not lost when it is hardest to replace?
6. **The failed negotiations:** diagnose them before building the seek half,
   or build both and measure them side by side?

## Part 7. What would make this wrong

A mesh where the far ends do not answer. If most of the shortfall is dials
that die in negotiation, the seek half raises the dial rate and the timeout
count and leaves the median where it is. That is the reading Part 5 must
check first. And a population that grows past the caps: at 200 nodes, T 40 is
a floor under M 50 and changes nothing, which is the intent, but the 5 s tick
would then run on any node that falls short, and its cost on a large mesh is
unmeasured.
