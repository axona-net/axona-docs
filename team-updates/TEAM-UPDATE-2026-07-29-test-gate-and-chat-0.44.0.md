# Team update — 2026-07-29 · the test gate, and axona.chat 0.44.0

**Kernel:** 4.49.0 (**unchanged** — `src/` untouched, tag `v4.49.0` still 5930e1d)
**axona.chat:** 0.41.0 → **0.44.0**
**Environment:** promoted to production. `axona-protocol` `main` = `3c00a85`,
`axona-chat` `main` = `3b6fb97`. Prod bridge unchanged: `2.103.0` / kernel `4.49.0`.

Nothing on the wire changed. No relay, bridge, or droplet needed touching, and no
consumer lockfile re-resolved — both protocol commits are test-only.

---

## 1. Phase C — a test gate that can report its own completeness

Phase C was the refactor plan's first gate, and both external reviewers (Passes 8
and 9 on the health scorecard) called it the absolute blocker. It is done.

**What was wrong, measured rather than estimated:**

| | scorecard §5.1 said | Review Pass 8 said | **measured** |
|---|---|---|---|
| orphaned test files | ~10 | 15 | **35** |
| chained invocations | "`&&`-chained" | — | **109, one chain** |
| referenced-but-missing | — | — | 0 |

`npm test` was a single `&&` chain of 109 invocations. A failure at position 3 hid
the other 106 and printed one red line, so fixing #3 revealed #7, then #19 — an
unbounded queue of surprises with no way to know how much was broken. And 35 of
144 test files were in no suite the chain touched, which matters because **a test
that is not wired in looks exactly like a test that passes: both are silent.**

Every gate in the plan is phrased "the suite is green before this ships". Against
the old runner that sentence meant "an unknown fraction of an unknown number of
tests did not fail before the chain stopped". It was a property of a shell
expression, not a fact.

**What exists now** (`axona-protocol`):

- `test/run.mjs` — runs every selected test *despite* failures, reports
  `ran N of M selected`, fails once at the end. A test that cannot be spawned is
  a FAILURE, never a skip. Timeout is Node's own child-process timeout, not the
  `timeout` binary (macOS has none — the first triage pass reported all 35 orphans
  broken when it was really printing "command not found" 35 times).
- `test/manifest.json` — all 152 test files classified `default` / `extended` /
  `integration` / `quarantined` / `retired`, each non-running entry carrying a
  written reason. The answer to "what is the suite?", which previously had none.
- `--guard` — bidirectional disk ↔ manifest reconciliation, run *before* the
  tests. A file with no entry and an entry with no file are equally lies; the
  4.42.0 revert silently dropped four closed findings when their fences were
  reverted along with the code.
- `.github/workflows/tests.yml` — `guard` gates `suite`. **First real execution
  passed on `main` at 3c00a85**, both jobs green.

**The 35 orphans were resolved by running them.** 11 passed and were promoted —
real coverage that existed and was never wired, including fences for #364 ghost
reads, #354 standalone lookup, #343 TURN encoding and #363 leave-order teardown.
24 failed against internals the Phase-1 rewrite removed and were retired, each
reason naming the exact missing symbol. Quarantined is now zero.

---

## 2. What the honest gate found on its first day

**A 25%-flaky test in the release gate.** `smoke_pubsub_kill.mjs` assertion 3c
demanded 24/24 kill convergence under 30% loss inside a fixed 30-tick window
(15/20 runs passed). A 10× healing budget made it 12/12, proving the straggler was
*slow, not wedged* — so the assertion fenced convergence **latency** while claiming
to fence convergence, which the plan's own SLO rule (REPS ≥ 5, mean ± sd) forbids.
Fixed, with the measurement in the comment.

**#413 — a probability model that was wrong.** `smoke_interloper_convergence`
rejection-sampled for a node XOR-closer to the topic than the closest of N=30,
giving up after 400 tries. Measured ~14% failure, which looked impossible: at the
mean hit rate of 1/(N+1), (30/31)^400 is 2e-6.

The per-try rate is **not** the mean. It IS the random distance of the
closest-of-N, ~Beta(1,N), heavily skewed small. Integrating over it:

```
P(fail) = ∫ N(1-p)^(N-1) · (1-p)^T dp  =  N / (N + T)
```

30/430 = 6.98% per loop; two loops per run gives 13.5% against 14.3% measured.
**The tail is polynomial, not exponential** — P(fail)=1e-6 would need 30 *million*
tries, so raising the budget was never going to work. Fixed structurally: mint N+1
identities, sort by distance, *designate* the closest. 20/20 reps, suite 121/121.

Same loop leaked: rejected candidates stayed **registered** in the SimNetwork
(30 → 82 in one run). Not a kernel bug — `leave()` does stop the transport
(`AxonaPeer.js:1163`) and `connect()`'s error path stops both, so `stop()`
deliberately leaves an *injected* transport alone. The test used the abrupt path
to discard a peer.

