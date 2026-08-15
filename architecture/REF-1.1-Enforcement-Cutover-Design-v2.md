# REF-1.1 Enforcement Cutover — Registration Discipline (v2)

Kernel 4.63.0 · design, not shipped · shadow default-off throughout

Recut of v1 after Aster's review (council seq 1123, relayed by David). v1 asserted
that a module-private binding removes the string-addressable surface; it did not
require the mechanism that makes that true, nor prove the surface gone at runtime.
Aster: "as written, it assumes the condition it needs to prove." v2 requires the
capability boundary as a design obligation and proves it at runtime. The five
changes are marked [A1]–[A5] where they land.

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
shadow flag stays off by default.

What changes is where a frame is allowed to be *wired*. Today a handler may reach
the raw dispatch primitive from anywhere in `src/`. After the cutover there is
one function that wires frames, and the raw primitive is unreachable — at
runtime, not just absent from source — from everywhere else. This is a
discipline, enforced at build time and proven at run time. It is not a behavior.

Contract enforcement — a registry that reflects on a frame and refuses it when it
violates its declared row — is a separate, later, wire-affecting phase. It rides
the Envelope V2 flag day and the 5.0.0 bump. This document does not design it and
does not depend on it.

## Why the S5 scan could not close this

S5 shipped the ownership fence on a NARROWED claim, and said so. The narrowing
was forced by aliasing. The fence scanned for a syntactic pattern — a call that
looks like `.onRoutedMessage(`. A pattern scan is defeated by three moves:

    const f = peer.onRoutedMessage; f(wire, handler)   // alias
    const m = 'onRouted' + 'Message'; peer[m](...)     // computed
    Object.assign(sink, { route: peer.onRoutedMessage })  // re-export

Each of these dispatches a frame without ever writing the token the scanner
looks for at the call site. A scanner that tries to follow them is a dataflow
analysis over the whole module graph, and that analysis is not decidable in the
general case. So S5 checked the direct-call subset and recorded the gap. The
fence was sound *for the grammar it could see*, and the grammar was not closed.

The cutover closes the grammar. That is the whole point of it. But the closure is
a mechanism the design must build, not a property it may assume.

## The sound core

Soundness comes from two things that must both hold. v1 stated the first and
assumed the second. v2 requires both.

**The identifier scan (decidable).** An alias must name the symbol before it can
capture it. `const f = peer.onRoutedMessage` still contains the token
`onRoutedMessage`. A re-export still contains it. Any binding of the raw
primitive obtained through a *named* reference, however many hops it later
travels, has a first hop that writes the identifier. A scan for the identifier
catches that first hop. Aliasing does not escape a scan for the thing being
aliased; it only escapes a scan for the *call*.

**The capability boundary (the part v1 assumed).** [A1] An identifier scan is
worth nothing if the primitive is still reachable without naming it — through a
bracket read `recv['onRouted'+'Message']`, a prototype walk
`Object.getPrototypeOf(recv).onRoutedMessage`, a reflective `Reflect.get`, or a
reference some module captured before the seal and still holds. v1 said "make the
binding module-private" and claimed there is then "no key to compute." That claim
is only true if the design *removes the method from every public receiver and its
prototype chain* — and v1 did not require that, so it assumed its own conclusion.

v2 requires it. The raw dispatch primitive is a **closure-captured capability**:
a function value closed over by `registerFrame` and by the named mechanism shims,
and by nothing else. It is **not a method on any receiver, any receiver's
prototype, or any exported object.** There is no own property and no inherited
property, under any string or symbol key, on any reachable object, that returns
it. A bracket read finds nothing. A prototype walk finds nothing. `Reflect.get`
finds nothing. There is no surface to capture, so there is nothing a pre-seal
capture could still hold — the migration inventory [A2] proves no such capture
survives, and the runtime tests [A4] prove the surface is gone.

With both in hand the invariant is total. The identifier scan proves no module
*names* the primitive outside the allowlist. The capability boundary proves no
module *reaches* it without naming it. Neither alone is enough; v1 shipped the
first and asserted the second. The question the build asks becomes decidable —
"is the symbol referenced outside the allowlist?" — and the question the runtime
answers becomes total — "does any non-privileged access path return the
primitive?" — and the answer to the second is no, by construction and by test.

## The four exit criteria (Aster, record 3ff52d4c) — with v2 sharpening

1. **One canonical path.** A single `registerFrame(recv, wire, handler)`. `wire`
   is a literal frame-type constant at the call site, never a variable, so the
   frame a call wires is legible without running the code. `registerFrame` does
   two things and no more: it installs the dispatch the raw primitive used to
   install, and — when the shadow flag is armed — it installs the observation
   wrap. One door, and the observation cannot be forgotten because it is not a
   second step.

2. **Prohibit raw access outside it.** [A1] The raw dispatch primitive is a
   closure-captured capability, reachable only by `registerFrame` and a short,
   named set of mechanism shims — the low-level demux points that are not frames
   and have no row. It is not a method on any public receiver or prototype. The
   shim set is enumerated in one place with a one-line justification each, and
   adding to it is a reviewed change.

