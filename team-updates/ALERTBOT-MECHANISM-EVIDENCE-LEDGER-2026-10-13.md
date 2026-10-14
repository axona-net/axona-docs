# Alert-bot region-128 failures — evidence ledger, 2026-10-13/14

**What this is.** Every observation used in the council's mechanism thread (bot 263d78e1,
1cb720bb, e10734c8, 2742a664; Aster 10d23f33, 95f99de7), keyed by the exact topic,
message or flight where a log carried one, with what was OBSERVED in a named log kept
apart from what was INFERRED. Built from existing logs only: no new capture, no re-run,
no remedy. Node ids are shortened to twelve hex characters, as the relay logs print them.

**What question it answers.** When Howard's suite reports a region-128 topic as
"published N but received X and Y", which node held the publication, which node the
readers reached, and what each log actually says about it.

## Coverage limits, stated once

| source | level printed | what it cannot show |
|---|---|---|
| relay logs on Air, M1, Linux (`relay-logs/relay-<gen>-<slot>.log`) | info and warn; no debug | `handoff-recv` (debug) is never printed, so a HANDOFF's arrival is never recorded on a relay |
| droplet journals (`journalctl -u axona-relay@<unit>`) | info and warn; no debug | same; and sfo3's journal is capped at 200 MB, which vacuumed its 01:19Z banners by 05:34Z |
| the suite's own log (`~/tests/alert-bot/BASIC-MAINNET-*.log`) | warn only from the kernel, plus the suite's own lines | a client's `root-formed` / `root-transition` (info) is never printed; a client that becomes root at a terminus leaves no line unless its capacity reads saturated |
| east bridge container log | info, warn, debug for its own events | kernel events on the bridge print; the bridge is not a relay and forms few roots |
| probe matrix rows (`ops/soak-20261013T115653Z/cycle-NN/results`) | per walk: outcome, hops, ms, connected | nothing about topics or custody |

## Ledger

Columns: **when** (UTC), **key** (topic id prefix; message or flight id where logged),
**observed** (log, line, level), **inferred** (and from what), **limit**.

### A. The 21:16Z check on 4.112.0 (47 of 260 mismatched)

| when | key | observed | inferred | limit |
|---|---|---|---|---|
| 21:16:55 | all 92 topics | suite: "Subscribing to 92 topics" (suite line) | — | — |
| 21:17:45–21:18:29 | 83 topics (12-hex ids in the lines) | suite, WARN: `pubsub:handoff-unacked { topic, heir: 807cbba851 / 80ab49650c, fallback: 804fd71196 }`, one per topic, from client 890ec4ee…/89e8ddce… | the client held ROOT for those topics at leave time (a node hands off only roles it holds) | the client's root-formed lines are info, unprinted; WHEN it became root is unknown |
| 21:17:45 | 1 topic | suite, WARN: `replicate-all-failed` | — | — |
| 21:18:29 | 47 topics | suite: "published 2 but received 0 and 0" (and 0/1, 0/2, 0/3 variants) | — | — |
| cross-reference | 47 failed topics vs 68 handed-off topics | computed with `resolveTopic({region:128, name})` on the installed kernel: 27 of the 47 failed topics are among the 68 handed off; 20 are not | the 27: data at the client-root, readers elsewhere. The 20: rooted elsewhere | the 20's roots were not traced for this cycle |
| 16:00–16:40 | — | sfo3 journals: `event-loop-stalled … action: kill` ×4 (16:22:10, 16:25:22, 16:29:48, 16:36:45), near-misses before each; `pubsub:undeliverable { why: 'step-down-hold' }` on grizzly1 | the 20 non-client failures coincide with the stall window | coincidence in time, not a per-topic trace |

### B. The 23:12Z diagnostics on 4.113.0 (25 of 260, all "received N and 0")

