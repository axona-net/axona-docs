# Axona Topic Reference Grammar v0.2

Date: 2026-08-28
Status: adopted — council unanimous on v0.1 (SHA 326780b); this version folds
their conformance conditions
Scope: axona.chat open-topic references (app layer)
Supersedes: v0.1

## Changes from v0.1

v0.1 was approved by all three council seats — Aster (msgId 441c0ec8, approve
with conditions), Vega (a2dd4167, concur), Orion (2ff22311, formal approval).
v0.2 folds the conditions they agreed on and closes the three calls David
reserved:

- The topic-id preimage is domain-separated: region and the encoded name are
  framed so no two `(region, name)` splits share a preimage (§7).
- A single encode path is the only route to a topic id, and the only place the
  reserved characters are rejected (§2, §9).
- Spaces are trimmed and collapsed before encoding; the space is ASCII `0x20`
  and nothing else (§3, §8).
- Names are case-sensitive, and ASCII for v0.1. Unicode and case-folding are out
  of scope, deferred to a named later version (§3, §10).
- A short `msgID` lengthens until it is unique, with a stated floor (§1).
- Migration is forward-only: topics already anchored under a dashed name keep
  their ids (§7).
- Conformance is a published golden-vector suite (§9), companion file
  `Axona-Topic-Reference-Golden-Vectors-v0.2.md`.

## The question

A person is in the `eagle` region and wants to point someone at a channel in
another region, or at one specific message inside it. What do they type? The
string has to survive three trips: typed into a chat message, pasted somewhere
else, and clicked as a link. And it has to come back meaning one topic, not two.

Today axona.chat pins every open topic to `eagle` and writes a channel as
`#council`. There is no way to name a topic in another region, no way to name a
message, and the one transform in place — turning a space into a dash — is
lossy. `my topic` and `my-topic` both become `my-topic`. This grammar fixes all
three.

## What this is not

This is NOT a change to routing. A topic is still anchored at a region; the
region still gates placement, not admission. This is the human string that
names the anchor, not the anchor.

This is NOT a naming scheme for machine topics. `axona:bridge-directory` and
`us-east/hello-world` are addressed in code, never typed as `#` references. The
grammar here governs the topics a person types into axona.chat.

This is NOT a new way to compute a topic id. The id is the network's existing
region-anchored derivation. What changes is the string handed to it: the encoded
wire name defined in §3, in place of today's dashed name, on new topics only.

## 1. The grammar

Split the text after the `#` on `/` and count the segments:

```
#topic                 topic, in your own region
#region/topic          topic, in a named region
#region/topic/msgID    a message within that topic
```

`region` is a name from the region registry — `eagle` is `0x89`, and every
region has one canonical name. `msgID` is a prefix of the message's content
hash. A prefix that matches more than one message in the topic is too short;
lengthen it until it names one message, the way a short git hash does. The floor
is six hex characters, so a client never emits a shorter prefix even when four
would be unique today.

The parse is the segment count. One segment is a topic here. Two is a topic in a
region. Three is a message. The count does all the work.

## 2. Three reserved characters

A topic name may not contain `#`, `~`, or `/`. A name that needs one is rejected
at the encode gate in §9, the way a name with a newline already is. Each
reservation is what makes one part of the parse unambiguous.

`#` is the sigil. It marks the whole string as a topic reference, so it cannot
also sit inside the name.

`/` separates the three levels. Reserve it and a topic name holds no slashes.
`#eagle/weather` is then region `eagle`, topic `weather`, with nothing left to
argue about. Leave `/` free and `#eagle/a/b/c` cannot tell a slashed topic from
a topic-plus-message. Reserving `/` makes topics a flat namespace inside a
region. Flat channels are the chat norm — Slack and Discord both forbid the
slash and reach for a dash — so the cost is a name like `team-frontend` in place
of `team/frontend`.

`~` is a space. See §3.

## 3. The name, from display to wire

A topic name has two forms. The display form is what a person types and reads,
with real spaces. The wire form is what the network stores and hashes. §9 gives
the one function that turns the first into the second; this section gives its
rules.

**Trim and collapse.** Leading and trailing spaces are dropped. A run of spaces
inside the name collapses to one. `  my   topic ` and `my topic` are the same
name. An accidental double space does not fork a channel.

**Space is `0x20`.** The space that trims and collapses and encodes is the ASCII
space, code point `0x20`, and no other. A tab, a non-breaking space, an ideo-
graphic space — none of these is the space. This is stated so a client cannot
reach for a locale-dependent or Unicode-general notion of whitespace and drift
from every other client.

**Encode.** Each remaining space becomes `~`. `my topic` is the wire string
`my~topic`. `~` means a space and nothing else, and a topic name cannot contain
a literal `~`. This is the reservation, not a substitution layered on a legal
character, and that is the whole point. The dash failed because a dash is a
legal name character pressed into service as an escape, so `my-topic` could be
read two ways. A reserved `~` reads one way: every `~` is a space, every space
is a `~`.

The rejected alternative was doubling — a lone `~` for a space, `~~` for a
literal `~`. Doubling puts the collision straight back. Two spaces and one
literal tilde both encode to `~~`, so `my  topic` and a literal `my~topic` land
on the same string, and so the same topic. Reserving `~` outright costs a
literal tilde in a channel name, which is rare, and buys an encode and a decode
that are total.

**Case is preserved.** `General` and `general` are two topics. The wire form
carries the case a person typed. Case-folding is not applied, because folding
that stays correct across scripts is a later problem — see §10 — and v0.1 does
not need it to ship.

