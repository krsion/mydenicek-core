import { verifyEntraToken } from "@mydenicek/shared-auth";
import type { PeerId } from "@mydenicek/shared-types";

/** Claims attached to an authenticated WebSocket connection. */
export interface AuthClaims {
  oid: string;
  tid: string;
  name: string;
  roles: string[];
  scopes: string[];
  peerId: PeerId;
}

/**
 * Validates an Entra Bearer token from the `Authorization` header and derives
 * the peer's stable identifier.
 *
 * @param authHeader - The raw `Authorization` header value.
 * @param deviceGuid - The device GUID sent by the client (from query string or header).
 * @returns Resolved claims with the derived peerId.
 * @throws If the token is missing, malformed, or invalid.
 */
export async function validateConnection(
  authHeader: string | null,
  deviceGuid: string | null,
): Promise<AuthClaims> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }
  const token = authHeader.slice(7);
  const claims = await verifyEntraToken(token);
  const guid = deviceGuid ?? crypto.randomUUID();
  const peerId = await derivePeerId(claims.oid, guid);
  return { ...claims, peerId };
}

/**
 * Derives a stable PeerId from oid and deviceGuid using SHA-256.
 * PeerId = lowercase hex of SHA-256("${oid}:${deviceGuid}")
 */
async function derivePeerId(oid: string, deviceGuid: string): Promise<PeerId> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${oid}:${deviceGuid}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
