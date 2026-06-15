# Axona as a decentralized control plane for virtual device links (v0.1)

**Status:** architecture note / design sketch · **Flagged:** 2026-06-15 ·
**Prompted by:** AWS *Resilient Network Graphs* (RNG) — random-graph datacenter
fabric (Shufflebox optical scrambling + Spraypoint packet spraying), reported
~⅓ faster / ~40% more energy-efficient. The question this note answers: *could
Axona pub/sub serve as "dynamic virtual connections between network devices" in
an RNG-like way?* Short answer: not as a fabric — as a **control plane**.

---

## TL;DR

RNG and Axona are **not the same layer**, and a literal "Axona instead of RNG"
loses immediately. RNG is a **data plane**: hardware, line rate (ns–µs), terabits,
inside *one owner's trusted datacenter*. Axona is an **application-layer overlay**:
signed envelopes, WebRTC/WS, milliseconds, open and adversarial. You cannot move
datacenter packets over Axona pub/sub — the per-message cost (sign → DHT lookup →
mesh route) is orders of magnitude too heavy.

The productive framing is **Axona as a decentralized, zero-trust SDN-style
control plane**: devices use pub/sub to *discover* each other, *advertise*
capability and liveness, and *negotiate* a direct virtual link; the bulk data
then flows over that link **out of band**, with Axona out of the path. This is
exactly the two-phase model Axona already runs (the bridge brokers the
rendezvous; WebRTC then carries data directly) — and the **bridge directory is
the existence proof** that devices can advertise endpoints on a public topic and
others can discover, rank, and fail over to them with no central registry.

It wins precisely where RNG's assumptions break: **no single owner**
(multi-operator WAN, SD-WAN, edge/IoT, coalition or contested networks), where
the control plane must be ownerless and the devices mutually untrusting. Inside
one AWS datacenter, RNG wins decisively and Axona would be absurd.

## 1. The layer split (why this isn't a competition)

| | AWS RNG | Axona (this proposal) |
|---|---|---|
| Plane | data | **control** (+ low-rate messaging) |
| Medium | optics + switch silicon | signed pub/sub over WebRTC/WS |
| Timescale | ns–µs, line rate | ms; eventual/best-effort |
| Topology dynamism | random but **physically fixed** once cabled; dynamism is in packet *spraying* | **fluid** — links form/decay/re-form per session |
| Trust | single owner, trusted fabric | zero-trust; every device = its keypair |
| Locality | deliberately **randomized away** (every in-DC path is short) | **preserved** via geo-prefix routing (right for WAN/edge) |
| Failure model | graceful degradation across many short paths | route-around dead/saturated peer; no SPOF, no controller |
| Guarantees | provable bisection BW, bounded latency | none — emergent, eventually-consistent |

Read across the bottom rows and the shared instinct is clear: **both reject
hierarchy for a flat, redundant, multipath, self-healing graph.** RNG validated
that bet in hardware at hyperscale; Axona makes the same bet one layer up, for a
setting RNG was never meant to serve — devices with no common owner.

## 2. The two-phase pattern Axona already has

Axona's bridge model *is* a control-plane / data-plane split:

```
discover + signal  ──►  Axona (bridge / mesh)      ← control plane (this note)
carry data         ──►  direct WebRTC DataChannel   ← data plane (out of band)
```

Generalize "browser peer" to "network device" and "WebRTC DataChannel" to
"whatever the devices speak directly" (WireGuard/IPsec tunnel, VXLAN/Geneve,
QUIC, MPLS-over-UDP, a raw socket). Axona's job ends once the two endpoints hold
enough to bring up that link themselves.

## 3. Topic schema (concrete)

**Device presence / capability — a public fabric topic.** Modeled directly on
the bridge directory (`axona:bridge-directory`):

- Topic: `axona:netfabric:<fabric-id>` published with `publisher: null` so every
  device derives it identically. A device `host()`s it if it is infrastructure
  (durable root that stores+serves entries without consuming), else `sub()`s
  `{ since: 'all' }` at join and merges.
- Entry (signed; `signerPubkey` **is** the stable device id):
  ```json
  {
    "device":   "<signerPubkey>",
    "endpoints":[ "wg://203.0.113.7:51820", "quic://[2001:db8::7]:443" ],
    "transports":["wireguard","quic"],
    "role":     "edge-router",
    "caps":     { "mbps": 10000, "mtu": 9000 },
    "region":   "eu-west",
    "health":   { "load": 0.31, "ts": 1750000000000 },
    "ttl_ms":   172800000
  }
  ```
- **Geo-prefix is the WAN advantage.** The topic-id's 8-bit S2 prefix biases
  discovery toward nearby devices — the locality RNG throws away (correctly, in a
  DC) is exactly what you want to keep across a wide-area fabric. A device
  advertises into its region's keyspace; a peer looking for a nearby exit finds
  it without a global directory scan.
