import type { SignedEvent, UnsignedEvent } from "@mydenicek/shared-types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, stableValue(nested)] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(serialized: string): Uint8Array {
  const binary = atob(serialized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function pubKeyToBase64(key: Uint8Array): string {
  return bytesToBase64(key);
}

export function base64ToPubKey(serialized: string): Uint8Array {
  return base64ToBytes(serialized);
}

export async function generateKeypair(): Promise<{
  pubKey: Uint8Array;
  privKey: Uint8Array;
}> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const pubKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const privKey = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );
  return { pubKey, privKey };
}

export async function canonicalEventHash(
  event: UnsignedEvent,
): Promise<Uint8Array> {
  const hashable = {
    docId: event.docId,
    author: event.author,
    payload: event.payload,
    predecessors: event.predecessors,
  };
  const bytes = new TextEncoder().encode(stableJson(hashable));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

export async function signEvent(
  event: UnsignedEvent,
  privKey: Uint8Array,
): Promise<SignedEvent> {
  const hashBytes = await canonicalEventHash(event);
  const importedPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(privKey),
    "Ed25519",
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      importedPrivateKey,
      toArrayBuffer(hashBytes),
    ),
  );
  return {
    ...event,
    hash: bytesToBase64(hashBytes),
    signature: bytesToBase64(signature),
  };
}

export async function verifyEvent(
  event: SignedEvent,
  pubKey: Uint8Array,
): Promise<boolean> {
  const expectedHash = await canonicalEventHash(event);
  if (!equalBytes(expectedHash, base64ToBytes(event.hash))) {
    return false;
  }
  const importedPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(pubKey),
    "Ed25519",
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    importedPublicKey,
    toArrayBuffer(base64ToBytes(event.signature)),
    toArrayBuffer(expectedHash),
  );
}
