# Axona Perimeter — implementation v0.1

**Status:** built, unreleased. Kernel 4.112.0 on branch `perimeter-v03`, relay
0.156.0 on branch `perimeter-v03`. Nothing tagged, nothing on `main` or
`testnet`, nothing deployed. David's word (2026-10-12): "Implement the
perimeter design with fences, don't release yet."

**Design:** Aster's Perimeter Connection Proposal v0.1 (council 388fda2d),
v0.2 amendment (541a178f), v0.3 amendment (fd1ff07b), accepted at design
level by axona.bot (434c2956) after Orion's and Vega's reviews, answering
David's request for comments (565bcf0b). This note maps each clause the
kernel can carry to the code that carries it and the fence that proves it.
It changes no number: every K, cap and profile in the design stays a
hypothesis, and the defaults stay what they were.

## What question the code answers

Which peers may a node close on its own, and which never? The design's
answer is one policy with four reasons, asked at every elective close and
re-derived from current state each time. The code before this release had
two readers of that contract and no displacement rule. The code after it
has one reader, a displacement rule, a way to improve a full table, and a
discovery path for the bands.

## Clause by clause

| Design clause | Where it lives | Fence |
|---|---|---|
| v0.1 §2, v0.2 §B: one admitted table; retention reasons NEAR, BAND, SERVICE, DUTY, overlapping, re-derived | `AxonaPeer._retentionMap`, `retentionOf`, `protectedPeers` | `fence_retention_policy` 1–7 |
| v0.2 §B: SUSPECT removes routing confidence and never releases a token | `mesh.isStale`, `composite.isStale`; a stale peer loses NEAR only | `fence_retention_policy` 5; `fence_near_displacement` 6 |
| v0.2 §E, v0.3 §4: elective closes consult the policy; resource-release closes do not | the gate's swap victim and refused-grace; the mesh's degree-cap and make-room through `setObligedPeers(protectedPeers)` | `fence_close_class_matrix` A, B |
| v0.1 §6: a strictly closer node takes a NEAR slot; the displaced peer keeps its channel only by another reason | `_gateDecision`: the sponsor ranked into the near set, `nearImprove`, no margin on that path | `fence_near_displacement` 1–5 |
| v0.1 §5: improve an occupied near slot | `_fillTick` at cap → `_nearImproveStep`: one search, at most one dial, only when the gate predicts admission | `fence_near_improve_dial` 1–5 |
| v0.1 §5, v0.3 §F: an independent band path; fairness between classes | `_bandDiscoveryStep`: one probe per tick toward the sparsest band inside the held span; dial order alternates near-first and band-first | `fence_band_discovery` 1–5 |
| v0.3 §2: one K for gate, maintenance and fill, refused at construction | `AxonaPeer` constructor assertion; relay `armingFromEnv` couples the gate's K to `RELAY_SYNAPTOME_KNEAR` | `fence_retention_policy` 8; relay `fence_arming_gate` |
| v0.3 §3: check, construction and registration in one serialized stretch | unchanged: `mesh.js` asks the ledger and attaches the PC with no await between (inbound :957→:1336, outbound :1279→:1294) | read in review 434c2956; the fence that fails on an inserted await is not written yet |

## What the code does not do, by design

- It flips no enforcement. The channel ledger still ships in observation
  mode and no launcher enforces it. The design's host budget (v0.3 §1,
  surge capacity within the budget) is configuration and ops, not kernel
  code, and it waits on the measurement the design names.
- It adds no browser cap and no mobile leaf role. Both are named in the
  design as separate policies; neither is a kernel default to change on a
  branch.
- It persists nothing. A restarted node is a new node; survivors recover
  obligations. The design accepts that baseline (v0.3 §5).
- It moves no number. K stays 5 on relays by default, the cap stays 50,
  the heartbeat stays 2 s.

## What a reader can check without trusting this note

Run the five kernel fences and the relay fence from the branches. Delete
the kill switch of each and watch the named check fail: the mutants are
listed in each fence's header with the check they break. Read
`health().perimeter` on any armed node for the live shape: how many peers
carry each reason, how many are stale, how many improvements and probes
have run.

## What would make this wrong

A node whose transport exposes `isStale` but whose stale marker lags the
channel's real state would hold a dead peer as NEAR for up to
`heartbeat.staleMs` (10 s) and drop a live one for as long as a hiccup
lasts; both are bounded by the heartbeat's own numbers. A population
whose nodes all sit inside one band would make the band path idle, which
is the intended case, not a defect. The near-improvement dial assumes the
gate's preflight predicts the commit; the two share one code path, so the
prediction holds within one synchronous tick, and a bind that lands after
an admission in between is refused and reconciled as before.
