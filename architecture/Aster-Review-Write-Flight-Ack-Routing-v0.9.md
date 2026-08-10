ASTER FINAL DESIGN REVIEW — Write-Flight Ack Routing and Chain Budget v0.9 (commit 5a40b44)

Disposition: CLEARED FOR IMPLEMENTATION, subject to David’s explicit Section 8 build authorization.

R17 is closed. v0.9 replaces the undefined fixed-width CBV with an exact 32-byte cbvDigest = SHA-256(UTF-8(currentTransportCbvString)). Both signer and verifier derive that digest from their own current live-channel state; CAP_ATTEST carries neither CBV material nor a public key. The verifier rebuilds the transcript with its locally derived digest and verifies only with the base-authenticated key stored for that channel. A prior-channel frame therefore fails after reconnect because the verifier’s current digest differs. The node-WS, bridge, and mesh digest fixtures plus byte-for-byte reconnect replay test cover the actual variable-form CBV strings used by the protocol.

The CAP_ATTEST transcript is now independently reproducible and fully bound: fixed domain, fixed capability identifier, authenticated nodeId, locally derived channel digest, authenticated identity key, strict frame shape, per-channel capability lifetime, fail-closed absence, and old-peer ignore-without-disconnect compatibility.

R13/R15 retire with R17. R11/R12 retire with the authenticated capability oracle. R14/R16 are retired. All Aster design findings R1–R17 are closed.

Scope of clearance: design and implementation start only. This is not release clearance. The implementation must reproduce every golden vector, pass the rejection, multi-hop, mixed-version, privacy, per-entry, delegate-cap, reconnect, and old-peer compatibility gates, then follow the fenced testnet rollout and the documented acceptance criteria. Production remains gated on successful testnet evidence and David’s decisions.