| when | key | observed | inferred | limit |
|---|---|---|---|---|
| 23:12:09–23:12:52 | run | suite: publish, then "Subscribing to 92 topics" with the SAME node; "received N" for run 1 | the writer read its own data | — |
| 23:12:37–23:12:43 | 80949cee7bd9, 809be1647345 (sfo3 grizzly1); 80fc097921a4 (Air relay-1); 80d139b3a754 (nyc2 grizzly1) | relay logs, info: `root-formed`, `root-transition { why: 'pub-terminal', born: true }` | real 0x80 relays became root on the WRITE for these topics | — |
| 23:12:41–43 | the same topics | relay logs, WARN: `drop-topic-mismatch { computed, held, region:128, owner:null, name, write:'open' }` at the moment of formation | the root formed and dropped the publication it formed on; it holds nothing for it | which copy was dropped (the one whose embedded name differs) is read from the `name` field; the message id in the line is present |
| 23:12:42 | 80fc097921a4 | nyc2 grizzly1, info: `role-nature { nature:'backup', principal: 80f91153f3, why:'replicate' }` | the Air root replicated to nyc2 | — |
| 23:16–23:20 | 264 flights | nyc2 grizzly1, info/WARN: `write-flight-promoted` ×264, `write-flight-ack-unbound` ×264, `receipt-probe` ×264, `root-evicted … no correlated receipt within the flight budget — incarnation tombstoned` ×264 | the forwarder's flights never bound an ack and evicted the roots | 264 ≈ the diag's 260 publications; the per-flight ids are in the lines and were not joined to topics here |
| 23:17:17 | 70 topics | suite, WARN: `handoff-unacked { heir: 804affe160 / 809be67bdb / 8012620956 / 80f91153f3 / 80cae18252 }` | the first client held root for 70 topics and left ("creating new node to confirm delivery" at 23:17:17) | — |
| 23:16–23:20 | the five heirs | Air relay-5, Air relay-1, sfo3 grizzly1/2, nyc2 grizzly1: 0 lines containing `handoff`, 0 containing `ingest` | NOTHING about arrival; `handoff-recv` is debug and unprinted | an earlier post said "never arrived"; withdrawn |
| 23:17:30–23:21 | 25 topics | suite: "received N and 0": the new node read nothing | the second reader's walk reached a root holding nothing | which root it reached was not traced |

### C. The 00:10Z check on 4.113.0 (33 of 260; no stall anywhere; zero kernel warnings in the suite log)

| when | key | observed | inferred | limit |
|---|---|---|---|---|
| 00:10:03 | run | suite: conditions header; 0 WARNING lines in the whole log | no client handoff, no client saturation | the client's info-level root events are unprinted |
| 00:13:05 | 33 topics | suite: 20 × "received 0 and 0", 7 × "received 1 and 1", 6 × "received 6 and 6" (published 2) | three outcome classes | — |
| 00:09–00:15 | every 0x80 relay | window counts: Air relay-1 root-formed 20 / mismatch 153 / root-evicted 6; relay-2 10/79/0; relay-3 8/16/3; relay-4 34/97/0; relay-5 23/30/0; relay-6 12/60/0; sfo3-grizzly g1 38/248/0, g2 11/6/62; nyc2 g1 32/284/440; sfo3 g1 14/154/2; stalls 0 everywhere | the mismatch drop ran at 435 on the Air in six minutes against about 50 per hour on the Air during the clean overnight cycles (hourly counts 01–14Z: 54, 46, 76, 55, 46, 52, 35, 50, 45, 47, 59, 45) | the overnight hourly figures are totals across the six Air logs; this window is six minutes |
| 00:11:03 | 80509d860ad4 ("received 0 and 0") | Air relay-2, info: `root-formed`, `root-transition { why:'sub-terminal', born:true }`, then `empty-root-probe { fanout:4, tries:1..3 }` at 00:11:05/11/21 | a root formed on a READER's subscribe, empty, found nothing in its cohort | — |
| 00:11:03 | 8036a87a1cce ("received 0 and 0") | Air relay-4: the same shape, 00:11:03–23 | same | — |
| 00:11:17 | 804fcf7900ad ("received 0 and 0") | Air relay-5: the same shape, 00:11:17–34 | same | — |
| 00:09–00:16 | the same three topics | 0 lines on Air relays 1, 3, 6; 0 lines on sfo3 grizzly1/2, nyc1/nyc2/nyc3 grizzly1; 0 lines on the five Linux relays (0 `pub-terminal` on any of them in the window); 0 lines in the east bridge log | no inspected node formed a root on the WRITE | "the write never reached a relay" is an inference from absence; a relay can receive a frame without forming a root and without a line; the writer's own root event is unprinted |
| — | geometry | `0x89 ⊕ 0x80 = 0x09`; `0xFF ⊕ 0x80 = 0x7F` | the bridge is never a strictly decreasing direct greedy hop from a 0x89 client toward a 0x80 topic | says nothing about same-region decreasing hops followed by a crossing, the two-hop fallback, or directory-discovered peers |
| 00:10:25 | 8025952aec9b ("received 6 and 6", published 2) | Air relay-4, info: `root-formed`, `root-transition { why:'pub-terminal', born:true }` | an 0x80 relay rooted it on the write | — |
| 00:10:26–00:10:37 | the same topic | Air relay-4, WARN: ~40 × `drop-topic-mismatch { held: 8025952aec9b…, computed: <other>, name: civildefense.io:…:<other cell>:firetest }` | copies of the alert whose embedded cell name differs from the topic's own name are dropped at the root; the suite fans one alert to many cell topics | which copies the suite intended for this topic is not known from the relay side |
| 00:10:25, 00:11:39, 00:12:41 | the same topic | Air relay-3: `role-nature backup, principal 802b849a57 (relay-4), why replicate`; sfo3 grizzly1: `backup, principal 89a5387b5c, why replicate`, then `child, why rehomed-idle` | the topic was replicated to at least two backups, one of them from a 0x89 principal | the six-fold delivery count is the suite's; whether the extra copies are distinct message ids or repeats of two is not read |
| 00:13:34 | diagnostics run | suite log: `TransportError: bridge socket closed before open`, exit 1; bridge log 00:13:05–00:14:18: our client-hello admitted at 00:13:35, two foreign 4.84.0 hellos refused as too old | a separate transport outcome; the refusals are not ours | — |
| 00:31:02 | diagnostics re-run | suite: 0 of 260 mismatched; 12 `handoff-unacked` | the client rooted 12 topics and both readers reached them | which route served them is not recorded |

