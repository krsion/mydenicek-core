import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { TableClient, TableServiceClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { verifyEntraToken, type EntraClaims } from "@mydenicek/shared-auth";
import type { Doc } from "@mydenicek/shared-types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(Deno.env.get("PORT") ?? "3001", 10);
const AUTH_ENABLED = Deno.env.get("AUTH_ENABLED") !== "false";
const STORAGE_ACCOUNT = Deno.env.get("AZURE_STORAGE_ACCOUNT") ?? "";
const TABLE_NAME = "docs";

// ---------------------------------------------------------------------------
// Azure Table Storage
// ---------------------------------------------------------------------------

function buildTableClient(): TableClient {
  const credential = new DefaultAzureCredential();
  const endpoint = `https://${STORAGE_ACCOUNT}.table.core.windows.net`;
  return new TableClient(endpoint, TABLE_NAME, credential);
}

// ---------------------------------------------------------------------------
// Auth helper
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
    return { oid: "anon", tid: "anon", name: "anonymous", roles: [], scopes: [] };
  }
  if (!request.claims) throw new Error("Unauthenticated");
  return request.claims;
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  const table = buildTableClient();

  app.addHook("onRequest", authenticate);

  // GET /healthz
  app.get("/healthz", async () => ({ status: "ok" }));

  // GET /docs — list the authenticated user's docs
  app.get("/docs", async (request) => {
    const { oid } = requireClaims(request);
    const entities = table.listEntities<Doc & { partitionKey: string; rowKey: string }>({
      queryOptions: { filter: `partitionKey eq '${oid}'` },
    });
    const docs: Doc[] = [];
    for await (const entity of entities) {
      docs.push(entityToDoc(entity));
    }
    return docs;
  });

  // POST /docs — create a new doc
  app.post(
    "/docs",
    async (request: FastifyRequest<{ Body: Partial<Doc> }>, reply) => {
      const { oid } = requireClaims(request);
      const body = request.body ?? {};
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const doc: Doc = {
        id,
        title: String(body.title ?? "Untitled"),
        ownerOid: oid,
        createdAt: now,
        updatedAt: now,
      };
      await table.createEntity({
        partitionKey: oid,
        rowKey: id,
        ...doc,
      });
      reply.code(201).send(doc);
    },
  );

  // GET /docs/:id
  app.get(
    "/docs/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { oid } = requireClaims(request);
      const { id } = request.params;
      try {
        const entity = await table.getEntity<Doc>(oid, id);
        return entityToDoc(entity);
      } catch {
        reply.code(404).send({ error: "Not found" });
      }
    },
  );

  // PUT /docs/:id — update title (and updatedAt)
  app.put(
    "/docs/:id",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: Partial<Doc>;
      }>,
      reply,
    ) => {
      const { oid } = requireClaims(request);
      const { id } = request.params;
      const body = request.body ?? {};
      try {
        await table.updateEntity(
          {
            partitionKey: oid,
            rowKey: id,
            title: String(body.title ?? "Untitled"),
            updatedAt: new Date().toISOString(),
          },
          "Merge",
        );
        const updated = await table.getEntity<Doc>(oid, id);
        return entityToDoc(updated);
      } catch {
        reply.code(404).send({ error: "Not found" });
      }
    },
  );

  // DELETE /docs/:id
  app.delete(
    "/docs/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { oid } = requireClaims(request);
      const { id } = request.params;
      try {
        await table.deleteEntity(oid, id);
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

function entityToDoc(
  entity: Record<string, unknown>,
): Doc {
  return {
    id: String(entity.rowKey ?? entity.id ?? ""),
    title: String(entity.title ?? ""),
    ownerOid: String(entity.partitionKey ?? entity.ownerOid ?? ""),
    createdAt: String(entity.createdAt ?? ""),
    updatedAt: String(entity.updatedAt ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = buildServer();
await server.listen({ port: PORT, host: "0.0.0.0" });
