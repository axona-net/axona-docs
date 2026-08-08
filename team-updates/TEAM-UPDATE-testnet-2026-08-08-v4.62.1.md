# Team Update — Dead-Root Eviction on testnet (kernel v4.62.1)

**Date:** 2026-08-08 · **Author:** axona.bot · **Scope:** testnet only; prod stays 4.61.2

## What question does this deployment answer?

Can a write survive its root dying without saying goodbye? On 4.61.x the
answer was no: a half-alive claimant that accepted every write and ingested
none stranded the axona.bot channel for 2 hours 6 minutes (GH #28). The
Dead-Root Eviction design (council-ratified v0.3) makes the write path carry
its own liveness law: a write completes on a bound INGEST-ack or the root's
incarnation is convicted, tombstoned, and succeeded.

## What is deployed

- Kernel v4.62.1 (tag 8f34759) — epochs on root claims, typed INGEST-acks,
  write flights with receipt probes, tombstoned convictions, closest-live
  promotion. 4.62.1 adds Aster's ack-binding fence: only the addressed root's
  ack, at the flight's epoch, settles a flight.
- Relay v0.106.0, bridge v2.111.0 (healthz-verified), M4 fleet 26/26 + M1
  fleet 12/12 — rolled one slot at a time, census held throughout.

## Live gate results (testnet, 2026-08-08)

- **SIGKILL a settled root:** succession healed in 11s (terminal-promote);
  a later write was independently readable in 5.1s.
- **SIGKILL + write 6ms later (the #28 phenotype):** successor claimant
  seated and accepted-but-never-ingested — the specimen mechanism on demand.
  Flight ran probe → nack → retry → probe → nack → conviction → tombstone →
  self-promotion. Write independently readable in **29s**; on 4.61.x the same
  phenotype stranded 2h06m. The gap to the ~15s idealized budget is the
  refreshTick sweep cadence, not the constants; a shorter sweep tick is the
  lever if 15s matters.
- **Chunked transfer (Howard's shape):** 3 fresh topics × 10 chunks,
  fresh-subscriber replay — 30/30 (100%).
- **axonSpec vs live testnet:** clean runs 11/11 specs; the recurring failure
  is the harness's own 5s `beforeAll` timeout (pre-dates 4.62.x). No
  eviction-shaped signature.

These numbers are one night on one testnet under no load; the soak loop and
Howard's cross-region A/B are what would prove them wrong.

## What this does not do

Prod promotion is a separate decision (David's). The fence measured a bounded
zombie window; the flapper conveyor that regenerates dead roots under churn is
still the environment, not something this release removes.
