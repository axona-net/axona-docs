# Axona Security Changelog

A running, public record of security-relevant changes to the Axona protocol
kernel (`@axona/protocol`) and the applications that ride on it
(<https://axona.net>, the demo, the signaling bridge, and the simulator).

Axona is **self-authenticating**: every guarantee below is enforced by
cryptography the peers carry themselves. None of these fixes introduces — or
depends on — a certificate authority, a central trust server, or a
reputation/identity-management service. A node's identity is its own keypair;
the network verifies it directly.

Entries are newest-first and keyed to the kernel version in which the change
shipped. axona.net and the demo track the kernel version; the deployed build is
always visible in each app's version row and at the bridge's `/healthz`.

---

## Kernel v4.34.0 — 2026-07-21 (testnet) — relayed connections work outside the browser

**Protected:** peers running outside a browser (relays, bots, test harnesses,
any Node process) can once again reach each other when both sit behind
home-router NAT. Such pairs need a relay server, and the credential for it —
a short-lived token whose user portion legitimately contains a colon — was
being mangled by the Node WebRTC compatibility layer, which packs the
credential into a URL and re-splits it on colons. The relay server therefore
rejected every request, no relayed path was ever offered, and two NAT'd
machines simply could not connect. Credentials are now encoded so they
survive that packing; browsers are unaffected (they never take that path).

Operationally this had teeth: testnet's region infrastructure fragmented
into per-machine islands, each holding topic history only its own host could
read — presenting as a stubborn, deterministic ~13% read-failure rate for
whichever participant was on the wrong side. Credentials remain short-lived
and per-session; nothing about their secrecy or lifetime changed.

Known gap: relaying over TCP (for networks that block UDP entirely) is still
unavailable — the ICE backend gathers no TCP-relayed path even against a
server that accepts TCP. Tracked separately.

## Kernel v4.33.0 — 2026-07-21 (testnet) — reads recover past dead neighbors

**Protected:** a reader arriving after nodes have died — even ungracefully —
now recovers the topic history from the surviving replica cohort. Recovery
probes prefer candidates the node can actually reach and rotate past
non-responders instead of re-querying the same silent targets; and, as a
temporary testnet-era aid, the bridge includes the authenticated identity of
a closed connection in its departure broadcast so peers can immediately
forget a dead node's stale routing memories. The hint grants no new removal
power: it is ignored by any peer that can still reach the subject directly
(a peer's own connectivity always outranks the bridge's opinion), it severs
nothing, and ordinary peers still cannot announce departures for anyone but
themselves.

## Kernel v4.32.0 — 2026-07-21 (testnet) — graceful departure preserves history before announcing itself

**Protected:** a publisher (or any holder) that leaves the network gracefully
now transfers every topic history it is responsible for to a live heir — and
receives a cryptographically-attributable acknowledgment — *before* it
announces its departure. Previously the departure announcement went out first;
peers proactively tore down their links to the leaver on hearing it, and the
subsequent history transfers could no longer be delivered. Any message whose
only copy was held by the leaver was permanently lost — silently, and
deterministically for the same set of topics on every run. Applications
observed this as "published and confirmed, but never receivable afterward."

Also in this release: replica placement and heir selection now prefer nodes in
the topic's own region (an out-of-region copy is durable but invisible to
routed reads), topics with no surviving replica are handed off first when a
departure is cut short, and a departing non-root holder can no longer cause a
competing root to be created elsewhere.

Note: v4.31.0 below shipped folded into this release rather than separately.

## Kernel v4.31.0 — 2026-07-21 (folded into v4.32.0) — departing replicas hand off their history

A gracefully departing node now safeguards every topic history it holds, not
only the ones it serves as root. Previously a node leaving the network handed
off only its *rooted* topics; a history copy it held as a *backup replica* was
dropped silently — and when churn had already moved the last surviving copy of
a message onto such a backup, that message was permanently lost even though it
had been correctly published, confirmed, and replicated (observed in the field
as ~10% of publishes unrecoverable after a publisher restart, immune to
waiting or re-subscribing). PROTECTED: on departure, a non-root holder that
cannot positively confirm the topic's root is still alive (an open link right
now — deliberately not trusting beacons or keepalives, which stay "fresh" for
tens of seconds after a root dies) pushes its full history to the topic's
closest live node as a replication — union-merged if the recipient is a root,
stored as a backup otherwise, so the history survives without minting a
competing root. Deterministic restart-churn harness: full-timeline recovery
82.5% → 100% (0 losses in 800 messages across 100 paired trials), live
fan-out unchanged. Verification: `test/smoke_backup_handoff.mjs` +
`test/diag_restart_loss.mjs`.

## Kernel v4.28.1 — 2026-07-18 (testnet) — root self-verification active on every peer

Every node that claims a topic's root role now periodically verifies that claim
against the live network — an iterative lookup confirms it is genuinely the
closest node, and a claim that isn't yields to the true root automatically. This
protection existed in the kernel but was inert on standalone peers (browsers,
relays, embedded peers) because the peer's routing adapter answered the
verification query in a shape the verifier could not read; v4.28.1 aligns the
adapter with the verifier's contract. PROTECTED: a topic's serialization point
converges to a single, network-confirmed node — a stale, mistaken, or
deliberately minted competing root claim is detected and demoted within seconds
instead of persisting and silently absorbing a topic's traffic. A new contract
test pins the adapter/verifier shape so the two cannot drift apart again.

---

## Kernel v4.27.0 — 2026-07-17 (testnet) — a node stays alive while it converges (join-storm hardening)

**What's protected:** the **liveness of infrastructure nodes under bulk state
transfer** — whether that bulk arrives from legitimate convergence (a relay
rejoining a busy region receives every topic's full state at once) or from a
deliberate flood. Three complementary bounds, all normative (architecture doc
§XI, enforced by the constants coherence guard): a root now paces its
full-state replication to at most a fixed budget of topics per repair tick
(a newly joined cohort member is seeded progressively instead of being
firehosed); a receiver drains verification-heavy pushes through a bounded,
time-sliced queue so signature-checking CPU can never monopolize the event
loop (mesh keepalives keep their share; queue overflow is dropped-and-logged
and re-healed by anti-entropy, bounding memory against a malicious sender);
and a node whose mesh has dissolved now detects the starvation and re-runs
its self-integration instead of remaining silently isolated forever. The
failure this closes was reproduced live on two kernel versions: a rejoining
relay bulk-ingesting ~1,000 roles starved its own heartbeats, was evicted by
every peer, and the regional backbone dissolved without self-healing.

---

## Kernel v4.26.0 — 2026-07-16 (testnet) — role state is bounded and every role transition is observable

**What's protected:** the **boundedness of per-topic role state** on
infrastructure nodes, and an operator's ability to **see** what every node
believes its responsibilities are. A node's pub/sub nature (root, backup, or
plain subscriber, plus the orthogonal holder flag) is now derived from ground
facts at the moment it is read — never stored separately, so it cannot drift
from reality — and every entry into or exit from the backup nature passes
through a single audited transition with a structured log line. A backup that
is promoted to root now sheds its backup state completely (previously a
promoted node could retain standing obligations toward a departed principal
indefinitely — unbounded stale state on long-lived infrastructure), and stale
backup state for topics that have re-homed elsewhere is evicted on a fixed
60-second window that never fires while the backup could still legitimately
win the election. Role natures are exposed at the inspection surface, so a
node accumulating responsibilities it shouldn't hold is visible at a glance
rather than discoverable only by log archaeology.

---

## Kernel v4.24.0 — 2026-07-15 (testnet) — a topic's history survives root formation and graceful departure

**What's protected:** the **availability of a topic's full, verified history**
across the two membership events that used to lose it silently. First, a
subscriber whose subscribe terminates at itself — making it the topic's new
root with an empty cache — now actively **pulls the history forward** from its
nearest peers and the lookup path before serving reads, re-verifying every
publisher signature and honoring tombstones on ingest (the same authenticated
union-ingest path as the v4.22 split-history reconciliation; nothing enters a
cache unverified). Previously that empty root would answer `since:'all'` with
nothing for as long as it held the role, while a node one hop away held the
complete timeline — measured in the field as the dominant cause (82%) of
unrecoverable read misses. The pull is bounded (delayed birth probe, ≤3 tries,
fan-out 4) and self-quenching, so it cannot be turned into a request
amplifier. Second, a gracefully departing node's **handoff of its cached
topics is now acknowledged and retried**, with a replication fallback to the
K-closest cohort for any heir that never confirms — a departing node can no
longer take the last copy of a topic's history with it because one routed
message went unanswered. Both mechanisms strengthen the network's standing
guarantee that history a publisher signed remains retrievable, by exactly the
peers entitled to it, without any central store.

## Kernel v4.23.0 — 2026-07-15 (testnet) — no region can be made a hotspot by anchoring topics in empty water

**What's protected:** the **even distribution of load across the network**, and
with it resistance to a cheap concentration/denial-of-service pattern. Axona
places a topic in the keyspace by a region byte at the top of its id. Roughly
half of the 192 geographic cells are open ocean or near-empty land where no
peers live. A topic anchored at one of those cells has no local population, so
the nodes responsible for it are simply the few peers nearest that empty byte in
id space — and **every** topic anchored anywhere in that ocean lands on the same
small set. An adversary (or just careless clients) could pile unbounded topic
load onto a handful of unlucky nodes by anchoring in water. The kernel now
**folds every ocean / sparse cell onto its nearest populated region** when an id
is minted — both node identities and topic ids — so an anchor in empty water
resolves to a real region and its load spreads across that region's whole node
population instead of a boundary sliver. Measured in simulation (2,100 nodes,
2,000 ocean-anchored topics): peak per-node load **2.7× lower**, and the share
carried by the busiest 1% of nodes **1.9× lower**. The fold is deterministic and
carried in the id itself — no coordinator, no registry. It is also
wire-compatible: the region byte is unchanged for every populated region, so no
existing topic or node id moves.

*(This release also renames the human-readable region labels to neutral
in-range animal names, removing country names from border-spanning cells. That
is a presentation change with no protocol effect — the id carries only the
numeric region code, never the label.)*

---

## Kernel v4.22.0 — 2026-07-15 (testnet + production) — a topic's full history survives a change of root

**What's protected:** the **completeness of published history across a root
transition**. When the node responsible for a topic (its root) changes — a
root leaves, or a better-placed node takes over — the cached timeline
previously split in two: the new root held the messages published after the
handover, and the old heir held those before it. A fresh subscriber arriving
afterward and asking for the full backlog (`since:'all'`) could be answered
by only one side and recover half the timeline. Roots now **union-ingest** the
history replicated to them rather than discarding it, and a subscriber
advertises the oldest message it holds so the root **pulls forward** any older
half it is missing. The two halves reconcile into one complete timeline, so a
cold subscriber recovers every message published across the transition, not
just those on one side of it. The reconciliation is **self-quenching**: once a
node has unioned a peer's range it does not re-request it, and a companion
hardening (v4.22.1) bounds the pull to fire once per advertised low-water mark
so a persistently-missing tombstone cannot drive a repeated-pull storm —
protecting the **availability** of a busy root under churn. Validated by a
dedicated split-history repro suite (previously recovered 6 of 12 messages
across a transition; now 12 of 12) and an overnight soak showing a flap-free
backbone with full-timeline recovery.

