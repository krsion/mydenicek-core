targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param computeRgName string = '${prefix}-attachments-compute-rg'
param dataRgName string = '${prefix}-attachments-data-rg'
param acrLoginServer string = ''
param imageTag string = 'latest'

resource computeRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: computeRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'attachments'
  }
}

resource dataRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: dataRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'attachments'
    tier: 'data'
  }
}

module storage './storage.bicep' = {
  name: 'attachments-storage'
  scope: resourceGroup(dataRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}attachments${uniqueString(subscription().id)}', '-', '')), 24)
    principalId: container.outputs.principalId
  }
}

module container './containerGroup.bicep' = {
  name: 'attachments-container'
  scope: resourceGroup(computeRg.name)
  params: {
    location: location
    containerGroupName: '${prefix}-attachments-aci'
    image: '${acrLoginServer}/attachments:${imageTag}'
  }
}

output computeResourceGroupName string = computeRg.name
output dataResourceGroupName string = dataRg.name
output principalId string = container.outputs.principalId
// TODO: Add AcrPull assignment for attachments managed identity at shared ACR scope.
