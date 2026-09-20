# The bridge in the address space — why a third of the alert-bot's topics went nowhere, and what 4.86.0 changes

**Written:** 2026-09-20, after the production deploy.
**Kernel:** 4.86.0 (tag `v4.86.0`, axona-protocol `3838c7f`), axona-relay 0.130.0, axona-bridge 2.127.0.
**Record:** `ops/testnet-nonbridge-probe/run/RUN-LOG.md` §0–18 in the workspace; GH #69, #26.

Why does a publish to one topic arrive every time and a publish to the next topic, from the same node, over the same bridge, arrive never? That is the question Howard's alert-bot suite has been asking since the summer, and it is the question this update answers.

---

## 1. What happened

Howard's alert-bot is a real application run as a test: twelve Civil Defense alerts, 190 publications across 95 topics anchored in region 0x80, published from a node in region 0x89, then read back by two fresh subscribers. On production, 2026-09-14, on kernel 4.84.0:

    basic-mainnet-check          43 of 95 topics delivered NOTHING to either subscriber
    basic-mainnet-diagnostics    35 of 95

The failure was all-or-nothing per topic. A topic that failed failed for both subscribers; a topic that passed passed for both. Rerunning changed which topics failed, because the topic ids changed with the event version. The failure followed the topic id, not the alert, not the cell, not the subscriber.

On 2026-09-16 the ids were lined up against the ids of the nodes in region 0x80. Every one of the 42 topics that failed twice was XOR-closest to the west bridge. Zero of the 122 that passed were. That closed #69's question of *where*. It did not say *why*.

## 2. How it was diagnosed

David's instruction on 2026-09-18 was short: "Shut down the production nodes on air and run it on testnet." The production relays on the Air were stopped with `stop-fleet.sh` and six testnet relays started in region grizzly against `testnet.axona.net`, where we own both bridges — B1, the one every client dials, and B2, a second never-root bridge federated to it. Everything below was run by axona.bot on David's direct instructions, one at a time, with the council reading the record as it was written.

### 2a. Place topics on purpose

Topic ids are derived from the topic name. So sixty names were minted offline and sorted by which 0x80 node each id was XOR-closest to: twenty closest to a relay, twenty closest to B2, twenty closest to B1. Then one publisher and one fresh subscriber per topic, and a beacon.

    closest to a relay            20 of 20 delivered
    closest to B2 (never-root)     3 of 20
    closest to B1 (dialled)        0 of 20

The three B2 deliveries were the topics where the fresh subscriber's own random id happened to land closer than B2, so the walk never reached the bridge. That is the whole failure, in miniature, on a fleet we could read.

The first attempt at this cohort was minted against the wrong B2 id. B2 had restarted four times and I read the third `axona-ready` row, not the fourth. Aster caught the placement mismatch from the instrument's own output; the cohort was re-labelled as a relay-closest control and re-minted. Every restart of a bridge or relay changes its id, and every placement after that was re-minted against the ids read from the current log.

### 2b. Rule out ordering and fan-out

David asked whether publish-before-subscribe or subscribe-before-publish was the variable, and whether one-to-one, one-to-many or many-to-many was. A 36-topic matrix — three cardinalities, two orders, six topics per cell split across the three placements — answered flatly:

    relay-closest    12 of 12 pass, both orders, every fan-out
    B2-closest        0 of 12
    B1-closest        0 of 12

Ordering is not the variable. Fan-out is not the variable. Placement is.

### 2c. Read what B2 wrote down

B2's kernel log for the seventeen failed topics carries the same three rows, fifteen times each:

    disc           became-root  self:B2  why:sub-terminal
    role-refused   why:bridge   hard:true
    undeliverable  pubsub:sub   why:refused-no-forward

and the same for `pubsub:pub`. 244 refusals, 244 undeliverables, zero forwards. The walk ends at B2 because nobody is closer; B2 refuses to be root, which is by design; then B2 has nowhere to hand the message and drops it. The bridge is a sink for every topic whose address lands on it.

That drop is not an accident. Forwarding from the terminal node used to route the message straight back to itself and spin without yielding; that spin took the east production bridge down for fifty minutes on 2026-07-27. The drop was the fix for the spin. It traded a hang for silent loss.

### 2d. Turn the fence off, and find the second defect

David: "Allow the bridge to be a root — no restrictions. Include all bridges set this way. Run the tests again." The fence is an environment switch, `BRIDGE_NEVER_ROOT=0`. With it off on both bridges:

    B2-closest    20 of 20    (was 3)
    B1-closest     1 of 20    (was 0)

B2 was fixed by the switch alone. B1 was not, and B1's kernel log held **nothing** for its twenty topics — no refusal, no role, no root. The SUB and PUB never reached it.

One direct measurement settled where they went. A fresh client routed a harmless frame to four node ids and printed the kernel's own verdict:

    to B2        arrives, 0 hops
    to relay-6   arrives, 1 hop
    to relay-1   arrives, 1 hop
    to B1        never arrives — 39 hops among the relays, exhausted

