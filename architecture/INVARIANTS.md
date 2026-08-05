# Invariants — moved

**Superseded 2026-08-05.** The invariants live in
[`Axona-Architecture.tex`](Axona-Architecture.tex) §XII, and nowhere else.

This file held `S1–S6` (structural rules) and `B1–B13` (behavioural
invariants) plus `I-ID`. `axona-protocol/INVARIANTS.md` held `I-1…I-11`
under a different scheme. The two overlapped without cross-referencing, so a
reader could not tell whether `B3` and `I-2` were two rules or one — they were
one. Worse, the kernel copy's `I-1` asserted that a topic has *exactly* one
root, which the system does not guarantee and never has.

Everything here was folded into §XII: the six structural rules as their own
subsection, the behavioural entries merged into `I-1…I-18`, each carrying its
enforcing test or the word **UNFENCED**, and the process rules as a closing
subsection. The old identifier is printed beside each entry (`was B7`), so
existing references still resolve.

| Old | New |
|---|---|
| S1–S6 | §XII structural rules, same numbering |
| B1 | I-16 (region is an optimization, never a wall) |
| B2, B4, B9 | I-1 (convergence) |
| B3 | I-2 |
| B5, B6, B11 | I-4 |
| B7, B8 | I-8 |
| B10 | I-10 |
| B12 | I-17 (a bridge holds no topic role) |
| B13 | I-18 (capacity is measured, never counted) |
| I-ID | I-15 (transport identity is ephemeral) |
| C. Process rules | §XII process rules |

The long-form arguments that were here — B1 on why a region wall cannot be
load-bearing, B12 on the three doors and why referral beats proxy, I-ID on why
a durable `nodeId` is a durable correlator — are in §XII and in the sections
they belong to. Git history holds this file's previous contents.
