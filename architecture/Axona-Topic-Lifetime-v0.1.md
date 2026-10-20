# Axona Topic Lifetime — design packet v0.6

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

**v0.3 (01:5xZ 2026-10-20)** answers Aster's REQUEST CHANGES 23c5cfd1 on
v0.2, four points, each verified against source and each holding, and
replaces Parts 4 through 8 with one rule set (Part 4, ten sections). (1) The
epoch does not identify a generation: `_knownEpoch` (rootElection.js:35) is
soft state and a cold node mints 1 again, so a generation is (topic, root id,
epoch), and every holder that leaves one keeps a closed record consulted
before any role is created; the entry points that create a role on first
sight are named. (2) A lapsed standby lease ends the appointment and nothing
else; a node that is also a reader, child or custodian continues as that; a
child is counted once, by its declared demand. (3) The closure record is not
a single copy: the root and its backups all keep the tombstones as idle
holders, the failure assumption is stated, and the one case weaker than
today, a moved terminus with no record, is named for David instead of
traded away. (4) The bounds are a table with a condition on every row;
root death is one election within a side, not across a partition; REHOME is
kernel-internal and keeps the app's subscription, and only TOPIC_TERMINATED
ends one.

**v0.4 (01:5xZ 2026-10-20)** answers Aster's 2791acd7 on v0.3, three
concrete cases, each holding. (1) A grant now has a LIFETIME: a REPLICATE
carries its issue stamp and is an appointment only while younger than the
standby lease, so the replay window and the rejection window are the same
window and a grant delivered at 181 s creates nothing; the delay assumption
is stated instead of inferred, and a frame with no generation is never
relabelled current. (2) A branch leaving is not the topic ending: a holder
that leaves its own appointment writes a LEFT record, under which a reader is
sent to the live tree, and only a root's termination writes the CLOSED record
under which a reader forms the next generation. (3) "Survives any two"
requires the copies to hold the deletions: a root terminates only after its
tombstone set is credited on two backups by the verified replication path
(repairPlane.js:1082) and otherwise keeps today's custody hold; a moved
terminus finds the holders through the birth probe, which pulls from the five
nearest and is answered with deletions by an empty holder (repairPlane.js:725,
syncEngine.js:153–163); the residual case is sized and left to David.

**v0.5 (02:0xZ 2026-10-20)** answers Aster's 5237dce7 on v0.4, three points
on evidence and one contradiction, each checked against source and each
holding. (1) Replication credit is not a receipt: `role.replicas` is written
on the dispatch verdict (repairPlane.js:1082) and a backup answers consumed
the moment the ingest is queued (wireHandlers.js:1049–1050), so 4.5 now
requires a REPLICA_RECEIPT, a new frame the backup sends only after its
queued ingest commits, bound to the generation and to a hash of the deletion
set, and old or keepalive credit counts for nothing. (2) The birth probe is
not a barrier: it is scheduled 800 ms after formation and skipped once the
cache has filled (repairPlane.js:694, :701), so 4.6 now has an explicit
RECOVERING state in which a new root pulls deletions from its five nearest
before it serves or acknowledges a body, and the larger weakened case when no
holder answers is disclosed for David as Aster asked. (3) Equal windows need
a clock margin: the merge's allowance is 300 s (`MERGE_E_MAX_MS`), useless
for a 180 s window, so 4.4 separates an assumed appointment skew S and a
delivery bound D from the rule, makes a grant fresh only under L − S, demands
fresh authority (a live beacon) in the band of width 2S, and keeps the record
for L + S + D; the skewed 181 s case is a fence. 4.10's "silence reads as
current" is gone.

**v0.6 (02:3xZ 2026-10-20)** answers Aster's e32cfd6f on v0.5. (1) A first
reply is not coverage: RECOVERING now ends early only when every queried node
has answered, a node without a record answers "none", a late reply after
release still applies, and the timeout is a named weakened mode with a
fail-closed alternative for David's choice; the three traces Aster named are
fences. (2) A receipt is a retention contract: bound to the authenticated
backup, the generation and the backup's incarnation, a commitment to retain
the named deletions through their expiries regardless of LEFT, closure or map
pressure, revalidated against known invalidations before release, an old
incarnation's receipt counting for nothing, and the crash assumption stated
apart; CLOSED is installed before the first termination send so no write
enters a dismantling generation. (3) The text is reconciled: one record
window (L + S + D) everywhere, one grant rule — a grant is accepted only if
its apparent age is within D + S, the most a conforming grant can read, and
dropped otherwise; the uncertain band and the beacon authority are gone,
since a cached beacon is not a challenge-response proof; the record timer is
monotonic with wall-jump handling; the 15 s skew is an opening value with
its failure direction stated; the closure fence names RECOVERING; 4.10's
inventory names REPLICA_RECEIPT.

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

