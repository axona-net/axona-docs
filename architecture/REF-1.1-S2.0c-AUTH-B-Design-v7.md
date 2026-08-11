# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v7

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-07`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v6.md` (78c3ba1), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V6-REVIEW`, msgId 999c9434). **Signed-expiry v6 is ACCEPTED**;
  Option-1 remains approved in principle. v7 resolves the two AUTH-B blockers: **blocker 1** —
  authority is a local fact and must not travel as a transferable marker; **blocker 2** — the
  tombstone bound must be specified, not asserted. **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design-v6.md` (accepted). Builds none of S2.0c-MEMBERSHIP.
  S2.0c/chunking held.

v6's error was making the authoritative tombstone a *transferable* verdict. v7 returns to the
v3/v4 principle Aster reaffirmed: **authority is earned locally by co-location and never
trusted from another node.** Everything else in v6 stands.

## Blocker 1 (revises v6) — authority is local and non-transferable

A tombstone is authoritative on a node **only because that node** held the body, recomputed its
`MSGID_DOMAIN_V2` id, and matched the kill's signer to the body's committed publisher. That is a
**local** fact. A migrated signed kill proves only "*some* key signed a kill naming this
`msgId`" — it does not prove the co-location check happened. So a malicious replica can attach
an "authoritative, publisher = attacker" label to any valid non-author kill and send it to a
body-absent receiver, who cannot recover the committed publisher from the one-way `msgId` and so
cannot distinguish the fabrication from a genuine verdict. Trusting a transferred verdict is
forged suppression. v7:

- **The authoritative tombstone never migrates as authoritative.** On migration a node sends
  only the **signed kill**. `verifyKill` proves the signer signed *a* kill for the `msgId`; it
  does not confer authority.
- **The receiver earns authority locally or not at all.** A migrated kill enters the bounded
  provisional candidate set. It becomes an authoritative tombstone on the receiver **iff** a body
  arrives there and the co-location check passes there (`verifyEnvelope` B-4, `MSGID_DOMAIN_V2`
  recompute, `signer == body.publisher`, `now ≤ effectiveDeath`).
- **The local verdict survives the node's own body eviction.** A node that already earned the
  tombstone keeps it (in the bounded tombstone set, blocker 2) to `effectiveDeath`, so a forged
  kill arriving *there* is dropped against the local verdict even after the body leaves the
  cache. The verdict is durable **locally**; it is never exported as authority.

