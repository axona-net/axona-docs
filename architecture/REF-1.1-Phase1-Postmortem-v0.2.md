# REF-1.1 Phase-1 Post-mortem v0.2 — council dispositions + the locked S2 sequence

- **Draft ID:** `AXONABOT-COUNCIL-REF11-PHASE1-POSTMORTEM-20260810-02`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Supersedes:** `REF-1.1-Phase1-Postmortem-v0.1.md` (commit 1660f41) for the
  disposition and S2-sequence sections; v0.1 keeps the finding rationale.
- **Sources folded:** Aster review (#council seq 664), Aster record corrections
  (seq 668, 671), Aster precision notes (seq 673); Orion independent read
  (seq 670); axona.bot F5 correction (seq 665); David's authorization of the
  revised scope (seq 667).
- **Status:** implementer-facing spec for S2. S2.0a is shipped (testnet 13f0e11).
  S2.0b begins under this document. No canary or deployment clearance.

## What Phase 1 established

The nine S1 rounds hardened one thing: **observation reflecting over an
attacker-influenced value is executable, and the only safe input is a
decoder-certified snapshot classified by construction-time tags under bounded
work.** That machinery is boundary-neutral — a primitive, not a pub/sub
property. v0.1 argues this from the round-by-round evidence; it is not repeated
here.

## Finding dispositions (council-final)

Each row: the finding, its council disposition, and the binding form it takes in
S2. F1–F6 are from v0.1; F7–F8 were added by Aster's review; the F5 premise
correction is owned by axona.bot.

- **F1 — shared reflection-safety core.** ACCEPTED (Aster seq 664, Orion 670).
  Binding form: the certified-snapshot mint, construction tags, safe leaf
  reader/classifier, and observation budgets are **one** implementation at
  `src/registry/`; no boundary keeps a local copy. NOT a universal business
  dispatcher — the four registries stay boundary-parameterized. **Done in S2.0a.**
- **F2 — trust boundary as a kernel-wide law.** ACCEPTED. Binding form: state
  Option B once at plan §4.6 as a kernel-wide invariant (security holds under
  intact realm intrinsics for the process lifetime; same-realm post-load
  intrinsic replacement is out of scope, needs a hardened compartment), with a
  short reference at every decoder/observer seam. Clarify that "realm
  intrinsics/prototypes" means the **trusted built-ins**; attacker mutation of a
  certified value and its own prototype chain stays IN scope.
- **F3 — amortized per-boundary gate.** ACCEPTED staging; order deferred (Aster).
  Binding form: admit boundaries 2–4 one at a time through the same shared
  trap-suite; choose the order only after the S2.0b decode/trust inventory.
  Transport/auth takes the strictest gate regardless of position.
- **F4 — per-frame observational equivalence.** ACCEPTED, name locked
  (Aster seq 673 #1). Binding form: S3/S2.1 acceptance proves, per frame,
  **handler call count and order, `this` identity, argument identities and
  values, synchronous return/throw, asynchronous result, and verdict** are
  identical flag-on vs flag-off. NOT "byte-for-byte handler dispatch." Byte
  equality applies only to serializable golden artifacts where defined. Canary
  distribution stays a monitoring signal, never the acceptance proof.
- **F5 — certification seam in the ownership map.** OWNERSHIP GAP ACCEPTED; the
  "same bytes 4×" premise and global decode-once prescription WITHDRAWN
  (axona.bot seq 665; Aster seq 664, 673 #2). Binding form: S2.0b produces a
  parse-site table and assigns **one named certified-decoder entry per relevant
  parse-site / codec class** — outer wire frames, bigint-revived transport
  values, and nested application-envelope JSON stay semantically distinct and
  are NOT merged into one decode result.
- **F6 — uniform RESERVED rule for types.** ACCEPTED, as a present validator gap
  (Aster). Binding form: `defineRow`/registry validation rejects
  `AuthorLaneRef`, `FrontierRef`, and every uninstalled leaderless union arm
  under Kernel 4; activation requires an installed profile plus conformance
  tests. Landed as an S2.0c gate.
- **F7 — bound the decoder/certification path.** ACCEPTED, CRITICAL (Aster,
  Orion). Binding form: each certifying decoder enforces a **serialized-byte
  ceiling before `JSON.parse`**, because `MAX_NODES`/`MAX_DEPTH` bound the walk,
  not the parse or `Object.keys` enumeration; plus wide/deep/adversarial-number
  tests proving bounded failure. Landed as an S2.0c gate before the mint becomes
  a four-boundary primitive.
- **F8 — non-authoritative certification.** ACCEPTED, CRITICAL (Aster seq 664,
  673 #3). Binding form: the shared brand grants **reflection safety only** — it
  grants no schema validity, authentication, admission, or boundary authority.
  Skip-to-verbatim on observer failure is necessary but is NOT the complete rule.
  A cross-boundary test proves a snapshot certified by one codec gains no
  admission authority at another boundary.

## The locked S2 sequence

David authorized this revised scope (seq 667); Orion cleared the start (seq 670).
Each substep carries its own acceptance gate; none implies canary or deploy.

- **S2.0a — relocate the shared core.** `src/pubsub/registry/` → `src/registry/`,
  zero behavior change, 48-gate suite unchanged, import/re-export proven.
  **DONE — testnet 13f0e11; smoke_registry_core 48/48, full npm test 150/150.**
- **S2.0b — parse-site / certification ownership table.** For every relevant
  decode site (boundary/frame family, input provenance, codec/reviver, maximum
  serialized bytes, output lifetime, downstream consumers, whether shadow
  observation needs it, the fixed certified-decoder entry point): build the
  table, and for boundary 1 select the **authoritative outer-frame decoder
  seam**, keeping semantically-distinct nested decodes separate (F5). Amends
  REF-0.3. No dispatch change.
- **S2.0c — input bounds + type-validation gates.** Pre-parse serialized-byte
  ceiling in the certifying decoder + wide/deep/adversarial-number tests (F7);
  profile/RESERVED union-arm rejection gates (F6). The shared module may expose
  fixed string-only decoder variants; it must not expose an object-branding
  function a file-URL consumer can use to certify a Proxy.
- **S2.1 — wire boundary 1.** Shadow-wrap `_registerHandlers` behind
  `AXONA_REGISTRY_SHADOW` (default off) against the named decoder seam and the
  shared core, then prove per-frame observational equivalence (F4). Certification
  stays non-authoritative (F8).

## Out of scope / still gated

No wire change, no leaderless behavior, no version bump tied to a deploy, no
canary. RESERVED strategies stay RESERVED. The M1 telemetry canary and any
production step remain separately David-gated. Boundaries 2–4 (S4) follow only
after boundary 1 is proven, ordered per the S2.0b inventory (F3).
