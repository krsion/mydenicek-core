targetScope = 'resourceGroup'

param vmssName string

resource vmss 'Microsoft.Compute/virtualMachineScaleSets@2024-03-01' existing = {
  name: vmssName
}

resource autoscale 'Microsoft.Insights/autoscaleSettings@2022-10-01' = {
  name: '${vmssName}-autoscale'
  location: resourceGroup().location
  properties: {
    enabled: true
    targetResourceUri: vmss.id
    profiles: [
      {
        name: 'default'
        capacity: {
          minimum: '1'
          maximum: '3'
          default: '1'
        }
        rules: [
          {
            metricTrigger: {
              metricName: 'Percentage CPU'
              metricResourceUri: vmss.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT5M'
            }
          }
        ]
      }
    ]
  }
}