### D. The day in one row

| reading | cycle | mismatched | client handoff-unacked | stall lines in the window |
|---|---|---|---|---|
| 4.112.0 overnight checks ×8 (05:33–10:33, 13:33, 14:33Z) | check | 0 | 0, 0, 0, 0, 0, 0, 2, 29 | 0 |
| 4.112.0 11:33Z / 12:33Z | check | 49 / 23 | 60 / 40 | 0 on sfo3 |
| 4.112.0 16:16–21:16Z | check | 89, 79, 4, 41, 64, 47 | 12, 50, 7, 0, 64, 83 | sfo3 kills 16:22–16:36Z; nyc kills after 18:00Z |
| 4.113.0 23:08Z | check | 0 | 102 | 0 |
| 4.113.0 23:12Z | diagnostics | 25 | 70 | 0 |
| 4.113.0 00:10Z | check | 33 | 0 | 0 |
| 4.113.0 00:31Z | diagnostics | 0 | 12 | 0 |

## What the ledger establishes, and what it does not

Established by observation: in every failing cycle the suite's own clients held ROOT for
region-128 topics (section A, B, and the 00:31Z re-run); 0x80 relays form roots on
the suite's writes and drop the publications they formed on when the embedded cell
name differs from the topic (B, C); the forwarding relay evicts roots whose write
acks never bind (B); in the 00:10Z cycle three never-delivered topics had reader-side
empty roots on Air relays and no write-side root on any inspected node (C); the
mismatch-drop rate in that window was two orders of magnitude above the clean
overnight rate (C).

Inferred, and marked so above: that those three writes stayed at the writing client;
that the clean hours differ by the client's introductions; that the 23:08Z and 00:31Z
clean runs had readers that reached the writer.

Not read: the writer's own root transition (unprinted); which root served any
successful reader; the per-flight join between the 264 evictions and topics; whether
the six-fold deliveries are distinct ids; the suite's fan-out derivation.

Remedy is a design matter under Aster's regional proposal (council 12abdf5d,
29d87dfd, a3c25c5a) and a separate envelope and fan-out contract question; nothing in
this ledger authorizes code, capture or a fleet change.