## 4. The contract — one rule set

Everything below replaces v0.2's Parts 4, 4a, 5, 5a, 6, 7 and 8, which carried
old and new statements side by side (Aster 23c5cfd1). Each rule names what the
node can read in its own state. Numbers are today's constants unless a row
says otherwise.

### 4.1 A generation is (topic, root id, epoch)

A topic's live tree is a GENERATION, identified by the topic, the id of the
root that formed it, and that root's epoch. The epoch alone does not identify
it: `_knownEpoch` (rootElection.js:35) reads the local role, the beacon cache
and the root-tombstone cache, all soft state, so a node that has forgotten
everything mints epoch 1 again, and two roots formed after a full forgetting
carry equal epochs. The root's id is minted per process start, so equal epochs
from different roots are told apart by it. Every frame this packet adds or
reads (the standby grant, its renewal, the termination, the rehome) names
the generation in full. A frame naming a generation the receiver does not hold
and has not closed is handled by the rules of 4.2; a frame naming a generation
the receiver has closed is dropped.

Complete forgetting is accepted and stated with its assumption: no frame of
a generation is delivered later than D (`APPOINTMENT_DELAY_MS`, 4.4) after it
was issued, and no two relays' clocks differ by more than S. Nothing
enforces the physical delay; 4.4's rule rejects any grant whose apparent age
exceeds what those assumptions allow, so a delivery beyond D costs an
appointment, never a resurrection. Under that assumption, when every holder of a generation is gone and
every closed record (4.2) has expired, nothing of the old generation can
still arrive, and the next subscriber forms a new generation at the terminus
as a first subscriber does today. A frame that names no generation (an older
kernel) is never relabelled as the current one: a bare SUB is a reader and
seats as demand; a bare REPLICATE is an appointment only from the receiver's
current principal, and never creates a role from nothing.

### 4.2 A holder remembers what it closed, before it creates anything

A holder that leaves a generation writes one of two records, kept outside
`axonRoles` in a bounded map with `until = mono() + L + S + D` (4.4), on the
monotonic clock so a wall-clock jump neither shortens nor lengthens it.
Pressure on the map evicts the OLDEST record only, never one whose `until`
has not passed; if the map is full of live records the node refuses new
appointments until one expires, which delays a grant and never admits a
stale one. Which one
depends on whether the GENERATION ended or only this holder's part in it
(Aster 2791acd7: a branch leaving is not the root ending the topic):

- **CLOSED** `{ topic, rootId, epoch, until, tombstones }` is written only
  on a root's termination (4.5), by the root and by every backup and child
  that receives the notice. It means "this generation ended". The ex-root
  and ex-backups carry the generation's active tombstones in it until their
  own expiry (4.6).
- **LEFT** `{ topic, rootId, epoch, until, upstream }` is written when a
  holder leaves its own appointment while the generation lives: a lapsed
  standby lease (4.4), a child stepping down (4.7), a reaper taking a role.
  It means "this generation lives elsewhere; I am not part of it".

The records are consulted BEFORE any role is created or any seat is granted
(the `_syncIngest` and `_onSub` entry points, which today create a role on
first sight: syncEngine.js:226–237, wireHandlers.js:401):

- a REPLICATE, a standby SUB or a TOPIC_TERMINATED naming a generation under
  either record is dropped. A delayed grant therefore renews nothing and
  creates nothing, and a duplicate notice ends nothing twice.
