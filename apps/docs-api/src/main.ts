import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { Doc } from "@mydenicek/shared-types";
import { verifyEntraToken } from "@mydenicek/shared-auth";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const requestCounts = new Map<string, { count: number; resetAt: number }>();

const docs = new Map<string, Doc>();
const tableAccountName = Deno.env.get("TABLE_ACCOUNT_NAME") ?? "";
const tableEndpoint = tableAccountName
  ? `https://${tableAccountName}.table.core.windows.net`
  : "";

const tableClient = tableEndpoint
  ? new TableClient(tableEndpoint, "docs", new DefaultAzureCredential())
  : undefined;

await tableClient?.createTable().catch(() => undefined);

app.addHook("onRequest", async (request, reply) => {
  const key = request.ip;
  const now = Date.now();
  const current = requestCounts.get(key);
  if (!current || current.resetAt < now) {
    requestCounts.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 120) {
    return reply.code(429).send({ message: "Too many requests" });
  }
});

async function requireBearerToken(token: string | undefined) {
  if (!token) throw new Error("Missing bearer token.");
  return verifyEntraToken(token);
}

app.addHook("preHandler", async (request) => {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const claims = await requireBearerToken(token);
  request.headers["x-user-oid"] = claims.oid;
});

app.get("/docs", async (request, reply) => {
  const oid = String(request.headers["x-user-oid"] ?? "");
  const items = [...docs.values()].filter((doc) => doc.ownerOid === oid);
  return reply.send(items);
});

app.post("/docs", async (request, reply) => {
  const input = request.body as Partial<Doc>;
  const now = new Date().toISOString();
  const doc: Doc = {
    id: crypto.randomUUID(),
    title: input.title ?? "Untitled",
    body: input.body ?? "",
    ownerOid: String(request.headers["x-user-oid"] ?? ""),
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? [],
  };
  docs.set(doc.id, doc);
  await tableClient?.upsertEntity({
    partitionKey: doc.ownerOid,
    rowKey: doc.id,
    title: doc.title,
    body: doc.body,
    updatedAt: doc.updatedAt,
  }).catch(() => undefined);
  return reply.code(201).send(doc);
});

app.get("/docs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const doc = docs.get(id);
  if (!doc) return reply.code(404).send({ message: "Not found" });
  return reply.send(doc);
});

app.put("/docs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const existing = docs.get(id);
  if (!existing) return reply.code(404).send({ message: "Not found" });
  const input = request.body as Partial<Doc>;
  const updated: Doc = {
    ...existing,
    title: input.title ?? existing.title,
    body: input.body ?? existing.body,
    tags: input.tags ?? existing.tags,
    updatedAt: new Date().toISOString(),
  };
  docs.set(id, updated);
  await tableClient?.upsertEntity({
    partitionKey: updated.ownerOid,
    rowKey: updated.id,
    title: updated.title,
    body: updated.body,
    updatedAt: updated.updatedAt,
  }).catch(() => undefined);
  return reply.send(updated);
});

app.delete("/docs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const existing = docs.get(id);
  if (!existing) return reply.code(404).send({ message: "Not found" });
  docs.delete(id);
  await tableClient?.deleteEntity(existing.ownerOid, existing.id).catch(() =>
    undefined
  );
  return reply.code(204).send();
});

const port = Number(Deno.env.get("PORT") ?? "8080");
await app.listen({ port, host: "0.0.0.0" });