3. **Enforce across all production-reachable modules in CI.** [A3] An AST-based
   check, not a regex, fails the build when the raw dispatch symbol is referenced
   outside the allowlist. The allowlist is keyed by **module identity and export
   identity, not by filename** — a rename, a moved file, a symlink, or a
   re-export cannot inherit privilege by matching a path string. The check covers
   every production-reachable module and its exports. Direct calls fail. Aliases
   fail, because the capture names the symbol. Re-exports fail, for the same
   reason. The check reports the module and line.

4. **Preserve the ownership invariants.** B1 through B4 carry forward- and
   backward-ownership invariants: a frame is owned by exactly one boundary, and a
   boundary owns exactly the frames its rows declare. `registerFrame` carries the
   `(recv, wire)` binding the row already names, so migration moves a
   registration without moving its ownership. The fence — now reading a closed
   grammar — runs green over the migrated tree, and this time the green is sound,
   not narrowed.

## Phases

Each phase leaves the suite green and the wire untouched. The work is
non-overlapping per boundary, so a boundary can migrate and gate on its own.

- **E0 — Independent inventory.** [A5] Enumerate the worklist from the code, not
  from the registry. The registry rows cannot be the evidence of completeness: a
  frame wired outside the registry is the failure the cutover exists to catch, and
  such a frame is by definition absent from the rows. So E0 is an AST scan of the
  current tree for every call site of the raw primitive, and a separate inventory
  of every *consumer* of the raw methods — callers, adapters, test mocks, and any
  public contract that names them — because sealing the surface [A1] breaks a mock
  or adapter that reads it. The frame-site set is then checked to cover the
  registry rows and to exceed them by nothing; a site in the scan but not in the
  rows is an unregistered frame and a finding, not a merge to wave through.

- **E1 — Land `registerFrame`.** Introduce the canonical helper closing over the
  raw capability, alongside the still-public primitive. Prove it wires and
  observes identically to the current wrap on one boundary's rows. No migration
  yet.

- **E2 — Migrate, one boundary at a time.** Move every site from the E0 inventory
  to `registerFrame`. Suite green after each boundary. The differential smoke
  proves dispatch byte-identity flag-off and flag-on at each step, so a missed or
  miswired site shows up as a behavior change in test, not as silence on the wire.

- **E3 — Seal the capability.** Remove `onRoutedMessage` / `onNotification` from
  every public receiver and prototype; the raw dispatch survives only as the
  closure capability from E1. Cut the mechanism shim set to its documented minimum
  and freeze the allowlist by module identity. After E3 no reachable object exposes
  the primitive under any key.

- **E4 — Arm the gates.** Turn on the AST check and both negative-test classes
  (below). The build now fails on any new raw reference, and the runtime tests
  prove the capability boundary holds. The sound-no-alias guarantee S5 deferred is
  delivered here — mechanism plus proof, not assertion — and the S5 fence is
  re-run against the closed grammar to record that its narrowing is retired.

## Gates

- Full `npm test` green after every phase — the canonical gate, unchanged.
- The boundary ownership fence green over the migrated tree, read as sound rather
  than narrowed.
- A differential that dispatches each frame flag-off and flag-on and asserts
  byte-identical handler input and return value. A missed migration is a test
  failure, never a wire regression.
- **The AST source-text gate**, proven by three negative tests — direct, aliased,
  computed — each of which must turn the build red. This proves no module *names*
  the primitive outside the allowlist.
- **[A4] The runtime capability-boundary tests**, a distinct class proving raw
  access fails at *run time*, not merely that source text is clean. Each must pass
  after E3: a bracket read `recv['onRoutedMessage']` returns undefined; a prototype
  walk over the receiver and its chain finds no such method; `Reflect.get` and
  `Reflect.ownKeys` do not surface it; a reference captured before E3 does not
  survive the seal into a live capability. The AST gate proves absence in source;
  these prove unreachability in the running object graph. A design that passed the
  first and failed the second would be the v1 gap made concrete.

## Risk and rollback

The risk is one class: a registration site missed in E2, so a frame stops
dispatching. It is caught before the wire by the differential and the full suite,
because a frame that does not wire does not deliver in test. There is no
partial-wire failure mode that passes tests and fails in production, because the
tests exercise the same dispatch path production does. E0's independent inventory
[A5] is the guard against the site being missed in the first place — the worklist
comes from the code, not from the registry that could omit it.

Rollback is a git revert. Nothing deploys a behavior; nothing changes on the
wire; no node on the network can tell whether a peer ran the pre- or
post-cutover tree. WIRE_VERSION does not move. The cutover is invisible to every
other node by construction, which is what makes it safe to land under the
standing fence and roll without a flag day.

## Sequencing

This is held. It lands behind David's go and behind the 4.63.0 soak clearing —
the soak proves the rolled kernel is sound before the tree is restructured on top
of it. Council reviews this design; no code lands on the review. Contract
enforcement stays out of scope and out of this document.
