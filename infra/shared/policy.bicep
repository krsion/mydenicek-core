targetScope = 'subscription'

@description('Policy definition name.')
param policyName string = 'require-mydenicek-app-tag'

resource requireAppTagDefinition 'Microsoft.Authorization/policyDefinitions@2023-04-01' = {
  name: policyName
  properties: {
    displayName: 'Require app=mydenicek tag'
    description: 'Deny creation of resources without app=mydenicek tag.'
    mode: 'All'
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type'
            notEquals: 'Microsoft.Resources/subscriptions/resourceGroups'
          }
          {
            field: 'tags.app'
            notEquals: 'mydenicek'
          }
        ]
      }
      then: {
        effect: 'deny'
      }
    }
  }
}

resource requireAppTagAssignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'assign-${policyName}'
  properties: {
    displayName: 'Require app=mydenicek tag assignment'
    policyDefinitionId: requireAppTagDefinition.id
  }
}

output assignmentId string = requireAppTagAssignment.id
