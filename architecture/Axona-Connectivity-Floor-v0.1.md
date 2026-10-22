# Axona Connectivity Floor — design packet v0.2

**v0.2 (18:22Z 2026-10-22)** answers Aster's DESIGN REQUEST CHANGES 87d42cca
on v0.1 (b33a8ec), four findings, each checked against the packet and each
holding, and carries Orion's review 95b7c3c9. F1: the known − 1 clamp left a
cold node that knows only itself and a bridge with a target of 1, so it never
sought; seeking now engages on the floor alone and only the dials are bounded
by supply. F2: the keep guard tested the count BEFORE the close and so allowed
40 → 39; it now tests the count AFTER the close, re-read at close time. F3:
outbound dials fill M only, so a leaf's floor of 12 was not reachable by
dialing; the deficit is now split into dialable, supply-exhausted and
class-blocked, and none of them grows a cap. F4: the seek paths now share one
bounded seeker with one budget, hysteresis, a generation fence and a strict
meaning for "fresh supply". The whole change sits behind a flag, OFF by
default. Part 6 records all three reviews per question (Vega ca4f7569 added after commit dd4382e).

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

Everything in this part sits behind one flag, `CONNECTIVITY_FLOOR`, OFF by
default. Off, every site behaves as 4.119.0 does, and today's fences keep
pinning that.

**The counts.**

- **U**, usable peers: unique identities with a bound, authenticated channel
  that is not closing, across both pools, as `_usablePeers()`
  (AxonaPeer.js:1877) counts them. An attempt in flight, an unbound channel
  and a proposed replacement are NOT in U. Two channels to one identity count
  once.
- **T**, the floor: 40.
- **T_eff** = min(T, M + I, H). A ceiling set by the profile's budget. A leaf
  (M 6, I 6, H 12) has T_eff 12. T_eff is not a promise that 12 is reachable
  (see the deficit classes below), and nothing raises a cap to meet it.

**K. Keep: never cross the floor by choice.** At each elective close, compute
**U_after**, the usable count if this close goes ahead, at the moment of the
close and not when it was scheduled. If U_after < T_eff, the close does not
happen. A refused-grace close re-reads U when its grace timer fires; a peer
lost during the grace counts. Five sites take the check:

1. the gate swap in `_gateDecision` (AxonaPeer.js:3122 onward);
2. the refusal close in `_seedSynaptomeWithSponsor` (AxonaPeer.js:2770;
   lane refusals included);
3. the near-improve step of `_fillTick` (AxonaPeer.js:2007, the at-cap
   branch);
4. `_enforceDegree` (mesh.js:823), bridge;
5. `retireForNewcomer` (mesh.js:1245), bridge.

Two things are NOT elective and keep their rules: replacing one route to an
identity with another route to the same identity (U does not change), and
every health, authentication, duplicate and departure teardown. On a relay
today K changes nothing, because all three kernel sites already wait for 48 or
50. It exists so that a bridge, a smaller profile or a future cap cannot take
a node below its floor by choice.

**S. Seek: one bounded seeker below the floor.** The seeker ENGAGES when
U < T_eff and RELEASES when U ≥ T_eff has held for two consecutive ticks. It
engages on the floor alone. What the node happens to know does not decide
whether it looks; it decides only how many dials it can make. A cold node that
knows itself and one bridge is below its floor, so it seeks, and its first
act is to ask the directory.

- **S1 tick.** 5 000 ms while engaged, instead of 15 000.
- **S2 dial budget per tick.** min(8, 3 + ⌈(T_eff − U) / 5⌉), further bounded
  at the moment each dial is issued by: free M slots, the ledger's in-flight
  bound (`pPending` 8), and the number of eligible candidates not already held
  or in flight. A candidate is eligible when it is a verified identity, not
  self, not held, not dead-marked and not inside its per-identity backoff
  (4 attempts, 30 s × 2, unchanged).
- **S3 one budget.** The fill, the re-warm, self-integrate, peer-list dials
  and the browser seeker draw from this one per-tick budget. No path dials
  around it. Candidates are deduplicated by identity across all of them.
- **S4 backoff.** The tick that finds nobody to dial backs off, 30 s × 2 as
  today, with a ceiling of 60 s while engaged. The backoff resets only on
  FRESH supply: a verified identity the node has not seen before, or a known
  identity whose backoff has expired. A repeated peer list, a stale presence
  record or an unverified hint resets nothing.
- **S5 directory.** On engaging, ask the bridge directory at once; then every
  60 s drawn in [30 s, 90 s] while engaged; back to 10 min on release.
- **S6 self-integrate.** Dialing through existing peers (`connectViaRelay`)
  is allowed while engaged, inside the S3 budget.
