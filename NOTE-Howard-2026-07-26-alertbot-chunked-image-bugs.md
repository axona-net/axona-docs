# Note for Howard — three crashes in the alert-bot acceptance run, one root cause

*2026-07-26. Ran your acceptance suite against **prod** (kernel 4.43.0, bridges 2.95.0,
9-relay backbone) to get a baseline before we ship a departure-durability fix. It
crashed three times before completing. All three trace to one defect, and two of them
interact in a way that makes each run sabotage the next.*

**Good news first: the run produced exactly the measurement we needed, and it is a clean
reproduction of the bug we're fixing. Details in §4.**

---

## 1. The root cause

The chunked-image path constructs a topic descriptor with **`name: undefined`** and hands
it to the kernel. The kernel refuses it — correctly — with `PUBLISH_INVALID_TOPIC`:

```
PublishError: topic must be an object { name, region?, owner?, write? }
  context: { topic: { name: undefined, region: 128, owner: '5a12889c94e14b…' } }
```

`region: 128` is 0x80 (grizzly), and the owner is populated, so the descriptor is *nearly*
right — only `name` is missing. That points at a field-name mismatch rather than a missing
lookup: the image path appears to pass `{name}` where the surrounding code expects
`{eventName}`, or vice versa.

Same malformed descriptor, three different call sites, each fatal.

## 2. The three crash sites

### (a) Metrics timer — `index.js:210`

```
at AxonaPeer.metrics (…/AxonaPeer.js:2274)
at Timeout._onTimeout (…/alert-bot/index.js:210:57)
```

Fires `metricsS` seconds after the first publish to a topic. With the default
`--metricsS 5` it kills the process immediately after publishing, before any confirmation
runs. **Workaround:** `--metricsS 0`.

Note this one is thrown from inside a bare `setTimeout` callback, so it is an uncaught
exception — the app cannot catch it without wrapping the callback body.

### (b) Kill loop — `index.js:163`

```
TypeError: Cannot read properties of undefined (reading 'identity')
  at getUserIdentity (…/index.js:163:3)
  at …/index.js:180:30
```

`index.js:161` does `let user = users[source]`, then `:163` dereferences `user.identity`.
When `source` is absent, `users[undefined]` is `undefined` and this throws — at startup,
before anything is published.

**Where the bad `source` comes from is the important part.** Crash (a) happens *after*
publishing, so the run has already appended its publications to `killCache.txt` — and one
of those entries, written by the same image path, has **`source: null`**. The next run's
kill loop reads it and dies.

I measured this on your live cache:

```
584 entries — 571 'alert-bot', 8 'user2', 4 'user3', 1 null
```

One poisoned line out of 584 is enough. And it recurs: after each subsequent run I found
exactly one new null-source entry. **So every run breaks the following run.** That is
consistent with the `killCache.poisoned-backup-085232.txt` already sitting in your
directory — this has bitten before and been worked around the same way.

**Workaround:** drop entries whose `source` is null/empty before running (I backed the
file up first; kept 583, dropped 1).

### (c) Subscribe during chunk assembly — `index.js:354`

```
at AxonaPeer.sub (…/AxonaPeer.js:1916)
at …/@axona/protocol/std/chunk.js:299
at receiveChunkedBytes (…/std/chunk.js:280)
at P2PWebNetwork.assembleChunkedDataURL (…/@yz-social/civildefense.io/…/p2pWebNetwork.js:163)
at startSub (…/alert-bot/index.js:354:20)
```

This is the one that matters most, because it is in the **confirmation phase** — after
publish, after disconnect, after re-join, while subscribing to all 392 topics to check
what survived. So even with (a) and (b) worked around, the run still cannot produce
delivery numbers. **Workaround:** `--includeImages false`, which removes the chunked-image
path entirely.

## 3. Suggested fixes — all small

1. **Fix the descriptor construction** in the image path. This is the actual bug; the other
   three symptoms are downstream. Worth grepping for `eventName` vs `name` around the
   chunk/blob publish and assembly code.
