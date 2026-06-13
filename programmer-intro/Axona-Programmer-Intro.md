---
marp: true
size: 16:9
theme: default
paginate: true
header: ""
footer: "AXONA · Programmer Intro · v0.4"
style: |
  /* ── Tufte-inspired typography + cream paper ─────────────────── */
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=Inconsolata:wght@400;500&display=swap');

  section {
    background: #fffff8;
    color: #1a1a1a;
    font-family: 'EB Garamond', Georgia, 'Goudy Old Style', serif;
    font-size: 18px;
    line-height: 1.5;
    padding: 36px 56px 32px 56px;
    overflow: hidden;
  }
  section h1, section h2, section h3 {
    color: #111;
    font-weight: 600;
    margin: 0 0 0.4em 0;
    letter-spacing: -0.005em;
  }
  section h1 { font-size: 34px; }
  section h2 {
    font-size: 14px; color: #888; text-transform: uppercase;
    letter-spacing: 0.12em; font-weight: 500; margin-bottom: 0.2em;
  }
  section h3 { font-size: 18px; font-weight: 500; color: #555; }

  /* Two-column Tufte grid */
  .tufte {
    display: grid;
    grid-template-columns: 1.55fr 1fr;
    column-gap: 38px;
    height: 100%;
  }
  .main { padding-right: 6px; }
  .main ul, .main ol { padding-left: 22px; margin: 0.4em 0; }
  .main li {
    margin-bottom: 0.9em;
    color: #3a3a3a;
    font-size: 15px;
    line-height: 1.5;
  }
  .main li > .head:first-child {
    display: block;
    font-size: 32px;
    font-weight: 600;
    color: #0c0c0c;
    margin-bottom: 0.28em;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .main p { margin: 0.25em 0; }
  .margin {
    border-left: 1px solid #d8d4ca;
    padding-left: 28px;
    font-size: 13px;
    color: #444;
    line-height: 1.45;
  }
  .margin h4 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    color: #888; margin: 0.9em 0 0.25em 0; font-weight: 600;
  }
  .margin h4:first-child { margin-top: 0; }
  .margin p { margin: 0.3em 0; }
  .margin ul { padding-left: 16px; margin: 0.3em 0; }
  .margin li { margin-bottom: 0.3em; }
  .margin a { color: #2d7373; text-decoration: none; border-bottom: 1px dotted #c0bcb0; }
  .margin table { font-size: 11px; border-collapse: collapse; margin: 0.3em 0; width: 100%; }
  .margin th, .margin td {
    padding: 2px 6px; border-bottom: 1px solid #e6e2d4; text-align: left;
  }
  .margin th { color: #777; font-weight: 600; }
  .margin tr.hi td { color: #2d7373; font-weight: 600; }
  .margin code { font-family: 'Inconsolata', Menlo, monospace; font-size: 0.92em; background: #f0ecdf; padding: 1px 3px; border-radius: 2px; }
  .main code { font-family: 'Inconsolata', Menlo, monospace; background: #f0ecdf; padding: 1px 4px; border-radius: 2px; font-size: 0.92em; }

  /* Title slide */
  section.title {
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 80px;
    position: relative;
  }
  section.title h1 {
    font-size: 110px; letter-spacing: -0.025em; line-height: 1.0;
    margin-bottom: 0.05em; font-weight: 500;
  }
  section.title h2 {
    font-size: 24px; color: #555; font-weight: 400;
    text-transform: none; letter-spacing: normal; margin: 0.2em 0 0.8em;
    max-width: 60%;
  }
  section.title .tagline {
    font-size: 18px; color: #2d7373; font-style: italic; margin-bottom: 2em;
    max-width: 60%;
  }
  section.title .meta {
    font-size: 13px; color: #888; line-height: 1.7;
    max-width: 60%;
  }
  section.title .meta a { color: #2d7373; text-decoration: none; }
  section.title .sidebar {
    position: absolute;
    right: 80px;
    top: 50%;
    transform: translateY(-50%);
    width: 290px;
    font-family: 'EB Garamond', Georgia, serif;
    font-size: 13.5px;
    line-height: 1.6;
    color: #3a3a3a;
    border-left: 1px solid #c0bcb0;
    padding-left: 22px;
  }
  section.title .sidebar strong { color: #111; }
  section.title .sidebar em { color: #555; font-style: italic; }

  /* Emphasis palette — restrained per Tufte */
  strong { color: #111; font-weight: 600; }
  em { color: #555; font-style: italic; }
  .accent { color: #c0392b; font-weight: 600; }
  .num { color: #2d7373; font-weight: 600; }

  /* Final-page closing statement, centered across full slide width.
     Positioned in the gap between marginalia bottom and the footer
     pagination row. Compress slide-9 marginalia if needed. */
  .closing-statement {
    position: absolute;
    bottom: 22px;
    left: 56px;
    right: 56px;
    text-align: center;
    font-size: 24px;
    font-style: italic;
    color: #111;
    letter-spacing: -0.005em;
    line-height: 1.2;
  }

  blockquote {
    border-left: 2px solid #c0bcb0;
    padding: 0.1em 0 0.1em 14px;
    color: #555; font-style: italic; margin: 0.4em 0;
  }
  section::after { color: #b0a890; font-size: 11px; font-style: italic; }
  footer { color: #b0a890; font-size: 11px; font-style: italic; }
  .main pre { background:#f6f4ec; border:1px solid #e0dccf; border-radius:4px; padding:7px 10px; margin:6px 0; overflow:hidden; }
  .main pre code { font-family:'Inconsolata', Menlo, monospace; font-size:12px; line-height:1.5; color:#222; background:none; padding:0; }
  .codecap { font-size:12.5px; color:#666; margin:8px 0 2px 0; }
---
<!-- _class: title -->
<!-- _paginate: false -->
<!-- _footer: "" -->

# AXONA

## A programmer's introduction

<div class="tagline">Self-authenticating, geo-aware pub/sub that runs in a browser tab — with no platform in the middle.</div>

<div class="meta">

June 2026 · v0.4 · a ~30-minute talk
Live: <a href="https://demo.axona.net/apps/axona-minimal/">demo.axona.net/apps/axona-minimal</a> · Docs: <a href="https://github.com/axona-net/axona-docs">github.com/axona-net/axona-docs</a>

</div>

<div class="sidebar">

You'll leave with a working mental model of the network, the small API you actually call, and an app you watched run live — <strong>Axona Minimal</strong>, about sixty lines, publishing and subscribing over the real mesh.

</div>

---

<div class="tufte">
<div class="main">

## 1 / Overview

# What Axona is

- <span class="head">A peer-to-peer pub/sub bus.</span> Any peer publishes to a topic; any peer subscribes; messages flow peer-to-peer over an encrypted WebRTC mesh. No broker in the path.
- <span class="head">Self-authenticating.</span> A peer's identity <em>is</em> its keypair, and its address is derived from its public key and verified directly. No account, no certificate authority, no registrar.
- <span class="head">It runs in a browser tab.</span> Pure JS/WASM; the same kernel runs in Node and in the simulator. The cost of entry is a keypair and a page.

</div>
<div class="margin">

#### The shift

A hosted broker — Pusher, Ably, a Kafka cluster — is a company you trust and a switch someone can flip.

Axona moves that function <em>into the participants</em>. Nothing to sign up for, nothing to revoke through, and no chokepoint to censor or seize.

#### Live now

The first version is in the wild; anyone can connect.

</div>
</div>

---

<div class="tufte">
<div class="main">

## 2 / How it works

# Addresses are places

- <span class="head">A node id is 264 bits.</span> Top 8 = your S2 geographic cell, the rest = SHA-256 of your key. XOR distance on that top byte makes routing favor locality.
- <span class="head">A topic id, same shape — you pick the region.</span> The S2 prefix is the publisher's choice, not your own cell, so a topic roots anywhere (the demo: us-east).
- <span class="head">The publish id carries no geography.</span> Just the signing key — no S2 prefix — so a post proves <em>who</em> wrote it, never <em>where</em> they are.

<img src="../images/Node-Address.svg" alt="node id, topic id, and publish id bit structure" style="width:90%; margin-top:8px;" />

</div>
<div class="margin">

#### 192 cells cover the planet

<img src="../images/S2-Map.png" alt="S2 region cells over a world map" style="width:100%; border:1px solid #d8d4ca; margin-bottom:6px;" />

A node roots the topics near it; a sparse region's root set simply spills to the nearest neighbors. Geography is a routing hint, not a border.

</div>
</div>

---

<div class="tufte">
<div class="main">

## 3 / How it works

# The mesh, and how a message travels

- <span class="head">A bridge bootstraps; the mesh carries.</span> A WebSocket bridge introduces peers and relays signaling — a rendezvous, not a router. Peers form a WebRTC mesh and reach any id in a few hops via a learned routing table.
- <span class="head">Topics have a root set.</span> The R nodes closest to a topic id replicate it. A publish lands on the roots and fans out down a tree to the subscribers.
- <span class="head">It heals.</span> Gap-safe replay, root-to-root anti-entropy, and kill convergence keep replicas consistent — a missed message is backfilled, a retraction stays retracted.

</div>
<div class="margin">

<img src="../images/Architecture-Layers.png" alt="kernel / protocol / transport / bridge layers" style="width:100%; border:1px solid #d8d4ca; background:white; padding:4px; margin-bottom:8px;" />

<img src="../images/Axonal-PubSub-Healing.png" alt="pub/sub fan-out tree and self-healing" style="width:100%; border:1px solid #d8d4ca; background:white; padding:4px;" />

</div>
</div>

---

<div class="tufte">
<div class="main">

## 4 / Trust

# The security model

- <span class="head">Identity = keypair.</span> The address is derived from the public key, and the transport handshake is mutually authenticated and channel-bound — a man-in-the-middle that swaps the media fingerprint fails the bind.
- <span class="head">Signed, verified at ingress.</span> A signed publish is checked against the publisher's key at the root, before it is cached or fanned out. Spoofed-signature spam dies at the edge.
- <span class="head">You can only act for yourself.</span> A subscribe or unsubscribe is honored only for the authenticated peer's own id — no subscribing a victim, no silencing one.
- <span class="head">Who, not where.</span> A signed post proves its author by key, but the envelope carries no location — the publisher's S2 region is never on the wire. An app reveals a sender's region only by choosing to.
- <span class="head">Bounded &amp; content-addressed.</span> A node only roots topics it is closest to; the message id is the hash of its content; a per-publisher sequence and TTL drop stale or replayed envelopes. Memory-hard proof-of-work prices a publish identity against Sybils.

</div>
<div class="margin">

#### No trust server

Every guarantee here is carried by the peers' own cryptography. No CA, no central authority sits behind any of it.

#### What it does <em>not</em> promise

A kill is best-effort redaction, not a cryptographic un-send: a peer that already holds the bytes keeps them. And a medium no platform can censor is one no platform can moderate. Design with that in mind.

</div>
</div>

---

<div class="tufte">
<div class="main">

## 5 / The surface

# The API you actually call

- <span class="head">Construct a peer.</span> <code>deriveIdentity()</code> → <code>webTransport()</code> → <code>new AxonaPeer()</code> → <code>peer.start()</code>.
- <span class="head">Then publish and subscribe.</span> <code>peer.pub(topic, msg, {publisher})</code> and <code>peer.sub(topic, handler, {publisher, since})</code>. That is the whole core loop.
- <span class="head">The rest is on demand.</span> <code>unsub</code>, <code>pull</code> (by id, or latest), <code>kill</code> (creator-only retract), <code>host</code> (serve a topic without consuming it), <code>metrics</code>, <code>health</code>.

</div>
<div class="margin">

#### Where a topic lives

<code>opts.publisher</code> selects it:

| value | the topic is… |
|---|---|
| omitted | your own feed |
| <code>null</code> | a public topic |
| hex id | someone's feed |

A shared room uses a region-anchored publisher, so every peer in the region derives the same topic id.

</div>
</div>

---

<div class="tufte">
<div class="main">

## 6 / Build-along

# Axona Minimal, in three steps

<p class="codecap">Connect — locate the user, derive the identity, build the node + peer:</p>

```js
const here      = await whereAmI();                 // real GPS, or us-east on denial
const identity  = await deriveIdentity({ lat: here.lat, lng: here.lng });
const transport = webTransport({ bridgeUrl: BRIDGE, identity });
const node      = new NeuronNode({ id: BigInt('0x' + identity.id),
                                   lat: here.lat, lng: here.lng });
node.transport  = transport;
const peer = new AxonaPeer({ domain: new AxonaDomain({ k: 20 }), node, identity, transport });
await transport.start(identity.id);
await peer.start();
```

<p class="codecap">Subscribe — the handler gets each envelope:</p>

```js
await peer.sub(topic, (env) => {
  if (!env || env.deleted || seen.has(env.msgId)) return;
  seen.add(env.msgId);
  const { text, pub } = env.message;          // pub = the node-id we chose to share
  render(text, idLabel(pub), false, topic);   // idLabel → "region:userID"
}, { publisher: ANCHOR.publisher, since: 'all' });
```

<p class="codecap">Publish — attach our publish id so subscribers can show the region:</p>

```js
const msgId = await peer.pub(topic, { text, pub: identity.id },
                             { publisher: ANCHOR.publisher });
seen.add(msgId);
render(text, idLabel(identity.id), true, topic);
```

</div>
<div class="margin">

<img src="../images/Build-Flow.svg" alt="deriveIdentity to webTransport to AxonaPeer to sub/pub, producing the Axona Minimal UI" style="width:100%; margin-bottom:8px;" />

That is the entire networking story. Everything else in the file is DOM glue.

#### Sharing the region is the app's call

The protocol signs <em>who</em>, never <em>where</em>. To show a sender's region this app opts in — it puts its own node-id in the post (<code>pub</code>) and reads <code>region:userID</code> off it. The disclosure stays visible, at the app layer.

</div>
</div>

---

<div class="tufte">
<div class="main">

## 7 / Go

# Try it, then go deeper

- <span class="head">Run it.</span> <a href="https://demo.axona.net/apps/axona-minimal/">demo.axona.net/apps/axona-minimal</a> — open two tabs and watch a message cross between them. Each line shows the sender's region, read off its publish id.
- <span class="head">Read it.</span> The Explainer (how the routing works), the Architecture note (kernel · transport · bridge · wire), and the API Reference for every exported symbol.
- <span class="head">Host it.</span> Run a relay (<code>axona-relay</code>) to carry your region's topics, or stand up your own bridge — the one piece you bootstrap from.

</div>
<div class="margin">

#### Three live demos

<a href="https://demo.axona.net">demo.axona.net</a> — Axona Minimal, the hello-world pub/sub example, and the S2 region globe.

#### The kernel

<a href="https://github.com/axona-net/axona-protocol">axona-net/axona-protocol</a>

</div>
</div>

<div class="closing-statement">Sixty lines and a browser tab put you on the network. There is no step zero.</div>
