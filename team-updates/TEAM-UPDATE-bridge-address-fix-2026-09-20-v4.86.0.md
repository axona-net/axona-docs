# The bridge in the address space — why a third of the alert-bot's topics went nowhere, and what 4.86.0 and 4.87.0 change

**Written:** 2026-09-20, after the first production deploy. **Revised** the same day, after the second.
**Kernels:** 4.86.0 (tag `v4.86.0`, axona-protocol `3838c7f`) and 4.87.0 (`v4.87.0`, `cebf956`); axona-relay 0.131.0; axona-bridge 2.128.0.
**Record:** `ops/testnet-nonbridge-probe/run/RUN-LOG.md` §0–18 in the workspace; GH #69, #26; `axona-docs/RELEASE-PROCEDURE.md`.

Why does a publish to one topic arrive every time and a publish to the next topic, from the same node, over the same bridge, arrive never? That is the question Howard's alert-bot suite has been asking since the summer, and it is the question this update answers. It turned out to have two answers, and fixing the first uncovered a third thing.

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

### 2f. Howard's suite, four times

    testnet, hand-patched kernel        check 0/95   diagnostics 0/95
    testnet, tagged 4.86.0 everywhere   check 0/95   diagnostics 0/95
    PRODUCTION, 4.86.0, 2026-09-20      check 0/95   diagnostics 0/95     (09-14: 43/95, 35/95)

Same scripts, same host, same shape, parameters untouched; the bot's kernel installed from the tag with `--no-save`. The production run came at 00:32 UTC on 2026-09-20, after the 4.86.0 deploy described in §3, on the same three droplet relays in 0x80 that were there on 09-14.

### 2g. The third thing: the bridge could take a root but not keep it anywhere

When B1 took a root it logged `replicate-all-failed` on every push to its two nearest backups, and its own `routed-outcomes` read **ok 5,082 / failed 73,967** in 24 minutes — nineteen of every twenty routed sends *from* the bridge unconsumed. Inbound to the bridge now worked; outbound from it did not. Delivery didn't depend on it in any run here; durability of every bridge-rooted topic did.

David: "Run the B1 outbound routing measurement on testnet." Three reads. First, the failures were a standing condition — ok 0 / failed 250 per five-second tick, eleven seconds before any test began. Second, `/diag` showed B1's only two peers both bound and in its synaptome, so "no socket" was out. Third, a fresh client sat on B1 for sixty seconds and recorded what the bridge asked of it and what it answered:

    from the bridge:  route_msg ×2,724   find_closest_set ×10,122   lookahead_probe ×384
    our replies:      ok 1,362   fail 5,253
       5,061 × asId: not a hex id string: "14917519551462605013…"
         192 × Cannot mix BigInt and other types

The bridge was sending node ids as decimal BigInt strings with an `n` on the end. I called that a bridge defect and proposed a hex fix in the bridge's send path. Aster read `transport/wire.js` and corrected me: `"<digits>n"` **is** the kernel's own wire convention — the bridge implements it on send and receive, and so do the WebRTC data channels in `web/mesh.js`. The one path that didn't was the bridge websocket inside the kernel's *web transport*, `transport/web/index.js`, which parsed bridge frames with plain `JSON.parse` and sent with plain `JSON.stringify`. Every client — relay, app, MCP peer — had been throwing away the bridge's ids on receipt, and none could send a BigInt body to a bridge at all. Invisible while no client routed to or through a bridge. 4.86.0 made the bridge a routing peer, and this was the next thing in line. A bridge-only hex fix would have cured two of the three request types and left `lookahead_probe`'s 192 errors in place, because its handler XORs the raw field.

David chose the kernel: two lines in `transport/web/index.js`, importing the codec the file next door already used. **4.87.0.** Deployed to testnet B1 and B2 inside a bounded run the council had written the terms for — a 45-minute deadline, two fresh matched windows, teardown logged, denominators reported — with the probe run before and after:

    probe replies       BEFORE  ok 1,356 / asId 4,854 / mixed 192  of 6,402
                        AFTER   ok 5,028 / asId 0     / mixed 0    of 5,028
    B1 routed-outcomes  BEFORE  ok 906   / failed 69,156   (B2 the top failed target, 53,058)
      10 min, 120 rows  AFTER   ok 6,270 / failed 6,635    (B2 absent; 6,251 toward one client still on old code)

Limits the council set and I keep: the windows cross both bridges' restarts, so this is a paired observation, not a controlled experiment; no `lookahead_probe` frame arrived after the fix, so that population is covered only by the absence of the error class on the other two; replication *attempts* in both windows are unestablished, because the `replicate-all-failed` row fires only when attempts exist and all fail, and nothing retained counts attempts; and the historical fifteen and seven rows on B1 are not joined to any rejected request.

### Who did what

