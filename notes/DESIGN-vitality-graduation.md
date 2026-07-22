# Design note — vitality-based bridge graduation (#374, graduation-model half)

**Status:** IMPLEMENTED, staged (kernel 4.38.0 + bridge 2.92.0), gated on
`BRIDGE_NURSERY` + user go for testnet deploy. Stacks on kernel 4.37.0 (the
graduation-survivability fix — a bridge `peer-left` no longer tears down a live
mesh channel). This note specs the *selection* half: how the bridge chooses
*which* node to graduate, upgrading the proxy it uses today to a real,
measured vitality signal.

**As-built vs. spec:** the selection is a pure module `src/graduation_select.js`
(`selectGraduate`), unit-tested by `scripts/smoke-graduation-select.js` (15/15).
The `GRADUATION_MIN_KERNEL` floor stays 4.35 (honours 4200); the vitality path
is gated on the *presence of a fresh meshBound report*, not a version string, so
4.35–4.37 clients transparently use the uptime fallback. The end-to-end
selection+survival integration test on the real bridge (§7) is deferred — the
pure unit test covers selection deterministically and `graduation_probe.mjs`
already proves survival; driving real-bridge graduation is left as a follow-up
because node-datachannel localhost convergence is timing-flaky.

---

## 1. What graduation is for, and the two axes it must satisfy

The bridge is a bootstrap + signaling node, deliberately capacity-bounded
(`MAX_PEERS`, default 32). When newcomers push it over cap it **graduates** an
established, meshed peer off (WS close 4200): that peer keeps its WebRTC mesh
and frees the scarce bridge slot for whoever still needs bootstrap. Two
properties must hold across every graduation decision:

1. **Keyspace balance** — the set of peers the bridge *keeps* must span the full
   address space, so any newcomer can be introduced to a same-region + diverse
   anchor set (`anchor_select.js`). Losing coverage of a region blinds new
   arrivals to part of the keyspace.
2. **Vitality safety** — never graduate a peer that isn't robustly meshed. A
   poorly-meshed graduate strands itself and re-dials, producing exactly the
   `open→graduate→peers=0→open` churn #374 is about. Release the node the mesh
   can *most afford to lose*, on evidence.

## 2. What we do today, and the gap

Current selection (`server.js:maybeGraduate`, 453):

- **Trigger:** admitted > `MAX_PEERS + SLACK`, ≤1 graduation / 3s (anti-storm).
- **Primary axis (balance):** graduate from the **most over-represented nodeId
  keyspace region first**; **never a region's last representative** (`:487`).
- **Vitality:** *approximated* by two proxies — `uptime ≥ 30s` ("has had time to
  mesh") and `has a bound nodeId`. Within a region, oldest-first.
- **Client backstop:** if a graduate wasn't truly meshed, the kernel
  `boundPeers` floor (`graduationMeshFloor`=3) re-dials.

The gap: **the bridge never measures the client's real mesh.** `uptime ≥ 30s`
is a guess. A node can be 30s old and have 1 mesh peer (barely meshed) or 20
(highly redundant); the bridge treats them identically and may graduate the
fragile one. The client backstop turns that mistake into churn instead of a
silent stranding — better, but still churn. We want the bridge to decide on the
measured value, so the mistake never happens.

## 3. The vitality signal (kernel → bridge)

Reuse the existing bridge ping. The client already sends
`{type:'ping', t}` every `pingIntervalMs` (`web/index.js:846`). Add one field:

```js
// web/index.js — startBridgePingLoop()
socket.send(JSON.stringify({
  type: 'ping',
  t: Date.now(),
  meshBound: (() => { try { return webrtc.boundPeers().length; } catch { return 0; } })(),
}));
```

`meshBound` is the count of **authenticated, currently-bound** mesh peers —
the same quantity the graduation floor already trusts on the client, and the
transport-layer expression of the peer's vitality (a bound channel is a live,
recently-active synapse). One non-negative integer; no new message, no wire
version change (additive field on an existing frame).

Bridge records it on the connection (`server.js`, ping handler at 1055):

```js
case 'ping': {
  conn.pings++;
  if (Number.isInteger(msg.meshBound) && msg.meshBound >= 0) {
    conn.meshBound   = msg.meshBound;
    conn.meshBoundAt = Date.now();      // freshness stamp
  }
  // …existing pong…
}
```

Add `meshBound` / `meshBoundAt` to the conn record type (`server.js:239`),
default `meshBound: null`.

## 4. The selection rule (bridge)

`meshBound` replaces the two proxies — it becomes both an **eligibility gate**
and the **within-region ordering key** — while keyspace balance stays the
primary axis and the never-orphan-a-region invariant is untouched.

**Constants** (all env-overridable, nursery kill-switch still governs all):

