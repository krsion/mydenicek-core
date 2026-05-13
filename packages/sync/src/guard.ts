import { base64ToPubKey, verifyEvent } from "@mydenicek/crypto";
import { fetchPeerKey } from "./acl-client.ts";
import type { SignedEvent } from "@mydenicek/shared-types";

/** State attached to each WebSocket connection when AUTH_ENABLED. */
export interface ConnState {
  docId: string;
  role: "owner" | "editor" | "viewer";
  peerId: string;
  oid: string;
}

/** Per-peer token bucket for rate limiting. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRatePerMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRatePerMs,
    );
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// 50/sec rate limit per peer (capacity=50, refill=50/1000ms)
const rateBuckets = new Map<string, TokenBucket>();

function getBucket(peerId: string): TokenBucket {
  let bucket = rateBuckets.get(peerId);
  if (!bucket) {
    bucket = new TokenBucket(50, 50 / 1000);
    rateBuckets.set(peerId, bucket);
  }
  return bucket;
}

/**
 * Validates an inbound signed event against the connection state.
 *
 * Pipeline:
 *   1. event.docId === conn.docId
 *   2. Overwrite event.author = conn.peerId
 *   3. conn.role !== 'viewer' for writes
 *   4. Look up pubkey, verifyEvent signature
 *   5. Reject if pubkey is revoked
 *   6. Token-bucket rate limit: 50/sec per peer
 *
 * @returns null if valid, or an error reason string to reject with.
 */
export async function validateInboundEvent(
  event: SignedEvent,
  conn: ConnState,
  serviceToken: string,
): Promise<string | null> {
  // 1. Document scope check
  if (event.docId !== conn.docId) {
    return `event docId '${event.docId}' does not match connection docId '${conn.docId}'`;
  }

  // 2. Overwrite author with authenticated peerId (prevents spoofing)
  event.author = conn.peerId;

  // 3. Role check for writes
  if (conn.role === "viewer") {
    return "viewer role cannot send write events";
  }

  // 4. Signature verification
  const peerKey = await fetchPeerKey(conn.peerId, serviceToken);
  if (!peerKey) {
    return `no registered public key for peer '${conn.peerId}'`;
  }

  const pubKey = base64ToPubKey(peerKey.pubKey);
  const valid = await verifyEvent(event, pubKey);
  if (!valid) {
    return "Ed25519 signature verification failed";
  }

  // 5. Revocation check
  if (peerKey.revokedAt) {
    const revokedAt = new Date(peerKey.revokedAt).getTime();
    const eventTimestamp = Date.now(); // Conservative: use current time
    if (revokedAt < eventTimestamp) {
      return `key for peer '${conn.peerId}' was revoked at ${peerKey.revokedAt}`;
    }
  }

  // 6. Rate limit
  if (!getBucket(conn.peerId).consume()) {
    return `rate limit exceeded for peer '${conn.peerId}'`;
  }

  return null;
}