- a reader SUB or a publish at a CLOSED record forms a NEW generation: the
  node becomes root with epoch = closed.epoch + 1 and its own id, and the
  record's tombstones become the new root's tombstones, so the old deletions
  stay in force (David's question in chat).
- a reader SUB or a publish at a LEFT record is forwarded toward the record's
  `upstream` as a non-root forwards today, and a stale via at that node is
  answered with REHOME toward the same upstream: the live tree is served, no
  competing root is manufactured. If the upstream is unreachable the walk
  proceeds as a cold walk does today.
- a REPLICATE naming a generation the receiver neither holds nor has on
  record is an appointment only if it is within its lifetime (4.4).

### 4.3 Demand, counted once

A seat is exactly one of three kinds, declared by the SUB that renews it:

| kind | declared by | counts as demand |
|---|---|---|
| reader | an app or a seat (a SUB with no declaration) | 1 |
| child | a child relay, `demand: n` = its own demand count | n, and 0 when n is 0 |
| standby | a backup, `standby: true` with the generation | 0 |

A SUB that declares nothing is a reader: an older kernel reads as demand, so a
mixed fleet retains more, never less. `demand` at a holder is the sum over its
seats by this table and nothing else; a child is never counted as a seat and
again as its declared count. `lastDemandAt` is stamped by a reader SUB, by a
child SUB with n > 0, and by a stamped write; never by a standby SUB, a
REPLICATE, a beacon, a keepalive or a duplicate kill (the 4.116.0 rule).
Local intent (`peer.sub()`, `peer.host(topic)`, a metrics lease) and custody
(`_custodyAlive`: an open merge or pull, pins, an active tombstone) are read
as today and are not demand.

### 4.4 The standby appointment is a lease on one thing

A backup's appointment is granted and renewed only by a REPLICATE from the
generation's root; `lastReplicaAt` is the stamp (its one writer is
`becomeBackup`, rootClaim.js:391, reached only through a REPLICATE receipt,
syncEngine.js:291) and nothing the backup sends moves it. The lease is
`STANDBY_LEASE_MS` = L = `DROP_MS` = 180 s from the last REPLICATE. A
REPLICATE carries the generation and its own issue stamp. Two assumptions
are stated apart from the rule and are the only things the rule rests on:
S, the clock skew between any two relays for appointment frames
(`APPOINTMENT_SKEW_MS`, opening value 15 s, to be measured on the fleet
before it is read as a figure; the merge machine's `MERGE_E_MAX_MS` of 300 s
is a different allowance for a different purpose and is not used here), and
D, the longest a frame is in flight (`APPOINTMENT_DELAY_MS`, 60 s). A
conforming grant, issued and delivered within D under skew S, reads at most
D + S old by the receiver's clock. That is the whole rule: a REPLICATE is an
appointment or a renewal only if its apparent age is at most D + S (75 s at
the opening values), and is dropped otherwise, whatever it names. There is
no uncertain band and no authority check: a cached beacon is not a
challenge-response proof of current root authority (Aster e32cfd6f), so
nothing rests on one. A grant older than the bound is outside the model and
costs its sender an appointment, which the next tick's REPLICATE renews.

The record of 4.2 is kept for L + S + D (255 s), longer than it needs to be:
a grant issued before a closure is accepted only within D + S of its issue,
and issued at the latest at the closure, so within D + S of the closure; the
record outlives that by L. Under the assumptions, no grant of a closed
generation is ever accepted. Aster's skewed case (a grant at a physical
181 s reading 179 s under 2 s of skew) is dropped twice over: by the record,
which lives 74 s more, and by age, 179 s being past 75 s. The fence is
`fence_grant_lifetime` below.

S is an opening value, not a fleet bound (Aster e32cfd6f); the failure
direction is stated: a real skew beyond S makes a conforming grant read older
than D + S and be dropped, which delays appointments and admits nothing. A
measured skew sets S later; a smaller S is safer in the only way that
matters here. A wall-clock jump at the receiver moves the apparent age of
every grant by the jump; the kernel already detects a jump against its
monotonic clock for the merge machine, and on a jump beyond S the receiver
drops grants for one D so nothing is accepted on a moved clock. An empty root
replicates nothing (repairPlane.js:931), so an empty root's backups lapse one
window after their last grant with no notice at all.

When the lease lapses, the APPOINTMENT ends and nothing else does: the node
runs `retireBackup`, stops its standby renewals, and writes the closed record.
The role then stands or falls on what it still is, read in this order:

1. it holds bodies or tombstones of the generation and the root is gone: the
   4.94.0 election obligation, unchanged — it stays subscribed, self-roots at
   the SUB terminal, and the others re-home under it;