---

## Kernel v4.19.5 — 2026-07-13 (testnet + production) — a burst publisher's topic history survives its departure

**What's protected:** the **durability of published history across a
publisher's graceful departure**, at any scale of topics. A node that roots
many topics (a burst publisher creating dozens of fresh topics in seconds)
and then leaves now hands off every topic's cached history to a live heir
within the leave window: heir resolution runs in parallel, a leaver whose own
routing table is still thin falls back to the iterative network lookup rather
than abandoning the history, and the receiving heir retains its inherited
root claim instead of deferring back toward the departed node's stale
advertisement. A departed peer's root advertisements are also swept the
moment its channel closes, so live traffic is never steered at a node that
has left. Validated by a dedicated mechanics suite and a live burst-departure
test (all topics' history retrievable by a fresh subscriber after the
publisher departs, previously none).

---

## Kernel v4.19.4 — 2026-07-11 (testnet + production) — a departing peer goes silent, and its last words arrive

**What's protected:** the **integrity of a publisher's final messages** and the
**resource safety of departure**. An application that publishes and then leaves
now drains its in-flight publishes on evidence (bounded by the caller's
timeout) before departing — previously the drain window was silently capped at
50ms, so a publish-then-leave pattern could drop the very message the
application existed to send, and the retry machinery then outlived the
departure, consuming full CPU against a dead connection for ~40 seconds.
Topic hand-off on graceful leave is now genuinely time-bounded, and a peer
that has left sends nothing further. Validated by a dedicated regression
suite and live before/after measurement on a multi-host network.

---

## Kernel v4.19.3 — 2026-07-10 (testnet + production) — the mesh survives a bridge restart

**What's protected:** the network's **availability across signaling-bridge
restarts**. A relay (or any peer) that loses its bridge connection and reconnects
while the bridge is still coming back up now rides through the transient failure
and re-establishes itself, instead of stalling permanently. Availability is the
whole game for a delivery substrate — a node that is alive but can never rejoin is
indistinguishable from a dead one, and a fleet that all fails this way at once is
an outage.

Previously, a reconnect attempt that met a non-WebSocket HTTP response (a proxy
returning 502 during the bridge's boot window) surfaced as an unhandled error that
tore down the reconnect machinery: the peer stayed running but never retried, so a
routine bridge restart could strand the entire relay fleet until a manual restart.
The reconnect path now treats a failed upgrade as an ordinary retry with backoff,
and every recovery loop is bounded so it can never wait forever on the thing it is
recovering. Validated by a regression test that reproduces the exact failure and by
a live end-to-end reconnect through a sustained 502 window.

Also in this line (v2.68.0 bridge): event-loop **stall detection with public
health gauges**, and restored **root-state introspection** — a monitoring surface
that had silently reported zero now reports the truth, so operators can see what
the infrastructure is actually doing.

---

## Kernel v4.19.0 — 2026-07-07 (testnet + production) — root reconciliation: stranded traffic can no longer mint a competing root

**What's protected:** a topic's **single authoritative root stays single** even
when routed traffic strands on a nearby node. Delivery and revocation both
depend on this: every subscriber must attach to the same root that publishers
and kills reach, or messages are silently lost for part of the network and
killed content stays live for a subset of holders.

Previously, a subscribe (or metrics request) that terminated at a near-miss
node caused that node to take the topic's root **even while it held a live,
verified root announcement naming a strictly closer node**. The announcement
machinery demoted it moments later — and the next stranded message re-rooted
it. Between two long-lived infrastructure relays serving the same region this
became a standing oscillation: subscribers and publishers split across the two
root variants, and fresh subscribers received little or nothing. Observed on
the production backbone within hours of the relay tier going live; confirmed
by journal forensics (75 of 285 topics rooted on more than one relay) and a
failing delivery soak.

The fix routes every root-taking decision through one shared gate: a node
never takes (or retakes) a root while a live root announcement names a
strictly closer root it can verify — either over a direct authenticated
channel, or by having heard the announcement within the last announcement
period. Stranded traffic is instead forwarded to the true root, and any
spurious local claim demotes and re-homes beneath it, carrying its cached
history upward. Churn recovery is preserved: when a root genuinely dies, its
channel drop (or its announcements going silent) reopens promotion at once.
The same change closes a pre-existing bounded loop where a stranded publish
could chase a departed root's stale announcement for its full validity window.

Root-state introspection (`health().axonRoles`) is also restored — it had been
silently empty since the v3.12 internals rebuild, which masked this defect.

Validated by a new divergent-view regression suite (the unfixed kernel fails
it), the full kernel test suite, a 13/14 quiesced live restart-and-kill gate,
and a production delivery soak. No wire change; deployed to testnet and
production the same day.

---

## Kernel v4.18.2 — 2026-07-04 (testnet) — single-root election on churn (no split-brain)

**What's protected:** a topic keeps **exactly one authoritative root** when the
node currently serving it departs, so publications and **kills survive churn**.
Delivery and revocation are integrity guarantees — a subscriber must receive
every published message for a topic it holds, and a kill (tombstone) must reach
**every** holder so revoked content is provably gone network-wide. Previously,
when a topic's root left the mesh, more than one of its warm backup replicas
could each independently promote itself to root; the topic then briefly had two
disjoint roots, and a subsequent publish or kill would land on one while some
subscribers renewed against the other — silently dropping that message or
leaving a killed item live for a subset of the network until the roots
reconciled.

The fix removes the separate, locally-decided promotion path entirely. A backup
is now an ordinary **subscribing relay**: it renews toward the topic every cycle,
so a departed root is replaced through the **same network-confirmed election**
every subscriber already uses — an iterative closest-node lookup that resolves to
a single globally-closest terminus. The closest survivor becomes the sole root
and serves the full history it had prefetched (gap-free); the others re-home
underneath it. Two replicas can no longer both believe they are closest, because
the decision is confirmed against the mesh rather than each node's partial local
view. Validated by a single-root-election regression test and by an 8/8 live
restart-and-kill suite on a quiesced backbone (previously bimodal, ~1-in-2-to-5
runs splitting).

Testnet only; production remains on the 3.x line pending the gated wire-major
promotion.

---

## Bridge v2.61.0 — 2026-07-03 (testnet) — bootstrap-nursery: bounded, load-spread introductions

**What's protected:** a newcomer's *first contacts* are no longer a fixed,
unbounded set. Previously the bridge handed every joining peer the entire
admitted peer-list, so the same well-connected nodes were every newcomer's
initial neighbours — a concentration an adversary could exploit to sit astride
most bootstraps (an eclipse foothold). The bridge now introduces each newcomer
to a **bounded, curated anchor set** and applies a **relative-usage penalty** so
introductions spread across many eligible peers instead of funneling through a
few. The peer then self-expands into the rest of the mesh over **mesh-relayed
signalling** — a path proven to work with the bridge process entirely dead
(`mesh_relay_multihop_e2e`), so reaching the network never depends on any single
introducer. Anchor eligibility is gated on connection uptime and spread across
keyspace regions; selection auto-falls-back to the full list only when too few
peers are eligible (a cold/small network), and the whole behaviour is reversible
via `BRIDGE_NURSERY=off`.

Bounding only **engages at scale**: a self-protecting threshold keeps the bridge
handing out the full list until the eligible pool is comfortably larger than the
anchor count (default ≥ 3×k). On a network barely larger than k, dropping any peer
removes redundancy the network doesn't have — so below the threshold the nursery is
inert. (This was found live: on a 9-relay testnet, bounding to 8 dropped the one
relay rooting a cross-region topic and stalled that direction until the threshold
was added.)

This is a decentralization / eclipse-resistance improvement, validated in
simulation before deployment (dht-sim `results/w2`: the load penalty cut anchor
concentration — Gini 0.75→0.20 — while every newcomer stayed 100% reachable).
No wire or API change; peers are unaffected.

---

## Kernel v4.17.2 — 2026-07-03 (testnet)

**First-publish delivery hardened against convergence races (availability).**
Two reliability tweaks to the publish path, both idempotent (the root dedups by
message id, so a re-send never double-delivers): a freshly-joined node's
cold-publish burst now runs a second, slower wave (≈2 s past the first) so it
keeps getting fresh shots at the true root as its routing table warms; and the
*first* publish to a topic — even from an already-integrated node — is re-sent
once after a short beat, so a message published in the instant a topic's tree is
forming (a subscriber that just arrived, a root that just rooted) is not lost to
a single-shot timing race. No trust, authorization, or wire change. (v4.17.2)

---

## Kernel v4.17.1 — 2026-07-03 (testnet)

**Cross-region pub/sub delivery restored (availability).** A subscriber whose
node sits in a different region than a topic could fail to reach that topic's
root: the root-hint resolver consulted only *locally-known* peers, so a
foreign-region node — which holds few or no synapses into the topic's region —
concluded it was itself the closest node and formed a *second, disjoint* root,
splitting the topic's tree so the publisher's messages never reached the
subscriber. The resolver now falls back to the network's iterative closest-node
lookup before a node roots a topic itself, so publisher and subscriber converge
on one root regardless of region. The region prefix remains a *placement hint*
(topics still land near their region for locality); it never gates rooting or
delivery. No trust or authorization change — purely which node serves as root.
(v4.17.1)

---

## Kernel v4.17.0 — 2026-07-03 (testnet)

**Topic history survives the loss of its serving node within a churn window.**
A topic's cache is continuously replicated from its serving root to the nearest
backup nodes. Previously a backup waited a fixed silence interval (~65s) before
taking over — so when the root actually *left* the network, the topic's stored
history was unreachable to new subscribers for that whole window. The backup now
distinguishes a root that has genuinely departed the reachable set (promote after
a short grace) from one that is merely momentarily quiet (still wait the full
interval, so a live-but-lossy root is never split). This closes an availability
gap in which post-departure subscribers could transiently read an empty topic;
it changes recovery *timing* only — no node gains authority it could not already
prove, and a rare over-promotion is reconciled by the existing closest-node and
beacon-demote checks. (v4.17.0)

**A node that is itself a topic's root now replays that topic's history to its
own application.** A holder of a topic's cache subscribing for full history
previously received none of it (its own outbound request carries a high-water
mark and does not self-seat), leaving a root-hosting subscriber blind to the
history it was storing. It now replays its local cache directly to the app under
the same exactly-once dedup as the wire path. Correctness fix; no trust change.
(v4.17.0)

---

## Kernel v4.13.0–v4.16.0 — 2026-07-02 (testnet)

**Message ingress hardened by a single validated ID gate.** Every address
crossing from the wire into the routing core (node, topic, subscriber, and
target IDs) now passes one canonical coercion gate that validates format and
range before any routing state is touched, and routing objects can no longer
be constructed holding an unvalidated identifier. Malformed or out-of-range
IDs are rejected at the boundary with a stable, classifiable error rather than
reaching keyspace math. (v4.14.0)

**Region-occupancy discipline implemented, staged behind a switch.** The
kernel now enforces — when enabled — that a topic's serving infrastructure
(root, child relays, hosts) consists only of nodes in the topic's own region,
and refuses pub/sub into a region with no operational node. This protects a
region's nodes from absorbing a neighboring region's traffic (cross-region
hotspot/amplification). It ships **disabled** while the network is below the
regional coverage needed to enforce it without refusing legitimate traffic;
enabling it network-wide is a configuration change, not a release. (v4.13.0,
gated in v4.15.0)

**Metrics measured only on demand.** Topic activity snapshots are now
published only while a subscriber holds a renewable, self-expiring lease —
removing the standing background publish load and ensuring no orphan
measurement continues after interest lapses. Snapshot counts remain advisory
and are never a security input. (v4.12.0)

---

## Kernel v4.11.2 — 2026-07-01

**A "give me the latest" read is no longer a single-node bottleneck.** Building on the
v4.11.1 read change, a read for the *latest* message on a topic (a `pull` with no message
id) is now also answered by the **nearest replica that holds the topic**, returning
whatever most-recent message that node has, rather than routing every such read to the one
node closest to the topic's address. This removes that node as a read throughput
bottleneck and single point of failure for hot polling paths, and makes reads survive a
degraded route to it. The trade is explicit and bounded: a "latest" answer may be a beat
behind the newest publish until the replicas converge (they continuously reconcile), so it
is *recent* rather than *strictly newest* — appropriate for state-polling, while a reader
that needs an exact, specific message still asks for it by id and gets that exact message.
A replica with nothing cached does not answer — the read continues until a node with data
(or the closest node) responds — so this never manufactures a false "no message."

---

## Kernel v4.11.1 — 2026-07-01

**Reading a specific message no longer depends on reaching one particular node.** A
message's authoritative copy is held by the node closest to the topic's address, but
under the cohort model the same message is replicated across the closest-K nodes and any
children/hosts carrying the topic. A read for a specific message (`pull` by message id)
now returns from the **first replica the request reaches**, rather than insisting on the
single closest node — so a read succeeds even when the route toward that node is degraded
or momentarily stranded, and it completes in fewer hops. This is safe because the message
id is the hash of its own content: a replica either holds that exact message or it
doesn't, so a nearer answer is the *same* answer. A message still in a node's cache has
not been retracted there (a retraction drops it), so this cannot resurface a killed
message. (Reads for "the latest" resolved at the authoritative closest node here; the
v4.11.2 entry above broadens that to the nearest replica.)

---

## Kernel v4.11.0 — 2026-07-01

**A message published in the first seconds after a node joins is now delivered
reliably, not silently dropped.** A publish is routed toward the topic's address
and held by the node closest to it. A brand-new node hasn't yet learned enough of
the network to route accurately, so its very first publish could take a wrong turn
and land nowhere any subscriber looks — and because a publish is one-shot (a
subscriber renews, a publish does not), that message was simply lost, with no error
to the sender. Now, while a node is still integrating (few peers), it re-sends the
**same** message a handful of times over the first second. This is safe and
self-limiting: every copy carries the same content-addressed message id, so the
holding node keeps exactly one (no duplicates reach subscribers); the extra sends
also accelerate the new node's own integration; and the burst switches off the
moment the node is connected enough to route on its own. The result closes a
cold-start message-loss window without weakening any delivery or authorship
guarantee — the publisher still learns nothing about *where* any subscriber is, and
the transport identity remains unlinked to the author identity.

---

## Kernel v4.10.0 — 2026-06-30

**A retracted (killed) message can no longer resurface to a subscriber that joins
after the kill.** A topic's history is held by the cohort of nodes closest to its
address; under churn a late subscriber may attach to any of them. Previously a
retraction reached only the one node a kill happened to route to, while another
cohort member — or a node that *inherited* the cached history through a hand-off or
catch-up transfer — could still hold the un-retracted copy and serve it onward. Now
**every cohort member converges on the same history *and* the same set of
retractions**: a retraction is distributed to the closest-K nodes the instant it is
applied, and every internal history transfer (catch-up, hand-off, backup
replication) carries its retractions alongside the messages, applied first. A killed
message stays killed everywhere it could be read — including for subscribers that
arrive later and attach to a different holder.

**A retraction is only delivered to apps that actually received the message.** A
subscriber requesting full history that joined *after* a message was both posted and
killed never sees that message at all — and now receives no spurious "deleted"
event for content it never held. Retraction notifications are scoped to consumers
that received the original, so an app can't be told to retract something it never
displayed.

**The same hardening makes ordinary messages reliably reach every subscriber under
churn.** A retraction is just a publish with a side effect: the distribution fix
that keeps kills consistent is the same one that stops a post-churn *publish* from
being silently lost to a subscriber that homed on a different cohort member. Message
ordering remains anchored to the root's single monotonic stamp (v4.9.1); cohort
members adopt that stamp rather than re-stamping, so convergence never reorders a
topic.

These changes ship on **testnet** (kernel v4.10.0); production remains on the 3.x
line. Wire-compatible point release (WIRE 4.0, no flag day).

## Kernel v4.9.1 — 2026-06-29

**The signaling bridge can never be selected as a topic's root or relay — closing a
black-hole path.** The bridge is connection infrastructure, not a routable
participant: it cannot serve a topic's history. Several routing paths already
excluded it, but two did not — the local nearest-node lookup that seeds a
subscriber's root hint, and the relay-recruitment step that hands a sub-tree to a
child. Because the bridge sits in every peer's connection table and is often
numerically close to a topic's address, those gaps let a topic's traffic home on
the bridge, where it would strand (no delivery). The bridge is now excluded
consistently across **all** root- and relay-selection paths, so a topic always
elects a real, serving node.

**Message ordering no longer trusts publisher clocks.** Subscribers now order every
message — and every retraction — by the **root's** monotonic stamp (the single
serialization point), not the publisher's self-declared timestamp. A publisher
cannot mis-order a topic (intentionally or via a skewed clock) by back- or
post-dating its own messages; the publisher's timestamp still gates envelope
freshness at ingress but is not what consumers rank by. Each message and kill also
carries a **dense per-topic sequence number** assigned by the root, so a subscriber
can detect a missed message (a gap in the sequence) rather than silently losing it.

