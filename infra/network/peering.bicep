targetScope = 'resourceGroup'

@description('Name of the hub VNet resource.')
param hubVnetName string

@description('Name of the spoke VNet resource.')
param spokeVnetName string

@description('Resource ID of the hub VNet.')
param hubVnetId string

@description('Resource ID of the spoke VNet.')
param spokeVnetId string

// Existing references needed to create child peering resources
resource hubVnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: hubVnetName
}

resource spokeVnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: spokeVnetName
}

// Hub → Spoke peering
resource hubToSpoke 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2023-11-01' = {
  parent: hubVnet
  name: 'peer-hub-to-${spokeVnetName}'
  properties: {
    remoteVirtualNetwork: {
      id: spokeVnetId
    }
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    allowGatewayTransit: false
    useRemoteGateways: false
  }
}

// Spoke → Hub peering
resource spokeToHub 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2023-11-01' = {
  parent: spokeVnet
  name: 'peer-${spokeVnetName}-to-hub'
  properties: {
    remoteVirtualNetwork: {
      id: hubVnetId
    }
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    allowGatewayTransit: false
    useRemoteGateways: false
  }
}

output hubToSpokePeeringId string = hubToSpoke.id
output spokeToHubPeeringId string = spokeToHub.id