**#412 — real, ≤1%, unattributed.** `smoke_interloper_convergence` section C once
showed a late subscriber replaying only the post-mint half of the history. My
leading hypothesis (that a partially-populated root never reconciles, because every
empty-root cohort-pull gate in `repairPlane.js` requires `cache.length === 0`) was
**refuted**: a purpose-built harness shows the union completes on renewal tick 1.
That harness is now a permanent fence, `smoke_partial_root_union.mjs`. Rate
corrected downward: 1 failure in 139 attempts, 121 consecutive non-reproductions.
An untested "the repair is renewal-gated and section C's post-death budget is ~1.5s
of real time" idea is recorded on the task. **Do not treat it as diagnosed.**

---

## 3. axona.chat 0.42.0 → 0.44.0

**0.42.0 — shell-style recall.** Up/Down in the composer walk back and forward
through what you sent, persisted across tabs. Recall takes over only at the line
edge (first line for Up, last for Down) so multi-line markdown stays editable, and
Down past the newest restores the draft you were mid-way through typing.
**Private replies are never stored** — see the security changelog.

**0.43.0 — three mobile bugs, three unrelated causes.**

- *Landscape stayed "portrait."* There was no orientation lock anywhere. The
  breakpoint was width-only (`innerWidth <= 800`), and a phone in landscape reports
  ~812×375 — *wider* than 800, so the app chose the two-column desktop layout on a
  viewport 375px tall. A landscape phone is short, not wide. Now
  `(max-width: 800px), (max-height: 500px)` via one shared hook.
- *Controls heaped in the corner.* The comment above the footer's mobile branch
  had always claimed the version string is dropped on phones. It never was — that
  span rendered unconditionally and, with `nowrap`, was the widest thing in the row.
- *A fourth bug created by fixing the first*, caught in the browser: `MessagePane`
  held a **third** copy of `innerWidth <= 800`, used to indent the header past the
  floating ☰ pill. The moment ChatShell became height-aware they disagreed and the
  pill sat on top of the channel name. Three copies of one magic number in three
  files is what turned a one-bug change into a four-bug change.

**0.44.0 — one "Add topic" button.** `Join` and `+ New` ran the identical three
lines and differed only in descriptor construction. That split was fictional —
Axona has no topic registry, so `+ New` on an open name produced the same topicId
as `Join` on that name. It was also harmful: owner and write **fold into the
address**, and Join's name path hardcoded `write:'open', owner:null`, so typing the
*name* of a moderated channel silently landed you on a different, empty topic — the
#393 failure mode. One dialog now, and the resolved address is displayed before you
commit.

---

## 4. Removed: the "Members" readout

It did not mean what its label said. `presence` is fed by one network-wide
heartbeat topic (`axona-presence-heartbeats`, region eagle), not by the channel on
screen, so it counted everyone anywhere on Axona who had published a heartbeat.
And it could not tick down: the 90-second freshness window was evaluated against a
`Date.now()` captured at render time with nothing re-rendering on a timer, so a
peer going quiet never aged out. Mislabelled *and* frozen. Presence data itself is
untouched and still drives the per-message live/ghost indicators.

---

## 5. Open, and two documentation debts

**Code:**

- **#412** — interloper-death history loss. Real, ≤1%, unattributed, leading
  hypothesis refuted. Hermetic, so far cheaper to iterate on than #406/#341.
- **#414** — retiring the two recruitment tests left that mechanism with **no
  fence**, and its own header records that it drifted silently once before.
- **#413 residual** — the mint math is understood and fixed; nothing outstanding.

**Docs debt found while running this cycle — flagged, not faked:**

- `RELEASE-NOTES.md` stops at **v4.29.0** (2026-07-18) and never mentions 4.49.0.
  That is ~20 kernel versions unrecorded. Backfilling it means reconstructing those
  releases from git history; it is not something to improvise, so it is recorded
  here rather than guessed at. Nothing was owed for *today* — the kernel version
  did not change.
- `programmer-guide/render.sh` is pinned `VERSION="v4.48.0"` / `DATE=2026-07-27`,
  but the standing rule is that developer docs carry the kernel deployed on
  testnet, which has been **4.49.0** since 2026-07-28. The guide is one version
  stale. Bumping it means re-rendering five PDFs and archiving the priors, and it
  should be done deliberately with the 4.48→4.49 content deltas reviewed — not as a
  side effect of a test-infrastructure release.

---

## 6. How to check any of this yourself

```bash
# the suite reports a count, and fails if ran != selected
cd axona-protocol && npm test
npm run test:guard            # disk <-> manifest reconciliation alone
npm run test:list             # every test and its class
```

```bash
# what axona.chat actually serves — never trust the deploy's own output
curl -s https://axona.chat/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
curl -s https://axona.chat/assets/<that>.js | LC_ALL=C grep -c "Add topic"
curl -s https://bridge.axona.net/healthz
```

*Verified on 2026-07-29: bundle carries `0.44.0`, the recall tip, `Add topic` ×2
and the `max-height: 500px` breakpoint; `Members:` returns 0 hits.*
