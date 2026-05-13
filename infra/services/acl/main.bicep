targetScope = 'resourceGroup'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region.')
param location string = 'westeurope'

@description('Resource ID of the workload subnet for the VM NIC.')
param subnetId string

@description('Resource ID of the Log Analytics Workspace.')
param lawResourceId string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Resource tags.')
param tags object = {}

// ── VM ────────────────────────────────────────────────────────────────────────
module vm 'vm.bicep' = {
  name: 'vm-acl-${environment}'
  params: {
    name: 'vm-acl-${environment}'
    location: location
    subnetId: subnetId
    // TODO: supply actual ASG ID from network stack outputs
    asgId: 'TODO_ASG_ID'
    adminUsername: 'azureuser'
    // TODO: replace with actual SSH public key or pull from Key Vault
    sshPublicKey: 'TODO_SSH_PUBLIC_KEY'
    storageAccountName: 'saacl${environment}${uniqueString(resourceGroup().id)}'
    appInsightsConnStr: appInsightsConnStr
    authEnabled: true
    tags: tags
  }
}

// ── Table Storage (acl + peers tables) ───────────────────────────────────────
module tableStorage 'tableStorage.bicep' = {
  name: 'storage-acl-${environment}'
  params: {
    name: 'saacl${environment}${uniqueString(resourceGroup().id)}'
    location: location
    // TODO: supply real subnet and DNS zone IDs from network stack outputs
    privateEndpointSubnetId: 'TODO_PE_SUBNET_ID'
    privateDnsZoneId: 'TODO_TABLE_DNS_ZONE_ID'
    tags: tags
  }
}

// ── File Share ────────────────────────────────────────────────────────────────
module fileShare 'fileShare.bicep' = {
  name: 'fileshare-acl-${environment}'
  params: {
    name: 'safiles${environment}${uniqueString(resourceGroup().id)}'
    location: location
    shareName: 'shared'
    tags: tags
  }
}

// ── Backup ────────────────────────────────────────────────────────────────────
module backup 'backup.bicep' = {
  name: 'backup-acl-${environment}'
  params: {
    name: 'rsv-acl-${environment}'
    location: location
    vmId: vm.outputs.vmId
    vmName: vm.outputs.vmName
    tags: tags
  }
}

// ── RBAC: VM MI → ACL storage (Storage Table Data Contributor) ───────────────
// Use deploy-time known names for guid() to satisfy BCP120 constraint.
var tableStorageDeplName = 'saacl${environment}${uniqueString(resourceGroup().id)}'
var fileStorageDeplName  = 'safiles${environment}${uniqueString(resourceGroup().id)}'
var vmDeplName           = 'vm-acl-${environment}'

var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
resource rbacTableContrib 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, tableStorageDeplName, vmDeplName, storageTableDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: vm.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── RBAC: VM MI → file share (Storage File Data SMB Share Contributor) ────────
var storageFileSmbContributorRoleId = '0c867c2a-1d8c-454a-a3db-ab2ea1bdc8bb'
resource rbacFileContrib 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, fileStorageDeplName, vmDeplName, storageFileSmbContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageFileSmbContributorRoleId)
    principalId: vm.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Forward lawResourceId for use by the monitor stack or pipeline diagnostic wiring
output lawResourceId string = lawResourceId
output vmId string = vm.outputs.vmId
output tableStorageAccountId string = tableStorage.outputs.storageAccountId
output fileStorageAccountId string = fileShare.outputs.storageAccountId
