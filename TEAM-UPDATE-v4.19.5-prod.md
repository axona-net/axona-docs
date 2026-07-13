# Team Update — A burst publisher's topics survive its departure (kernel v4.19.5, testnet + production) — 2026-07-13

**Headline:** the follow-up to Howard's second report is fixed and promoted.
A node that publishes to many fresh topics and then leaves — the alert-bot's
exact shape: 123 publishes over 112 topics in ~7 seconds, departing while
rooting 25 of them — now hands off **every** rooted topic's history inside
`leave()`'s time bound, and the heirs keep it. Live in production as
**kernel 4.19.5 · bridge 2.70.0 · relay 0.48.3 · peer 3.48.2**; post-deploy
acceptance on the settled prod mesh came back **100% initial / 100% healed
delivery (12/12 subscribers per message, ordering intact)**. Testnet and
production are now identical, so results reproduce on either network.

---

## What was actually wrong — three departure-side defects

Reproducing Howard's `output.txt` live exposed a cluster, not a single bug:

1. **Handoff was serial.** The departing root resolved one heir at a time, a
   full network lookup each — 25 rooted topics could not finish inside the
   leave window, and every topic past the cutoff died with the node. Heir
   resolution now runs **in parallel** (8 lookups in flight) and the whole
   handoff is raced against the caller's full timeout.
2. **A thin-tabled leaver gave up.** A node that joined, burst-published, and
   left within seconds often had a local routing table containing only itself —
   so it found "no heir" and handed off **nothing**, even on a populated
   network. It now falls back to the **iterative network lookup** before
   abandoning a topic's history.
3. **The heir un-adopted itself.** The nastiest one: the heir adopted the
   history, then immediately deferred its new root claim back toward the
   *departing node's still-fresh root beacon* — undoing the handoff entirely.
   The HANDOFF now names the leaver; the heir purges that ghost beacon and
   never defers to the node that just handed off. Generalised: any peer's
   death now sweeps every beacon naming it, so stranded traffic stops being
   steered at corpses.

Two smaller correctness holes closed in the same pass: a publisher now
recognises its own message arriving via any stamped path (cohort replication,
replay-up, handoff) as delivery confirmation, and `leave()`'s evidence-based
drain benefits from it.

## What the residual is (and isn't)

In Howard's run, 11 of 112 topics replayed zero to a fresh subscriber. After
the fix we correlated every remaining miss: **none were rooted on the departed
bot** — the departure-side loss is gone. What remains is the pre-existing
**fresh-subscriber cold-attach** class (~10% of topics on a young, sparse
mesh): a brand-new subscriber sometimes attaches before its view of the topic
root converges. It is on the punch list as its own item; it is not a
regression and not departure-related.

## Verification

- New mechanics suite `smoke_leave_handoff_burst` (9/9): parallel timing,
  thin-table lookup fallback, leaver-named handoff, ghost-beacon purge,
  peer-death sweep. Full kernel suite green.
- Live burst validation: 30-topic burst → leave → fresh subscriber, before
  **0/24** topics survived the departure, after **24/24**.
- Prod deploy: staggered bridges (east → west, federation up both ways),
  9-relay backbone restarted clean, collectors reconnected; settled-mesh
  acceptance 100%/100%.

**For Howard:** prod now matches what you validated on testnet — the
workaround pauses can stay deleted on either network. If you re-run the
alert-bot suite against prod, expect the replay misses to drop to the
cold-attach residual only (fresh subscribers on just-created topics), and
none attributable to the bot's own departure.

— shipped 2026-07-13: kernel v4.19.5, bridge v2.70.0, relay v0.48.3, peer
v3.48.2; testnet + production.