## Kernel v4.8.8 — 2026-06-29

**A retraction can no longer be silently missed by a subscriber that kept reading.**
v4.8.7 made kills ride replayed history, but replay only re-sent a retraction to a
subscriber whose sync cursor was still *behind* the kill. A subscriber that missed
the kill itself yet kept receiving newer messages had a cursor *ahead* of the kill,
so the retraction was never re-sent to it — it could hold the deleted content
indefinitely and serve it on to late subscribers. The root now re-offers **every
active (un-expired) retraction on each renewal, independent of the sync cursor**, so
any subscriber converges on all live retractions regardless of how far its reading
has advanced. Delivery stays exactly-once (the receiver deduplicates idempotently),
and the set is bounded by the existing retraction time-to-live. Deleted content can
no longer outlive its retraction on a straggler replica.

## Kernel v4.8.7 — 2026-06-28

**A message can only be retracted by its own author — kills are now verified at
the root.** A `kill` (retraction) is a signed statement; the kernel now verifies
that signature at the topic root and accepts the kill **only if its signer is the
same author key that published the target message**. A kill signed by anyone else
is dropped. If a kill arrives before the root holds the target (it raced ahead of
the message, or the root just took over), it is held *provisionally* and enforced
when the message arrives: the message stays retracted only if its author matches
the kill's signer — otherwise the unauthorized kill is discarded and the message
is delivered normally. This closes a gap where a retraction was applied by target
id without checking who signed it. The authorization is purely cryptographic
(author keypair → signature); no moderator, owner-registry, or trust server is
involved, and the kill still discloses only *who* signed it, never *where* the
publisher is.

**Retractions are now as durable as publishes.** A kill rides the same protected,
replayed history as a normal message, so a subscriber that was briefly unreachable
when a message was retracted still learns of the retraction when it re-syncs —
a retraction can no longer be silently missed, leaving deleted content visible to
a straggler.

## Kernel v4.7.0 — 2026-06-27

