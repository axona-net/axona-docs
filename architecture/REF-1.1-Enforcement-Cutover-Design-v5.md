# REF-1.1 Enforcement Cutover — Registration Discipline (v5)

Kernel 4.63.0 · design, not shipped · shadow default-off throughout

Recut of v4 after all three seats cleared the v4 design — Orion fully accepted,
Vega closed every finding, Aster gave conditional design acceptance with two
qualifications. v5 folds those two in, marked [Q1] and [Q2]; the four items v4
closed are retained below as [R1]–[R4].

- [Q1] The E1 named-baseline gate blocks new *named* raw references but cannot, by
  construction, catch a new *computed* access to the still-public methods during
  the E1–E3 window. v5 states that limit and leans on the bounded dynamic
  instrumentation and the differential tests to cover the window. It does **not**
  add a computed-member policy — that would be a new primitive, and the seats asked
  for the limit written down, not a new mechanism at design time.
- [Q2] The production import graph must be finite in practice. Dynamic `import()`
  and loader paths get a manifest, and CI rejects any runtime-loaded module outside
  it, so the closed world is a decidable set rather than an open one.

- [R1] The pre-E3 capture claim in v3 was false. Deleting a public property does
  not revoke a function reference captured before the deletion. v4 names the
  mechanism: a restart lifecycle. The seal is a source property of the shipped
  build; a node adopts it by fresh construction, never by in-process hot-swap.
- [R2] E0's AST scan is named-site evidence, not a complete inventory — aliases,
  computed access, and reflection are the open-grammar cases it cannot enumerate.
  v4 adds dynamic gateway instrumentation over a stated boundary and drops the
  "exceeds by nothing" claim.
- [R3] Warn mode only reports; it does not close the merge race. v4 freezes an
  existing-site baseline at E1 and fails CI on any new non-baseline raw reference.
- [R4] The runtime proof must quantify all roots, not one receiver. v4 defines the
  root set as the E0 consumer inventory and the production import graph, including
  dynamic and module-loader entry points.
- [E0] The raw dispatch surface is **four** primitives, not two. This document
  names `onRoutedMessage` and `onNotification` in its examples; an E0 read-only
  scan of the kernel at 1edb1fd found the sealed-capability set is
  `{onRequest, onNotification, onRoutedMessage, onMessage}` — 32 call sites in
  `src/`, ~60% of them in `AxonaPeer.js`. The mechanism is unchanged: the
  closure-captured capability [A1], the module-identity allowlist and gate [A3],
  and the runtime reachability proof [A4] each cover all four names, not a special
  pair. The examples stay two-named for readability; the implementation binds the
  set of four. (A related E0 finding: a few of the 32 sites — the
  `CompositeTransport` fan-out — are mechanism, not frame registrations, and land
  on the shim allowlist rather than the migration worklist.)

## The question

The four boundary registries watch live frames today. They watch through a wrap
that a handler is *asked* to route through. Nothing forces it. A new frame added
next month can call `peer.onRoutedMessage(...)` directly, dispatch correctly,
pass every test, and never appear in a registry. The observation layer would not
know the frame exists. Neither would the ownership fence.

So: how do we make "every frame goes through one door" a property a build can
prove, instead of a convention a reviewer has to catch?

## What this is not

This cutover does **NOT** turn on contract enforcement. The registries do not
begin rejecting, rewriting, or delaying any frame. Nothing changes on the wire.
WIRE_VERSION stays 4.0. A frame that dispatches today dispatches to the same
handler with the same bytes and the same return value after the cutover. The
shadow flag stays off by default, and the armed path uses the *same* wrap the
flag-off path uses today [V5] — not a second wrapper.

What changes is where a frame is allowed to be *wired*. Today a handler may reach
the raw dispatch primitive from anywhere. After the cutover there is one function
that wires frames, and the raw primitive is unreachable — at runtime, not just
absent from source — from everywhere else in the closed world defined below.

Contract enforcement — a registry that reflects on a frame and refuses it when it
violates its declared row — is a separate, later, wire-affecting phase. It rides
the Envelope V2 flag day and the 5.0.0 bump. This document does not design it and
does not depend on it.

## The closed world

