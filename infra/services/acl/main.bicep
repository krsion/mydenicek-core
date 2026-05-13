targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param computeRgName string = '${prefix}-acl-compute-rg'
param dataRgName string = '${prefix}-acl-data-rg'
param adminSshPublicKey string = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDPLACEHOLDER'
param networkInterfaceResourceId string = '/subscriptions/TODO/resourceGroups/TODO/providers/Microsoft.Network/networkInterfaces/TODO'

resource computeRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: computeRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'acl'
  }
}

resource dataRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: dataRgName
  location: location
  tags: {
    app: 'mydenicek'
    service: 'acl'
    tier: 'data'
  }
}

module vm './vm.bicep' = {
  name: 'acl-vm'
  scope: resourceGroup(computeRg.name)
  params: {
    location: location
    vmName: '${prefix}-acl-vm'
    adminSshPublicKey: adminSshPublicKey
    networkInterfaceResourceId: networkInterfaceResourceId
  }
}

module backup './backup.bicep' = {
  name: 'acl-backup'
  scope: resourceGroup(computeRg.name)
  params: {
    location: location
    vaultName: '${prefix}-acl-rsv'
  }
}

module table './tableStorage.bicep' = {
  name: 'acl-table'
  scope: resourceGroup(dataRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}acl${uniqueString(subscription().id)}', '-', '')), 24)
    principalId: vm.outputs.principalId
  }
}

module files './fileShare.bicep' = {
  name: 'acl-files'
  scope: resourceGroup(dataRg.name)
  params: {
    location: location
    storageAccountName: take(toLower(replace('${prefix}shared${uniqueString(subscription().id)}', '-', '')), 24)
    principalId: vm.outputs.principalId
  }
}

output computeResourceGroupName string = computeRg.name
output dataResourceGroupName string = dataRg.name
output principalId string = vm.outputs.principalId
