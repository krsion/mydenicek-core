import * as ed from "@noble/ed25519";
import type {
  EventHash,
  SignedEvent,
  UnsignedEvent,
} from "@mydenicek/shared-types";

// noble/ed25519 v2 requires a SHA-512 implementation in non-browser runtimes.
// Deno exposes crypto.subtle, so we wire it up here.
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  // noble calls this synchronously; we use the sync path via SubtleCrypto.
  // In practice noble also accepts an async shim via sha512Async, but the
  // sign/verify APIs we use are already async, so this path is never hit.
  // Keep it as a safety net.
  throw new Error(
    "Synchronous SHA-512 is not available in Deno — use async APIs only.",
  );
};

ed.etc.sha512Async = async (...msgs: Uint8Array[]): Promise<Uint8Array> => {
  const combined = concatBytes(...msgs);
  const hash = await crypto.subtle.digest("SHA-512", combined);
  return new Uint8Array(hash);
};

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/** Generates a fresh Ed25519 keypair. */
export async function generateKeypair(): Promise<
  { pubKey: Uint8Array; privKey: Uint8Array }
> {
  const privKey = ed.utils.randomPrivateKey();
  const pubKey = await ed.getPublicKey(privKey);
  return { pubKey, privKey };
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

/** Encodes a raw key/hash byte array as a base64 string. */
export function pubKeyToBase64(k: Uint8Array): string {
  return btoa(String.fromCharCode(...k));
}

/** Decodes a base64 string back to a raw byte array. */
export function base64ToPubKey(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------

/**
 * Produces the canonical SHA-256 hash of an unsigned event.
 *
 * The hash covers only the four stable fields: `docId`, `author`, `payload`,
 * and `predecessors`.  The `hash` and `signature` fields are intentionally
 * excluded so the hash can be computed before signing.
 *
 * Keys inside `payload` (if it is an object) are recursively sorted so the
 * hash is stable regardless of key insertion order.
 */
export async function canonicalEventHash(
  event: UnsignedEvent,
): Promise<Uint8Array> {
  const canonical = {
    docId: event.docId,
    author: event.author,
    payload: sortedJson(event.payload),
    predecessors: event.predecessors,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

// ---------------------------------------------------------------------------
// Sign / verify
// ---------------------------------------------------------------------------

/**
 * Signs an event and returns a new `SignedEvent` with `hash` and `signature`
 * fields populated.  The original event object is not mutated.
 */
export async function signEvent(
  event: UnsignedEvent,
  privKey: Uint8Array,
): Promise<SignedEvent> {
  const hashBytes = await canonicalEventHash(event);
  const sigBytes = await ed.sign(hashBytes, privKey);

  return {
    ...event,
    hash: pubKeyToBase64(hashBytes) as EventHash,
    signature: pubKeyToBase64(sigBytes),
  };
}

/**
 * Returns `true` if the event's signature is valid for the given public key
 * AND the stored hash matches the recomputed canonical hash.
 */
export async function verifyEvent(
  event: SignedEvent,
  pubKey: Uint8Array,
): Promise<boolean> {
  try {
    const expectedHashBytes = await canonicalEventHash(event);
    const storedHashBytes = base64ToPubKey(event.hash);

    // Constant-time byte comparison to prevent timing attacks.
    if (!bytesEqual(expectedHashBytes, storedHashBytes)) return false;

    const sigBytes = base64ToPubKey(event.signature);
    return await ed.verify(sigBytes, expectedHashBytes, pubKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively sorts object keys so the JSON serialisation is deterministic
 * regardless of insertion order.  Arrays are preserved as-is (elements are
 * not reordered).
 */
function sortedJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortedJson);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    sorted[key] = sortedJson((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** Concatenates multiple Uint8Arrays into one. */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Constant-time byte-array equality check. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