2. **Guard the kill loop** — skip (and log) any killCache entry whose `source` isn't in
   `users`, instead of dereferencing. One line, and it stops a bad cache entry from
   bricking every future run.
3. **Wrap the metrics timer body** in try/catch, or validate before calling `metrics()`.
   A throw inside a bare `setTimeout` is fatal and unrecoverable.
4. **Consider not persisting a killCache entry when the publish path produced no usable
   source** — the poison is written silently at the moment of a partial failure.

**One item on our side, not yours:** `std/chunk.js` calls `peer.sub` inside a Promise
executor without validating the descriptor first, which turns an app-layer mistake into an
unhandled rejection and a dead process rather than a catchable error. We should validate
early and reject with context. I'll file that against the kernel.

## 4. What the run measured anyway — and why we wanted it

Your suite is the right instrument for a fix we've just re-landed, because **the code under
test runs on the departing node, and your alert-bot *is* the departing node**: it publishes,
waits, disconnects, then re-joins to confirm.

Baseline, your client on kernel **4.41.0** (which it gets transitively via
`@yz-social/civildefense.io`) against prod 4.43.0:

| | |
|---|---|
| published | 780 publications across **392 topics** |
| held at the moment of departure | **618 axons** |
| **`pubsub:handoff-unacked` warnings** | **72** |
| heirs that absorbed them | **two** — 42 to `8042db53…`, 30 to `8046ba28…`, each the other's fallback |

That is a textbook reproduction. The ack window a departing node waits for was a **fixed**
700 ms, while the work on the receiving side scales with the number of topics transferred.
Two heirs absorbing 72 topics' worth of simultaneous cache ingest cannot acknowledge inside
a constant window — so "unacked" overwhelmingly meant **"acked late"**, and each late topic
fell through to a single unconfirmed fallback send. Where the leaver held the only copy,
that history could be lost. It lines up with the 68 unacked you saw on the earlier 4.41.0
run, now at three times the axon count.

**Kernel 4.44.0 fixes exactly this**: the round window becomes
`min(5000, 700 + 25×unacked)` and exits early both when every heir has acknowledged and
when acknowledgements stop arriving — spending time in proportion to evidence rather than
to a guess. Our fence goes from 68/68 unacked to **0/68** at K=68.

**To see it on your side you need to move your own kernel to 4.44.0** — running your suite
twice on 4.41.0 would show nothing, since the fix lives in the departing node's code. That
pin is transitive through `civildefense.io`, so it may need a bump there too. Happy to help
with that.

## 5. How to reproduce what I ran

```
# de-poison first, or the kill loop dies at startup
cp killCache.txt killCache.backup.txt
# drop entries with null/empty source

node index.js --metricsS 0 --pauseAfterPublishS 25                    # handoff numbers
node index.js --metricsS 0 --pauseAfterPublishS 25 --includeImages false   # + delivery numbers
```

`--pauseAfterPublishS 25` reproduces the 25-second settle-before-disconnect from your
earlier reference run, so the departure is timed the same and the numbers are comparable.

Full logs are in your repo as `acceptance-prod-4.41.0-baseline-*.log`.

## 6. Context you may want

Prod moved to kernel **4.43.0** today — one version across both bridges (2.95.0), all nine
backbone relays (0.84.0) and axona.chat (0.36.0). Two changes are worth knowing about as an
app author:

- **Hosting is decided by a node's ADDRESS, never by ownership.** `host(topic)` now refuses
  a topic the node isn't near, with `HOST_NOT_IN_NEIGHBOURHOOD`. If any of your code hosts
  its own topics, it will now be refused unless its address would have put it there anyway.
- **Region names are the animal names** — `useast → eagle`, `uswest → grizzly`,
  `uscentlw → bison`. Pure rename: identical topic ids, both spellings resolve, existing
  share links unaffected. Your 0x80 is `grizzly`.

Also, on the prod soak run just before your suite: 39/40 scenarios green at ~40 nodes,
including 100% on scale, churn, discovery, kill and restart. The same soak on our
12-node testnet was 32/40 — the difference was mesh size, not the kernel, which is why
we've moved acceptance testing to prod.
