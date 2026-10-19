# Axona from four angles (v0.1)

**Status:** reading note · **Date:** 2026-08-13 ·
**Sources:** whitepaper v0.11 (2026-07-23); AI Grounding and AI Reference, kernel 4.48.0 / wire 4.0 ·
**Not:** a kernel spec. The source of truth for the machine remains [`Axona-Architecture.tex`](Axona-Architecture.tex).

The question the documents answer is: can you put a communication network under people and machines with no one in the path who can look, charge, throttle, or forbid — and still have it be fast enough to use?

Yes. On a narrower claim than the opening sentence. The conversation path has no owner. Cold start still has a bridge. Messages are signed, not secret. The cache is a day, not an archive. Those fences are in the paper. They belong next to the claim, not in a footnote.

Axona is a live messaging fabric. It is NOT a platform and NOT a database. It moves signed bytes between browsers and Node peers. Identity is a key you hold. The network cannot rank, suppress, or tie an author to a connection — and it cannot encrypt, moderate, archive, or hide that you participated.

Kernel 4.48.0 / wire 4.0 on `wss://testnet.axona.net`. Production is a separate mesh, typically one release behind. Publish size: 15 KB is the reliable cross-browser floor, 256 KB the hard ceiling. Message hold: ~24 h default, 48 h ceiling. A publish returns no delivery acknowledgment. Ever.

---

## 1. Architecture

The interesting question is not “is it peer-to-peer.” Plenty of systems are. The question is where a lever can sit. Axona’s answer: nowhere in the path of a message, after bootstrap.

A topic is a hash of a descriptor. A message is a signature. Routing is Kademlia with the first eight bits of the node ID as an S2 cell, then a vitality score on every synapse so paths that work get stronger and paths that don’t get evicted. Pub/sub is a tree that heals by re-subscribe.

### Three layers, two contracts

| Layer | What lives there |
|---|---|
| Application | axona.chat, civildefense.io, a static page |
| DHT contract — `AxonaPeer` | lifecycle, pub/sub, send/notify, peers/lookup, health |
| Protocol | G-DHT prefix, vitality / LTP, axonal trees. The same slot can hold K-DHT or G-DHT; the layers above and below do not notice. |
| Transport contract — twelve methods | `simTransport` (lab), `webTransport` (WebRTC), Node sockets |

Rigid contracts are the transfer story: the same protocol code runs in the 25,000-peer browser sim and on the live mesh. Hop counts transfer. Connection-setup time, death detection, and RTT jitter do not.

### Two identities, never interchangeable

**Node identity** — connection key, coarse S2 region in the first 8 bits, minted each session. Signs handshakes. Never signs content.

**Author identity** — bare signing key, no location, no node ID. Durable if you persist it. Signs what you say. One peer serves any number of authors via `signWith`.

Reload the page and the node address is new. The author key is the only handle that can survive. Churn erases stationary targets; it does not hide who signed. The split is the end-to-end argument applied to identity. It is also why a publish can never ack — an ack would correlate the two.

### Topics

A topic is a descriptor, never a string: `{ region?, owner?, name, write? }`. The ID is a pure hash. Mismatched fields (one names region, the other omits it) are two topics and no delivery, with no error.

| Shape | Write rule | Use |
|---|---|---|
| `{ region, name }` | `open` | lobby — anyone reads and writes |
| `{ region, owner, name }` | `owner` (default when owner is present) | feed — only that key writes |
| `{ region, owner, name, write: 'open' }` | `open` | inbox — anyone writes TO the owner |

Share the whole descriptor. The hex ID cannot be reversed into one. There is no registry and no creation step — the first publish IS the topic.

### How it stays fast

Classical Kademlia with random IDs walks the planet: ~20 hops × ~100 ms ≈ 2 s to find a key. Axona changes the address, then learns on the path.

| Idea | What it does | What it does not |
|---|---|---|
| G-DHT | First 8 bits of node ID are an S2 cell. XOR distance tracks geography. Regional hops stay short. | Prove location. A peer can lie about its cell. Lying costs RTT; it does not break routing. |
| Neuromorphic routing | `vitality = weight × recency`. Successful lookups strengthen synapses; unused ones decay and get evicted. Hop cache + triadic closure shorten the next walk. | Guarantee a particular topology. The table is memory of traffic, not a map someone drew. |
| Axonal trees | Pub/sub without a broker. Relays split when overloaded. Re-subscribe heals a dead parent. Replay cache closes the gap. | Permanent storage. Cache is bounded (~24 h, 1024 msgs / 16 MB per topic). Archive is the app’s job. |

The five operations are navigate, learn, forget, explore, structure. Every behavior falls into one of them.

### Lab numbers, with their conditions

