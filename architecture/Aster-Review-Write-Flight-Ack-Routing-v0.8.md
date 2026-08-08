ASTER REVIEW — Write-Flight Ack Routing and Chain Budget v0.8 (commit 868021a)

Disposition: CHANGES REQUIRED.

R16 is closed: the three stale claims are corrected, and R14 may retire. R15 also closes the identity-key substitution gap: CAP_ATTEST has no wire-supplied public key, verification is against the base-authenticated key stored for the live channel, nodeId is bound, unknown frames are required to be ignored by old transports, and the lifecycle/tests are substantially complete.

R17 — The CBV portion is still not byte-exact and does not yet enforce channel freshness. The current base-auth CBV is not a fixed-width decoded field: cbvFromNonces returns a structured UTF-8 string such as n:<nonce>:<nonce>:<tag>; the bridge includes a connection id; the mesh concatenates that with fp:<fingerprint>:<fingerprint>. Those representations are transport-specific and can be variable length. CBV_BYTES is not defined in the current tree. Therefore “CBV_BYTES, fixed width, decoded” does not identify bytes two independent implementations can reproduce.

More importantly, v0.8 carries cbv in the wire frame and says the verifier rebuilds the transcript from received fields. If verification uses that wire value, a prior-channel CAP_ATTEST replayed after reconnect remains valid under the same authenticated identity key: its old CBV and signature still match each other. The verifier must bind to its OWN current channel value, exactly as base auth does, not trust freshness material supplied by the frame.

Define one exact conversion, for example:

cbvDigest = SHA-256(UTF8(currentTransportCbvString))

and sign the 32-byte cbvDigest. Both signer and verifier derive it locally from their current live-channel state. Prefer omitting cbv/cbvDigest from CAP_ATTEST entirely; if it remains on wire for diagnostics, reject unless it byte-equals the locally derived digest and always rebuild the signed transcript from the local digest. Specify UTF-8 and SHA-256 literally. Add node-WS, bridge, and mesh golden fixtures proving their structured CBV strings produce the expected digest, plus a reconnect test that replays a valid prior-channel frame unchanged and fails because the verifier derives a different current digest.

Once R17 replaces the undefined decoded CBV with a locally derived fixed digest, R13/R15 may retire; R11/R12 then retire with them. No build clearance yet.
