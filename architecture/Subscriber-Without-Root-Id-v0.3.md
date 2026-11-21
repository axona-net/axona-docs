# A subscriber that is never told which node is the root

**v0.3 — 2026-11-21 — axona.bot, for council review. Nothing here is built.**
Replaces v0.2 (`6e175aa`), which Orion returned on one item (`4dcaa2ee`). Kernel
read at tag v4.157.0 (`f348b7a`).

## The question

Does a subscriber need to know the node id of the root it is served by?

David, 2026-11-20: "I suggest sending the actual root transport ID is a bad idea and
should be removed." Three reasons: the id is an optimization over aiming at the
topic; the id a subscriber holds may not be renewed; and knowing a root's node id
may lead to its physical owner. The third matters most.

## What changed from v0.2

- **The end-of-topic notice is split by receiver.** v0.2 did not read it. A root
  ending a topic sends ONE generation to backups and subscribers alike, and under
  stage 1 the two groups hold different forms. Orion's item SWR2-1; section
  "The end-of-topic notice" below.
- **`REHOME` and the left-write are read.** Orion's audit: neither uses the root's
  id as an address. One boundary is stated where v0.2 was silent.
- Orion's answer to the question put to it: stage 1, with the pin untouched, is
  clear of SWR-1.

## What changed from v0.1

- **The first switch is withdrawn.** v0.1 proposed that subscribes and renewals
  carry no waypoint, as a first build with no wire change. Orion read the two
  functions I had not, and the tree does not survive it. Details below.
- **The live case for reason 2 is gone.** v0.1 cited the #council split of
  2026-11-21 as stale pins at work. The cause was a merge candidate record that
  outlived a completed merge (fixed in kernel 4.159.0). The subscribers were pinned
  to a node that was wrongly still a root. Unpinning them would have moved them;
  it would not have made one root.
- **The proposal is now two stages of very different size.** The first hides the
  ROOT from every subscriber that is not its direct child and changes no routing.
  The second removes the parent's id too, and needs the tree rebuilt.
- **The list of places a root's id is read is longer.** Orion's second item.

## What this is NOT

It does NOT make a root unfindable. The root of a topic is the live node whose id
is closest to the topic id, and any participant can ask the mesh who that is. This
work stops TELLING subscribers and stops them STORING it. A rule on which nodes may
be a root is what would protect an owner, and it is David's open question below.

It is NOT a change to how roots, backups and merging roots name one another.

It does NOT arm `SUB_TERMINAL_VERIFY`.

## Where the id goes today

| # | what | who receives it |
|---|---|---|
| 1 | `from` on every `DELIVER`, stored as the PIN | every subscriber; it names the PARENT: the root, or a relay under it |
| 2 | `gen.root` on every `DELIVER` | every subscriber in the tree, however deep; it names the ROOT |
| 3 | `delegate` on a handover `DELIVER` | a subscriber being moved under a child relay; it names the child |
| 4 | the root hint (beacon record, else closest-node lookup) | any node that subscribes or publishes; computed locally |
| 5 | `via: [id]` on `SUB`, `PUB`, `KILL`, `TOUCH`, `PULL`, `METRICSON`, `UNSUB` | every hop the frame crosses |
| 6 | `ROOTBEACON { root, topics, epochs }` | the root's nearest neighbours and theirs |
| 7 | discovery events and status rows | the app |

Row 2 is the widest. A subscriber four relays below the root is told the root's id
on every delivery, and has no use for it but one comparison.

## Why the pin cannot simply go

Two reads, both Orion's, both verified in source.

**A relay seats only a subscribe that ENDS at it.** `_topicDecision`
(wireHandlers.js:172): a frame with no waypoint is handled only where the walk
terminates; anywhere else the answer is `forward`. A relay that holds a seat for a
subscriber lets that subscriber's bare renewal pass straight through.

**A child relay is not on the subscriber's path.** When a root holds twenty direct
subscribers it hands the next one to a child, and it picks the child by closeness
to the SUBSCRIBER's id (`_pickChild`, wireHandlers.js:462). The subscriber's own
walk toward the topic need not pass that child at all.

Put together: a delegated subscriber that renews toward the topic reaches the root,
not its child. The root is still full, so it delegates again. The child's seat goes
unrenewed and expires. Every delegated subscriber does this every 60 seconds. v0.1
listed this under "what would show this is wrong." It is wrong, and no test is
needed to see it.

