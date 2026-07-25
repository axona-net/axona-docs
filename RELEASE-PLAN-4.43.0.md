# Kernel 4.43.0 — what to keep, what to drop, and why

*2026-07-25. Written to decide one thing: what goes into a single 4.43.0 that ships
everywhere, so testnet and prod stop diverging.*

---

## 1. Where we actually are

| | version | what it is |
|---|---|---|
| **prod** (`origin/main`) | **4.41.0** | running on both bridges + 9 relays |
| **testnet** (local branch) | **4.39.2** | 4.39.0 baseline + two new fixes |
| **4.42.0** | tagged, deployed **nowhere** | failed its soak gate |

**The version numbers are misleading, and this is the thing to understand first.**

testnet is *ahead* of prod in git — it contains every single commit that prod has.
The "rollback to 4.39.0" was done as a **revert commit** that restored the older file
contents, not by rewinding the branch. So the history marched forward while the
version string went backwards:

```
v4.40.0 → v4.41.0 → v4.42.0 → [revert tree to 4.39.0] → 4.39.1 → 4.39.2
                                        ↑
                         this is where the 4.40/4.41/4.42 code was undone
```

Consequence: **merging testnet into main is a clean fast-forward in git, but it would
silently roll prod's behaviour back** — the revert would go out as if it were an
upgrade. Nothing warns you. That is the trap 4.43.0 exists to avoid.

---

## 2. What each version added after 4.38

| version | what it added | in testnet today? |
|---|---|---|
| **4.39.0** | `connect()` and sponsor-less `join()` self-integrate on bootstrap | ✅ baseline |
| **4.39.1** | **Address rule** — `host(topic)` refuses a topic this node isn't near | ✅ new |
| **4.39.2** | **I-ID** — transport identity never persisted (+ snapshot fix, 3 fences) | ✅ new |
| **4.40.0** | `connect()` re-framed as *the* entry point; exported from the package root | ❌ reverted |
| **4.41.0** | `metrics().publishes` became a real counter (it had always read 0) | ❌ reverted |
| **4.42.0** | mass-leaver handoff scaling · policy-table closure · closed role shape · deleted dead `unpub.js` | ❌ reverted, never shipped |

---

## 3. Keep or drop — one call each

### ✅ KEEP — the two testnet fixes (4.39.1 + 4.39.2)

Both are new, both are fenced, both are the reason we're doing this release.

- **Address rule (4.39.1)** — hosting is decided by a node's *address*, never by who
  owns the topic. Fenced by `smoke_host_address_rule.mjs`.
- **I-ID (4.39.2)** — a node's transport identity is minted fresh every start and
  written nowhere; author identity still persists. Fenced three ways, and verified
  live: two MCP peer starts produced different nodeIds and the same authorId.

### ✅ RESTORE — `metrics().publishes` (4.41.0)

**Prod is running this today.** Ship 4.43.0 without it and throughput metrics silently
return to reading 0 — the exact failure mode we spent real time chasing when metrics
were dead across all of 4.x. It is a one-line counter in `topicStore.js` plus its read
path. Small, self-contained, no interaction with anything else in this release.

### ✅ RESTORE — `connect` exported from the package root (4.40.0)

Cheap, and it removes a foot-gun. **Nothing currently breaks without it** — axona-chat
imports from the `@axona/protocol/connect.js` subpath, which works in both versions,
and I verified the subpath export and the `disconnect` return both survive on testnet.
So this is not urgent; it is just that having `connect` importable from the root is
what the docs describe, and doc/code drift is how we got here.

### ❌ DROP from 4.43.0 — everything in 4.42.0

This is the one real judgement call, and the answer is no — not because the work is
bad, but because **it never passed its gate**: scale delivery 97.7% mean / 79.2% floor,
with 5/17 scale and 3/15 churn scenarios failing. It has been deployed nowhere, so
dropping it costs us nothing that is currently running.

Folding an ungated change into the release whose entire purpose is *"get back to a
stable, testable baseline"* would defeat the release. The tag stays; it gets re-gated
on its own, against a clean 4.43.0 baseline, where a regression will actually be
attributable.

One exception worth noting: 4.42.0 also **deleted `unpub.js`** (118 lines of dead
code). That part is zero-risk. It is not worth a special case — it can ride along with
the re-gated 4.42 work.

---

## 4. The bridge directory — treat it like any other topic

**The directive:** the bridge topic is not special. It is reachable by every bridge and
every user, each bridge re-publishes its own entry roughly hourly, freshness is what
tells you a bridge is alive, and every node keeps its own persisted copy.

This settles the open question from the address rule, and it settles it cleanly.

### What is there today

`bridge_directory.js` calls `peer.host(DIRECTORY_TOPIC)` — the bridge roots its own
directory topic regardless of address. Under the 4.39.1 address rule that call starts
being **refused**. But the comment above it explains *why* it was added, and it is a
real problem, not laziness:

> the launch publish lands before peers reconnect… without this it would route into an
> empty mesh and be lost as the real region-closest roots fill in.

So the bridge was hosting its own topic to survive its own cold start.

### Why hourly re-publish fixes it properly

**A heartbeat makes a lost publish harmless.** If the entry is re-sent every hour, the
launch publish landing in an empty mesh costs nothing — the next beat repopulates it.
The ordering problem the `host()` was patching stops existing, so the patch can go.

That is the whole trade: *one hosting exception* is replaced by *one repeating publish*,
and the topic becomes ordinary.

It also buys liveness for free. Today a bridge that dies leaves a directory entry behind
with nothing to retract it. With hourly beats, **age is the health signal** — an entry
under an hour old is live, one several hours old is almost certainly gone. No tombstones,
no departure protocol, no explicit retraction to get wrong.

