# Known-network viewer — design brief

David, 2026-11-07: "I want to build a visualization tool for the 'known network'. That is, what can be determined from whatever data is available to a given node."

## The question

What does the network look like from where a node stands, and what does it look like when many of those views are put side by side?

A browser tab knows its own peers and the topic roles it holds. That is a small picture. A relay knows more. Joined together, the views of all 48 relays and the bridges cover most of the network. The viewer answers both questions with one program: it draws whatever views it is handed.

## What this is NOT

- It is NOT a monitoring service. It runs on demand, on David's machine or in a node, and stops.
- It publishes NOTHING to the mesh. A view of the network is never posted to a topic.
- It does NOT persist node IDs. A node ID is a transport correlator, and a correlator leads to an IP. The viewer holds IDs in memory for the life of the display and writes none to disk (see memory rule "never persist a transport/node ID").
- It shows NO IP addresses and NO locations. The envelope discloses who, never where, and the viewer keeps that.
- It is NOT a new query surface on relays. Relays have no network query endpoint by design. Fleet data reaches the viewer through files that the operator's machine collects.

## Two parts, one format

The work splits in two at a file format, so the viewer can be built and tested without the access that fleet collection needs:

1. **The viewer** (council build). Reads observations, merges them, draws them.
2. **The collector** (axona.bot). Gathers observations from the fleet and writes them in the same format.

A regular node needs only the viewer. It makes one observation of itself and draws it.

## The observation

One observation is one node's view at one moment. It is derived from `peer.health()`, the object a relay already writes on SIGUSR1 and a seat already shows in `axona_status`:

```json
{
  "schema": "axona-observation/1",
  "at": 1794100000000,
  "observer": { "nodeId": "<66-hex>", "kind": "relay|bridge|browser|seat|cli", "label": "m1-r3", "kernel": "4.131.0" },
  "complete": { "peers": true, "roles": true },
  "peers":  [ { "nodeId": "<66-hex>", "link": "webrtc|ws|turn|routed", "rttMs": 23 } ],
  "roles":  [ { "topic": "<66-hex>", "nature": "root|backup|child|reader", "holder": "<66-hex>|null",
                "subscribers": 4, "children": 2, "cacheSize": 17 } ],
  "admission": { "roles": 41, "maxRoles": 96, "saturated": false }
}
```

Fields the source cannot supply are null, never zero. `complete` separates "this node holds no roles" from "this node's roles could not be read", the same distinction `health().axonRolesComplete` makes. A census that counts a failed read as an empty one has been wrong on this project before.

`label` is set only for David's own relays and bridges (host and slot, e.g. `win-svc-07`). Every other node is shown by a short ID prefix.

## Sources the viewer accepts

- **Self.** In a node (browser or CLI), call `peer.health()` and build one observation. This is the regular-node mode, and it is the first thing to make work.
- **A directory of observation files** (`*.json`, one observation per file, or `*.ndjson`). This is what the collector writes. The viewer re-reads the directory on a button or a timer.

## Merging views

- A node is **observed** when an observation comes from it, and **inferred** when it appears only in someone else's peer list. Draw the two differently (filled and hollow).
- A link is **confirmed** when both ends list each other, and **one-sided** when only one end does. One-sided links are where to look for half-open channels.
- Newer observations of the same observer replace older ones. Show each observer's age, so a stale view isn't read as current.

## What to draw

- **The mesh.** Nodes and peer links, coloured by link kind (webrtc, ws to a bridge, turn relay, routed). RTT is the edge label when present.
- **A topic.** Pick a topic and see its tree: the root (or roots — a split shows as two), backups, children and readers. Two roots on one topic is the condition council has spent weeks on, and it should be impossible to miss.
- **Load.** Per node, roles against `maxRoles`, with `saturated` called out.

A plain force-directed layout is enough to start. Islands (the Windows-versus-Mac partition of late October) should be visible as separate clusters without any special handling.

## The collector (axona.bot builds this)

`ops/known-network-collect.mjs` on David's machine:

- For each relay host (air, m1, axona-linux, axona-win, the droplets), trigger the health dump and read it back over ssh, using the existing fleet tooling and never hand-rolled process control.
- For each bridge, read the authenticated diagnostics with the token held on this machine.
- Add axona.bot's own seat observation.
- Write one observation file per node into a directory under the scratch area, overwriting the previous run. Nothing is kept between runs.

The collector is read-only on the fleet. It restarts nothing and changes no configuration.

## Open questions for the builder

- Browser app, CLI that serves a local page, or both? The self mode wants to live inside a node; the fleet mode only needs to read files.
- How many nodes can the layout draw before it needs clustering? Roughly 60 observed nodes plus their inferred peers is the fleet case.
- Is there a cheap way for a regular node to learn more than its own view without a new protocol surface? If not, say so and stop there.

## Who

Recommended: Vega designs and builds the viewer, and Orion reviews. Aster leads axona 5 and is not taken off it. axona.bot builds the collector and provides the fleet observations. David can reassign any of this.
