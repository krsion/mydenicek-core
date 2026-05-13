targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param networkRgName string = '${prefix}-network-rg'

resource networkRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: networkRgName
  location: location
  tags: {
    app: 'mydenicek'
    env: 'network'
  }
}

module asg './asg.bicep' = {
  name: 'asg'
  scope: resourceGroup(networkRg.name)
}

module nsg './nsg.bicep' = {
  name: 'nsg'
  scope: resourceGroup(networkRg.name)
}

module hub './hubVnet.bicep' = {
  name: 'hub-vnet'
  scope: resourceGroup(networkRg.name)
  params: {
    location: location
    vnetName: '${prefix}-hub-vnet'
    addressPrefix: '10.0.0.0/16'
  }
}

module spokeFrontend './spokeVnet.bicep' = {
  name: 'spoke-frontend'
  scope: resourceGroup(networkRg.name)
  params: {
    location: location
    name: '${prefix}-frontend-vnet'
    addressPrefix: '10.1.0.0/16'
    subnetPrefix: '10.1.0.0/24'
  }
}

module spokeSync './spokeVnet.bicep' = {
  name: 'spoke-sync'
  scope: resourceGroup(networkRg.name)
  params: {
    location: location
    name: '${prefix}-sync-vnet'
    addressPrefix: '10.2.0.0/16'
    subnetPrefix: '10.2.0.0/24'
  }
}

module spokeApi './spokeVnet.bicep' = {
  name: 'spoke-api'
  scope: resourceGroup(networkRg.name)
  params: {
    location: location
    name: '${prefix}-api-vnet'
    addressPrefix: '10.3.0.0/16'
    subnetPrefix: '10.3.0.0/24'
  }
}

module spokeData './spokeVnet.bicep' = {
  name: 'spoke-data'
  scope: resourceGroup(networkRg.name)
  params: {
    location: location
    name: '${prefix}-data-vnet'
    addressPrefix: '10.4.0.0/16'
    subnetPrefix: '10.4.0.0/24'
  }
}

module peering './peering.bicep' = {
  name: 'peerings'
  scope: resourceGroup(networkRg.name)
  params: {
    hubVnetName: hub.outputs.vnetName
    spokeVnetNames: [
      spokeFrontend.outputs.vnetName
      spokeSync.outputs.vnetName
      spokeApi.outputs.vnetName
      spokeData.outputs.vnetName
    ]
  }
}

module privateDns './privateDns.bicep' = {
  name: 'private-dns'
  scope: resourceGroup(networkRg.name)
  params: {
    frontendVnetId: spokeFrontend.outputs.vnetId
    syncVnetId: spokeSync.outputs.vnetId
    apiVnetId: spokeApi.outputs.vnetId
    dataVnetId: spokeData.outputs.vnetId
  }
}

module lb './loadBalancer.bicep' = {
  name: 'sync-lb'
  scope: resourceGroup(networkRg.name)
  params: {
    location: location
    lbName: '${prefix}-sync-lb'
  }
}

output networkResourceGroupName string = networkRg.name
output hubVnetId string = hub.outputs.vnetId
