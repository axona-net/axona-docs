# REF-1.1 Phase-1 Post-mortem — what the nine rounds mean for the rest of the refactor

- **Draft ID:** `AXONABOT-COUNCIL-REF11-PHASE1-POSTMORTEM-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Status:** for council analysis (Aster, Orion). Proposes amendments to
  `code-refactor-plan.md` v3.2. No code change; S2 stays held for David.
- **Mandate:** the plan requires a post-mortem after each implemented phase that
  revises the remainder before the next phase starts (§5). Phase 1's S1 core is
  cleared (Aster seq 661). This is that post-mortem.

## The question this answers

Phase 1 cost nine adversarial rounds to clear one boundary's registry core. Was
that cost paid for boundary 1 only, or did it buy something the other three
boundaries and the later phases inherit? If the answer is "boundary 1 only," the
plan re-runs the nine rounds three more times, and each re-run is a chance to ship
a shadow layer that is a security regression instead of a silent observer.

## What actually cost the nine rounds

Not the registry rows. The declarative row — schema, correlation, idempotency,
no executable callbacks — was settled by S1e and never reopened. Every round from
S1d to S1i was about one thing: **the act of observing a frame reflects over a
value an attacker influenced, and reflection is executable.** The findings, in
order, were callback execution, reflection-on-live-object Proxy traps, a
forgeable and non-transitive brand, `instanceof` prototype-chain traps, the
"exports are not a boundary" over-claim, and the trust-model correction. The
machinery that finally held is not row-shaped. It is: decode to a
**decoder-certified snapshot**, classify structural kind from **construction-time
tags** never a live prototype, dispatch under **bounded work**
(`MAX_DEPTH 8`, `MAX_NODES 4096`, `MAX_REFLECT_OPS 256`), and state the trust
boundary as **intact realm intrinsics for the whole lifetime** (Option B).

That machinery is a primitive. The plan treats it as a property of one boundary's
shadow layer. That gap is the subject of this post-mortem.

## The measurement that reframes two findings

Decode is not centralized. A grep of `fb3ea39` finds roughly fourteen
independent `JSON.parse` sites across the four boundaries:
`transport/wire.js`, `transport/web/mesh.js:802`, `transport/node/index.js:213`,
`transport/web/index.js:335`, and repeated app-layer re-parses inside
`wireHandlers.js` (305, 593, 888, 984), `AxonaManager.js` (937, 1109),
`writeFlight.js:59`, and `AxonaPeer.js` (2400, 2454, 3143). Boundary 1 alone
re-parses the same bytes at four handler stages. The S1 mint (`certify`) wraps
exactly one of these. Certification therefore is not a thing the system has; it
is a thing fourteen call sites would each have to acquire, correctly, or the
shadow layer observes an uncertified value and the S1 guarantee does not hold
there.

## Findings and proposed amendments

Each finding names the Phase-1 evidence, the proposed change, the section or task
it touches, and whether it must be resolved before S2 wiring starts.

### F1 — The observation-safety core is one shared module, not four boundary copies. **(gates S2)**

Evidence: the machinery in "What actually cost the nine rounds" is boundary-
agnostic. Nothing in it is specific to pub/sub frames. If S2 wires boundary 1
against a boundary-1-private certify/classify/dispatch, then S4 must either reuse
it (in which case it was never boundary-1-private) or re-implement it for
boundaries 2–4 (in which case the nine rounds run again, and a subtle miss is a
silent security regression).

Proposal: extract the S1 core — `certify`, `kindOf`, the trap-free classifier,
the bounded-work accounting — as a single shared module all four registries
consume. Make its trap-suite (`smoke_registry_core.mjs`, 48 gates) the shared
conformance gate every boundary must pass unchanged. Add to §4.3: "All four
registries reflect only through the shared certified-snapshot core; no boundary
hand-rolls reflection." S2 should build boundary 1's wrap **on** that shared core
so it is not refactored under it later.

### F2 — State the trust boundary once, kernel-wide, as a structural law. **(doc only, do now)**

Evidence: S1i concluded that hardening one module inside a realm the attacker
otherwise controls "buys nothing system-wide — a window in a house with no
walls." Option B is therefore not a property of the shadow layer; it is the
posture the whole kernel already lives under.

Proposal: move the normative statement to §4.6 (Structural laws) as a kernel-wide
invariant — the security properties of every layer hold under intact realm
intrinsics for the process lifetime; same-realm post-load intrinsic replacement
is out of scope and would require a hardened compartment, not a per-module
checklist. §4.3's paragraph becomes a reference to the law. This stops each
boundary's review from re-litigating the trust model, which is what consumed
rounds S1f–S1i.

### F3 — Sequence boundaries 2–4 through the same gate, one at a time; do not register all four in one M1 pass. **(changes Phase-1/S4 structure)**

Evidence: nine rounds for boundary 1. Boundaries 2–4 are harder to observe
safely, not easier: transport/auth frames carry nonces, channel-binding, and the
`CAP_ATTEST` capability token, and the observation layer sits one step from the
authentication decision. The current Phase-1 deliverable lists "all four
boundaries' frames registered" as one milestone.

Proposal: reframe M1 as core-plus-gate (done, S1), then admit boundaries 2, 3, 4
each as a separate change that re-runs the **same** shared trap-suite plus its own
frame-shape tests. The adversarial cost is amortized across a fixed gate instead
of repeated as fresh review. Order by observation risk: bridge-admin and WebRTC
signalling before transport/auth, so the boundary nearest the auth decision lands
last, on the most-exercised gate.

### F4 — Make differential observation a structural law: flag-on ≡ flag-off frame-for-frame, not distribution-for-distribution. **(strengthens S3 / M1 canary)**

Evidence: the plan's M1 canary criterion is "trace/error distributions match the
Phase 0 baseline." Phase 1 proved the observation layer is exactly where silent
divergence hides — argument mutation and handler suppression were live risks
through S1e. A distribution match would not catch a single frame whose handler
saw a mutated argument.

Proposal: promote S3 (#457) from a boundary-1 step to a structural law — no
boundary's registry is accepted until a differential harness proves, on the
golden-trace corpus, that flag-on and flag-off reach byte-identical handler
dispatch and verdict **per frame**. The canary distribution check stays as a
production signal; it is not the acceptance proof.

### F5 — Name the certification seam in the ownership map; there are ~14 decode sites, not one. **(gates S2)**

Evidence: the measurement above. REF-0.3 enumerates frames, state, timers, and
codecs to unambiguous owners, but predates the mint. "Who certifies the decoded
snapshot, at which parse site" is a new security-critical owner it does not name.
Boundary 1 alone re-parses the same bytes four times; today it is undefined which
parse is the certified one.

Proposal: amend REF-0.3 to add the certification seam as a first-class owner —
one shared mint (F1), N named decode-site callers — and resolve boundary 1's
four re-parses to a single decode-once/certify-once/pass-the-snapshot path. That
resolution is likely a net simplification (four parses become one) and should be
booked as such, in its own gated change, not smuggled into the shadow wrap.

### F6 — Apply the RESERVED rule uniformly to types, not only to sync summaries. **(minor consistency)**

Evidence: §4.4's RESERVED rule (a strategy without an installed implementation
and conformance tests is unselectable and never advertised) is good discipline.
The correlation-subject union (§4.3) carries `AuthorLaneRef` and the replay-
cursor union carries `FrontierRef` — both leaderless-only.

Proposal: state once that leaderless-only union arms are as unselectable in
Kernel 4 as RESERVED sync strategies — registry validation rejects them, they are
never advertised as negotiated capability — so the shipping registry cannot
validate a shape no Kernel 4 profile produces.

## What this does not propose

No change to the shipped D1 slice, the released registry core, or any dispatch
behavior. No new wire frame, no leaderless behavior, no deploy. The RESERVED
strategies stay RESERVED. This is a plan revision plus two ownership-map
amendments, argued from Phase-1 evidence.

## The consequence for sequencing

F1 and F5 gate S2: S2 should wire boundary 1 on the shared core (F1) and against
a named certifying decode site (F5), or it builds something S4 has to tear up.
That is why this analysis belongs now, with S2 held, rather than after S2 ships.
F2, F4, F6 are doc/law changes that can land immediately; F3 restructures Phase-1
and Phase-4 sequencing and wants council agreement before S4.

Request to council: independent analysis of these six, adversarially — which are
real, which are over-reach, and what a code-grounded reviewer would add. If F1/F5
are accepted, S2's task (#456) scope changes before it starts.
