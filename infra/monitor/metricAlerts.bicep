targetScope = 'resourceGroup'

@description('Resource ID of sa-acl storage account.')
param aclStorageResourceId string

@description('Action group resource ID.')
param actionGroupResourceId string

resource roleAssignmentChangesAlert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: 'sa-acl-role-assignment-changes'
  location: 'global'
  properties: {
    enabled: true
    scopes: [
      aclStorageResourceId
    ]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'Administrative'
        }
        {
          field: 'operationName'
          containsAny: [
            'Microsoft.Authorization/roleAssignments/write'
            'Microsoft.Authorization/roleAssignments/delete'
          ]
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: actionGroupResourceId
        }
      ]
    }
  }
}
