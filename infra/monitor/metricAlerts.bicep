targetScope = 'resourceGroup'

param actionGroupId string

// TODO: Replace with real target resource IDs.
resource cpuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'sync-vmss-cpu-high'
  location: 'global'
  properties: {
    description: 'Sync VMSS CPU too high.'
    severity: 2
    enabled: true
    scopes: [
      subscription().id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          name: 'high-cpu'
          metricName: 'Percentage CPU'
          metricNamespace: 'microsoft.compute/virtualmachinescalesets'
          operator: 'GreaterThan'
          threshold: 70
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
    }
    actions: [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}
