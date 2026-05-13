targetScope = 'subscription'

@description('Role definition id to use for deterministic deployment.')
param roleGuid string = '00000000-0000-0000-0000-000000001041'

resource operatorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: roleGuid
  properties: {
    roleName: 'Mydenicek Operator'
    description: 'Can operate mydenicek resources with read/write except RBAC changes.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Resources/subscriptions/resourceGroups/read'
          'Microsoft.Resources/subscriptions/resourceGroups/write'
          'Microsoft.Resources/subscriptions/resourceGroups/delete'
          'Microsoft.Compute/*/read'
          'Microsoft.Compute/*/write'
          'Microsoft.Network/*/read'
          'Microsoft.Network/*/write'
          'Microsoft.Storage/*/read'
          'Microsoft.Storage/*/write'
          'Microsoft.Web/*/read'
          'Microsoft.Web/*/write'
          'Microsoft.Insights/*/read'
          'Microsoft.Insights/*/write'
        ]
        notActions: [
          'Microsoft.Authorization/*/write'
          'Microsoft.Authorization/*/delete'
        ]
      }
    ]
    assignableScopes: [
      subscription().id
    ]
  }
}

output roleDefinitionId string = operatorRole.id
