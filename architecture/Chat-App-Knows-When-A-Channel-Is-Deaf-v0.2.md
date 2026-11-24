# A chat app that knows when a channel has gone deaf

**v0.2 — 2026-11-24 — axona.bot, for council review. Nothing here is built.**
Replaces v0.1 (`4d0d831`), which Orion returned in scope (`8924ca73`, CAD-1 and
CAD-2) with an answer to the note's question 2. Written on David's word of 2026-11-24 ("yes", to writing the app-side change up for
review). App read at axona-chat 0.115.0 (`acd30a1`); kernel 4.159.0. Evidence from
David's Chrome tab and the twenty Windows relay logs, 2026-11-24.

## What changed from v0.1

- **The cause has a name** (Orion, read by me in source). A subscriber counts itself
  attached when its SUBSCRIBE travels UP and is consumed. Nothing checks that a
  DELIVER can travel DOWN. `_unpinIfWaypointDead` drops an upstream only on an
  explicit failed verdict for the upward send. The deaf tab's upward sends worked;
  3,214 log rows on three hosts name it as a failed destination coming down.
- **The trigger no longer reads `current_count`** (CAD-1). That field is the root's
  cache length. It stops rising when the cache is full and it falls when the root
  changes. Part 3 now reads `publishes` and `seq` from the same root.
- **A re-seat that talks only to itself is caught** (CAD-2). Unsubscribing leaves a
  local role in place; a tab that holds a wedged root role for the channel would
  re-subscribe to its own cache.
- **One number in Orion's return is not what the source says.** The cache ceiling is
  1,024 entries, not 100. The argument stands; the figure does not.

## The question

How does a person looking at a channel know that the channel has stopped arriving?

On 2026-11-24 the answer was: they don't. David's axona.chat tab showed #council
with its newest message stamped 06:21 AM Eastern. The footer read
"Online (bridge.axona.net) v0.115.0 · kernel 4.159.0". The next #council post was
made at 10:51 AM. It did not arrive, and nothing after it did, for more than nine
hours. The tab said Online the whole time.

## What this is NOT

It is NOT the fault of the morning, where a NEW reader of #council received nothing.
This tab was attached and receiving, and then it was not.

It is NOT an old bundle. The tab ran the served app on the fleet's kernel.

It is NOT a fix for what left the tab unfed. That cause is now named, under "What
changed", and it is in the kernel: a subscriber that is attached one way. **Everything proposed here is detection and repair in the app: a symptom fix,
named as one.** It is worth building because the symptom is a person reading a room
that looks quiet and is not.

## What happened, as far as it has been read

- The tab's console shows three session recoveries, at 03:53:51, 03:55:28 and
  03:56:55 Eastern, each "wake after … suspend with 0 peers". Each one builds a new
  node. The node that went deaf, `8925b035d4d1`, was the third.
- That node received #council for two hours and twenty-four minutes after it was
  built. Its last message arrived at 11:21:36Z. The console has no line after the
  third recovery.
- No Windows relay log holds a channel open or close with that node. They name it as
  a failed routed destination 1,370 times, from 08:57:25Z to 14:31:58Z, and never
  again after.
- Between 10:54:58Z and 11:01:49Z seven Windows relays logged a split-union pull
  FROM that node, each on a different topic. The tab had become the root of seven
  small topics.

Not read: which node the tab's #council subscription was attached to, and why the
relays stopped naming the tab at 14:31:58Z.

## What exists today

- **The app's health check is a peer count.** `PeerContext.jsx` ticks every five
  seconds. If the peer has one peer or more, the tick returns: healthy. Recovery
  fires only on zero peers.
- **The counter in a channel's header is a separate subscription.** For each channel
  the app subscribes to a second, metrics topic and shows its `current_count`. That
  subscription can live while the channel's own subscription is dead. The tab's
  badge read "3 messages" while it showed none of them.
- **The app shows no node id.** In production the peer object is not reachable from
  the page. David got the id by pasting a script into the developer console that
  walks the page's internals.
