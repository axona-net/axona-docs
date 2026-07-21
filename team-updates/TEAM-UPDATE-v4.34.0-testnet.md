# Team Update — Kernel v4.32.0 → v4.34.0 on testnet (2026-07-21)

**TL;DR: three root causes found and fixed in one day — a graceful-departure
ordering bug that destroyed handed-off history, recovery probes that spent
their budget on unreachable nodes, and a TURN credential bug that made every
NAT'd machine an island. All three are live on testnet. We do NOT yet have a
clean acceptance number: every measurement taken today was confounded by our
own test infrastructure, and that story is worth reading too.**

---

## What shipped

### v4.32.0 — departure preserves history before announcing itself

`leave()` broadcast `peer-leaving` to every neighbor *before* running the
graceful handoff. Receivers react to that signal by hard-closing the leaver's
channel (a proactive re-anchor path built for bridge restarts), so by handoff
time the leaver had no routes: every HANDOFF terminated at the *sender* and was
silently discarded by a target-mismatch guard.

Captured live: **173 of 173 leave handoffs boomeranged back to the leaver, zero
acks.** Every topic whose only copy rode a handoff died with the departing node
— deterministic by topology, immune to wait times and re-subscribes, and
independent of the publisher's region. That last property is what made it so
hard to see: it survived every experiment designed to rule out self-rooting.

Fix: reorder to **drain → handoff (acks return) → notify → stop**. Data first,
funeral announcement second. Also in the release: heirs and replica cohorts are
chosen in-region first (an out-of-region copy is durable but unfindable by
routed reads), singleton roots hand off first, and a departing backup pushes a
replica rather than minting a competing root.

### v4.33.0 — reads recover past dead neighbors

After 4.32, residual read failures all mapped to *dead nodes'* keyspace slices
and never healed. A new sim smoke proved the recovery chain itself was sound —
an ungracefully-killed root's history recovers fully from cohort backups — so
the fault was in *where probes went*: they burned their whole budget re-querying
unreachable or silent candidates. Probes now prefer reachable candidates and
rotate past non-responders.

Second piece (Howard's proposal): the bridge includes a closed connection's
authenticated identity in its departure broadcast, so peers purge a dead node's
stale routing memories in seconds rather than hours. It grants **no removal
power** — a peer that can still reach the subject ignores the hint outright,
ordinary peers still cannot announce anyone's departure but their own, and
nothing is severed. Marked temporary: once nodes graduate off their bridge
socket the hint becomes inaccurate, and the reachability guard is what makes
that harmless.

### v4.34.0 — relayed connections work outside the browser

Browsers hand `{urls, username, credential}` to their native WebRTC stack
intact. Node's compatibility layer instead flattens them into
`turn:USER:CRED@host:port`, and the ICE library re-parses that by splitting on
colons. Our bridge mints TURN REST usernames as `<expiry>:<token>` — a colon
**by design** — so the username truncated to the timestamp, the HMAC could never
match, the relay server returned 401, and **no relayed path was ever offered.**

Three-way experiment against the live relay server: native struct ✓ ·
raw-colon ✗ · percent-encoded ✓. Fix: encode under Node only (browsers must keep
sending raw fields, or *their* HMAC breaks instead).

Second fault found in the same investigation: the **testnet bridge had no TURN
secret configured at all** — it was advertising no relay service whatsoever. The
client fix alone would not have helped testnet. Now wired.

---

## What this cost us, and what we learned about our own testing

Most of today's confusion was not the protocol. It was us. Recording it because
the lesson generalizes:

1. **The observer effect was real.** The instrumented hosts I stood up to
   capture kernel events wrote every event synchronously to disk; under load
   they starved their own event loops and degraded into exactly the
   accept-but-don't-serve state we were hunting. My diagnostic probes became the
   disease.
2. **NAT'd laptops fragment a region.** With TURN broken, relays behind two
   different home routers could not reach each other, so each machine's relays
   captured keyspace slices only that machine could read. Both participants
   measured real, deterministic, *mutually invisible* failures. This is why the
   region infrastructure now runs on a public IP.
3. **Test processes outlived their tests.** Three harness nodes from earlier runs
   were still connected and holding roles **seven hours** later, quietly seeding
   the region with stale holders.
4. **Restarting the fleet all at once shreds history.** Simultaneous shutdown
   makes every departing node's handoff heir another departing node. Fleet
   restarts are now rolling, one at a time, waiting out each graceful leave.
5. **"Pushed" is not "deployed."** The web checkouts served a stale kernel for
   part of the evening because the release ritual has five deploy targets and
   only three were completed. Verify the live surface, not the commit.

Every acceptance number produced today (13%, 21/558, 7/558, 38/558, 22/558) is
confounded by at least one of the above. **We are not reporting an acceptance
result, because we do not have an honest one yet.**

---

## Deployed

| Component | Version | Verified |
|---|---|---|
| Kernel `@axona/protocol` | **4.34.0** | tagged, branch + all consumers |
| Bridge | 2.88.0 | `/healthz` reports kernel 4.34.0 |
| Peer app (testnet.axona.net) | 4.4.0 | served JS reports 4.34.0 |
| Demo (demo-testnet.axona.net) | — | on-disk kernel 4.34.0 |
| Relay (droplet, region grizzly) | 0.65.0 | kernel 4.34.0, single process |
| TURN (coturn) | — | active, credentials minting, UDP relay verified |

Region 0x80's substrate is now a single public-IP relay rather than a fleet of
NAT'd laptop processes. **Production remains on 4.29.0** — five releases behind
— pending an acceptance result and a promotion decision.

---

## Actions

- **Howard:** one rerun of the alert-bot experiment, run alone, on the current
  testnet. The region is clean for the first time today: no zombie nodes, no
  stale-kernel relays, no laptop islands, and your machine and ours can finally
  reach each other. That run is the acceptance gate.
- **Everyone:** `git pull` gets you 4.34.0. Browser users should reload.
- **Next engineering item:** let cohort replicas *serve* replay when a root
  doesn't answer — the last piece of "reads survive unhealthy neighbors," and
  the gate for promoting this stack to production.

## Known open

- **Relaying over TCP** (for networks that block UDP entirely) still yields no
  candidate. Reproduced with the native API too, so it is not our compatibility
  layer and not the server config — suspect the ICE backend is UDP-only for
  relays. Needs verification before any fix. Ordinary home NAT is unaffected.
- The testnet droplet is small (458 MB) and now hosts bridge + coturn + relay.
  A dedicated relay host is a purchasing decision, not an engineering one.