So the pin does a job nothing else does today: it is how a subscriber's renewal
finds the parent the root chose for it.

## The proposal

### Stage 1. The root's id leaves `DELIVER`

No routing changes. The pin stays. A subscriber still knows its PARENT. What it
stops learning is the ROOT, unless the root is its parent.

**An opaque generation tag.** A subscriber uses `gen` for one thing: "same root,
epoch not lower" (wireHandlers.js:1207). A root mints a random tag once per
generation and sends `{ tag, epoch }` on deliveries. Relays pass it down unchanged.
A hash of the root's id would NOT do; with a few hundred nodes it is reversed by
trying each.

**Role holders keep the real pair.** A backup's appointment is judged by the
election relation on `gen.root` (syncEngine.js:346–363), so `REPLICATE`, `HANDOFF`
and the merge frames go on carrying `{ root, epoch }`. Those frames travel between
role holders, who must name one another.

**Every reader of `gen`, found so far.** This is the audit Orion asked for; each
needs a ruling before a build:

- the delivery handler's attachment decision (wireHandlers.js:1183–1290): compares
  root and epoch. Works on a tag.
- `_genValid` (topicLifetime.js:101): requires `g.root` to be a node id in hex. Must
  accept the tag form.
- `_genCarried` and `_attachedGenOf` (topicLifetime.js:97–99): what a relay sends
  down. Carries the tag.
- `REHOME` (topicLifetime.js:432–465): `_onRehome` compares the generation it is
  attached to with the one the frame carries (`_sameGen`). Works on a tag once
  `_genValid`, `_genNorm` and `_sameGen` accept one. Orion's read.
- the left-write (`_leftWrite`, topicLifetime.js:225, :437): a child stepping down
  already writes `rootId: null`; the sweep at :225 runs only on backups. Nothing to
  change. One boundary: a child directly under the root passes `upstream: <root>`
  to the subscribers it re-homes. They become the root's direct subscribers, which
  stage 1 does not hide the root from.
- `TOPIC_TERMINATED` (topicLifetime.js:260–347): the next section.
- `_endSubscriptionTerminated` (topicLifetime.js:383): keys its once-per-generation
  record on `gen.root`. Keys on the tag when there is one.
- the standby grant (rootClaim.js:429, syncEngine.js:314–371): role holders. Keeps
  the pair.

**The end-of-topic notice.** `_terminateStep` builds one payload with one `gen` and
routes it to every subscriber and every replica (topicLifetime.js:263–279). The
receiver ends a backup APPOINTMENT when the notice matches the pair it was granted
under, and an ATTACHMENT when it matches the generation its deliveries named
(:311–312). With `OPAQUE_GEN_SEND` on, a backup holds `{ root, epoch }` and a
reader holds `{ tag, epoch }`. One form cannot match both:

- the tag sent to a backup matches no appointment, and the backup stands after its
  root has ended the topic;
- the pair sent to a reader matches no attachment, and a child forwards it to every
  seat below (:347). That is the root's id sent down the whole tree, by the one
  frame v0.2 missed.

So the sender splits by receiver. Replicas and standby seats get `{ root, epoch }`.
Reader and child seats get `{ tag, epoch }`, and a child forwards the form it was
sent. A node that is both a backup and a reader gets both frames, and each ends
only the obligation it matches, which is the rule the receiver already follows.

The ignored-notice log row reads `gen.root.slice` (:313) and would throw on a tag.
It logs the tag.

**The app is told less.** `sub-root`, `pub-root`, `term-verify` and
`branch-reattach` stop carrying an id prefix. A seat's status row says attached or
not, and for how long. Relay logs keep ids: the faults of this week were found in
them.

What stage 1 buys: every subscriber under a relay stops being told who the root is.
What it does not: a root's direct subscribers still see it as their parent, and
anyone can still look it up.

### Stage 2. The parent's id goes too. Not proposed for build

For a subscriber to hold NO node id, its renewal must find its seat by aiming at
the topic. That needs the two reads above reversed:

- **Seats on the path.** The root hands a subscriber down to a relay its subscribe
  PASSED THROUGH, not to the relay closest to the subscriber. The kernel already
  notes the return route of a subscribe (`_noteReturn`, Closer-Born v0.6).
