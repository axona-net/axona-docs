# Axona Topic Lifetime — design packet v0.13

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

**v0.13 (20:2xZ 2026-10-20)** closes Aster's X1 and X2 on e469e27
(b0748c4c): an appointment's end cleared every tombstone on the shared role,
including one the live attachment had delivered from another generation; and
the delegation handover trusted the sender instead of the decision. Fixed at
30d8571: a tombstone carries the generation that delivered it and an
obligation's end drops only its own; a handover rides only an accepted
frame. Departures 26 and 27; fences 233; mutants 36.

**v0.12 (17:5xZ 2026-10-20)** closes Aster's two follow-ups at the fix
boundaries (848688cb; Orion 6deb9c63 confirmed each from source): a delayed
older DELIVER of the same root rolled the attachment back, so an old notice
matched again; the held-body evidence outlived a change of upstream, so a
child could step down with a body only its OLD root had sent; and the held
set was kept unarmed and never pruned. Fixed: the attachment
moves forward only within a root, the evidence is bound to the current
upstream and generation and cleared when either changes, and the set exists
only armed and is pruned with the cache. Then Aster's four cases at those
seams (0cfdd82d): a different root id alone re-attached; an obsolete
same-root DELIVER still credited custody; the prune missed backups; a fresh
older-epoch grant rolled an appointment back. Fixed in the same commit
series: a root switch needs a reply to this node's OWN SUB (an attachment
nonce on SUB, echoed on DELIVER), custody is credited only by an accepted
current-generation DELIVER, the prune runs over every role, and grants move
forward only. Then Aster's TL-B11 (535a6741): a reply to an older request
could still commit after a newer one had. Fixed: each nonce carries the
holder's attempt number and a reply commits only for an attempt newer than
the last committed, the pin following the decision; TL-B12 (c59cb0be): the
decision made once and three-way, commit, data only, or forward from the
selected parent; TL-B13 (daa31e63): one attachment per topic per node and
teardown bound per obligation. And two findings from the armed suite: the
selected parent hands a delegated seat to its child, and the attempt window
holds sixteen. Part 10: departures 14 to 27, fences 233, mutants 36. The
4.4 skew sentence is corrected (c59cb0be): a skew beyond S can admit as
well as refuse.

**v0.11 (17:xxZ 2026-10-20)** closes Aster's three counterexamples on the
build (c5adedec, REQUEST CHANGES), each confirmed from source: a delayed
notice of an old generation ended a seat in the new one (the binding was by
principal OR upstream, not the exact generation); a thin child stepped down
holding a body its upstream never sent; a gen-bearing grant with no issue
stamp passed as legacy. Fixed at ba53255: a DELIVER names the generation it
serves and the notice and REHOME bind to it exactly; a child steps down only
when every body it holds is one its upstream sent; no stamp, no grant. Part
10 is updated (departures 11 to 13, fences 160, mutants 21). Retracted:
c4a9ad5e's "as you cleared them" about the 4.4 rule and the LEFT record;
Aster never cleared them.

**v0.10 (16:0xZ 2026-10-20)** adds Part 10, the build: branch `topic-lifetime`
088c524 over v4.116.0, behind `TOPIC_LIFETIME` (default off), six fences,
18 of 18 mutants red, ten departures from the packet stated. Unreleased,
unarmed.

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

S is a set value, not a measured fleet bound (Aster e32cfd6f). The failure
direction, corrected by Aster (c59cb0be): a real skew beyond S is OUTSIDE
the model, in both directions. A receiver whose clock runs ahead reads a
conforming grant as older than D + S and drops it, which delays appointments
and admits nothing; a sender whose clock runs ahead makes an old grant read
younger, and a 100 s grant from a sender 30 s ahead reads 70 s and passes
the 75 s gate. The rule is a bound under the stated S, not a refusal-only
rule under any skew. A later measurement can only widen S. A wall-clock jump at the receiver moves the apparent age of
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

## 10. The build (branch `topic-lifetime`, 30d8571 over v4.116.0; 2026-10-20)

Built on David's word ("Build", 04:0xZ). NOT released, NOT armed: both are
his separate words. The whole machine sits behind `TOPIC_LIFETIME` (kernel
option `topicLifetime`, env `TOPIC_LIFETIME=1`, default 0). Unarmed, a node
is 4.116.0 with two more registered frames that it consumes without effect.

