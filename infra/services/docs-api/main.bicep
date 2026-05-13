targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param computeRgName string = '${prefix}-docs-api-compute-rg'
param dataRgName string = '${prefix}-docs-api-data-rg'
param acrLoginServer string = ''
param imageTag string = 'latest'
var docsStorageAccountName = take(toLower(replace('${prefix}docs${uniqueString(subscription().id)}', '-', '')), 24)

resource computeRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: computeRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'docs-api'
  }
}

resource dataRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: dataRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'docs-api'
    tier: 'data'
  }
}

module plan './appServicePlan.bicep' = {
  name: 'docs-api-plan'
  scope: resourceGroup(computeRg.name)
  params: {
    location: location
    planName: '${prefix}-docs-plan'
  }
}

module table './tableStorage.bicep' = {
  name: 'docs-api-table-storage'
  scope: resourceGroup(dataRg.name)
  params: {
    location: location
    storageAccountName: docsStorageAccountName
    principalId: web.outputs.principalId
  }
}

module web './webApp.bicep' = {
  name: 'docs-api-web'
  scope: resourceGroup(computeRg.name)
  params: {
    location: location
    appName: '${prefix}-docs-api'
    planId: plan.outputs.planId
    containerImage: '${acrLoginServer}/docs-api:${imageTag}'
    storageAccountName: docsStorageAccountName
  }
}

output computeResourceGroupName string = computeRg.name
output dataResourceGroupName string = dataRg.name
output principalId string = web.outputs.principalId
