// =====================================================================
// minimal-pubsub — two Axona peers in one Node process, pub/sub roundtrip.
//
// What this demonstrates (kernel v3.2.0):
//   * createNodeIdentity → 264-bit Ed25519 CONNECTION identity in an S2 cell
//   * createAuthorIdentity → a location-free AUTHORSHIP key to sign publishes
//   * Two SimTransports on a shared SimNetwork (the kernel's in-process router)
//   * Composing AxonaPeer + AxonaManager from the kernel primitives
//   * Structured topic descriptors { region, name } (open topic) + signWith
//   * peer.pub / peer.sub roundtrip across two distinct peers
//
// Run:  npm install && node index.js
//
// For real-world browser/Node wiring (WebRTC + bridge), see the Quick Start
// (../../Quick-Start-v3.2.0.md) and apps/axona-minimal in axona-protocol —
// this example uses the in-process sim transport to keep the parts visible.
// =====================================================================

import {
  AxonaPeer, AxonaDomain, NeuronNode, AxonaManager, Synapse,
  SimNetwork, simTransport,
  createNodeIdentity, createAuthorIdentity,
  clz264,
} from '@axona/protocol';

// ── 1. Region ────────────────────────────────────────────────────────
// us-east (Virginia). Both peers mint their node identity in this cell.
const US_EAST = { lat: 38.0, lng: -77.0 };

// ── 2. Build a peer ──────────────────────────────────────────────────
// One function, called twice — once for alice, once for bob — wires
// node identity + transport + node + AxonaPeer + AxonaManager together.

async function makePeer({ network, region }) {
  // 2a. Mint a 264-bit Ed25519 CONNECTION identity in this region's S2 cell.
  //     (This is the node/transport key — distinct from an author key.)
  const identity = await createNodeIdentity({ lat: region.lat, lng: region.lng });

  // 2b. Open a SimTransport on the shared SimNetwork.
  const transport = simTransport({ network, identity, heartbeatMs: 0 });
  await transport.start(identity.id);

  // 2c. Build the local DHT node. NeuronNode holds the synaptome and routing
  //     state; AxonaDomain holds parameters shared across peers. NeuronNode
  //     XORs ids as BigInts, so convert identity.id (hex) to BigInt here.
  const node   = new NeuronNode({
    id:  BigInt('0x' + identity.id),
    lat: region.lat, lng: region.lng,
  });
  node.transport = transport;
  const domain = new AxonaDomain({ k: 20 });

  // 2d. AxonaPeer is the per-node DHT contract implementation. In v3 the
  //     CONNECTION key is passed as `nodeIdentity` (there is no `identity`
  //     param, and no default author — publishes name their signer per-call).
  const peer = new AxonaPeer({ domain, node, nodeIdentity: identity, transport });
  await peer.start();

  // 2e. AxonaManager handles pub/sub. It needs a `dht` adapter that forwards
  //     K-closest / sendDirect / routeMessage / handler registration to our
  //     AxonaPeer. sendDirect special-cases self-target for local dispatch.
  const dht = {
    getSelfId:       () => peer.getNodeId(),
    findKClosest:    (...args) => peer.findKClosest(...args),
    routeMessage:    (...args) => peer.routeMessage(...args),
    sendDirect:      async (peerId, type, payload) => {
      if (peerId === peer.getNodeId()) {
        const h = peer._directHandlers?.get(type);
        if (!h) return false;
        try { await h(payload, { fromId: peer.getNodeId(), type }); return true; }
        catch (err) { console.error('self-sendDirect threw:', err); return false; }
      }
      return peer.sendDirect(peerId, type, payload);
    },
    onRoutedMessage: (type, h) => peer.onRoutedMessage(type, h),
    onDirectMessage: (type, h) => peer.onDirectMessage(type, h),
  };
  const axonaManager = new AxonaManager({ dht });
  peer._axonaManager = axonaManager;       // hand the AM to the peer
  return { peer, identity };
}

// ── 3. Wire two peers + connect them ─────────────────────────────────

const network = new SimNetwork();

const { peer: alice, identity: aliceId } = await makePeer({ network, region: US_EAST });
const { peer: bob,   identity: bobId   } = await makePeer({ network, region: US_EAST });

// alice needs an AUTHOR identity to sign her publish with. (A peer can hold
// several; each publish picks one via signWith. There is no default signer.)
const aliceAuthor = await createAuthorIdentity();

// Open a SimNetwork channel between alice and bob, then admit each other to
// their synaptomes. Real transports (WebRTC mesh, WS bridge) do this admission
// via the axona:hello / hello-ack handshake at channel-open time.
await alice._transport.openConnection(bobId.id);

function admitSynapse(localPeer, remoteBigInt) {
  const localId = localPeer._node.id;
  const stratum = clz264(localId ^ remoteBigInt);
  const syn = new Synapse({ peerId: remoteBigInt, latencyMs: 1, stratum });
  syn.weight   = 0.5;
  syn.inertia  = 0;
  syn._addedBy = 'demo';
  localPeer._node.synaptome.set(remoteBigInt, syn);
}
admitSynapse(alice, BigInt('0x' + bobId.id));
admitSynapse(bob,   BigInt('0x' + aliceId.id));

console.log('[alice] nodeId:', aliceId.id);
console.log('[bob]   nodeId:', bobId.id);
console.log('[alice] author:', aliceAuthor.authorId.slice(0, 16) + '…');

await new Promise(r => setTimeout(r, 50));

// ── 4. Pub/sub roundtrip ─────────────────────────────────────────────
// A topic is a structured descriptor. { region, name } with no owner is an
// OPEN topic: anyone may publish (self-signed) and anyone may subscribe.

const TOPIC = { region: 'useast', name: 'hello-world' };

const received = [];
const sub = await bob.sub(TOPIC, (envelope) => {
  received.push(envelope);
  console.log('[bob]   received:', {
    msgId:        envelope.msgId,
    message:      envelope.message,
    signerPubkey: envelope.signerPubkey?.slice(0, 16) + '…',
  });
}, { since: 'all' });

console.log('[bob]   subscribed:', sub.topicId);

// Wait for the subscribe-k frame to reach alice's role.
await new Promise(r => setTimeout(r, 100));

const msgId = await alice.pub(TOPIC, 'hello from alice', { signWith: aliceAuthor });
console.log('[alice] published msgId=' + msgId);

// Let the publish-k → cache → fan-out cycle complete.
await new Promise(r => setTimeout(r, 200));

console.log();
const ok = received.length === 1 && received[0].signerPubkey === aliceAuthor.authorId;
console.log(ok
  ? '✓ roundtrip ok — bob received alice\'s envelope, signed by alice\'s author'
  : `✗ roundtrip failed — expected 1 envelope signed by alice, got ${received.length}`);
process.exit(ok ? 0 : 1);
