# E-1 — Targeted-Placement Defense: Decision Record

**Version:** v0.1 · **Date:** 2026-06-09 · **Status:** **DECIDED — proof-of-work (memory-hard), Vivaldi/RTT rejected.**
**Baseline:** kernel v2.32.0 (live `axona/5` line).
**Feeds:** `implementation/Decoupled-Publish-Identity-and-C3-v0.1.md` §7(a); `red team/SECURITY-STATUS-v2.32.0.md` (E-1 keystone).
**Standing constraint:** no central authority / CA / reputation service. Self-authenticating only.

---

## 1. The problem (E-1)

A node/topic address is `[8-bit S2 prefix][256-bit SHA-256(pubkey)]`. A topic is rooted by the nodes whose addresses are XOR-closest to it. The topic address is publicly derivable, so an attacker can **grind keypairs** until a node address lands in a target topic's K-closest set, becoming a root → surveil subscribers, drop messages (eclipse/censor). Cryptography doesn't help: the attacker uses valid keys and breaks no rules. The only lever is **making it costly to *choose where you land*.**

## 2. Options considered

### Rejected — RTT / Vivaldi coordinate cross-check
The idea: verify a node's claimed S2 prefix against its measured network position so a grinder can't claim a region it isn't near.

**Rejected, on architecture grounds (not just false positives):** the 8-bit prefix is a **routing aid, like a telephone area code — not a residency requirement.** A node is *meant* to be able to choose any prefix and still function anywhere; latency may suffer, functionality must not. Verifying RTT against the prefix would:
- convert a soft routing hint into hard locality enforcement, breaking the "works anywhere" property;
- destroy the **location-privacy affordance** — the freedom to choose a non-local region is the same lever privacy depends on (forcing true location is exactly what we *don't* want);
- and, decisively, it can only ever constrain the **prefix** — the 256-bit hash where grinding actually happens carries no latency information, so RTT cannot touch the dimension under attack.

So RTT defends a dimension we don't want enforced and can't defend the dimension that matters. Dropped.

### Selected — memory-hard proof-of-work on identity minting
Require that a valid identity satisfy `H(pubkey ‖ nonce)` < target (N leading zero bits), where `H` is **memory-hard** (Argon2/scrypt-class). Verifiable in one evaluation; minting costs ~2ᴺ. No blockchain, no consensus, no global state — purely local and self-verifying.

**Why it fits E-1 specifically — the asymmetry runs in our favor.** The attack *is* "mint many, keep the close ones," so the per-identity cost compounds against the attacker by exactly their grinding factor, while an honest node pays it once:

| | identities minted | PoW cost |
|---|---|---|
| honest join | 1 | 1 puzzle |
| grind one root slot | ~ (honest nodes nearby ÷ K) | that many puzzles |
| grind to dominate / eclipse | ~ local honest population | that many puzzles |

It also has the boring virtues: self-verifying in one hash (no verification-DoS), decentralized, constraint-compliant, and it **doubles as the anti-flood anchor** the publish-identity work needs (§4).

## 3. Decision details

1. **Memory-hard, not SHA-256.** Honest users are on phones/browsers (weak); attackers rent GPU/ASIC/botnet (strong). A memory-hard puzzle flattens that hardware gap. Plain SHA-256 PoW would be a mistake here.
2. **Bound to the pubkey** (`H(pubkey ‖ nonce)`), so one puzzle can't cover many identities — grinding needs a fresh puzzle per attempt.
3. **Difficulty is a protocol parameter**, fixed (no decentralized difficulty-adjustment oracle needed), **bumpable** by version. Fixed difficulty erodes with Moore's law; revisit per release.
4. **Per-role difficulty** (see §4): transport identities (which can eclipse) carry the higher difficulty; publish identities (which can only flood) carry a lower one calibrated to anti-flood, not anti-eclipse.
5. **Ship the field NOW at difficulty 0.** Add the `pow` nonce to the identity/envelope format immediately, as a no-op (difficulty 0 = no requirement). Costs honest users nothing today, but makes raising difficulty later a **parameter change, not an identity-format flag-day.** Build the lever loose; tighten under threat.
6. **The work is on a SEPARATE puzzle hash — never on the address.** The difficulty applies to `leadingZeroBits(H(domain‖role‖pubkey‖nonce)) ≥ N`; the node/publisher address is `[prefix]‖SHA-256(pubkey)` and is **never constrained by the PoW** at any difficulty. This is the deliberate rejection of the **address-encoded ("vanity address") form** — the S/Kademlia *static* puzzle, where the node ID itself must carry leading-zero bits. Encoding the work into the address is *catastrophic for a heterogeneous keyspace*: if only a SUBSET of identities are PoW'd (publishIDs, but not the uniformly-distributed transport IDs and topics), forcing **leading-zero address bits** clusters every PoW'd publisher — and the owned topics they anchor — onto `0x000…`, the keyspace edge, collapsing the DHT's uniform load distribution. (A **trailing-zero** address variant would preserve placement, since XOR closeness is dominated by the high bits — but it still re-couples difficulty to the address format, reviving the flag-day. The separate nonce avoids both: zero address bits constrained, full address entropy, tunable difficulty.) This decoupling is the S/Kademlia *dynamic* puzzle applied as the sole mechanism. *(Independently re-derived in the 2026-06-10 design review; see [[design_pow_address_decoupling]].)*

### Honest limitations
- **One-time cost = deterrent, not an absolute bar.** Pay once, hold the position forever; a funded attacker still gets in. PoW raises a targeted surveillance/eclipse from "free and instant" to "hours of memory-hard compute per topic." That's a real threat-model change, not impossibility.
- **Conflicts with rotating-key privacy** — localized to the publish identity (§4).
- Raising difficulty later gates **new** mints and grandfathers existing identities; on a fresh, pre-adoption network with no grinding yet, setting it low (or 0) now loses nothing.

## 4. Impact on the publishID / transportID dichotomy

This is where PoW earns its keep. The earlier objection to decoupling the **publish identity** from the **transport/routing identity** was: *decoupling removes the only thing rate-limiting publishers* — today a publish rides an admitted transport identity (which paid handshake + a mesh slot), but a free-floating publish key could be minted by the thousands to defeat per-publisher quota (SP-10) and replay-freshness. **PoW removes that objection**, in five concrete ways:

1. **It relocates the Sybil cost from "being an admitted transport peer" to "minting any identity."** The anti-abuse property that was *implicitly* attached to the transport binding becomes *explicitly* attached to the key itself. So a publish key is no longer free — minting one costs a puzzle, and minting fresh ones per message to evade quota costs a puzzle each.
2. **It lets the quota anchor stay on the publishID — preserving the clean decoupling.** Without PoW, the only fix was to re-anchor quota on the *injecting transport identity* (which re-couples the two). With PoW, quota keys on the (puzzle-bearing) **publish** key directly. This is the answer to handoff §7(a): **"PoW the publish key,"** not "anchor on transport id."
3. **The two identities become the same *kind* of object — a PoW-stamped self-authenticating keypair — differing only by role:** transportID authenticates channels and occupies a DHT/routing address; publishID signs/owns content streams. Conceptually cleaner than the old asymmetric-implicit-cost framing.
4. **Per-role difficulty becomes a deliberate degree of freedom.** The two roles have different attack surfaces: a transport identity can be *ground into a root position* → eclipse (needs strong PoW); a publish identity cannot route or become a root — its only abuse is *flooding* (needs only enough PoW to make quota-evasion uneconomic). So set **higher difficulty on transport keys, lower on publish keys.** This also softens the privacy tension below.
5. **It localizes the rotating-key privacy tension to exactly the right place.** Stable transportID: mint once, PoW paid once, no tension. Rotating publishID (the unlinkable-publisher privacy mode): pays a puzzle per rotation — a coherent, *opt-in* cost ("unlinkability costs a puzzle per persona"), and made cheaper by the lower publish-role difficulty in (4).

**Net:** PoW is the prerequisite that makes the publishID decoupling *safe*. It converts my earlier critique ("publishID is downstream of E-1") into a clean dependency: **ship the PoW field first (even at difficulty 0); then the publish-identity work proceeds with its anti-flood anchor already answered, without re-coupling to the transport identity.**

### Concrete wire/enforcement note
For the anti-flood property to bite, a root must be able to check a publisher's PoW before granting a quota slot. Since PoW is over `pubkey`, the verifier needs `(pubkey, nonce)`:
- **transportID:** the PoW nonce is presented at the `axona/5` handshake (already an auth exchange — add one field).
- **publishID:** the PoW nonce must travel with the publish. **Add a `signerPow` (nonce) field to signed envelopes**; a K-closest root verifies `H(signerPubkey ‖ signerPow)` meets the publish-role difficulty before counting the publisher as first-seen / granting a quota slot. At difficulty 0 this is a no-op; the field exists from day one so enforcement can be switched on later without a flag-day.

The `OwnershipProof` seam (handoff §6) is **unaffected** — PoW adds a minting cost; ownership is still proven by a signature from the owning key.

## 5. Sequencing

1. ✅ **DONE — kernel v2.34.0 (2026-06-10, on testnet).** `pow` nonce in the auth hello + `signerPow` in the envelope, both **siblings** (self-binding to the pubkey, outside the signed transcript/core ⇒ wire-compatible with 2.33.0). Per-role verifier `src/pow/pow.js` (`powMint`/`powVerify`/`powBits`/`powCalibrate`), difficulty a frozen protocol constant `POW_DIFFICULTY={transport:0,publish:0}`. Checked at the handshake-admit and publish-ingress gates as **no-ops at difficulty 0**. ⚠️ The shipped work hash is **SHA-256 (scaffolding only)** — it gates nothing at difficulty 0; **step 3 must first swap it for a memory-hard fn** (Argon2id/scrypt). Tests `test/smoke_pow.js`; live-verified by the relay e2e suite.
2. Land the publish-identity decoupling (handoff Part 2) with quota anchored on the publish key (§7(a) now answered). *(Demand-gated.)*
3. **Stage 4 — turn difficulty on.** When a threat appears (or proactively): **first swap the SHA-256 scaffolding hash for a memory-hard fn**, then raise transport-role difficulty (anti-eclipse, Stage 4a) and publish-role difficulty (anti-flood, Stage 4b) to calibrated values (use `powCalibrate` device data); these ride one coordinated bump (soft `MIN_KERNEL` floor raise — no wire-epoch partition, since the fields already travel) and only THEN warrant a public `SECURITY-CHANGELOG.md` entry.
4. **Stage 5 — proof-of-tenure** *(forward-looking; design note only, see §6).* Convert the one-time `pow` into an **accumulating, periodically-re-minted proof of longevity**, bound to *time* (not work) via a beacon-seeded chain or a VDF. Gated behind Stage 4 (reuses its memory-hard hash).

## 6. Stage 5 (forward-looking): proof-of-tenure

**Status:** design note, not committed — no code. Gated behind Stage 4 (difficulty must be live, and it reuses Stage 4's memory-hard hash). Originated in the 2026-06-10 design review: *"the PoW can be computed in the background and regularly saved — a continuously improving proof, demonstrating longevity on the network."* See `[[design_pow_address_decoupling]]`.

### 6.1 Motivation
Stage 4's honest limitation (§3, *one-time cost = deterrent, not a bar*): a position is bought once and held forever. Stage 5 reframes PoW from a **one-time admission gate** into an **accumulating proof of tenure** — a node grinds in the background and periodically saves a steadily-stronger proof, so a long-lived honest node visibly out-proves a freshly-minted Sybil swarm. Tenure becomes a *self-certified* signal the network can weight (K-closest selection, admission tiebreaks, routing preference), and it complements the *observed* behavioral-vitality / route-around work (black-hole-nodes, Endo attestation): self-asserted longevity **+** externally-observed good behavior = defense in depth.

### 6.2 ⚠️ The trap: accumulated work ≠ time
A naïve accumulator — "keep grinding higher difficulty, save the best" — measures **cumulative compute = hashpower × time, NOT elapsed time.** An attacker with a GPU farm forges "two years of tenure" in an afternoon; memory-hardness narrows the gap but does not close it. A tenure proof buyable with hashpower is a longevity costume over a hashpower contest. **The whole design hinges on binding each increment to time, not work.**

### 6.3 Binding to time — two options
Each increment must consume an input that **did not exist before**, so the proof can be neither precomputed nor fast-forwarded:

1. **Beacon-seeded sequential chain.** Each saved proof commits to `(previous_proof ‖ fresh_public_beacon)`, where the beacon is a periodic, unforgeable-in-advance value. The chain grows only as fast as beacons arrive, so **its length is capped by real elapsed time** regardless of how many machines you own; per-link depth is rate-limited so hashpower can't substitute for length. Lighter to build; verify = re-walk the links.
2. **Verifiable Delay Function (VDF).** Inherently *sequential* — parallel machines give no speedup — so wall-clock time is the cost by construction. The rigorous option (this is exactly Chia's "proof of time"); heavier to implement and parameterize, but the cleanest "continuously present since T."

### 6.4 Storage
Already half-built: kernel v2.35.0 persists the transport `pow` in the identity envelope (`dumpIdentity`/`loadIdentity`). A tenure token (chain head + beacon refs, or a VDF checkpoint) extends that same slot — small, cheap to persist, cheap to verify.

### 6.5 Open caveats / decisions (resolve before this is more than a note)
- **Patient adversary.** Tenure starves *fresh* Sybil swarms, but a funded attacker can **pre-age many identities in parallel** from day one (each chain is sequential, but N chains run concurrently across N identities). Tenure is a real signal fresh swarms lack — not a bar against a provisioned, patient adversary. It stacks with the per-position Stage-4 mint cost and observed vitality; not a silver bullet.
- **Tenure ≠ usefulness.** The proof says the *key* persisted and grinded; not that the node *routed or served*. Do not conflate with behavioral vitality.
- **Incumbency bias.** Weighting routing/K-closest by tenure risks rich-get-richer / ossification. Tenure should be a tiebreak or floor, not a monopoly — pick the weighting curve accordingly.
- **Beacon source (make-or-break).** Axona has no blockchain. What is the unforgeable, periodic, network-agreed beacon? A bridge-rotated nonce is simplest but reintroduces a trust point; a mesh-gossiped checkpoint is more decentralized but needs agreement. **Resolve this first** — it determines whether option (1) is even viable, else fall back to a VDF (no external beacon needed).

## 7. References

### Prior art (this design composes known primitives — it is not novel crypto)
*Citations verified 2026-06-10 against source PDFs in the maintainer's local `references/` library (gitignored — copyrighted, not committed; filenames noted for the maintainer).*
- **Hashcash** — Adam Back, *Hashcash — A Denial of Service Counter-Measure* (paper dated 1 Aug 2002; mechanism originally proposed May 1997). The `H(input‖nonce)`-has-N-leading-zero-bits proof-of-work primitive used here (and by Bitcoin). *(local: `references/hashcash.pdf`)*
- **S/Kademlia** — Ingmar Baumgart & Sebastian Mies, *S/Kademlia: A Practicable Approach Towards Secure Key-Based Routing* (ICPADS 2007). The canonical crypto-puzzle Sybil/eclipse defense for DHTs — its abstract: *"limiting free nodeId generation with crypto puzzles"* — and the source of the **static** (address-constraining) vs **dynamic** (separate-nonce) puzzle distinction §3.6 turns on. Also cited in `whitepaper/Axona-Whitepaper.md`. *(local: `references/SKademlia_2007.pdf`)*
- **Douceur** — John R. Douceur, *The Sybil Attack* (IPTPS 2002). The upstream impossibility result: without a trusted authority, distinguishing identities requires a *resource proof* — the reason a self-authenticating network needs PoW at all. *(local: `references/sybil.pdf`)*

### Forward — Stage 5 proof-of-tenure (§6); not yet in the local `references/` library, citations unverified against source
- **Verifiable Delay Functions** — D. Boneh, J. Bonneau, B. Bünz, B. Fisch (CRYPTO 2018). The VDF concept (option 6.3.2).
- B. Wesolowski, *Efficient Verifiable Delay Functions* (EUROCRYPT 2019); K. Pietrzak, *Simple Verifiable Delay Functions* (ITCS 2019) — the two practical VDF constructions.
- M. Mahmoody, T. Moran, S. Vadhan, *Publicly Verifiable Proofs of Sequential Work* (ITCS 2013) — the timestamped sequential-work primitive behind option 6.3.1.
- **Chia** — Cohen & Pietrzak, *Simple Proofs of Sequential Work* / the Chia "proof of space and time" — the worked precedent for VDF-based proof-of-time in a live P2P network.

### Axona docs
- `architecture/Axona-vs-Vivaldi-v0.1.md` — why Vivaldi ≠ Axona's measured-RTT metric (predicted-coordinate model error + manipulation surface).
- `implementation/Decoupled-Publish-Identity-and-C3-v0.1.md` §7(a) (anti-abuse anchor — now answered by this record).
- `red team/SECURITY-STATUS-v2.32.0.md` (E-1 keystone, Wave E).
- Code touch-points for implementation: `src/identity.js` (mint/verify + `pow`), `src/pubsub/envelope.js` (`signerPow`, verify path `:155–199`), `src/transport/handshake-auth.js` (present `pow` at handshake), `src/pubsub/AxonaManager.js` (quota gate checks publish-role PoW before first-seen / `_openTopicQuota`).
