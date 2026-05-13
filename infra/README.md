# Infra (AZ-104 scaffolding)

This folder contains additive Bicep scaffolding for AZ-104 learning.

## Deploy order

1. `infra/shared/main.bicep`
2. `infra/network/main.bicep`
3. `infra/services/*/main.bicep`
4. `infra/monitor/main.bicep`

## OIDC setup (GitHub Actions)

Replace placeholders (`<SUBSCRIPTION_ID>`, `<TENANT_ID>`, `<ORG>`, `<REPO>`) and run:

```bash
APP_NAME=mydenicek-gha
az ad app create --display-name "$APP_NAME"
APP_ID=$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)
az ad sp create --id "$APP_ID"

az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope /subscriptions/<SUBSCRIPTION_ID>

az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<ORG>/<REPO>:ref:refs/heads/infra/az-104",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-pr",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<ORG>/<REPO>:pull_request",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Set repository secrets/variables:
- `AZURE_CLIENT_ID` (app id)
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `ACR_NAME` (for example `mydenicekacr1234`)
- `ACR_LOGIN_SERVER` (for example `mydenicekacr1234.azurecr.io`)

> The `subject` example above is pinned to branch `infra/az-104` as requested for this sprint. If workflows are executed from a different branch, create another federated credential with the matching `subject`.

## Scheduled teardown/spinup

- Teardown: 22:00 CEST (`0 20 * * *` UTC)
- Spinup: 07:00 CEST (`0 5 * * *` UTC)

GitHub Actions cron is UTC. During winter time (CET), adjust to `0 21 * * *` teardown and `0 6 * * *` spinup.

## Cost expectation

| Mode | Estimated monthly cost |
|---|---:|
| Scheduled (night teardown) | ~$20 |
| 24/7 always-on | ~$60 |

## Cost guardrails

- VM/VMSS use Spot + deallocate + `maxPrice: -1`
- VM SKU: `Standard_B1s`
- App Service plan: `B1` Linux
- No App Gateway, Bastion, VPN Gateway, Azure Firewall in Bicep
- Standard LB only where needed (sync, acl)

> App Gateway, Bastion, and VPN Gateway are intentionally not deployed due to high monthly costs (typically >$130/mo each). For AZ-104, conceptual understanding is covered in `RUNBOOK.md` theory-only topics.

## RBAC matrix

| Service identity | Resource | Built-in role |
|---|---|---|
| sync VMSS | sa-sync-events blob | Storage Blob Data Contributor |
| sync VMSS | ACR | AcrPull |
| sync VMSS | App Insights | Monitoring Metrics Publisher |
| docs-api App Service | sa-docs table | Storage Table Data Contributor |
| acl VM | sa-acl table | Storage Table Data Contributor |
| acl VM | sa-shared file share | Storage File Data SMB Share Contributor |
| attachments ACI | sa-attachments blob | Storage Blob Delegator + Storage Blob Data Contributor |
| attachments ACI | ACR | AcrPull |
