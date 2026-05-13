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
    service: 'acl'
  }
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  name: '${sa.name}/default/shared-docs'
  properties: {
    shareQuota: 100
    accessTier: 'TransactionOptimized'
  }
}

resource fileRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(principalId)) {
  name: guid(sa.id, principalId, 'Storage File Data SMB Share Contributor')
  scope: sa
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0c867c2a-1d8c-454a-a3db-ab2ea1bdc8bb')
    principalType: 'ServicePrincipal'
  }
}

output storageAccountName string = sa.name
output storageAccountId string = sa.id
