# Architecture Comparison Notes

Template tables for options explored during the AZ-104 learning deployment.
Fill in as experiments happen.

## Frontend Hosting Options

| Option | Cost | Pros | Cons | Notes |
|--------|------|------|------|-------|
| Static Web App (free tier) | $0 | CDN, easy CI/CD | Limited auth rules | |
| Azure CDN + Blob static | ~$1/month | Simple | Manual CI/CD | |
| App Service (Linux) | ~$13/month | Full control | Overkill for SPA | |
| Vercel / Netlify | $0 (hobby) | Fastest DX | Not Azure | |

## Sync Backend Options

| Option | Cost | Pros | Cons | Notes |
|--------|------|------|------|-------|
| VMSS Spot B1s | ~$2/month | VMSS AZ-104 practice | Spot eviction risk | **Current** |
| Container Apps | ~$5/month | Serverless scaling | Less AZ-104 coverage | Old approach (infra/azure/) |
| AKS + Deployment | ~$70/month | Production-like | Too expensive | Theory only |
| Azure Functions (WS) | Not supported | n/a | WebSockets not stable | |

## Storage Options

| Option | Cost | Pros | Cons | Notes |
|--------|------|------|------|-------|
| Table Storage | $0.045/GB | Cheap, AZ-104 | No ACID, no joins | **Current** |
| Cosmos DB | ~$25/month (serverless) | Global dist, ACID | Cost | AZ-204 territory |
| Azure SQL | ~$5/month (B1) | Full SQL | Overkill for KV | |
| PostgreSQL Flex | ~$13/month | Open source | Not AZ-104 focus | |
