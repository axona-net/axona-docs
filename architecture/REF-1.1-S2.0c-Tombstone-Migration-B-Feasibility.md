# REF-1.1 S2.0c — feasibility of avoiding body-absent transferable tombstone authorization (Option B)

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-BFEAS-20260810-01`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-10
- **Kernel:** 4.62.2. Analysis only. No code, no deploy, no design clearance.
- **Context:** Aster's v2/v6 re-review (seq 763) showed that making a migrated tombstone
  a body-absent, cold-verifiable *authorization* proof requires a per-topic membership-
  consensus + trust-anchor protocol (fork-safe transitions, authenticated genesis,
  portable checkpoints, key freshness) — a three-tier stack S2.0c-MEMBERSHIP → S2.0c-AUTH
  → chunking v6. David directed: **evaluate whether the requirement can be reframed to
  avoid that (Option B) before building the consensus layer (Option A).** This is that
  evaluation.

## The question

A tombstone must do two things during full-state migration to a fresh replica: **not let
a non-author suppress content (authorization)**, and **not let a deleted body come back
(permanence)**. Option A proves both to a cold replica cryptographically — which forces a
membership history, which forces consensus. The question here: can the *same two
properties* be preserved **without** a transferable, cold-verifiable authorization proof —
and therefore without a membership-consensus layer?

## Why A is expensive (one sentence)

Authorization is cheap where the body is present — `kill.signerPubkey == the body's
B-4-verified publisher` is a local check — and expensive where the body is absent, because
then the only thing that ties the killer to authorship is an attestation by *whoever
admitted the message*, which is a claim about historical cohort membership, which needs
consensus to be fork-safe. **The cost traces entirely to insisting a body-absent tombstone
be a transferable authorization proof.**

## B: two tiers of deletion, only one of them authoritative

Split what a tombstone means by whether the body is co-located:

- **Authoritative deletion (unchanged, cheap).** A node that *holds* a message's body
  applies a signed kill only after checking `verifyKill(signedKill)` **and**
  `signedKill.signerPubkey == the body's authenticated publisher`. This is a local,
  membership-free check — it is the deletion right, "proven by the same keypair that proved
  authorship," exactly where the body still exists to prove it against. Authoritative
  deletions propagate through the mesh by the existing signed-kill distribution (eager
  K-closest cohort delivery, kill-gated-on-prior-delivery; the 4.10.0 kill-consistency
  work), reaching body-holders who each authorize locally.

- **Migration suppression hint (new, non-authoritative, bounded).** Full-state migration
  (REPLICATE / HANDOFF / REPLAYUP) carries the **signed kill object** (not today's unsigned
  `_activeDels` form) alongside state. On the receiver:
  - if it holds the body, it authorizes co-located (above) and deletes authoritatively;
  - if it does **not** hold the body, it records a **suppression hint**: it suppresses that
    `msgId` if the body later arrives, but it does **not** treat the hint as an authorized
    deletion it will itself re-propagate as authoritative, and the hint **expires** on a
    **locally derived** clock.

A migrated hint is promoted to an authoritative tombstone only if/when the node
independently authorizes the kill (co-located with a body, or via the normal kill path). A
forged or omitted hint therefore never creates a durable authorized deletion that spreads.

## The two properties, argued

### Permanence — a deleted body does not come back

The claim: **a suppression hint whose expiry is `local-receipt-time + TTL_CEILING`
outlives every legitimately-existing copy of the body, so no resurface — with no transferable
authorization.** The argument rests on three kernel facts:

1. **Bodies have a hard death from their own publish time.** `_expireCache`
   (`topicStore.js`) evicts on `now − cache[0].publishTs > TTL_MS`; `_cachePush` dedups by
   `cacheIds`, so re-delivery of the same `msgId` does **not** refresh `publishTs`; `touch`
   may extend life but "never past the cap." So any copy dies at `publishTs + TTL_CEILING`,
   full stop.
2. **`msgId` is content-addressed to the author.** `msgId = hash(publisher ‖ message)`,
   B-4-verified at ingress. Only the author can mint a given `msgId`; no third party can
   "republish" a killed message to give it a fresh life.
3. **A copy present at time `T` was published in the past:** `publishTs ≤ T`, so it dies by
   `publishTs + TTL_CEILING ≤ T + TTL_CEILING`.

