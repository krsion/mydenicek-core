import type { PeerKey } from "@mydenicek/shared-types";

import type { ConnectionRole } from "./auth.ts";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

class TtlLruCache<T> {
  private entries = new Map<string, CacheEntry<T>>();

  constructor(private capacity: number, private ttlMs: number) {}

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    if (Date.now() > value.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value.value;
  }

  set(key: string, value: T): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

export interface AclClient {
  getRole(docId: string, oid: string): Promise<ConnectionRole | null>;
  getPeerKey(peerId: string): Promise<PeerKey | null>;
}

export interface AclClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createAclClient(options: AclClientOptions = {}): AclClient {
  const baseUrl = options.baseUrl ?? Deno.env.get("ACL_BASE_URL") ??
    "http://127.0.0.1:8081";
  const fetchImpl = options.fetchImpl ?? fetch;
  const roleCache = new TtlLruCache<ConnectionRole | null>(1024, 60_000);
  const keyCache = new TtlLruCache<PeerKey | null>(2048, 60_000);

  async function fetchJson<T>(path: string): Promise<T | null> {
    const response = await fetchImpl(`${baseUrl}${path}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`ACL request failed (${response.status}) for ${path}.`);
    }
    return await response.json() as T;
  }

  return {
    async getRole(docId: string, oid: string): Promise<ConnectionRole | null> {
      const cacheKey = `${docId}:${oid}`;
      const cached = roleCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      const response = await fetchJson<{ role: ConnectionRole }>(
        `/acl/${encodeURIComponent(docId)}/role?oid=${encodeURIComponent(oid)}`,
      );
      const role = response?.role ?? null;
      roleCache.set(cacheKey, role);
      return role;
    },

    async getPeerKey(peerId: string): Promise<PeerKey | null> {
      const cached = keyCache.get(peerId);
      if (cached !== undefined) {
        return cached;
      }
      const peerKey = await fetchJson<PeerKey>(
        `/peers/by-peerid/${encodeURIComponent(peerId)}/key`,
      );
      keyCache.set(peerId, peerKey);
      return peerKey;
    },
  };
}
