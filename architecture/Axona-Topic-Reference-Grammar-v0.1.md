# Axona Topic Reference Grammar v0.1

Date: 2026-08-28
Status: proposal — for council review
Scope: axona.chat open-topic references (app layer)

## The question

A person is in the `eagle` region and wants to point someone at a channel in
another region, or at one specific message inside it. What do they type? The
string has to survive three trips: typed into a chat message, pasted somewhere
else, and clicked as a link. And it has to come back meaning one topic, not two.

Today axona.chat pins every open topic to `eagle` and writes a channel as
`#council`. There is no way to name a topic in another region, no way to name a
message, and the one transform in place — turning a space into a dash — is
lossy. `my topic` and `my-topic` both become `my-topic`. This note fixes all
three.

## What this is not

This is NOT a change to routing. A topic is still anchored at a region; the
region still gates placement, not admission. This is the human string that
names the anchor, not the anchor.

This is NOT a naming scheme for machine topics. `axona:bridge-directory` and
`us-east/hello-world` are addressed in code, never typed as `#` references. The
grammar here governs the topics a person types into axona.chat.

This is NOT a new identity for existing topics beyond the single hashing rule in
§7. The reference is a way to write a topic down; the topic id is what the
network already computes.

## 1. The grammar

Split the text after the `#` on `/` and count the segments:

```
#topic                 topic, in your own region
#region/topic          topic, in a named region
#region/topic/msgID    a message within that topic
```

`region` is a name from the region registry — `eagle` is `0x89`, and every
region has one canonical name. `msgID` is a prefix of the message's content
hash, long enough to be unique within the topic, the way a short git hash is:
`3f9a2c`, not the full sixty-four characters.

The parse is the segment count. One segment is a topic here. Two is a topic in a
region. Three is a message. The count does all the work.

## 2. Three reserved characters

A topic name may not contain `#`, `~`, or `/`. A name that needs one is rejected
on input, the way a name with a newline already is. Each reservation is what
makes one part of the parse unambiguous.

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

## 3. Spaces

A space in a topic name is stored as `~`. `my topic` is the string `my~topic`.
The app shows the space; the reference and the link carry the `~`.

`~` means a space and nothing else. A topic name cannot contain a literal `~`.
This is the reservation, not a substitution on top of a legal character, and
that is the whole point. The dash failed because a dash is a legal name
character pressed into service as an escape, so `my-topic` could be read back
two ways. A reserved `~` reads back one way: every `~` is a space, every space
is a `~`.

The rejected alternative was doubling: a lone `~` for a space, `~~` for a
literal `~`. Doubling puts the collision straight back. Two spaces and one
literal tilde both encode to `~~`, so `my  topic` and a literal `my~topic` land
on the same string, and so the same topic. And `~~~` cannot be read back —
space-then-tilde and tilde-then-space are the same three characters. Reserving
`~` outright costs a literal tilde in a channel name, which is rare, and buys an
encode and a decode that are total.

## 4. Region: relative and absolute

Bare `#council` is relative. It resolves against the region of whoever is
resolving it. In your own client that is you. The hazard is the moment the bare
reference leaves your region — copied into another region's channel, or baked
into a link — where it now names a different topic for each reader.

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

The topic id is the hash of the canonical form — the `~`-encoded string, the one
with `my~topic` in it, not `my topic`. The encoded string is the identity. The
space never enters the hash; it exists only on screen.

This is the one rule that touches identity, and it is the rule that has to be
settled before any of the display and link behaviour is built on top of it.

## 8. Open question

Do consecutive spaces collapse? Without a rule, `my topic` and `my  topic` are
two topics — `my~topic` and `my~~topic` — which is consistent and easy to trip
over with an accidental double space. Collapsing runs of space to one before
encoding makes them the same topic. This note recommends collapsing and leaves
the decision to David.

## Council review

Requested from Aster, Orion, and Vega. The parse in §1, the three reservations
in §2, and the identity rule in §7 are the load-bearing claims. The place to
push is §7: hashing the encoded form fixes the identity for every future client,
so a client that hashes the displayed form instead would compute a different id
for the same channel. State the invariant you would enforce to keep every client
on the encoded form.