The soundness claim is scoped, and the scope is stated rather than assumed. The
closed world is the kernel's **production import graph** — the module set
transitively reachable from the kernel's runtime entry points, including dynamic
`import()` sites and any module-loader entry points [R4] — together with the
objects those modules construct. Inside it, the two gates below make the raw
primitive unreachable except through the one door.

[Q2] The graph is finite in practice only if the loader set is a checked artifact.
A static import graph is finite by construction, but a dynamic `import()` or a
loader entry point can resolve to a specifier computed at runtime, which would make
the graph open. So the design requires a **manifest** of the allowed
dynamic-import and loader targets, and CI rejects any runtime-loaded module outside
the manifest. This is the clause that keeps the closed world a decidable set rather
than an open one; without it "production import graph" names something a build
cannot enumerate.

Outside it is out of scope, and named so: a host that embeds the kernel and
reaches into its internals through means the kernel does not sanction is not
constrained by this cutover. The cutover disciplines the kernel's own tree and the
objects it builds; it does not bound what an embedder does with reflection against
a running node. This is the "clearly defined closed world" the claim rests on.

## Why the S5 scan could not close this

S5 shipped the ownership fence on a NARROWED claim, and said so. The narrowing
was forced by aliasing. The fence scanned for a syntactic pattern — a call that
looks like `.onRoutedMessage(`. A pattern scan is defeated by three moves:

    const f = peer.onRoutedMessage; f(wire, handler)   // alias   — names it
    Object.assign(sink, { route: peer.onRoutedMessage })  // re-export — names it
    const m = 'onRouted' + 'Message'; peer[m](...)     // computed — does NOT name it

The first two dispatch a frame while still writing the identifier somewhere. The
third reaches the method through a string, writing no identifier at all. A scanner
that tries to follow any of them into the call is a dataflow analysis over the
whole module graph, and that analysis is not decidable in the general case. So S5
checked the direct-call subset and recorded the gap.

The cutover closes the grammar. The two access classes above, *named* and
*unnamed*, are closed by two different gates.

## The sound core — two gates that partition the access space

Every path that reaches the raw primitive is one of exactly two kinds. It either
**names** the symbol somewhere, or it **reaches** the symbol without naming it.
There is no third kind. Each gate owns one kind, and completeness comes from the
partition, not from either gate covering both.

**Named access → the AST identifier gate (decidable).** An alias must name the
symbol before it can capture it. `const f = peer.onRoutedMessage` contains the
token `onRoutedMessage` as an Identifier node. A re-export contains it. Any
binding obtained through a *named* reference, however many hops it later travels,
has a first hop that writes the identifier. An AST scan for the Identifier catches
that first hop. This gate sees Identifier references and nothing else. It does not
see `recv['onRoutedMessage']`, because that property is a string Literal, not an
Identifier — and matching string literals would be a pattern scan with comment and
doc-constant false positives, which is the fragile thing S5 already rejected. So
the AST gate does not try. Computed access is not its case. [V3]

**Unnamed access → the runtime capability boundary (total).** [A1] The raw
dispatch primitive is a **closure-captured capability**: a function value closed
over by the one registrar and by the named mechanism shims, and by nothing else.
It is **not a method on any receiver, any receiver's prototype, or any exported
object.** There is no own property and no inherited property, under any string or
symbol key, on any object the closed world constructs, that returns it.
`recv['onRoutedMessage']` finds nothing. `recv['onRouted'+'Message']` finds
nothing. A prototype walk finds nothing. `Reflect.get` finds nothing. Computed,
bracket, reflective access all resolve to `undefined` — the runtime gate's case,
proven by test [A4].

**Why no captured reference survives — the lifecycle, not a deletion.** [R1] A
reference captured while the method was public would *not* be revoked by deleting
the property later; a captured function value outlives the property it came from.
So the seal does not rely on runtime deletion. The seal is a property of the
*shipped source*: in the built kernel the method is not a public member of any
class, so no object a node constructs ever exposes it, so no code in a running
node can capture it. A node adopts the sealed build the only way it adopts any
build — by **fresh construction on restart**. E3 is never a hot-swap into a live
process. There is therefore no running node in which the method was once public
and a pre-seal reference could survive; every running node is sealed from
construction. (If a deployment ever needed to hot-swap E3 into a live process
without restart, that would require a revocable transitional gateway and its own
revocation test — out of scope for the restart-based rollout, and called out here
so the assumption is explicit.)

