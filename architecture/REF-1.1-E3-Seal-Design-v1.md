# REF-1.1 E3 – Seal the Registration Capability (design note v1)

E2 is done. All 38 frame-registration sites now go through the one canonical
`registerFrame` door, verified byte-identical flag-off, and the kernel manifest
reads `migration-target callees = {registerFrame: 38}` with zero raw sites left.
So the question E3 answers is the one the whole cutover was built to force:

**Once every frame goes through the door, can anything still reach the raw dispatch
primitive without going through the door?**

Today the answer is yes. `onRequest`, `onNotification`, and `onRoutedMessage` are
still public methods on every transport. A merge next month could write
`recv.onRoutedMessage('sub', h)` by hand, or `recv['onRouted'+'Message']`, and the
frame would wire with no row, no ownership check, no observation. E2 moved every
*existing* caller to the door. E3 removes the *ability* to call anything else.

## What E3 is not

E3 is **NOT** a `delete recv.onRoutedMessage`. This was the false claim in the v3
design, and record [R1] retired it: a reference captured while the method was
public is not revoked by deleting the property later. A captured function value
outlives the property it came from. Runtime deletion seals nothing.

E3 is **NOT** an in-process hot-swap. There is no live node in which the method
flips from public to sealed under a running heap.

E3 does **NOT** touch `onMessage` or `onDirectMessage`. Those are the app-facing
receive surface, not raw registration primitives. Sealing them would change
application compatibility. They stay public.

E3 changes no wire and no behavior. The seal moves the *access path* to the
primitive. A sealed build and the E2 build dispatch the same bytes.

## The seal is a property of the shipped source

The raw dispatch primitive becomes a closure-captured capability: a function value
closed over by the one registrar and by a short, named set of mechanism shims, and
by nothing else. It is not a method on any receiver, any receiver's prototype, or
any exported object. There is no own property and no inherited property, under any
string or symbol key, that returns it.

The seal does not depend on any node forgetting a reference. It depends on the
built kernel never handing one out. In the sealed source the method is not a public
member of any class, so no object a node constructs exposes it, so no code in a
running node can capture it. A node adopts the sealed build the way it adopts any
build: by fresh construction on restart. Every running node is sealed from birth.
There is no window in which the method was once public on a live object and a
pre-seal alias could survive.

By the way, that restart property is also the one caveat. If a deployment ever had
to hot-swap E3 into a live process without restart, the closure capture would need
a revocable transitional gateway and its own revocation test. That is out of scope
for a restart-based rollout, and it is stated here so the assumption is on the
record.

## Why this closes the hole the S5 fence left open

Every path that reaches the raw primitive names the symbol somewhere, or reaches
it without naming it. There is no third kind. The two gates partition that space.

The **named** paths – `const f = recv.onRoutedMessage`, a re-export, an alias
through however many hops – all write the identifier `onRoutedMessage` at their
first hop. The AST identifier gate catches that first hop. This is the gate S5
already carries; E4 arms it against an empty baseline.

The **unnamed** paths – `recv['onRoutedMessage']`, `recv['onRouted'+'Message']`, a
prototype walk, `Reflect.get` – read a property that, after E3, no constructed
object has. They resolve to `undefined`. This is the gate E3 delivers. S5 could not
close it because a public method is reachable by computed access and a string-literal
scan for method names produces comment and doc-constant false positives, which S5
rejected. Removing the public method closes it structurally instead of by pattern.

## What changes, from the E0 inventory

The sealed set is the three primitives: `onRequest`, `onNotification`,
`onRoutedMessage`. The E0 manifest classifies every site that names one of them:

| Bucket | Count | E3 action |
|---|---|---|
| primitive-definition | 13 | The method declarations on every transport plus the `Transport.js` contract and the `AxonaPeer` routed primitive. Each becomes the capability channel, not a public method. This is the seal itself. |
| canonical-door | 3 | `registerFrame` reads the primitive from the capability channel it closes over, in place of `recv.onRequest(...)`. |
| mechanism-shim | 5 | The `CompositeTransport` fan-out that replays a handler to each sub-transport, plus one `AxonaPeer` routed shim. Re-expressed through the capability, enumerated in one place, one justification each. |
| parameterized-registrar | 1 | `onDirectMessage` registers `onNotification('direct_${type}')` – a computed wire the literal-wire gate forbids at the door. It needs a home (open decision 2). |

The 13 primitive-definitions span every transport in the tree: the `Transport.js`
contract, `wstransport`, `sim/transport`, `web/bridge`, `web/composite`,
`web/webrtc`, and the `AxonaPeer` routed primitive. That is the blast radius. It is
wider than any single E2 boundary and it is all in the transport layer, which is
the part of the kernel a wrong move breaks hardest.

