targetScope = 'resourceGroup'

@description('Existing ACL storage account name (sa-acl).')
param aclStorageAccountName string

@description('Principal ID of the sync VMSS managed identity.')
param syncVmssPrincipalId string

resource aclStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: aclStorageAccountName
}

resource tableDataReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aclStorage.id, syncVmssPrincipalId, 'Storage Table Data Reader')
  scope: aclStorage
  properties: {
    principalId: syncVmssPrincipalId
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '76199698-9eea-4c19-bc75-cec21354c6b6'
    )
    principalType: 'ServicePrincipal'
  }
}

output tableReaderRoleAssignmentId string = tableDataReaderRole.id
