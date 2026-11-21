# A node that always has room for one more

**v0.2 — 2026-11-21 — axona.bot, for council review. Nothing here is built.**
Replaces v0.1 (`9a51937`), which Orion returned in scope (`43ccfc1c`). Kernel read
at tag v4.157.0 (`f348b7a`). Evidence from the Windows relay 07's whole log,
2026-11-17 to 2026-11-21.

## What changed from v0.1

- **David's two answers are in.** The reserve is a tenth of the managed table with
  a floor of ONE slot. The first build covers MANAGED peers only; the incoming pool
  is deferred.
- **The opening case is corrected and measured.** v0.1 opened on the relay's
  refused dial to a newcomer, as if that had split #council. It had not: the cause
  was a stale merge candidate, fixed in kernel 4.159.0. The refusal is real and is
  now counted: the relay was refused its own dial to the topic's active root 9,594
  times over 33 hours, and connected within one second when a slot opened.
- **Gap 4 is answered.** Orion read what is charged to the managed pool and absent
  from the table: four buckets. Item 6 counts each.
- **A dial above the target must say why** (Orion, CH-1). Without that, routine
  dials eat the reserve.
- **Closeness to a rooted topic protects for a trial, not for ever** (CH-2).
- **The retire notice is bounded and authenticated by its channel** (CH-3).

## The question

What does a node do when its connection table is full and a peer it needs arrives?

A relay in production answered: refuse. The Windows relay 07 lost its channel to
node `898bd7b40333` at 18:06:28Z on 2026-11-19. That node was, and is, the node
closest to the #council topic. From 18:07Z the relay tried to dial it back:

```
relay-connect-initiate {"to":"898bd7b40333…","cls":"M"}
initiate-refused {"why":"pool-M", … "M":{"charged":50 …}}
```

9,594 times, until 03:00:49Z on 2026-11-21. Then one of its fifty peers left, the
next dial went out, and the channel was open ONE SECOND later. It has stayed open.
For 33 hours the only thing between the relay and the peer it most wanted was its
own full table.

David, 2026-11-20: "A node must always have free space for new connections." Keep
about 10 percent free, 5 of 50. When a new node connects, one existing peer is
chosen and dropped, safely and gently. If the new node is useful it is kept. Certain
peers, like those closest to this node, are always kept, so the main rules are not
affected.

## What this is NOT

It is NOT a larger table. The cap stays 50. The node runs FIVE BELOW it.

It is NOT a new eviction policy. The kernel already has one, with its protections.
This note changes WHEN it runs.

It is NOT the fix for the #council split of 2026-11-21. That was a merge candidate
record that outlived a completed merge; it is fixed in kernel 4.159.0 and would
have split the topic with any table size. The refused dial is a separate fault
found in the same log.

## What exists today

More of David's rule is built than that log suggests. Read in source.

**Two pools** (pool_profile.js, channel_ledger.js). A relay holds M = 50 MANAGED
peers, which it selects and keeps and routes through, and I = 50 INCOMING peers,
which dialled it. A newcomer that dials a relay lands in I without displacing
anyone. So for an INBOUND connection there is already room.

**Promotion with a swap** (`_promote`, AxonaPeer.js:2160). An incoming peer can be
moved into the managed table. With M full the gate looks for a victim, commits the
swap, and transfers the slot when the victim's close is confirmed.

**The victim rule** (`_gateDecision`, AxonaPeer.js:3822–3862). The victim is the
lowest-vitality edge in the densest band of the table. Never chosen: the `kNear`
peers nearest this node, every peer in a band at or under the sparse floor, and
peers held for service. A candidate strictly closer than the farthest near peer
takes a near slot outright.

**The duty gate** (`mayRetire`, AxonaPeer.js). A voluntary close of a peer this node
owes something to is refused: an upstream, a principal, a replica, a seated
subscriber, a handoff party, a peer named by queued ingest work.

**Eviction is not death.** The victim leaves the table and its channel closes. It is
not marked dead and may bind again.

So the protections David asks for are there, and so is the swap.

## Where it fails

Four gaps. The first is the one in the log above.

**1. A node's own dial is refused before any gate runs.** To dial out, the mesh
reserves a managed slot first (`reserve`, channel_ledger.js:206; refusal at
mesh.js:1498). With `charged(M) + reserved(M) >= M` the answer is `pool-M` and no
call is placed. The swap rule that might have admitted the peer never sees it,
because it only judges a peer that is already bound. A peer the node WANTS, at a
full table, can enter only by dialling in.

**2. At the cap, a node holds.** `_addByVitality` (AxonaPeer.js:6712) says it in its
own comment: at cap the swap "is SKIPPED BEFORE THE OPEN … until it exists a node
at cap holds." Linux relay 1 logged `vitality-swap-skipped {"size":52,"cap":50}`
through the day. The target and the cap are the same number, so there is no slack
to try anything in.

