targetScope = 'resourceGroup'

@description('Log Analytics workspace resource ID.')
param workspaceResourceId string

@description('Action group resource ID.')
param actionGroupResourceId string

@description('Alert location.')
param location string = resourceGroup().location

resource signatureFailuresAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'signature-verification-failures'
  location: location
  properties: {
    description: 'Signature verification failures > 0 in 5 minutes.'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [
      workspaceResourceId
    ]
    criteria: {
      allOf: [
        {
          query: loadTextContent('./kql/signature-failures.kql')
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroupResourceId
      ]
    }
  }
}