### What changes

| | now | after |
|---|---|---|
| hosting | bridge `host()`s the directory | **nothing hosts it specially** — it roots wherever its address lands |
| publishing | once at launch, plus on change | **every ~1h**, plus on change |
| liveness | no signal; stale entries persist | **entry age** — over an hour old ⇒ presumed offline |
| client copy | discovered book, in memory | **persisted on every node**, refreshed as beats arrive |

Persisting the directory on every node is also what lets a cold client bootstrap from
what it already knows instead of a hardcoded seed list. Note this does **not** conflict
with I-ID: a node saving *other* nodes' bridge URLs is fine — what it may never save is
its own transport identity.

### The one risk this introduces

Made ordinary, the directory inherits the ordinary requirement: **some node's address
must be near the topic id, or the topic has no root and discovery breaks.** The `host()`
was masking that.

The topic is `{ region: 'useast', name: 'axona:bridge-directory' }` — pinned to one
region. Prod runs an `axona-relay@useast` on each of the three droplets, so coverage is
probably fine, but "probably" is not good enough for the mechanism every client uses to
find the network. **Measure it before shipping:** who currently roots that topic id, and
how many distinct nodes hold it.

### Decisions — settled

**1. Multi-region.** A bridge publishes its entry to the directory topic of **every
region that already has a bridge** — eagle, and each other populated region. Not one
global topic, and not only its own.

The bootstrap is self-expanding and needs no seed list: a bridge reads the directory it
can already reach (its own region, plus whatever its persisted book holds), learns which
regions have bridges, and publishes to each. A new region joins the set the moment a
bridge lands there.

Cost is small and linear — B bridges × R regions publishes per hour. Today that's 2×2=4
an hour; even at 20 bridges across 10 regions it's ~3 a minute. **The real cost is not
traffic, it's coverage:** each region's directory topic needs a node near *its* id, so
adding regions multiplies the requirement that made step 1 a gate. Publishing into a
region with nothing near that topic id puts the entry nowhere.

**2. Region names: animal names, `useast`/`uswest` deprecated.** Verified before
planning it — `{region:'useast'}` and `{region:'eagle'}` derive **the identical topic
id** (`89e2ea650b8193b8274aa169…`). It is a pure rename over the same cells, **not** a
flag day: no topic moves, no id changes, old and new names interoperate during the
migration. The legacy names are still wired into relay service names
(`axona-relay@useast`), `MCP_REGION`, and the directory descriptor — those are the
migration surface.

**3. Bridge author key: durable.** The bridge gets a persisted author identity instead
of minting a throwaway per start, so a client can verify "this is the same bridge that
announced an hour ago" rather than trusting the URL alone. This is squarely legitimate
under I-ID — *author* is the durable half. It lives beside `bridges.json` in the bridge's
`/data` volume, and it is the **only** key a bridge persists; its transport identity
stays ephemeral.

**4. Retention: the standard 24h window, no special case, no pruning.** Correct — and
worth being precise about the mechanism, because it is append-and-expire rather than
overwrite. Each entry carries `ts: Date.now()`, so every beat is a distinct message that
accumulates and then ages out on the ordinary 24h ceiling. So:

- **the topic self-prunes** — 24 beats per bridge per region resident, then TTL evicts;
- **the node's book self-bounds** — it is keyed by bridge URL, so its size is the number
  of distinct bridges ever seen, not the number of beats.

Neither needs a pruner. One consequence to keep in view: a consumer must take the
**latest entry per URL** rather than treating every stored beat as a separate bridge.

## 5. What 4.43.0 is

```
4.43.0  =  testnet 4.39.2
        +  metrics().publishes            (restored from 4.41.0)
        +  connect exported from root     (restored from 4.40.0)
        +  bridge directory as an ORDINARY topic:
             · drop the bridge's host() call
             · hourly re-publish, to EVERY bridge-populated region
             · freshness = liveness (stale ⇒ presumed offline)
             · every node persists its directory copy (URL-keyed)
             · bridge gets a DURABLE author key (transport stays ephemeral)
        +  region names → animal names (useast/uswest deprecated; pure rename)
        −  everything from 4.42.0         (re-gated separately)
```

Ships across the board: kernel, relay, bridge, axona.chat, demo apps — one version
everywhere, so `/healthz` tells the whole truth again.

## 6. Order of work

1. **Measure the directory's coverage first** — who roots `axona:bridge-directory`
   today, and how many distinct nodes hold it. This gates the whole directory change:
   if nothing is near that address, dropping the `host()` breaks discovery, and we need
   to know that before writing code rather than after deploying it.
2. ~~Settle the directory decisions~~ — **done**, see §4.
3. Restore the two reverted pieces onto testnet; kernel suite green.
4. Implement the directory change: drop `host()`, add the hourly beat, add per-node
   persistence + pruning. Fence the beat (an entry older than the window is not treated
   as live) and the no-host path.
5. Tag 4.43.0. Re-vendor into relay + bridge; re-pin axona-chat and the demo apps.
6. Testnet first — full fleet, verify `/healthz` reads 4.43.0 everywhere. Then leave it
   running long enough to see **at least two directory beats** land and a deliberately
   stopped bridge age out of the listing.
7. Soak on a clean field. This is the baseline everything later gets measured against,
   so it is worth doing properly rather than quickly.
8. Promote to prod: bridges first, then the 9 relays rolling, then the apps.
9. Re-gate 4.42.0 separately against 4.43.0.

**Note on axona-peer:** frozen since 4.38.0 and deliberately not part of this. It gets
no re-vendor, no version bump, no kernel pin change.
