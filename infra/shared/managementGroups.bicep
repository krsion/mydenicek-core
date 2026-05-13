// Management group hierarchy stub.
// NOTE: managementGroups are a tenant-level resource and must be deployed at
// tenant scope.  Run this file separately:
//   az deployment tenant create --location westeurope --template-file managementGroups.bicep
targetScope = 'tenant'

@description('Display name for the learning management group.')
param managementGroupDisplayName string = 'Mydenicek Learning'

@description('ID suffix for the learning management group.')
param managementGroupId string = 'mydenicek-learning'

// TODO: replace with your actual Azure tenant root management group ID.
// Retrieve it with: az account management-group list --query "[?displayName=='Tenant Root Group'].id" -o tsv
var tenantRootId = 'TODO_TENANT_ROOT_MANAGEMENT_GROUP_ID'

resource learningMg 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: managementGroupId
  properties: {
    displayName: managementGroupDisplayName
    details: {
      parent: {
        id: '/providers/Microsoft.Management/managementGroups/${tenantRootId}'
      }
    }
  }
}

output managementGroupId string = learningMg.id
output managementGroupName string = learningMg.name
