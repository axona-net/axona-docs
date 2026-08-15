# REF-1.1 Enforcement Cutover — Registration Discipline (v3)

Kernel 4.63.0 · design, not shipped · shadow default-off throughout

Recut of v2 after Vega's review (council seq 1127–1128). Vega kept Aster's A1–A5
and found one error and four unstated points. The error: v2 listed *computed*
access among the AST negative tests, but an identifier scan cannot see
`recv['onRoutedMessage']` — a string literal is not an Identifier node. v3
partitions the two gates cleanly: the AST gate owns *names*, the runtime gate owns
*reachability*, and neither claims the other's case. The four gaps — the
wire-literal gate, one-door-vs-two-primitives, the "production-reachable" scope,
and the E2-vs-E4 merge window — are closed below and marked [V1]–[V5].

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
flag-off path uses today [V5] — not a second wrapper — so flag-off and flag-on do
not diverge.

What changes is where a frame is allowed to be *wired*. Today a handler may reach
the raw dispatch primitive from anywhere. After the cutover there is one function
that wires frames, and the raw primitive is unreachable — at runtime, not just
absent from source — from everywhere else. This is a discipline, enforced at build
time and proven at run time. It is not a behavior.

Contract enforcement — a registry that reflects on a frame and refuses it when it
violates its declared row — is a separate, later, wire-affecting phase. It rides
the Envelope V2 flag day and the 5.0.0 bump. This document does not design it and
does not depend on it.

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

The cutover closes the grammar. The closure is a mechanism the design must build,
not a property it may assume — and the two access classes above, *named* and
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
symbol key, on any reachable object, that returns it. `recv['onRoutedMessage']`
finds nothing. `recv['onRouted'+'Message']` finds nothing. A prototype walk finds
nothing. `Reflect.get` finds nothing. A reference captured before the seal does
not survive it, because after E3 there is no property to have captured. Computed,
bracket, reflective, and captured-reference access all resolve to `undefined` —
this is the runtime gate's case, and it is proven by test [A4], not by the AST
scan.

With the partition the invariant is total. Named access cannot escape the AST gate
because escaping it means not naming the symbol — which lands the access in the
other half, where the capability boundary defuses it. Unnamed access cannot reach
the primitive because there is no property to reach. Neither gate needs to cover
the other's case, and neither claims to. v2 erred by asserting the AST gate caught
computed access; it does not, and it does not need to.

## The four exit criteria (Aster, record 3ff52d4c)

1. **One canonical path.** A single `registerFrame(recv, wire, handler)`. [V1]
   `wire` must be a literal frame-type constant at the call site — the AST gate
   rejects a `registerFrame` call whose second argument is not a Literal (or a
   member of the frozen frame-type-constant set), because a variable `wire` goes
   through the door while defeating the static legibility the door exists to give.
   [V2] There is one door, not two: `registerFrame` selects routed-primitive vs
   notification-primitive dispatch internally from the row's transport kind, so
   both primitives live behind the one function and the one allowlist. Two public
   entry points would be two doors sharing an allowlist — wider than needed, and
   rejected. `registerFrame` does two things and no more: it installs dispatch and,
   when the shadow flag is armed, the observation wrap [V5]. The observation cannot
   be forgotten because it is not a second step.

2. **Prohibit raw access outside it.** [A1] The raw dispatch primitive is a
   closure-captured capability, reachable only by `registerFrame` and a short,
   named set of mechanism shims — the low-level demux points that are not frames
   and have no row. It is not a method on any public receiver or prototype. The
   shim set is enumerated in one place with a one-line justification each, and
   adding to it is a reviewed change.

3. **Enforce across all production-reachable modules in CI.** [A3] An AST check,
   not a regex, fails the build when the raw dispatch Identifier is referenced
   outside the allowlist. The allowlist is keyed by **module identity and export
   identity, not by filename** — a rename, a moved file, a symlink, or a re-export
   cannot inherit privilege by matching a path string. [V4] "Production-reachable"
   is the module set transitively imported by the kernel's runtime entry points —
   the graph that ships. Test files, mocks, helpers, and scripts are not in it, but
   E3 deletes the method there too, so those consumers are covered by the E0
   inventory rather than by the gate.

4. **Preserve the ownership invariants.** B1–B4 carry forward- and
   backward-ownership invariants: a frame is owned by exactly one boundary, and a
   boundary owns exactly the frames its rows declare. `registerFrame` carries the
   `(recv, wire)` binding the row already names, and **refuses at registration** a
   pair the rows do not declare — it throws, at E1 onward, rather than deferring a
   mis-bound pair to the E4 fence. The ownership fence at E4 is the static backstop
   that proves no mis-bound pair slipped through, not the first line that catches
   one.

