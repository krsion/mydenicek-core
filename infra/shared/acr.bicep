targetScope = 'resourceGroup'

@description('Name of the Azure Container Registry (must be globally unique, alphanumeric).')
param name string

@description('Azure region for the registry.')
param location string

@description('Resource tags.')
param tags object = {}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    // Admin user disabled; access via managed identity and AcrPull/AcrPush roles
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

output registryId string = acr.id
output loginServer string = acr.properties.loginServer
output registryName string = acr.name