- **S7 browsers and apps.** A light seeker in `connect()`: it runs on
  connect and on foreground thaw (`visibilitychange` to visible), asks the
  bridge for its peer list and dials inside the same S2/S3 bounds. No timer
  runs while the page is hidden. (Orion 95b7c3c9, from the PWA runtime
  findings: background timers freeze and sockets die.)
- **S8 generation fence.** Every seeker run carries a generation number.
  Stop, sleep, `leave()` and a peer restart bump it, and a decision taken
  under an old generation is dropped when it lands. Every cap check happens
  when the dial is issued, never only when the timer fired.

**The deficit, reported in three classes.** Each tick that the seeker is
engaged, the node reports T_eff − U split into:

- **dialable**: free M slots with eligible candidates to fill them;
- **supply-exhausted**: free M slots and no eligible candidate;
- **class-blocked**: the rest, which only inbound (I) can fill, or which the
  node's resources forbid.

Only the dialable part drives dialing. A class-blocked deficit is reported,
never answered by dialing harder, by borrowing across pools or by raising a
cap. A node with U at T_eff that is all class-blocked reports itself as such,
not as "at floor".

## Part 5. How we would know

**Offline, before any build is merged.** New fences, each asserting its
precondition and turned red by deleting its fix:

- **K boundary**: U = 39, 40 and 41 at every K site; at 40 a close that
  would leave 39 is refused; at 41 one close is allowed and the next refused.
- **K grace**: a refused-grace close whose peer count drops during the grace
  re-reads U and does not close.
- **K identity**: a duplicate-route replacement for the same identity still
  happens at U = 40; a health or departure teardown still happens below T.
- **S cold start**: a node that knows only itself and one bridge engages and
  asks the directory on its first tick.
- **S leaf**: M 6, I 6, H 12 with U 6 reports a class-blocked deficit of 6
  and makes no extra dials.
- **S supply**: a repeated peer list does not reset the backoff; a new
  verified identity does.
- **S budget**: fill, re-warm, self-integrate and peer-list dials together
  never exceed one tick's budget.
- **S fence**: a stop or sleep between decision and dial drops the dial.
- **S release**: hysteresis holds the seeker at U = T_eff for one tick and
  releases on the second.
- **Remote full**: a far end at its cap refuses; the near end defers and does
  not retry faster.
- **Simultaneous dials** end with one channel.
- **Flag off**: every existing fence passes unchanged.

About 25 existing fences pin today's numbers. They stay as the flag-off
fences. New profile-specific fences cover the flag-on numbers, so nothing is
"fixed" by editing an expected value.

**In the field, after a release and only on David's word.** The same census
as 17:19Z, at T0, +10 and +30 minutes after a roll: per relay, U, with median
and minimum, and the three deficit classes. Beside it, the negotiation-timeout
rate per relay per hour, reported separately, so that more dialing is not
read as more connecting.

## Part 6. Questions, with the reviews so far

1. **What is 40 a floor on?** Unique usable peers across both pools, M ∪ I
   (this packet), or the incoming pool alone (David's word "inbound")?
   Orion: total. Aster: total, since I is 0 on every relay today and an
   I-only floor would do nothing, subject to David confirming that reading.
   **David to confirm.**
2. **Fixed 40, or a share of the population?** v0.1 capped the target at
   known − 1; Aster's F1 shows that cap stops a cold node from seeking, so
   v0.2 removes it from the trigger and keeps supply only as a bound on
   dials. Orion: fixed 40. Aster: no percentage-of-known threshold. Settled
   at fixed 40 unless David says otherwise.
3. **Browsers and apps.** Orion: light seeker on connect and on foreground
   thaw, no continuous fill. Carried as S7.
4. **The seek numbers** (5 s, up to 8, 60 s, 60 s directory). Orion: accept.
   Aster: opening settings, not measured optima; any field study is
   separately authorised. Carried as opening settings.
5. **Liveness while short.** Orion and Aster: keep 20 s silence and 30 s
   unbound unchanged in this change. Carried.
6. **The failed negotiations.** Orion: build alongside, with the timeout rate
   reported separately, and triage the M1 `datachannel-opening` stalls in
   parallel. Aster: classify them separately before any stronger performance
   claim. Carried in Part 5. Whether the triage runs before or beside a build
   is **David's call**.

Vega ca4f7569 (18:22:54Z, written before v0.2 was posted): concurs that
healthy relays are not shed below cap at 4.119.0; CONDITIONAL ACCEPT of the
invariant, with F1 to F4 folded into v0.2 before any implementation scope.
v0.2 is that fold.

## Part 7. What would make this wrong

A mesh where the far ends do not answer. If most of the shortfall is dials
that die in negotiation, the seek half raises the dial rate and the timeout
count and leaves the median where it is. That is the reading Part 5 must
check first. And a population that grows past the caps: at 200 nodes, T 40 is
a floor under M 50 and changes nothing, which is the intent, but the 5 s tick
would then run on any node that falls short, and its cost on a large mesh is
unmeasured.
