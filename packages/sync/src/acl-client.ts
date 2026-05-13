import type { AclEntry, PeerId, PeerKey } from "@mydenicek/shared-types";

const ACL_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Simple TTL cache backed by a Map. */
class TtlCache<K, V> {
  private readonly cache = new Map<K, CacheEntry<V>>();

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

const roleCache = new TtlCache<string, AclEntry | null>();
const keyCache = new TtlCache<PeerId, PeerKey | null>();

/** Base URL of the ACL service, read from ACL_SERVICE_URL env. */
function getAclBaseUrl(): string {
  return Deno.env.get("ACL_SERVICE_URL") ?? "http://localhost:3002";
}

/**
 * Fetches the ACL entry for a (docId, oid) pair, with a 60s LRU cache.
 * Returns null if the principal has no access to the document.
 */
export async function fetchAclEntry(
  docId: string,
  oid: string,
  serviceToken: string,
): Promise<AclEntry | null> {
  const cacheKey = `${docId}:${oid}`;
  const cached = roleCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${getAclBaseUrl()}/docs/${encodeURIComponent(docId)}/members/${
    encodeURIComponent(oid)
  }`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${serviceToken}` },
  });
  if (response.status === 404) {
    roleCache.set(cacheKey, null, ACL_CACHE_TTL_MS);
    return null;
  }
  if (!response.ok) {
    throw new Error(`ACL service returned ${response.status} for ${url}`);
  }
  const entry = (await response.json()) as AclEntry;
  roleCache.set(cacheKey, entry, ACL_CACHE_TTL_MS);
  return entry;
}

/**
 * Fetches the active Ed25519 public key for a peerId from the ACL service.
 * Returns null if no active key is registered.
 */
export async function fetchPeerKey(
  peerId: PeerId,
  serviceToken: string,
): Promise<PeerKey | null> {
  const cached = keyCache.get(peerId);
  if (cached !== undefined) return cached;

  const url = `${getAclBaseUrl()}/peers/by-peerid/${
    encodeURIComponent(peerId)
  }/key`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${serviceToken}` },
  });
  if (response.status === 404) {
    keyCache.set(peerId, null, ACL_CACHE_TTL_MS);
    return null;
  }
  if (!response.ok) {
    throw new Error(`ACL service returned ${response.status} for ${url}`);
  }
  const key = (await response.json()) as PeerKey;
  keyCache.set(peerId, key, ACL_CACHE_TTL_MS);
  return key;
}