| name | default | meaning |
|---|---|---|
| `GRADUATION_SAFE_FLOOR` | `4` | min reported `meshBound` to be graduation-eligible (one above the client floor of 3, so a graduate keeps ≥3 after any single concurrent loss) |
| `GRADUATION_VITALITY_TTL_MS` | `2 × pingInterval` (~`20000`) | a `meshBound` older than this is stale → treat as unknown |
| `GRADUATION_MIN_KERNEL` | `4.38.0` | kernel that ships the `meshBound` ping field |

**Eligibility** — a peer may be graduated iff **all**:
- kernel ≥ `GRADUATION_MIN_KERNEL` (sends `meshBound`) **and** its `meshBound`
  is fresh (`now − meshBoundAt < TTL`) **and** `meshBound ≥ SAFE_FLOOR`;
- not in graduation cooldown (`:473`);
- has a bound nodeId (`connRegion != null`).

**Ordering** — among eligible peers:
1. most over-represented region first (**unchanged, primary**);
2. within a region, **highest `meshBound` first** — release the *most
   redundant* node, the one whose departure the mesh best absorbs (this replaces
   oldest-first);
3. tiebreak: oldest `since` (longest to re-bootstrap if wrong).

**Invariant** — never a region's last representative (`regionCount ≤ 1 → skip`,
unchanged). Rate-limit + hysteresis + cooldown all unchanged.

**Net rule, one line:**
> *Graduate the best-meshed peer (highest fresh `meshBound`, above the safe
> floor) in the most over-represented region — never a region's last node.*

## 5. Backward compatibility (mixed fleet)

Peers below `GRADUATION_MIN_KERNEL`, or with no fresh `meshBound` yet, report
nothing. For them the bridge **falls back to the current uptime proxy**
(`uptime ≥ 30s`), so a mixed 4.35–4.38 fleet degrades gracefully: measured
vitality where available, uptime guess otherwise. When the fleet is uniformly
≥4.38, every decision is measured. No flag day; `BRIDGE_NURSERY=off` still
disables graduation entirely.

## 6. Trust boundary (self-reported value)

`meshBound` is self-reported, so consider both lies:

- **False-high** ("I'm well-meshed" when not): only gets the *liar itself*
  graduated → it strands and re-dials. Harms no one else; the client floor
  already catches it. Acceptable.
- **False-low** ("I'm not meshed" to keep its slot): a mild capacity-DoS — one
  peer refusing to graduate. Bounded to a single slot per liar. Two backstops:
  (a) a hard uptime ceiling that graduates any peer after `MAX_NURSERY_MS`
  regardless of reported vitality *if* it's kept a region above 1; (b) optional
  cross-check against `conn.signalsRelayed` (the bridge's own count of SDP/ICE
  it relayed for this peer — demonstrated mesh-building it can't fake). (a) is
  in scope for v1; (b) is a noted hardening, not required.

The bridge is not a trust anchor, and the honest-majority case is the design
target — consistent with the rest of the protocol.

## 7. Changes, versions, tests

**Kernel (4.38.0):** add `meshBound` to the ping frame (`web/index.js`).
One-line. Unit: assert the ping payload carries `boundPeers().length`.

**Bridge:** record `meshBound`/`meshBoundAt` on ping; rewrite `maybeGraduate`
eligibility + ordering per §4; keep uptime fallback. Version bump.

**Tests:**
- Bridge unit for `maybeGraduate`: construct N synthetic conns with mixed
  regions + `meshBound` values; assert (i) picks highest-meshBound in the
  most-crowded region, (ii) skips a region's last rep, (iii) skips
  sub-floor/stale-vitality peers, (iv) falls back to uptime for a null-meshBound
  conn.
- Extend `test/integration/graduation_probe.mjs`: run the **real** bridge with a
  low `MAX_PEERS`, bring up N peers, let them mesh, and assert the bridge
  graduates the highest-`meshBound` peer and that peer's mesh **survives** (ties
  §4 selection to the 4.37 survivability fix in one end-to-end run).

**Rollout:** kernel 4.38.0 to testnet fleet first (so peers emit `meshBound`),
then flip the bridge to the vitality path, then re-enable `BRIDGE_NURSERY` on
testnet and soak. Prod only after a clean testnet soak and a uniformly-≥4.38
fleet, folded into the #373 promotion.

## 8. Why this is the right shape

It unifies the two axes into one measured rule instead of a guess plus a
backstop: keyspace balance decides *which region* to thin, measured vitality
decides *which node* in it — always the one the mesh can best spare. It reuses
the existing heartbeat (no new wire, no version break), it self-corrects for
old clients, and it is honest about the self-report trust boundary. The bridge
stops guessing at mesh health and starts releasing on evidence — the
neuromorphic "prune the least-load-bearing synapse" instinct, applied to the
bridge's own attachment budget.