**Join-time self-integration — built only on authenticated first-party links, so
it does not weaken the eclipse defense.** A node joining via a single sponsor used
to sit reachable-from-almost-nobody until background annealing slowly wove it in:
a node is reachable only once the peers in *its own keyspace neighbourhood* hold a
synapse to it, and a sponsor-only join populates no such synapses. `join()` now
calls `peer.integrate()` — it runs `findKClosest(ownId)` (a read-only lookup that
needs only the node's *own* id, no global directory) and opens **authenticated**
channels to the neighbours it discovers. Each side adopts the other only on a
verified bilateral bind (axona/4 + DTLS-fingerprint), via the same `onPeerBound`
admission path an inbound mesh peer already uses. This is the **opposite** of the
attack the B-3 admission rules block: a node still cannot write itself into a
stranger's table by unauthenticated gossip — it can only earn a synapse through a
mutually-authenticated connection it actually opened. No new trust surface; a peer
simply integrates *itself* faster instead of waiting on ambient discovery.

(Also: the in-process simulator transport now fires the same `onPeerBound`
admission event the web/node transports do — closing a fidelity gap where
simulated meshes never exercised adopt-on-bind. Test-surface only; no protocol
change.)

---

## Kernel v4.5.0 — 2026-06-26

**Fast (keypair-free) node identity — sim-only, refused on the production
keyspace.** `createNodeIdentity({ fast: true })` mints a routable node identity
from random bytes with **no Ed25519 keypair**, so large in-simulator meshes build
without per-node keygen. A node identity is never signature-verified by the
protocol (the sim transport doesn't sign; web-mesh binding is a browser-only DTLS
concern), so this changes nothing a peer can verify — but to guarantee an
unverifiable identity can never reach the live network, `fast` is **refused
unless the keyspace has been shrunk below production width** (`configureKeyspace`
must have been called first; the default 264-bit profile throws). Production
identities are unaffected: the default path still does a full Ed25519 keygen.

## Kernel v4.4.0 — 2026-06-26

**Sim-configurable keyspace — production verification is unchanged; a shrunk
profile (simulator only) trades crypto verification for routing-scale.** The
kernel can now run at a smaller ID width so churn/scale tests fit far more nodes,
while **production keeps the full 264-bit keyspace and full signature
verification**. The security-relevant facts:

- **Production is the default and is byte-for-byte unchanged.** The keyspace
  profile defaults to region 8 ‖ SHA-256 256 (264-bit node/topic ids, 256-bit
  author ids). `verifyEnvelope` performs the full Ed25519 check exactly as before.
  A node only leaves this profile if it explicitly calls `configureKeyspace(...)`
  with a sub-256-bit hash — which the live network, the bridge, axona.net, and the
  demo never do. A startup guard logs loudly to stderr whenever a non-default
  profile is configured, and a kernel test asserts the default profile is 264-bit,
  so a sim build can't silently ship as production.

- **The relaxation is confined to the shrunk profile and is structurally
  unavoidable there.** When the author id is shrunk below the 256-bit Ed25519
  width (e.g. a 64-bit sim author id), the carried `signerPubkey` is a truncated
  routing id, not a verifiable public key — so `verifyEnvelope` skips the Ed25519
  signature check (gated on `AUTH_VERIFY_RELAXED = hashBits < 256`). It still
  enforces envelope **structure**, the **msgId content-address recompute** (a
  tampered message is rejected with `bad_msgid`), and **owner-only write policy**
  at the root (`signerPubkey === owner`). The simulator measures routing
  convergence and delivery, not auth; auth-path testing stays on the 256-bit
  profile.

- **No production attack surface is added.** Because the relaxation cannot engage
  unless a peer reconfigures its own keyspace below 256 bits, there is no input an
  attacker can send a production peer to disable its signature verification.

## Kernel v4.3.0 — 2026-06-25

**Metrics moved entirely onto signed, published snapshots; `unpub` removed;
`touch` deprecated.** Two surface changes, both narrowing what the network does
on a peer's behalf:

- **`peer.metrics()` no longer triggers an on-demand fan-out.** Previously it
  scatter-gathered the K closest roots per call — an amplification an attacker
  could drive by polling. Now a topic's root publishes a **signed** metric
  snapshot to a derived, open metric topic on a fixed ~20 s cadence, and
  `metrics()` simply reads the latest published snapshot. There is no caller-
  triggered fan-out to amplify, and every snapshot carries the publisher's
  `signerPubkey` so a consumer can pin trust to a known relay key. Snapshots
  remain **advisory** (the metric topic is open by construction); the protocol
  does not claim a snapshot is authoritative.

- **Intentional disclosure: owned-topic activity metrics are now public.** An
  owned (`write:'owner'`) topic's *messages* stay write-gated — only the owner
  key may publish, enforced at the root — but its **activity counts**
  (subscriber count, retained-message count, bytes) are now published to an open
  metric topic, so anyone who can derive the topic id can read them. This is a
  deliberate design decision (parity with open topics; lets anyone watch an
  owned topic's reach without holding the owner key). The message **contents**
  and the **write** capability are unchanged and remain owner-gated.

- **Retraction surface narrowed to `kill` only.** `peer.unpub()` (owner-only
  bulk queue removal) is **removed** — its wire record is no longer sent or
  handled. `peer.kill(topic, msgId)` — authorship-gated, single-message,
  tombstoned — is the sole retraction primitive. `peer.touch()` (hold-time
  keep-alive) is **deprecated to a no-op**. Fewer signed mutation verbs reach a
  root, each still self-authenticating.

Testnet only (wire-4 partition); production untouched.

---

## Kernel v4.0.0 — 2026-06-24

**Wire-version partition (`WIRE_VERSION` 3.0 → 4.0).** The routing-only
axonic-tree pub/sub is now isolated from earlier builds by the wire major. A
peer or bridge speaking wire 3.x and one speaking wire 4.x refuse each other at
**both** layers that matter: the signaling bridge rejects a mismatched
`wireVersion` major at the client-hello (close code 4426, before any frame is
relayed), and two peers reject each other in the `wireCompatible()` handshake
that gates the authenticated channel. The refusal is **hermetic** — there is no
version-floor heuristic to slip past, so a build on an incompatible protocol is
cleanly excluded rather than admitted and then failing silently mid-session.
This protects message integrity: peers on divergent pub/sub semantics can never
partially interoperate and corrupt a topic's delivery or ordering.

## Kernel v3.10.0 — 2026-06-22

Pub/sub root election is now proximity-gated on every promotion path
(wire-compatible; no flag day).

### PROTECTED: only a topic's genuine K-closest nodes can become its roots

- **A node can no longer self-promote to a topic *root* unless it is actually in
  the topic's K-closest set** (`findKClosest(topicId, rootSetSize)`). Previously
  three promotion paths created a root with no proximity check — direct
  `subscribe-k` receipt, the routed terminal-subscribe fallback, and a recruited
  relay (`adopt-subscribers`) that a stray `subscribe-k` later flipped to
  in-root-set. Any node a subscriber's *approximate* K-closest estimate happened
  to reach would therefore install a permanent root role (replay cache + feed
  fan-out) for a topic it isn't responsible for. The same `_mayHostTopic`
  self-proximity gate that already guarded the publish/lazy-axon path now guards
  all of them, so a peer hosts a topic's feed only when it is legitimately one of
  its roots. This bounds role/replay-cache allocation to the canonical root set
  and removes a low-cost way to scatter a topic's hosting across arbitrary nodes.
- **Recruited sub-axons are now correctly parented and classified.** The
  batch-adoption recruit message carries the recruiter's id, so an adopted relay
  records its parent and stays a sub-axon under its root instead of being
  mislabeled as an independent root. The delivery tree converges to the intended
  shape — a fixed ~`rootSetSize` root set, with overloaded roots recruiting
  close-by sub-axons beneath them — rather than smearing subscribers across many
  spurious roots. Verified by `smoke_pubsub_root_election` (canonical root count,
  recruitment fires, full delivery).

---

## Kernel v3.5.0 — 2026-06-20

A behavior change on the metrics read path (wire-compatible).

### `peer.metrics()` is now an owner-only reader — no arbitrary fan-out probes

- **PROTECTED: a non-owner can no longer trigger a K-root fan-out by reading a
  topic's metrics.** The `pubsub:metricsReq` scatter-gather now answers only the
  **owner of an owned topic** (the cached publisher anchor must equal the proven
  requester); open, public, and synthetic-regional topics are refused outright.
  Their live state is instead read by subscribing to the topic's published
  *metric topic* (`metricTopic(T)` — see the architecture note), which rides the
  normal, rate-bounded pub/sub delivery path rather than an on-demand K-closest
  amplifier. This removes the last way an arbitrary peer could aim a fan-out read
  at a topic, and keeps owned-topic subscriber counts owner-private (an empty
  cache, where ownership is indeterminate, now fails closed and is refused).
  Owned-topic behavior is otherwise unchanged (it was already owner-gated under
  the C-3 vouch check); the change is that open topics stop answering the probe.

## Kernel v3.3.0 — 2026-06-19

A behavior fix on the publish path (wire-compatible).

### Re-publishing identical content no longer duplicates or double-delivers

- **PROTECTED: each msgId occupies one replay-cache slot and is delivered once,
  even if the same content is published repeatedly.** The live publish path
  previously deduped only on the random per-publish `publishId`, so re-publishing
  identical content (same author + message ⇒ same msgId) stored a second cache
  entry and re-delivered to subscribers. Both ingress paths now upsert by content
  hash: a re-publish replaces the prior entry (one entry per msgId) and is not
  re-fanned to subscribers who already received it. This removes a duplicate-cache
  amplification vector (a publisher could inflate a topic's retained-message count
  by re-sending the same payload) and gives exactly-once delivery per msgId.

## Kernel v3.2.0 — 2026-06-19

A point release (wire-compatible with v3.0/v3.1) that removes a write-policy
footgun and clarifies the read-vs-write capability split.

### Naming an owner can no longer leave the feed accidentally world-writable

- **PROTECTED: `write` now defaults to `'owner'` whenever a topic names an `owner`.**
  Previously `write` defaulted to `'open'` regardless, so an owned feed written as
  `{ region, owner, name }` without an explicit `write:'owner'` resolved to an
  *open* topic that anyone could publish to. Now an `owner` implies owner-only by
  default; an owner-namespaced topic that anyone may post to (an inbox) must opt in
  with an explicit `write:'open'`. A topic with no owner is necessarily open
  (`write` is ignored), so the policy can never name an owner it won't enforce.

### A topic ID is a read capability, not a write capability

- **PROTECTED: publishing still requires the full descriptor; a bare topic ID is
  accepted only for reading.** `sub`/`pull`/`metrics` may be addressed by the
  shareable 66-hex topic ID, but `pub` (and `kill`/`unpub`) reject a bare ID and
  require the `{ region, owner, name, write }` descriptor. The storing node
  recomputes the id from the descriptor to enforce `signer === owner`; since a topic
  ID is a hash that cannot reveal its owner, accepting writes addressed by ID alone
  would let anyone who learned an owned feed's ID post to it. Read handles are
  freely shareable; write authorization always travels with the descriptor.

## Kernel v3.1.0 — 2026-06-18

A point release that fixes how a topic's region is chosen. Wire-compatible with
v3.0.0 — the envelope carries the already-resolved region, so a v3.0.0 storing
node recomputes the same topic id as a v3.1.0 publisher; no flag day.

### Topic placement can no longer be steered onto a handful of regions

- **PROTECTED: a topic's region is always a real cell the publisher legitimately
  occupies, and is never a function of an author key.** Region resolves to the
  explicit `region` in the descriptor, or — when omitted — to the publisher's own
  node region (the top byte of its Node ID). It is never derived from the Author
  ID. An Author ID is location-free, so hashing one into a region byte produced an
  arbitrary cell; because most of that hash space maps to ocean and snaps to the
  nearest populated region, author-derived placement concentrated many authors'
  topics onto a small set of unlucky regions — a keyspace hot spot whose
  XOR-closest peers would absorb disproportionate storage and fan-out. Region
  selection is now decoupled from author identity, preserving location-free
  authorship while keeping every topic on a routable, real-region cell.

## Kernel v3.0.0 — 2026-06-18

A breaking flag-day: the identity, authorship, and addressing model was rebuilt
from first principles around three separate concerns — connection (node
identity), authorship (author identity), and addressing (topic descriptor). The
signed envelope now binds a structured topic **descriptor** `{ region, owner,
name, write }` instead of a bare string, so the wire format changed (WIRE_VERSION
2.0 → 3.0) and the whole network moves together.

### Write policy is enforced at the storing node, not just claimed by the sender

- **PROTECTED: an owner-only topic can only carry messages signed by its owner.**
  A topic descriptor declares its write policy (`open` — anyone may publish,
  self-signed; or `owner` — only the named author key). The author signs the full
  descriptor, and the node that stores/serves the topic independently recomputes
  the topic id from the signed descriptor and, for `write: 'owner'`, requires
  `signerPubkey === owner` before accepting the message — at every ingress path
  (direct publish, K-closest relay accept, and anti-entropy sync). A publish that
  names someone else's owner-only topic is refused both at the publisher
  (`WRITE_POLICY_VIOLATION`) and again at the root, so a feed or profile topic
  cannot be spoofed by a third party even if they reach a storing node directly.

### Authorship is location-free and never carries connection material

- **PROTECTED: an author identity is a keypair and nothing else — no node id, no
  region, no coordinates.** Authorship (`createAuthorIdentity`) is fully separated
  from connection (`createNodeIdentity`): the published envelope discloses *who*
  signed (the author key) and the *topic descriptor*, never *where* the publisher
  is. *(As shipped in v3.0.0, owner-anchored topics were placed at a region
  key-derived from the author id, making a feed discoverable from the author id
  alone. **Revised in v3.1.0** — see above: a topic's region is explicit or the
  publisher's own node region and is never derived from the author key, so
  discovering an owned feed needs the owner Author ID **and** its region.)* Signing is
  `signWith`-only with an explicit author identity; the transport/node key can
  never sign a publish, and an unsigned publish must opt in explicitly
  (`ANONYMOUS`). This makes the *unlinkable transport / accountable author* split
  structural rather than conventional.

### Hermetic wire partition from the pre-v0.3 network

- **PROTECTED: a pre-v0.3 (string-topic) peer and a v0.3 (descriptor-topic) peer
  cannot silently half-talk.** Because the signed envelope's topic shape changed,
  the two builds would otherwise reject each other's messages *after* admission —
  a silent "my publish isn't delivered" failure. WIRE_VERSION major 3 makes the
  refusal happen cleanly at the handshake: the bridge admits only wire-major-3
  peers and returns `UPGRADE_REQUIRED` to anything older, so the cutover is
  hermetic and observable rather than a quiet data-plane mismatch.

Scope note (no over-claim): as in v2.50/v2.51, the peer a publisher hands a
message to over its own connection can still locally correlate that connection
with the author key at send time; the protocol carries no location, but it does
not defend against network-level traffic analysis (out of scope for v1).

---

## Kernel v2.51.0 — 2026-06-16

### Transport/authorship key separation is enforced (no implicit key reuse)

- **PROTECTED: a node's connection (transport) key can no longer silently double as
  its authorship (signing) key.** `peer.pub` signs publishes with a dedicated publish
  identity and never falls back to the transport identity; a signed publish without
  one is refused (`PUBLISH_NO_PUBLISH_IDENTITY`). This removes a key-reuse footgun —
  the same keypair both authenticating your connection and signing your content — and
  makes the *unlinkable transport / accountable author* split the **default** posture
  rather than an opt-in. Signing with the transport key remains possible only as an
  explicit, per-call choice (`signWith`), never implicitly.

---

## Kernel v2.50.0 — 2026-06-16

### Authorship can be unlinkable from network presence (dual-key identity)

Optional, additive, no wire change — a peer may sign publishes with a **publish
identity** separate from its transport identity.

- **PROTECTED: an app can have an accountable, recognizable author without a
  trackable network presence.** Previously one keypair was both the transport
  identity (node id, connection) and the publish signer (`signerPubkey`), forcing
  a choice: persist it (durable authorship, but linkable connections) or keep it
  ephemeral (unlinkable, but authorship resets every session). A peer can now
  sign publishes with a distinct, app-held **publish identity** while the
  transport identity stays ephemeral. The published envelope then carries the
  publish key only — **no transport-key material** — so an observer cannot tie a
  publisher's messages to its (rotating) network identity or to a specific
  connection, while the publisher remains a stable pseudonym that can `kill`/
  `unpub` its own messages across sessions. Apps may run several publish
  identities through one peer (`signWith`), e.g. per-channel personas.
- Scope note (no over-claim): the peer a publisher hands a message to *over its
  own connection* can still locally correlate that connection with the publish
  key at send time; at-rest and onward-hop data carry no such link. The default
  remains single-key (signing with the transport identity) unless an app opts in.

---

## Kernel v2.48.0 — 2026-06-16

### Ephemeral transport identities + bounded pub/sub memory

This wave removes the last stable, persisted per-node handle from the
infrastructure tier and puts hard byte ceilings on the pub/sub paths an
attacker could otherwise use to grow a node's memory.

- **PROTECTED: a relay or bridge can no longer be tracked across restarts by a
  stable transport id.** Relays and bridges now mint a fresh in-memory keypair
  and 264-bit node-id on every start and never write it to disk — there is no
  identity file and no lock. A restarted infrastructure node re-joins as a new
  node; nothing on the wire links the new session to the old one. Discovery and
  first-party reputation key on the node's *URL*, not on the (now-rotating)
  signer, so resilience is unchanged while the long-lived correlatable handle is
  gone. (Browser peers were already ephemeral; this extends the property to the
  always-on nodes.)
- **PROTECTED: a publish can no longer be linked to a node's identity through
  its publish id.** The publish id is now an opaque random token with no
  embedded node-id or region prefix, minted independently of the transport id.
  Besides closing a correlation channel, this removes a restart-collision class:
  a fresh node can never reissue a publish id a previous incarnation used.
- **PROTECTED: replay/anti-entropy responses are byte-bounded and the replay
  cache is byte-budgeted.** Replay and msgsync responses are now framed to a
  fixed byte ceiling per message, and the per-topic replay cache evicts on a
  total-bytes budget (16 MiB) as well as a count. A peer requesting history, or
  a publisher pushing large messages, can no longer drive a serving node's
  memory or a single frame past a bounded size.
- **PROTECTED: oversize publishes fail loud instead of silently vanishing.**
  `peer.pub` rejects a payload over the reliable-publish floor (15 KiB, the
  universal WebRTC-receivability bound) with a typed error rather than emitting
  a message that some peers along the path would silently drop. The protocol
  ships `@axona/protocol/std/chunk` so applications split large content into
  individually-receivable chunks. Predictable delivery is a robustness property,
  but the explicit ceiling also bounds per-message work at every hop.

---

## Bridge v2.26.0 — 2026-06-15

### Bridge hardening — less metadata exposed, smaller public surface

Operator-side and metadata-minimisation hardening for the signaling bridge, from
a structured external assessment of the deployment model. No kernel or wire
change; bridges update independently.

- **PROTECTED: a TURN relay can no longer correlate a peer's sessions by its
  credential.** The short-lived TURN username is now an ephemeral per-session
  random token (`<expiry>:<random>`) instead of carrying the peer's stable
  node-id. A relay operator — who may be a different party from the signaling
  bridge — sees no stable per-peer handle to link allocations across time.
- **PROTECTED: the raw bridge port isn't world-reachable on a standard deploy.**
  The installer binds the Node process to loopback (`HOST=127.0.0.1`); every
  request must arrive through nginx (TLS, access logging, real client IP, rate
  limits). Connection metadata can't be harvested by hitting the app port
  directly.
- **PROTECTED: the public health endpoint discloses only liveness + version.**
  Unauthenticated `/healthz` returns status, bridge version, and kernel version;
  the full topology body and the per-connection `/diag` view (IPs, node-ids,
  user-agents) now require an operator token. The network's bootstrap topology is
  no longer free for the asking.
- The operator guide now leads with **review-and-pin-a-release** for the
  installer (over `curl | bash` from HEAD) and documents operator security and
  legal considerations.

## Kernel v2.42.0 — 2026-06-13

### Bridge discovery + failover, without a trusted directory

Bridges can now advertise themselves on a public `axona:bridge-directory` topic,
and clients collect that list at launch and fail over to a saved alternate when
their configured bridge is unreachable on a later launch. The directory is
open — any bridge may publish — so the trust model is built to assume that.

- **PROTECTED: a bridge can't impersonate you or read your traffic, whichever
  one you use.** A bridge is only a rendezvous/signaling broker; the mesh is
  mutually authenticated and channel-bound and the media is end-to-end DTLS.
  Failing over to an unknown bridge can cost you availability or expose
  connection metadata, but never message integrity, authorship, or content — so
  discovery from an open directory is safe by construction.
- **PROTECTED: a poisoned directory can't redirect you off your bridge.** The
  configured primary is a trusted root and is **never auto-replaced**; the
  directory only adds *fallbacks*, consulted only when the primary won't open.
  Candidates are ranked by the client's **own first-party experience** (bridges
  it has personally bootstrapped through, by recency + latency) ahead of unknown
  third-party entries — reputation it observed itself, not anything a bridge
  claims. Entries are signed and self-expiring (48 h), and only `wss://` URLs are
  accepted (no downgrade to an unencrypted bridge).
- The **testnet bridge is excluded** (`BRIDGE_DIRECTORY=off`): it runs an
  independent fleet and must not advertise into the directory production apps read.

(A bridge-role proof-of-work to price directory entries against Sybil flooding,
and gossiped/aggregate reputation, are noted as future work — the first cut
relies on signing + first-party reputation + trusted roots.)

## Kernel v2.41.1 — 2026-06-13

### A signed publish discloses WHO, not WHERE — publisher location stays private

A signed envelope authenticates its author with `signerPubkey` (the raw Ed25519
verification key) and nothing more. The publisher's geographic region — the S2
cell encoded in the **top byte of its node-id** — is deliberately **not** carried
in the envelope, and it cannot be recovered from the public key (the node-id is
`S2-prefix ‖ SHA-256(pubkey)`; only the hash half is derivable from the key).

- **PROTECTED: a subscriber learns the publisher's identity, never their
  location.** Verifying a message tells you the exact key that signed it and lets
  you re-derive the content address — but reveals nothing about where the
  publisher sits. Location disclosure is not part of authentication.
- An application that *wants* to show a sender's region must opt in explicitly by
  placing it in its own message payload (the **Axona Minimal** demo does this as a
  worked example), keeping the choice — and the disclosure — visible at the
  application layer rather than baked into the protocol.

(Briefly, v2.41.0 carried the publisher's node-id on the envelope; v2.41.1 removes
it. The signed-envelope shape, `msgId`, and signature are unchanged — no flag day.)

## Kernel v2.40.3 — 2026-06-12

### Malformed-frame protection centralized to one dispatch-layer guard

Refactor of the 2.40.2 guard — same guarantee, broader coverage, smaller surface.
The per-registration guard (which only checked `topicId`/`fromId` and could be
forgotten on a new handler) is replaced by one check at the AxonaPeer dispatch
boundary that wraps **every** handler: a corrupt sender id is dropped at the
transport layer for all subsystems, and any handler error on a malformed id —
*any* field, current or future handler — is contained and classified
(`AXONA_BAD_ID` → a quiet churn-time drop, not a loud error). No new handler can
bypass it.

## Kernel v2.40.2 — 2026-06-12

### The malformed-frame guard now covers every pub/sub handler

No wire change. v2.40.1 stopped a malformed frame from *crashing* a node (the
dispatch boundary contains any handler error), but a present-but-malformed
routing id still threw inside handlers v2.40.1 hadn't individually hardened (e.g.
the `subscribe-k` handler), producing error-log noise on every such frame.

