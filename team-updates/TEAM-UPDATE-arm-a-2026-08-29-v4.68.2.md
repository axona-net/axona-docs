# Arm A — the connection-quality baseline

Date: 2026-08-29
Kernel on testnet: 4.68.2 (connection-quality stack present but OFF)
Run: seed 100, 2026-08-28 18:26Z → 2026-08-29 06:26Z (12h), analyzer sha256 de265deb

## The question

Does the connection-quality stack make pub/sub better under real conditions?
You can't answer that by turning the stack on and watching it work. You have to
show the failures are there when it's off, then show they're gone when it's on.
Same setup both times, one switch. Arm A is the switch off. It is the control,
and a control only counts if it reproduces the disease. A placebo group that
happens not to get sick proves nothing about the drug.

Arm A got sick.

## What ran

Eight harness participants across the four fleet hosts — M4, the M1, the Linux
box, the Windows box — publishing and reading on 15 open channels and 8 owned
ones, on top of 62 relays. Alongside them a churn driver ran the §6 schedule:
32 rolling restarts, one relay at a time, heir-preserving so census never
dipped; and 10 abrupt kills on the two hosts with headroom against the 95%
floor, each relay held dead for a three-minute heir window. Zero refusals; the
floor guard never had to stop an action. The fleet came through the 12 hours
intact at 25 / 12 / 5 / 20, still 62.

Every publish wrote three facts to a ledger: what the client meant to send, what
the API returned, and what each required reader actually observed. Three
separate truths, so a stranded write is never confused with a reader who was
simply offline.

## The result

Of **23,180 publishes, 10,735 reached every required reader**. 46%. More than
half of all publishes left at least one reader who never saw the message.

Counted as individual required-reader deliveries, the workload owed 134,779 of
them. They landed like this:

| outcome | count | share |
|---|---|---|
| live | 104,256 | 77.4% |
| late | 6,418 | 4.8% |
| eventual-replay | 26 | 0.02% |
| **missing** | **24,079** | **17.9%** |

The 24,079 missing are the hard number. A reader that was down when a message
went out shows up as eventual-replay, not missing — so these are deliveries that
never arrived by any path, replay included. Nearly one in five.

For the deliveries that did land, the median was **835ms**. The tail was not:
p95 139 seconds, p99 50 minutes, worst case 5.9 hours. 10,315 deliveries took
longer than ten seconds.

The detectors, on top of the missing writes: 1,414 stale pulls, 178 replay
gaps, 214 foreign replays, 99 churn-correlated events, and the 6,418 late
propagations above. 25,885 findings at fail severity, 6,418 at warn.

## Representativeness

The gate for a valid baseline is two failures of different kinds: at least one
addressing or root failure, and at least one watch, replay, or churn failure. A
run that only reproduces one kind can't stand in for production, which shows
both.

Arm A has 24,079 stranded writes for the first, and replay gaps, stale pulls,
and churn-correlated events for the second. The gate is met, and not narrowly.
This is a baseline Arm B can be measured against.

## How it degrades

Does the loss build, level off, or wander? Binned into 15-minute buckets across
the 12 hours, the stranded writes hold a flat band — roughly 500 a bucket, noisy
between 350 and 820, settling lower and steadier in the last four hours. The
loss is a leak at a constant rate, not a storm that feeds itself.

This is the opposite of the eviction storm in #51, where deaf write-flights grew
from 16 an hour to 470 and took the mesh down with them. That mechanism was
fixed in 4.62.2, and its absence shows here. What remains on 4.68.2 with the
stack off is endemic stranding, a drain the network sustains without healing or
spiralling.

The kill rounds left no mark on the curve, and the largest stranded spike landed
in an interval with no churn at all. The stranding is a property of the network,
not a reaction to the churn. So Arm B, if the stack works, closes a steady
drain. It is not asked to survive a shock.

One caveat on the early hump. Late propagations concentrate in the first two
hours and fall to zero by hour eight. Some of that is mesh warm-up settling.
Some is the finite window: a message published near the end has no time to
arrive late before the ledger closes, so it scores as stranded instead. The
back-third late-rate is higher than zero; the run cannot see it.

