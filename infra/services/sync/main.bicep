targetScope = 'resourceGroup'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region.')
param location string = 'westeurope'

@description('Resource ID of the workload subnet for the VMSS NICs.')
param subnetId string

@description('Name of the Azure Container Registry (without login server suffix).')
param acrName string

@description('Resource ID of the Log Analytics Workspace.')
param lawResourceId string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Resource ID of the ACL service storage account (for table data reader assignment).')
param aclStorageAccountId string

@description('Resource tags.')
param tags object = {}

// ── VMSS ──────────────────────────────────────────────────────────────────────
module vmss 'vmss.bicep' = {
  name: 'vmss-sync-${environment}'
  params: {
    name: 'vmss-sync-${environment}'
    location: location
    subnetId: subnetId
    acrLoginServer: '${acrName}.azurecr.io'
    imageTag: 'latest'
    appInsightsConnStr: appInsightsConnStr
    authEnabled: true
    tags: tags
  }
}

// ── Storage (events + snapshots) ──────────────────────────────────────────────
module storage 'storage.bicep' = {
  name: 'storage-sync-${environment}'
  params: {
    name: 'sasync${environment}${uniqueString(resourceGroup().id)}'
    location: location
    // TODO: supply real subnet and DNS zone IDs from network stack outputs
    privateEndpointSubnetId: 'TODO_PE_SUBNET_ID'
    privateDnsZoneId: 'TODO_BLOB_DNS_ZONE_ID'
    tags: tags
  }
}

// ── Autoscale ─────────────────────────────────────────────────────────────────
module autoscale 'autoscale.bicep' = {
  name: 'autoscale-sync-${environment}'
  params: {
    name: 'as-sync-${environment}'
    vmssId: vmss.outputs.vmssId
    location: location
    tags: tags
  }
}

// ── RBAC assignments ──────────────────────────────────────────────────────────
// Use names/params known at deploy start for guid() — module output IDs are not
// available until after deployment begins (BCP120 constraint).
var syncStorageName = 'sasync${environment}${uniqueString(resourceGroup().id)}'
var vmssDeplName    = 'vmss-sync-${environment}'

// Storage Blob Data Contributor on own storage account
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource rbacBlobContrib 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, syncStorageName, vmssDeplName, storageBlobDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: vmss.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// AcrPull on ACR
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource acrRef 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
}
resource rbacAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, acrName, vmssDeplName, acrPullRoleId)
  scope: acrRef
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: vmss.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Monitoring Metrics Publisher on the resource group
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'
resource rbacMetrics 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, vmssDeplName, monitoringMetricsPublisherRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: vmss.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Table Data Reader on ACL storage account
var storageTableDataReaderRoleId = '76199698-9eea-4c19-bc75-cec21354c6b6'
resource aclStorageRef 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  // TODO: pass actual resource name; using ID reference requires careful scoping
  name: last(split(aclStorageAccountId, '/'))
}
resource rbacAclTableReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, aclStorageAccountId, vmssDeplName, storageTableDataReaderRoleId)
  scope: aclStorageRef
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataReaderRoleId)
    principalId: vmss.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Forward lawResourceId for use by the monitor stack or pipeline diagnostic wiring
output lawResourceId string = lawResourceId
output vmssId string = vmss.outputs.vmssId
output storageAccountId string = storage.outputs.storageAccountId