- **PROTECTED: a malformed routing id is rejected before any handler.** A single
  guard wraps all pub/sub handler registrations and drops a frame whose `topicId`
  or `fromId` is present-but-malformed — so a truncated id from a peer
  mid-teardown (or a hostile peer) is silently ignored network-wide, not just
  caught after the fact.
- **PROTECTED: a malformed remote `fromId` is dropped, never coerced to `null`.**
  This closes a subtle trap: several handlers treat a `null` `fromId` as
  "locally originated ⇒ trusted", so silently nulling a malformed *remote* id
  could have let an unauthenticated frame onto a trusted path. The guard drops it
  instead.

## Kernel v2.40.1 — 2026-06-12

### A malformed inbound frame can no longer crash a node

No wire change. A received pub/sub frame carrying a malformed id — e.g. a
**truncated `fromId`** from a peer tearing down mid-shutdown — reached an `async`
handler that parsed the id with a throwing decoder; the synchronous throw became a
rejected promise the dispatch's `try/catch` couldn't catch, escalating to a Node
`unhandledRejection` that terminates the process. A remote peer could therefore
crash a node with a single malformed frame.

- **PROTECTED: untrusted ids are parsed defensively.** The anti-entropy and
  kill-convergence handlers now drop a frame whose `topicId`/`fromId` isn't a
  well-formed id, instead of throwing on it.
