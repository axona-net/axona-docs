# The storm — nine hours of silent write loss, and what was underneath it

**Written:** 2026-09-11, after resolution.
**Supersedes the live account** in `NOTE-council-2026-09-09-council-write-loss.md`,
which was written while the fault was open and got several things wrong. That
note is kept as-is; this one is the settled version.

What makes a topic stop accepting writes while it keeps serving reads perfectly?
That is the question this incident answers, and the answer is not the one we
started with.

---

## 1. What happened

Between **2026-09-09 14:50:18 EDT and 2026-09-10 00:33:27 EDT** — nine hours and
forty-three minutes — the `#council` topic accepted nothing. `#jokes` and
`#general` behaved the same way over overlapping windows.

The failure had a specific and dangerous shape:

- **Publishes returned success.** `ok:true` with a msgId, every time.
- **Reads were perfect throughout.** Complete topics, correct order, to every
  reader, at normal latency.
- **No error was emitted anywhere** — not by the publisher, the relays, the
  bridge, or the reader.

Four council seats had a channel that looked healthy from both ends and moved
nothing. It was found only because one message was checked after posting.

### What was established, by control

| ruled out | how |
|---|---|
| message content, msgId dedup | a short unique message failed identically |
| message size | the same 6,496-char body landed on another topic |
| stale kernel on the publisher | restarted the MCP peer onto 4.84.0; unchanged |
| the publisher's mesh seat | reconnected to 60 peers; unchanged |
| topic write policy | `council` resolves `write:open, owner:null` |
| the topicId derivation | computed under 4.82.0 and 4.84.0 — byte-identical |
| a wire-version partition | `WIRE_VERSION` unchanged at 4.0 across the window |

### What the fleet looked like underneath

Measured on the droplet backbone while the fault was open:

    every relay, every host   20-32 evictions per 10 min
                              (pc-closed / pong-timeout / peer-departed-hint)
    tor1/useast               peers=13  mesh(open/bound)=2/12   roles=65
                              later: peers=19  mesh(open/bound)=0/18  roles=62
                              145 root-transitions in 5 min
                              terminal-promote 67 · verify-closer 40
                              · beacon-closer 35
    routed outcomes           ok:21 failed:82 · ok:0 failed:22

A relay bonded to eighteen peers with **zero** open channels, holding 62 roles,
re-crowning itself root roughly every two seconds. A one-shot PUB routed to a
root that had already moved, or over a channel that was bound and never open.
Reads survived because they are answered from caches that already hold the data.

---

## 2. What I believe caused it

Three things, and they are not equally certain. I have separated them because
this incident produced six wrong mechanism claims from me, and the council
fenced most of them.

### CONFIRMED — a region misconfiguration concentrated the entire workload

Every topic this project uses is **eagle** (0x89): council `898be2a9`, jokes
`894226`, general `89f58f`. A relay in any other region is idle by construction.

The droplet systemd template sets `Environment=RELAY_REGION=%i` — **the instance
name IS the region.** The instance names are geography, and the kernel resolves
them anyway, silently:

    useast   -> 0x89 eagle          uswest   -> 0x80 grizzly
    uscentlw -> 0x87                grizzly1 -> does not resolve

Nobody chose that mapping. It fell out of the naming. The consequence is exact:
**`useast` was the only eagle relay on each droplet**, so it absorbed that box's
entire share of the workload while its two siblings sat at `roles=0` with
near-perfect channels. That is why the sick relay was `useast` on all three
hosts, every time we looked, for the whole incident.

The same fault at larger scale: **m1's eight relays were in grizzly**, holding
0-1 roles all night. I read that as "uneven distribution" for hours. It was not
uneven. Before the fix, **14 of 48 relays — 29% of the fleet — were in a region
carrying no traffic at all.**

This is confirmed: the mapping is reproducible from the kernel's resolver, and
the region each relay joined is printed in its own startup banner.

### CONFIRMED — nothing in the system rebalances roles, and nothing sheds them

`saturated()` gates `canAcceptRole()` and **nothing else**. A node that becomes
unfit while holding roles keeps holding them, because no code revisits that
decision. Ownership is decided by XOR distance to the topicId, verified
origin-independently — and never re-examined against whether the owner can still
be reached. **Closest is not reachable.**

Measured directly: five axona-linux relays holding **900 roles between them**
while each could see 4-7 peers. One held 295 roles on five peers. `MAX_ROLES` is
96; the only hard backstop is `roles >= maxRoles * 8` (768), so that state is
legal by design.

Every one of those five read `saturated: true` — the one existing rung was
firing correctly and changed nothing, because there is nothing below it.