2. it is a child with readers, or a reader itself, or holds local intent or
   custody: it continues in that capacity under the ordinary rules;
3. none of the above: the reapers take it on that tick.

### 4.5 Termination

A root terminates its generation when all of these hold on one tick: cache
empty; no custody except the generation's own tombstones; no local intent;
demand zero; `now - lastDemandAt > DROP_MS`; and, when tombstones exist,
a RECEIPT for the current deletion set from at least two backups. The
receipt is a new frame, REPLICA_RECEIPT `{ generation, delsHash, count }`,
sent by a backup only after its queued ingest of a REPLICATE has COMMITTED
the tombstones, never on enqueue; `delsHash` is a hash over the sorted
(msgId, killTs) pairs of the backup's active tombstones for the generation.
The receipt is a RETENTION CONTRACT, not a hash alone: it names the backup
(the mesh identity the frame arrived under, authenticated by the channel),
the generation, and the backup's INCARNATION (its node id, minted per
process start), and it commits the backup to retain the named deletions
through their existing expiries regardless of a later LEFT, a closure, or
pressure on its bounded maps — a closure holder's tombstones are evicted
only by expiry. The root keeps the latest receipt per backup identity and
counts one only if its `delsHash` equals the hash of the root's own current
set AND no invalidation is known at the moment of counting: a receipt from
an incarnation the root no longer has as a backup, from a backup whose lease
has since lapsed, or from a backup that has since sent LEFT, counts for
nothing, and the root re-reads these on the tick it would terminate, not
earlier. The assumption stated apart: a receipt proves commitment, not
survival; the three-copy contract tolerates the loss of two holders after
commitment, as today's replicated tombstones do, and nothing proves a holder
never fails. Replication credit does not count: `role.replicas` is written on the dispatch verdict
(repairPlane.js:1082), a backup returns consumed the moment the ingest is
queued (wireHandlers.js:1049–1050), and the credit survives a later failed
push, so two entries there say nothing about what a backup holds (Aster
5237dce7). A keepalive carries no receipt; a receipt for an older set does
not match and does not count. A root without two matching receipts does not
terminate: it keeps today's custody hold and its live backups until it has
them or the tombstones expire. The three copies of 4.6 therefore exist,
committed and for this exact set, before live custody is dropped, or live
custody is not dropped. It sends TOPIC_TERMINATED, naming
the generation, to every seat, backups, children and readers alike, once per
tick for up to three ticks or until every backup has left, whichever is first;
after the first send it sets `role.dismantling` and accepts no new seat for
the generation. The order on the terminating tick is fixed: the root installs its CLOSED
record and sets `role.dismantling` FIRST, synchronously, then sends. From
that point the role accepts no write and no seat: a stamped write arriving
after the install is answered by the record and forms the next generation
by 4.2 with the deletions carried; one arriving before it restamps
`lastDemandAt` and cancels the termination, which never began. No write can
enter a dismantling generation, because the generation is closed before the
first frame that says so leaves. The reapers take the root on the tick after
its last send; the record stays (4.6).

On receipt, bound to the generation:

- a BACKUP with no bodies or tombstones beyond the generation's own
  tombstones retires its appointment (4.4) and keeps the tombstones as a
  closure holder (4.6); a backup holding a body the root lacks does NOT obey
  and elects by 4.4(1) — `holdsHistory` protects root bodies only
  (repairPlane.js:276), so a body is carried by an election or not at all;
- a CHILD forwards the notice to its own seats, then retires and writes the
  closed record;
- a READER's kernel ends the app's subscription for that generation and
  delivers one row `{ terminated: true, generation }`. The subscription is
  ended, not paused: an app that still wants the topic subscribes again and
  forms the next generation. This is the one place the app sees anything.

Delivery is not assumed. A seat that never receives the notice is bounded by
what it is: a reader's or child's seat lapses at the root at DROP_MS, and a
child still renewing toward a root that is gone walks to the terminus, finds
the closed record, and is answered with the same TOPIC_TERMINATED there; a
backup's appointment lapses by 4.4 one window after the root's last REPLICATE.

### 4.6 Deletion protection survives the tree

