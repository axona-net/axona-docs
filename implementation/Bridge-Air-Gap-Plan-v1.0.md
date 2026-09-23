# Bridge Air-Gap — Project Plan — v1.0 (normative correction to v0.9: the origin rule was inheritable)

**Status:** proposed; a normative correction under Aster CP 32556d0d. It
records a defect in v0.8's own origin rule, found by that review, reproduced,
and closed. It replaces the ORIGIN paragraph of §7.1.2 and adds one WP4 row.
Nothing else moves.
**Author:** axona.bot, for David A. Smith — YZ.social
**Date:** 2026-09-23
**Base:** v0.9 (sha256 b5e9806b…) on v0.8 (754e72fe…) on v0.7 (0f06b617…) on
v0.6 (952e0660…) on v0.5 (f0d5bcbe…) on v0.4 (cc9ea61a…) on v0.3 (e7b23101…);
v0.2 (3e8f8a9a…) and v0.1 (866b123f…); all frozen
**Companions:** council 2c7657fe, 89e85dea, 92c7314e, 32556d0d; kernel branch
`air-gap-4.89.0` (1ca2c91); bridge branch `air-gap-2.132.0` (8d9ca52); both
LOCAL until David okays a push; ops/STATE.md 2026-09-23

---

## 0. The defect

v0.8 §7.1.2 gave the origin rule as a property of the frame and the edge: when
a node originates a route_msg whose addressee sits on a direct edge, that edge
is the hop whatever its class. The rule is needed. A client must be able to
send SUB to the bridge it dialled, and the bridge must be able to send its own
directory entry one hop to a directly connected root (§7.2.7).

What the rule did not say is which frames count as originated. A bridge
originates almost nothing, but it RESTAMPS. `_topicDecision`'s no-role branch
pops the via of a received SUB or PUB and re-sends it through `_send`, which
stamps `fromId` with the local id. If the surviving via names a directly
connected client, the restamped frame is addressed to a peer on an introduction
edge, and under v0.8 the exception fired: one client's frame crossed the bridge
to another client, which is the highway the whole plan exists to close.

The egress classifier does not catch it. A restamped PUB for a named directory
copy carries the bridge's own `originId` and a named topic, so it classifies
`directoryOwnEntry`, an allowed class, and is written. `genericTransit` stays
at zero throughout. A counter cannot see a frame that has taken a lawful frame's
shape.

Reproduced on a real bridge child (fence section H): client A sends a route_msg
addressed to the bridge carrying a PUB for the legacy directory copy with
`via: [bridge, B]`; the bridge holds no role for that copy. With v0.8's rule,
client B receives `req:route_msg` and the write is counted `directoryOwnEntry`.

## 7.1.2 (ORIGIN paragraph replaced) The origin rule is opt-in per call

The exception now requires the caller to declare, inside this process, that the
node is the ORIGIN of the operation. The declaration travels as `ownOrigin` from
the pub/sub layer through routing to the egress gate. It is absent by default,
so a path that does not think about it fails closed.

- ORIGIN, declared: the node's own `pub`, `sub`, `unsub`, `kill`, `touch`,
  `pull`, `metricson`, and the retries of its own writes (the write-flight
  retry and promote, the pending-publish retry and early resend). These may use
  the addressee exception.
- NOT ORIGIN, by omission: `_reroute`, `_rerouteDeclined`, `_deferToRoot`,
  `_forwardToRoot`. Every path that carries or derives from a received frame.
  These may not, whatever `fromId` now says.

At an introduction-only node the exception fires only on a declared origin. A
regular node is unaffected: the exception can only ever select an introduction
edge, and greedy already picks a directly connected addressee, whose XOR
distance is zero.

The RECEIVE rule of v0.8 is unchanged and remains separate: the forwarding scan
in the route_msg handler has no addressee exception at all.

The general statement, which v0.8 should have made: a local identifier written
onto a frame by this node does not make the frame this node's own. Provenance
is what the emitting code knows, never what the frame says. This is the same
principle v0.9 applied to egress classes, applied one layer lower, to the choice
of hop.

## WP4 (row added)

| Row | What | Fence | State |
|---|---|---|---|
| I6 | the no-role REROUTE branch, deterministic: a received PUB whose surviving via names a directly connected client. Precondition asserted (no role for the copy). B receives no route_msg and no pubsub verb; anything B receives is a discovery query about the bridge's own placement; zero forbidden invocations at all three physical points; no new invocation of any class at the uplink or data-channel points; the publish ends as a local root here, which only the pop-to-bare-topic path produces. NEGATIVE-TESTED: with the gate removed, B receives `req:route_msg`, counted `directoryOwnEntry`, transit counters at zero | fence_air_gap_ingress §H | done |

Section G is retained separately as the positive local-root service case, on a
copy the bridge already roots, and claims nothing about the reroute branch.

Both sections admit the bridge's own `discoveryRequest`: a `lookup_step` or
`find_closest_set` about its own placement carries no third-party payload, and
§7.1 permits discovery over an introduction edge. Class 4 of the §7.2.6 table
is read accordingly: the bridge's own discovery queries, whatever local job
issues them, not only §7.2.7 root discovery. Both sections assert on the
CONTENT of what the third client received, never on silence.

## Everything else

Every line of v0.9, v0.8, v0.7, v0.6, v0.5, v0.4 and v0.3 not named above
stands as written. §7.2.7, WP3, WP4 H0 and O2 point 3 remain INCOMPLETE. D7
operator; D8 neither.