**Where it lives.** One mixin, `src/pubsub/topicLifetime.js`: the seat kinds
and demand (4.3), the LEFT records (4.2), the grant rule and the wall-jump
hold (4.4), the standby-lease sweep (4.4), the termination sweep and its
per-tick step (4.5), the two receivers `_onTopicTerminated` and `_onRehome`,
the reader's `_endSubscriptionTerminated`, and the thin-branch sweep (4.7).
The tick calls `_lifetimeTick` after replication and before the standby
renewals and the reapers. Touchpoints elsewhere, each one line or a block
named for the rule: the cut refuses a dismantling role (mergeMachine); a
dismantling root beacons nothing (rootElection) and replicates nothing
(repairPlane), and the reapers leave it to its termination step; SUB carries
`standby | demand | gen` and REPLICATE carries `gen + issuedAt` (AxonaManager,
syncEngine); the grant rule runs at REPLICATE ingest before `becomeBackup`
(syncEngine); `_accept` stores the seat's kind and demand and stamps
`lastDemandAt` only for demand; a stamped publish and a fresh kill stamp it, a
duplicate kill does not (wireHandlers); a standby seat is never promoted or
delegated; a dismantling root refuses every seat; an UNSUB marked
`steppedDown` arms the parent's cooldown; two Boundary-1 rows and three
projections (boundary1Registry); the peer stops each Subscription handle on
the terminated row (AxonaPeer).

**Departures from the packet, each stated:**

1. The flag. The packet has none; David is the deploy gate, and arming a
   rule that ends topics is a word, not a default.
2. A terminated topic's epoch is kept as a high-water for L + S + D
   (`_genHighWater`, read by `_knownEpoch`) so the next generation the same
   node forms mints above it. Without it the same node minted epoch 1 again
   and a late notice of the ended generation matched the new one. This is
   identity, not a deletion record: no seat, no tombstone, nothing served.
3. LEFT records are consulted for REPLICATE grants and standby SUBs. A reader
   SUB at a stepped-down node is handled by routing's existing via-pop
   reroute, which already forwards it onward; the record adds nothing there.
4. The step-down needs a REACHABLE upstream; unreachable is the election
   path, not a thin branch. The cooldown is armed at the parent by the
   child's UNSUB marked `steppedDown`, so the parent learns at once rather
   than at the seat's lapse.
5. Demand counts SEATS, and a seat lasts DROP_MS after its last renewal. A
   branch whose second reader stops is thin only after that seat lapses, so
   it steps down DROP_MS + 90 s after the reader's last renewal, not 90 s.
   The 4.8 rows read the same way: a notice lost to a child adds one
   renewal; a reader that stops adds one seat lease before anything moves.
6. Armed, termination (DROP_MS of no demand) precedes the five-minute
   empty-role grace for a keyspace host's seatless empty root. The grace
   remains the bound for an unarmed node (fence_topic_terminated T8).
7. Mixed fleet. An older kernel's bare standby SUB reads as a READER (demand
   1), so a root with a 4.116.0 backup never terminates until that backup is
   rolled; and a 4.116.0 root recruits no NEW armed backup, since a
   generation-less grant renews only from the current principal. Both are
   the 4.1 rule ("a mixed fleet retains more, never less") and both end when
   the fleet is on one kernel.
8. A backup that holds ANY body ignores the notice: the root's cache was
   empty when it terminated, so every body a backup holds is one the root
   lacks.
9. The notice binds by the receiver's principal, its upstream, the sender
   being its upstream, or (no role and no pin); a root ignores another
   root's notice (4.8: a split's halves each end by their own rule).
10. The seat lease, the body TTL, the merge machine, local intent and leases
    are untouched (4.10 holds).
11. (Aster TL-B01.) A DELIVER names the generation it serves: a root its own,
    a child the one its upstream named. The receiver records that attachment
    (`role.attachedGen` on a relay, `_attachedGen` for the node's own
    subscription), and TOPIC_TERMINATED and REHOME bind to it EXACTLY; a
    backup binds by its appointment's exact (root, epoch); only an
    unversioned attachment, an older-kernel upstream that named none, binds
    by upstream. A delayed notice of (R, 1) therefore never ends a seat in
    (R, 2). The window: a reader re-seated in the next generation is
    attached to it on the first DELIVER after its SUB, one round trip.
12. (Aster TL-B02.) A thin child steps down only when every body it holds is
    one its upstream SENT (`role.upstreamHeld`, stamped in `_onDeliver`). A
    body that arrived from below, a reader's replay-up, is held until the
    root has pulled it and fanned it back, which marks it; the sweep logs
    `step-down-held-body` once and the branch stands. This is 4.7's "a body
    the root lacks" made checkable from the child's own state.
13. (Aster TL-B03.) A gen-bearing grant with no finite issue stamp is
    refused, as a creation and as a renewal; only a generation-less grant is
    legacy, and that only from the current principal.
