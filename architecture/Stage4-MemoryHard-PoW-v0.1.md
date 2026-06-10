# Stage 4 — Memory-Hard PoW: Function Selection (v0.1)

*Decision record for the Stage-4 prerequisite: the memory-hard function that
replaces the SHA-256 scaffolding before PoW difficulty is raised above 0.
Companion to [`E-1-Placement-Defense-v0.1.md`](E-1-Placement-Defense-v0.1.md)
(§5 step 3). **Status: decision + scoping; no code.** Gated on Stage 4 being
scheduled.*

## 1. Requirement

- **Replace SHA-256 before any difficulty > 0.** At difficulty 0 the work hash
  never gates, so SHA-256 is fine today; once difficulty > 0 it is live and
  GPU/ASIC-shortcuttable, and the honest minter is a **phone in a browser
  (WASM)** while the attacker rents GPU/ASIC/cloud.
- **Cheap verify is mandatory.** Every peer verifies every other peer's `pow`
  (handshake) and `signerPow` (publish ingress). Verification cost is paid
  N-times-per-node at mesh scale, so it must be ~µs and low-memory.
- **Zero-dependency kernel.** The implementation is a vendored pure-JS module or
  a WASM blob — no npm runtime dep.

## 2. Decision: asymmetric (memory-hard solve · cheap verify)

Symmetric KDFs (**Argon2id**, **scrypt**) are **rejected as the primary proof**:
verifying re-runs the full memory-hard evaluation (hundreds of MB, tens of ms),
which at mesh scale is a verification-DoS and a scaling wall. They remain a
**fallback** only if the asymmetric implementation risk proves unacceptable.

Chosen: the **asymmetric** family — memory-hard to *find* a solution, but the
solution is a small witness that is **trivially cheap to check** (a handful of
hashes, no large memory). This keeps Hashcash's cheap-verify property while
adding memory-hardness.

## 3. The two knobs — "memory = device floor, difficulty = search effort"

The mistake that locks phones out is raising difficulty by enlarging the buffer.
Keep them separate:

- **Memory parameter: fixed to the weakest honest device.** Target a working set
  that fits a phone-in-a-browser — realistically **~256–512 MB** (WASM linear
  memory caps ~2–4 GB, but mobile tabs are killed well below that). This is a
  constant, not a difficulty dial.
- **Difficulty: search effort.** Require extra leading-zero bits on the witness
  (or K solutions / a tighter cycle constraint). Dials cost up/down **without
  touching the memory footprint**.
- **Graceful degradation, not exclusion.** A device below the memory target can
  recompute instead of store and still finish — slower (super-linear TMTO), not
  blocked.
- **Mint in a Web Worker.** Off the UI thread, checkpoint the witness, accumulate
  over time. A weak device participates *by accumulating* — which is exactly the
  Stage-5 proof-of-tenure engine (E-1 §6).
- **Never delegate minting to a server.** A server that mints proofs is a
  Sybil/trust hole. Verify is shared and cheap; **mint stays client-side.**

The cost of fixing memory at the phone floor: it **caps ASIC-resistance** — a
server-class attacker with abundant RAM keeps a bounded constant-factor edge.
That is the deliberate trade: *universal participation* over maximal hardware
equalization. Cheap verify is what makes it pay.

## 4. Candidate scoring — Equihash vs Cuckoo Cycle

| Criterion | **Equihash** (Biryukov–Khovratovich 2016) | **Cuckoo Cycle** (Tromp 2014) |
|---|---|---|
| Hardness | memory-**capacity** (build + sort big lists; generalized birthday) | memory-**bandwidth** (random edge access; find an L-cycle) |
| Verify | cheap — a few hashes + XOR-to-zero on ~2ᵏ indices | cheapest — check L edges form a cycle |
| Memory tuning | `(n,k)` → tens–hundreds MB | edge-bits → modest; "lean" solvers trade memory↓ for time↑ (lowest floor) |
| WASM/phone fit | sorting is compute+memory heavy but WASM-friendly | bandwidth/latency-bound random access is awkward + slow in WASM/phones |
| ASIC story | ASICs exist (Zcash) but bounded | designed for ASIC-resistance (Cuckaroo); tunable |
| Implementation risk | moderate (Wagner step + sort) | moderate (edge gen + trim rounds + cycle find) |
| Precedent | Zcash | Grin / MimbleWimble |

**Recommendation: default to Equihash with a small `(n,k)`** sized to the
~256–512 MB floor — clearer capacity-tuning, simplest cheap-verify, and sorting
maps acceptably to WASM. **Fall back to Cuckoo (lean solver)** if the phone
memory floor turns out to be the binding constraint, accepting its
bandwidth-bound solve. **Final pick is gated on a prototype benchmark on real
phone-WASM** (mint time at the floor, verify time, peak memory) — do not commit
the function without that measurement.

## 5. Parallelism & multi-device (shared publishID across a user's devices)

**Goal:** one user, one publishID, managed as a single entity across phone + PC;
both devices keep improving the proof (and the Stage-5 tenure proof), splitting
the effort.

