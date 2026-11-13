# A role goes only to a node in the topic's region: the rule against the kernel as it stands

axona 4. Analysis of 2026-11-13. Written by axona.bot at David's direction, for
the council's read.

## The question

David, 2026-11-13: a topic role can only be assigned to a node that shares the
region of that topic. Message sending is NOT affected; it uses the best route
whatever the region. A region with too few nodes may fail, and that is
acceptable for now.

What does that rule change in the kernel as it stands, what does it fix, and
what does it break?

## What this note is NOT

It is NOT a design and it changes NO code.

It is NOT a measurement. The source is kernel `17086c6` (4.136.0); `src/pubsub`
is byte-identical to the `v4.131.0` production tag by `git diff`. Fleet figures
are read from the host table in `ops/fleet.sh`, not from the running fleet.

It does NOT argue for or against the rule. It says what the rule touches and
where the open decisions are.

## This rule has been in the kernel before

The kernel carried this rule from 4.13.0 as the "region lock". From 4.15.0 it
sat behind a flag that defaulted OFF, and the record of 2026-07-03 has it off
on the fleet. I did not check whether 4.13.0 and 4.14 ran it enforced. On 2026-09-04
David directed its total removal, the council concurred, and 4.75.0
(`5ce792e`) deleted it: the flag, the same-region test, the refusal at the
walk's end, the child-relay gate, the host gate, the region ranking of backups
and heirs. Invariant I-16 has read since then: region is an optimization, never
a wall.

The reason recorded for I-16: regions are unevenly populated, and a region that
may not borrow capacity next door degrades to unrooted topics while healthy
neighbours sit idle. "The failure mode of a missed optimization is a slower
hop; the failure mode of an enforced wall is data with nowhere to live."

The new rule reverses I-16 **for roles** and keeps it **for routing**. David
has named the cost I-16 was written to avoid and accepted it. The council
should read the rule with that history in front of it, because six comments in
the source and one test (`smoke_region_hint.mjs`) still assert the opposite.

## The one property the rule rests on

The region is the top byte of every id. A node in the topic's region differs
from the topic id by 0x00 on that byte. Every other node differs by at least
0x01. So every in-region node is XOR-closer to the topic than every
out-of-region node, bridges included.

Two consequences follow, and they are the whole analysis in small:

1. **Among in-region nodes the rule changes nothing.** The closest in-region
   node is the same node the kernel picks today whenever the walk reaches the
   region.
2. **The rule acts only when the walk does NOT reach the region.** Today that
   walk ends at the wrong node and a root is born there. Under the rule that
   walk ends with no root, and the sender's retry carries it.

The rule converts a wrong root into no root. Everything below is that
conversion, site by site.

## What it fixes

Three failures on the record are a root born outside the topic's region:

- **Bridges holding roles.** Testnet, 2026-11-12, one region and three hosts:
  the two bridges formed 214 roots, all `sub-terminal`, none while the hosts
  were up. A bridge's region is 0xFF and no ordinary topic lives there.
- **A client rooting another region's topics.** Alert-bot, 2026-10-13: an
  eagle client claimed root of grizzly topics through the reachable-root
  fallback after 6 s unattached, and the topics had two roots.
- **A foreign subscriber rooting its own copy.** 2026-07-03: a subscriber
  outside the topic's region found itself closest in its own table, rooted the
  topic, and cross-region delivery was 0%. The 4.17.1 fix asked the network
  first. The rule removes the case.

The "never select 0xFF" rule of 2026-11-12 becomes a corollary. So does its
open question about a topic in region 0xFF: the mint allows one topic there,
the bridge directory, and under this rule the bridges are its correct holders.

Bridges that already hold roots also get a way out. An out-of-region claim
loses the election to any in-region claim, so the first in-region root pulls
the bridge's history and the bridge's claim ends.

## Where it applies

The list in `role-selection-points-0xff.md` (`b14651e`) carries over row for
row. The predicate changes from "is this id in region 0xFF" to "is this id in
the topic's region". In short:

| Point | Under the rule |
|---|---|
| The walk's end (`AxonaPeer.js` 1343–1387, 6825–6861) | A node outside the topic's region is never the end of a walk that seats a role. It forwards to its best hop. With no hop, the walk stops and the sender retries. |
| Root birth and promotion (`wireHandlers.js` 316, 631, 1669, 1915; `rootClaim.js` 480) | Unchanged for an in-region node. Unreachable for any other. |
| Reachable-root claim (`rootClaim.js` 248, 611) | Only for a topic in this node's own region. |
| Defer to a closer root, beacon acceptance, yield (`rootClaim.js` 198; `rootElection.js` 77–146) | A beacon naming an out-of-region root is not recorded and not deferred to. |
| Root hint and terminal verify (`rootElection.js` 237; `AxonaManager.js` 1017) | Out-of-region ids are dropped from the answer. |
| Backup cohort (`repairPlane.js` 990–1012, 1154, 1194) | In-region candidates only. |
| Heir of a leaving root (`repairPlane.js` 1304, 1453) | In-region candidates only. |
| Write retry target (`writeFlight.js` 333) | In-region neighbours only. |
| Verify nominee (`rootElection.js` 404) | In-region nodes only. |
| The election (`rootClaim.js` 284) | In-region beats out-of-region, before epoch and before distance. |
| Child relay, if a child is a role (`wireHandlers.js` 266–337, 570) | See decision 1. |