- **A relay takes a renewal in transit.** `_topicDecision` handles a bare subscribe
  that carries a seat token this relay issued, wherever on the walk it is.

That is a different tree: fan-out follows routing paths in place of keyspace
closeness. Its shape, its depth under load and its behaviour when a path changes
are all unexamined. It also needs a subscribe to reach the root on a cold mesh
without a hint, which kernel 4.64.0 tried and lost 25–55 percent of history replay
on (AxonaManager.js:1576–1608); the terminal check that would correct that is off.

Two smaller things could be done in its place, and are named so they can be
refused:

- every delegated renewal climbs to the root, which forwards it to the child. No
  subscriber holds a child's id. The root handles every renewal of every
  subscriber, which is the load delegation exists to remove.
- leave the pin as it is. A subscriber knows a relay's id, and never the root's
  unless the root is its parent. That is stage 1, finished.

## What it costs

Stage 1: a wire change. Old receivers read `gen.root`; a new root must send both
forms until none remain, so it is two releases, read-both then stop-sending. One
random value per generation. Nothing on the delivery path beyond that.

Stage 2: a redesign of delegation, not costed.

## Rollout, stage 1 only

1. `OPAQUE_GEN=1` on receivers: accept `{ tag, epoch }` beside `{ root, epoch }`.
2. `OPAQUE_GEN_SEND=1` on roots: send the tag and stop sending `gen.root` on
   `DELIVER`.
3. The app-facing events lose their id prefix in the release that turns 2 on.

## Acceptance checks, stage 1

1. A subscriber under one relay receives deliveries, re-attaches across a root
   change and across a relay change, and at no point holds the root's node id in
   any map, log row or event.
2. An old subscriber under a new root still attaches (both forms sent).
3. A new subscriber under an old root still attaches (the pair accepted).
4. Two generations of one root are told apart by epoch on the tag; two roots at
   the same epoch are told apart by tag.
5. A backup's grant is judged on the real pair and is unchanged.
6. A tag is not derivable from the root's id: the same root mints different tags in
   two generations.
7. A root ends a topic that has two backups, one child relay and readers under the
   child. Both backups end their appointments. Every reader gets one `terminated`
   row. No frame that reaches the child or a reader carries the root's id.
8. A node that is a backup and a reader of the same topic ends both, from the two
   frames.

## What would show this is wrong

- A subscriber-side reader of `gen.root` uses it as an ADDRESS and not as an
  identity to compare. `REHOME` and the left-write were the suspects and are
  cleared. The end-of-topic notice was not on the list and failed. A third audit
  by a seat that has not yet read it is the check.
- A relay child needs the root's id to become a backup later. Then relays, which
  are subscribers too, must receive the pair, and stage 1 hides the root from
  leaf subscribers only.
- The answer to David's question below is "roots are always relays." Then the id
  stage 1 hides is a relay's, and the work buys little.

## Open questions

1. **For David.** May a person's device root a topic? If roots are always relays,
   most of reason 3 is met by that rule alone, stage 1 is tidying and stage 2 is
   not worth its cost. If a phone may root a topic, stage 1 is worth doing soon
   and stage 2 is worth designing.
2. **For Aster.** Topic Lifetime is yours. Does `{ tag, epoch }` in place of
   `{ root, epoch }` on `DELIVER` keep TL-B07, B11, B12 and B13? What do `REHOME`
   and the left-write need from the root's id?
3. **For Orion.** SWR2-1 is in as the split by receiver. Does a standby SEAT in
   `role.subscribers` always have a matching entry in `role.replicas`, or must the
   sender read the seat's kind to choose the form?
4. **For Vega.** Does a delivery proof identify the root by key? Unanswered from
   v0.1, and it decides whether the tag hides anything from a subscriber that
   verifies proofs.

## Relation to work in flight

- **Kernel 4.159.0** fixes the #council split. Nothing here bears on it.
- **Wire-Frame-Bound v0.5** also changes `DELIVER`. The second to be built rebases
  on the first.
- **Connection-Headroom v0.2** is untouched. Orion concurs on it (`4dcaa2ee`).
- **Publisher location privacy** is the same principle applied to publishers.
