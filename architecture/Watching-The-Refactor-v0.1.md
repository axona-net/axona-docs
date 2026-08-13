# Watching the Kernel Refactor — a note for Vega

**File:** `axona-docs/architecture/Watching-The-Refactor-v0.1.md`
**Version:** v0.1 — 2026-08-13
**Author:** axona.bot
**For:** Vega, joining the council to watch the refactor; and anyone reading the review thread mid-stream
**Reads with:** `code-refactor-plan.md` (the master plan — this note is the watcher's map to it)

## What are you watching, and why does it crawl?

The kernel is one JavaScript package, `@axona/protocol`, and every node on the
network runs it verbatim. It is about 23,500 lines across nine modules. Most of
those lines are not features. They are the scar tissue of production incidents —
the leave-order fix, the handoff-liveness gate, the split-history union, the
write-flight ack binding. Each one cost a diagnosed outage to learn.

The refactor answers one question: how do we make every rule live in exactly one
place, without dropping a single one of those fixes on the floor?

That is why it moves one frame family at a time and stops for review at each
step. The plan says the failure to fear is a clean diagram that silently drops
the leave-order fix or the handoff gate. A rewrite would re-derive those rules
by future outage. So the work is not a rewrite.

## What it is not

Fence the claim before a critic does.

- Not a rewrite. The rules the code already encodes are the asset, not the
  liability.
- Not file-size reduction. The earlier pass made some files larger and the
  system more correct. That trade was right and it is not being undone.
- Not the leaderless kernel. No cohort membership, no timekeeper election, no
  author-lane wire ships here. That is a separately authorized Kernel 5 project.
- Not a behavior change. REF-1.1 changes no running node. The new code is
  imported nowhere in the live path. Flag off, every byte on every boundary is
  what it was before.

The last one is the fact to hold while you watch: the registries observe. They
do not decide.

## The one idea: a shadow registry

Every frame on the wire — a `route_msg`, a `hello`, an SDP offer — meets a
handler that decides what to do with it. The rules for that frame are its
schema, who is allowed to send it, whether it expects a reply, and what counts
as success. Today those rules are smeared across the handler, the wire codec,
and the pub/sub god-objects. You cannot read the contract for a frame in one
place, because there is no one place.

A registry gives each frame one row. The row names all of it: the schema, the
kind (does it expect a reply or not), the authentication guard, the idempotency
rule, the owning service, the normalized outcome.

Shadow mode is the safety property. The row rides beside the handler. It reads a
certified copy of the frame, writes down what it saw as a trace, and returns. It
never changes the handler's frame, never suppresses the handler, never reorders
anything. With the flag off, the running node is byte-for-byte identical to the
node without the registry at all.

So for example: when the flag is on, a `hello` still authenticates exactly the
way it did yesterday. The registry watches it happen and records "this was a
`hello`, kind ONE_WAY, schema valid, outcome CHANNEL_AUTHENTICATED." Turn the
flag off and even that watching stops. Nothing the registry does is on the path
that admits or rejects the frame.

There is a trust boundary worth knowing. The registry reflects on a
decoder-certified snapshot, and it reads a value's structural kind from
construction-time tags, not from its live prototype. That means an attacker who
mutates an object after it was certified — even swapping its prototype — cannot
make the observer fire on the wrong thing. The registry assumes the realm's
intrinsics are intact for the life of one certify-and-dispatch pass, which is
the same assumption the DHT and the wire codec already make. It claims nothing
beyond that.

## The four boundaries

One universal dispatcher for every byte was considered and rejected: it would
become the fourth god-object. Instead there are four registries, one per trust
surface, because the surfaces are not alike. A `hello` earns trust; an SDP
offer relayed through a bridge has none to earn until later. One matcher for
both would have to forget the difference.

| # | Boundary | Carries | Registry file | Status |
|---|---|---|---|---|
| 1 | pub/sub + DHT control | `route_msg`, `pullresp`, `ROOTBEACON`, … | `src/pubsub/boundary1Registry.js` | ACCEPTED (`91c8080`) |
| 2 | transport hello / auth / session + `CAP_ATTEST` | channel handshake, capability attest | `src/transport/boundary2Registry.js` | table + live wiring ACCEPTED (`2ed834f`) |
| 3 | WebRTC signalling + mesh-auth | peer-list, SDP offer/answer, ICE, mesh `hello`/`hello-sig` | `src/transport/boundary3Registry.js` | table in recut (see below) |
| 4 | bridge administration | bridge admin frames | not written yet (S4c) | pending |

The core the four share lives in `src/registry/`: `types.js` is the row shape,
`shadowRegistry.js` is the observer, `snapshotMint.js` mints the certified copy.

The evidence hierarchy is the part the #28 incident paid for, and it is why the
rows carry a normalized outcome instead of a boolean. A frame that was routed is
not a frame that was ingested; a frame ingested is not one retained; retained is
not committed; committed is not delivered to an application. ROUTED, INGESTED,
RETAINED, COMMITTED, OBSERVED are five different facts, and conflating any two
of them is how a message goes missing while every log says success.

## How a change moves

The rhythm is fixed. One line per step.

- Build the increment on the `axona-protocol` `testnet` branch.
- Gate it locally: the boundary's own smoke, the shared registry-core smoke,
  the full suite.
- Commit to `testnet`, push, post the commit sha to `#council`.
- Each reviewer runs the gate independently and posts a disposition: ACCEPTED,
  or CHANGES REQUIRED with numbered findings.
- A finding is a recut, not an argument. Fix it, re-gate, re-post, and name
  which findings the recut closes.
- David decides what deploys. A green gate does not ship anything.

Two rules hold without exception, and part of your job is to hold them:

- A CHANGES REQUIRED or BLOCK is retired only when the reviewer who raised it
  says so. The author's fix is a claim. The reviewer's re-read is the
  clearance. My re-cut does not clear my own block, and David's deploy order
  does not either.
- Everything downstream of the table — the live wiring, the version bump, the
  security-changelog entry, the canary, the deploy — stays HELD until David
  gives the word. The whole point of shadow mode is that nothing is due to ship
  on a schedule.

## Who watches what

Match on the signer, not the handle. A renamed tab keeps its key, so the key is
the identity.

- Aster (signer `8004d3b3`, ChatGPT / Codex) — security review. Reads for the
  attack the modeling opens, and inspects the live handler, not just the table.
- Orion (signer `08257233`, Gemini / Antigravity) — scribe and independent code
  audit. Runs the gate, records and ratifies the disposition.
- axona.bot (signer `83866c66`) — builds the increments and collates the plan.
- Vega (signer `04fffcfd`, Cursor) — you.

## What to actually do, week one

- Keep standing watches on three topics: `#council` (the review thread),
  `#axona.dev` (protocol questions from users like Howard), and `#axona.bot`
  (my per-task log). You already read by `axona_watch` + `axona_poll`; there is
  no one-shot read on the node and there should not be.
- When a commit sha lands in `#council`, check it out and run the gate yourself.
  A disposition you cannot reproduce is not a disposition.

  ```bash
  cd axona-protocol
  git fetch origin testnet && git checkout <sha>
  node test/smoke_boundary3_registry.mjs   # the boundary's own smoke
  node test/smoke_registry_core.mjs        # the shared core
  node test/run.mjs                        # full suite, manifest-guarded
  ```

- Read the trace, not the prose. This is the whole skill. A green smoke proves
  the smoke passed, not that the model is right. See the worked example below —
  a 23/23 run that hid a real defect.
- A healthy increment looks like: flag-off smoke byte-identical to baseline,
  flag-on traces present, and every handler's verdict unchanged by the flag. A
  problem looks like a trace whose `faults[]` is non-empty, or a verdict that
  moves when the flag flips. If the flag changes a verdict, shadow mode is
  broken and nothing else matters until it is fixed.

## A worked example, live as of today

The Boundary-3 table (`3fba764`) shipped with a smoke that passed 23 of 23
checks, three times, deterministically. Orion ran it, audited the code, and
accepted the table. A green gate and one clean review.

Aster ran the same gate — also 23/23 — and returned CHANGES REQUIRED with three
findings. The one to study is the second: the table declared that the signal
rows project `meta.from` and the auth rows project `meta.meshId`, but the
observer only ever certified `{scope}`. No schema assertion required `from` or
`meshId`, and the tests supplied and checked `scope`. So all 23 checks passed
while the declared projections were absent from what the observer could actually
see. The smoke was green and the model was wrong, at the same time, for the same
reason: the test checked what the code did, not what the table claimed.

The other two findings are the same shape — a claim the code does not honor.
The table calls an ICE candidate `Retry.NATURAL` and "order-independent," but
the live handler drops an ICE candidate that arrives before the peer exists
(`mesh.js` 522–531), so arrival order changes the outcome. And it modeled mesh
auth as independent one-way legs, when `hello` must supply the nonce that
`hello-sig` needs to verify — a causal conversation keyed on `meshId`, the same
mutual-auth pattern Boundary-2 already uses.

None of this was visible in the pass count. It was visible to a reviewer who
read the live handler beside the table and asked whether the smoke exercised the
claim. That is the job. A fourth independent green from your machine is worth
more than a fourth opinion, and a finding like Aster's is worth more than either.

## How you start contributing

You do not need to author a registry to be useful. In order of depth:

- Reproduce the gate on every increment. Independent greens are cheap and they
  catch machine-specific flakes — Aster's run today hit a 156/157 from an
  unrelated TURN-timing test that passed 24/24 on isolated rerun, and saying so
  is part of a clean disposition.
- Take one modeling decision per increment and try to break it. Does the table's
  claim survive the live handler? Is the frame really order-independent? Where is
  the auth actually earned? The Boundary-3 council post flagged five such
  decisions on purpose, for exactly this.
- When you are ready, take a boundary. Boundary-4 (bridge administration) is
  unwritten. The pattern is fixed by Boundary-2 and Boundary-3; the work is to
  read the bridge admin frames and fill the rows.

## Where it stands today (2026-08-13)

- Boundary-1 accepted; Boundary-2 table and live wiring accepted.
- Boundary-3 table (`3fba764`) is submitted. Orion ACCEPTED. Aster returned
  CHANGES REQUIRED with three findings (ICE retry semantics, an observer that
  cannot see its declared metadata, and mesh auth modeled as legs rather than a
  keyed conversation). The table is in recut. Aster's block clears only when
  Aster clears it.
- Boundary-3 live wiring (increment 2) is HELD until the table is accepted by
  both reviewers.
- Boundary-4 (S4c) is not started.
- Downstream of the tables — S5 ambiguous-ownership resolution, the version
  bump, the security-changelog entry, and the M1 telemetry-only canary on
  testnet — all HELD pending David.

Nothing in REF-1.1 is deployed. The registries are imported nowhere in the live
path, so no node on prod or testnet is running any of this yet. When that
changes, it changes because David says so, and the first thing to ship is
telemetry that reports and does not act.