And `helloPressure` was **0** with `tickLagMax` of **1 ms** on all five. They
were failing while completely idle. The capacity telemetry we act on measures
whether a node can KEEP UP; it cannot see whether a node can REACH anyone.

### PROBABLE, NOT ISOLATED — churn was the trigger

In the seven hours around the cutoff: **three full fleet rolls** (14:49, 16:14,
22:03), **two bridge redeployments**, and a **twenty-relay Windows rebuild** — on
a backbone already thinned from six relays to four. Every relay restarted three
times; the Windows twenty, four.

The correlation is tight: the last council message landed **50 seconds after the
first roll began**.

It is not proven. Our roll gate asks each relay "are you open?" and never asks
the fleet "are you settled?", so every gate passed while the fleet re-homed into
the next operation. That is a real hole regardless of whether it caused this.
But per Aster (`863d3d7a`), a settle gate that WOULD have refused those rolls has
to be replayed against explicit thresholds before that is stated as fact.

**The churn was mine.**

### Why the three combine

A fleet with one eagle relay per droplet has no slack in the region that matters.
Churn displaces roles; they re-elect onto whichever node is closest by XOR,
regardless of fitness; that node cannot shed them or refuse them once held; it
degrades; its topics stop accepting writes while its caches keep answering
reads. The region fault made the target small, the missing shed made the damage
permanent, and the churn pulled the trigger.

---

## 3. What was done

Every action below was on David's explicit instruction.

**During the outage**

1. **Droplets 4 → 3 relays, one host at a time.** A zero-role unit (`uscentlw`)
   stopped and disabled per host first, so no roles were dumped into a churning
   fleet. Load 9.63 → 4.89 and 11.71 → 5.81 on the two worst hosts; root
   transitions to zero on seven of nine relays. **Writes resumed immediately** —
   a publish landed and an independent peer read it back in 223 ms.

   CAVEAT: this changed the relay count AND restarted every process. A restart
   alone rebuilds every connection and would also clear bound-not-open channels,
   so "the fourth relay was the problem" is unproven.

**After**

2. **Windows fleet rebuilt**, 20/20, after the first attempt aborted on a GH #61
   wedge at slot 6 — bound peers, completed mesh auth, then stopped logging for
   27 minutes. Retry loop cleared it; second attempt went straight through.
3. **axona-linux fully restarted, one relay at a time** — stop-then-start, not a
   roll. This is the distinction that matters: a graceful roll pre-starts an heir
   which ADOPTS the departing relay's roles, so nothing moves. A genuine restart
   releases them for re-election. **536 roles left the host**; load 6.85 → 2.56;
   peers 4-7 → 6-28.
4. **Individual restarts** of `tor1/useast` and `nyc3/useast`.
5. **m1 moved grizzly → eagle** and rolled, confirmed by each relay's banner.
6. **Droplet `uswest` moved to eagle** on all three hosts via explicit
   `region.conf` drop-ins. One grizzly relay per droplet kept deliberately —
   region is a placement hint, but a region with zero nodes has nowhere to hint
   to. **Eagle capacity 34 → 45 relays.**
7. **Droplet config versioned** (`axona-relay/deploy/droplet/`) — template,
   drop-ins, an installer with a dry run, and a README. Captured FROM the live
   hosts, not written from intent; all three were byte-identical and the dry run
   showed comment-only differences.
8. **Six running-but-disabled units enabled.** All three droplets had `useast`
   and `uswest` running but not enabled — started by hand, never wired to boot,
   predating this incident. **A reboot would have returned one grizzly relay per
   host and nothing would have reported the loss.**

**Instrument fixes forced by the investigation**

9. `relay-census.sh` — counted phantom relays from any caller whose command line
   mentioned the pattern. Now keyed on the executable (`args[0]`), with a
   self-test. My first fix was worse than the bug: an accept-list on `comm`
   counted ZERO on Linux, because node renames its main thread to `MainThread`.
10. `install-units.sh` — an unbounded `journalctl -u <unit>` in a courtesy line
    turned a four-file install into seven minutes. Bounded: 7+ min → 45s and 14s.
11. relay `0.127.0` (deployed just before the incident closed) — the health-dump
    emitted placeholders instead of data on any relay seating 27+ roles, so the
    instrument went blind on exactly the nodes that mattered, for the entire
    period in which the fault appeared.

---

## 4. Current state

    kernel 4.84.0 · relay 0.127.0 · bridge 2.124.0 · chat 0.61.0 · share 0.27.0
    48 relays — eagle 45 · grizzly 3
    droplets 3 x 3, all units enabled, region explicit and versioned

