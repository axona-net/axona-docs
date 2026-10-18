# Team update — the #council root split, and the kernel that reconciles two roots

Kernel 4.115.0 on branch `dual-root` (head: `5daca18`), built 2026-10-17/18 from the design packet `architecture/Axona-Dual-Root-Reconciliation-v0.1.md` (header v0.15, docs commit 14a6bd8). Unreleased. The reconciliation is off by default. Release and arming are separate decisions, both David's.

## What question this answers

On 2026-10-16 at 17:26Z David posted a test message to #council from axona.chat and saw it echo in two of his own browsers. No council seat answered. The seats had not gone deaf. #council had two roots, and the two never found each other for nine hours. The question this work answers: what happened, why the kernel could not repair it, and what the kernel now does when two roots hold one topic.

## What happened, read from six hosts' logs

The 0.161.0 relay roll restarted every relay. The old council root on the Linux host restarted at 17:17Z. A relay on the nyc3 droplet was born as an empty council root at 17:17:42Z; its birth probe found nobody holding the topic, because the probe's routed pulls failed while the mesh around it was still forming, and the probe never re-armed. A Windows relay restarted at 17:19Z and formed its own empty council root at 17:21Z. The nyc3 root yielded to the Windows one on verify. David's post walked to the Windows root and was replicated to two backups. Every council seat stayed on a root a seat held, with the 58-message history, and that root was backed by nothing on the relay fleet.

Neither side could see the other. The seat-held root ran its self-verify every 45 seconds, and the verify read the LAST hop of its lookup as the terminus. The walk visited the Windows root at hop 9 of 41 and then bounced between two relays that were each other's closest known node until the hop cap; hop 41 was farther than the seat, so the seat kept its claim. Had the verify read the closest node the walk visited, the split would have ended on the first verify.

Reconnecting my seat on David's word rehomed it onto the relay-held root. The reconnect's graceful leave handed the seat's 24-hour-bounded cache to an heir, and eleven entries crossed into the Windows root at 03:04Z, unrecorded by any log. The other 47 were older than the handoff's bound and stayed behind.

## What the kernel now does

Four fixes to the paths that let the split form and stand, then the reconciliation machine itself.

The verify reads the closest VISITED node of its lookup, not the last hop. The lookup never revisits a node, and a node with nothing unvisited reports a stall with the closest visited id instead of running to the hop cap. The birth probe awaits its pulls' verdicts: a try that reached nobody is deferred, not spent, and re-arms once the node can route. A history that crosses into a root by handoff or by the low-water pull leaves an info record naming its carrier.

The machine, behind the kernel option `mergeCapable` (default off; an unarmed node behaves as 4.114.1 on every path):

- ONE election relation between two live claims: higher epoch wins; at equal epoch the XOR-closer wins. The old yield rule was two yields and no winner; a merge run on it would cross offers forever.
- The root flag is a transaction. A root holding a body or an active tombstone sheds its claim only with a release token minted at the end of a completed round. Every path that used to demote directly, including ADOPT, which never called demote, goes through one entry that records a candidate instead.
- The cut is at the commit, not at the handler's entry. A publish awaits its signature check before it stamps; a cut between the two refuses the stamp. The refused write is forwarded to the winner by name, under a flight bound to the winner's epoch, never to the beacon's.
- The exchange: the loser offers; the winner pulls by cursor under a correlation id; the loser cuts, gates, measures its export against a published bound, and answers a manifest header and frames; the winner admits only if its own entries plus the manifest plus a write reserve fit, pins everything for the round, and acks once, after the last frame, with retention counted against the manifest at ack time. The loser matches six fields, checks a lease anchored at its own bind on a monotonic clock, re-checks it synchronously before the flip, and demotes with the token. Completion is a correlated block on the loser's next subscribe; the winner closes with MERGE_CLOSED.
- The loser holds toward the accepted winner whether or not the winner is closer, so a closer loser at a lower epoch cannot re-promote and outrank the live winner. A role is never reaped while it holds custody: an open round, a completion in flight, pinned entries, or any active tombstone keeps it.

## What is proven and what is assumed

Forty-nine fences on the branch, every one run twice: with the fix, green; with the fix deleted, red at the predicted check. The full suite passes. The exchange runs end to end on a two-node fabric and on the in-tree simulator with real lookups and beacons: six peers, a partition, a publish on each side, a heal, one root at the end holding both bodies.

Two guarantees, stated apart. CUSTODY is unconditional: an entry leaves the network only by its holder's TTL; a refused, short, stale or late ack leaves the loser rooted; two roots that never find each other stay two roots and lose nothing. UNION AT THE FLIP, the claim that the winner holds everything the loser held at the moment the loser steps down, rests on two assumptions the packet does not verify: each clock's error is under the published allowance over a round, and the synchronous run from the loser's last lease check to its flip is not suspended past one tick. A flip that detects the second violation after the fact logs it and claims no completion; the data is safe, the union is not asserted.

The gate's bound is 191 seconds per round at the published parameters: an export bound of 17,564,672 serialized bytes, 180 frames at 96 KiB, and a per-frame service allowance of 250 ms that is ASSUMED from one hop's 39 ms median on the October 8 RTT matrix, not measured on a merge. A subscriber of the loser sees nothing new for at most that long per round. If the allowance is wrong the round aborts at the bound and retries; nothing is lost.

## Where the build departed from the packet

Each is stated in the fence that pins it. The loser converges to the winner's state by asking for everything once on its first completion subscribe, because a child's ordinary replay asks only above its own high water. The demote's own subscribe is an ordinary renewal; completion rides a second one sent after the post-flip lease read, so a late flip claims nothing. Frames end before an equal-stamp group; they do not extend across it. Manifest tombstones are pinned with the bodies. A subscribe at the held loser is seated there as the winner's child, the shipped rule. A late pull under a corr the loser already ended is stale, not a fresh round. A non-root answers an offer with a refusal, so silence is never mistaken for a legacy winner.

One finding from the simulator: a root made by hand mints the next epoch and WINS under the relation; the true root demotes into it through a round and the union is preserved. The packet promises the union, not the owner.

## How to read a split now

RELEASE-PROCEDURE.md §6 gained two checks: before the first host rolls, read who roots the standing topics from a seat and from a fresh peer (`ops/cold-lookup-topic.mjs`, `ops/cold-read-topic.mjs`) and roll those hosts last; after the roll, run both again and compare with a seat's `axona_status`, which now lists the seat's roles. Two views is a split, not lag. A seat's `axona_reconnect` now returns what it rooted at the close and which handoffs were acked.

## What is not done

Nothing is released and nothing is armed. The parallel review of the fleet's empty-root inventory (Aster, council seq 267 onward) found the migrated-tombstone case this build's custody guard covers, and proposes a metadata export first; that is a separate decision. The service allowance should be measured on a merge before the bound is read as a figure. Until then it is a ceiling.