**It parallelizes for free.** Each search attempt is independent over a huge
nonce space, and the landscape for a given `(pubkey, nonce)` is deterministic
(no intrinsic randomness — see below). So two devices sharing one publish key
(same `signerPubkey` ⇒ same target) split the work by searching **disjoint nonce
spaces**:

- **Randomness is a choice, not a step.** The nonce can be a counter or a random
  draw. To explore different spaces, each device either (a) **salts its nonce
  with a per-device tag** (coordination-free; disjoint with overwhelming
  probability over a 2¹²⁸ space), or (b) takes an **explicit disjoint range**
  (exact). Either way ≈ linear (2×) speedup.
- **The witness is bound to the pubkey, not the device.** A witness found on the
  phone is valid for the PC. So the devices **sync only the tiny best-witness**
  (a few hundred bytes); cheap verify lets each instantly check and adopt the
  other's. Both converge on the best/longest-tenure proof.

**Key-management caveat (Stage-3 decision).** A *portable* publish key conflicts
with the non-extractable transport-key policy (finding H4 — keys are
non-extractable so XSS can't exfiltrate them). Two options for putting the same
publish key on both devices:

1. **Exportable publish key** — a deliberate exception to the non-extractable
   rule (the publish key signs public content, a weaker secret than the
   transport key); transfer via encrypted export/import or QR pairing.
2. **Passphrase-derived** — both devices derive the identical keypair from a user
   secret (passphrase → seed → Ed25519), so the private key is never
   transferred — but it is only as strong as the passphrase.

This is a Stage-3 (publishID-decoupling) concern; noted here because it is the
prerequisite for the multi-device effort-split to mean anything.

## 6. Benchmark plan (the phone-WASM go/no-go gate)

The function pick (§4) is **not committed without this measurement.** A runnable
harness lives in the kernel repo at **`bench/pow-wasm/`** (works today against the
SHA-256 baseline; memory-hard candidates drop in as `candidates/*.js` implementing
the contract in `candidates/template.js`).

**The question:** at a memory parameter that fits the weakest supported phone,
does the candidate (a) **fit without OOM-killing the tab**, (b) give an acceptable
**foreground mint time**, and (c) keep **verify at µs scale**? If neither candidate
clears it → lower difficulty, go background-only, or fall back to Argon2id.

**Metrics** (per candidate × device × param): mint p50/p90/p99, verify ms, **peak
WASM linear memory + OOM flag**, thermal degradation over a sustained run,
single-thread sufficiency.

**Harness shape:** a static page runs trials in a **Web Worker** (matches the real
mint path; isolates an OOM so it's reported, not silent). Peak memory via
`wasmMemory.buffer.byteLength` (+ `measureUserAgentSpecificMemory()` when
cross-origin isolated).

**Shareable + self-reporting (deployed).** Pages serves the repo root, so the
harness is live at **<https://demo.axona.net/bench/pow-wasm/>** — share the link,
testers hit Run, and (auto-publish on by default) the result is **published over
the live Axona network** to topic `pow-bench/results`. Collect from any local
node — Axona relaying its own telemetry:

```bash
node axona-relay/src/cli.js sub "pow-bench/results" --region useast --for 3600
```

(Verified end-to-end on prod: a result published to the topic is received by that
command.) The LAN `collector.js` (serves with COOP/COEP for the accurate memory
API + threads) stays as the cross-origin-isolated alternative.

**Phased run:**
1. **Node baseline** — param→cost curve, no browser.
2. **Desktop browser** — catch WASM issues (memory growth, SIMD, threads); DevTools
   CPU-throttle for dev iteration (simulates CPU, *not* memory/thermal).
3. **Real phones** — the decision data (your phone + PC + a low-end Android); plus
   optionally a cloud device lab (BrowserStack / AWS Device Farm) for breadth.
   Non-negotiable — emulators don't reproduce mobile memory limits or thermal.
4. **Passive field data** — once a candidate is flagged in, the shipped
   `powCalibrate` + relay logging gather real cross-device numbers over time
   (difficulty still 0 → pure measurement).

**Output:** a table `candidate × param × device → {mint, verify, peak mem, OOM?,
thermal}` → read off the **largest memory param that fits the support-floor phone
without OOM**, and the **difficulty at that param giving an acceptable mint**. That
tuple *is* the Stage-4 parameter decision.

## 7. References

- **Equihash** — A. Biryukov & D. Khovratovich, *Equihash: Asymmetric
  Proof-of-Work Based on the Generalized Birthday Problem* (NDSS 2016).
- **Cuckoo Cycle** — J. Tromp, *Cuckoo Cycle: A Memory Bound Graph-Theoretic
  Proof-of-Work* (2014; BITCOIN 2015).
- `architecture/E-1-Placement-Defense-v0.1.md` — the PoW keystone (§3 memory-hard
  rationale, §5 sequencing, §6 Stage-5 tenure).
- *(Equihash/Cuckoo PDFs not yet in the local `references/` library; citations
  unverified against source.)*