## The connection sets held

The stack the two arms compare exists partly to keep a node's connection set
full. So did the sets erode? For the relays, no. Sampled across all three hosts
over the 12 hours, `bound < open` — a connection open but not yet bound — showed
up at 0.03% to 0.16% of the one-second heartbeats, and the widest gap was 6
connections out of 40 to 70. Transient, never widening. No relay dropped below
20 peers, none isolated, none collapsed. The relays that stopped were the ones
churn rolled or killed, and their replacements rejoined. The never-bind storm
from the earlier conn-decay work did not recur; the 4.68.2 fixes held.

This is a measurement of the relays, not the participants. The harness logged
`channels: null`; it never counted the participant side. So the weaker,
participant-class nodes the stack most directly protects — the background-tab
case in #55 — are the ones this run cannot see.

That reframes the 24,079 stranded writes. They did not happen because relays
lost their connections; the relay mesh was full and stable throughout. The
stranding is either participant-side decay the harness missed or a routing
failure on a healthy mesh, and this run cannot separate the two. The fix is in
the harness: Arm B has to record the participants' connection sets, or the two
arms are compared blind to the one thing the stack most changes.

## Present from the first minute

The two shapes together point one way. The stranding is flat from the first
bucket — 385 losses in the opening 15 minutes, on a mesh whose connection sets
were already full — and it never builds. A failure present at minute one, on a
healthy mesh, is not degradation and not a connection-set problem. It is an
addressing failure: a publish that reaches a root the reader is not under, or a
subscribe that never rooted the reader where the publisher writes.

The connection-quality stack maintains the connection set. This fault sits above
the connection set, in who-roots-what. So the prediction for the short reruns is
that Arm B strands about as much as Arm A. The stack is a good thing. It is
aimed somewhere else.

## What this is not

This is not evidence the stack works. Arm A is the stack off. It shows the
failures are present and heavy when the network runs the way it runs today. The
claim — that the connection-quality stack removes them — is Arm B: the same
seed, the same churn schedule, the same topic map and payloads, the stack on.
Only the difference between the two arms is attributable to the stack, and Arm A
is half of that difference.

Nor is 17.9% a fixed property of the network. It is 17.9% under this churn, this
topic map, this fleet, on 4.68.2 with the stack off. A gentler schedule would
strand fewer; a harsher one, more. The number's job is to be the same number
Arm B runs against, not to be a universal constant.

## Next: measure more, then two short runs

The full 12-hour baseline stands. The next step is smaller and sharper: a
three-hour Arm A rerun and a three-hour Arm B rerun, back to back, with the same
enlarged instrumentation, to test whether the stack moves the stranding at all.
The prediction on the table is that it does not.

What the reruns add to the ledger:

- Participant connection sets. Each sidecar records its own open and bound
  channel count every sample — the field this run left null. This is the node
  class the stack most directly changes, and the one this run could not see.
- The routing fate of every publish. For each write: the root it targeted, the
  root the reader was under at that moment, and whether the two agree. A
  stranded write with a root mismatch is an addressing failure; one with a
  matching root is a delivery failure. Today's ledger cannot tell them apart.
- Subscription and root state per reader per topic over time: when each reader
  rooted, re-rooted, or lost its root, so a miss can be tied to a reader that
  was not rooted where the publisher wrote.

The seed, topic map, churn script, and payload manifest stay fixed, so the two
short runs and the long baseline replay the same workload. The latency threshold
freezes before Arm B, and the baseline's p99 of 50 minutes is what the
provisional p99 ≤ 2500ms has to beat.

## For the council

This goes to the seats before the reruns, for an initial read, not for sign-off.
Two questions:

- What else should the reruns measure? The list above is ours. The stranding is
  present from the first minute on a full mesh, so the answer is likely in the
  addressing and root path — name the fields that would pin it down.
- What is the core issue? A publish reaching a root the reader is not under is
  one guess. Say where you would look first.
