targetScope = 'resourceGroup'

@description('Name of the Recovery Services Vault.')
param name string

@description('Azure region.')
param location string

@description('Resource ID of the VM to protect.')
param vmId string

@description('Name of the VM (used in backup item name).')
param vmName string

@description('Resource tags.')
param tags object = {}

resource vault 'Microsoft.RecoveryServices/vaults@2024-04-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'RS0'
    tier: 'Standard'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

// Daily backup policy: retain for 7 days
resource backupPolicy 'Microsoft.RecoveryServices/vaults/backupPolicies@2024-04-01' = {
  parent: vault
  name: 'policy-daily-7d'
  properties: {
    backupManagementType: 'AzureIaasVM'
    instantRpRetentionRangeInDays: 2
    schedulePolicy: {
      schedulePolicyType: 'SimpleSchedulePolicy'
      scheduleRunFrequency: 'Daily'
      scheduleRunTimes: ['2024-01-01T02:00:00Z']
    }
    retentionPolicy: {
      retentionPolicyType: 'LongTermRetentionPolicy'
      dailySchedule: {
        retentionTimes: ['2024-01-01T02:00:00Z']
        retentionDuration: {
          count: 7
          durationType: 'Days'
        }
      }
    }
    timeZone: 'UTC'
  }
}

// Protected item — links the policy to the VM
// NOTE: the container name and item name follow the Azure Backup naming convention.
// The fabricName is always 'Azure' for IaaS VMs.
resource protectedItem 'Microsoft.RecoveryServices/vaults/backupFabrics/protectionContainers/protectedItems@2024-04-01' = {
  // Container name format: iaasvmcontainerv2;<resourceGroup>;<vmName>
  name: '${name}/Azure/iaasvmcontainerv2;${resourceGroup().name};${vmName}/vm;iaasvmcontainerv2;${resourceGroup().name};${vmName}'
  location: location
  properties: {
    protectedItemType: 'Microsoft.Compute/virtualMachines'
    policyId: backupPolicy.id
    sourceResourceId: vmId
  }
}

output vaultId string = vault.id
output vaultName string = vault.name
output backupPolicyId string = backupPolicy.id
