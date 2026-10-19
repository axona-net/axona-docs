# Axona Topic Lifetime — design packet v0.1

**Status:** DESIGN, for council review. Nothing built. David's word is a
direction, not a build: council 6d25996a (seq 305, 23:20Z 2026-10-19), quoted
in Part 1. The review bar is Aster 96b00853 (map the grant, renew, discharge
and re-home paths; freeze the drain contract before any implementation), Vega
add1da9e (split the seat lease from the framework teardown; say what the test
harness does to the numbers) and Orion 5bfabd78. Every line number below is
read from axona-protocol at `0c9ec13` (tag v4.116.0), the kernel the fleet
runs since 20:06Z 2026-10-19.

CAVEAT: this packet changes a rule David set on 2026-09-24 after Orion and
Aster, that a backup seat is exempt from both reapers. It does not drop the
exemption. It gives the exemption the termination it never had.

## 1. The question

Why does a fleet whose subscriber seats expire in three minutes still carry
three thousand roles two hours after the last publisher left?

David's reading of the 22:40Z census (6d25996a): "A subscription to a topic
has a time-limit value and must be regularly renewed. This should be a very
short time period, larger than the standard topic renewal rate, but at most 4
times the length of that. … If there is also nothing within the cache the
entire topic framework must be dismantled. This must also be done quickly and
regularly. The impact of not performing aggressive garbage collection like
this has already been seen. … This is dramatically accelerated with churn —
which we have not really introduced yet."

The census (ops/role-census-20261019T2240Z.md): 2,997 roles over 802 topics;
387 roots of which 385 had at least one seat and none were empty; 1,367
backups of which 1,147 had no seat; every root's seats were its own backups.

## 2. What the kernel does today, path by path

This is the map Aster asked for. It is what exists, not what should.

**A seat is granted** when a SUB arrives at a root or child: the subscriber is
written into `role.subscribers` with `lastRenewed = now`
(wireHandlers.js:401, or refreshed at :382 on a renewal); a child relay is also
written into `role.children`.

**A seat is renewed** by the subscriber's own cadence: `RENEW_FAST_MS` 5 s at
first, multiplied by `RENEW_BACKOFF` 1.5 each stable renewal, up to the
`RENEW_MS` ceiling of 60 s (constants.js:23–31).

