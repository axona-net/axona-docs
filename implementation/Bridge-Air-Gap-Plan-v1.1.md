# Bridge Air-Gap — Project Plan — v1.1 (normative correction to v1.0: the discovery plane)

**Status:** proposed; a normative correction under Aster CP d7d8b077. It
enumerates the `discoveryRequest` amendment that v1.0 made without declaring it,
names the jobs permitted to emit one, and records a second transit path the
question exposed: an introduction-only node relaying a RECEIVED discovery walk.
It reopens no retired block.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-23
**Base:** v1.0 (sha256 e3b56d60…) on v0.9 (b5e9806b…) on v0.8 (754e72fe…) on
v0.7 (0f06b617…) on v0.6 (952e0660…) on v0.5 (f0d5bcbe…) on v0.4 (cc9ea61a…) on
v0.3 (e7b23101…); v0.2 (3e8f8a9a…) and v0.1 (866b123f…); all frozen
**Companions:** council b284c157, d7d8b077; kernel branch `air-gap-4.89.0`
(99a4a01, pushed); bridge branch `air-gap-2.132.0` (8d9ca52, pushed);
axona-docs main; ops/STATE.md 2026-09-23

---

## 0. The undeclared amendment, now declared

v1.0 said it amended the ORIGIN paragraph only. It also widened class 4 of the
§7.2.6 table, from the bridge's `lookup_step` and `find_closest_set` issued
"only by §7.2.7 root discovery" to "whatever local job issues them". That was a
normative change carried in a sentence. It is separated out here, bounded, and
the jobs are named.

## 7.2.6 class 4 (replaced) `discoveryRequest`

A `discoveryRequest` is a `lookup_step` or `find_closest_set` request that THIS
node issues about its OWN placement decision. Four conditions, all required:

1. **Emitting job**, one of exactly these, each named with its caller:
   - §7.2.7 root discovery for a named directory copy (not yet implemented).
   - Terminal-ownership verification before this node self-claims root of a
     named directory copy (`_verifyTerminalOwnership` via `dht.lookup` or
     `findKClosest`).
   - Self-integration and repair-plane cohort resolution for a role this node
     already holds (`repairPlane` via `findKClosest`).
   A job outside this list does not get the class by being a lookup.
2. **Not a relay.** The request must not be the continuation of a walk this
   node received. See §7.1.5.
3. **Content.** The body carries a target key, a hop count, the walk's own path
   and queried set, and `K`. It carries no application payload: no `json`, no
   `msgs`, no `innerPayload`, no pubsub verb. A request whose body carries any
   of those is not discovery and is `genericTransit`.
4. **Allowed types.** `lookup_step` and `find_closest_set` only. `local_probe`
   and `lookahead_probe` are answered, never issued, by a bridge.

Rate: these follow the emitting job's own event rate, which is a role decision
or a repair tick. No additional per-connection egress bound is imposed on them
and none is claimed. D8 remains neither.

One-hop and no-forwarding are unchanged: a `discoveryRequest` goes to a
directly connected peer and its answer comes back on the same connection.

## 7.1.5 (new) The discovery plane is not a highway either

The ingress table (v0.4 §7.2.1) says `lookup_step` terminates at the bridge's
own table with one table scan and no egress. The code did not do that. The
handler feeds the wire context straight into the iterative walk, which picks a
candidate from the synaptome with no capability filter and sends `lookup_step`
onward. A bridge therefore relayed a client's traversal to another client, one
round trip per hop, across introduction edges.

The egress classifier cannot catch it: a forwarded walk is indistinguishable at
the write from the bridge's own discovery query, so it classifies
`discoveryRequest` and is written. This is the v1.0 pattern again, in the
discovery plane: a frame taking a lawful frame's shape.

It is narrower than the v1.0 bypass. The walk carries no application payload,
so nothing a client said reaches another client. What it carries is work: the
bridge spends a request and a wait on a traversal that is not its own, and a
client gains a way to walk the mesh through it.

**The rule.** At an introduction-only node, a discovery walk that ARRIVED from
a peer is answered from the local table and never relayed. The node's own walk
is unaffected: it enters the walk without the received marker, so the bridge
still resolves its own placement for every job in class 4 above. A regular node
is unchanged.

Provenance again, for the third time and stated generally: the emitting code
knows whether a frame is this node's own; the frame never does. v0.9 applied it
to egress classes, v1.0 to the choice of hop, v1.1 to the discovery walk.

## WP4 (row added)

| Row | What | Fence | State |
|---|---|---|---|
| P10 | an introduction-only node answers a RECEIVED walk from its local table and sends nothing; its OWN walk is still relayed, so placement resolution survives; a regular node relays a received walk exactly as before | fence_air_gap_capability | done |

## Status of the record

The v1.0 bypass and this one are **author-reproduced and locally patched, not
independently closed**. Independent review is asked to trace `ownOrigin` and the
received marker through every received and derived path, including retries,
promotions and deferred paths, and to confirm that no inbound frame field can
supply either one. The old-behaviour failing fixture and the separate local-root
positive case are preserved.

## Everything else

Every line of v1.0, v0.9, v0.8, v0.7, v0.6, v0.5, v0.4 and v0.3 not named above
stands as written. §7.2.7, WP3, WP4 H0 and O2 point 3 remain INCOMPLETE. D7
operator; D8 neither.
