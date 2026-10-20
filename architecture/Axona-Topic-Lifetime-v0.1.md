# Axona Topic Lifetime — design packet v0.9

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
today, a new root formed with no record in reach, is named for David instead of
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
(repairPlane.js:1082) and otherwise keeps today's custody hold; a new
root finds the holders through the birth probe, which pulls from the five
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

**v0.9 (04:0xZ 2026-10-20)** takes David's four answers in chat and is the
BUILD baseline: "1. Let's use 2 subscribers and 90 seconds. 2. Clock skew.
That is fine. 3. Agreed. 4. Build." So: a child is thin below 2 readers for
90 s (4.7); S is set at 15 s, not measured first (4.4); Howard's suite runs
with its delete cache in place (Part 9); and the build starts on an
axona-protocol branch, for council review before any release.

**v0.8 (03:4xZ 2026-10-20)** takes David's decision in chat: "There is no
need for a deletion record. After the termination message, all participating
nodes will no longer reference the topic ID or subscribers. It is possible
that a child node may renew while the system is being shut down and before it
receives the termination message. This re-subscription may regenerate the
root on some node, but this too will time out quickly and the topic
infrastructure will be trivially removed in the next termination pass."
Withdrawn accordingly: the CLOSED record (4.2), the REPLICA_RECEIPT frame and
the two-receipt precondition (4.5), the closure holders, the RECOVERING state
and the fail-open or fail-closed choice (4.6), and their four fences (4.9).
Tombstones do not hold a topic open and go with the generation. The late
renewal is written as a rule with its bound. Part 9 loses two questions.

**v0.7 (02:5xZ 2026-10-20)** takes David's correction in chat: a terminated
topic has no root, so nothing "moves". A later subscriber or publisher forms a
NEW root at whatever node is then closest to the topic id, and that root
appoints its own backups (the same nodes as before or others) and selects its
own children as the subscriptions warrant. Every "moved terminus" in v0.6 now
reads "new root"; the recovery-mode question in Part 9 is restated in those
words. No rule changed.

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
deleted body from returning, while its generation lives. The body's run is
untouched; the tombstone's ends with the generation (4.6, David 2026-10-20).

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
is handled by the rules of 4.2 and 4.5; a TOPIC_TERMINATED or a REHOME naming
a generation the receiver does not hold is dropped.

Complete forgetting is accepted and stated with its assumption: no frame of
a generation is delivered later than D (`APPOINTMENT_DELAY_MS`, 4.4) after it
was issued, and no two relays' clocks differ by more than S. Nothing
enforces the physical delay; 4.4's rule rejects any grant whose apparent age
exceeds what those assumptions allow, so a delivery beyond D costs an
appointment, never a resurrection. Under that assumption, when every holder
of a generation is gone and D has passed, nothing of the old generation can
still arrive, and the next subscriber forms a NEW generation at the node then
closest to the topic id, as a first subscriber does today, with its own
backups and its own children. A frame that names no generation (an older
kernel) is never relabelled as the current one: a bare SUB is a reader and
seats as demand; a bare REPLICATE is an appointment only from the receiver's
current principal, and never creates a role from nothing.

### 4.2 A holder remembers what it LEFT, before it creates anything

A holder that leaves its own part in a LIVE generation writes a LEFT record
`{ topic, rootId, epoch, until, upstream }`, kept outside `axonRoles` in a
bounded map with `until = mono() + L + S + D` (4.4), on the monotonic clock so
a wall-clock jump neither shortens nor lengthens it. Pressure on the map
evicts the OLDEST record only, never one whose `until` has not passed; if the
map is full of live records the node refuses new appointments until one
expires, which delays a grant and never admits a stale one. The record is
written on a lapsed standby lease (4.4), a child stepping down (4.7), or a
reaper taking a role while the generation lives (Aster 2791acd7: a branch
leaving is not the root ending the topic). It means "this generation lives
elsewhere; I am not part of it".

Termination writes NO record. The generation is gone and no node references
the topic id or its subscribers after the notice (David, chat 2026-10-20).
v0.3 through v0.7 carried a CLOSED record with the tombstones in it; 4.5 and
4.6 withdraw it.

The record is consulted BEFORE any role is created or any seat is granted
(the `_syncIngest` and `_onSub` entry points, which today create a role on
first sight: syncEngine.js:226–237, wireHandlers.js:401):

- a REPLICATE or a standby SUB naming a generation under the record is
  dropped. A delayed grant therefore renews nothing and creates nothing.
