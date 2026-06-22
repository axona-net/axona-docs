# From Gates to Gradients — 1. Costly identity, not gated identity (v0.2)

**Status:** design note · **Flagged:** 2026-06-15 · **Revised:** 2026-06-21 (v0.2 — refreshed against the kernel 3.6.0 surface) · **Relates to:**
[`E-1-Placement-Defense-v0.1.md`](E-1-Placement-Defense-v0.1.md) ·
[`Stage4-MemoryHard-PoW-v0.1.md`](Stage4-MemoryHard-PoW-v0.1.md) ·
[`../implementation/Decoupled-Publish-Identity-and-C3-v0.1.md`](../implementation/Decoupled-Publish-Identity-and-C3-v0.1.md) ·
companion essay *From Gates to Gradients* · sibling notes
[2 (cascade telemetry)](Gates-to-Gradients-2-Cascade-Telemetry-v0.2.md),
[3 (soft retraction)](Gates-to-Gradients-3-Soft-Retraction-Annotations-v0.2.md),
[4 (forkable filter sets)](Gates-to-Gradients-4-Forkable-Filter-Sets-v0.2.md),
[5 (agent legibility)](Gates-to-Gradients-5-Agent-Legibility-v0.2.md),
[6 (friction scaled to reach)](Gates-to-Gradients-6-Friction-Scaled-to-Reach-v0.2.md)

---

## TL;DR

This is **note 1 of 6** responding to *From Gates to Gradients*, an essay that
argues for replacing **gates** (binary verdicts someone owns and can abuse) with
**gradients** (costs that scale, friction that rises with reach, filters that
fork) — governance unbundled from control. Each note specs one move.

This note is the **keystone**, because free identity is the hinge of every other
risk in the series. A free identity is a Sybil swarm: one operator mints ten
thousand keypairs and forges consensus at the price of compute. The move is to
make identity **costly but not gated** — a cost that *no authority adjudicates*.
No one can deny you an identity; it simply isn't free to run a thousand. **Axona
already chose exactly this**: a memory-hard proof-of-work on a separate puzzle
hash, decoupled from the node address, decided in the E-1 record. So this note is
not a new proposal — it is the observation that the essay independently arrived at
Axona's own conclusion, plus an honest accounting of what that buys and what it
does not. Roadmap status: **design done, needs shipping** — it is the centerpiece
of the existing security roadmap.

## 1. The idea — costly ≠ permissioned

A **gated** identity is one a gatekeeper grants or denies: an account approval, a
KYC check, an allow-list, a verified-badge. Whoever holds the gate holds a
chokepoint they can monetize, capture, or be compelled to abuse. A **costly**
identity is the opposite shape: anyone may mint one, but minting consumes a real
resource that no one issues and no one can withhold. The distinction is the whole
of this note.

|                    | **Gated identity**                  | **Costly identity**                          |
|--------------------|-------------------------------------|----------------------------------------------|
| Who decides        | a gatekeeper (CA, admin, registrar) | no one — a public, self-checkable cost        |
| Failure of openness| can deny *you*, specifically        | cannot deny anyone; only prices *volume*       |
| Abuse surface      | the gate is a chokepoint to capture | no chokepoint to capture                       |
| Sybil resistance   | strong, but rents control to the gatekeeper | scales the *cost* of a swarm, not its *legality* |

The reason identity must be the first move is the **defender/attacker
asymmetry**. With free identities, the attacker mints as many as the honest
network has real participants and drowns every per-identity defense — quotas,
reputation, K-closest selection, consensus — at the cost of compute. Pricing
identity rebalances that asymmetry: an honest participant pays once; an attacker
minting a swarm pays per identity, and the cost compounds by exactly their
Sybil factor. This is the upstream impossibility result (Douceur, *The Sybil
Attack*, 2002): without a trusted authority, telling identities apart requires a
*resource proof*. The gradient framing simply insists the resource proof be one
**no authority adjudicates** — otherwise you have re-introduced the gate.

