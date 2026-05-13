targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param serviceRgName string = '${prefix}-docs-api-rg'
param acrLoginServer string = ''
param imageTag string = 'latest'

resource serviceRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: serviceRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'docs-api'
  }
}

module plan './appServicePlan.bicep' = {
  name: 'docs-api-plan'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    planName: '${prefix}-docs-plan'
  }
}

module table './tableStorage.bicep' = {
  name: 'docs-api-table-storage'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}docs${uniqueString(subscription().id)}', '-', '')), 24)
  }
}

module web './webApp.bicep' = {
  name: 'docs-api-web'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    appName: '${prefix}-docs-api'
    planId: plan.outputs.planId
    containerImage: '${acrLoginServer}/docs-api:${imageTag}'
    storageAccountName: table.outputs.storageAccountName
  }
}

output resourceGroupName string = serviceRg.name
output principalId string = web.outputs.principalId
// TODO: Add Storage Table Data Contributor assignment for docs-api managed identity.
