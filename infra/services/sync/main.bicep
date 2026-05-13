targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param serviceRgName string = '${prefix}-sync-rg'
param acrLoginServer string = ''
param imageTag string = 'latest'
param appInsightsResourceId string = ''

resource serviceRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: serviceRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'sync'
  }
}

module storage './storage.bicep' = {
  name: 'sync-storage'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}syncevents${uniqueString(subscription().id)}', '-', '')), 24)
  }
}

module vmss './vmss.bicep' = {
  name: 'sync-vmss'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    vmssName: '${prefix}-sync-vmss'
    imageReferenceId: ''
    containerImage: '${acrLoginServer}/sync:${imageTag}'
  }
}

module autoscale './autoscale.bicep' = {
  name: 'sync-autoscale'
  scope: resourceGroup(serviceRg.name)
  params: {
    vmssName: vmss.outputs.vmssName
  }
}

output resourceGroupName string = serviceRg.name
output identityPrincipalId string = vmss.outputs.principalId
output storageAccountName string = storage.outputs.storageAccountName
// TODO: Add RBAC assignments from the matrix (Blob Contributor, AcrPull, Monitoring Metrics Publisher).
