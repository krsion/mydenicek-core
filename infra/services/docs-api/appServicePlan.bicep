targetScope = 'resourceGroup'

param location string
param planName string

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  tags: {
    app: 'mydenicek'
    service: 'docs-api'
  }
  properties: {
    reserved: true
  }
}

output planId string = plan.id
