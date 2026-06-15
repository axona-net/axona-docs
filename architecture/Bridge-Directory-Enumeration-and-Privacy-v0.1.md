# Bridge directory enumeration & the mass-shutdown threat (v0.1)

**Status:** architecture note / design rationale · **Flagged:** 2026-06-15 ·
**Prompted by:** the external [Security Assessment: Axona Bridge](https://github.com/axona-net/axona-bridge/issues/1)
(June 2026), finding **G-1** (directory enumeration / mass shutdown — rated
CRITICAL). **Relates to:** the bridge directory (kernel
[`bridgeDirectory.js`](https://github.com/axona-net/axona-protocol/blob/main/src/bridgeDirectory.js),
SECURITY-CHANGELOG v2.42.0); the Synopsis claim *"no one address to block"*;
[Gates-to-Gradients 1 — Costly identity](Gates-to-Gradients-1-Costly-Identity-v0.1.md);
the red-team [punch list](../red%20team/red-team-punchlist-v2.43.0.md) (G-1).

---

## TL;DR

The bridge directory is, by design, a **publicly readable, self-updating map of
the entire bridge fleet** — every bridge advertises its `wss://` endpoint, coarse
coordinates, version, and signing key so clients can discover it and fail over to
it. The external assessment is correct that this hands a state-level adversary a
complete, actionable target list, and that our stated defence — *"no one address
to block"* — holds against **ad-hoc blocking of individual bridges** but **not**
against an adversary who enumerates and targets the **whole fleet at once**.

This is not an oversight; it is a real and fundamental **tension between
discoverability and enumerability**. The directory exists precisely to remove the
single-bridge point of failure (auto-discovery, transparent failover, new bridges
usable immediately). That same openness is what makes the fleet enumerable. You
cannot have "any client can find a bridge" and "no adversary can find all bridges"
without a *partitioned, credentialed distribution layer* — which is exactly the
lesson Tor learned with BridgeDB.

Two honest conclusions follow. First, **access-controlling the directory is
necessary but not sufficient**: Axona bridges are `wss://` endpoints at known
domains with valid TLS, so they are blockable by SNI/DNS and discoverable by
internet-wide scanning *regardless of the directory* — the deeper gap is the
absence of pluggable-transport-style obfuscation, a much larger lift. Second, the
**Synopsis claim should be qualified**: "no single *fixed* address to block," not
"unstoppable."

## 1. The tension: discoverability *is* enumerability

The directory's purpose (see SECURITY-CHANGELOG v2.42.0 and the Synopsis "What it
is" section) is resilience: many replaceable bridges, anyone can launch one, every
node collects the current set on launch, so knocking one bridge offline just fails
clients over to others and a new bridge is found without a client update. **No
single point of failure — not even the rendezvous.**

For that to work, a client with no prior state must be able to *discover* bridges.
Discovery is enumeration seen from the other side: a mechanism that lets an honest
new client learn the fleet also lets a hostile new client learn the fleet. The two
are the same operation. So the directory's resilience benefit and its
enumeration exposure are not separable features — they are one property viewed
from two directions, exactly as "un-censorable and un-governable are one fact" in
the Synopsis.

## 2. The threat (as the assessment frames it, and it's fair)

A state-level adversary does not need traffic analysis or infiltration:

1. **Enumerate (minutes).** Connect to any bridge, subscribe to
   `axona:bridge-directory` with `since:'all'`, receive the full signed set:
   every `wss://` endpoint, coordinates, region, version, key.
2. **Target (hours–days).** ToS/abuse complaints to each VPS provider; legal
   demands to each domain registrar; national-firewall SNI/DNS/IP blocks for the
   whole list at once.
3. **Monitor (continuous).** Keep polling any surviving bridge's directory; new
   bridges appear automatically and are targeted on the same loop — the
   adversary's poller catches a new bridge as fast as any legitimate client.

Two structural aggravators the assessment correctly identifies:

- **Seed identification.** `/healthz` exposes `uplink.connected`; a bridge with no
  uplink reads as the bootstrap seed. (Mitigated *operationally* right now — the
  two prod bridges uplink to each other, so neither is uplink-less — but the field
  is an unnecessary fingerprint and should not be served unauthenticated.)
- **Fingerprinting without the directory (§3.5 of the assessment).** Even with the
  directory locked, the distinctive `/healthz` body and the TLS SNI make bridges
  findable by Shodan-style scanning. This is the key point that bounds how much
  directory access control can buy.

## 3. What our current defence does and does not cover

| Defence (shipped) | Covers | Does **not** cover |
|---|---|---|
| Failover to alternates; new bridges auto-discovered | Ad-hoc blocking of *one* (or a few) bridges; operator churn | Simultaneous fleet-wide enumerate-and-takedown |
| Configured primary never auto-replaced; first-party ranking (v2.42.0) | Directory *poisoning* redirecting an existing user off a good bridge | A **cold** client with no primary, or one whose primary is already blocked |
| Federation: entries served by the topic's K-closest roots | A single entry-bridge hand-filtering a client's whole view | A client whose *only* mesh path is one malicious bridge (it can still drop entries it relays) |
| Signed, self-expiring `wss://`-only entries | Forged/downgraded entries | Enumeration (signing doesn't hide the entry — it authenticates it) |

The gap is real and it is the cold-bootstrap / fleet-takedown case, which is
precisely the censorship scenario the project most wants to win.

## 4. Prior art: the Tor relay-vs-bridge lesson (BridgeDB)

Tor hit this exact wall. Its public relay consensus is enumerable and therefore
blockable, so Tor added **bridges** — *unlisted* relays — and distributes them
through **BridgeDB**: a partitioned, rate-limited, CAPTCHA/PoW-gated, per-requester
service that hands out only a small subset per request so that no single party can
enumerate the whole set. Reputation and trust-on-first-use do the rest.

Axona today publishes the equivalent of the *full relay list* with **no unlisted
tier**. The assessment's recommendations — membership-gated directory reads,
partitioned views, a public-bootstrap address distinct from a private-federation
address — are the BridgeDB design restated for Axona, and they are the right
direction.

## 5. Mitigation options (and their honest ceilings)

Ordered by leverage; none is a silver bullet, and that limitation is the point.

1. **Cost the read (raise enumeration's price).** Gate full-directory subscription
   behind a **costly identity** (Gates-to-Gradients note 1 / E-1 memory-hard PoW):
   an adversary must mint priced identities to enumerate at scale, and re-mint to
   re-enumerate. Turns "free, instant, complete" into "metered and costly." *Ceiling:*
   a funded adversary still pays it; and it does nothing about §3.5 scanning.
2. **Partition the view (BridgeDB-style).** Serve each requester a *subset*
   (deterministic per requesting identity, or proof-gated), so one query never
   yields the whole fleet, and reputation/TOFU steers honest clients to working
   bridges. *Ceiling:* designing partition resistance to a Sybil enumerator (mint
   many identities → reassemble the set) is the hard part — it reduces to note 1's
   cost again.
3. **Split bootstrap from federation addresses.** A bridge advertises a *public
   bootstrap* `wss://` for cold clients and keeps a *private federation* address
   for inter-bridge gossip; only the bootstrap address is in the public portion.
   *Ceiling:* the bootstrap address is still public and blockable — this protects
   the federation topology, not the bootstrap surface.
4. **Minimal unauthenticated `/healthz`.** Return version only to anonymous
   callers; drop/obscure `uplink.connected` and topology; require a bridge-to-bridge
   token for the full body. *Ceiling:* cheap and worth doing, but TLS-SNI scanning
   still finds the endpoint — it removes the *seed* tell, not the endpoint.
5. **Coarse coordinates by default.** Advertise region-level, not precise, lat/lng
   (the ranking penalty is small; the jurisdictional disclosure is meaningful).
   Document the tradeoff so operators choose it knowingly. *Ceiling:* the `wss://`
   domain/IP usually reveals jurisdiction anyway.

**The ceiling above all ceilings.** Because a bridge is a `wss://` endpoint at a
real domain with valid TLS, it is **SNI/DNS-blockable and scan-discoverable
regardless of the directory.** Every option above raises the *cost* and *latency*
of a fleet takedown; none makes the bridge layer truly censorship-resistant. That
requires **pluggable-transport-style obfuscation** (domain fronting, obfs, etc.) —
a substantial, separate body of work Axona has not taken on, and the honest place
where the bridge layer's censorship resistance currently ends.

## 6. The claim to qualify

The Synopsis says *"there is no one address to block — knock a bridge offline and
clients fail over to others."* That is **true against ad-hoc blocking and operator
churn**, and it should stay — it is a real, demonstrated property. But against a
**fleet-enumerating state adversary** it overclaims. Recommended qualification:
"no single *fixed* point of failure; individual bridges are replaceable and
auto-discovered" — and an explicit acknowledgement that simultaneous fleet-wide
enumeration-and-takedown is a real threat the open directory does not, by itself,
defeat. Better to state the boundary than to let "unstoppable" stand unqualified —
the same honesty discipline as "un-censorable and un-governable are one fact."

## 7. Open questions

- **Can a partitioned directory resist a Sybil enumerator without a central
  authority?** Partitioning by requesting identity only helps if identities are
  costly (note 1) and if reassembly across many identities is bounded — an open
  design problem.
- **Where does federation discovery live if the public view is partitioned?**
  Bridges still need to find each other to federate; that gossip must not become a
  back-door full enumeration.
- **Is obfuscated transport in scope at all?** It is the only thing that makes the
  bridge layer truly hard to block, but it is a large effort and partly outside the
  browser's control (SNI is set by the browser's TLS stack). Worth a separate
  decision record before committing.
- **Does qualifying the claim cost more than it's worth rhetorically?** No — an
  overclaim that a capable adversary can falsify is worse for credibility than an
  honest boundary. Qualify it.

---

*This is a design rationale + threat note, not a committed roadmap item; it records
the analysis so the directory's enumeration tradeoff and the claim-qualification
are on the record. Tracked as **G-1** in the [punch list](../red%20team/red-team-punchlist-v2.43.0.md).*