14. (Aster TL-B04.) The attachment moves FORWARD only within a root: a
    DELIVER naming the same root at a lower epoch does not move it, so
    reordered traffic cannot make an old notice match again; a different
    root re-attaches at whatever epoch, since no order exists across roots.
    The obsolete DELIVER's bodies are still cached; only the attachment
    ignores it. The remaining window is the one in departure 11: a reader
    whose seat has moved into the next generation is attached to it on the
    first DELIVER after its SUB.
15. (Aster TL-B05.) Custody evidence is bound to the attachment: the held
    set and the sender it came from are cleared on any change of upstream or
    generation and on a REHOME, and a body is marked held only when the
    CURRENT upstream sent it. A child re-attached to a replacement root
    keeps every body until that root has sent it back.
16. (Aster, boundedness.) The held set exists only when armed, describes
    only bodies in the cache, and is pruned to the cache every tick. A relay
    under an upstream that names no generation (an older kernel) marks
    nothing and therefore never steps down, which is the conservative side
    of the mixed-fleet rule.
17. (Aster TL-B07.) A root switch is a SELECTION, not an arrival. Every SUB
    this node sends carries a fresh attachment nonce (the current and the
    previous are kept); the reply to a SUB echoes it on every DELIVER it
    sends; only a DELIVER that echoes this node's nonce may attach to a
    generation of a different root, or make a first attachment. A DELIVER
    that echoes nothing is fan-out: it may advance the attachment within
    the current root and never switch it. A different root id alone is not
    evidence of a new selection. No order across roots is assumed.
18. (Aster TL-B08.) Body custody is credited only by an ACCEPTED
    current-generation DELIVER from the current upstream, never by sender
    equality alone; an obsolete frame that is ignored for attachment is
    ignored for custody too.
19. (Aster TL-B09.) The held-set prune runs over EVERY role every tick,
    before any sweep and apart from any eligibility test, so a backup under
    keepalives accumulates nothing across evictions.
20. (Aster TL-B10.) Grants move forward only, as deliveries do: a grant
    naming the same root at a lower epoch is refused whatever its
    freshness; a different root's grant issued more than S before the
    current appointment is an old sender's delayed grant and is refused;
    within S the two senders' clocks cannot order them and the grant
    re-principals as today. Freshness is not generation currency.
21. (Aster TL-B11.) The nonce proves correlation, not currency. Each SUB
    nonce carries the holder's attempt number (the current and the previous
    are kept); a reply commits a selection only if its attempt is NEWER than
    the last committed one, so a delayed reply to an older request never
    replaces a newer committed selection, and a repeated reply to the
    committed attempt is data only. The previous attempt's reply still
    commits when no newer reply has (overlap liveness). This is local
    request order, not an order across roots. Armed, a DELIVER that names a
    generation re-pins the upstream only when the attachment decision
    accepts it; unarmed, and for a frame naming no generation, the pin
    behaves as 4.116.0.
22. (Aster TL-B12.) The decision is three-way and made once. A frame that
    echoes a nonce of an attempt NEWER than the last committed one is the
    reply to this node's own request and COMMITS, any generation, any
    parent. A frame that echoes a nonce recognised as obsolete or already
    committed, or one never issued here, is DATA ONLY: bodies kept, no
    attachment, no pin, no custody credit. A frame that echoes nothing is
    fan-out and may move the attachment FORWARD only when it comes from the
    parent this node currently selects (the pinned upstream) and names the
    current root at an epoch not lower; fan-out from any other node is data
    only. Same root and epoch do not identify the parent.
23. (Aster TL-B13.) ONE attachment per topic per node. A node that is a
    relay (child or backup) AND its own reader sends one SUB per topic for
    both duties, so there is one selection: one record (`_attach`: the
    generation, the selected parent, the attempt window, the committed
    attempt) shared by the relay role and the reader. A backup APPOINTMENT
    (its principal and the generation its grant named) is a separate
    obligation. A notice ends only the obligation it matches: an old
    appointment's end never ends a reader attached elsewhere and never
    removes its pin; an attachment's end never ends a backup appointment to
    another generation; the role object goes only when no live duty remains
    on it. Both receipt orders are fenced.
24. The selected parent hands a delegated seat to its child. Under the
    selected-parent rule a delegated subscriber's first DELIVER from its new
    child echoes an attempt the parent already committed, from a node that
    is not its pinned parent, so it would be data only and the subscriber
    would re-seat at the root every renewal (found by the armed suite, not
    by Aster). The parent the subscriber selected therefore tells it: one
    empty DELIVER per delegated seat carrying `delegate`, which moves the pin
    and the attachment's parent and changes neither the generation nor the
    attempt. A `delegate` from any node other than the selected parent is
    ignored.