Tombstones are not torn down with the tree, and they are not a single copy.
At termination the root and each backup keep the generation's tombstones as
CLOSURE HOLDERS: a role with no seats, no replication, no keepalive and no
beacon, read only by 4.2, expiring with its last tombstone (`TTL_MS`, 24 h
from the kill). A node reaching the topic in that window (a returning stale
holder, a new publisher, a new reader) walks to the terminus, which is one
of these holders with the probability the routing gives to the nearest ids,
and the new generation forms with the deletions carried.

How a moved terminus finds the holders, as an explicit rule and not the
birth probe: the probe runs 800 ms after formation and is skipped once the
cache has filled (repairPlane.js:694, :701), so a publish that lands first
leaves a new root with no deletions and a delayed deleted body is then
accepted (Aster 5237dce7). A node that becomes root for a generation it did
not inherit (no CLOSED record of its own) therefore enters RECOVERING on the
tick it forms: it sends a deletions-only pull to the `EMPTY_ROOT_PROBE_FANOUT`
+ 1 = 5 nodes nearest the topic at once, and a holder with an empty cache
answers with its active deletions (syncEngine.js:153–163, the tombstone-only
transfer). While RECOVERING the root ingests bodies but neither acknowledges,
fans out nor serves them; they are held pinned. A queried node answers one
of two ways: its active deletions, or "none" when it holds no record for the
topic. COVERAGE is every queried node having answered, each answer applied.
Recovery ends early only on coverage; a first reply, or any number short of
all, ends nothing (Aster e32cfd6f: an ordinary neighbour answering "none"
first must not release bodies a closure holder is about to name). Deletions
apply as they arrive; a held body a deletion names is dropped; a deletion
arriving after release still installs its tombstone and kills the body at
the root and down the tree, late, which is the residual stated below. A
reply's dispatch verdict is not its application.

Without coverage by `RECOVERY_MS` (10 s) there are two modes, and the choice
is David's (Part 9): FAIL-OPEN releases the held bodies and serves, with the
generation marked `unrecovered` in the role and in the log, and the pull
repeated each tick until coverage or the tombstone TTL; FAIL-CLOSED keeps
holding and keeps pulling until coverage or `RECOVERY_MAX_MS` (60 s), and
then opens as fail-open does. Aster's recommendation, recorded: retain
protection, which is fail-closed. Neither mode is silent; both log the
nodes that did not answer.

What this keeps and what it gives up, stated for David as Aster asked: the
replicated deletion contract keeps its three copies, written before live
custody is dropped (4.5), at the cost of three idle rows and no traffic; it
survives the loss of any two of the three holders, as today's contract does,
and a moved terminus recovers them by the RECOVERING rule. It is weaker than
today in one case: the new root reaches the end of its recovery mode without
coverage (a holder among its five nearest has not answered within the mode's
window, or no holder is among the five), AND a stale holder returns inside
the 24 hours. Then the new generation serves without the deletions and the
stale body is accepted, until a late deletion arrives and kills it.
Today's tree would have been found by the beacon and the stale holder
refused. The packet does not close this case; it sizes it and names it, and
Aster's recommendation is recorded: preserve deletion protection, which
means keeping today's live framework for deleted topics instead. The choice
is David's, in Part 9, not a default of this packet. The dual-root machine,
when armed, merges a closure holder's tombstones into such a root when the
two meet.

### 4.7 A thin branch steps down, and the app never knows

A child counts its demand by 4.3. A child whose demand has been below
`CHILD_MIN_READERS` for `CHILD_STEP_DOWN_MS` steps down, in this order: it
hands off anything it owes (a body its seats have not received and the root
holds goes with the rehome's replay; a body the root lacks makes it elect by
4.4(1) instead of stepping down); it sends REHOME, naming the generation and
its upstream, to each of its seats; it stops answering the via extension and
answers a stale via with the same REHOME; it stops renewing to its parent;
it writes a LEFT record (4.2) and drops its list. It does not write CLOSED:
the generation lives on at the root, and a reader arriving at this node
later is sent there, never seated as a new root. REHOME is
kernel-internal: a receiving kernel keeps the app's subscription, walks to
the topic again on its fast cadence (`RENEW_FAST_MS`, 5 s) and seats at the
root or at a child the root keeps; the app sees at most one renewal's gap in
delivery, as under ordinary churn. REHOME is not a termination and ends no
subscription; a REHOME naming a generation the receiver no longer holds is
dropped.