Writes verified from a seated peer; council live and active. The droplet config
is installed and verified identically on all three hosts at `0959a66`.

**Still wrong, and unexplained:**

- **Role concentration persists.** After redistribution, axona-linux still holds
  368 roles across five relays. Nothing rebalances; roles move only when a holder
  dies ungracefully.
- **Synaptome sizes are wildly uneven and I cannot explain it.** On a 48-relay
  fleet, some relays see 28-40 peers and others see 4-10, and the low ones are
  consistently the ones holding roles. Cause unknown. This may be the most
  important open thread in the incident.
- **A cold peer still cannot write to a warm topic.** Pre-existing, documented,
  and it invalidated one of my controls: I claimed "two unrelated peers cannot
  write" removed every property of my peer from the picture. The second peer was
  cold, and cold peers fail this way by design.
- **GH #61 (the wedge) is open** and fired again during the Windows rebuild.
- **GH #60 remains open.**

---

## 5. What to do next

In the order I would do them.

**1. Ship the write-outcome evidence first.** `ok:true` means DISPATCHED, not
accepted. There is no acknowledgement a caller can wait on, so no application —
including the MCP publish every council seat uses — can tell a healthy channel
from a dead one. Council ratified this as a prerequisite (Aster `863d3d7a`, Vega
`fd72a683`, Orion `3f54450f`): without it we cannot establish that any later fix
protects writes. Aster's condition: **inspect the existing write-flight and ack
paths before asserting none exist** — I asserted that without looking.

**2. Make a rootless or unservable topic observable.** Roles are visible per
relay; the property that actually matters is not visible anywhere. Report the
absence of a reachable verified holder within a stated scope and deadline —
never universal absence, which is unknowable under partial observation.

**3. Node fitness as three dimensions, not one score.** Council refuted the
scalar ladder I proposed. Keep local resource capacity, channel reachability and
per-topic service progress separate, each carrying explicit `unknown` and `stale`
states. `open/bound` is reachability evidence ONLY and does not prove a topic is
servable — two working links may serve a topic while twelve open ones may not
reach its holders. Verify the numerator and denominator cover the same eligible
channel population before arming any threshold.

**4. Shedding requires a successor, never a threshold.** A node must not abdicate
because a number tripped, unless a willing, reachable successor has verifiably
adopted the specific obligation. If all neighbours are degraded, retain bounded
best-effort and expose inability — never drop the last useful copy. Refusing new
roles is necessary and NOT sufficient.

**5. A settle gate with canaries.** Our roll gate must ask the fleet, not just
the relay. Low churn is necessary and not sufficient — a frozen or partitioned
fleet is also quiet — so it needs bounded stabilization criteria PLUS a fresh
end-to-end write/read canary, version and coverage checks, and a timeout that
ABORTS rather than certifies.

**6. Explain the synaptome asymmetry.** Why does a relay on a 48-node fleet
settle at 4 peers while its neighbour on the same core settles at 40? Until that
is understood, every fix above is being designed against a symptom.

**7. Housekeeping.** Deploy the census fix to the hosts; version the droplet host
build (node, checkout, keys — `deploy/droplet/` covers units only); and add a
kernel-side refusal for an unresolvable `RELAY_REGION` rather than silently
landing in a region nobody chose.

---

## 6. What I got wrong

Recorded because the pattern matters more than the individual errors: the
measurements held up all night; the mechanisms I narrated between them did not.
Six claims, each asserted from a name or a shape without reading the path.

1. `computeMsgIdV2` folds topicId into the msgId — it has **no callers**. The
   live path is `sha256(canonicalize({publisher, message}))`, no topicId.
2. Identical msgIds across two topics proved my peer was pre-V2 — that is
   correct 4.84.0 behaviour.
3. "Isolated" size from topic by republishing an identical body to a second
   topic — same content and publisher give the same msgId, so it could only ever
   be a dedup no-op. I contaminated my own control.
4. On GH #63, that largest-first reduction keeps the census and drops `seated` —
   it is the reverse; the fence falsified it as it was written.
5. A fresh topic self-roots at the publisher — **false, and a topic-capture
   vulnerability if it were true.** David caught it. Placement is XOR distance to
   the topicId, verified origin-independently and failing closed.
6. "Two unrelated peers cannot write" as a clean control — the second was a cold
   peer, which fails warm-topic writes by design.

The census fix belongs on this list too: my first version would have reported
**zero** relays on axona-linux, which is worse than the over-count it replaced,
and it was caught only because a restart script reused the same test and found
nothing to restart.
