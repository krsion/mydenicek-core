targetScope = 'tenant'

@description('Root management group name.')
param rootManagementGroupName string = 'mydenicek-root'

@description('Parent management group name.')
param contosoManagementGroupName string = 'contoso'

resource rootMg 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: rootManagementGroupName
  properties: {
    displayName: 'Root'
  }
}

resource contosoMg 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: contosoManagementGroupName
  properties: {
    displayName: 'Contoso'
    details: {
      parent: {
        id: rootMg.id
      }
    }
  }
}

resource prodMg 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: 'prod'
  properties: {
    displayName: 'Prod'
    details: {
      parent: {
        id: contosoMg.id
      }
    }
  }
}

resource devMg 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: 'dev'
  properties: {
    displayName: 'Dev'
    details: {
      parent: {
        id: contosoMg.id
      }
    }
  }
}

output contosoManagementGroupId string = contosoMg.id
