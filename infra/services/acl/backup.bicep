targetScope = 'resourceGroup'

param location string
param vaultName string

resource vault 'Microsoft.RecoveryServices/vaults@2024-01-01' = {
  name: vaultName
  location: location
  sku: {
    name: 'Standard'
  }
  tags: {
    app: 'mydenicek'
    service: 'acl'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

// TODO: Add backup policy + protected item wiring for ACL VM.
