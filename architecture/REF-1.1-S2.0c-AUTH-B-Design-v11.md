# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v11

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-11`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Supersedes:** `...-Design-v10.md`. v11 folds in the Gate A recut requirements Aster raised
  (msgId b8c2d20f): the pending-capacity and candidate state must be **explicitly bounded** and the
  capacity budget must cover the **complete deletion state**. No security-model change from v8;
  this fixes the capacity/state contract and the numbers. Signed-expiry v6 accepted.
  S2.0c/chunking held.

## Bounded candidate + pending-capacity state (new normative contract)

The candidate store — which holds both body-absent candidates and **body-verified-pending-capacity**
candidates (a tagged candidate, not a separate structure) — is bounded exactly like the tombstone
store:

- **Caps:** `CAND_MAX` (global count) + byte cap + **per-signer** and **per-topic** sublimits +
  `CAND_RECORD_MAX` (per-record). Admission is refusal-only; a non-expired entry is never evicted.
- **Dedup:** at most one candidate per `(topicId, msgId, signer)`; a repeated matching kill is a
  no-op.
- **Expiry:** every candidate carries a **ClaimRetention** deadline
  (`receipt + FUTURE_TOLERANCE_MS + TTL_CEILING + CLOCK_SKEW`, signed-expiry v6 D2) and is reclaimed
  when passed. A pending candidate whose body is evicted **demotes** to plain (loses its
  authorization basis) and expires normally.
- **Committed deadline:** authorization always keys on the body's **committed** `effectiveDeath`
  (never `now + TTL`); `SUPPRESS` and every reclamation retry re-check `now ≤ effectiveDeath`, so a
  late arrival or retry can never extend authorization or retention.

## Capacity defaults — the complete deletion state fits the budget

The memory budget covers **tombstones + candidates (incl. pending) together**, measured as one
full state (`-Sim.mjs` v3, `-Results.md` v3): 999 B/entry, split ~4:1 (deletions outnumber pending
claims):

| Parameter | **v11** | budget use |
|---|---|---|
| `TOMBSTONE_RECORD_MAX` = `CAND_RECORD_MAX` | 768 B | — |
| relay `TOMBSTONE_MAX_COUNT` | **32768** (sublimit 2048) | |
| relay `CAND_MAX` (incl. pending) | **8192** (sublimit 512) | |
| relay full-state worst case | — | **39.0 MiB = 61% of 64 MiB** |
| browser `TOMBSTONE_MAX_COUNT` / `CAND_MAX` | **2048 / 512** | **NON-NORMATIVE, DISABLED** |

## Pre-enable conditions (Aster Gate A)

Normative status requires, per Aster: (a) the full-state benchmark re-run on the **production
relay OS/runtimes** (Linux droplet + Windows fleet), not only this host's darwin/arm64; (b) a
**real-browser** measurement before the browser profile is enabled (kept disabled meanwhile); (c) a
re-run if the eventual kernel representation differs from the standalone object/Map layout.

## Status

Design v11 — bounded candidate/pending state + complete-state capacity defaults; v8 security model
unchanged and accepted. Gate A recut v3 delivered. Remaining pre-code gate: **B** (implementation
test plan). No kernel code, canary, deploy, S2.1 wiring, or chunking until Aster accepts the recut
and the Gate B plan. Membership remains unbuilt, not retired.
