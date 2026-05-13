targetScope = 'subscription'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

// Stable GUID derived from subscription ID + role name so re-deployments are idempotent.
var roleDefName = guid(subscription().id, 'MydenicekOperator', environment)

resource mydenicekOperatorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: roleDefName
  properties: {
    roleName: 'Mydenicek Operator (${environment})'
    description: 'Can restart compute resources and read everything, but cannot delete resources.'
    type: 'CustomRole'
    assignableScopes: [
      subscription().id
    ]
    permissions: [
      {
        actions: [
          '*/read'
          'Microsoft.Compute/virtualMachines/restart/action'
          'Microsoft.Compute/virtualMachineScaleSets/restart/action'
          'Microsoft.Web/sites/restart/action'
          'Microsoft.ContainerInstance/containerGroups/restart/action'
        ]
        notActions: [
          '*/delete'
        ]
        dataActions: []
        notDataActions: []
      }
    ]
  }
}

output roleDefinitionId string = mydenicekOperatorRole.id
output roleDefinitionName string = mydenicekOperatorRole.name
