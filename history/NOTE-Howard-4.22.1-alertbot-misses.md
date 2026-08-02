# Note to Howard — the 4.22.1 alert-bot read misses

*2026-07-15 · re: your runs against bridge.axona.net (483 / 1,389 / 370 topics)*

Thanks for the runs — this is exactly the kind of field data we can act on.
Three parts: the answer to your `axonRoles` question, what we think is
happening with the misses, and a couple of small things that would help us
pin it down.

## Your question: what is `health().axonRoles.length`?

It's the number of topics for which **your node currently holds a piece of the
delivery tree** — either as the topic's **root** (the live node XOR-closest to
the topic id; it stamps messages, holds the authoritative cache, fans out to
subscribers) or as a recruited **child relay** under someone else's root. Each
entry is `{topic, isRoot, children, cacheSize}`.

It is *not* "topics I've published to" and *not* "topics I've subscribed to."
A publisher whose topic roots on some other node holds no entry for it — the
publish simply routes away. So:

**No, it is not significant that the number is about half your topic count —
for a publisher that's expected and healthy.** You published to N topics; you
hold roles only for the subset that happened to root on you (you were the
closest live node at that moment). The rest rooted on your other hosts, the
relays, or other peers. Roots spreading across the mesh is the DHT doing its
job — one node rooting *all* its own topics would be the pathology (no load
distribution, and everything depends on that node's departure going
perfectly). Your reader nodes show much higher counts (1206/1389, 358/370)
for the complementary reason: after the publisher and hosts leave, the fresh
reader is the closest live node for most topics, so it self-roots them on
subscribe.

One honest caveat: that "~half rooted on the departing publisher" number is
also the interesting one for the misses, below.

## What we think is happening with the misses

First, what the data establishes, and what it doesn't:

- **The misses are genuine non-delivery, not slowness.** Your 600-second
  windows are far past any convergence time; messages still missing at 600s
  were unrecoverable by that reader, full stop.
- **We can NOT yet say topic count is the driver.** Your three runs point in
  conflicting directions — 483 topics → 100%, 1,389 → 4.5% missed, but 370 →
  13% missed (the *smallest* run failed worst). The runs also differ in
  region, host freshness, delete-history, and timeout, so no single variable
  is isolated. The similar absolute miss counts (48 vs 63) despite a 3.75×
  topic-count difference hint the failure set may be closer to "a fixed
  population of unlucky topics" than a rate that grows with scale.
- Relay coverage isn't the explanation either: 0x80 *is* covered by our relay
  backbone and 0x47 is not, yet 0x80 failed proportionally worse.

The failure *shape* is the useful clue: whole multi-message topics missed
entirely (`published 9 received 0`), alongside partials on busy topics. That
points at the root/holder machinery around your publisher's departure rather
than message-level loss. Three candidate mechanisms, each with a distinct
signature:

1. **Leave-handoff shortfall.** Your departing publisher rooted ~half its
   topics. A graceful `leave()` hands each rooted topic's cache to an heir,
   but that window is time-bounded (~5s) and was sized for tens of roots, not
   700+. Handoffs that didn't complete = topics whose history left with you.
2. **Reader self-roots an empty topic.** Your fresh reader, being the closest
   live node for most topics, may *become root of an empty role* on subscribe
   instead of first pulling history from whichever node actually holds it —
   so it authoritatively serves itself nothing.
3. **Replication never happened.** The publish burst may have outrun the
   cohort replication that normally puts backup copies on the nodes nearest
   each topic — in which case the history genuinely died with the departing
   nodes and no reader could ever recover it.

(1) and (2) are recoverability bugs — the data exists somewhere and retrieval
fails. (3) is a durability bug — the data is gone. They need different fixes,
so we won't fix anything until we've *captured* which one it is; guessing
produces symptom patches.

Separate small thing: your over-deliveries (`published 2 but received 12!`,
handle/avatar topics receiving 4× what you published) are all on
**persistent owner topics**. Your bot deletes prior *publications*, but an
owner topic's history can survive on its root across runs, so the reader
replays accumulated older messages too. Accounting artifact, not a delivery
bug — but worth excluding from the miss tally so it doesn't muddy the counts.

## What we're doing

1. **Reproducing under controlled conditions** (in progress now). Our soak has
   a scenario that is literally your alert-bot workload (one publisher, many
   fresh topics, publish → leave → fresh `since:'all'` reader); it was
   validated at ~90 topics. We're scaling it through 370 → 1,400 with region,
   freshness, delete-history, and window held constant — varying only count —
   to reproduce your signature (multi-message topics at 0, still 0 at 600s).
2. **Instrumenting to capture the mechanism.** Per missed topic: was it rooted
   on the departing publisher (hypothesis 1)? does the reader hold
   `isRoot:true, cacheSize:0` for it while another live node still has the
   cache (hypothesis 2)? or does a post-mortem sweep find *no* live holder at
   all (hypothesis 3)?
3. **Fixing the captured mechanism, then gating** the usual way: a dedicated
   repro test that fails on today's kernel and passes on the fix, the full
   suite plus your axonSpec, repeated runs at the failing scale, testnet soak,
   then production. Since you hit this on production, it goes out on the next
   promoted line.

Also already fixed, unrelated to the misses but from your reports: the ~5s
hang your bots see on every disconnect (`leaveMs ~5040`) was the leave drain
waiting for publish confirmations that a non-subscribing publisher never
receives. Kernel 4.23.2 exits that wait as soon as it stops making progress
(~1.5s for your pattern). It reaches you with the next release.

## What would help from you

1. **The reader-side smoking gun (biggest ask, one line of code).** At the
   moment your reader times out, log its roles filtered to roots, e.g.:
   `peer.health().axonRoles.filter(r => r.isRoot)` — ideally the full entries,
   not just the length. If the missed topics appear there with
   `cacheSize: 0`, that's hypothesis 2 confirmed straight from the field, and
   you'll have saved us a week. If they *don't* appear, that's informative
   too.
2. **Publisher-side roles at disconnect.** You already log
   `axonRoles.length`; if it's cheap, log the topic ids of the `isRoot`
   entries. Then we can check whether the missed topics correlate with
   "rooted on the departing publisher" (hypothesis 1).
3. **Keep the miss lists.** The per-topic `published X received Y` output you
   already produce is exactly right — keep it per run so we can correlate
   against 1 and 2.
4. **Exclude owner topics from the miss accounting** (or tally them
   separately) so the persistent-history over-delivery doesn't mix with the
   real misses.
5. **If you rerun: one variable at a time.** Same region, same hosts warm/cold
   state, same timeout — vary only alert count. Your three runs were each
   individually great; they just can't be compared to each other.

Nothing here needs you to stop testing — the current kernel is safe to keep
hammering, and every run with the extra two log lines makes the diagnosis
faster.