Hysteresis: promotion happens only at the parent's limit (`MAX_DIRECT`, 20);
a new child is not thin until `CHILD_MIN_STAY_MS` has passed; a parent does
not re-promote a node that stepped down within `CHILD_COOLDOWN_MS`. The
opening values (3 readers, 180 s, 180 s, 300 s) and Orion's 2 to 3 and 60
to 90 s are candidates; Aster's 23c5cfd1 and 7ddb72ea record that none is
agreed, and the numbers are chosen together after the rule. Not applied to
backups.

### 4.8 Bounds, each with its condition

Counted from the last renewal of the last demand seat, in ticks under the
published allowance, with the clock skew of 4.4, with delivery as each row
says, and with the closed or left record reachable at the node a walk
reaches; no wall-clock promise is made and no row holds outside its
condition:

| condition | the generation is gone within |
|---|---|
| every notice delivered | one DROP window + two ticks (~190 s at a 5 s tick) |
| notices lost to backups | + one standby lease (4.4): ~370 s |
| notices lost to a child that keeps renewing | the child's next walk reaches a closed record: + one renewal (~60 s) |
| the root dies before terminating, bodies on a backup | one election, then the rule: + one election + one window |
| a partition | each side ends by its own rules: a side with the root terminates; a side with a backup holding bodies elects once; a side with neither lapses. Two roots that meet at the heal are the dual-root machine's case, and until it is armed they stand as two generations until each ends by this rule |

"Root death is one election" holds within one connected side and is not
claimed across a partition.

### 4.9 The fences, negative cases first

- `fence_generation_identity`: two roots with equal epochs and different ids
  are different generations; a grant, a REPLICATE and a termination from the
  wrong id are dropped; after complete forgetting a new generation forms and
  nothing old reaches it.
- `fence_closed_record`: a delayed REPLICATE after lapse creates no role and
  renews nothing; a duplicate TOPIC_TERMINATED ends nothing; a reader SUB at
  a closed record forms epoch + 1 with the tombstones carried; a publish
  before the first send cancels the termination; a publish after it forms
  the next generation with the deletions in force.