- a reader SUB or a publish at a LEFT record is forwarded toward the record's
  `upstream` as a non-root forwards today, and a stale via at that node is
  answered with REHOME toward the same upstream: the live tree is served, no
  competing root is manufactured. If the upstream is unreachable the walk
  proceeds as a cold walk does today.
- a REPLICATE naming a generation the receiver neither holds nor has on
  record is an appointment only if it is within its lifetime (4.4). After a
  termination this is the late-grant case of 4.5: an empty standby that
  lapses one lease later and is reaped.

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
(`APPOINTMENT_SKEW_MS`, SET at 15 s by David on 2026-10-20, not measured
first; the merge machine's `MERGE_E_MAX_MS` of 300 s
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

The LEFT record of 4.2 is kept for L + S + D (255 s), longer than it needs
to be: a grant issued before a lapse is accepted only within D + S of its
issue, and issued at the latest at the lapse, so within D + S of the lapse;
the record outlives that by L. Under the assumptions, no grant of a lapsed
appointment is ever accepted. Aster's skewed case (a grant at a physical
181 s reading 179 s under 2 s of skew) is dropped twice over: by the record,
which lives 74 s more, and by age, 179 s being past 75 s. The fence is
`fence_grant_lifetime` below.

S is a set value, not a measured fleet bound (Aster e32cfd6f); the failure
direction is stated: a real skew beyond S makes a conforming grant read older
than D + S and be dropped, which delays appointments and admits nothing. A
later measurement can only widen S; a smaller S is safer in the only way
that matters here. A wall-clock jump at the receiver moves the apparent age of
every grant by the jump; the kernel already detects a jump against its
monotonic clock for the merge machine, and on a jump beyond S the receiver
drops grants for one D so nothing is accepted on a moved clock. An empty root
replicates nothing (repairPlane.js:931), so an empty root's backups lapse one
window after their last grant with no notice at all.

When the lease lapses, the APPOINTMENT ends and nothing else does: the node
runs `retireBackup`, stops its standby renewals, and writes a LEFT record.
The role then stands or falls on what it still is, read in this order:

1. it holds bodies or tombstones of the generation and the root is gone: the
   4.94.0 election obligation, unchanged — it stays subscribed, self-roots at
   the SUB terminal, and the others re-home under it;
2. it is a child with readers, or a reader itself, or holds local intent or
   custody: it continues in that capacity under the ordinary rules;
3. none of the above: the reapers take it on that tick.

### 4.5 Termination

