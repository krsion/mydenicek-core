targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param serviceRgName string = '${prefix}-attachments-rg'
param acrLoginServer string = ''
param imageTag string = 'latest'

resource serviceRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: serviceRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'attachments'
  }
}

module storage './storage.bicep' = {
  name: 'attachments-storage'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}attachments${uniqueString(subscription().id)}', '-', '')), 24)
  }
}

module container './containerGroup.bicep' = {
  name: 'attachments-container'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    containerGroupName: '${prefix}-attachments-aci'
    image: '${acrLoginServer}/attachments:${imageTag}'
  }
}

output resourceGroupName string = serviceRg.name
output principalId string = container.outputs.principalId
// TODO: Add RBAC assignments for attachments identity (Blob Delegator, Blob Contributor, AcrPull).