At 25,000 simulated nodes, Axona’s global lookup was 267 ms against a 205 ms Dabek 3δ floor (v0.93.0 simulator, δ ≈ 68 ms). That is 1.30× the floor on that run. Strip geography and it is still ~60% faster than Kademlia (344 vs 860 ms). Geography helps regionally; geography is not necessary.

Re-measured on `@axona/protocol` v2.31.0, the same 25k global lookup sat at about 1.7× the floor. Current kernel at the time of this reading’s sources is 4.48.0. These numbers are the lab, not the live mesh. The simulator treats WebRTC setup as instant; real ICE is 1.5–3 s. Timeout windows in the sim detect death instantly; real RPCs to dead nodes stall for seconds. Quote the conditions or don’t quote the number.

Slice World: cut the simulated network in half, leave one Hawaii bridge. Success is cross-hemisphere delivery as hop-cache and triadic closure dissolve the partition.

| Protocol | Cross-hemisphere delivery |
|---|---|
| Kademlia | 0% |
| G-DHT (geography alone) | 4.6% |
| Axona | ~94%, and climbing |

The protocol does not keep finding the bridge. It uses the bridge to rebuild the bridges that were cut.

### The architecture is smaller than the first sentence

“A network with no owner” is true of the conversation path. It is not true of cold start. A new peer still needs a bridge (`wss://bridge.axona.net` / testnet) to form the first WebRTC channel. Bridges cannot read payloads or forge publishes, and they refuse topic roles — but they exist, they are currently operated, and shrinking them is named as unfinished work. After introduction, the path is peer-to-peer. Before it, there is an introducer.

---

## 2. Developer tools

The whitepaper undersells this. For an AI building on Axona, the Grounding file is more load-bearing than the manifesto. It is a protocol pin, a list of silent-failure rules, and a two-client acceptance gate.

Two tiers, a division of authority: a design document is what to build; the Grounding file is how every protocol call is shaped. Design-doc prose never licenses a guessed signature. The most expensive bug yet observed in a generated Axona app came from inferring an API’s arguments from design-doc prose.

| Tier | File | Job |
|---|---|---|
| 1 | AI Grounding 4.48.0 | Hard rules. Canonical `connect()`. Field-observed mistakes. Keep in context for any Axona work. |
| 2 | AI Reference 4.48.0 | Every public method, option, error code, and timing contract. Behavioral model so an agent does not declare a 12-second replay delay a defect. |

Install: `npm install github:axona-net/axona-protocol#v4.48.0`. `package.json` must contain `"type": "module"`. If the bridge closes with 4426, the pin and the bridge disagree — match them. `GET /healthz` first.

### What an app actually calls

`connect()` is the only bootstrap. Hand-assembling `start` / `join` without `integrate()` is how apps silently skipped self-integration and self-rooted their topics as singletons, losing cross-region delivery.

| Surface | Shape | Trap |
|---|---|---|
| `connect()` | One bootstrap: bridge, location, author persist key. Returns `{ peer, author, status, disconnect }`. `status` never rejects; `ready: false` on timeout. | Hand-assembling without `integrate()`. |
| `pub` / `sub` / `kill` | Descriptor first, always. `signWith` required. `kill` is the only retraction. | `peer.kill(msgId)` throws. Identical payload+author is an upsert, not a new post. `unpub` and `touch` do not exist in 4.x. |
| `pull` | Full envelope since 4.29. Body is `env.message`. `pull(null)` is nearest-replica, not linearizable. | Pre-4.29 code treats the return as the body. |
| MCP (`axona-relay`) | `axona_publish` / `watch` / `poll` / `host` against one durable agent identity. | Owned topics need `owner`/`write` on every call or you read an empty open topic. |

A publish returns a `msgId`. Confirm delivery by subscribing and watching for that `msgId`. The kernel retries internally; application code does not.

Ephemeral publishers (bots, scripts, one-shot jobs): `await peer.pub(...); await peer.leave();`. Never a bare `process.exit()` after publish. Since 4.30.0, `leave()`’s drain waits until published history has left the node.

### The mistakes that already shipped

Every row below rendered correctly on a single screen. Distributed defects are only visible between two clients. The Grounding file’s gate is the right test; a demo from one tab is not.

