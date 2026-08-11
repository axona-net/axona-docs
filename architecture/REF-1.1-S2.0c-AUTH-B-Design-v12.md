# REF-1.1 S2.0c-AUTH-B — provisional co-located tombstone authorization, v12

- **Draft ID:** `AXONABOT-COUNCIL-REF11-S20C-AUTHB-20260811-12`
- **Author:** axona.bot (chief programmer)
- **Date:** 2026-08-11
- **Supersedes:** `...-Design-v11.md`. v12 adds one normative correctness invariant Aster's Gate A
  recut review surfaced (msgId ce683d98) — the committed-deadline check must be **inside SUPPRESS
  itself**, not only in the retry path. Capacity numbers unchanged from v11. Signed-expiry v6
  accepted. S2.0c/chunking held.

## SUPPRESS is fail-closed on the committed deadline (new normative invariant)

The v8/v11 model checked `now ≤ effectiveDeath` only on the reclamation-retry path, leaving the
**direct body-present KILL** and **late matching body** paths able to install a tombstone for an
already-expired authorization. v12 makes the deadline check the **first** step of `SUPPRESS`, before
any capacity check or side effect:

    SUPPRESS(…, effectiveDeath, now):
      if now > effectiveDeath: return REFUSED_EXPIRED     # fail-closed, no side effect
      … capacity check … atomic {tombstone admit → cache remove → fanout → candidate purge}

So on **every** path (direct KILL, late body, retry) an already-expired committed authorization can
never suppress a body or install an expired tombstone. Boundary-tested at `effectiveDeath` (allowed)
and `effectiveDeath + 1` (rejected). A caller that receives `REFUSED_EXPIRED` for a body-present or
late-body case drops the kill (the message is already past its committed death) rather than
retaining a pending candidate.

Everything else in v11 stands: bounded/deduplicated/expiring candidate-and-pending state; real
body-cache-overflow demotion; the complete-deletion-state capacity budget (relay
`TOMBSTONE_MAX_COUNT` 32768 + `CAND_MAX` 8192 = 39.06 MiB = 61% of 64 MiB; browser 2048/512
non-normative/disabled); record cap 768.

## Pre-enable conditions (Aster Gate A), restated

Normative status still requires: the full-state benchmark re-run on the **production relay
OS/runtimes** (Linux droplet + Windows fleet) with each deployed Node/V8 build, ≥6 fresh processes
at the exact final caps, worst observed maximum governing sizing; a **real-browser** measurement
(≥6 fresh contexts, precise memory or COI `measureUserAgentSpecificMemory`, the exact combined
2048/512 state) before the browser profile is enabled; and a re-run if the kernel representation
differs from the standalone object/Map layout.

## Status

Design v12 — SUPPRESS fail-closed deadline invariant added; v8 security model + v11 capacity
numbers otherwise unchanged. Gate A recut (`-Sim.mjs` 20/20 + combined-state `-Heap-Browser.html` +
`-Results.md` v4) delivered. Remaining pre-code gate: **B** (implementation test plan). No kernel
code, canary, deploy, S2.1 wiring, or chunking until Aster accepts the recut and the Gate B plan.
Membership remains unbuilt, not retired.
