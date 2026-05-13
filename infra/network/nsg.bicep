targetScope = 'resourceGroup'

resource syncNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-sync'
  location: resourceGroup().location
  tags: {
    app: 'mydenicek'
  }
  properties: {
    securityRules: [
      {
        name: 'allow-websocket-inbound'
        properties: {
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
          access: 'Allow'
          priority: 100
          direction: 'Inbound'
        }
      }
    ]
  }
}

output syncNsgId string = syncNsg.id