A suppression hint received at `T` and held until `T + TTL_CEILING` therefore covers the
death of every copy that existed at `T`. A copy "born" after `T` could only be the author
re-minting the exact `msgId` — which a deleting author will not do, and no one else can. So
no copy outlives its suppression, and after `T + TTL_CEILING` both the suppression and every
copy are gone. **No resurface, no membership history required.** (Expiry derives from the
local monotonic clock, never from the attacker-suppliable `killTs` — the same "don't trust
wire `publishTs`" discipline the envelope layer already uses.)

Within a single migration, body and tombstone travel together (tombstones lead the batch in
the chunking design), so there is no intra-migration window where a killed body is served
before its hint. The only re-exposure window is the general kill-consistency one — body and
kill arriving by different paths with the kill slower — which exists today and under A alike;
B does not worsen it.

### Authorization — a non-author cannot durably suppress

A forged suppression hint (a malicious migration sender naming a `msgId` never actually
killed) suppresses that message on the fresh replica for at most `TTL_CEILING`, and creates
**no** authoritative deletion the replica re-propagates. Two bounds contain it:

- **Bounded and self-healing.** The authoritative copy of the message (held by the live
  cohort, replayed by anti-entropy) re-delivers it once the hint expires; the censorship is
  temporary, not permanent.
- **Reduces to E-1 given a migration-source gate.** To be a REPLICATE/HANDOFF *source* for
  a fresh replica, the sender must be an accepted migration peer — which should be, and the
  design must ensure is, a keyspace-proximate cohort member. Landing ≥1 proximate seat for a
  target topic is the address-grinding cost **E-1** — the *same floor* Option A's forgery
  residual bottoms out at. **Requirement to verify/enforce:** a fresh replica accepts
  full-state migration only from a proximity-eligible source; if that gate is absent today,
  B must add it (a node should not accept whole-state from an arbitrary authenticated peer
  regardless).

So B's authorization residual is *temporary, bounded, self-healing suppression by an
E-1-capable attacker*. A's is *nothing, by an E-1-capable attacker*. Both rest on E-1.

### Against the current production gap

Today, `_activeDels` migrates **unsigned** tombstones and `_applyDels`/`_applyKill` apply
them with **no `verifyKill`** — any authenticated sync sender **permanently** tombstones
arbitrary `msgId`s on a backup (the disclosed unsigned-migrated-tombstone gap). B closes
that gap: migrated kills are **signed** (forgery now needs a signature, and the sender still
can't fabricate authorship), and a body-absent hint is **bounded + non-authoritative**
instead of permanent. **B is a strict improvement over production today**, independent of
whether A is ever built.

## What B does NOT provide (honest limitations)

- **No cold-verifiable authorized-delete proof.** A fresh replica cannot prove to a third
  party that a suppression was authorized. B's position is that it does not need to —
  authoritative deletion is established locally where bodies live; migration only needs
  bounded suppression plus convergence to authoritative state.
- **Temporary censorship is possible** (bounded `TTL_CEILING`, self-healing, E-1-gated).
  A eliminates it; B tolerates it. This is the core trade.
- **Leans on existing kill distribution.** Permanence of *real* deletes depends on the
  signed kill reaching body-holders — the 4.10.0 kill-consistency machinery. B does not
  worsen it, but does not strengthen it either; if that path has residual gaps they remain.
- **`TTL_CEILING` becomes security-load-bearing**, not just a storage bound. Its value must
  be the true absolute maximum body lifetime (including any `touch` extension cap).

## A vs B

| | A (S2.0c-MEMBERSHIP stack) | B (bounded suppression hints) |
|---|---|---|
| New machinery | per-topic Byzantine membership consensus, authenticated genesis, portable checkpoints, forward-secure keys, replica→assembler attestation wire | signed kill in migration + local-clock suppression expiry + migration-source proximity gate |
| New crypto domains | ≥3 (`ADMISSION_ATTEST`, `COHORT_DESC`, `COHORT_TRANSITION`) + key-freshness | none — reuses `kill.js`, B-4, content-addressing, TTL |
| Security floor | E-1 | E-1 |
| Authorization residual | none | temporary bounded self-healing suppression |
| vs prod gap | closes | closes |
| Fits REF-1.1 (simplify) | adds a consensus subsystem | net removal (deletes the unsigned-tombstone path, adds no subsystem) |
| Open hard problems | F1 genesis, F3 fork, F4 checkpoints, F6 key freshness | verify TTL-ceiling invariant + migration-source gate |

## Verdict and recommendation

**B appears viable and reduces to the same E-1 security floor as A, with none of the
consensus machinery** — resting on invariants the kernel already has (hard-death TTL,
content-addressed `msgId`, signed kills, co-located authorization) plus two checks to
confirm/enforce (the absolute TTL ceiling is truly hard; migration is accepted only from a
proximity-eligible source). Its price is a **bounded, self-healing, E-1-gated temporary
censorship** window that A would eliminate — and even with that price B is strictly better
than production today.

Recommendation: **adopt B as the S2.0c authorization approach** unless the council judges
that eliminating *temporary* suppression is worth a per-topic Byzantine consensus layer in a
refactor whose stated purpose is to remove complexity. If B is chosen, the next artifact is
a short **S2.0c-AUTH-B design** (signed-kill migration + local-clock suppression + the
proximity-source gate + tests: forged-hint bounded-suppression, no-resurface-past-TTL,
co-located authoritative delete, omitted-hint harmless, TTL-ceiling-is-hard), and chunking
v6 loses its consensus dependency entirely — it carries signed kills, which it already knows
how to chunk. S2.0c-MEMBERSHIP is not built.

Two facts to confirm in code before B is promoted from analysis to design: (1) no path
refreshes a cache entry's effective death beyond `publishTs + absolute-cap` (including
`touch` and any re-ingest); (2) a fresh replica's REPLICATE/HANDOFF acceptance is, or can be,
gated on source proximity. Both look true from the read above; both must be asserted with a
test.

## Status

Analysis only. No code, no S2.0c/S2.1 clearance, no canary, no deploy. Submitted for the
council's read and David's direction: adopt B (and write S2.0c-AUTH-B), or proceed with A
(S2.0c-MEMBERSHIP). The three-tier A designs and chunking v6 remain gated either way.
