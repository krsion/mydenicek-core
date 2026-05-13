# AZ-104 Learning Runbook — mydenicek

This runbook tracks practical exercises for the AZ-104 exam using the mydenicek
CRDT deployment as a live learning sandbox.

> **Status**: Work in progress — tied to the `infra/az-104` branch. Do not merge to main until after thesis defense.

---

## Identity & Governance

- [ ] Create Entra app reg with scopes and app roles
- [ ] Configure MSAL in React (PKCE, redirect URIs)
- [ ] Verify JWTs server-side (aud, iss, sig) via shared-auth
- [ ] Bulk-invite 3 users via CSV; create dynamic group
- [ ] Invite B2B guest, give Doc.Read role on one doc
- [ ] Configure SSPR
- [ ] CA policy: require MFA for Admin app role
- [ ] Test app-role assignment via Entra group → token `roles` claim
- [ ] Management group hierarchy via Bicep
- [ ] Azure Policy: require `app=mydenicek` tag (deny)
- [ ] Custom RBAC role "Mydenicek Operator" via Bicep
- [ ] Resource locks on prod RG

## Storage

- [ ] Append blobs from sync
- [ ] Block blobs with lifecycle (hot→cool→archive)
- [ ] Soft delete + versioning + restore a deleted blob
- [ ] User-delegation SAS (MI, no account key)
- [ ] Table storage CRUD from docs-api and acl
- [ ] Azure Files SMB share, mounted by acl VM
- [ ] Azure File Sync to laptop
- [ ] AzCopy: bulk upload + sync
- [ ] LRS/ZRS/GRS variety across the 5 storage accounts
- [ ] Provision Key Vault with private endpoint

## Compute

- [ ] VMSS autoscale rules
- [ ] VMSS rolling upgrade (push new sync image)
- [ ] Observe a spot eviction (lower maxPrice temporarily)
- [ ] App Service slot swap (docs-api staging → prod)
- [ ] App Service autoscale rule
- [ ] Single VM with data disk; expand disk
- [ ] VM extensions: AMA + custom script
- [ ] Recovery Services Vault: backup + file-level restore
- [ ] ASR replication of VM to paired region + failover test
- [ ] ACI deploy/teardown cycle
- [ ] Read AKS docs (theory-only)

## Networking

- [ ] Hub-spoke 4 spokes peered to hub
- [ ] NSGs using ASGs
- [ ] Standard LB with health probes
- [ ] Private endpoints for blob, table, files, key vault
- [ ] Private DNS zones linked across spokes
- [ ] Network Watcher: IP flow verify, next hop, connection troubleshoot
- [ ] NSG flow logs → storage → traffic analytics
- [ ] Connect to private VM via `az ssh vm`
- [ ] Defender JIT VM access once

## Monitor

- [ ] LAW receiving from every resource
- [ ] App Insights distributed traces across services
- [ ] 6 saved KQL queries (in infra/monitor/kql/)
- [ ] 5 alerts (metric + log + activity + service health)
- [ ] Verify signature-failures alert fires when client sends tampered event
- [ ] Workbook dashboard pinned
- [ ] Cost Management budget + 80% alert

## Theory-Only Topics

Brief bullets — understand conceptually but skip deployment (each costs >$130/month in Azure):

- **Bastion**: Fully managed jump-host service for SSH/RDP to private VMs over TLS without a public IP on the VM. Use `az ssh vm` and Defender JIT instead for this sandbox.
- **VPN Gateway**: Site-to-site (S2S) or point-to-site (P2S) encrypted tunnels between on-premises and Azure VNet. Starts at ~$140/month (Basic SKU). For AZ-104: understand gateway SKUs, BGP peering, and IKEv2 handshake.
- **ExpressRoute**: Dedicated private link to Azure bypassing the public internet via a carrier. High bandwidth, low latency, high cost ($55–$11,000/month). For AZ-104: understand circuit SKUs, peering types (Azure private, Microsoft), and Global Reach.
- **Azure Firewall**: Managed stateful L3–L7 firewall with FQDN filtering and threat intelligence. ~$900/month for Standard SKU. For AZ-104: understand rule collection priorities, DNAT rules, and Azure Firewall Manager.
- **Application Gateway**: Managed L7 load balancer with WAF, SSL offload, and URL-based routing. ~$130/month (v2 Small). For AZ-104: understand listener types, routing rules, backend health probes, and WAF rule sets.
- **AKS**: Managed Kubernetes — free control plane but pay for nodes. For AZ-104 conceptual depth: understand node pools, cluster autoscaler, managed identity integration, CNI options, and monitoring with Container Insights.
