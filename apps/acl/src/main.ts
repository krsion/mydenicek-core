import type { AclEntry } from "@mydenicek/shared-types";
import { verifyEntraToken } from "@mydenicek/shared-auth";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const aclByDoc = new Map<string, Map<string, AclEntry>>();
const requestCounts = new Map<string, { count: number; resetAt: number }>();

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

app.addHook("preHandler", async (request) => {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const claims = await verifyEntraToken(token ?? "");
  request.headers["x-user-oid"] = claims.oid;
});

app.get("/docs/:id/members", async (request, reply) => {
  const { id } = request.params as { id: string };
  const entries = [...(aclByDoc.get(id)?.values() ?? [])];
  return reply.send(entries);
});

app.put("/docs/:id/members/:oid", async (request, reply) => {
  const { id, oid } = request.params as { id: string; oid: string };
  const input = request.body as Partial<AclEntry>;
  const docAcl = aclByDoc.get(id) ?? new Map<string, AclEntry>();
  const entry: AclEntry = {
    docId: id,
    oid,
    role: input.role ?? "viewer",
    grantedBy: String(request.headers["x-user-oid"] ?? ""),
    grantedAt: new Date().toISOString(),
  };
  docAcl.set(oid, entry);
  aclByDoc.set(id, docAcl);
  return reply.send(entry);
});

app.delete("/docs/:id/members/:oid", async (request, reply) => {
  const { id, oid } = request.params as { id: string; oid: string };
  aclByDoc.get(id)?.delete(oid);
  return reply.code(204).send();
});

const port = Number(Deno.env.get("PORT") ?? "8080");
await app.listen({ port, host: "0.0.0.0" });
