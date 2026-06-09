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

1. **Add `pow` nonce to the identity format and `signerPow` to the envelope, at difficulty 0** (no-op; avoids a future format flag-day). Memory-hard verifier in place, difficulty as a protocol constant.
2. Land the publish-identity decoupling (handoff Part 2) with quota anchored on the publish key (§7(a) now answered).
3. When a threat appears (or proactively): raise transport-role difficulty (anti-eclipse) and publish-role difficulty (anti-flood) to calibrated values; document in `SECURITY-CHANGELOG.md`.

## 6. References
- `architecture/Axona-vs-Vivaldi-v0.1.md` — why Vivaldi ≠ Axona's measured-RTT metric (predicted-coordinate model error + manipulation surface).
- `implementation/Decoupled-Publish-Identity-and-C3-v0.1.md` §7(a) (anti-abuse anchor — now answered by this record).
- `red team/SECURITY-STATUS-v2.32.0.md` (E-1 keystone, Wave E).
- Code touch-points for implementation: `src/identity.js` (mint/verify + `pow`), `src/pubsub/envelope.js` (`signerPow`, verify path `:155–199`), `src/transport/handshake-auth.js` (present `pow` at handshake), `src/pubsub/AxonaManager.js` (quota gate checks publish-role PoW before first-seen / `_openTopicQuota`).
