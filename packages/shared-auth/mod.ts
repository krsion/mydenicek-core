import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_URI =
  "https://login.microsoftonline.com/common/discovery/v2.0/keys";

/** Parsed claims extracted from a verified Entra ID JWT. */
export interface EntraClaims {
  oid: string;
  tid: string;
  name: string;
  roles: string[];
  scopes: string[];
}

// Module-level JWKS cache — created once, reused across requests.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(JWKS_URI));
  }
  return cachedJwks;
}

/**
 * Verifies an Entra ID (Azure AD) bearer token and returns its claims.
 *
 * Reads `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` from the environment to
 * validate issuer and audience.  Throws if the token is missing, expired,
 * has an invalid signature, or fails audience/issuer checks.
 */
export async function verifyEntraToken(token: string): Promise<EntraClaims> {
  const tenantId = Deno.env.get("AZURE_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID");

  if (!tenantId) throw new Error("AZURE_TENANT_ID env var is not set");
  if (!clientId) throw new Error("AZURE_CLIENT_ID env var is not set");

  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;

  const { payload } = await jwtVerify(token, getJwks(), {
    audience: clientId,
    issuer,
  });

  const oid = payload["oid"];
  const tid = payload["tid"];
  const name = payload["name"] ?? payload["preferred_username"] ?? "";

  if (typeof oid !== "string" || !oid) {
    throw new Error("Token missing required claim: oid");
  }
  if (typeof tid !== "string" || !tid) {
    throw new Error("Token missing required claim: tid");
  }

  const roles = extractStringArray(payload["roles"]);

  // `scp` is a space-delimited string; `scope` is an alias some issuers use.
  const scopeRaw = payload["scp"] ?? payload["scope"] ?? "";
  const scopes = typeof scopeRaw === "string" && scopeRaw.length > 0
    ? scopeRaw.split(" ")
    : [];

  return {
    oid,
    tid,
    name: typeof name === "string" ? name : "",
    roles,
    scopes,
  };
}

/** Safely coerces an unknown claim value to a string array. */
function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}