- **PROTECTED: no handler can leak an unhandled rejection.** The direct-message
  dispatch now contains an async handler's rejection as well as a synchronous
  throw (matching the routed-message path), so a bug or hostile frame in any
  single handler is logged and dropped rather than killing the node — defense in
  depth across the whole handler class.

## Kernel v2.40.0 — 2026-06-12

### Infrastructure nodes can host topics without subscribing to them

Wire-additive over v2.39.0 — and in fact uses **no new wire message at all**: a
host announces itself with the same `pubsub:subscribe-k` a subscriber already
sends, so every existing kernel recruits a host with no flag day. `WIRE_VERSION`
is unchanged.

- **Hosting is now decoupled from consuming.** A relay or other infrastructure
  node can call `host()` to volunteer as a root/replica — storing and serving a
  topic for other peers — without registering as a *subscriber* of it. Previously
  the only way a node entered a topic's serving fabric was to `sub()`, which also
  made it a consumer (local delivery) of data it only meant to carry. A host
  registers no delivery handler and is never added to the node's own
  subscription set, so it forwards and serves but consumes nothing.
- **Two scopes, both least-privilege by proximity.** `host(topic)` serves one
  named topic; `host()` (no argument) volunteers the node for *its own keyspace
  neighborhood* — it gets recruited for whatever topics land near its id and
  nothing else. Neither bypasses the B-2 proximity gate: a host still only ends
  up rooting topics it is genuinely K-closest to, so the primitive cannot force a
  node into the serving set for arbitrary/distant topics. A node that hosts a
  topic it is far from simply wastes its *own* memory and harms no one.
- **No new trust.** A recruited host caches a message only after the same
  publisher-signature (B-4) and content-address checks every root applies on
  ingress, and serves replays exactly as a root already does. Hosting changes
  *who volunteers to carry* a topic, not *what is accepted* onto it.

## Kernel v2.37.0–v2.39.0 — 2026-06-12

### Pub/sub messages converge across replicas (no silent loss), and old browsers can join

Wire-additive over v2.36.0 (new `pubsub:msgsync` / `msgsync-resp` direct messages;
no envelope or identity change — old and new nodes interoperate).

- **A delivered message can no longer go permanently missing.** Replay-on-
  (re)subscribe was filtered by a single high-water timestamp, which can't
  represent a hole: once you received anything newer than a gap, that gap was
  masked forever. Subscribers now report the content-ids they actually hold and a
  root replays exactly the complement, so a missed message is backfilled rather
  than lost (v2.37.0).
- **The R root replicas reconcile, so any root carries every publisher's feed.**
  A publish only reaches the *publisher's* K-closest root set, which need not be a
  subscriber's. Roots now exchange digests of held content-ids with their
  K-closest siblings and pull what they're missing. **Pulled messages are
  RE-VERIFIED** — a sibling root is not trusted: the publisher signature (B-4) and
  the content-address are re-checked exactly as on live ingress, so reconciliation
  cannot be used to inject a forged or content-poisoned message; tombstoned
  (killed) messages are never resurrected through it (v2.39.0).
- **Old browsers without native WebCrypto Ed25519 can now derive an identity and
  join at all** (older Chrome / Samsung Internet / many WebViews), via a vendored
  pure-JS Ed25519 fallback. Native devices are unchanged and keep the
  **non-extractable** signing key (finding H4); the software fallback's key lives
  in JS memory and is therefore extractable, so the H4 hardening is a native-only
  property — used only where the alternative is "cannot connect." Signatures
  interoperate both ways (same RFC 8032 curve) (v2.38.0).

## Kernel v2.36.0 — 2026-06-11

### A retraction now survives replica divergence and subscriber reloads

Wire-additive over v2.35.0 (adds the `pubsub:kill-sync` direct message; no
envelope or identity change, so old and new nodes interoperate).

- **A killed message stays killed across the whole root set.** A topic is
  replicated across several root axons. A root that applies a creator-authorized
  `kill` now re-gossips the **signed** kill to the current root set until the
  replicas converge; any replica that had missed it re-verifies the kill against
  the message it holds and removes + tombstones that message. The retraction
  travels as the signed kill object — re-checked against the message it names —
  so it stays creator-authorized end to end and can never be used to suppress a
  message the sender did not author. What a user sees: a retracted message no
  longer reappears after a subscriber reloads.
- **A root never replays a message it has tombstoned.** Replay-on-(re)subscribe
  now also filters tombstoned messages on the *sending* side, so a lingering
  cache entry cannot leak a retracted message to a freshly-joined subscriber
  whose own tombstone set is still empty.

Bounded by design: re-gossip is gated to recent retraction activity, so there is
no steady-state cost and kill traffic stays proportional to actual retractions.

## Kernel v2.33.0 — 2026-06-09  *(in production 2026-06-10)*

### Pub/sub abuse hardening — metrics can't be turned into a reflector, and a retraction is now complete

Wire-compatible with v2.32.0 (no envelope/identity change).

- **Metrics responses go only to the proven requester.** A topic-metrics reply
  is now delivered solely to the cryptographically authenticated channel peer
  that asked — never to an address named in the request payload. A request can
  therefore no longer be turned into a reflection/amplification toward a chosen
  victim, and the redundant tree-wide broadcast that multiplied it is removed.
- **Metrics ownership fails closed.** When a root cannot establish a topic's
  owner (empty replay cache), the owner-sensitive subscriber count is withheld
  rather than disclosed.
- **A retraction removes every copy.** `kill` now drops all cached copies of a
  message's content, not just the first — identical re-gossiped content can no
  longer survive its own retraction.
- **Anonymous publishes can't dodge the flood cap.** Unsigned publishes share a
  single per-publisher quota bucket on open topics, so omitting a signature no
  longer bypasses the per-publisher limit.

## Kernel v2.28.0 — 2026-06-06

### A node authenticates only within its own network; an active publisher's replay protection no longer weakens under load; dropped-message logging is now observable

- **Network isolation by construction.** A node forms an authenticated channel
  only with peers that share its network's protocol epoch. The epoch is folded
  into the value each side signs at connect time, so a peer running a
  separately-deployed, incompatible build of the protocol cannot complete the
  mutual handshake with a current node — at the mesh layer or at the bridge.
  Two networks on different epochs are therefore cryptographically separate:
  no peer in one can be talked, relayed, or cached into an authenticated
  relationship with a peer in the other. The wire-format major is also carried
  in the connection request so the signaling bridge can decline an incompatible
  peer cleanly, with an explicit "please upgrade," instead of admitting it to
  fail silently later.

- **Replay protection holds under load.** Each node tracks a per-publisher
  freshness watermark that rejects a captured message replayed from earlier in
  that publisher's stream. The bounded store that holds those watermarks now
  keeps the *most recently active* publishers, so a continuously-active
  publisher's watermark is retained even while the node is tracking many
  publishers — closing a window where an attacker could have forced an active
  publisher's record out of the cache and then replayed an old message of
  theirs.

- **Silent security drops are now observable.** When a node rejects a hostile or
  malformed message (a bad signature, a stale or oversized publish, an
  unauthorized retraction), that decision is now surfaced through the
  application's logging hook instead of being discarded, so an operator can see
  what a node is refusing and why.

All three are covered by new regression tests, including a test that a
cross-epoch handshake is refused even when the epoch tag is forged to match (the
signature still fails), and a test that an active publisher survives a flood of
others without losing its replay protection.

---

## Kernel v2.23.0 — 2026-06-05

### Published message IDs are now verified content addresses; relay setup is rate-bounded; a failed handshake can't strand a peer

A pre-deployment hardening pass (an adversarial whole-system review, deliberately
broadened beyond the connection layer) produced three protections:

- **Message-ID integrity.** A published message's identifier — the key used to
  fetch it (`pull`) and to retract it (`kill`) — is now verified to be the true
  hash of the message's content at the point a node accepts it. A message whose
  advertised ID does not match its content is rejected, so a published ID
  reliably resolves to exactly the content it names and cannot be made
  unretractable or used to shadow another message's ID. Honest publishers are
  unaffected (their ID already is the content hash).

- **Connection-setup backpressure.** A node now caps how many direct connections
  it will be negotiating at once, so a peer that floods it with introductions to
  many fabricated identities cannot drive unbounded connection-setup work. The
  cap frees itself as negotiations complete or time out, and normal nodes operate
  far below it.

- **Handshake liveness.** A direct-channel authentication that fails partway
  (an identity mismatch, or a transient error while admitting the peer) is now
  always cleanly retryable, so a peer can never be left permanently
  authenticated-but-unusable by a one-off failure.

All three are covered by new regression tests, including a deterministic test for
the handshake-liveness case. None changes the wire format.

---

## Kernel v2.22.0 — 2026-06-05

### A connection that never finishes negotiating can no longer strand a peer

A direct connection that fails to establish — ICE never completes across a hard
NAT, no TURN path, the far side goes away mid-handshake — used to leave the
half-formed peer recorded indefinitely with no live channel and nothing to clean
it up (the health checks that retire dead links only run on connections that
actually opened). As with the v2.21.0 case, a peer left in that state was treated
as "already connecting," so the node would never try again — it could stay
unable to reach that peer directly until a restart.

Now every connection attempt is given a bounded window to succeed; if it hasn't
opened in time it is fully retired, so the node cleanly tries again later
(bridge-free) the next time it encounters that peer. This also caps a
previously-unbounded reconnect retry loop. The result: no peer can get
permanently stuck "half-connected," which is the failure mode that only appears
once a network is large enough to have peers behind difficult NATs.