**3. A swap between bands needs a margin.** To prevent two peers evicting each
other in turn, a band swap is admitted only when the victim's band holds at least
two more edges than the candidate's (the `V >= C + 2` rule). A useful newcomer in
a well-filled band is refused `no-swap`. Near displacement is exempt.

**4. The table and the ledger disagree.** At 03:00:28Z Linux relay 2 logged
`promotion-deficit {"peer":"898f14cce429…","why":"pool-M"}`. That reason comes from
the LEDGER refusing the move after the GATE found room. The ledger charges channels;
the table counts members. Orion read what fills the difference (`43ccfc1c`). Four
buckets are charged to M and are not members:

- **A refused bind the duty gate will not release.** An outbound channel that binds
  and is then refused admission is closed after a grace window, unless the node
  owes that peer a duty. Then the close is skipped and the timer re-arms
  (`if (!doClose()) arm()`, AxonaPeer.js:3434, which I read). The channel stays
  open and charged, outside the table, for as long as the duty stands.
- **Closing channels.** The table entry is deleted at once; the charge stays until
  the transport confirms the close.
- **Channels not yet bound.** Allocated, negotiating, or open and awaiting the
  three-message authentication.
- **Reservations not yet consumed,** for up to 30 seconds.

The first is by design: a duty outranks the bound. It is also invisible, and a slot
held that way is a slot the reserve does not have.

## The proposal

### 1. A target below the cap

`M_TARGET = M − reserve`, with `reserve = max(1, ceil(M / 10))`. For a relay, 45 of
50. For a leaf profile of 6, 5 of 6. David, 2026-11-20: a floor of one slot.

The fill and every routine admission aim at the TARGET. The slots between target
and cap are TRIAL slots. Nothing lives in them for long.

### 2. A dial above the target must say why

The reservation is where this is enforced (`ChannelLedger.reserve`, reached from
`mesh._initiateTo`, mesh.js:1496, which today asks for class M with no reason).

- By default a managed reservation is refused at `M_TARGET`, with the reason
  `target-M`. That is every routine dial: the fill, an introduction, a peer list.
- A reservation that carries `trial: { reason }` is admitted up to `M`. The kernel
  sets it; a transport caller cannot. Three reasons exist: `near` (closer than the
  farthest near peer), `duty` (the duty gate names this peer), `rooted-closer`
  (closer than this node to a topic it roots).

Without the flag every gossip dial would take a trial slot and the reserve would be
gone in a minute (Orion, CH-1).

**`rooted-closer` is a trial, not a standing.** v0.1 proposed adding it to the list
the duty gate reads. Orion's objection holds: raw closeness would let a bridge that
never roots, a saturated peer or a peer that answers "not root" hold a managed slot
for ever. So:

- it applies only to a peer in the topic's region that is not a bridge;
- it buys the dial and the trial window, `promoteMs`, 30 seconds;
- past the window the peer is kept only by a reason that already exists: it is
  near, or a merge or handover with it is open, which the duty gate already reads.

### 3. Above the target, one peer goes

Whenever `charged(M) > M_TARGET`, the retire rule runs. It is the existing victim
rule with the existing protections and the existing duty gate, run because the node
is over target and not because a candidate is waiting.

- The newcomer is a candidate like any other once its trial ends. If it is the
  lowest-vitality unprotected peer, it is the one that goes. That is "if the new
  node is useful it is retained."
- The trial is the promotion window that already exists (`promoteMs`, 30 seconds),
  so a newcomer is judged on measured latency and use, not on arrival.
- If every peer is protected, nothing is closed. The node sits above target, up to
  the cap, and logs `headroom-short` with the count. A protected peer is never
  dropped to make room. Then the node is full for a reason and says so.
- A refused bind that the duty gate holds open (gap 4, first bucket) is counted
  as occupying a trial slot and named in `headroom-short`. It is not closed. It is
  no longer invisible.

Admission no longer needs the band margin of gap 3. The margin exists because
admission and eviction were one act and could reverse. With a trial slot they are
two acts, separated by the trial, and the cool-off below stops the reversal.

### 4. A gentle drop tells the other side

Today the victim's channel closes. From the far end that is a lost channel, and a
lost channel starts recovery: mark, redial, repair. The drop needs one frame before
the close: `RETIRE { reason, coolMs }`. The far end then

- removes this node from its own table in the same step, with no dead mark, so no
  member is left behind without a channel (the case found on testnet on
  2026-11-10);
- does not redial for `coolMs`, unless it holds a protected reason of its own for
  this node, in which case it may dial at once and the dial is admitted under item
  2.

