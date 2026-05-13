import { createRemoteJWKSet, jwtVerify } from "jose";

export interface VerifiedEntraToken {
  oid: string;
  tid: string;
  name: string;
  roles: string[];
  scopes: string[];
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function readTenantId(): string {
  return Deno.env.get("ENTRA_TENANT_ID") ?? "common";
}

function readAudience(): string {
  return Deno.env.get("ENTRA_AUDIENCE") ?? "api://mydenicek";
}

function getJwksForTenant(tenantId: string) {
  const cached = jwksCache.get(tenantId);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    ),
  );
  jwksCache.set(tenantId, jwks);
  return jwks;
}

export async function verifyEntraToken(
  token: string,
): Promise<VerifiedEntraToken> {
  const tenantId = readTenantId();
  const audience = readAudience();
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks = getJwksForTenant(tenantId);
  const { payload } = await jwtVerify(token, jwks, {
    audience,
    issuer: tenantId === "common" ? undefined : issuer,
  });

  const oid = String(payload.oid ?? "");
  const tid = String(payload.tid ?? "");
  if (!oid || !tid) {
    throw new Error("Token missing required oid/tid claims.");
  }

  const roles = Array.isArray(payload.roles)
    ? payload.roles.map((role) => String(role))
    : [];
  const scopes = typeof payload.scp === "string"
    ? payload.scp.split(" ").filter(Boolean)
    : [];

  return {
    oid,
    tid,
    name: String(payload.name ?? payload.preferred_username ?? oid),
    roles,
    scopes,
  };
}
