targetScope = 'resourceGroup'

@description('Name of the autoscale settings resource.')
param name string

@description('Resource ID of the VMSS to autoscale.')
param vmssId string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

resource autoscale 'Microsoft.Insights/autoscaleSettings@2022-10-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    enabled: true
    targetResourceUri: vmssId
    profiles: [
      {
        name: 'Default'
        capacity: {
          minimum: '1'
          maximum: '5'
          default: '1'
        }
        rules: [
          {
            // Scale out when CPU > 70% for 5 minutes
            metricTrigger: {
              metricName: 'Percentage CPU'
              metricResourceUri: vmssId
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
          {
            // Scale in when CPU < 30% for 10 minutes
            metricTrigger: {
              metricName: 'Percentage CPU'
              metricResourceUri: vmssId
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT10M'
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
            scaleAction: {
              direction: 'Decrease'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT10M'
            }
          }
        ]
      }
    ]
  }
}

output autoscaleId string = autoscale.id