## Phases

Each phase leaves the suite green and the wire untouched. The work is
non-overlapping per boundary, so a boundary can migrate and gate on its own.

- **E0 — Independent inventory.** [A5] Enumerate the worklist from the code, not
  from the registry. The registry rows cannot be the evidence of completeness: a
  frame wired outside the registry is the failure the cutover exists to catch, and
  such a frame is by definition absent from the rows. So E0 is an AST scan of the
  current tree for every call site of the raw primitive, and a separate inventory
  of every *consumer* of the raw methods — callers, adapters, test mocks, helpers,
  scripts, and any public contract that names them [V4] — because sealing the
  surface [A1] breaks a consumer that reads it. The frame-site set is checked to
  cover the registry rows and to exceed them by nothing; a site in the scan but not
  in the rows is an unregistered frame and a finding, not a merge to wave through.

- **E1 — Land `registerFrame`.** Introduce the canonical registrar closing over
  the raw capability, alongside the still-public primitive. It reuses the existing
  flag-off wrap [V5]. Prove it wires and observes identically to the current wrap
  on one boundary's rows. No migration yet.

- **E2 — Migrate, one boundary at a time.** Move every site from the E0 inventory
  to `registerFrame`. Suite green after each boundary. The differential smoke proves
  dispatch byte-identity flag-off and flag-on at each step. [V4] The AST gate runs
  in **warn mode from E1**, reporting any new raw reference while the old sites
  still exist, so a raw call merged mid-migration is visible rather than racing the
  gate's arming. It flips to fail at E4.

- **E3 — Seal the capability.** Remove `onRoutedMessage` / `onNotification` from
  every public receiver and prototype; the raw dispatch survives only as the
  closure capability from E1. Cut the mechanism shim set to its documented minimum
  and freeze the allowlist by module identity. After E3 no reachable object exposes
  the primitive under any key.

- **E4 — Arm the gates.** Flip the AST check to fail, and turn on the runtime
  capability-boundary tests. The build now fails on any new raw reference, and the
  runtime tests prove the capability boundary holds. The sound-no-alias guarantee
  S5 deferred is delivered here — two gates over a partitioned access space, with
  proof — and the S5 fence is re-run against the closed grammar to record that its
  narrowing is retired.

## Gates

- Full `npm test` green after every phase — the canonical gate, unchanged.
- The boundary ownership fence green over the migrated tree, read as sound rather
  than narrowed.
- A differential that dispatches each frame flag-off and flag-on and asserts
  byte-identical handler input and return value. A missed migration is a test
  failure, never a wire regression.
- **The AST identifier gate — names.** [V3] Proven by three negative tests, each of
  which must turn the build red: a direct call, an aliased capture, and a
  re-export — all of which write the Identifier. Computed and bracket access are
  not in this set; they name nothing for it to catch.
- **The runtime capability-boundary tests — reachability.** [A4] A distinct class,
  passing after E3: `recv['onRoutedMessage']` returns undefined; a prototype walk
  over the receiver and its chain finds no such method; `Reflect.get` and
  `Reflect.ownKeys` do not surface it; a reference captured before E3 does not
  survive the seal into a live capability. This is where computed, bracket,
  reflective, and captured-reference access are proven inert. The AST gate proves
  absence in source; these prove unreachability in the running object graph.
- **The wire-literal gate.** [V2] The AST check rejects a `registerFrame` call
  whose `wire` argument is not a literal frame-type constant, proven by a negative
  test that passes a variable and must turn the build red.

## Risk and rollback

The risk is one class: a registration site missed in E2, so a frame stops
dispatching. It is caught before the wire by the differential and the full suite,
because a frame that does not wire does not deliver in test. There is no
partial-wire failure mode that passes tests and fails in production, because the
tests exercise the same dispatch path production does. E0's independent inventory
[A5] is the guard against the site being missed in the first place — the worklist
comes from the code, not from the registry that could omit it — and the warn-mode
gate [V4] is the guard against a new raw call landing during the migration window.

Rollback is a git revert. Nothing deploys a behavior; nothing changes on the
wire; no node on the network can tell whether a peer ran the pre- or
post-cutover tree. WIRE_VERSION does not move. The cutover is invisible to every
other node by construction, which is what makes it safe to land under the
standing fence and roll without a flag day.

## Sequencing

This is held. It lands behind David's go and behind the **fleet soak** on 4.63.0
— the fleet is rolled to 4.63.0 and the soak is running now; the hold is that soak
clearing, which proves the rolled kernel is sound under churn over hours. That is a
different gate from the M1c single-slot canary, which proved only that the shadow
registry observes live frames correctly. Council reviews this design; no code lands
on the review. Contract enforcement stays out of scope and out of this document.
