import type { PeerKey } from "@mydenicek/shared-types";

interface JwtClaims {
  oid?: string;
  roles?: string[];
}

interface AclRecord {
  docId: string;
  oid: string;
  role: "viewer" | "editor";
}

const peerKeys = new Map<string, PeerKey>();
const acl = new Map<string, AclRecord>();

function decodeClaims(request: Request): JwtClaims {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
    return {
      oid: typeof payload.oid === "string" ? payload.oid : undefined,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter((role): role is string =>
          typeof role === "string"
        )
        : [],
    };
  } catch {
    return {};
  }
}

function computePeerId(oid: string, deviceGuid: string): Promise<string> {
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

function sendJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(
  { port: Number(Deno.env.get("PORT") ?? "8081") },
  async (request) => {
    const url = new URL(request.url);
    const claims = decodeClaims(request);

    if (request.method === "GET" && url.pathname.startsWith("/acl/")) {
      const [, , encodedDocId, action] = url.pathname.split("/");
      if (action !== "role") return new Response("Not found", { status: 404 });
      const docId = decodeURIComponent(encodedDocId);
      const oid = url.searchParams.get("oid") ?? "";
      const match = acl.get(`${docId}:${oid}`);
      return match
        ? sendJson(200, { role: match.role })
        : new Response("Not found", { status: 404 });
    }

    if (
      request.method === "POST" && /^\/peers\/[^/]+\/keys$/.test(url.pathname)
    ) {
      const oid = decodeURIComponent(url.pathname.split("/")[2]);
      if (claims.oid !== oid) return new Response("Forbidden", { status: 403 });
      const body = await request.json() as {
        deviceGuid?: string;
        pubKey?: string;
      };
      if (!body.deviceGuid || !body.pubKey) {
        return new Response(
          "Bad request",
          { status: 400 },
        );
      }
      const key: PeerKey = {
        oid,
        deviceGuid: body.deviceGuid,
        pubKey: body.pubKey,
        createdAt: new Date().toISOString(),
      };
      peerKeys.set(`${oid}:${body.deviceGuid}`, key);
      return sendJson(201, key);
    }

    if (
      request.method === "GET" && /^\/peers\/[^/]+\/keys$/.test(url.pathname)
    ) {
      const oid = decodeURIComponent(url.pathname.split("/")[2]);
      if (claims.oid !== oid) return new Response("Forbidden", { status: 403 });
      const keys = Array.from(peerKeys.values()).filter((key) =>
        key.oid === oid && !key.revokedAt
      );
      return sendJson(200, keys);
    }

    if (
      request.method === "GET" &&
      /^\/peers\/by-peerid\/[^/]+\/key$/.test(url.pathname)
    ) {
      const peerId = decodeURIComponent(url.pathname.split("/")[3]);
      if (!claims.roles?.includes("Service")) {
        return new Response("Forbidden", { status: 403 });
      }
      for (const key of peerKeys.values()) {
        if (key.revokedAt) continue;
        const expectedPeerId = await computePeerId(key.oid, key.deviceGuid);
        if (expectedPeerId === peerId) {
          return sendJson(200, key);
        }
      }
      return new Response("Not found", { status: 404 });
    }

    if (
      request.method === "DELETE" &&
      /^\/peers\/[^/]+\/keys\/[^/]+$/.test(url.pathname)
    ) {
      const [, , oidEncoded, , deviceGuidEncoded] = url.pathname.split("/");
      const oid = decodeURIComponent(oidEncoded);
      const deviceGuid = decodeURIComponent(deviceGuidEncoded);
      const key = peerKeys.get(`${oid}:${deviceGuid}`);
      if (!key) return new Response("Not found", { status: 404 });
      const isAdmin = claims.roles?.includes("Admin") ?? false;
      if (claims.oid !== oid && !isAdmin) {
        return new Response("Forbidden", {
          status: 403,
        });
      }
      peerKeys.set(`${oid}:${deviceGuid}`, {
        ...key,
        revokedAt: new Date().toISOString(),
      });
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  },
);