25. The attempt window is bounded at sixteen, not two. A cold subscribe
    emits several SUBs within seconds (the first, the steered one, the burst
    retries), and the reply to the first must still be recognised; with a
    two-deep window it was not, and no reader pinned (found by the armed
    suite). The oldest attempts fall off; a reply to one of them is data
    only.
26. (Aster X1.) A tombstone belongs to the obligation that delivered it.
    Armed, a tombstone carries the generation that delivered it: a DELIVER
    tags it with the accepted attachment's generation, a REPLICATE with the
    grant's; a root's own and a legacy carrier's stay untagged. An
    obligation's end drops only its own: the appointment's generation, or
    the untagged ones when the appointment was legacy; the attachment's
    generation when the attachment ends. A deletion the live attachment
    delivered keeps suppressing its body after the appointment ends. This
    is David's rule applied per generation, not per topic: nothing of a
    generation survives ITS end.
27. (Aster X2.) The handover obeys the same decision as every other control
    effect: it rides only a frame the decision accepted, a reply to a live
    newer attempt or fan-out from the selected parent at the current root
    at an epoch not lower. A delayed older-epoch delegate from the pinned
    parent, or one echoing an obsolete attempt, moves nothing.

**The fences, armed by the fixture whatever the environment says** (run
`node test/<name>.mjs`; `test/lib/lifetimeFixture.mjs` drives one manager
with wall and monotonic clocks on one manual clock):

