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

### Decisions I need from you

1. **Region pin.** The directory is pinned to `useast`, so global discovery depends on
   one region's coverage. Keep it simple and single-region, or give each region its own
   directory topic (bridges publish to their own, clients read their own and fall back)?
   Single-region is what works today; per-region removes a global dependency on one
   region but multiplies the topic.
2. **Bridge author key: durable or ephemeral?** Today the bridge mints an *ephemeral*
   author, so the signer rotates every restart and entries dedup on URL alone. I-ID
   permits a durable author (durable WHO is the legitimate half). A durable one would
   let a client verify "this is the same bridge that announced last hour" rather than
   trusting the URL by itself. Worth it, or is URL-plus-TLS enough?
3. **Retention window.** For "older than an hour ⇒ offline" to be readable, the topic
   must retain at least two or three hours of beats so a fresh subscriber sees the
   current generation. What ceiling do we want?
4. **Persist cadence on nodes.** Save on every arriving beat, or debounce? And prune
   entries past what age, so the book does not grow without bound?

I have not implemented any of this — the design touches the release, so it should be
settled first.

## 5. What 4.43.0 is

```
4.43.0  =  testnet 4.39.2
        +  metrics().publishes            (restored from 4.41.0)
        +  connect exported from root     (restored from 4.40.0)
        +  bridge directory as an ORDINARY topic:
             · drop the bridge's host() call
             · hourly re-publish per bridge (heartbeat)
             · freshness = liveness (stale ⇒ presumed offline)
             · every node persists its directory copy
        −  everything from 4.42.0         (re-gated separately)
```

Ships across the board: kernel, relay, bridge, axona.chat, demo apps — one version
everywhere, so `/healthz` tells the whole truth again.

## 6. Order of work

1. **Measure the directory's coverage first** — who roots `axona:bridge-directory`
   today, and how many distinct nodes hold it. This gates the whole directory change:
   if nothing is near that address, dropping the `host()` breaks discovery, and we need
   to know that before writing code rather than after deploying it.
2. Settle the four directory decisions (region pin, bridge author key, retention
   window, persist cadence).
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