- `fence_grant_lifetime` (Aster's 181 s traces, perfect clocks and skewed):
  a REPLICATE issued before a closure and delivered at 181 s after it meets a
  record that lives for L + S + D and is also past D + S, and creates
  nothing; the same under 2 s of skew, reading 179 s old, likewise; one
  delivered at L + S + D + 1 is dropped by age alone; a grant reading 76 s
  old is dropped and one reading 74 s old is an appointment; a wall-clock
  jump beyond S at the receiver drops grants for one D; a fresh REPLICATE
  from a live root is an appointment; a REPLICATE with no generation from a
  node that is not the receiver's principal creates nothing.
- `fence_replica_receipt`: a consumed dispatch verdict earns no receipt; a
  keepalive earns no receipt; a receipt is sent only after the queued ingest
  commits; a receipt whose hash matches an older set does not count after a
  new tombstone; a root with one matching receipt does not terminate; with
  two it does.
- `fence_recovery_before_admission`: a publish fills a new root before any
  probe would have run; a delayed deleted body then arrives and is refused,
  because the deletions were pulled in RECOVERING first; a body held during
  recovery is released only on coverage and acknowledged once; EMPTY-FIRST,
  HOLDER-SECOND: a neighbour answers "none" first and a holder answers
  within the window — the body stays held and is dropped; PARTIAL-FIRST:
  three of five answer and the bodies stay held; LATE-AFTER-RELEASE: a
  deletion arriving after a fail-open release installs its tombstone and
  kills the served body; under fail-closed the same case never serves it;
  with no coverage by the mode's window the fence records the sized case,
  not a pass.
- `fence_replica_receipt_contract`: a receipt from an incarnation the root
  no longer holds as a backup does not count; one from a backup whose lease
  lapsed since does not count; the root re-reads invalidations on the
  terminating tick; a closure holder under map pressure evicts no tombstone
  before its expiry; a write arriving between the CLOSED install and the
  first send is answered by the record, never ingested.
- `fence_left_record` (Aster's prune-with-live-root trace): a child steps
  down while the root serves twenty readers; a reader arriving at the
  stepped-down node is forwarded to the root and seated there; a stale via
  at that node is answered with REHOME; no second root exists at any tick;
  a standby SUB naming the generation at that node is dropped.
- `fence_termination_precondition`: a root with an uncredited tombstone does
  not terminate and keeps its live backups; once two backups are credited
  it terminates on the next window; a root whose pushes all fail keeps
  today's custody hold until the tombstones expire.
- `fence_demand_accounting`: a child declaring zero contributes zero and is
  not counted as a seat; a child declaring n contributes n; a standby seat
  contributes zero; a bare SUB counts one; no housekeeping frame stamps
  `lastDemandAt`.
- `fence_standby_lease`: the backup's own SUB does not move `lastReplicaAt`;
  an empty backup lapses with no election and no further SUB over twenty
  ticks; a backup with one body lapses into an election and the body
  survives on the new root; a backup that is also a reader keeps its reader
  seat after the appointment lapses.
- `fence_topic_terminated`: a root with no demand and no bodies terminates
  after one window and the root, two backups and a child are gone within
  two ticks; one demand seat renewing holds it; one body holds it; a child
  that never receives the notice is answered by the closed record on its
  next walk; a reader receives exactly one terminated row and its kernel
  does not renew.
- `fence_closure_holders`: three holders keep the tombstones; with two of
  them gone a returning stale body is refused at the third; a terminus moved
  to a node that reaches coverage with a holder among its five nearest
  imports the deletions in RECOVERING before serving and refuses the stale
  body; a terminus that ends its recovery mode without coverage accepts the
  stale body under fail-open, and the fence records that as the sized
  residual case, not a pass.
- `fence_child_step_down`: a thin child steps down after the window; its
  readers reattach within one fast renewal with the app's subscription
  intact and at most one renewal's gap; a body the root lacks makes the
  child elect instead; a node that stepped down is not re-promoted within
  the cooldown; a new child is not thin within its minimum stay.
- `fence_no_reseat`: the 4.92.0 shape (a backup reaped on its own evidence
  re-seating on the next keepalive) is asserted absent over twenty ticks.
- Mutants: drop the root id from the generation (equal epochs collide); drop
  the closed-record check before role creation (a late REPLICATE re-forms the
  topic); count a child twice; let the standby SUB stamp the lease; remove
  the election exception for a backup with a body (data lost); make REHOME
  end the app's subscription (the reader is gone for good); remove the
  closure holders (a stale body returns).

### 4.10 What it does not do

It does not change the seat lease, the body TTL, the tombstone semantics
(allow, forbid, revoke on a forged kill), the merge machine, local intent or
leases. It adds a declaration to SUB, a generation and an issue stamp to
REPLICATE, and three frames, TOPIC_TERMINATED, REHOME and REPLICA_RECEIPT,
all ignored by an older kernel; an older
kernel's bare SUB reads as demand and its generation-less REPLICATE is an
appointment only from the receiver's current principal and never creates a
role (4.1), so a mixed fleet retains more, never less. Under churn the
standby set is bounded to generations with demand or bodies, and a roll
re-forms only the topics someone reads or wrote to.

## 9. Where David's word is still needed — the questions in full

1. **Recovery mode.** When a topic's root moves and the new root cannot
   reach any node holding the old deletions within 10 seconds: FAIL-OPEN
   (serve, mark the topic unrecovered, keep asking every tick, and accept
   that a deleted message may return until the deletion arrives) or
   FAIL-CLOSED (hold for up to 60 seconds before serving)? Aster recommends
   fail-closed (4.6).
2. **Thin-branch numbers** (4.7). A child steps down below 3 readers for
   180 s; a new child has 180 s before it can be judged thin; a node that
   stepped down is not re-promoted for 300 s. Orion's alternative: 2 to 3
   readers, 60 to 90 s. Confirm or name others.
3. **The tombstone arrangement** (4.6). After a topic ends its deletion
   records stay on the root and both backups as idle entries with no
   traffic, and the live tree goes. Is that the "light weight" you meant?
4. **Clock skew** (4.4). The grant rule assumes relays' clocks differ by at
   most 15 s, an opening guess. Measure it on the fleet before the build, or
   set a value?
5. **Howard's production tests**, deferred by David: should his suite run
   with its delete cache in place, so its own deletions exercise the
   teardown?
6. **The build word.**

Answered already: the seat bound stays at today's 60 s renewal and 180 s
drop (David, 2026-10-19).

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