- **Role/capability sub-topics** (`axona:netfabric:<id>:role:edge-router`) let a
  device subscribe to *just* the supply it needs.

**Per-link negotiation — a private rendezvous.** Once A picks B from the
directory, the link is brought up the same way WebRTC SDP is relayed today —
offer/answer over a pairwise channel (a derived topic keyed to the pair, or a
direct signed `send()`), carrying transport choice, addresses/ICE-equivalents,
session-key material, and MTU. This is **control metadata only**; the session
keys negotiated here key the *direct* link, not anything Axona sees.

## 4. Link lifecycle

```
advertise  →  discover + rank  →  negotiate (offer/answer)  →  bring up direct link
   ▲                                                                    │
   └──────────── re-discover alternate on failure ◄──── maintain (heartbeat) ┘
```

- **Advertise / discover / rank** — reuse `rankBridges`-style layered ranking:
  configured roots first, then devices this one has *personally* connected
  through (first-party reputation: success, recency, measured RTT/throughput),
  then fresh signed entries by proximity + tenure. Stale entries (past `ttl_ms`)
  drop.
- **Negotiate** — offer/answer; both sides already hold each other's verifying
  key from the signed advert, so the link is mutually authenticated end-to-end.
- **Maintain** — liveness via a low-rate heartbeat (pub/sub or on the direct
  link). Lifecycle verbs already exist: `unsub` (stop listening), `unpub`/`kill`
  (withdraw or tombstone an advert), bounded queues + TTL ceilings cap stale state.
- **Fail over** — a dead device's advert ages out and peers re-rank to an
  alternate. This is the bridge-failover path verbatim, generalized — the
  resilience analogue of RNG rerouting around a cut link, but with **no
  controller** deciding the reroute.

## 5. What this buys over an RNG-style fabric — and what it cannot

**Buys (where RNG's single-owner-DC assumption breaks):**
- **No central control plane.** Coordination with no controller to seize or fail
  — the headline Axona property, now applied to device interconnect.
- **Zero-trust interconnect.** Each device proves itself by key; adverts are
  signed; links are mutually authenticated. Right for cross-operator / coalition /
  hostile environments.
- **Genuinely dynamic topology.** Links re-form continuously — *more* dynamic
  than RNG, whose graph is physically fixed once cabled.
- **WAN-correct locality** via the geo-prefix, instead of randomizing it away.

**Cannot (use the right tool):**
- **Not a packet fabric.** It establishes and manages links; it does not carry
  bulk traffic. The instant real throughput is needed, hand off to the direct
  link.
- **No SLA / no determinism.** Emergent, eventually-consistent, best-effort.
  Anything needing bounded latency or provable bisection bandwidth stays on
  purpose-built hardware.
- **Reconfiguration is ms–s, not sub-µs.** Fine for connection setup and
  topology churn; wrong for per-packet decisions.

## 6. Honest security boundary (inherited from the bridge directory)

Signed adverts prove **who** a device is, not **that its endpoint is real or
honest** — anyone can sign an advert for a link that doesn't exist, or flood the
fabric topic with identities (Sybil). As with the bridge directory, the damage
is bounded **client-side, not by the directory**: a device never auto-replaces a
configured/trusted peer, prefers links it has personally verified, and a
fake/dead endpoint simply fails at negotiation and sinks to last resort — one
wasted attempt, never a hijack. Stronger admission (device-identity proof-of-work,
gossiped reputation, an operator's trusted-root set) is deferred hardening, the
same phase-2 work flagged for the directory. See the bridge directory trust
model in
[axona-bridge `deploy/INSTALL.md`](https://github.com/axona-net/axona-bridge/blob/main/deploy/INSTALL.md)
and `@axona/protocol` `src/bridgeDirectory.js`.

## 7. Open questions

- **Heartbeat vs. direct-link liveness** — where does failure detection live,
  and how fast can re-rank + re-negotiate close a gap without flapping?
- **Pairwise negotiation channel** — derived per-pair topic vs. direct signed
  unicast; which scales better for a dense fabric?
- **Capacity/health honesty** — `load`/`mbps` in an advert are self-reported;
  first-party measured throughput should dominate ranking, mirroring how the
  directory trusts observed time-to-mesh over advertised location.
- **dht-sim model** — a fabric-control-plane scenario (N devices, churn, link
  setup/teardown, failover latency) would let us measure convergence before any
  real deployment, the same way we gate protocol changes today.

---

*This is a positioning + design sketch, not a committed roadmap item. It exists
so the RNG comparison and the control-plane framing are on record if we pursue a
network-device or SDN-overlay application of Axona.*
