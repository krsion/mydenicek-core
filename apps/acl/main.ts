import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { verifyEntraToken, type EntraClaims } from "@mydenicek/shared-auth";
import type { AclEntry, PeerKey } from "@mydenicek/shared-types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(Deno.env.get("PORT") ?? "3002", 10);
const AUTH_ENABLED = Deno.env.get("AUTH_ENABLED") !== "false";
const STORAGE_ACCOUNT = Deno.env.get("AZURE_STORAGE_ACCOUNT") ?? "";

// ---------------------------------------------------------------------------
// Azure Table Storage clients
// ---------------------------------------------------------------------------

function buildTableClient(tableName: string): TableClient {
  const credential = new DefaultAzureCredential();
  const endpoint = `https://${STORAGE_ACCOUNT}.table.core.windows.net`;
  return new TableClient(endpoint, tableName, credential);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    claims?: EntraClaims;
  }
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!AUTH_ENABLED) return;
  const authHeader = request.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing Bearer token" });
    return;
  }
  try {
    request.claims = await verifyEntraToken(authHeader.slice(7));
  } catch (err) {
    reply.code(401).send({ error: "Invalid token", detail: String(err) });
  }
}

function requireClaims(request: FastifyRequest): EntraClaims {
  if (!AUTH_ENABLED) {
    return {
      oid: "anon",
      tid: "anon",
      name: "anonymous",
      roles: [],
      scopes: [],
    };
  }
  if (!request.claims) throw new Error("Unauthenticated");
  return request.claims;
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  const aclTable = buildTableClient("acl");
  const peersTable = buildTableClient("peers");

  app.addHook("onRequest", authenticate);

  // GET /healthz
  app.get("/healthz", async () => ({ status: "ok" }));

  // -------------------------------------------------------------------------
  // Document ACL endpoints
  // -------------------------------------------------------------------------

  // GET /docs/:id/members
  app.get(
    "/docs/:id/members",
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      requireClaims(request);
      const { id: docId } = request.params;
      const entries = aclTable.listEntities<AclEntry & { partitionKey: string; rowKey: string }>({
        queryOptions: { filter: `partitionKey eq '${docId}'` },
      });
      const members: AclEntry[] = [];
      for await (const e of entries) {
        members.push({
          docId,
          principalOid: e.rowKey,
          role: e.role as AclEntry["role"],
        });
      }
      return members;
    },
  );

  // PUT /docs/:id/members/:oid — assign role
  app.put(
    "/docs/:id/members/:oid",
    async (
      request: FastifyRequest<{
        Params: { id: string; oid: string };
        Body: { role: AclEntry["role"] };
      }>,
      reply,
    ) => {
      requireClaims(request);
      const { id: docId, oid: principalOid } = request.params;
      const role = request.body?.role;
      if (!["owner", "editor", "viewer"].includes(role)) {
        return reply
          .code(400)
          .send({ error: "role must be owner | editor | viewer" });
      }
      await aclTable.upsertEntity({
        partitionKey: docId,
        rowKey: principalOid,
        role,
      });
      reply.code(204).send();
    },
  );

  // DELETE /docs/:id/members/:oid — revoke
  app.delete(
    "/docs/:id/members/:oid",
    async (
      request: FastifyRequest<{ Params: { id: string; oid: string } }>,
      reply,
    ) => {
      requireClaims(request);
      const { id: docId, oid: principalOid } = request.params;
      try {
        await aclTable.deleteEntity(docId, principalOid);
        reply.code(204).send();
      } catch {
        reply.code(404).send({ error: "Not found" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Peer key endpoints
  // -------------------------------------------------------------------------

  // POST /peers/:oid/keys — register a new device key
  app.post(
    "/peers/:oid/keys",
    async (
      request: FastifyRequest<{
        Params: { oid: string };
        Body: { deviceGuid: string; pubKey: string };
      }>,
      reply,
    ) => {
      const claims = requireClaims(request);
      const { oid } = request.params;
      // Only the owner may register their own key.
      if (AUTH_ENABLED && claims.oid !== oid) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const { deviceGuid, pubKey } = request.body ?? {};
      if (!deviceGuid || !pubKey) {
        return reply.code(400).send({ error: "deviceGuid and pubKey required" });
      }
      const now = new Date().toISOString();
      await peersTable.upsertEntity({
        partitionKey: oid,
        rowKey: deviceGuid,
        oid,
        deviceGuid,
        pubKey,
        createdAt: now,
      });
      reply.code(201).send({ oid, deviceGuid, pubKey, createdAt: now });
    },
  );

  // GET /peers/:oid/keys — list active (non-revoked) keys
  app.get(
    "/peers/:oid/keys",
    async (request: FastifyRequest<{ Params: { oid: string } }>) => {
      requireClaims(request);
      const { oid } = request.params;
      const entities = peersTable.listEntities<
        PeerKey & { partitionKey: string; rowKey: string }
      >({
        queryOptions: { filter: `partitionKey eq '${oid}'` },
      });
      const keys: PeerKey[] = [];
      for await (const e of entities) {
        if (!e.revokedAt) {
          keys.push(entityToPeerKey(e));
        }
      }
      return keys;
    },
  );

  // GET /peers/by-peerid/:peerId/key — server-to-server lookup; requires 'Service' app role
  app.get(
    "/peers/by-peerid/:peerId/key",
    async (
      request: FastifyRequest<{ Params: { peerId: string } }>,
      reply,
    ) => {
      const claims = requireClaims(request);
      if (AUTH_ENABLED && !claims.roles.includes("Service")) {
        return reply.code(403).send({ error: "Requires Service role" });
      }
      // peerId = sha256hex(oid:deviceGuid) — stored as rowKey index in "peers" table
      const { peerId } = request.params;
      const entities = peersTable.listEntities<
        PeerKey & { partitionKey: string; rowKey: string }
      >({
        queryOptions: { filter: `peerId eq '${peerId}'` },
      });
      for await (const e of entities) {
        if (!e.revokedAt) return entityToPeerKey(e);
      }
      return reply.code(404).send({ error: "Not found" });
    },
  );

  // DELETE /peers/:oid/keys/:deviceGuid — self or Admin
  app.delete(
    "/peers/:oid/keys/:deviceGuid",
    async (
      request: FastifyRequest<{ Params: { oid: string; deviceGuid: string } }>,
      reply,
    ) => {
      const claims = requireClaims(request);
      const { oid, deviceGuid } = request.params;
      const isSelf = !AUTH_ENABLED || claims.oid === oid;
      const isAdmin = claims.roles.includes("Admin");
      if (!isSelf && !isAdmin) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      // Soft-delete: set revokedAt rather than removing the record.
      try {
        await peersTable.updateEntity(
          {
            partitionKey: oid,
            rowKey: deviceGuid,
            revokedAt: new Date().toISOString(),
          },
          "Merge",
        );
        reply.code(204).send();
      } catch {
        reply.code(404).send({ error: "Not found" });
      }
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Entity mapper
// ---------------------------------------------------------------------------

function entityToPeerKey(entity: Record<string, unknown>): PeerKey {
  return {
    oid: String(entity.oid ?? entity.partitionKey ?? ""),
    deviceGuid: String(entity.deviceGuid ?? entity.rowKey ?? ""),
    pubKey: String(entity.pubKey ?? ""),
    createdAt: String(entity.createdAt ?? ""),
    ...(entity.revokedAt ? { revokedAt: String(entity.revokedAt) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = buildServer();
await server.listen({ port: PORT, host: "0.0.0.0" });