A root terminates its generation when all of these hold on one tick: the
cache holds no body; no custody is open (a merge, a pull, a pin); no local
intent; demand zero; `now - lastDemandAt > DROP_MS`. Tombstones do not hold
a topic open. They belong to the generation and go with it (David, chat
2026-10-20: "There is no need for a deletion record. After the termination
message, all participating nodes will no longer reference the topic ID or
subscribers"). Nothing is credited, received or hashed first: there is no
receipt frame, no closure holder and no record. `role.replicas` is not read,
which closes Aster 5237dce7's point about it by removing the need.

The order on the terminating tick is fixed. The root sets `role.dismantling`
FIRST, synchronously; from then the role grants no seat and takes no write.
Then it sends TOPIC_TERMINATED, naming the generation, to every seat,
backups, children and readers alike, once per tick for up to three ticks or
until every seat has left, whichever is first. On the tick after its last
send `_retireRole` takes it: bodies none, tombstones dropped, seat list
dropped, backup list dropped. A stamped write arriving before the install
restamps `lastDemandAt` and cancels a termination that never began. One
arriving after it is refused by the dismantling role under the 4.116.0
retired-role cut: forwarded where a path exists, otherwise left unacked for
the publisher's own re-send, which lands at the node then closest and forms
the next generation as a first write does today.

On receipt, bound to the generation:

- a BACKUP retires its appointment (4.4) and drops the generation: bodies
  none, tombstones dropped, `backupOf` cleared, the topic out of
  `_backupTopics`. A backup holding a body the root lacks does NOT obey and
  elects by 4.4(1): `holdsHistory` protects root bodies only
  (repairPlane.js:276), so a body is carried by an election or not at all;
- a CHILD forwards the notice to its own seats, then drops its role and its
  list;
- a READER's kernel ends the app's subscription for that generation and
  delivers one row `{ terminated: true, generation }`. The subscription is
  ended, not paused: an app that still wants the topic subscribes again and
  forms the next generation. This is the one place the app sees anything.

After the notice no node references the topic id or its subscribers.

THE LATE RENEWAL (David, chat 2026-10-20). A seat may renew while the tree
is coming down and before its notice arrives. That SUB walks to the node
closest to the topic id, which holds no role any more, and `_onSub` creates
one on first sight (wireHandlers.js:401): a new, empty root with one seat.
The notice then reaches the seat, which drops its state and stops renewing;
the seat lapses at the new root at DROP_MS, demand reads zero and
`lastDemandAt` is DROP_MS old on the same tick, and the new root terminates
by this same rule with nothing left to notify. The regenerated tree costs
one empty role for one DROP window and two ticks, and it is gone on the
next pass. A child that declares readers (`demand: n`, n > 0) is not this
case: the topic has demand and the regenerated root is its root. A seat
that never receives the notice is bounded the same way: a reader's or
child's seat lapses at DROP_MS, a backup's appointment lapses by 4.4 one
lease after the root's last REPLICATE, and a REPLICATE delayed within D + S
appoints an empty standby that lapses one lease later. Delivery is not
assumed; it only shortens the end.

### 4.6 Nothing survives the tree

Deletion protection ends with the generation. A tombstone keeps a deleted
body from returning for `TTL_MS` 24 h (wireHandlers.js:1233) WHILE the
generation lives; at termination it is dropped with the role, on the root
and on every backup. No closure holder, no deletion record, no recovery pull,
no receipt (David, chat 2026-10-20). v0.3 through v0.7 carried all four, and
this revision withdraws them.

What this gives up, stated plainly. A node that missed BOTH the kill and the
termination, and still holds the deleted body in its cache, can serve that
body again: it regenerates a root with it by the late-renewal path of 4.5,
or it answers a new root's birth pull with it (repairPlane.js:725). The body
then lives until its own `TTL_MS` expires, 24 h from its publish, unless the
deleting author sends the kill again. The case needs a holder partitioned
through the kill AND through the notice; a holder that saw the kill holds no
body, and one that saw the notice holds nothing. David accepts this bound:
the body TTL is the ceiling, and a deleted message that returns this way
returns in one regenerated tree for at most the rest of its 24 h. Two trees
meeting at a heal are the dual-root machine's case, as 4.8 says.

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
numbers, set by David on 2026-10-20 ("2 subscribers and 90 seconds"):
`CHILD_MIN_READERS` = 2 and `CHILD_STEP_DOWN_MS` = 90 s. A child whose
declared demand has read 0 or 1 for 90 s steps down. The two hysteresis
values David did not name are set to match: `CHILD_MIN_STAY_MS` = 90 s (a
child is judged on no less than one full window) and `CHILD_COOLDOWN_MS` =
300 s (the v0.2 value, five windows of 60 s renewal). All four are env
overridable. Not applied to backups.

### 4.8 Bounds, each with its condition

Counted from the last renewal of the last demand seat, in ticks under the
published allowance, with the clock skew of 4.4, with delivery as each row
says, and with a LEFT record reachable at the node a walk reaches; no
wall-clock promise is made and no row holds outside its condition:

| condition | the generation is gone within |
|---|---|
| every notice delivered | one DROP window + two ticks (~190 s at a 5 s tick) |
| notices lost to backups | + one standby lease (4.4): ~370 s |
| notices lost to a child that keeps renewing | the child regenerates an empty root that ends by the same rule (4.5): + one DROP window and two ticks (~190 s) |
| the root dies before terminating, bodies on a backup | one election, then the rule: + one election + one window |
| a partition | each side ends by its own rules: a side with the root terminates; a side with a backup holding bodies elects once; a side with neither lapses. Two roots that meet at the heal are the dual-root machine's case, and until it is armed they stand as two generations until each ends by this rule |

"Root death is one election" holds within one connected side and is not
claimed across a partition.

### 4.9 The fences, negative cases first

- `fence_generation_identity`: two roots with equal epochs and different ids
  are different generations; a grant, a REPLICATE and a termination from the
  wrong id are dropped; after complete forgetting a new generation forms and
  nothing old reaches it.
- `fence_late_renewal` (David's case): a child renewing after the root's
  last tick regenerates an empty root with one seat; the notice reaches the
  child; the seat lapses and the regenerated root terminates within one
  DROP window and two ticks, after which no node holds a role, a seat, a
  tombstone or a record for the topic; a child declaring n > 0 keeps the
  regenerated root alive; a duplicate TOPIC_TERMINATED naming a generation
  no longer held ends nothing; a publish before the first send cancels the
  termination; a publish after it is refused unacked and its re-send forms
  the next generation at a clean role; a REPLICATE delayed within D + S
  after termination appoints an empty standby that lapses one lease later
  and is reaped, holding nothing in between.
- `fence_grant_lifetime` (Aster's 181 s traces, perfect clocks and skewed):
  a REPLICATE issued before a lapse and delivered at 181 s after it meets a
  LEFT record that lives for L + S + D and is also past D + S, and creates
  nothing; the same under 2 s of skew, reading 179 s old, likewise; one
  delivered at L + S + D + 1 is dropped by age alone; a grant reading 76 s
  old is dropped and one reading 74 s old is an appointment; a wall-clock
  jump beyond S at the receiver drops grants for one D; a fresh REPLICATE
  from a live root is an appointment; a REPLICATE with no generation from a
  node that is not the receiver's principal creates nothing.
- `fence_left_record` (Aster's prune-with-live-root trace): a child steps
  down while the root serves twenty readers; a reader arriving at the
  stepped-down node is forwarded to the root and seated there; a stale via
  at that node is answered with REHOME; no second root exists at any tick;
  a standby SUB naming the generation at that node is dropped.
- `fence_termination_precondition`: a root whose cache holds one body does
  not terminate; a root holding only tombstones terminates on the next
  window and the tombstones are gone from the root and both backups; a root
  with an open merge or pull does not terminate; a write arriving between
  the `dismantling` install and the first send is refused, never ingested;
  after the last send no node holds a role, a seat, a tombstone or a record
  for the topic.
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
  that never receives the notice regenerates an empty root that is gone
  within one DROP window and two ticks; a reader receives exactly one
  terminated row and its kernel does not renew.
- `fence_deleted_body_bound` (the 4.6 residual, recorded not passed): a
  holder partitioned through the kill and the notice regenerates a root
  with the deleted body; the body is served until its own TTL and a re-sent
  kill ends it; a holder that saw the kill regenerates nothing with it.
- `fence_child_step_down`: a thin child steps down after the window; its
  readers reattach within one fast renewal with the app's subscription
  intact and at most one renewal's gap; a body the root lacks makes the
  child elect instead; a node that stepped down is not re-promoted within
  the cooldown; a new child is not thin within its minimum stay.
- `fence_no_reseat`: the 4.92.0 shape (a backup reaped on its own evidence
  re-seating on the next keepalive) is asserted absent over twenty ticks.
- Mutants: drop the root id from the generation (equal epochs collide); drop
  the LEFT-record check before role creation (a late REPLICATE re-forms the
  branch); count a child twice; let the standby SUB stamp the lease; remove
  the election exception for a backup with a body (data lost); make REHOME
  end the app's subscription (the reader is gone for good); let a tombstone
  hold the topic open (the backups never end); let the dismantling role
  grant a seat (the tree never empties).

### 4.10 What it does not do

It does not change the seat lease, the body TTL, the tombstone semantics
(allow, forbid, revoke on a forged kill), the merge machine, local intent or
leases. It adds a declaration to SUB, a generation and an issue stamp to
REPLICATE, and two frames, TOPIC_TERMINATED and REHOME, all ignored by an
older kernel; an older
kernel's bare SUB reads as demand and its generation-less REPLICATE is an
appointment only from the receiver's current principal and never creates a
role (4.1), so a mixed fleet retains more, never less. Under churn the
standby set is bounded to generations with demand or bodies, and a roll
re-forms only the topics someone reads or wrote to.

## 9. David's answers, in full

The four questions of v0.8 and the answers (David, chat, 04:0xZ 2026-10-20):

1. **Thin-branch numbers** (4.7). Asked: 3 readers for 180 s, 180 s stay,
   300 s cooldown, or Orion's 2 to 3 readers and 60 to 90 s? Answer: "Let's
   use 2 subscribers and 90 seconds." Set: below 2 readers for 90 s; stay
   90 s; cooldown 300 s.
2. **Clock skew** (4.4). Asked: measure on the fleet before the build, or set
   15 s? Answer: "That is fine." Set: 15 s.
3. **Howard's production tests.** Asked: should his suite run with its
   delete cache in place so its own deletions exercise the teardown? Answer:
   "Agreed." His suite runs unchanged on the production checks.
4. **The build word.** Answer: "Build." The build goes on an axona-protocol
   branch under this packet, fences and mutants first, council review, and
   nothing is released or armed without David's separate word.

Answered earlier. The seat bound stays at today's 60 s renewal and 180 s
drop (David, 2026-10-19). A terminated topic has no root; a later arrival
forms a NEW root with its own backups and children (David, 2026-10-20). No
deletion record survives termination: tombstones go with the generation,
and a seat that renews before its notice regenerates a root that ends by
the same rule on the next pass (David, 2026-10-20); the residual is sized
in 4.6.

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