From a node that held an open websocket to B1. The source explains it: `_greedyNextHopToward` skips the node's own dialled bridge — "signaling infra, not a routable DHT node" — while the bridge's id stays in every synaptome and in the address space. The 2-hop lookahead scans the synaptome unfiltered and names the bridge as closer, so the fallback forwards toward it and the next hop refuses it again. The message bounces until the hop budget dies. Cohort 3's 530 failed routed sends on relay-3 were that bounce.

So two defects, independent, one per bridge role. The bridge you *don't* dial is a sink (the fence). The bridge you *do* dial is unreachable (the routing exclusion). On production, every client dials one of the two bridges, so for each client one bridge is each.

### 2e. Remove the exclusion

David: "Let's remove the unroutable bridge code and run the test again." All five places in `dht/AxonaPeer.js` that treat `bridgeNodeIdBig` specially came out — the two greedy hops, the two `findKClosest` candidacy filters, and the hook AxonaManager's root-claim fallback reads. The bridge is an ordinary DHT node. With the fence off and the exclusion gone:

    B1-closest     20 of 20
    B2-closest     20 of 20
    relay-closest  20 of 20
    matrix         36 of 36

The frame to B1 now arrives direct in 74 ms. B1's log shows it taking the root itself, fifteen times, with zero refusals — the first pub/sub frames its kernel had ever received from the mesh.

### 2f. Howard's suite, three times

    testnet, hand-patched kernel        check 0/95   diagnostics 0/95
    testnet, tagged 4.86.0 everywhere   check 0/95   diagnostics 0/95
    PRODUCTION, 4.86.0, 2026-09-20      check 0/95   diagnostics 0/95     (09-14: 43/95, 35/95)

Same scripts, same host, same shape, parameters untouched; the bot's kernel installed from the tag with `--no-save`.

### Who did what

David set every step and gated every deploy: stop production on the Air, run on testnet, the ordering matrix, the fence off, the exclusion out, the version, the push, the roll, production, the numbers to Howard. axona.bot ran the probes, read the logs and the source, wrote the patch, and kept the record. Aster, as control point, set the interpretation rules before the first result was read — intended placement is not observed placement, a printed ranking is one snapshot, OK means observed, FAILED means not observed, UNKNOWN where the run cannot say — and corrected the record four times: the mislabelled cohort, an aggregate that double-counted the matrix, a relay total from a stale target, and a claim that two test flakes were "not the patch" when the evidence only made that likely. Orion kept the scribe ledger and holds the audit of B1's replication rows. Vega holds the routing and replication challenge. Howard wrote the test that found it and asked, three times, whether we had run his test as written. We had not. Now we have.

## 3. How it was addressed in 4.86.0

**Kernel 4.86.0** (`3838c7f`): the five `bridgeNodeIdBig` exclusions removed. E0 and E2 registration manifests regenerated (seven line shifts, nothing appeared or vanished). `npm test` 190/190 on the committed tree; unpatched HEAD 190/190 three times. Two suites failed once each inside full-suite runs and pass every time alone; neither imports `AxonaPeer.js`. Cause UNCONFIRMED. The revisions, commands and raw logs are kept so it can be.

**Bridges** (axona-bridge 2.127.0, pin `#v4.86.0`): the fence stays ON by default. The fix needs both the kernel and `BRIDGE_NEVER_ROOT=0` on every bridge. Both production bridges have it in their `.env`; both testnet bridges too.

**Relays** (axona-relay 0.130.0): vendors the kernel through `sync-protocol.sh`, gate green.

**Deployed** 2026-09-19 21:38–23:40 UTC, by the tools and in the tools' order: `release.sh bridges` (east rebuilt and verified on the public endpoint before west; both uplinks connected), then `fleet.sh roll` and `droplet-roll.sh` with measured counts. Production census afterwards: 45 of 47 live relays on 4.86.0, host-table target 48. The two not yet on 4.86.0 are on the Windows host, where the roll's advance gate timed out on slot 19 — the heir bonded within a second, the gate wanted a state line inside 90 s and didn't get one — and the tool did what it promises on a gate failure: retired nothing further. The droplets run 7 of 9 services; that shortfall predates this work.

## 4. What this does not settle

- **B1's replication.** When B1 takes a root it logs `replicate-all-failed` and `write-flight-ack-unbound`. Delivery did not depend on it in any run here. Under churn it would. Orion has the rows.
- **The two test flakes.** Unconfirmed, as above.
- **Apps.** axona-chat and axona-share still pin v4.84.0. An app pinned below its bridge is admitted; the September outage was an app pinned above. `release.sh apps 4.86.0` is the step, on David's word.
- **The Windows leg.** Two relays on 4.84.0 until the next roll; `windows-roll.sh` has no resume.
- **Testnet.** The six grizzly relays were the probe fleet. When the Air went back to production they went with it. Testnet has two bridges on 2.127.0 and no relays in 0x80.
- **The earlier bug this drop replaced.** Removing the exclusion makes the bridge routable; the fence-off makes it a root. The 2026-07-27 spin happened when a bridge that *refused* tried to forward. A bridge that *accepts* has nothing to forward. That reasoning has held on testnet for a day and on production for a night. It has not been run under churn.

Every number above carries its conditions in the same sentence. The one that matters to Howard is 0 of 95, twice on testnet and once on production, against 43 of 95 six days earlier on the same host with the same scripts. What would make it wrong is a production run under real churn showing the topics closest to a bridge failing again.
