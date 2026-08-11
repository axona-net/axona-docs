# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v8

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-08`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Kernel:** 4.62.2. Design only. No code, no deploy.
- **Supersedes:** `...-Design-v7.md` (ac9b011), reviewed **CHANGES REQUIRED**
  (`ASTER-COUNCIL-REF11-S20C-V7-REVIEW`, msgId dd682d02). **The v7 security direction is
  accepted** (local non-transferable authority; no live-tombstone eviction; fabricated-authority
  vector correct). Signed-expiry v6 remains accepted. v8 resolves the two remaining blockers:
  **blocker 1** — one atomic refusal/retry state machine; **blocker 2** — concrete capacity
  parameters + case-correct saturation vectors. **Depends on**
  `REF-1.1-S2.0c-Signed-Expiry-Design-v6.md` (accepted). S2.0c/chunking held.

The security model is settled. v8 makes the capacity mechanics coherent and normative. Two v7
statements were wrong and are corrected here (owned): the full-capacity match path was
under-specified, and the saturation matrix's "N+1 forged kill dropped as non-author regardless"
and "full-capacity migration adoption" **contradicted the local-authority rule** — a body-absent
node cannot know a kill is non-author, and a body-absent kill is never a tombstone.

## Blocker 1 — one atomic transition table with a defined retry

**Atomic action.** `SUPPRESS(topicId, msgId)` is all-or-nothing:
`{ admit authoritative tombstone (subject to capacity) → remove body from cache → emit delete
fanout → purge the candidate set }`. If tombstone admission is refused, **none** of suppression,
cache removal, or fanout occurs.

**Transitions** (a node's state for one `(topicId, msgId)`):

| Event | Local tombstone? | Body? | Action |
|---|---|---|---|
| kill arrives | present | — | adjudicate: `signer == tombstone.publisher` → confirm no-op; else drop. No new admission. |
| kill arrives | absent | present | co-locate: if `signer == body.publisher` → **try `SUPPRESS`**; else (non-author, body proves it) drop the kill. |
| kill arrives | absent | absent | **cannot** judge authorship → admit to the bounded candidate set (per-signer + global cap) or drop under candidate-cap policy. Never self-authorizes; never "non-author dropped." |
| body arrives | absent | (now present) | if any candidate `signer == body.publisher` → **try `SUPPRESS`**; else deliver body, purge non-matching candidates. |
| tombstone slot reclaimed (an entry passed `effectiveDeath`) | — | — | **retry**: for retained *body-verified-pending-capacity* candidates whose body is still present, oldest-body-first, attempt `SUPPRESS` until slots fill. |
| body evicted while a *pending-capacity* candidate waits | absent | (now absent) | the candidate reverts to an ordinary body-absent candidate (loses its authorization basis); retries only if the body reappears (co-location) or via re-propagation; ages out at `claimRetention`. |

**`try SUPPRESS` outcomes, explicit:**
- **Admission SUCCESS** → the full atomic `SUPPRESS` runs.
- **Admission REFUSED** (global, per-signer, or per-topic sublimit full of live entries) → **no**
  suppression, **no** cache removal, **no** fanout; retain **only** the verified matching kill as a
  candidate tagged *body-verified-pending-capacity* (drop non-matching candidates — the body has
  proven the author); the deletion is retried by the *slot-reclaimed* transition above. This closes
  v7's "capacity freeing does nothing" gap: reclamation is an explicit retry trigger, not a hope.

Re-propagation remains a second, independent retry path (a fresh copy of the kill from the network
re-enters the table). If the body is evicted before any retry succeeds, the deletion waits for the
body to reappear or for re-propagation — the accepted bounded-resurrection residual, capped by
`effectiveDeath`.

## Blocker 2 — concrete, case-correct capacity contract

**Retained record + size cap.** One tombstone = `{ topicId(33B), msgId(32B), signerPubkey(32B),
effectiveDeath(8B) }` plus the verifying signed-kill bytes. Normative
`TOMBSTONE_RECORD_MAX = 512 bytes`; a kill whose stored record would exceed it is rejected. No
message bytes are stored (deletion is preserved, content is not).

**Normative default bounds** (profile-scoped; confirmed by a saturation sim before any code):

| Parameter | Relay profile | Browser profile | Basis |
|---|---|---|---|
| `TOMBSTONE_MAX_BYTES` | 64 MiB | 4 MiB | stated per-node memory budget for deletion state |
| `TOMBSTONE_MAX_COUNT` | `⌊MAX_BYTES / 512⌋` = 131072 | 8192 | byte budget ÷ record cap |
| per-signer sublimit | `MAX_COUNT / 16` = 8192 | 512 | no one signer holds > 1/16 of the set |
| per-topic sublimit | `MAX_COUNT / 16` = 8192 | 512 | no one topic holds > 1/16 of the set |

Admission is refused when the **global** cap **or** the applicable **per-signer** **or**
**per-topic** sublimit is full of **live** entries (`now ≤ effectiveDeath`). Only **expired**
entries are reclaimed; a live entry is never evicted. The `/16` fraction and the memory budgets are
the normative defaults; the saturation sim confirms the production values before code (an honest
pre-code gate, not a blank number).

**Bounded-derivation note.** Because a body-absent kill can never become a tombstone (local
authority), the live-tombstone population is bounded by messages actually **present-and-author-
killed** at this node within `TTL_CEILING` — not by the count of distinct signed kills an attacker
can mint. Attacker-minted body-absent kills land in the **candidate** set (its own per-signer +
global cap), never the tombstone set.

**Case-correct saturation vectors** (split by local knowledge, as required):

- **Body absent, forged (non-author) kill:** node cannot know it is non-author → treated as a
  bounded candidate (per-signer + global candidate cap) or dropped under candidate-cap policy;
  **never** "non-author dropped," **never** a tombstone.
- **Body absent, genuine kill:** bounded candidate; becomes a tombstone only after a body arrives
  and co-locates (then subject to capacity).
- **Body present, non-author kill:** the body proves non-authorship → drop the kill.
- **Body present, author kill, capacity available:** atomic `SUPPRESS`.
- **Body present, author kill, capacity full:** refused; retain matching candidate; retried on
  slot reclamation; body-evicted-before-retry → reverts to body-absent candidate.
- **Local tombstone present, any kill:** adjudicate against the local tombstone; no new admission.
- **Full-capacity migration:** a migrated (body-absent) kill is **never** eligible for tombstone
  adoption; it is a candidate; adoption is attempted only after local body co-location — so
  "migration adoption" never reintroduces transferable authority.

## Accepted residual (David)

Deletion is best-effort against a malicious omitting source and against a saturated node,
hard-bounded by the author's committed `exp` via `effectiveDeath`, and eventual under an honest,
non-saturated path. Accepted modes: source omission; candidate-cap eviction / `claimRetention`
expiry; body-absent migration (kill waits as a candidate); tombstone **capacity refusal** (retried
on reclamation or re-propagation). None produce forged suppression; none evict a live suppression.

## Status

Design v8. No code, no S2.0c clearance, no S2.1 authorization, no canary, no deploy. Depends on the
accepted `REF-1.1-S2.0c-Signed-Expiry-Design-v6.md`. Submitted for review before any code. S2.0c
and chunking held; membership alternative not retired.
