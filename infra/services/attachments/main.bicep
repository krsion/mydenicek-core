targetScope = 'resourceGroup'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region.')
param location string = 'westeurope'

@description('Name of the Azure Container Registry (without login server suffix).')
param acrName string

@description('Resource ID of the Log Analytics Workspace.')
param lawResourceId string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Resource tags.')
param tags object = {}

// ── Storage ───────────────────────────────────────────────────────────────────
module storage 'storage.bicep' = {
  name: 'storage-attachments-${environment}'
  params: {
    name: 'saattach${environment}${uniqueString(resourceGroup().id)}'
    location: location
    tags: tags
  }
}

// ── Container Group ───────────────────────────────────────────────────────────
module containerGroup 'containerGroup.bicep' = {
  name: 'aci-attachments-${environment}'
  params: {
    name: 'aci-attachments-${environment}'
    location: location
    acrLoginServer: '${acrName}.azurecr.io'
    imageTag: 'latest'
    storageAccountName: storage.outputs.storageAccountName
    appInsightsConnStr: appInsightsConnStr
    authEnabled: true
    tags: tags
  }
}

// ── RBAC: ACI MI → attachments blob (Storage Blob Delegator) ─────────────────
// Use deploy-time known names for guid() to satisfy BCP120 constraint.
var attachStorageDeplName = 'saattach${environment}${uniqueString(resourceGroup().id)}'
var aciDeplName           = 'aci-attachments-${environment}'

var storageBlobDelegatorRoleId = 'db58b8e5-c6ad-4a2a-8342-4190687cbf4f'
resource rbacBlobDelegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, attachStorageDeplName, aciDeplName, storageBlobDelegatorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDelegatorRoleId)
    principalId: containerGroup.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── RBAC: ACI MI → attachments blob (Storage Blob Data Contributor) ───────────
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource rbacBlobContrib 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, attachStorageDeplName, aciDeplName, storageBlobDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: containerGroup.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── RBAC: ACI MI → ACR (AcrPull) ─────────────────────────────────────────────
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource acrRef 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
}
resource rbacAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, acrName, aciDeplName, acrPullRoleId)
  scope: acrRef
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: containerGroup.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Forward lawResourceId for use by the monitor stack or pipeline diagnostic wiring
output lawResourceId string = lawResourceId
output containerGroupId string = containerGroup.outputs.containerGroupId
output storageAccountId string = storage.outputs.storageAccountId
