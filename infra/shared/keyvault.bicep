targetScope = 'resourceGroup'

@description('Name of the Key Vault.')
param name string

@description('Azure region for the Key Vault.')
param location string

@description('Resource ID of the subnet where the private endpoint will be placed.')
param privateEndpointSubnetId string

@description('Resource ID of the privatelink.vaultcore.azure.net private DNS zone.')
param privateDnsZoneId string

@description('Resource tags.')
param tags object = {}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    // RBAC authorization — no legacy access policies
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    // Disable public network access; all access via private endpoint
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: []
    }
  }
}

// Private endpoint for Key Vault
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-${name}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'plsc-${name}'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: ['vault']
        }
      }
    ]
  }
}

// DNS zone group ties the PE to the private DNS zone so names resolve automatically
resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: privateEndpoint
  name: 'dzg-${name}'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'privatelink-vaultcore'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output vaultId string = keyVault.id
output vaultUri string = keyVault.properties.vaultUri
output privateEndpointId string = privateEndpoint.id
