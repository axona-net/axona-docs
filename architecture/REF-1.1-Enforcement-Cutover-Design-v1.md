# REF-1.1 Enforcement Cutover — Registration Discipline

Kernel 4.63.0 · design, not shipped · shadow default-off throughout

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
one function that wires frames, and the raw primitive is unreachable from
everywhere else. This is a discipline, enforced at build time. It is not a
behavior.

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
general case. So S5 checked the decidable subset — direct calls — and recorded the
gap. The fence was sound *for the grammar it could see*, and the grammar was not
closed.

The cutover closes the grammar. That is the whole point of it.

## The sound core

Soundness comes from changing the question the build asks. S5 asked "is there a
call matching this pattern?" — undecidable under aliasing. The cutover asks "is
the raw dispatch symbol *named* anywhere outside the files allowed to name it?"
— decidable by a scan for one identifier.

The move rests on two facts.

First, an alias must name the symbol before it can capture it. `const f =
peer.onRoutedMessage` still contains the token `onRoutedMessage`. A re-export
still contains it. Any binding of the raw primitive, however many hops it later
travels, has a first hop that writes the identifier. An identifier scan catches
that first hop. Aliasing does not escape a scan for the thing being aliased; it
only escapes a scan for the *call*.

Second — the residual hole — computed access `obj['onRouted'+'Message']` can
reach a property without writing its name. This is closed by making the raw
primitive private: a module-scoped binding with no string-addressable
property on any public object. There is then no key to compute. Computed access
returns `undefined`, not the primitive, and the frame fails to wire loudly rather
than dispatching in the dark.

With both facts in hand the CI invariant is total: the raw dispatch symbol is
referenced only inside an allowlist of named files — the `registerFrame` module
and the documented mechanism shims — and that allowlist is finite, named, and
lives in one place. A scan for the identifier over `src/` either finds a
reference outside the allowlist or it does not. There is no third answer, and no
input defeats it.

## The four exit criteria (Aster, record 3ff52d4c)

1. **One canonical path.** A single `registerFrame(recv, wire, handler)`. `wire`
   is a literal frame-type constant at the call site, never a variable, so the
   frame a call wires is legible without running the code. `registerFrame` does
   two things and no more: it installs the dispatch the raw primitive used to
   install, and — when the shadow flag is armed — it installs the observation
   wrap. One door, and the observation cannot be forgotten because it is not a
   second step.

2. **Prohibit raw access outside it.** `onRoutedMessage` and `onNotification`
   become private bindings. `registerFrame` reaches them. A short, named set of
   mechanism shims reaches them — the low-level demux points that are not frames
   and have no row. Nothing else in `src/` can name them. The shim set is
   enumerated in one file with a one-line justification each, and adding to it is
   a reviewed change.

3. **Enforce across all `src/` in CI.** An AST-based check, not a regex, fails
   the build when the raw dispatch symbol is referenced outside the allowlist.
   Direct calls fail. Aliases fail, because the capture names the symbol.
   Re-exports fail, for the same reason. Computed access cannot reach the
   primitive at all, because there is no public property to address. The check
   reports the file and line, and it is proven by negative tests — one direct,
   one aliased, one computed — each of which must turn the build red.

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

- **E0 — Freeze the worklist.** Enumerate every registration site now live. This
  is the registry row set already: 20 rows on B1, the B2 transport/auth set, the
  B3 signalling/mesh-auth set, the B4 bridge-admin set. The worklist is the
  inventory, not a fresh survey. A site not on it at E0 that appears later is a
  merge that raced the cutover, and the CI gate catches it.

- **E1 — Land `registerFrame`.** Introduce the canonical helper alongside the raw
  primitive, both reachable. Prove it wires and observes identically to the
  current wrap on one boundary's rows. No migration yet.

- **E2 — Migrate, one boundary at a time.** Move every site to `registerFrame`.
  Suite green after each boundary. The differential smoke proves dispatch
  byte-identity flag-off and flag-on at each step, so a missed or miswired site
  shows up as a behavior change in test, not as silence on the wire.

- **E3 — Seal the primitive.** Make `onRoutedMessage` / `onNotification` private.
  Cut the mechanism shim set to its documented minimum and freeze the allowlist.
  After E3 the only references to the raw symbol in `src/` are the ones the
  allowlist names.

- **E4 — Arm the CI gate.** Turn on the AST check and its negative tests. The
  build now fails on any new raw access. The sound-no-alias guarantee S5 deferred
  is delivered here, and the S5 fence is re-run against the closed grammar to
  record that its narrowing is retired.

## Gates

- Full `npm test` green after every phase — the canonical gate, unchanged.
- The boundary ownership fence green over the migrated tree, read as sound rather
  than narrowed.
- A differential that dispatches each frame flag-off and flag-on and asserts
  byte-identical handler input and return value. A missed migration is a test
  failure, never a wire regression.
- The CI gate's three negative tests — direct, aliased, computed — each turning
  the build red. A gate that cannot be shown to fail on a real violation is not a
  gate.

## Risk and rollback

The risk is one class: a registration site missed in E2, so a frame stops
dispatching. It is caught before the wire by the differential and the full suite,
because a frame that does not wire does not deliver in test. There is no
partial-wire failure mode that passes tests and fails in production, because the
tests exercise the same dispatch path production does.

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
