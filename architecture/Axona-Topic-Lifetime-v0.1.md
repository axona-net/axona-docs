# Axona Topic Lifetime — design packet v0.2

**Status:** DESIGN, for council review. Nothing built. David's word is a
direction, not a build: council 6d25996a (seq 305, 23:20Z 2026-10-19), quoted
in Part 1. The review bar is Aster 96b00853 (map the grant, renew, discharge
and re-home paths; freeze the drain contract before any implementation), Vega
add1da9e (split the seat lease from the framework teardown; say what the test
harness does to the numbers) and Orion 5bfabd78. Every line number below is
read from axona-protocol at `0c9ec13` (tag v4.116.0), the kernel the fleet
runs since 20:06Z 2026-10-19.

**v0.2 (01:2xZ 2026-10-20)** takes David's three answers and the council's
four responses to d200175e. The bound stays at today's constants (David:
"We can maintain the current bound. That was an example"); Part 4's table is
reverted. The dismantle becomes an explicit frame, TOPIC_TERMINATED, bound to
the root's epoch so a delayed notice cannot end a topic that was re-formed,
with the seat lease as the fallback for a notice that never arrives (Aster
5408c64e). A new Part 5a carries David's thin-branch rule: a child below a
floor of readers for a grace period steps down, with a minimum stay and a
cooldown so the tree does not oscillate (Aster's two thresholds, Orion's
numbers as the opening proposal). Part 6 is resolved: tombstones stay, as a
closure record on the root alone, and the live framework does not stay for
them (David: "tombstones are light weight"; Aster: retain a small
expiry-bounded record, not the framework).

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

**The numbers.** David's 30 s and four minutes were an example; the bound
stays where it is. One constant moves so that the grace never stacks on an
expired lease:

| constant | today | v0.2 | reason |
|---|---|---|---|
| `RENEW_MS` (ceiling) | 60 s | 60 s | kept (David, 2026-10-19) |
| `DROP_MS` | 180 s (3×) | 180 s | kept; inside the ≤4× bound |
| `ROLE_EMPTY_GRACE_MS` | 300 s | 180 s | one window, never stacked |
| `BACKUP_EVICT_MS` | 60 s | 60 s | unchanged; the rehome discharge stays |

