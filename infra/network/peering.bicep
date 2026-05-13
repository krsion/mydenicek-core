targetScope = 'resourceGroup'

param hubVnetName string
param spokeVnetNames array

resource hubVnet 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: hubVnetName
}

resource spokePeeringsFromHub 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = [for spoke in spokeVnetNames: {
  name: '${hubVnet.name}/${spoke}-from-hub'
  properties: {
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    remoteVirtualNetwork: {
      id: resourceId('Microsoft.Network/virtualNetworks', spoke)
    }
  }
}]

resource spokePeeringsToHub 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = [for spoke in spokeVnetNames: {
  name: '${spoke}/${hubVnet.name}-to-hub'
  properties: {
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    remoteVirtualNetwork: {
      id: hubVnet.id
    }
  }
}]