With the partition and the lifecycle the invariant is total *within the closed
world*. Named access cannot escape the AST gate. Unnamed access cannot reach the
primitive because no constructed object exposes it. No captured reference exists
because the running node was sealed from birth.

## The four exit criteria (Aster, record 3ff52d4c)

1. **One canonical path.** A single `registerFrame(recv, wire, handler)`. [V1]
   `wire` must be a literal frame-type constant at the call site — the AST gate
   rejects a `registerFrame` call whose second argument is not a Literal or a
   member of the frozen frame-type-constant set, and that constant set lives in
   **one module** so the exception is a single reviewed surface. [V2] There is one
   door, not two: `registerFrame` selects routed-primitive vs notification-primitive
   dispatch internally from the row's transport kind, so both primitives live behind
   the one function and the one allowlist. `registerFrame` installs dispatch and,
   when the shadow flag is armed, the observation wrap [V5] — one step, not two.

2. **Prohibit raw access outside it.** [A1] The raw dispatch primitive is a
   closure-captured capability, reachable only by `registerFrame` and a short,
   named set of mechanism shims — the low-level demux points that are not frames
   and have no row. It is not a method on any public receiver or prototype. The
   shim set is enumerated in one place with a one-line justification each, and
   adding to it is a reviewed change.

3. **Enforce across the production import graph in CI.** [A3] An AST check, not a
   regex, over the closed world [R4] fails the build when the raw dispatch
   Identifier is referenced outside the allowlist, which is keyed by **module
   identity and export identity, not by filename**. [R3] The enforcement is a
   **baseline diff**, not a warning: at E1 the existing raw-call sites are frozen
   into a baseline, and CI fails on any *new* raw reference not in the baseline from
   E1 onward. The baseline shrinks as E2 migrates sites and reaches empty at E4.
   Warn-only would report a new raw call without stopping it; the baseline diff
   stops it while the legacy sites still legitimately exist. [Q1] The baseline gate
   fails on a new *named* raw reference, and that is all it can fail on. While the
   public methods still exist, in the E1–E3 window, a new *computed* access to them
   — `recv['onRoutedMessage']` added in a merge — is not a new named reference and
   the baseline gate does not catch it. That window is covered by the E0–E2 dynamic
   gateway instrumentation and the differential tests, not by the named gate, and
   after E3 the access is inert because the method is gone. The design states this
   limit rather than adding a computed-member policy: a general computed-access
   check would be a new primitive, and the partition already assigns computed access
   to the runtime boundary, which closes it structurally at E3.

4. **Preserve the ownership invariants.** B1–B4 carry forward- and
   backward-ownership invariants: a frame is owned by exactly one boundary, and a
   boundary owns exactly the frames its rows declare. `registerFrame` carries the
   `(recv, wire)` binding the row already names, and **refuses at registration** a
   pair the rows do not declare — it throws, at E1 onward. The ownership fence at E4
   is the static backstop that proves no mis-bound pair slipped through.

## Phases

Each phase leaves the suite green and the wire untouched. The work is
non-overlapping per boundary, so a boundary can migrate and gate on its own.

- **E0 — Independent inventory, two kinds of evidence.** [A5][R2] Enumerate the
  worklist from the code, not from the registry — a frame wired outside the registry
  is the failure the cutover exists to catch, and is by definition absent from the
  rows. The inventory is two kinds of evidence, because a static scan cannot
  enumerate the open grammar:
  - **Named-site evidence** — an AST scan of the current tree for every site that
    names the raw primitive (direct, aliased, re-export), plus the consumer
    inventory of callers, adapters, test mocks, helpers, scripts, and public
    contracts that name the methods, since sealing [A1] breaks a consumer that reads
    them.
  - **Dynamic gateway evidence** — the still-public `onRoutedMessage` /
    `onNotification` are instrumented to record every actual invocation over a
    stated coverage boundary: the full integration suite, and a defined deployment
    observation window. This window is **E0–E2 only**; after E3 the methods are
    gone. It catches sites reached through computed, reflective, or otherwise
    unnamed paths the static scan cannot see.
  A dynamically-observed site absent from the static scan is a **finding**, not a
  merge to wave through. The completeness claim is stated with its boundary: complete
  for the named grammar plus everything exercised within the coverage boundary. v3's
  "the frame-site set exceeds the rows by nothing" is withdrawn — a static scan
  cannot support "by nothing."

