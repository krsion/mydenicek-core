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
    service: 'sync'
  }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource appendContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${sa.name}/default/events'
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountName string = sa.name
output storageAccountId string = sa.id