**Why no "cold-verifiable witness" (Aster's alternative, rejected with reason).** A witness that
let a body-absent receiver re-derive authority would have to carry enough to recompute
`msgId = sha256(canonical({d, exp, message, publisher, topicId}))` and to bind the publisher —
which requires `message`. Carrying `message` preserves the very content the kill deletes, so the
witness defeats deletion. There is no one-way-hash-only proof that a given `msgId` was authored
by a given publisher without the message. Hence authority **cannot** be made cold-verifiable
under B-prime; it is local by necessity, and the residual is the accepted bounded resurrection.

**Malicious-state-source vector (required):** a peer sends a fabricated "authoritative" tombstone
wrapping a valid **non-author** kill for a victim `msgId`. The receiver ignores the marker,
treats the signed kill as a bounded candidate, and never suppresses the victim's body without its
own body-based co-location check → forged suppression impossible.

## Blocker 2 (specifies the bound v6 only asserted) — the tombstone-saturation invariant

The shipped kernel holds tombstones in a plain per-role `Map` that only *time*-expires; v6 cited
Phase A but Phase A does not supply a cardinality or byte bound. v7 specifies one (design only —
this is the bound to add, no code here):

- **Accounting unit.** One tombstone per `(topicId, msgId)`: a fixed-size record —
  `{ topicId, msgId, signerPubkey, effectiveDeath }` plus the verifying signed-kill bytes. No
  message, no per-body growth.
- **Capacity.** A normative per-node bound `TOMBSTONE_MAX` (by count and by bytes), with
  **per-signer** and **per-topic** sublimits so no single signer or topic can consume the whole
  bound.
- **Admission at capacity is REFUSAL, never live-eviction.** A live tombstone (one with
  `now ≤ effectiveDeath`) is **never** evicted to make room — evicting it would drop a suppression
  and open the no-suppression-gap. When the set (or a sublimit) is full of live entries, a new
  kill's admission as a tombstone is **refused**: the kill stays an unapplied bounded candidate,
  the message is **not** suppressed at this node, and that is an accepted, documented **refusal /
  resurrection** mode (the deletion waits until capacity frees at `effectiveDeath` or the kill
  re-propagates to a non-full replica). Only **expired** tombstones (past `effectiveDeath`) are
  reclaimed.
- **Migration/adoption when the receiver is full.** A receiver at tombstone capacity refuses to
  adopt a migrated kill as a tombstone; it keeps it under the provisional candidate cap (or drops
  it there under that cap) — accepted refusal, re-propagation. A receiver never displaces a live
  tombstone to adopt a migrated one.
- **Semantics stated:** refusal-at-capacity is an accepted availability-over-deletion residual,
  bounded by `effectiveDeath`; it never produces forged suppression and never silently drops a
  live suppression.

## Mechanism, consolidated (v7)

1. Migration carries **bodies** (→ bounded body cache) and **signed kills** (→ bounded provisional
   candidate set, per-signer + global cap) — **never** an authoritative marker.
2. On a kill: if a **local** authoritative tombstone exists for `(topicId, msgId)`, adjudicate
   against it (matching signer confirmed; mismatch dropped). Else the kill is a bounded candidate.
3. On body arrival: verify (`verifyEnvelope` B-4, `MSGID_DOMAIN_V2` recompute, `now ≤
   effectiveDeath`). If a candidate's signer equals the body's committed publisher, admit a
   **local** authoritative tombstone (subject to `TOMBSTONE_MAX` + sublimits; refuse at capacity),
   then purge the candidate set (v4 D4). Else deliver the body, purge non-matching candidates.
4. The local tombstone persists to `effectiveDeath` across the node's own body eviction. It is
   never exported as authority; other nodes receive only the signed kill and re-earn authority
   locally.

## Accepted residual (David)

Deletion is best-effort against a malicious omitting source and against a full-capacity replica,
hard-bounded by the author's committed `exp` via `effectiveDeath`, and eventual under an honest,
non-saturated path. Accepted bounded-resurrection / refusal modes: (a) source omission; (b)
pre-tombstone candidate-cap eviction or `claimRetention` expiry; (c) body-absent migration (no
transferable authority — the kill waits as a candidate for a co-located body); (d) tombstone
**capacity refusal** (message not suppressed at a full node until capacity frees or the kill
reaches a non-full replica). None produce forged suppression; none drop a live suppression.

## Test matrix (v7)

1. **Non-transferable authority (blocker 1):** a fabricated "authoritative" tombstone wrapping a
   valid non-author kill does not suppress a body-absent receiver's message; the receiver re-earns
   authority only via its own body co-location.
2. **Local verdict durability:** a node that earned a tombstone keeps suppressing across its own
   body eviction to `effectiveDeath`; a later forged kill there is dropped.
3. **Bodyless migration reverts to provisional:** a tombstone migrated without its body is a
   bounded candidate at the receiver, not authoritative (v3/v4 reaffirmed).
4. **Tombstone saturation (blocker 2):** N live tombstones fill capacity; N+1 **genuine** kill →
   admission refused, message not suppressed, documented refusal (no live eviction); N+1 **forged**
   kill → dropped as non-author regardless; full-capacity **migration** → receiver refuses
   adoption, keeps as candidate.
5. **Per-signer / per-topic sublimits:** one signer or topic cannot consume the whole
   `TOMBSTONE_MAX`.
6. **Standing (v3–v6):** forged claim cannot suppress; genuine co-located deletion; cross-topic
   impossible by construction; body-`exp` mismatch → different `msgId`; unbounded-cache removed
   (no per-body verdict).

## Status

Design v7. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends on
the accepted `REF-1.1-S2.0c-Signed-Expiry-Design-v6.md`. Submitted for review before any code.
S2.0c and chunking held; membership alternative not retired.