- **E1 — Land `registerFrame` and freeze the baseline.** [R3] Introduce the
  canonical registrar closing over the raw capability, reusing the existing flag-off
  wrap [V5]. Freeze the existing raw-call sites into the CI baseline. From here CI
  fails on any new non-baseline raw reference. Prove the registrar wires and observes
  identically to the current wrap on one boundary's rows. No migration yet.

- **E2 — Migrate, one boundary at a time.** Move every site from the E0 inventory
  to `registerFrame`; the baseline shrinks with each migrated site. Suite green
  after each boundary. The differential smoke proves dispatch byte-identity flag-off
  and flag-on at each step, so a missed or miswired site shows up as a behavior
  change in test.

- **E3 — Seal the capability.** Remove `onRoutedMessage` / `onNotification` from
  every public receiver and prototype; the raw dispatch survives only as the closure
  capability from E1. This is a source change taken by nodes on restart [R1], never
  an in-process hot-swap. Cut the mechanism shim set to its documented minimum and
  freeze the allowlist by module identity. The E0–E2 dynamic instrumentation window
  closes here.

- **E4 — Arm the gates.** The CI baseline is empty; the AST check now fails on any
  raw reference. Turn on the runtime capability-boundary tests over the quantified
  root set [R4]. The sound-no-alias guarantee S5 deferred is delivered here — two
  gates over a partitioned access space, a stated closed world, and proof — and the
  S5 fence is re-run against the closed grammar to record that its narrowing is
  retired.

## Gates

- Full `npm test` green after every phase — the canonical gate, unchanged.
- The boundary ownership fence green over the migrated tree, read as sound.
- A differential that dispatches each frame flag-off and flag-on and asserts
  byte-identical handler input and return value.
- **The AST identifier gate — names.** [V3] Three negative tests that must turn the
  build red: a direct call, an aliased capture, and a re-export. Computed and bracket
  access are not in this set; they name nothing for it to catch.
- **The baseline-diff gate.** [R3] A negative test that adds a new non-baseline raw
  reference and must turn the build red, and a positive test that an existing
  baseline site does not, until it is migrated.
- **The runtime capability-boundary tests — reachability over all roots.** [R4] The
  root set is the E0 consumer inventory made concrete: every public instance type,
  its prototype chain, adapter objects, factory outputs, module exports, and cached
  references the kernel holds. For every member the test asserts no property under
  any string or symbol key, no prototype method, no factory output, and no cached
  reference returns the capability. One receiver is a sample; the whole root set is
  the proof.
- **The wire-literal gate.** [V2] The AST check rejects a `registerFrame` call whose
  `wire` argument is not a literal frame-type constant, proven by a negative test
  that passes a variable and must turn the build red.

## Risk and rollback

The risk is one class: a registration site missed in E2, so a frame stops
dispatching. It is caught before the wire by the differential and the full suite,
because a frame that does not wire does not deliver in test. E0's two-kind inventory
[R2] is the guard against the site being missed — named-site scan plus dynamic
gateway evidence over the stated boundary — and the baseline-diff gate [R3] is the
guard against a new raw call landing during the migration window.

Rollback is a git revert. Nothing deploys a behavior; nothing changes on the
wire; no node on the network can tell whether a peer ran the pre- or
post-cutover tree. WIRE_VERSION does not move. The cutover is invisible to every
other node by construction, which is what makes it safe to land under the standing
fence and roll without a flag day.

## Sequencing

This is held. It lands behind David's go and behind the **fleet soak** on 4.63.0 —
the fleet is rolled to 4.63.0 and the soak is running now; the hold is that soak
clearing, which proves the rolled kernel is sound under churn over hours. That is a
different gate from the M1c single-slot canary, which proved only that the shadow
registry observes live frames correctly. Council reviews this design; no code lands
on the review. Contract enforcement stays out of scope and out of this document.
