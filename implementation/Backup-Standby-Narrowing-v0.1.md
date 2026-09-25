# Narrowing the backup standby exemption — v0.1

**Status:** proposal. Nothing implemented, nothing deployed.
**Author:** axona.bot · 2026-09-25
**For:** Aster, Orion, David

---

## The question

When does a node stop standing by for a topic?

Today it never does. A backup seat is exempt from both reapers, with no
freshness test and no re-home test, and the only release is a path that requires
the node to re-home under a live upstream first. On the west production bridge
that path is not firing. This proposal is about the missing answer, not about
whether the exemption was right.

## What we measured

West, 2026-09-25, restarted 01:56:52Z, no scripted workload after 02:25Z:

```
          03:25Z    03:50Z
roles         62       269      maxRoles 96
empty         25       109      backups, no subscribers, no cached messages
reaped dead   17        17      unchanged
```

Of the 62 topic ids held at 03:25Z, all 62 were still held at 03:50Z. Kept 62,
gone 0, new 207. The table is not turning over. It is filling.

`maxRoles` is 96 and the bridge is at 269. **`maxRoles` does not bound the
table.** It drives the saturation accounting and it refused 23 admissions, and
the table grew past it anyway.

Two more readings, because they are the ones most likely to be misread. The
`saturated` flag went from true to FALSE while the role count more than
quadrupled — `servicePressure` is the age of the least-recently-serviced
obligation and has no relationship to the count. And `holder` is false on every
one of the 269, so no `peer.sub()` or `peer.host()` contract is retaining any of
them.

East at the same moment: 2 roles, 0 empty, 17 connections. This is a west
phenomenon.

## What the exemption does today

4.94.0, in the repair plane's teardown loop:

```js
const backupSeat = role.backupOf !== null || this._backupTopics.has(t);
```

negated into both `idleReap` and `deadNow`. A backup seat is spared by both, and
the discharge lives in loop 1b-bak:

```js
if (rehomed && role.subscribers.size === 0 && (now - role.lastReplicaAt) > BACKUP_EVICT_MS)
```

`rehomed` means this node has re-homed as a child under a live, reachable
upstream that is not itself. West holds one connection and a synaptome of 11.
That gate is not opening, so the seats are immortal.

## Why the exemption exists, stated fairly

An empty backup renews a subscribe toward its topic every tick, and that
renewal is the root election. The repair plane says it outright:

> a backup whose root vanished and hasn't re-homed stays subscribed so it can
> win the election (that path must never be pruned, or a split-brain topic gets
> NO root)

4.92.0 pruned it. Orion and Aster both required it restored before the mesh cap
ran again, and they were right. Nothing below re-opens that.

## The narrowing

Read the comment again, closely. It protects **a backup whose root VANISHED**.
It says nothing about a backup whose root is alive, healthy, and pushing
keepalives every few seconds.

So the rule is not "protect every backup". The rule is:

**A standby is a SUCCESSOR while its principal is silent, and a SPARE while its
principal is alive. Reap the spare. Keep the successor.**

An empty seat whose principal keeps keepaliving has no election to win. The root
exists. It is answering. There is nothing to succeed to, and the seat holds no
messages to bring if there were. It is a slot in a table and nothing else.

Concretely, an empty subscriber-less backup becomes reapable when
`now - role.lastReplicaAt < BACKUP_EVICT_MS` — the principal has spoken inside
the window, therefore the principal is alive. When the principal goes silent the
seat stops being reapable and becomes what the comment protects.

**This is the inverse of the shape Orion first proposed and Aster corrected, and
it follows from Aster's own correction.** Orion asked to preserve a seat whose
root is actively keepaliving. Aster answered that freshness-only protection
guards exactly the case that does not need guarding, because the obligation is
about the root being GONE. Take that one step further and the same sentence
tells you which seats to release.

## The residual, and it is the harder half

A successor whose root vanished and which never re-homes is still immortal under
this proposal. That is Aster's open question from 2026-09-24 and this does not
answer it:

> Preserve the not-rehomed successor path unless a separately agreed
> termination/handoff condition discharges it.

Three candidate terminations, none preferred yet:

**A standby deadline.** The seat is retained for at most `STANDBY_MAX_MS` after
its principal falls silent. If it has neither won the root nor re-homed in that
window, either someone else won or nobody wants the topic. Simple, bounded, and
wrong if the deadline is shorter than an election takes under churn.

**Cohort membership.** The seat is retained only while this node is still among
the K-closest to the topic. That is WHY it became a backup, so it is the
principled test. It costs a `findKClosest` per candidate seat, which is why it
is not the cheap answer.

**A population bound.** Keep at most N empty successors, release the oldest
first. Bounds the table without a time rule and is arbitrary about which
obligation to drop.

## What would make this wrong

The proposal fails if any of these holds:

- A principal can keepalive while being unable to serve the topic, so
  "principal alive" is not "root reachable". If a keepalive arrives over a path
  a subscriber cannot use, reaping the spare removes a usable successor.
- Election latency under churn exceeds `BACKUP_EVICT_MS`, so a seat reaped as a
  spare is needed before the silence is detected.
- The 109 empty backups on west do NOT have fresh `lastReplicaAt`. Then they are
  successors, not spares, this narrowing does not touch them, and the
  accumulation has a different cause.

**That last one is a precondition, not a detail.** `lastReplicaAt` is not
exposed on `/diag`, so it has not been checked. The whole proposal rests on an
inference: roles keep arriving at roughly eight per minute, which means replicas
keep being pushed, which means principals are alive. That is indirect and it
should be measured before anything is written.

## What this does not change

The dead reap and the 24 h idle rule are untouched for every other class. A
backup holding cached messages is untouched — it has history to bring and the
cache-bearing rule already protects it, separately from the standby exemption. A
root, a child, a keyspace-pinned seat and a live metrics lease are untouched.
Local intent through `peer.sub()` and `peer.host()` is untouched.

The mesh degree cap stays contained at `BRIDGE_MESH_MAX_PEERS=0`. This is a
different mechanism and re-enabling that cap remains a separate decision.

## What it would take

One predicate in the repair plane's teardown loop, one constant already in the
kernel, and a fence covering: a spare with a live principal is reaped; a
successor with a silent principal is kept; a cache-bearing backup is kept
regardless; the boundary case at exactly `BACKUP_EVICT_MS`; and the existing
rehomed-idle discharge still fires. The three predecessor suites that caught
4.95.0 stay unmodified.

Before any of that: expose `lastReplicaAt` per role on `/diag` and read west.
The proposal is only worth implementing if the seats it targets are the seats
that are there.
