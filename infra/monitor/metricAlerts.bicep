targetScope = 'resourceGroup'

@description('Location for alert rules (use "global" for activity log alerts).')
param location string = 'global'

@description('Resource ID of the Action Group to trigger.')
param actionGroupId string

@description('Resource ID of the sync VMSS.')
param syncVmssId string

@description('Resource ID of the docs-api Web App.')
param docsAppId string

@description('Resource tags.')
param tags object = {}

// ── 1. CPU alert on VMSS (>80% for 5 min) ────────────────────────────────────
resource cpuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-vmss-cpu-high'
  location: 'global'
  tags: tags
  properties: {
    description: 'Fires when sync VMSS average CPU exceeds 80% for 5 minutes.'
    severity: 2
    enabled: true
    scopes: [syncVmssId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HighCPU'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Percentage CPU'
          metricNamespace: 'Microsoft.Compute/virtualMachineScaleSets'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}

// ── 2. HTTP 5xx alert on App Service ─────────────────────────────────────────
resource http5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-webapp-5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'Fires when the docs-api Web App returns HTTP 5xx errors.'
    severity: 1
    enabled: true
    scopes: [docsAppId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xx'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}

// ── 3. Spot eviction activity log alert ───────────────────────────────────────
resource spotEvictionAlert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: 'alert-spot-eviction'
  location: 'global'
  tags: tags
  properties: {
    description: 'Fires when a Spot VM or VMSS instance is evicted.'
    enabled: true
    scopes: [resourceGroup().id]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'Policy'
        }
        {
          field: 'operationName'
          equals: 'Microsoft.Compute/virtualMachineScaleSets/deallocate/action'
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: actionGroupId
        }
      ]
    }
  }
}

// ── 4. Role assignment change activity log alert ──────────────────────────────
resource roleChangeAlert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: 'alert-role-assignment-change'
  location: 'global'
  tags: tags
  properties: {
    description: 'Fires when a role assignment is created or deleted in the resource group.'
    enabled: true
    scopes: [resourceGroup().id]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'Administrative'
        }
        {
          field: 'operationName'
          containsAny: [
            'Microsoft.Authorization/roleAssignments/write'
            'Microsoft.Authorization/roleAssignments/delete'
          ]
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: actionGroupId
        }
      ]
    }
  }
}

output cpuAlertId string = cpuAlert.id
output http5xxAlertId string = http5xxAlert.id
output spotEvictionAlertId string = spotEvictionAlert.id
output roleChangeAlertId string = roleChangeAlert.id
