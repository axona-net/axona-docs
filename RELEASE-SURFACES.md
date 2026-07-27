# Release surfaces — what carries a version, and how each one is built

*Every place a version number, install command, or cross-repo link is written down,
and the exact mechanism that regenerates it. This exists because on 2026-07-27 we
found three separate surfaces telling users to fetch things that did not exist —
and finding them took longer than fixing them.*

Baseline recorded 2026-07-27 at kernel **4.48.0**.

---

## 0. The rule that orders everything

> **Documents are versioned to the kernel version DEPLOYED ON TESTNET.**
> Held or undeployed releases do not count. Re-version on each edit cycle.

And its companion:

> **Never delete a prior PDF.** Render the new one at the top level, then
> `git mv` the PRIOR top-level PDF into `history/<section>/` and update the
> README link.

---

## 1. Rendering — there are exactly four pipelines

Knowing which pipeline a document is on tells you everything about how to change it.

### Pipeline A — `pandoc` → `.tex` → `tectonic`, driven by a script

**Only `programmer-guide/`.** Source of truth is the **`.md`**; the `.tex` is a
build artifact and is overwritten every run. Do not hand-edit it.

```bash
cd axona-docs/programmer-guide && ./render.sh
```

`render.sh` holds `VERSION=` (line ~15) and `DATE=` near it — **edit those first**,
they name the output files. It generates a per-doc title page, applies
`axona-doc-preamble.tex` (tufte-handout: full-width body, margin notes, no page
numbers, heading-orphan protection), and runs `tectonic`.

Five docs ride it: Quick Start, API Reference, Programmer Guide, Services Guide,
AI Grounding. (`Axona-AI-Reference` is markdown-only — machine-facing, no PDF.)

### Pipeline B — hand-maintained `.tex` → `tectonic`

**The `.tex` IS the source.** There is no markdown upstream and no script; you edit
LaTeX directly and run:

```bash
cd axona-docs/<section> && tectonic Axona-<Name>.tex
```

| Doc | Source | Current |
|---|---|---|
| Architecture | `architecture/Axona-Architecture.tex` | v4.27.0 |
| Whitepaper | `whitepaper/Axona-Whitepaper.tex` | v0.11 |
| Explainer | `explainer/Axona-Explainer.tex` | v0.4.29 |
| Manifesto | `manifesto/Axona-Manifesto.tex` | — |
| Paper | `paper/Axona-Paper.tex` | v0.5.0 |
| Synopsis | `synopsis/Axona-Synopsis.tex` | v0.6 |
| Applications | `applications/Axona-Applications.tex` | v0.6 |

`tectonic` is self-contained and fetches tufte-latex itself — **no system TeX Live
is installed and none is needed.** Do not reach for `md-to-pdf` on these.

### Pipeline C — Marp

Slide decks. Both are markdown with `marp: true` frontmatter; **the version lives
in the `footer:` field**, and the rendered filename must match it.

```bash
npx @marp-team/marp-cli deck.md -o "N-DHT Presentation v<footer-version>.pdf"
```

- `presentation/deck.md` → currently v0.3.55. **Render unprompted after any edit.**
- `pitch/axona-pitch.md` → currently v0.23.

### Pipeline D — markdown only, no render

Nothing to build; the `.md` is the artifact. `SECURITY-CHANGELOG.md`,
`RELEASE-NOTES.md`, `TESTNET.md`, `BUILDING.md`, `architecture/INVARIANTS.md`,
the architecture scorecards, `implementation/`, and everything in `team-updates/`.

---

## 2. Websites — what serves what

| Site | Repo | Mechanism | Notes |
|---|---|---|---|
| **axona.net** | `axona-web` | Pages from `main`, `CNAME` in repo | Hosts the whitepaper mirror + doc links |
| **demo.axona.net** | `axona-protocol` | Pages from `main`, `CNAME` in repo | `apps/` — minimal, share, pow-bench |
| **axona.chat** | `axona-chat` | Pages via `.github/workflows/deploy.yml` | Custom domain is a **Pages setting**, not a repo `CNAME` |
| **axona-share** (standalone) | `axona-share` | Pages via `.github/workflows/pages.yml` | `axona-net.github.io/axona-share` |
| **testnet.axona.net** | droplet `161.35.234.165` | `git pull` on three `testnet` checkouts | bridge + peer app + demo-testnet |

**Deploy branches:** work happens on `testnet`, live sites build from `main`. Web
and prod repos need `git push origin testnet:main` as well as
`git push origin testnet`. (`axona-relay` and `dht-sim` are testnet-only.)

**The whitepaper lives in TWO repos.** Edit the source in `axona-docs/whitepaper`,
render, then **copy the fresh PDF into `axona-web/whitepaper/` and push `main`** —
axona.net serves the axona-web mirror, not axona-docs. Rendering alone changes
nothing publicly.

