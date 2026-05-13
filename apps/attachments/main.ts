import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
  UserDelegationKey,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { verifyEntraToken, type EntraClaims } from "@mydenicek/shared-auth";
import type { Attachment } from "@mydenicek/shared-types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(Deno.env.get("PORT") ?? "3003", 10);
const AUTH_ENABLED = Deno.env.get("AUTH_ENABLED") !== "false";
const STORAGE_ACCOUNT = Deno.env.get("AZURE_STORAGE_ACCOUNT") ?? "";
const CONTAINER_NAME = Deno.env.get("ATTACHMENTS_CONTAINER") ?? "attachments";
/** SAS validity in seconds (default 15 minutes). */
const SAS_TTL_SECONDS = parseInt(
  Deno.env.get("SAS_TTL_SECONDS") ?? "900",
  10,
);

// ---------------------------------------------------------------------------
// Azure Blob Storage
// ---------------------------------------------------------------------------

function buildBlobServiceClient(): BlobServiceClient {
  const credential = new DefaultAzureCredential();
  const accountUrl = `https://${STORAGE_ACCOUNT}.blob.core.windows.net`;
  return new BlobServiceClient(accountUrl, credential);
}

/**
 * Creates a user-delegation SAS URL for writing a blob.
 *
 * Uses `DefaultAzureCredential` so no storage account key is needed — the
 * managed identity / service principal must have the
 * `Storage Blob Delegator` and `Storage Blob Data Contributor` roles on the
 * storage account.
 */
async function createUploadSasUrl(
  blobName: string,
  contentType: string,
): Promise<string> {
  const blobServiceClient = buildBlobServiceClient();

  const now = new Date();
  const expiresOn = new Date(now.getTime() + SAS_TTL_SECONDS * 1000);

  // Fetch a user delegation key valid for the SAS window.
  const userDelegationKey: UserDelegationKey = await blobServiceClient
    .getUserDelegationKey(now, expiresOn);

  const sasParams = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName,
      permissions: BlobSASPermissions.parse("cw"), // create + write
      startsOn: now,
      expiresOn,
      contentType,
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    STORAGE_ACCOUNT,
  );

  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  const blobClient = containerClient.getBlobClient(blobName);
  return `${blobClient.url}?${sasParams.toString()}`;
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

  app.addHook("onRequest", authenticate);

  // GET /healthz
  app.get("/healthz", async () => ({ status: "ok" }));

  // POST /attachments — returns a pre-signed upload URL
  app.post(
    "/attachments",
    async (
      request: FastifyRequest<{
        Body: {
          docId: string;
          fileName: string;
          contentType: string;
          sizeBytes?: number;
        };
      }>,
      reply,
    ) => {
      requireClaims(request);
      const body = request.body ?? {};
      const { docId, fileName, contentType, sizeBytes } = body;

      if (!docId || !fileName || !contentType) {
        return reply.code(400).send({
          error: "docId, fileName, and contentType are required",
        });
      }

      const id = crypto.randomUUID();
      // Blob path: <docId>/<attachmentId>/<fileName>
      const blobName = `${docId}/${id}/${fileName}`;

      const sasUrl = await createUploadSasUrl(blobName, contentType);

      const attachment: Attachment & { uploadUrl: string } = {
        id,
        docId,
        blobUrl: `https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER_NAME}/${blobName}`,
        contentType,
        sizeBytes: sizeBytes ?? 0,
        uploadUrl: sasUrl,
      };

      reply.code(201).send(attachment);
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = buildServer();
await server.listen({ port: PORT, host: "0.0.0.0" });
