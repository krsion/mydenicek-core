targetScope = 'resourceGroup'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region.')
param location string = 'westeurope'

@description('Resource ID of the workload subnet for VNet integration.')
param subnetId string

@description('Resource ID of the Log Analytics Workspace.')
param lawResourceId string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Resource tags.')
param tags object = {}

// ── App Service Plan ──────────────────────────────────────────────────────────
module plan 'appServicePlan.bicep' = {
  name: 'plan-docs-api-${environment}'
  params: {
    name: 'plan-docs-api-${environment}'
    location: location
    tags: tags
  }
}

// ── Table Storage ─────────────────────────────────────────────────────────────
module tableStorage 'tableStorage.bicep' = {
  name: 'storage-docs-api-${environment}'
  params: {
    name: 'sadocsapi${environment}${uniqueString(resourceGroup().id)}'
    location: location
    // TODO: supply real subnet and DNS zone IDs from network stack outputs
    privateEndpointSubnetId: 'TODO_PE_SUBNET_ID'
    privateDnsZoneId: 'TODO_TABLE_DNS_ZONE_ID'
    tags: tags
  }
}

// ── Web App ───────────────────────────────────────────────────────────────────
module webApp 'webApp.bicep' = {
  name: 'webapp-docs-api-${environment}'
  params: {
    name: 'app-docs-api-${environment}'
    location: location
    planId: plan.outputs.planId
    subnetId: subnetId
    appInsightsConnStr: appInsightsConnStr
    authEnabled: true
    tags: tags
  }
}

// ── RBAC: App Service MI → Storage Table Data Contributor ─────────────────────
// Use deploy-time known names for guid() to satisfy BCP120 constraint.
var tableStorageDeplName = 'sadocsapi${environment}${uniqueString(resourceGroup().id)}'
var webAppDeplName       = 'app-docs-api-${environment}'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
resource rbacTableContrib 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, tableStorageDeplName, webAppDeplName, storageTableDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: webApp.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Forward lawResourceId for use by the monitor stack or pipeline diagnostic wiring
output lawResourceId string = lawResourceId
output webAppId string = webApp.outputs.webAppId
output storageAccountId string = tableStorage.outputs.storageAccountId
