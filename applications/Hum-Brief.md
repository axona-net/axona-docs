# Product Brief — *Hum*

*A peer-to-peer adaptive social feed built on Axona.*

**Version**: 0.1 draft · 2026-05-24 · *working name*
**Owner**: David A. Smith · `davidasmith@gmail.com`

---

## One-line pitch

A swipe-based social feed where every gesture trains your network — strengthen connections to publishers you like, drop the ones you don't — with the ranking algorithm running on your own device, not on a server.

## The product, in two paragraphs

Hum is a swipe-based decentralized social feed. Users see a card stack of posts from publishers they're connected to. **Swipe right** to like — the post forwards to your followers with your endorsement, and your connection to the publisher strengthens. **Swipe left** to dislike — the post stops there, and the connection weakens. **Tap** to open the post and add a comment; comments forward alongside the reshare.

The trick is that the connection graph is *alive*. When a connection's strength drops below a threshold, it's quietly dropped and replaced with a probe — a candidate publisher discovered through your high-strength connections' graphs (hill-climbing) or a random distant peer (simulated annealing). Over weeks, your feed becomes a curated graph of publishers your actual behavior says you want to hear from. There is no algorithm operator; there is no server-side ranking; the only learning signal is your swipes.

## Core UX

### The card stack

| Gesture | Effect |
|---|---|
| Swipe right | Like → reshare to your followers → +1 connection strength to publisher |
| Swipe left | Dislike → don't propagate → −1 connection strength |
| Tap | Open detail; add a comment (comment rides with the reshare) |
| Swipe up | Private bookmark (no propagation, no strength change) |

### Content creation

A single-screen composer with three input types:
- **Text** — up to ~2,000 characters
- **Image** — paste or upload; signed envelope carries the bytes; the axonal tree fans them out
- **Link** — paste a URL; client renders an Open Graph preview card

Posts publish to one of the author's named topics (default: one topic per user; advanced users can have several, e.g., `tech`, `books`).

### Connection management

- Lock individual connections (locked = exempt from auto-rotation)
- See your full connection list with current strength scores; manual override at any time
- Manual block / unblock

## Out of scope for v1

- **Video hosting** — links to YouTube / Vimeo only. Too early to know whether the network handles MB-scale media at scale.
- **Direct messaging** — planned for v2 via Axona's `send` / `notify`; not first-launch.
- **Encrypted private posts** — everything in v1 is publicly signed.
- **Threaded multi-level comments** — single-reply only.
- **Cross-posting from Twitter / Bluesky / Mastodon** — manual reshare via paste-the-link only.
- **Native mobile apps** — web-first; PWA-installable on phones.

## Why this is Axona-native

1. **The mechanism mirrors the protocol.** Axona's neuromorphic routing strengthens useful peer-to-peer connections and prunes the rest. Hum does the same thing one layer up, with user attention as the learning signal. Same algorithm, different layer. *"Transparent adaptive feed"* is the protocol's story retold for end users.
2. **No central operator means no engagement-maximisation incentive.** No ads, no rage-bait amplification, no shadowbanning. Ranking runs only on the user's device, from the user's own swipe history.
3. **Verifiable reach without surveillance.** Publishers see their post's reach (`publishes` + `reshare_count`) via `peer.metrics` without learning who reshared. This is the privacy property Axona was designed for, made visible at the application layer.

## Technical scope (v1)

- Web-first PWA, single-page app (React or Svelte)
- Built directly on `@axona/protocol` v1.0 — *no protocol work*, all application layer
- `peer.pub` / `peer.sub` for posts and reshares; `peer.pull` for fetching referenced bodies; `peer.metrics` for the publisher's reach dashboard
- Local IndexedDB for: connection strengths, swipe history, bookmark stash
- The hill-climb + annealing exploration logic is ~200 lines of JavaScript on top of `peer.lookup` and `peer.peers`

## Build estimate

| Weeks | Milestone |
|---|---|
| 1–2 | Composer + card stack + swipe gestures |
| 3–4 | Connection-strength mechanic; drop/replace below threshold |
| 5–6 | Hill-climb + simulated-annealing exploration |
| 7–8 | Bootstrap topics + cold-start seed |
| 9–10 | Polish: image handling, Open Graph link previews |
| 11–12 | Invite-only beta launch |

**Total**: ~3 months to a credible v1, single developer.

## Success metrics

- **30 days post-launch** — 500 active nodes; 50 daily active users; median session ≥ 5 minutes
- **90 days** — 5,000 active nodes; median user has 30+ connections; median swipe rate > 50/day
- **180 days** — 50,000 active nodes (this puts Hum on track as the principal driver of the pitch deck's Q1 2027 100K-node milestone)

## Open questions (decide before week 1)

1. **Cold-start bootstrap** — how does a new user get their first 5–10 publishers? Curated starter list per topic? Geographic-prefix popularity? Both?
2. **Image hosting** — bytes-in-envelope (simpler, per-post payload bigger) or content-hash-and-pull (smaller publish, slower view)? Affects bandwidth budget per post.
3. **Connection-strength decay** — does an old like count the same as a recent one? Exponential decay (e.g., half-life ~30 days) or step function?
4. **Reshare-with-comment shape** — does the comment become part of the reshared envelope, or a separate post referencing the original? Affects how comments aggregate.
5. **Public-only floor** — should v1 explicitly signal "private posts and DMs are coming" so early users don't expect them now?

---

**Adjacent ship (separate brief)**: a browser extension that lets users highlight any web page and one-click-share to their Hum feed. Solves the content-creation friction problem and is independently viral. Recommended to ship alongside the v1 beta launch.
