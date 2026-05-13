targetScope = 'resourceGroup'

@description('Name of the App Service Plan.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    family: 'B'
    capacity: 1
  }
  properties: {
    // reserved: true is required for Linux plans
    reserved: true
  }
}

output planId string = appServicePlan.id
output planName string = appServicePlan.name