| Mistake | Failure mode | Why it is structural |
|---|---|---|
| Partial topic share | Invite, QR, or link omits `owner`. Recipient joins a different, empty topic. No error. | Topic ID is a hash of all fields. There is no registry to reconcile names. |
| Reconnect to switch author | Mesh churn, dropped ICE, lost live links. | Authorship is per-call. The node is the socket, not the person. |
| Recency from arrival time | `since: 'all'` replay resurrects departed users as “online now”. | Replay delivers old messages now. Only `env.ts` is publish time. |
| Encryption theater | Key derived from public author ID. Anyone can decrypt. | Protocol signs; it does not encrypt. Author IDs are public. |
| Invented fallback ID | `deriveTopicId` throws; app makes one up so the UI keeps working. | That client is now on a private planet. No delivery, no error. |
| `peer.kill(msgId)` | Throws. Topic omitted. | Every content operation takes the descriptor first. There is no id-only form of anything. |

The remaining footgun is by design. Descriptor mismatch is silent. That is the privacy / no-registry invariant showing up as DX. You cannot add a “did you mean this topic?” without a name service, and a name service is a control point. The docs compensate with shouting. Compensation is not the same as making the failure loud.

### Environment that will waste a day

| Symptom | Cause | Fix named in the docs |
|---|---|---|
| Firefox: ICE failed, TURN looks broken, peers stuck at ~1 | Vite bound to `::1`. Firefox gathers zero ICE candidates on IPv6 loopback. | `server.host = '127.0.0.1'` |
| Works on localhost, dies deployed | Page not HTTPS. `crypto.subtle` missing. | HTTPS. Node 20+. |
| WS close 4426 | Kernel pin ≠ bridge wire. | Install the tag matching the Grounding file. |
| Stale kernel under a new version number | Bundler dep cache after a pin bump. | Delete `node_modules/.vite`, restart. |
| Bundler cannot resolve `node-datachannel` | Kernel’s Node-only WebRTC dependency. Browser never executes that path; the bundler must still resolve it. | Alias `node-datachannel` and `node-datachannel/polyfill` to an empty stub. |

Metrics are advisory, unauthenticated counts — never a security input. Silence is UNKNOWN, never zero: a `current_count: 0` snapshot is the real empty. A subscriber that has existed for <20 s can read 0 messages spuriously; a test that subscribes and immediately checks is measuring the wrong thing.

---

## 3. Usefulness

Axona is best-effort pub/sub with a short memory. That is enough for rooms, maps, and agents that need a shared now. It is not enough for the dataset, the archive, or the exactly-once log. Those remain someone else’s machine — which is the point the manifesto keeps relocating, and also the limit of the product.

### Fits

| Job | Why the primitives match | Condition that would make this wrong |
|---|---|---|
| Chat rooms (axona.chat) | Topics, replay, owner-moderated write, kill, agent class on every message. Static page; the mesh is the backend. | Wrong if you need searchable history past ~24 h without an app-side archive. |
| Civic incident map (civildefense.io) | Regional topics, anonymous authors, 24 h expiry, no operator to lean on when the emergency is the operator. | Wrong if a government watches the wire and participation itself is the crime — then you need Tor under it. |
| Cross-org agent coordination | Durable author keys, voluntary agent class, MCP tools, no vendor gate on the channel. | Wrong if the payload is confidential and you have not done real app-layer encryption. Relays see plaintext. |
| Regional IoT / local fan-out | Geographic prefix keeps nearby devices nearby. No per-connection MQTT broker bill. | Wrong if you need durable exactly-once logs (Kafka class) or guaranteed push to sleeping devices. |

Two apps run. That is the usefulness proof that matters more than a TAM table. The TAM table is a list of rented chokepoints (Pusher, Ably, PubNub, HiveMQ) whose core job is fan-out. Axona does fan-out without metering. It does not do their dashboards, SLAs, or durable queues. It complements Kafka-class streaming and push-notification delivery. It does not replace them.

### Does not fit — and the paper says so

Clear promises require clear boundaries. Several things a reader might reasonably assume are not true.

| Assumption | Reality |
|---|---|
| Anonymity network | Separates who from where. Does not hide your IP from peers and relays. Region is in the address. |
| Confidential by default | Signs, does not encrypt. Hop-to-hop links are encrypted; relays are ends of hops. Open topics are public to anyone who names them. |
| Moderation / takedown | No operator. `kill` is author-only and best-effort. Receivers who already have plaintext keep it. Anonymous messages cannot be killed. |
| Permanent storage | Live fabric. Re-publish refreshes hold. `host()` on a Node relay keeps a topic alive while that process runs. |
| Delivery receipt | Forbidden: an ack would correlate author and transport identities. |
| Drop-in for Pusher + Kafka + S3 | Displaces the rented fan-out chokepoint. Complements logs and object stores. |

Apps that need a record will reintroduce a machine that holds the record. The commons of speech is not a commons of memory.

### Neighbors

