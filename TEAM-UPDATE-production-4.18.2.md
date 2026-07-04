# Team Update — Axona is in production (kernel v4.18.2) — 2026-07-04

**Headline:** production is now on the 4.x line. We completed the 3.x → 4.x
wire-major flag day — the one we'd deliberately held prod back from for the couple
of weeks the 4.x line was baking on testnet — and kernel **v4.18.2** is live on
both production bridges, on **axona.net**, and on the
production demo. The trigger was earning it: Howard's CivilDefense app has been
running cleanly on the 4.18.2 testnet, which is the real-world signal we'd been
waiting for before touching prod.

This was not a point release. Prod had been on kernel 3.6.0 (wire 3); the entire
4.x line — routing-only pub/sub, dual-key identity, region-aware addressing, the
one-call `connect()`, cache replication, and this week's split-brain root-election
fix — rides a wire major. 3.x and 4.x nodes cannot interoperate, so promotion is
an all-at-once coordinated cutover, not a rolling upgrade.

---

## What moved

| Surface | Before | Now |
|---|---|---|
| East bridge (`bridge.axona.net`) | app 2.33.0 / kernel 3.6.0 | **2.63.0 / 4.18.2** |
| West bridge (`bridge-west.axona.net`) | 3.6.0 | **2.63.0 / 4.18.2** |
| Peer app (`axona.net`) | 3.36.0 | **v0.81.0 (4.18.2)** |
| Demo (`demo.axona.net`) | 3.x | **4.18.2** |

Mechanically: all repos promoted `testnet → main`; both prod bridges rebuilt on
`main` via their Docker stacks; the west→east federation uplink re-established.
As expected for a wire major, any still-open 3.x browser session was hard-rejected
at the moment of cutover and reloads into the 4.x app — a brief, one-time
partition, which is the designed behaviour and not an error.

Two operational notes worth carrying forward:

- **Stagger the bridge restarts.** When both prod bridges restart at the same
  moment, each boots before it can see the other's directory entry, so both come
  up as independent seeds (`uplink-none`). Restarting the *second* bridge after
  the first is already advertising lets it discover and uplink cleanly. That's how
  west→east came up.
- **Rollback is itself a flag day.** Because it's a wire major, reverting means
  redeploying the 3.6.0 image on both bridges and rolling `main` back on
  kernel/peer/demo — all-or-nothing. Everything is tagged (`v4.18.2`, and the prior
  3.x commits), so it's mechanical, but it's a deliberate act, not a quick undo.

---

## The verification, told straight

This part is worth reading, because I almost mis-called it.

After the cutover I ran a quick two-peer publish/subscribe round-trip against a
prod bridge. It delivered once, then on a later run it *didn't* — which looked
alarming, like the cutover had broken pub/sub.

So instead of trusting the alarm, I ran the control: the **exact same probe against
testnet** — which has our nine-relay backbone and where Howard's app runs great —
side by side with prod. Both came back **1 out of 3**. Identical. The probe itself
is the problem: a cold, brand-new topic with two throwaway peers and no warm-up
races on which node becomes the topic's root, and frequently reads a false zero.
It's a known-bad instrument; our own runbooks warn against judging the network by
it. Real application usage — warm subscriptions, retries, the app-level resume path
that CivilDefense uses — is the signal that matters, and that works. Prod now runs
the identical 4.18.2 code as that testnet, and behaves identically.

The lesson we keep re-learning: **do not judge this network by a cold single-shot
round-trip.** Judge it by real app behaviour and by the warm soak scenarios. The
cold probe is a coin-flip on both networks.

---

## The one honest gap, and why it isn't a blocker

Production has **no relay backbone.** On testnet, reliability at scale comes from a
small fleet of always-on relays that host regions of the keyspace, so any topic has
stable, well-placed infrastructure to root on and to heal around. Production has
only the two bridges' embedded peers — no equivalent standing relay tier.

To be clear about what this is and isn't:

- It is **not** a regression from this cutover. Prod never had a relay backbone;
  the wire-major promotion didn't remove anything.
- It is **fine for production as it stands today** — early, low-traffic, and with
  the split-brain and cross-region fixes that made the app reliable in the first
  place all present in 4.18.2.
- It **is** the natural next investment for robustness at scale and for reliable
  cross-region / cross-bridge delivery: a couple of small always-on relays on
  hosted infrastructure (a VM/droplet per region), pointed at the prod bridges,
  hosting the keyspace — the production analogue of the testnet backbone.

Deliberately deferred for now: that backbone needs to live on real hosted
infrastructure, **not** a developer laptop (which is where the testnet backbone
currently runs). Standing it up is a small, self-contained infra task we'll pick up
when we can host it properly — it does not gate anything that's live today.

---

## Where this leaves us

The technical foundation the manifesto describes as "built" is now, genuinely,
in production: an ownerless mesh on the 4.x protocol, live on consumer devices and
browsers, carrying signed traffic, with the pub/sub correctness work of the last
several weeks all shipped. Prod tracks `main`; testnet remains the staging line on
the same 4.18.2 code. The remaining production work is operational — the relay
backbone above, and the observability we've committed to for stewardship — not
protocol.

*Kernel v4.18.2 · production · 2026-07-04.*