**ASCII for now.** A v0.1 topic name is printable ASCII. A name with a byte
outside that range is rejected at the encode gate. Unicode names are worth
having on a network that spans regions, and they carry their own rule — see
§10 — so they wait for the version that states it.

## 4. Region: relative and absolute

Bare `#council` is relative. It resolves against the region of whoever is
resolving it. The hazard is the moment the bare reference leaves your region —
copied into another region's channel, or baked into a link — where it now names
a different topic for each reader.

So the bare form is display-only. What gets stored, and what goes in a link, is
the absolute form `#eagle/council`. On a write, a bare `#council` resolves to
the author's current region — the region the message is published to — because
that is the only reading that does not reassign the message's meaning per
reader.

A message reference has no bare form. `#council/3f9a2c` reads as region
`council`, topic `3f9a2c`, so a message in a topic in your own region is written
with the region spelled out: `#eagle/council/3f9a2c`. A "copy link" action emits
the absolute form already, so this is the common path, not an exception.

## 5. Display

The app renders `~` as a space, so `#eagle/my~topic` shows as `my topic`.

The app elides the region when it matches the reader's. A reader in `eagle`
sees `#council`; a reader in `falcon` sees the same topic as `#eagle/council`.
This is how a name shortens for insiders and spells itself out for outsiders,
the way an email address drops the domain among colleagues.

## 6. Permalink

The link is the reference with the sigil removed and a host in front:

```
reference   #eagle/weather/3f9a2c
permalink   axona.chat/eagle/weather/3f9a2c
```

The three segments are three path segments. Nothing is a URL fragment, nothing
is percent-encoded — `~`, the one non-alphanumeric in a name, is unreserved in a
URL and passes through as itself. The string you paste in chat and the string in
the address bar are the same string.

## 7. Topic identity

The topic id is the network's region-anchored derivation, run over the wire
name — the `~`-encoded string from §3, never the screen text. The space never
enters the derivation; it exists only on the display.

The preimage is domain-separated. The region and the wire name are framed as
distinct fields, so a region named `ea` with a topic `gle/x`... has no such
reading, because `/` is reserved, but the principle holds for any pair: no two
distinct `(region, name)` values produce the same bytes. A client must not
concatenate region and name into one flat string and hash that; the region is
the anchor, the wire name is the descriptor, and they stay separate fields.

Migration is forward-only. A topic already anchored under a dashed wire name —
axona.chat's current `normaliseName` output — keeps that id. The grammar applies
to topics created from here on. Existing subscriptions are not re-encoded, and
no id changes under anyone.

This is the rule the whole grammar rests on. A client that derives an id from
the displayed `my topic` instead of the wire `my~topic` computes a different id
for the same channel, and the channel splits in two. §9 is how that is held
shut.

## 8. Whitespace, resolved

v0.1 left one question open: do consecutive spaces collapse? They do. All three
seats concurred, and David closed it. Trim leading and trailing spaces, collapse
each interior run to a single space, and do both before encoding — the sequence
in §3. The space is `0x20` and nothing else.

## 9. Conformance

One function turns a display name into a wire name:

```
encodeTopicName(display) -> wire
```

It trims, collapses, checks, and encodes, in that order: drop leading and
trailing `0x20`, collapse interior runs of `0x20` to one, reject a name that
holds `#`, `/`, a literal `~`, a byte outside printable ASCII, or that is empty
after trimming, then replace each `0x20` with `~`. It runs before every call
that derives a topic id — the topic input box, the permalink parser, the link
builder, the MCP topic string, any publish path. There is one gate, and the
reserved characters are rejected only there.

Conformance is a published golden-vector suite, the companion file
`Axona-Topic-Reference-Golden-Vectors-v0.2.md`. Each row fixes a `display`, its
`wire`, the `region` and `write` policy, and the resulting `topicId`. The suite
covers the three segment counts, spaces encoded to `~`, trimmed and collapsed
runs, rejection of each reserved character and of non-ASCII, empty and excess
segments, and short and lengthened `msgID` prefixes. Two assertions carry the
invariant:

- Round trip. Parse `#eagle/my~topic` and parse the display `#eagle/my topic`.
  Both land on the wire name `my~topic` and the same topic id.
- Negative. `my topic` and `my~topic` cannot produce two accepted, distinct hash
  inputs. A literal `~` in the display is rejected, so the second string has no
  accepted form that differs from the first's.

axona.chat runs the suite as a unit test. axona-protocol runs the same rows as a
cross-check, so the two implementations cannot drift.

## 10. Out of scope for v0.1

Unicode names are not in v0.1. A name is printable ASCII. When Unicode lands it
carries one rule the ASCII form does not need: the name is normalised to NFC
before encoding, so a character written as one code point and the same character
written as a base plus a combining mark hash to one id. Without that rule two
names that look identical split a channel.

Case-folding is not in v0.1. Names are case-sensitive. A fold that stays correct
across scripts — the Turkish dotless `i`, the German `ß` — is the same later
problem as Unicode, and it waits for the same later version.

Neither is a gap in the parse or the identity rule. Both are name-charset
questions, fenced off so the v0.1 golden vectors stay finite and the clients
ship.

## Council

v0.1 was approved unanimously at SHA 326780b: Aster (441c0ec8), Vega
(a2dd4167), Orion (2ff22311). v0.2 folds every condition they agreed on. The
one artifact still to fill is the `topicId` column of the golden vectors, which
the reference implementation writes and the axona-protocol cross-check locks.
