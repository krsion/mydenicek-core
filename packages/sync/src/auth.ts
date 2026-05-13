import { verifyEntraToken } from "@mydenicek/shared-auth";

export interface AuthenticatedPeer {
  peerId: string;
  oid: string;
  tid: string;
  name: string;
  roles: string[];
  scopes: string[];
}

function convertHashToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function derivePeerId(
  oid: string,
  deviceId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${oid}:${deviceId}`),
  );
  return convertHashToHex(digest);
}

function parseBearerToken(authHeader: string | null): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2) return undefined;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}

export async function resolveAuthenticatedPeer(
  request: Request,
  url: URL,
): Promise<AuthenticatedPeer | undefined> {
  const authEnabled = Deno.env.get("AUTH_ENABLED") === "true";
  if (!authEnabled) return undefined;

  const token = url.searchParams.get("access_token") ??
    parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    throw new Error("Missing access token.");
  }

  const claims = await verifyEntraToken(token);
  const deviceId = url.searchParams.get("device_id") ?? "unknown-device";

  return {
    peerId: await derivePeerId(claims.oid, deviceId),
    ...claims,
  };
}
