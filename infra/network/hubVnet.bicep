targetScope = 'resourceGroup'

param location string
param vnetName string
param addressPrefix string

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: {
    app: 'mydenicek'
  }
  properties: {
    addressSpace: {
      addressPrefixes: [
        addressPrefix
      ]
    }
    subnets: [
      {
        name: 'shared'
        properties: {
          addressPrefix: '10.0.0.0/24'
        }
      }
    ]
  }
}

output vnetId string = vnet.id
output vnetName string = vnet.name
