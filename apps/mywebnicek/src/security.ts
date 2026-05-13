import { generateKeypair, signEvent } from "@mydenicek/crypto";
import type { SignedEvent, UnsignedEvent } from "@mydenicek/shared-types";

const DB_NAME = "mydenicek-security";
const STORE_NAME = "keypairs";
const KEY_NAME = "mydenicek.keypair.v1";

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

export interface DeviceKeypair {
  deviceGuid: string;
  privKey: Uint8Array;
  pubKey: Uint8Array;
}

export interface AuthContext {
  oid: string;
  token: string;
}

function computePeerIdFromHash(
  oid: string,
  deviceGuid: string,
): Promise<string> {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${oid}:${deviceGuid}`),
  ).then((digest) =>
    Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredKeypair(): Promise<DeviceKeypair | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(KEY_NAME);
    request.onsuccess = () => {
      const value = request.result as {
        deviceGuid: string;
        privKey: string;
        pubKey: string;
      } | undefined;
      if (!value) {
        resolve(null);
        return;
      }
      resolve({
        deviceGuid: value.deviceGuid,
        privKey: base64ToBytes(value.privKey),
        pubKey: base64ToBytes(value.pubKey),
      });
    };
    request.onerror = () => reject(request.error);
  });
}

async function writeStoredKeypair(keypair: DeviceKeypair): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      deviceGuid: keypair.deviceGuid,
      privKey: bytesToBase64(keypair.privKey),
      pubKey: bytesToBase64(keypair.pubKey),
    }, KEY_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStoredKeypair(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(KEY_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function registerPeerKey(
  aclBaseUrl: string,
  auth: AuthContext,
  keypair: DeviceKeypair,
): Promise<void> {
  await fetch(
    `${aclBaseUrl}/peers/${encodeURIComponent(auth.oid)}/keys`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceGuid: keypair.deviceGuid,
        pubKey: bytesToBase64(keypair.pubKey),
      }),
    },
  );
}

export async function revokePeerKey(
  aclBaseUrl: string,
  auth: AuthContext,
  deviceGuid: string,
): Promise<void> {
  await fetch(
    `${aclBaseUrl}/peers/${encodeURIComponent(auth.oid)}/keys/${
      encodeURIComponent(deviceGuid)
    }`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${auth.token}`,
      },
    },
  );
}

export async function getOrCreateDeviceIdentity(
  auth: AuthContext,
  aclBaseUrl: string,
): Promise<{ keypair: DeviceKeypair; peerId: string }> {
  const stored = await readStoredKeypair();
  if (stored) {
    return {
      keypair: stored,
      peerId: await computePeerIdFromHash(auth.oid, stored.deviceGuid),
    };
  }

  const generated = await generateKeypair();
  const keypair: DeviceKeypair = {
    deviceGuid: crypto.randomUUID(),
    privKey: generated.privKey,
    pubKey: generated.pubKey,
  };
  await writeStoredKeypair(keypair);
  await registerPeerKey(aclBaseUrl, auth, keypair);
  const peerId = await computePeerIdFromHash(auth.oid, keypair.deviceGuid);
  return { keypair, peerId };
}

export async function signOutgoingEvent(
  event: UnsignedEvent,
  keypair: DeviceKeypair,
): Promise<SignedEvent> {
  return await signEvent(event, keypair.privKey);
}
