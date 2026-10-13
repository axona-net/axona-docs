# Team update — soak of 2026-10-13 on kernel 4.112.0

**Status:** the alert-bot half ran the night; the connectivity half ran six daytime
cycles and was stopped by hand at 17:01Z when it began to cost the fleet. The second
alert-bot run is still going (hourly to about 21:16Z) and this note will be amended
with its last cycles.

## What was tested

Does every relay reach every other relay, and does the alert-bot suite deliver, hour
after hour, on the fleet as deployed? Fleet: kernel 4.112.0 / relay 0.156.0 / bridge
2.159.0 on 51 relays (Air 6, M1 8, Linux 5, Windows 20, four one-core droplets with
3 each) and two bridges. Nothing was added to production; the relays themselves were
the senders.

Two loops, each bounded on its own host by a cycle count and a hard deadline:

- **Alert-bot (Howard's suite)** on the Linux box: every hour, `basic-mainnet-check`
  (92 topics, 260 publications) then `basic-mainnet-diagnostics`, through the same
  wrapper scripts used for the 4.112.0 promotion readings (no portals, kill cache set
  aside). Run 1: ten cycles, 05:33Z to 14:38Z. Run 2: from 16:16Z, twenty minutes
  after each probe cycle.
- **Connectivity (the relay probe matrix)** from this Mac: every hour, a census of
  every running relay's current id, then every relay walks a routed request to every
  id in the census, two samples at 40 ms, and writes its rows beside the request.
  Bridge `/healthz` read each cycle. The Mac slept before the driver was launched, so
  this half started at 11:56Z, not overnight; it ran at 11:56, 12:56, 13:56, 14:56,
  15:56 and 16:56Z.

The window had two things unusual about it. The sfo3 droplet's three relays were
absent from the first four censuses (their startup banners had been vacuumed from a
capped journal) and present from the fifth. And at 16:00Z that same droplet began a
watchdog kill storm, described below, which the sixth cycle ran through.

## Results

### Connectivity, routed walks relay to relay

| cycle | start | targets | walks ok | failed, by class | targets reachable from every other sender |
|---|---|---|---|---|---|
| 1 | 11:56Z | 50 | 4962 / 5004 (99.2%) | 42 terminal | 49 of 50 |
| 2 | 12:56Z | 50 | 4863 / 4906 (99.1%) | 42 terminal, 1 exhausted | 49 of 50 |
| 3 | 13:56Z | 50 | 4939 / 5004 (98.7%) | 61 terminal, 4 exhausted | 49 of 50 |
| 4 | 14:56Z | 50 | 4942 / 5004 (98.8%) | 61 terminal, 1 exhausted | 49 of 50 |
| 5 | 15:56Z | 53 | 4807 / 5073 (94.8%) | 59 terminal, 207 exhausted | 12 of 53 |
| 6 | 16:56Z | 53 | 4519 / 4992 (90.5%) | 205 terminal, 268 exhausted | 29 of 53 |

Conditions: one sender (the Linux box's second relay) skipped the second cycle's
request; the sixth cycle had no sfo3 senders (skipped on purpose, see below). A
`terminal` walk ended at a node with no closer peer; an `exhausted` walk spent its
round budget, at a cost of 5 s each (the two-hop lookahead timeout).

In cycles 1 to 4 every failure but seven went to ONE target, the Linux box's second
relay: 42, 42, 61 and 61 senders could not reach it. That relay is alive (a log line
every second, graduated, eleven peers, two roles, no stall line) and as a sender
reached 98 of 98 targets. It is the low-degree id case from the 2026-10-08 matrix: a
node few others hold, so greedy walks end one hop short of it.

Cycle 5 is the first with the sfo3 relays as targets, and 190 of its 266 failures are
`exhausted` walks toward them, 102 from the Windows senders. Cycle 6 adds the nyc
droplets' 0x80-region relays and one Air relay to the failing targets.

### Bridges

Both bridges read `ok` with service pressure 0.05 to 0.23 (worst obligation CHILD) in
cycles 1 to 3. West read `degraded` in cycle 4 and both read `degraded` in cycle 5,
each time with worst obligation ROOT at 48 to 59 s of age and zero refusals. That is
the ROOT-deadline artefact (council 11a8c5d5), caught live: the fix on kernel branch
`root-deadline` reads those same moments at 0.27 to 0.33. The reading says nothing
about delivery and was not treated as such.

### Alert-bot, run 1 (overnight, 05:33Z to 14:38Z)

| cycle | check (of 92 topics / 260 publications) | diagnostics (of 260) |
|---|---|---|
| 1 to 6 (05:33 to 10:33Z) | 0 mismatched | 0 mismatched |
| 7 (11:33Z) | 49 mismatched, 21 differing between run 1 and run 2 | 0 |
| 8 (12:33Z) | 23 mismatched, all 23 differing between runs | 0 |
| 9, 10 (13:33, 14:33Z) | 0 | 0 |

Every run exited 0 with zero `found:false`. The 49 failures at 11:33Z were all
region-128 topics ("published 2 but received 0 and 0"). Nothing of ours ran at that
hour: the Mac was asleep and the probe driver not yet started. The sfo3 journal shows
no stall line between 05:00Z and 16:00Z. The cause of cycles 7 and 8 is not known.

### Alert-bot, run 2 (from 16:16Z, ongoing)

Cycle 1 (16:16 to 16:31Z): check 89 of 260 mismatched (29 differing between runs),
diagnostics 83 of 260 (40 differing), all region 128, 59 of them "received 0 and 0".
This cycle ran inside the sfo3 kill storm. Later cycles will be added here.

## What we learned

**The sfo3 droplet cannot carry three relays and any extra load.** One core, about
half of it stolen by the hypervisor, CPU pressure 99.8% through the afternoon. Its
first watchdog near-miss came at 16:00:13Z, two minutes after the fifth probe
request; the watchdog killed each of its three relays between 16:22Z and 16:36Z, one
of them twice, and systemd restarted each. The restarted relays came up holding
hundreds of roles (474 and 275 read at 16:58Z) and kept missing 15 to 20 beats.

**A restarted relay replays every old probe request.** The probe worker remembers
"already ran" by a file named with the relay's own id; a restarted relay has a new id
and no memory, so it re-ran all thirteen request files still in the directory, one
after another, on a host already at 100%. Each kill made the next. This is a defect in
the measurement tool, not the kernel. Fix owed: a request older than its own TTL is
ignored and marked done. Until then, old request files are deleted before any restart.

**The 0x80 region is thin.** On every nyc droplet exactly one of the three relays
stalls, and it is the one whose id sits in region 128; its two 0x89 siblings hold one
to six roles each and never stall. Twelve relays serve region 128 (six on one-core
droplets, six on the Air) against the alert-bot's 92 topics and whatever else lands
there. When sfo3's three died, their roles fell on the other 0x80 relays (one on nyc3
read 1009 roles) and those began to stall too, in two bursts: 16:21 to 16:26Z with the
sfo3 kills, and 16:55 to 17:00Z with the sixth probe request. The driver was stopped
at 17:01Z and CPU pressure on the nyc droplets fell from 99% to 40 to 71% within
minutes.

**Two findings stand on their own.** One relay on the Linux box is unreachable from
most of the fleet by construction of its id, not by any fault; it cost about 1% of
walks in every cycle. And the bridges' `degraded` readings this week are the ROOT
deadline, not delivery.

**What the overnight run says.** Eight of ten hourly alert-bot cycles were clean on
both suites, including the hour-later readings that followed the 4.112.0 promotion.
The two dirty cycles were region 128 only and happened with nothing of ours running;
they are unexplained and should not be folded into the sfo3 story without evidence.

## Actions

- **David's decision, open:** sfo3 (resize, move two of its three relays, or accept a
  host that kills its relays under load), and the 0x80 region's relay count and host
  size relative to its topic load. No fleet change was made by the bot.
- **Owed, on David's word:** the probe worker's request TTL, on a relay branch with a
  fence. The facility stays unused until then except with a clean request directory.
- **Done, instrument only:** stale request files removed from all eight hosts; a
  skip list for hosts that must shed measurement work (sfo3 on it); the census tool
  reads a vacuumed-journal relay's id from its own probe files completed by the
  bridge's connection table.
- **Not blocking:** the ROOT-deadline release (branch `root-deadline`, 4.113.0) is
  independent of all of this and waits on David.
- **Next measurement:** when sfo3 is resized or relieved, one more hourly matrix day
  with a clean request directory, and the alert-bot loop beside it, to read region
  128 with its roots settled.

Results on disk: `ops/soak-20261013T115653Z/` (per cycle: census, rows, fold, bridge
JSON) on the ops Mac; `~/tests/soak-howard-20261013T051315Z/` and
`~/tests/soak-howard-20261013T150848Z/` on the Linux box. Node ids stay there.