- **A channel has no "last arrived" time.** The newest message carries the time it
  was WRITTEN. Nothing says when the app last heard anything.

## The proposal

Three parts, in the app only. No kernel change.

### 1. The app says which node it is

The footer's version line gains the first twelve characters of the node id; a click
copies the whole id. The About panel shows the same, with the time the node was
built and how many times the session has been rebuilt since the page loaded.

A person can then say "I am `8925b035d4d1`" and anyone with a relay log can find
them. Today that took a console script and a seat that knew to ask.

### 2. Each channel shows when it last heard anything

The channel header shows the time of the last message ARRIVAL beside the count. Not
the time the newest message was written. A channel whose newest message is from this
morning and whose last arrival was this morning reads differently from one that
heard a replay a minute ago.

### 3. The app notices a deaf channel and re-seats it

- For each channel the app already holds two numbers: the count the network reports
  and the messages it has received.
- **The condition.** The root's metrics snapshot for a channel carries `by`, the
  root's id, and `publishes` and `seq`, which only go up. When `publishes` or `seq`
  rises under the same `by` and no message arrives on the channel within a bound,
  the channel is deaf. When `by` changes, the comparison starts again from the new
  root's numbers; a new root that reports messages the app does not hold is the
  same evidence.
- **The first response is narrow.** Stop that one channel's subscription and
  subscribe again, asking for history. The app already removes duplicates by message
  id, so a replay costs nothing on screen.
- **A re-seat must hear from the network.** If the re-subscribe is answered only
  from the tab's own cache, because the tab holds a local role for that channel, it
  has not been re-seated. The app then gives up that local role, or goes straight
  to the next response.
- **The second response is the existing one.** If the channel is still deaf after a
  re-seat, run the full session rebuild that zero peers triggers today.
- **Every step is said out loud.** A console line, and a mark on the channel in the
  list: "re-attached 10:52", or "not receiving". Never a silent repair.
- **It is bounded.** A re-seat per channel no more than once in a set interval, with
  the interval doubling. A channel that cannot be made to hear is marked and left,
  not hammered.

## What it costs

A wrong trigger re-subscribes a healthy channel and replays its history once. The
count is itself a message on a topic and can arrive before the message it counts,
so the bound has to be longer than that gap; that gap is not measured.

## What would show this is wrong

- A deaf channel whose metrics subscription is deaf too. Then the count does not
  rise and part 3 never fires. Part 2 still shows the stale arrival time, to a
  person who looks.
- A `publishes` that rises for a publish the subscriber should not receive. Then
  part 3 fires on a healthy channel. I have read where the snapshot is built, not
  every place `publishes` is incremented.
- A re-seat that attaches to the same dead place. The tab's third rebuild worked for
  two hours and then failed; nothing says a fourth would have done better. This is
  the limit of a symptom fix.
- A tab the browser has frozen. No timer runs, so nothing here runs. The existing
  wake check covers that case and this note leaves it alone.

## Open questions

1. **For Vega.** What increments `publishes`, and can it rise without a publish a
   subscriber should receive?
2. **For all.** The cause-side change is a subscriber that does not call itself
   attached until something has come DOWN to it. Is that one more note, or does it
   belong in the kernel's next fix release ahead of all three notes?
3. **For Aster.** Part 3 re-subscribes with history on a trigger the network can
   move. Can a hostile root use the count to make every tab re-pull on a loop?
4. **For David.** The bound in part 3: how long may a channel be deaf before the app
   acts? And should the node id sit in the footer always, or only in About?

## Relation to work in flight

- **"A bridge that is not the queue" v0.2.** A tab is a node with few peers that
  opens channels slowly. The tab here held no channel to any of twenty relays.
  Whatever that note decides for "five peers" applies to this tab first.
- **The earlier watchdog fix** (axona-chat 0.102.0) made recovery survive a rebuild
  that throws. It still watches peers, not delivery.
- **The node-id display** was offered to David this morning after the collector was
  mistaken for a browser tab. Part 1 is that offer.
