targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param serviceRgName string = '${prefix}-acl-rg'

resource serviceRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: serviceRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'acl'
  }
}

module vm './vm.bicep' = {
  name: 'acl-vm'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    vmName: '${prefix}-acl-vm'
  }
}

module backup './backup.bicep' = {
  name: 'acl-backup'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    vaultName: '${prefix}-acl-rsv'
  }
}

module table './tableStorage.bicep' = {
  name: 'acl-table'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}acl${uniqueString(subscription().id)}', '-', '')), 24)
  }
}

module files './fileShare.bicep' = {
  name: 'acl-files'
  scope: resourceGroup(serviceRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}shared${uniqueString(subscription().id)}', '-', '')), 24)
  }
}

output resourceGroupName string = serviceRg.name
output principalId string = vm.outputs.principalId
// TODO: Add RBAC assignments for ACL VM (Table Contributor + File Share SMB Contributor).
