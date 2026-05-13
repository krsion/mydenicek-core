# Azure Infrastructure — mydenicek

This directory contains the Bicep modules and GitHub Actions workflows for the
AZ-104 learning deployment.

> **Branch:** `infra/az-104` — DO NOT MERGE TO MAIN UNTIL AFTER THESIS DEFENSE.

---

## Prerequisites

- Azure CLI ≥ 2.60
- Bicep CLI ≥ 0.28 (`az bicep install`)
- GitHub CLI or GitHub Actions runner with OIDC permissions

---

## OIDC Federated Credential Setup

GitHub Actions workflows use **OIDC federated credentials** — no secrets stored in GitHub.

### 1. Create the Entra app registration

```bash
# Create the app registration
az ad app create --display-name "mydenicek-github-actions"

# Note the appId from the output
APP_ID="<appId from above>"

# Create a service principal
az ad sp create --id "$APP_ID"
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
```

### 2. Assign subscription-level Contributor

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
az role assignment create \
  --assignee "$SP_OBJECT_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$SUBSCRIPTION_ID"
```

### 3. Add federated credentials for each branch/workflow

```bash
# For the infra/az-104 branch
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "infra-az-104",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:krsion/mydenicek:ref:refs/heads/infra/az-104",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# For the copilot branch (add as needed)
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "deploy-any",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:krsion/mydenicek:environment:azure",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

### 4. Store secrets in GitHub

```bash
gh secret set AZURE_CLIENT_ID --body "$APP_ID"
gh secret set AZURE_TENANT_ID --body "$(az account show --query tenantId -o tsv)"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID"
```

---

## Deploy Order

Always deploy in this order to respect module dependencies:

1. **Shared** (`deploy-shared.yml`) — Log Analytics, App Insights, ACR, Key Vault, DNS zone
2. **Network** (`deploy-network.yml`) — Hub VNet, 4 spokes, NSGs, peering, private DNS
3. **Services** (`deploy-service.yml`) — sync, docs-api, acl, attachments (any order)
4. **Monitor** (`deploy-monitor.yml`) — Alerts, diagnostic settings

---

## Scheduled Teardown & Spinup

| Event | UTC | CEST (summer) | CET (winter) |
|-------|-----|---------------|--------------|
| Teardown | 20:00 | 22:00 | 21:00 |
| Spinup | 05:00 | 07:00 | 06:00 |

**Winter adjustment:** During CET (last Sunday October → last Sunday March), shift the cron by +1h UTC. Edit `.github/workflows/scheduled-teardown.yml` and `scheduled-spinup.yml`:

```yaml
# Summer (CEST): UTC+2
on:
  schedule:
    - cron: '0 20 * * *'  # teardown

# Winter (CET): UTC+1 — change to:
    - cron: '0 21 * * *'  # teardown
```

**What is torn down nightly:**
- Sync VMSS (deallocated, not deleted — preserves OS disk)
- ACL VM (deallocated)
- App Service Plan (deleted to stop billing — App Service itself survives)
- ACI container groups (deleted)
- Standard Load Balancers

**What persists across teardown:**
- All 5 storage accounts (event log, docs, ACL data, attachments)
- Log Analytics Workspace
- Azure Container Registry (images)
- All VNets, NSGs, private DNS zones
- Key Vault

---

## Cost Estimates

| Mode | ~$/month |
|------|---------|
| Running 13h/day, Mon–Fri | ~$21 |
| Running 24/7 | ~$50 |
| Over budget threshold | $40 (80% of $50 budget) → email alert |

---

## Why App Gateway, Bastion, and VPN Gateway Are NOT Deployed

These services are covered in AZ-104 but are excluded from this sandbox because:

| Service | Min monthly cost | Why excluded |
|---------|-----------------|--------------|
| Application Gateway v2 | ~$130/month | Exceeds total sandbox budget alone |
| Azure Bastion Developer | ~$5/month (Dev SKU) | `az ssh vm` + Defender JIT covers learning objectives |
| VPN Gateway Basic | ~$27/month | No on-premises network to connect; Pure-theory AZ-104 exercise |
| Azure Firewall Standard | ~$900/month | Far exceeds budget |

All four are covered conceptually in `RUNBOOK.md` (Theory-Only Topics section).

---

## RBAC Matrix

| Service identity | Resource | Built-in role |
|-----------------|----------|---------------|
| sync VMSS (MI) | sa-sync blob | Storage Blob Data Contributor |
| sync VMSS (MI) | ACR | AcrPull |
| sync VMSS (MI) | App Insights | Monitoring Metrics Publisher |
| sync VMSS (MI) | sa-acl table | Storage Table Data Reader |
| docs-api App Service (MI) | sa-docs table | Storage Table Data Contributor |
| acl VM (MI) | sa-acl tables (acl + peers) | Storage Table Data Contributor |
| acl VM (MI) | sa-shared file share | Storage File Data SMB Share Contributor |
| attachments ACI (MI) | sa-attachments blob | Storage Blob Delegator |
| attachments ACI (MI) | sa-attachments blob | Storage Blob Data Contributor |
| attachments ACI (MI) | ACR | AcrPull |

Custom role **Mydenicek Operator** is defined in `infra/shared/customRole.bicep`.

---

## Troubleshooting

### Bicep compilation fails

```bash
az bicep build --file infra/shared/main.bicep
az bicep build --file infra/network/main.bicep
```

### OIDC token exchange fails

Verify the `subject` in the federated credential matches the workflow trigger (branch or environment).

### Spot VM evicted during study session

The CRDT event log is persisted to Azure Blob Storage; no data is lost. Re-run `deploy-service.yml` to respawn the instance.

### Key Vault private endpoint DNS not resolving

Verify private DNS zone `privatelink.vaultcore.azure.net` is linked to all spoke VNets where resolution is needed.
