# AZ-104 Learning Runbook

## Identity & Governance
- [ ] Create Entra app reg with scopes and app roles
- [ ] Configure MSAL in React (PKCE, redirect URIs)
- [ ] Verify JWTs server-side (audience, issuer, signature) via shared-auth
- [ ] Bulk-invite 3 users via CSV; create dynamic group
- [ ] Invite a B2B guest, give them Doc.Read role on one doc
- [ ] Configure SSPR (portal-only)
- [ ] Conditional Access: require MFA for Admin role
- [ ] Management group hierarchy via Bicep (Root → Contoso → {Prod, Dev})
- [ ] Azure Policy: require `app=mydenicek` tag (deny)
- [ ] Custom RBAC role "Mydenicek Operator" via Bicep
- [ ] Resource locks on prod RG

## Storage
- [ ] Append blobs from sync service
- [ ] Block blobs with lifecycle (hot→cool→archive)
- [ ] Soft delete + versioning + restore a deleted blob
- [ ] User-delegation SAS (managed identity, no account key)
- [ ] Table storage CRUD from docs-api and acl
- [ ] Azure Files SMB share, mounted by acl VM
- [ ] Azure File Sync to your laptop (1 sync group)
- [ ] AzCopy: bulk upload + sync
- [ ] Different redundancy SKUs (LRS, ZRS, GRS) across the 5 storage accounts

## Compute
- [ ] VMSS autoscale rules (CPU + custom metric)
- [ ] VMSS rolling upgrade (push new sync image)
- [ ] Observe a spot eviction (lower maxPrice temporarily)
- [ ] App Service slot swap (docs-api staging → prod)
- [ ] App Service autoscale rule
- [ ] Single VM with data disk; expand disk
- [ ] VM extensions: AMA + custom script
- [ ] Recovery Services Vault: backup + file-level restore
- [ ] ASR replication of the VM to paired region, do a failover test
- [ ] ACI deploy/teardown cycle
- [ ] Read AKS docs (theory-only)

## Networking
- [ ] Hub-spoke with 4 spokes peered to hub
- [ ] NSGs using ASGs
- [ ] Standard Load Balancer with health probes, backend pools
- [ ] Private endpoints for blob, table, files
- [ ] Private DNS zones linked across spokes
- [ ] Network Watcher: IP flow verify, next hop, connection troubleshoot
- [ ] NSG flow logs → storage → traffic analytics
- [ ] Connect to private VM via `az ssh vm`
- [ ] Try Defender JIT VM access once

## Monitor
- [ ] LAW receiving from every resource
- [ ] App Insights distributed traces across services
- [ ] 5 saved KQL queries (provided as files in infra/monitor/kql/)
- [ ] 5 alerts (metric + log + activity + service health)
- [ ] Workbook dashboard pinned
- [ ] Cost Management budget + 80% alert

## Theory-only topics
- **Bastion**: Managed browser-based SSH/RDP to private VMs without public IP exposure.
- **VPN Gateway / ExpressRoute**: Hybrid connectivity options; VPN for encrypted internet tunnels, ExpressRoute for private dedicated circuits.
- **Azure Firewall / App Gateway / AKS**: Firewall for centralized L3-L7 filtering, App Gateway for HTTP routing + WAF, AKS for managed Kubernetes orchestration.