This was found by a dedicated pre-deployment stability review specifically
looking for more failure modes of this class (a deliberately adversarial pass,
since each prior review had surfaced one). It is the same liveness-hardening
family as v2.21.0 and is covered by a new regression test.

---

## Kernel v2.21.0 — 2026-06-05

### A dropped direct channel always heals — no peer can wedge unreachable

A peer whose direct `RTCPeerConnection` reached the terminal `closed` state out
from under it (the far side closing, or an abrupt network drop) was left
recorded as a known peer with no live channel. Because the peer was still
"known," the self-healing reconnect path treated it as already-in-progress and
**never re-established the connection** — so a peer that dropped this particular
way could become permanently unreachable directly, falling back to multi-hop
relaying through others indefinitely.

Now a channel that closes out from under us is fully released, so the node
**re-forms the direct connection on its own** (bridge-free, via a freshly
relayed handshake through the existing mesh) the next time it sees that peer.
This closes a liveness gap that would otherwise surface only once a deployed
network experienced real churn at scale. The complementary `failed`-state
recovery path is unchanged. Guarded by a dedicated regression test.

This shipped alongside the at-scale verification that the network forms direct,
authenticated peer-to-peer connections **without the signaling bridge** — over
genuinely multi-hop relayed signalling (origin and target sharing no common
neighbour, so a single relay is impossible), with the bridge process killed, and
with the routing substrate that carries the signalling measured at 10,000 nodes
(99.5% delivery, 100% reachability). The bridge remains only the optional
cold-start rendezvous for a node's very first edge.

---

## Kernel v2.20.0 — 2026-06-05

### Bridgeless connection is now the default and self-driving; a dropped peer rejoins routing

The network no longer depends on the signaling bridge to form new direct
connections in steady state — and it now does so on its own:

- **On by default.** Peer-relayed signaling (`meshRelay`) is enabled by default.
  The bridge bootstrap path is byte-for-byte unchanged (it signals by ephemeral
  connection id, never a node id, so the relay never intercepts it); the bridge
  remains only the cold-start rendezvous for a node's very first edge.
- **Autonomous.** When a node learns of a peer it has no channel to (peer-driven
  discovery), it forms the new direct WebRTC edge by relaying the signaling
  through the existing mesh — no bridge involved. The resulting channel is still
  authenticated end-to-end (`axona/4` + DTLS-fingerprint binding), so a relaying
  peer can carry the signaling but cannot impersonate an endpoint or read the
  channel.
- **A peer that drops and reconnects rejoins the routing table.** A fan-out
  dedup made the "peer bound" notification fire only once per peer for the
  lifetime of a subscription, so a peer that left and came back (churn, or a
  bridgeless reconnect) could end up connected-but-unrouted — silently absent
  from the routing table. The notification is now re-armed when a peer departs,
  so a returning peer is re-admitted and is reachable again.

Verified end-to-end over real WebRTC with the **bridge process killed**: a node
autonomously forms an authenticated direct channel to a peer introduced purely
peer-to-peer, and re-admits it to its routing table — with no bridge in
existence. Removing the bridge as a hard dependency for new connections
eliminates a single point of dependency in the network's liveness.

---

## Kernel v2.19.0 — 2026-06-05

### Routing tables drop a dead peer immediately; bridgeless connect verified end-to-end

Two routing-integrity fixes, surfaced by an end-to-end verification of
bridgeless connection (a node forming a new authenticated direct channel to a
peer with the signaling bridge **process killed**):

- **A dead peer is evicted from the routing table the moment its channel
  dies.** Previously a peer was only ever *admitted*; a dropped peer — most
  importantly the bridge after it goes down — lingered in every node's
  synaptome until lazy cleanup, and greedy routing could keep selecting that
  dead, address-space-near peer as a next hop. Routing now evicts on the
  transport's authenticated peer-death signal, so the table reflects only live,
  bound channels. This both makes **bridgeless peer-relayed connection work
  when it matters most** (right after the central bridge drops) and shortens
  the window in which a departed or non-responsive peer can sit in a routing
  path.

- **Routed forwarding only ever hands a message to a directly-connected
  neighbour.** A fallback path could forward toward a peer two hops away as if
  it were adjacent; it now forwards to the verified first hop. This keeps
  multi-hop delivery (including relayed WebRTC signaling) from dead-ending one
  hop short.

The security properties of a relayed connection are unchanged and were
re-confirmed end-to-end over real WebRTC with the bridge dead: the channel is
authenticated by `axona/4` + DTLS-fingerprint binding regardless of who relayed
the SDP, so a relaying peer can carry the signaling but cannot impersonate an
endpoint or read the resulting channel. Removing the bridge as a hard
dependency for new connections eliminates a single point of dependency in the
network's liveness.

---

## Kernel v2.17.0 — 2026-06-04

### Bridgeless connection (peer-relayed signaling) stays authenticated end-to-end

A new, **capability-flagged** path lets two peers negotiate a fresh direct
WebRTC channel by relaying the WebRTC signaling (SDP offer/answer + ICE)
*through an existing peer* — a routed `mesh:signal` carried over the mesh —
instead of through the signaling bridge. This removes the bridge as a
single point of dependency for forming new connections. The security property
that makes it safe:

- **A relay can carry the signaling but cannot impersonate either endpoint or
  read the resulting channel.** The channel the signaling bootstraps is still
  authenticated end-to-end by the `axona/4` handshake (each side proves its
  pubkey hashes to its nodeId suffix) **and** bound to the actual DTLS
  certificate fingerprints (finding A-1). A relaying peer that rewrote the SDP
  to insert its own certificate would produce divergent fingerprints, so the
  mutual signature fails and no channel binds. The relay therefore sees the same
  metadata the bridge already sees (who is connecting to whom) and **nothing
  more** — it can drop or delay a negotiation, never man-in-the-middle it.
- **No new signed-object type, no weaker check.** The signaling payload is
  opaque to relays and needs no signature of its own precisely because the
  connection it bootstraps authenticates itself; a forged or tampered
  `mesh:signal` can at worst fail to produce a valid channel, never produce an
  unauthenticated one. Inbound `mesh:signal` reuses the existing size/rate caps.
- **Off by default.** The path ships behind a `meshRelay` capability flag; with
  it disabled the connection behaviour is byte-for-byte the bridge-only path.
  Validated across three layers before shipping — topology, real kernel routing,
  and a headless real-WebRTC harness (A↔C formed through B with the bridge
  closed; fingerprints cross-match; `axona/4` binds end-to-end).

---

## Kernel v2.16.0 — 2026-06-03

### Keep-alive (`touch`) authority follows topic ownership

The keep-alive that lets a message's hold-time be refreshed (`touch`) is gated
by **topic ownership**, matching the access model already used for `unpub` and
owned-topic metrics — not message authorship:

- **Open topics** (ownerless — a public topic, or a synthetic region-keyed
  anchor `prefix‖0^256`): **anyone** may keep a message alive. These topics
  have no owner, so the keep-alive is a shared, public capability — appropriate
  for community feeds and regional rooms.
- **Owned topics** (anchored at a real identity): **only the owner** may. The
  touch must be signed by the key whose `sha256(pubkey)` is the owner nodeId's
  256-bit suffix (the same pubkey↔nodeId bind `unpub` enforces; no registry, no
  gatekeeper).

In every case a `touch` can only **extend** a message's life up to its absolute
48 h ceiling — never beyond it — so neither an owner nor an open-topic
participant can pin a message indefinitely.

---

## Kernel v2.15.0 — 2026-06-03

### Retraction now reliably removes a message everywhere

The creator-only retraction (`kill`, kernel v2.10.0) is strengthened so that
retracting a message **reliably removes it across the topic's relays and keeps
it removed**:

- **No surviving copies.** A relay that acquired a message through the replay
  path (the history a node receives when it subscribes) now retains the content
  hash that retraction matches on. Previously such a copy wasn't matchable, so
  it could linger on that relay and be re-served to later subscribers after the
  author had retracted the message. A retraction now reaches those copies too.
- **No resurrection.** The replay path now honors the retraction tombstone, so
  a lagging relay replaying its older history can no longer re-introduce a
  message the author already retracted.

