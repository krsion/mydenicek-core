targetScope = 'resourceGroup'

@description('Name of the hub VNet.')
param name string

@description('Azure region for the hub VNet.')
param location string

@description('Resource tags.')
param tags object = {}

resource hubVnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        // Reserved for future VPN Gateway (not deployed — no VPN Gateway per constraints)
        name: 'GatewaySubnet'
        properties: {
          addressPrefix: '10.0.0.0/27'
        }
      }
      {
        // Reserved for Azure Bastion (not deployed — no Bastion per constraints)
        name: 'AzureBastionSubnet'
        properties: {
          addressPrefix: '10.0.1.0/26'
        }
      }
      {
        name: 'mgmt'
        properties: {
          addressPrefix: '10.0.2.0/24'
        }
      }
      {
        name: 'shared'
        properties: {
          addressPrefix: '10.0.3.0/24'
        }
      }
    ]
  }
}

output vnetId string = hubVnet.id
output vnetName string = hubVnet.name
output sharedSubnetId string = hubVnet.properties.subnets[3].id
output mgmtSubnetId string = hubVnet.properties.subnets[2].id