**The drain budget**, counted from the last renewal of the last demand seat,
with the scheduler running (a wall-clock promise is not made; this is a count
of ticks under the published allowance, Aster's condition): the seat expires
at 180 s; the root reads demand zero on that tick and, cache being empty,
sends TOPIC_TERMINATED on the same tick; backups and children retire on
receipt, within one tick; the root retires on its next tick. Under 190 s at
a 5 s tick. A holder that never receives the notice is bounded two ways, and
Aster's 7ddb72ea is why there are two: a READER's seat lapses at the root
when the reader stops renewing, but a BACKUP does not stop renewing on its
own, so its bound is the standby lease of Part 4a, which the root renews by
replicating and the backup cannot renew by its own SUB. An empty backup that
misses the notice retires one lease window after the root's last REPLICATE,
without an election; a backup holding bodies elects, and the new root runs
the rule again. Under loss or partition the drain is therefore one window
plus one lease window, not "seconds", and the packet claims nothing faster.
Today's arithmetic, which Aster did, is 180 s plus 300 s plus a sweep: about
eight minutes, and only for the roots the grace sees at all.

## 4a. The standby appointment is a lease, not a self-renewal

Today a backup renews its own seat for ever (loop 1b-bak) and the root's
replication refreshes `lastReplicaAt` beside it; neither has an end. Aster's
7ddb72ea names the hole in any send-once termination: the lease expires a
seat that stops renewing, and a backup is a sender that never stops. A
missed notice would leave a backup renewing toward a topic that no longer
exists, and its SUB at the terminus would re-form the topic as an empty root
with the other backup as its seat — the loop the packet exists to end.

**The rule.** A backup holds a STANDBY LEASE granted by the root's
REPLICATE and renewed only by the root's REPLICATE; `lastReplicaAt` is the
lease stamp and nothing the backup sends moves it. The lease lasts
`STANDBY_LEASE_MS` = `DROP_MS` = 180 s from the last REPLICATE. While it
holds, the backup renews its seat as today and is exempt from the reapers as
today. When it lapses:

- a backup with NO bodies and no tombstones retires through `retireBackup`
  and the reapers take the role on that tick. It sends no further SUB. There
  is nothing to elect for, so no election. An empty root replicates nothing
  (repairPlane.js:931), so an empty root's backups lapse on their own one
  window after their appointment even if every notice is lost; the notice
  makes the same thing happen in one tick instead of one window.
- a backup WITH bodies or tombstones keeps the election obligation of 4.94.0
  unchanged: it stays subscribed, self-roots at the SUB terminal if the root
  is gone, and the others re-home under it. History is preserved by the one
  node that has something to preserve, and the new root applies the rule.

A standby SUB and a REPLICATE both carry the epoch of the root that issued
the appointment. A root that receives a standby SUB bearing an older epoch
than its own refuses it: it is housekeeping from a closed generation, not
demand, and it seats nobody. A backup that receives a REPLICATE bearing an
older epoch than the lease it holds ignores it. A late TOPIC_TERMINATED
bearing an older epoch than the holder's current root is ignored (Part 5).
This is Aster's closed-generation rule: successful renewal by a reader may
establish new demand; stale standby traffic may not revive old state or
destroy a new generation.

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
4. **The notice** is one frame, TOPIC_TERMINATED, carrying the topic, the
   root's epoch and the root's id, sent by the root to every backup and every
   child; a child forwards it to its own subscribers and apps receive it as a
   delivery row `{ terminated: true, epoch }`, after which the app's
   subscription is ended and it may subscribe again, which forms a new topic
   generation at the terminus with epoch + 1. The frame is bound to the epoch:
   a holder that has already seated under a newer root ignores an older
   notice, so a delayed termination cannot end a topic that was re-formed
   (Aster's generation rule). Only the root sends it; a notice from any other
   sender is dropped. It is sent once per tick for up to three ticks or until
   every backup has acknowledged by leaving, whichever is first; a holder that
   never receives it is covered by its own lease, Part 4. The root then sets
   `role.dismantling = true`, which `_custodyAlive` does not read and the
   reapers do: on the next tick `deadNow` takes a root with no seats left, and
   `_retireRole(t, role, 'terminated')` marks the object so a parked write is
   refused (4.116.0's retired-role cut).
5. **The backup's receipt**: a backup holding no bodies and no tombstones
   runs `retireBackup(t, role, 'terminated')`, sends no further SUB, and the
   ordinary reapers take the role on that tick. A backup that holds a body
   the root does not (a split-union ingest can put one there) does NOT obey
   the notice: it has something to preserve, so it keeps its election
   obligation, self-roots when the root retires, and the new root applies
   the rule. Aster's 7ddb72ea is right that `holdsHistory` protects root
   bodies only (repairPlane.js:276), so a body may never be left on a role
   that has just stopped being a backup; it is carried by the election or
   it is not carried at all.
6. **A seat that returns** after the dismantle re-forms the topic from nothing
   at the routing terminus, as a new root with epoch + 1, exactly as a
   first subscriber does today. Nothing is lost that was held: there was
   nothing.
7. **The grace** keeps its one job, a root born empty with no seat and no
   body, and shortens to one window. The dismantle path never waits for it.

## 5a. Thin branches step down (David d200175e)

Today a relay becomes a child only because its parent was crowded: at
`MAX_DIRECT` = 20 direct seats the parent promotes one subscriber and hands
it up to `DELEGATE_BATCH` = 8 of the others (wireHandlers.js:386–395, :422,
constants.js:139, :308). Nothing demotes it. A child whose readers all leave
keeps renewing to its parent as an empty child, and the parent keeps it.
Under churn this leaves a wide tree of thin branches, each one a seat the
parent must manage and a hop a delivery must cross.

**The rule.** A child counts its READERS: its seats that are not standby and
not children carrying zero demand. A child whose readers have numbered fewer
than `CHILD_MIN_READERS` for longer than `CHILD_STEP_DOWN_MS` steps down:
it stops renewing to its parent, sends one notice to its remaining readers
(the same TOPIC_TERMINATED frame with `rehome: true`, meaning "re-subscribe,
the topic lives, this branch does not"), stops answering the via extension
so no walk is routed through it, hands off anything it still owes (a body
its readers have not received goes with the rehome notice's replay, as a
handoff does today), and drops its list. Its readers walk to the topic again
and are seated at the root or at a child the root still keeps. A reader that
walks during the step-down may miss deliveries for one renewal, as it would
under ordinary churn; nothing is lost that the root holds.

**Hysteresis, so the tree does not oscillate** (Aster's two thresholds and
cooldown):

| constant | opening proposal | meaning |
|---|---|---|
| `MAX_DIRECT` | 20 (today) | the parent promotes a child at this many seats |
| `CHILD_MIN_READERS` | 3 | below this a child is thin |
| `CHILD_STEP_DOWN_MS` | 180 s | thin for one lease window before stepping down |
| `CHILD_MIN_STAY_MS` | 180 s | a new child is not thin until it has had one window to fill |
| `CHILD_COOLDOWN_MS` | 300 s | a parent does not re-promote a node that stepped down within this |

Promotion happens only at the parent's limit; a node that stepped down is
re-promoted only if the parent fills again and the cooldown has passed, so
a node that is promoted, found thin and demoted cycles at most once per
cooldown, and only while the parent is at its limit. Orion's 2 to 3 readers
and 60 to 90 s are the lower edge of this table; the window is set to the
lease so that one departing reader is not mistaken for an empty branch.
The numbers are to be chosen together once the rule is agreed, as Aster
asked; the table is a starting point, not a measurement, and Aster's
7ddb72ea records that the packet's 4 / 180 s and Orion's 2 to 3 / 60 to 90 s
are competing candidates, not a policy.

**Not applied to backups.** A backup's job is the root's history, not
fan-out, and it ends by TOPIC_TERMINATED, not by a reader count.

## 6. Tombstones: a closure record, not a framework

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

**v0.2 resolution: neither A nor B.** The tombstones stay and the framework
does not. A root whose cache is empty, whose tombstones are active and whose
demand is zero sends TOPIC_TERMINATED as in Part 5; its backups and children
go. The root itself does not retire: it keeps the tombstones as a CLOSURE
RECORD, replicates nothing, seats nobody, sends no keepalive, and retires
through `_retireRole` when the last tombstone expires. A subscriber or
publisher arriving in the meantime walks to the same terminus, finds the
record, and the topic re-forms around it as a new generation (epoch + 1) with
the old deletions still in force: the one deleted id stays refused, every
other id lands normally, exactly as David asked in chat. A departed holder
returning with the deleted body is refused at ingest by the record, which is
the protection B would have given up. What A would have cost, two backups
and two keepalive frames every tick for every deleted test topic for a day,
is not paid; what remains is one thin role per deleted topic on one node for
the tombstones' lifetime. Aster's 5408c64e asked for a small expiry-bounded
deletion record and not the live framework; this is that record. The
tombstone semantics themselves (allow, forbid, revoke on a forged kill) do
not change.

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
- `fence_standby_lease`: a backup's own SUB does not move `lastReplicaAt`;
  an empty backup whose lease lapses retires with no election and sends no
  SUB on the following twenty ticks; a backup holding one body whose lease
  lapses elects and the body survives on the new root; a standby SUB bearing
  an older epoch seats nobody at a newer root; a REPLICATE and a
  TOPIC_TERMINATED bearing an older epoch are ignored; a notice lost to
  every backup still ends the topic within one lease window.
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

## 9. Where David's word is still needed

1. The bound: answered, kept at today's constants (v0.2 Part 4).
2. Tombstones: resolved in v0.2 Part 6 as a closure record on the root alone;
   David to confirm that reading of "light weight".
3. Part 5a's numbers (`CHILD_MIN_READERS`, the step-down window, the minimum
   stay, the cooldown): David to confirm the opening values or name others.
4. The harness: deferred by David to after this packet.
5. The build word.

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
