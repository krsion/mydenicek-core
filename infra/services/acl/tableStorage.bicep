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
  properties: {
    minimumTlsVersion: 'TLS1_2'
  }
}

resource table 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: '${sa.name}/default/acl'
}

output storageAccountName string = sa.name
output storageAccountId string = sa.id
