# Axona Topic Reference Golden Vectors v0.2

Date: 2026-08-28
Status: canonicalization and parse rows fixed; `topicId` column pending the
reference implementation
Companion to: `Axona-Topic-Reference-Grammar-v0.2.md`
Scope: axona.chat open-topic references (app layer)

These rows are the conformance suite the council required. axona.chat runs them
as a unit test; axona-protocol runs the same rows as a cross-check, so the two
implementations cannot drift. A row is `{ display, wire, region, write,
topicId }` plus the accept/reject verdict and a note.

The `display -> wire` mapping and every accept/reject verdict are fixed here and
are exact. The `topicId` column is written by the reference implementation —
`deriveTopicId(region, write, wire)`, the network's existing region-anchored
derivation run over the wire name — and locked by the axona-protocol
cross-check. It reads `<ref>` until then. Do not hand-fill it; a wrong id in a
golden file is worse than an empty one.

## 1. `encodeTopicName(display) -> wire`

The gate: trim leading and trailing `0x20`, collapse interior runs of `0x20` to
one, reject a name holding `#` `/` a literal `~` a non-printable-ASCII byte or
empty-after-trim, then replace each `0x20` with `~`.

| # | display | wire | region | write | topicId | verdict | note |
|---|---------|------|--------|-------|---------|---------|------|
| E1 | `general` | `general` | eagle | open | `<ref>` | accept | bare name, no spaces |
| E2 | `my topic` | `my~topic` | eagle | open | `<ref>` | accept | one space encodes |
| E3 | `my   topic` | `my~topic` | eagle | open | `<ref>` | accept | interior run collapses to one |
| E4 | `  my topic  ` | `my~topic` | eagle | open | `<ref>` | accept | leading/trailing trimmed |
| E5 | `a b c` | `a~b~c` | eagle | open | `<ref>` | accept | every space encodes |
| E6 | `team-frontend` | `team-frontend` | eagle | open | `<ref>` | accept | dash is a normal name character |
| E7 | `General` | `General` | eagle | open | `<ref>` | accept | case preserved — distinct from E1 |
| E8 | `a/b` | — | eagle | open | — | reject | reserved `/` |
| E9 | `a#b` | — | eagle | open | — | reject | reserved `#` |
| E10 | `my~topic` | — | eagle | open | — | reject | literal `~` — the negative test |
| E11 | `   ` | — | eagle | open | — | reject | empty after trim |
| E12 | `café` | — | eagle | open | — | reject | non-ASCII byte (v0.1) |
| E13 | `a<TAB>b` | — | eagle | open | — | reject | `0x09` is not `0x20` and not printable ASCII |

E1 and E7 differ only in case and are two topics. E2, E3, and E4 share one wire
name `my~topic` and so one topic id — the collapse-and-trim proof. E10 is the
negative test: `my~topic` as a display string has no accepted form, so it cannot
become a second hash input that competes with E2's.

## 2. Reference parse — segment count

The parse splits on `/` after the `#` and counts. One segment is a topic in the
resolver's region; two is `region/topic`; three is `region/topic/msgID`. The
topic segment is decoded from wire to display for the row's `display`; the
region and msgID are taken as written.

| # | reference | region | topic (wire) | msgID | verdict | note |
|---|-----------|--------|--------------|-------|---------|------|
| P1 | `#general` | resolver's | `general` | — | accept | relative; resolves to author's region on write |
| P2 | `#eagle/general` | eagle | `general` | — | accept | qualified |
| P3 | `#eagle/my~topic` | eagle | `my~topic` | — | accept | wire name in the reference |
| P4 | `#eagle/my topic` | eagle | `my~topic` | — | accept | display name in the reference — same wire as P3 |
| P5 | `#eagle/weather/3f9a2c` | eagle | `weather` | `3f9a2c` | accept | message deep link |
| P6 | `#eagle/weather/3f9a2c/x` | — | — | — | reject | four segments — excess |
| P7 | `#eagle//general` | — | — | — | reject | empty segment |
| P8 | `#eagle/weather/3f9` | eagle | `weather` | `3f9` | reject | msgID under the six-hex floor |

P3 and P4 land on the same wire name `my~topic` and so the same topic id — the
round-trip proof, the reference form and the display form meeting at one id.

## 3. Regenerating the `topicId` column

```
for each accepted row:
    topicId = deriveTopicId(region, write, wire)   # region-anchored, domain-separated
```

`region` is the registry code (eagle = `0x89`), not the name string. `wire` is
the encoded name from column `wire`. `write` is the topic's write policy. The
reference implementation writes the column; the axona-protocol cross-check reads
these same rows and asserts an identical id for each, and asserts that no two
distinct accepted rows collide.