This keeps the original guarantee honest: retraction remains **best-effort
redaction, not a cryptographic un-send** (a reader who already received a
message can keep it, and anonymous/unsigned messages have no provable creator
and so can't be retracted) — but within the network a retracted message is now
consistently dropped rather than able to reappear. Self-authenticating as
before: the authority to retract is the same keypair that signed the message,
with no registry or central gatekeeper.

> Also in this kernel: a **keep-alive** (`touch`) lets a message's hold-time
> expiry be reset — bounded by the same absolute ceiling a read already
> respects — without re-publishing. Its authorization model is refined in
> v2.16.0 (above).

---

## Kernel v2.10.0 — 2026-05-31

### Message lifecycle you control — retract, remove, and bounded retention

The pub/sub layer gained owner/creator-controlled lifecycle operations and
bounded retention. Each new authority is **self-authenticating** — proven by
the same keypair that proved authorship/ownership, with no registry or central
gatekeeper:

- **Retract a message (creator-only).** A publisher can retract a message it
  sent; the topic's hosting nodes accept the retraction only if it's signed by
  the **same key that signed the original message**, drop it, and forward a
  delete marker to current subscribers so they can clear their local copy. A
  short-lived tombstone stops a lagging node from re-circulating it. (It is
  best-effort redaction, not a cryptographic un-send — a reader who already
  received a message can keep it — and an anonymous/unsigned message has no
  provable creator and so can't be retracted.)
- **Remove a topic's queue (owner-only).** The topic owner — the identity whose
  key the topic id is derived from — can clear, or fully destroy, the topic's
  message queue. Ownership is verified two ways at once: the signer's key must
  bind to the claimed owner id, and that id must derive the topic id. No one
  else can clear another's topic.
- **Anti-flood quota on open topics.** On open (anyone-may-publish) topics, a
  single publisher can occupy only a bounded fraction of the message queue, so
  one party can't flush everyone else's messages out. Owner-gated topics are
  governed by their publisher rules instead.
- **Bounded retention + hold time.** Every topic holds a bounded number of
  messages with deterministic, replica-consistent eviction, and each message
  has a hold time with a hard ceiling (default 24 h, max 48 h) after which it
  expires and is swept — so nothing is retained indefinitely, and a read can
  extend a message's life only up to that ceiling.

All of the above is **additive and interoperable** — older peers simply don't
honor the new control messages — so it shipped without a flag-day. It builds
on the v2.9.0 signed sequence/timestamp: eviction order, "latest", and hold-
time are all anchored to fields under the publisher's signature.

---

## Kernel v2.9.0 — 2026-05-31

### A captured message can't be replayed back into the feed (envelope freshness)

Every signed pub/sub message now carries, *under its signature*, a freshness
window and a per-publisher sequence number — so a message a node legitimately
sent can't be **captured and re-injected later** as if it were live:

- **Freshness window.** A signed message's timestamp is now covered by the
  signature, and the topic's hosting nodes reject a live publish whose signed
  timestamp is outside a bounded window of the present. A recorded message
  therefore stops being accepted as "new" once it ages out — an attacker can no
  longer rebroadcast last week's signed message to people who subscribe today.
  Crucially, the check is on the *signed* timestamp, not the unsigned routing
  metadata a replayer would control. (This is distinct from the legitimate
  *replay-to-late-subscribers* feature, where a topic's own hosting node serves
  its cached history to a peer that just subscribed — that path is unchanged.)
- **Per-publisher sequence.** Each publisher stamps a monotonically increasing
  number under the signature, seeded from the wall clock so it keeps climbing
  across restarts. A hosting node tracks how far each publisher has advanced and
  rejects a message that tries to rewind well behind that point — i.e. a replay
  from earlier in the publisher's own stream — while still tolerating benign
  network reordering of genuinely live messages. This also gives every topic a
  deterministic ordering, the foundation for "give me the latest" semantics.
- **Explicit domain separation on signatures.** The data a publisher signs is
  now tagged with an explicit, versioned context label, so a signature produced
  for a pub/sub message can never be lifted and presented as a valid signature
  in a different part of the protocol, and there is no delimiter ambiguity in
  what was signed.

Together these close the message-replay gap that signing alone didn't cover:
before, a signature proved *who wrote* a message but not *when* or *in what
order*, so a valid old message stayed valid forever. This is a coordinated
upgrade — the freshness and sequence fields are mandatory, so all peers, the
bridge, and the demo move to v2.9.0 together — but it changes only what nodes
*verify*, not any stored data.

---

## Kernel v2.8.0 — 2026-05-31

### A peer earns its place in the routing table — gossip can't poison it (eclipse prevention)

Hardening of how a node builds and maintains its routing table, to resist an
**eclipse attack** (an adversary surrounding a node so it can only talk through
attacker-controlled hops):

- **Routing entries now require first-party verification.** A peer named in a
  routing-gossip message (a "you should know this node" hint) is treated only as
  a *candidate*. On the production transports it becomes an actual routing entry
  only after this node has itself connected to it and completed the `axona/4`
  identity handshake — so a peer that can't prove the identity it claims is never
  admitted, and forged gossip can't inject hops into the table. Candidate
  verification is budget-limited so a flood of hints can't induce a connection
  storm.
- **Reinforcement can't pin an unverified entry.** A "this route was useful"
  signal now only applies to an entry whose peer is currently identity-bound,
  so it can't be used to keep a stale or unverified entry artificially alive in
  the table.
- **Neighbourhood disclosure is bounded.** A query for "who do you know" returns
  a small, capped sample rather than the node's whole neighbour set, so an
  attacker can't cheaply map the topology to plan a surrounding.

This is the routing-layer complement to the v2.6.0 channel binding: that stops a
broker interposing on a link; this stops an adversary capturing which links a
node has at all. As before, it's local enforcement — fully interoperable with
earlier peers (no flag-day) — and applies on the identity-binding transports;
the in-process simulator keeps its prior behavior. Eclipse resistance in any
open, permissionless network is a matter of raising cost, not a binary: this
turns "forge a gossip message" into "run, identity-verify, and sustain real
well-positioned nodes," which is a dramatically higher bar. (The buildup cost of
verified admission was measured first — a ~2 s join-time warm-up traded for
flat steady-state latency, no failure tail, and ~5× less connection load — and
pairs with staggered bootstrap so the join experience doesn't regress.)

---

## Kernel v2.7.0 — 2026-05-31

### Pub/sub trust boundary: a peer can only act for itself, and only where it belongs

A batch of hardening to the publish/subscribe layer so that membership and
message flow can't be driven by a peer on behalf of others, and so that
resource use is bounded by what a peer can legitimately request:

- **Subscriptions can only ever be made for the requesting peer.** Across
  *every* path — including multi-hop routed subscribe/unsubscribe, not just
  the direct one — a node now enrolls (or removes) only the cryptographically
  authenticated peer that delivered the request. A peer can no longer name a
  third party as the subscriber, closing a reflection/amplification vector
  where one peer could aim a topic's feed (and its catch-up backlog) at a
  victim.
- **A node only hosts topics it's actually responsible for.** Becoming a
  relay point for a topic now requires being among the nodes closest to that
  topic's address. A flood of messages for arbitrary topics can no longer make
  uninvolved nodes allocate per-topic state, closing a memory-exhaustion vector
  that could crash browser peers.
- **Forged-signature messages are rejected at the entry point.** A signed
  message whose signature doesn't verify is now dropped where it first enters
  the relay tree, before it is cached or forwarded — so spoofed-signature spam
  can't be amplified outward before the edge rejects it. (Anonymous/unsigned
  messages are unaffected.)
- **Canonical encoding is now total and standards-aligned.** The byte encoding
  underlying every signature and content hash always emits valid JSON with a
  stable key order and matches what the wire produces, eliminating a class of
  signer/verifier mismatches and signature-collision hazards. No change for any
  message that verified before.
- **Inbound payloads are bounded.** Per-message size and per-batch count caps
  on the network-facing handlers prevent a single inbound message from forcing
  an unbounded allocation.

All of the above are local enforcement changes — fully interoperable with
earlier peers (no flag-day).

---

## Kernel v2.6.0 — 2026-05-30

### Mesh traffic is now cryptographically bound to its own connection

Direct peer-to-peer links (the WebRTC "mesh") are now bound to the actual
encrypted channel they run over. Each side folds its connection's DTLS
certificate fingerprint into the mutual identity proof, so the authentication
succeeds **only** when both peers are talking over the same end-to-end channel
they each negotiated.

**What this protects:** the signaling broker (bridge) relays connection setup
but is explicitly *untrusted* for the contents of peer traffic. This change
removes any path by which a broker positioned between two peers could
transparently interpose on a link that both peers believe is direct — the
identity proofs no longer verify if the channel has been split. The
untrusted-broker assumption that Axona's architecture rests on is now enforced,
not just intended.

**Design notes:** the binding **fails closed** — if a link can't establish the
channel binding it does not authenticate, rather than falling back to a weaker
mode. Whether to apply channel binding is a local decision each peer makes
about its own connection, so it cannot be downgraded by a remote party.

> **Operator note (flag-day):** because v2.6.0 peers bind their identity proofs
> to the channel and earlier peers do not, the two will not form *direct* mesh
> links with each other during a mixed-version window. Broker connectivity and
> relayed delivery are unaffected, and direct links re-form automatically once
> both ends are on v2.6.0. Reload all instances together to minimize the window.

---

## Kernel v2.5.0 — 2026-05-30

### Assurance: the authentication path is now independently testable, and the app surfaces routing truth

This release contains no behavior change to the protocol's guarantees; it
hardens our ability to *prove* they hold and to *notice* when they don't.

- The peer-to-peer authentication handshake was extracted into a standalone,
  directly testable unit, and covered by a new integration test that drives the
  real handshake across the same conditions production peers experience. A
  companion headless test harness stands up multiple real peers over real
  WebRTC against a real broker and asserts that every link is mutually
  authenticated end-to-end. (This harness is also able to *catch* the class of
  regression that motivated it — it fails loudly if authentication silently
  stops binding links.)
- Applications now expose **routing truth**: a health signal that distinguishes
  "connections are open" from "connections are *authenticated and routing*,"
  and flags the degraded state where channels exist but no authenticated
  routing is flowing. The reference app shows an authenticated-peer count
  directly in its status panel.

---

## Kernel v2.4.1 — 2026-05-30

### Mesh authentication now binds reliably

A correctness defect in the mesh handshake caused the two endpoints to derive
mismatched channel-binding values, so authenticated direct links frequently
failed to establish and traffic silently fell back to relayed paths. The
binding value is now derived identically on both sides, so authenticated
peer-to-peer links form as intended. (No weakening of the check was involved —
the check was simply never able to succeed; this restores it.)

---

## Kernel v2.4.0 — 2026-05-29

### Security hardening batch + exactly-once delivery

A set of fixes from a full post-handshake security review:

- **Signature verification tightened.** Removed a placeholder code path under
  which an unsigned, non-authentic publication could be accepted as if it had a
  valid signature. All publications now require a genuine signature to verify.
- **Subscription requests can no longer be aimed at a third party.** A peer may
  now only subscribe or unsubscribe *itself* — established by the
  cryptographically proven identity of the channel it's speaking on — closing a
  reflection/amplification vector where one peer could enroll a victim as the
  target of a feed.
- **Private keys can be made non-extractable.** Browser peers can hold their
  signing key in a form that cannot be read back out by page script, so a
  cross-site-scripting incident or a malicious dependency cannot exfiltrate a
  peer's long-term identity.
- **Key-consistency check on load.** Loading a stored identity now verifies the
  private key actually matches its public key (a sign-then-verify probe),
  catching a corrupted or swapped key at load time instead of silently
  producing unverifiable signatures later.
- **Exactly-once delivery to the application.** Reworked pub/sub delivery so a
  message is handed to the application exactly once, eliminating a bug where a
  periodic re-subscribe could re-deliver earlier messages on a timer.

---

## Kernel v2.2.0 – v2.3.0 — 2026-05-29

### Authenticated identity handshake (`axona/4`) — the foundation

The core upgrade the rest of this list builds on. Every peer's node identifier
is derived from its public key; the `axona/4` handshake makes a peer **prove**,
on every connection, that it possesses the private key for the identity it
claims:

- **Bind** — the presented public key must hash to the claimed node identifier.
- **Possess** — an Ed25519 signature demonstrates control of the matching
  private key.
- **Channel** — the signature is bound to the specific live connection, so a
  captured proof cannot be replayed onto a different link.

This shipped across all three transports (browser/WebRTC, Node, and the
in-process simulator) and through the bridge's embedded peer, with
cross-transport domain separation so a proof valid on one kind of link cannot be
replayed onto another. Together this closes node-identity spoofing and
impersonation: a peer can no longer claim an identifier it does not hold the key
for.

---

## Foundational properties (in place since the 1.0 line)

- **Key-derived identifiers.** A node's 264-bit identifier embeds the SHA-256 of
  its public key, so the identity space is not squat-able by name alone.
- **Signed publications.** Application messages are Ed25519-signed and carry a
  verifiable envelope; topic ownership is cryptographically checkable.
- **No central authority.** Bootstrapping uses a signaling broker for
  connection setup only; the broker is never a trust root for identity or
  message content.

---

## Scope and ongoing work

This changelog records resolved items. Axona's security review is an ongoing,
adversarial process — findings are tracked privately and hardened in batches,
and this document is updated as each ships. Responsible-disclosure reports are
welcome via the project maintainers.

*Last updated: 2026-07-21.*
