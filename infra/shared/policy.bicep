targetScope = 'subscription'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

// ── Built-in policy: require tag 'app=mydenicek' on all resource groups ───────
// Policy definition: "Require a tag on resource groups"
// Built-in definition ID: 96670d01-0a4d-4649-9c89-2d3abc0a5025
var requireTagPolicyDefinitionId = '/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025'

resource tagPolicyAssignment 'Microsoft.Authorization/policyAssignments@2023-04-01' = {
  name: 'require-app-tag-${environment}'
  properties: {
    displayName: '[${environment}] Require app=mydenicek tag on resource groups'
    description: 'Denies creation of resource groups that do not carry the app=mydenicek tag.'
    policyDefinitionId: requireTagPolicyDefinitionId
    enforcementMode: 'Default'
    parameters: {
      tagName: {
        value: 'app'
      }
      tagValue: {
        value: 'mydenicek'
      }
    }
  }
}

output policyAssignmentId string = tagPolicyAssignment.id