**The shape matters more than the predicate.** The old region lock put the
refusal at the walk's end: an out-of-region terminal returned `reject` and the
message was consumed there. That is the sink David described for the bridge on
2026-11-12, at every out-of-region node. The rule has to be built as the walk
NOT ending there. The forwarder already has that path for a node that cannot
serve (`AxonaPeer.js` 1378–1387): it reports not-terminal, hands the walk to
the closest connected peer off the path, and stops with `no-capable-terminal`
when there is none.

## What it costs

**1. A region needs three serving nodes to be durable.** `ROOT_REPLICAS` is 2.
A root and two backups, all in region. With two nodes the root has one backup.
With one, none. With zero there is no root: a publish retries until its TTL and
a subscribe holds its seat and renews.

**2. Production has two populated regions.** By the host table: eagle (0x89)
and grizzly (0x80). Every other region code has no relay. A topic minted in a
third region has only the browsers and apps whose own node id falls there.

**3. A browser is an in-region node.** A client's region comes from its
location. In a region with no relay, the clients ARE the region, and the rule
makes them the only eligible roots. Today a relay next door holds that topic.
Under the rule the topic lives on phones and tabs, and no relay may back it up.

**4. "Fail" includes losing stored history.** A leaving root hands its history
to an heir. With no in-region heir there is nowhere to hand it. The last
in-region node to leave takes the topic's history with it. David accepted
failure in a thin region; I am naming this one separately because it is loss
and not delay.

**5. A region restarts together, and loses together.** Under the current rule
roles spill to neighbours during a roll. Under this rule they cannot. The
record already shows a fleet roll leaving the council topic with empty roots for
about 7.5 minutes, when its root and its only backup were relays restarted two
minutes apart (2026-10-07). The same roll under this rule has no spillway at all.

**6. The failure is silent unless it is surfaced.** The old lock had a
pre-send error, `REGION_UNPOPULATED`, so an app learned at once that the
region had no node. It was deleted with the lock. Without it a publish to an
empty region is a retry loop that ends at its TTL.

**7. Region is self-declared.** A node's region is derived from the location
it supplies, or set by an override. The eight relays on one Mac are pinned to
eagle and the six on another to grizzly, by config. The rule is a placement
rule. It is NOT a security boundary: a node that wants to be eligible for a
region mints itself there.

**8. A mixed fleet has two rules.** A node on the old kernel still roots out of
region and beacons it. A node on the new kernel ignores that beacon and roots
in region. Two roots for the same topic until the fleet is on one kernel, and
the election change is what settles them. This needs a flag and an arming
order, as closer-born did.

## What is not known

- **How often a walk fails to reach a populated region.** That rate is how
  often the rule turns a wrong root into a delay. The 2026-10-13 record says
  one 5 s lookahead timeout plus one tick was enough to make an eagle client
  the root of a grizzly topic. It does not give a rate.
- **Whether a walk that stops at a node with no hop is rare enough.** The same
  unknown as case 3 of the 0xFF note.
- **Which regions live users' nodes are in.** The chat app names `eagle` for
  its channels in its tests. I did not check where its users' node ids fall.
- **Whether the staged handover completes from an out-of-region loser.** The
  path exists (`mergeMachine.js` 500–520). In run RL1 on 2026-11-12 the second
  testnet bridge sent 85 merge offers toward closer hosts and all were refused
  `not-root`.

## Decisions this leaves

1. **Is a child relay a role?** The kernel has three natures: ROOT, BACKUP,
   CHILD. A root past 20 direct subscribers promotes a subscriber to a child.
   If CHILD is a role, a topic whose subscribers are mostly out of region can
   only widen through its in-region ones, and otherwise seats over capacity.
   The old lock did this. David.
2. **Is hosting a role?** `host(topic)` keeps a topic's history without
   subscribing. The old lock refused a foreign host. David.
3. **Is losing history in a thin region inside "acceptable for now"?** Cost 4.
   David.
4. **Does an app get told?** Cost 6. A pre-send error, a health field, or
   nothing. David.
5. **The election relation.** Region first, then epoch, then distance. The
   council reviewed the relation as a total order; a region term in front keeps
   it total. Council.
6. **I-16 is reversed for roles.** The invariant, six source comments and
   `smoke_region_hint.mjs` say the opposite today. They change in the same
   change or the next reader restores the old rule. Council.

## What would test it without building it

Testnet runs with `BRIDGE_NEVER_ROOT=0`. Setting it to 1 on the two testnet
bridges exercises one half of this rule today, on the kernel as shipped: a
node that is never the end of a walk, with the forwarder's hand-on path
carrying the message. One alert-bot run each way would say whether a
never-root bridge still swallows messages on a kernel that has the hand-on
path. That is a testnet change and it waits for David's word.
