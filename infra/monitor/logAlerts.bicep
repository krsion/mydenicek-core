targetScope = 'resourceGroup'

param actionGroupId string

resource failedSigninAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'failed-signins-alert'
  location: resourceGroup().location
  properties: {
    displayName: 'Failed sign-ins detected'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    scopes: [
      subscription().id
    ]
    criteria: {
      allOf: [
        {
          query: 'SigninLogs | where ResultType != 0 | summarize failures = count()'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroupId
      ]
    }
  }
}