**A seat expires** on the holder's refreshTick when `now - lastRenewed >
DROP_MS`, 180 s (constants.js:32, repairPlane.js:265). That is three times the
ceiling. An app, a council seat, a child relay: all go this way within three
minutes of their last renewal. The census shows almost none of them because
this already works.

**A backup is granted** when a root pushes its state to a neighbour: the root's
tick calls `_replicateRoots` (repairPlane.js:619) which pushes to
`ROOT_REPLICAS` = 2 nearest reachable peers (constants.js:77, `_replicateRole`
at :898); the receiver's `_onReplicate` (wireHandlers.js:1038) ends in
`becomeBackup` (syncEngine.js:291 → rootClaim.js:386), which sets
`role.backupOf`, stamps `lastReplicaAt`, and adds the topic to
`_backupTopics`. A root with no bodies and no tombstones pushes nothing
(repairPlane.js:931, `nothing-to-preserve`).

**A backup renews itself.** Loop 1b-bak (repairPlane.js:209–221) walks
`_backupTopics` every tick and sends a SUB toward the root for each. The root
seats it like any subscriber. The backup never stops; there is no demand in
the loop.

**A backup is discharged** in one case only: `rehomed-idle`
(repairPlane.js:219–220). The backup's upstream must name a reachable node
other than itself (`_isReachableId`), the backup must hold no seats, its
principal must not have replicated for `BACKUP_EVICT_MS` 60 s, and no custody
may be alive. `retireBackup` (rootClaim.js:402) then clears `backupOf` and
leaves `_backupTopics`, and the role falls under the ordinary reapers. While
the root lives, its keepalive replication refreshes `lastReplicaAt` every tick
and the discharge never fires. When the root dies, no backup is re-homed, so
the discharge never fires either; the backups elect one of themselves through
the SUB terminal.

**Both reapers exempt a backup seat**: `backupSeat = role.backupOf !== null ||
_backupTopics.has(t)` (repairPlane.js:301) guards `idleReap` (:303) and
`deadNow` (:405). The root is not exempt, but a root with seats is never
`deadNow`, and its seats are its backups.

**Re-home** is `_upstream` (rootClaim.js:489 and :622, wireHandlers.js:1067)
pointing at a node the dial table can reach.

**What a SUB carries** (AxonaManager.js `_emitSubscribe`): `since`, `hw`,
`lw`, and the merge block while a merge completes. Nothing says whether the
sender is a backup standing by or a reader.

**What a REPLICATE carries** (syncEngine.js COHORT_REPLICATE): the root's
state signature `count:hw:tombstones`, and on a signature change the full
state. Nothing says whether anyone reads the topic.

The loop, in one sentence: the root pushes to two backups because it has
bodies; the backups seat at the root every tick because they exist; the root
is not dead because it has seats; the backups are not dead because they are
backups. Orion's 5bfabd78 draws the same loop.

## 3. What this packet is not

It is NOT a shorter subscriber timeout. The seat lease already expires at three
times the renewal ceiling, inside David's bound of four. Shortening it moves
nothing in the census, because the seats that remain are not leases a reader
can let lapse. Aster's 96b00853 says the same: "merely reducing subscriber
timeout cannot stop a component that keeps renewing itself."

It is NOT the empty-role grace again. The grace (4.116.0) takes a root that
holds nothing. A root with backups holds seats, so the grace does not see it,
by design. The census confirms the grace's own class is at zero.

It is NOT a change to what a body or a tombstone is owed. A body lives
`TTL_MS` 24 h (constants.js:311) and is served to a late subscriber for that
long; a tombstone lives the same 24 h (wireHandlers.js:1233) and keeps a
deleted body from returning. Part 6 asks one question about the second; it
changes nothing about the first.

It is NOT a drop of the 4.94.0 exemption. The exemption stays while the topic
has demand or bodies. What changes is that it ends.

## 4. The contract

Definitions, each a thing the node can read in its own state:

- **Demand** at a holder: a seat whose SUB did not declare `standby`. An app,
  a council seat, a child relay. A child relay's SUB carries its own demand
  count, so a child with readers below it is demand and a child with only
  standby below it is not. This is Aster's split of end-reader demand from
  downstream aggregate demand.
- **Standby**: a seat whose SUB declared `standby` because the sender holds
  the topic as a backup. Standby is never demand.
- **Bodies**: `role.cache.length > 0`.
- **Custody**: `_custodyAlive` as shipped (an open merge or pull, pins, an
  active tombstone). Part 6 is about the last clause.
- **Local intent**: `peer.sub()`, `peer.host(topic)`, a metrics lease. As
  today, never dismantled by this rule.

**The rule.** A ROOT whose cache is empty, whose custody is not alive, whose
local intent is absent, and whose demand has been zero for one DROP window
DISMANTLES its topic: it announces `demand: 0, dismantle: true` to its backups
and children in the REPLICATE keepalive it already sends every tick, stops
replicating, and retires itself on the next tick through `_retireRole`
(repairPlane.js:69), the one detach site. A BACKUP that hears the announcement
from its live principal retires through `retireBackup('dismantled')` on that
tick and, holding no seats and no bodies, is taken by `deadNow` on the same
tick. A CHILD that hears it unseats its subscribers' routes and is taken the
same way. The framework goes in one window and one tick.

**Root death.** A backup whose principal stops replicating keeps the election
obligation exactly as today: it stays subscribed, one backup self-roots at the
SUB terminal, the others re-home under it. The new root inherits no demand
and no bodies, and applies the rule. A dead root therefore costs one election
and one DROP window, and nothing after. The 4.94.0 split-brain case, a
vanished root whose backups were pruned so no root remained, cannot occur,
because nothing here prunes a backup on its own evidence.

**The numbers, and David's two readings.** David wrote "at most 4 times" the
renewal rate and, in the example, "every 30 seconds … within four minutes",
which is eight times. Aster read the ratio as operative. This packet proposes
the ratio and asks David to confirm in Part 9:

| constant | today | proposed | reason |
|---|---|---|---|
| `RENEW_MS` (ceiling) | 60 s | 30 s | David's renewal rate |
| `DROP_MS` | 180 s (3×) | 120 s (4×) | David's bound |
| `ROLE_EMPTY_GRACE_MS` | 300 s | 120 s | one window, never stacked |
| `BACKUP_EVICT_MS` | 60 s | 60 s | unchanged; the rehome discharge stays |

**The drain budget**, counted from the last renewal of the last demand seat,
with the scheduler running (a wall-clock promise is not made; this is a count
of ticks under the published allowance, Aster's condition): the seat expires
at 120 s; the root reads demand zero on that tick and, cache being empty,
announces on the same tick; backups and children retire on receipt, within one
tick; the root retires on its next tick. Under 130 s at a 5 s tick. With the
empty-role grace folded to the same window and never started after an expired
demand lease, the worst case is one window plus two ticks, not two windows.
Today's arithmetic, which Aster did, is 180 s plus 300 s plus a sweep: about
eight minutes, and only for the roots the grace sees at all.

**A topic that holds bodies** is not dismantled while they live. A test that
publishes 260 bodies and deletes none keeps its 92 topics, each with two
backups, for 24 hours. That is the harness Vega named, and it is a harness
choice: a run that deletes what it published (Howard's suite with its kill
cache in place) leaves tombstones, which is Part 6. A test profile with a
short body TTL is a separate change and is not proposed here.

## 5. The mechanism

1. **SUB carries `standby: true`** when the sender holds the topic as a
   backup (loop 1b-bak's `_sendSubscribe`), and **`demand: n`** when the
   sender is a child, n being its own count of non-standby seats. A root
   counts demand as the seats whose latest SUB was not standby, plus the sum
   of children's declared demand. A SUB that says nothing is demand: an old
   client is a reader until it says otherwise, so a version skew fails safe
   toward retention.
2. **REPLICATE carries `demand`** every tick. A backup records it beside
   `lastReplicaAt`. The field is informational until it reads zero with
   `dismantle: true`.
3. **The root's dismantle test** runs in refreshTick after seat eviction and
   cache expiry, before the reapers: `isRoot && cache.length === 0 &&
   !custodyAlive && !localIntent && demand === 0 && now - lastDemandAt >
   DROP_MS`. `lastDemandAt` is stamped by every demand SUB and by every stamped
   write, never by a standby SUB, a beacon, a keepalive or a duplicate kill —
   the laundering rule from 4.116.0 applies to it.
4. **The announcement** is one REPLICATE with `dismantle: true` to every
   backup and a DELIVER-side notice to every child. It is sent once; the root
   then sets `role.dismantling = true`, which `_custodyAlive` does not read
   and the reapers do: on the next tick `deadNow` takes a root with no seats
   left, and `_retireRole(t, role, 'dismantled')` marks the object so a
   parked write is refused (4.116.0's retired-role cut).
5. **The backup's receipt**: `retireBackup(t, role, 'dismantled')`, then the
   ordinary reapers. A backup that holds a body the root does not (it should
   not; replication is from the root) keeps it as an ordinary child would and
   is reaped when it expires; it does not keep the framework alive, because
   it no longer seats at the root.
6. **A seat that returns** after the dismantle re-forms the topic from nothing
   at the routing terminus, as a new root with epoch + 1, exactly as a
   first subscriber does today. Nothing is lost that was held: there was
   nothing.
7. **The grace** keeps its one job, a root born empty with no seat and no
   body, and shortens to one window. The dismantle path never waits for it.

## 6. The one open design choice: tombstones

A deleted body leaves a tombstone for 24 hours so that a late replica or a
late subscriber holding the body does not bring it back. Since 4.115.0 an
active tombstone is custody and holds the role. Under this packet a topic
whose test deleted everything it published is therefore NOT dismantled at
the window: its root holds tombstones, replicates them to its backups, and
the three roles stand for 24 hours with nothing but deletion records. Aster's
96b00853 names this: "zero BODY cache is not zero deletion custody."

Two readings, stated apart:

- **A.** Keep it. A tombstone is a promise to every holder that a body is
  gone; the framework is the holder. A deleted test topic costs three thin
  roles for a day. The census would show them as roots with tombstones and
  standby seats, distinguishable from today's rows by `tombstones > 0`.
- **B.** Let tombstones die with the framework when no holder has a body and
  demand is zero. The promise a tombstone makes is to a holder that still
  has the body; if the root, both backups and every child retire together,
  no such holder is in the framework. The one that can exist is outside it:
  a child that left carrying bodies and returns after the dismantle,
  re-forming the topic from its stale cache. That is the resurrection
  tombstones exist for, bounded to a departed holder's cache and to the
  24 hours that cache lives.

This packet recommends **B with a short tombstone-only hold**: a root whose
cache is empty, whose tombstones are active, and whose demand is zero holds
one extra window before announcing, so a kill that is still fanning out
lands; then it dismantles, and the tombstones go with it. The resurrection
case is stated as the cost. David decides; A is the shipped behaviour and
costs nothing to keep.

## 7. The regression this must not repeat, and the fences

On 4.92.0 an empty backup was reaped on its own evidence and re-seated on the
next keepalive, 2.8 times a second on the west bridge for 2.4 hours. The
discharge here is the root's announcement, carried in the frame the root
already sends; a backup never reads its own emptiness as a reason to go. The
fence set:

- `fence_topic_dismantle`: a root with no demand and no bodies for one window
  announces once and the root, two backups and a child are all retired within
  two ticks; a root with one demand seat renewing is held; a root with one
  body is held; a root with an active tombstone is held (A) or held one window
  then dismantled (B); a standby SUB does not stamp `lastDemandAt`; a child
  declaring demand holds the root and a child declaring zero does not.
- `fence_topic_dismantle_root_death`: the principal stops; the backups elect
  one; the new root dismantles after one window; exactly one election.
- `fence_topic_dismantle_no_reseat`: a retired backup sends no SUB on the
  next tick and is not re-granted by a keepalive from a root that is itself
  retiring; the 4.92.0 shape is asserted absent over twenty ticks.
- `fence_topic_dismantle_reform`: a reader returning after the dismantle
  forms a new root at the terminus with epoch + 1 and receives nothing stale.
- `fence_seat_lease_bounds`: `DROP_MS <= 4 * RENEW_MS` is a constant check
  that fails the build if anyone moves one without the other.
- Mutants: remove the standby flag (backups count as demand, nothing
  dismantles); remove `lastDemandAt`'s stamp guard (a keepalive renews
  demand); remove the announcement (backups never retire; the root is held
  by its own backups); let a backup reap on its own emptiness (the 4.92.0
  loop returns).

## 8. What it does not do, and churn

It does not touch local intent, leases, bodies or the merge machine. It does
not shorten the body TTL. It does not reap a backup whose root is silent,
which stays the election path. It adds one field to SUB and two to
REPLICATE, both ignored by an older kernel, and an older kernel's silence on
`standby` reads as demand, so a mixed fleet retains more, never less.

Under churn the standby set is bounded to topics with demand or bodies: a
relay roll today re-forms every root it rolled with two fresh backups, and
those stand until the bodies expire; under this packet a topic nobody reads
and nobody wrote to is gone one window after the roll settles. David's
"dramatically accelerated with churn" is exactly the roll case.

## 9. Questions for David

1. The bound: `DROP_MS` at four times a 30 s renewal is 120 s. The example's
   four minutes is eight times. Which?
2. Tombstones: A or B (Part 6)?
3. The harness: should Howard's suite run with its kill cache in place on the
   production checks, so that the test's own deletions exercise the drain,
   with the understanding that each run then leaves tombstones under either
   A or B?

## Source map (axona-protocol `0c9ec13`)

| what | where |
|---|---|
| seat grant / renew | wireHandlers.js:382, :401; rootClaim.js:355 |
| seat expiry | repairPlane.js:265; constants.js:32 |
| renewal cadence | constants.js:23–31 |
| root replication | repairPlane.js:619 (`_replicateRoots`), :898 (`_replicateRole`), :931 (`nothing-to-preserve`); constants.js:77 (`ROOT_REPLICAS`) |
| backup grant | wireHandlers.js:1038 → syncEngine.js:291 → rootClaim.js:386 |
| backup renewal | repairPlane.js:209–221 (loop 1b-bak) |
| backup discharge | repairPlane.js:219–220; rootClaim.js:402; constants.js:88 |
| reaper exemptions | repairPlane.js:301 (`backupSeat`), :303 (`idleReap`), :329 (`holdsNothing`), :335 (`keyspacePinned`), :405 (`deadNow`) |
| the one detach site | repairPlane.js:69 (`_retireRole`) |
| custody | mergeMachine.js `_custodyAlive` |
| SUB fields | AxonaManager.js `_emitSubscribe` |
| REPLICATE push | syncEngine.js COHORT_REPLICATE, `_syncPush` |
| tombstone TTL | wireHandlers.js:1233; constants.js:311 |
| re-home | rootClaim.js:489, :622; wireHandlers.js:1067 |