| fence | checks | what it pins |
|---|---|---|
| fence_topic_terminated | 115 | 4.3 demand counted once; 4.5 the whole termination: window, install before send, three rounds, the tick after, tombstones with it; what holds (seat, body, intent, lease, custody) and what does not (tombstones); write before/after the install; a dismantling root refuses seats and the next renewal forms epoch + 1; receipt at a backup, a backup with a body, a child, a reader; generation binding; T8 grace ordering; B01 the exact binding (backup same-root/new-epoch, reader attached by DELIVER, child forwards the exact generation, a renewed reader, the unversioned fallback); B04 forward-only attachment on a reader and on a relay; B07 a root switch only by a reply to this node's own SUB, a delayed old DELIVER from a previous root re-attaches nothing, a fan-out DELIVER makes no first attachment, the previous nonce still answers; B11 cross-root and same-root reorderings never replace a newer committed selection, a repeated committed reply is data only, overlap liveness kept, the same on a relay with its late body cached data-only, the pin follows the decision; B12 same generation, two parents, for a reader and a relay: an obsolete correlated reply and fan-out from an unselected parent move nothing and credit nothing, fan-out from the selected parent moves forward and credits, a nonce never issued is data only; B13 a hybrid node, child plus reader and backup plus reader, both receipt orders; B14 the delegation handover from the selected parent only, and a six-attempt burst whose first reply still commits, the window bounded at sixteen; X1 a deletion belongs to its obligation, both orders, the reordered body still suppressed after the appointment ends; X2 the handover's two negatives and two positive controls; unarmed |
| fence_standby_lease | 45 | 4.4 the lease: the backup's own SUB moves nothing; an empty backup lapses with no election and no further SUB; a body or tombstone keeps the election path; a reader keeps reading; the grant rule at 74 s and 76 s, Aster's 181 s traces perfect and skewed; LEFT refuses only the generation left; the wall-jump hold; the legacy grant; armed frames carry gen + issuedAt, unarmed carry neither and never lapse; B03 no stamp no grant, created or renewed; B10 a fresh older-epoch grant does not roll the appointment back and the old notice does not retire it, a different root's grant beyond S is refused, one after it re-principals |
| fence_child_step_down | 44 | 4.7 at David's numbers: REHOME, UNSUB steppedDown, LEFT, retire; the clock clears at the floor; the stay (150 s scene); a backup and an unreachable upstream never step down; REHOME keeps the app's subscription and is ignored from a non-upstream; the parent does not re-promote a cooled node; a REHOME naming an old generation is ignored; B02 body custody (an untransferred body holds the branch; the upstream's DELIVER of it releases; a relayed body is no bar); B05 evidence cleared on re-attachment to a replacement root, kept body until that root sends it, cleared on REHOME; the set pruned with the cache; B08 an obsolete same-root DELIVER's body is cached but not credited; B09 a backup's held set is pruned to its one-entry cache; unarmed keeps no set and no attachment |
| fence_topic_demand_stamp | 8 | the real ingress paths: a stamped publish and a fresh kill stamp; a duplicate kill, a REPLICATE union and a beacon do not; the peer stops each Subscription handle once |
| fence_deleted_body_bound | 8 | 4.6 the residual, recorded not passed: a holder partitioned through both the kill and the notice serves the deleted body until its own TTL; one that saw the kill holds nothing |
| fence_topic_late_renewal | 13 | a fabric of four real managers: reader, publisher, root, two cohort backups seated as standbys; the message is deleted, the reader leaves, the root dismantles after one window and the backups drop the generation with the tombstone; the LATE RENEWAL regenerates an empty root at epoch + 1 with one seat, gone within one window and two ticks; nothing referenced anywhere |

**Mutants, 36 of 36 red** (scratchpad `tl-mutants.py`; each edits one
source file from a scratch copy, runs the fences named, restores every
file): a standby SUB stamps demand (15 + 8 red); the cut ignores dismantling
(2); a tombstone holds the topic open (2 + 1 + 8); a backup with a body
obeys (1); the generation binding dropped (1); a dismantling root grants
seats (2); the backup's own SUB moves its lease (12); the D + S age check
dropped (3); the LEFT check dropped (3); a legacy grant from a stranger
creates a role (2); the lapse takes a backup with a body (2 + 2); REHOME ends
the subscription (2); the stay dropped (1); the cooldown dropped (1); a
child's seats counted as readers (4); the epoch high-water dropped (1 + 1);
the reapers take a dismantling root (1); a stamped publish does not stamp
(2); the notice binds by principal or upstream instead of the exact
generation (Aster TL-B01); a thin child steps down with a held body (TL-B02);
a stampless gen-bearing grant is accepted (TL-B03); a delayed older DELIVER
rolls the attachment back (TL-B04); custody evidence survives an upstream
change (TL-B05); the held set is never pruned; a different root id alone
re-attaches (TL-B07); an obsolete DELIVER credits custody (TL-B08); the
prune skips roles that are not step-down candidates (TL-B09); a fresh
older-epoch grant rolls the appointment back (TL-B10); a reply to an
older request commits after a newer one did (TL-B11); the pin ignores the
attachment decision (TL-B11); an obsolete correlated reply falls through
to the forward rule (TL-B12); fan-out from an unselected parent moves the
pin (TL-B12); an appointment's end also ends a reader attached elsewhere
(TL-B13); a delegate handover from a non-selected parent is accepted; the
attempt window is two deep again; an appointment's end clears every
tombstone on the shared role (X1); the handover trusts the sender instead
of the decision (X2). One mutant, a different root id alone re-attaching, was
dropped as subsumed by the selected-parent rule; three were retargeted
after rewrites moved their anchors. Three of these were green on the first run because the MUTANT was
wrong (the receiver's seat instead of the sender's lease; a stay equal to
the thin window; a cooled node never first in line); the mutants were fixed,
not the code.

**The suite** (at 30d8571, with nothing else running on the box):
unarmed 291 of 293, the TURN credential flake and fence_merge_sim_partition;
armed 293 of 293. At e469e27 it read unarmed 291 of 293,
the TURN credential flake and fence_merge_sim_partition, and armed 292 of
293, the TURN credential flake. Two armed runs between ba53255 and
97b854c were not evidence: one ran while a mutant pass rewrote source files,
the other while fences and smokes ran alongside, and smoke_restart_handoff
(106 s on an idle Mac against the runner's 180 s limit) timed out in both;
alone, armed, it passes. At ba53255 the runs read unarmed 293 of 293 and
armed 292 of 293: smoke_interloper_convergence,
an eleven-second real-time smoke, failed its late-replay check once in the
suite and once in three runs alone, then passed twelve of twelve (six armed,
six unarmed) under a log tap that recorded no lifetime event in any run, at
load average 10 to 24 on this Mac. It is read as the same wall-clock class
as fence_merge_sim_partition, and it is stated here, not hidden. At 088c524 the same
runs read 291 of 293 (the TURN credential flake and fence_merge_sim_partition,
the load-bound wall-clock fence, four of four alone at load 10 to 11) and
293 of 293. Seven pre-lifetime scenes
hand-build generation-less REPLICATE frames or pin the 4.94.0 standby
contract ("a backup whose root vanished is retained for ever"); they now
say `topicLifetime:false` and the armed contract is the two fences above.
Registry: two Boundary-1 rows, the E0 and E2 manifests regenerated, the
door counts 23 → 25 and 43 → 45.

**What this does not show.** No production run: the fleet is on 4.116.0 and
the flag is off. The thin-branch numbers and S = 15 s are David's settings,
not measurements. The mixed-fleet case in departure 7 is reasoned from the
rule, not run against a 4.116.0 peer.

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