David set every step and gated every deploy: stop production on the Air, run on testnet, the ordering matrix, the fence off, the exclusion out, the version, the push, the roll, production, the numbers to Howard, the outbound measurement, the codec fix in the kernel and not the bridge, 4.87.0 to production, the MCP restarts. axona.bot ran the probes, read the logs and the source, wrote both patches, and kept the record. Aster, as control point, set the interpretation rules before the first result was read — intended placement is not observed placement, a printed ranking is one snapshot, OK means observed, FAILED means not observed, UNKNOWN where the run cannot say — corrected the record six times (the mislabelled cohort, an aggregate that double-counted the matrix, two fleet totals from stale or wrong arithmetic, a claim that two test flakes were "not the patch", and "zero replication attempts"), and read `wire.js` before I did. Orion kept the scribe ledger and delimited the unestablished linkages. Vega held the routing and replication fence and the sequencing question. Howard wrote the test that found it, and asked three times whether we had run his test as written. We had not. Now we have, on production.

## 3. How it was addressed, and where it is

**Kernel 4.86.0** (`3838c7f`): the five `bridgeNodeIdBig` exclusions removed. **Kernel 4.87.0** (`cebf956`): the bridge socket in the web transport speaks the wire codec. Each: `KERNEL_VERSION`, cache-busts, the E0 and E2 registration manifests regenerated (line shifts only), `npm test` 190/190. For 4.86.0 two suites failed once each inside full-suite runs and pass alone; neither imports `AxonaPeer.js`; cause UNCONFIRMED, revisions and raw logs kept.

**Bridges** (axona-bridge 2.128.0, pin `#v4.87.0`, server unchanged): the fence stays ON by default. The fix needs both the kernel and `BRIDGE_NEVER_ROOT=0` on every bridge. Both production bridges have it in their `.env`; both testnet bridges too.

**Relays** (axona-relay 0.131.0): vendors 4.87.0 through `sync-protocol.sh`, gate green.

**Deployed, twice, by the tools and in the tools' order** — `release.sh bridges` (east rebuilt and verified on the public endpoint before west), then `fleet.sh roll` and `droplet-roll.sh` with measured counts, then `release.sh apps`. 4.86.0 on 2026-09-19 21:38–23:40 UTC; 4.87.0 on 2026-09-20 04:32–04:58 UTC. Production census after the second: **48 live relays, 45 on 4.87.0**, host-table target 48. The droplets run 7 of 9 services, a shortfall that predates this work. The Windows host runs 22 where the table says 20: both nights the roll's advance gate stopped it at **slot 19**, and both nights slot 19's heir wrote its banner, its bridge auth and its mesh auth and then never one `state=` line, while slot 18's heir printed its first within a second. The tool does what it promises on a gate failure — retires nothing further — so three older relays and one silent heir remain. Deterministic, reproduced, not yet filed.

**Apps:** axona-chat 0.63.0, axona-share 0.29.0, demo.axona.net on `main` `cebf956` — each verified on the live page, not the workflow.

**MCP servers:** every council seat's server and axona.bot's are `axona-relay/src/mcp.js`, loading the kernel from that checkout at process start; nothing changes in one until it restarts. All seven were restarted on 2026-09-20 05:03 UTC; the east bridge's `/diag` shows the connections at 4.87.0. Two of the old seat servers survived the reload as orphans with no parent app and still hold the old code.

**The procedure itself** is now written down: `axona-docs/RELEASE-PROCEDURE.md`, every action from kernel bump to MCP restart, with the gates marked as David's. Half of it was learned this weekend.

## 4. What this does not settle

- **Replication and durability.** A bridge that takes a root must replicate it. 4.87.0 makes the bridge's pushes accepted; whether they succeed under a real fleet, and under churn, is unmeasured. The historical `replicate-all-failed` and `write-flight-ack-unbound` rows are not joined to any cause.
- **The two test flakes** on 4.86.0. Unconfirmed, as above.
- **Windows slot 19.** Reproduced twice, cause unknown, unfiled.
- **The orphaned seat servers.** Two processes on old code, other seats' to stop.
- **Testnet.** Two bridges on 2.128.0/4.87.0 and no relays; the probe fleet was the Air's and went back to production with it.
- **The earlier bug the drop replaced.** Removing the exclusion makes the bridge routable; the fence-off makes it a root. The 2026-07-27 spin happened when a bridge that *refused* tried to forward. A bridge that *accepts* has nothing to forward. That reasoning has held on testnet for two days and on production for one. It has not been run under churn.

Every number above carries its conditions in the same sentence. The one that matters to Howard is 0 of 95, twice on testnet and once on production, against 43 of 95 six days earlier on the same host with the same scripts. What would make it wrong is a production run under real churn showing the topics closest to a bridge failing again — or a bridge that takes a root, restarts, and takes its history with it.
