import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { verifyEntraToken } from "@mydenicek/shared-auth";
import Fastify from "fastify";

const app = Fastify({ logger: true });

const accountName = Deno.env.get("BLOB_ACCOUNT_NAME") ?? "";
const endpoint = accountName
  ? `https://${accountName}.blob.core.windows.net`
  : "";
const credential = new DefaultAzureCredential();
const blobService = endpoint
  ? new BlobServiceClient(endpoint, credential)
  : undefined;

app.post("/attachments", async (request, reply) => {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = await verifyEntraToken(token);
  if (!blobService || !accountName) {
    return reply.code(503).send({ message: "Blob storage not configured." });
  }

  const container = blobService.getContainerClient("attachments");
  await container.createIfNotExists();

  const blobName = `${claims.oid}/${crypto.randomUUID()}`;
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + 15 * 60 * 1000);
  const userDelegationKey = await blobService.getUserDelegationKey(
    startsOn,
    expiresOn,
  );

  const sas = generateBlobSASQueryParameters(
    {
      containerName: container.containerName,
      blobName,
      permissions: BlobSASPermissions.parse("cw"),
      startsOn,
      expiresOn,
      protocol: "Https",
    },
    userDelegationKey,
    accountName,
  ).toString();

  const url = `${container.getBlockBlobClient(blobName).url}?${sas}`;
  return reply.code(201).send({
    uploadUrl: url,
    blobName,
    expiresOn: expiresOn.toISOString(),
  });
});

const port = Number(Deno.env.get("PORT") ?? "8080");
await app.listen({ port, host: "0.0.0.0" });
