targetScope = 'resourceGroup'

@description('Name of the storage account (must be globally unique, 3-24 lowercase alphanumeric).')
param name string

@description('Azure region.')
param location string

@description('Resource ID of the private endpoint subnet.')
param privateEndpointSubnetId string

@description('Resource ID of the privatelink.table.core.windows.net private DNS zone.')
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

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource docsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'docs'
}

// Private endpoint for table storage
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-table-${name}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'plsc-table-${name}'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: ['table']
        }
      }
    ]
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: privateEndpoint
  name: 'dzg-table-${name}'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'privatelink-table'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output tableEndpoint string = storageAccount.properties.primaryEndpoints.table
