targetScope = 'resourceGroup'

param location string
param storageAccountName string
param principalId string = ''

resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  tags: {
    app: 'mydenicek'
    service: 'docs-api'
  }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource table 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: '${sa.name}/default/docs'
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(principalId)) {
  name: guid(sa.id, principalId, 'Storage Table Data Contributor')
  scope: sa
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
    principalType: 'ServicePrincipal'
  }
}

output storageAccountName string = sa.name
output storageAccountId string = sa.id
