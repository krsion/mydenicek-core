targetScope = 'resourceGroup'

@description('Name of the Key Vault.')
param keyVaultName string = 'kv-mydenicek'

@description('Azure location.')
param location string = resourceGroup().location

@description('Subnet resource ID for the data private endpoint subnet (spoke-data).')
param dataPrivateEndpointSubnetId string

@description('Optional JWKS URL value. Keep empty to fetch JWKS live for now.')
param jwksUrlSecretValue string = ''

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enabledForTemplateDeployment: true
    publicNetworkAccess: 'Disabled'
  }
}

resource vaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: '${keyVault.name}-pe'
  location: location
  properties: {
    subnet: {
      id: dataPrivateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'keyvault-connection'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-05-01' = {
  name: 'default'
  parent: keyVaultPrivateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'vaultcore'
        properties: {
          privateDnsZoneId: vaultPrivateDnsZone.id
        }
      }
    ]
  }
}

resource jwksUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(jwksUrlSecretValue)) {
  name: 'entra-jwks-url'
  parent: keyVault
  properties: {
    value: jwksUrlSecretValue
  }
}

output keyVaultId string = keyVault.id
output keyVaultUri string = keyVault.properties.vaultUri
