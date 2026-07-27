# Saturation and Admission — a node must be able to say "no"

**v0.4 · 2026-07-27 · kernel 4.45.0 on prod · status: DESIGN, nothing implemented**

## The one-sentence version

An Axona node currently accepts every role it is handed, caches without a global
ceiling, evicts history silently, and can never decline — so the only way it
expresses saturation is by getting slower until its neighbours give up on it.

---

## 1. What we found, and how

Live prod, 2026-07-27 ~02:00 UTC, kernel 4.45.0, nine relays across three
961 MB droplets.

| Droplet | RAM used | Largest relay RSS | Relay roles |
|---|---|---|---|
| sfo3 `143.110.224.247` | 858 / 961 MB | 215 MB | 325 · 516 · 431 |
| nyc3 `167.71.106.63` | 822 / 961 MB | **367 MB** | 237 (2 silent) |
| tor1 `159.203.46.28` | 886 / 961 MB | **352 MB** | 523 (2 silent) |

All three boxes at **86–92 % memory**. Simultaneously, **four of nine relays
emitted no status line for five minutes** and a fifth reported `state=stale`,
while systemd showed all nine `running`. The two silent-heavy droplets are the
ones carrying the largest role counts.

That combination — high memory, high role count, alive-but-not-reporting — is
what a thrashing node looks like from outside. We are not claiming proof of
GC thrash here; we are claiming the system has **no way to distinguish** a node
that is thinking from a node that is drowning, and no way for the node itself to
say which it is.

---

## 2. Four defects, each verified in code

### 2.1 The cache ceiling is per-ROLE but documented as per-RELAY

```js
export const CACHE_MAX   = 1024;              // messages cached per relay   <-- comment
export const CACHE_BYTES = 16 * 1024 * 1024;  // byte ceiling on a relay's cache
```

Enforcement, `topicStore.js _cachePush`:

```js
while (role.cache.length > this._cacheMax || role.cacheBytes > this._cacheBytes) {
```

`role.cache`, `role.cacheBytes` — **per role.** On a relay holding 523 roles the
documented 16 MB ceiling is really 523 × 16 MB. **A relay has no global cache
bound at all.** On a 961 MB box, forty saturated roles exhaust the machine.

The comment is not a nitpick: it is the number a reader budgets capacity from.

### 2.2 Eviction is silent

```js
const old = role.cache.shift();
role.cacheIds.delete(old.msgId);
```

