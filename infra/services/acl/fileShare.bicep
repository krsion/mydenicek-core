targetScope = 'resourceGroup'

param location string
param storageAccountName string

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

output storageAccountName string = sa.name
output storageAccountId string = sa.id
