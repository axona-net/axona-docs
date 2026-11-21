# A node that always has room for one more

**v0.1 — 2026-11-20 — axona.bot, for council review. Nothing here is built.**
Kernel read at tag v4.157.0 (`f348b7a`). Evidence from production relay logs,
03:00Z–03:32Z 2026-11-21.

## The question

What does a node do when its connection table is full and a peer it needs arrives?

Tonight a relay answered: refuse. The Windows relay 07 was root of #council. A node
was born closer to that topic than the relay. The relay tried to open a channel to
it and its own table said no, every 15 seconds, 128 times in half an hour:

```
relay-connect-initiate {"to":"898f14cce429…","cls":"M"}
initiate-refused {"why":"pool-M", … "M":{"charged":50 …}}
```

David, 2026-11-20: "A node must always have free space for new connections." Keep
about 10 percent free, 5 of 50. When a new node connects, one existing peer is
chosen and dropped, safely and gently. If the new node is useful it is kept. Certain
peers, like those closest to this node, are always kept, so the main rules are not
affected.

## What this is NOT

It is NOT a larger table. The cap stays 50. The node runs FIVE BELOW it.

It is NOT a new eviction policy. The kernel already has one, with its protections.
This note changes WHEN it runs.

It is NOT shown to be the cure for tonight's split. A relay and a newcomer with no
direct channel can still exchange routed frames through others. Whether the handover
of the #council root needed that direct channel is not read. See "What would show
this is wrong."

## What exists today

More of David's rule is built than tonight suggests. Read in source.

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

Four gaps. The first is tonight's.

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
the table counts members. Something is charged to M that is not a member. I have
not read what.

## The proposal

### 1. A target below the cap

`M_TARGET = M − reserve`, with `reserve = max(1, ceil(M / 10))`. For a relay, 45 of
50. For a leaf profile of 6, 5 of 6.

The fill and every routine admission aim at the TARGET. The slots between target
and cap are TRIAL slots. Nothing lives in them for long.

### 2. A needed dial may use a trial slot

The reservation for an outbound dial succeeds while `charged(M) + reserved(M) < M`,
as now. What changes is that a node at its target still has five such slots. A
routine fill dial stops at the target. A dial with a REASON may go above it: a peer
nearer than the farthest near peer, a peer the node owes a duty, a peer closer than
this node to a topic it roots.

That last reason is new, and it is tonight's. It belongs in the list the duty gate
already reads (`obligationsOf`): a root owes a handover to a node born closer.

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

Both ends choose independently. Without the cool-off, A drops B, B redials into A's
trial slot, A drops B again.

### 5. The same for the incoming pool

The I pool refuses at 50 with `pool-I`. The rule carries over: a target of 45, and
above it the longest-idle incoming peer that the duty gate releases is retired. A
node should never be unable to answer a call. Whether I needs it as much as M is a
question for the review; inbound has had room every time I have looked.

### 6. Count what is charged and not held

Gap 4 is a measurement before it is a fix. The once-a-minute row gains, per pool:
charged, reserved, members, and charged-not-member with the oldest age. If channels
are charged to M with no table entry, headroom built on the ledger's count is
smaller than it reads.

## What it costs

- **Five fewer managed links at rest.** A relay routes through 45 where it had 50.
  Whether lookups lengthen is the first thing to measure; the hop counts in the
  relay logs' `verify-walk` rows are a ready baseline (25 and 41 hops on #council
  tonight).
- **More negotiations.** Each trial is a WebRTC handshake, and one that ends in a
  drop bought nothing. The fill already bounds attempts in flight (`pPending`, 8).
- **A new frame.** Old kernels ignore `RETIRE` and see a lost channel, as today. So
  a mixed fleet flaps no more than it does now, and gains the cool-off as it
  upgrades.

## Rollout

Two switches, default off.

1. `M_HEADROOM=1`: items 1, 2, 3 and 6. No wire change.
2. `RETIRE_NOTICE=1`: item 4. Arms on receivers first.

Item 5 waits for the first two to be measured.

Testnet first. The test that decides it is tonight's case rebuilt: a relay at its
target, rooting a topic, and a node born closer than it.

## What would show this is wrong

- With headroom on, the relay opens the channel to the closer-born node and the
  root still does not move. Then the full table was not what held the split, and
  the cause is in the handover or the merge.
- Lookups on a 45-peer table take measurably more hops than on 50.
- A node sits at `headroom-short` for hours because near, sparse-band, service and
  duty protections together cover more than 45 peers. Then the reserve is fiction
  on that node and the protections need a ceiling.
- Trials churn: the count of peers retired within a minute of admission stays
  high. Then vitality cannot judge a peer in 30 seconds.
- Gap 4 turns out to be most of the charge. Then the table was never full of
  peers, and the first fix is the accounting.

## Open questions

1. **For David.** Is 10 percent the reserve at every size, or a floor of one slot
   on a leaf with 6? And does the rule apply to the incoming pool in the first
   build, or to managed peers only?
2. **For Aster.** Hold-and-Fill is yours. Does a target below the cap break a bound
   the ledger's rows rely on? And is "closer than me to a topic I root" a duty the
   gate should read, or a reason of its own?
3. **For Orion.** What is charged to M on the Windows relay 07 that is not in its
   table? Its stats row is in the `initiate-refused` lines.
4. **For Vega.** Does dropping the band margin for trial admission reopen the
   oscillation the margin was written for, given the cool-off?

## Relation to work in flight

- **The #council split** is live and under its own investigation. This note takes
  one observed refusal from it and no conclusion.
- **Closer-born inheritance** (David, 2026-11-03): a node born closer inherits the
  root. Item 2's new reason is what lets the standing root reach the heir.
- **Subscriber-Without-Root-Id v0.1** and **Wire-Frame-Bound v0.5** are untouched.
- **The two-pool profile** is the base this builds on. Nothing in it is removed.