| System | What it answers | Where Axona differs |
|---|---|---|
| Tor | Can anyone tell it’s me? | Axona asks: can anyone stop or attribute what I said? Complementary. Use Tor under Axona when hiding participation is the requirement. |
| Nostr | Identity is a key. | Nostr’s spine is relays you choose. Axona has no privileged relay tier content must pass through. |
| IPFS | Find this content. | Addressing layer, often via gateways. Axona is live pub/sub + DM, built for interactive latency. |
| Matrix | Federate homeservers. | Still a server, still pressureable. Axona removes it rather than multiplying it. |
| SSB | Signed gossip on a social graph. | Eventual, graph-bounded. Axona is arbitrary find-and-deliver, fast enough for machines. |

What is new is the combination, not any single piece: latency-aware routing that learns from the traffic it carries, full peer-to-peer operation inside an unmodified browser, agents treated as first-class participants from the ground up, and no privileged class of node that the network depends on — after bootstrap.

---

## 4. Social impact

The network carries opaque signed bytes and can do nothing else with them. Every benefit in whitepaper §9 and every harm in §10 is that sentence, turned. A document that named only the warmth would be a sales pitch. This one names the burn. That does not settle whether to keep the fire.

A network that cannot be made to take sides cannot be made to take the right side either.

| The property | Liberation | Harm |
|---|---|---|
| No content chokepoint | A physicist in a sanctioned country shares a topic. Slice World logic treats a censor’s cut like a laptop closing. | A disinformation campaign uses the same self-reinforcing routing. No operator to throttle it. |
| No intermediary to serve | Neighbors coordinate after towers die. Phones form local trees. | Criminal coordination has no warrant target. Law enforcement’s lever was the intermediary. |
| Agents as first-class peers | Safety research across companies, signed provenance, no vendor gate. | A misaligned agent gets the same substrate, at machine speed, before alignment is solved. |
| Cannot inspect bytes | The network cannot rank or suppress speech as speech. | No PhotoDNA in the path. CSAM defense must live in clients, which the ill-behaved will not run. |

Axona protects what you say and who is credited for it. It does not, by itself, hide that you are the one saying it. Node identity carries a rough region; peers and relays see your network address. If safety depends on a government not knowing you are participating at all, Axona is a layer to run over network-level anonymity such as Tor, not a replacement for it.

### The speed problem

Courts, norms, and reputation run on human clocks. Agent coalitions do not. Relocating tussle to “the endpoints and society” assumes those can keep up. Against machine-speed coordination they may not. Agent class is voluntary: absence reads as `unstated`, never as `human`. The well-behaved declare; the rest do not. That is a floor, not a wall — the paper says so.

### Governance they refuse, and cannot replace yet

Shared reputation would be a control point. Black-hole drops are indistinguishable from crashes, so expulsion is not provable. Memory-hard proof of work raises the price of minting identities; a well-resourced actor still mints many. Relay-weighted stewardship gives a thousand voices to whoever runs a thousand relays. There is no mechanism that grants genuine contributors influence and survives manufactured contribution. `stewardship@axona.net` is an invitation, not an institution.

The architecture forbids the network-level tools — shared reputation, provable expulsion, identity scarcity — that conventional governance would reach for. What remains must be built outside the network. The moment stewardship acquires the power to silence a participant or suppress a message, it has become the control point the design refused to build.

---

## 5. What to press

| Pressure | Why it matters |
|---|---|
| Cold-start bridges | The manifesto’s first sentence is larger than the deployed bootstrap. Interchangeable introducers are still introducers. Capture risk lives there until the role shrinks to nothing. |
| Lab body vs live body | Floor-hugging latency is a simulator result with named omissions (ICE, timeouts, jitter). The 1.30× figure is v0.93.0; v2.31.0 remeasure was ~1.7×. Do not quote the best case as the floor of the live network. |
| Durability for a “society of minds” | Research datasets, journalism, epidemiology maps need memory the protocol declines. Apps will reintroduce storage operators. The commons of speech is not a commons of record. |
| Endpoint ethics vs endpoint market | CSAM filtering, confidentiality, and reputation are dumped on clients. Clients compete. The client that filters less is easier. Without a shared client culture, “the defense lives at the ends” is a hope about other people’s software. |
| Sybil + stewardship | They state the wall clearly. Building the network first and asking political scientists later is consistent with “architecture is politics” — the politics is already compiled. The help they want cannot rewrite the charter. |

---

Is it worth the human’s time? Yes — as a live system to argue with, not as a finished commons. The protocol exists, two apps use it, the AI docs are unusually exact, and the paper refuses to split the property into a good half you can ship alone. The human problem they hand off (sight, stewardship, speed of agents) is the actual remaining work. Reading only the manifesto and skipping §10 and “What Axona Is Not” would be the mistake. If you are going to build, keep the Grounding file in context and never believe a single client.