No log, no counter, no metric. A root that has evicted serves a truncated
`since:'all'` **that is indistinguishable from "never published"** to the
subscriber. This is the same failure shape as the handoff ack we fixed in
4.45.0 (#402): a loss with no signal. We fixed the ack because a confirmation
must mean something; eviction deserves the same treatment.

*Scope note:* this does NOT explain the alert-bot partials. 102 publications
across 53 topics is ~2 per topic — three orders of magnitude below `CACHE_MAX`.
The cache is a real defect; it is not that defect. Recorded so it does not
become the next comfortable theory.

### 2.3 A node can never refuse a role

There is no cap on `axonRoles.size` anywhere in the kernel. `_becomeRoot()` is
called unconditionally from **five** sites (v0.1 of this doc said three — wrong,
corrected by re-reading):

| Site | `why` |
|---|---|
| `wireHandlers.js:101` | `sub-terminal` — a SUB terminates here |
| `wireHandlers.js:265` | `pub-terminal` — a PUB terminates here |
| `wireHandlers.js:662` | `kill-terminal` |
| `wireHandlers.js:772` | `metricson-terminal` |
| `syncEngine.js:165` | `handoff-heir` — a HANDOFF arrives |

The only refusal in the whole surface is regional (`host-refused-foreign-region`).
Capacity handling exists for **subscribers** — `MAX_DIRECT = 20`, then delegate
to a child (`wireHandlers.js:162`) — but nothing equivalent for **roles**.

Note the asymmetry already in the tree: `repairPlane.js` comments talk about
routing *around* nodes that are "degraded / overloaded", so the **reader** side
already believes overloaded nodes exist. The overloaded node just has no way to
**say so**. Readers infer it from silence.

### 2.4 A bridge still becomes a root

`bridge_directory.js` carries this comment:

> REMOVED 2026-07-25 — the bridge used to host() this topic … the topic no
> longer needs an exception to the address rule.

`host()` was removed deliberately, to honour the address rule. But a few lines
later:

```js
for (const r of bridgeRegions()) subs.push(await peer.sub(topicIn(r), ...))
```

and `sub()` self-roots (2.3 above). **Removing `host()` closed one of two doors.**
`src/server.js:768` iterates `axon.axonRoles` for healthz, so the bridge peer
demonstrably carries a role map.

A bridge is a bridge: transport and introduction. It should not hold topic
roots — it is the one node in the system whose failure is least tolerable and
whose address should carry no keyspace obligation.

---

---

---

## D0 — ONE refusal gate, TWO reasons

*v0.3, 2026-07-27. David: "both of those should refuse new roles if necessary."
v0.2 had these as separate mechanisms — grace for the newcomer, saturation for
the loaded node. That was a structural mistake. They are two reasons for the
same decision and they share one gate, one decline path, and one floor.*

```js
// AxonaManager — the ONLY place that decides whether a role may be taken.
// TWO TIERS. The floor (below) may override SOFT refusals and must NEVER
// override HARD ones.
canAcceptRole() {
  // ── HARD: categorical. Not capacity. The floor cannot override these. ──
  if (this.isBridge)              return { ok:false, why:'bridge',         hard:true };
  if (!this.inRegion(topicBig))   return { ok:false, why:'foreign-region', hard:true };

  // ── SOFT: situational. Self-declared, temporary, floor-overridable. ──
  if (!this.seated())             return { ok:false, why:'not-seated',     hard:false };
  if (this.saturated())           return { ok:false, why:'saturated',      hard:false };

  return { ok:true };
}

// NOT YET — a joining node transports at once, manages nothing until it is in.
seated() {
  return (this._now() - this._joinedAt) >= ROLE_GRACE_MS   // 60-120 s
      && this.state === 'open'
      && this.openMeshChannels() >= 1;   // OPEN, not merely bound. Tonight's
}                                        // locked-out relays are 0 open / 58 bound.

// NOT ANY MORE — self-declared, self-limiting, can only ever hold LESS.
saturated() {
  return this.axonRoles.size   >= MAX_ROLES
      || this.cacheBytesTotal  >= RELAY_CACHE_BYTES
      || this.ingestQueueDepth >= INGEST_QUEUE_MAX * 0.75;
}
```

### Three reasons, two tiers

| Reason | Tier | Says |
|---|---|---|
| `bridge` | HARD | **not ever** — a bridge is a bridge: transport and introduction |
| `foreign-region` | HARD | **not here** — the address rule; already enforced today |
| `not-seated` | soft | **not yet** — still integrating; carries traffic, manages nothing |
| `saturated` | soft | **not any more** — full |

`foreign-region` is not new. `AxonaManager.js:387` already logs
`host-refused-foreign-region`, which is the only refusal in the kernel today.
Folding it in is a move, not an invention — and it establishes that hard
refusals already exist and are already respected.

**Why the bridge must be HARD.** A soft bridge refusal would be overridden by
the floor the first time every candidate in a neighbourhood was busy — quietly,
under exactly the load where the bridge is least able to afford it, and with the
`admitted-despite` line making it look intentional. The bridge is the one node
whose failure is least tolerable; its address must carry no keyspace obligation
at any pressure. `host()` was removed on 2026-07-25 for this reason and `sub()`
kept rooting anyway (see 2.4) — a soft tier would reopen that door on a timer.

Both branches are refusals of *new* roles. Neither ever sheds what the node
already promised — a node that drops held roles under pressure is a node whose
acks cannot be trusted, which is the #402 lesson.

### One decline path

All five `_becomeRoot` sites consult `canAcceptRole()`. Declining is not
dropping, and the per-site semantics are identical whichever reason fired:

| `why` | Decline behaviour | Risk if wrong |
|---|---|---|
| `sub-terminal` | re-route the SUB onward to the next-closest node | subscriber never attaches |
| `pub-terminal` | **forward the PUB toward the real root — never swallow it** | **message loss** |
| `handoff-heir` | refuse; the leaver picks another heir | last copy dropped |
| `kill-terminal` | forward the kill | tombstone lost, killed msg resurrects |
| `metricson-terminal` | forward or no-op | cosmetic only |

`pub-terminal` is the dangerous one: a node that declines to root a publish with
nowhere to forward it has destroyed the message.

### One floor — and it must ship in the same commit

If EVERY candidate refuses, nobody roots and the topic has no root. Both reasons
can do this, in different ways, and both happened tonight:

* **all not-seated** — a fleet-wide restart puts every relay in grace at once
* **all saturated** — 9 relays at 400-700 roles each on 961 MB boxes

So: when no candidate with a SOFT refusal remains, **accept anyway and log
`admitted-despite { why, roles, cacheBytes }`** — soft only. A node whose refusal
is HARD is never a fallback candidate, however desperate the neighbourhood: if
every remaining node is a bridge or out-of-region, the correct outcome is an
unrooted topic and a loud log, not a bridge quietly taking a root. Mirrors `wireHandlers.js:174`
seating a subscriber over capacity. The log line is what turns a silent overload
into a visible one — refusing everywhere without it is a partition we could not
diagnose.

### One declaration

`canAcceptRole()`'s verdict rides the existing liveness beacon — no new round
trip. Heir selection and cohort spray in `repairPlane` skip candidates that
declare either reason, walking on to the next-closest willing node. This is what
makes refusal useful rather than merely polite: today a refused node still gets
picked again immediately, because the chooser cannot see the refusal.

### Why the address rule survives this

Both reasons are properties of the node's OWN state, self-declared and
self-limiting, and can only ever cause a node to hold LESS. Neither can be used
to ACQUIRE a role — only to decline one. Skipping a refusing node is therefore
not a privilege granted to anybody; it is the chooser respecting an honest
"cannot". That keeps it outside the class of thing the address rule forbids.


## 3. Design

### D1 — Saturation is a first-class, declared state

A node computes its own saturation from what it actually holds:

```
saturation = max( roles / MAX_ROLES,
                  cacheBytesTotal / RELAY_CACHE_BYTES,
                  ingestQueueDepth / INGEST_QUEUE_MAX )
```

`cacheBytesTotal` is the **new global** figure from D2. Saturation is published
in the same beacon that already advertises liveness — it costs no new round trip.

Three bands, and the middle one matters most:

| Band | Meaning | Behaviour |
|---|---|---|
| `< 0.75` | healthy | accepts roles normally |
| `0.75 – 1.0` | **strained** | serves everything it holds; accepts NO new roles |
| `≥ 1.0` | saturated | refuses new roles, sheds coldest roles to the cohort |

The strained band exists so a node degrades by **declining growth**, not by
dropping what it already promised. A node that sheds under pressure is a node
whose acks cannot be trusted — the lesson from #402.

### D2 — A relay-wide cache ceiling, and observable eviction

Add `RELAY_CACHE_BYTES` (global, e.g. 256 MB — well under a 961 MB box with
three relays) enforced across all roles, evicting from the **coldest role**
first rather than uniformly. Keep the per-role bound as a fairness cap so one
hot topic cannot starve the rest.

Every eviction emits `cache-evicted { topic, msgs, bytes, reason }`. A root that
has evicted must also **say so on replay**: a `since:'all'` answer needs a
`truncatedFrom` marker so a subscriber can tell "this is all there was" from
"this is all I still have". Silent truncation of history is the durability
equivalent of a lying ack.

### D3 — MAX_ROLES, and healing that respects it

Cap roles per node. Given the observed numbers — 523 roles at 352 MB RSS on a
961 MB box, three relays per box — a first cut of **MAX_ROLES ≈ 150** keeps a
relay near 100 MB and a droplet near a third of its RAM. To be validated in
dht-sim before it ships, not chosen by arithmetic alone.

The consequence that matters is in the repair plane: **heir selection and
cohort spray must skip strained/saturated candidates.** Today `findKClosest`
returns addresses; it must return addresses *with* saturation, and the repair
plane must walk past a saturated node to the next-closest willing one.

This is a genuine tension with the address rule, and it should be stated rather
than smoothed over. The address rule says hosting is decided by ADDRESS, never
by ownership or preference. Skipping saturated nodes is a preference. The
reconciliation: saturation is a **property of the node's own state**, not a
privilege granted to it, it is self-declared and self-limiting, and it can only
ever cause a node to hold *less*. It cannot be used to acquire a role, only to
decline one. That keeps it outside the class of thing the address rule forbids —
but it is close enough to the line that it needs a written justification, which
is this paragraph.

### D4 — A bridge holds no roles

The bridge's embedded peer must not root. Two options:

1. **A read-only subscribe** — `peer.watch()` semantics: receive without becoming
   a terminal root. Requires a kernel affordance that does not exist today.
2. **The bridge does not subscribe at all** — it learns the directory from the
   relays that already host it, over the same path any client uses.

Option 2 is smaller and more honest to "a bridge is a bridge". Option 1 is more
generally useful (any observer that wants delivery without obligation). Decide
before implementing; do not add both.

Either way, add a **fence test**: the bridge's `axonRoles` map must be empty
after a full bring-up and a directory cycle. The 2026-07-25 `host()` removal
failed precisely because nothing checked the outcome — only the intent.

---

## 4. Sequencing

0. **D0 role-admission grace** — smallest change, fixes the observed incident,
   and reuses an existing guard. Needs the `admitted-in-grace` floor in the same
   commit, or a fleet restart partitions the network.
1. **D2 observability** — `cache-evicted` + the global byte counter. It is
   the cheapest change and it tells us whether eviction is actually happening in
   the field. Everything else is guesswork until we can see it.
2. **D4 bridge fence** — small, isolated, verifiable, and it removes load from
   the node least able to afford it.
3. **D1 saturation beacon** — declaration only, nobody acts on it yet. Watch what
   the fleet reports for a day.
4. **D3 MAX_ROLES + skip-saturated** — last, because it changes topology under
   churn, and that is the change most likely to produce a 4.24.0-style regression.

Nothing here is implemented. The measurements above were taken on a degraded
prod at 02:00; the numbers are real but the field was not healthy, and the
`MAX_ROLES` figure in particular is a starting hypothesis for dht-sim, not a
value to ship.

## 5. Open questions

- Does saturation belong in the beacon, or in the routing table entry? Beacon is
  cheaper; table entry is fresher at the moment of heir selection.
- What happens when **every** candidate in a neighbourhood is saturated? Refusing
  everywhere is a partition. There must be a floor — probably "accept anyway and
  log `admitted-over-capacity`", the same shape as `wireHandlers.js:174` already
  uses for subscribers.
- Should `MAX_ROLES` be static, or derived from observed memory headroom? Static
  is predictable; derived survives heterogeneous hardware (a 961 MB droplet and a
  laptop should not carry the same load).