## 2. How it helps

- **It removes the chokepoint instead of relocating it.** A gate stops Sybils by
  letting someone decide who is real; a cost stops them by making volume
  expensive. The first is governance *through* control; the second is governance
  *unbundled from* control — the essay's thesis in one substitution.
- **It is the prerequisite for every later gradient.** Cascade telemetry (note
  2), soft retraction (note 3), forkable filters (note 4) and reach-scaled
  friction (note 6) all assume per-identity actions have a non-zero floor. On
  free identities, each is trivially evaded by minting fresh keys. Costly
  identity is what makes the rest bite.
- **It preserves "works anywhere, for anyone."** Because the cost is paid by the
  minter and checked by everyone, there is no registry to consult, no region to
  prove, no human in the loop. Self-authentication stays intact.

## 3. How Axona provides it

Axona's identity is a keypair; its address is `[8-bit S2 geo prefix] ‖
SHA-256(pubkey)` (264 bits total). The costly-identity mechanism, **decided in
the E-1 record**, is a **memory-hard proof-of-work** required to mint a valid
identity:

> a valid identity must satisfy `leadingZeroBits(H(domain ‖ role ‖ pubkey ‖
> nonce)) ≥ N`, where `H` is a memory-hard function. Verifiable in one
> evaluation; minting costs ~2ᴺ.

Four properties make this a *gradient*, not a *gate*:

1. **No adjudicator.** The puzzle is self-checkable by any peer in one hash. No
   CA, no reputation service, no consensus, no global state. This is the
   standing constraint of the whole system: self-authenticating only.
2. **Decoupled from the address.** The work is on a **separate puzzle hash** and
   **never constrains the address** at any difficulty. Encoding leading-zero bits
   into the address itself (the S/Kademlia *static* puzzle / "vanity address"
   form) would cluster every PoW'd publisher near `0x000…` and collapse the DHT's
   uniform load distribution; the separate nonce (the *dynamic* puzzle) prices
   identity while leaving placement uniform. See E-1 §3 item 6.
3. **Memory-hard, asymmetric, phone-floored.** Honest minters are phones in a
   browser (WASM); attackers rent GPU/ASIC/cloud. Stage 4 selects an
   **asymmetric memory-hard function (Equihash / Cuckoo-style)** — memory-hard to
   *solve*, trivially cheap to *verify* — on the principle *"memory = device
   floor, difficulty = search effort."* The memory parameter is pinned to the
   weakest honest device (~256–512 MB) so difficulty dials cost without locking
   phones out, and a shared author identity can **split the search across a user's
   devices** for a near-linear speedup. See
   [`Stage4-MemoryHard-PoW-v0.1.md`](Stage4-MemoryHard-PoW-v0.1.md).
4. **Per-role difficulty.** Node (transport) identities — which can be ground
   into a root position → eclipse — carry the higher difficulty; author (publish)
   identities, which can only flood, carry a lower one calibrated to anti-flood.
   The carrier for this priced credential now **exists**: the **author/node key
   split shipped in the v3.0 identity flag-day** (kernel 3.0.0). `createNodeIdentity`
   mints the routing key (the geo-prefixed nodeId); `createAuthorIdentity` mints a
   **location-free author keypair** whose pubkey is the `signerPubkey` on every
   envelope, and per-publisher quotas already key on it. So the dedicated publish
   key the earlier *Decoupled-Publish-Identity* note proposed is live — what
   remains is to *price* it (attach the role-calibrated PoW), not to build it.

**Why PoW and not stake or personhood.** The essay names three ways to price
identity — a PoW mint, a small stake/burn, or non-custodial proof-of-personhood.
Axona chose PoW for exactly the reason this note insists on: it is **non-custodial
and adjudicated by no authority**. The alternatives re-introduce the gate:

| Option              | Cost is real? | Adjudicator / custodian?                    | Fits "no gate"? |
|---------------------|---------------|---------------------------------------------|-----------------|
| **PoW mint** (chosen)| yes (compute) | none — self-verifying hash                   | yes             |
| Stake / burn        | yes (capital) | a chain / custodian holds or slashes the stake | no — a control point |
| Proof-of-personhood | yes (enrollment) | an issuer attests "one human"             | no — a gatekeeper    |

**Roadmap status.** Per E-1 §5: the wire fields shipped first as **no-ops at
difficulty 0** (kernel v2.34.0 — `pow` in the handshake, `signerPow` in the
envelope), so raising difficulty later is a parameter change, not an
identity-format flag-day. The **author/node key separation that carries the
priced credential has since shipped** (v3.0.0 — `createAuthorIdentity` /
`createNodeIdentity`), so the credential to price now exists as a first-class
object. What remains is **Stage 4**: swap the SHA-256 scaffolding hash for the
memory-hard function, run the phone-WASM go/no-go benchmark, and raise difficulty
to calibrated values. So the honest summary is unchanged — **design done, PoW
needs shipping** — this is the centerpiece of the existing security roadmap, and
the essay independently re-derived it.

## 4. Honest limits

- **A cost is a deterrent, not a bar.** PoW shifts the economics of *casual and
  scaled* Sybil — it turns "free and instant" into "memory-hard compute per
  identity." It does **not** stop a determined, well-resourced adversary who can
  simply pay the cost. Eclipse needs only ~R identities (R = 5 today) at one
  target, so a funded attacker buys those few placements outright; closing that
  residual is the job of the non-PoW placement layers (R-closest signature
  verification, self-proximity gating, disjoint-path lookups), not of PoW. See
  E-1 §4.
- **Memory-hardness narrows the hardware gap; it does not erase it.** Pinning the
  memory floor to a phone *caps* ASIC-resistance — a server-class attacker with
  abundant RAM keeps a bounded constant-factor edge. That is the deliberate
  trade: universal participation over maximal hardware equalization (Stage-4 §3).
- **This is the "cannot be bought" boundary of the entire series.** A cost that
  scales is a cost the rich can pay. Every note in this series stops at the same
  wall: gradients raise the price of abuse and tilt the asymmetry toward
  defenders, but none of them is a wall a sufficiently funded adversary cannot
  buy through. **Anyone promising more is selling the chokepoint back under a new
  name** — the very gate the series sets out to remove.

## 5. Open questions

- **Calibrating the difficulty curve.** The phone floor caps transport difficulty
  from above; eclipse economics set the bar it must clear. Whether a single
  phone-affordable difficulty can both stay honest-friendly *and* meaningfully
  dent a funded eclipse is open and depends on the Stage-4 benchmark numbers — it
  may be that PoW only ever buys time for the placement layers to act.
- **Rotating-key privacy vs. per-mint cost.** Unlinkable publishing (a fresh
  author identity per persona) pays a puzzle per rotation. The lower publish-role
  difficulty softens this, but the right price for "unlinkability costs a puzzle
  per persona" is unsettled, and too high a floor could price out exactly the
  privacy mode the system means to protect.
- **Does proof-of-tenure change the gate/gradient character?** Stage 5 reframes
  the one-time cost as an *accumulating* proof of longevity (E-1 §6). Tenure is a
  gradient too — but weighting routing by it risks incumbency / rich-get-richer
  ossification, which is its own soft chokepoint. Open whether tenure stays a
  tiebreak (gradient) or hardens into something gate-shaped.
- **Where does the cost land for honest low-end users?** Graceful degradation
  (recompute instead of store) keeps weak devices in, but the lived UX cost of a
  multi-second mint on a budget Android, sustained and thermal-throttled, is not
  yet measured. If the floor is felt as a barrier, it has quietly become a gate.

---

*This is a design sketch exploring the essay's framing against Axona's decided
mechanism — not a committed roadmap item.*
