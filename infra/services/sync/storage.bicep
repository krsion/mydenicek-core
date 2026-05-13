targetScope = 'resourceGroup'

@description('Name of the storage account (must be globally unique, 3-24 lowercase alphanumeric).')
param name string

@description('Azure region.')
param location string

@description('Resource ID of the private endpoint subnet.')
param privateEndpointSubnetId string

@description('Resource ID of the privatelink.blob.core.windows.net private DNS zone.')
param privateDnsZoneId string

@description('Resource tags.')
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    // Disable shared-key access; all access via managed identity RBAC
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Deny'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

// "events" container — append-blob workload
resource eventsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'events'
  properties: {
    publicAccess: 'None'
  }
}

// "snapshots" container — block-blob workload
resource snapshotsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'snapshots'
  properties: {
    publicAccess: 'None'
  }
}

// Private endpoint for blob storage
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-blob-${name}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'plsc-blob-${name}'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: ['blob']
        }
      }
    ]
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: privateEndpoint
  name: 'dzg-blob-${name}'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'privatelink-blob'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
