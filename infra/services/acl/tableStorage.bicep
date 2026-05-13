targetScope = 'resourceGroup'

@description('Existing ACL storage account name (sa-acl).')
param storageAccountName string

resource aclStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  name: 'default'
  parent: aclStorage
}

resource aclTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: 'acl'
  parent: tableService
}

resource peersTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: 'peers'
  parent: tableService
}

output peersTableName string = peersTable.name
