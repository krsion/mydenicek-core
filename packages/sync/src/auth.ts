export type ConnectionRole = "viewer" | "editor";

export interface ConnectionIdentity {
  oid: string;
  peerId: string;
  role: ConnectionRole;
  docId: string;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }
  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = atob(normalized);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return payload;
  } catch {
    return null;
  }
}

export async function computePeerId(
  oid: string,
  deviceGuid: string,
): Promise<string> {
  const payload = `${oid}:${deviceGuid}`;
  const bytes = new TextEncoder().encode(payload);
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const digest = new Uint8Array(digestBuffer);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function isAuthEnabled(): boolean {
  return Deno.env.get("AUTH_ENABLED") === "true";
}

export async function resolveConnectionIdentity(
  request: Request,
  docId: string,
): Promise<ConnectionIdentity> {
  if (!isAuthEnabled()) {
    const peerId = new URL(request.url).searchParams.get("peerId") ??
      `anon-${crypto.randomUUID()}`;
    return { oid: "anonymous", docId, peerId, role: "editor" };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const claims = parseJwtPayload(bearer);
  if (!claims || typeof claims.oid !== "string") {
    throw new Error("Missing or invalid bearer token.");
  }

  const url = new URL(request.url);
  const deviceGuid = url.searchParams.get("deviceGuid") ?? "";
  if (!deviceGuid) {
    throw new Error("Missing deviceGuid query parameter.");
  }

  return {
    docId,
    oid: claims.oid,
    peerId: await computePeerId(claims.oid, deviceGuid),
    role: "editor",
  };
}