Two bounds (Orion, CH-3). The sender of a `RETIRE` is the peer on the channel it
arrived on, never a field in the frame. And `coolMs` is clamped by the receiver to
`[0, RETIRE_COOL_MAX_MS]`, proposed 120 seconds, so no peer can tell another to
stay away for ever.

Both ends choose independently. Without the cool-off, A drops B, B redials into A's
trial slot, A drops B again.

### 5. The incoming pool: deferred

v0.1 carried the same rule for the I pool. David, 2026-11-20: managed peers only in
the first build. Nothing here changes how incoming peers are admitted.

### 6. Count what is charged and not held

The once-a-minute row gains, for the managed pool: charged, reserved, members, and
the four buckets of gap 4 each with its own count: `preBind`, `graceOrBlocked`,
`closing`, `reserved`, plus the age of the oldest closing channel. Headroom is
computed from the ledger's charge, so a bucket that grows unseen shrinks the
reserve unseen.

## What it costs

- **Five fewer managed links at rest.** A relay routes through 45 where it had 50.
  Whether lookups lengthen is the first thing to measure; the hop counts in the
  relay logs' `verify-walk` rows are a ready baseline (25 and 41 hops on #council
  on 2026-11-21).
- **More negotiations.** Each trial is a WebRTC handshake, and one that ends in a
  drop bought nothing. The fill already bounds attempts in flight (`pPending`, 8).
- **A new frame.** Old kernels ignore `RETIRE` and see a lost channel, as today. So
  a mixed fleet flaps no more than it does now, and gains the cool-off as it
  upgrades.

## Rollout

Two switches, default off.

1. `M_HEADROOM=1`: items 1, 2, 3 and 6. No wire change.
2. `RETIRE_NOTICE=1`: item 4. Arms on receivers first.

Testnet first. The test that decides it is the production case rebuilt: a relay at
its target that loses its channel to a near peer and must dial it back.

## Acceptance checks

1. A routine dial at `M_TARGET` is refused `target-M`. The same dial with
   `trial: { reason: 'near' }` is admitted, up to `M` and no further.
2. A transport caller that sets the trial flag itself is ignored.
3. With the table above target, one unprotected peer is retired per pass until it
   is at target; near, sparse-band, service and duty peers are never chosen.
4. A `rooted-closer` peer is dialled above target, and after `promoteMs` is retired
   like any other unless it is near or a merge with it is open.
5. A bridge and an out-of-region peer never get `rooted-closer`.
6. With every peer protected nothing closes, and `headroom-short` names the count
   and any duty-held refused binds.
7. A `RETIRE` removes the sender's entry with no dead mark; a redial inside the
   cool-off is not sent; a `coolMs` of ten minutes is treated as 120 seconds; a
   `RETIRE` naming another node in its payload retires only the channel's peer.
8. The minute row's four buckets add up to charged minus members.
9. The production case: a relay at 45 of 50 loses a near peer, dials it back at
   once under `near`, and is back at target within one trial window.

## What would show this is wrong

- The 33 hours were not the pool. Two offers at 20:15Z and 20:17Z on 2026-11-19 DID
  go out, and both timed out in negotiation: the far node was not answering then.
  If it stayed silent, a reserve would have changed nothing until it woke. The log
  cannot say when it woke; it says the first dial after a slot opened succeeded.
- Lookups on a 45-peer table take measurably more hops than on 50.
- A node sits at `headroom-short` for hours because near, sparse-band, service and
  duty protections together cover more than 45 peers. Then the reserve is fiction
  on that node and the protections need a ceiling.
- Trials churn: the count of peers retired within a minute of admission stays
  high. Then vitality cannot judge a peer in 30 seconds.
- Gap 4 turns out to be most of the charge. Then the table was never full of
  peers, and the first fix is the accounting.

## Open questions

1. **For Aster.** Hold-and-Fill is yours. Does a target below the cap break a bound
   the ledger's rows rely on? Is counting a duty-held refused bind against the
   trial slots right, or should it be moved to the incoming class?
2. **For Orion.** Your three items are in as written. Is `target-M` at the
   reservation the right place, or should the kernel decline to ask?
3. **For Vega.** Does dropping the band margin for trial admission reopen the
   oscillation the margin was written for, given the cool-off?
4. **For David.** Is 120 seconds the most a peer may ask another to stay away?

## Relation to work in flight

- **The #council split** was caused by a stale merge candidate and is fixed in
  kernel 4.159.0 (`2a0fb35`, in review). This note takes one measured refusal from
  the same log and claims nothing about the split.
- **Closer-born inheritance** (David, 2026-11-03): a node born closer inherits the
  root. Item 2's new reason is what lets the standing root reach the heir.
- **Subscriber-Without-Root-Id v0.1** and **Wire-Frame-Bound v0.5** are untouched.
- **The two-pool profile** is the base this builds on. Nothing in it is removed.
