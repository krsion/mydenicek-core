targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param computeRgName string = '${prefix}-sync-compute-rg'
param dataRgName string = '${prefix}-sync-data-rg'
param acrLoginServer string = ''
param imageTag string = 'latest'
param appInsightsResourceId string = ''
param adminSshPublicKey string = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDPLACEHOLDER'
param subnetResourceId string = '/subscriptions/TODO/resourceGroups/TODO/providers/Microsoft.Network/virtualNetworks/TODO/subnets/default'

resource computeRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: computeRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'sync'
  }
}

resource dataRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: dataRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'sync'
    tier: 'data'
  }
}

module vmss './vmss.bicep' = {
  name: 'sync-vmss'
  scope: resourceGroup(computeRg.name)
  params: {
    location: location
    vmssName: '${prefix}-sync-vmss'
    imageReferenceId: ''
    containerImage: '${acrLoginServer}/sync:${imageTag}'
    adminSshPublicKey: adminSshPublicKey
    subnetResourceId: subnetResourceId
  }
}

module storage './storage.bicep' = {
  name: 'sync-storage'
  scope: resourceGroup(dataRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}syncevents${uniqueString(subscription().id)}', '-', '')), 24)
    principalId: vmss.outputs.principalId
  }
}

module autoscale './autoscale.bicep' = {
  name: 'sync-autoscale'
  scope: resourceGroup(computeRg.name)
  params: {
    vmssName: vmss.outputs.vmssName
  }
}

output computeResourceGroupName string = computeRg.name
output dataResourceGroupName string = dataRg.name
output identityPrincipalId string = vmss.outputs.principalId
output storageAccountName string = storage.outputs.storageAccountName
// TODO: Add RBAC assignments from the matrix for AcrPull and Monitoring Metrics Publisher.