---

## 3. READMEs — all eleven

| Repo | Carries a kernel version? | Notes |
|---|---|---|
| `axona-protocol` | **YES** — install command + 6 doc links | Highest-risk file in the set; see §4 |
| `axona-bridge` | **YES** — headline + `/healthz` sample + env table | Sample output must match a real bridge |
| `axona-docs` | **YES** — index links to every current PDF | Re-link on every doc re-version |
| `axona-peer` | **v4.38.0 — CORRECT, DO NOT UPDATE** | ⛔ FROZEN. Deliberately stale |
| `axona-relay` | No kernel version | Cites `bridge.axona.net` / `testnet.axona.net` |
| `axona-chat` | No | — |
| `axona-share` | No | Cites bridge URLs |
| `axona-web` | No | — |
| `axona-mcp` | No | Cites bridge URLs |
| `alert-bot` | No | 12 lines |
| `dht-sim` | No | 1546 lines, oldest (2026-06-08); prose likely drifted |

---

## 4. The cross-repo reference trap

**This is the failure mode that keeps recurring.** A file is renamed in `axona-docs`,
and nothing in any other repo knows. On 2026-07-27 it bit three times independently:

1. `axona.net`'s developer-doc links → 404 (pointed at `-v4.38.0` filenames)
2. `axona-protocol/README.md`'s six doc links → **all six 404** (`-v4.27.1`, `-v4.30.0`)
3. `axona-protocol/README.md`'s install command → `#v4.38.0`, **ten releases stale**

Renaming the programmer-guide set is therefore never a one-repo operation.

**This is now guarded by CI.** `scripts/check-links.mjs` resolves every link
against a real axona-docs checkout on disk — deterministic, no network, no rate
limits. It runs in `axona-docs`, `axona-protocol`, `axona-bridge` and `axona-web`
on push and PR, **plus weekly on a schedule** in the consumer repos: a rename can
land in axona-docs alone, and those repos would otherwise have no commit to
trigger on.

Run it yourself before pushing a docs cycle:

```bash
node axona-docs/scripts/check-links.mjs . --docs-root ../axona-docs
```

Two deliberate policies:

- **`vendor/` is skipped.** A vendored axona-protocol carries its own README;
  fixing a link there is pointless because the next re-vendor overwrites it.
  Stale vendored links are a re-vendor problem, and the fix is to re-vendor.
- **`history/`, `team-updates/` and `red team/` warn but never fail.** They are
  snapshots in time — a v2.51 team update correctly references what existed at
  v2.51, and "fixing" it would falsify the record. They stay visible as warnings
  so nothing is hidden, but they cannot turn CI red, because a build that is red
  for reasons nobody may fix is a build that gets muted.

`axona-peer` is deliberately **not** wired up: it is frozen, and adding CI to it
would be a change to a repo that must not change.

---

## 5. Release checklist

**Code, in dependency order** — kernel → consumers → deploy → verify:

- [ ] `axona-protocol`: bump, tag `vX.Y.Z`, push `testnet` (+ `testnet:main` to deploy demo)
- [ ] Re-vendor/re-pin: `axona-relay`, `axona-bridge`, `dht-sim`, `axona-chat` — **never `axona-peer`**
- [ ] Deploy: testnet droplet → prod bridges (**east first**, west is the surviving bootstrap) → 9 prod relays
- [ ] Verify by **fetching what each surface actually serves** — `/healthz`, the built bundle, the live page. Never trust the deploy command's own output.

**Docs, once testnet is live on the new kernel:**

- [ ] `SECURITY-CHANGELOG.md` if anything security-relevant shipped (newest first, keyed to kernel version, say what is PROTECTED, never enumerate open findings)
- [ ] `RELEASE-NOTES.md`
- [ ] `team-updates/TEAM-UPDATE-<date>-v<kernel>.md` — **in `team-updates/`, never the repo root**
- [ ] `programmer-guide/render.sh` → bump `VERSION`/`DATE`, edit the five `.md`, `./render.sh`
- [ ] `git mv` prior top-level PDFs → `history/programmer-guide/`
- [ ] Architecture / Whitepaper / others **if materially affected** — Pipeline B, then archive priors
- [ ] Whitepaper only: copy PDF → `axona-web/whitepaper/`, push `main`
- [ ] `axona-docs/README.md` → relink every renamed PDF

**Cross-repo, the step that gets forgotten:**

- [ ] `axona-protocol/README.md` → install pin + all six doc links
- [ ] `axona-bridge/README.md` → headline version, kernel line, `/healthz` sample, new env vars
- [ ] `axona-web` → developer-doc link targets
- [ ] **Verify every changed link returns 200**

---

*Maintained alongside `architecture/INVARIANTS.md`. If you add a surface that carries
a version, add it here in the same commit — the cost of this document is entirely in
rediscovering what it lists.*
