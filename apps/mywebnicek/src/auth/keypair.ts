// Manages per-device Ed25519 keypair in IndexedDB under key 'mydenicek.keypair.v1'
import { generateKeypair } from "@mydenicek/crypto";

const KEYPAIR_KEY = "mydenicek.keypair.v1";
const DEVICE_GUID_KEY = "mydenicek.deviceGuid.v1";

export interface DeviceIdentity {
  pubKey: Uint8Array;
  privKey: Uint8Array;
  deviceGuid: string;
}

/**
 * Loads the device keypair from localStorage, or generates and stores a new one.
 * Uses localStorage as a simple persistent store (IndexedDB would be more robust
 * but adds complexity for an MVP; TODO: migrate to IndexedDB).
 */
export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const storedPubKey = localStorage.getItem(`${KEYPAIR_KEY}.pub`);
  const storedPrivKey = localStorage.getItem(`${KEYPAIR_KEY}.priv`);
  const storedGuid = localStorage.getItem(DEVICE_GUID_KEY);

  if (storedPubKey && storedPrivKey && storedGuid) {
    return {
      pubKey: base64ToBytes(storedPubKey),
      privKey: base64ToBytes(storedPrivKey),
      deviceGuid: storedGuid,
    };
  }

  const { pubKey, privKey } = await generateKeypair();
  const deviceGuid = crypto.randomUUID();

  localStorage.setItem(`${KEYPAIR_KEY}.pub`, bytesToBase64(pubKey));
  localStorage.setItem(`${KEYPAIR_KEY}.priv`, bytesToBase64(privKey));
  localStorage.setItem(DEVICE_GUID_KEY, deviceGuid);

  return { pubKey, privKey, deviceGuid };
}

/** Removes the device keypair from localStorage. */
export function clearDeviceIdentity(): void {
  localStorage.removeItem(`${KEYPAIR_KEY}.pub`);
  localStorage.removeItem(`${KEYPAIR_KEY}.priv`);
  localStorage.removeItem(DEVICE_GUID_KEY);
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