`onMessage` (3 sites) and the bridge `dispatch` demux (8 sites) name different
methods and are out of scope, as recorded above.

## The capability channel – the mechanism to decide

The design calls for a closure capability with no property under any key. The
concrete shape is decision 1 below, and it is the one that most shapes the diff.
The leading candidate:

A module-private `WeakMap<receiver, {onRequest, onNotification, onRoutedMessage}>`
in an internal module imported only by the transport definitions and by
`registerFrame`. Each transport constructor deposits its three dispatch closures
into the map, keyed by the transport instance. `registerFrame` reads the closure
for `row.transportKind` out of the map and calls it. No object carries the method;
the map is the channel; `registerFrame` is the allowlisted reader. The AST gate
keys the allowlist by the module identity of that internal module and of
`registerFrame`, not by filename.

The `CompositeTransport` case is the one this shape has to earn. The composite
registers a handler on itself and replays it to each sub-transport, so it must read
its subs' capability, not call `t.onRequest(...)`. Under the WeakMap it reads each
sub out of the map. Under an alternate shape – a capability object handed to
`registerFrame` at construction – the composite would have to thread that object
through, which is more plumbing. The composite is why decision 1 is a decision and
not a detail.

## Three decisions for the council

These are the calls a reviewer will want to make before a line is written, the
same design-cleared-before-build rhythm that kept E2 clean.

1. **The capability-channel shape.** Module-private `WeakMap` keyed by receiver, or
   a construction-time capability object handed to `registerFrame`. The WeakMap
   reads cleanly for the composite fan-out; the capability object keeps the
   dependency explicit at construction. One choice, taken up front, because it sets
   the shape of all 13 definition sites.

2. **The home for the parameterized direct registrar.** `onDirectMessage` binds
   `onNotification('direct_${type}')` on a computed wire, and the literal-wire gate
   [V2] refuses a computed wire at `registerFrame`. Either `onDirectMessage` joins
   the enumerated mechanism-shim set as a named low-level registrar with its own
   justification, or B6 grows a parameterized variant that owns the `direct_*`
   family. This is the one new question E3 raises.

3. **The mechanism-shim minimum.** The shim set is the exception to the seal, so it
   is the surface a reviewer watches. E3 cuts it to its documented minimum and
   freezes it by module identity. The council decides which of the five current
   shims survive as capability shims and which fold into the door.

## How E3 is proven

- Runtime capability-boundary tests [A4]: for each of the three primitives, on a
  constructed receiver of each transport, `recv['onRoutedMessage']`,
  `recv['onRouted'+'Message']`, a prototype walk, and `Reflect.get` all return
  `undefined`. A control that a *named* access still resolves inside the door
  proves the test is not vacuously green.
- Full suite byte-identical to the E2 build. The seal is an access-path change, so
  a behavior change in test means the seal moved dispatch, which would be the bug.
- The E2 differential smokes still prove dispatch identity flag-off and flag-on.
- The consumer inventory from E0's named-site evidence: every test mock, dht-sim
  adapter, bridge adapter, and the frozen axona-peer that named a primitive is
  updated to construct through the door or is shown never to have named one. A
  consumer that still reads `recv.onRequest` breaks at the seal; that break is the
  point, and each one is a reviewed edit.
- The E0–E2 dynamic instrumentation window closes here. After E3 the methods are
  gone, so the gateway that recorded live invocations has nothing to instrument.

## Sizing and slices

E3 is one phase, sliced like E2 so each cut lands green and gates on its own:

- **E3a** – introduce the capability channel, reroute `registerFrame` to read it,
  seal one transport, and land the runtime capability-boundary test proving that
  transport's three primitives are unreachable by computed access. This is the
  slice that settles decision 1 in code.
- **E3b** – seal the remaining transports and the `Transport.js` contract.
- **E3c** – cut the mechanism-shim set to its minimum, home the parameterized
  direct registrar (decision 2), freeze the allowlist by module identity, and close
  the E0 instrumentation.

Each slice is suite-green, gated M4 + M1, and submitted to council with the
source-backed artifact set. No wire changes and no behavior changes across all
three.

## What stays held

E3 seals the source. It does not arm anything. The AST baseline is still non-empty
until E4, the runtime boundary tests run but do not gate the build until E4, and
the `direct_*` fence still observes, it does not throw. E3 finalization, E4
(arming the gates), the fleet rollout to v4.63.0, and every deploy remain held for
David.

The reason E3 is a source change taken on restart, not a hot-swap, is also the
reason the rollout is the careful part: a fleet running the E2 build and a fleet
running the E3 build both dispatch the same bytes, so a mixed fleet during a
restart-based roll is safe on the wire – but a node has to restart to become
sealed, and the roll is what makes every node restart onto the sealed build. That
sequencing is E4's and the deploy's to specify, not E3's.
