targetScope = 'resourceGroup'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region.')
param location string = 'westeurope'

@description('Resource ID of the Log Analytics Workspace.')
param lawId string

@description('Resource ID of the Application Insights instance.')
param appInsightsId string

@description('Resource ID of the sync VMSS.')
param syncVmssId string

@description('Resource ID of the docs-api Web App.')
param docsAppId string

@description('Resource ID of the ACL VM.')
param aclVmId string

@description('Resource tags.')
param tags object = {}

// ── Action Group (email alerts) ───────────────────────────────────────────────
module actionGroup 'actionGroup.bicep' = {
  name: 'ag-${environment}'
  params: {
    name: 'ag-mydenicek-${environment}'
    // TODO: replace with actual ops email address
    emailAddress: 'ops@example.com'
    location: 'global'
    tags: tags
  }
}

// ── Diagnostic Settings ───────────────────────────────────────────────────────
module diagnostics 'diagnosticSettings.bicep' = {
  name: 'diag-${environment}'
  params: {
    lawId: lawId
    resourceIds: [syncVmssId, docsAppId, aclVmId]
    tags: tags
  }
}

// ── Metric Alerts ─────────────────────────────────────────────────────────────
module metricAlerts 'metricAlerts.bicep' = {
  name: 'metricAlerts-${environment}'
  params: {
    location: 'global'
    actionGroupId: actionGroup.outputs.actionGroupId
    syncVmssId: syncVmssId
    docsAppId: docsAppId
    tags: tags
  }
}

// ── Log Alerts ────────────────────────────────────────────────────────────────
module logAlerts 'logAlerts.bicep' = {
  name: 'logAlerts-${environment}'
  params: {
    location: location
    lawId: lawId
    actionGroupId: actionGroup.outputs.actionGroupId
    tags: tags
  }
}

output actionGroupId string = actionGroup.outputs.actionGroupId
